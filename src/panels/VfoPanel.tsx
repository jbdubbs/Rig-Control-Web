import React from "react";
import { Pencil, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatStep } from "../utils";
import { VFO_STEPS } from "../constants";
import type { RigStatus } from "../types";
import ModeBwPanel from "./ModeBwPanel";

export interface VfoPanelProps {
  variant: "compact" | "phone";
  vfo?: "A" | "B";
  connected: boolean;
  status: RigStatus;
  vfoStep: number;
  setVfoStep: React.Dispatch<React.SetStateAction<number>>;
  inputVfoA: string;
  setInputVfoA: React.Dispatch<React.SetStateAction<string>>;
  inputVfoB: string;
  setInputVfoB: React.Dispatch<React.SetStateAction<string>>;
  vfoSupported?: boolean;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
  handleSetVFO: (vfo: string) => void;
  handleToggleSplit: () => void;
  handleSetFreq: (freq: string) => void;
  localMode?: string;
  availableModes?: string[];
  handleSetMode?: (mode: string) => void;
  handleSetBw?: (bw: number) => void;
  bandwidth?: number | string;
  bwDisabled?: boolean;
}

export interface VfoCollapsedHeaderProps {
  status: RigStatus;
  inputVfoA: string;
  inputVfoB: string;
  localMode: string | undefined;
  vfoStep: number;
  connected: boolean;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
}

export function VfoCollapsedHeader({
  status,
  inputVfoA,
  inputVfoB,
  localMode,
  vfoStep,
  connected,
  adjustVfoFrequency,
}: VfoCollapsedHeaderProps) {
  const vfoIsA = status.vfo === "VFOA";
  const vfoIsB = status.vfo === "VFOB";
  const vfoKnown = vfoIsA || vfoIsB;

  return (
    <>
      <button
        onClick={() => adjustVfoFrequency(vfoIsA ? "A" : "B", -1)}
        disabled={!connected}
        className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50 flex-shrink-0"
        title="Frequency Down"
      >
        <ChevronLeft size={14} />
        <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
      </button>
      <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-center">
        <div
          className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            status.isSplit
              ? "bg-amber-500"
              : !vfoKnown
              ? "bg-[#4a4b4e]"
              : vfoIsA
              ? "bg-emerald-500"
              : "bg-blue-500"
          )}
        />
        <span
          className={cn(
            "text-xs font-bold uppercase flex-shrink-0",
            status.isSplit
              ? "text-amber-500"
              : !vfoKnown
              ? "text-[#8e9299]"
              : vfoIsA
              ? "text-emerald-500"
              : "text-blue-500"
          )}
        >
          {status.isSplit ? "SPLIT" : !vfoKnown ? "-" : vfoIsA ? "A" : "B"}
        </span>
        <span className="text-[#4a4b4e] flex-shrink-0">—</span>
        <span
          className={cn(
            "text-sm font-mono font-bold truncate",
            status.ptt
              ? "text-red-500"
              : status.isSplit
              ? "text-amber-500"
              : !vfoKnown
              ? "text-[#8e9299]"
              : vfoIsA
              ? "text-emerald-500"
              : "text-blue-500"
          )}
        >
          {vfoKnown ? `${parseFloat(vfoIsA ? inputVfoA : inputVfoB).toFixed(3)} MHz` : "-"}
        </span>
        <span className="text-[#4a4b4e] flex-shrink-0">—</span>
        <span className="text-xs font-bold text-[#8e9299] flex-shrink-0">
          {localMode}
        </span>
      </div>
      <button
        onClick={() => adjustVfoFrequency(vfoIsA ? "A" : "B", 1)}
        disabled={!connected}
        className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50 flex-shrink-0"
        title="Frequency Up"
      >
        <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
        <ChevronRight size={14} />
      </button>
    </>
  );
}

function stepLabel(s: number) {
  return s >= 1 ? `${s}M` : s >= 0.001 ? `${Math.round(s * 1000)}k` : `${Math.round(s * 1000000)}Hz`;
}

// ─── Shared sub-components (compact + phone) ──────────────────────────────────
// Extracted so a future fix to the frequency-input commit logic, VFO-button disabled
// conditions, etc. can't be applied to one variant and silently forgotten in the other —
// each renders both sizes from one place, parameterized by `size`.

interface VfoButtonGroupProps {
  size: "compact" | "phone";
  status: RigStatus;
  connected: boolean;
  vfoSupported: boolean;
  handleSetVFO: (vfo: string) => void;
  handleToggleSplit: () => void;
}

function VfoButtonGroup({ size, status, connected, vfoSupported, handleSetVFO, handleToggleSplit }: VfoButtonGroupProps) {
  const isCompact = size === "compact";
  const btnClass = cn(
    "font-bold uppercase transition-all",
    isCompact ? "px-3 py-1 rounded text-xs" : "px-3 py-1.5 rounded-lg text-xs"
  );
  const bDisabled = !connected || !vfoSupported;
  return (
    <div className={cn("flex items-center", isCompact ? "gap-2" : "gap-1.5")}>
      <button
        onClick={() => handleSetVFO("VFOA")}
        disabled={!connected}
        className={cn(
          btnClass,
          !connected && "opacity-50 cursor-not-allowed",
          status.isSplit
            ? (status.txVFO === "VFOA" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
            : (status.vfo === "VFOA" ? "bg-emerald-500 text-white border border-emerald-500" : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20")
        )}
      >{isCompact ? "VFO A" : "A"}</button>
      <button
        onClick={() => handleSetVFO("VFOB")}
        disabled={bDisabled}
        className={cn(
          btnClass,
          bDisabled && "opacity-50 cursor-not-allowed",
          status.isSplit
            ? (status.txVFO === "VFOB" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
            : (status.vfo === "VFOB" ? "bg-blue-500 text-white border border-blue-500" : "bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20")
        )}
      >{isCompact ? "VFO B" : "B"}</button>
      <button
        onClick={handleToggleSplit}
        disabled={bDisabled}
        className={cn(
          btnClass,
          bDisabled && "opacity-50 cursor-not-allowed",
          status.isSplit ? "bg-red-500 text-white border border-red-500" : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
        )}
      >SPLIT</button>
    </div>
  );
}

interface VfoFreqStepButtonsProps {
  size: "compact" | "phone";
  vfoIsA: boolean;
  vfoStep: number;
  connected: boolean;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
}

function VfoFreqStepButtons({ size, vfoIsA, vfoStep, connected, adjustVfoFrequency }: VfoFreqStepButtonsProps) {
  const isCompact = size === "compact";
  const iconSize = isCompact ? 12 : 14;
  const btnClass = cn(
    "flex items-center gap-1 px-2 py-1 border border-[#2a2b2e] text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50",
    isCompact ? "bg-[#0a0a0a] rounded" : "bg-[#1a1b1e] rounded-lg"
  );
  return (
    <div className={cn("flex items-center", isCompact ? "justify-center gap-2" : "gap-1")}>
      <button
        onClick={() => adjustVfoFrequency(vfoIsA ? "A" : "B", -1)}
        disabled={!connected}
        className={btnClass}
        title="Frequency Down"
      >
        <ChevronLeft size={iconSize} />
        <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
      </button>
      <button
        onClick={() => adjustVfoFrequency(vfoIsA ? "A" : "B", 1)}
        disabled={!connected}
        className={btnClass}
        title="Frequency Up"
      >
        <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
        <ChevronRight size={iconSize} />
      </button>
    </div>
  );
}

interface VfoFrequencyInputProps {
  size: "compact" | "phone";
  status: RigStatus;
  connected: boolean;
  vfoKnown: boolean;
  vfoIsA: boolean;
  vfoStep: number;
  inputVfoA: string;
  inputVfoB: string;
  setInputVfoA: React.Dispatch<React.SetStateAction<string>>;
  setInputVfoB: React.Dispatch<React.SetStateAction<string>>;
  handleSetFreq: (freq: string) => void;
}

function VfoFrequencyInput({
  size, status, connected, vfoKnown, vfoIsA, vfoStep,
  inputVfoA, inputVfoB, setInputVfoA, setInputVfoB, handleSetFreq,
}: VfoFrequencyInputProps) {
  const isCompact = size === "compact";
  const colorClass = cn(
    status.isSplit
      ? (status.vfo === status.txVFO ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
      : !vfoKnown ? "text-[#8e9299] hover:bg-white/5 focus:bg-white/5 border-[#2a2b2e] focus:border-[#4a4b4e]"
      : (vfoIsA ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50" : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50")
  );
  const mhzColorClass = !vfoKnown ? "text-[#8e9299]/50" : vfoIsA ? "text-emerald-500/50" : "text-blue-500/50";

  const input = (
    <input
      type="number"
      step={vfoStep}
      value={!vfoKnown ? "" : vfoIsA ? inputVfoA : inputVfoB}
      onChange={(e) => vfoIsA ? setInputVfoA(e.target.value) : setInputVfoB(e.target.value)}
      disabled={!connected || !vfoKnown}
      onBlur={() => {
        if (!vfoKnown) return;
        const val = parseFloat(vfoIsA ? inputVfoA : inputVfoB);
        if (!isNaN(val)) handleSetFreq(Math.round(val * 1000000).toString());
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn(
        "w-full bg-white/5 font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-all cursor-text border",
        isCompact ? "text-4xl rounded-lg py-1 px-2" : "text-3xl rounded-xl py-1.5 px-3",
        !connected && "opacity-50 cursor-not-allowed",
        colorClass
      )}
      {...(isCompact ? { title: "Click to edit frequency" } : {})}
    />
  );

  if (isCompact) {
    return (
      <div className="relative group flex items-baseline justify-center gap-2 py-1">
        {input}
        <span className={cn("text-sm font-bold", mhzColorClass)}>MHz</span>
        <Pencil size={12} className={cn(
          "absolute right-12 top-1/2 -translate-y-1/2 transition-opacity pointer-events-none",
          !vfoKnown ? "text-[#8e9299]/30" : vfoIsA ? "text-emerald-500/30" : "text-blue-500/30"
        )} />
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-center gap-2">
      {input}
      <span className={cn("text-sm font-bold flex-shrink-0", mhzColorClass)}>MHz</span>
    </div>
  );
}

interface VfoStepSelectorProps {
  size: "compact" | "phone";
  vfoStep: number;
  setVfoStep: React.Dispatch<React.SetStateAction<number>>;
  connected: boolean;
}

function VfoStepSelector({ size, vfoStep, setVfoStep, connected }: VfoStepSelectorProps) {
  return (
    <div className={cn("flex gap-1 justify-center pb-0.5", size === "phone" && "overflow-x-auto")}>
      {VFO_STEPS.map(s => (
        <button
          key={s}
          onClick={() => setVfoStep(s)}
          disabled={!connected}
          className={cn(
            "flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold transition-all",
            vfoStep === s ? "bg-emerald-500 text-white" : "bg-[#0a0a0a] border border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/50 disabled:opacity-50"
          )}
        >{stepLabel(s)}</button>
      ))}
    </div>
  );
}

export default function VfoPanel({
  variant,
  vfo = "A",
  connected,
  status,
  vfoStep,
  setVfoStep,
  inputVfoA,
  setInputVfoA,
  inputVfoB,
  setInputVfoB,
  vfoSupported = true,
  adjustVfoFrequency,
  handleSetVFO,
  handleToggleSplit,
  handleSetFreq,
  localMode,
  availableModes,
  handleSetMode,
  handleSetBw,
  bandwidth,
  bwDisabled = false,
}: VfoPanelProps) {
  const vfoIsA = status.vfo === "VFOA";
  const vfoIsB = status.vfo === "VFOB";
  const vfoKnown = vfoIsA || vfoIsB;

  // ─── Compact: combined VFO + Mode/BW row ─────────────────────────
  if (variant === "compact") {
    return (
      <div className={cn(
        "bg-[#151619] p-3 rounded-xl border shadow-lg space-y-2",
        !vfoKnown ? "border-[#2a2b2e]" : vfoIsA ? "border-emerald-500/30" : "border-blue-500/30"
      )}>
        <div className="grid grid-cols-3 items-center">
          <VfoButtonGroup
            size="compact"
            status={status}
            connected={connected}
            vfoSupported={vfoSupported}
            handleSetVFO={handleSetVFO}
            handleToggleSplit={handleToggleSplit}
          />
          <VfoFreqStepButtons
            size="compact"
            vfoIsA={vfoIsA}
            vfoStep={vfoStep}
            connected={connected}
            adjustVfoFrequency={adjustVfoFrequency}
          />
          {localMode !== undefined && handleSetMode && handleSetBw && (
            <div className="flex items-center justify-end gap-2">
              <ModeBwPanel
                variant="compact"
                connected={connected}
                localMode={localMode}
                availableModes={availableModes ?? []}
                handleSetMode={handleSetMode}
                bandwidth={bandwidth ?? "2400"}
                handleSetBw={handleSetBw}
                bwDisabled={bwDisabled}
              />
            </div>
          )}
        </div>

        <VfoFrequencyInput
          size="compact"
          status={status}
          connected={connected}
          vfoKnown={vfoKnown}
          vfoIsA={vfoIsA}
          vfoStep={vfoStep}
          inputVfoA={inputVfoA}
          inputVfoB={inputVfoB}
          setInputVfoA={setInputVfoA}
          setInputVfoB={setInputVfoB}
          handleSetFreq={handleSetFreq}
        />

        <VfoStepSelector size="compact" vfoStep={vfoStep} setVfoStep={setVfoStep} connected={connected} />
      </div>
    );
  }

  // ─── Phone: headless content (chrome provided by PanelChrome in layout) ─
  return (
    <>
      <div className="flex items-center justify-between">
        <VfoButtonGroup
          size="phone"
          status={status}
          connected={connected}
          // PhoneLayout never wires up real vfoSupported capability detection (only
          // CompactLayout does), so this always resolves to the prop's `true` default —
          // preserved here explicitly rather than silently changed by this extraction.
          vfoSupported={true}
          handleSetVFO={handleSetVFO}
          handleToggleSplit={handleToggleSplit}
        />
        <VfoFreqStepButtons
          size="phone"
          vfoIsA={vfoIsA}
          vfoStep={vfoStep}
          connected={connected}
          adjustVfoFrequency={adjustVfoFrequency}
        />
      </div>

      <VfoFrequencyInput
        size="phone"
        status={status}
        connected={connected}
        vfoKnown={vfoKnown}
        vfoIsA={vfoIsA}
        vfoStep={vfoStep}
        inputVfoA={inputVfoA}
        inputVfoB={inputVfoB}
        setInputVfoA={setInputVfoA}
        setInputVfoB={setInputVfoB}
        handleSetFreq={handleSetFreq}
      />

      <VfoStepSelector size="phone" vfoStep={vfoStep} setVfoStep={setVfoStep} connected={connected} />

      {localMode !== undefined && handleSetMode && handleSetBw && (
        <div className="flex items-center gap-2">
          <ModeBwPanel
            variant="phone"
            connected={connected}
            localMode={localMode}
            availableModes={availableModes ?? []}
            handleSetMode={handleSetMode}
            bandwidth={bandwidth ?? "2400"}
            handleSetBw={handleSetBw}
            bwDisabled={bwDisabled}
          />
        </div>
      )}
    </>
  );
}
