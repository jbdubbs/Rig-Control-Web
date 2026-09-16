import React, { useState, useEffect } from "react";
import { MapPin, X } from "lucide-react";
import { cn } from "../utils";
import { POTA_BANDS, SPOT_MODES } from "../constants";
import { acFor, PillToggleGroup, type SpotSourceType } from "../components/SpotFilterControls";
import { parseFilterTerms } from "./DxSpotSettingsModal";

type Tab = SpotSourceType;

const TABS: { key: Tab; label: string; ac: ReturnType<typeof acFor> }[] = [
  { key: 'pota', label: 'POTA', ac: acFor('pota') },
  { key: 'sota', label: 'SOTA', ac: acFor('sota') },
  { key: 'wwff', label: 'WWFF', ac: acFor('wwff') },
  { key: 'dx', label: 'DX', ac: acFor('dx') },
];

const MODE_OPTIONS = SPOT_MODES.map(m => ({ value: m, label: m }));
const BAND_OPTIONS = POTA_BANDS.map(b => ({ value: b.label, label: b.label }));

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
  dxClusterEnabled: boolean; setDxClusterEnabled: (v: boolean) => void;
  dxHost: string; setDxHost: (v: string) => void;
  dxPort: number; setDxPort: (v: number) => void;
  dxLoginCallsign: string; setDxLoginCallsign: (v: string) => void;
  dxMaxAge: number; setDxMaxAge: (v: number) => void;
  dxCallsignFilter: string[]; setDxCallsignFilter: (v: string[]) => void;
  dxKeywordFilter: string[]; setDxKeywordFilter: (v: string[]) => void;
  dxBandFilter: string[]; setDxBandFilter: (v: string[]) => void;
  dxConnected: boolean;
  dxError: string | null;
}

export default function ComboSpotSettingsModal(props: ComboSpotSettingsModalProps) {
  const { isOpen, onClose } = props;
  const [activeTab, setActiveTab] = useState<Tab>('pota');
  const [callsignRaw, setCallsignRaw] = useState(props.dxCallsignFilter.join(", "));
  const [keywordRaw, setKeywordRaw] = useState(props.dxKeywordFilter.join(", "));

  useEffect(() => {
    if (isOpen && activeTab === 'dx') {
      setCallsignRaw(props.dxCallsignFilter.join(", "));
      setKeywordRaw(props.dxKeywordFilter.join(", "));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const ac = acFor(activeTab);
  const inputClass = cn("w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm text-white focus:outline-none", ac.focus);

  const nonDxConfig = activeTab === 'pota' ? {
    pollRate: props.potaPollRate, setPollRate: props.setPotaPollRate,
    maxAge: props.potaMaxAge, setMaxAge: props.setPotaMaxAge,
    modeFilter: props.potaModeFilter, setModeFilter: props.setPotaModeFilter,
    bandFilter: props.potaBandFilter, setBandFilter: props.setPotaBandFilter,
  } : activeTab === 'sota' ? {
    pollRate: props.sotaPollRate, setPollRate: props.setSotaPollRate,
    maxAge: props.sotaMaxAge, setMaxAge: props.setSotaMaxAge,
    modeFilter: props.sotaModeFilter, setModeFilter: props.setSotaModeFilter,
    bandFilter: props.sotaBandFilter, setBandFilter: props.setSotaBandFilter,
  } : activeTab === 'wwff' ? {
    pollRate: props.wwffPollRate, setPollRate: props.setWwffPollRate,
    maxAge: props.wwffMaxAge, setMaxAge: props.setWwffMaxAge,
    modeFilter: props.wwffModeFilter, setModeFilter: props.setWwffModeFilter,
    bandFilter: props.wwffBandFilter, setBandFilter: props.setWwffBandFilter,
  } : null;

  const activeBandFilter = activeTab === 'dx' ? props.dxBandFilter : (nonDxConfig?.bandFilter ?? []);
  const setActiveBandFilter = activeTab === 'dx' ? props.setDxBandFilter : (nonDxConfig?.setBandFilter ?? (() => {}));

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
          {activeTab === 'dx' && (
            <>
              <label className="flex items-center justify-between cursor-pointer select-none">
                <span className="text-[0.625rem] uppercase tracking-widest font-bold text-[#8e9299]">
                  Enable DX Cluster
                  <span className="block normal-case tracking-normal font-normal text-[0.625rem] text-[#5a5b5e] mt-0.5">
                    {props.dxClusterEnabled ? (props.dxConnected ? 'Connected' : (props.dxError ?? 'Connecting…')) : 'Disabled'}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={props.dxClusterEnabled}
                  onChange={e => props.setDxClusterEnabled(e.target.checked)}
                  className={cn("w-4 h-4 cursor-pointer flex-shrink-0", ac.check)}
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[0.625rem] uppercase text-[#8e9299]">Cluster Host</label>
                  <input type="text" value={props.dxHost} onChange={e => props.setDxHost(e.target.value)} className={inputClass} placeholder="w3lpl.net" />
                </div>
                <div className="space-y-1">
                  <label className="text-[0.625rem] uppercase text-[#8e9299]">Port</label>
                  <input type="number" value={props.dxPort} onChange={e => props.setDxPort(Number(e.target.value))} className={inputClass} placeholder="7373" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] uppercase text-[#8e9299]">Login Callsign</label>
                <input type="text" value={props.dxLoginCallsign} onChange={e => props.setDxLoginCallsign(e.target.value.toUpperCase())} className={inputClass} placeholder="Your callsign" />
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
                <select
                  value={props.dxMaxAge}
                  onChange={e => props.setDxMaxAge(Number(e.target.value))}
                  className={cn(inputClass, "appearance-none cursor-pointer")}
                >
                  {[5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] uppercase text-[#8e9299]">Callsign / Prefix Filter</label>
                <input
                  type="text"
                  value={callsignRaw}
                  onChange={e => setCallsignRaw(e.target.value)}
                  onBlur={() => props.setDxCallsignFilter(parseFilterTerms(callsignRaw))}
                  className={inputClass}
                  placeholder="e.g. VP8, FT5, JA1ABC (comma-separated, empty = show all)"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[0.625rem] uppercase text-[#8e9299]">Keyword Filter</label>
                <input
                  type="text"
                  value={keywordRaw}
                  onChange={e => setKeywordRaw(e.target.value)}
                  onBlur={() => props.setDxKeywordFilter(parseFilterTerms(keywordRaw))}
                  className={inputClass}
                  placeholder="e.g. FT8, CONTEST (matches the spot comment)"
                />
              </div>
            </>
          )}

          {nonDxConfig && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Frequency</label>
                  <select
                    value={nonDxConfig.pollRate}
                    onChange={e => nonDxConfig.setPollRate(Number(e.target.value))}
                    className={cn("w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none", ac.focus)}
                  >
                    {[1, 2, 3, 4, 5].map(m => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
                  <select
                    value={nonDxConfig.maxAge}
                    onChange={e => nonDxConfig.setMaxAge(Number(e.target.value))}
                    className={cn("w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none", ac.focus)}
                  >
                    {[1, 3, 5, 10, 15].map(m => <option key={m} value={m}>{m} min</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[0.625rem] uppercase text-[#8e9299]">Mode Filter</label>
                <PillToggleGroup ac={ac} options={MODE_OPTIONS} selected={nonDxConfig.modeFilter} onChange={nonDxConfig.setModeFilter} layout="wrap" />
              </div>
            </>
          )}

          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
            <PillToggleGroup ac={ac} options={BAND_OPTIONS} selected={activeBandFilter} onChange={setActiveBandFilter} layout="grid-4" />
          </div>
        </div>

      </div>
    </div>
  );
}
