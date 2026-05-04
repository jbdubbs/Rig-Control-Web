import React, { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../utils";
import type { SolarData } from "../types/solar";

interface Props {
  solarData: SolarData | null;
  onRefresh: () => void;
}

const COND_COLOR: Record<string, string> = {
  Good: "text-emerald-400",
  Fair: "text-amber-400",
  Poor: "text-red-400",
};

const VHF_LOC: Record<string, string> = {
  northern_hemi: "N. Hemi",
  north_america: "N. America",
  europe: "Europe",
  europe_6m: "Europe 6m",
  europe_4m: "Europe 4m",
};

const HF_ORDER = ["80m-40m", "30m-20m", "17m-15m", "12m-10m"];

function sfiColor(v: number): string {
  if (v >= 150) return "text-emerald-400";
  if (v >= 120) return "text-amber-400";
  return "text-red-400";
}

function aColor(v: number): string {
  if (v < 20) return "text-emerald-400";
  if (v < 30) return "text-amber-400";
  if (v < 50) return "text-red-400";
  return "text-purple-400";
}

function kColor(v: number): string {
  if (v < 4) return "text-emerald-400";
  if (v < 5) return "text-amber-400";
  return "text-red-400";
}

function geomagColor(s: string): string {
  const lc = s.toLowerCase();
  if (lc === "quiet" || lc === "very quiet") return "text-emerald-400";
  if (lc === "unsettled" || lc === "active") return "text-amber-400";
  return "text-red-400";
}

export default function SolarPanel({ solarData, onRefresh }: Props) {
  const [tab, setTab] = useState<"hf" | "vhf" | "solar">("hf");

  if (!solarData) {
    return (
      <div className="flex items-center justify-center h-24 text-[#8e9299] text-[0.625rem]">
        Loading solar data…
      </div>
    );
  }

  const sortedHfBands = HF_ORDER
    .map(name => solarData.hfBands.find(b => b.name === name))
    .filter(Boolean) as NonNullable<(typeof solarData.hfBands)[number]>[];

  return (
    <div className="flex flex-col h-full text-[0.625rem] font-mono">
      {/* Tab bar */}
      <div className="flex gap-1 px-2 pt-1.5 pb-1 border-b border-[#2a2b2e]">
        {([["hf", "HF"], ["vhf", "VHF"], ["solar", "SOLAR/GEO"]] as const).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-2 py-0.5 rounded font-bold uppercase transition-all",
              tab === t ? "bg-sky-600 text-white" : "text-[#8e9299] hover:bg-white/5"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
        {tab === "hf" && (
          <>
            {/* Quick-glance indices */}
            <div className="flex gap-x-3 text-white">
              <span>SFI=<span className={sfiColor(solarData.solarflux)}>{solarData.solarflux}</span></span>
              <span>SN=<span className="text-white">{solarData.sunspots}</span></span>
              <span>A=<span className={aColor(solarData.aindex)}>{solarData.aindex}</span></span>
              <span>K=<span className={kColor(solarData.kindex)}>{solarData.kindex}</span></span>
            </div>

            {/* HF band conditions table */}
            <div className="border border-[#2a2b2e] rounded overflow-hidden mt-0.5">
              <div className="grid grid-cols-3 bg-[#1a1b1e] text-[#8e9299] px-1.5 py-0.5 border-b border-[#2a2b2e]">
                <span>Band</span>
                <span>Day</span>
                <span>Night</span>
              </div>
              {sortedHfBands.map(b => (
                <div key={b.name} className="grid grid-cols-3 px-1.5 py-0.5 even:bg-[#1a1b1e]">
                  <span className="text-[#8e9299]">{b.name}</span>
                  <span className={cn(COND_COLOR[b.day] ?? "text-white")}>{b.day}</span>
                  <span className={cn(COND_COLOR[b.night] ?? "text-white")}>{b.night}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "solar" && (() => {
          const solarRows: Array<{ label: string; value: React.ReactNode }> = [
            { label: "SFI",  value: <span className={sfiColor(solarData.solarflux)}>{solarData.solarflux}</span> },
            { label: "SN",   value: <span className="text-white">{solarData.sunspots}</span> },
            ...(solarData.esfi !== null ? [
              { label: "eSFI", value: <span className={sfiColor(solarData.esfi!)}>{solarData.esfi}</span> },
              { label: "eSSN", value: <span className="text-white">{solarData.essn}</span> },
            ] : []),
          ];
          const geoRows: Array<{ label: string; value: React.ReactNode }> = [
            { label: "A",      value: <span className={aColor(solarData.aindex)}>{solarData.aindex}</span> },
            { label: "K",      value: <span className={kColor(solarData.kindex)}>{solarData.kindex}</span> },
            { label: "Geomag", value: <span className={geomagColor(solarData.geomagfield)}>{solarData.geomagfield}</span> },
            { label: "XRay",   value: <span className="text-white">{solarData.xray}</span> },
            { label: "Noise",  value: <span className="text-white">{solarData.signalnoise}</span> },
          ];
          const renderTable = (heading: string, rows: typeof solarRows) => (
            <div className="border border-[#2a2b2e] rounded overflow-hidden">
              <div className="bg-[#1a1b1e] text-[#8e9299] px-1.5 py-0.5 border-b border-[#2a2b2e]">
                {heading}
              </div>
              {rows.map((r, i) => (
                <div key={r.label} className={cn("grid grid-cols-2 px-1.5 py-0.5", i % 2 === 0 ? "" : "bg-[#1a1b1e]")}>
                  <span className="text-[#8e9299]">{r.label}</span>
                  {r.value}
                </div>
              ))}
            </div>
          );
          return (
            <>
              {renderTable("Solar", solarRows)}
              {renderTable("Geo / Noise", geoRows)}
            </>
          );
        })()}

        {tab === "vhf" && (
          <div className="border border-[#2a2b2e] rounded overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_auto] bg-[#1a1b1e] text-[#8e9299] px-1.5 py-0.5 border-b border-[#2a2b2e]">
              <span>Type</span>
              <span>Location</span>
              <span>Status</span>
            </div>
            {solarData.vhfConditions.map((v, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] px-1.5 py-0.5 even:bg-[#1a1b1e]">
                <span className="text-[#8e9299]">{v.name}</span>
                <span className="text-white">{VHF_LOC[v.location] ?? v.location}</span>
                <span className={v.condition === "Band Closed" ? "text-red-400" : "text-emerald-400"}>
                  {v.condition === "Band Closed" ? "Closed" : v.condition}
                </span>
              </div>
            ))}
            {solarData.vhfConditions.length === 0 && (
              <div className="px-1.5 py-1 text-[#8e9299]">No VHF data</div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-2 pt-1 pb-1.5 border-t border-[#2a2b2e] text-[#8e9299] space-y-0.5">
        <div className="flex items-center justify-between">
          <span>As of {solarData.updated}</span>
          <button
            onClick={onRefresh}
            title="Refresh solar data"
            className="p-0.5 hover:bg-white/5 rounded transition-colors hover:text-white"
          >
            <RefreshCw size={9} />
          </button>
        </div>
        <div className="text-[0.55rem] text-[#5a5b5e]">
          Solar data: <span className="text-[#6a6b6e]">hamqsl.com</span> (N0NBH)
          {solarData.esfi !== null && <> · eSFI/eSSN: <span className="text-[#6a6b6e]">prop.kc2g.com</span> (KC2G/WWROF/GIRO)</>}
        </div>
      </div>
    </div>
  );
}
