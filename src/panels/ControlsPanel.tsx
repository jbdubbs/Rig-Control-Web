import React from "react";
import { Mic, RefreshCw, Signal, Zap, Waves, Activity, Settings } from "lucide-react";
import { cn } from "../utils";
import type { RigStatus, CwSettings, NbCapabilities, NrCapabilities, AnfCapabilities } from "../types";

export interface ControlsPanelProps {
  variant: "phone" | "compact" | "desktop";
  connected: boolean;
  status: RigStatus;
  isTuning: boolean;
  tuneJustFinished: boolean;
  cwSettings: CwSettings;
  cwKeyActive: boolean;
  cwStuckAlert: boolean;
  attenuatorLevels: string[];
  preampLevels: string[];
  agcLevels: string[];
  nbCapabilities: NbCapabilities;
  nrCapabilities: NrCapabilities;
  anfCapabilities: AnfCapabilities;
  handleSetPTT: (state: boolean) => void;
  handleSetFunc: (func: string, state: boolean) => void;
  handleVfoOp: (op: string) => void;
  cycleAttenuator: () => void;
  cyclePreamp: () => void;
  cycleAgc: () => void;
  getAttenuatorLabel: () => string;
  getPreampLabel: () => string;
  getAgcLabel: () => string;
}

export default function ControlsPanel({
  variant,
  connected,
  status,
  isTuning,
  tuneJustFinished,
  cwSettings,
  cwKeyActive,
  cwStuckAlert,
  attenuatorLevels,
  preampLevels,
  agcLevels,
  nbCapabilities,
  nrCapabilities,
  anfCapabilities,
  handleSetPTT,
  handleSetFunc,
  handleVfoOp,
  cycleAttenuator,
  cyclePreamp,
  cycleAgc,
  getAttenuatorLabel,
  getPreampLabel,
  getAgcLabel,
}: ControlsPanelProps) {
  const isDesktop = variant === "desktop";
  const isPhone = variant === "phone";

  // Desktop: p-4 with large buttons in 4-col grid
  // Compact: p-2 with h-12 buttons in 3-col grid
  // Phone: button grids only (no outer box) — 3-col then 4-col rows
  const iconSizeLarge = isDesktop ? 20 : 18;
  const iconSizeSmall = isDesktop ? 20 : 16;
  const btnBase = isDesktop
    ? "flex flex-col items-center justify-center p-4 rounded-lg border transition-all gap-2"
    : "flex flex-col items-center justify-center h-12 rounded-lg border transition-all gap-0.5";
  const btnBasePhone = "flex flex-col items-center justify-center h-12 rounded-xl border transition-all gap-1";
  const labelClass = isDesktop ? "text-[0.625rem]" : "text-xs";
  const subLabelClass = isDesktop ? "text-[0.5625rem]" : "text-[0.625rem]";

  const tuneBtn = (extraClass = "") => (
    <button
      onClick={() => { if (isTuning) return; status.tuner ? handleSetFunc("TUNER", false) : handleVfoOp("TUNE"); }}
      disabled={!connected || isTuning}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || isTuning) && "cursor-not-allowed",
        isTuning ? "bg-red-500/20 border-red-500 text-red-500"
          : (status.tuner || tuneJustFinished) ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
          : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <RefreshCw size={isPhone ? 18 : iconSizeLarge} className={cn("transition-transform", isTuning ? "animate-spin" : isDesktop ? "group-active:rotate-180" : "")} />
      <span className={cn(labelClass, "uppercase font-bold leading-none")}>Tune</span>
    </button>
  );

  const attenBtn = (extraClass = "") => (
    <button
      onClick={cycleAttenuator}
      disabled={!connected || attenuatorLevels.length === 0}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || attenuatorLevels.length === 0) && "opacity-50 cursor-not-allowed",
        status.attenuation > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <Signal size={isPhone ? 18 : iconSizeSmall} />
      {isDesktop ? (
        <div className="flex flex-col items-center">
          <span className={cn(labelClass, "uppercase font-bold")}>Atten</span>
          <span className={cn(subLabelClass, "font-bold opacity-80")}>{getAttenuatorLabel()}</span>
        </div>
      ) : (
        <span className={cn(labelClass, "uppercase font-bold leading-none")}>{getAttenuatorLabel()}</span>
      )}
    </button>
  );

  const preampBtn = (extraClass = "") => (
    <button
      onClick={cyclePreamp}
      disabled={!connected || preampLevels.length === 0}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || preampLevels.length === 0) && "opacity-50 cursor-not-allowed",
        status.preamp > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <Zap size={isPhone ? 18 : iconSizeSmall} />
      {isDesktop ? (
        <div className="flex flex-col items-center">
          <span className={cn(labelClass, "uppercase font-bold")}>Preamp</span>
          <span className={cn(subLabelClass, "font-bold opacity-80")}>{getPreampLabel()}</span>
        </div>
      ) : (
        <span className={cn(labelClass, "uppercase font-bold leading-none")}>{getPreampLabel()}</span>
      )}
    </button>
  );

  const nbBtn = (extraClass = "") => (
    <button
      onClick={() => handleSetFunc("NB", !status.nb)}
      disabled={!connected || !nbCapabilities.supported}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || !nbCapabilities.supported) && "opacity-50 cursor-not-allowed",
        status.nb ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <Waves size={isPhone ? 16 : iconSizeSmall} />
      {isDesktop ? (
        <div className="flex flex-col items-center">
          <span className={cn(labelClass, "uppercase font-bold")}>NB</span>
          <span className={cn(subLabelClass, "font-bold opacity-80")}>{status.nb ? "ON" : "OFF"}</span>
        </div>
      ) : (
        <span className={cn(labelClass, "uppercase font-bold leading-none")}>NB</span>
      )}
    </button>
  );

  const nrBtn = (extraClass = "") => (
    <button
      onClick={() => handleSetFunc("NR", !status.nr)}
      disabled={!connected || !nrCapabilities.supported}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed",
        status.nr ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <Activity size={isPhone ? 16 : iconSizeSmall} />
      {isDesktop ? (
        <div className="flex flex-col items-center">
          <span className={cn(labelClass, "uppercase font-bold")}>DNR</span>
          <span className={cn(subLabelClass, "font-bold opacity-80")}>{status.nr ? "ON" : "OFF"}</span>
        </div>
      ) : (
        <span className={cn(labelClass, "uppercase font-bold leading-none")}>DNR</span>
      )}
    </button>
  );

  const anfBtn = (extraClass = "") => (
    <button
      onClick={() => handleSetFunc("ANF", !status.anf)}
      disabled={!connected || !anfCapabilities.supported}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || !anfCapabilities.supported) && "opacity-50 cursor-not-allowed",
        status.anf ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <Activity size={isPhone ? 16 : iconSizeSmall} />
      {isDesktop ? (
        <div className="flex flex-col items-center">
          <span className={cn(labelClass, "uppercase font-bold")}>ANF</span>
          <span className={cn(subLabelClass, "font-bold opacity-80")}>{status.anf ? "ON" : "OFF"}</span>
        </div>
      ) : (
        <span className={cn(labelClass, "uppercase font-bold leading-none")}>ANF</span>
      )}
    </button>
  );

  const agcBtn = (extraClass = "") => (
    <button
      onClick={cycleAgc}
      disabled={!connected || agcLevels.length === 0}
      className={cn(
        isPhone ? btnBasePhone : btnBase, extraClass,
        (!connected || agcLevels.length === 0) && "opacity-50 cursor-not-allowed",
        status.agc > 0 ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
      )}
    >
      <Settings size={isPhone ? 16 : iconSizeSmall} />
      <div className="flex flex-col items-center leading-none">
        <span className={cn(labelClass, "uppercase font-bold")}>AGC</span>
        <span className={cn(subLabelClass, "font-bold opacity-80")}>{getAgcLabel()}</span>
      </div>
    </button>
  );

  const cwIndicator = (
    <div className={cn(
      isPhone ? btnBasePhone : btnBase,
      cwStuckAlert ? "bg-red-900/30 border-red-500 text-red-400"
        : cwKeyActive ? "bg-amber-500/20 border-amber-400 text-amber-300"
        : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299]"
    )}>
      {isDesktop ? (
        <>
          <div className={cn("w-3 h-3 rounded-full", cwStuckAlert ? "bg-red-500" : cwKeyActive ? "bg-amber-400 animate-pulse" : "bg-[#2a2b2e]")} />
          <span className="text-[0.625rem] uppercase font-bold">CW KEY</span>
          <span className="text-[0.5rem] text-[#8e9299]">{cwSettings.wpm} WPM</span>
        </>
      ) : (
        <>
          <span className="text-[0.6rem] font-bold leading-none">CW</span>
          <span className="text-[0.5rem] leading-none">{cwSettings.wpm}W</span>
          <div className={cn("w-2 h-2 rounded-full mt-0.5", cwStuckAlert ? "bg-red-500" : cwKeyActive ? "bg-amber-400 animate-pulse" : "bg-[#2a2b2e]")} />
        </>
      )}
    </div>
  );

  // Phone: button grids only, no outer box
  if (isPhone) {
    return (
      <>
        <div className="grid grid-cols-3 gap-2">
          {tuneBtn()}
          {attenBtn()}
          {preampBtn()}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {nbBtn()}
          {agcBtn()}
          {nrBtn()}
          {anfBtn()}
        </div>
      </>
    );
  }

  // Compact: headless content (chrome provided by PanelChrome in layout)
  if (variant === "compact") {
    return (
      <div className="grid grid-cols-3 gap-2 h-full content-start">
        <button
          onClick={() => handleSetPTT(!status.ptt)}
          disabled={!connected}
          className={cn(
            btnBase,
            !connected && "opacity-50 cursor-not-allowed",
            status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
          )}
        >
          <Mic size={16} />
          <span className="text-xs uppercase font-bold leading-none">PTT</span>
        </button>
        {cwSettings.enabled && cwIndicator}
        {tuneBtn()}
        {attenBtn()}
        {preampBtn()}
        {nbBtn()}
        {anfBtn()}
        {agcBtn()}
        {nrBtn()}
      </div>
    );
  }

  // Desktop: headless content (chrome provided by PanelChrome in layout)
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <button
        onClick={() => handleSetPTT(!status.ptt)}
        disabled={!connected}
        className={cn(
          btnBase,
          !connected && "opacity-50 cursor-not-allowed",
          status.ptt
            ? "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
            : "bg-[#0a0a0a] border-[#2a2b2e] hover:border-emerald-500"
        )}
      >
        <Mic size={20} />
        <span className="text-[0.625rem] uppercase font-bold">PTT</span>
      </button>
      {cwSettings.enabled && cwIndicator}
      {tuneBtn("group")}
      {attenBtn()}
      {preampBtn()}
      {nbBtn()}
      {nrBtn()}
      {anfBtn()}
      {agcBtn()}
    </div>
  );
}
