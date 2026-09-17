import net from "net";
import fs from "fs";
import path from "path";
import { Socket } from "socket.io";
import type { ServerContext } from "./context.ts";
import { vlogRig as vlog, vlogWsjtx, ts } from "./vlog.ts";
import { startRigctld } from "./rigctld.ts";

// Hamlib's Yaesu newcat backend (dual-receiver rigs like the FTDX3000/5000/101/10) and some
// Icom dual-receiver rigs (IC-9700, IC-905, IC-7610, IC-7850/7851) report the current VFO as
// "Main"/"Sub" rather than "VFOA"/"VFOB". The rest of this app (and the frontend) only ever
// compares against the literal "VFOA"/"VFOB" strings, so normalize here at the point rigctld
// responses are ingested.
export function normalizeVfoName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "Main") return "VFOA";
  if (trimmed === "Sub") return "VFOB";
  return trimmed;
}

export function formatExtendedCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const parts = trimmed.split(/\s+/);
  if (parts[0].length === 1) {
    return `+${trimmed}`;
  }
  return `+\\${trimmed}`;
}

export function parseExtendedResponse(resp: string): string {
  const lines = resp.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return resp;

  const lastLine = lines[lines.length - 1];
  if (lastLine.includes("RPRT 1")) {
    throw new Error("Rig command error (RPRT 1)");
  }

  const values: string[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(":");
    if (colonIndex !== -1) {
      values.push(line.substring(colonIndex + 1).trim());
    } else {
      values.push(line);
    }
  }
  return values.join("\n");
}

// A serial-link glitch or misbehaving rigctld that streams data without ever emitting an RPRT
// terminator would otherwise let responseBuffer/buffer grow unbounded for the whole command
// timeout window (up to 25s for power-on). These caps are generous margins over real response
// sizes — ordinary extended/simple commands return a handful of short lines, while dump_caps for
// complex rigs (long frequency-range/channel lists) can legitimately run to tens of KB.
const MAX_RESPONSE_BUFFER_BYTES = 8192;
const MAX_DUMP_CAPS_BUFFER_BYTES = 131072;

export function executeRigCommand(ctx: ServerContext, cmd: string, useExtended = false, timeoutMs = 10000): Promise<string> {
  const finalCmd = useExtended ? formatExtendedCommand(cmd) : cmd;
  const startMs = Date.now();

  return new Promise((resolve, reject) => {
    if (!ctx.rigSocket || ctx.rigSocket.destroyed) {
      console.error(`[${ts()}] [RIG] Command rejected (not connected): "${cmd}"`);
      return reject("Not connected to rig");
    }

    let responseBuffer = "";
    const timeout = setTimeout(() => {
      ctx.rigSocket?.removeListener("data", onData);
      ctx.rigSocket?.removeListener("error", onError);
      console.warn(`[${ts()}] [RIG] Command timed out: "${cmd}" (extended=${useExtended}, timeoutMs=${timeoutMs}) — destroying socket to reset state`);
      if (ctx.rigSocket) {
        ctx.rigSocket.destroy();
        ctx.isConnected = false;
      }
      reject(`Rig command timeout: "${cmd}"`);
    }, timeoutMs);

    const finishWithTiming = () => {
      const elapsed = Date.now() - startMs;
      if (elapsed > 1000) {
        vlog(`[RIG] SLOW command: "${cmd}" took ${elapsed}ms`);
      }
    };

    const onData = (data: Buffer) => {
      responseBuffer += data.toString();

      if (responseBuffer.length > MAX_RESPONSE_BUFFER_BYTES) {
        clearTimeout(timeout);
        ctx.rigSocket?.removeListener("data", onData);
        ctx.rigSocket?.removeListener("error", onError);
        console.warn(`[${ts()}] [RIG] Response for "${cmd}" exceeded ${MAX_RESPONSE_BUFFER_BYTES} bytes without a terminator — destroying socket to reset state`);
        if (ctx.rigSocket) {
          ctx.rigSocket.destroy();
          ctx.isConnected = false;
        }
        reject(`Rig response exceeded ${MAX_RESPONSE_BUFFER_BYTES} bytes without a terminator: "${cmd}"`);
        return;
      }

      if (useExtended) {
        const rprtMatch = responseBuffer.match(/RPRT (-?\d+)/);
        if (rprtMatch) {
          clearTimeout(timeout);
          ctx.rigSocket?.removeListener("data", onData);
          ctx.rigSocket?.removeListener("error", onError);
          finishWithTiming();
          vlog(`[RIG] Response for "${cmd}": ${responseBuffer.trim()}`);
          const rprtCode = parseInt(rprtMatch[1], 10);
          if (rprtCode === 0) {
            try {
              resolve(parseExtendedResponse(responseBuffer));
            } catch (e) {
              console.error(`[${ts()}] [RIG] Parse error for "${cmd}":`, e);
              reject(e);
            }
          } else {
            reject(`RPRT ${rprtCode}: "${cmd}"`);
          }
        }
      } else {
        clearTimeout(timeout);
        ctx.rigSocket?.removeListener("data", onData);
        ctx.rigSocket?.removeListener("error", onError);
        finishWithTiming();
        vlog(`[RIG] Response for "${cmd}": ${responseBuffer.trim()}`);
        resolve(responseBuffer.trim());
      }
    };

    const onError = (err: Error) => {
      clearTimeout(timeout);
      ctx.rigSocket?.removeListener("data", onData);
      console.error(`[${ts()}] [RIG] Socket error during command "${cmd}":`, err.message);
      reject(err);
    };

    vlog(`[RIG] Sending command: "${cmd}"`);
    ctx.rigSocket.on("data", onData);
    ctx.rigSocket.once("error", onError);
    ctx.rigSocket.write(finalCmd + "\n");
  });
}

const processRigQueue = async (ctx: ServerContext) => {
  if (ctx.isRigBusy || ctx.rigCommandQueue.length === 0) return;
  ctx.isRigBusy = true;
  const { cmd, useExtended, resolve, reject, timeoutMs } = ctx.rigCommandQueue.shift()!;
  try {
    const resp = await executeRigCommand(ctx, cmd, useExtended, timeoutMs);
    resolve(resp);
  } catch (err) {
    reject(err);
  } finally {
    ctx.isRigBusy = false;
    setTimeout(() => processRigQueue(ctx), 10);
  }
};

export function sendToRig(ctx: ServerContext, cmd: string, useExtended = false, priority = false, timeoutMs?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (priority) {
      ctx.rigCommandQueue.unshift({ cmd, useExtended, resolve, reject, timeoutMs });
    } else {
      ctx.rigCommandQueue.push({ cmd, useExtended, resolve, reject, timeoutMs });
    }
    processRigQueue(ctx);
  });
}

async function probeDumpCaps(ctx: ServerContext): Promise<string> {
  // dump_caps needs the full raw multi-KB response (not a single parsed value), so it bypasses
  // ctx.rigCommandQueue/executeRigCommand and attaches its own "data" listener directly. But it
  // still shares the one physical rigctld socket with everything sent via sendToRig() — without
  // this isRigBusy guard, a command dispatched concurrently (e.g. a client's "get-modes" request
  // racing in right as this starts) would attach its own listener on the same socket at the same
  // time, and each listener could resolve on bytes meant for the other — silently shifting every
  // subsequent command/response pairing by one for the rest of that poll cycle (observed in the
  // field as e.g. a "t" (get_ptt) command resolving with another command's response text).
  while (ctx.isRigBusy) {
    await new Promise(r => setTimeout(r, 10));
  }
  ctx.isRigBusy = true;
  try {
    return await new Promise((resolve, reject) => {
      if (!ctx.rigSocket || ctx.rigSocket.destroyed) {
        return reject("Not connected");
      }

      let buffer = "";
      const timeout = setTimeout(() => {
        ctx.rigSocket?.removeListener("data", onData);
        ctx.rigSocket?.removeListener("error", onError);
        reject("dump_caps timed out");
      }, 10000);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        if (buffer.length > MAX_DUMP_CAPS_BUFFER_BYTES) {
          clearTimeout(timeout);
          ctx.rigSocket?.removeListener("data", onData);
          ctx.rigSocket?.removeListener("error", onError);
          reject(`dump_caps response exceeded ${MAX_DUMP_CAPS_BUFFER_BYTES} bytes without a terminator`);
          return;
        }
        if (/RPRT -?\d+/.test(buffer)) {
          clearTimeout(timeout);
          ctx.rigSocket?.removeListener("data", onData);
          ctx.rigSocket?.removeListener("error", onError);
          resolve(buffer);
        }
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        ctx.rigSocket?.removeListener("data", onData);
        reject(`dump_caps error: ${err.message}`);
      };

      ctx.rigSocket.on("data", onData);
      ctx.rigSocket.once("error", onError);
      ctx.rigSocket.write("+\\dump_caps\n");
    });
  } finally {
    ctx.isRigBusy = false;
  }
}

export function parseDumpCapsIntoContext(dump: string, ctx: ServerContext): void {
  const lines = dump.split('\n');

  const preampLine = lines.find(l => l.trim().startsWith('Preamp:'));
  ctx.rigctldSettings.preampCapabilities = preampLine
    ? preampLine.replace('Preamp:', '').trim().split(/\s+/).filter(Boolean)
    : [];

  const attenuatorLine = lines.find(l => l.trim().startsWith('Attenuator:'));
  ctx.rigctldSettings.attenuatorCapabilities = attenuatorLine
    ? attenuatorLine.replace('Attenuator:', '').trim().split(/\s+/).filter(Boolean)
    : [];

  const agcLine = lines.find(l => l.trim().startsWith('AGC levels:'));
  ctx.rigctldSettings.agcCapabilities = agcLine
    ? agcLine.replace('AGC levels:', '').trim().split(/\s+/).filter(Boolean)
    : [];

  const setFunctionsLine = lines.find(l => l.trim().startsWith('Set functions:'));
  if (setFunctionsLine) {
    const funcs = setFunctionsLine.replace('Set functions:', '').trim().split(/\s+/);
    ctx.rigctldSettings.nbSupported = funcs.includes('NB');
    ctx.rigctldSettings.nrSupported = funcs.includes('NR');
    ctx.rigctldSettings.anfSupported = funcs.includes('ANF');
    ctx.spectrumSupported = funcs.includes('SPECTRUM');
  } else {
    ctx.rigctldSettings.nbSupported = false;
    ctx.rigctldSettings.nrSupported = false;
    ctx.rigctldSettings.anfSupported = false;
    ctx.spectrumSupported = false;
  }

  const getLevelLine = lines.find(l => l.trim().startsWith('Get level:'));
  if (getLevelLine) {
    const nbMatch = getLevelLine.match(/\bNB\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
    ctx.rigctldSettings.nbLevelSupported = !!nbMatch;
    ctx.rigctldSettings.nbLevelRange = nbMatch
      ? { min: parseFloat(nbMatch[1]), max: parseFloat(nbMatch[2]), step: parseFloat(nbMatch[3]) }
      : { min: 0, max: 1, step: 0.1 };

    const nrMatch = getLevelLine.match(/\bNR\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
    ctx.rigctldSettings.nrLevelSupported = !!nrMatch;
    ctx.rigctldSettings.nrLevelRange = nrMatch
      ? { min: parseFloat(nrMatch[1]), max: parseFloat(nrMatch[2]), step: parseFloat(nrMatch[3]) }
      : { min: 0, max: 1, step: 0.066667 };

    // Some rigs (e.g. Xiegu G90) list RF in dump_caps but with a degenerate 0..0/0 range even
    // though get/set RF genuinely work at runtime — treat a degenerate match the same as no
    // match at all (unsupported, default range), so probeCapabilities()'s live "l RF"
    // corroboration probe below gets a chance to override it instead of the slider getting
    // stuck at min=max=0.
    const rfMatch = getLevelLine.match(/\bRF\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
    const rfParsed = rfMatch
      ? { min: parseFloat(rfMatch[1]), max: parseFloat(rfMatch[2]), step: parseFloat(rfMatch[3]) }
      : null;
    const rfSane = !!rfParsed && rfParsed.max > rfParsed.min && rfParsed.step > 0;
    ctx.rigctldSettings.rfLevelSupported = rfSane;
    ctx.rigctldSettings.rfLevelRange = rfSane
      ? rfParsed!
      : { min: 0, max: 1, step: 0.1 };

    // Some rigs (e.g. Xiegu G90) list RFPOWER in dump_caps but with a degenerate 0..0/0 range
    // even though get/set RFPOWER genuinely work at runtime — feeding that straight into the
    // slider's min/max leaves it stuck, so fall back to the default range in that case too.
    const rfPowerMatch = getLevelLine.match(/RFPOWER\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
    const rfPowerParsed = rfPowerMatch
      ? { min: parseFloat(rfPowerMatch[1]), max: parseFloat(rfPowerMatch[2]), step: parseFloat(rfPowerMatch[3]) }
      : null;
    ctx.rigctldSettings.rfPowerRange = rfPowerParsed && rfPowerParsed.max > rfPowerParsed.min && rfPowerParsed.step > 0
      ? rfPowerParsed
      : { min: 0, max: 1, step: 0.01 };
  } else {
    ctx.rigctldSettings.nbLevelSupported = false;
    ctx.rigctldSettings.nrLevelSupported = false;
    ctx.rigctldSettings.rfLevelSupported = false;
  }
}

function emitCapabilities(ctx: ServerContext): void {
  ctx.io.emit("preamp-capabilities", ctx.rigctldSettings.preampCapabilities);
  ctx.io.emit("attenuator-capabilities", ctx.rigctldSettings.attenuatorCapabilities);
  ctx.io.emit("agc-capabilities", ctx.rigctldSettings.agcCapabilities);
  ctx.io.emit("nb-capabilities", { supported: ctx.rigctldSettings.nbSupported, levelSupported: ctx.rigctldSettings.nbLevelSupported, range: ctx.rigctldSettings.nbLevelRange });
  ctx.io.emit("nr-capabilities", { supported: ctx.rigctldSettings.nrSupported, levelSupported: ctx.rigctldSettings.nrLevelSupported, range: ctx.rigctldSettings.nrLevelRange });
  ctx.io.emit("rfpower-capabilities", { range: ctx.rigctldSettings.rfPowerRange });
  ctx.io.emit("rflevel-capabilities", { supported: ctx.rigctldSettings.rfLevelSupported, range: ctx.rigctldSettings.rfLevelRange });
  ctx.io.emit("anf-capabilities", { supported: ctx.rigctldSettings.anfSupported });
  ctx.io.emit("spectrum-supported", ctx.spectrumSupported);
}

async function probeCapabilities(ctx: ServerContext): Promise<void> {
  const rigNumber = ctx.rigctldSettings.rigNumber;
  vlog("[RIG] Probing rig capabilities via dump_caps...");

  try {
    const dump = await probeDumpCaps(ctx);
    parseDumpCapsIntoContext(dump, ctx);
    vlog("[RIG] Capabilities probed via dump_caps");
  } catch (err) {
    vlog("[RIG] dump_caps probe failed; trying local rigctld database:", err);
    try {
      const { fetchRadioCapabilities } = await import("./rigctld.ts");
      const success = await fetchRadioCapabilities(ctx, rigNumber);
      if (success) {
        vlog("[RIG] Capabilities probed via local rigctld database");
      } else {
        vlog("[RIG] Local capability probe also failed; capabilities may be unavailable");
      }
    } catch (importErr) {
      vlog("[RIG] Could not load local capability fallback:", importErr);
    }
  }

  // dump_caps's static Get level line doesn't always list RF at all, and even when it does
  // (e.g. Xiegu G90) it can report a degenerate 0..0/0 range — parseDumpCapsIntoContext()
  // normalizes both cases to rfLevelSupported=false, default range. Either way, the rig can
  // demonstrably support get_level RF at runtime, so corroborate with a live probe before
  // trusting dump_caps as authoritative, so the RF Level slider isn't hidden/stuck needlessly.
  if (!ctx.rigctldSettings.rfLevelSupported) {
    try {
      await sendToRig(ctx, "l RF", true);
      ctx.rigctldSettings.rfLevelSupported = true;
      vlog("[RIG] RF level missing/degenerate in dump_caps but live get_level RF succeeded; enabling RF Level slider");
    } catch {
      vlog("[RIG] RF level unsupported (dump_caps missing/degenerate and live probe failed)");
    }
  }

  emitCapabilities(ctx);
}

export async function probeVfoCapability(ctx: ServerContext): Promise<void> {
  try {
    const result = await sendToRig(ctx, "v", true);
    ctx.vfoSupported = true;
    vlog(`VFO supported (reported: ${result})`);
  } catch (err) {
    ctx.vfoSupported = false;
    vlog("VFO not supported or probe failed; disabling VFO B and split:", err);
    try {
      await sendToRig(ctx, "f", true);
    } catch {
      vlog("get_freq also failed after VFO probe — rig may not be responding");
    }
  }
}

function powerStateFilePath(ctx: ServerContext): string {
  return path.join(ctx.dataDir, "rig-power-state.json");
}

interface PersistedPowerOffState {
  off: boolean;
  serialPort: string;
  rigNumber: string;
  audioWasPlaying: boolean;
  vfo: string;
  frequency: string;
  savedAt: number;
}

function loadPersistedPowerOffState(ctx: ServerContext): PersistedPowerOffState | null {
  try {
    return JSON.parse(fs.readFileSync(powerStateFilePath(ctx), "utf-8"));
  } catch {
    return null;
  }
}

function savePersistedPowerOffState(ctx: ServerContext): void {
  try {
    const state: PersistedPowerOffState = {
      off: true,
      serialPort: ctx.rigctldSettings.serialPort,
      rigNumber: ctx.rigctldSettings.rigNumber,
      audioWasPlaying: ctx.audioWasPlaying,
      vfo: ctx.lastStatus.vfo,
      frequency: ctx.lastStatus.frequency,
      savedAt: Date.now(),
    };
    fs.writeFileSync(powerStateFilePath(ctx), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[RIG][POWER] Failed to persist power-off state:", e);
  }
}

function clearPersistedPowerOffState(ctx: ServerContext): void {
  try {
    fs.unlinkSync(powerStateFilePath(ctx));
  } catch {
    // already absent — fine
  }
}

function isPersistedOffMatchingCurrentRig(ctx: ServerContext): boolean {
  const persisted = loadPersistedPowerOffState(ctx);
  return !!persisted?.off
    && persisted.serialPort === ctx.rigctldSettings.serialPort
    && persisted.rigNumber === ctx.rigctldSettings.rigNumber;
}

// Used to enrich every "rig-connecting" emit made while ctx.knownPoweredOff is true (the initial
// connect attempt and each subsequent auto-reconnect retry ping) with the same last-known VFO/
// frequency snapshot. Must be called fresh each time rather than cached once, and every call site
// that emits knownPoweredOff:true must include this — otherwise a later emit lacking these fields
// (e.g. a retry ping) would overwrite the frontend's already-correct display with the neutral
// "unknown" placeholder.
function getKnownPoweredOffSnapshot(ctx: ServerContext): { vfo?: string; frequency?: string } {
  if (!ctx.knownPoweredOff) return {};
  const persisted = loadPersistedPowerOffState(ctx);
  if (persisted?.vfo && persisted?.frequency) {
    vlog(`[RIG][POWER] Sending last-known snapshot with rig-connecting: vfo=${persisted.vfo} frequency=${persisted.frequency}`);
    return { vfo: persisted.vfo, frequency: persisted.frequency };
  }
  vlog(`[RIG][POWER] No usable last-known snapshot to send (persisted file present=${!!persisted}, vfo=${persisted?.vfo}, frequency=${persisted?.frequency})`);
  return {};
}

async function probePowerCapability(ctx: ServerContext): Promise<void> {
  try {
    const result = await sendToRig(ctx, "get_powerstat", true);
    ctx.powerSupported = true;
    const previousState = ctx.powerState;
    ctx.powerState = result.trim() === "1" ? 'on' : 'off';
    vlog(`[RIG] Power control supported; state: ${ctx.powerState}`);
    if (ctx.powerState === 'on' && previousState !== 'on') {
      await onPowerOn(ctx);
    }
  } catch {
    // A failed/timed-out probe here doesn't necessarily mean the rig lacks power control — it
    // commonly happens right after an auto-reconnect, while the radio's USB/serial link is still
    // settling. Only resetRigState() (manual connect/disconnect) clears powerSupported to false;
    // a transient probe failure here must not silently hide a capability already confirmed true.
    ctx.powerState = 'unknown';
    vlog("[RIG] Power capability probe failed (rig may not support it, or link isn't ready yet)");
  }
}

async function triggerPowerOff(ctx: ServerContext): Promise<void> {
  if (ctx.lastStatus.ptt) {
    vlog("[RIG][POWER] PTT active — clearing before power off");
    await sendToRig(ctx, "T 0", false, true).catch(() => {});
  }
  const { cwSetKey, stopCwTick } = await import("./cw.ts");
  cwSetKey(ctx, false);
  stopCwTick(ctx);
  const { stopAudio } = await import("./audio.ts");
  ctx.audioWasPlaying = ctx.audioStatus === 'playing';
  if (ctx.audioWasPlaying) vlog("[RIG][POWER] Audio was playing — stopping before power off");
  await stopAudio(ctx);
  if (ctx.spectrumSettings.source === "ft4222") {
    const { stopYaesuScope } = await import("./yaesuScope.ts");
    stopYaesuScope(ctx);
  }
  const queued = ctx.rigCommandQueue.length;
  if (queued > 0) vlog(`[RIG][POWER] Draining ${queued} queued command(s)`);
  while (ctx.rigCommandQueue.length > 0) {
    ctx.rigCommandQueue.shift()!.reject("Radio powered off");
  }
  ctx.powerState = 'off';
  ctx.lastPowerCheck = Date.now();
  ctx.powerOffProbeFailureCount = 0;
  ctx.lastStatus = { ...ctx.lastStatus, ptt: false, powerState: 'off', powerPending: false };
  ctx.io.emit("rig-status", ctx.lastStatus);
  ctx.io.emit("spectrum-data", { id: 0, name: "", amplitudes: [], timestamp: Date.now() });
  savePersistedPowerOffState(ctx);
  vlog("[RIG][POWER] Local state set to off — polling suspended");
}

async function onPowerOn(ctx: ServerContext): Promise<void> {
  clearPersistedPowerOffState(ctx);

  if (ctx.pendingCapabilityProbe) {
    ctx.pendingCapabilityProbe = false;
    vlog("[RIG] Running deferred capability probes after restart-restored power-on");
    await probeVfoCapability(ctx);
    await probeCapabilities(ctx);
    if (ctx.spectrumSettings.enabled && ctx.spectrumSupported) {
      try {
        await sendToRig(ctx, "U SPECTRUM 1", true);
        vlog("[SPECTRUM] Enabled spectrum output on rig");
      } catch (err) {
        console.warn("[SPECTRUM] Failed to enable spectrum output:", err);
      }
    }
    ctx.io.emit("rig-connected", {
      host: ctx.rigConfig.host,
      port: ctx.rigConfig.port,
      vfoSupported: ctx.vfoSupported,
      powerSupported: ctx.powerSupported,
    });
  }

  if (ctx.spectrumSettings.enabled && ctx.spectrumSettings.source === "ft4222") {
    import("./yaesuScope.ts").then(({ startYaesuScope }) => {
      setTimeout(() => startYaesuScope(ctx), 2000);
    });
  }
  if (ctx.audioWasPlaying) {
    ctx.audioWasPlaying = false;
    import("./audio.ts").then(({ startAudio }) => {
      setTimeout(() => startAudio(ctx), 2000);
    });
  }
}

export function stopPolling(ctx: ServerContext): void {
  if (ctx.pollingTimeout) {
    clearTimeout(ctx.pollingTimeout);
    ctx.pollingTimeout = null;
  }
}

export async function pollRig(ctx: ServerContext): Promise<void> {
  if (ctx.powerState === 'off') {
    // A set-power(true) request runs its own dedicated get_powerstat confirmation loop against
    // the same single serial link; don't have this routine probe compete with it for the link —
    // doing so previously delayed the user's own set_powerstat command behind an unrelated
    // background probe that happened to already be in flight.
    if (ctx.powerOpInProgress) return;
    if (Date.now() - ctx.lastPowerCheck < 5000) return;
    try {
      const result = await sendToRig(ctx, "get_powerstat", true);
      ctx.powerOffProbeFailureCount = 0;
      if (result.trim() === "1") {
        ctx.powerState = 'on';
        ctx.lastStatus = { ...ctx.lastStatus, powerState: 'on' };
        ctx.io.emit("rig-status", ctx.lastStatus);
        vlog("[RIG] Radio powered on — resuming polling");
        await onPowerOn(ctx);
        // fall through to normal poll this cycle
      }
    } catch {
      // still off or not responding
      ctx.powerOffProbeFailureCount++;
      if (ctx.powerOffProbeFailureCount >= POWER_OFF_PROBE_FAILURE_LIMIT && ctx.autoStartEnabled && !ctx.rigctldRespawnInFlight) {
        vlog(`[RIG] get_powerstat has failed ${ctx.powerOffProbeFailureCount} times in a row while radio is off — proactively restarting rigctld before it can crash on its own`);
        ctx.powerOffProbeFailureCount = 0;
        ctx.rigctldRespawnInFlight = true;
        startRigctld(ctx).finally(() => { ctx.rigctldRespawnInFlight = false; });
      }
    }
    ctx.lastPowerCheck = Date.now();
    if (ctx.powerState === 'off') return;
  }

  if (!ctx.isConnected) {
    // ctx.autoReconnect is explicitly cleared by a manual disconnect — without checking it here,
    // a poll cycle that was already suspended awaiting a command sent before that disconnect can
    // resume afterward and reconnect anyway, defeating the user's manual disconnect.
    if (ctx.autoReconnect && ctx.rigConfig.host && ctx.rigConfig.host !== "mock") {
      vlog("Attempting background reconnection...");
      connectToRig(ctx, ctx.rigConfig.host, ctx.rigConfig.port);
    }
    return;
  }
  try {
    const now = Date.now();
    const isSlowPoll = ctx.pollCycleCount % 10 === 0;
    ctx.pollCycleCount++;

    const ptt = await sendToRig(ctx, "t", true);
    const smeter = await sendToRig(ctx, "l STRENGTH", true);
    const isPttActive = ptt === "1";

    let alc = ctx.lastStatus.alc?.toString() || "0";
    let powerMeter = ctx.lastStatus.powerMeter?.toString() || "0";
    let swr = ctx.lastStatus.swr?.toString() || "1.0";

    if (isPttActive) {
      try {
        alc = await sendToRig(ctx, "l ALC", true);
        powerMeter = await sendToRig(ctx, "l RFPOWER_METER", true);
        swr = await sendToRig(ctx, "l SWR", true);
      } catch (e) {
        vlog("TX levels poll failed, might not be supported");
      }
    }

    const frequency = await sendToRig(ctx, "f", true);
    const modeBw = await sendToRig(ctx, "m", true);
    const [mode, bandwidth] = modeBw.split("\n");
    let rfpower = ctx.lastStatus.rfpower;
    let rflevel = ctx.lastStatus.rfLevel;
    let agc = ctx.lastStatus.agc;
    let vfo = ctx.lastStatus.vfo;
    let isSplit = ctx.lastStatus.isSplit;
    let txVFO = ctx.lastStatus.txVFO;
    let att = ctx.lastStatus.attenuation;
    let preamp = ctx.lastStatus.preamp;
    let nb = ctx.lastStatus.nb;
    let nbLevel = ctx.lastStatus.nbLevel;
    let nr = ctx.lastStatus.nr;
    let nrLevel = ctx.lastStatus.nrLevel;
    let anf = ctx.lastStatus.anf;
    let tuner = ctx.lastStatus.tuner;
    let vdd = ctx.lastStatus.vdd;

    if (isSlowPoll) {
      if (ctx.visibleMeters.includes('vdd')) {
        vdd = parseFloat(await sendToRig(ctx, "l VD_METER", true).catch(() => "13.8"));
      }
      rfpower = parseFloat(await sendToRig(ctx, "l RFPOWER", true));
      rflevel = parseFloat(await sendToRig(ctx, "l RF", true).catch(() => "0"));
      agc = parseInt(await sendToRig(ctx, "l AGC", true).catch(() => "6"));
      if (ctx.vfoSupported) {
        vfo = normalizeVfoName(await sendToRig(ctx, "v", true));
        const splitInfo = await sendToRig(ctx, "s", true);
        const [isSplitStr, txVFOStr] = splitInfo.split("\n");
        isSplit = isSplitStr === "1";
        txVFO = txVFOStr ? normalizeVfoName(txVFOStr) : "VFOB";
      }
      if (ctx.rigctldSettings.attenuatorCapabilities.length > 0) {
        att = parseInt(await sendToRig(ctx, "l ATT", true).catch(() => String(att))) || 0;
      }
      if (ctx.rigctldSettings.preampCapabilities.length > 0) {
        preamp = parseInt(await sendToRig(ctx, "l PREAMP", true).catch(() => String(preamp))) || 0;
      }
      nb = (await sendToRig(ctx, "u NB", true).catch(() => "0")) === "1";
      nbLevel = parseFloat(await sendToRig(ctx, "l NB", true).catch(() => "0"));
      nr = (await sendToRig(ctx, "u NR", true).catch(() => "0")) === "1";
      nrLevel = parseFloat(await sendToRig(ctx, "l NR", true).catch(() => "0"));
      anf = (await sendToRig(ctx, "u ANF", true).catch(() => "0")) === "1";
      tuner = (await sendToRig(ctx, "u TUNER", true).catch(() => "0")) === "1";

      if (ctx.powerSupported) {
        const ps = await sendToRig(ctx, "get_powerstat", true).catch(() => null);
        if (ps !== null && ps.trim() === "0") {
          vlog("[RIG] Radio powered off (detected during slow poll)");
          await triggerPowerOff(ctx);
          return;
        }
      }
    }

    if (ctx.pendingQuickPolls.size > 0) {
      const pending = new Set(ctx.pendingQuickPolls);
      ctx.pendingQuickPolls.clear();
      if (pending.has('attenuation') && ctx.rigctldSettings.attenuatorCapabilities.length > 0) att = parseInt(await sendToRig(ctx, "l ATT", true).catch(() => String(att))) || 0;
      if (pending.has('preamp') && ctx.rigctldSettings.preampCapabilities.length > 0) preamp = parseInt(await sendToRig(ctx, "l PREAMP", true).catch(() => String(preamp))) || 0;
      if (pending.has('agc')) agc = parseInt(await sendToRig(ctx, "l AGC", true).catch(() => String(agc)));
      if (pending.has('nb')) nb = (await sendToRig(ctx, "u NB", true).catch(() => nb ? "1" : "0")) === "1";
      if (pending.has('nbLevel')) nbLevel = parseFloat(await sendToRig(ctx, "l NB", true).catch(() => String(nbLevel)));
      if (pending.has('nr')) nr = (await sendToRig(ctx, "u NR", true).catch(() => nr ? "1" : "0")) === "1";
      if (pending.has('nrLevel')) nrLevel = parseFloat(await sendToRig(ctx, "l NR", true).catch(() => String(nrLevel)));
      if (pending.has('anf')) anf = (await sendToRig(ctx, "u ANF", true).catch(() => anf ? "1" : "0")) === "1";
      if (pending.has('rfpower')) rfpower = parseFloat(await sendToRig(ctx, "l RFPOWER", true).catch(() => String(rfpower)));
      if (pending.has('rfLevel')) rflevel = parseFloat(await sendToRig(ctx, "l RF", true).catch(() => String(rflevel)));
      if (pending.has('tuner')) tuner = (await sendToRig(ctx, "u TUNER", true).catch(() => tuner ? "1" : "0")) === "1";
    }

    ctx.lastStatus = {
      frequency,
      mode,
      bandwidth,
      ptt: isPttActive,
      smeter: parseFloat(smeter),
      swr: parseFloat(swr),
      alc: parseFloat(alc),
      powerMeter: parseFloat(powerMeter),
      rfpower,
      rfLevel: rflevel,
      agc,
      vdd: parseFloat(vdd as unknown as string),
      vfo,
      isSplit,
      txVFO,
      attenuation: att,
      preamp,
      nb,
      nbLevel,
      nr,
      nrLevel,
      anf,
      tuner,
      powerState: ctx.powerState,
      powerPending: ctx.lastStatus.powerPending,
      timestamp: now,
    };

    ctx.io.emit("rig-status", ctx.lastStatus);
  } catch (err) {
    console.error(`[${ts()}] [RIG] Poll cycle ${ctx.pollCycleCount} failed:`, err);
  }
}

export function startPolling(ctx: ServerContext): void {
  stopPolling(ctx);
  const runPoll = async () => {
    if (!ctx.isConnected) return;
    if (ctx.cwIsKeying) {
      ctx.pollingTimeout = setTimeout(runPoll, 200);
      return;
    }
    const startTime = Date.now();
    await pollRig(ctx);
    const duration = Date.now() - startTime;
    const nextDelay = Math.max(0, ctx.pollRate - duration);
    ctx.pollingTimeout = setTimeout(runPoll, nextDelay);
  };
  ctx.pollingTimeout = setTimeout(runPoll, ctx.pollRate);
}

export function resetRigState(ctx: ServerContext): void {
  ctx.vfoSupported = true;
  ctx.powerSupported = false;
  ctx.powerState = 'unknown';
  ctx.powerOpInProgress = false;
  ctx.lastPowerCheck = 0;
  ctx.powerOffProbeFailureCount = 0;
  ctx.pendingCapabilityProbe = false;
  ctx.knownPoweredOff = false;
  ctx.lastStatus = {
    frequency: "14074000",
    mode: "USB",
    bandwidth: "2400",
    ptt: false,
    smeter: -54,
    swr: 1.0,
    alc: 0,
    powerMeter: 0,
    rfpower: 0.5,
    vdd: 13.8,
    vfo: "VFOA",
    isSplit: false,
    txVFO: "VFOB",
    rfLevel: 0,
    agc: 6,
    attenuation: 0,
    preamp: 0,
    nb: false,
    nbLevel: 0,
    nr: false,
    nrLevel: 8 / 15,
    anf: false,
    tuner: false,
    powerState: 'unknown',
    powerPending: false,
  };
}

const CONNECT_MAX_ATTEMPTS = 5;
const CONNECT_RETRY_DELAY_MS = 1000;
const AUTO_RECONNECT_RETRY_DELAY_MS = 5000;
const AUTO_RECONNECT_TIMEOUT_MS = 30000;
const SOCKET_CONNECT_TIMEOUT_MS = 10000;
// A radio whose serial link never recovers while powered off has been observed (field diagnostics,
// 2026-07) to eventually crash rigctld itself with a Windows heap-corruption exit after ~13-14
// consecutive get_powerstat failures. This limit is set well below that observed count so the
// proactive restart in pollRig() intervenes with a solid safety margin; it's a judgment call from a
// single incident, not a precisely measured threshold.
const POWER_OFF_PROBE_FAILURE_LIMIT = 6;
// Real hardware (e.g. FT-710 USB re-enumeration, CI-V waking up after a cold boot) can take
// several seconds per command right after a power-on — observed 2.7-9.4s per get_powerstat
// round-trip in the field. A short deadline burns through its whole budget in 1-2 attempts and
// reports a spurious timeout even when the radio would have confirmed a few seconds later.
const POWER_ON_CONFIRM_TIMEOUT_MS = 25000;

export function connectToRig(ctx: ServerContext, host: string, port: number, socket?: Socket, attempt = 1, auto = false): void {
  if (ctx.isConnected && ctx.rigConfig.host === host && ctx.rigConfig.port === port) {
    vlog(`Already connected to rigctld at ${host}:${port}. Informing client.`);
    if (socket) {
      socket.emit("rig-connected", { host, port });
    } else {
      ctx.io.emit("rig-connected", { host, port });
    }
    return;
  }

  if (attempt === 1) {
    if (ctx.rigSocket) {
      ctx.rigSocket.destroy();
      ctx.rigSocket = null;
    }
    ctx.rigConfig = { host, port };
    // Arm the slower 5s-retry/30s-give-up safety net (below, in the socket "close" handler)
    // from the moment a connection is requested, not only once one has actually succeeded.
    // Without this, if rigctld hasn't finished starting its TCP listener yet — e.g. right
    // after an app restart, where startRigctld() marks status "running" the instant the
    // process is spawned, well before rigctld has actually bound its port — the quick
    // ECONNREFUSED retry burst below (~4s total) can exhaust itself with autoReconnect still
    // false, silently abandoning the connection with no further attempts at all.
    ctx.autoReconnect = true;
    // Only reset the give-up clock for a genuinely new request (auto=false: an explicit
    // connect-rig, whether user- or autoconnect-triggered). The close handler's own scheduled
    // retry re-enters here with (attempt=1, auto=true) — resetting the clock on every one of
    // those cycles would make the 30s give-up budget unreachable (infinite silent retries).
    if (!auto) {
      ctx.autoReconnectStartedAt = null;
      // Computed once per genuinely new request and left alone across the quick ECONNREFUSED
      // retry burst and the close handler's own scheduled re-entries (which pass auto=true) —
      // lets the frontend suppress the generic "reconnecting" spinner for the whole attempt
      // sequence whenever the radio is already known (from disk) to have been left off.
      ctx.knownPoweredOff = isPersistedOffMatchingCurrentRig(ctx);
    }
  }

  // When the radio is known (from disk) to have been left off, hand the frontend the exact
  // VFO/frequency it was last confirmed on — captured at the moment power-off was triggered, so
  // it's still accurate (an off radio can't retune itself). This lets the UI show a trustworthy
  // last-known VFO immediately on reconnect instead of waiting out the ~10s+ power-on handshake,
  // and instead of trusting the browser's own (per-client, potentially stale) localStorage cache.
  ctx.io.emit("rig-connecting", { attempt, maxAttempts: CONNECT_MAX_ATTEMPTS, auto, knownPoweredOff: ctx.knownPoweredOff, ...getKnownPoweredOffSnapshot(ctx) });

  const sock = new net.Socket();
  ctx.rigSocket = sock;
  let retrying = false;

  // Bound the TCP handshake itself — without this, a host that accepts the SYN but never
  // completes the connection (or a fully unreachable rigctld) can hang for Node's default
  // ~2min connect timeout, which would blow well past the 30s auto-reconnect give-up budget.
  sock.setTimeout(SOCKET_CONNECT_TIMEOUT_MS);
  sock.once("timeout", () => {
    vlog(`[RIG] Connection attempt to ${host}:${port} timed out after ${SOCKET_CONNECT_TIMEOUT_MS}ms`);
    sock.destroy(new Error(`connect timeout after ${SOCKET_CONNECT_TIMEOUT_MS}ms`));
  });

  sock.connect(port, host, async () => {
    sock.setTimeout(0);
    vlog(`Connected to rigctld at ${host}:${port}`);
    // Note: the TCP handshake can complete even if rigctld is frozen/unresponsive (the OS
    // finishes it from the accept backlog independently of the app calling accept()), so this
    // callback firing is not proof the rig is actually reachable — that's only established once
    // the capability probes below succeed against a socket that's still alive.
    ctx.isConnected = true;
    ctx.autoReconnect = true;

    const persistedOff = loadPersistedPowerOffState(ctx);
    const restoringOff = isPersistedOffMatchingCurrentRig(ctx);

    if (restoringOff) {
      vlog(`[RIG] Restoring persisted power-off state from last session — deferring capability probes (persisted vfo=${persistedOff!.vfo}, frequency=${persistedOff!.frequency})`);
      ctx.powerSupported = true;
      ctx.powerState = 'off';
      ctx.lastPowerCheck = Date.now();
      ctx.autoReconnectStartedAt = null;
      ctx.audioWasPlaying = persistedOff!.audioWasPlaying;
      ctx.pendingCapabilityProbe = true;
      ctx.lastStatus = {
        ...ctx.lastStatus,
        powerState: 'off',
        ...(persistedOff!.vfo && persistedOff!.frequency
          ? { vfo: persistedOff!.vfo, frequency: persistedOff!.frequency }
          : {}),
      };
      ctx.io.emit("rig-connected", { host, port, vfoSupported: ctx.vfoSupported, powerSupported: true });
      ctx.io.emit("rig-status", ctx.lastStatus);
      startPolling(ctx);
      return;
    }

    await probeVfoCapability(ctx);
    await probeCapabilities(ctx);
    await probePowerCapability(ctx);
    if (sock.destroyed) {
      // A probe above hit its own command timeout and destroyed this socket; the close handler
      // is already driving the retry/give-up sequence. Don't declare success (or reset the
      // auto-reconnect budget) for a connection that's already dead.
      return;
    }
    ctx.autoReconnectStartedAt = null;
    ctx.io.emit("rig-connected", { host, port, vfoSupported: ctx.vfoSupported, powerSupported: ctx.powerSupported });
    if (ctx.spectrumSettings.enabled && ctx.spectrumSupported) {
      try {
        await sendToRig(ctx, "U SPECTRUM 1", true);
        vlog("[SPECTRUM] Enabled spectrum output on rig");
      } catch (err) {
        console.warn("[SPECTRUM] Failed to enable spectrum output:", err);
      }
    }
    startPolling(ctx);
  });

  sock.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ECONNREFUSED" && attempt < CONNECT_MAX_ATTEMPTS) {
      retrying = true;
      sock.destroy();
      ctx.rigSocket = null;
      vlog(`Rig connection refused at ${host}:${port}, retry ${attempt}/${CONNECT_MAX_ATTEMPTS - 1}...`);
      setTimeout(() => connectToRig(ctx, host, port, socket, attempt + 1, auto), CONNECT_RETRY_DELAY_MS);
    } else {
      ctx.isConnected = false;
      if (auto || err.code === "ECONNREFUSED") {
        // Silent (auto-)reconnect: don't surface a scary error for a single failed attempt —
        // ctx.autoReconnect is already armed (set at the top of this function, before the
        // quick ECONNREFUSED-retry burst even starts), so the close handler below will keep
        // quietly retrying regardless of whether this particular attempt was flagged "auto".
        // Exhausting the quick burst on ECONNREFUSED is exactly the case where rigctld may
        // simply still be starting up (see the attempt===1 comment above) — showing an error
        // here would be premature since a background retry is about to succeed or, once the
        // AUTO_RECONNECT_TIMEOUT_MS budget is exhausted, emit the one real user-facing message.
        vlog(`[RIG] Connect attempt failed (${err.message}); close handler will retry or give up`);
      } else {
        console.error("Rig socket error:", err);
        ctx.io.emit("rig-error", `Could not connect to rigctld at ${host}:${port} — ${err.message}`);
      }
    }
  });

  sock.on("close", () => {
    if (retrying) return;
    vlog("Rig connection closed");
    ctx.isConnected = false;
    ctx.io.emit("rig-disconnected");
    stopPolling(ctx);
    if (ctx.autoReconnect && ctx.rigConfig.host && ctx.rigConfig.host !== "mock") {
      if (ctx.autoReconnectStartedAt === null) {
        ctx.autoReconnectStartedAt = Date.now();
      }
      const elapsed = Date.now() - ctx.autoReconnectStartedAt;
      if (elapsed >= AUTO_RECONNECT_TIMEOUT_MS) {
        vlog(`[RIG] Auto-reconnect gave up after ${elapsed}ms without success`);
        ctx.autoReconnect = false;
        ctx.autoReconnectStartedAt = null;
        ctx.io.emit("rig-error", "Automatic reconnect failed after 30s — reconnect manually when the radio is ready.");
        return;
      }
      ctx.io.emit("rig-connecting", { attempt: 0, maxAttempts: CONNECT_MAX_ATTEMPTS, auto: true, knownPoweredOff: ctx.knownPoweredOff, ...getKnownPoweredOffSnapshot(ctx) });
      // A dead rigctld process (crashed, not just a dropped socket) makes every reconnect attempt
      // ECONNREFUSED forever — the retry loop above only ever re-pokes the TCP port. Respawn it
      // here when we're the ones who own its lifecycle (autoStartEnabled), so the next scheduled
      // attempt below actually has something to connect to.
      if (!ctx.rigctldProcess && ctx.autoStartEnabled && !ctx.rigctldRespawnInFlight) {
        vlog("[RIG] rigctld process is not running — restarting it before the next reconnect attempt");
        ctx.rigctldRespawnInFlight = true;
        startRigctld(ctx).finally(() => { ctx.rigctldRespawnInFlight = false; });
      }
      vlog("[RIG] Scheduling auto-reconnect in 5s...");
      ctx.pollingTimeout = setTimeout(() => {
        if (!ctx.isConnected && ctx.autoReconnect) {
          vlog("[RIG] Attempting auto-reconnect...");
          connectToRig(ctx, ctx.rigConfig.host, ctx.rigConfig.port, undefined, 1, true);
        }
      }, AUTO_RECONNECT_RETRY_DELAY_MS);
    }
  });
}

export function registerRigCommHandlers(socket: Socket, ctx: ServerContext): void {
  socket.on("connect-rig", ({ host, port }) => {
    resetRigState(ctx);
    connectToRig(ctx, host, port, socket);
  });

  socket.on("disconnect-rig", () => {
    ctx.autoReconnect = false;
    ctx.autoReconnectStartedAt = null;
    resetRigState(ctx);
    vlog("Rig manually disconnected");
    const hadSocket = !!ctx.rigSocket;
    if (ctx.rigSocket) {
      ctx.rigSocket.destroy();
      ctx.rigSocket = null;
    }
    ctx.isConnected = false;
    stopPolling(ctx);
    // The socket's own "close" handler (connectToRig) already emits "rig-disconnected" once
    // destroy() completes; only emit it here directly when there was no live socket to destroy,
    // since in that case nothing else would notify connected clients.
    if (!hadSocket) {
      ctx.io.emit("rig-disconnected");
    }
  });

  socket.on("set-func", async ({ func, state }) => {
    try {
      await sendToRig(ctx, `U ${func} ${state ? "1" : "0"}`, true, true);
      const key = func.toLowerCase() === "tuner" ? "tuner" :
                  func.toLowerCase() === "nb" ? "nb" :
                  func.toLowerCase() === "nr" ? "nr" :
                  func.toLowerCase() === "anf" ? "anf" : null;
      if (key) {
        ctx.lastStatus = { ...ctx.lastStatus, [key]: state };
        ctx.io.emit("rig-status", ctx.lastStatus);
        ctx.pendingQuickPolls.add(key);
      }
    } catch (err) {
      socket.emit("rig-op-error", `Failed to set ${func}`);
    }
  });

  socket.on("set-level", async ({ level, val }) => {
    try {
      await sendToRig(ctx, `L ${level} ${val}`, true, true);
      const key = level.toLowerCase() === "rfpower" ? "rfpower" :
                  level.toLowerCase() === "rf" ? "rfLevel" :
                  level.toLowerCase() === "agc" ? "agc" :
                  level.toLowerCase() === "att" ? "attenuation" :
                  level.toLowerCase() === "preamp" ? "preamp" :
                  level.toLowerCase() === "nr" ? "nrLevel" :
                  level.toLowerCase() === "nb" ? "nbLevel" : null;
      if (key) {
        ctx.lastStatus = { ...ctx.lastStatus, [key]: parseFloat(val) };
        ctx.io.emit("rig-status", ctx.lastStatus);
        ctx.pendingQuickPolls.add(key);
      }
    } catch (err) {
      socket.emit("rig-op-error", `Failed to set ${level}`);
    }
  });

  socket.on("tune-to-spot", async ({ freqHz, mode, modeChanged }: { freqHz: string; mode: string; modeChanged: boolean }) => {
    try {
      await sendToRig(ctx, `F ${freqHz}`, true, true);
      if (modeChanged) {
        await sendToRig(ctx, `M ${mode} -1`, true, true);
        const modeBw = await sendToRig(ctx, "m", true, true);
        const [confirmedMode, confirmedBw] = modeBw.split("\n");
        ctx.lastStatus = { ...ctx.lastStatus, mode: confirmedMode, bandwidth: confirmedBw };
        await new Promise(resolve => setTimeout(resolve, 200));
        await sendToRig(ctx, `F ${freqHz}`, true, true);
      }
      const confirmedFreq = await sendToRig(ctx, "f", true, true);
      ctx.lastStatus = { ...ctx.lastStatus, frequency: confirmedFreq };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to tune to spot");
    }
  });

  socket.on("set-frequency", async (freq) => {
    const t0 = Date.now();
    vlogWsjtx(`[wsjtx:freq] set-frequency received: ${freq}`);
    try {
      await sendToRig(ctx, `F ${freq}`, true, true);
      vlogWsjtx(`[wsjtx:freq] F ${freq} accepted by rigctld (${Date.now() - t0}ms)`);
      const confirmedFreq = await sendToRig(ctx, "f", true, true);
      vlogWsjtx(`[wsjtx:freq] readback: ${confirmedFreq} (${Date.now() - t0}ms total)`);
      ctx.lastStatus = { ...ctx.lastStatus, frequency: confirmedFreq };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      vlogWsjtx(`[wsjtx:freq] FAILED: ${err} (${Date.now() - t0}ms)`);
      socket.emit("rig-error", "Failed to set frequency");
    }
  });

  socket.on("set-mode", async ({ mode, bandwidth }) => {
    try {
      await sendToRig(ctx, `M ${mode} ${bandwidth}`, true, true);
      const modeBw = await sendToRig(ctx, "m", true, true);
      const [confirmedMode, confirmedBw] = modeBw.split("\n");
      ctx.lastStatus = { ...ctx.lastStatus, mode: confirmedMode, bandwidth: confirmedBw };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set mode/bandwidth");
    }
  });

  socket.on("get-modes", async () => {
    try {
      const modes = await sendToRig(ctx, "M ?", true, true);
      const modeList = modes.split(/[\s\n]+/).filter(m => Boolean(m) && m !== "RPRT" && !/^\d+$/.test(m));
      socket.emit("available-modes", modeList);
    } catch (err) {
      console.error("Failed to get modes:", err);
    }
  });

  socket.on("set-ptt", async (ptt) => {
    const pttVal = ptt ? "1" : "0";
    const t0 = Date.now();
    vlogWsjtx(`[wsjtx:ptt] set-ptt received: ptt=${ptt} → sending T ${pttVal} to rigctld`);
    try {
      await sendToRig(ctx, `T ${pttVal}`, true, true);
      vlogWsjtx(`[wsjtx:ptt] T ${pttVal} accepted by rigctld (${Date.now() - t0}ms)`);
      const confirmedPtt = (await sendToRig(ctx, "t", true, true)) === "1";
      vlogWsjtx(`[wsjtx:ptt] readback: ptt=${confirmedPtt}, requested=${pttVal === "1"}, match=${confirmedPtt === (pttVal === "1")} (${Date.now() - t0}ms total)`);
      ctx.lastStatus = { ...ctx.lastStatus, ptt: confirmedPtt };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      vlogWsjtx(`[wsjtx:ptt] FAILED: ${err} (${Date.now() - t0}ms)`);
      socket.emit("rig-error", "Failed to set PTT");
    }
  });

  socket.on("set-power", async ({ state }: { state: boolean }) => {
    vlog(`[RIG][POWER] set-power received: state=${state}`);
    // Checked before powerSupported deliberately: resetRigState() (run at the top of every
    // connect-rig attempt, including a doomed retry against a still-dead rigctld) clears
    // powerSupported to false until a fresh capability probe succeeds. Without this ordering, a
    // radio that genuinely supports power control but is simply disconnected right now would be
    // misreported as "not supported by this rig" — a confusing, wrong lead for the user to chase.
    if (!ctx.isConnected) {
      vlog("[RIG][POWER] Rejected — not connected to rig");
      socket.emit("rig-op-error", "Not connected to rig — reconnect before using power control");
      return;
    }
    if (!ctx.powerSupported) {
      vlog("[RIG][POWER] Rejected — power control not supported by this rig");
      socket.emit("rig-op-error", "Power control not supported by this rig");
      return;
    }
    // Guard against overlapping power operations — without this, a second set-power event
    // (an impatient repeat click, or a second connected client/tab) fired a fully independent
    // execution of this handler while a previous one's confirmation loop was still running,
    // which could send set_powerstat 1 and set_powerstat 0 back-to-back while the radio was
    // still mid-boot. Only one power operation is allowed in flight at a time, server-wide,
    // regardless of which client requests it.
    if (ctx.powerOpInProgress) {
      vlog("[RIG][POWER] Rejected — a power operation is already in progress");
      socket.emit("rig-op-error", "Power operation already in progress — please wait");
      return;
    }
    ctx.powerOpInProgress = true;
    try {
      if (!state) {
        vlog("[RIG][POWER] Initiating power-off sequence");
        await triggerPowerOff(ctx);
        vlog("[RIG][POWER] Sending set_powerstat 0 to rig");
        await sendToRig(ctx, "set_powerstat 0", true, true);
        vlog("[RIG][POWER] Power-off command acknowledged by rigctld");
      } else {
        // The whole power-on attempt — the initial ack AND the confirmation polling that
        // follows — shares one ~25-30s wall-clock budget. Both the initial set_powerstat 1
        // send and the get_powerstat polls below get that same generous per-command timeout
        // override (instead of the generic 10s used for ordinary commands): a radio that's
        // still mid-boot can take longer than 10s just to ack the power-on command itself, and
        // the generic timeout destroying the socket at that point was cutting the attempt short
        // (and dropping the whole rig connection) well before this budget was ever exhausted.
        const t0 = Date.now();
        const deadline = t0 + POWER_ON_CONFIRM_TIMEOUT_MS;
        vlog(`[RIG][POWER] Sending set_powerstat 1 to rig (up to ${POWER_ON_CONFIRM_TIMEOUT_MS / 1000}s to ack + confirm)`);
        // Broadcast the pending state to every connected client (not just the one that clicked)
        // before the — potentially slow — command even completes, so all UIs show the same
        // "waiting for radio" state instead of each client tracking its own local guess.
        ctx.lastStatus = { ...ctx.lastStatus, powerPending: true };
        ctx.io.emit("rig-status", ctx.lastStatus);
        // A dropped/reset connection on this send (see issue #62) does not tell us whether the
        // command reached the radio before the reset — confirmed in the field to sometimes mean
        // it did NOT (radio stayed off). So `acked` tracks whether we know a set_powerstat 1 was
        // actually delivered; while false, the loop below resends it as soon as the link is back,
        // exactly what a manual second click on Power On used to be needed for — instead of
        // silently polling get_powerstat on a radio that was never actually told to turn on.
        let acked = false;
        try {
          await sendToRig(ctx, "set_powerstat 1", true, true, POWER_ON_CONFIRM_TIMEOUT_MS);
          acked = true;
          vlog(`[RIG][POWER] Power-on command acknowledged after ${Date.now() - t0}ms — polling get_powerstat every 500 ms until the window elapses`);
        } catch (ackErr) {
          vlog(`[RIG][POWER] Initial set_powerstat 1 send failed (${ackErr}) — will resend once the link recovers instead of failing immediately`);
        }
        let confirmed = false;
        let polls = 0;
        while (Date.now() < deadline) {
          if (!ctx.isConnected) {
            // Give auto-reconnect (5s retry cadence) a chance to bring the link back within the
            // remaining budget instead of giving up on the first disconnected tick.
            await new Promise<void>(r => setTimeout(r, 500));
            continue;
          }
          if (!acked) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            try {
              vlog("[RIG][POWER] Link back — resending set_powerstat 1");
              await sendToRig(ctx, "set_powerstat 1", true, true, Math.max(remaining, 1000));
              acked = true;
              vlog(`[RIG][POWER] Resend acknowledged after ${Date.now() - t0}ms`);
            } catch (resendErr) {
              vlog(`[RIG][POWER] Resend of set_powerstat 1 failed (${resendErr}) — will retry again if/when the link recovers`);
              await new Promise<void>(r => setTimeout(r, 500));
              continue;
            }
          }
          await new Promise<void>(r => setTimeout(r, 500));
          if (ctx.powerState === 'on') {
            vlog(`[RIG][POWER] Power-on confirmed by poll loop after ${Date.now() - t0} ms`);
            confirmed = true;
            break;
          }
          polls++;
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          try {
            const ps = await sendToRig(ctx, "get_powerstat", true, true, Math.max(remaining, 1000));
            vlog(`[RIG][POWER] Poll ${polls}: get_powerstat=${ps.trim()} (${Date.now() - t0} ms elapsed)`);
            if (ps.trim() === "1") { confirmed = true; break; }
          } catch (pollErr) {
            vlog(`[RIG][POWER] Poll ${polls}: get_powerstat error — ${pollErr} (${Date.now() - t0} ms elapsed)`);
          }
        }
        if (confirmed && ctx.powerState !== 'on') {
          vlog(`[RIG][POWER] Radio confirmed on after ${Date.now() - t0} ms — resuming normal operations`);
          ctx.powerState = 'on';
          ctx.lastStatus = { ...ctx.lastStatus, powerState: 'on', powerPending: false };
          ctx.io.emit("rig-status", ctx.lastStatus);
          await onPowerOn(ctx);
        } else if (confirmed) {
          vlog(`[RIG][POWER] Radio confirmed on (by poll loop) after ${Date.now() - t0} ms`);
          ctx.lastStatus = { ...ctx.lastStatus, powerPending: false };
          ctx.io.emit("rig-status", ctx.lastStatus);
        } else {
          vlog(`[RIG][POWER] Timed out — radio did not confirm power-on within ${POWER_ON_CONFIRM_TIMEOUT_MS / 1000}s (connected=${ctx.isConnected}, acked=${acked})`);
          ctx.lastStatus = { ...ctx.lastStatus, powerPending: false };
          ctx.io.emit("rig-status", ctx.lastStatus);
          socket.emit("rig-op-error", acked
            ? `Radio did not respond within ${POWER_ON_CONFIRM_TIMEOUT_MS / 1000} seconds`
            : "Could not deliver the power-on command — check the rigctld connection and try again");
        }
      }
    } catch (err) {
      vlog(`[RIG][POWER] set-power failed: ${err}`);
      if (state) {
        ctx.lastStatus = { ...ctx.lastStatus, powerPending: false };
        ctx.io.emit("rig-status", ctx.lastStatus);
      }
      if (state && String(err).includes('timeout')) {
        vlog("[RIG][POWER] Power-on timeout is expected during radio boot — auto-reconnect will resume when ready");
      } else {
        socket.emit("rig-op-error", `Failed to set power: ${err}`);
      }
    } finally {
      ctx.powerOpInProgress = false;
    }
  });

  socket.on("set-vfo", async (vfo) => {
    if (!ctx.vfoSupported) return;
    try {
      await sendToRig(ctx, `V ${vfo}`, true, true);
      const confirmedVfo = normalizeVfoName(await sendToRig(ctx, "v", true, true));
      ctx.lastStatus = { ...ctx.lastStatus, vfo: confirmedVfo };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set VFO");
    }
  });

  socket.on("set-split-vfo", async ({ split, txVFO }) => {
    if (!ctx.vfoSupported) return;
    try {
      await sendToRig(ctx, `S ${split} ${txVFO}`, true, true);
      const splitInfo = await sendToRig(ctx, "s", true, true);
      const [isSplitStr, confirmedTxVFO] = splitInfo.split("\n");
      ctx.lastStatus = { ...ctx.lastStatus, isSplit: isSplitStr === "1", txVFO: confirmedTxVFO ? normalizeVfoName(confirmedTxVFO) : "VFOB" };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set split VFO");
    }
  });

  socket.on("vfo-op", async (op) => {
    try {
      await sendToRig(ctx, `G ${op}`, true, true);
      const frequency = await sendToRig(ctx, "f", true, true);
      const modeBw = await sendToRig(ctx, "m", true, true);
      const [mode, bandwidth] = modeBw.split("\n");
      if (ctx.vfoSupported) {
        const vfo = normalizeVfoName(await sendToRig(ctx, "v", true, true));
        ctx.lastStatus = { ...ctx.lastStatus, frequency, mode, bandwidth, vfo };
      } else {
        ctx.lastStatus = { ...ctx.lastStatus, frequency, mode, bandwidth };
      }
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", `Failed to execute VFO operation: ${op}`);
    }
  });

  socket.on("set-visible-meters", (meters: string[]) => {
    ctx.visibleMeters = meters;
  });

  socket.on("set-poll-rate", (rate) => {
    ctx.pollRate = rate;
    ctx.saveSettings();
    startPolling(ctx);
  });

  socket.on("set-autoconnect-eligible", (eligible) => {
    ctx.autoconnectEligible = eligible;
    ctx.saveSettings();
  });

  socket.on("set-client-config", ({ host, port }) => {
    ctx.clientHost = host;
    ctx.clientPort = port;
    ctx.saveSettings();
  });

  socket.on("send-raw", async (cmd) => {
    try {
      const resp = await sendToRig(ctx, cmd, false, true);
      socket.emit("raw-response", { cmd, resp });
    } catch (err) {
      socket.emit("raw-response", { cmd, resp: `Error: ${err}` });
    }
  });

  socket.on("set-ft710-span", async (spanIndex: number) => {
    if (typeof spanIndex !== "number" || spanIndex < 0 || spanIndex > 9) return;
    const catCmd = `SS05${spanIndex}0000;`;
    try {
      await sendToRig(ctx, `send_raw 0 ${catCmd}`, true, true);
    } catch (err) {
      console.warn("[SPECTRUM] Failed to set FT-710 span:", err);
    }
  });
}
