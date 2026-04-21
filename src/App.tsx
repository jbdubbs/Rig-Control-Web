import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Activity, 
  Radio, 
  Settings, 
  Power, 
  Mic, 
  Zap, 
  Waves,
  Signal,
  Gauge,
  RefreshCw,
  Download,
  Volume2,
  VolumeX,
  MicOff,
  Monitor,
  Server,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pencil,
  Check,
  AlertCircle,
  AlertTriangle,
  Headphones,
  MapPin
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from "recharts";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface PotaSpot {
  spotId: number;
  spotTime: string;
  activator: string;
  frequency: number;
  mode: string;
  reference: string;
  name: string;
  locationDesc: string;
  spotter: string;
  source: string;
  comments: string;
}

interface SotaSpot {
  id: number;
  activatorCallsign: string;
  frequency: string;
  mode: string;
  associationCode: string;
  summitCode: string;
  timeStamp: string;
}

interface RigStatus {
  frequency: string;
  mode: string;
  bandwidth: string;
  ptt: boolean;
  smeter: number;
  swr: number;
  rfpower: number;
  vfo: string;
  isSplit: boolean;
  txVFO: string;
  rfLevel: number;
  agc: number;
  attenuation: number;
  preamp: number;
  nb: boolean;
  nbLevel: number;
  nr: boolean;
  nrLevel: number;
  anf: boolean;
  tuner: boolean;
  alc: number;
  powerMeter: number;
  vdd: number;
  timestamp: number;
}

const POTA_BANDS: { label: string; min: number; max: number }[] = [
  { label: '6M',   min:  50000, max:  52000 },
  { label: '10M',  min:  29000, max:  30000 },
  { label: '12M',  min:  24000, max:  25000 },
  { label: '15M',  min:  21000, max:  22000 },
  { label: '17M',  min:  18000, max:  19000 },
  { label: '20M',  min:  14000, max:  15000 },
  { label: '30M',  min:  10000, max:  11000 },
  { label: '40M',  min:   7000, max:   8000 },
  { label: '60M',  min:   5000, max:   6000 },
  { label: '80M',  min:   3000, max:   4000 },
  { label: '160M', min:   1000, max:   2000 },
  { label: '144',  min: 144000, max: 148000 },
  { label: '220',  min: 219000, max: 225000 },
  { label: '440',  min: 430000, max: 450000 },
];

const MODES_FALLBACK = [
  "USB", "LSB", "CW", "AM", "FM", "RTTY"
];

const VOICE_MODES = new Set([
  "LSB", "USB", "PKTUSB", "PKTLSB", "AM", "AMN", "FM", "FMN", "FM-D", "PKTFMN"
]);

const BANDWIDTHS = [300, 500, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3200, 3500, 4000];

const VFO_STEPS = [0.00001, 0.0001, 0.001, 0.003, 0.01, 0.1];

const DEFAULT_STATUS: RigStatus = {
  frequency: "14074000",
  mode: "USB",
  bandwidth: "2400",
  ptt: false,
  smeter: -54,
  swr: 1.0,
  rfpower: 0.5,
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
  nrLevel: 0.5,
  anf: false,
  tuner: false,
  alc: 0,
  powerMeter: 0,
  vdd: 13.8,
  timestamp: Date.now()
};

// Verbose logging — set to true when the server was started with -v / --verbose.
// Updated via the 'verbose-mode' socket event on connect.
let clientVerbose = false;
const vlog = (...args: any[]) => { if (clientVerbose) console.log(...args); };

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [vfoSupported, setVfoSupported] = useState(true);
  const [host, setHost] = useState(() => localStorage.getItem("last-host") || "127.0.0.1");
  const [port, setPort] = useState(() => parseInt(localStorage.getItem("last-port") || "4532"));
  const [status, setStatus] = useState<RigStatus>(() => {
    try {
      const saved = localStorage.getItem("last-rig-status");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return DEFAULT_STATUS;
  });
  const [history, setHistory] = useState<any[]>([]);
  const [pollRate, setPollRate] = useState(() => parseInt(localStorage.getItem("last-poll-rate") || "2000"));
  const [vfoA, setVfoA] = useState(() => localStorage.getItem("last-vfoA") || "14074000");
  const [vfoB, setVfoB] = useState(() => localStorage.getItem("last-vfoB") || "7074000");
  const [error, setError] = useState<string | null>(null);
  const [rawCommand, setRawCommand] = useState("");
  const [consoleLogs, setConsoleLogs] = useState<{ cmd: string, resp: string, time: string }[]>([]);
  const [availableModes, setAvailableModes] = useState<string[]>(MODES_FALLBACK);
  const [vfoStep, setVfoStep] = useState(0.001);
  const [inputVfoA, setInputVfoA] = useState("");
  const [inputVfoB, setInputVfoB] = useState("");
  const [localMode, setLocalMode] = useState(() => localStorage.getItem("last-mode") || "USB");
  
  const [localRFPower, setLocalRFPower] = useState(() => parseFloat(localStorage.getItem("last-rfpower") || "0.5"));
  const [localRFLevel, setLocalRFLevel] = useState(0);
  const isDraggingRFLevel = useRef(false);
  const [localNRLevel, setLocalNRLevel] = useState(0);
  const isDraggingNR = useRef(false);
  const [localNBLevel, setLocalNBLevel] = useState(0);
  const isDraggingNB = useRef(false);
  const [nbCapabilities, setNbCapabilities] = useState({ supported: false, range: { min: 0, max: 1, step: 0.1 } });
  const [nrCapabilities, setNrCapabilities] = useState({ supported: false, range: { min: 0, max: 1, step: 0.066667 } });
  const [anfCapabilities, setAnfCapabilities] = useState({ supported: false });
  const [rfPowerCapabilities, setRfPowerCapabilities] = useState({ range: { min: 0, max: 1, step: 0.01 } });
  const [backendUrl, setBackendUrl] = useState(() => {
    const stored = localStorage.getItem("backend-url");
    if (!stored) return window.location.origin;
    try {
      const storedUrl = new URL(stored);
      const currentUrl = new URL(window.location.origin);
      if (storedUrl.hostname === currentUrl.hostname && storedUrl.port === currentUrl.port && storedUrl.protocol !== currentUrl.protocol) {
        console.log(`[INIT] Correcting stale backend-url: ${stored} → ${window.location.origin}`);
        localStorage.setItem("backend-url", window.location.origin);
        return window.location.origin;
      }
    } catch (_) {
      console.warn("[INIT] Invalid backend-url in storage, resetting to current origin.");
      localStorage.setItem("backend-url", window.location.origin);
      return window.location.origin;
    }
    return stored;
  });
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isCompact, setIsCompact] = useState(() => {
    const saved = localStorage.getItem("is-compact");
    return saved === null ? true : saved === "true";
  });
  const [isPhone, setIsPhone] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [phoneMeterTab, setPhoneMeterTab] = useState<'signal' | 'swr' | 'alc'>('signal');
  const [activeMeter, setActiveMeter] = useState<'signal' | 'swr' | 'alc' | 'vdd'>('signal');
  const [activeVFO, setActiveVFO] = useState<'A' | 'B'>('A');
  const [rigctldSettings, setRigctldSettings] = useState({
    rigNumber: "",
    serialPort: "",
    portNumber: "4532",
    ipAddress: "127.0.0.1",
    serialPortSpeed: "38400",
    preampCapabilities: [] as string[],
    attenuatorCapabilities: [] as string[],
    agcCapabilities: [] as string[],
    nbSupported: false,
    nbLevelRange: { min: 0, max: 1, step: 0.1 },
    nrSupported: false,
    nrLevelRange: { min: 0, max: 1, step: 0.1 },
    rfPowerRange: { min: 0, max: 1, step: 0.01 },
    anfSupported: false
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'rigctld' | 'spots'>('rigctld');
  const [potaEnabled, setPotaEnabled] = useState(false);
  const [potaPollRate, setPotaPollRate] = useState(5);
  const [potaMaxAge, setPotaMaxAge] = useState(15);
  const [potaModeFilter, setPotaModeFilter] = useState<'ALL' | 'SSB' | 'CW' | 'FT8' | 'FT4'>('ALL');
  const [potaBandFilter, setPotaBandFilter] = useState<string[]>([]);
  const [potaSpots, setPotaSpots] = useState<PotaSpot[]>([]);
  const [potaSortCol, setPotaSortCol] = useState<string | null>('spotTime');
  const [potaSortDir, setPotaSortDir] = useState<'asc' | 'desc' | 'api'>('desc');
  const [potaSpotsVisible, setPotaSpotsVisible] = useState(false);
  const [activeCompactPowerTab, setActiveCompactPowerTab] = useState<'levels' | 'pota' | 'sota'>('levels');
  const [potaSpotsCollapsed, setPotaSpotsCollapsed] = useState(() => localStorage.getItem("pota-spots-collapsed") === "true");
  const [sotaEnabled, setSotaEnabled] = useState(false);
  const [sotaPollRate, setSotaPollRate] = useState(5);
  const [sotaMaxAge, setSotaMaxAge] = useState(15);
  const [sotaModeFilter, setSotaModeFilter] = useState<'ALL' | 'SSB' | 'CW' | 'FT8' | 'FT4'>('ALL');
  const [sotaBandFilter, setSotaBandFilter] = useState<string[]>([]);
  const [sotaSpots, setSotaSpots] = useState<SotaSpot[]>([]);
  const [sotaSortCol, setSotaSortCol] = useState<string | null>('timeStamp');
  const [sotaSortDir, setSotaSortDir] = useState<'asc' | 'desc' | 'api'>('desc');
  const [sotaSpotsVisible, setSotaSpotsVisible] = useState(false);
  const [sotaSpotsCollapsed, setSotaSpotsCollapsed] = useState(() => localStorage.getItem("sota-spots-collapsed") === "true");
  const [radios, setRadios] = useState<{id: string, mfg: string, model: string}[]>([]);
  const [rigctldProcessStatus, setRigctldProcessStatus] = useState<"running" | "stopped" | "error" | "already_running">("stopped");
  const [videoStatus, setVideoStatus] = useState<"streaming" | "stopped">("stopped");
  const [videoSettings, setVideoSettings] = useState({
    device: "",
    videoWidth: 640,
    videoHeight: 480,
    framerate: ""
  });
  const [videoAutoStart, setVideoAutoStart] = useState(false);
  const [videoDevices, setVideoDevices] = useState<{ id: string; label: string }[]>([]);
  const isElectronSource = !!(window as any).electron;

  const [activeMicClientId, setActiveMicClientId] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<"playing" | "stopped">("stopped");
  const [audioEngineState, setAudioEngineState] = useState<{ isReady: boolean, error: string | null }>({ isReady: false, error: null });
  const [audioDevices, setAudioDevices] = useState<{ inputs: { name: string, altName: string, hostAPIName: string, defaultSampleRate: number }[], outputs: { name: string, altName: string, hostAPIName: string, defaultSampleRate: number }[] }>({ inputs: [], outputs: [] });
  const [audioSettings, setAudioSettings] = useState({
    inputDevice: "",
    outputDevice: "",
    inboundEnabled: false,
    outboundEnabled: false
  });
  const [localAudioDevices, setLocalAudioDevices] = useState<{ inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });
  const [localAudioSettings, setLocalAudioSettings] = useState({
    inputDevice: localStorage.getItem("local-audio-input") || "default",
    outputDevice: localStorage.getItem("local-audio-output") || "default"
  });
  const [inboundMuted, setInboundMuted] = useState(false);
  const [outboundMuted, setOutboundMuted] = useState(true);
  const [localAudioReady, setLocalAudioReady] = useState(false);
  const [audioWasRestarted, setAudioWasRestarted] = useState(false);
  const [isBackendEngineCollapsed, setIsBackendEngineCollapsed] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const opusDecoderRef = useRef<any>(null); // AudioDecoder
  const opusEncoderRef = useRef<any>(null); // AudioEncoder
  const micStreamRef = useRef<MediaStream | null>(null);

  const [isVideoSettingsOpen, setIsVideoSettingsOpen] = useState(false);
  const [preampLevels, setPreampLevels] = useState<string[]>([]);
  const [attenuatorLevels, setAttenuatorLevels] = useState<string[]>([]);
  const [agcLevels, setAgcLevels] = useState<string[]>([]);
  const [rigctldLogs, setRigctldLogs] = useState<string[]>([]);
  const [rigctldVersionInfo, setRigctldVersionInfo] = useState<{ version: string | null, isSupported: boolean }>({ version: null, isSupported: true });
  const logEndRef = useRef<HTMLDivElement>(null);
  const potaSpotsBoxRef = useRef<HTMLDivElement>(null);
  const sotaSpotsBoxRef = useRef<HTMLDivElement>(null);
  const [testResult, setTestResult] = useState<{ success: boolean, message: string } | null>(null);
  const [isVideoCollapsed, setIsVideoCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [pendingVfoOp, setPendingVfoOp] = useState<string | null>(null);
  const [isTuning, setIsTuning] = useState(false);
  const [tuneJustFinished, setTuneJustFinished] = useState(false);
  const tuningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tuneSeenPTTRef = useRef(false);
  const tuneJustFinishedRef = useRef(false);
  const [isPhoneVFOCollapsed, setIsPhoneVFOCollapsed] = useState(true);
  const [isPhoneMeterCollapsed, setIsPhoneMeterCollapsed] = useState(true);
  const [isPhoneQuickControlsCollapsed, setIsPhoneQuickControlsCollapsed] = useState(true);
  const [isCompactSMeterCollapsed, setIsCompactSMeterCollapsed] = useState(() => localStorage.getItem("is-compact-smeter-collapsed") === "true");
  const [isCompactOtherMeterCollapsed, setIsCompactOtherMeterCollapsed] = useState(() => localStorage.getItem("is-compact-other-meter-collapsed") === "true");
  const [isCompactControlsCollapsed, setIsCompactControlsCollapsed] = useState(() => localStorage.getItem("is-compact-controls-collapsed") === "true");
  const [isCompactRFPowerCollapsed, setIsCompactRFPowerCollapsed] = useState(() => localStorage.getItem("is-compact-rfpower-collapsed") === "true");
  const [isDesktopControlsCollapsed, setIsDesktopControlsCollapsed] = useState(() => localStorage.getItem("is-desktop-controls-collapsed") === "true");
  const [isDesktopModeCollapsed, setIsDesktopModeCollapsed] = useState(false);
  const [isDesktopBwCollapsed, setIsDesktopBwCollapsed] = useState(false);
  const [isDesktopRFPowerCollapsed, setIsDesktopRFPowerCollapsed] = useState(false);
  const [isDesktopSMeterCollapsed, setIsDesktopSMeterCollapsed] = useState(false);
  const [isDesktopSWRCollapsed, setIsDesktopSWRCollapsed] = useState(false);
  const [isDesktopALCCollapsed, setIsDesktopALCCollapsed] = useState(false);
  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(false);
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
  const [resolutionDraft, setResolutionDraft] = useState({ width: "640", height: "480" });
  const resolutionDraftRef = useRef({ width: "640", height: "480" });
  const isResolutionFocusedRef = useRef(false);
  const resolutionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAttemptedAutoconnect = useRef(false);
  const isAutoconnectAttempt = useRef(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!isCompact || isPhone || !(window as any).electron) return;

    const snap = () => {
      if (containerRef.current) {
        const height = containerRef.current.offsetHeight;
        const width = window.innerWidth;
        const padding = isCompact ? 16 : 64; // p-2 is 8px, so 16px total
        let targetHeight = height + padding;

        if (isPhone) {
          // In phone view, cap height at screen resolution
          const screenHeight = window.screen.availHeight;
          if (targetHeight > screenHeight) {
            targetHeight = screenHeight;
          }
        }

        (window as any).electron.resizeWindow(width, targetHeight);
      }
    };

    const observer = new ResizeObserver(snap);

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', snap);

    if (isCompact) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', snap);
      document.body.style.overflow = 'auto';
    };
  }, [isCompact, isPhone]);

  useEffect(() => {
    if (!navigator.mediaDevices) {
      console.warn("navigator.mediaDevices is not available. Audio device selection will be disabled.");
      return;
    }
    const getLocalDevices = async () => {
      try {
        // Request permission first to get device labels if not already granted
        // We do this quietly by just checking if we can get a stream
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
        } catch (permErr) {
          // If permission is denied, we still want to enumerate devices (though labels will be empty)
          console.warn("Microphone permission not yet granted or denied:", permErr);
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(d => d.kind === 'audioinput');
        const outputs = devices.filter(d => d.kind === 'audiooutput');
        setLocalAudioDevices({ inputs, outputs });
      } catch (err) {
        console.error("Error enumerating local audio devices:", err);
      }
    };
    getLocalDevices();
    navigator.mediaDevices.addEventListener('devicechange', getLocalDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', getLocalDevices);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const mobile = width < 768;
      const compact = width >= 768 && width < 1280;
      
      setIsPhone(mobile);
      if (mobile || compact) {
        setIsCompact(true);
      } else {
        setIsCompact(false);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (socket) {
      socket.on("settings-data", (data: any) => {
        vlog("[SOCKET] Received settings-data", data);
        if (data.settings) {
          setRigctldSettings(data.settings);
          if (data.settings.preampCapabilities) {
            setPreampLevels(data.settings.preampCapabilities);
          }
          if (data.settings.attenuatorCapabilities) {
            setAttenuatorLevels(data.settings.attenuatorCapabilities);
          }
          if (data.settings.agcCapabilities) {
            setAgcLevels(data.settings.agcCapabilities);
          }
          if (data.settings.rfPowerRange) {
            setRfPowerCapabilities({ range: data.settings.rfPowerRange });
          }
        }
        if (data.isConnected !== undefined) {
          setConnected(data.isConnected);
        }
        setSettingsLoaded(true);
        if (data.videoSettings) {
          const vs = data.videoSettings;
          // Migrate old 'resolution' string to discrete width/height fields
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
        if (data.audioSettings) {
          setAudioSettings(data.audioSettings);
        }
        if (data.pollRate) {
          setPollRate(data.pollRate);
        }
        if (data.clientHost) {
          setHost(data.clientHost);
        }
        if (data.clientPort) {
          setPort(data.clientPort);
        }
        if (data.potaSettings) {
          if (data.potaSettings.enabled !== undefined) setPotaEnabled(data.potaSettings.enabled);
          if (data.potaSettings.pollRate !== undefined) setPotaPollRate(data.potaSettings.pollRate);
          if (data.potaSettings.maxAge !== undefined) setPotaMaxAge(data.potaSettings.maxAge);
          if (data.potaSettings.modeFilter !== undefined) setPotaModeFilter(data.potaSettings.modeFilter);
          if (Array.isArray(data.potaSettings.bandFilter)) setPotaBandFilter(data.potaSettings.bandFilter);
        }
        if (data.sotaSettings) {
          if (data.sotaSettings.enabled !== undefined) setSotaEnabled(data.sotaSettings.enabled);
          if (data.sotaSettings.pollRate !== undefined) setSotaPollRate(data.sotaSettings.pollRate);
          if (data.sotaSettings.maxAge !== undefined) setSotaMaxAge(data.sotaSettings.maxAge);
          if (data.sotaSettings.modeFilter !== undefined) setSotaModeFilter(data.sotaSettings.modeFilter);
          if (Array.isArray(data.sotaSettings.bandFilter)) setSotaBandFilter(data.sotaSettings.bandFilter);
        }

        // Handle autoconnect
        const isAlreadyConnected = data.isConnected === true || connectedRef.current;
        if (data.autoStart && !isAlreadyConnected && !hasAttemptedAutoconnect.current) {
          const isEligible = data.autoconnectEligible === true;
          if (isEligible) {
            hasAttemptedAutoconnect.current = true;
            isAutoconnectAttempt.current = true;
            const savedHost = data.clientHost || "127.0.0.1";
            const savedPort = data.clientPort || 4532;
            vlog(`[AUTOCONNECT] Attempting connection to ${savedHost}:${savedPort}`);
            socket.emit("connect-rig", { 
              host: savedHost, 
              port: savedPort
            });
          } else {
            vlog("[AUTOCONNECT] Not eligible for autoconnect");
          }
        }
      });
      socket.on("video-devices-list", (list: { id: string; label: string }[]) => {
        setVideoDevices(list);
      });
      socket.on("video-source-status", (payload: { status: "streaming" | "stopped"; videoWidth?: number; videoHeight?: number; framerate?: string }) => {
        vlog(`[VIDEO] video-source-status received: status=${payload.status} isElectronSource=${isElectronSource} videoWidth=${payload.videoWidth} videoHeight=${payload.videoHeight}`);
        setVideoStatus(payload.status);
        if (payload.status === "streaming") {
          setVideoError(null);
          if (!isElectronSource && payload.videoWidth && payload.videoHeight) {
            // Store dims in a ref so the video-frame handler can access them from
            // its stale closure when it needs to re-configure the decoder.
            videoStreamDimsRef.current = { width: payload.videoWidth!, height: payload.videoHeight! };
            setVideoSettings(prev => ({
              ...prev,
              videoWidth: payload.videoWidth!,
              videoHeight: payload.videoHeight!,
              framerate: payload.framerate ?? prev.framerate
            }));
            // Decoder will be fully configured once the first keyframe arrives with its
            // AVCC description. Calling initVideoDecoder here without description creates
            // the decoder object early so it's ready to receive that first frame.
            initVideoDecoder(payload.videoWidth!, payload.videoHeight!);
          }
        } else {
          if (!isElectronSource && videoDecoderRef.current) {
            try { videoDecoderRef.current.close(); } catch (_) {}
            videoDecoderRef.current = null;
          }
        }
      });
      socket.on("video-settings-updated", (settings: { device: string; videoWidth: number; videoHeight: number; framerate: string }) => {
        setVideoSettings(prev => ({ ...prev, ...settings }));
        // Only update the draft text if the user isn't currently editing the resolution
        // fields — otherwise we'd clobber mid-edit input.
        if (!isResolutionFocusedRef.current) {
          const draft = { width: String(settings.videoWidth), height: String(settings.videoHeight) };
          setResolutionDraft(draft);
          resolutionDraftRef.current = draft;
        }
        // If this client is the Electron source and currently streaming, restart capture
        // with the new settings. Use the ref so we get the latest values without a stale closure.
        if (isElectronSource && videoStatusRef.current === "streaming") {
          // Merge into the ref immediately so startVideoCapture picks them up
          videoSettingsRef.current = { ...videoSettingsRef.current, ...settings };
          startVideoCapture();
        }
      });
      socket.on("video-start-requested", () => {
        if (isElectronSource) startVideoCapture();
      });
      socket.on("video-stop-requested", () => {
        if (isElectronSource) stopVideoCapture();
      });
      let clientFrameCount = 0;
      socket.on("video-frame", (chunk: { data: ArrayBuffer; type: string; timestamp: number; description?: ArrayBuffer }) => {
        if (isElectronSource) return;
        clientFrameCount++;
        const hasDecoder = !!videoDecoderRef.current;
        const decoderState = videoDecoderRef.current?.state ?? "none";
        if (chunk.type === "key" || clientFrameCount <= 5) {
          vlog(`[VIDEO] video-frame received #${clientFrameCount}: type=${chunk.type} dataBytes=${chunk.data?.byteLength ?? "?"} hasDecoder=${hasDecoder} decoderState=${decoderState} hasDescription=${!!chunk.description}`);
        }
        // Keyframes carry the AVCC description (SPS/PPS). Re-configure the decoder with
        // it so AVCC-formatted frames can be decoded. This handles both initial setup and
        // any future encoder reconfiguration.
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
      });
      socket.on("audio-status", (status: "playing" | "stopped") => {
        setAudioStatus(status);
        if (status === "stopped") {
          if (localAudioReadyRef.current) {
            setAudioWasRestarted(true);
          }
          // Full pipeline teardown — client must re-join to participate
          if (opusEncoderRef.current) { try { opusEncoderRef.current.close(); } catch (_) {} opusEncoderRef.current = null; }
          if (opusDecoderRef.current) { try { opusDecoderRef.current.close(); } catch (_) {} opusDecoderRef.current = null; }
          if (playbackNodeRef.current) { playbackNodeRef.current.disconnect(); playbackNodeRef.current = null; }
          if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
          setLocalAudioReady(false);
        }
      });
      socket.on("audio-engine-state", (state: { isReady: boolean, error: string | null }) => {
        setAudioEngineState(state);
      });
      socket.on("mic-active-client", (id: string | null) => {
        setActiveMicClientId(id);
      });
      socket.on("mic-mute-forced", () => {
        setOutboundMuted(true);
      });
      socket.on("verbose-mode", (v: boolean) => { clientVerbose = v; });
      socket.on("audio-devices-list", (devices: { inputs: { name: string, altName: string, hostAPIName: string, defaultSampleRate: number }[], outputs: { name: string, altName: string, hostAPIName: string, defaultSampleRate: number }[] }) => {
        setAudioDevices(devices);
      });
      socket.on("radios-list", (list: any) => {
        const unique = Array.from(new Map(list.map((r: any) => [r.id, r])).values()) as any[];
        setRadios(unique);
      });
      socket.on("rigctld-status", (data: any) => {
        if (typeof data === 'string') {
          setRigctldProcessStatus(data as any);
        } else {
          setRigctldProcessStatus(data.status);
          if (data.logs) setRigctldLogs(data.logs);
          setRigctldVersionInfo({ version: data.version, isSupported: data.isVersionSupported });
        }
        setStatusLoaded(true);
      });
      socket.on("rigctld-log", (lines: string[]) => {
        setRigctldLogs(prev => [...prev, ...lines].slice(-100));
      });
      socket.on("test-result", (result: { success: boolean, message: string }) => {
        setTestResult(result);
        setTimeout(() => setTestResult(null), 5000);
      });
      socket.on("preamp-capabilities", (levels: string[]) => {
        setPreampLevels(levels);
        setRigctldSettings(prev => ({ ...prev, preampCapabilities: levels }));
      });
      socket.on("attenuator-capabilities", (levels: string[]) => {
        setAttenuatorLevels(levels);
        setRigctldSettings(prev => ({ ...prev, attenuatorCapabilities: levels }));
      });
      socket.on("agc-capabilities", (levels: string[]) => {
        setAgcLevels(levels);
        setRigctldSettings(prev => ({ ...prev, agcCapabilities: levels }));
      });
      socket.on("nb-capabilities", (data: { supported: boolean, range: { min: number, max: number, step: number } }) => {
        setNbCapabilities(data);
        setRigctldSettings(prev => ({ ...prev, nbSupported: data.supported, nbLevelRange: data.range }));
      });
      socket.on("nr-capabilities", (data: { supported: boolean, range: { min: number, max: number, step: number } }) => {
        setNrCapabilities(data);
        setRigctldSettings(prev => ({ ...prev, nrSupported: data.supported, nrLevelRange: data.range }));
      });
      socket.on("anf-capabilities", (data: { supported: boolean }) => {
        setAnfCapabilities(data);
        setRigctldSettings(prev => ({ ...prev, anfSupported: data.supported }));
      });
      socket.on("rfpower-capabilities", (data: { range: { min: number, max: number, step: number } }) => {
        setRfPowerCapabilities(data);
        setRigctldSettings(prev => ({ ...prev, rfPowerRange: data.range }));
      });
      socket.emit("get-settings");
      socket.emit("get-radios");
      socket.emit("get-video-devices");
      if (isElectronSource) enumerateVideoDevices();
    }
  }, [socket]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [rigctldLogs]);

  const isSettingsValid = () => {
    return (
      rigctldSettings.rigNumber &&
      rigctldSettings.serialPort &&
      rigctldSettings.portNumber &&
      rigctldSettings.ipAddress &&
      rigctldSettings.serialPortSpeed
    );
  };

  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      socket?.emit("save-settings", {
        settings: rigctldSettings,
        pollRate,
        clientHost: host,
        clientPort: port,
        potaSettings: { enabled: potaEnabled, pollRate: potaPollRate, maxAge: potaMaxAge, modeFilter: potaModeFilter, bandFilter: potaBandFilter },
        sotaSettings: { enabled: sotaEnabled, pollRate: sotaPollRate, maxAge: sotaMaxAge, modeFilter: sotaModeFilter, bandFilter: sotaBandFilter }
      });
      localStorage.setItem("last-poll-rate", pollRate.toString());
      localStorage.setItem("last-host", host);
      localStorage.setItem("last-port", port.toString());
    }, 1000);
    return () => clearTimeout(timer);
  }, [rigctldSettings, host, port, pollRate, socket, potaEnabled, potaPollRate, potaMaxAge, potaModeFilter, potaBandFilter, sotaEnabled, sotaPollRate, sotaMaxAge, sotaModeFilter, sotaBandFilter]);

  useEffect(() => {
    if (!potaEnabled) setActiveCompactPowerTab('levels');
  }, [potaEnabled]);

  useEffect(() => {
    if (!potaEnabled) {
      setPotaSpots([]);
      return;
    }
    const fetchSpots = async () => {
      try {
        const res = await fetch("https://api.pota.app/spot/");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setPotaSpots(data);
        }
      } catch {
        // network error — silently ignore
      }
    };
    fetchSpots();
    const interval = setInterval(fetchSpots, potaPollRate * 60 * 1000);
    return () => clearInterval(interval);
  }, [potaEnabled, potaPollRate]);

  useEffect(() => {
    const el = potaSpotsBoxRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPotaSpotsVisible(entry.isIntersecting),
      { threshold: 0, root: containerRef.current }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [potaEnabled, isPhone]);

  useEffect(() => {
    if (!sotaEnabled) setActiveCompactPowerTab(prev => prev === 'sota' ? 'levels' : prev);
  }, [sotaEnabled]);

  // SOTA spotting is fully functional. Polls api2.sota.org.uk/api/spots/-1/all (public, no auth).
  useEffect(() => {
    if (!sotaEnabled) {
      setSotaSpots([]);
      return;
    }
    const fetchSotaSpots = async () => {
      try {
        const res = await fetch("https://api2.sota.org.uk/api/spots/-1/all");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setSotaSpots(data);
        }
      } catch {
        // network error — silently ignore
      }
    };
    fetchSotaSpots();
    const interval = setInterval(fetchSotaSpots, sotaPollRate * 60 * 1000);
    return () => clearInterval(interval);
  }, [sotaEnabled, sotaPollRate]);

  useEffect(() => {
    const el = sotaSpotsBoxRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setSotaSpotsVisible(entry.isIntersecting),
      { threshold: 0, root: containerRef.current }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sotaEnabled, isPhone]);

  const isDraggingRF = useRef(false);
  const isChangingMode = useRef(false);
  const targetModeRef = useRef("");
  const modeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const skipPollsCount = useRef(0);
  const pttRef = useRef(false);

  useEffect(() => {
    if (status) {
      localStorage.setItem("last-rig-status", JSON.stringify(status));
      pttRef.current = status.ptt;
    }
  }, [status]);

  useEffect(() => {
    localStorage.setItem("last-vfoA", vfoA);
  }, [vfoA]);

  useEffect(() => {
    localStorage.setItem("last-vfoB", vfoB);
  }, [vfoB]);

  useEffect(() => {
    localStorage.setItem("last-mode", localMode);
  }, [localMode]);

  useEffect(() => {
    localStorage.setItem("last-rfpower", (localRFPower ?? 0.5).toString());
  }, [localRFPower]);

  useEffect(() => {
    localStorage.setItem("backend-url", backendUrl);
  }, [backendUrl]);

  // Auto-start video capture on the Electron source if settings were previously saved
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

  // Wire the getUserMedia stream to the <video> element.
  // Two cases require wiring:
  //   1. Stream becomes active while the current view's <video> node is already mounted
  //      (videoStatus transitions to "streaming") — handled by the useEffect below.
  //   2. The view switches (compact ↔ phone ↔ desktop) while streaming, unmounting the
  //      old <video> node and mounting a new blank one — handled by the callback ref,
  //      which fires whenever the DOM node identity changes.
  const videoPreviewCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    videoPreviewRef.current = node;
    if (node && isElectronSource && videoStatusRef.current === "streaming" && videoStreamRef.current) {
      node.srcObject = videoStreamRef.current;
      node.play().catch(() => {});
    }
  }, []); // isElectronSource is a mount-time constant; status/stream accessed via refs

  useEffect(() => {
    if (isElectronSource && videoStatus === "streaming" && videoPreviewRef.current && videoStreamRef.current) {
      videoPreviewRef.current.srcObject = videoStreamRef.current;
      videoPreviewRef.current.play().catch(() => {});
    }
  }, [videoStatus, isElectronSource]);

  // Keep refs in sync so socket handlers (registered once at mount) always see current values.
  const videoStatusRef = useRef(videoStatus);
  useEffect(() => { videoStatusRef.current = videoStatus; }, [videoStatus]);
  useEffect(() => { videoSettingsRef.current = videoSettings; }, [videoSettings]);
  useEffect(() => { videoDevicesRef.current = videoDevices; }, [videoDevices]);

  useEffect(() => {
    localStorage.setItem("is-compact", isCompact.toString());
    localStorage.setItem("is-compact-smeter-collapsed", isCompactSMeterCollapsed.toString());
    localStorage.setItem("is-compact-other-meter-collapsed", isCompactOtherMeterCollapsed.toString());
    localStorage.setItem("is-compact-controls-collapsed", isCompactControlsCollapsed.toString());
    localStorage.setItem("is-compact-rfpower-collapsed", isCompactRFPowerCollapsed.toString());
    localStorage.setItem("is-desktop-controls-collapsed", isDesktopControlsCollapsed.toString());
    localStorage.setItem("pota-spots-collapsed", potaSpotsCollapsed.toString());
    localStorage.setItem("sota-spots-collapsed", sotaSpotsCollapsed.toString());
  }, [isCompact, isCompactSMeterCollapsed, isCompactOtherMeterCollapsed, isCompactControlsCollapsed, isCompactRFPowerCollapsed, isDesktopControlsCollapsed, potaSpotsCollapsed, sotaSpotsCollapsed]);

  useEffect(() => {
    if (!socket) return;
    const visible = [];
    const isPtt = status?.ptt || false;
    if (isCompact) {
      if (activeMeter === 'swr' && isPtt) visible.push('swr');
      if (activeMeter === 'alc' && isPtt) visible.push('alc');
      if (activeMeter === 'vdd') visible.push('vdd');
    } else {
      if (isPtt) {
        visible.push('swr', 'alc', 'vdd');
      }
    }
    socket.emit("set-visible-meters", visible);
  }, [socket, isCompact, activeMeter, status?.ptt]);

  const findClosestDNRValue = (val: number) => {
    if (!nrCapabilities.range.step) return val;
    const steps = Math.round((val - nrCapabilities.range.min) / nrCapabilities.range.step);
    const calculated = nrCapabilities.range.min + (steps * nrCapabilities.range.step);
    return Math.min(nrCapabilities.range.max, calculated);
  };

  const clientId = useMemo(() => {
    let id = localStorage.getItem("client-id");
    if (!id) {
      id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("client-id", id);
    }
    return id;
  }, []);

  useEffect(() => {
    const newSocket = io(backendUrl, { 
      transports: ['websocket'],
      auth: { clientId }
    });
    setSocket(newSocket);

    newSocket.on("rig-connected", ({ vfoSupported: vfoSup }: { vfoSupported?: boolean } = {}) => {
      console.log("[RIG] Connected successfully, vfoSupported:", vfoSup !== false);
      setConnected(true);
      setVfoSupported(vfoSup !== false);
      setError(null);
      newSocket.emit("set-autoconnect-eligible", true);
      isAutoconnectAttempt.current = false;
      newSocket.emit("get-modes");
    });
    newSocket.on("available-modes", (modes: string[]) => {
      setAvailableModes(modes);
    });
    newSocket.on("rig-disconnected", () => {
      console.log("[RIG] Disconnected");
      setConnected(false);
      setVfoSupported(true);
      if (isAutoconnectAttempt.current) {
        newSocket.emit("set-autoconnect-eligible", false);
        isAutoconnectAttempt.current = false;
      }
    });
    newSocket.on("rig-error", (msg: string) => {
      console.log("[RIG] Error:", msg);
      setError(msg);
      setConnected(false);
      if (isAutoconnectAttempt.current) {
        newSocket.emit("set-autoconnect-eligible", false);
        isAutoconnectAttempt.current = false;
      }
    });
    newSocket.on("raw-response", (data: { cmd: string, resp: string }) => {
      setConsoleLogs(prev => [{ cmd: data.cmd, resp: data.resp, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));
    });
    newSocket.on("rig-status", (newStatus: RigStatus) => {
      if (!newStatus) return;

      setPendingVfoOp(null);

      // Snapshot tuneJustFinishedRef at the start of this handler so the cleanup
      // branch cannot fire in the same poll that sets it.
      const wasJustFinished = tuneJustFinishedRef.current;

      // Tune cycle state machine — watches PTT to determine cycle start/end.
      // All checks use refs to avoid stale closure values.
      if (tuningTimeoutRef.current !== null) {
        if (newStatus.ptt) {
          // PTT engaged — radio is actively tuning
          tuneSeenPTTRef.current = true;
        } else if (tuneSeenPTTRef.current) {
          // PTT released after having been engaged — cycle is done
          setIsTuning(false);
          tuneJustFinishedRef.current = true;
          setTuneJustFinished(true); // optimistic: hold green for one full poll cycle
          tuneSeenPTTRef.current = false;
          clearTimeout(tuningTimeoutRef.current);
          tuningTimeoutRef.current = null;
        }
        // If !ptt && !tuneSeenPTTRef: PTT hasn't engaged yet — keep spinner
      } else if (wasJustFinished) {
        // First poll AFTER the cycle-end poll — now trust status.tuner for final color
        tuneJustFinishedRef.current = false;
        setTuneJustFinished(false);
      }
      
      // Skip polls after a user change to allow rig to stabilize
      if (skipPollsCount.current > 0) {
        skipPollsCount.current--;
        return;
      }
      
      // Sanitize SWR: minimum value is 1.0
      newStatus.swr = Math.max(1, newStatus.swr ?? 1);
      
      // Sanitize S-Meter: range is -54 (S0) to +60 (S9+60)
      newStatus.smeter = Math.max(-54, Math.min(60, newStatus.smeter ?? -54));
      
      setStatus(prev => {
        const updated = { ...prev, ...newStatus };
        if (!updated.ptt) {
          updated.swr = 1.0;
          updated.alc = 0;
        }
        return updated;
      });

      if (!isDraggingRF.current && newStatus.rfpower !== undefined && newStatus.rfpower !== null) {
        setLocalRFPower(newStatus.rfpower);
      }
      if (!isDraggingRFLevel.current && newStatus.rfLevel !== undefined && newStatus.rfLevel !== null) {
        setLocalRFLevel(newStatus.rfLevel);
      }
      if (newStatus.agc !== undefined && newStatus.agc !== null) {
        setStatus(prev => ({ ...prev, agc: newStatus.agc }));
      }
      if (!isDraggingNR.current && newStatus.nrLevel !== undefined && newStatus.nrLevel !== null) {
        setLocalNRLevel(findClosestDNRValue(newStatus.nrLevel));
      }
      if (!isDraggingNB.current && newStatus.nbLevel !== undefined && newStatus.nbLevel !== null) {
        setLocalNBLevel(newStatus.nbLevel);
      }
      if (!isChangingMode.current && newStatus.mode) {
        setLocalMode(newStatus.mode);
      } else if (newStatus.mode === targetModeRef.current) {
        isChangingMode.current = false;
        if (modeTimeoutRef.current) clearTimeout(modeTimeoutRef.current);
      }
      if (newStatus.vfo === "VFOA" && newStatus.frequency) setVfoA(newStatus.frequency);
      if (newStatus.vfo === "VFOB" && newStatus.frequency) setVfoB(newStatus.frequency);
      
      setHistory(prev => {
        const currentPtt = newStatus.ptt !== undefined ? newStatus.ptt : pttRef.current;
        const next = [...prev, { 
          time: new Date(newStatus.timestamp || Date.now()).toLocaleTimeString(),
          smeter: newStatus.smeter,
          smeterGraph: Math.min(0, newStatus.smeter ?? -54),
          swr: currentPtt ? (newStatus.swr ?? 1.0) : 1.0,
          swrGraph: Math.min(4, Math.max(1, currentPtt ? (newStatus.swr ?? 1.0) : 1.0)),
          alc: currentPtt ? (newStatus.alc ?? 0) : 0,
          powerMeter: newStatus.powerMeter,
          vdd: newStatus.vdd
        }];
        return next.slice(-30); // Keep last 30 points
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isDraggingRF.current) return;
    
    const timer = setTimeout(() => {
      handleSetLevel("RFPOWER", localRFPower);
      isDraggingRF.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [localRFPower]);

  useEffect(() => {
    if (!isDraggingRFLevel.current) return;
    const timer = setTimeout(() => {
      handleSetLevel("RF", localRFLevel);
      isDraggingRFLevel.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [localRFLevel]);

  useEffect(() => {
    if (!isDraggingNR.current) return;
    const timer = setTimeout(() => {
      handleSetLevel("NR", localNRLevel);
      isDraggingNR.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [localNRLevel]);

  useEffect(() => {
    if (!isDraggingNB.current) return;
    const timer = setTimeout(() => {
      handleSetLevel("NB", localNBLevel);
      isDraggingNB.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [localNBLevel]);

  useEffect(() => {
    if (document.activeElement?.id !== "vfoA-input") {
      setInputVfoA((parseFloat(vfoA) / 1000000).toFixed(6));
    }
  }, [vfoA]);

  useEffect(() => {
    if (document.activeElement?.id !== "vfoB-input") {
      setInputVfoB((parseFloat(vfoB) / 1000000).toFixed(6));
    }
  }, [vfoB]);

  const handleConnect = () => {
    if (connected) {
      socket?.emit("set-autoconnect-eligible", false);
      socket?.emit("disconnect-rig");
    } else {
      socket?.emit("set-client-config", { host, port });
      isAutoconnectAttempt.current = false;
      socket?.emit("connect-rig", { host, port });
    }
  };

  const handleSetFreq = (freq: string) => {
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freq }));
    if (status.vfo === "VFOA") setVfoA(freq);
    else setVfoB(freq);
    socket?.emit("set-frequency", freq);
  };

  const adjustVfoFrequency = (targetVfo: 'A' | 'B', direction: 1 | -1) => {
    if (!connected) return;
    const currentFreq = targetVfo === 'A' ? parseInt(vfoA) : parseInt(vfoB);
    const stepHz = Math.round(vfoStep * 1000000);
    const newFreq = currentFreq + (direction * stepHz);
    const newFreqStr = newFreq.toString();

    if (targetVfo === 'A') {
      setVfoA(newFreqStr);
      setInputVfoA((newFreq / 1000000).toFixed(6));
    } else {
      setVfoB(newFreqStr);
      setInputVfoB((newFreq / 1000000).toFixed(6));
    }

    if (status.vfo === (targetVfo === 'A' ? 'VFOA' : 'VFOB')) {
      handleSetFreq(newFreqStr);
    } else {
      handleSetVFO(targetVfo === 'A' ? 'VFOA' : 'VFOB');
      setTimeout(() => {
        handleSetFreq(newFreqStr);
      }, 100);
    }
  };

  const handleSetMode = (mode: string) => {
    skipPollsCount.current = 1;
    setLocalMode(mode);
    setStatus(prev => ({ ...prev, mode }));
    targetModeRef.current = mode;
    isChangingMode.current = true;
    socket?.emit("set-mode", { mode, bandwidth: "-1" });
    
    if (modeTimeoutRef.current) clearTimeout(modeTimeoutRef.current);
    modeTimeoutRef.current = setTimeout(() => {
      isChangingMode.current = false;
    }, 5000);
  };

  const handleSetBw = (bw: number) => {
    const currentMode = (status?.mode) || availableModes[0] || "USB";
    const bwStr = (bw ?? 2400).toString();
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), bandwidth: bwStr }));
    socket?.emit("set-mode", { mode: currentMode, bandwidth: bwStr });
  };

  const handleSetPTT = (state: boolean) => {
    // Auto-claim the mic on PTT press in voice modes if the client is joined but muted
    if (state && localAudioReady && outboundMuted && VOICE_MODES.has(status?.mode || "")) {
      setOutboundMuted(false);
      socket?.emit("mic-unmute-request");
    }
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), ptt: state }));
    socket?.emit("set-ptt", state);
  };

  const handleSetVFO = (vfo: string) => {
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), vfo }));
    socket?.emit("set-vfo", vfo);
  };

  const handleToggleSplit = () => {
    if (status.isSplit) {
      const targetVFO = status.txVFO === "VFOA" ? "VFOB" : "VFOA";
      skipPollsCount.current = 1;
      setStatus(prev => ({ ...prev, isSplit: false }));
      socket?.emit("set-split-vfo", { split: 0, txVFO: status.txVFO });
      handleSetVFO(targetVFO);
    } else {
      const txVFO = status.vfo === "VFOA" ? "VFOB" : "VFOA";
      skipPollsCount.current = 1;
      setStatus(prev => ({ ...prev, isSplit: true, txVFO }));
      socket?.emit("set-split-vfo", { split: 1, txVFO });
    }
  };

  const handlePollRateChange = (rate: number) => {
    setPollRate(rate);
    socket?.emit("set-poll-rate", rate);
  };

  const handleSetFunc = (func: string, state: boolean) => {
    const key = func.toLowerCase() as keyof RigStatus;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), [key]: state }));
    socket?.emit("set-func", { func, state });
  };

  const handleSetLevel = (level: string, val: number) => {
    const key = level.toLowerCase() === "rfpower" ? "rfpower" : 
                level.toLowerCase() === "rf" ? "rfLevel" :
                level.toLowerCase() === "agc" ? "agc" :
                level.toLowerCase() === "att" ? "attenuation" :
                level.toLowerCase() === "preamp" ? "preamp" :
                level.toLowerCase() === "nr" ? "nrLevel" :
                level.toLowerCase() === "nb" ? "nbLevel" : null;
    if (key) {
      skipPollsCount.current = 1;
      setStatus(prev => ({ ...(prev || DEFAULT_STATUS), [key]: val }));
    }
    socket?.emit("set-level", { level, val });
  };

  const cyclePreamp = () => {
    if (preampLevels.length === 0) {
      handleSetLevel("PREAMP", 0);
      return;
    }
    const levelsAsNumbers = preampLevels.map(l => parseInt(l.replace('dB', '')));
    const allOptions = [0, ...levelsAsNumbers];
    let currentIndex = allOptions.indexOf(status.preamp);
    if (currentIndex === -1) currentIndex = 0; // Fallback to OFF if current level is not in list
    const nextIndex = (currentIndex + 1) % allOptions.length;
    const nextValue = allOptions[nextIndex];
    handleSetLevel("PREAMP", nextValue);
  };

  const getPreampLabel = () => {
    if (status.preamp === 0) return (isCompact || isPhone) ? "P.AMP" : "OFF";
    // If the current preamp level is not in our known capabilities, just show the number
    return `${status.preamp}dB`;
  };

  const cycleAttenuator = () => {
    if (attenuatorLevels.length === 0) return;
    const levelsAsNumbers = attenuatorLevels.map(l => parseInt(l.replace('dB', '')));
    const allOptions = [0, ...levelsAsNumbers];
    let currentIndex = allOptions.indexOf(status.attenuation);
    if (currentIndex === -1) currentIndex = 0;
    const nextIndex = (currentIndex + 1) % allOptions.length;
    const nextValue = allOptions[nextIndex];
    handleSetLevel("ATT", nextValue);
  };

  const getAttenuatorLabel = () => {
    if (status.attenuation === 0) return (isCompact || isPhone) ? "ATT" : "OFF";
    return `${status.attenuation}dB`;
  };

  const cycleAgc = () => {
    if (agcLevels.length === 0) return;
    const parsed = agcLevels.map(l => {
      const parts = l.split('=');
      return { value: parseInt(parts[0]), label: parts[1] };
    });
    let currentIndex = parsed.findIndex(p => p.value === status.agc);
    if (currentIndex === -1) currentIndex = 0;
    const nextIndex = (currentIndex + 1) % parsed.length;
    handleSetLevel("AGC", parsed[nextIndex].value);
  };

  const getAgcLabel = () => {
    if (agcLevels.length === 0) return "OFF";
    const parsed = agcLevels.map(l => {
      const parts = l.split('=');
      return { value: parseInt(parts[0]), label: parts[1] };
    });
    const current = parsed.find(p => p.value === status.agc);
    return current ? current.label : (status.agc === 0 ? "OFF" : status.agc.toString());
  };

  const handleVfoOp = (op: string) => {
    // Optimistic updates for known VFO operations
    if (op === "CPY") {
      // A=B: copy active VFO to other VFO
      skipPollsCount.current = 1;
      if (status.vfo === "VFOA") {
        setVfoB(status.frequency);
        localStorage.setItem("last-vfoB", status.frequency);
      } else {
        setVfoA(status.frequency);
        localStorage.setItem("last-vfoA", status.frequency);
      }
    }
    
    if (op === "TUNE") {
      if (tuningTimeoutRef.current) clearTimeout(tuningTimeoutRef.current);
      tuneSeenPTTRef.current = false;
      setIsTuning(true);
      tuneJustFinishedRef.current = false;
      setTuneJustFinished(false);
      // Safety timeout: clear spinner if PTT never engages within 15s
      tuningTimeoutRef.current = setTimeout(() => {
        setIsTuning(false);
        tuneJustFinishedRef.current = false;
        setTuneJustFinished(false);
        tuneSeenPTTRef.current = false;
        tuningTimeoutRef.current = null;
      }, 15000);
    }

    setPendingVfoOp(op);
    socket?.emit("vfo-op", op);
  };

  // Audio Context Refs
  const audioSettingsRef = useRef(audioSettings);
  const audioStatusRef = useRef(audioStatus);
  const inboundMutedRef = useRef(inboundMuted);
  const outboundMutedRef = useRef(outboundMuted);
  const localAudioReadyRef = useRef(localAudioReady);

  useEffect(() => { audioSettingsRef.current = audioSettings; }, [audioSettings]);
  useEffect(() => { audioStatusRef.current = audioStatus; }, [audioStatus]);
  useEffect(() => { inboundMutedRef.current = inboundMuted; }, [inboundMuted]);
  useEffect(() => { outboundMutedRef.current = outboundMuted; }, [outboundMuted]);
  useEffect(() => { localAudioReadyRef.current = localAudioReady; }, [localAudioReady]);
  useEffect(() => { if (audioStatus === "playing") setIsBackendEngineCollapsed(true); }, [audioStatus]);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: ArrayBuffer | Uint8Array) => {
      // console.count("[AUDIO-IN] Packets received");
      if (inboundMutedRef.current || !audioSettingsRef.current.inboundEnabled || audioStatusRef.current !== "playing" || !localAudioReadyRef.current) {
        return;
      }
      playInboundAudio(data);
    };
    socket.on("audio-inbound", handler);
    return () => {
      socket.off("audio-inbound", handler);
    };
  }, [socket]);
  
  useEffect(() => {
    const resumeAudio = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    };
    window.addEventListener('click', resumeAudio);
    return () => window.removeEventListener('click', resumeAudio);
  }, []);

  // Audio Playback Logic
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

  const initLocalAudioPipeline = async () => {
    // Stop any existing mic capture cleanly before resetting audio state
    stopMicCapture();

    // Close and null all stale WebCodecs/AudioContext refs so they are always freshly created
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

    // Handle output device if supported
    if (localAudioSettings.outputDevice && localAudioSettings.outputDevice !== 'default' && typeof (ctx as any).setSinkId === 'function') {
      try {
        await (ctx as any).setSinkId(localAudioSettings.outputDevice);
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
        playbackNodeRef.current.connect(ctx.destination);
      }

      if (!opusDecoderRef.current && typeof (window as any).AudioDecoder !== 'undefined') {
        const decoder = new (window as any).AudioDecoder({
          output: (audioData: any) => {
            if (inboundMutedRef.current || audioStatusRef.current !== "playing") {
              audioData.close();
              return;
            }
            // Convert AudioData to Float32Array and send to worklet
            const options = { planeIndex: 0 };
            const size = audioData.allocationSize(options);
            const buffer = new ArrayBuffer(size);
            audioData.copyTo(buffer, options);
            const float32Data = new Float32Array(buffer);

            if (playbackNodeRef.current) {
              playbackNodeRef.current.port.postMessage({ type: 'pcm', pcm: float32Data });
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
  };

  // ── Video pipeline ─────────────────────────────────────────────────────────

  const enumerateVideoDevices = async () => {
    if (!isElectronSource) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices
        .filter(d => d.kind === "videoinput")
        .map(d => ({ id: d.deviceId, label: d.label || d.deviceId }));
      setVideoDevices(videoInputs);
      socket?.emit("video-devices-update", videoInputs);
    } catch (e) {
      console.error("[VIDEO] enumerateDevices failed:", e);
    }
  };

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
        // Reinitialize on GPU context loss or other fatal errors so the stream
        // recovers automatically (e.g. after a window resize with hardware decoding).
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

  const stopVideoCapture = () => {
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
    socket?.emit("video-source-stop");
  };

  const startVideoCapture = async () => {
    if (!isElectronSource) return;
    stopVideoCapture();

    // Read from refs so this function always uses current values even when called
    // from a stale socket handler closure registered at mount time.
    const currentSettings = videoSettingsRef.current;
    const fps = parseInt(currentSettings.framerate) || 15;
    const width = currentSettings.videoWidth || 640;
    const height = currentSettings.videoHeight || 480;

    // Validate the stored device value against the enumerated device list.
    // settings.device stores a deviceId (opaque browser UUID). If the stored value
    // doesn't match any known deviceId — e.g. a stale label from the old FFmpeg
    // implementation — fall back to the default camera rather than throwing
    // OverconstrainedError.
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
      // srcObject is wired in a useEffect that watches videoStatus so the
      // <video> element is guaranteed to be in the DOM when it fires.

      const track = stream.getVideoTracks()[0];
      const keyframeInterval = Math.max(fps * 2, 30);

      // The encoder outputs AVCC-formatted H.264. The SPS/PPS (avcC box) needed by the
      // decoder arrives once in metadata.decoderConfig.description after configure().
      // We attach it to every keyframe so any client — including late joiners receiving
      // the buffered keyframe — can configure their decoder correctly.
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
          socket?.emit("video-frame", payload);
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

      socket?.emit("video-source-start", {
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
  };

  const handleJoinAudio = async () => {
    // If neither local device has ever been explicitly configured, redirect to audio settings
    const explicitInput = localStorage.getItem("local-audio-input");
    const explicitOutput = localStorage.getItem("local-audio-output");
    if (!explicitInput && !explicitOutput) {
      setIsVideoSettingsOpen(true);
      socket?.emit("get-video-devices");
      socket?.emit("get-audio-devices");
      if (isElectronSource) enumerateVideoDevices();
      return;
    }
    await initLocalAudioPipeline();
  };

  const handleStartAudio = async () => {
    await initLocalAudioPipeline();

    // Auto-enable streams if devices are selected
    const newSettings = {
      ...audioSettings,
      inboundEnabled: audioSettings.inputDevice !== "" ? true : audioSettings.inboundEnabled,
      outboundEnabled: audioSettings.outputDevice !== "" ? true : audioSettings.outboundEnabled
    };

    if (newSettings.inboundEnabled !== audioSettings.inboundEnabled || newSettings.outboundEnabled !== audioSettings.outboundEnabled) {
      setAudioSettings(newSettings);
      socket?.emit("update-audio-settings", newSettings);
    }

    socket?.emit("control-audio", "start");
  };

  const startMicCapture = async () => {
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

      const isPhoneDefault = !localAudioSettings.inputDevice || localAudioSettings.inputDevice === 'default';
      const specificConstraints = {
        audio: { deviceId: { exact: localAudioSettings.inputDevice },
                 echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      };
      const defaultConstraints = {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      };

      let stream: MediaStream;
      if (isPhoneDefault) {
        stream = await navigator.mediaDevices.getUserMedia(defaultConstraints);
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia(specificConstraints);
        } catch (deviceErr: any) {
          // Stored device ID is stale (unplugged, permission-rotated, etc.) — clear it and
          // fall back to the default device so the user doesn't need to clear their cache.
          console.warn(`[AUDIO] Stored input device "${localAudioSettings.inputDevice}" unavailable (${deviceErr.name}), falling back to default.`);
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
          output: (chunk: any, metadata: any) => {
            encodeCount++;
            if (encodeCount % 50 === 0) {
              vlog(`[AUDIO-ENCODE] Encoded 50 packets. Emitting to socket...`);
            }
            if (outboundMutedRef.current || audioStatusRef.current !== "playing") return;
            const buffer = new ArrayBuffer(chunk.byteLength);
            chunk.copyTo(buffer);
            if (encodeCount <= 5 || encodeCount % 50 === 0) {
              vlog(`[AUDIO-EMIT] Emitting audio-outbound packet #${encodeCount}, bytes=${buffer.byteLength}, socket connected=${socket?.connected}`);
            }
            socket?.emit("audio-outbound", buffer);
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
      const FRAME_SIZE = 960; // 20ms at 48kHz

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
      silentGain.connect(ctx.destination); // Required for processing to happen in some browsers
    } catch (err) {
      console.error("Error starting mic capture:", err);
    }
  };

  const stopMicCapture = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (captureNodeRef.current) {
      captureNodeRef.current.disconnect();
      captureNodeRef.current = null;
    }
  };

  useEffect(() => {
    if (audioStatus === "playing" && audioSettings.outboundEnabled && localAudioReady) {
      startMicCapture();
    } else {
      stopMicCapture();
    }
    return () => stopMicCapture();
  }, [audioStatus, audioSettings.outboundEnabled, localAudioSettings.inputDevice, localAudioReady]);

  const handleSendRaw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected || !rawCommand.trim()) return;
    const cmd = rawCommand.startsWith("+\\") ? rawCommand : `+\\${rawCommand}`;
    socket?.emit("send-raw", cmd);
  };

  const formatFreq = (freq: string) => {
    const f = parseInt(freq);
    if (isNaN(f)) return "0.000000";
    return (f / 1000000).toFixed(6);
  };

  const formatStep = (s: number) => {
    if (s >= 1) return `${s} MHz`;
    if (s >= 0.001) return `${s * 1000} kHz`;
    return `${s * 1000000} Hz`;
  };

  const filteredSpots = useMemo(() => {
    // Keep only the latest spot per activator (ISO strings compare lexicographically)
    const latestByActivator = new Map<string, PotaSpot>();
    for (const spot of potaSpots) {
      const existing = latestByActivator.get(spot.activator);
      if (!existing || spot.spotTime > existing.spotTime) {
        latestByActivator.set(spot.activator, spot);
      }
    }
    // Filter by max age, mode, and band
    const cutoff = Date.now() - potaMaxAge * 60 * 1000;
    return [...latestByActivator.values()].filter(s => {
      if (new Date(s.spotTime + 'Z').getTime() < cutoff) return false;
      if (potaModeFilter !== 'ALL' && s.mode !== potaModeFilter) return false;
      if (potaBandFilter.length > 0) {
        const inBand = potaBandFilter.some(label => {
          const band = POTA_BANDS.find(b => b.label === label);
          return band && s.frequency >= band.min && s.frequency < band.max;
        });
        if (!inBand) return false;
      }
      return true;
    });
  }, [potaSpots, potaMaxAge, potaModeFilter, potaBandFilter]);

  const sortedSpots = useMemo(() => {
    if (!potaSortCol || potaSortDir === 'api') return filteredSpots;
    return [...filteredSpots].sort((a, b) => {
      const aVal = (a as any)[potaSortCol];
      const bVal = (b as any)[potaSortCol];
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return potaSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredSpots, potaSortCol, potaSortDir]);

  const matchedSpotIds = useMemo(() => {
    const activeHz = Math.round(parseFloat(status.vfo === 'VFOA' ? inputVfoA : inputVfoB) * 1_000_000);
    const ids = new Set<number>();
    for (const spot of filteredSpots) {
      const spotHz = Math.round(spot.frequency * 1000);
      if (spotHz === activeHz) ids.add(spot.spotId);
    }
    return ids;
  }, [filteredSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedSpots = useMemo(() => {
    if (matchedSpotIds.size === 0) return sortedSpots.map(s => ({ spot: s, isPinned: false }));
    const pinned = sortedSpots
      .filter(s => matchedSpotIds.has(s.spotId))
      .map(s => ({ spot: s, isPinned: true }));
    const all = sortedSpots.map(s => ({ spot: s, isPinned: false }));
    return [...pinned, ...all];
  }, [sortedSpots, matchedSpotIds]);

  const filteredSotaSpots = useMemo(() => {
    const latestByActivator = new Map<string, SotaSpot>();
    for (const spot of sotaSpots) {
      const existing = latestByActivator.get(spot.activatorCallsign);
      if (!existing || spot.timeStamp > existing.timeStamp) {
        latestByActivator.set(spot.activatorCallsign, spot);
      }
    }
    const cutoff = Date.now() - sotaMaxAge * 60 * 1000;
    return [...latestByActivator.values()].filter(s => {
      if (new Date(s.timeStamp + 'Z').getTime() < cutoff) return false;
      if (sotaModeFilter !== 'ALL' && s.mode !== sotaModeFilter) return false;
      if (sotaBandFilter.length > 0) {
        const freqKhz = parseFloat(s.frequency) * 1000;
        const inBand = sotaBandFilter.some(label => {
          const band = POTA_BANDS.find(b => b.label === label);
          return band && freqKhz >= band.min && freqKhz < band.max;
        });
        if (!inBand) return false;
      }
      return true;
    });
  }, [sotaSpots, sotaMaxAge, sotaModeFilter, sotaBandFilter]);

  const sortedSotaSpots = useMemo(() => {
    if (!sotaSortCol || sotaSortDir === 'api') return filteredSotaSpots;
    return [...filteredSotaSpots].sort((a, b) => {
      const aVal = (a as any)[sotaSortCol];
      const bVal = (b as any)[sotaSortCol];
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sotaSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredSotaSpots, sotaSortCol, sotaSortDir]);

  const matchedSotaSpotIds = useMemo(() => {
    const activeHz = Math.round(parseFloat(status.vfo === 'VFOA' ? inputVfoA : inputVfoB) * 1_000_000);
    const ids = new Set<number>();
    for (const spot of filteredSotaSpots) {
      const spotHz = Math.round(parseFloat(spot.frequency) * 1_000_000);
      if (spotHz === activeHz) ids.add(spot.id);
    }
    return ids;
  }, [filteredSotaSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedSotaSpots = useMemo(() => {
    if (matchedSotaSpotIds.size === 0) return sortedSotaSpots.map(s => ({ spot: s, isPinned: false }));
    const pinned = sortedSotaSpots
      .filter(s => matchedSotaSpotIds.has(s.id))
      .map(s => ({ spot: s, isPinned: true }));
    const all = sortedSotaSpots.map(s => ({ spot: s, isPinned: false }));
    return [...pinned, ...all];
  }, [sortedSotaSpots, matchedSotaSpotIds]);

  const formatSpotAge = (spotTime: string): string => {
    const diff = Math.floor((Date.now() - new Date(spotTime + 'Z').getTime()) / 60000);
    return diff <= 0 ? '<1m ago' : `${diff}m ago`;
  };

  const handleTuneToSpot = (spot: PotaSpot) => {
    if (!connected) return;
    const freqHz = String(Math.round(spot.frequency * 1000));
    let mode = spot.mode;
    if (mode === 'SSB') mode = (spot.frequency / 1000) >= 10 ? 'USB' : 'LSB';
    if (mode === 'CW')  mode = (spot.frequency / 1000) >= 10 ? 'CW'  : 'CWR';
    if (mode === 'FT8' || mode === 'FT4') mode = availableModes.includes('PKTUSB') ? 'PKTUSB' : 'USB';
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handlePotaSort = (col: string) => {
    if (potaSortCol !== col) {
      setPotaSortCol(col);
      setPotaSortDir('asc');
    } else if (potaSortDir === 'asc') {
      setPotaSortDir('desc');
    } else {
      setPotaSortCol(null);
      setPotaSortDir('api');
    }
  };

  const handleTuneToSotaSpot = (spot: SotaSpot) => {
    if (!connected) return;
    const freqMhz = parseFloat(spot.frequency);
    const freqHz = String(Math.round(freqMhz * 1_000_000));
    let mode = spot.mode;
    if (mode === 'SSB') mode = freqMhz >= 10 ? 'USB' : 'LSB';
    if (mode === 'CW')  mode = freqMhz >= 10 ? 'CW'  : 'CWR';
    if (mode === 'FT8' || mode === 'FT4') mode = availableModes.includes('PKTUSB') ? 'PKTUSB' : 'USB';
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handleSotaSort = (col: string) => {
    if (sotaSortCol !== col) {
      setSotaSortCol(col);
      setSotaSortDir('asc');
    } else if (sotaSortDir === 'asc') {
      setSotaSortDir('desc');
    } else {
      setSotaSortCol(null);
      setSotaSortDir('api');
    }
  };

  const renderSpotsTable = (showFullLocation: boolean) => (
    <table className="w-full text-[0.625rem] font-mono border-collapse">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activator', label: 'Activator' },
            { key: 'frequency', label: 'Frequency' },
            { key: 'mode', label: 'Mode' },
            { key: 'locationDesc', label: 'Location' },
            { key: 'spotTime', label: 'Age' },
          ] as const).map(({ key, label }) => (
            <th
              key={key}
              onClick={() => handlePotaSort(key)}
              className="px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none whitespace-nowrap border-b border-[#2a2b2e]"
            >
              {label}
              {potaSortCol === key && potaSortDir !== 'api' && (
                <span className="ml-1 text-emerald-500">{potaSortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {displayedSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No POTA spots in the last {potaMaxAge} min...
            </td>
          </tr>
        ) : (
          displayedSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.spotId}` : String(spot.spotId)}>
              {!isPinned && index > 0 && displayedSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                matchedSpotIds.has(spot.spotId)
                  ? "bg-red-500/10 hover:bg-red-500/20"
                  : "hover:bg-white/5"
              )}>
                <td className="px-2 py-1 text-emerald-400 whitespace-nowrap">{spot.activator}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    onClick={() => handleTuneToSpot(spot)}
                    disabled={!connected}
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={connected ? 'Tune VFO to this frequency' : 'Connect to rig first'}
                  >
                    {(spot.frequency / 1000).toFixed(6)}
                  </button>
                </td>
                <td className="px-2 py-1 text-[#e0e0e0] whitespace-nowrap">{spot.mode}</td>
                <td className="px-2 py-1 text-[#8e9299]">
                  {showFullLocation
                    ? `${spot.locationDesc} · ${spot.reference} · ${spot.name}`
                    : `${spot.locationDesc} · ${spot.reference}`}
                </td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(spot.spotTime)}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  const renderSotaSpotsTable = () => (
    <table className="w-full text-[0.625rem] font-mono border-collapse">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activatorCallsign', label: 'Activator' },
            { key: 'frequency', label: 'Frequency' },
            { key: 'mode', label: 'Mode' },
            { key: 'summitCode', label: 'Location' },
            { key: 'timeStamp', label: 'Age' },
          ] as const).map(({ key, label }) => (
            <th
              key={key}
              onClick={() => handleSotaSort(key)}
              className="px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none whitespace-nowrap border-b border-[#2a2b2e]"
            >
              {label}
              {sotaSortCol === key && sotaSortDir !== 'api' && (
                <span className="ml-1 text-amber-500">{sotaSortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {displayedSotaSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No SOTA spots in the last {sotaMaxAge} min...
            </td>
          </tr>
        ) : (
          displayedSotaSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.id}` : String(spot.id)}>
              {!isPinned && index > 0 && displayedSotaSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                matchedSotaSpotIds.has(spot.id)
                  ? "bg-red-500/10 hover:bg-red-500/20"
                  : "hover:bg-white/5"
              )}>
                <td className="px-2 py-1 text-amber-400 whitespace-nowrap">{spot.activatorCallsign}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    onClick={() => handleTuneToSotaSpot(spot)}
                    disabled={!connected}
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={connected ? 'Tune VFO to this frequency' : 'Connect to rig first'}
                  >
                    {parseFloat(spot.frequency).toFixed(3)}
                  </button>
                </td>
                <td className="px-2 py-1 text-[#e0e0e0] whitespace-nowrap">{spot.mode}</td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{spot.associationCode}/{spot.summitCode}</td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(spot.timeStamp)}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <div className={cn(
      "bg-[#0a0a0a] text-[#e0e0e0] font-mono",
      isPhone ? "h-[100dvh] flex flex-col overflow-hidden" : isCompact ? "p-2 overflow-hidden h-fit" : "min-h-screen p-4 md:p-8"
    )}>
      <div
        ref={containerRef}
        className={cn(
          isPhone ? "flex-1 overflow-y-auto p-2 w-full space-y-4" : "mx-auto space-y-4",
          !isPhone && (isCompact ? "w-full" : "max-w-6xl space-y-6")
        )}
      >
        {/* Header / Connection */}
        <header className="bg-[#151619] rounded-xl border border-[#2a2b2e] shadow-2xl py-1.5 px-3 sm:p-4 flex items-center justify-between gap-2">
          {/* Phone: slim connection indicator */}
          <div className="flex sm:hidden items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", connected ? "bg-emerald-500" : "bg-red-500/70")} />
            <span className="text-sm font-bold tracking-tight uppercase italic">RigControl Web</span>
          </div>
          {/* Desktop: full branding */}
          <div className="hidden sm:flex items-center gap-3 min-w-0">
            <Signal size={24} className="text-emerald-500 flex-shrink-0" />
            <h1 className="text-xl font-bold tracking-tighter uppercase italic truncate">RigControl Web</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <button
              onClick={handleConnect}
              className={cn(
                "p-1.5 sm:px-6 sm:py-2 rounded-lg font-bold uppercase text-sm transition-all flex items-center gap-2",
                connected
                  ? "bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white"
                  : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 hover:bg-emerald-500 hover:text-white"
              )}
            >
              <Power size={16} className="flex-shrink-0" />
              <span className="hidden sm:inline">{connected ? "Disconnect" : "Connect"}</span>
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={cn(
                "p-1.5 sm:p-2 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg transition-all flex-shrink-0",
                rigctldProcessStatus === "running" ? "text-emerald-500 border-emerald-500/50" : "text-red-500 border-red-500/50"
              )}
              title="Rigctld Settings"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
            <div className="p-2 bg-red-500/20 rounded-full text-red-500">
              <Settings size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-red-500 font-bold text-sm uppercase tracking-tight">Connection Error</h3>
              <p className="text-xs text-red-400/80 mt-1 leading-relaxed">{error}</p>
              
              <div className="mt-4 p-3 bg-black/40 rounded border border-red-500/20 space-y-2">
                <p className="text-[0.625rem] text-[#8e9299] uppercase font-bold">How to fix this:</p>
                <ul className="text-[0.6875rem] list-disc list-inside space-y-1 text-red-300/70">
                  <li><strong>Use ngrok:</strong> Run <code className="bg-black px-1">ngrok tcp 4532</code> on your radio computer and use the provided <code className="text-white">0.tcp.ngrok.io</code> address.</li>
                  <li><strong>Port Forwarding:</strong> Forward port <code className="text-white">4532</code> on your router to <code className="text-white">192.168.86.34</code>.</li>
                  <li><strong>Public IP:</strong> Ensure you use your <em>Public</em> IP (search "What is my IP") and not your local 192.168.x.x address.</li>
                </ul>
              </div>

              <div className="mt-3 flex gap-4">
                <a 
                  href="https://github.com/Hamlib/Hamlib/wiki/rigctld" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[0.625rem] uppercase font-bold text-emerald-500 hover:underline"
                >
                  Rigctld Setup Guide
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Phone SPOTS scroll pill — visible when any spots section is enabled but none are in view */}
        {isPhone && (potaEnabled || sotaEnabled) && !potaSpotsVisible && !sotaSpotsVisible && (
          <button
            onClick={() => {
              const target = potaEnabled ? potaSpotsBoxRef.current : sotaSpotsBoxRef.current;
              target?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-1.5 bg-[#151619] border border-emerald-500/50 text-emerald-400 rounded-full text-[0.625rem] font-bold uppercase tracking-wider shadow-lg backdrop-blur-sm"
          >
            <MapPin size={10} />
            SPOTS ↓
          </button>
        )}

        {/* Main Interface */}
        {isPhone ? (
          <div className="space-y-2 animate-in fade-in duration-300">
            {/* Unified VFO & Mode/BW Box */}
            <div className={cn(
              "bg-[#151619] rounded-xl border shadow-lg overflow-hidden",
              status.isSplit ? "border-amber-500/30" : status.vfo === "VFOA" ? "border-emerald-500/30" : "border-blue-500/30"
            )}>
              {/* Header — always visible */}
              <div className={cn(
                "flex items-center justify-between px-3 py-2 bg-[#1a1b1e]",
                !isPhoneVFOCollapsed && "border-b border-[#2a2b2e]"
              )}>
                {isPhoneVFOCollapsed ? (
                  /* Collapsed: [◁ step]  ● VFO  freq  —  mode  [step ▷]  [⌄] */
                  <>
                    {/* Left: step-down arrow */}
                    <button
                      onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', -1)}
                      disabled={!connected}
                      className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50 flex-shrink-0"
                      title="Frequency Down"
                    >
                      <ChevronLeft size={14} />
                      <span className="text-[0.625rem] font-bold">
                        {vfoStep >= 1 ? `${vfoStep}M` : vfoStep >= 0.001 ? `${Math.round(vfoStep * 1000)}k` : `${Math.round(vfoStep * 1000000)}Hz`}
                      </span>
                    </button>

                    {/* Center: VFO summary */}
                    <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-center">
                      <div className={cn("w-2 h-2 rounded-full flex-shrink-0",
                        status.isSplit ? "bg-amber-500" : status.vfo === "VFOA" ? "bg-emerald-500" : "bg-blue-500"
                      )} />
                      <span className={cn("text-xs font-bold uppercase flex-shrink-0",
                        status.isSplit ? "text-amber-500" : status.vfo === "VFOA" ? "text-emerald-500" : "text-blue-500"
                      )}>
                        {status.isSplit ? "SPLIT" : status.vfo === "VFOA" ? "A" : "B"}
                      </span>
                      <span className="text-[#4a4b4e] flex-shrink-0">—</span>
                      <span className={cn("text-sm font-mono font-bold truncate",
                        status.ptt ? "text-red-500" : status.isSplit ? "text-amber-500" : status.vfo === "VFOA" ? "text-emerald-500" : "text-blue-500"
                      )}>
                        {parseFloat(status.vfo === "VFOA" ? inputVfoA : inputVfoB).toFixed(3)} MHz
                      </span>
                      <span className="text-[#4a4b4e] flex-shrink-0">—</span>
                      <span className="text-xs font-bold text-[#8e9299] flex-shrink-0">{localMode}</span>
                    </div>

                    {/* Right: step-up arrow */}
                    <button
                      onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', 1)}
                      disabled={!connected}
                      className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50 flex-shrink-0"
                      title="Frequency Up"
                    >
                      <span className="text-[0.625rem] font-bold">
                        {vfoStep >= 1 ? `${vfoStep}M` : vfoStep >= 0.001 ? `${Math.round(vfoStep * 1000)}k` : `${Math.round(vfoStep * 1000000)}Hz`}
                      </span>
                      <ChevronRight size={14} />
                    </button>

                    {/* Expand chevron */}
                    <button
                      onClick={() => setIsPhoneVFOCollapsed(false)}
                      className="p-1 hover:bg-white/5 rounded text-[#8e9299] flex-shrink-0 ml-1"
                      title="Expand VFO"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-[#8e9299]">
                      <Radio size={12} />
                      <span className="text-[0.5625rem] uppercase tracking-widest font-bold">VFO</span>
                    </div>
                    <button
                      onClick={() => setIsPhoneVFOCollapsed(true)}
                      className="p-1 hover:bg-white/5 rounded text-[#8e9299] flex-shrink-0"
                      title="Collapse VFO"
                    >
                      <ChevronUp size={16} />
                    </button>
                  </>
                )}
              </div>

              {/* Expanded content */}
              {!isPhoneVFOCollapsed && (
                <div className="p-3 space-y-2">
                  {/* Row 1: VFO A/B/SPLIT + Up/Down arrows — single non-wrapping line */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleSetVFO("VFOA")}
                        disabled={!connected}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all",
                          !connected && "opacity-50 cursor-not-allowed",
                          status.isSplit
                            ? (status.txVFO === "VFOA" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
                            : (status.vfo === "VFOA" ? "bg-emerald-500 text-white border border-emerald-500" : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20")
                        )}
                      >A</button>
                      <button
                        onClick={() => handleSetVFO("VFOB")}
                        disabled={!connected}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all",
                          !connected && "opacity-50 cursor-not-allowed",
                          status.isSplit
                            ? (status.txVFO === "VFOB" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
                            : (status.vfo === "VFOB" ? "bg-blue-500 text-white border border-blue-500" : "bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20")
                        )}
                      >B</button>
                      <button
                        onClick={handleToggleSplit}
                        disabled={!connected}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all",
                          !connected && "opacity-50 cursor-not-allowed",
                          status.isSplit ? "bg-red-500 text-white border border-red-500" : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
                        )}
                      >SPLIT</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', -1)}
                        disabled={!connected}
                        className="flex items-center gap-1 px-2 py-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        title="Frequency Down"
                      >
                        <ChevronLeft size={14} />
                        <span className="text-[0.625rem] font-bold">
                          {vfoStep >= 1 ? `${vfoStep}M` : vfoStep >= 0.001 ? `${Math.round(vfoStep * 1000)}k` : `${Math.round(vfoStep * 1000000)}Hz`}
                        </span>
                      </button>
                      <button
                        onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', 1)}
                        disabled={!connected}
                        className="flex items-center gap-1 px-2 py-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        title="Frequency Up"
                      >
                        <span className="text-[0.625rem] font-bold">
                          {vfoStep >= 1 ? `${vfoStep}M` : vfoStep >= 0.001 ? `${Math.round(vfoStep * 1000)}k` : `${Math.round(vfoStep * 1000000)}Hz`}
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Frequency input */}
                  <div className="flex items-baseline justify-center gap-2">
                    <input
                      type="number"
                      step={vfoStep}
                      value={status.vfo === "VFOA" ? inputVfoA : inputVfoB}
                      onChange={(e) => status.vfo === "VFOA" ? setInputVfoA(e.target.value) : setInputVfoB(e.target.value)}
                      disabled={!connected}
                      onBlur={() => {
                        const val = parseFloat(status.vfo === "VFOA" ? inputVfoA : inputVfoB);
                        if (!isNaN(val)) handleSetFreq(Math.round(val * 1000000).toString());
                      }}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className={cn(
                        "w-full bg-white/5 text-3xl font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-xl transition-all cursor-text py-1.5 px-3 border",
                        !connected && "opacity-50 cursor-not-allowed",
                        status.isSplit
                          ? (status.vfo === status.txVFO ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
                          : (status.vfo === "VFOA" ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50" : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50")
                      )}
                    />
                    <span className={cn("text-sm font-bold flex-shrink-0", status.vfo === "VFOA" ? "text-emerald-500/50" : "text-blue-500/50")}>MHz</span>
                  </div>

                  {/* Row 3: Step chips — one-tap step selection replacing the dropdown */}
                  <div className="flex gap-1 overflow-x-auto pb-0.5 justify-center">
                    {VFO_STEPS.map(s => (
                      <button
                        key={s}
                        onClick={() => setVfoStep(s)}
                        disabled={!connected}
                        className={cn(
                          "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold transition-all",
                          vfoStep === s
                            ? "bg-emerald-500 text-white"
                            : "bg-[#0a0a0a] border border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/50 disabled:opacity-50"
                        )}
                      >
                        {s >= 1
                          ? `${s}M`
                          : s >= 0.001
                            ? `${Math.round(s * 1000)}k`
                            : `${Math.round(s * 1000000)}Hz`}
                      </button>
                    ))}
                  </div>

                  {/* Row 4: Mode + Bandwidth */}
                  <div className="flex items-center gap-2">
                    <select
                      value={localMode}
                      onChange={(e) => handleSetMode(e.target.value)}
                      disabled={!connected}
                      className={cn("flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500", !connected && "opacity-50 cursor-not-allowed")}
                    >
                      {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      value={status?.bandwidth || "2400"}
                      onChange={(e) => handleSetBw(parseInt(e.target.value))}
                      disabled={!connected}
                      className={cn("flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500", !connected && "opacity-50 cursor-not-allowed")}
                    >
                      {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bw}Hz</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Video Feed Section */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col shadow-lg">
              <div className="p-2 px-3 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Monitor size={12} />
                  <span className="text-[0.5625rem] uppercase tracking-widest font-bold">Video & Audio</span>
                </div>
                <div className="flex items-center gap-3">
                  {audioStatus === "playing" && !localAudioReady ? (
                    <button
                      onClick={handleJoinAudio}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[0.5rem] uppercase font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all border border-blue-500/30 mr-1"
                      title="Join the active audio session"
                    >
                      <Headphones size={10} />
                      {audioWasRestarted ? "Restarted — Join Audio" : "Join Audio"}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 mr-1">
                      <button
                        onClick={() => setInboundMuted(!inboundMuted)}
                        disabled={audioStatus !== "playing" || !localAudioReady}
                        className={cn(
                          "p-1 rounded-lg transition-all",
                          (audioStatus !== "playing" || !localAudioReady) ? "opacity-30 cursor-not-allowed" :
                          inboundMuted ? "text-red-500 bg-red-500/10" : "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
                        )}
                        title={inboundMuted ? "Unmute Inbound Audio" : "Mute Inbound Audio"}
                      >
                        {inboundMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
                      <button
                        onClick={() => {
                          const newMuted = !outboundMuted;
                          setOutboundMuted(newMuted);
                          if (newMuted) {
                            socket?.emit("mic-mute-notify");
                          } else {
                            socket?.emit("mic-unmute-request");
                          }
                        }}
                        disabled={audioStatus !== "playing" || !audioSettings.outboundEnabled || !localAudioReady}
                        className={cn(
                          "p-1 rounded-lg transition-all",
                          (audioStatus !== "playing" || !audioSettings.outboundEnabled || !localAudioReady) ? "opacity-30 cursor-not-allowed" :
                          outboundMuted ? "text-red-500 bg-red-500/10" : "text-blue-500 bg-blue-500/10 hover:bg-blue-500/20"
                        )}
                        title={outboundMuted ? "Unmute Outbound Audio" : "Mute Outbound Audio"}
                      >
                        {outboundMuted ? <MicOff size={12} /> : <Mic size={12} />}
                      </button>
                    </div>
                  )}
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    videoStatus === "streaming" ? "bg-emerald-500 animate-pulse" : "bg-[#2a2b2e]"
                  )} />
                  <button
                    onClick={() => {
                      setIsVideoSettingsOpen(true);
                      socket?.emit("get-video-devices");
                      socket?.emit("get-audio-devices");
                      if (isElectronSource) enumerateVideoDevices();
                    }}
                    className="p-1.5 hover:bg-[#2a2b2e] rounded-lg text-[#8e9299] transition-all"
                    title="Video & Audio Settings"
                  >
                    <Settings size={14} />
                  </button>
                  <button 
                    onClick={() => setIsVideoCollapsed(!isVideoCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isVideoCollapsed ? "Expand Video & Audio" : "Collapse Video & Audio"}
                  >
                    {isVideoCollapsed ? <ChevronDown size={isPhone ? 16 : 18} /> : <ChevronUp size={isPhone ? 16 : 18} />}
                  </button>
                </div>
              </div>
              {!isVideoCollapsed && (
                <div className="relative aspect-video bg-black flex items-center justify-center">
                  <video ref={videoPreviewCallbackRef} autoPlay muted playsInline
                    className={cn("w-full h-full object-contain", (!isElectronSource || videoStatus !== "streaming") && "hidden")} />
                  <canvas ref={videoCanvasRef}
                    className={cn("w-full h-full object-contain", (isElectronSource || videoStatus !== "streaming") && "hidden")} />
                  {videoStatus !== "streaming" && (
                    <div className="flex flex-col items-center gap-4 text-[#3a3b3e]">
                      <Monitor size={32} strokeWidth={1} />
                      <span className="text-[0.5rem] uppercase font-bold tracking-widest">Stream Stopped</span>
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
                      <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                      <p className="text-xs text-red-400 font-medium">{videoError}</p>
                      {isElectronSource && (
                        <button
                          onClick={() => { setVideoError(null); socket?.emit("request-video-start"); }}
                          className="mt-3 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-[10px] transition-colors"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="bg-[#151619] p-3 rounded-xl border border-[#2a2b2e] space-y-3">
              <div className={cn("flex items-center justify-between", !isPhoneMeterCollapsed && "border-b border-[#2a2b2e] pb-3")}>
                {isPhoneMeterCollapsed ? (
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm font-mono font-bold", status.ptt ? "text-red-500" : "text-emerald-500")}>
                      {status.ptt
                        ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                        : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
                    </span>
                    <span className="text-[#3a3b3e]">·</span>
                    <span className={cn("text-sm font-mono font-bold", (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500")}>
                      {(status.swr ?? 1).toFixed(2)}
                    </span>
                    <span className="text-[#3a3b3e]">·</span>
                    <span className="text-sm font-mono font-bold text-blue-400">
                      {(status.alc ?? 0).toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {(['signal', 'swr', 'alc'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPhoneMeterTab(m)}
                        className={cn(
                          "px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                          phoneMeterTab === m
                            ? (m === 'swr' && (status.swr ?? 1) > 3 ? "bg-red-500 text-white" : "bg-emerald-500 text-white")
                            : (m === 'swr' && (status.swr ?? 1) > 3 ? "text-red-500 bg-red-500/10" : "text-[#8e9299] hover:bg-white/5")
                        )}
                      >
                        {m === 'signal' ? (status.ptt ? 'POWER' : 'SIGNAL') : m}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {!isPhoneMeterCollapsed && (
                    <div className="flex flex-col items-end">
                      {phoneMeterTab === 'signal' && (
                        <span className={cn("text-lg font-mono font-bold", status.ptt ? "text-red-500" : "text-emerald-500")}>
                          {status.ptt
                            ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                            : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
                        </span>
                      )}
                      {phoneMeterTab === 'swr' && (
                        <span className={cn("text-lg font-mono font-bold", (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500")}>
                          {(status.swr ?? 1).toFixed(2)}
                        </span>
                      )}
                      {phoneMeterTab === 'alc' && (
                        <span className="text-lg font-mono font-bold text-blue-500">
                          {(status.alc ?? 0).toFixed(5)}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => setIsPhoneMeterCollapsed(!isPhoneMeterCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isPhoneMeterCollapsed ? "Expand Meters" : "Collapse Meters"}
                  >
                    {isPhoneMeterCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </button>
                </div>
              </div>
              {!isPhoneMeterCollapsed && (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                      <XAxis dataKey="time" hide />
                      <YAxis 
                        domain={phoneMeterTab === 'signal' ? (status.ptt ? [0, 1] : [-54, 0]) : phoneMeterTab === 'swr' ? [1, 4] : [0, 1]} 
                        hide 
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '12px' }}
                        itemStyle={{ 
                          color: phoneMeterTab === 'signal' 
                            ? (status.ptt ? '#ef4444' : '#10b981') 
                            : phoneMeterTab === 'swr' 
                              ? ((status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b') 
                              : '#3b82f6' 
                        }}
                        formatter={(val: number, name: string, props: any) => {
                          if (phoneMeterTab === 'signal') {
                            const rawVal = props.payload?.smeter ?? val;
                            return [status.ptt ? `${Math.round((val ?? 0) * 100)}W` : (rawVal > 0 ? `S9+${rawVal}dB` : `S${Math.round((rawVal + 54) / 6)}`), status.ptt ? "POWER" : "SIGNAL"];
                          }
                          if (phoneMeterTab === 'swr') {
                            return [(props.payload?.swr ?? 1).toFixed(2), 'SWR'];
                          }
                          return [(val ?? 0).toFixed(phoneMeterTab === 'alc' ? 5 : 2), phoneMeterTab.toUpperCase()];
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey={phoneMeterTab === 'signal' ? (status.ptt ? "powerMeter" : "smeterGraph") : phoneMeterTab === 'swr' ? 'swrGraph' : 'alc'} 
                        stroke={
                          phoneMeterTab === 'signal' 
                            ? (status.ptt ? "#ef4444" : "#10b981") 
                            : phoneMeterTab === 'swr' 
                              ? ((status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b') 
                              : '#3b82f6'
                        } 
                        strokeWidth={2} 
                        dot={false} 
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Consolidated Quick Controls box */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden">
              <div className="p-3 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Zap size={12} />
                  <span className="text-[0.5625rem] uppercase tracking-widest font-bold">Quick Controls</span>
                </div>
                <button
                  onClick={() => setIsPhoneQuickControlsCollapsed(!isPhoneQuickControlsCollapsed)}
                  className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                  title={isPhoneQuickControlsCollapsed ? "Expand Quick Controls" : "Collapse Quick Controls"}
                >
                  {isPhoneQuickControlsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
              </div>
              {!isPhoneQuickControlsCollapsed && (
                <div className="p-3 flex flex-col gap-4">

                  {/* Tune / Att / Preamp */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        if (isTuning) return;
                        if (status.tuner) {
                          handleSetFunc("TUNER", false);
                        } else {
                          handleVfoOp("TUNE");
                        }
                      }}
                      disabled={!connected || isTuning}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || isTuning) && "cursor-not-allowed",
                        isTuning
                          ? "bg-red-500/20 border-red-500 text-red-500"
                          : (status.tuner || tuneJustFinished)
                            ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
                            : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <RefreshCw size={18} className={cn(isTuning && "animate-spin")} />
                      <span className="text-xs uppercase font-bold leading-none">Tune</span>
                    </button>
                    <button
                      onClick={cycleAttenuator}
                      disabled={!connected || attenuatorLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || attenuatorLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.attenuation > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Signal size={18} />
                      <span className="text-xs uppercase font-bold leading-none">{getAttenuatorLabel()}</span>
                    </button>
                    <button
                      onClick={cyclePreamp}
                      disabled={!connected || preampLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || preampLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.preamp > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Zap size={18} />
                      <span className="text-xs uppercase font-bold leading-none">{getPreampLabel()}</span>
                    </button>
                  </div>

                  {/* NB / AGC / DNR / ANF toggle buttons */}
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => handleSetFunc("NB", !status.nb)}
                      disabled={!connected || !nbCapabilities.supported}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || !nbCapabilities.supported) && "opacity-50 cursor-not-allowed",
                        status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Waves size={16} />
                      <span className="text-xs uppercase font-bold leading-none">NB</span>
                    </button>
                    <button
                      onClick={cycleAgc}
                      disabled={!connected || agcLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || agcLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.agc > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Settings size={16} />
                      <div className="flex flex-col items-center leading-none gap-0.5">
                        <span className="text-xs uppercase font-bold">AGC</span>
                        <span className="text-[0.5625rem] font-bold opacity-80">{getAgcLabel()}</span>
                      </div>
                    </button>
                    <button
                      onClick={() => handleSetFunc("NR", !status.nr)}
                      disabled={!connected || !nrCapabilities.supported}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed",
                        status.nr ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Activity size={16} />
                      <span className="text-xs uppercase font-bold leading-none">DNR</span>
                    </button>
                    <button
                      onClick={() => handleSetFunc("ANF", !status.anf)}
                      disabled={!connected || !anfCapabilities.supported}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1",
                        (!connected || !anfCapabilities.supported) && "opacity-50 cursor-not-allowed",
                        status.anf ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Activity size={16} />
                      <span className="text-xs uppercase font-bold leading-none">ANF</span>
                    </button>
                  </div>

                  {/* RF Power / Level / DNR Level / NB Level sliders */}
                  <div className="flex flex-col gap-3">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs uppercase text-[#8e9299]">RF Power</span>
                        <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
                      </div>
                      <input
                        type="range"
                        min={rfPowerCapabilities.range.min * 100}
                        max={rfPowerCapabilities.range.max * 100}
                        step={rfPowerCapabilities.range.step * 100}
                        value={localRFPower * 100}
                        disabled={!connected}
                        onChange={(e) => {
                          isDraggingRF.current = true;
                          setLocalRFPower(parseFloat(e.target.value) / 100);
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-2 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs uppercase text-[#8e9299]">RF Level</span>
                        <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFLevel * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={localRFLevel}
                        disabled={!connected}
                        onChange={(e) => {
                          isDraggingRFLevel.current = true;
                          setLocalRFLevel(parseFloat(e.target.value));
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-2 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs uppercase text-[#8e9299]">DNR Level</span>
                        <span className="text-sm text-emerald-500 font-bold">Lvl {Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)}
                        step="1"
                        value={Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}
                        disabled={!connected || !nrCapabilities.supported}
                        onChange={(e) => {
                          isDraggingNR.current = true;
                          const stepIdx = parseInt(e.target.value);
                          const calculated = nrCapabilities.range.min + (stepIdx * nrCapabilities.range.step);
                          setLocalNRLevel(Math.min(nrCapabilities.range.max, calculated));
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-2 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed"
                        )}
                      />
                    </div>
                    {nbCapabilities.supported && (
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs uppercase text-[#8e9299]">NB Level</span>
                          <span className="text-sm text-emerald-500 font-bold">Lvl {Math.round(localNBLevel)}</span>
                        </div>
                        <input
                          type="range"
                          min={nbCapabilities.range.min}
                          max={nbCapabilities.range.max}
                          step={nbCapabilities.range.step}
                          value={localNBLevel}
                          disabled={!connected}
                          onChange={(e) => {
                            isDraggingNB.current = true;
                            setLocalNBLevel(parseFloat(e.target.value));
                          }}
                          className={cn(
                            "w-full accent-emerald-500 h-2 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                            !connected && "opacity-50 cursor-not-allowed"
                          )}
                        />
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>

            {potaEnabled && (
              <div ref={potaSpotsBoxRef} className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden">
                <div className={cn("p-3 flex items-center justify-between bg-[#1a1b1e]", !potaSpotsCollapsed && "border-b border-[#2a2b2e]")}>
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <MapPin size={12} />
                    <span className="text-[0.5625rem] uppercase tracking-widest font-bold">POTA Spots</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.5rem] text-[#8e9299]">{filteredSpots.length} spot{filteredSpots.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setPotaSpotsCollapsed(!potaSpotsCollapsed)}
                      className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                      title={potaSpotsCollapsed ? "Expand Spots" : "Collapse Spots"}
                    >
                      {potaSpotsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    </button>
                  </div>
                </div>
                {!potaSpotsCollapsed && (
                  <div className="overflow-x-auto">
                    {renderSpotsTable(false)}
                  </div>
                )}
              </div>
            )}
            {sotaEnabled && (
              <div ref={sotaSpotsBoxRef} className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden">
                <div className={cn("p-3 flex items-center justify-between bg-[#1a1b1e]", !sotaSpotsCollapsed && "border-b border-[#2a2b2e]")}>
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <MapPin size={12} />
                    <span className="text-[0.5625rem] uppercase tracking-widest font-bold">SOTA Spots</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.5rem] text-[#8e9299]">{filteredSotaSpots.length} spot{filteredSotaSpots.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setSotaSpotsCollapsed(!sotaSpotsCollapsed)}
                      className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                      title={sotaSpotsCollapsed ? "Expand Spots" : "Collapse Spots"}
                    >
                      {sotaSpotsCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    </button>
                  </div>
                </div>
                {!sotaSpotsCollapsed && (
                  <div className="overflow-x-auto">
                    {renderSotaSpotsTable()}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : isCompact ? (
          <div className="space-y-2 animate-in fade-in duration-300">
            {/* Unified VFO & Mode/BW Box */}
            <div className={cn(
              "bg-[#151619] p-3 rounded-xl border shadow-lg space-y-2",
              status.vfo === "VFOA" ? "border-emerald-500/30" : "border-blue-500/30"
            )}>
              <div className="grid grid-cols-3 items-center">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSetVFO("VFOA")}
                    disabled={!connected}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.isSplit
                        ? (status.txVFO === "VFOA" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
                        : (status.vfo === "VFOA"
                          ? "bg-emerald-500 text-white border border-emerald-500"
                          : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20")
                    )}
                  >
                    VFO A
                  </button>
                  <button
                    onClick={() => handleSetVFO("VFOB")}
                    disabled={!connected || !vfoSupported}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                      (!connected || !vfoSupported) && "opacity-50 cursor-not-allowed",
                      status.isSplit
                        ? (status.txVFO === "VFOB" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
                        : (status.vfo === "VFOB"
                          ? "bg-blue-500 text-white border border-blue-500"
                          : "bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20")
                    )}
                  >
                    VFO B
                  </button>
                  <button
                    onClick={handleToggleSplit}
                    disabled={!connected || !vfoSupported}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                      (!connected || !vfoSupported) && "opacity-50 cursor-not-allowed",
                      status.isSplit
                        ? "bg-red-500 text-white border border-red-500"
                        : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
                    )}
                  >
                    SPLIT
                  </button>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', -1)}
                    disabled={!connected}
                    className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                    title="Frequency Down"
                  >
                    <ChevronLeft size={12} />
                    <span className="text-[0.625rem] font-bold">
                      {vfoStep >= 1 ? `${vfoStep}M` : vfoStep >= 0.001 ? `${Math.round(vfoStep * 1000)}k` : `${Math.round(vfoStep * 1000000)}Hz`}
                    </span>
                  </button>
                  <button
                    onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', 1)}
                    disabled={!connected}
                    className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                    title="Frequency Up"
                  >
                    <span className="text-[0.625rem] font-bold">
                      {vfoStep >= 1 ? `${vfoStep}M` : vfoStep >= 0.001 ? `${Math.round(vfoStep * 1000)}k` : `${Math.round(vfoStep * 1000000)}Hz`}
                    </span>
                    <ChevronRight size={12} />
                  </button>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <select
                    value={localMode}
                    onChange={(e) => handleSetMode(e.target.value)}
                    disabled={!connected}
                    className={cn(
                      "bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500",
                      !connected && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select 
                    value={status?.bandwidth || "2400"}
                    onChange={(e) => handleSetBw(parseInt(e.target.value))}
                    disabled={!connected}
                    className={cn(
                      "bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500",
                      !connected && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bw}Hz</option>)}
                  </select>
                </div>
              </div>

              <div className="relative group flex items-baseline justify-center gap-2 py-1">
                <input
                  type="number"
                  step={vfoStep}
                  value={status.vfo === "VFOA" ? inputVfoA : inputVfoB}
                  onChange={(e) => status.vfo === "VFOA" ? setInputVfoA(e.target.value) : setInputVfoB(e.target.value)}
                  disabled={!connected}
                  onBlur={() => {
                    const val = parseFloat(status.vfo === "VFOA" ? inputVfoA : inputVfoB);
                    if (!isNaN(val)) {
                      handleSetFreq(Math.round(val * 1000000).toString());
                    }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={cn(
                    "w-full bg-white/5 text-4xl font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg transition-all cursor-text py-1 px-2 border",
                    !connected && "opacity-50 cursor-not-allowed",
                    status.isSplit
                      ? (status.vfo === status.txVFO 
                          ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" 
                          : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
                      : (status.vfo === "VFOA" 
                          ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50" 
                          : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50")
                  )}
                  title="Click to edit frequency"
                />
                <span className={cn(
                  "text-sm font-bold",
                  status.vfo === "VFOA" ? "text-emerald-500/50" : "text-blue-500/50"
                )}>MHz</span>
                <Pencil size={12} className={cn(
                  "absolute right-12 top-1/2 -translate-y-1/2 transition-opacity pointer-events-none",
                  status.vfo === "VFOA" ? "text-emerald-500/30" : "text-blue-500/30"
                )} />
              </div>

              {/* Step chips */}
              <div className="flex gap-1 justify-center pb-0.5">
                {VFO_STEPS.map(s => (
                  <button
                    key={s}
                    onClick={() => setVfoStep(s)}
                    disabled={!connected}
                    className={cn(
                      "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold transition-all",
                      vfoStep === s
                        ? "bg-emerald-500 text-white"
                        : "bg-[#0a0a0a] border border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/50 disabled:opacity-50"
                    )}
                  >
                    {s >= 1
                      ? `${s}M`
                      : s >= 0.001
                        ? `${Math.round(s * 1000)}k`
                        : `${Math.round(s * 1000000)}Hz`}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Combined Meter Box */}
              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
                <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <div className="flex gap-1">
                    {(['signal', 'swr', 'alc', 'vdd'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setActiveMeter(m)}
                        className={cn(
                          "px-2 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                          activeMeter === m 
                            ? (m === 'swr' && (status.swr ?? 1) > 3 ? "bg-red-500 text-white" : "bg-emerald-500 text-white")
                            : (m === 'swr' && (status.swr ?? 1) > 3 ? "text-red-500 bg-red-500/10" : "text-[#8e9299] hover:bg-white/5")
                        )}
                      >
                        {m === 'signal' ? (status.ptt ? 'power' : 'signal') : m}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-xs font-mono font-bold",
                      activeMeter === 'signal' ? (status.ptt ? "text-red-500" : "text-emerald-500") :
                      activeMeter === 'swr' ? ((status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500") :
                      activeMeter === 'alc' ? "text-blue-500" : "text-emerald-500"
                    )}>
                      {activeMeter === 'signal' ? (
                        status.ptt 
                          ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                          : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`
                      ) : activeMeter === 'swr' ? (
                        (status.swr ?? 1).toFixed(2)
                      ) : activeMeter === 'alc' ? (
                        (status.alc ?? 0).toFixed(5)
                      ) : (
                        `${(status.vdd ?? 0).toFixed(1)}V`
                      )}
                    </span>
                    <button 
                      onClick={() => setIsCompactSMeterCollapsed(!isCompactSMeterCollapsed)}
                      className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
                    >
                      {isCompactSMeterCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                  </div>
                </div>
                {!isCompactSMeterCollapsed && (
                  <div className="p-2 flex-1 min-h-[80px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                        <XAxis dataKey="time" hide />
                        <YAxis 
                          domain={
                            activeMeter === 'signal' ? (status.ptt ? [0, 1] : [-54, 0]) :
                            activeMeter === 'swr' ? [1, 4] :
                            activeMeter === 'vdd' ? [11, 16] : [0, 1]
                          } 
                          hide={activeMeter !== 'swr' && activeMeter !== 'vdd'}
                          ticks={activeMeter === 'swr' ? [1, 2, 3, 4] : activeMeter === 'vdd' ? [11, 12, 13, 14, 15, 16] : undefined}
                          width={15}
                          style={{ fontSize: '6px', fill: '#4a4b4e' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '8px' }}
                          itemStyle={{ 
                            color: activeMeter === 'signal' ? (status.ptt ? '#ef4444' : '#10b981') :
                                   activeMeter === 'swr' ? ((status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b') :
                                   activeMeter === 'alc' ? '#3b82f6' : '#10b981'
                          }}
                          formatter={(val: number, name: string, props: any) => {
                            if (activeMeter === 'signal') {
                              const rawVal = props.payload?.smeter ?? val;
                              return [status.ptt ? `${Math.round((val ?? 0) * 100)}W` : (rawVal > 0 ? `S9+${rawVal}dB` : `S${Math.round((rawVal + 54) / 6)}`), status.ptt ? "POWER" : "SIGNAL"];
                            }
                            if (activeMeter === 'swr') {
                              return [(props.payload?.swr ?? 1).toFixed(2), 'SWR'];
                            }
                            if (activeMeter === 'vdd') {
                              return [`${(val ?? 0).toFixed(1)}V`, 'VDD'];
                            }
                            return [(val ?? 0).toFixed(activeMeter === 'alc' ? 5 : 2), activeMeter.toUpperCase()];
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey={
                            activeMeter === 'signal' ? (status.ptt ? "powerMeter" : "smeterGraph") :
                            activeMeter === 'swr' ? 'swrGraph' : activeMeter
                          } 
                          stroke={
                            activeMeter === 'signal' ? (status.ptt ? "#ef4444" : "#10b981") :
                            activeMeter === 'swr' ? ((status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b') :
                            activeMeter === 'alc' ? '#3b82f6' : '#10b981'
                          } 
                          strokeWidth={1.5} 
                          dot={false} 
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Video Feed Section (Moved into grid) */}
              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col shadow-lg">
                <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <Monitor size={12} />
                    <span className="text-xs uppercase tracking-widest font-bold">Video & Audio</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {audioStatus === "playing" && !localAudioReady ? (
                      <button
                        onClick={handleJoinAudio}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[0.5rem] uppercase font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all border border-blue-500/30 mr-1"
                        title="Join the active audio session"
                      >
                        <Headphones size={10} />
                        {audioWasRestarted ? "Restarted — Join Audio" : "Join Audio"}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1 mr-1">
                        <button
                          onClick={() => setInboundMuted(!inboundMuted)}
                          disabled={audioStatus !== "playing" || !localAudioReady}
                          className={cn(
                            "p-1 rounded-lg transition-all",
                            (audioStatus !== "playing" || !localAudioReady) ? "opacity-30 cursor-not-allowed" :
                            inboundMuted ? "text-red-500 bg-red-500/10" : "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
                          )}
                          title={inboundMuted ? "Unmute Inbound Audio" : "Mute Inbound Audio"}
                        >
                          {inboundMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                        </button>
                        <button
                          onClick={() => {
                            const newMuted = !outboundMuted;
                            setOutboundMuted(newMuted);
                            if (newMuted) {
                              socket?.emit("mic-mute-notify");
                            } else {
                              socket?.emit("mic-unmute-request");
                            }
                          }}
                          disabled={audioStatus !== "playing" || !audioSettings.outboundEnabled || !localAudioReady}
                          className={cn(
                            "p-1 rounded-lg transition-all",
                            (audioStatus !== "playing" || !audioSettings.outboundEnabled || !localAudioReady) ? "opacity-30 cursor-not-allowed" :
                            outboundMuted ? "text-red-500 bg-red-500/10" : "text-blue-500 bg-blue-500/10 hover:bg-blue-500/20"
                          )}
                          title={outboundMuted ? "Unmute Outbound Audio" : "Mute Outbound Audio"}
                        >
                          {outboundMuted ? <MicOff size={12} /> : <Mic size={12} />}
                        </button>
                      </div>
                    )}
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      videoStatus === "streaming" ? "bg-emerald-500 animate-pulse" : "bg-[#2a2b2e]"
                    )} />
                    <button
                      onClick={() => {
                        setIsVideoSettingsOpen(true);
                        if (isElectronSource) enumerateVideoDevices();
                        socket?.emit("get-audio-devices");
                      }}
                      className="p-1 hover:bg-[#2a2b2e] rounded text-[#8e9299] transition-all"
                      title="Video & Audio Settings"
                    >
                      <Settings size={12} />
                    </button>
                    <button
                      onClick={() => setIsVideoCollapsed(!isVideoCollapsed)}
                      className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
                    >
                      {isVideoCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                  </div>
                </div>
                {!isVideoCollapsed && (
                  <div className="relative aspect-video bg-black flex items-center justify-center">
                    <video ref={videoPreviewCallbackRef} autoPlay muted playsInline
                      className={cn("w-full h-full object-contain", (!isElectronSource || videoStatus !== "streaming") && "hidden")} />
                    <canvas ref={videoCanvasRef}
                      className={cn("w-full h-full object-contain", (isElectronSource || videoStatus !== "streaming") && "hidden")} />
                    {videoStatus !== "streaming" && (
                      <div className="flex flex-col items-center gap-2 text-[#3a3b3e]">
                        <Monitor size={24} strokeWidth={1} />
                        <span className="text-[0.5rem] uppercase font-bold tracking-widest">Stopped</span>
                      </div>
                    )}
                    {videoError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
                        <AlertCircle className="w-6 h-6 text-red-500 mb-1" />
                        <p className="text-[10px] text-red-400 font-medium">{videoError}</p>
                        {isElectronSource && (
                          <button
                            onClick={() => { setVideoError(null); socket?.emit("request-video-start"); }}
                            className="mt-2 px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-[9px] transition-colors"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Compact Controls & RF Power */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
                <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <span className="text-xs font-bold uppercase text-[#8e9299]">Controls</span>
                  <button 
                    onClick={() => setIsCompactControlsCollapsed(!isCompactControlsCollapsed)}
                    className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
                  >
                    {isCompactControlsCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                </div>
                {!isCompactControlsCollapsed && (
                  <div className="p-2 grid grid-cols-3 gap-2 h-full content-start">
                    <button 
                      onClick={() => handleSetPTT(!status.ptt)}
                      disabled={!connected}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        !connected && "opacity-50 cursor-not-allowed",
                        status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Mic size={16} />
                      <span className="text-xs uppercase font-bold leading-none">PTT</span>
                    </button>
                    <button
                      onClick={() => {
                        if (isTuning) return;
                        if (status.tuner) {
                          handleSetFunc("TUNER", false);
                        } else {
                          handleVfoOp("TUNE");
                        }
                      }}
                      disabled={!connected || isTuning}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || isTuning) && "cursor-not-allowed",
                        isTuning
                          ? "bg-red-500/20 border-red-500 text-red-500"
                          : (status.tuner || tuneJustFinished)
                            ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
                            : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <RefreshCw size={16} className={cn(isTuning && "animate-spin")} />
                      <span className="text-xs uppercase font-bold leading-none">Tune</span>
                    </button>
                    <button
                      onClick={cycleAttenuator}
                      disabled={!connected || attenuatorLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || attenuatorLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.attenuation > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Signal size={16} />
                      <span className="text-xs uppercase font-bold leading-none">
                        {getAttenuatorLabel()}
                      </span>
                    </button>
                    <button 
                      onClick={cyclePreamp}
                      disabled={!connected || preampLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || preampLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.preamp > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Zap size={16} />
                      <span className="text-xs uppercase font-bold leading-none">
                        {getPreampLabel()}
                      </span>
                    </button>
                    <button 
                      onClick={() => handleSetFunc("NB", !status.nb)}
                      disabled={!connected || !nbCapabilities.supported}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || !nbCapabilities.supported) && "opacity-50 cursor-not-allowed",
                        status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Waves size={16} />
                      <span className="text-xs uppercase font-bold leading-none">NB</span>
                    </button>
                    <button
                      onClick={() => handleSetFunc("ANF", !status.anf)}
                      disabled={!connected || !anfCapabilities.supported}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || !anfCapabilities.supported) && "opacity-50 cursor-not-allowed",
                        status.anf ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Activity size={16} />
                      <span className="text-xs uppercase font-bold leading-none">ANF</span>
                    </button>

                    <button 
                      onClick={cycleAgc}
                      disabled={!connected || agcLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || agcLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.agc > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Settings size={16} />
                      <div className="flex flex-col items-center leading-none">
                        <span className="text-xs uppercase font-bold">AGC</span>
                        <span className="text-[0.625rem] font-bold opacity-80">{getAgcLabel()}</span>
                      </div>
                    </button>
                    <button 
                      onClick={() => handleSetFunc("NR", !status.nr)}
                      disabled={!connected || !nrCapabilities.supported}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed",
                        status.nr ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <Activity size={16} />
                      <span className="text-xs uppercase font-bold leading-none">DNR</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
                <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <div className="flex items-center gap-1">
                    {(['levels', ...(potaEnabled ? ['pota'] : []), ...(sotaEnabled ? ['sota'] : [])] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveCompactPowerTab(tab)}
                        className={cn(
                          "px-2 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                          activeCompactPowerTab === tab
                            ? "bg-emerald-500 text-white"
                            : "text-[#8e9299] hover:bg-white/5"
                        )}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setIsCompactRFPowerCollapsed(!isCompactRFPowerCollapsed)}
                    className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
                  >
                    {isCompactRFPowerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                </div>
                {!isCompactRFPowerCollapsed && (
                  <div className="relative overflow-hidden">
                    {/* LEVELS — always rendered to establish the box height; invisible when POTA or SOTA tab is active */}
                    <div className={cn(
                      "p-2 flex flex-col justify-center gap-1",
                      (activeCompactPowerTab === 'pota' || activeCompactPowerTab === 'sota') && "invisible"
                    )}>
                      <div className="flex justify-between items-center">
                        <span className="text-xs uppercase text-[#8e9299]">RF Power</span>
                        <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
                      </div>
                      <input
                        type="range"
                        min={rfPowerCapabilities.range.min * 100}
                        max={rfPowerCapabilities.range.max * 100}
                        step={rfPowerCapabilities.range.step * 100}
                        value={localRFPower * 100}
                        disabled={!connected}
                        onChange={(e) => {
                          isDraggingRF.current = true;
                          setLocalRFPower(parseFloat(e.target.value) / 100);
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      />
                      <div className="flex justify-between items-center mt-3">
                        <span className="text-xs uppercase text-[#8e9299]">RF Level</span>
                        <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFLevel * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={localRFLevel}
                        disabled={!connected}
                        onChange={(e) => {
                          isDraggingRFLevel.current = true;
                          setLocalRFLevel(parseFloat(e.target.value));
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      />
                      <div className="flex justify-between items-center mt-3">
                        <span className="text-xs uppercase text-[#8e9299]">DNR Level</span>
                        <span className="text-sm text-emerald-500 font-bold">Lvl {Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)}
                        step="1"
                        value={Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}
                        disabled={!connected || !nrCapabilities.supported}
                        onChange={(e) => {
                          isDraggingNR.current = true;
                          const stepIdx = parseInt(e.target.value);
                          const calculated = nrCapabilities.range.min + (stepIdx * nrCapabilities.range.step);
                          setLocalNRLevel(Math.min(nrCapabilities.range.max, calculated));
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed"
                        )}
                      />
                      {nbCapabilities.supported && (
                        <>
                          <div className="flex justify-between items-center mt-3">
                            <span className="text-xs uppercase text-[#8e9299]">NB Level</span>
                            <span className="text-sm text-emerald-500 font-bold">Lvl {Math.round(localNBLevel)}</span>
                          </div>
                          <input
                            type="range"
                            min={nbCapabilities.range.min}
                            max={nbCapabilities.range.max}
                            step={nbCapabilities.range.step}
                            value={localNBLevel}
                            disabled={!connected}
                            onChange={(e) => {
                              isDraggingNB.current = true;
                              setLocalNBLevel(parseFloat(e.target.value));
                            }}
                            className={cn(
                              "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                              !connected && "opacity-50 cursor-not-allowed"
                            )}
                          />
                        </>
                      )}
                    </div>
                    {/* POTA — absolutely positioned so it never influences the box height */}
                    {potaEnabled && activeCompactPowerTab === 'pota' && (
                      <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
                        {renderSpotsTable(false)}
                      </div>
                    )}
                    {/* SOTA — absolutely positioned so it never influences the box height */}
                    {sotaEnabled && activeCompactPowerTab === 'sota' && (
                      <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
                        {renderSotaSpotsTable()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Column: Frequency & Controls */}
            <div className="lg:col-span-2 space-y-6">
            
            {/* Frequency Displays */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={cn(
                "bg-[#151619] p-6 rounded-xl border transition-all",
                status.isSplit
                  ? (status.txVFO === "VFOA" ? "border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.1)]" : "border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.1)]")
                  : (status.vfo === "VFOA" ? "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]" : "border-[#2a2b2e]")
              )}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[0.625rem] uppercase font-bold",
                      status.isSplit
                        ? (status.txVFO === "VFOA" ? "text-red-500" : "text-amber-500")
                        : "text-[#8e9299]"
                    )}>VFO A</span>
                    <div className="flex items-center gap-1">
                      <select 
                        value={vfoStep}
                        onChange={(e) => setVfoStep(parseFloat(e.target.value))}
                        disabled={!connected}
                        className={cn(
                          "bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[0.5625rem] px-1 py-0.5 focus:outline-none focus:border-emerald-500 text-[#8e9299]",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                      </select>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => adjustVfoFrequency('A', 1)}
                          disabled={!connected}
                          className="p-0.5 bg-[#1a1b1e] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                          title="Frequency Up"
                        >
                          <ChevronUp size={10} />
                        </button>
                        <button
                          onClick={() => adjustVfoFrequency('A', -1)}
                          disabled={!connected}
                          className="p-0.5 bg-[#1a1b1e] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                          title="Frequency Down"
                        >
                          <ChevronDown size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {(status.vfo === "VFOA" || (status.isSplit && status.txVFO === "VFOA")) && (
                    <Activity size={12} className={cn(
                      status.isSplit && status.txVFO === "VFOA" ? "text-red-500" : "text-emerald-500",
                      "animate-pulse"
                    )} />
                  )}
                </div>
                <div className="relative group flex items-baseline gap-2">
                  <input
                    id="vfoA-input"
                    type="number"
                    step={vfoStep}
                    value={inputVfoA}
                    onChange={(e) => setInputVfoA(e.target.value)}
                    disabled={!connected}
                    onBlur={() => {
                      const val = parseFloat(inputVfoA);
                      if (!isNaN(val)) {
                        handleSetFreq(Math.round(val * 1000000).toString());
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className={cn(
                      "w-full bg-white/5 text-4xl font-bold tracking-tighter font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg transition-all cursor-text py-1 px-2 border",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.isSplit
                        ? (status.txVFO === "VFOA" 
                            ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" 
                            : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
                        : "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50"
                    )}
                    title="Click to edit frequency"
                  />
                  <span className={cn(
                    "text-xs font-bold",
                    status.isSplit
                      ? (status.txVFO === "VFOA" ? "text-red-500/50" : "text-amber-500/50")
                      : "text-emerald-500/50"
                  )}>MHz</span>
                  <Pencil size={14} className={cn(
                    "absolute right-12 top-1/2 -translate-y-1/2 transition-opacity pointer-events-none",
                    status.isSplit
                      ? (status.txVFO === "VFOA" ? "text-red-500/30" : "text-amber-500/30")
                      : "text-emerald-500/30"
                  )} />
                </div>
                <button
                  onClick={() => handleSetVFO("VFOA")}
                  disabled={!connected}
                  className={cn(
                    "mt-4 w-full py-1 text-[0.625rem] uppercase border border-[#2a2b2e] rounded hover:bg-[#2a2b2e] transition-colors",
                    !connected && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Select VFO A
                </button>
              </div>

              <div className={cn(
                "bg-[#151619] p-6 rounded-xl border transition-all",
                status.isSplit
                  ? (status.txVFO === "VFOB" ? "border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.1)]" : "border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.1)]")
                  : (status?.vfo === "VFOB" ? "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]" : "border-[#2a2b2e]")
              )}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[0.625rem] uppercase font-bold",
                      status.isSplit
                        ? (status.txVFO === "VFOB" ? "text-red-500" : "text-amber-500")
                        : "text-[#8e9299]"
                    )}>VFO B</span>
                    <button
                      onClick={handleToggleSplit}
                      disabled={!connected || !vfoSupported}
                      className={cn(
                        "px-2 py-0.5 rounded text-[0.5rem] font-bold uppercase transition-all border",
                        (!connected || !vfoSupported) && "opacity-50 cursor-not-allowed",
                        status.isSplit
                          ? "bg-red-500 text-white border-red-500"
                          : "bg-red-500/10 text-red-500 border-red-500/30 hover:bg-red-500/20"
                      )}
                    >
                      SPLIT
                    </button>
                    <div className="flex items-center gap-1">
                      <select 
                        value={vfoStep}
                        onChange={(e) => setVfoStep(parseFloat(e.target.value))}
                        disabled={!connected}
                        className={cn(
                          "bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[0.5625rem] px-1 py-0.5 focus:outline-none focus:border-emerald-500 text-[#8e9299]",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                      </select>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => adjustVfoFrequency('B', 1)}
                          disabled={!connected}
                          className="p-0.5 bg-[#1a1b1e] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                          title="Frequency Up"
                        >
                          <ChevronUp size={10} />
                        </button>
                        <button
                          onClick={() => adjustVfoFrequency('B', -1)}
                          disabled={!connected}
                          className="p-0.5 bg-[#1a1b1e] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                          title="Frequency Down"
                        >
                          <ChevronDown size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {(status?.vfo === "VFOB" || (status.isSplit && status.txVFO === "VFOB")) && (
                    <Activity size={12} className={cn(
                      status.isSplit && status.txVFO === "VFOB" ? "text-red-500" : "text-emerald-500",
                      "animate-pulse"
                    )} />
                  )}
                </div>
                <div className="relative group flex items-baseline gap-2">
                  <input
                    id="vfoB-input"
                    type="number"
                    step={vfoStep}
                    value={inputVfoB}
                    onChange={(e) => setInputVfoB(e.target.value)}
                    disabled={!connected}
                    onBlur={() => {
                      const val = parseFloat(inputVfoB);
                      if (!isNaN(val)) {
                        handleSetFreq(Math.round(val * 1000000).toString());
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className={cn(
                      "w-full bg-white/5 text-4xl font-bold tracking-tighter font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg transition-all cursor-text py-1 px-2 border",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.isSplit
                        ? (status.txVFO === "VFOB" 
                            ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" 
                            : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
                        : "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50"
                    )}
                    title="Click to edit frequency"
                  />
                  <span className={cn(
                    "text-xs font-bold",
                    status.isSplit
                      ? (status.txVFO === "VFOB" ? "text-red-500/50" : "text-amber-500/50")
                      : "text-emerald-500/50"
                  )}>MHz</span>
                  <Pencil size={14} className={cn(
                    "absolute right-12 top-1/2 -translate-y-1/2 transition-opacity pointer-events-none",
                    status.isSplit
                      ? (status.txVFO === "VFOB" ? "text-red-500/30" : "text-amber-500/30")
                      : "text-emerald-500/30"
                  )} />
                </div>
                <button
                  onClick={() => handleSetVFO("VFOB")}
                  disabled={!connected || !vfoSupported}
                  className={cn(
                    "mt-4 w-full py-1 text-[0.625rem] uppercase border border-[#2a2b2e] rounded hover:bg-[#2a2b2e] transition-colors",
                    (!connected || !vfoSupported) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  Select VFO B
                </button>
              </div>
            </div>

            {/* Main Controls Grid */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Settings size={14} />
                  <span className="text-[0.625rem] uppercase tracking-widest font-bold">Quick Controls</span>
                </div>
                <button 
                  onClick={() => setIsDesktopControlsCollapsed(!isDesktopControlsCollapsed)}
                  className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                  title={isDesktopControlsCollapsed ? "Expand Controls" : "Collapse Controls"}
                >
                  {isDesktopControlsCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!isDesktopControlsCollapsed && (
                <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <button 
                    onClick={() => handleSetPTT(!status.ptt)}
                    disabled={!connected}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.ptt 
                        ? "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Mic size={20} />
                    <span className="text-[0.625rem] uppercase font-bold">PTT</span>
                  </button>

                  <button
                    onClick={() => {
                      if (isTuning) return;
                      if (status.tuner) {
                        handleSetFunc("TUNER", false);
                      } else {
                        handleVfoOp("TUNE");
                      }
                    }}
                    disabled={!connected || isTuning}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2 group",
                      (!connected || isTuning) && "cursor-not-allowed",
                      isTuning
                        ? "bg-red-500/20 border-red-500 text-red-500"
                        : (status.tuner || tuneJustFinished)
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
                          : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <RefreshCw size={20} className={cn("transition-transform", isTuning ? "animate-spin" : "group-active:rotate-180")} />
                    <span className="text-[0.625rem] uppercase font-bold">Tune</span>
                  </button>

                  <button
                    onClick={cycleAttenuator}
                    disabled={!connected || attenuatorLevels.length === 0}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-1",
                      (!connected || attenuatorLevels.length === 0) && "opacity-50 cursor-not-allowed",
                      status.attenuation > 0 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Signal size={20} />
                    <div className="flex flex-col items-center">
                      <span className="text-[0.625rem] uppercase font-bold">Atten</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {getAttenuatorLabel()}
                      </span>
                    </div>
                  </button>

                  <button 
                    onClick={cyclePreamp}
                    disabled={!connected || preampLevels.length === 0}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-1",
                      (!connected || preampLevels.length === 0) && "opacity-50 cursor-not-allowed",
                      status.preamp > 0 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Zap size={20} />
                    <div className="flex flex-col items-center">
                      <span className="text-[0.625rem] uppercase font-bold">Preamp</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {getPreampLabel()}
                      </span>
                    </div>
                  </button>

                  <button 
                    onClick={() => handleSetFunc("NB", !status.nb)}
                    disabled={!connected || !nbCapabilities.supported}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                      (!connected || !nbCapabilities.supported) && "opacity-50 cursor-not-allowed",
                      status.nb 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Waves size={20} />
                    <div className="flex flex-col items-center">
                      <span className="text-[0.625rem] uppercase font-bold">NB</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {status.nb ? "ON" : "OFF"}
                      </span>
                    </div>
                  </button>

                  <button 
                    onClick={() => handleSetFunc("NR", !status.nr)}
                    disabled={!connected || !nrCapabilities.supported}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                      (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed",
                      status.nr 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Activity size={20} />
                    <div className="flex flex-col items-center">
                      <span className="text-[0.625rem] uppercase font-bold">DNR</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {status.nr ? "ON" : "OFF"}
                      </span>
                    </div>
                  </button>

                  <button 
                    onClick={() => handleSetFunc("ANF", !status.anf)}
                    disabled={!connected || !anfCapabilities.supported}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                      (!connected || !anfCapabilities.supported) && "opacity-50 cursor-not-allowed",
                      status.anf 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Activity size={20} />
                    <div className="flex flex-col items-center">
                      <span className="text-[0.625rem] uppercase font-bold">ANF</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {status.anf ? "ON" : "OFF"}
                      </span>
                    </div>
                  </button>

                  <button 
                    onClick={cycleAgc}
                    disabled={!connected || agcLevels.length === 0}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-1",
                      (!connected || agcLevels.length === 0) && "opacity-50 cursor-not-allowed",
                      status.agc > 0 
                        ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <Settings size={20} />
                    <div className="flex flex-col items-center">
                      <span className="text-[0.625rem] uppercase font-bold">AGC</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {getAgcLabel()}
                      </span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Mode & Bandwidth */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
                <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <Waves size={14} />
                    <span className="text-[0.625rem] uppercase tracking-widest font-bold">Mode Selection</span>
                  </div>
                  <button 
                    onClick={() => setIsDesktopModeCollapsed(!isDesktopModeCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isDesktopModeCollapsed ? "Expand Mode Selection" : "Collapse Mode Selection"}
                  >
                    {isDesktopModeCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
                {!isDesktopModeCollapsed && (
                  <div className="p-6">
                    <select 
                      value={localMode}
                      onChange={(e) => handleSetMode(e.target.value)}
                      disabled={!connected}
                      className={cn(
                        "w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded p-2 text-sm focus:outline-none focus:border-emerald-500",
                        !connected && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
                <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <Settings size={14} />
                    <span className="text-[0.625rem] uppercase tracking-widest font-bold">Filter Bandwidth</span>
                  </div>
                  <button 
                    onClick={() => setIsDesktopBwCollapsed(!isDesktopBwCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isDesktopBwCollapsed ? "Expand Filter Bandwidth" : "Collapse Filter Bandwidth"}
                  >
                    {isDesktopBwCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
                {!isDesktopBwCollapsed && (
                  <div className="p-6">
                    <select 
                      value={status?.bandwidth || "2400"}
                      onChange={(e) => handleSetBw(parseInt(e.target.value))}
                      disabled={!connected}
                      className={cn(
                        "w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded p-2 text-sm focus:outline-none focus:border-emerald-500",
                        !connected && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bw} Hz</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Video Feed Section */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Monitor size={14} />
                  <span className="text-[0.625rem] uppercase tracking-widest font-bold">Video & Audio</span>
                </div>
                <div className="flex items-center gap-3">
                  {audioStatus === "playing" && !localAudioReady ? (
                    <button
                      onClick={handleJoinAudio}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[0.5rem] uppercase font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all border border-blue-500/30 mr-1"
                      title="Join the active audio session"
                    >
                      <Headphones size={10} />
                      {audioWasRestarted ? "Restarted — Join Audio" : "Join Audio"}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 mr-1">
                      <button
                        onClick={() => setInboundMuted(!inboundMuted)}
                        disabled={audioStatus !== "playing" || !localAudioReady}
                        className={cn(
                          "p-1 rounded-lg transition-all",
                          (audioStatus !== "playing" || !localAudioReady) ? "opacity-30 cursor-not-allowed" :
                          inboundMuted ? "text-red-500 bg-red-500/10" : "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
                        )}
                        title={inboundMuted ? "Unmute Inbound Audio" : "Mute Inbound Audio"}
                      >
                        {inboundMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
                      <button
                        onClick={() => {
                          const newMuted = !outboundMuted;
                          setOutboundMuted(newMuted);
                          if (newMuted) {
                            socket?.emit("mic-mute-notify");
                          } else {
                            socket?.emit("mic-unmute-request");
                          }
                        }}
                        disabled={audioStatus !== "playing" || !audioSettings.outboundEnabled || !localAudioReady}
                        className={cn(
                          "p-1 rounded-lg transition-all",
                          (audioStatus !== "playing" || !audioSettings.outboundEnabled || !localAudioReady) ? "opacity-30 cursor-not-allowed" :
                          outboundMuted ? "text-red-500 bg-red-500/10" : "text-blue-500 bg-blue-500/10 hover:bg-blue-500/20"
                        )}
                        title={outboundMuted ? "Unmute Outbound Audio" : "Mute Outbound Audio"}
                      >
                        {outboundMuted ? <MicOff size={12} /> : <Mic size={12} />}
                      </button>
                    </div>
                  )}
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    videoStatus === "streaming" ? "bg-emerald-500 animate-pulse" : "bg-[#2a2b2e]"
                  )} />
                  <button
                    onClick={() => {
                      setIsVideoSettingsOpen(true);
                      socket?.emit("get-video-devices");
                      socket?.emit("get-audio-devices");
                      if (isElectronSource) enumerateVideoDevices();
                    }}
                    className="p-1.5 hover:bg-[#2a2b2e] rounded-lg text-[#8e9299] transition-all"
                    title="Video & Audio Settings"
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    onClick={() => setIsVideoCollapsed(!isVideoCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isVideoCollapsed ? "Expand Video & Audio" : "Collapse Video & Audio"}
                  >
                    {isVideoCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              {!isVideoCollapsed && (
                <div className="relative aspect-video bg-black flex items-center justify-center">
                  <video ref={videoPreviewCallbackRef} autoPlay muted playsInline
                    className={cn("w-full h-full object-contain", (!isElectronSource || videoStatus !== "streaming") && "hidden")} />
                  <canvas ref={videoCanvasRef}
                    className={cn("w-full h-full object-contain", (isElectronSource || videoStatus !== "streaming") && "hidden")} />
                  {videoStatus !== "streaming" && (
                    <div className="flex flex-col items-center gap-4 text-[#3a3b3e]">
                      <Monitor size={48} strokeWidth={1} />
                      <span className="text-[0.625rem] uppercase font-bold tracking-widest">Stream Stopped</span>
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
                      <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
                      <p className="text-sm text-red-400 font-medium">{videoError}</p>
                      {isElectronSource && (
                        <button
                          onClick={() => { setVideoError(null); socket?.emit("request-video-start"); }}
                          className="mt-4 px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-xs transition-colors"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {potaEnabled && (
              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden">
                <div className={cn("p-4 flex items-center justify-between bg-[#1a1b1e]", !potaSpotsCollapsed && "border-b border-[#2a2b2e]")}>
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <MapPin size={14} />
                    <span className="text-[0.625rem] uppercase tracking-widest font-bold">POTA Spots</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.5625rem] text-[#8e9299]">{filteredSpots.length} spot{filteredSpots.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setPotaSpotsCollapsed(!potaSpotsCollapsed)}
                      className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                      title={potaSpotsCollapsed ? "Expand Spots" : "Collapse Spots"}
                    >
                      {potaSpotsCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                    </button>
                  </div>
                </div>
                {!potaSpotsCollapsed && (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto custom-scrollbar">
                    {renderSpotsTable(true)}
                  </div>
                )}
              </div>
            )}
            {sotaEnabled && (
              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden">
                <div className={cn("p-4 flex items-center justify-between bg-[#1a1b1e]", !sotaSpotsCollapsed && "border-b border-[#2a2b2e]")}>
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <MapPin size={14} />
                    <span className="text-[0.625rem] uppercase tracking-widest font-bold">SOTA Spots</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[0.5625rem] text-[#8e9299]">{filteredSotaSpots.length} spot{filteredSotaSpots.length !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setSotaSpotsCollapsed(!sotaSpotsCollapsed)}
                      className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                      title={sotaSpotsCollapsed ? "Expand Spots" : "Collapse Spots"}
                    >
                      {sotaSpotsCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                    </button>
                  </div>
                </div>
                {!sotaSpotsCollapsed && (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto custom-scrollbar">
                    {renderSotaSpotsTable()}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Meters & Graphs */}
          <div className="space-y-6">

            {/* RF Power & DNR Slider */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Gauge size={14} />
                  <span className="text-[0.625rem] uppercase tracking-widest font-bold">RF Power & Levels</span>
                </div>
                <button 
                  onClick={() => setIsDesktopRFPowerCollapsed(!isDesktopRFPowerCollapsed)}
                  className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                  title={isDesktopRFPowerCollapsed ? "Expand RF Power" : "Collapse RF Power"}
                >
                  {isDesktopRFPowerCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!isDesktopRFPowerCollapsed && (
                <div className="p-6 space-y-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-[#8e9299]">
                        <Gauge size={14} />
                        <span className="text-[0.625rem] uppercase tracking-widest">RF Power</span>
                      </div>
                      <span className="text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
                    </div>
                    <input 
                      type="range" 
                      min={rfPowerCapabilities.range.min * 100} 
                      max={rfPowerCapabilities.range.max * 100} 
                      step={rfPowerCapabilities.range.step * 100}
                      value={localRFPower * 100}
                      disabled={!connected}
                      onChange={(e) => {
                        isDraggingRF.current = true;
                        setLocalRFPower(parseFloat(e.target.value) / 100);
                      }}
                      className={cn(
                        "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                        !connected && "opacity-50 cursor-not-allowed"
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-[#8e9299]">
                        <Signal size={14} />
                        <span className="text-[0.625rem] uppercase tracking-widest">RF Level</span>
                      </div>
                      <span className="text-emerald-500 font-bold">{Math.round(localRFLevel * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.1"
                      value={localRFLevel}
                      disabled={!connected}
                      onChange={(e) => {
                        isDraggingRFLevel.current = true;
                        setLocalRFLevel(parseFloat(e.target.value));
                      }}
                      className={cn(
                        "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                        !connected && "opacity-50 cursor-not-allowed"
                      )}
                    />
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 text-[#8e9299]">
                        <Activity size={14} />
                        <span className="text-[0.625rem] uppercase tracking-widest">DNR Level</span>
                      </div>
                      <span className="text-emerald-500 font-bold">Level {Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)} 
                      step="1"
                      value={Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}
                      disabled={!connected || !nrCapabilities.supported}
                      onChange={(e) => {
                        isDraggingNR.current = true;
                        const stepIdx = parseInt(e.target.value);
                        const calculated = nrCapabilities.range.min + (stepIdx * nrCapabilities.range.step);
                        setLocalNRLevel(Math.min(nrCapabilities.range.max, calculated));
                      }}
                      className={cn(
                        "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                        (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed"
                      )}
                    />
                  </div>

                  {nbCapabilities.supported && (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-[#8e9299]">
                          <Waves size={14} />
                          <span className="text-[0.625rem] uppercase tracking-widest">NB Level</span>
                        </div>
                        <span className="text-emerald-500 font-bold">Level {Math.round(localNBLevel)}</span>
                      </div>
                      <input 
                        type="range" 
                        min={nbCapabilities.range.min}
                        max={nbCapabilities.range.max}
                        step={nbCapabilities.range.step}
                        value={localNBLevel}
                        disabled={!connected}
                        onChange={(e) => {
                          isDraggingNB.current = true;
                          setLocalNBLevel(parseFloat(e.target.value));
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* S-Meter / Power Meter Graph */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  {status.ptt ? <Gauge size={14} className="text-red-500" /> : <Signal size={14} />}
                  <span className={cn(
                    "text-[0.625rem] uppercase tracking-widest font-bold",
                    status.ptt ? "text-red-500" : "text-[#8e9299]"
                  )}>
                    {status.ptt ? "POWER OUT" : "S-Meter"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-xs font-mono font-bold",
                    status.ptt ? "text-red-500" : "text-emerald-500"
                  )}>
                    {status.ptt 
                      ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                      : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`
                    }
                  </span>
                  <button 
                    onClick={() => setIsDesktopSMeterCollapsed(!isDesktopSMeterCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isDesktopSMeterCollapsed ? "Expand S-Meter" : "Collapse S-Meter"}
                  >
                    {isDesktopSMeterCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              {!isDesktopSMeterCollapsed && (
                <div className="p-6 space-y-6 h-[280px]">
                  {/* Bar Graph */}
                  <div className="space-y-1">
                    <div className="h-4 bg-[#0a0a0a] rounded border border-[#2a2b2e] relative overflow-hidden">
                      <div 
                        className={cn(
                          "h-full transition-all duration-150 ease-out",
                          status.ptt ? "bg-red-500" : "bg-gradient-to-r from-blue-600 via-emerald-500 to-red-600"
                        )}
                        style={{ 
                          width: status.ptt 
                            ? `${Math.max(0, Math.min(100, status.powerMeter * 100))}%`
                            : `${Math.max(0, Math.min(100, (Math.min(0, status.smeter) + 54) / 54 * 100))}%` 
                        }}
                      />
                      {/* Scale Overlay */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {status.ptt ? (
                          <>
                            <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '0%' }} />
                            <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '25%' }} />
                            <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '50%' }} />
                            <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '75%' }} />
                          </>
                        ) : (
                          <>
                            <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '0%' }} />
                            <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '55.5%' }} />
                          </>
                        )}
                        <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '100%' }} />
                      </div>
                    </div>
                    <div className="flex justify-between text-[0.5rem] text-[#4a4b4e] font-mono uppercase tracking-tighter">
                      {status.ptt ? (
                        <>
                          <span>0W</span>
                          <span>25W</span>
                          <span>50W</span>
                          <span>75W</span>
                          <span>100W</span>
                        </>
                      ) : (
                        <>
                          <span>S0</span>
                          <span className="ml-[-10%]">S5</span>
                          <span>S9</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Line Graph (History) */}
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                        <XAxis dataKey="time" hide />
                        <YAxis 
                          domain={status.ptt ? [0, 1] : [-54, 0]} 
                          ticks={status.ptt ? [0, 0.25, 0.5, 0.75, 1] : [-54, -24, 0]}
                          tickFormatter={(val) => {
                            if (status.ptt) return `${Math.round(val * 100)}W`;
                            if (val === -54) return "S0";
                            if (val === -24) return "S5";
                            if (val === 0) return "S9";
                            return "";
                          }}
                          width={35}
                          style={{ fontSize: '8px', fill: '#4a4b4e' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                          itemStyle={{ color: status.ptt ? '#ef4444' : '#10b981' }}
                          labelStyle={{ display: 'none' }}
                          formatter={(value: number, name: string, props: any) => {
                            const rawVal = props.payload?.smeter ?? value;
                            return [
                              status.ptt 
                                ? `${Math.round(value * 100)} Watts`
                                : rawVal > 0 ? `S9+${rawVal}dB` : `S${Math.round((rawVal + 54) / 6)}`,
                              status.ptt ? 'Power' : 'Signal'
                            ];
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey={status.ptt ? "powerMeter" : "smeterGraph"} 
                          stroke={status.ptt ? "#ef4444" : "#10b981"} 
                          strokeWidth={1.5} 
                          dot={false} 
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            {/* SWR Graph */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className={cn(
                  "flex items-center gap-2",
                  (status.swr ?? 1) > 3 ? "text-red-500" : "text-[#8e9299]"
                )}>
                  <Activity size={14} />
                  <span className="text-[0.625rem] uppercase tracking-widest font-bold">SWR Ratio</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-xs font-mono font-bold",
                    (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500"
                  )}>
                    {(status.swr ?? 1).toFixed(2)}
                  </span>
                  <button 
                    onClick={() => setIsDesktopSWRCollapsed(!isDesktopSWRCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isDesktopSWRCollapsed ? "Expand SWR Graph" : "Collapse SWR Graph"}
                  >
                    {isDesktopSWRCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              {!isDesktopSWRCollapsed && (
                <div className="p-6 h-[210px]">
                  <div className="h-full pb-8">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} />
                        <XAxis dataKey="time" hide />
                        <YAxis 
                          domain={[1, 4]} 
                          ticks={[1, 2, 3, 4]}
                          width={25}
                          style={{ fontSize: '8px', fill: '#4a4b4e' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                          itemStyle={{ color: (status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b' }}
                          formatter={(val: number, name: string, props: any) => [(props.payload?.swr ?? 1).toFixed(2), 'SWR']}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="swrGraph" 
                          stroke={(status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b'} 
                          strokeWidth={2} 
                          dot={false} 
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>

            {/* ALC Graph */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Waves size={14} />
                  <span className="text-[0.625rem] uppercase tracking-widest font-bold">ALC Level</span>
                </div>
                <button 
                  onClick={() => setIsDesktopALCCollapsed(!isDesktopALCCollapsed)}
                  className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                  title={isDesktopALCCollapsed ? "Expand ALC Graph" : "Collapse ALC Graph"}
                >
                  {isDesktopALCCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              </div>
              {!isDesktopALCCollapsed && (
                <div className="p-6 h-[210px]">
                  <div className="h-full pb-8">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} />
                        <XAxis dataKey="time" hide />
                        <YAxis 
                          domain={[0, 1]} 
                          width={45}
                          style={{ fontSize: '8px', fill: '#4a4b4e' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(val) => (val ?? 0).toFixed(1)}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                          itemStyle={{ color: '#3b82f6' }}
                          formatter={(value: number) => [(value ?? 0).toFixed(5), 'ALC']}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="alc" 
                          stroke="#3b82f6" 
                          strokeWidth={2} 
                          dot={false} 
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

        {/* Command Console */}
        {!isCompact && (
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-[#1a1b1e] px-4 py-2 border-b border-[#2a2b2e] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings size={14} className="text-[#8e9299]" />
                <span className="text-[0.625rem] uppercase font-bold tracking-widest text-[#8e9299]">Rigctld Command Console</span>
              </div>
              <button 
                onClick={() => setIsConsoleCollapsed(!isConsoleCollapsed)}
                className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                title={isConsoleCollapsed ? "Expand Console" : "Collapse Console"}
              >
                {isConsoleCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
              </button>
            </div>
            
            {!isConsoleCollapsed && (
              <div className="p-4 space-y-4">
                <div className="bg-[#0a0a0a] rounded border border-[#2a2b2e] h-40 overflow-y-auto p-3 font-mono text-[0.6875rem] space-y-1">
                  {consoleLogs.length === 0 ? (
                    <div className="text-[#4a4b4e] italic">No commands sent yet. Try "f" for frequency or "m" for mode.</div>
                  ) : (
                    consoleLogs.map((log, i) => (
                      <div key={i} className="border-b border-[#1a1b1e] pb-1 last:border-0">
                        <div className="flex justify-between opacity-50 text-[0.5625rem]">
                          <span>{log.time}</span>
                          <span>CMD: {log.cmd}</span>
                        </div>
                        <div className="text-emerald-500 mt-0.5">
                          <span className="text-[#8e9299] mr-2">&gt;</span>
                          {log.resp}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleSendRaw} className="flex gap-2">
                  <input 
                    type="text" 
                    value={rawCommand}
                    onChange={(e) => setRawCommand(e.target.value)}
                    disabled={!connected}
                    placeholder="Enter hamlib command (e.g. 'f', 'm', 'v', 't')..."
                    className={cn(
                      "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-[#4a4b4e]",
                      !connected && "opacity-50 cursor-not-allowed"
                    )}
                  />
                  <button 
                    type="submit"
                    disabled={!connected || !rawCommand.trim()}
                    className="px-6 py-2 bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 rounded font-bold uppercase text-xs hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* Footer Status Bar */}
        {!isPhone && !isCompact && (
          <footer className="bg-[#151619] px-6 py-3 rounded-xl border border-[#2a2b2e] flex justify-between items-center text-[0.625rem] uppercase tracking-widest text-[#8e9299]">
            <div className="flex gap-6">
              <span>Status: <span className={connected ? "text-emerald-500" : "text-red-500"}>{connected ? "Online" : "Offline"}</span></span>
              {!isCompact && (
                <span>Server: {connected ? `${host}:${port}` : "None"}</span>
              )}
            </div>
            <div className="flex gap-6">
              <span>Mode: <span className="text-white">{status.mode}</span></span>
              <span>BW: <span className="text-white">{status.bandwidth} Hz</span></span>
              <span>VFO: <span className="text-white">{status.vfo}</span></span>
            </div>
          </footer>
        )}

        {/* Portable Setup Modal */}
        {showSetupModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                    <Server size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold uppercase tracking-tight">Portable Setup</h2>
                    <p className="text-[0.625rem] text-[#8e9299] uppercase tracking-widest">Run RigControl locally on your computer</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowSetupModal(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-400">
                    <Monitor size={16} />
                    <h3 className="text-sm font-bold uppercase">1. Install the App</h3>
                  </div>
                  <p className="text-xs text-[#8e9299] leading-relaxed">
                    Click the <span className="text-blue-400 font-bold">INSTALL</span> button in the header to add RigControl to your desktop or home screen. This allows you to use the interface like a native application, even when offline.
                  </p>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <Zap size={16} />
                    <h3 className="text-sm font-bold uppercase">2. Run the Portable Backend</h3>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs text-[#8e9299] leading-relaxed">
                      To control your local radio without port forwarding, you need to run the backend server on the same computer as your radio.
                    </p>
                    <div className="bg-[#0a0a0a] p-4 rounded-lg border border-[#2a2b2e] space-y-3">
                      <p className="text-[0.625rem] text-emerald-500/70 font-bold uppercase">Quick Start Command:</p>
                      <code className="block text-[0.6875rem] text-white bg-black/50 p-3 rounded border border-white/5 break-all">
                        git clone https://github.com/example/rigcontrol-web.git<br/>
                        cd rigcontrol-web && npm install && npm start
                      </code>
                      <p className="text-[0.625rem] text-[#4a4b4e] italic">
                        * Requires Node.js and Hamlib (rigctld) installed on your system.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Settings size={16} />
                    <h3 className="text-sm font-bold uppercase">3. Configure Backend URL</h3>
                  </div>
                  <div className="space-y-4">
                    <p className="text-xs text-[#8e9299] leading-relaxed">
                      Once your local backend is running, point this app to it. If running on the same machine, use <code className="text-white">https://localhost:3000</code>.
                    </p>
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Local Backend URL</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={backendUrl}
                          onChange={(e) => setBackendUrl(e.target.value)}
                          className="flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                          placeholder="https://localhost:3000"
                        />
                        <button 
                          onClick={() => window.location.reload()}
                          className="px-4 py-2 bg-blue-500/20 text-blue-500 border border-blue-500/50 rounded text-xs font-bold uppercase hover:bg-blue-500 hover:text-white transition-all"
                        >
                          Apply
                        </button>
                      </div>
                      <p className="text-[0.5625rem] text-amber-500/70 italic">
                        * Changing this will refresh the page to reconnect.
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="p-6 bg-[#1a1b1e] border-t border-[#2a2b2e] flex justify-end">
                <button 
                  onClick={() => setShowSetupModal(false)}
                  className="px-6 py-2 bg-[#2a2b2e] hover:bg-[#3a3b3e] text-white rounded font-bold uppercase text-xs transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Video Settings Modal */}
      {isVideoSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-[#151619] w-full max-w-md rounded-2xl border border-[#2a2b2e] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
                  <Monitor size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight uppercase italic">Video & Audio Settings</h2>
                </div>
              </div>
              <button 
                onClick={() => setIsVideoSettingsOpen(false)}
                className="p-2 hover:bg-[#2a2b2e] rounded-xl text-[#8e9299] transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-4">
                <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Video Settings</h3>

                <div className="space-y-2">
                  <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Video Device</label>
                  <select
                    value={videoSettings.device}
                    onChange={(e) => {
                      const newSettings = { ...videoSettings, device: e.target.value };
                      setVideoSettings(newSettings);
                      socket?.emit("update-video-settings", newSettings);
                    }}
                    className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-all"
                  >
                    <option value="">Select Device</option>
                    {videoDevices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                  {!isElectronSource && videoDevices.length === 0 && (
                    <p className="text-[0.625rem] text-[#8e9299]">Device list is populated by the host Electron app.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Resolution (Width × Height)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={resolutionDraft.width}
                      onFocus={() => { isResolutionFocusedRef.current = true; }}
                      onBlur={() => { isResolutionFocusedRef.current = false; }}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = { ...resolutionDraftRef.current, width: raw };
                        resolutionDraftRef.current = next;
                        setResolutionDraft(next);
                        if (resolutionDebounceRef.current) clearTimeout(resolutionDebounceRef.current);
                        resolutionDebounceRef.current = setTimeout(() => {
                          const w = parseInt(resolutionDraftRef.current.width);
                          const h = parseInt(resolutionDraftRef.current.height);
                          if (w > 0 && w <= 7680 && h > 0 && h <= 4320) {
                            const newSettings = { ...videoSettingsRef.current, videoWidth: w, videoHeight: h };
                            setVideoSettings(newSettings);
                            socket?.emit("update-video-settings", newSettings);
                          }
                        }, 800);
                      }}
                      className="w-24 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-3 text-sm text-center focus:outline-none focus:border-emerald-500 transition-all"
                    />
                    <span className="text-[#8e9299] font-bold text-sm">×</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={resolutionDraft.height}
                      onFocus={() => { isResolutionFocusedRef.current = true; }}
                      onBlur={() => { isResolutionFocusedRef.current = false; }}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const next = { ...resolutionDraftRef.current, height: raw };
                        resolutionDraftRef.current = next;
                        setResolutionDraft(next);
                        if (resolutionDebounceRef.current) clearTimeout(resolutionDebounceRef.current);
                        resolutionDebounceRef.current = setTimeout(() => {
                          const w = parseInt(resolutionDraftRef.current.width);
                          const h = parseInt(resolutionDraftRef.current.height);
                          if (w > 0 && w <= 7680 && h > 0 && h <= 4320) {
                            const newSettings = { ...videoSettingsRef.current, videoWidth: w, videoHeight: h };
                            setVideoSettings(newSettings);
                            socket?.emit("update-video-settings", newSettings);
                          }
                        }, 800);
                      }}
                      className="w-24 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-3 text-sm text-center focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Framerate</label>
                  <select
                    value={videoSettings.framerate}
                    onChange={(e) => {
                      const newSettings = { ...videoSettings, framerate: e.target.value };
                      setVideoSettings(newSettings);
                      socket?.emit("update-video-settings", newSettings);
                    }}
                    className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-all"
                  >
                    <option value="">Select FPS</option>
                    <option value="5">5 fps</option>
                    <option value="10">10 fps</option>
                    <option value="15">15 fps</option>
                    <option value="24">24 fps</option>
                    <option value="30">30 fps</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => socket?.emit("request-video-start")}
                    disabled={!videoSettings.device || !videoSettings.framerate || videoStatus === "streaming"}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                      videoStatus === "streaming"
                        ? "bg-emerald-500/20 text-emerald-500 cursor-not-allowed"
                        : (!videoSettings.device || !videoSettings.framerate)
                          ? "bg-emerald-500/20 text-emerald-500/50 cursor-not-allowed"
                          : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                    )}
                  >
                    <Power size={16} />
                    Start Video
                  </button>
                  <button
                    onClick={() => socket?.emit("request-video-stop")}
                    disabled={videoStatus === "stopped"}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                      videoStatus === "stopped"
                        ? "bg-red-500/20 text-red-500 cursor-not-allowed"
                        : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                    )}
                  >
                    <X size={16} />
                    Stop Video
                  </button>
                </div>
              </div>

              {/* Audio Settings Section */}
              <div className="space-y-4 pt-4 border-t border-[#2a2b2e]">
                <div className="border-b border-blue-500/20 pb-1">
                  <h3 className="text-[0.625rem] uppercase text-blue-500 font-bold">Audio Settings (Bi-Directional)</h3>
                </div>

                {/* Local Client Audio — first so users configure their own devices before touching backend controls */}
                <div className="space-y-4">
                  <h4 className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Local Client Audio (Your System)</h4>

                  {activeMicClientId && clientId !== activeMicClientId && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-3">
                      <AlertTriangle className="text-amber-500 shrink-0" size={16} />
                      <p className="text-[0.625rem] text-amber-500/80 font-medium leading-tight">
                        Microphone is active in another session. Unmute your mic button to take over.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">Local Input (Microphone)</label>
                      {localAudioDevices.inputs.length > 0 && !localAudioDevices.inputs[0].label && (
                        <button
                          onClick={async () => {
                            try {
                              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                              stream.getTracks().forEach(t => t.stop());
                              const devices = await navigator.mediaDevices.enumerateDevices();
                              const inputs = devices.filter(d => d.kind === 'audioinput');
                              const outputs = devices.filter(d => d.kind === 'audiooutput');
                              setLocalAudioDevices({ inputs, outputs });
                            } catch (err) {
                              console.error("Failed to get mic permission:", err);
                            }
                          }}
                          className="text-[0.5rem] uppercase font-bold text-blue-500 hover:text-blue-400 transition-colors"
                        >
                          Request Permission
                        </button>
                      )}
                    </div>
                    <select
                      value={localAudioSettings.inputDevice}
                      onFocus={() => navigator.mediaDevices.enumerateDevices().then(devices => {
                        setLocalAudioDevices({ inputs: devices.filter(d => d.kind === 'audioinput'), outputs: devices.filter(d => d.kind === 'audiooutput') });
                      }).catch(console.error)}
                      onChange={(e) => {
                        const newSettings = { ...localAudioSettings, inputDevice: e.target.value };
                        setLocalAudioSettings(newSettings);
                        localStorage.setItem("local-audio-input", e.target.value);
                        // Re-trigger mic capture if active
                        if (audioStatus === "playing" && audioSettings.outboundEnabled && !outboundMuted && localAudioReady) {
                          stopMicCapture();
                          startMicCapture();
                        }
                      }}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                    >
                      <option value="default">Default Input</option>
                      {localAudioDevices.inputs.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 5)}`}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">Local Output (Speakers/Headphones)</label>
                    <select
                      value={localAudioSettings.outputDevice}
                      onFocus={() => navigator.mediaDevices.enumerateDevices().then(devices => {
                        setLocalAudioDevices({ inputs: devices.filter(d => d.kind === 'audioinput'), outputs: devices.filter(d => d.kind === 'audiooutput') });
                      }).catch(console.error)}
                      onChange={(e) => {
                        const newSettings = { ...localAudioSettings, outputDevice: e.target.value };
                        setLocalAudioSettings(newSettings);
                        localStorage.setItem("local-audio-output", e.target.value);
                        if (audioContextRef.current && typeof (audioContextRef.current as any).setSinkId === 'function') {
                          (audioContextRef.current as any).setSinkId(e.target.value).catch(console.error);
                        }
                      }}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                    >
                      <option value="default">Default Output</option>
                      {localAudioDevices.outputs.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 5)}`}</option>
                      ))}
                    </select>
                  </div>

                  <p className="text-[0.5rem] uppercase text-[#4a4b4e] font-bold">
                    Device changes apply immediately — no restart needed
                  </p>
                </div>

                {/* Backend Audio Engine — separated so users don't conflate device config with server control */}
                <div className="pt-4 border-t border-[#2a2b2e]/50">
                  <button
                    onClick={() => setIsBackendEngineCollapsed(!isBackendEngineCollapsed)}
                    className="w-full flex items-center justify-between mb-3 group"
                  >
                    <h4 className="text-[0.625rem] uppercase text-[#8e9299] font-bold group-hover:text-white transition-colors">Backend Audio Engine</h4>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[0.5rem] uppercase font-bold px-1.5 py-0.5 rounded",
                        audioEngineState.isReady ? "bg-emerald-500/20 text-emerald-500" : "bg-red-500/20 text-red-500"
                      )}>
                        {audioEngineState.isReady ? "READY" : "FAILED"}
                      </span>
                      <span className={cn(
                        "text-[0.5rem] uppercase font-bold px-1.5 py-0.5 rounded",
                        audioStatus === "playing" ? "bg-blue-500/20 text-blue-400" : "bg-[#2a2b2e] text-[#4a4b4e]"
                      )}>
                        {audioStatus === "playing" ? "RUNNING" : "STOPPED"}
                      </span>
                      {isBackendEngineCollapsed ? <ChevronDown size={12} className="text-[#8e9299]" /> : <ChevronUp size={12} className="text-[#8e9299]" />}
                    </div>
                  </button>

                  {!isBackendEngineCollapsed && (<>
                  {audioEngineState.error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
                      <AlertTriangle className="text-red-500 shrink-0" size={16} />
                      <p className="text-[0.625rem] text-red-500/80 font-medium leading-tight">
                        Audio Engine Error: {audioEngineState.error}
                      </p>
                    </div>
                  )}

                  <div className={cn("space-y-4", !audioEngineState.isReady && "opacity-50 pointer-events-none")}>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Backend Input (Mic/Line)</label>
                        <div className="flex items-center gap-2">
                          <span className="text-[0.5rem] uppercase text-[#4a4b4e]">Enabled</span>
                          <button
                            onClick={() => {
                              const newSettings = { ...audioSettings, inboundEnabled: !audioSettings.inboundEnabled };
                              setAudioSettings(newSettings);
                              socket?.emit("update-audio-settings", newSettings);
                            }}
                            className={cn(
                              "w-8 h-4 rounded-full transition-all relative",
                              audioSettings.inboundEnabled ? "bg-blue-500" : "bg-[#2a2b2e]"
                            )}
                          >
                            <div className={cn(
                              "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                              audioSettings.inboundEnabled ? "left-4.5" : "left-0.5"
                            )} />
                          </button>
                        </div>
                      </div>
                      <select
                        value={audioSettings.inputDevice}
                        onFocus={() => socket?.emit("get-audio-devices")}
                        onChange={(e) => {
                          const newSettings = { ...audioSettings, inputDevice: e.target.value, inboundEnabled: e.target.value !== "" };
                          setAudioSettings(newSettings);
                          socket?.emit("update-audio-settings", newSettings);
                        }}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                      >
                        <option value="">Select Backend Input</option>
                        {audioDevices.inputs.map(d => {
                          const api = d.hostAPIName.replace(/^Windows\s+/i, '');
                          const isWASAPI = /WASAPI/i.test(api);
                          const wasapiIncompatible = isWASAPI && d.defaultSampleRate !== 48000;
                          const rateK = d.defaultSampleRate / 1000;
                          const rate = d.defaultSampleRate ? `${rateK === Math.floor(rateK) ? rateK : rateK.toFixed(1)}k` : '';
                          const label = isWASAPI
                            ? `${d.name} [WASAPI${wasapiIncompatible ? ` – set device to 48k in Windows` : ''}]`
                            : `${d.name}${api || rate ? ` [${[api, rate].filter(Boolean).join(', ')}]` : ''}`;
                          return <option key={d.altName} value={d.altName} disabled={wasapiIncompatible}>{label}</option>;
                        })}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Backend Output (Speakers)</label>
                        <div className="flex items-center gap-2">
                          <span className="text-[0.5rem] uppercase text-[#4a4b4e]">Enabled</span>
                          <button
                            onClick={() => {
                              const newSettings = { ...audioSettings, outboundEnabled: !audioSettings.outboundEnabled };
                              setAudioSettings(newSettings);
                              socket?.emit("update-audio-settings", newSettings);
                            }}
                            className={cn(
                              "w-8 h-4 rounded-full transition-all relative",
                              audioSettings.outboundEnabled ? "bg-blue-500" : "bg-[#2a2b2e]"
                            )}
                          >
                            <div className={cn(
                              "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                              audioSettings.outboundEnabled ? "left-4.5" : "left-0.5"
                            )} />
                          </button>
                        </div>
                      </div>
                      <select
                        value={audioSettings.outputDevice}
                        onFocus={() => socket?.emit("get-audio-devices")}
                        onChange={(e) => {
                          const newSettings = { ...audioSettings, outputDevice: e.target.value, outboundEnabled: e.target.value !== "" };
                          setAudioSettings(newSettings);
                          socket?.emit("update-audio-settings", newSettings);
                        }}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                      >
                        <option value="">Select Backend Output</option>
                        {audioDevices.outputs.map(d => {
                          const api = d.hostAPIName.replace(/^Windows\s+/i, '');
                          const isWASAPI = /WASAPI/i.test(api);
                          const wasapiIncompatible = isWASAPI && d.defaultSampleRate !== 48000;
                          const rateK = d.defaultSampleRate / 1000;
                          const rate = d.defaultSampleRate ? `${rateK === Math.floor(rateK) ? rateK : rateK.toFixed(1)}k` : '';
                          const label = isWASAPI
                            ? `${d.name} [WASAPI${wasapiIncompatible ? ` – set device to 48k in Windows` : ''}]`
                            : `${d.name}${api || rate ? ` [${[api, rate].filter(Boolean).join(', ')}]` : ''}`;
                          return <option key={d.altName} value={d.altName} disabled={wasapiIncompatible}>{label}</option>;
                        })}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleStartAudio}
                      disabled={(!audioSettings.inputDevice && !audioSettings.outputDevice) || audioStatus === "playing"}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                        audioStatus === "playing"
                          ? "bg-blue-500/20 text-blue-500 cursor-not-allowed"
                          : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                      )}
                    >
                      <Power size={16} />
                      Start Backend Audio
                    </button>
                    <button
                      onClick={() => socket?.emit("control-audio", "stop")}
                      disabled={audioStatus === "stopped"}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                        audioStatus === "stopped"
                          ? "bg-red-500/20 text-red-500 cursor-not-allowed"
                          : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                      )}
                    >
                      <X size={16} />
                      Stop Backend Audio
                    </button>
                  </div>

                  <div className="flex items-center gap-2 p-3 bg-[#0a0a0a] border border-[#2a2b2e] rounded-xl">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      audioStatus === "playing" ? "bg-blue-500 animate-pulse" : "bg-[#2a2b2e]"
                    )} />
                    <span className="text-[0.625rem] uppercase font-bold text-[#8e9299]">
                      Backend Audio: {audioStatus.toUpperCase()}
                    </span>
                  </div>
                  </>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rigctld Settings Modal */}
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-4 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-emerald-500/10 text-emerald-500 rounded-lg">
                    <Settings size={16} />
                  </div>
                  <h2 className="text-sm font-bold uppercase tracking-tight">General Settings</h2>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Tab Bar */}
              <div className="flex border-b border-[#2a2b2e] bg-[#1a1b1e]">
                {(['rigctld', 'spots'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveSettingsTab(tab)}
                    className={cn(
                      "px-5 py-2.5 text-[0.625rem] font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px",
                      activeSettingsTab === tab
                        ? "border-emerald-500 text-emerald-400"
                        : "border-transparent text-[#8e9299] hover:text-white"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {activeSettingsTab === 'rigctld' && (
              <div className="p-6 space-y-6">
                {/* Client Side Settings */}
                <div className="space-y-4">
                  <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Client Side Settings (Connection to Rigctld)</h3>
                  <div className="space-y-1">
                    <label className="text-[0.625rem] uppercase text-[#8e9299]">Host Address</label>
                    <input 
                      type="text" 
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Port</label>
                      <input 
                        type="number" 
                        value={(port === null || isNaN(port)) ? "" : port}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setPort(isNaN(val) ? NaN : val);
                        }}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Rate</label>
                      <select 
                        value={pollRate}
                        onChange={(e) => handlePollRateChange(parseInt(e.target.value))}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
                      >
                        <option value={250}>250 ms</option>
                        <option value={500}>500 ms</option>
                        <option value={1000}>1000 ms</option>
                        <option value={1500}>1500 ms</option>
                        <option value={2000}>2000 ms</option>
                        <option value={5000}>5000 ms</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Server Side Settings */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-blue-500/20 pb-1">
                    <h3 className="text-[0.625rem] uppercase text-blue-500 font-bold">Server Side / Backend Settings</h3>
                    <span className="text-[0.5rem] text-[#8e9299] font-medium italic">Hamlib 4.7.0+ Recommended</span>
                  </div>
                  {!rigctldVersionInfo.isSupported && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/50 rounded-xl text-amber-500 text-[0.6875rem] animate-in slide-in-from-top-2">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle size={14} />
                        <p className="font-bold uppercase">Unsupported Hamlib Version</p>
                      </div>
                      <p className="opacity-80">
                        Detected rigctld version {rigctldVersionInfo.version}. Hamlib versions less than 4.7.0 are unsupported and may cause issues. Please upgrade to Hamlib 4.7.0 or newer.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[0.625rem] uppercase text-[#8e9299]">Rig Model (Hamlib Rig #)</label>
                    <select 
                      value={rigctldSettings.rigNumber}
                      onChange={(e) => setRigctldSettings(prev => ({ ...prev, rigNumber: e.target.value }))}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                    >
                      <option value="">Select a Radio...</option>
                      {radios.map(r => (
                        <option key={`${r.id}-${r.mfg}-${r.model}`} value={r.id}>
                          {r.id}: {r.mfg} {r.model}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.625rem] uppercase text-[#8e9299]">Serial Port (e.g. /dev/ttyUSB0 or COM3)</label>
                    <input 
                      type="text"
                      value={rigctldSettings.serialPort}
                      onChange={(e) => setRigctldSettings(prev => ({ ...prev, serialPort: e.target.value }))}
                      placeholder="/dev/ttyUSB0"
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Server Port</label>
                      <input 
                        type="text"
                        value={rigctldSettings.portNumber}
                        onChange={(e) => setRigctldSettings(prev => ({ ...prev, portNumber: e.target.value }))}
                        placeholder="4532"
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Serial Speed</label>
                      <input 
                        type="text"
                        value={rigctldSettings.serialPortSpeed}
                        onChange={(e) => setRigctldSettings(prev => ({ ...prev, serialPortSpeed: e.target.value }))}
                        placeholder="38400"
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[0.625rem] uppercase text-[#8e9299]">Listen Address</label>
                    <input 
                      type="text"
                      value={rigctldSettings.ipAddress}
                      onChange={(e) => setRigctldSettings(prev => ({ ...prev, ipAddress: e.target.value }))}
                      placeholder="127.0.0.1"
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
                    />
                  </div>
                </div>

                <div className="pt-4 space-y-3">
                  <div className="flex items-center justify-between text-[0.5rem] text-[#8e9299] opacity-50 uppercase font-bold tracking-widest border-t border-[#2a2b2e] pt-4">
                    <span>App Version</span>
                    <span>v04.14.2026-Alpha3</span>
                  </div>

                  {rigctldProcessStatus === "already_running" && (
                    <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-[0.6875rem] animate-in slide-in-from-top-2">
                      <p className="font-bold uppercase mb-1">Process Conflict</p>
                      <p className="opacity-80">rigctld is already running on the system. You must stop it or kill it to start a new instance from this app.</p>
                      <button 
                        onClick={() => socket?.emit("kill-existing-rigctld")}
                        className="mt-2 w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold uppercase text-[0.625rem] transition-all"
                      >
                        Kill and Restart
                      </button>
                    </div>
                  )}

                  {testResult && (
                    <div className={cn(
                      "p-3 rounded-lg border text-[0.6875rem] animate-in slide-in-from-top-2",
                      testResult.success ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400" : "bg-red-500/10 border-red-500/50 text-red-400"
                    )}>
                      <p className="font-bold uppercase mb-1">{testResult.success ? "Test Passed" : "Test Failed"}</p>
                      <p className="opacity-80">{testResult.message}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between p-3 bg-[#0a0a0a] border border-[#2a2b2e] rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        rigctldProcessStatus === "running" ? "bg-emerald-500 animate-pulse" : 
                        rigctldProcessStatus === "error" || rigctldProcessStatus === "already_running" ? "bg-red-500" : "bg-[#2a2b2e]"
                      )} />
                      <span className="text-[0.625rem] uppercase font-bold text-[#8e9299]">
                        Status: {rigctldProcessStatus.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => socket?.emit("test-rigctld", rigctldSettings)}
                        disabled={rigctldProcessStatus === "running"}
                        className={cn(
                          "px-3 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                          rigctldProcessStatus === "running" 
                            ? "bg-gray-500/10 text-gray-500 border border-gray-500/20 cursor-not-allowed" 
                            : "bg-blue-500/10 text-blue-500 border border-blue-500/50 hover:bg-blue-500 hover:text-white"
                        )}
                      >
                        Test
                      </button>
                      {rigctldProcessStatus === "running" ? (
                        <button 
                          onClick={() => {
                            socket?.emit("set-autoconnect-eligible", false);
                            socket?.emit("stop-rigctld");
                          }}
                          className="px-3 py-1 bg-red-500/10 text-red-500 border border-red-500/50 rounded text-[0.625rem] font-bold uppercase hover:bg-red-500 hover:text-white transition-all"
                        >
                          Stop
                        </button>
                      ) : (
                        <button 
                          onClick={() => socket?.emit("start-rigctld")}
                          className="px-3 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/50 rounded text-[0.625rem] font-bold uppercase hover:bg-emerald-500 hover:text-white transition-all"
                        >
                          Start
                        </button>
                      )}
                    </div>
                  </div>


                </div>

                {/* Log View */}
                <div className="space-y-2 pt-4 border-t border-[#2a2b2e]">
                  <div className="flex items-center justify-between">
                    <label className="text-[0.625rem] uppercase text-[#8e9299]">Process Logs</label>
                    <button 
                      onClick={() => setRigctldLogs([])}
                      className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg p-3 h-32 overflow-y-auto custom-scrollbar font-mono text-[0.625rem] space-y-1">
                    {rigctldLogs.length === 0 ? (
                      <p className="text-[#4a4b4e] italic">No logs available...</p>
                    ) : (
                      rigctldLogs.map((log, i) => (
                        <div key={i} className="text-[#8e9299] break-all">
                          <span className="text-emerald-500/50 mr-2">[{i+1}]</span>
                          {log}
                        </div>
                      ))
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>
              )}

              {activeSettingsTab === 'spots' && (
              <div className="p-6 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Spot Sources</h3>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="pota-enabled"
                      checked={potaEnabled}
                      onChange={(e) => setPotaEnabled(e.target.checked)}
                      className="w-4 h-4 accent-emerald-500 cursor-pointer"
                    />
                    <label htmlFor="pota-enabled" className="text-sm font-bold cursor-pointer select-none">POTA</label>
                    <span className="text-[0.5625rem] text-[#8e9299]">Parks on the Air</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="sota-enabled"
                      checked={sotaEnabled}
                      onChange={(e) => setSotaEnabled(e.target.checked)}
                      className="w-4 h-4 accent-amber-500 cursor-pointer"
                    />
                    <label htmlFor="sota-enabled" className="text-sm font-bold cursor-pointer select-none">SOTA</label>
                    <span className="text-[0.5625rem] text-[#8e9299]">Summits on the Air</span>
                  </div>
                </div>

                {potaEnabled && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <h3 className="text-[0.625rem] uppercase text-blue-500 font-bold border-b border-blue-500/20 pb-1">POTA Options</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Frequency</label>
                        <select
                          value={potaPollRate}
                          onChange={(e) => setPotaPollRate(Number(e.target.value))}
                          className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
                        >
                          {[1, 2, 3, 4, 5].map(m => (
                            <option key={m} value={m}>{m} min</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
                        <select
                          value={potaMaxAge}
                          onChange={(e) => setPotaMaxAge(Number(e.target.value))}
                          className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
                        >
                          {[1, 3, 5, 10, 15].map(m => (
                            <option key={m} value={m}>{m} min</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
                        {potaBandFilter.length > 0 && (
                          <button
                            onClick={() => setPotaBandFilter([])}
                            className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
                          >
                            Clear (ALL)
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {POTA_BANDS.map(({ label }) => {
                          const active = potaBandFilter.includes(label);
                          return (
                            <label
                              key={label}
                              className={cn(
                                "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
                                active
                                  ? "bg-emerald-500/10 border-emerald-500/60 text-emerald-400"
                                  : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/40 hover:text-white"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() =>
                                  setPotaBandFilter(prev =>
                                    active ? prev.filter(b => b !== label) : [...prev, label]
                                  )
                                }
                                className="w-3 h-3 accent-emerald-500 cursor-pointer flex-shrink-0"
                              />
                              <span className="text-[0.5625rem] font-bold uppercase">{label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {potaBandFilter.length === 0 && (
                        <p className="text-[0.5rem] text-[#4a4b4e] italic">No bands selected — showing all bands</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Mode Filter</label>
                      <div className="flex gap-2 flex-wrap">
                        {(['ALL', 'SSB', 'CW', 'FT8', 'FT4'] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setPotaModeFilter(m)}
                            className={cn(
                              "px-3 py-1 rounded text-[0.625rem] font-bold uppercase transition-all border",
                              potaModeFilter === m
                                ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                                : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/50 hover:text-white"
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {sotaEnabled && (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <h3 className="text-[0.625rem] uppercase text-amber-500 font-bold border-b border-amber-500/20 pb-1">SOTA Options</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Frequency</label>
                        <select
                          value={sotaPollRate}
                          onChange={(e) => setSotaPollRate(Number(e.target.value))}
                          className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 text-white appearance-none cursor-pointer"
                        >
                          {[1, 2, 3, 4, 5].map(m => (
                            <option key={m} value={m}>{m} min</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
                        <select
                          value={sotaMaxAge}
                          onChange={(e) => setSotaMaxAge(Number(e.target.value))}
                          className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 text-white appearance-none cursor-pointer"
                        >
                          {[1, 3, 5, 10, 15].map(m => (
                            <option key={m} value={m}>{m} min</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
                        {sotaBandFilter.length > 0 && (
                          <button
                            onClick={() => setSotaBandFilter([])}
                            className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
                          >
                            Clear (ALL)
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {POTA_BANDS.map(({ label }) => {
                          const active = sotaBandFilter.includes(label);
                          return (
                            <label
                              key={label}
                              className={cn(
                                "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
                                active
                                  ? "bg-amber-500/10 border-amber-500/60 text-amber-400"
                                  : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-amber-500/40 hover:text-white"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={active}
                                onChange={() =>
                                  setSotaBandFilter(prev =>
                                    active ? prev.filter(b => b !== label) : [...prev, label]
                                  )
                                }
                                className="w-3 h-3 accent-amber-500 cursor-pointer flex-shrink-0"
                              />
                              <span className="text-[0.5625rem] font-bold uppercase">{label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {sotaBandFilter.length === 0 && (
                        <p className="text-[0.5rem] text-[#4a4b4e] italic">No bands selected — showing all bands</p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Mode Filter</label>
                      <div className="flex gap-2 flex-wrap">
                        {(['ALL', 'SSB', 'CW', 'FT8', 'FT4'] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => setSotaModeFilter(m)}
                            className={cn(
                              "px-3 py-1 rounded text-[0.625rem] font-bold uppercase transition-all border",
                              sotaModeFilter === m
                                ? "bg-amber-500/20 border-amber-500 text-amber-400"
                                : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-amber-500/50 hover:text-white"
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}

            </div>
          </div>
        )}

      </div>

      {/* Phone sticky PTT bar — sits outside the scroll container */}
      {isPhone && (
        <div className="flex-shrink-0 px-3 py-3 bg-[#151619] border-t border-[#2a2b2e]">
          <button
            onPointerDown={(e) => {
              if (!connected) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              handleSetPTT(true);
            }}
            onPointerUp={(e) => {
              if (!connected) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              handleSetPTT(false);
            }}
            onPointerCancel={(e) => {
              if (!connected) return;
              handleSetPTT(false);
            }}
            disabled={!connected}
            className={cn(
              "flex flex-col items-center justify-center w-full h-16 rounded-xl border transition-all gap-1 touch-none select-none",
              !connected && "opacity-50 cursor-not-allowed",
              status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
            )}
          >
            <Mic size={24} />
            <span className="text-xs uppercase font-bold leading-none">PTT</span>
          </button>
        </div>
      )}
    </div>
  );
}
