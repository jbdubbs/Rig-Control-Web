import path from "path";
import { spawn } from "child_process";
import { Socket } from "socket.io";
import { ServerContext, CwPaddleEvent } from "./context.ts";

const CW_BUFFER_DEPTH_MS = 60;
const CW_BUFFER_MAX_MS = 240;

export function getCwHelperPath(baseDir: string): string {
  let base = baseDir;
  if (base.endsWith(".asar")) base = base.replace(".asar", ".asar.unpacked");
  return path.join(base, "cw-key-helper.py");
}

const setSerialKey = (ctx: ServerContext, active: boolean): Promise<void> => {
  if (!ctx.cwKeyerProcess || ctx.cwKeyerProcess.killed) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      ctx.cwKeyerProcess!.stdin!.write(active ? "1\n" : "0\n", () => resolve());
    } catch (_) {
      resolve();
    }
  });
};

const sendCwCatPtt = (ctx: ServerContext, state: boolean, clientId: string) => {
  ctx.sendToRig(`T ${state ? 1 : 0}`, false, true).catch((err) => {
    console.error("[CW] CAT PTT error:", err);
    if (ctx.cwStuckKeyTimer) { clearTimeout(ctx.cwStuckKeyTimer); ctx.cwStuckKeyTimer = null; }
    ctx.cwKeyLockedOut = false;
    ctx.activeCwClientId = null;
    ctx.cwIsKeying = false;
    ctx.io.to(clientId).emit("cw-stuck-key-alert");
  });
};

const setCwKeyingActive = (ctx: ServerContext, active: boolean) => {
  ctx.cwIsKeying = active;
  if (!active) {
    if (ctx.cwIdleTimer) clearTimeout(ctx.cwIdleTimer);
    ctx.cwIdleTimer = setTimeout(() => {
      ctx.cwIsKeying = false;
      ctx.cwIdleTimer = null;
    }, 500);
  } else {
    if (ctx.cwIdleTimer) { clearTimeout(ctx.cwIdleTimer); ctx.cwIdleTimer = null; }
  }
};

export function cwSetKey(ctx: ServerContext, active: boolean): void {
  if (ctx.cwKeyIsDown === active) return;
  ctx.cwKeyIsDown = active;
  if (active) {
    if (ctx.cwIdleTimer) { clearTimeout(ctx.cwIdleTimer); ctx.cwIdleTimer = null; }
    ctx.cwStuckKeyTimer = setTimeout(() => {
      ctx.cwStuckKeyTimer = null;
      if (ctx.cwSettings.keyingMethod === "rigctld-ptt") {
        sendCwCatPtt(ctx, false, ctx.activeCwClientId ?? "");
      } else {
        setSerialKey(ctx, false).catch((err) => console.error("[CW] Watchdog key-up error:", err.message));
      }
      ctx.cwKeyIsDown = false;
      ctx.cwKeyLockedOut = true;
      const cid = ctx.activeCwClientId;
      ctx.activeCwClientId = null;
      stopCwTick(ctx);
      setCwKeyingActive(ctx, false);
      if (cid) ctx.io.to(cid).emit("cw-stuck-key-alert");
      console.warn("[CW] Stuck-key watchdog fired — key forced inactive");
    }, 5000);
    setCwKeyingActive(ctx, true);
  } else {
    if (ctx.cwStuckKeyTimer) { clearTimeout(ctx.cwStuckKeyTimer); ctx.cwStuckKeyTimer = null; }
    setCwKeyingActive(ctx, false);
  }
  if (ctx.cwSettings.keyingMethod === "rigctld-ptt") {
    sendCwCatPtt(ctx, active, ctx.activeCwClientId ?? "");
  } else {
    setSerialKey(ctx, active).catch((err) => console.error("[CW] Key set error:", err.message));
  }
}

export function stopCwTick(ctx: ServerContext): void {
  if (ctx.cwTickTimer) { clearTimeout(ctx.cwTickTimer); ctx.cwTickTimer = null; }
}

export function cwTick(ctx: ServerContext): void {
  ctx.cwTickTimer = null;
  if (!ctx.activeCwClientId) return;

  const connectMs = ctx.socketConnectTimes.get(ctx.activeCwClientId) ?? Date.now();
  const nowClientMs = Date.now() - connectMs;
  const playheadMs = nowClientMs - CW_BUFFER_DEPTH_MS;

  while (ctx.cwPaddleBuffer.length > 0 && ctx.cwPaddleBuffer[0].t <= playheadMs) {
    const evt = ctx.cwPaddleBuffer.shift()!;
    ctx.cwPlayheadDit = evt.dit;
    ctx.cwPlayheadDah = evt.dah;
    ctx.cwPlayheadStraight = evt.straight;
  }

  if (!ctx.cwBufferReady) {
    if (nowClientMs >= CW_BUFFER_DEPTH_MS) {
      ctx.cwBufferReady = true;
    } else {
      ctx.cwTickTimer = setTimeout(() => cwTick(ctx), 4);
      return;
    }
  }

  if (ctx.cwKeyLockedOut) {
    if (!ctx.cwPlayheadDit && !ctx.cwPlayheadDah && !ctx.cwPlayheadStraight) ctx.cwKeyLockedOut = false;
    else { ctx.cwTickTimer = setTimeout(() => cwTick(ctx), 4); return; }
  }

  const ditMs = (1.2 / ctx.cwSettings.wpm) * 1000;
  const nowMs = Date.now();

  if (ctx.cwSettings.mode === "straight") {
    const wantDown = ctx.cwPlayheadStraight;
    if (wantDown !== ctx.cwKeyIsDown) cwSetKey(ctx, wantDown);
  } else {
    if (ctx.cwMachine === "IDLE") {
      if (ctx.cwPlayheadDit && !ctx.cwPlayheadDah) {
        ctx.cwMachine = "SENDING_DIT"; ctx.cwElementEndMs = nowMs + ditMs; ctx.cwPendingElement = null; cwSetKey(ctx, true);
      } else if (ctx.cwPlayheadDah && !ctx.cwPlayheadDit) {
        ctx.cwMachine = "SENDING_DAH"; ctx.cwElementEndMs = nowMs + ditMs * 3; ctx.cwPendingElement = null; cwSetKey(ctx, true);
      } else if (ctx.cwPlayheadDit && ctx.cwPlayheadDah) {
        ctx.cwMachine = "SENDING_DIT"; ctx.cwElementEndMs = nowMs + ditMs; ctx.cwPendingElement = "dah"; cwSetKey(ctx, true);
      }
    } else if (ctx.cwMachine === "SENDING_DIT" || ctx.cwMachine === "SENDING_DAH") {
      if (ctx.cwSettings.mode === "iambic-b") {
        if (ctx.cwMachine === "SENDING_DIT" && ctx.cwPlayheadDah && ctx.cwPendingElement !== "dah") ctx.cwPendingElement = "dah";
        else if (ctx.cwMachine === "SENDING_DAH" && ctx.cwPlayheadDit && ctx.cwPendingElement !== "dit") ctx.cwPendingElement = "dit";
      }
      if (nowMs >= ctx.cwElementEndMs) {
        cwSetKey(ctx, false);
        ctx.cwMachine = "INTER_ELEMENT";
        // Advance from scheduled element end, not from nowMs, to prevent drift accumulation.
        ctx.cwElementEndMs += ditMs;
      }
    } else if (ctx.cwMachine === "INTER_ELEMENT") {
      if (nowMs >= ctx.cwElementEndMs) {
        let next: "dit" | "dah" | null = null;
        if (ctx.cwSettings.mode === "iambic-b" && ctx.cwPendingElement) {
          next = ctx.cwPendingElement;
        } else if (ctx.cwPlayheadDit && ctx.cwPlayheadDah) {
          next = ctx.cwPendingElement === "dah" ? "dah" : "dit";
        } else if (ctx.cwPlayheadDit) {
          next = "dit";
        } else if (ctx.cwPlayheadDah) {
          next = "dah";
        }
        ctx.cwPendingElement = null;
        if (next === "dit") {
          ctx.cwMachine = "SENDING_DIT"; ctx.cwElementEndMs += ditMs;
          if (ctx.cwSettings.mode === "iambic-b" && ctx.cwPlayheadDah) ctx.cwPendingElement = "dah";
          cwSetKey(ctx, true);
        } else if (next === "dah") {
          ctx.cwMachine = "SENDING_DAH"; ctx.cwElementEndMs += ditMs * 3;
          if (ctx.cwSettings.mode === "iambic-b" && ctx.cwPlayheadDit) ctx.cwPendingElement = "dit";
          cwSetKey(ctx, true);
        } else {
          ctx.cwMachine = "IDLE";
        }
      }
    }
  }

  ctx.cwTickTimer = setTimeout(() => cwTick(ctx), 4);
}

export async function openKeyerPort(ctx: ServerContext, portPath: string): Promise<void> {
  await closeKeyerPort(ctx);
  if (!portPath) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => { if (!settled) { settled = true; resolve(); } };

    const proc = spawn("python3", [
      getCwHelperPath(ctx.baseDir),
      portPath,
      ctx.cwSettings.keyingMethod === "rts" ? "rts" : "dtr",
      ctx.cwSettings.serialKeyPolarity,
    ]);

    let buf = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("OPEN_OK")) {
          ctx.cwKeyerProcess = proc;
          proc.on("close", (code) => {
            if (ctx.cwKeyerProcess === proc) {
              ctx.cwKeyerProcess = null;
              console.warn(`[CW] Keyer helper exited (code ${code})`);
              ctx.io.emit("cw-port-status", { open: false, port: portPath, error: "Helper process exited unexpectedly" });
            }
          });
          console.log(`[CW] Keyer port opened: ${portPath}`);
          ctx.io.emit("cw-port-status", { open: true, port: portPath });
          settle();
        } else if (line.startsWith("OPEN_ERROR:")) {
          const msg = line.slice("OPEN_ERROR:".length).trim();
          console.error(`[CW] Failed to open keyer port ${portPath}: ${msg}`);
          proc.kill();
          ctx.io.emit("cw-port-status", { open: false, port: portPath, error: msg });
          settle();
        }
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      console.error("[CW] Helper stderr:", chunk.toString().trim());
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      const msg = err.code === "ENOENT"
        ? "python3 not found — install Python 3 with pyserial"
        : err.message;
      console.error(`[CW] Failed to spawn helper:`, msg);
      ctx.io.emit("cw-port-status", { open: false, port: portPath, error: msg });
      settle();
    });

    setTimeout(() => {
      if (!settled) {
        proc.kill();
        ctx.io.emit("cw-port-status", { open: false, port: portPath, error: "Helper did not respond — check python3 and pyserial" });
        settle();
      }
    }, 5000);
  });
}

export async function closeKeyerPort(ctx: ServerContext): Promise<void> {
  stopCwTick(ctx);
  if (ctx.cwStuckKeyTimer) { clearTimeout(ctx.cwStuckKeyTimer); ctx.cwStuckKeyTimer = null; }
  if (ctx.cwIdleTimer) { clearTimeout(ctx.cwIdleTimer); ctx.cwIdleTimer = null; }
  if (ctx.cwClaimIdleTimer) { clearTimeout(ctx.cwClaimIdleTimer); ctx.cwClaimIdleTimer = null; }
  if (ctx.cwKeyerProcess && !ctx.cwKeyerProcess.killed) {
    await setSerialKey(ctx, false);
    ctx.cwKeyerProcess.kill();
  }
  ctx.cwKeyerProcess = null;
  ctx.cwKeyLockedOut = false;
  ctx.activeCwClientId = null;
  ctx.cwIsKeying = false;
  ctx.cwKeyIsDown = false;
  ctx.cwMachine = "IDLE";
  ctx.cwPaddleBuffer = [];
}

export async function syncKeyerPort(ctx: ServerContext, forceReopen = false): Promise<void> {
  const needsPort = ctx.cwSettings.enabled
    && ctx.cwSettings.keyingMethod !== "rigctld-ptt"
    && !!ctx.cwSettings.keyerPort;
  if (needsPort) {
    if (!ctx.cwKeyerProcess || ctx.cwKeyerProcess.killed || forceReopen) {
      await openKeyerPort(ctx, ctx.cwSettings.keyerPort);
    }
  } else if (ctx.cwKeyerProcess && !ctx.cwKeyerProcess.killed) {
    await closeKeyerPort(ctx);
  }
}

export function registerCwHandlers(socket: Socket, ctx: ServerContext): void {
  socket.on("cw-paddle", ({ dit, dah, straight, t }: { dit: boolean; dah: boolean; straight: boolean; t: number }) => {
    const anyActive = dit || dah || straight;

    if (anyActive) {
      if (ctx.cwKeyLockedOut) return;
      if (ctx.activeCwClientId && ctx.activeCwClientId !== socket.id) return;
      if (!ctx.activeCwClientId) {
        ctx.activeCwClientId = socket.id;
        ctx.cwPaddleBuffer = [];
        ctx.cwPlayheadDit = false; ctx.cwPlayheadDah = false; ctx.cwPlayheadStraight = false;
        ctx.cwMachine = "IDLE"; ctx.cwPendingElement = null; ctx.cwElementEndMs = 0;
        ctx.cwKeyIsDown = false; ctx.cwBufferReady = false;
        ctx.cwTickTimer = setTimeout(() => cwTick(ctx), 4);
      }
    }

    if (ctx.activeCwClientId !== socket.id) return;

    if (ctx.cwClaimIdleTimer) clearTimeout(ctx.cwClaimIdleTimer);
    ctx.cwClaimIdleTimer = setTimeout(() => {
      ctx.cwClaimIdleTimer = null;
      if (!ctx.cwKeyIsDown) {
        ctx.activeCwClientId = null;
        stopCwTick(ctx);
        ctx.cwMachine = "IDLE";
        ctx.cwPaddleBuffer = [];
      }
    }, 3000);

    const evt: CwPaddleEvent = { t, dit, dah, straight };
    let i = ctx.cwPaddleBuffer.length;
    while (i > 0 && ctx.cwPaddleBuffer[i - 1].t > t) i--;
    ctx.cwPaddleBuffer.splice(i, 0, evt);

    const connectMs = ctx.socketConnectTimes.get(socket.id) ?? Date.now();
    const ceilingT = (Date.now() - connectMs) - CW_BUFFER_MAX_MS;
    while (ctx.cwPaddleBuffer.length > 0 && ctx.cwPaddleBuffer[0].t < ceilingT) ctx.cwPaddleBuffer.shift();
  });

  socket.on("update-cw-settings", async (partial: Partial<typeof ctx.cwSettings>) => {
    const oldPolarity = ctx.cwSettings.serialKeyPolarity;
    ctx.cwSettings = { ...ctx.cwSettings, ...partial };
    const polarityChanged = partial.serialKeyPolarity !== undefined && partial.serialKeyPolarity !== oldPolarity;
    await syncKeyerPort(ctx, polarityChanged);
    ctx.saveSettings();
    ctx.io.emit("settings-data", {
      cwSettings: ctx.cwSettings,
      cwPortStatus: (ctx.cwKeyerProcess && !ctx.cwKeyerProcess.killed)
        ? { open: true, port: ctx.cwSettings.keyerPort }
        : { open: false, port: ctx.cwSettings.keyerPort },
    });
  });
}
