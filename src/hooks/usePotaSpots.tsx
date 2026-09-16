import React, { useState, useEffect, useMemo } from "react";
import { Socket } from "socket.io-client";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";
import { usePersistedCollapsed } from "./usePersistedCollapsed";
import type { PotaSpot, SotaSpot, WwffSpot, RigStatus } from "../types";

interface UsePotaSpotsOptions {
  socket: Socket | null;
  connected: boolean;
  status: RigStatus;
  inputVfoA: string;
  inputVfoB: string;
  availableModes: string[];
  skipPollsCount: React.MutableRefObject<number>;
  setStatus: React.Dispatch<React.SetStateAction<RigStatus>>;
  potaEnabled: boolean;
  sotaEnabled: boolean;
  wwffEnabled: boolean;
  callsign?: string;
}

const ALL_SPOT_MODES = ['SSB', 'CW', 'FT8', 'FT4'];

// Shared by handleTuneToSpot/handleTuneToSotaSpot/handleTuneToWwffSpot — the
// three differ only in how each spot type's frequency field is converted to
// MHz beforehand; the mode-mapping rule itself is identical across POTA,
// SOTA, and WWFF.
export function inferTuneMode(mode: string, freqMhz: number, availableModes: string[]): string {
  if (mode === 'SSB') return freqMhz >= 10 ? 'USB' : 'LSB';
  if (mode === 'CW') return freqMhz >= 10 ? 'CW' : 'CWR';
  if (mode === 'FT8' || mode === 'FT4') return availableModes.includes('PKTUSB') ? 'PKTUSB' : 'USB';
  return mode;
}

// ── Shared spot pipeline ──────────────────────────────────────────────────────
// POTA, SOTA, and WWFF each encode the same underlying facts (a dedup identity, a spot
// timestamp, a numeric id, a frequency, a mode) in different field names and units —
// notably POTA/SOTA's timestamp is an ISO-ish string needing a "+ 'Z'" parse, while WWFF's
// is a raw Unix epoch in seconds. These accessors normalize each spot type to a common
// shape once, so the dedup/filter/sort/matched-frequency pipeline below (and the tests for
// it) don't need to know about any of these differences.
export interface SpotAccessors<T> {
  dedupKey: (spot: T) => string;
  timeMs: (spot: T) => number;
  idOf: (spot: T) => number;
  freqKhz: (spot: T) => number;
  modeOf: (spot: T) => string;
}

export const potaAccessors: SpotAccessors<PotaSpot> = {
  dedupKey: (s) => s.activator,
  timeMs: (s) => new Date(s.spotTime + 'Z').getTime(),
  idOf: (s) => s.spotId,
  freqKhz: (s) => s.frequency,
  modeOf: (s) => s.mode,
};

export const sotaAccessors: SpotAccessors<SotaSpot> = {
  dedupKey: (s) => s.activatorCallsign,
  timeMs: (s) => new Date(s.timeStamp + 'Z').getTime(),
  idOf: (s) => s.id,
  freqKhz: (s) => parseFloat(s.frequency) * 1000,
  modeOf: (s) => s.mode,
};

export const wwffAccessors: SpotAccessors<WwffSpot> = {
  dedupKey: (s) => s.activator,
  timeMs: (s) => s.spot_time * 1000,
  idOf: (s) => s.id,
  freqKhz: (s) => s.frequency_khz,
  modeOf: (s) => s.mode,
};

// Pure — exported for unit testing. Dedupes by keeping only the most recent spot per
// dedupKey, then drops anything older than maxAgeMinutes or outside modeFilter/bandFilter.
export function dedupeAndFilterSpots<T>(
  spots: T[],
  accessors: SpotAccessors<T>,
  maxAgeMinutes: number,
  modeFilter: string[],
  bandFilter: string[],
): T[] {
  const { dedupKey, timeMs, freqKhz, modeOf } = accessors;
  const latestByKey = new Map<string, T>();
  for (const spot of spots) {
    const key = dedupKey(spot);
    const existing = latestByKey.get(key);
    if (!existing || timeMs(spot) > timeMs(existing)) {
      latestByKey.set(key, spot);
    }
  }
  const deduped = [...latestByKey.values()];
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
  const allModes = ALL_SPOT_MODES.every(m => modeFilter.includes(m));
  return deduped.filter(s => {
    if (timeMs(s) < cutoff) return false;
    if (!allModes && modeFilter.length > 0 && !modeFilter.includes(modeOf(s))) return false;
    if (bandFilter.length > 0) {
      const khz = freqKhz(s);
      const inBand = bandFilter.some(label => {
        const band = POTA_BANDS.find(b => b.label === label);
        return band && khz >= band.min && khz < band.max;
      });
      if (!inBand) return false;
    }
    return true;
  });
}

// Pure — exported for unit testing.
export function sortSpots<T>(spots: T[], sortCol: string | null, sortDir: 'asc' | 'desc' | 'api'): T[] {
  if (!sortCol || sortDir === 'api') return spots;
  return [...spots].sort((a, b) => {
    const aVal = (a as any)[sortCol];
    const bVal = (b as any)[sortCol];
    const cmp = typeof aVal === 'number' && typeof bVal === 'number'
      ? aVal - bVal
      : String(aVal).localeCompare(String(bVal));
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

// Pure — exported for unit testing. A spot is "matched" when its frequency is within
// 100 Hz of the active VFO — close enough that click-to-tune already landed on it.
export function computeMatchedSpotIds<T>(
  spots: T[],
  freqKhz: (spot: T) => number,
  idOf: (spot: T) => number,
  activeVfoMhz: string,
): Set<number> {
  const activeHz = Math.round(parseFloat(activeVfoMhz) * 1_000_000);
  const ids = new Set<number>();
  for (const spot of spots) {
    const spotHz = Math.round(freqKhz(spot) * 1000);
    if (Math.abs(spotHz - activeHz) <= 100) ids.add(idOf(spot));
  }
  return ids;
}

// Pure — exported for unit testing. Matched spots are pinned to the top (in their sorted
// order) with the full sorted list following, so a spot on-frequency is never hidden below
// the fold, without ever removing it from the full listing.
export function pinMatchedSpots<T>(
  spots: T[],
  matched: Set<number>,
  idOf: (spot: T) => number,
): { spot: T; isPinned: boolean }[] {
  if (matched.size === 0) return spots.map(s => ({ spot: s, isPinned: false }));
  const pinned = spots.filter(s => matched.has(idOf(s))).map(s => ({ spot: s, isPinned: true }));
  const all = spots.map(s => ({ spot: s, isPinned: false }));
  return [...pinned, ...all];
}

interface UseSpotSourceOptions<T> {
  enabled: boolean;
  fetchUrl: string;
  logPrefix: string;
  verboseRef: React.MutableRefObject<boolean>;
  initialSortCol: string;
  accessors: SpotAccessors<T>;
  status: RigStatus;
  inputVfoA: string;
  inputVfoB: string;
}

// Fetch-interval + dedup/filter/sort/matched-frequency pipeline shared by POTA, SOTA, and
// WWFF — parameterized per spot type via `accessors` (see SpotAccessors above) and
// `fetchUrl`/`logPrefix`. Each spot type still gets its own independent settings state
// (pollRate/maxAge/modeFilter/bandFilter/sortCol/sortDir) since those are exposed to
// callers (App.tsx, settings persistence) as separate, independently-configurable fields.
function useSpotSource<T>({
  enabled,
  fetchUrl,
  logPrefix,
  verboseRef,
  initialSortCol,
  accessors,
  status,
  inputVfoA,
  inputVfoB,
}: UseSpotSourceOptions<T>) {
  const [pollRate, setPollRate] = useState(5);
  const [maxAge, setMaxAge] = useState(15);
  const [modeFilter, setModeFilter] = useState<string[]>(ALL_SPOT_MODES);
  const [bandFilter, setBandFilter] = useState<string[]>(() => POTA_BANDS.map(b => b.label));
  const [spots, setSpots] = useState<T[]>([]);
  const [sortCol, setSortCol] = useState<string | null>(initialSortCol);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | 'api'>('desc');

  useEffect(() => {
    if (!enabled) {
      setSpots([]);
      return;
    }
    const fetchSpots = async () => {
      const vlog = verboseRef.current;
      if (vlog) console.log(`[spots:${logPrefix}] Fetching ${fetchUrl}`);
      try {
        const res = await fetch(fetchUrl);
        if (vlog) console.log(`[spots:${logPrefix}] Response: ${res.status} ${res.statusText}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            if (vlog) console.log(`[spots:${logPrefix}] Received ${data.length} spots`);
            setSpots(data);
          } else {
            if (vlog) console.warn(`[spots:${logPrefix}] Response was not an array:`, typeof data);
          }
        } else {
          if (vlog) console.warn(`[spots:${logPrefix}] HTTP error: ${res.status} ${res.statusText}`);
        }
      } catch (err) {
        if (vlog) console.error(`[spots:${logPrefix}] Fetch failed:`, err);
      }
    };
    fetchSpots();
    const interval = setInterval(fetchSpots, pollRate * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pollRate, fetchUrl, logPrefix]);

  const filteredSpots = useMemo(() => {
    const result = dedupeAndFilterSpots(spots, accessors, maxAge, modeFilter, bandFilter);
    if (verboseRef.current) {
      const cutoff = Date.now() - maxAge * 60 * 1000;
      if (spots.length > 0) {
        const sample = spots[0];
        console.log(`[spots:${logPrefix}] Filter pipeline — raw: ${spots.length}, maxAge: ${maxAge}m, cutoff: ${new Date(cutoff).toISOString()}, sample time: ${new Date(accessors.timeMs(sample)).toISOString()}, freqKhz: ${accessors.freqKhz(sample)}, mode: "${accessors.modeOf(sample)}"`);
        console.log(`[spots:${logPrefix}] Filters — modeFilter: [${modeFilter}], bandFilter: [${bandFilter}]`);
      }
      console.log(`[spots:${logPrefix}] Result: ${result.length} spots (dropped: ${spots.length - result.length})`);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, maxAge, modeFilter, bandFilter]);

  const sortedSpots = useMemo(
    () => sortSpots(filteredSpots, sortCol, sortDir),
    [filteredSpots, sortCol, sortDir]
  );

  const matchedSpotIds = useMemo(() => {
    const activeVfoMhz = status.vfo === 'VFOA' ? inputVfoA : inputVfoB;
    return computeMatchedSpotIds(filteredSpots, accessors.freqKhz, accessors.idOf, activeVfoMhz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedSpots = useMemo(
    () => pinMatchedSpots(sortedSpots, matchedSpotIds, accessors.idOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedSpots, matchedSpotIds]
  );

  const handleSort = (col: string) => {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortCol(null);
      setSortDir('api');
    }
  };

  return {
    pollRate, setPollRate,
    maxAge, setMaxAge,
    modeFilter, setModeFilter,
    bandFilter, setBandFilter,
    sortCol, sortDir, handleSort,
    filteredSpots, matchedSpotIds, displayedSpots,
  };
}

export function usePotaSpots({
  socket,
  connected,
  status,
  inputVfoA,
  inputVfoB,
  availableModes,
  skipPollsCount,
  setStatus,
  potaEnabled,
  sotaEnabled,
  wwffEnabled,
  callsign = "",
}: UsePotaSpotsOptions) {
  const ns = (key: string) =>
    callsign ? `${callsign.toUpperCase()}:${key}` : key;

  const [isCompactPotaSpotsCollapsed, setIsCompactPotaSpotsCollapsed] = usePersistedCollapsed(ns, "compact-pota-spots-collapsed", "pota-spots-collapsed", false, callsign);
  const [isPhonePotaSpotsCollapsed, setIsPhonePotaSpotsCollapsed] = usePersistedCollapsed(ns, "phone-pota-spots-collapsed", "pota-spots-collapsed", false, callsign);
  const [isCompactSotaSpotsCollapsed, setIsCompactSotaSpotsCollapsed] = usePersistedCollapsed(ns, "compact-sota-spots-collapsed", "sota-spots-collapsed", false, callsign);
  const [isPhoneSotaSpotsCollapsed, setIsPhoneSotaSpotsCollapsed] = usePersistedCollapsed(ns, "phone-sota-spots-collapsed", "sota-spots-collapsed", false, callsign);
  const [isCompactWwffSpotsCollapsed, setIsCompactWwffSpotsCollapsed] = usePersistedCollapsed(ns, "compact-wwff-spots-collapsed", "wwff-spots-collapsed", false, callsign);
  const [isPhoneWwffSpotsCollapsed, setIsPhoneWwffSpotsCollapsed] = usePersistedCollapsed(ns, "phone-wwff-spots-collapsed", "wwff-spots-collapsed", false, callsign);

  // ── Debug flag ────────────────────────────────────────────────────────────
  const spotsVerboseRef = React.useRef(false);
  useEffect(() => {
    if (!socket) return;
    const onDebugFlags = ({ spots }: { spots: boolean }) => { spotsVerboseRef.current = spots; };
    socket.on("debug-flags", onDebugFlags);
    return () => { socket.off("debug-flags", onDebugFlags); };
  }, [socket]);

  const pota = useSpotSource<PotaSpot>({
    enabled: potaEnabled,
    fetchUrl: "https://api.pota.app/spot/",
    logPrefix: "pota",
    verboseRef: spotsVerboseRef,
    initialSortCol: "spotTime",
    accessors: potaAccessors,
    status, inputVfoA, inputVfoB,
  });
  const sota = useSpotSource<SotaSpot>({
    enabled: sotaEnabled,
    // SOTA spotting polls api2.sota.org.uk/api/spots/-1/all (public, no auth).
    fetchUrl: "https://api2.sota.org.uk/api/spots/-1/all",
    logPrefix: "sota",
    verboseRef: spotsVerboseRef,
    initialSortCol: "timeStamp",
    accessors: sotaAccessors,
    status, inputVfoA, inputVfoB,
  });
  const wwff = useSpotSource<WwffSpot>({
    enabled: wwffEnabled,
    fetchUrl: "https://spots.wwff.co/static/spots.json",
    logPrefix: "wwff",
    verboseRef: spotsVerboseRef,
    initialSortCol: "spot_time",
    accessors: wwffAccessors,
    status, inputVfoA, inputVfoB,
  });

  // ── Settings loading from server ─────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const parseModeFilter = (raw: unknown): string[] => {
      if (Array.isArray(raw)) return raw;
      if (raw === 'ALL' || raw === undefined) return ALL_SPOT_MODES;
      return [raw as string];
    };
    const handler = (data: any) => {
      if (data.potaSettings) {
        if (data.potaSettings.pollRate !== undefined) pota.setPollRate(data.potaSettings.pollRate);
        if (data.potaSettings.maxAge !== undefined) pota.setMaxAge(data.potaSettings.maxAge);
        if (data.potaSettings.modeFilter !== undefined) pota.setModeFilter(parseModeFilter(data.potaSettings.modeFilter));
        if (Array.isArray(data.potaSettings.bandFilter)) pota.setBandFilter(data.potaSettings.bandFilter);
      }
      if (data.sotaSettings) {
        if (data.sotaSettings.pollRate !== undefined) sota.setPollRate(data.sotaSettings.pollRate);
        if (data.sotaSettings.maxAge !== undefined) sota.setMaxAge(data.sotaSettings.maxAge);
        if (data.sotaSettings.modeFilter !== undefined) sota.setModeFilter(parseModeFilter(data.sotaSettings.modeFilter));
        if (Array.isArray(data.sotaSettings.bandFilter)) sota.setBandFilter(data.sotaSettings.bandFilter);
      }
      if (data.wwffSettings) {
        if (data.wwffSettings.pollRate !== undefined) wwff.setPollRate(data.wwffSettings.pollRate);
        if (data.wwffSettings.maxAge !== undefined) wwff.setMaxAge(data.wwffSettings.maxAge);
        if (data.wwffSettings.modeFilter !== undefined) wwff.setModeFilter(parseModeFilter(data.wwffSettings.modeFilter));
        if (Array.isArray(data.wwffSettings.bandFilter)) wwff.setBandFilter(data.wwffSettings.bandFilter);
      }
    };
    socket.on("settings-data", handler);
    return () => { socket.off("settings-data", handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // ── Log enabled state ─────────────────────────────────────────────────────
  useEffect(() => {
    if (spotsVerboseRef.current) {
      console.log(`[spots] Enabled state — pota: ${potaEnabled}, sota: ${sotaEnabled}, wwff: ${wwffEnabled}`);
    }
  }, [potaEnabled, sotaEnabled, wwffEnabled]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const formatSpotAge = (spotTimeMs: number): string => {
    const diff = Math.floor((Date.now() - spotTimeMs) / 60000);
    return diff <= 0 ? '<1m ago' : `${diff}m ago`;
  };

  const handleTuneToSpot = (spot: PotaSpot) => {
    if (!connected) return;
    const freqHz = String(Math.round(spot.frequency * 1000));
    const mode = inferTuneMode(spot.mode, spot.frequency / 1000, availableModes);
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handleTuneToSotaSpot = (spot: SotaSpot) => {
    if (!connected) return;
    const freqMhz = parseFloat(spot.frequency);
    const freqHz = String(Math.round(freqMhz * 1_000_000));
    const mode = inferTuneMode(spot.mode, freqMhz, availableModes);
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handleTuneToWwffSpot = (spot: WwffSpot) => {
    if (!connected) return;
    const freqMhz = spot.frequency_khz / 1000;
    const freqHz = String(Math.round(spot.frequency_khz * 1000));
    const mode = inferTuneMode(spot.mode, freqMhz, availableModes);
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  // ── Render functions ──────────────────────────────────────────────────────
  const renderSpotsTable = (showFullLocation: boolean) => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-auto">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activator', label: 'Activator', width: '' },
            { key: 'frequency', label: 'Frequency', width: '' },
            { key: 'mode', label: 'Mode', width: '' },
            { key: 'locationDesc', label: 'Location', width: 'w-full' },
            { key: 'spotTime', label: 'Age', width: '' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => pota.handleSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none border-b border-[#2a2b2e]", width)}
            >
              {label}
              {pota.sortCol === key && pota.sortDir !== 'api' && (
                <span className="ml-1 text-emerald-500">{pota.sortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pota.displayedSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No POTA spots in the last {pota.maxAge} min...
            </td>
          </tr>
        ) : (
          pota.displayedSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.spotId}` : String(spot.spotId)}>
              {!isPinned && index > 0 && pota.displayedSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                pota.matchedSpotIds.has(spot.spotId)
                  ? "bg-red-500/10 hover:bg-red-500/20"
                  : "hover:bg-white/5"
              )}>
                <td className="px-2 py-1 text-emerald-400 whitespace-nowrap">{spot.activator}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    onClick={() => handleTuneToSpot(spot)}
                    disabled={!connected}
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={connected ? 'Tune VFO to this frequency' : 'Connect to rig first'}
                  >
                    {parseFloat((spot.frequency / 1000).toFixed(4)).toString()}
                  </button>
                </td>
                <td className="px-2 py-1 text-[#e0e0e0] whitespace-nowrap">{spot.mode}</td>
                <td className="px-2 py-1 text-[#8e9299]">
                  {showFullLocation
                    ? `${spot.locationDesc} · ${spot.reference} · ${spot.name}`
                    : `${spot.locationDesc} · ${spot.reference}`}
                </td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(potaAccessors.timeMs(spot))}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  const renderSotaSpotsTable = () => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-auto">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activatorCallsign', label: 'Activator', width: '' },
            { key: 'frequency', label: 'Frequency', width: '' },
            { key: 'mode', label: 'Mode', width: '' },
            { key: 'summitCode', label: 'Location', width: 'w-full' },
            { key: 'timeStamp', label: 'Age', width: '' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => sota.handleSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none border-b border-[#2a2b2e]", width)}
            >
              {label}
              {sota.sortCol === key && sota.sortDir !== 'api' && (
                <span className="ml-1 text-amber-500">{sota.sortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sota.displayedSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No SOTA spots in the last {sota.maxAge} min...
            </td>
          </tr>
        ) : (
          sota.displayedSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.id}` : String(spot.id)}>
              {!isPinned && index > 0 && sota.displayedSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                sota.matchedSpotIds.has(spot.id)
                  ? "bg-red-500/10 hover:bg-red-500/20"
                  : "hover:bg-white/5"
              )}>
                <td className="px-2 py-1 text-amber-400 whitespace-nowrap">{spot.activatorCallsign}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    onClick={() => handleTuneToSotaSpot(spot)}
                    disabled={!connected}
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={connected ? 'Tune VFO to this frequency' : 'Connect to rig first'}
                  >
                    {parseFloat(parseFloat(spot.frequency).toFixed(4)).toString()}
                  </button>
                </td>
                <td className="px-2 py-1 text-[#e0e0e0] whitespace-nowrap">{spot.mode}</td>
                <td className="px-2 py-1 text-[#8e9299]">{spot.associationCode}/{spot.summitCode}</td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(sotaAccessors.timeMs(spot))}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  const renderWwffSpotsTable = () => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-auto">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activator', label: 'Activator', width: '' },
            { key: 'frequency_khz', label: 'Frequency', width: '' },
            { key: 'mode', label: 'Mode', width: '' },
            { key: 'reference', label: 'Location', width: 'w-full' },
            { key: 'spot_time', label: 'Age', width: '' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => wwff.handleSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none border-b border-[#2a2b2e]", width)}
            >
              {label}
              {wwff.sortCol === key && wwff.sortDir !== 'api' && (
                <span className="ml-1 text-sky-500">{wwff.sortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {wwff.displayedSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No WWFF spots in the last {wwff.maxAge} min...
            </td>
          </tr>
        ) : (
          wwff.displayedSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.id}` : String(spot.id)}>
              {!isPinned && index > 0 && wwff.displayedSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                wwff.matchedSpotIds.has(spot.id)
                  ? "bg-red-500/10 hover:bg-red-500/20"
                  : "hover:bg-white/5"
              )}>
                <td className="px-2 py-1 text-sky-400 whitespace-nowrap">{spot.activator}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    onClick={() => handleTuneToWwffSpot(spot)}
                    disabled={!connected}
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={connected ? 'Tune VFO to this frequency' : 'Connect to rig first'}
                  >
                    {parseFloat((spot.frequency_khz / 1000).toFixed(4)).toString()}
                  </button>
                </td>
                <td className="px-2 py-1 text-[#e0e0e0] whitespace-nowrap">{spot.mode}</td>
                <td className="px-2 py-1 text-[#8e9299]">{spot.reference} · {spot.reference_name}</td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(wwffAccessors.timeMs(spot))}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  return {
    // Settings state (App.tsx needs for save-settings emit and layouts)
    potaPollRate: pota.pollRate, setPotaPollRate: pota.setPollRate,
    potaMaxAge: pota.maxAge, setPotaMaxAge: pota.setMaxAge,
    potaModeFilter: pota.modeFilter, setPotaModeFilter: pota.setModeFilter,
    potaBandFilter: pota.bandFilter, setPotaBandFilter: pota.setBandFilter,
    potaSortCol: pota.sortCol,
    potaSortDir: pota.sortDir,
    isCompactPotaSpotsCollapsed, setIsCompactPotaSpotsCollapsed,
    isPhonePotaSpotsCollapsed, setIsPhonePotaSpotsCollapsed,
    sotaPollRate: sota.pollRate, setSotaPollRate: sota.setPollRate,
    sotaMaxAge: sota.maxAge, setSotaMaxAge: sota.setMaxAge,
    sotaModeFilter: sota.modeFilter, setSotaModeFilter: sota.setModeFilter,
    sotaBandFilter: sota.bandFilter, setSotaBandFilter: sota.setBandFilter,
    sotaSortCol: sota.sortCol,
    sotaSortDir: sota.sortDir,
    isCompactSotaSpotsCollapsed, setIsCompactSotaSpotsCollapsed,
    isPhoneSotaSpotsCollapsed, setIsPhoneSotaSpotsCollapsed,
    wwffPollRate: wwff.pollRate, setWwffPollRate: wwff.setPollRate,
    wwffMaxAge: wwff.maxAge, setWwffMaxAge: wwff.setMaxAge,
    wwffModeFilter: wwff.modeFilter, setWwffModeFilter: wwff.setModeFilter,
    wwffBandFilter: wwff.bandFilter, setWwffBandFilter: wwff.setBandFilter,
    wwffSortCol: wwff.sortCol,
    wwffSortDir: wwff.sortDir,
    isCompactWwffSpotsCollapsed, setIsCompactWwffSpotsCollapsed,
    isPhoneWwffSpotsCollapsed, setIsPhoneWwffSpotsCollapsed,
    // Computed
    filteredSpots: pota.filteredSpots,
    filteredSotaSpots: sota.filteredSpots,
    filteredWwffSpots: wwff.filteredSpots,
    displayedSpots: pota.displayedSpots,
    displayedSotaSpots: sota.displayedSpots,
    displayedWwffSpots: wwff.displayedSpots,
    // Render functions
    renderSpotsTable,
    renderSotaSpotsTable,
    renderWwffSpotsTable,
  };
}
