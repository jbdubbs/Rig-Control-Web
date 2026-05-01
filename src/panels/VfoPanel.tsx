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
  return (
    <>
      <button
        onClick={() => adjustVfoFrequency(status.vfo === "VFOA" ? "A" : "B", -1)}
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
              : status.vfo === "VFOA"
              ? "bg-emerald-500"
              : "bg-blue-500"
          )}
        />
        <span
          className={cn(
            "text-xs font-bold uppercase flex-shrink-0",
            status.isSplit
              ? "text-amber-500"
              : status.vfo === "VFOA"
              ? "text-emerald-500"
              : "text-blue-500"
          )}
        >
          {status.isSplit ? "SPLIT" : status.vfo === "VFOA" ? "A" : "B"}
        </span>
        <span className="text-[#4a4b4e] flex-shrink-0">—</span>
        <span
          className={cn(
            "text-sm font-mono font-bold truncate",
            status.ptt
              ? "text-red-500"
              : status.isSplit
              ? "text-amber-500"
              : status.vfo === "VFOA"
              ? "text-emerald-500"
              : "text-blue-500"
          )}
        >
          {parseFloat(status.vfo === "VFOA" ? inputVfoA : inputVfoB).toFixed(3)} MHz
        </span>
        <span className="text-[#4a4b4e] flex-shrink-0">—</span>
        <span className="text-xs font-bold text-[#8e9299] flex-shrink-0">
          {localMode}
        </span>
      </div>
      <button
        onClick={() => adjustVfoFrequency(status.vfo === "VFOA" ? "A" : "B", 1)}
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
}: VfoPanelProps) {

  // ─── Compact: combined VFO + Mode/BW row ─────────────────────────
  if (variant === "compact") {
    return (
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
                  : (status.vfo === "VFOA" ? "bg-emerald-500 text-white border border-emerald-500" : "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500/20")
              )}
            >VFO A</button>
            <button
              onClick={() => handleSetVFO("VFOB")}
              disabled={!connected || !vfoSupported}
              className={cn(
                "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                (!connected || !vfoSupported) && "opacity-50 cursor-not-allowed",
                status.isSplit
                  ? (status.txVFO === "VFOB" ? "bg-red-500 text-white border border-red-500" : "bg-amber-500 text-white border border-amber-500")
                  : (status.vfo === "VFOB" ? "bg-blue-500 text-white border border-blue-500" : "bg-blue-500/10 text-blue-500 border border-blue-500/30 hover:bg-blue-500/20")
              )}
            >VFO B</button>
            <button
              onClick={handleToggleSplit}
              disabled={!connected || !vfoSupported}
              className={cn(
                "px-3 py-1 rounded text-xs font-bold uppercase transition-all",
                (!connected || !vfoSupported) && "opacity-50 cursor-not-allowed",
                status.isSplit ? "bg-red-500 text-white border border-red-500" : "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20"
              )}
            >SPLIT</button>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', -1)}
              disabled={!connected}
              className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
              title="Frequency Down"
            >
              <ChevronLeft size={12} />
              <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
            </button>
            <button
              onClick={() => adjustVfoFrequency(status.vfo === 'VFOA' ? 'A' : 'B', 1)}
              disabled={!connected}
              className="flex items-center gap-1 px-2 py-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
              title="Frequency Up"
            >
              <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
              <ChevronRight size={12} />
            </button>
          </div>
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
              />
            </div>
          )}
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
              if (!isNaN(val)) handleSetFreq(Math.round(val * 1000000).toString());
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={cn(
              "w-full bg-white/5 text-4xl font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg transition-all cursor-text py-1 px-2 border",
              !connected && "opacity-50 cursor-not-allowed",
              status.isSplit
                ? (status.vfo === status.txVFO ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50" : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50")
                : (status.vfo === "VFOA" ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50" : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50")
            )}
            title="Click to edit frequency"
          />
          <span className={cn("text-sm font-bold", status.vfo === "VFOA" ? "text-emerald-500/50" : "text-blue-500/50")}>MHz</span>
          <Pencil size={12} className={cn(
            "absolute right-12 top-1/2 -translate-y-1/2 transition-opacity pointer-events-none",
            status.vfo === "VFOA" ? "text-emerald-500/30" : "text-blue-500/30"
          )} />
        </div>

        <div className="flex gap-1 justify-center pb-0.5">
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
      </div>
    );
  }

  // ─── Phone: headless content (chrome provided by PanelChrome in layout) ─
  return (
    <>
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
            onClick={() => adjustVfoFrequency(status.vfo === "VFOA" ? "A" : "B", -1)}
            disabled={!connected}
            className="flex items-center gap-1 px-2 py-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
            title="Frequency Down"
          >
            <ChevronLeft size={14} />
            <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
          </button>
          <button
            onClick={() => adjustVfoFrequency(status.vfo === "VFOA" ? "A" : "B", 1)}
            disabled={!connected}
            className="flex items-center gap-1 px-2 py-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded-lg text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
            title="Frequency Up"
          >
            <span className="text-[0.625rem] font-bold">{stepLabel(vfoStep)}</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-baseline justify-center gap-2">
        <input
          type="number"
          step={vfoStep}
          value={status.vfo === "VFOA" ? inputVfoA : inputVfoB}
          onChange={(e) =>
            status.vfo === "VFOA"
              ? setInputVfoA(e.target.value)
              : setInputVfoB(e.target.value)
          }
          disabled={!connected}
          onBlur={() => {
            const val = parseFloat(
              status.vfo === "VFOA" ? inputVfoA : inputVfoB
            );
            if (!isNaN(val))
              handleSetFreq(Math.round(val * 1000000).toString());
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cn(
            "w-full bg-white/5 text-3xl font-bold tracking-tighter font-mono text-center focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-xl transition-all cursor-text py-1.5 px-3 border",
            !connected && "opacity-50 cursor-not-allowed",
            status.isSplit
              ? status.vfo === status.txVFO
                ? "text-red-500 hover:bg-red-500/10 focus:bg-red-500/10 border-red-500/30 focus:border-red-500/50"
                : "text-amber-500 hover:bg-amber-500/10 focus:bg-amber-500/10 border-amber-500/30 focus:border-amber-500/50"
              : status.vfo === "VFOA"
              ? "text-emerald-500 hover:bg-emerald-500/10 focus:bg-emerald-500/10 border-[#2a2b2e] focus:border-emerald-500/50"
              : "text-blue-500 hover:bg-blue-500/10 focus:bg-blue-500/10 border-[#2a2b2e] focus:border-blue-500/50"
          )}
        />
        <span
          className={cn(
            "text-sm font-bold flex-shrink-0",
            status.vfo === "VFOA" ? "text-emerald-500/50" : "text-blue-500/50"
          )}
        >
          MHz
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-0.5 justify-center">
        {VFO_STEPS.map((s) => (
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
            {stepLabel(s)}
          </button>
        ))}
      </div>

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
          />
        </div>
      )}
    </>
  );
}
