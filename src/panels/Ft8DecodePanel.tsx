import React from "react";
import { cn } from "../utils";
import type { Ft8Decode, Ft8Depth } from "../ft8Decoder";
import { getCallingStationCountry } from "../ft8Callsign";

export interface Ft8DecodePanelProps {
  ft8Decodes: Ft8Decode[];
  ft8ScrollContainerRef: React.RefObject<HTMLDivElement>;
  maxHeightClass?: string;
}

const COLUMNS = ['SNR', 'DT', 'Freq', 'Message', 'Country'] as const;

function Ft8DecodePanel({ ft8Decodes, ft8ScrollContainerRef, maxHeightClass = 'max-h-64' }: Ft8DecodePanelProps) {
  return (
    <div ref={ft8ScrollContainerRef} className={cn(maxHeightClass, "overflow-y-auto overflow-x-hidden custom-scrollbar")}>
      <table className="w-full text-[0.625rem] font-mono border-separate border-spacing-0 table-auto">
        <thead>
          <tr className="bg-[#0a0a0a]">
            {COLUMNS.map((label) => (
              <th
                key={label}
                className="sticky top-0 z-10 px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] bg-[#0a0a0a] border-b border-[#2a2b2e]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ft8Decodes.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length} className="px-2 py-4 text-center text-[#4a4b4e] italic">
                Waiting for FT8 decodes...
              </td>
            </tr>
          ) : (
            ft8Decodes.map((d, index) => {
              const country = getCallingStationCountry(d.message);
              const isNewTimeslot = index === 0 || ft8Decodes[index - 1].utcTime !== d.utcTime;
              return (
                <React.Fragment key={d.id}>
                  {isNewTimeslot && (
                    <tr>
                      <td colSpan={COLUMNS.length} className="px-2 py-1 text-center text-[0.6875rem] uppercase tracking-widest text-[#e0e0e0] border-t-2 border-[#2a2b2e]">
                        — {d.utcTime} UTC —
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-[#2a2b2e]/40 hover:bg-white/5">
                    <td className={cn("px-2 py-1 whitespace-nowrap", d.snr >= 0 ? "text-emerald-400" : "text-amber-400")}>
                      {d.snr > 0 ? `+${d.snr.toFixed(0)}` : d.snr.toFixed(0)}
                    </td>
                    <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{d.dt.toFixed(1)}</td>
                    <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{d.freqHz.toFixed(0)}</td>
                    <td className="px-2 py-1 text-[#e0e0e0]">{d.message}</td>
                    <td className={cn("px-2 py-1 whitespace-nowrap", country ? "text-white font-bold text-[0.6875rem]" : "text-[#8e9299]")}>
                      {country ? country.country : '—'}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ft8Decodes updates on decoded messages, independent of rig-status polling — memoizing
// avoids re-rendering this panel on every 2s tick.
export default React.memo(Ft8DecodePanel);

export function Ft8DepthSelect({ depth, onChange }: { depth: Ft8Depth; onChange: (d: Ft8Depth) => void }) {
  return (
    <select
      value={depth}
      onChange={(e) => onChange(e.target.value as Ft8Depth)}
      title="Decode depth"
      className="bg-[#0a0a0a] border border-[#2a2b2e] rounded text-[0.5625rem] uppercase text-[#8e9299] px-1.5 py-0.5 hover:text-white focus:outline-none"
    >
      <option value="fast">Fast</option>
      <option value="balanced">Balanced</option>
      <option value="deep">Deep</option>
    </select>
  );
}
