import { Socket } from "socket.io";
import { ServerContext } from "./context.ts";
import { vlog } from "./vlog.ts";

const OUTBOUND_SILENCE = Buffer.alloc(960 * 2);
const OUTBOUND_PRE_FILL = 3;
const OUTBOUND_JITTER_MAX = 8;

export async function initAudioEngine(ctx: ServerContext): Promise<void> {
  try {
    const dynamicImport = new Function('modulePath', 'return import(modulePath)');

    console.log("[AUDIO-INIT] Attempting to load libopus-node...");
    ctx.libopus = await dynamicImport("libopus-node");
    console.log("[AUDIO-INIT] libopus-node loaded successfully.");

    console.log("[AUDIO-INIT] Attempting to load naudiodon...");
    try {
      ctx.portAudio = await dynamicImport("naudiodon");
      console.log("[AUDIO-INIT] naudiodon loaded successfully.");
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
    const devices = ctx.portAudio.getDevices();
    const inputs = devices.filter((d: any) => d.maxInputChannels > 0).map((d: any) => ({ name: d.name, altName: d.id.toString(), hostAPIName: d.hostAPIName || "", defaultSampleRate: d.defaultSampleRate || 0 }));
    const outputs = devices.filter((d: any) => d.maxOutputChannels > 0).map((d: any) => ({ name: d.name, altName: d.id.toString(), hostAPIName: d.hostAPIName || "", defaultSampleRate: d.defaultSampleRate || 0 }));
    return { inputs, outputs };
  } catch (err: any) {
    console.error("[AUDIO] Failed to list devices:", err);
    return { inputs: [], outputs: [], error: err.message };
  }
}

export async function stopAudio(ctx: ServerContext): Promise<void> {
  console.log("[AUDIO] Stopping audio streaming...");
  if (ctx.outboundTimer) { clearInterval(ctx.outboundTimer); ctx.outboundTimer = null; }
  ctx.outboundJitterBuffer = [];
  if (ctx.audioInputProcess) {
    try { await ctx.audioInputProcess.quit(); } catch (e) {}
    ctx.audioInputProcess = null;
  }
  if (ctx.audioOutputProcess) {
    try { await ctx.audioOutputProcess.quit(); } catch (e) {}
    ctx.audioOutputProcess = null;
  }
  ctx.opusEncoder = null;
  ctx.opusDecoder = null;
  ctx.audioStatus = "stopped";
  ctx.io.emit("audio-status", ctx.audioStatus);
}

export async function startAudio(ctx: ServerContext): Promise<void> {
  console.log("[AUDIO] Starting audio streaming...");
  await stopAudio(ctx);

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
    console.log("[AUDIO] Opus encoder/decoder initialized at 48000Hz Mono.");
  } catch (err) {
    console.error("[AUDIO] Failed to initialize Opus:", err);
    return;
  }

  if (ctx.audioSettings.inputDevice) {
    try {
      const deviceId = parseInt(ctx.audioSettings.inputDevice, 10);
      ctx.audioInputProcess = new ctx.portAudio.AudioIO({
        inOptions: {
          channelCount: 1,
          sampleFormat: ctx.portAudio.SampleFormat16Bit,
          sampleRate: 48000,
          deviceId: isNaN(deviceId) ? -1 : deviceId,
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
          if (ctx.activeMicClientId && ctx.lastStatus.ptt) return;
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
      console.log(`[AUDIO-IN] Started capture from device ${ctx.audioSettings.inputDevice}`);
    } catch (err) {
      console.error("[AUDIO-IN] Failed to start capture:", err);
    }
  }

  if (ctx.audioSettings.outputDevice) {
    try {
      const deviceId = parseInt(ctx.audioSettings.outputDevice, 10);
      ctx.audioOutputProcess = new ctx.portAudio.AudioIO({
        outOptions: {
          channelCount: 1,
          sampleFormat: ctx.portAudio.SampleFormat16Bit,
          sampleRate: 48000,
          deviceId: isNaN(deviceId) ? -1 : deviceId,
          closeOnError: false,
          framesPerBuffer: 0,
          maxQueue: 20,
        },
      });

      ctx.audioOutputProcess.on('error', (err: any) => {
        console.error("[AUDIO-OUT] naudiodon error:", err);
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
        } else {
          ctx.outboundJitterBuffer = [];
          frame = OUTBOUND_SILENCE;
        }
        ctx.audioOutputProcess.write(frame);
      }, 20);

      console.log(`[AUDIO-OUT] Started playback to device ${ctx.audioSettings.outputDevice}`);
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

export function registerAudioHandlers(socket: Socket, ctx: ServerContext, clientId: string): void {
  socket.on("get-audio-devices", async () => {
    vlog("[AUDIO] Client requested audio devices list");
    const { inputs, outputs, error } = await listAudioDevices(ctx);
    socket.emit("audio-devices-list", { inputs, outputs });
  });

  socket.on("update-audio-settings", async (settings: any) => {
    vlog("[AUDIO] Updating audio settings:", settings);
    const wasPlaying = ctx.audioStatus === "playing";
    ctx.audioSettings = { ...ctx.audioSettings, ...settings };
    ctx.saveSettings();
    ctx.io.emit("settings-data", { audioSettings: ctx.audioSettings });
    if (wasPlaying) {
      await startAudio(ctx);
    }
  });

  socket.on("control-audio", async (action: "start" | "stop") => {
    vlog(`[AUDIO] Control action received: ${action}`);
    if (action === "start") {
      await startAudio(ctx);
    } else if (action === "stop") {
      await stopAudio(ctx);
    }
  });

  socket.on("mic-unmute-request", () => {
    ctx.activeMicClientId = clientId;
    console.log(`[AUDIO] Mic claimed by client: ${clientId}`);
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
