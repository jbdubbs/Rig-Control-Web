import React, { useState, useEffect } from "react";
import { Radio, X } from "lucide-react";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";
import { acFor, PillToggleGroup } from "../components/SpotFilterControls";

export function parseFilterTerms(raw: string): string[] {
  return raw.split(",").map(t => t.trim()).filter(Boolean);
}

export interface DxSpotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dxClusterEnabled: boolean;
  setDxClusterEnabled: (v: boolean) => void;
  dxHost: string;
  setDxHost: (v: string) => void;
  dxPort: number;
  setDxPort: (v: number) => void;
  dxLoginCallsign: string;
  setDxLoginCallsign: (v: string) => void;
  dxMaxAge: number;
  setDxMaxAge: (v: number) => void;
  dxCallsignFilter: string[];
  setDxCallsignFilter: (v: string[]) => void;
  dxKeywordFilter: string[];
  setDxKeywordFilter: (v: string[]) => void;
  dxBandFilter: string[];
  setDxBandFilter: (v: string[]) => void;
  dxConnected: boolean;
  dxError: string | null;
}

const BAND_OPTIONS = POTA_BANDS.map(b => ({ value: b.label, label: b.label }));
const ac = acFor('dx');

export default function DxSpotSettingsModal({
  isOpen, onClose,
  dxClusterEnabled, setDxClusterEnabled,
  dxHost, setDxHost,
  dxPort, setDxPort,
  dxLoginCallsign, setDxLoginCallsign,
  dxMaxAge, setDxMaxAge,
  dxCallsignFilter, setDxCallsignFilter,
  dxKeywordFilter, setDxKeywordFilter,
  dxBandFilter, setDxBandFilter,
  dxConnected, dxError,
}: DxSpotSettingsModalProps) {
  const [callsignRaw, setCallsignRaw] = useState(dxCallsignFilter.join(", "));
  const [keywordRaw, setKeywordRaw] = useState(dxKeywordFilter.join(", "));

  useEffect(() => {
    if (isOpen) {
      setCallsignRaw(dxCallsignFilter.join(", "));
      setKeywordRaw(dxKeywordFilter.join(", "));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const inputClass = cn("w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm text-white focus:outline-none", ac.focus);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">

        <div className="p-4 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-lg", ac.iconBg)}>
              <Radio size={16} />
            </div>
            <h2 className="text-sm font-bold uppercase tracking-tight">DX Cluster Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <label className="flex items-center justify-between cursor-pointer select-none">
            <span className="text-[0.625rem] uppercase tracking-widest font-bold text-[#8e9299]">
              Enable DX Cluster
              <span className="block normal-case tracking-normal font-normal text-[0.625rem] text-[#5a5b5e] mt-0.5">
                {dxClusterEnabled ? (dxConnected ? 'Connected' : (dxError ?? 'Connecting…')) : 'Disabled'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={dxClusterEnabled}
              onChange={e => setDxClusterEnabled(e.target.checked)}
              className={cn("w-4 h-4 cursor-pointer flex-shrink-0", ac.check)}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Cluster Host</label>
              <input
                type="text"
                value={dxHost}
                onChange={e => setDxHost(e.target.value)}
                className={inputClass}
                placeholder="w3lpl.net"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Port</label>
              <input
                type="number"
                value={dxPort}
                onChange={e => setDxPort(Number(e.target.value))}
                className={inputClass}
                placeholder="7373"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Login Callsign</label>
            <input
              type="text"
              value={dxLoginCallsign}
              onChange={e => setDxLoginCallsign(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="Your callsign"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
            <select
              value={dxMaxAge}
              onChange={e => setDxMaxAge(Number(e.target.value))}
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
              onBlur={() => setDxCallsignFilter(parseFilterTerms(callsignRaw))}
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
              onBlur={() => setDxKeywordFilter(parseFilterTerms(keywordRaw))}
              className={inputClass}
              placeholder="e.g. FT8, CONTEST (matches the spot comment)"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
            <PillToggleGroup ac={ac} options={BAND_OPTIONS} selected={dxBandFilter} onChange={setDxBandFilter} layout="grid-4" />
          </div>
        </div>

      </div>
    </div>
  );
}
