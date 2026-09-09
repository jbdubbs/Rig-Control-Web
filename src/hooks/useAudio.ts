import { useState, useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { Socket } from "socket.io-client";
import type { GGMorseDecoder } from "../ggmorseDecoder";
import { splitLocalAudioDevices } from "../utils";

let audioVerbose = false;
let wsjtxAudioVerbose = false;
const vlog = (...args: any[]) => { if (audioVerbose) console.log(...args); };
const vlogWsjtx = (...args: any[]) => { if (wsjtxAudioVerbose) console.log("[wsjtx:audio]", ...args); };

interface UseAudioOptions {
  socket: Socket | null;
  cwDecodeEnabledRef: MutableRefObject<boolean>;
  cwDecoderRef: MutableRefObject<GGMorseDecoder | null>;
  waterfallActiveRef: MutableRefObject<boolean>;
}

export function useAudio({ socket, cwDecodeEnabledRef, cwDecoderRef, waterfallActiveRef }: UseAudioOptions) {
  const [activeMicClientId, setActiveMicClientId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<"playing" | "stopped" | "cooldown">("stopped");
  const [audioEngineState, setAudioEngineState] = useState<{ isReady: boolean; error: string | null }>({ isReady: false, error: null });
  const [audioDevices, setAudioDevices] = useState<{ inputs: { name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[]; outputs: { name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[] }>({ inputs: [], outputs: [] });
  const [audioSettings, setAudioSettings] = useState({
    inputDevice: "",
    outputDevice: "",
    inboundEnabled: false,
    outboundEnabled: false
  });
  const [localAudioDevices, setLocalAudioDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });
  const [localAudioSettings, setLocalAudioSettings] = useState({
    inputDevice: localStorage.getItem("local-audio-input") || "default",
    outputDevice: localStorage.getItem("local-audio-output") || "default",
    wsjtxOutputDevice: localStorage.getItem("local-audio-wsjtx-output") || "",
    enhancementsEnabled: localStorage.getItem("local-audio-enhancements") !== "false",
  });
  const [inboundMuted, setInboundMuted] = useState(false);
  const [inboundVolume, setInboundVolume] = useState<number>(() => {
    const saved = localStorage.getItem("local-audio-inbound-volume");
    return saved !== null ? parseFloat(saved) : 1.0;
  });
  const [outboundMuted, setOutboundMuted] = useState(true);
  const [localAudioReady, setLocalAudioReady] = useState(false);
  const [audioWasRestarted, setAudioWasRestarted] = useState(false);
  const [isBackendEngineCollapsed, setIsBackendEngineCollapsed] = useState(false);
  // Set once the user manually re-expands the Backend Audio Engine section
  // (never reset until the next app start) — once true, the auto-collapse
  // effect below stops forcing it shut on every device-change-triggered
  // restart, so a user actively picking through devices doesn't have the
  // section yanked closed out from under them after every selection.
  const userExpandedBackendEngineRef = useRef(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const inboundGainRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const opusDecoderRef = useRef<any>(null);
  const opusEncoderRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const wsjtxStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const wsjtxAudioRef = useRef<HTMLAudioElement | null>(null);
  const socketRef = useRef(socket);

  // Internal refs kept in sync for use in stale closures
  const audioSettingsRef = useRef(audioSettings);
  const audioStatusRef = useRef(audioStatus);
  const inboundMutedRef = useRef(inboundMuted);
  const outboundMutedRef = useRef(outboundMuted);
  const localAudioReadyRef = useRef(localAudioReady);
  const localAudioSettingsRef = useRef(localAudioSettings);
  const inboundVolumeRef = useRef(inboundVolume);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { audioSettingsRef.current = audioSettings; }, [audioSettings]);
  useEffect(() => { audioStatusRef.current = audioStatus; }, [audioStatus]);
  useEffect(() => { inboundMutedRef.current = inboundMuted; }, [inboundMuted]);
  useEffect(() => { outboundMutedRef.current = outboundMuted; }, [outboundMuted]);
  useEffect(() => { localAudioReadyRef.current = localAudioReady; }, [localAudioReady]);
  useEffect(() => { localAudioSettingsRef.current = localAudioSettings; }, [localAudioSettings]);
  useEffect(() => { inboundVolumeRef.current = inboundVolume; }, [inboundVolume]);

  // Single source of truth for "does the inbound gain node reflect mute state" —
  // called both when inboundMuted changes and whenever the gain node itself is
  // (re)created (e.g. on rejoin), so the two can never drift apart.
  const applyInboundMute = useCallback(() => {
    if (!inboundGainRef.current) return;
    inboundGainRef.current.gain.value = inboundMutedRef.current ? 0 : inboundVolumeRef.current;
  }, []);

  useEffect(() => {
    applyInboundMute();
  }, [inboundMuted, applyInboundMute]);

  // Collapse backend engine panel when audio starts playing — skipped once
  // the user has manually re-expanded it (see userExpandedBackendEngineRef),
  // so restarts triggered by the user's own device selection don't keep
  // closing the section back up while they're actively using it.
  useEffect(() => {
    if (audioStatus === "playing" && !userExpandedBackendEngineRef.current) {
      setIsBackendEngineCollapsed(true);
    }
  }, [audioStatus]);

  const toggleBackendEngineCollapsed = useCallback(() => {
    setIsBackendEngineCollapsed(prev => {
      const next = !prev;
      if (!next) userExpandedBackendEngineRef.current = true;
      return next;
    });
  }, []);

  // Enumerate browser-side local audio devices
  useEffect(() => {
    if (!navigator.mediaDevices) {
      console.warn("navigator.mediaDevices is not available. Audio device selection will be disabled.");
      return;
    }
    const getLocalDevices = async () => {
      try {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
        } catch (permErr) {
          console.warn("Microphone permission not yet granted or denied:", permErr);
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        setLocalAudioDevices(splitLocalAudioDevices(devices));
      } catch (err) {
        console.error("Error enumerating local audio devices:", err);
      }
    };
    getLocalDevices();
    navigator.mediaDevices.addEventListener('devicechange', getLocalDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getLocalDevices);
  }, []);

  // Resume AudioContext on user interaction (browser autoplay policy)
  useEffect(() => {
    const resumeAudio = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    };
    window.addEventListener('click', resumeAudio);
    return () => window.removeEventListener('click', resumeAudio);
  }, []);

  // audio-inbound socket handler
  useEffect(() => {
    if (!socket) return;
    const handler = (data: ArrayBuffer | Uint8Array) => {
      if (!audioSettingsRef.current.inboundEnabled || audioStatusRef.current !== "playing" || !localAudioReadyRef.current) {
        return;
      }
      if (inboundMutedRef.current && !cwDecodeEnabledRef.current && !waterfallActiveRef.current && !wsjtxStreamDestRef.current) {
        return;
      }
      playInboundAudio(data);
    };
    socket.on("audio-inbound", handler);
    return () => { socket.off("audio-inbound", handler); };
  }, [socket]);

  // Mic capture lifecycle
  useEffect(() => {
    if (audioStatus === "playing" && audioSettings.outboundEnabled && localAudioReady) {
      startMicCapture();
    } else {
      stopMicCapture();
    }
    return () => stopMicCapture();
  }, [audioStatus, audioSettings.outboundEnabled, localAudioSettings.inputDevice, localAudioSettings.enhancementsEnabled, localAudioReady]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    const onSettingsData = (data: any) => {
      if (data.audioSettings) {
        setAudioSettings(data.audioSettings);
      }
    };

    const onAudioStatus = (status: "playing" | "stopped" | "cooldown") => {
      setAudioStatus(status);
      if (status === "stopped") {
        if (localAudioReadyRef.current) {
          setAudioWasRestarted(true);
        }
        if (opusEncoderRef.current) { try { opusEncoderRef.current.close(); } catch (_) {} opusEncoderRef.current = null; }
        if (opusDecoderRef.current) { try { opusDecoderRef.current.close(); } catch (_) {} opusDecoderRef.current = null; }
        if (playbackNodeRef.current) { playbackNodeRef.current.disconnect(); playbackNodeRef.current = null; }
        if (analyserNodeRef.current) { analyserNodeRef.current.disconnect(); analyserNodeRef.current = null; }
        if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
        setLocalAudioReady(false);
      }
    };

    const onAudioEngineState = (state: { isReady: boolean; error: string | null }) => {
      setAudioEngineState(state);
    };

    const onMicActiveClient = (id: string | null) => {
      setActiveMicClientId(id);
    };

    const onMicMuteForced = () => {
      setOutboundMuted(true);
    };

    const onAudioDevicesList = (devices: { inputs: { name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[]; outputs: { name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[]; error?: string }) => {
      if (devices.error) console.warn("[audio] Device enumeration failed:", devices.error);
      setAudioDevices(devices);
    };

    const onDebugFlags = ({ audio, wsjtx }: { audio: boolean; wsjtx: boolean }) => {
      audioVerbose = audio;
      wsjtxAudioVerbose = wsjtx;
    };

    socket.on("settings-data", onSettingsData);
    socket.on("audio-status", onAudioStatus);
    socket.on("audio-engine-state", onAudioEngineState);
    socket.on("mic-active-client", onMicActiveClient);
    socket.on("mic-mute-forced", onMicMuteForced);
    socket.on("audio-devices-list", onAudioDevicesList);
    socket.on("debug-flags", onDebugFlags);

    return () => {
      socket.off("settings-data", onSettingsData);
      socket.off("audio-status", onAudioStatus);
      socket.off("audio-engine-state", onAudioEngineState);
      socket.off("mic-active-client", onMicActiveClient);
      socket.off("mic-mute-forced", onMicMuteForced);
      socket.off("audio-devices-list", onAudioDevicesList);
      socket.off("debug-flags", onDebugFlags);
    };
  }, [socket]);

  const playInboundAudio = (data: ArrayBuffer | Uint8Array) => {
    if (!opusDecoderRef.current || opusDecoderRef.current.state !== 'configured') return;
    try {
      const chunk = new (window as any).EncodedAudioChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: data
      });
      opusDecoderRef.current.decode(chunk);
    } catch (e) {
      console.error("[AUDIO] Failed to decode Opus chunk:", e);
    }
  };

  const stopMicCapture = useCallback(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (captureNodeRef.current) {
      captureNodeRef.current.disconnect();
      captureNodeRef.current = null;
    }
  }, []);

  const initLocalAudioPipeline = useCallback(async () => {
    stopMicCapture();

    if (opusEncoderRef.current) {
      try { opusEncoderRef.current.close(); } catch (_) {}
      opusEncoderRef.current = null;
    }
    if (opusDecoderRef.current) {
      try { opusDecoderRef.current.close(); } catch (_) {}
      opusDecoderRef.current = null;
    }
    if (playbackNodeRef.current) {
      playbackNodeRef.current.disconnect();
      playbackNodeRef.current = null;
    }
    if (analyserNodeRef.current) {
      analyserNodeRef.current.disconnect();
      analyserNodeRef.current = null;
    }
    if (inboundGainRef.current) {
      inboundGainRef.current.disconnect();
      inboundGainRef.current = null;
    }
    if (audioContextRef.current) {
      try { await audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }

    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: 'interactive'
    });
    const ctx = audioContextRef.current;
    vlog(`[AUDIO-DIAG] AudioContext actual sampleRate=${ctx.sampleRate} (requested 48000)`);

    const outputDevice = localAudioSettingsRef.current.outputDevice;
    if (outputDevice && outputDevice !== 'default' && typeof (ctx as any).setSinkId === 'function') {
      try {
        await (ctx as any).setSinkId(outputDevice);
      } catch (e) {
        console.error("Error setting sink ID:", e);
      }
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    try {
      await ctx.audioWorklet.addModule('/audio-processor.js');

      if (!playbackNodeRef.current) {
        playbackNodeRef.current = new AudioWorkletNode(ctx, 'playback-processor');
        const analyserNode = ctx.createAnalyser();
        analyserNode.fftSize = 4096;
        analyserNode.smoothingTimeConstant = 0.6;
        analyserNodeRef.current = analyserNode;
        const gainNode = ctx.createGain();
        inboundGainRef.current = gainNode;
        applyInboundMute();
        playbackNodeRef.current.connect(analyserNode);
        analyserNode.connect(gainNode);
        gainNode.connect(ctx.destination);

        // WSJTX dual output: tap from analyserNode (before gain) so mute/volume
        // doesn't affect the WSJTX feed
        const wsjtxDevice = localAudioSettingsRef.current.wsjtxOutputDevice;
        if (wsjtxDevice) {
          vlogWsjtx(`Setting up dual output to device: ${wsjtxDevice}`);
          try {
            const streamDest = ctx.createMediaStreamDestination();
            analyserNode.connect(streamDest);
            wsjtxStreamDestRef.current = streamDest;
            vlogWsjtx("MediaStreamDestination created and connected to analyserNode");

            const audioEl = new Audio();
            audioEl.srcObject = streamDest.stream;
            if (typeof (audioEl as any).setSinkId === "function") {
              vlogWsjtx(`Calling setSinkId(${wsjtxDevice})`);
              await (audioEl as any).setSinkId(wsjtxDevice);
              vlogWsjtx("setSinkId succeeded");
            } else {
              vlogWsjtx("setSinkId not available on this browser");
            }
            await audioEl.play();
            wsjtxAudioRef.current = audioEl;
            vlogWsjtx("WSJTX audio output active");
          } catch (e) {
            console.error("[AUDIO] Failed to setup WSJTX output:", e);
            vlogWsjtx("WSJTX audio output setup failed:", e);
          }
        }
      }

      if (!opusDecoderRef.current && typeof (window as any).AudioDecoder !== 'undefined') {
        const decoder = new (window as any).AudioDecoder({
          output: (audioData: any) => {
            const isPlaying = audioStatusRef.current === "playing";
            const needPcm = isPlaying && (!inboundMutedRef.current);
            const needCw = isPlaying && cwDecodeEnabledRef.current && !!cwDecoderRef.current;
            const needWaterfall = isPlaying && waterfallActiveRef.current;
            const needWsjtx = isPlaying && !!wsjtxStreamDestRef.current;

            if (!needPcm && !needCw && !needWaterfall && !needWsjtx) {
              audioData.close();
              return;
            }

            const options = { planeIndex: 0 };
            const size = audioData.allocationSize(options);
            const buffer = new ArrayBuffer(size);
            audioData.copyTo(buffer, options);
            const float32Data = new Float32Array(buffer);

            if ((needPcm || needWaterfall || needWsjtx) && playbackNodeRef.current) {
              playbackNodeRef.current.port.postMessage({ type: 'pcm', pcm: float32Data });
            }
            if (needCw) {
              cwDecoderRef.current!.processSamples(float32Data);
            }
            audioData.close();
          },
          error: (e: any) => console.error("[AUDIO] Decoder error:", e)
        });

        decoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 1
        });
        opusDecoderRef.current = decoder;
      }
    } catch (e) {
      console.error("[AUDIO] Failed to setup audio playback:", e);
    }

    setLocalAudioReady(true);
    setAudioWasRestarted(false);
  }, [stopMicCapture, applyInboundMute]);

  const updateWsjtxOutput = useCallback(async (deviceId: string) => {
    vlogWsjtx(`updateWsjtxOutput called, deviceId=${deviceId || "(none)"}`);
    localStorage.setItem("local-audio-wsjtx-output", deviceId);
    setLocalAudioSettings(prev => ({ ...prev, wsjtxOutputDevice: deviceId }));

    const ctx = audioContextRef.current;
    const analyser = analyserNodeRef.current;

    // Tear down existing WSJTX output
    if (wsjtxStreamDestRef.current && analyser) {
      vlogWsjtx("Tearing down existing WSJTX output");
      try { analyser.disconnect(wsjtxStreamDestRef.current); } catch {}
    }
    if (wsjtxAudioRef.current) {
      wsjtxAudioRef.current.pause();
      wsjtxAudioRef.current.srcObject = null;
      wsjtxAudioRef.current = null;
    }
    wsjtxStreamDestRef.current = null;

    if (!deviceId || !ctx || !analyser) {
      vlogWsjtx("WSJTX output disabled (no device selected or no audio context)");
      return;
    }

    try {
      const streamDest = ctx.createMediaStreamDestination();
      analyser.connect(streamDest);
      wsjtxStreamDestRef.current = streamDest;
      vlogWsjtx("MediaStreamDestination created and connected");

      const audioEl = new Audio();
      audioEl.srcObject = streamDest.stream;
      if (typeof (audioEl as any).setSinkId === "function") {
        vlogWsjtx(`Calling setSinkId(${deviceId})`);
        await (audioEl as any).setSinkId(deviceId);
      }
      await audioEl.play();
      wsjtxAudioRef.current = audioEl;
      vlogWsjtx("WSJTX audio output active");
    } catch (e) {
      console.error("[AUDIO] Failed to setup WSJTX output:", e);
      vlogWsjtx("WSJTX audio output setup failed:", e);
    }
  }, []);

  const handleStartAudio = useCallback(async () => {
    await initLocalAudioPipeline();

    const newSettings = {
      ...audioSettingsRef.current,
      inboundEnabled: audioSettingsRef.current.inputDevice !== "" ? true : audioSettingsRef.current.inboundEnabled,
      outboundEnabled: audioSettingsRef.current.outputDevice !== "" ? true : audioSettingsRef.current.outboundEnabled
    };

    if (newSettings.inboundEnabled !== audioSettingsRef.current.inboundEnabled || newSettings.outboundEnabled !== audioSettingsRef.current.outboundEnabled) {
      setAudioSettings(newSettings);
      socketRef.current?.emit("update-audio-settings", newSettings);
    }

    socketRef.current?.emit("control-audio", "start");
  }, [initLocalAudioPipeline]);

  const startMicCapture = useCallback(async () => {
    try {
      if (!navigator.mediaDevices) {
        console.error("navigator.mediaDevices is not available.");
        return;
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 48000,
          latencyHint: 'interactive'
        });
      }
      const ctx = audioContextRef.current;
      vlog(`[AUDIO-DIAG] Capture AudioContext actual sampleRate=${ctx.sampleRate} (requested 48000)`);

      const inputDevice = localAudioSettingsRef.current.inputDevice;
      const isPhoneDefault = !inputDevice || inputDevice === 'default';
      const enhancementsEnabled = localAudioSettingsRef.current.enhancementsEnabled;
      const enhancementFlags = { echoCancellation: enhancementsEnabled, noiseSuppression: enhancementsEnabled, autoGainControl: enhancementsEnabled };
      const specificConstraints = {
        audio: { deviceId: { exact: inputDevice }, ...enhancementFlags }
      };
      const defaultConstraints = {
        audio: { ...enhancementFlags }
      };

      let stream: MediaStream;
      if (isPhoneDefault) {
        stream = await navigator.mediaDevices.getUserMedia(defaultConstraints);
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia(specificConstraints);
        } catch (deviceErr: any) {
          console.warn(`[AUDIO] Stored input device "${inputDevice}" unavailable (${deviceErr.name}), falling back to default.`);
          localStorage.removeItem("local-audio-input");
          setLocalAudioSettings(prev => ({ ...prev, inputDevice: "default" }));
          stream = await navigator.mediaDevices.getUserMedia(defaultConstraints);
        }
      }
      micStreamRef.current = stream;
      const source = ctx.createMediaStreamSource(stream);

      try {
        await ctx.audioWorklet.addModule('/audio-processor.js');
      } catch (e) {
        console.warn("audio-processor.js might already be loaded:", e);
      }

      if (!opusEncoderRef.current && typeof (window as any).AudioEncoder !== 'undefined') {
        let encodeCount = 0;
        const encoder = new (window as any).AudioEncoder({
          output: (chunk: any) => {
            encodeCount++;
            if (encodeCount % 50 === 0) {
              vlog(`[AUDIO-ENCODE] Encoded 50 packets. Emitting to socket...`);
            }
            if (outboundMutedRef.current || audioStatusRef.current !== "playing") return;
            const buffer = new ArrayBuffer(chunk.byteLength);
            chunk.copyTo(buffer);
            if (encodeCount <= 5 || encodeCount % 50 === 0) {
              vlog(`[AUDIO-EMIT] Emitting audio-outbound packet #${encodeCount}, bytes=${buffer.byteLength}, socket connected=${socketRef.current?.connected}`);
            }
            socketRef.current?.emit("audio-outbound", buffer);
          },
          error: (e: any) => console.error("[AUDIO] Encoder error:", e)
        });

        encoder.configure({
          codec: 'opus',
          sampleRate: 48000,
          numberOfChannels: 1,
          bitrate: 64000
        });
        opusEncoderRef.current = encoder;
      }

      const captureNode = new AudioWorkletNode(ctx, 'capture-processor');
      captureNodeRef.current = captureNode;

      let pcmBuffer = new Float32Array(0);
      const FRAME_SIZE = 960;

      let captureFrameCount = 0;
      captureNode.port.onmessage = (e) => {
        captureFrameCount++;
        if (captureFrameCount % 50 === 0) {
          vlog(`[AUDIO-CAPTURE] Captured 50 frames. outboundMuted: ${outboundMutedRef.current}, audioStatus: ${audioStatusRef.current}, encoderState: ${opusEncoderRef.current?.state}`);
        }

        if (outboundMutedRef.current || audioStatusRef.current !== "playing") return;
        if (!opusEncoderRef.current || opusEncoderRef.current.state !== 'configured') return;

        const inputData = e.data.pcm;
        const newBuffer = new Float32Array(pcmBuffer.length + inputData.length);
        newBuffer.set(pcmBuffer, 0);
        newBuffer.set(inputData, pcmBuffer.length);
        pcmBuffer = newBuffer;

        while (pcmBuffer.length >= FRAME_SIZE) {
          const frame = pcmBuffer.subarray(0, FRAME_SIZE);
          pcmBuffer = pcmBuffer.subarray(FRAME_SIZE);

          const audioData = new (window as any).AudioData({
            format: 'f32-planar',
            sampleRate: 48000,
            numberOfFrames: FRAME_SIZE,
            numberOfChannels: 1,
            timestamp: performance.now() * 1000,
            data: frame
          });

          opusEncoderRef.current.encode(audioData);
          audioData.close();
        }
      };

      source.connect(captureNode);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      captureNode.connect(silentGain);
      silentGain.connect(ctx.destination);
    } catch (err) {
      console.error("Error starting mic capture:", err);
    }
  }, []);

  return {
    activeMicClientId,
    audioStatus,
    audioEngineState,
    audioDevices,
    audioSettings, setAudioSettings,
    localAudioDevices, setLocalAudioDevices,
    localAudioSettings, setLocalAudioSettings,
    inboundMuted, setInboundMuted,
    inboundVolume, setInboundVolume,
    outboundMuted, setOutboundMuted,
    localAudioReady,
    audioWasRestarted, setAudioWasRestarted,
    isBackendEngineCollapsed, setIsBackendEngineCollapsed, toggleBackendEngineCollapsed,
    audioContextRef,
    inboundGainRef,
    analyserNodeRef,
    initLocalAudioPipeline,
    handleStartAudio,
    startMicCapture,
    stopMicCapture,
    updateWsjtxOutput,
  };
}
