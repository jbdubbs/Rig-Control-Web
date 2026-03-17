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
  Volume2
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
  attenuation: number;
  preamp: number;
  nb: boolean;
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

const DNR_LEVELS = [0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.75, 0.8, 0.85, 0.95, 1.0];

const DEFAULT_STATUS: RigStatus = {
  frequency: "14074000",
  mode: "USB",
  bandwidth: "2400",
  ptt: false,
  smeter: -54,
  swr: 1.0,
  rfpower: 0.5,
  vfo: "VFOA",
  attenuation: 0,
  preamp: 0,
  nb: false,
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
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(4532);
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
  const [pollRate, setPollRate] = useState(2000);
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
  const [localNRLevel, setLocalNRLevel] = useState(0.5);
  const isDraggingNR = useRef(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [backendUrl, setBackendUrl] = useState(() => localStorage.getItem("backend-url") || window.location.origin);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [isCompact, setIsCompact] = useState(() => localStorage.getItem("is-compact") === "true");
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("font-size");
    return saved ? parseInt(saved) : 16;
  });
  const [activeMeter, setActiveMeter] = useState<'signal' | 'swr' | 'alc' | 'vdd'>('signal');
  const effectiveRightMeter = (isCompact && activeMeter === 'signal') ? 'swr' : activeMeter;
  const [activeVFO, setActiveVFO] = useState<'A' | 'B'>('A');
  const [showHeaderOptions, setShowHeaderOptions] = useState(false);
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
  }, [isCompact]);

  useEffect(() => {
    localStorage.setItem("font-size", fontSize.toString());
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  useEffect(() => {
    if (!socket) return;
    const visible = [];
    const isPtt = status?.ptt || false;
    if (isCompact) {
      if (effectiveRightMeter === 'swr' && isPtt) visible.push('swr');
      if (effectiveRightMeter === 'alc' && isPtt) visible.push('alc');
      if (effectiveRightMeter === 'vdd') visible.push('vdd');
    } else {
      if (isPtt) {
        visible.push('swr', 'alc');
      }
    }
    socket.emit("set-visible-meters", visible);
  }, [socket, isCompact, effectiveRightMeter, status?.ptt]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallButton(false);
    }
  };

  useEffect(() => {
    const newSocket = io(backendUrl);
    setSocket(newSocket);

    newSocket.on("rig-connected", () => {
      setConnected(true);
      setError(null);
      newSocket.emit("get-modes");
    });
    newSocket.on("available-modes", (modes: string[]) => {
      setAvailableModes(modes);
    });
    newSocket.on("rig-disconnected", () => setConnected(false));
    newSocket.on("rig-error", (msg: string) => {
      setError(msg);
      setConnected(false);
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
      if (!isDraggingNR.current && newStatus.nrLevel !== undefined && newStatus.nrLevel !== null) {
        setLocalNRLevel(newStatus.nrLevel);
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
          swr: currentPtt ? (newStatus.swr ?? 1.0) : 1.0,
          swrGraph: Math.min(5, currentPtt ? (newStatus.swr ?? 1.0) : 1.0),
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
    if (!isDraggingNR.current) return;
    const timer = setTimeout(() => {
      handleSetLevel("NR", localNRLevel);
      isDraggingNR.current = false;
    }, 1000);

    return () => clearTimeout(timer);
  }, [localNRLevel]);

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
      socket?.emit("disconnect-rig");
    } else {
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
                level.toLowerCase() === "att" ? "attenuation" :
                level.toLowerCase() === "preamp" ? "preamp" :
                level.toLowerCase() === "nr" ? "nrLevel" : null;
    if (key) {
      skipPollsCount.current = 2;
      setStatus(prev => ({ ...(prev || DEFAULT_STATUS), [key]: val }));
    }
    socket?.emit("set-level", { level, val });
  };

  const handleVfoOp = (op: string) => {
    socket?.emit("vfo-op", op);
  };

  const handleSendRaw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawCommand.trim()) return;
    socket?.emit("send-raw", rawCommand);
    // We don't clear it immediately so the user knows what they sent
    // but we can clear it if preferred. Let's clear it for better UX.
    // Actually, let's keep it and just clear on success or just leave it.
    // Standard consoles usually clear.
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
      "min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-mono",
      isCompact ? "p-2" : "p-4 md:p-8"
    )}>
      <div className={cn(
        "mx-auto space-y-4",
        isCompact ? "max-w-[640px]" : "max-w-6xl space-y-6"
      )}>
        {/* Header / Connection */}
        <header className={cn(
          "bg-[#151619] rounded-xl border border-[#2a2b2e] shadow-2xl transition-all duration-300",
          isCompact ? "p-3" : "p-6"
        )}>
          {isCompact ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "p-1.5 rounded-full",
                    connected ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                  )}>
                    <Radio size={16} />
                  </div>
                  <h1 className="text-sm font-bold tracking-tighter uppercase italic">RigControl Web</h1>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setFontSize(prev => Math.max(10, prev - 1))}
                      className="w-4 h-4 flex items-center justify-center bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[10px] hover:border-emerald-500 text-[#8e9299] transition-colors"
                      title="Decrease Font Size"
                    >
                      -
                    </button>
                    <button 
                      onClick={() => setFontSize(prev => Math.min(24, prev + 1))}
                      className="w-4 h-4 flex items-center justify-center bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[10px] hover:border-emerald-500 text-[#8e9299] transition-colors"
                      title="Increase Font Size"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-[#8e9299] uppercase">{host}:{port}</span>
                  <button 
                    onClick={() => setShowHeaderOptions(!showHeaderOptions)}
                    className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
                  >
                    {showHeaderOptions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button 
                    onClick={() => setIsCompact(false)}
                    className="p-1 hover:bg-white/5 rounded text-emerald-500"
                    title="Exit Compact Mode"
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>

              {showHeaderOptions && (
                <div className="pt-2 border-t border-[#2a2b2e] animate-in slide-in-from-top-2 duration-200 space-y-2">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 flex flex-col gap-1">
                      <label className="text-[8px] uppercase text-[#8e9299]">Host</label>
                      <input 
                        type="text" 
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-[10px] focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="w-16 flex flex-col gap-1">
                      <label className="text-[8px] uppercase text-[#8e9299]">Port</label>
                      <input 
                        type="number" 
                        value={(port === null || isNaN(port)) ? "" : port}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setPort(isNaN(val) ? NaN : val);
                        }}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-[10px] focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <button 
                      onClick={handleConnect}
                      className={cn(
                        "w-24 py-1 rounded font-bold uppercase text-[9px] transition-all flex items-center justify-center gap-1 h-[22px]",
                        connected ? "bg-red-500/20 text-red-500 border border-red-500/50" : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50"
                      )}
                    >
                      <Power size={10} />
                      {connected ? "Disconnect" : "Connect"}
                    </button>
                  </div>
                  
                  <div className="flex justify-center">
                    <div className="w-1/3 flex flex-col gap-1">
                      <label className="text-[8px] uppercase text-[#8e9299] text-center">Polling Rate</label>
                      <select 
                        value={pollRate}
                        onChange={(e) => handlePollRateChange(parseInt(e.target.value))}
                        className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-1 py-1 text-[10px] focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer text-center"
                      >
                        <option value={250}>250ms</option>
                        <option value={500}>500ms</option>
                        <option value={1000}>1000ms</option>
                        <option value={1500}>1500ms</option>
                        <option value={2000}>2000ms</option>
                        <option value={5000}>5000ms</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col md:flex-row justify-between items-center w-full">
              <div className="flex items-center gap-4 mb-4 md:mb-0">
                <div className={cn(
                  "p-3 rounded-full",
                  connected ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                )}>
                  <Radio size={32} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tighter uppercase italic">RigControl Web</h1>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => setFontSize(prev => Math.max(10, prev - 1))}
                        className="w-6 h-6 flex items-center justify-center bg-[#0a0a0a] border border-[#2a2b2e] rounded text-sm hover:border-emerald-500 text-[#8e9299] transition-colors"
                        title="Decrease Font Size"
                      >
                        -
                      </button>
                      <button 
                        onClick={() => setFontSize(prev => Math.min(24, prev + 1))}
                        className="w-6 h-6 flex items-center justify-center bg-[#0a0a0a] border border-[#2a2b2e] rounded text-sm hover:border-emerald-500 text-[#8e9299] transition-colors"
                        title="Increase Font Size"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-[#8e9299] uppercase tracking-widest">Hamlib rigctld Interface</p>
                </div>
              </div>

              <div className="flex flex-col gap-4 w-full md:w-auto">
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[#8e9299]">Host Address</label>
                    <input 
                      type="text" 
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      className="bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-1 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[#8e9299]">Port</label>
                    <input 
                      type="number" 
                      value={(port === null || isNaN(port)) ? "" : port}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setPort(isNaN(val) ? NaN : val);
                      }}
                      className="bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-1 text-sm w-24 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div className="flex gap-2">
                    {showInstallButton && (
                      <button 
                        onClick={handleInstallClick}
                        className="px-4 py-2 rounded font-bold uppercase text-xs transition-all bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500 hover:text-white flex items-center gap-2"
                        title="Install to Desktop"
                      >
                        <Download size={14} />
                        Install
                      </button>
                    )}
                    <button 
                      onClick={() => setShowSetupModal(true)}
                      className="px-4 py-2 rounded font-bold uppercase text-xs transition-all bg-[#2a2b2e] text-[#8e9299] border border-[#3a3b3e] hover:bg-[#3a3b3e] hover:text-white flex items-center gap-2"
                    >
                      <Server size={14} />
                      Portable
                    </button>
                    <button 
                      onClick={handleConnect}
                      className={cn(
                        "px-6 py-2 rounded font-bold uppercase text-xs transition-all flex items-center gap-2",
                        connected 
                          ? "bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white"
                          : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 hover:bg-emerald-500 hover:text-white"
                      )}
                    >
                      <Power size={14} />
                      {connected ? "Disconnect" : "Connect"}
                    </button>
                    {!connected && (
                      <button 
                        onClick={() => socket?.emit("connect-rig", { host: "mock", port: 0 })}
                        className="px-4 py-2 rounded font-bold uppercase text-xs transition-all bg-amber-500/20 text-amber-500 border border-amber-500/50 hover:bg-amber-500 hover:text-white"
                      >
                        Demo
                      </button>
                    )}
                    <button 
                      onClick={() => setIsCompact(true)}
                      className="px-3 py-2 rounded font-bold uppercase text-xs transition-all bg-[#2a2b2e] text-[#8e9299] border border-[#3a3b3e] hover:bg-[#3a3b3e] hover:text-white flex items-center justify-center"
                      title="Enter Compact Mode"
                    >
                      <Minimize2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase text-[#8e9299]">Poll Rate</label>
                  <select 
                    value={pollRate}
                    onChange={(e) => handlePollRateChange(parseInt(e.target.value))}
                    className="bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-1 text-sm focus:outline-none focus:border-emerald-500 transition-colors appearance-none cursor-pointer"
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
          )}
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
                <p className="text-[10px] text-[#8e9299] uppercase font-bold">How to fix this:</p>
                <ul className="text-[11px] list-disc list-inside space-y-1 text-red-300/70">
                  <li><strong>Use ngrok:</strong> Run <code className="bg-black px-1">ngrok tcp 4532</code> on your radio computer and use the provided <code className="text-white">0.tcp.ngrok.io</code> address.</li>
                  <li><strong>Port Forwarding:</strong> Forward port <code className="text-white">4532</code> on your router to <code className="text-white">192.168.86.34</code>.</li>
                  <li><strong>Public IP:</strong> Ensure you use your <em>Public</em> IP (search "What is my IP") and not your local 192.168.x.x address.</li>
                </ul>
              </div>

              <div className="mt-3 flex gap-4">
                <button 
                  onClick={() => socket?.emit("connect-rig", { host: "mock", port: 0 })}
                  className="text-[10px] uppercase font-bold text-amber-500 hover:underline"
                >
                  Try Demo Mode (Mock Rig)
                </button>
                <a 
                  href="https://github.com/Hamlib/Hamlib/wiki/rigctld" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-[10px] uppercase font-bold text-emerald-500 hover:underline"
                >
                  Rigctld Setup Guide
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Main Interface */}
        {isCompact ? (
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
                    className={cn(
                      "px-3 py-1 rounded text-[10px] font-bold uppercase transition-all",
                      status.vfo === "VFOA" 
                        ? "bg-emerald-500 text-white border border-emerald-500" 
                        : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20"
                    )}
                  >
                    VFO A
                  </button>
                  <button 
                    onClick={() => handleSetVFO("VFOB")}
                    className={cn(
                      "px-3 py-1 rounded text-[10px] font-bold uppercase transition-all",
                      status.vfo === "VFOB" 
                        ? "bg-blue-500 text-white border border-blue-500" 
                        : "bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20"
                    )}
                  >
                    VFO B
                  </button>
                  <select 
                    value={vfoStep}
                    onChange={(e) => setVfoStep(parseFloat(e.target.value))}
                    className="bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[9px] px-2 py-1 focus:outline-none focus:border-emerald-500 text-[#8e9299]"
                  >
                    {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <select 
                    value={localMode}
                    onChange={(e) => handleSetMode(e.target.value)}
                    className="bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-[10px] focus:outline-none focus:border-emerald-500"
                  >
                    {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select 
                    value={status?.bandwidth || "2400"}
                    onChange={(e) => handleSetBw(parseInt(e.target.value))}
                    className="bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-[10px] focus:outline-none focus:border-emerald-500"
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
                  onBlur={() => {
                    const val = parseFloat(status.vfo === "VFOA" ? inputVfoA : inputVfoB);
                    if (!isNaN(val)) {
                      handleSetFreq(Math.round(val * 1000000).toString());
                    }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={cn(
                    "w-full bg-white/5 text-4xl font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg transition-all cursor-text py-1 px-2 border",
                    status.vfo === "VFOA" 
                      ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50" 
                      : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50"
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

            {/* Split Meter Boxes */}
            <div className="grid grid-cols-2 gap-2">
              {/* Left Box: S-METER */}
              <div className="bg-[#151619] p-2 rounded-xl border border-[#2a2b2e] space-y-1">
                <div className="flex items-center justify-between border-b border-[#2a2b2e] pb-1">
                  <span className={cn(
                    "text-[9px] font-bold uppercase",
                    status.ptt ? "text-red-500" : "text-[#8e9299]"
                  )}>
                    {status.ptt ? "POWER OUT" : "S-METER"}
                  </span>
                  <span className={cn(
                    "text-[9px] font-mono font-bold",
                    status.ptt ? "text-red-500" : "text-emerald-500"
                  )}>
                    {status.ptt 
                      ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                      : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
                  </span>
                </div>
                <div className="h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                      <XAxis dataKey="time" hide />
                      <YAxis domain={status.ptt ? [0, 1] : [-54, 60]} hide />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '8px' }}
                        itemStyle={{ color: status.ptt ? '#ef4444' : '#10b981' }}
                        formatter={(val: number) => [
                          status.ptt ? `${Math.round((val ?? 0) * 100)}W` : (val ?? 0),
                          status.ptt ? "POWER" : "SIGNAL"
                        ]}
                      />
                      <Line 
                        type="monotone" 
                        dataKey={status.ptt ? "powerMeter" : "smeter"} 
                        stroke={status.ptt ? "#ef4444" : "#10b981"} 
                        strokeWidth={1.5} 
                        dot={false} 
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Right Box: SWR/ALC/VDD */}
              <div className="bg-[#151619] p-2 rounded-xl border border-[#2a2b2e] space-y-1">
                <div className="flex items-center justify-between border-b border-[#2a2b2e] pb-1">
                  <div className="flex gap-1">
                    {(['swr', 'alc', 'vdd'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setActiveMeter(m)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[8px] font-bold uppercase transition-all",
                          effectiveRightMeter === m ? "bg-emerald-500 text-white" : "text-[#8e9299] hover:bg-white/5"
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col items-end gap-0">
                    {effectiveRightMeter !== 'vdd' && (
                      <>
                        <span className="text-[8px] font-mono font-bold leading-tight" style={{ color: '#f59e0b' }}>
                          SWR {(status.swr ?? 1).toFixed(2)}
                        </span>
                        <span className="text-[8px] font-mono font-bold leading-tight" style={{ color: '#3b82f6' }}>
                          ALC {(status.alc ?? 0).toFixed(5)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                      <XAxis dataKey="time" hide />
                      <YAxis 
                        domain={effectiveRightMeter === 'swr' ? [0, 5] : effectiveRightMeter === 'vdd' ? [11, 16] : [0, 1]} 
                        hide={effectiveRightMeter !== 'swr' && effectiveRightMeter !== 'vdd'}
                        ticks={effectiveRightMeter === 'swr' ? [0, 1, 2, 3, 4, 5] : effectiveRightMeter === 'vdd' ? [11, 12, 13, 14, 15, 16] : undefined}
                        width={15}
                        style={{ fontSize: '6px', fill: '#4a4b4e' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '8px' }}
                        itemStyle={{ color: effectiveRightMeter === 'swr' ? '#f59e0b' : effectiveRightMeter === 'vdd' ? '#10b981' : '#3b82f6' }}
                        formatter={(val: number, name: string, props: any) => {
                          if (effectiveRightMeter === 'swr') {
                            return [(props.payload?.swr ?? 1).toFixed(2), 'SWR'];
                          }
                          if (effectiveRightMeter === 'vdd') {
                            return [`${(val ?? 0).toFixed(1)}V`, 'VDD'];
                          }
                          return [(val ?? 0).toFixed(effectiveRightMeter === 'alc' ? 5 : 2), effectiveRightMeter.toUpperCase()];
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey={effectiveRightMeter === 'swr' ? 'swrGraph' : effectiveRightMeter} 
                        stroke={effectiveRightMeter === 'swr' ? '#f59e0b' : effectiveRightMeter === 'vdd' ? '#10b981' : '#3b82f6'} 
                        strokeWidth={1.5} 
                        dot={false} 
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Compact Controls & RF Power */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-[#151619] p-2 rounded-xl border border-[#2a2b2e] grid grid-cols-3 gap-1">
                <button 
                  onClick={() => handleSetPTT(!status.ptt)}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded border transition-all gap-1",
                    status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                  )}
                >
                  <Mic size={14} />
                  <span className="text-[8px] uppercase font-bold">PTT</span>
                </button>
                <button 
                  onClick={() => {
                    if (status.tuner) {
                      handleSetFunc("TUNER", false);
                    } else {
                      handleVfoOp("TUNE");
                    }
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded border transition-all gap-1",
                    status.tuner ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                  )}
                >
                  <RefreshCw size={14} className={cn(status.tuner && "animate-spin")} />
                  <span className="text-[8px] uppercase font-bold">Tune</span>
                </button>
                <button 
                  onClick={() => handleSetFunc("NB", !status.nb)}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded border transition-all gap-1",
                    status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                  )}
                >
                  <Activity size={14} />
                  <span className="text-[8px] uppercase font-bold">NB</span>
                </button>
                <button 
                  onClick={() => {
                    const next = status.attenuation === 0 ? 6 : status.attenuation === 6 ? 12 : 0;
                    handleSetLevel("ATT", next);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded border transition-all gap-1",
                    status.attenuation > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                  )}
                >
                  <Signal size={14} />
                  <span className="text-[8px] uppercase font-bold">
                    {status.attenuation === 0 ? "ATT" : status.attenuation === 6 ? "ATT -6" : "ATT -12"}
                  </span>
                </button>
                <button 
                  onClick={() => {
                    const next = status.preamp === 0 ? 10 : status.preamp === 10 ? 20 : 0;
                    handleSetLevel("PREAMP", next);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded border transition-all gap-1",
                    status.preamp > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                  )}
                >
                  <Zap size={14} />
                  <span className="text-[8px] uppercase font-bold">
                    {status.preamp === 0 ? "IPO" : status.preamp === 10 ? "AMP1" : "AMP2"}
                  </span>
                </button>
                <button 
                  onClick={() => handleSetFunc("NR", !status.nr)}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded border transition-all gap-1",
                    status.nr ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
                  )}
                >
                  <Volume2 size={14} />
                  <span className="text-[8px] uppercase font-bold">DNR</span>
                </button>
              </div>

              <div className="bg-[#151619] p-2 rounded-xl border border-[#2a2b2e] flex flex-col justify-center gap-1">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] uppercase text-[#8e9299]">RF Power</span>
                  <span className="text-[10px] text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
                </div>
                <input 
                  type="range" 
                  min="0.05" 
                  max="1" 
                  step="0.05"
                  value={localRFPower}
                  onChange={(e) => {
                    isDraggingRF.current = true;
                    setLocalRFPower(parseFloat(e.target.value));
                  }}
                  className="w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between items-center mt-3">
                  <span className="text-[9px] uppercase text-[#8e9299]">DNR Level</span>
                  <span className="text-[10px] text-emerald-500 font-bold">Lvl {DNR_LEVELS.indexOf(localNRLevel) === -1 ? 8 : DNR_LEVELS.indexOf(localNRLevel) + 1}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="14" 
                  step="1"
                  value={DNR_LEVELS.indexOf(localNRLevel) === -1 ? 7 : DNR_LEVELS.indexOf(localNRLevel)}
                  onChange={(e) => {
                    isDraggingNR.current = true;
                    setLocalNRLevel(DNR_LEVELS[parseInt(e.target.value)]);
                  }}
                  className="w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer"
                />
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
                status.vfo === "VFOA" ? "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]" : "border-[#2a2b2e]"
              )}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase text-[#8e9299]">VFO A</span>
                    <select 
                      value={vfoStep}
                      onChange={(e) => setVfoStep(parseFloat(e.target.value))}
                      className="bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[9px] px-1 py-0.5 focus:outline-none focus:border-emerald-500 text-[#8e9299]"
                    >
                      {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                    </select>
                  </div>
                  {status.vfo === "VFOA" && <Activity size={12} className="text-emerald-500 animate-pulse" />}
                </div>
                <div className="relative group flex items-baseline gap-2">
                  <input
                    id="vfoA-input"
                    type="number"
                    step={vfoStep}
                    value={inputVfoA}
                    onChange={(e) => setInputVfoA(e.target.value)}
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
                    className="w-full bg-white/5 text-4xl font-bold tracking-tighter text-emerald-500 font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none hover:bg-emerald-500/10 focus:bg-emerald-500/10 rounded-lg transition-all cursor-text py-1 px-2 border border-[#2a2b2e] focus:border-emerald-500/50"
                    title="Click to edit frequency"
                  />
                  <span className="text-xs text-emerald-500/50 font-bold">MHz</span>
                  <Pencil size={14} className="absolute right-12 top-1/2 -translate-y-1/2 text-emerald-500/30 transition-opacity pointer-events-none" />
                </div>
                <button 
                  onClick={() => handleSetVFO("VFOA")}
                  className="mt-4 w-full py-1 text-[10px] uppercase border border-[#2a2b2e] rounded hover:bg-[#2a2b2e] transition-colors"
                >
                  Select VFO A
                </button>
              </div>

              <div className={cn(
                "bg-[#151619] p-6 rounded-xl border transition-all",
                status?.vfo === "VFOB" ? "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]" : "border-[#2a2b2e]"
              )}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase text-[#8e9299]">VFO B</span>
                    <select 
                      value={vfoStep}
                      onChange={(e) => setVfoStep(parseFloat(e.target.value))}
                      className="bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[9px] px-1 py-0.5 focus:outline-none focus:border-emerald-500 text-[#8e9299]"
                    >
                      {VFO_STEPS.map(s => <option key={s} value={s}>{formatStep(s)}</option>)}
                    </select>
                  </div>
                  {status?.vfo === "VFOB" && <Activity size={12} className="text-emerald-500 animate-pulse" />}
                </div>
                <div className="relative group flex items-baseline gap-2">
                  <input
                    id="vfoB-input"
                    type="number"
                    step={vfoStep}
                    value={inputVfoB}
                    onChange={(e) => setInputVfoB(e.target.value)}
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
                    className="w-full bg-white/5 text-4xl font-bold tracking-tighter text-emerald-500 font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none hover:bg-emerald-500/10 focus:bg-emerald-500/10 rounded-lg transition-all cursor-text py-1 px-2 border border-[#2a2b2e] focus:border-emerald-500/50"
                    title="Click to edit frequency"
                  />
                  <span className="text-xs text-emerald-500/50 font-bold">MHz</span>
                  <Pencil size={14} className="absolute right-12 top-1/2 -translate-y-1/2 text-emerald-500/30 transition-opacity pointer-events-none" />
                </div>
                <button 
                  onClick={() => handleSetVFO("VFOB")}
                  className="mt-4 w-full py-1 text-[10px] uppercase border border-[#2a2b2e] rounded hover:bg-[#2a2b2e] transition-colors"
                >
                  Select VFO B
                </button>
              </div>
            </div>

            {/* Main Controls Grid */}
            <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] grid grid-cols-2 md:grid-cols-4 gap-4">
              <button 
                onClick={() => handleSetPTT(!status.ptt)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                  status.ptt 
                    ? "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]" 
                    : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-[#8e9299]"
                )}
              >
                <Mic size={20} />
                <span className="text-[10px] uppercase font-bold">PTT</span>
              </button>

              <button 
                onClick={() => {
                  if (status.tuner) {
                    handleSetFunc("TUNER", false);
                  } else {
                    handleVfoOp("TUNE");
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2 group",
                  status.tuner ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                )}
              >
                <RefreshCw size={20} className={cn("transition-transform", status.tuner ? "animate-spin" : "group-active:rotate-180")} />
                <span className="text-[10px] uppercase font-bold">Tune</span>
              </button>

              <button 
                onClick={() => {
                  const current = status.attenuation;
                  let next = 0;
                  if (current === 0) next = 6;
                  else if (current === 6) next = 12;
                  else next = 0;
                  handleSetLevel("ATT", next);
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-1",
                  status.attenuation > 0 
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                    : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                )}
              >
                <Signal size={20} />
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold">Atten</span>
                  <span className="text-[9px] font-bold opacity-80">
                    {status.attenuation === 0 ? "OFF" : 
                     status.attenuation === 6 ? "-6dB" : 
                     status.attenuation === 12 ? "-12dB" : "OFF"}
                  </span>
                </div>
              </button>

              <button 
                onClick={() => {
                  const current = status.preamp;
                  let next = 0;
                  if (current === 0) next = 10;
                  else if (current === 10) next = 20;
                  else next = 0;
                  handleSetLevel("PREAMP", next);
                }}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-1",
                  status.preamp > 0 
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                    : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                )}
              >
                <Zap size={20} />
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold">Preamp</span>
                  <span className="text-[9px] font-bold opacity-80">
                    {status.preamp === 0 ? "IPO" : 
                     status.preamp === 10 ? "AMP1" : 
                     status.preamp === 20 ? "AMP2" : "IPO"}
                  </span>
                </div>
              </button>

              <button 
                onClick={() => handleSetFunc("NB", !status.nb)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                  status.nb 
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                    : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                )}
              >
                <Activity size={20} />
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold">NB</span>
                  <span className="text-[9px] font-bold opacity-80">
                    {status.nb ? "ON" : "OFF"}
                  </span>
                </div>
              </button>

              <button 
                onClick={() => handleSetFunc("NR", !status.nr)}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2",
                  status.nr 
                    ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                    : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
                )}
              >
                <Volume2 size={20} />
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase font-bold">DNR</span>
                  <span className="text-[9px] font-bold opacity-80">
                    {status.nr ? "ON" : "OFF"}
                  </span>
                </div>
              </button>
            </div>

            {/* Mode & Bandwidth */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] space-y-4">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Waves size={14} />
                  <span className="text-[10px] uppercase tracking-widest">Mode Selection</span>
                </div>
                <select 
                  value={localMode}
                  onChange={(e) => handleSetMode(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded p-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] space-y-4">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Settings size={14} />
                  <span className="text-[10px] uppercase tracking-widest">Filter Bandwidth</span>
                </div>
                <select 
                  value={status?.bandwidth || "2400"}
                  onChange={(e) => handleSetBw(parseInt(e.target.value))}
                  className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded p-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bw} Hz</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Right Column: Meters & Graphs */}
          <div className="space-y-6">
            
            {/* RF Power & DNR Slider */}
            <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] space-y-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <Gauge size={14} />
                    <span className="text-[10px] uppercase tracking-widest">RF Power</span>
                  </div>
                  <span className="text-emerald-500 font-bold">{Math.round(localRFPower * 100)} Watts</span>
                </div>
                <input 
                  type="range" 
                  min="0.05" 
                  max="1" 
                  step="0.05"
                  value={localRFPower}
                  onChange={(e) => {
                    isDraggingRF.current = true;
                    setLocalRFPower(parseFloat(e.target.value));
                  }}
                  className="w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2 text-[#8e9299]">
                    <Volume2 size={14} />
                    <span className="text-[10px] uppercase tracking-widest">DNR Level</span>
                  </div>
                  <span className="text-emerald-500 font-bold">Level {DNR_LEVELS.indexOf(localNRLevel) === -1 ? 8 : DNR_LEVELS.indexOf(localNRLevel) + 1}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="14" 
                  step="1"
                  value={DNR_LEVELS.indexOf(localNRLevel) === -1 ? 7 : DNR_LEVELS.indexOf(localNRLevel)}
                  onChange={(e) => {
                    isDraggingNR.current = true;
                    setLocalNRLevel(DNR_LEVELS[parseInt(e.target.value)]);
                  }}
                  className="w-full accent-emerald-500 h-1 bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>

            {/* S-Meter / Power Meter Graph */}
            <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] space-y-6 h-[320px]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  {status.ptt ? <Gauge size={14} className="text-red-500" /> : <Signal size={14} />}
                  <span className={cn(
                    "text-[10px] uppercase tracking-widest",
                    status.ptt ? "text-red-500 font-bold" : "text-[#8e9299]"
                  )}>
                    {status.ptt ? "POWER OUT" : "S-Meter"}
                  </span>
                </div>
                <span className={cn(
                  "text-xs font-mono font-bold",
                  status.ptt ? "text-red-500" : "text-emerald-500"
                )}>
                  {status.ptt 
                    ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                    : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`
                  }
                </span>
              </div>

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
                        : `${Math.max(0, Math.min(100, (status.smeter + 54) / 114 * 100))}%` 
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
                        <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '26.3%' }} />
                        <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '47.3%' }} />
                      </>
                    )}
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '100%' }} />
                  </div>
                </div>
                <div className="flex justify-between text-[8px] text-[#4a4b4e] font-mono uppercase tracking-tighter">
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
                      <span className="ml-[-5%]">S9</span>
                      <span>S9+60</span>
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
                      domain={status.ptt ? [0, 1] : [-54, 60]} 
                      ticks={status.ptt ? [0, 0.25, 0.5, 0.75, 1] : [-54, -24, 0, 60]}
                      tickFormatter={(val) => {
                        if (status.ptt) return `${Math.round(val * 100)}W`;
                        if (val === -54) return "S0";
                        if (val === -24) return "S5";
                        if (val === 0) return "S9";
                        if (val === 60) return "+60";
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
                      formatter={(value: number) => [
                        status.ptt 
                          ? `${Math.round(value * 100)} Watts`
                          : value > 0 ? `S9+${value}dB` : `S${Math.round((value + 54) / 6)}`,
                        status.ptt ? 'Power' : 'Signal'
                      ]}
                    />
                    <Line 
                      type="monotone" 
                      dataKey={status.ptt ? "powerMeter" : "smeter"} 
                      stroke={status.ptt ? "#ef4444" : "#10b981"} 
                      strokeWidth={1.5} 
                      dot={false} 
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* SWR Graph */}
            <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] space-y-4 h-[250px]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[#8e9299]">
                  <Activity size={14} />
                  <span className="text-[10px] uppercase tracking-widest">SWR Ratio</span>
                </div>
                <span className="text-xs font-mono text-amber-500 font-bold">
                  {(status.swr ?? 1).toFixed(2)}
                </span>
              </div>
              <div className="h-full pb-8">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} />
                    <XAxis dataKey="time" hide />
                    <YAxis 
                      domain={[0, 5]} 
                      ticks={[0, 1, 2, 3, 4, 5]}
                      width={25}
                      style={{ fontSize: '8px', fill: '#4a4b4e' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                      itemStyle={{ color: '#f59e0b' }}
                      formatter={(val: number, name: string, props: any) => [(props.payload?.swr ?? 1).toFixed(2), 'SWR']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="swrGraph" 
                      stroke="#f59e0b" 
                      strokeWidth={2} 
                      dot={false} 
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ALC Graph */}
            <div className="bg-[#151619] p-6 rounded-xl border border-[#2a2b2e] space-y-4 h-[250px]">
              <div className="flex items-center gap-2 text-[#8e9299]">
                <Waves size={14} />
                <span className="text-[10px] uppercase tracking-widest">ALC Level</span>
              </div>
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
          </div>
        </div>
      )}

        {/* Command Console */}
        {!isCompact && (
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-2xl">
            <div className="bg-[#1a1b1e] px-4 py-2 border-b border-[#2a2b2e] flex items-center gap-2">
              <Settings size={14} className="text-[#8e9299]" />
              <span className="text-[10px] uppercase font-bold tracking-widest text-[#8e9299]">Rigctld Command Console</span>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="bg-[#0a0a0a] rounded border border-[#2a2b2e] h-40 overflow-y-auto p-3 font-mono text-[11px] space-y-1">
                {consoleLogs.length === 0 ? (
                  <div className="text-[#4a4b4e] italic">No commands sent yet. Try "f" for frequency or "m" for mode.</div>
                ) : (
                  consoleLogs.map((log, i) => (
                    <div key={i} className="border-b border-[#1a1b1e] pb-1 last:border-0">
                      <div className="flex justify-between opacity-50 text-[9px]">
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
                  placeholder="Enter raw hamlib command (e.g. 'f', 'm', 'v', 't')..."
                  className="flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-[#4a4b4e]"
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
          </div>
        )}

        {/* Footer Status Bar */}
        <footer className="bg-[#151619] px-6 py-3 rounded-xl border border-[#2a2b2e] flex justify-between items-center text-[10px] uppercase tracking-widest text-[#8e9299]">
          <div className="flex gap-6">
            <span>Status: <span className={connected ? "text-emerald-500" : "text-red-500"}>{connected ? "Online" : "Offline"}</span></span>
            <span>Rig: {connected ? `${host}:${port}` : "None"}</span>
          </div>
          <div className="flex gap-6">
            <span>Mode: <span className="text-white">{status.mode}</span></span>
            <span>BW: <span className="text-white">{status.bandwidth} Hz</span></span>
            <span>VFO: <span className="text-white">{status.vfo}</span></span>
          </div>
        </footer>

        {/* Portable Setup Modal */}
        {showSetupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                    <Server size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold uppercase tracking-tight">Portable Setup</h2>
                    <p className="text-[10px] text-[#8e9299] uppercase tracking-widest">Run RigControl locally on your computer</p>
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
                      <p className="text-[10px] text-emerald-500/70 font-bold uppercase">Quick Start Command:</p>
                      <code className="block text-[11px] text-white bg-black/50 p-3 rounded border border-white/5 break-all">
                        git clone https://github.com/example/rigcontrol-web.git<br/>
                        cd rigcontrol-web && npm install && npm start
                      </code>
                      <p className="text-[10px] text-[#4a4b4e] italic">
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
                      <label className="text-[10px] uppercase text-[#8e9299]">Local Backend URL</label>
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
                      <p className="text-[9px] text-amber-500/70 italic">
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
      </div>
    </div>
  );
}
