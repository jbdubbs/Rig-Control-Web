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
  Radio,
  Headphones,
  MapPin,
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

export interface PhoneLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
  socket: Socket | null;

  // VFO
  vfoStep: number;
  inputVfoA: string;
  inputVfoB: string;
  localMode: string;
  setVfoStep: React.Dispatch<React.SetStateAction<number>>;
  setInputVfoA: React.Dispatch<React.SetStateAction<string>>;
  setInputVfoB: React.Dispatch<React.SetStateAction<string>>;
  isPhoneVFOCollapsed: boolean;
  setIsPhoneVFOCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
  handleSetVFO: (vfo: string) => void;
  handleToggleSplit: () => void;
  handleSetFreq: (freq: string) => void;
  handleSetMode: (mode: string) => void;
  handleSetBw: (bw: number) => void;

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

  // Meters
  isPhoneMeterCollapsed: boolean;
  phoneMeterTab: "signal" | "swr" | "alc";
  history: any[];
  setIsPhoneMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setPhoneMeterTab: React.Dispatch<
    React.SetStateAction<"signal" | "swr" | "alc">
  >;

  // Quick controls
  isPhoneQuickControlsCollapsed: boolean;
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
  setIsPhoneQuickControlsCollapsed: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  setLocalRFPower: React.Dispatch<React.SetStateAction<number>>;
  setLocalRFLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNRLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNBLevel: React.Dispatch<React.SetStateAction<number>>;
  handleSetFunc: (func: string, state: boolean) => void;
  handleVfoOp: (op: string) => void;
  cycleAttenuator: () => void;
  cyclePreamp: () => void;
  cycleAgc: () => void;
  getAttenuatorLabel: () => string;
  getPreampLabel: () => string;
  getAgcLabel: () => string;

  // POTA spots
  potaEnabled: boolean;
  potaSpotsCollapsed: boolean;
  filteredSpots: any[];
  potaSpotsBoxRef: React.RefObject<HTMLDivElement>;
  setPotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;

  // SOTA spots
  sotaEnabled: boolean;
  sotaSpotsCollapsed: boolean;
  filteredSotaSpots: any[];
  sotaSpotsBoxRef: React.RefObject<HTMLDivElement>;
  setSotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  renderSotaSpotsTable: () => React.ReactElement;

  // CW
  cwSettings: CwSettings;

  // Command console
  showCommandConsole: boolean;
  isConsoleCollapsed: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setIsConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;
}

function PhoneLayout({
  status,
  connected,
  availableModes,
  socket,
  vfoStep,
  inputVfoA,
  inputVfoB,
  localMode,
  setVfoStep,
  setInputVfoA,
  setInputVfoB,
  isPhoneVFOCollapsed,
  setIsPhoneVFOCollapsed,
  adjustVfoFrequency,
  handleSetVFO,
  handleToggleSplit,
  handleSetFreq,
  handleSetMode,
  handleSetBw,
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
  isPhoneMeterCollapsed,
  phoneMeterTab,
  history,
  setIsPhoneMeterCollapsed,
  setPhoneMeterTab,
  isPhoneQuickControlsCollapsed,
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
  setIsPhoneQuickControlsCollapsed,
  setLocalRFPower,
  setLocalRFLevel,
  setLocalNRLevel,
  setLocalNBLevel,
  handleSetFunc,
  handleVfoOp,
  cycleAttenuator,
  cyclePreamp,
  cycleAgc,
  getAttenuatorLabel,
  getPreampLabel,
  getAgcLabel,
  potaEnabled,
  potaSpotsCollapsed,
  filteredSpots,
  potaSpotsBoxRef,
  setPotaSpotsCollapsed,
  renderSpotsTable,
  sotaEnabled,
  sotaSpotsCollapsed,
  filteredSotaSpots,
  sotaSpotsBoxRef,
  setSotaSpotsCollapsed,
  renderSotaSpotsTable,
  cwSettings,
  showCommandConsole,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
}: PhoneLayoutProps) {
  return (
    <div className="space-y-2 animate-in fade-in duration-300">
      {/* CW mode warning */}
      {cwSettings.enabled && connected && !['CW', 'CWR', 'CW-R'].includes(status?.mode || '') && (
        <div className="bg-amber-900/40 border border-amber-500/60 text-amber-300 text-xs font-bold px-3 py-2 rounded-xl text-center">
          Radio not in CW mode — Switch mode to key
        </div>
      )}
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
              {isVideoCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
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

      {/* Meters */}
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
                  {m === 'signal' ? (status.ptt ? 'POWER' : 'SIGNAL') : m.toUpperCase()}
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
              <div className="bg-[#0a0a0a] rounded border border-[#2a2b2e] h-32 overflow-y-auto p-2 font-mono text-[0.6875rem] space-y-1">
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
                  placeholder="e.g. 'f', 'm', 'v', 't'..."
                  className={cn(
                    "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 transition-colors placeholder:text-[#4a4b4e]",
                    !connected && "opacity-50 cursor-not-allowed"
                  )}
                />
                <button
                  type="submit"
                  disabled={!connected || !rawCommand.trim()}
                  className="px-4 py-1.5 bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 rounded font-bold uppercase text-xs hover:bg-emerald-500 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

export default React.memo(PhoneLayout);
