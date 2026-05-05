import React, { useState, useEffect, useMemo } from "react";
import { Socket } from "socket.io-client";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";
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
}

const ALL_SPOT_MODES = ['SSB', 'CW', 'FT8', 'FT4'];

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
}: UsePotaSpotsOptions) {
  // ── POTA state ────────────────────────────────────────────────────────────
  const [potaPollRate, setPotaPollRate] = useState(5);
  const [potaMaxAge, setPotaMaxAge] = useState(15);
  const [potaModeFilter, setPotaModeFilter] = useState<string[]>(ALL_SPOT_MODES);
  const [potaBandFilter, setPotaBandFilter] = useState<string[]>(() => POTA_BANDS.map(b => b.label));
  const [potaSpots, setPotaSpots] = useState<PotaSpot[]>([]);
  const [potaSortCol, setPotaSortCol] = useState<string | null>('spotTime');
  const [potaSortDir, setPotaSortDir] = useState<'asc' | 'desc' | 'api'>('desc');
  const [potaSpotsCollapsed, setPotaSpotsCollapsed] = useState(
    () => localStorage.getItem("pota-spots-collapsed") === "true"
  );

  // ── SOTA state ────────────────────────────────────────────────────────────
  const [sotaPollRate, setSotaPollRate] = useState(5);
  const [sotaMaxAge, setSotaMaxAge] = useState(15);
  const [sotaModeFilter, setSotaModeFilter] = useState<string[]>(ALL_SPOT_MODES);
  const [sotaBandFilter, setSotaBandFilter] = useState<string[]>(() => POTA_BANDS.map(b => b.label));
  const [sotaSpots, setSotaSpots] = useState<SotaSpot[]>([]);
  const [sotaSortCol, setSotaSortCol] = useState<string | null>('timeStamp');
  const [sotaSortDir, setSotaSortDir] = useState<'asc' | 'desc' | 'api'>('desc');
  const [sotaSpotsCollapsed, setSotaSpotsCollapsed] = useState(
    () => localStorage.getItem("sota-spots-collapsed") === "true"
  );

  // ── WWFF state ────────────────────────────────────────────────────────────
  const [wwffPollRate, setWwffPollRate] = useState(5);
  const [wwffMaxAge, setWwffMaxAge] = useState(15);
  const [wwffModeFilter, setWwffModeFilter] = useState<string[]>(ALL_SPOT_MODES);
  const [wwffBandFilter, setWwffBandFilter] = useState<string[]>(() => POTA_BANDS.map(b => b.label));
  const [wwffSpots, setWwffSpots] = useState<WwffSpot[]>([]);
  const [wwffSortCol, setWwffSortCol] = useState<string | null>('spot_time');
  const [wwffSortDir, setWwffSortDir] = useState<'asc' | 'desc' | 'api'>('desc');
  const [wwffSpotsCollapsed, setWwffSpotsCollapsed] = useState(
    () => localStorage.getItem("wwff-spots-collapsed") === "true"
  );

  // ── LocalStorage sync ─────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("pota-spots-collapsed", potaSpotsCollapsed.toString());
  }, [potaSpotsCollapsed]);

  useEffect(() => {
    localStorage.setItem("sota-spots-collapsed", sotaSpotsCollapsed.toString());
  }, [sotaSpotsCollapsed]);

  useEffect(() => {
    localStorage.setItem("wwff-spots-collapsed", wwffSpotsCollapsed.toString());
  }, [wwffSpotsCollapsed]);

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
        if (data.potaSettings.pollRate !== undefined) setPotaPollRate(data.potaSettings.pollRate);
        if (data.potaSettings.maxAge !== undefined) setPotaMaxAge(data.potaSettings.maxAge);
        if (data.potaSettings.modeFilter !== undefined) setPotaModeFilter(parseModeFilter(data.potaSettings.modeFilter));
        if (Array.isArray(data.potaSettings.bandFilter)) {
          setPotaBandFilter(data.potaSettings.bandFilter.length === 0
            ? POTA_BANDS.map(b => b.label)
            : data.potaSettings.bandFilter);
        }
      }
      if (data.sotaSettings) {
        if (data.sotaSettings.pollRate !== undefined) setSotaPollRate(data.sotaSettings.pollRate);
        if (data.sotaSettings.maxAge !== undefined) setSotaMaxAge(data.sotaSettings.maxAge);
        if (data.sotaSettings.modeFilter !== undefined) setSotaModeFilter(parseModeFilter(data.sotaSettings.modeFilter));
        if (Array.isArray(data.sotaSettings.bandFilter)) {
          setSotaBandFilter(data.sotaSettings.bandFilter.length === 0
            ? POTA_BANDS.map(b => b.label)
            : data.sotaSettings.bandFilter);
        }
      }
      if (data.wwffSettings) {
        if (data.wwffSettings.pollRate !== undefined) setWwffPollRate(data.wwffSettings.pollRate);
        if (data.wwffSettings.maxAge !== undefined) setWwffMaxAge(data.wwffSettings.maxAge);
        if (data.wwffSettings.modeFilter !== undefined) setWwffModeFilter(parseModeFilter(data.wwffSettings.modeFilter));
        if (Array.isArray(data.wwffSettings.bandFilter)) {
          setWwffBandFilter(data.wwffSettings.bandFilter.length === 0
            ? POTA_BANDS.map(b => b.label)
            : data.wwffSettings.bandFilter);
        }
      }
    };
    socket.on("settings-data", handler);
    return () => { socket.off("settings-data", handler); };
  }, [socket]);

  // ── POTA fetch interval ───────────────────────────────────────────────────
  useEffect(() => {
    if (!potaEnabled) {
      setPotaSpots([]);
      return;
    }
    const fetchSpots = async () => {
      try {
        const res = await fetch("https://api.pota.app/spot/");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setPotaSpots(data);
        }
      } catch {
        // network error — silently ignore
      }
    };
    fetchSpots();
    const interval = setInterval(fetchSpots, potaPollRate * 60 * 1000);
    return () => clearInterval(interval);
  }, [potaEnabled, potaPollRate]);

  // ── SOTA fetch interval ───────────────────────────────────────────────────
  // SOTA spotting polls api2.sota.org.uk/api/spots/-1/all (public, no auth).
  useEffect(() => {
    if (!sotaEnabled) {
      setSotaSpots([]);
      return;
    }
    const fetchSotaSpots = async () => {
      try {
        const res = await fetch("https://api2.sota.org.uk/api/spots/-1/all");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setSotaSpots(data);
        }
      } catch {
        // network error — silently ignore
      }
    };
    fetchSotaSpots();
    const interval = setInterval(fetchSotaSpots, sotaPollRate * 60 * 1000);
    return () => clearInterval(interval);
  }, [sotaEnabled, sotaPollRate]);

  // ── WWFF fetch interval ───────────────────────────────────────────────────
  useEffect(() => {
    if (!wwffEnabled) {
      setWwffSpots([]);
      return;
    }
    const fetchWwffSpots = async () => {
      try {
        const res = await fetch("https://spots.wwff.co/static/spots.json");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setWwffSpots(data);
        }
      } catch {
        // network error — silently ignore
      }
    };
    fetchWwffSpots();
    const interval = setInterval(fetchWwffSpots, wwffPollRate * 60 * 1000);
    return () => clearInterval(interval);
  }, [wwffEnabled, wwffPollRate]);

  // ── Computed: POTA ────────────────────────────────────────────────────────
  const filteredSpots = useMemo(() => {
    const latestByActivator = new Map<string, PotaSpot>();
    for (const spot of potaSpots) {
      const existing = latestByActivator.get(spot.activator);
      if (!existing || spot.spotTime > existing.spotTime) {
        latestByActivator.set(spot.activator, spot);
      }
    }
    const cutoff = Date.now() - potaMaxAge * 60 * 1000;
    const potaAllModes = ALL_SPOT_MODES.every(m => potaModeFilter.includes(m));
    return [...latestByActivator.values()].filter(s => {
      if (new Date(s.spotTime + 'Z').getTime() < cutoff) return false;
      if (!potaAllModes && potaModeFilter.length > 0 && !potaModeFilter.includes(s.mode)) return false;
      if (potaBandFilter.length > 0) {
        const inBand = potaBandFilter.some(label => {
          const band = POTA_BANDS.find(b => b.label === label);
          return band && s.frequency >= band.min && s.frequency < band.max;
        });
        if (!inBand) return false;
      }
      return true;
    });
  }, [potaSpots, potaMaxAge, potaModeFilter, potaBandFilter]);

  const sortedSpots = useMemo(() => {
    if (!potaSortCol || potaSortDir === 'api') return filteredSpots;
    return [...filteredSpots].sort((a, b) => {
      const aVal = (a as any)[potaSortCol];
      const bVal = (b as any)[potaSortCol];
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return potaSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredSpots, potaSortCol, potaSortDir]);

  const matchedSpotIds = useMemo(() => {
    const activeHz = Math.round(parseFloat(status.vfo === 'VFOA' ? inputVfoA : inputVfoB) * 1_000_000);
    const ids = new Set<number>();
    for (const spot of filteredSpots) {
      const spotHz = Math.round(spot.frequency * 1000);
      if (spotHz === activeHz) ids.add(spot.spotId);
    }
    return ids;
  }, [filteredSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedSpots = useMemo(() => {
    if (matchedSpotIds.size === 0) return sortedSpots.map(s => ({ spot: s, isPinned: false }));
    const pinned = sortedSpots
      .filter(s => matchedSpotIds.has(s.spotId))
      .map(s => ({ spot: s, isPinned: true }));
    const all = sortedSpots.map(s => ({ spot: s, isPinned: false }));
    return [...pinned, ...all];
  }, [sortedSpots, matchedSpotIds]);

  // ── Computed: SOTA ────────────────────────────────────────────────────────
  const filteredSotaSpots = useMemo(() => {
    const latestByActivator = new Map<string, SotaSpot>();
    for (const spot of sotaSpots) {
      const existing = latestByActivator.get(spot.activatorCallsign);
      if (!existing || spot.timeStamp > existing.timeStamp) {
        latestByActivator.set(spot.activatorCallsign, spot);
      }
    }
    const cutoff = Date.now() - sotaMaxAge * 60 * 1000;
    const sotaAllModes = ALL_SPOT_MODES.every(m => sotaModeFilter.includes(m));
    return [...latestByActivator.values()].filter(s => {
      if (new Date(s.timeStamp + 'Z').getTime() < cutoff) return false;
      if (!sotaAllModes && sotaModeFilter.length > 0 && !sotaModeFilter.includes(s.mode)) return false;
      if (sotaBandFilter.length > 0) {
        const freqKhz = parseFloat(s.frequency) * 1000;
        const inBand = sotaBandFilter.some(label => {
          const band = POTA_BANDS.find(b => b.label === label);
          return band && freqKhz >= band.min && freqKhz < band.max;
        });
        if (!inBand) return false;
      }
      return true;
    });
  }, [sotaSpots, sotaMaxAge, sotaModeFilter, sotaBandFilter]);

  const sortedSotaSpots = useMemo(() => {
    if (!sotaSortCol || sotaSortDir === 'api') return filteredSotaSpots;
    return [...filteredSotaSpots].sort((a, b) => {
      const aVal = (a as any)[sotaSortCol];
      const bVal = (b as any)[sotaSortCol];
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sotaSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredSotaSpots, sotaSortCol, sotaSortDir]);

  const matchedSotaSpotIds = useMemo(() => {
    const activeHz = Math.round(parseFloat(status.vfo === 'VFOA' ? inputVfoA : inputVfoB) * 1_000_000);
    const ids = new Set<number>();
    for (const spot of filteredSotaSpots) {
      const spotHz = Math.round(parseFloat(spot.frequency) * 1_000_000);
      if (spotHz === activeHz) ids.add(spot.id);
    }
    return ids;
  }, [filteredSotaSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedSotaSpots = useMemo(() => {
    if (matchedSotaSpotIds.size === 0) return sortedSotaSpots.map(s => ({ spot: s, isPinned: false }));
    const pinned = sortedSotaSpots
      .filter(s => matchedSotaSpotIds.has(s.id))
      .map(s => ({ spot: s, isPinned: true }));
    const all = sortedSotaSpots.map(s => ({ spot: s, isPinned: false }));
    return [...pinned, ...all];
  }, [sortedSotaSpots, matchedSotaSpotIds]);

  // ── Computed: WWFF ────────────────────────────────────────────────────────
  const filteredWwffSpots = useMemo(() => {
    const latestByActivator = new Map<string, WwffSpot>();
    for (const spot of wwffSpots) {
      const existing = latestByActivator.get(spot.activator);
      if (!existing || spot.spot_time > existing.spot_time) {
        latestByActivator.set(spot.activator, spot);
      }
    }
    const cutoff = Date.now() - wwffMaxAge * 60 * 1000;
    const wwffAllModes = ALL_SPOT_MODES.every(m => wwffModeFilter.includes(m));
    return [...latestByActivator.values()].filter(s => {
      if (s.spot_time * 1000 < cutoff) return false;
      if (!wwffAllModes && wwffModeFilter.length > 0 && !wwffModeFilter.includes(s.mode)) return false;
      if (wwffBandFilter.length > 0) {
        const inBand = wwffBandFilter.some(label => {
          const band = POTA_BANDS.find(b => b.label === label);
          return band && s.frequency_khz >= band.min && s.frequency_khz < band.max;
        });
        if (!inBand) return false;
      }
      return true;
    });
  }, [wwffSpots, wwffMaxAge, wwffModeFilter, wwffBandFilter]);

  const sortedWwffSpots = useMemo(() => {
    if (!wwffSortCol || wwffSortDir === 'api') return filteredWwffSpots;
    return [...filteredWwffSpots].sort((a, b) => {
      const aVal = (a as any)[wwffSortCol];
      const bVal = (b as any)[wwffSortCol];
      const cmp = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return wwffSortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredWwffSpots, wwffSortCol, wwffSortDir]);

  const matchedWwffSpotIds = useMemo(() => {
    const activeHz = Math.round(parseFloat(status.vfo === 'VFOA' ? inputVfoA : inputVfoB) * 1_000_000);
    const ids = new Set<number>();
    for (const spot of filteredWwffSpots) {
      const spotHz = Math.round(spot.frequency_khz * 1000);
      if (spotHz === activeHz) ids.add(spot.id);
    }
    return ids;
  }, [filteredWwffSpots, inputVfoA, inputVfoB, status.vfo]);

  const displayedWwffSpots = useMemo(() => {
    if (matchedWwffSpotIds.size === 0) return sortedWwffSpots.map(s => ({ spot: s, isPinned: false }));
    const pinned = sortedWwffSpots
      .filter(s => matchedWwffSpotIds.has(s.id))
      .map(s => ({ spot: s, isPinned: true }));
    const all = sortedWwffSpots.map(s => ({ spot: s, isPinned: false }));
    return [...pinned, ...all];
  }, [sortedWwffSpots, matchedWwffSpotIds]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const formatSpotAge = (spotTime: string): string => {
    const diff = Math.floor((Date.now() - new Date(spotTime + 'Z').getTime()) / 60000);
    return diff <= 0 ? '<1m ago' : `${diff}m ago`;
  };

  const handleTuneToSpot = (spot: PotaSpot) => {
    if (!connected) return;
    const freqHz = String(Math.round(spot.frequency * 1000));
    let mode = spot.mode;
    if (mode === 'SSB') mode = (spot.frequency / 1000) >= 10 ? 'USB' : 'LSB';
    if (mode === 'CW')  mode = (spot.frequency / 1000) >= 10 ? 'CW'  : 'CWR';
    if (mode === 'FT8' || mode === 'FT4') mode = availableModes.includes('PKTUSB') ? 'PKTUSB' : 'USB';
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handlePotaSort = (col: string) => {
    if (potaSortCol !== col) {
      setPotaSortCol(col);
      setPotaSortDir('asc');
    } else if (potaSortDir === 'asc') {
      setPotaSortDir('desc');
    } else {
      setPotaSortCol(null);
      setPotaSortDir('api');
    }
  };

  const handleTuneToSotaSpot = (spot: SotaSpot) => {
    if (!connected) return;
    const freqMhz = parseFloat(spot.frequency);
    const freqHz = String(Math.round(freqMhz * 1_000_000));
    let mode = spot.mode;
    if (mode === 'SSB') mode = freqMhz >= 10 ? 'USB' : 'LSB';
    if (mode === 'CW')  mode = freqMhz >= 10 ? 'CW'  : 'CWR';
    if (mode === 'FT8' || mode === 'FT4') mode = availableModes.includes('PKTUSB') ? 'PKTUSB' : 'USB';
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handleSotaSort = (col: string) => {
    if (sotaSortCol !== col) {
      setSotaSortCol(col);
      setSotaSortDir('asc');
    } else if (sotaSortDir === 'asc') {
      setSotaSortDir('desc');
    } else {
      setSotaSortCol(null);
      setSotaSortDir('api');
    }
  };

  const handleTuneToWwffSpot = (spot: WwffSpot) => {
    if (!connected) return;
    const freqMhz = spot.frequency_khz / 1000;
    const freqHz = String(Math.round(spot.frequency_khz * 1000));
    let mode = spot.mode;
    if (mode === 'SSB') mode = freqMhz >= 10 ? 'USB' : 'LSB';
    if (mode === 'CW')  mode = freqMhz >= 10 ? 'CW'  : 'CWR';
    if (mode === 'FT8' || mode === 'FT4') mode = availableModes.includes('PKTUSB') ? 'PKTUSB' : 'USB';
    const modeChanged = mode !== status.mode;
    skipPollsCount.current = 1;
    setStatus(prev => ({ ...prev, frequency: freqHz, mode }));
    socket?.emit('tune-to-spot', { freqHz, mode, modeChanged });
  };

  const handleWwffSort = (col: string) => {
    if (wwffSortCol !== col) {
      setWwffSortCol(col);
      setWwffSortDir('asc');
    } else if (wwffSortDir === 'asc') {
      setWwffSortDir('desc');
    } else {
      setWwffSortCol(null);
      setWwffSortDir('api');
    }
  };

  // ── Render functions ──────────────────────────────────────────────────────
  const renderSpotsTable = (showFullLocation: boolean) => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-fixed">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activator', label: 'Activator', width: 'w-[18%]' },
            { key: 'frequency', label: 'Frequency', width: 'w-[18%]' },
            { key: 'mode', label: 'Mode', width: 'w-[10%]' },
            { key: 'locationDesc', label: 'Location', width: 'w-[44%]' },
            { key: 'spotTime', label: 'Age', width: 'w-[10%]' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => handlePotaSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none whitespace-nowrap border-b border-[#2a2b2e]", width)}
            >
              {label}
              {potaSortCol === key && potaSortDir !== 'api' && (
                <span className="ml-1 text-emerald-500">{potaSortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {displayedSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No POTA spots in the last {potaMaxAge} min...
            </td>
          </tr>
        ) : (
          displayedSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.spotId}` : String(spot.spotId)}>
              {!isPinned && index > 0 && displayedSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                matchedSpotIds.has(spot.spotId)
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
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(spot.spotTime)}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  const renderSotaSpotsTable = () => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-fixed">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activatorCallsign', label: 'Activator', width: 'w-[18%]' },
            { key: 'frequency', label: 'Frequency', width: 'w-[18%]' },
            { key: 'mode', label: 'Mode', width: 'w-[10%]' },
            { key: 'summitCode', label: 'Location', width: 'w-[44%]' },
            { key: 'timeStamp', label: 'Age', width: 'w-[10%]' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => handleSotaSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none whitespace-nowrap border-b border-[#2a2b2e]", width)}
            >
              {label}
              {sotaSortCol === key && sotaSortDir !== 'api' && (
                <span className="ml-1 text-amber-500">{sotaSortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {displayedSotaSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No SOTA spots in the last {sotaMaxAge} min...
            </td>
          </tr>
        ) : (
          displayedSotaSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.id}` : String(spot.id)}>
              {!isPinned && index > 0 && displayedSotaSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                matchedSotaSpotIds.has(spot.id)
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
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">{formatSpotAge(spot.timeStamp)}</td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  const renderWwffSpotsTable = () => (
    <table className="w-full text-[0.625rem] font-mono border-collapse table-fixed">
      <thead>
        <tr className="bg-[#0a0a0a]">
          {([
            { key: 'activator', label: 'Activator', width: 'w-[18%]' },
            { key: 'frequency_khz', label: 'Frequency', width: 'w-[18%]' },
            { key: 'mode', label: 'Mode', width: 'w-[10%]' },
            { key: 'reference', label: 'Location', width: 'w-[44%]' },
            { key: 'spot_time', label: 'Age', width: 'w-[10%]' },
          ] as const).map(({ key, label, width }) => (
            <th
              key={key}
              onClick={() => handleWwffSort(key)}
              className={cn("px-2 py-1.5 text-left text-[0.5625rem] uppercase text-[#8e9299] cursor-pointer hover:text-white select-none whitespace-nowrap border-b border-[#2a2b2e]", width)}
            >
              {label}
              {wwffSortCol === key && wwffSortDir !== 'api' && (
                <span className="ml-1 text-sky-500">{wwffSortDir === 'asc' ? '▲' : '▼'}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {displayedWwffSpots.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-4 text-center text-[#4a4b4e] italic">
              No WWFF spots in the last {wwffMaxAge} min...
            </td>
          </tr>
        ) : (
          displayedWwffSpots.map(({ spot, isPinned }, index) => (
            <React.Fragment key={isPinned ? `pinned-${spot.id}` : String(spot.id)}>
              {!isPinned && index > 0 && displayedWwffSpots[index - 1].isPinned && (
                <tr>
                  <td colSpan={5} className="px-2 py-1 text-center text-[0.5rem] uppercase tracking-widest text-[#4a4b4e] border-t-2 border-[#2a2b2e]">
                    — on frequency —
                  </td>
                </tr>
              )}
              <tr className={cn(
                "border-b border-[#2a2b2e]/40 transition-colors",
                matchedWwffSpotIds.has(spot.id)
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
                <td className="px-2 py-1 text-[#8e9299] whitespace-nowrap">
                  {(() => {
                    const diff = Math.floor((Date.now() - spot.spot_time * 1000) / 60000);
                    return diff <= 0 ? '<1m ago' : `${diff}m ago`;
                  })()}
                </td>
              </tr>
            </React.Fragment>
          ))
        )}
      </tbody>
    </table>
  );

  return {
    // Settings state (App.tsx needs for save-settings emit and layouts)
    potaPollRate, setPotaPollRate,
    potaMaxAge, setPotaMaxAge,
    potaModeFilter, setPotaModeFilter,
    potaBandFilter, setPotaBandFilter,
    potaSortCol,
    potaSortDir,
    potaSpotsCollapsed, setPotaSpotsCollapsed,
    sotaPollRate, setSotaPollRate,
    sotaMaxAge, setSotaMaxAge,
    sotaModeFilter, setSotaModeFilter,
    sotaBandFilter, setSotaBandFilter,
    sotaSortCol,
    sotaSortDir,
    sotaSpotsCollapsed, setSotaSpotsCollapsed,
    wwffPollRate, setWwffPollRate,
    wwffMaxAge, setWwffMaxAge,
    wwffModeFilter, setWwffModeFilter,
    wwffBandFilter, setWwffBandFilter,
    wwffSortCol,
    wwffSortDir,
    wwffSpotsCollapsed, setWwffSpotsCollapsed,
    // Computed
    filteredSpots,
    filteredSotaSpots,
    filteredWwffSpots,
    displayedSpots,
    displayedSotaSpots,
    displayedWwffSpots,
    // Render functions
    renderSpotsTable,
    renderSotaSpotsTable,
    renderWwffSpotsTable,
  };
}
