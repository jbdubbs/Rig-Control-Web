import { useState, useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";

let videoVerbose = false;
const vlog = (...args: any[]) => { if (videoVerbose) console.log(...args); };

interface UseVideoStreamOptions {
  socket: Socket | null;
  settingsLoaded: boolean;
}

export function useVideoStream({ socket, settingsLoaded }: UseVideoStreamOptions) {
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<"streaming" | "stopped">("stopped");
  const [videoSettings, setVideoSettings] = useState({
    device: "",
    videoWidth: 640,
    videoHeight: 480,
    framerate: ""
  });
  const [videoAutoStart, setVideoAutoStart] = useState(false);
  const [videoDevices, setVideoDevices] = useState<{ id: string; label: string }[]>([]);
  const [isVideoSettingsOpen, setIsVideoSettingsOpen] = useState(false);
  const [isVideoCollapsed, setIsVideoCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [resolutionDraft, setResolutionDraft] = useState({ width: "640", height: "480" });

  const isElectronSource = !!(window as any).electron;

  const videoEncoderRef = useRef<any>(null);
  const videoDecoderRef = useRef<any>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoFrameReaderAbortRef = useRef<AbortController | null>(null);
  const videoFrameCountRef = useRef(0);
  const videoSettingsRef = useRef({ device: "", videoWidth: 640, videoHeight: 480, framerate: "" });
  const videoDevicesRef = useRef<{ id: string; label: string }[]>([]);
  const videoStreamDimsRef = useRef({ width: 640, height: 480 });
  const resolutionDraftRef = useRef({ width: "640", height: "480" });
  const isResolutionFocusedRef = useRef(false);
  const resolutionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoStatusRef = useRef<"streaming" | "stopped">("stopped");
  const socketRef = useRef(socket);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { videoStatusRef.current = videoStatus; }, [videoStatus]);
  useEffect(() => { videoSettingsRef.current = videoSettings; }, [videoSettings]);
  useEffect(() => { videoDevicesRef.current = videoDevices; }, [videoDevices]);

  const enumerateVideoDevices = useCallback(async () => {
    if (!isElectronSource) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices
        .filter(d => d.kind === "videoinput")
        .map(d => ({ id: d.deviceId, label: d.label || d.deviceId }));
      setVideoDevices(videoInputs);
      socketRef.current?.emit("video-devices-update", videoInputs);
    } catch (e) {
      console.error("[VIDEO] enumerateDevices failed:", e);
    }
  }, [isElectronSource]);

  const initVideoDecoder = (width: number, height: number, description?: ArrayBuffer) => {
    vlog(`[VIDEO] initVideoDecoder called: ${width}x${height} hasDescription=${!!description}`);
    if (videoDecoderRef.current) {
      try { videoDecoderRef.current.close(); } catch (_) {}
    }
    let frameCount = 0;
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        frameCount++;
        const canvas = videoCanvasRef.current;
        vlog(`[VIDEO] Decoder output frame #${frameCount}: canvas=${canvas ? `${canvas.width}x${canvas.height} (offsetW=${canvas.offsetWidth} offsetH=${canvas.offsetHeight})` : "NULL"}`);
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height);
        }
        frame.close();
      },
      error: (e: DOMException) => {
        console.error("[VIDEO] Decoder error:", e);
        const { width: w, height: h } = videoStreamDimsRef.current;
        initVideoDecoder(w, h);
      }
    });
    const config: VideoDecoderConfig = {
      codec: "avc1.42001F",
      codedWidth: width,
      codedHeight: height,
      hardwareAcceleration: "no-preference",
    };
    if (description) config.description = description;
    decoder.configure(config);
    vlog(`[VIDEO] Decoder configured, state=${decoder.state} hasDescription=${!!description}`);
    videoDecoderRef.current = decoder;
  };

  const stopVideoCapture = useCallback(() => {
    videoFrameReaderAbortRef.current?.abort();
    videoFrameReaderAbortRef.current = null;
    if (videoEncoderRef.current) {
      try { videoEncoderRef.current.close(); } catch (_) {}
      videoEncoderRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    videoFrameCountRef.current = 0;
    socketRef.current?.emit("video-source-stop");
  }, []);

  const startVideoCapture = useCallback(async () => {
    if (!isElectronSource) return;
    stopVideoCapture();

    const currentSettings = videoSettingsRef.current;
    const fps = parseInt(currentSettings.framerate) || 15;
    const width = currentSettings.videoWidth || 640;
    const height = currentSettings.videoHeight || 480;

    const knownIds = videoDevicesRef.current.map(d => d.id);
    const validDeviceId = currentSettings.device && knownIds.includes(currentSettings.device)
      ? currentSettings.device
      : undefined;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: validDeviceId ? { exact: validDeviceId } : undefined,
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: fps }
        }
      });

      videoStreamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const keyframeInterval = Math.max(fps * 2, 30);
      let avcDescription: ArrayBuffer | null = null;

      const encoder = new VideoEncoder({
        output: (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
          if (metadata?.decoderConfig?.description) {
            avcDescription = metadata.decoderConfig.description as ArrayBuffer;
          }
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          const payload: { data: ArrayBuffer; type: string; timestamp: number; description?: ArrayBuffer } = {
            data: data.buffer,
            type: chunk.type,
            timestamp: chunk.timestamp,
          };
          if (chunk.type === "key" && avcDescription) {
            payload.description = avcDescription;
          }
          socketRef.current?.emit("video-frame", payload);
        },
        error: (e: DOMException) => {
          console.error("[VIDEO] Encoder error:", e);
          setVideoError("Video encoder error: " + e.message);
        }
      });

      encoder.configure({
        codec: "avc1.42001F",
        width,
        height,
        bitrate: Math.min(width * height * fps * 0.07, 2_000_000),
        framerate: fps,
        hardwareAcceleration: "no-preference",
      });

      videoEncoderRef.current = encoder;

      const abortController = new AbortController();
      videoFrameReaderAbortRef.current = abortController;

      const processor = new (window as any).MediaStreamTrackProcessor({ track });
      const reader = processor.readable.getReader();

      socketRef.current?.emit("video-source-start", {
        device: currentSettings.device,
        videoWidth: width,
        videoHeight: height,
        framerate: currentSettings.framerate
      });

      (async () => {
        try {
          while (!abortController.signal.aborted) {
            const { value: frame, done } = await reader.read();
            if (done || abortController.signal.aborted) break;
            const isKey = videoFrameCountRef.current % keyframeInterval === 0;
            encoder.encode(frame, { keyFrame: isKey });
            frame.close();
            videoFrameCountRef.current++;
          }
        } catch (e) {
          if (!abortController.signal.aborted) {
            console.error("[VIDEO] Frame read error:", e);
          }
        } finally {
          reader.cancel();
        }
      })();
    } catch (e: any) {
      console.error("[VIDEO] getUserMedia failed:", e);
      setVideoError("Could not access camera: " + (e.message || e));
    }
  }, [isElectronSource, stopVideoCapture]);

  const videoPreviewCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    videoPreviewRef.current = node;
    if (node && isElectronSource && videoStatusRef.current === "streaming" && videoStreamRef.current) {
      node.srcObject = videoStreamRef.current;
      node.play().catch(() => {});
    }
  }, []); // isElectronSource is a mount-time constant; status/stream accessed via refs

  // Wire getUserMedia stream to the <video> element when videoStatus changes
  useEffect(() => {
    if (isElectronSource && videoStatus === "streaming" && videoPreviewRef.current && videoStreamRef.current) {
      videoPreviewRef.current.srcObject = videoStreamRef.current;
      videoPreviewRef.current.play().catch(() => {});
    }
  }, [videoStatus, isElectronSource]);

  // Auto-start video capture on Electron source after settings load
  useEffect(() => {
    if (
      isElectronSource &&
      settingsLoaded &&
      videoAutoStart &&
      videoSettings.device &&
      videoSettings.framerate &&
      videoSettings.videoWidth > 0 &&
      videoSettings.videoHeight > 0
    ) {
      startVideoCapture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  useEffect(() => {
    if (!socket) return;

    const onSettingsData = (data: any) => {
      if (data.videoSettings) {
        const vs = data.videoSettings;
        if (vs.resolution && !vs.videoWidth) {
          const parts = (vs.resolution as string).split("x");
          vs.videoWidth = parseInt(parts[0]) || 640;
          vs.videoHeight = parseInt(parts[1]) || 480;
        }
        setVideoSettings(prev => ({ ...prev, ...vs }));
        const draft = { width: String(vs.videoWidth || 640), height: String(vs.videoHeight || 480) };
        setResolutionDraft(draft);
        resolutionDraftRef.current = draft;
      }
      if (data.videoAutoStart !== undefined) {
        setVideoAutoStart(data.videoAutoStart);
      }
    };

    const onVideoDevicesList = (list: { id: string; label: string }[]) => {
      setVideoDevices(list);
    };

    const onVideoSourceStatus = (payload: { status: "streaming" | "stopped"; videoWidth?: number; videoHeight?: number; framerate?: string }) => {
      vlog(`[VIDEO] video-source-status received: status=${payload.status} isElectronSource=${isElectronSource} videoWidth=${payload.videoWidth} videoHeight=${payload.videoHeight}`);
      setVideoStatus(payload.status);
      if (payload.status === "streaming") {
        setVideoError(null);
        if (!isElectronSource && payload.videoWidth && payload.videoHeight) {
          videoStreamDimsRef.current = { width: payload.videoWidth!, height: payload.videoHeight! };
          setVideoSettings(prev => ({
            ...prev,
            videoWidth: payload.videoWidth!,
            videoHeight: payload.videoHeight!,
            framerate: payload.framerate ?? prev.framerate
          }));
          initVideoDecoder(payload.videoWidth!, payload.videoHeight!);
        }
      } else {
        if (!isElectronSource && videoDecoderRef.current) {
          try { videoDecoderRef.current.close(); } catch (_) {}
          videoDecoderRef.current = null;
        }
      }
    };

    const onVideoSettingsUpdated = (settings: { device: string; videoWidth: number; videoHeight: number; framerate: string }) => {
      setVideoSettings(prev => ({ ...prev, ...settings }));
      if (!isResolutionFocusedRef.current) {
        const draft = { width: String(settings.videoWidth), height: String(settings.videoHeight) };
        setResolutionDraft(draft);
        resolutionDraftRef.current = draft;
      }
      if (isElectronSource && videoStatusRef.current === "streaming") {
        videoSettingsRef.current = { ...videoSettingsRef.current, ...settings };
        startVideoCapture();
      }
    };

    const onVideoStartRequested = () => {
      if (isElectronSource) startVideoCapture();
    };

    const onVideoStopRequested = () => {
      if (isElectronSource) stopVideoCapture();
    };

    let clientFrameCount = 0;
    const onVideoFrame = (chunk: { data: ArrayBuffer; type: string; timestamp: number; description?: ArrayBuffer }) => {
      if (isElectronSource) return;
      clientFrameCount++;
      const hasDecoder = !!videoDecoderRef.current;
      const decoderState = videoDecoderRef.current?.state ?? "none";
      if (chunk.type === "key" || clientFrameCount <= 5) {
        vlog(`[VIDEO] video-frame received #${clientFrameCount}: type=${chunk.type} dataBytes=${chunk.data?.byteLength ?? "?"} hasDecoder=${hasDecoder} decoderState=${decoderState} hasDescription=${!!chunk.description}`);
      }
      if (chunk.type === "key" && chunk.description) {
        const { width, height } = videoStreamDimsRef.current;
        initVideoDecoder(width, height, chunk.description);
      }
      if (!videoDecoderRef.current) return;
      try {
        videoDecoderRef.current.decode(new EncodedVideoChunk({
          type: chunk.type as "key" | "delta",
          data: chunk.data,
          timestamp: chunk.timestamp
        }));
      } catch (e) {
        console.error(`[VIDEO] decode() threw on frame #${clientFrameCount} type=${chunk.type}:`, e);
      }
    };

    const onVerboseMode = (v: boolean) => { videoVerbose = v; };

    socket.on("settings-data", onSettingsData);
    socket.on("video-devices-list", onVideoDevicesList);
    socket.on("video-source-status", onVideoSourceStatus);
    socket.on("video-settings-updated", onVideoSettingsUpdated);
    socket.on("video-start-requested", onVideoStartRequested);
    socket.on("video-stop-requested", onVideoStopRequested);
    socket.on("video-frame", onVideoFrame);
    socket.on("verbose-mode", onVerboseMode);

    socket.emit("get-video-devices");
    if (isElectronSource) enumerateVideoDevices();

    return () => {
      socket.off("settings-data", onSettingsData);
      socket.off("video-devices-list", onVideoDevicesList);
      socket.off("video-source-status", onVideoSourceStatus);
      socket.off("video-settings-updated", onVideoSettingsUpdated);
      socket.off("video-start-requested", onVideoStartRequested);
      socket.off("video-stop-requested", onVideoStopRequested);
      socket.off("video-frame", onVideoFrame);
      socket.off("verbose-mode", onVerboseMode);
    };
  }, [socket]);

  return {
    videoError, setVideoError,
    videoStatus,
    videoSettings, setVideoSettings,
    videoAutoStart,
    videoDevices,
    isElectronSource,
    isVideoSettingsOpen, setIsVideoSettingsOpen,
    isVideoCollapsed, setIsVideoCollapsed,
    resolutionDraft, setResolutionDraft,
    resolutionDraftRef,
    isResolutionFocusedRef,
    resolutionDebounceRef,
    videoSettingsRef,
    videoCanvasRef,
    videoPreviewCallbackRef,
    enumerateVideoDevices,
    startVideoCapture,
    stopVideoCapture,
  };
}
