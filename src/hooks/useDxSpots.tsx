import React, { useState, useEffect, useMemo } from "react";
import { Socket } from "socket.io-client";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";
import { usePersistedCollapsed } from "./usePersistedCollapsed";
import { inferTuneMode } from "./usePotaSpots";
import type { DxSpot, RigStatus } from "../types";

interface UseDxSpotsOptions {
  socket: Socket | null;
  connected: boolean;
  status: RigStatus;
  inputVfoA: string;
  inputVfoB: string;
  availableModes: string[];
  skipPollsCount: React.MutableRefObject<number>;
  setStatus: React.Dispatch<React.SetStateAction<RigStatus>>;
  settingsLoaded: boolean;
  callsign?: string;
}

const MAX_DX_SPOTS = 300;
// filteredDxSpots re-derives its age cutoff from Date.now() but is a useMemo
// keyed on data/settings changes — with no new dx-spot events (e.g. the
// telnet connection dropped) it never recomputes on its own, so spots that
// should have aged out just sit there indefinitely (issue #59). This tick
// forces a periodic recompute independent of whether new spots arrive.
const AGE_TICK_MS = 30_000;

// DX-cluster comments are free text typed by the spotter (e.g. "CQ CQ FT8",
// "UP 2 CW"), unlike POTA/SOTA/WWFF's structured mode field — this is a
// best-effort scan, not a guarantee. Only feeds inferTuneMode() when a clear
// keyword is present; otherwise the tune handler leaves mode untouched
// rather than risk silently changing it to something wrong.
function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every(x => setA.has(x));
}

function detectModeKeyword(comment: string): 'SSB' | 'CW' | 'FT8' | 'FT4' | undefined {
  const upper = comment.toUpperCase();
  if (/\bFT8\b/.test(upper)) return 'FT8';
  if (/\bFT4\b/.test(upper)) return 'FT4';
  if (/\b(SSB|USB|LSB)\b/.test(upper)) return 'SSB';
  if (/\bCW\b/.test(upper)) return 'CW';
  return undefined;
}

export function useDxSpots({
  socket,
  connected,
  status,
  inputVfoA,
  inputVfoB,
  availableModes,
  skipPollsCount,
  setStatus,
  settingsLoaded,
  callsign = "",
}: UseDxSpotsOptions) {
  const ns = (key: string) =>
    callsign ? `${callsign.toUpperCase()}:${key}` : key;

  const [dxSpots, setDxSpots] = useState<DxSpot[]>([]);
  const [dxConnected, setDxConnected] = useState(false);
  const [dxError, setDxError] = useState<string | null>(null);

  const [dxClusterEnabled, setDxClusterEnabled] = useState(false);
  const [dxHost, setDxHost] = useState("w3lpl.net");
  const [dxPort, setDxPort] = useState(7373);
  const [dxLoginCallsign, setDxLoginCallsign] = useState("");
  const [dxMaxAge, setDxMaxAge] = useState(30);
  const [dxCallsignFilter, setDxCallsignFilter] = useState<string[]>([]);
  const [dxKeywordFilter, setDxKeywordFilter] = useState<string[]>([]);
  const [dxBandFilter, setDxBandFilter] = useState<string[]>(() => POTA_BANDS.map(b => b.label));
  const [dxSortCol, setDxSortCol] = useState<string | null>('spotTime');
  const [dxSortDir, setDxSortDir] = useState<'asc' | 'desc' | 'api'>('desc');
  const [isCompactDxSpotsCollapsed, setIsCompactDxSpotsCollapsed] = usePersistedCollapsed(ns, "compact-dx-spots-collapsed", null, false, callsign);
  const [isPhoneDxSpotsCollapsed, setIsPhoneDxSpotsCollapsed] = usePersistedCollapsed(ns, "phone-dx-spots-collapsed", null, false, callsign);

  // Pre-fill the login callsign suggestion from the logged-in operator's own
  // callsign the first time it becomes known, without clobbering a value
  // already loaded from settings.
  useEffect(() => {
    if (callsign && !dxLoginCallsign) setDxLoginCallsign(callsign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callsign]);

  // ── Settings loading from server ─────────────────────────────────────────
  // Every setter below uses the functional-update form and returns the
  // *same* array/primitive reference when the incoming value already
  // matches current state. This matters because the save-settings effect
  // below is keyed on these values by reference/identity: naively calling
  // e.g. setDxCallsignFilter(s.callsignFilter) with a freshly-parsed-from-
  // JSON array (a new reference every time, even when the contents are
  // identical) re-triggers that effect, which re-emits save-settings, which
  // echoes back here, forever — a real feedback loop that was hammering the
  // server (and, downstream, the DX cluster connection) roughly once a
  // second. Skipping the update when nothing actually changed breaks the
  // cycle at the source.
  useEffect(() => {
    if (!socket) return;
    const handler = (data: any) => {
      const s = data.dxClusterSettings;
      if (!s) return;
      if (s.enabled !== undefined) setDxClusterEnabled(prev => prev === s.enabled ? prev : s.enabled);
      if (s.host !== undefined) setDxHost(prev => prev === s.host ? prev : s.host);
      if (s.port !== undefined) setDxPort(prev => prev === s.port ? prev : s.port);
      if (s.loginCallsign) setDxLoginCallsign(prev => prev === s.loginCallsign ? prev : s.loginCallsign);
      if (s.maxAge !== undefined) setDxMaxAge(prev => prev === s.maxAge ? prev : s.maxAge);
      if (Array.isArray(s.callsignFilter)) setDxCallsignFilter(prev => sameStringSet(prev, s.callsignFilter) ? prev : s.callsignFilter);
      if (Array.isArray(s.keywordFilter)) setDxKeywordFilter(prev => sameStringSet(prev, s.keywordFilter) ? prev : s.keywordFilter);
      if (Array.isArray(s.bandFilter) && s.bandFilter.length > 0) setDxBandFilter(prev => sameStringSet(prev, s.bandFilter) ? prev : s.bandFilter);
    };
    socket.on("settings-data", handler);
    return () => { socket.off("settings-data", handler); };
  }, [socket]);

  // ── Save settings ─────────────────────────────────────────────────────────
  // Emitted as its own scoped { dxClusterSettings } payload (mirroring
  // SpectrumHamlibPanel's save pattern) rather than folded into App.tsx's
  // single bundled save-settings effect — that bundle fires on any unrelated
  // rig/pota/sota/wwff setting change too, and the server treats every
  // save-settings call carrying dxClusterSettings as an explicit
  // enable/disable request (stop+restart the telnet connection). Bundling
  // this in would restart the DX cluster connection on completely unrelated
  // settings saves.
  useEffect(() => {
    if (!settingsLoaded || !socket) return;
    const timer = setTimeout(() => {
      socket.emit("save-settings", {
        dxClusterSettings: {
          enabled: dxClusterEnabled,
          host: dxHost,
          port: dxPort,
          loginCallsign: dxLoginCallsign,
          maxAge: dxMaxAge,
          callsignFilter: dxCallsignFilter,
          keywordFilter: dxKeywordFilter,
          bandFilter: dxBandFilter,
        },
      });
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, socket, dxClusterEnabled, dxHost, dxPort, dxLoginCallsign, dxMaxAge, dxCallsignFilter, dxKeywordFilter, dxBandFilter]);

  // ── Live spot feed ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onBacklog = (spots: DxSpot[]) => setDxSpots(Array.isArray(spots) ? spots : []);
    const onSpot = (spot: DxSpot) => {
      setDxSpots(prev => {
        if (prev.some(s => s.id === spot.id)) return prev;
        const next = [...prev, spot];
        return next.length > MAX_DX_SPOTS ? next.slice(-MAX_DX_SPOTS) : next;
      });
    };
    const onStatus = ({ connected: c, error }: { connected: boolean; error: string | null }) => {
      setDxConnected(c);
      setDxError(error);
    };
    socket.on("dx-spots-backlog", onBacklog);
    socket.on("dx-spot", onSpot);
    socket.on("dx-cluster-status", onStatus);
    return () => {
      socket.off("dx-spots-backlog", onBacklog);
      socket.off("dx-spot", onSpot);
      socket.off("dx-cluster-status", onStatus);
    };
  }, [socket]);

  // ── Age tick ──────────────────────────────────────────────────────────────
  const [ageTick, setAgeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setAgeTick(t => t + 1), AGE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const filteredDxSpots = useMemo(() => {
    const cutoff = Date.now() - dxMaxAge * 60 * 1000;
    const callsignUpper = dxCallsignFilter.map(t => t.toUpperCase());
    const keywordUpper = dxKeywordFilter.map(t => t.toUpperCase());
    return dxSpots.filter(s => {
      if (s.spotTime < cutoff) return false;
      if (dxBandFilter.length > 0) {
        const inBand = dxBandFilter.some(label => {
          const band = POTA_BANDS.find(b => b.label === label);
          return band && s.frequency >= band.min && s.frequency < band.max;
        });
        if (!inBand) return false;
      }
      if (callsignUpper.length > 0 && !callsignUpper.some(t => s.dxCall.includes(t))) return false;
      if (keywordUpper.length > 0 && !keywordUpper.some(t => s.comment.toUpperCase().includes(t))) return false;
      return true;
    });
  }, [dxSpots, dxMaxAge, dxBandFilter, dxCallsignFilter, dxKeywordFilter, ageTick]);

  const sortedDxSpots = useMemo(() => {
    if (!dxSortCol || dxSortDir === 'api') return filteredDxSpots;
    return [...filteredDxSpots].sort((a, b) => {
      const aVal = (a as any)[dxSortCol];
      const bVal = (b as any)[dxSortCol];
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return dxSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredDxSpots, dxSortCol, dxSortDir]);

  const matchedDxSpotIds = useMemo(() => {
    const activeHz = Math.round(parseFloat(status.vfo === 'VFOA' ? inputVfoA : inputVfoB) * 1_000_000);
    const ids = new Set<string>();
    for (const spot of filteredDxSpots) {
      const spotHz = Math.round(spot.frequency * 1000);
      if (Math.abs(spotHz - activeHz) <= 100) ids.add(spot.id);
    }
    return ids;
  }, [filteredDxSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedDxSpots = useMemo(() => {
    if (matchedDxSpotIds.size === 0) return sortedDxSpots.map(s => ({ spot: s, isPinned: false }));
    const pinned = sortedDxSpots
      .filter(s => matchedDxSpotIds.has(s.id))
      .map(s => ({ spot: s, isPinned: true }));
    const all = sortedDxSpots.map(s => ({ spot: s, isPinned: false }));
    return [...pinned, ...all];
  }, [sortedDxSpots, matchedDxSpotIds]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const formatDxSpotAge = (spotTimeMs: number): string => {
    const diff = Math.floor((Date.now() - spotTimeMs) / 60000);
    return diff <= 0 ? '<1m ago' : `${diff}m ago`;
  };

  const handleTuneToDxSpot = (spot: DxSpot) => {
    if (!connected) return;
    const freqHz = String(Math.round(spot.frequency * 1000));
    const detected = detectModeKeyword(spot.comment);
    const mode = detected ? inferTuneMode(detected, spot.frequency / 1000, availableModes) : undefined;
    const modeChanged = mode !== undefined && mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, ...(mode ? { mode } : {}) }));
    socket?.emit('tune-to-spot', { freqHz, ...(mode ? { mode } : {}), modeChanged });
  };

  const handleDxSort = (col: string) => {
    if (dxSortCol !== col) {
      setDxSortCol(col);
      setDxSortDir('asc');
    } else if (dxSortDir === 'asc') {
      setDxSortDir('desc');
    } else {
      setDxSortCol(null);
      setDxSortDir('api');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const renderDxSpotsTable = () => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-auto">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'dxCall', label: 'DX', width: '' },
            { key: 'frequency', label: 'Frequency', width: '' },
            { key: 'spotter', label: 'Spotter', width: '' },
            { key: 'comment', label: 'Comment', width: 'w-full' },
            { key: 'spotTime', label: 'Age', width: '' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => handleDxSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none border-b border-[#2a2b2e]", width)}
            >
              {label}
              {dxSortCol === key && dxSortDir !== 'api' && (
                <span className="ml-1 text-rose-500">{dxSortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {!dxClusterEnabled ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              DX Cluster disabled — enable it in Spot Settings...
            </td>
          </tr>
        ) : !dxConnected ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              {dxError ? `DX Cluster error: ${dxError}` : 'Connecting to DX Cluster...'}
            </td>
          </tr>
        ) : displayedDxSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No DX spots in the last {dxMaxAge} min...
            </td>
          </tr>
        ) : (
          displayedDxSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.id}` : spot.id}>
              {!isPinned && index > 0 && displayedDxSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                matchedDxSpotIds.has(spot.id)
                  ? "bg-red-500/10 hover:bg-red-500/20"
                  : "hover:bg-white/5"
              )}>
                <td className="px-2 py-1 text-rose-400 whitespace-nowrap">{spot.dxCall}</td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    onClick={() => handleTuneToDxSpot(spot)}
                    disabled={!connected}
                    className="text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={connected ? 'Tune VFO to this frequency' : 'Connect to rig first'}
                  >
                    {parseFloat((spot.frequency / 1000).toFixed(4)).toString()}
                  </button>
                </td>
                <td className="px-2 py-1 text-[#e0e0e0] whitespace-nowrap">{spot.spotter}</td>
                <td className="px-2 py-1 text-[#8e9299]">{spot.comment}</td>
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatDxSpotAge(spot.spotTime)}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  return {
    dxClusterEnabled, setDxClusterEnabled,
    dxHost, setDxHost,
    dxPort, setDxPort,
    dxLoginCallsign, setDxLoginCallsign,
    dxMaxAge, setDxMaxAge,
    dxCallsignFilter, setDxCallsignFilter,
    dxKeywordFilter, setDxKeywordFilter,
    dxBandFilter, setDxBandFilter,
    dxSortCol,
    dxSortDir,
    dxConnected,
    dxError,
    isCompactDxSpotsCollapsed, setIsCompactDxSpotsCollapsed,
    isPhoneDxSpotsCollapsed, setIsPhoneDxSpotsCollapsed,
    filteredDxSpots,
    displayedDxSpots,
    renderDxSpotsTable,
  };
}
