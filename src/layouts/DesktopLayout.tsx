import React from "react";
import type { Socket } from "socket.io-client";
import {
  Activity,
  Settings,
  Mic,
  Zap,
  Waves,
  Signal,
  Gauge,
  RefreshCw,
  Volume2,
  VolumeX,
  MicOff,
  Monitor,
  ChevronDown,
  ChevronUp,
  Pencil,
  AlertCircle,
  Headphones,
  MapPin,
  Power,
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
import { cn, formatStep } from "../utils";
import { VFO_STEPS, BANDWIDTHS } from "../constants";
import type {
  RigStatus,
  CwSettings,
  AudioSettings,
  NbCapabilities,
  NrCapabilities,
  AnfCapabilities,
  RfPowerCapabilities,
} from "../types";

export interface DesktopLayoutProps {
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

  // Desktop-specific collapse states
  isDesktopControlsCollapsed: boolean;
  setIsDesktopControlsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopModeCollapsed: boolean;
  setIsDesktopModeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopBwCollapsed: boolean;
  setIsDesktopBwCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopRFPowerCollapsed: boolean;
  setIsDesktopRFPowerCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopSMeterCollapsed: boolean;
  setIsDesktopSMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopSWRCollapsed: boolean;
  setIsDesktopSWRCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopALCCollapsed: boolean;
  setIsDesktopALCCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

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

  // Controls / levels
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

  // History / meters
  history: any[];

  // POTA/SOTA spots
  potaEnabled: boolean;
  sotaEnabled: boolean;
  potaSpotsCollapsed: boolean;
  sotaSpotsCollapsed: boolean;
  filteredSpots: any[];
  filteredSotaSpots: any[];
  setPotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setSotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaSpotsTable: () => React.ReactElement;
}

function DesktopLayout({
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
  isDesktopControlsCollapsed,
  setIsDesktopControlsCollapsed,
  isDesktopModeCollapsed,
  setIsDesktopModeCollapsed,
  isDesktopBwCollapsed,
  setIsDesktopBwCollapsed,
  isDesktopRFPowerCollapsed,
  setIsDesktopRFPowerCollapsed,
  isDesktopSMeterCollapsed,
  setIsDesktopSMeterCollapsed,
  isDesktopSWRCollapsed,
  setIsDesktopSWRCollapsed,
  isDesktopALCCollapsed,
  setIsDesktopALCCollapsed,
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
  history,
  potaEnabled,
  sotaEnabled,
  potaSpotsCollapsed,
  sotaSpotsCollapsed,
  filteredSpots,
  filteredSotaSpots,
  setPotaSpotsCollapsed,
  setSotaSpotsCollapsed,
  renderSpotsTable,
  renderSotaSpotsTable,
}: DesktopLayoutProps) {
  return (
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

          {cwSettings.enabled && (
            <div className={cn(
              "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-1",
              cwStuckAlert ? "bg-red-900/30 border-red-500 text-red-400" : cwKeyActive ? "bg-amber-500/20 border-amber-400 text-amber-300" : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299]"
            )}>
              <div className={cn("w-3 h-3 rounded-full", cwStuckAlert ? "bg-red-500" : cwKeyActive ? "bg-amber-400 animate-pulse" : "bg-[#2a2b2e]")} />
              <span className="text-[0.625rem] uppercase font-bold">CW KEY</span>
              <span className="text-[0.5rem] text-[#8e9299]">{cwSettings.wpm} WPM</span>
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
  );
}

export default React.memo(DesktopLayout);
