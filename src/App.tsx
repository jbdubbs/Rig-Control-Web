import React, { useState, useEffect, useRef } from "react";
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
  Monitor,
  Server,
  X,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Pencil,
  Volume2,
  Check,
  AlertCircle
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
  tuner: boolean;
  alc: number;
  powerMeter: number;
  vdd: number;
  timestamp: number;
}

const MODES_FALLBACK = [
  "USB", "LSB", "CW", "AM", "FM", "RTTY"
];

const BANDWIDTHS = [300, 500, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3200, 3500, 4000];

const VFO_STEPS = [0.000001, 0.00001, 0.0001, 0.001, 0.01, 0.1, 1, 10];

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
  tuner: false,
  alc: 0,
  powerMeter: 0,
  vdd: 13.8,
  timestamp: Date.now()
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
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
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem("backend-url") || window.location.origin);
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
    agcCapabilities: [] as string[]
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [radios, setRadios] = useState<{id: string, mfg: string, model: string}[]>([]);
  const [rigctldProcessStatus, setRigctldProcessStatus] = useState<"running" | "stopped" | "error" | "already_running">("stopped");
  const [videoStatus, setVideoStatus] = useState<"playing" | "paused" | "stopped">("stopped");
  const [videoSessionId, setVideoSessionId] = useState(Date.now());
  const [videoDevices, setVideoDevices] = useState<string[]>([]);
  const [videoSettings, setVideoSettings] = useState({
    device: "",
    resolution: "",
    framerate: ""
  });
  const [isVideoSettingsOpen, setIsVideoSettingsOpen] = useState(false);
  const [preampLevels, setPreampLevels] = useState<string[]>([]);
  const [attenuatorLevels, setAttenuatorLevels] = useState<string[]>([]);
  const [agcLevels, setAgcLevels] = useState<string[]>([]);
  const [rigctldLogs, setRigctldLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [testResult, setTestResult] = useState<{ success: boolean, message: string } | null>(null);
  const [isVideoCollapsed, setIsVideoCollapsed] = useState(false);
  const [isPhoneMeterCollapsed, setIsPhoneMeterCollapsed] = useState(false);
  const [isPhoneQuickControlsCollapsed, setIsPhoneQuickControlsCollapsed] = useState(false);
  const [isPhoneRFPowerCollapsed, setIsPhoneRFPowerCollapsed] = useState(false);
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
  const videoSettingsInitialized = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAttemptedAutoconnect = useRef(false);
  const isAutoconnectAttempt = useRef(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!isCompact || !(window as any).electron) return;

    const snap = () => {
      if (containerRef.current) {
        const height = containerRef.current.offsetHeight;
        const width = window.innerWidth;
        const padding = isCompact ? 16 : 64; // p-2 is 8px, so 16px total
        (window as any).electron.resizeWindow(width, height + padding);
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
  }, [isCompact]);

  useEffect(() => {
    if (videoSettings.device && !videoSettingsInitialized.current) {
      setIsVideoCollapsed(false);
      videoSettingsInitialized.current = true;
    }
  }, [videoSettings.device]);

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
        console.log("[SOCKET] Received settings-data", data);
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
        setSettingsLoaded(true);
        if (data.videoSettings) {
          setVideoSettings(data.videoSettings);
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

        // Handle autoconnect
        if (data.autoStart && !connectedRef.current && !hasAttemptedAutoconnect.current) {
          const isEligible = data.autoconnectEligible === true;
          if (isEligible) {
            hasAttemptedAutoconnect.current = true;
            isAutoconnectAttempt.current = true;
            const savedHost = data.clientHost || "127.0.0.1";
            const savedPort = data.clientPort || 4532;
            console.log(`[AUTOCONNECT] Attempting connection to ${savedHost}:${savedPort}`);
            socket.emit("connect-rig", { 
              host: savedHost, 
              port: savedPort
            });
          } else {
            console.log("[AUTOCONNECT] Not eligible for autoconnect");
          }
        }
      });
      socket.on("video-devices-list", (list: string[]) => {
        setVideoDevices(list);
      });
      socket.on("video-status", (status: "playing" | "paused" | "stopped") => {
        setVideoStatus(status);
        if (status === "playing") {
          setVideoSessionId(Date.now());
          setVideoError(null);
        }
      });
      socket.on("video-error", (msg: string) => {
        setVideoError(msg);
      });
      socket.on("radios-list", (list: any) => {
        const unique = Array.from(new Map(list.map((r: any) => [r.id, r])).values()) as any[];
        setRadios(unique);
      });
      socket.on("rigctld-status", (status: "running" | "stopped" | "error" | "already_running") => {
        setRigctldProcessStatus(status);
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
      socket.emit("get-settings");
      socket.emit("get-radios");
      socket.emit("get-video-devices");
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
        clientPort: port
      });
      localStorage.setItem("last-poll-rate", pollRate.toString());
      localStorage.setItem("last-host", host);
      localStorage.setItem("last-port", port.toString());
    }, 1000);
    return () => clearTimeout(timer);
  }, [rigctldSettings, host, port, pollRate, socket]);

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

  useEffect(() => {
    localStorage.setItem("is-compact", isCompact.toString());
    localStorage.setItem("is-compact-smeter-collapsed", isCompactSMeterCollapsed.toString());
    localStorage.setItem("is-compact-other-meter-collapsed", isCompactOtherMeterCollapsed.toString());
    localStorage.setItem("is-compact-controls-collapsed", isCompactControlsCollapsed.toString());
    localStorage.setItem("is-compact-rfpower-collapsed", isCompactRFPowerCollapsed.toString());
    localStorage.setItem("is-desktop-controls-collapsed", isDesktopControlsCollapsed.toString());
  }, [isCompact, isCompactSMeterCollapsed, isCompactOtherMeterCollapsed, isCompactControlsCollapsed, isCompactRFPowerCollapsed, isDesktopControlsCollapsed]);

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

  useEffect(() => {
    if (videoStatus === "playing") {
      setVideoSessionId(Date.now());
    }
  }, [isCompact, isPhone, videoStatus]);

  const findClosestDNRValue = (val: number) => {
    if (!nrCapabilities.range.step) return val;
    const steps = Math.round((val - nrCapabilities.range.min) / nrCapabilities.range.step);
    return nrCapabilities.range.min + (steps * nrCapabilities.range.step);
  };

  useEffect(() => {
    const newSocket = io(backendUrl);
    setSocket(newSocket);

    newSocket.on("rig-connected", () => {
      console.log("[RIG] Connected successfully");
      setConnected(true);
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
    skipPollsCount.current = 2;
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
    skipPollsCount.current = 2;
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
    skipPollsCount.current = 2;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), bandwidth: bwStr }));
    socket?.emit("set-mode", { mode: currentMode, bandwidth: bwStr });
  };

  const handleSetPTT = (state: boolean) => {
    skipPollsCount.current = 2;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), ptt: state }));
    socket?.emit("set-ptt", state);
  };

  const handleSetVFO = (vfo: string) => {
    skipPollsCount.current = 2;
    setStatus(prev => ({ ...(prev || DEFAULT_STATUS), vfo }));
    socket?.emit("set-vfo", vfo);
  };

  const handleToggleSplit = () => {
    if (status.isSplit) {
      const targetVFO = status.txVFO === "VFOA" ? "VFOB" : "VFOA";
      socket?.emit("set-split-vfo", { split: 0, txVFO: status.txVFO });
      handleSetVFO(targetVFO);
    } else {
      const txVFO = status.vfo === "VFOA" ? "VFOB" : "VFOA";
      socket?.emit("set-split-vfo", { split: 1, txVFO });
    }
  };

  const handlePollRateChange = (rate: number) => {
    setPollRate(rate);
    socket?.emit("set-poll-rate", rate);
  };

  const handleSetFunc = (func: string, state: boolean) => {
    const key = func.toLowerCase() as keyof RigStatus;
    skipPollsCount.current = 2;
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
      skipPollsCount.current = 2;
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
    socket?.emit("vfo-op", op);
  };

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

  return (
    <div className={cn(
      "bg-[#0a0a0a] text-[#e0e0e0] font-mono",
      isCompact ? "p-2 overflow-hidden h-fit" : "min-h-screen p-4 md:p-8"
    )}>
      <div 
        ref={containerRef}
        className={cn(
          "mx-auto space-y-4",
          isCompact ? "w-full" : "max-w-6xl space-y-6"
        )}
      >
        {/* Header / Connection */}
        <header className="bg-[#151619] rounded-xl border border-[#2a2b2e] shadow-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Signal size={24} className="text-emerald-500" />
            <h1 className="text-xl font-bold tracking-tighter uppercase italic">RigControl Web</h1>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={handleConnect}
              className={cn(
                "px-6 py-2 rounded-lg font-bold uppercase text-sm transition-all flex items-center gap-2",
                connected 
                  ? "bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white"
                  : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 hover:bg-emerald-500 hover:text-white"
              )}
            >
              <Power size={16} />
              {connected ? "Disconnect" : "Connect"}
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className={cn(
                "p-2 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg transition-all",
                rigctldProcessStatus === "running" ? "text-emerald-500 border-emerald-500/50" : "text-red-500 border-red-500/50"
              )}
              title="Rigctld Settings"
            >
              <Settings size={20} />
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

        {/* Main Interface */}
        {isPhone ? (
          <div className="space-y-3 animate-in fade-in duration-300">
            {/* Unified VFO & Mode/BW Box */}
            <div className={cn(
              "bg-[#151619] p-4 rounded-xl border shadow-lg space-y-4",
              status.vfo === "VFOA" ? "border-emerald-500/30" : "border-blue-500/30"
            )}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleSetVFO("VFOA")}
                    disabled={!connected}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all",
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
                    disabled={!connected}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                      !connected && "opacity-50 cursor-not-allowed",
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
                    disabled={!connected}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.isSplit 
                        ? "bg-red-500 text-white border border-red-500" 
                        : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
                    )}
                  >
                    SPLIT
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', 1)}
                      disabled={!connected}
                      className="p-1.5 bg-[#1a1b1e] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                      title="Frequency Up"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', -1)}
                      disabled={!connected}
                      className="p-1.5 bg-[#1a1b1e] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                      title="Frequency Down"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                  <select 
                    value={vfoStep}
                    onChange={(e) => setVfoStep(parseFloat(e.target.value))}
                    disabled={!connected}
                    className={cn(
                      "bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-xs px-3 py-2 focus:outline-none focus:border-emerald-500 text-[#8e9299]",
                      !connected && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                  </select>
                </div>
              </div>

              <div className="relative group flex items-baseline justify-center gap-2 py-2">
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
                    "w-full bg-white/5 text-5xl font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-xl transition-all cursor-text py-3 px-4 border",
                    !connected && "opacity-50 cursor-not-allowed",
                    status.isSplit
                      ? (status.vfo === status.txVFO 
                          ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" 
                          : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
                      : (status.vfo === "VFOA" 
                          ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50" 
                          : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50")
                  )}
                />
                <span className={cn(
                  "text-lg font-bold",
                  status.vfo === "VFOA" ? "text-emerald-500/50" : "text-blue-500/50"
                )}>MHz</span>
              </div>

              <div className="flex items-center gap-3">
                <select 
                  value={localMode}
                  onChange={(e) => handleSetMode(e.target.value)}
                  disabled={!connected}
                  className={cn(
                    "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:border-emerald-500",
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
                    "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm font-bold focus:outline-none focus:border-emerald-500",
                    !connected && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bw}Hz</option>)}
                </select>
              </div>
            </div>

            {/* Video Feed Section */}
            <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col shadow-lg">
              <div className="p-3 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Monitor size={12} />
                  <span className="text-[0.5625rem] uppercase tracking-widest font-bold">Video Feed</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    videoStatus === "playing" ? "bg-emerald-500 animate-pulse" : 
                    videoStatus === "paused" ? "bg-amber-500" : "bg-[#2a2b2e]"
                  )} />
                  <button 
                    onClick={() => {
                      setIsVideoSettingsOpen(true);
                      socket?.emit("get-video-devices");
                    }}
                    className="p-1.5 hover:bg-[#2a2b2e] rounded-lg text-[#8e9299] transition-all"
                    title="Video Settings"
                  >
                    <Settings size={14} />
                  </button>
                  <button 
                    onClick={() => setIsVideoCollapsed(!isVideoCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isVideoCollapsed ? "Expand Video Feed" : "Collapse Video Feed"}
                  >
                    {isVideoCollapsed ? <ChevronDown size={isPhone ? 16 : 18} /> : <ChevronUp size={isPhone ? 16 : 18} />}
                  </button>
                </div>
              </div>
              {!isVideoCollapsed && (
                <div className="relative aspect-video bg-black flex items-center justify-center">
                  {videoStatus === "playing" ? (
                    <img 
                      key={videoSessionId}
                      src={`${backendUrl}/api/video-stream?sessionId=${videoSessionId}`} 
                      alt="Video Stream"
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-[#3a3b3e]">
                      <Monitor size={32} strokeWidth={1} />
                      <span className="text-[0.5rem] uppercase font-bold tracking-widest">
                        {videoStatus === "paused" ? "Stream Paused" : "Stream Stopped"}
                      </span>
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
                      <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
                      <p className="text-xs text-red-400 font-medium">{videoError}</p>
                      <button 
                        onClick={() => socket?.emit("control-video", "play")}
                        className="mt-3 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-[10px] transition-colors"
                      >
                        Retry Connection
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="bg-[#151619] p-4 rounded-xl border border-[#2a2b2e] space-y-4">
              <div className="flex items-center justify-between border-b border-[#2a2b2e] pb-3">
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
                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end">
                    {phoneMeterTab === 'signal' && (
                      <span className={cn(
                        "text-lg font-mono font-bold",
                        status.ptt ? "text-red-500" : "text-emerald-500"
                      )}>
                        {status.ptt 
                          ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                          : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
                      </span>
                    )}
                    {phoneMeterTab === 'swr' && (
                      <span className={cn(
                        "text-lg font-mono font-bold",
                        (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500"
                      )}>
                        {(status.swr ?? 1).toFixed(2)}
                      </span>
                    )}
                    {phoneMeterTab === 'alc' && (
                      <span className="text-lg font-mono font-bold text-blue-500">
                        {(status.alc ?? 0).toFixed(5)}
                      </span>
                    )}
                  </div>
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

            {/* Controls Grid for Phone */}
            <div className="grid grid-cols-2 gap-3">
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
                  <div className="p-3 grid grid-cols-2 gap-3 h-full content-start">
                    <button 
                      onClick={() => handleSetPTT(!status.ptt)}
                      disabled={!connected}
                      className={cn(
                        "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                        !connected && "opacity-50 cursor-not-allowed",
                        status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                      )}
                    >
                      <Mic size={24} />
                      <span className="text-xs uppercase font-bold leading-none">PTT</span>
                    </button>
                    <button 
                      onClick={() => {
                        if (status.tuner) {
                          handleSetFunc("TUNER", false);
                        } else {
                          handleVfoOp("TUNE");
                        }
                      }}
                      disabled={!connected}
                      className={cn(
                        "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                        !connected && "opacity-50 cursor-not-allowed",
                        status.tuner ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <RefreshCw size={24} className={cn(status.tuner && "animate-spin")} />
                      <span className="text-xs uppercase font-bold leading-none">Tune</span>
                    </button>
                    <button 
                      onClick={cycleAttenuator}
                      disabled={!connected || attenuatorLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                        (!connected || attenuatorLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.attenuation > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                      )}
                    >
                      <Signal size={24} />
                      <span className="text-xs uppercase font-bold leading-none">
                        {getAttenuatorLabel()}
                      </span>
                    </button>
                    <button 
                      onClick={cyclePreamp}
                      disabled={!connected || preampLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                        (!connected || preampLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.preamp > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                      )}
                    >
                      <Zap size={24} />
                      <span className="text-xs uppercase font-bold leading-none">
                        {getPreampLabel()}
                      </span>
                    </button>
                    <button 
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className={cn(
                        "col-span-2 flex items-center justify-center h-12 rounded-xl border border-[#2a2b2e] bg-[#0a0a0a] text-[#8e9299] hover:text-white transition-all gap-2",
                        showAdvanced && "bg-white/5 border-white/20 text-white"
                      )}
                    >
                      <Settings size={16} />
                      <span className="text-xs uppercase font-bold">{showAdvanced ? "LESS CONTROLS" : "MORE CONTROLS"}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden">
                <div className="p-3 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <Gauge size={12} />
                    <span className="text-[0.5625rem] uppercase tracking-widest font-bold">RF Power</span>
                  </div>
                  <button 
                    onClick={() => setIsPhoneRFPowerCollapsed(!isPhoneRFPowerCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isPhoneRFPowerCollapsed ? "Expand RF Power" : "Collapse RF Power"}
                  >
                    {isPhoneRFPowerCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                  </button>
                </div>
                {!isPhoneRFPowerCollapsed && (
                  <div className="p-4 flex flex-col justify-center gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs uppercase text-[#8e9299]">RF Power</span>
                        <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.05" 
                        max="1" 
                        step="0.05"
                        value={localRFPower}
                        disabled={!connected}
                        onChange={(e) => {
                          isDraggingRF.current = true;
                          setLocalRFPower(parseFloat(e.target.value));
                        }}
                        className={cn(
                          "w-full accent-emerald-500 h-2 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                          !connected && "opacity-50 cursor-not-allowed"
                        )}
                      />
                    </div>
                    
                    <div className="space-y-4">
                      <div className="space-y-2">
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
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs uppercase text-[#8e9299]">DNR Level</span>
                          <span className="text-sm text-emerald-500 font-bold">Lvl {Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step)}</span>
                        </div>
                        <input 
                          type="range" 
                          min="0" 
                          max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)} 
                          step="1"
                          value={Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step)}
                          disabled={!connected || !nrCapabilities.supported}
                          onChange={(e) => {
                            isDraggingNR.current = true;
                            const stepIdx = parseInt(e.target.value);
                            setLocalNRLevel(nrCapabilities.range.min + (stepIdx * nrCapabilities.range.step));
                          }}
                          className={cn(
                            "w-full accent-emerald-500 h-2 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer",
                            (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed"
                          )}
                        />
                      </div>
                      {nbCapabilities.supported && showAdvanced && (
                        <div className="space-y-2 animate-in slide-in-from-top-1 duration-300">
                          <div className="flex justify-between items-center">
                            <span className="text-xs uppercase text-[#8e9299]">NB Level</span>
                            <span className="text-sm text-emerald-500 font-bold">{localNBLevel.toFixed(1)}</span>
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
            </div>

            {showAdvanced && !isPhoneQuickControlsCollapsed && (
              <div className="grid grid-cols-3 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <button 
                  onClick={() => handleSetFunc("NB", !status.nb)}
                  disabled={!connected || !nbCapabilities.supported}
                  className={cn(
                    "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                    (!connected || !nbCapabilities.supported) && "opacity-50 cursor-not-allowed",
                    status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#151619] border-[#2a2b2e]"
                  )}
                >
                  <Waves size={20} />
                  <span className="text-xs uppercase font-bold leading-none">NB</span>
                </button>
                <button 
                  onClick={cycleAgc}
                  disabled={!connected || agcLevels.length === 0}
                  className={cn(
                    "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                    (!connected || agcLevels.length === 0) && "opacity-50 cursor-not-allowed",
                    status.agc > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#151619] border-[#2a2b2e]"
                  )}
                >
                  <Settings size={20} />
                  <div className="flex flex-col items-center leading-none">
                    <span className="text-xs uppercase font-bold">AGC</span>
                    <span className="text-[0.625rem] font-bold opacity-80">{getAgcLabel()}</span>
                  </div>
                </button>
                <button 
                  onClick={() => handleSetFunc("NR", !status.nr)}
                  disabled={!connected || !nrCapabilities.supported}
                  className={cn(
                    "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                    (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed",
                    status.nr ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#151619] border-[#2a2b2e]"
                  )}
                >
                  <Activity size={20} />
                  <span className="text-xs uppercase font-bold leading-none">NR</span>
                </button>
                <button 
                  onClick={() => handleSetFunc("NB", !status.nb)}
                  disabled={!connected || !nbCapabilities.supported}
                  className={cn(
                    "flex flex-col items-center justify-center h-16 rounded-xl border transition-all gap-1",
                    (!connected || !nbCapabilities.supported) && "opacity-50 cursor-not-allowed",
                    status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#151619] border-[#2a2b2e]"
                  )}
                >
                  <Waves size={20} />
                  <span className="text-xs uppercase font-bold leading-none">NB</span>
                </button>
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
              <div className="flex items-center justify-between">
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
                    disabled={!connected}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                      !connected && "opacity-50 cursor-not-allowed",
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
                    disabled={!connected}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.isSplit 
                        ? "bg-red-500 text-white border border-red-500" 
                        : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
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
                        "bg-[#0a0a0a] border border-[#2a2b2e] rounded text-xs px-2 py-1 focus:outline-none focus:border-emerald-500 text-[#8e9299]",
                        !connected && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                    </select>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', 1)}
                        disabled={!connected}
                        className="p-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        title="Frequency Up"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', -1)}
                        disabled={!connected}
                        className="p-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                        title="Frequency Down"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                    <span className="text-xs uppercase tracking-widest font-bold">Video Feed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      videoStatus === "playing" ? "bg-emerald-500 animate-pulse" : 
                      videoStatus === "paused" ? "bg-amber-500" : "bg-[#2a2b2e]"
                    )} />
                    <button 
                      onClick={() => {
                        setIsVideoSettingsOpen(true);
                        socket?.emit("get-video-devices");
                      }}
                      className="p-1 hover:bg-[#2a2b2e] rounded text-[#8e9299] transition-all"
                      title="Video Settings"
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
                    {videoStatus === "playing" ? (
                      <img 
                        key={videoSessionId}
                        src={`${backendUrl}/api/video-stream?sessionId=${videoSessionId}`} 
                        alt="Video Stream"
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-[#3a3b3e]">
                        <Monitor size={24} strokeWidth={1} />
                        <span className="text-[0.5rem] uppercase font-bold tracking-widest">
                          {videoStatus === "paused" ? "Paused" : "Stopped"}
                        </span>
                      </div>
                    )}
                    {videoError && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
                        <AlertCircle className="w-6 h-6 text-red-500 mb-1" />
                        <p className="text-[10px] text-red-400 font-medium">{videoError}</p>
                        <button 
                          onClick={() => socket?.emit("control-video", "play")}
                          className="mt-2 px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-[9px] transition-colors"
                        >
                          Retry
                        </button>
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
                        status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                      )}
                    >
                      <Mic size={16} />
                      <span className="text-xs uppercase font-bold leading-none">PTT</span>
                    </button>
                    <button 
                      onClick={() => {
                        if (status.tuner) {
                          handleSetFunc("TUNER", false);
                        } else {
                          handleVfoOp("TUNE");
                        }
                      }}
                      disabled={!connected}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        !connected && "opacity-50 cursor-not-allowed",
                        status.tuner ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                      )}
                    >
                      <RefreshCw size={16} className={cn(status.tuner && "animate-spin")} />
                      <span className="text-xs uppercase font-bold leading-none">Tune</span>
                    </button>
                    <button 
                      onClick={cycleAttenuator}
                      disabled={!connected || attenuatorLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || attenuatorLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.attenuation > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
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
                        status.preamp > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
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
                        status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                      )}
                    >
                      <Waves size={16} />
                      <span className="text-xs uppercase font-bold leading-none">NB</span>
                    </button>
                    <button 
                      onClick={cycleAgc}
                      disabled={!connected || agcLevels.length === 0}
                      className={cn(
                        "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                        (!connected || agcLevels.length === 0) && "opacity-50 cursor-not-allowed",
                        status.agc > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
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
                        status.nr ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                      )}
                    >
                      <Activity size={16} />
                      <span className="text-xs uppercase font-bold leading-none">NR</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
                <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
                  <span className="text-xs uppercase text-[#8e9299] font-bold">Power & Levels</span>
                  <button 
                    onClick={() => setIsCompactRFPowerCollapsed(!isCompactRFPowerCollapsed)}
                    className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
                  >
                    {isCompactRFPowerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                </div>
                {!isCompactRFPowerCollapsed && (
                  <div className="p-2 flex flex-col justify-center gap-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs uppercase text-[#8e9299]">RF Power</span>
                      <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.05" 
                      max="1" 
                      step="0.05"
                      value={localRFPower}
                      disabled={!connected}
                      onChange={(e) => {
                        isDraggingRF.current = true;
                        setLocalRFPower(parseFloat(e.target.value));
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
                      <span className="text-sm text-emerald-500 font-bold">Lvl {Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step)}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)} 
                      step="1"
                      value={Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step)}
                      disabled={!connected || !nrCapabilities.supported}
                      onChange={(e) => {
                        isDraggingNR.current = true;
                        const stepIdx = parseInt(e.target.value);
                        setLocalNRLevel(nrCapabilities.range.min + (stepIdx * nrCapabilities.range.step));
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
                          <span className="text-sm text-emerald-500 font-bold">{localNBLevel.toFixed(1)}</span>
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
                      disabled={!connected}
                      className={cn(
                        "px-2 py-0.5 rounded text-[0.5rem] font-bold uppercase transition-all border",
                        !connected && "opacity-50 cursor-not-allowed",
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
                  disabled={!connected}
                  className={cn(
                    "mt-4 w-full py-1 text-[0.625rem] uppercase border border-[#2a2b2e] rounded hover:bg-[#2a2b2e] transition-colors",
                    !connected && "opacity-50 cursor-not-allowed"
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
                        : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-[#8e9299]"
                    )}
                  >
                    <Mic size={20} />
                    <span className="text-[0.625rem] uppercase font-bold">PTT</span>
                  </button>

                  <button 
                    onClick={() => {
                      if (status.tuner) {
                        handleSetFunc("TUNER", false);
                      } else {
                        handleVfoOp("TUNE");
                      }
                    }}
                    disabled={!connected}
                    className={cn(
                      "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2 group",
                      !connected && "opacity-50 cursor-not-allowed",
                      status.tuner ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                    )}
                  >
                    <RefreshCw size={20} className={cn("transition-transform", status.tuner ? "animate-spin" : "group-active:rotate-180")} />
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
                      <span className="text-[0.625rem] uppercase font-bold">NR</span>
                      <span className="text-[0.5625rem] font-bold opacity-80">
                        {status.nr ? "ON" : "OFF"}
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
                  <span className="text-[0.625rem] uppercase tracking-widest font-bold">Video Feed</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    videoStatus === "playing" ? "bg-emerald-500 animate-pulse" : 
                    videoStatus === "paused" ? "bg-amber-500" : "bg-[#2a2b2e]"
                  )} />
                  <button 
                    onClick={() => {
                      setIsVideoSettingsOpen(true);
                      socket?.emit("get-video-devices");
                    }}
                    className="p-1.5 hover:bg-[#2a2b2e] rounded-lg text-[#8e9299] transition-all"
                    title="Video Settings"
                  >
                    <Settings size={16} />
                  </button>
                  <button 
                    onClick={() => setIsVideoCollapsed(!isVideoCollapsed)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                    title={isVideoCollapsed ? "Expand Video Feed" : "Collapse Video Feed"}
                  >
                    {isVideoCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                  </button>
                </div>
              </div>
              {!isVideoCollapsed && (
                <div className="relative aspect-video bg-black flex items-center justify-center">
                  {videoStatus === "playing" ? (
                    <img 
                      key={videoSessionId}
                      src={`${backendUrl}/api/video-stream?sessionId=${videoSessionId}`} 
                      alt="Video Stream"
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-4 text-[#3a3b3e]">
                      <Monitor size={48} strokeWidth={1} />
                      <span className="text-[0.625rem] uppercase font-bold tracking-widest">
                        {videoStatus === "paused" ? "Stream Paused" : "Stream Stopped"}
                      </span>
                    </div>
                  )}
                  {videoError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
                      <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
                      <p className="text-sm text-red-400 font-medium">{videoError}</p>
                      <button 
                        onClick={() => socket?.emit("control-video", "play")}
                        className="mt-4 px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-xs transition-colors"
                      >
                        Retry Connection
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
                      <span className="text-emerald-500 font-bold">{Math.round(localRFPower * 100)} Watts</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.05" 
                      max="1" 
                      step="0.05"
                      value={localRFPower}
                      disabled={!connected}
                      onChange={(e) => {
                        isDraggingRF.current = true;
                        setLocalRFPower(parseFloat(e.target.value));
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
                      <span className="text-emerald-500 font-bold">Level {Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step)}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)} 
                      step="1"
                      value={Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step)}
                      disabled={!connected || !nrCapabilities.supported}
                      onChange={(e) => {
                        isDraggingNR.current = true;
                        const stepIdx = parseInt(e.target.value);
                        setLocalNRLevel(nrCapabilities.range.min + (stepIdx * nrCapabilities.range.step));
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
                        <span className="text-emerald-500 font-bold">{localNBLevel.toFixed(1)}</span>
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
                      Once your local backend is running, point this app to it. If running on the same machine, use <code className="text-white">http://localhost:3000</code>.
                    </p>
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Local Backend URL</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={backendUrl}
                          onChange={(e) => setBackendUrl(e.target.value)}
                          className="flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                          placeholder="http://localhost:3000"
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
                  <h2 className="text-lg font-bold tracking-tight uppercase italic">Video Settings</h2>
                  <p className="text-[0.625rem] text-[#8e9299] font-bold uppercase tracking-widest">Configure System Camera</p>
                </div>
              </div>
              <button 
                onClick={() => setIsVideoSettingsOpen(false)}
                className="p-2 hover:bg-[#2a2b2e] rounded-xl text-[#8e9299] transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="space-y-4">
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
                    {videoDevices.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Resolution</label>
                    <select 
                      value={videoSettings.resolution}
                      onChange={(e) => {
                        const newSettings = { ...videoSettings, resolution: e.target.value };
                        setVideoSettings(newSettings);
                        socket?.emit("update-video-settings", newSettings);
                      }}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-all"
                    >
                      <option value="">Select Resolution</option>
                      <option value="320x240">320x240</option>
                      <option value="640x480">640x480</option>
                      <option value="800x600">800x600</option>
                      <option value="1280x720">1280x720</option>
                    </select>
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
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => socket?.emit("control-video", "play")}
                  disabled={!videoSettings.device || videoStatus === "playing"}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                    videoStatus === "playing" 
                      ? "bg-emerald-500/20 text-emerald-500 cursor-not-allowed" 
                      : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20"
                  )}
                >
                  <Power size={16} />
                  Play
                </button>
                <button 
                  onClick={() => socket?.emit("control-video", "pause")}
                  disabled={videoStatus !== "playing"}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                    videoStatus !== "playing"
                      ? "bg-amber-500/20 text-amber-500 cursor-not-allowed"
                      : "bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20"
                  )}
                >
                  <Power size={16} className="rotate-90" />
                  Pause
                </button>
                <button 
                  onClick={() => socket?.emit("control-video", "stop")}
                  disabled={videoStatus === "stopped"}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                    videoStatus === "stopped"
                      ? "bg-red-500/20 text-red-500 cursor-not-allowed"
                      : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                  )}
                >
                  <X size={16} />
                  Stop
                </button>
              </div>
            </div>
            
            <div className="p-4 bg-[#1a1b1e] border-t border-[#2a2b2e] text-center">
              <button 
                onClick={() => setIsVideoSettingsOpen(false)}
                className="text-[0.625rem] uppercase font-bold text-[#8e9299] hover:text-white transition-all"
              >
                Close Settings
              </button>
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
                  <h2 className="text-sm font-bold uppercase tracking-tight">Rigctld Auto-Start Settings</h2>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

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
                    <span className="text-[0.5rem] text-[#8e9299] font-medium italic">Bundled Hamlib 4.7.0 Supported</span>
                  </div>
                  <p className="text-[0.625rem] text-[#8e9299] leading-relaxed">
                    The app will automatically use a bundled <code className="text-blue-400">rigctld</code> binary if placed in the <code className="text-blue-400">bin/[linux|windows|mac]/</code> folder, otherwise it falls back to your system PATH.
                  </p>
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
                    <span>v03.26.2026-Alpha1</span>
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
