import React from "react";
import { X } from "lucide-react";
import { cn } from "../utils";
import { PANEL_LABELS } from "../types/layout";
import type { PanelType } from "../types/layout";

const PANEL_ORDER: PanelType[] = [
  "vfo",
  "smeter",
  "videoaudio",
  "controls",
  "rflevels",
  "swr",
  "alc",
  "modebw",
  "cwdecode",
  "commandconsole",
  "spots_pota",
  "spots_sota",
];

interface PanelPickerProps {
  existingTypes: Set<PanelType>;
  availableTypes?: PanelType[];
  onSelect: (type: PanelType) => void;
  onClose: () => void;
}

export default function PanelPicker({ existingTypes, availableTypes, onSelect, onClose }: PanelPickerProps) {
  const displayTypes = availableTypes ?? PANEL_ORDER;
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Picker panel */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 bg-[#151619] border border-[#2a2b2e] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-[#2a2b2e] bg-[#1a1b1e]">
          <span className="text-[0.5625rem] uppercase tracking-widest font-bold text-[#8e9299]">Add Panel</span>
          <button onClick={onClose} className="p-1 text-[#8e9299] hover:text-white rounded hover:bg-white/5 transition-all">
            <X size={14} />
          </button>
        </div>
        <div className="p-2 grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto custom-scrollbar">
          {displayTypes.map((type) => {
            const inUse = existingTypes.has(type);
            return (
              <button
                key={type}
                disabled={inUse}
                onClick={() => { onSelect(type); onClose(); }}
                className={cn(
                  "text-left px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition-all border",
                  inUse
                    ? "text-[#4a4b4e] border-[#2a2b2e] cursor-not-allowed"
                    : "text-[#e0e0e0] border-[#2a2b2e] hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-300"
                )}
              >
                {PANEL_LABELS[type]}
                {inUse && <span className="block text-[0.5rem] text-[#4a4b4e] normal-case tracking-normal mt-0.5">already placed</span>}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
