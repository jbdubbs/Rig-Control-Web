import React from "react";
import { cn } from "../utils";
import { BANDWIDTHS } from "../constants";

export interface ModeBwPanelProps {
  variant: "phone" | "compact";
  connected: boolean;
  localMode: string;
  availableModes: string[];
  handleSetMode: (mode: string) => void;
  bandwidth: number | string;
  handleSetBw: (bw: number) => void;
}

export default function ModeBwPanel({
  variant,
  connected,
  localMode,
  availableModes,
  handleSetMode,
  bandwidth,
  handleSetBw,
}: ModeBwPanelProps) {
  const isPhone = variant === "phone";
  const selectClass = isPhone
    ? "flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-sm font-bold focus:outline-none focus:border-emerald-500"
    : "bg-[#0a0a0a] border border-[#2a2b2e] rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500";

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
        {BANDWIDTHS.map(bw => <option key={bw} value={bw}>{bw}Hz</option>)}
      </select>
    </>
  );
}
