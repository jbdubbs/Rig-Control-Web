import React from "react";
import { Waves, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../utils";
import { BANDWIDTHS } from "../constants";

export interface ModeBwPanelProps {
  variant: "phone" | "compact" | "desktop";
  connected: boolean;
  localMode: string;
  availableModes: string[];
  handleSetMode: (mode: string) => void;
  bandwidth: number | string;
  handleSetBw: (bw: number) => void;
  // Only used by desktop variant
  isModeCollapsed?: boolean;
  setIsModeCollapsed?: React.Dispatch<React.SetStateAction<boolean>>;
  isBwCollapsed?: boolean;
  setIsBwCollapsed?: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function ModeBwPanel({
  variant,
  connected,
  localMode,
  availableModes,
  handleSetMode,
  bandwidth,
  handleSetBw,
  isModeCollapsed,
  setIsModeCollapsed,
  isBwCollapsed,
  setIsBwCollapsed,
}: ModeBwPanelProps) {
  if (variant !== "desktop") {
    const isPhone = variant === "phone";
    const selectClass = isPhone
      ? "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500"
      : "bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500";
    const bwLabel = (bw: number) => isPhone ? `${bw}Hz` : `${bw}Hz`;

    // Inline dropdowns for phone/compact — no outer box
    return (
      <>
        <select
          value={localMode}
          onChange={(e) => handleSetMode(e.target.value)}
          disabled={!connected}
          className={cn(selectClass, !connected && "opacity-50 cursor-not-allowed")}
        >
          {availableModes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={bandwidth || "2400"}
          onChange={(e) => handleSetBw(parseInt(e.target.value))}
          disabled={!connected}
          className={cn(selectClass, !connected && "opacity-50 cursor-not-allowed")}
        >
          {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bwLabel(bw)}</option>)}
        </select>
      </>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Mode Selection */}
      <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
          <div className="flex items-center gap-2 text-[#8e9299]">
            <Waves size={14} />
            <span className="text-[0.625rem] uppercase tracking-widest font-bold">Mode Selection</span>
          </div>
          <button
            onClick={() => setIsModeCollapsed?.(!isModeCollapsed)}
            className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
            title={isModeCollapsed ? "Expand Mode Selection" : "Collapse Mode Selection"}
          >
            {isModeCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
        {!isModeCollapsed && (
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

      {/* Filter Bandwidth */}
      <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
          <div className="flex items-center gap-2 text-[#8e9299]">
            <Settings size={14} />
            <span className="text-[0.625rem] uppercase tracking-widest font-bold">Filter Bandwidth</span>
          </div>
          <button
            onClick={() => setIsBwCollapsed?.(!isBwCollapsed)}
            className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
            title={isBwCollapsed ? "Expand Filter Bandwidth" : "Collapse Filter Bandwidth"}
          >
            {isBwCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
        {!isBwCollapsed && (
          <div className="p-6">
            <select
              value={bandwidth || "2400"}
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
  );
}
