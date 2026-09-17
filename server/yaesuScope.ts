import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import type { ServerContext } from "./context.ts";
import { vlogSpectrum, createRateLogger } from "./vlog.ts";

const RESTART_DELAY_MS = 3000;
const RETRY_BUDGET_MS = 30000;
const MAX_LINE_BUFFER_BYTES = 8192; // several legit frames' worth (~1.9KB each) of headroom

// Splits every complete (newline-terminated) line off the front of buffer, returning them
// in order plus whatever incomplete trailing partial line is left over. A single stdout
// 'data' chunk can legitimately bundle several ~1.9KB NDJSON frames at once — Node hands
// over whatever the pipe delivered, not one line at a time — so callers must drain
// complete lines this way before ever judging the buffer's total size.
export function splitCompleteLines(buffer: string): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let rest = buffer;
  let newline: number;
  while ((newline = rest.indexOf("\n")) !== -1) {
    lines.push(rest.slice(0, newline));
    rest = rest.slice(newline + 1);
  }
  return { lines, remainder: rest };
}

// Guards against a corrupted or stuck ft4222-scope-reader stream (a chunk with no trailing
// newline — a crash mid-write or an unexpected frame-format change) growing lineBuffer
// without bound forever. Must only ever be called on the post-splitCompleteLines()
// remainder, never the raw buffer — otherwise it discards perfectly valid, complete lines
// just because several of them together exceed maxBytes.
export function guardLineBufferSize(
  buffer: string,
  maxBytes: number = MAX_LINE_BUFFER_BYTES
): { buffer: string; wasReset: boolean } {
  if (buffer.length <= maxBytes) return { buffer, wasReset: false };
  return { buffer: "", wasReset: true };
}

export function getYaesuScopeHelperPath(baseDir: string): string {
  let platformDir: string;
  let binaryName: string;
  if (process.platform === "win32") {
    platformDir = "windows";
    binaryName = "ft4222-scope-reader.exe";
  } else if (process.platform === "darwin") {
    platformDir = "mac";
    binaryName = "ft4222-scope-reader";
  } else {
    platformDir = "linux";
    binaryName = "ft4222-scope-reader";
  }

  let binBase = baseDir;
  if (binBase.endsWith(".asar")) binBase = binBase.replace(".asar", ".asar.unpacked");

  const fullPath = path.join(binBase, "bin", platformDir, binaryName);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[YAESU-SCOPE] binary not found at ${fullPath} — run 'npm run build:ft4222-reader'`);
  }
  return fullPath;
}

export function startYaesuScope(ctx: ServerContext, isRetry = false): void {
  if (ctx.yaesuScopeRestartTimer) {
    clearTimeout(ctx.yaesuScopeRestartTimer);
    ctx.yaesuScopeRestartTimer = null;
  }
  if (!isRetry) {
    ctx.yaesuScopeRetryStartedAt = null;
  }

  if (ctx.yaesuScopeProcess && !ctx.yaesuScopeProcess.killed) {
    return;
  }

  const binaryPath = getYaesuScopeHelperPath(ctx.baseDir);
  vlogSpectrum(`[YAESU-SCOPE] Starting ${binaryPath}`);

  const spawnOpts: Parameters<typeof spawn>[2] = { stdio: ["ignore", "pipe", "pipe"] };
  if (process.platform === "win32" && ctx.baseDir.includes(".asar")) {
    const appInstallDir = path.resolve(ctx.baseDir, "..", "..");
    spawnOpts.env = { ...process.env, PATH: `${appInstallDir};${process.env.PATH ?? ""}` };
    vlogSpectrum(`[YAESU-SCOPE] Added ${appInstallDir} to DLL search path`);
  }

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(binaryPath, [], spawnOpts);
  } catch (err: any) {
    console.error(`[YAESU-SCOPE] Failed to spawn: ${err.message}`);
    ctx.yaesuScopeProcess = null;
    return;
  }

  ctx.yaesuScopeProcess = proc;

  let started = false;
  let lineBuffer = "";
  let frameCount = 0;
  let lastFrameTime = 0;
  const rateLog = createRateLogger<{ spanHz: number; centerHz: number; modeVariant: number }>(1000, (count, elapsed, meta) => {
    const fps = Math.round(count / elapsed);
    vlogSpectrum(`[YAESU-SCOPE] ${fps} fps (${frameCount} total); span=${meta.spanHz}Hz center=${meta.centerHz}Hz mode=${meta.modeVariant}`);
  });
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;

  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    lineBuffer += chunk;
    // Drain every complete line first — a single 'data' chunk can legitimately bundle
    // several ~1.9KB frames (Node delivers whatever the pipe handed it, not one line at a
    // time), so the size guard below must only ever see the leftover partial-line
    // remainder, never the pre-drain buffer, or it discards perfectly valid data.
    const split = splitCompleteLines(lineBuffer);
    lineBuffer = split.remainder;
    for (const rawLine of split.lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (!started) {
        if (line.startsWith("OPEN_OK")) {
          started = true;
          lastFrameTime = Date.now();
          vlogSpectrum("[YAESU-SCOPE] Device opened, receiving spectrum data");
          ctx.yaesuScopeRunning = true;
          ctx.yaesuScopeError = null;
          ctx.yaesuScopeRetryStartedAt = null;
          ctx.io.emit("yaesu-scope-status", { running: true, error: null });
          watchdogTimer = setInterval(() => {
            const silence = Date.now() - lastFrameTime;
            if (silence > 15000) {
              console.warn(`[YAESU-SCOPE] No frames received for ${Math.round(silence / 1000)}s — process may be stuck in re-init loop`);
            }
          }, 5000);
        } else if (line.startsWith("OPEN_ERROR:")) {
          const msg = line.slice("OPEN_ERROR:".length).trim();
          console.error(`[YAESU-SCOPE] ${msg}`);
          ctx.yaesuScopeRunning = false;
          ctx.yaesuScopeError = msg;
          ctx.io.emit("yaesu-scope-status", { running: false, error: msg });
        }
        continue;
      }

      /* Parse NDJSON frame */
      let frame: any;
      try {
        frame = JSON.parse(line);
      } catch {
        vlogSpectrum(`[YAESU-SCOPE] Bad JSON: ${line.slice(0, 80)}`);
        continue;
      }

      const wf1Hex: string = frame.wf1 ?? "";
      if (wf1Hex.length !== 1700) {
        vlogSpectrum(`[YAESU-SCOPE] Unexpected wf1 length ${wf1Hex.length}`);
        continue;
      }

      const amplitudes: number[] = new Array(850);
      for (let i = 0; i < 850; i++) {
        amplitudes[i] = parseInt(wf1Hex.slice(i * 2, i * 2 + 2), 16);
      }

      const centerHz: number = frame.centerHz ?? 0;
      const spanHz:   number = frame.spanHz   ?? 0;
      const lowHz:    number = frame.lowHz    ?? 0;
      const highHz:   number = frame.highHz   ?? 0;
      const modeVariant: number = frame.modeVariant ?? 0;

      frameCount++;
      lastFrameTime = Date.now();
      rateLog({ spanHz, centerHz, modeVariant });

      ctx.io.emit("spectrum-data", {
        id: 0,
        name: "FT-710",
        type: modeVariant === 2 ? "FIXED" : "CENTER",
        length: amplitudes.length,
        amplitudes,
        minLevel: -130,
        maxLevel: -20,
        centerFreq: centerHz,
        span: spanHz,
        lowFreq: lowHz,
        highFreq: highHz,
        timestamp: Date.now(),
      });
    }

    // Whatever's left in lineBuffer now is a partial line with no newline yet — the only
    // thing that can legitimately grow without bound (a crash mid-write, a stuck stream, or
    // an unexpected frame-format change).
    const guarded = guardLineBufferSize(lineBuffer);
    if (guarded.wasReset) {
      console.warn(`[YAESU-SCOPE] lineBuffer exceeded ${MAX_LINE_BUFFER_BYTES} bytes with no newline — discarding (corrupted/stuck stream?)`);
      ctx.yaesuScopeError = "Malformed data stream from ft4222-scope-reader — buffer reset";
      ctx.io.emit("yaesu-scope-status", { running: ctx.yaesuScopeRunning, error: ctx.yaesuScopeError });
    }
    lineBuffer = guarded.buffer;
  });

  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (data: string) => {
    vlogSpectrum(`[YAESU-SCOPE] stderr: ${data.trim()}`);
  });

  proc.on("close", (code) => {
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }

    /* If stopYaesuScope already nulled our slot and a new process was started,
       this close event belongs to the old process — don't touch ctx state or
       schedule a restart, which would create a second concurrent reader. */
    if (ctx.yaesuScopeProcess !== proc) return;

    vlogSpectrum(`[YAESU-SCOPE] Process exited (code=${code})`);
    ctx.yaesuScopeProcess = null;
    ctx.yaesuScopeRunning = false;
    ctx.yaesuScopeError = null;
    ctx.io.emit("yaesu-scope-status", { running: false, error: null });

    /* Auto-restart if spectrum is still enabled and source is still ft4222 and radio is not powered off,
       but only within a bounded retry budget — otherwise a device that's genuinely gone (or never
       re-enumerates after a power cycle) would crash-loop forever. Mirrors the rig TCP reconnect
       pattern in rigComm.ts: fixed-delay retries bounded by an overall wall-clock budget, then give up
       and require an explicit user action (re-enable spectrum) to try again. */
    if (ctx.spectrumSettings.enabled && ctx.spectrumSettings.source === "ft4222" && ctx.powerState !== 'off') {
      if (ctx.yaesuScopeRetryStartedAt === null) {
        ctx.yaesuScopeRetryStartedAt = Date.now();
      }
      const elapsed = Date.now() - ctx.yaesuScopeRetryStartedAt;
      if (elapsed >= RETRY_BUDGET_MS) {
        const msg = `FT4222 device not found after ${Math.round(RETRY_BUDGET_MS / 1000)}s of retries — check the USB connection, then re-enable spectrum to try again`;
        vlogSpectrum(`[YAESU-SCOPE] Giving up — ${msg}`);
        ctx.yaesuScopeError = msg;
        ctx.yaesuScopeRetryStartedAt = null;
        ctx.io.emit("yaesu-scope-status", { running: false, error: msg });
        return;
      }
      vlogSpectrum(`[YAESU-SCOPE] Restarting in ${RESTART_DELAY_MS}ms`);
      ctx.yaesuScopeRestartTimer = setTimeout(() => {
        ctx.yaesuScopeRestartTimer = null;
        if (ctx.spectrumSettings.enabled && ctx.spectrumSettings.source === "ft4222" && ctx.powerState !== 'off') {
          startYaesuScope(ctx, true);
        }
      }, RESTART_DELAY_MS);
    }
  });

  proc.on("error", (err) => {
    console.error(`[YAESU-SCOPE] Process error: ${err.message}`);
    ctx.yaesuScopeProcess = null;
  });
}

export function stopYaesuScope(ctx: ServerContext): void {
  if (ctx.yaesuScopeRestartTimer) {
    clearTimeout(ctx.yaesuScopeRestartTimer);
    ctx.yaesuScopeRestartTimer = null;
  }
  ctx.yaesuScopeRetryStartedAt = null;
  if (ctx.yaesuScopeProcess && !ctx.yaesuScopeProcess.killed) {
    vlogSpectrum("[YAESU-SCOPE] Stopping");
    ctx.yaesuScopeProcess.kill("SIGTERM");
    ctx.yaesuScopeProcess = null;
  }
  ctx.yaesuScopeRunning = false;
  ctx.yaesuScopeError = null;
  ctx.io.emit("yaesu-scope-status", { running: false, error: null });
}
