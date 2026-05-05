import React, { useState } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";

const SPOT_MODES = ['SSB', 'CW', 'FT8', 'FT4'] as const;
const ALL_BAND_LABELS = POTA_BANDS.map(b => b.label);

type Tab = 'pota' | 'sota' | 'wwff';

const TABS: { key: Tab; label: string; ac: ReturnType<typeof acFor> }[] = [
  { key: 'pota', label: 'POTA', ac: acFor('pota') },
  { key: 'sota', label: 'SOTA', ac: acFor('sota') },
  { key: 'wwff', label: 'WWFF', ac: acFor('wwff') },
];

function acFor(type: Tab) {
  if (type === 'pota') return {
    iconBg: 'bg-emerald-500/10 text-emerald-500',
    pill: 'bg-emerald-500/10 border-emerald-500/60 text-emerald-400',
    check: 'accent-emerald-500',
    focus: 'focus:border-emerald-500',
    activeTab: 'text-emerald-400 border-emerald-500',
  };
  if (type === 'wwff') return {
    iconBg: 'bg-sky-500/10 text-sky-500',
    pill: 'bg-sky-500/10 border-sky-500/60 text-sky-400',
    check: 'accent-sky-500',
    focus: 'focus:border-sky-500',
    activeTab: 'text-sky-400 border-sky-500',
  };
  return {
    iconBg: 'bg-amber-500/10 text-amber-500',
    pill: 'bg-amber-500/10 border-amber-500/60 text-amber-400',
    check: 'accent-amber-500',
    focus: 'focus:border-amber-500',
    activeTab: 'text-amber-400 border-amber-500',
  };
}

export interface ComboSpotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  potaPollRate: number; setPotaPollRate: (v: number) => void;
  potaMaxAge: number; setPotaMaxAge: (v: number) => void;
  potaModeFilter: string[]; setPotaModeFilter: (v: string[]) => void;
  potaBandFilter: string[]; setPotaBandFilter: (v: string[]) => void;
  sotaPollRate: number; setSotaPollRate: (v: number) => void;
  sotaMaxAge: number; setSotaMaxAge: (v: number) => void;
  sotaModeFilter: string[]; setSotaModeFilter: (v: string[]) => void;
  sotaBandFilter: string[]; setSotaBandFilter: (v: string[]) => void;
  wwffPollRate: number; setWwffPollRate: (v: number) => void;
  wwffMaxAge: number; setWwffMaxAge: (v: number) => void;
  wwffModeFilter: string[]; setWwffModeFilter: (v: string[]) => void;
  wwffBandFilter: string[]; setWwffBandFilter: (v: string[]) => void;
}

export default function ComboSpotSettingsModal(props: ComboSpotSettingsModalProps) {
  const { isOpen, onClose } = props;
  const [activeTab, setActiveTab] = useState<Tab>('pota');

  if (!isOpen) return null;

  const config = {
    pota: {
      pollRate: props.potaPollRate, setPollRate: props.setPotaPollRate,
      maxAge: props.potaMaxAge, setMaxAge: props.setPotaMaxAge,
      modeFilter: props.potaModeFilter, setModeFilter: props.setPotaModeFilter,
      bandFilter: props.potaBandFilter, setBandFilter: props.setPotaBandFilter,
    },
    sota: {
      pollRate: props.sotaPollRate, setPollRate: props.setSotaPollRate,
      maxAge: props.sotaMaxAge, setMaxAge: props.setSotaMaxAge,
      modeFilter: props.sotaModeFilter, setModeFilter: props.setSotaModeFilter,
      bandFilter: props.sotaBandFilter, setBandFilter: props.setSotaBandFilter,
    },
    wwff: {
      pollRate: props.wwffPollRate, setPollRate: props.setWwffPollRate,
      maxAge: props.wwffMaxAge, setMaxAge: props.setWwffMaxAge,
      modeFilter: props.wwffModeFilter, setModeFilter: props.setWwffModeFilter,
      bandFilter: props.wwffBandFilter, setBandFilter: props.setWwffBandFilter,
    },
  };

  const ac = acFor(activeTab);
  const { pollRate, setPollRate, maxAge, setMaxAge, modeFilter, setModeFilter, bandFilter, setBandFilter } = config[activeTab];

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
            <h2 className="text-sm font-bold uppercase tracking-tight">All Spots Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[#2a2b2e] bg-[#1a1b1e]">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'px-4 py-2 text-[0.5625rem] uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px',
                activeTab === t.key
                  ? t.ac.activeTab
                  : 'text-[#8e9299] border-transparent hover:text-white'
              )}
            >
              {t.label}
            </button>
          ))}
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
