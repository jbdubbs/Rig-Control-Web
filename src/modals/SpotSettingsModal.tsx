import React from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";

const SPOT_MODES = ['SSB', 'CW', 'FT8', 'FT4'] as const;
const ALL_BAND_LABELS = POTA_BANDS.map(b => b.label);

export interface SpotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'pota' | 'sota';
  pollRate: number;
  setPollRate: (v: number) => void;
  maxAge: number;
  setMaxAge: (v: number) => void;
  modeFilter: string[];
  setModeFilter: (v: string[]) => void;
  bandFilter: string[];
  setBandFilter: (v: string[]) => void;
}

export default function SpotSettingsModal({
  isOpen, onClose, type,
  pollRate, setPollRate,
  maxAge, setMaxAge,
  modeFilter, setModeFilter,
  bandFilter, setBandFilter,
}: SpotSettingsModalProps) {
  if (!isOpen) return null;

  const isPota = type === 'pota';
  const ac = isPota
    ? { iconBg: 'bg-emerald-500/10 text-emerald-500', pill: 'bg-emerald-500/10 border-emerald-500/60 text-emerald-400', check: 'accent-emerald-500', focus: 'focus:border-emerald-500' }
    : { iconBg: 'bg-amber-500/10 text-amber-500', pill: 'bg-amber-500/10 border-amber-500/60 text-amber-400', check: 'accent-amber-500', focus: 'focus:border-amber-500' };

  const title = isPota ? 'POTA Spots Settings' : 'SOTA Spots Settings';

  const allModesChecked = SPOT_MODES.every(m => modeFilter.includes(m));
  const allBandsChecked = ALL_BAND_LABELS.every(b => bandFilter.includes(b));

  const toggleMode = (m: string) => {
    const next = modeFilter.includes(m) ? modeFilter.filter(x => x !== m) : [...modeFilter, m];
    setModeFilter(next.length === 0 ? [...SPOT_MODES] : next);
  };

  const toggleBand = (label: string) => {
    const next = bandFilter.includes(label) ? bandFilter.filter(b => b !== label) : [...bandFilter, label];
    setBandFilter(next.length === 0 ? ALL_BAND_LABELS : next);
  };

  const pillClass = (active: boolean) => cn(
    "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
    active ? ac.pill : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-[#4a4b4e] hover:text-white"
  );

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
            <div className="flex gap-2 flex-wrap">
              <label className={pillClass(allModesChecked)}>
                <input
                  type="checkbox"
                  checked={allModesChecked}
                  onChange={() => setModeFilter([...SPOT_MODES])}
                  className={cn("w-3 h-3 cursor-pointer flex-shrink-0", ac.check)}
                />
                <span className="text-[0.5625rem] font-bold uppercase">All</span>
              </label>
              {SPOT_MODES.map(m => (
                <label key={m} className={pillClass(modeFilter.includes(m))}>
                  <input
                    type="checkbox"
                    checked={modeFilter.includes(m)}
                    onChange={() => toggleMode(m)}
                    className={cn("w-3 h-3 cursor-pointer flex-shrink-0", ac.check)}
                  />
                  <span className="text-[0.5625rem] font-bold uppercase">{m}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Band Filter */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
            <div className="grid grid-cols-4 gap-1.5">
              <label className={cn(pillClass(allBandsChecked), "col-span-1")}>
                <input
                  type="checkbox"
                  checked={allBandsChecked}
                  onChange={() => setBandFilter(ALL_BAND_LABELS)}
                  className={cn("w-3 h-3 cursor-pointer flex-shrink-0", ac.check)}
                />
                <span className="text-[0.5625rem] font-bold uppercase">All</span>
              </label>
              {POTA_BANDS.map(({ label }) => (
                <label key={label} className={pillClass(bandFilter.includes(label))}>
                  <input
                    type="checkbox"
                    checked={bandFilter.includes(label)}
                    onChange={() => toggleBand(label)}
                    className={cn("w-3 h-3 cursor-pointer flex-shrink-0", ac.check)}
                  />
                  <span className="text-[0.5625rem] font-bold uppercase">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
