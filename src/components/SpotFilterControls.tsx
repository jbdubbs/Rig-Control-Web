import React from "react";
import { cn } from "../utils";

export type SpotSourceType = 'pota' | 'sota' | 'wwff' | 'dx';

export interface SpotAccent {
  iconBg: string;
  pill: string;
  check: string;
  focus: string;
  activeTab: string;
}

// Shared accent-color map for the POTA/SOTA/WWFF/DX spot settings UI — used by
// SpotSettingsModal, DxSpotSettingsModal, and ComboSpotSettingsModal so the same control
// (mode/band filter pills, focus rings, tab underline) stays visually consistent across all
// three instead of three independently-maintained copies.
export function acFor(type: SpotSourceType): SpotAccent {
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
  if (type === 'dx') return {
    iconBg: 'bg-rose-500/10 text-rose-500',
    pill: 'bg-rose-500/10 border-rose-500/60 text-rose-400',
    check: 'accent-rose-500',
    focus: 'focus:border-rose-500',
    activeTab: 'text-rose-400 border-rose-500',
  };
  return {
    iconBg: 'bg-amber-500/10 text-amber-500',
    pill: 'bg-amber-500/10 border-amber-500/60 text-amber-400',
    check: 'accent-amber-500',
    focus: 'focus:border-amber-500',
    activeTab: 'text-amber-400 border-amber-500',
  };
}

interface PillToggleGroupProps {
  ac: Pick<SpotAccent, 'pill' | 'check'>;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** 'wrap' for the mode filter's flex row, 'grid-4' for the band filter's 4-column grid. */
  layout: 'wrap' | 'grid-4';
}

// An "All" pill (with an indeterminate visual state when some-but-not-all options are
// selected) plus one toggle pill per option — the mode/band filter control shared verbatim
// (modulo layout) across SpotSettingsModal, DxSpotSettingsModal, and
// ComboSpotSettingsModal's per-tab filters.
export function PillToggleGroup({ ac, options, selected, onChange, layout }: PillToggleGroupProps) {
  const allValues = options.map(o => o.value);
  const allChecked = allValues.length > 0 && allValues.every(v => selected.includes(v));
  const noneChecked = selected.length === 0;
  const indeterminate = !allChecked && !noneChecked;

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  const toggleAll = () => onChange(noneChecked ? allValues : []);

  const pillClass = (active: boolean) => cn(
    "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
    active ? ac.pill : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-[#4a4b4e] hover:text-white"
  );

  const allPillClass = cn(
    "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
    allChecked ? ac.pill : indeterminate ? cn(ac.pill, "opacity-60") : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-[#4a4b4e] hover:text-white",
    layout === 'grid-4' && "col-span-1"
  );

  return (
    <div className={layout === 'grid-4' ? "grid grid-cols-4 gap-1.5" : "flex gap-2 flex-wrap"}>
      <label className={allPillClass}>
        <input
          type="checkbox"
          checked={allChecked}
          ref={el => { if (el) el.indeterminate = indeterminate; }}
          onChange={toggleAll}
          className={cn("w-3 h-3 cursor-pointer flex-shrink-0", ac.check)}
        />
        <span className="text-[0.5625rem] font-bold uppercase">All</span>
      </label>
      {options.map(o => (
        <label key={o.value} className={pillClass(selected.includes(o.value))}>
          <input
            type="checkbox"
            checked={selected.includes(o.value)}
            onChange={() => toggle(o.value)}
            className={cn("w-3 h-3 cursor-pointer flex-shrink-0", ac.check)}
          />
          <span className="text-[0.5625rem] font-bold uppercase">{o.label}</span>
        </label>
      ))}
    </div>
  );
}
