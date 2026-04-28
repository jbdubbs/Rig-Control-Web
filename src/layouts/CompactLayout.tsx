import React from "react";
import type { Socket } from "socket.io-client";
import {
  Activity,
  Settings,
  Mic,
  Zap,
  Waves,
  Signal,
  RefreshCw,
  Volume2,
  VolumeX,
  MicOff,
  Monitor,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Headphones,
  AlertCircle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "../utils";
import { VFO_STEPS, BANDWIDTHS } from "../constants";
import type {
  RigStatus,
  CwSettings,
  AudioSettings,
  NbCapabilities,
  NrCapabilities,
  AnfCapabilities,
  RfPowerCapabilities,
  ConsoleLog,
} from "../types";

export interface CompactLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
  socket: Socket | null;
  vfoSupported: boolean;

  // VFO
  vfoStep: number;
  inputVfoA: string;
  inputVfoB: string;
  localMode: string;
  setVfoStep: React.Dispatch<React.SetStateAction<number>>;
  setInputVfoA: React.Dispatch<React.SetStateAction<string>>;
  setInputVfoB: React.Dispatch<React.SetStateAction<string>>;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
  handleSetVFO: (vfo: string) => void;
  handleToggleSplit: () => void;
  handleSetFreq: (freq: string) => void;
  handleSetMode: (mode: string) => void;
  handleSetBw: (bw: number) => void;

  // Meters
  history: any[];
  activeMeter: "signal" | "swr" | "alc" | "vdd";
  isCompactSMeterCollapsed: boolean;
  setActiveMeter: React.Dispatch<
    React.SetStateAction<"signal" | "swr" | "alc" | "vdd">
  >;
  setIsCompactSMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // CW decoder
  cwDecodeEnabled: boolean;
  cwDecodedText: string;
  cwStats: { pitch: number; speed: number };
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;
  setCwDecodedText: React.Dispatch<React.SetStateAction<string>>;

  // Video
  videoStatus: "streaming" | "stopped";
  isVideoCollapsed: boolean;
  isElectronSource: boolean;
  videoError: string | null;
  videoPreviewCallbackRef: React.RefCallback<HTMLVideoElement>;
  videoCanvasRef: React.RefObject<HTMLCanvasElement>;
  setIsVideoCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsVideoSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVideoError: React.Dispatch<React.SetStateAction<string | null>>;
  enumerateVideoDevices: () => Promise<void>;

  // Audio
  audioStatus: "playing" | "stopped";
  localAudioReady: boolean;
  inboundMuted: boolean;
  outboundMuted: boolean;
  audioSettings: AudioSettings;
  audioWasRestarted: boolean;
  setInboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setOutboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleJoinAudio: () => void;

  // Controls
  isCompactControlsCollapsed: boolean;
  isCompactRFPowerCollapsed: boolean;
  setIsCompactControlsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCompactRFPowerCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isTuning: boolean;
  tuneJustFinished: boolean;
  attenuatorLevels: string[];
  preampLevels: string[];
  agcLevels: string[];
  nbCapabilities: NbCapabilities;
  nrCapabilities: NrCapabilities;
  anfCapabilities: AnfCapabilities;
  localRFPower: number;
  rfPowerCapabilities: RfPowerCapabilities;
  localRFLevel: number;
  localNRLevel: number;
  localNBLevel: number;
  isDraggingRF: React.MutableRefObject<boolean>;
  isDraggingRFLevel: React.MutableRefObject<boolean>;
  isDraggingNR: React.MutableRefObject<boolean>;
  isDraggingNB: React.MutableRefObject<boolean>;
  setLocalRFPower: React.Dispatch<React.SetStateAction<number>>;
  setLocalRFLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNRLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNBLevel: React.Dispatch<React.SetStateAction<number>>;
  handleSetPTT: (state: boolean) => void;
  handleSetFunc: (func: string, state: boolean) => void;
  handleVfoOp: (op: string) => void;
  cycleAttenuator: () => void;
  cyclePreamp: () => void;
  cycleAgc: () => void;
  getAttenuatorLabel: () => string;
  getPreampLabel: () => string;
  getAgcLabel: () => string;

  // CW keyer
  cwSettings: CwSettings;
  cwKeyActive: boolean;
  cwStuckAlert: boolean;

  // POTA/SOTA spots
  potaEnabled: boolean;
  sotaEnabled: boolean;
  activeCompactPowerTab: "levels" | "pota" | "sota";
  setActiveCompactPowerTab: React.Dispatch<
    React.SetStateAction<"levels" | "pota" | "sota">
  >;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaSpotsTable: () => React.ReactElement;

  // Command console
  showCommandConsole: boolean;
  isConsoleCollapsed: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setIsConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;
}

function CompactLayout({
  status,
  connected,
  availableModes,
  socket,
  vfoSupported,
  vfoStep,
  inputVfoA,
  inputVfoB,
  localMode,
  setVfoStep,
  setInputVfoA,
  setInputVfoB,
  adjustVfoFrequency,
  handleSetVFO,
  handleToggleSplit,
  handleSetFreq,
  handleSetMode,
  handleSetBw,
  history,
  activeMeter,
  isCompactSMeterCollapsed,
  setActiveMeter,
  setIsCompactSMeterCollapsed,
  cwDecodeEnabled,
  cwDecodedText,
  cwStats,
  cwScrollContainerRef,
  setCwDecodedText,
  videoStatus,
  isVideoCollapsed,
  isElectronSource,
  videoError,
  videoPreviewCallbackRef,
  videoCanvasRef,
  setIsVideoCollapsed,
  setIsVideoSettingsOpen,
  setVideoError,
  enumerateVideoDevices,
  audioStatus,
  localAudioReady,
  inboundMuted,
  outboundMuted,
  audioSettings,
  audioWasRestarted,
  setInboundMuted,
  setOutboundMuted,
  handleJoinAudio,
  isCompactControlsCollapsed,
  isCompactRFPowerCollapsed,
  setIsCompactControlsCollapsed,
  setIsCompactRFPowerCollapsed,
  isTuning,
  tuneJustFinished,
  attenuatorLevels,
  preampLevels,
  agcLevels,
  nbCapabilities,
  nrCapabilities,
  anfCapabilities,
  localRFPower,
  rfPowerCapabilities,
  localRFLevel,
  localNRLevel,
  localNBLevel,
  isDraggingRF,
  isDraggingRFLevel,
  isDraggingNR,
  isDraggingNB,
  setLocalRFPower,
  setLocalRFLevel,
  setLocalNRLevel,
  setLocalNBLevel,
  handleSetPTT,
  handleSetFunc,
  handleVfoOp,
  cycleAttenuator,
  cyclePreamp,
  cycleAgc,
  getAttenuatorLabel,
  getPreampLabel,
  getAgcLabel,
  cwSettings,
  cwKeyActive,
  cwStuckAlert,
  potaEnabled,
  sotaEnabled,
  activeCompactPowerTab,
  setActiveCompactPowerTab,
  renderSpotsTable,
  renderSotaSpotsTable,
  showCommandConsole,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
}: CompactLayoutProps) {
  return (
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
            <div className="flex-1 flex flex-col min-h-0">
              <div className={cn("p-2 flex-1", cwDecodeEnabled ? "min-h-[60px]" : "min-h-[80px]")}>
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
              {cwDecodeEnabled && (
                <div className="flex flex-col h-[80px] border-t border-[#2a2b2e] overflow-hidden">
                  <div className="px-2 py-1 flex items-center justify-between border-b border-[#2a2b2e]">
                    <div className="flex items-center gap-2">
                      <span className="text-[0.625rem] uppercase text-emerald-500 font-bold tracking-wider">CW Decode</span>
                      {cwStats.pitch > 0 && (
                        <span className="text-[0.625rem] text-[#8e9299]">
                          {Math.round(cwStats.pitch)}Hz&nbsp;{Math.round(cwStats.speed)}wpm
                        </span>
                      )}
                    </div>
                    <button onClick={() => setCwDecodedText('')} className="px-1.5 py-0.5 hover:bg-white/5 rounded text-[0.5rem] uppercase tracking-wider text-[#8e9299] hover:text-white/60">Clear</button>
                  </div>
                  <div ref={cwScrollContainerRef} className="flex-1 overflow-y-auto cw-scroll p-2 font-mono text-[0.625rem] text-emerald-400 leading-relaxed break-all">
                    {cwDecodedText || <span className="text-[#4a4b4e]">waiting for CW…</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Video Feed Section */}
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
              {cwSettings.enabled && (
                <div className={cn(
                  "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5",
                  cwStuckAlert ? "bg-red-900/30 border-red-500 text-red-400" : cwKeyActive ? "bg-amber-500/20 border-amber-400 text-amber-300" : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299]"
                )}>
                  <span className="text-[0.6rem] font-bold leading-none">CW</span>
                  <span className="text-[0.5rem] leading-none">{cwSettings.wpm}W</span>
                  <div className={cn("w-2 h-2 rounded-full mt-0.5", cwStuckAlert ? "bg-red-500" : cwKeyActive ? "bg-amber-400 animate-pulse" : "bg-[#2a2b2e]")} />
                </div>
              )}
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

      {showCommandConsole && (
        <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-lg flex flex-col">
          <div className="bg-[#1a1b1e] px-3 py-2 border-b border-[#2a2b2e] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings size={12} className="text-[#8e9299]" />
              <span className="text-[0.5625rem] uppercase font-bold tracking-widest text-[#8e9299]">Rigctld Command Console</span>
            </div>
            <button
              onClick={() => setIsConsoleCollapsed(!isConsoleCollapsed)}
              className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
              title={isConsoleCollapsed ? "Expand Console" : "Collapse Console"}
            >
              {isConsoleCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
          {!isConsoleCollapsed && (
            <div className="p-3 space-y-3">
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
                    "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-[#4a4b4e]",
                    !connected && "opacity-50 cursor-not-allowed"
                  )}
                />
                <button
                  type="submit"
                  disabled={!connected || !rawCommand.trim()}
                  className="px-5 py-2 bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 rounded font-bold uppercase text-xs hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(CompactLayout);
