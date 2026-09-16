import React from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "../utils";
import { POTA_BANDS, SPOT_MODES } from "../constants";
import { acFor, PillToggleGroup } from "../components/SpotFilterControls";

export interface SpotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'pota' | 'sota' | 'wwff';
  pollRate: number;
  setPollRate: (v: number) => void;
  maxAge: number;
  setMaxAge: (v: number) => void;
  modeFilter: string[];
  setModeFilter: (v: string[]) => void;
  bandFilter: string[];
  setBandFilter: (v: string[]) => void;
}

const MODE_OPTIONS = SPOT_MODES.map(m => ({ value: m, label: m }));
const BAND_OPTIONS = POTA_BANDS.map(b => ({ value: b.label, label: b.label }));

export default function SpotSettingsModal({
  isOpen, onClose, type,
  pollRate, setPollRate,
  maxAge, setMaxAge,
  modeFilter, setModeFilter,
  bandFilter, setBandFilter,
}: SpotSettingsModalProps) {
  if (!isOpen) return null;

  const ac = acFor(type);
  const title = type === 'pota' ? 'POTA Spots Settings' : type === 'wwff' ? 'WWFF Spots Settings' : 'SOTA Spots Settings';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

        <div className="p-4 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-lg", ac.iconBg)}>
              <MapPin size={16} />
            </div>
            <h2 className="text-sm font-bold uppercase tracking-tight">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Frequency</label>
              <select
                value={pollRate}
                onChange={e => setPollRate(Number(e.target.value))}
                className={cn("w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none", ac.focus)}
              >
                {[1, 2, 3, 4, 5].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
              <select
                value={maxAge}
                onChange={e => setMaxAge(Number(e.target.value))}
                className={cn("w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none", ac.focus)}
              >
                {[1, 3, 5, 10, 15].map(m => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
          </div>

          {/* Mode Filter */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Mode Filter</label>
            <PillToggleGroup ac={ac} options={MODE_OPTIONS} selected={modeFilter} onChange={setModeFilter} layout="wrap" />
          </div>

          {/* Band Filter */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
            <PillToggleGroup ac={ac} options={BAND_OPTIONS} selected={bandFilter} onChange={setBandFilter} layout="grid-4" />
          </div>
        </div>

      </div>
    </div>
  );
}
