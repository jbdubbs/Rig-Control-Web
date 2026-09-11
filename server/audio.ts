import { Socket } from "socket.io";
import type { ServerContext } from "./context.ts";
import { vlogAudio as vlog } from "./vlog.ts";

const OUTBOUND_SILENCE = Buffer.alloc(960 * 2);
const OUTBOUND_PRE_FILL = 3;
const OUTBOUND_JITTER_MAX = 8;
const CW_MODES = new Set(["CW", "CWR", "CW-R"]);

// naudiodon-gcc15's AudioIO.quit() resolves as soon as its detached native
// teardown thread (PaContext::stop) is launched, not when Pa_AbortStream/
// Pa_CloseStream/Pa_Terminate actually finish — reopening the same physical
// device before that thread completes races PortAudio's global ALSA state
// and segfaults (issue #53). This cooldown is a JS-side mitigation: give the
// detached thread a safe margin before the next device open is allowed.
const DEVICE_TEARDOWN_COOLDOWN_MS = 1000;
let lastDeviceTeardownAt = 0;

// Serializes every start/stop lifecycle operation (from socket handlers here
// and from rigComm.ts's power-off/power-on paths) so overlapping calls can
// never run concurrently against the same ctx.audioInputProcess/
// audioOutputProcess.
let audioOpChain: Promise<void> = Promise.resolve();
let restartSeq = 0;

function queueAudioOp(op: () => Promise<void>): Promise<void> {
  const result = audioOpChain.then(op, op);
  audioOpChain = result.then(() => {}, () => {}); // keep the chain alive past a rejection
  return result;
}

// ─── Backend Audio Engine admin-lock (issue #51) ───────────────────────────
// Pure decision logic, kept separate from the socket handlers below so it's
// unit-testable without touching naudiodon/sockets/ctx.

const BACKEND_LOCKABLE_KEYS = new Set(["inputDevice", "outputDevice", "inboundEnabled", "outboundEnabled"]);
const LOCK_FLAG_KEY = "backendLockedToAdmin";

export function isAudioSettingsChangeAllowed(
  locked: boolean,
  role: "admin" | "regular" | undefined,
  incomingKeys: string[]
): boolean {
  if (role === "admin") return true;
  // Only an admin may ever flip the lock flag itself, regardless of current lock state.
  if (incomingKeys.includes(LOCK_FLAG_KEY)) return false;
  if (locked && incomingKeys.some((k) => BACKEND_LOCKABLE_KEYS.has(k))) return false;
  return true;
}

export function isControlAudioActionAllowed(locked: boolean, role: "admin" | "regular" | undefined): boolean {
  return role === "admin" || !locked;
}

export async function initAudioEngine(ctx: ServerContext): Promise<void> {
  try {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)');

    vlog("[AUDIO-INIT] Attempting to load libopus-node...");
    ctx.libopus = await dynamicImport("libopus-node");
    vlog("[AUDIO-INIT] libopus-node loaded successfully.");

    vlog("[AUDIO-INIT] Attempting to load naudiodon...");
    try {
      ctx.portAudio = await dynamicImport("naudiodon");
      vlog("[AUDIO-INIT] naudiodon loaded successfully.");
      try {
        const hostAPIInfo = ctx.portAudio.getHostAPIs();
        vlog("[AUDIO-INIT] Host APIs:", JSON.stringify(hostAPIInfo, null, 2));
      } catch (e: any) {
        console.warn("[AUDIO-INIT] Could not enumerate host APIs:", e.message);
      }
      ctx.isAudioEngineReady = true;
    } catch (naudioErr: any) {
      console.error("[AUDIO-INIT] Failed to load naudiodon. Audio I/O will be disabled.", naudioErr.message);
      ctx.audioEngineError = "naudiodon missing (build tools required)";
    }
  } catch (err: any) {
    console.error("[AUDIO-INIT] Failed to load audio engine:", err);
    ctx.audioEngineError = err.message;
  } finally {
    ctx.io.emit("audio-engine-state", { isReady: ctx.isAudioEngineReady, error: ctx.audioEngineError });
  }
}

export async function listAudioDevices(ctx: ServerContext): Promise<{ inputs: any[]; outputs: any[]; error?: string }> {
  if (!ctx.portAudio) {
    return { inputs: [], outputs: [], error: ctx.audioEngineError || "Audio engine not ready" };
  }
  try {
    const allDevices = ctx.portAudio.getDevices();
    vlog("[AUDIO] Full device table:", JSON.stringify(allDevices.map((d: any) => ({
      id: d.id,
      name: d.name,
      hostAPIName: d.hostAPIName || "",
      maxInputChannels: d.maxInputChannels,
      maxOutputChannels: d.maxOutputChannels,
      defaultSampleRate: d.defaultSampleRate || 0,
    })), null, 2));
    // Windows enumerates every physical device once per host API (MME,
    // DirectSound, WASAPI, WDM-KS). DirectSound and WASAPI cover the latency
    // range users need, so MME (needlessly high latency) and WDM-KS (an
    // exclusive-mode driver that offers no benefit here) are hidden from the
    // device pickers to cut down the list. This only affects the list shown
    // to the user — resolveDeviceId() below still resolves against the full,
    // unfiltered device table, so a device saved before this change keeps
    // working exactly as before.
    const devices = process.platform === "win32"
      ? allDevices.filter((d: any) => d.hostAPIName !== "MME" && d.hostAPIName !== "Windows WDM-KS")
      : allDevices;
    const inputs = devices.filter((d: any) => d.maxInputChannels > 0).map((d: any) => ({ name: d.name, altName: d.id.toString(), hostAPIName: d.hostAPIName || "", defaultSampleRate: d.defaultSampleRate || 0 }));
    const outputs = devices.filter((d: any) => d.maxOutputChannels > 0).map((d: any) => ({ name: d.name, altName: d.id.toString(), hostAPIName: d.hostAPIName || "", defaultSampleRate: d.defaultSampleRate || 0 }));
    return { inputs, outputs };
  } catch (err: any) {
    console.error("[AUDIO] Failed to list devices:", err);
    return { inputs: [], outputs: [], error: err.message };
  }
}

// PortAudio device IDs are ordinal positions in the current enumeration, not
// stable identifiers — custom named ALSA PCMs (e.g. PipeWire target.object
// pins) can shift slots between enumerations even with no hardware change.
// Resolving by name alone is not enough either: on Windows, PortAudio
// enumerates the same physical device once per host API (MME, DirectSound,
// WASAPI, WDM-KS), all sharing an identical `name` — so name-only lookup
// always resolves to whichever host API happens to be enumerated first,
// regardless of which one the user picked. The current format is a JSON
// {name, hostAPIName} pair, which is both stable across restarts and unique
// per host API. Older saved formats are supported as fallbacks: a bare
// device name (settings saved between the name-only fix and this one) and a
// raw ordinal id (settings saved before either fix).
// Logged unconditionally (not gated behind --debug-audio): this is a
// one-shot, low-frequency diagnostic that fires once per startAudio() call,
// and it's the only reliable way to see which raw settings.json format and
// resolution branch produced a given device id — capturing it after the
// fact by asking a non-technical user for settings.json isn't practical, and
// gating it would risk missing the one time it matters if the debug flag
// wasn't already armed before the failure occurred.
function logDeviceResolution(label: "input" | "output", saved: string, branch: string, device: any | undefined): void {
  if (device) {
    console.log(
      `[AUDIO-RESOLVE] ${label} device: saved=${JSON.stringify(saved)} branch=${branch} -> ` +
      `id=${device.id} name=${JSON.stringify(device.name)} hostAPIName=${JSON.stringify(device.hostAPIName || "")} ` +
      `maxInputChannels=${device.maxInputChannels} maxOutputChannels=${device.maxOutputChannels} ` +
      `defaultSampleRate=${device.defaultSampleRate || 0}`
    );
  } else {
    console.log(`[AUDIO-RESOLVE] ${label} device: saved=${JSON.stringify(saved)} branch=${branch} -> NOT FOUND`);
  }
}

export function resolveDeviceId(ctx: ServerContext, saved: string, label: "input" | "output"): number {
  const devices = ctx.portAudio.getDevices();
  // PortAudio enumerates many physical devices as two separate rows under
  // the same host API — one input-capable, one output-capable — sharing an
  // identical `name` (e.g. "FT-710 (USB Audio Device)" on Windows
  // DirectSound: id 18 is input-only, id 22 is output-only). Matching by
  // name/hostAPIName alone is ambiguous between those rows, so every
  // name-based lookup below must also filter by the channel count relevant
  // to `label`, or it can silently resolve the output stream to an
  // input-only row (and vice versa).
  const matchesDirection = (d: any) => (label === "input" ? d.maxInputChannels > 0 : d.maxOutputChannels > 0);

  try {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed.name === "string" && typeof parsed.hostAPIName === "string") {
      const exact = devices.find((d: any) => d.name === parsed.name && d.hostAPIName === parsed.hostAPIName && matchesDirection(d));
      if (exact) {
        logDeviceResolution(label, saved, "exact-json-match", exact);
        return exact.id;
      }
      const byNameOnly = devices.find((d: any) => d.name === parsed.name && matchesDirection(d));
      logDeviceResolution(label, saved, "json-fallback-byNameOnly (host API mismatch)", byNameOnly);
      return byNameOnly ? byNameOnly.id : -1;
    }
  } catch {
    // Not JSON — fall through to legacy formats below.
  }

  const byName = devices.find((d: any) => d.name === saved && matchesDirection(d));
  if (byName) {
    logDeviceResolution(label, saved, "legacy-byName", byName);
    return byName.id;
  }
  const numeric = parseInt(saved, 10);
  if (isNaN(numeric)) {
    logDeviceResolution(label, saved, "unresolvable", undefined);
    return -1;
  }
  const byOrdinal = devices.find((d: any) => d.id === numeric);
  logDeviceResolution(label, saved, "legacy-ordinal", byOrdinal);
  return numeric;
}

async function stopAudioLocked(ctx: ServerContext): Promise<void> {
  vlog("[AUDIO] Stopping audio streaming...");
  if (ctx.outboundTimer) { clearInterval(ctx.outboundTimer); ctx.outboundTimer = null; }
  ctx.outboundJitterBuffer = [];
  let torndownLive = false;
  if (ctx.audioInputProcess) {
    try { await ctx.audioInputProcess.quit(); } catch (e) {}
    ctx.audioInputProcess = null;
    torndownLive = true;
  }
  if (ctx.audioOutputProcess) {
    try { await ctx.audioOutputProcess.quit(); } catch (e) {}
    ctx.audioOutputProcess = null;
    torndownLive = true;
  }
  if (torndownLive) lastDeviceTeardownAt = Date.now();
  ctx.opusEncoder = null;
  ctx.opusDecoder = null;
  ctx.audioStatus = "stopped";
  ctx.io.emit("audio-status", ctx.audioStatus);
}

async function startAudioLocked(ctx: ServerContext): Promise<void> {
  vlog("[AUDIO] Starting audio streaming...");
  await stopAudioLocked(ctx);

  const elapsed = Date.now() - lastDeviceTeardownAt;
  if (elapsed < DEVICE_TEARDOWN_COOLDOWN_MS) {
    const wait = DEVICE_TEARDOWN_COOLDOWN_MS - elapsed;
    vlog(`[AUDIO] Waiting ${wait}ms for prior device teardown before reopening`);
    ctx.audioStatus = "cooldown";
    ctx.io.emit("audio-status", ctx.audioStatus);
    await new Promise<void>(resolve => setTimeout(resolve, wait));
  }

  if (!ctx.isAudioEngineReady) {
    console.warn("[AUDIO] Cannot start audio: Audio engine is not ready.");
    return;
  }

  if (!ctx.audioSettings.inputDevice && !ctx.audioSettings.outputDevice) {
    console.warn("[AUDIO] Cannot start audio: No devices selected.");
    return;
  }

  try {
    ctx.opusEncoder = new ctx.libopus.OpusEncoder(48000, 1);
    ctx.opusDecoder = new ctx.libopus.OpusEncoder(48000, 1);
    vlog("[AUDIO] Opus encoder/decoder initialized at 48000Hz Mono.");
  } catch (err) {
    console.error("[AUDIO] Failed to initialize Opus:", err);
    return;
  }

  if (ctx.audioSettings.inputDevice) {
    try {
      const deviceId = resolveDeviceId(ctx, ctx.audioSettings.inputDevice, "input");
      ctx.audioInputProcess = new ctx.portAudio.AudioIO({
        inOptions: {
          channelCount: 1,
          sampleFormat: ctx.portAudio.SampleFormat16Bit,
          sampleRate: 48000,
          deviceId,
          closeOnError: true,
          framesPerBuffer: 0,
          maxQueue: 10,
          highwaterMark: 256,
        },
      });

      const FRAME_SIZE_BYTES = 960 * 2;
      let pcmBuffer = Buffer.alloc(0);

      ctx.audioInputProcess.on('data', (data: Buffer) => {
        try {
          if (ctx.activeMicClientId && ctx.lastStatus.ptt && !CW_MODES.has(ctx.lastStatus.mode)) return;
          pcmBuffer = Buffer.concat([pcmBuffer, data]);
          while (pcmBuffer.length >= FRAME_SIZE_BYTES) {
            const frame = pcmBuffer.subarray(0, FRAME_SIZE_BYTES);
            pcmBuffer = pcmBuffer.subarray(FRAME_SIZE_BYTES);
            try {
              const encodedPacket = ctx.opusEncoder.encode(frame);
              ctx.io.emit("audio-inbound", encodedPacket);
            } catch (err) {
              console.error("[AUDIO] Opus encode error:", err);
            }
          }
        } catch (err) {
          console.error("[AUDIO-IN] Unhandled exception in data handler:", err);
        }
      });

      ctx.audioInputProcess.on('error', (err: any) => {
        console.error("[AUDIO-IN] naudiodon error:", err);
      });

      ctx.audioInputProcess.start();
      vlog(`[AUDIO-IN] Started capture from device ${ctx.audioSettings.inputDevice}`);
    } catch (err) {
      console.error("[AUDIO-IN] Failed to start capture:", err);
    }
  }

  if (ctx.audioSettings.outputDevice) {
    try {
      const deviceId = resolveDeviceId(ctx, ctx.audioSettings.outputDevice, "output");
      ctx.audioOutputProcess = new ctx.portAudio.AudioIO({
        outOptions: {
          channelCount: 1,
          sampleFormat: ctx.portAudio.SampleFormat16Bit,
          sampleRate: 48000,
          deviceId,
          closeOnError: false,
          framesPerBuffer: 0,
          maxQueue: 20,
        },
      });

      ctx.audioOutputProcess.on('error', (err: any) => {
        console.error("[AUDIO-OUT] naudiodon error:", err);
      });
      ctx.audioOutputProcess.on('pa-status', (msg: string) => {
        vlog(`[AUDIO-OUT] portAudio status: ${msg.trim()}`);
      });

      ctx.audioOutputProcess.start();

      for (let i = 0; i < OUTBOUND_PRE_FILL; i++) {
        ctx.audioOutputProcess.write(OUTBOUND_SILENCE);
      }

      ctx.outboundTimer = setInterval(() => {
        if (!ctx.audioOutputProcess) return;
        let frame: Buffer;
        if (ctx.lastStatus.ptt && ctx.outboundJitterBuffer.length > 0) {
          frame = ctx.outboundJitterBuffer.shift()!;
        } else if (ctx.lastStatus.ptt) {
          // PTT active but buffer momentarily empty — write silence without
          // clearing the buffer so arriving packets aren't discarded.
          frame = OUTBOUND_SILENCE;
        } else {
          ctx.outboundJitterBuffer = [];
          frame = OUTBOUND_SILENCE;
        }
        ctx.audioOutputProcess.write(frame);
      }, 20);

      vlog(`[AUDIO-OUT] Started playback to device ${ctx.audioSettings.outputDevice}`);
    } catch (err) {
      console.error("[AUDIO-OUT] Failed to start playback:", err);
    }
  }

  ctx.activeMicClientId = null;
  ctx.io.emit("mic-active-client", null);
  ctx.io.emit("mic-mute-forced");
  ctx.audioStatus = "playing";
  ctx.io.emit("audio-status", ctx.audioStatus);
}

export function startAudio(ctx: ServerContext): Promise<void> {
  return queueAudioOp(() => startAudioLocked(ctx));
}

export function stopAudio(ctx: ServerContext): Promise<void> {
  return queueAudioOp(() => stopAudioLocked(ctx));
}

// Used only by update-audio-settings: coalesces rapid device-selection
// changes so only the most recently requested settings actually trigger a
// hardware restart, instead of stacking one full stop/cooldown/start cycle
// per intermediate selection.
function queueCoalescedRestart(ctx: ServerContext): Promise<void> {
  const mySeq = ++restartSeq;
  return queueAudioOp(async () => {
    if (mySeq !== restartSeq) return; // superseded by a newer settings change
    await startAudioLocked(ctx);
  });
}

export function registerAudioHandlers(socket: Socket, ctx: ServerContext, clientId: string): void {
  socket.on("get-audio-devices", async () => {
    vlog("[AUDIO] Client requested audio devices list");
    const { inputs, outputs, error } = await listAudioDevices(ctx);
    socket.emit("audio-devices-list", { inputs, outputs, error });
  });

  socket.on("update-audio-settings", async (settings: any) => {
    vlog("[AUDIO] Updating audio settings:", settings);
    const authInfo = ctx.authenticatedSockets.get(socket.id);
    const incomingKeys = Object.keys(settings ?? {});
    if (!isAudioSettingsChangeAllowed(ctx.audioSettings.backendLockedToAdmin, authInfo?.role, incomingKeys)) {
      vlog(`[AUDIO] Rejected update-audio-settings from ${authInfo?.callsign ?? "unauthenticated"} (locked): ${incomingKeys.join(",")}`);
      socket.emit("audio-settings:denied", {
        action: "update-audio-settings",
        reason: "Backend Audio Engine settings are locked to administrators.",
      });
      return;
    }
    const wasPlaying = ctx.audioStatus === "playing";
    ctx.audioSettings = { ...ctx.audioSettings, ...settings };
    ctx.saveSettings();
    ctx.io.emit("settings-data", { audioSettings: ctx.audioSettings });
    if (wasPlaying) {
      await queueCoalescedRestart(ctx);
    }
  });

  socket.on("control-audio", async (action: "start" | "stop") => {
    vlog(`[AUDIO] Control action received: ${action}`);
    const authInfo = ctx.authenticatedSockets.get(socket.id);
    if (!isControlAudioActionAllowed(ctx.audioSettings.backendLockedToAdmin, authInfo?.role)) {
      vlog(`[AUDIO] Rejected control-audio '${action}' from ${authInfo?.callsign ?? "unauthenticated"} (locked)`);
      socket.emit("audio-settings:denied", {
        action: "control-audio",
        reason: "Backend Audio Engine is locked to administrators.",
      });
      return;
    }
    if (action === "start") {
      await startAudio(ctx);
    } else if (action === "stop") {
      await stopAudio(ctx);
    }
  });

  socket.on("mic-unmute-request", () => {
    ctx.activeMicClientId = clientId;
    vlog(`[AUDIO] Mic claimed by client: ${clientId}`);
    socket.broadcast.emit("mic-mute-forced");
    ctx.io.emit("mic-active-client", ctx.activeMicClientId);
  });

  socket.on("mic-mute-notify", () => {
    if (ctx.activeMicClientId === clientId) {
      ctx.activeMicClientId = null;
      ctx.io.emit("mic-active-client", null);
    }
  });

  let outboundDiagCount = 0;
  let outboundRecvCount = 0;
  socket.on("audio-outbound", (data: Buffer) => {
    outboundRecvCount++;
    if (outboundRecvCount <= 5 || outboundRecvCount % 50 === 0) {
      vlog(`[AUDIO-DIAG] audio-outbound received #${outboundRecvCount} from clientId=${clientId}, bytes=${data.length}, activeMic=${ctx.activeMicClientId}, ptt=${ctx.lastStatus.ptt}`);
    }
    if (ctx.activeMicClientId !== clientId) return;
    if (!ctx.audioOutputProcess || !ctx.opusDecoder) return;
    if (!ctx.lastStatus.ptt) return;

    try {
      const pcmData = ctx.opusDecoder.decode(data);
      if (outboundDiagCount < 5) {
        vlog(`[AUDIO-DIAG] encoded packet bytes=${data.length} decoded bytes=${pcmData.length} (expected 1920 for 48kHz/mono/20ms)`);
        outboundDiagCount++;
      }
      ctx.outboundJitterBuffer.push(pcmData);
      while (ctx.outboundJitterBuffer.length > OUTBOUND_JITTER_MAX) {
        ctx.outboundJitterBuffer.shift();
      }
    } catch (err) {
      console.error("[AUDIO-OUT] Opus decode error:", err);
    }
  });
}
