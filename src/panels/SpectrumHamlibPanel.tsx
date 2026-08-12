import React, { useRef, useEffect, useState, useCallback } from "react";
import { Activity, RefreshCw, Settings, X } from "lucide-react";
import type { Socket } from "socket.io-client";
import PanelChrome from "../components/PanelChrome";
import type { SpectrumData, SpectrumSettings } from "../types";
import { COLORMAPS, COLORMAP_NAMES, amplitudeToPixel } from "../utils/spectrumColors";
import { useAutoLevel } from "../hooks/useAutoLevel";
import type { AutoLevelOptions } from "../utils/autoLevel";

// The FT-710 wf1 array is 850 bins; only 790 cover the nominal span (395 per half-span),
// with 30 guard bins on each side. 850/790 maps pixel position to true frequency.
const FT710_SPAN_SCALE = 850 / 790;

const DEFAULT_HEIGHT = 200;
const SPECTRUM_RATIO = 0.3;
const FLOOR_DEFAULT_HAMLIB = -80;
const CEILING_DEFAULT_HAMLIB = -40;
const FLOOR_DEFAULT_FT4222 = -100;
const CEILING_DEFAULT_FT4222 = -50;
const FLOOR_DEFAULT_IQ = -80;
const CEILING_DEFAULT_IQ = -20;
const LS_PREFIX = "spectrum-hamlib-";
const TOOLTIP_MAX_WIDTH = 90;

// Keyed by spectrumSettings.source. lsKey suffixes preserve the existing
// localStorage keys for hamlib ("floor"/"ceiling") and ft4222
// ("floor-ft4222"/"ceiling-ft4222") for backward compatibility.
const SOURCE_DISPLAY_DEFAULTS: Record<SpectrumSettings["source"], { floor: number; ceiling: number; lsKey: string }> = {
  hamlib: { floor: FLOOR_DEFAULT_HAMLIB, ceiling: CEILING_DEFAULT_HAMLIB, lsKey: "" },
  ft4222: { floor: FLOOR_DEFAULT_FT4222, ceiling: CEILING_DEFAULT_FT4222, lsKey: "-ft4222" },
  iq: { floor: FLOOR_DEFAULT_IQ, ceiling: CEILING_DEFAULT_IQ, lsKey: "-iq" },
};

// The FT4222 SPI stream is a raw, single-look (un-averaged) periodogram
// straight from the radio's DSP, so its floor estimate needs a higher
// percentile than the p10 default to avoid landing in the tail of a
// single-look power estimate's exponential distribution (see autoLevel.ts
// header comment) — p63.2 is the percentile that equals that distribution's
// own mean, i.e. ~0dB bias instead of p10's ~-9.8dB. hamlib/iq are left at
// the default: hamlib's reported level may already reflect radio-side
// detector averaging, and the iq source's Web Audio AnalyserNode applies its
// own smoothingTimeConstant averaging before we ever see the FFT bins.
const SOURCE_ALGORITHM_OPTIONS: Partial<Record<SpectrumSettings["source"], Partial<AutoLevelOptions>>> = {
  ft4222: { floorPercentile: 63.2 },
};

const IQ_SAMPLE_RATE_OPTIONS = [48000, 96000, 192000];

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

interface Props {
  latestSpectrumRef: React.MutableRefObject<SpectrumData | null>;
  waterfallHistoryRef: React.MutableRefObject<number[][]>;
  spectrumSupported: boolean;
  spectrumEnabled: boolean;
  spectrumSettings: SpectrumSettings;
  setSpectrumSettings: React.Dispatch<React.SetStateAction<SpectrumSettings>>;
  socket: Socket | null;
  connected: boolean;
  handleSetFreq: (freq: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  heightPx?: number;
  callsign?: string;
}

export default function SpectrumHamlibPanel({
  latestSpectrumRef,
  waterfallHistoryRef,
  spectrumSupported,
  spectrumEnabled,
  spectrumSettings,
  setSpectrumSettings,
  socket,
  connected,
  handleSetFreq,
  isCollapsed,
  setIsCollapsed,
  heightPx = DEFAULT_HEIGHT,
  callsign = "",
}: Props) {
  const lsKey = useCallback(
    (key: string) => (callsign ? `${callsign.toUpperCase()}:${LS_PREFIX}${key}` : `${LS_PREFIX}${key}`),
    [callsign]
  );
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastDrawnTimestampRef = useRef<number>(0);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [colorMapId, setColorMapId] = useState(() => lsGet(lsKey("colormap"), "classic"));
  const sourceDefaults = SOURCE_DISPLAY_DEFAULTS[spectrumSettings.source];
  const floorDefault = sourceDefaults.floor;
  const ceilingDefault = sourceDefaults.ceiling;

  const autoLevel = useAutoLevel({
    lsKey,
    sourceSuffix: sourceDefaults.lsKey,
    manualFloorDefault: floorDefault,
    manualCeilingDefault: ceilingDefault,
    algorithmOptions: SOURCE_ALGORITHM_OPTIONS[spectrumSettings.source],
  });
  // Keeps the draw loop's closure on the latest sampleFrame/getEffective*
  // without needing floor/ceiling/auto-toggle changes to tear down and
  // rebuild the rAF loop below (that rebuild-on-every-change was the root
  // cause of floor/ceiling edits instantly re-painting the whole waterfall).
  const autoLevelRef = useRef(autoLevel);
  autoLevelRef.current = autoLevel;
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  const [cursorLineX, setCursorLineX] = useState<number | null>(null);
  const [yaesuStatus, setYaesuStatus] = useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const [iqStatus, setIqStatus] = useState<{ running: boolean; error: string | null }>({ running: false, error: null });
  const [iqInputDevices, setIqInputDevices] = useState<{ name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[]>([]);
  const [optimisticSpanIndex, setOptimisticSpanIndex] = useState<number | null>(null);
  const optimisticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socket) return;
    const handler = (s: { running: boolean; error: string | null }) => setYaesuStatus(s);
    socket.on("yaesu-scope-status", handler);
    return () => { socket.off("yaesu-scope-status", handler); };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const handler = (s: { running: boolean; error: string | null }) => setIqStatus(s);
    socket.on("iq-scope-status", handler);
    return () => { socket.off("iq-scope-status", handler); };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const handler = (data: { inputs: typeof iqInputDevices; outputs: any[] }) => setIqInputDevices(data.inputs ?? []);
    socket.on("audio-devices-list", handler);
    return () => { socket.off("audio-devices-list", handler); };
  }, [socket]);

  const spectrumHeight = Math.floor(heightPx * SPECTRUM_RATIO);
  const waterfallHeight = heightPx - spectrumHeight - 20;

  const freqLabel = useCallback((hz: number): string => {
    if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
    if (hz >= 1_000) return `${(hz / 1_000).toFixed(1)} kHz`;
    return `${hz} Hz`;
  }, []);

  // Tooltip uses 4 decimal places so the displayed value matches the VFO exactly.
  // 500 Hz snap guarantees the ten-thousandths digit is always 0 or 5.
  const tooltipFreqLabel = useCallback((hz: number): string => {
    if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(4)} MHz`;
    if (hz >= 1_000) return `${(hz / 1_000).toFixed(2)} kHz`;
    return `${hz} Hz`;
  }, []);

  const hzAtCursor = useCallback((e: React.MouseEvent<HTMLCanvasElement>): number | null => {
    const data = latestSpectrumRef.current;
    if (!data || !data.span || !data.centerFreq) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const fraction = x / rect.width;
    const scale = data.name === "FT-710" ? FT710_SPAN_SCALE : 1.0;
    const rawHz = data.centerFreq + (fraction - 0.5) * data.span * scale;
    return Math.round(rawHz / 100) * 100;
  }, [latestSpectrumRef]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hz = hzAtCursor(e);
    if (hz === null) return;
    handleSetFreq(String(hz));
  }, [hzAtCursor, handleSetFreq]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const hz = hzAtCursor(e);
    if (hz === null) { setTooltip(null); setCursorLineX(null); return; }
    const containerRect = canvasContainerRef.current?.getBoundingClientRect();
    if (!containerRect) { setTooltip(null); setCursorLineX(null); return; }
    const cursorX = e.clientX - containerRect.left;
    setCursorLineX(cursorX);
    const flipLeft = cursorX + 8 + TOOLTIP_MAX_WIDTH > containerRect.width;
    setTooltip({
      x: flipLeft ? cursorX - TOOLTIP_MAX_WIDTH - 8 : cursorX + 8,
      y: e.clientY - containerRect.top,
      label: tooltipFreqLabel(hz),
    });
  }, [hzAtCursor, tooltipFreqLabel]);

  const handleCanvasMouseLeave = useCallback(() => { setTooltip(null); setCursorLineX(null); }, []);

  useEffect(() => {
    if (isCollapsed) return;

    const colorMap = COLORMAPS[colorMapId] ?? COLORMAPS.classic;

    const draw = () => {
      const data = latestSpectrumRef.current;
      const specCanvas = spectrumCanvasRef.current;
      const wfCanvas = waterfallCanvasRef.current;
      if (!specCanvas || !wfCanvas) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const w = specCanvas.width;

      if (!data || data.amplitudes.length === 0 || !connected || !spectrumEnabled) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      if (data.timestamp === lastDrawnTimestampRef.current) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }
      lastDrawnTimestampRef.current = data.timestamp;

      const ampRange = data.maxLevel - data.minLevel || 1;

      const dbValues = new Float32Array(data.amplitudes.length);
      for (let i = 0; i < data.amplitudes.length; i++) {
        dbValues[i] = data.minLevel + (data.amplitudes[i] / 255) * ampRange;
      }
      autoLevelRef.current.sampleFrame(dbValues, performance.now());
      const effFloor = autoLevelRef.current.getEffectiveFloor();
      const effCeiling = autoLevelRef.current.getEffectiveCeiling();

      // --- Spectrum line ---
      const sCtx = specCanvas.getContext("2d");
      if (sCtx) {
        const sh = specCanvas.height;
        sCtx.clearRect(0, 0, w, sh);

        sCtx.strokeStyle = "rgba(255,255,255,0.08)";
        sCtx.lineWidth = 1;
        for (let db = Math.ceil(effFloor / 10) * 10; db <= effCeiling; db += 10) {
          const y = sh - ((db - effFloor) / (effCeiling - effFloor)) * sh;
          sCtx.beginPath();
          sCtx.moveTo(0, y);
          sCtx.lineTo(w, y);
          sCtx.stroke();
        }

        sCtx.beginPath();
        sCtx.strokeStyle = "#22c55e";
        sCtx.fillStyle = "rgba(34,197,94,0.25)";
        sCtx.lineWidth = 1.5;

        const step = w / data.amplitudes.length;
        for (let i = 0; i < data.amplitudes.length; i++) {
          const norm = Math.max(0, Math.min(1, (dbValues[i] - effFloor) / (effCeiling - effFloor)));
          const x = i * step;
          const y = sh - norm * sh;
          if (i === 0) {
            sCtx.moveTo(x, sh);
            sCtx.lineTo(x, y);
          } else {
            sCtx.lineTo(x, y);
          }
        }
        sCtx.lineTo(w, sh);
        sCtx.closePath();
        sCtx.fill();
        sCtx.stroke();

        // Center frequency marker line
        sCtx.save();
        sCtx.strokeStyle = "rgba(255,255,255,0.45)";
        sCtx.lineWidth = 1;
        sCtx.setLineDash([4, 4]);
        sCtx.beginPath();
        sCtx.moveTo(w / 2, 0);
        sCtx.lineTo(w / 2, sh);
        sCtx.stroke();
        sCtx.restore();
      }

      // --- Waterfall ---
      const wfCtx = wfCanvas.getContext("2d");
      if (wfCtx) {
        const wh = wfCanvas.height;
        const lines = waterfallHistoryRef.current;
        const visibleLines = Math.min(lines.length, wh);
        const imageData = wfCtx.createImageData(w, wh);
        const buf32 = new Uint32Array(imageData.data.buffer);

        for (let row = 0; row < visibleLines; row++) {
          const line = lines[row];
          const step = line.length / w;
          for (let col = 0; col < w; col++) {
            const ampIdx = Math.min(line.length - 1, Math.floor(col * step));
            const dbm = data.minLevel + (line[ampIdx] / 255) * ampRange;
            const norm = Math.max(0, Math.min(1, (dbm - effFloor) / (effCeiling - effFloor)));
            buf32[row * w + col] = amplitudeToPixel(Math.round(norm * 255), 0, 255, colorMap);
          }
        }

        wfCtx.putImageData(imageData, 0, 0);

        // Center frequency marker line
        wfCtx.save();
        wfCtx.strokeStyle = "rgba(255,255,255,0.35)";
        wfCtx.lineWidth = 1;
        wfCtx.setLineDash([4, 4]);
        wfCtx.beginPath();
        wfCtx.moveTo(w / 2, 0);
        wfCtx.lineTo(w / 2, wh);
        wfCtx.stroke();
        wfCtx.restore();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isCollapsed, colorMapId, connected, spectrumEnabled, latestSpectrumRef, waterfallHistoryRef]);

  const freqAxisContent = (() => {
    const data = latestSpectrumRef.current;
    if (!data || !data.span || !data.centerFreq) return null;
    const ticks = 5;
    const centerIdx = Math.floor(ticks / 2);
    const scale = data.name === "FT-710" ? FT710_SPAN_SCALE : 1.0;
    return (
      <div className="relative h-6 select-none">
        {Array.from({ length: ticks }, (_, i) => {
          const frac = i / (ticks - 1);
          const hz = data.centerFreq + (frac - 0.5) * data.span * scale;
          const isCenter = i === centerIdx;
          return (
            <span
              key={i}
              className={`absolute -translate-x-1/2 ${isCenter ? "text-[0.625rem] font-bold text-gray-200" : "text-[0.5rem] text-gray-400"}`}
              style={{ left: `${frac * 100}%` }}
            >
              {freqLabel(hz)}
            </span>
          );
        })}
      </div>
    );
  })();

  const headerActions = (
    <button
      onClick={e => { e.stopPropagation(); setIsSettingsOpen(true); }}
      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors mr-1"
      title="Spectrum scope settings"
    >
      <Settings size={13} />
    </button>
  );

  const settingsModal = isSettingsOpen && (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={() => setIsSettingsOpen(false)}
    >
      <div
        className="bg-[#151619] w-full max-w-sm rounded-2xl border border-[#2a2b2e] shadow-2xl overflow-hidden mt-16"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <Activity size={18} />
            </div>
            <h2 className="text-sm font-bold tracking-tight uppercase italic">Spectrum Settings</h2>
          </div>
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-2 hover:bg-[#2a2b2e] rounded-xl text-[#8e9299] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Source selector */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Spectrum Source</label>
            <div className="grid grid-cols-3 gap-1 bg-[#0a0a0a] rounded-lg p-1 border border-[#2a2b2e]">
              {(["hamlib", "ft4222", "iq"] as const).map(src => (
                <button
                  key={src}
                  onClick={() => {
                    const next = { ...spectrumSettings, source: src };
                    setSpectrumSettings(next);
                    socket?.emit("save-settings", { spectrumSettings: next });
                  }}
                  className={`py-1.5 px-2 rounded text-[0.625rem] font-semibold transition-colors ${
                    spectrumSettings.source === src
                      ? "bg-emerald-600 text-white"
                      : "text-[#8e9299] hover:text-[#e0e0e0]"
                  }`}
                >
                  {src === "hamlib" ? "Hamlib UDP" : src === "ft4222" ? "FT-710 via USB" : "Audio I/Q"}
                </button>
              ))}
            </div>
          </div>

          {/* Enable / disable */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-[#e0e0e0]">Enable Spectrum Scope</div>
              <div className="text-[0.625rem] text-[#8e9299] mt-0.5">
                {spectrumSettings.source === "hamlib"
                  ? "Receives spectrum data via rigctld UDP multicast"
                  : spectrumSettings.source === "ft4222"
                  ? "Reads spectrum via FT4222 USB-SPI bridge"
                  : "Captures a stereo I/Q signal via a USB audio interface"}
              </div>
            </div>
            <button
              onClick={() => {
                const next = { ...spectrumSettings, enabled: !spectrumSettings.enabled };
                setSpectrumSettings(next);
                socket?.emit("save-settings", { spectrumSettings: next });
              }}
              className={`w-10 h-5 rounded-full transition-colors relative ${spectrumSettings.enabled ? "bg-emerald-500" : "bg-[#2a2b2e]"}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${spectrumSettings.enabled ? "left-5.5" : "left-0.5"}`} />
            </button>
          </div>

          {/* Hamlib: multicast config */}
          {spectrumSettings.source === "hamlib" && spectrumSettings.enabled && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-[#e0e0e0] shrink-0">Multicast Address</label>
                <input
                  type="text"
                  value={spectrumSettings.multicastAddr}
                  onChange={e => setSpectrumSettings(prev => ({ ...prev, multicastAddr: e.target.value }))}
                  onBlur={() => socket?.emit("save-settings", { spectrumSettings })}
                  className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-xs text-[#e0e0e0] w-36 focus:outline-none focus:border-emerald-500 transition-all"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs text-[#e0e0e0] shrink-0">Multicast Port</label>
                <input
                  type="number"
                  value={spectrumSettings.multicastPort}
                  onChange={e => setSpectrumSettings(prev => ({ ...prev, multicastPort: Number(e.target.value) }))}
                  onBlur={() => socket?.emit("save-settings", { spectrumSettings })}
                  className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-xs text-[#e0e0e0] w-24 focus:outline-none focus:border-emerald-500 transition-all"
                />
              </div>
            </div>
          )}

          {/* FT4222: status indicator + span control */}
          {spectrumSettings.source === "ft4222" && spectrumSettings.enabled && (
            <div className="rounded-lg bg-[#1a1b1e] border border-[#2a2b2e] p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${yaesuStatus.running ? "bg-emerald-400" : "bg-gray-600"}`} />
                <span className="text-xs text-[#e0e0e0]">
                  {yaesuStatus.running ? "Reader running" : "Reader stopped"}
                </span>
              </div>
              {yaesuStatus.error && (
                <div className="text-[0.625rem] text-red-400 leading-relaxed mt-1">{yaesuStatus.error}</div>
              )}
            </div>
          )}

          {/* FT4222: span selector */}
          {spectrumSettings.source === "ft4222" && (() => {
            const SPAN_OPTIONS = [
              { index: 0, label: "1 kHz" },
              { index: 1, label: "2 kHz" },
              { index: 2, label: "5 kHz" },
              { index: 3, label: "10 kHz" },
              { index: 4, label: "20 kHz" },
              { index: 5, label: "50 kHz" },
              { index: 6, label: "100 kHz" },
              { index: 7, label: "200 kHz" },
              { index: 8, label: "500 kHz" },
              { index: 9, label: "1 MHz" },
            ];
            const SPAN_HZ_TABLE = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
            const liveSpanHz = latestSpectrumRef.current?.span ?? null;
            const liveSpanIndex = liveSpanHz !== null ? SPAN_HZ_TABLE.indexOf(liveSpanHz) : -1;
            const displayedSpanIndex = optimisticSpanIndex !== null
              ? optimisticSpanIndex
              : liveSpanIndex >= 0
                ? liveSpanIndex
                : spectrumSettings.ft4222SpanIndex;
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Scope Span</label>
                  {liveSpanHz !== null && (
                    <span className="text-[0.625rem] text-emerald-400 font-mono">
                      Live: {liveSpanHz >= 1_000_000 ? `${liveSpanHz / 1_000_000} MHz` : `${liveSpanHz / 1000} kHz`}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {SPAN_OPTIONS.map(({ index, label }) => (
                    <button
                      key={index}
                      onClick={() => {
                        const next = { ...spectrumSettings, ft4222SpanIndex: index };
                        setSpectrumSettings(next);
                        socket?.emit("save-settings", { spectrumSettings: next });
                        socket?.emit("set-ft710-span", index);
                        if (optimisticTimerRef.current !== null) clearTimeout(optimisticTimerRef.current);
                        setOptimisticSpanIndex(index);
                        optimisticTimerRef.current = setTimeout(() => {
                          setOptimisticSpanIndex(null);
                          optimisticTimerRef.current = null;
                        }, 2000);
                      }}
                      className={`py-1.5 px-1 rounded text-[0.5625rem] font-semibold transition-colors ${
                        displayedSpanIndex === index
                          ? "bg-emerald-600 text-white"
                          : "bg-[#0a0a0a] border border-[#2a2b2e] text-[#8e9299] hover:text-[#e0e0e0]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* I/Q: status indicator */}
          {spectrumSettings.source === "iq" && spectrumSettings.enabled && (
            <div className="rounded-lg bg-[#1a1b1e] border border-[#2a2b2e] p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${iqStatus.running ? "bg-emerald-400" : "bg-gray-600"}`} />
                <span className="text-xs text-[#e0e0e0]">
                  {iqStatus.running ? "Capture running" : "Capture stopped"}
                </span>
              </div>
              {iqStatus.error && (
                <div className="text-[0.625rem] text-red-400 leading-relaxed mt-1">{iqStatus.error}</div>
              )}
            </div>
          )}

          {/* I/Q: device, sample rate, swap */}
          {spectrumSettings.source === "iq" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Capture Device</label>
                <select
                  value={spectrumSettings.iqAudioDevice}
                  onFocus={() => socket?.emit("get-audio-devices")}
                  onChange={e => {
                    const next = { ...spectrumSettings, iqAudioDevice: e.target.value };
                    setSpectrumSettings(next);
                    socket?.emit("save-settings", { spectrumSettings: next });
                  }}
                  className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-3 py-2 text-xs text-[#e0e0e0] focus:outline-none focus:border-emerald-500 transition-all"
                >
                  <option value="">Select capture device</option>
                  {iqInputDevices.map(d => {
                    const value = JSON.stringify({ name: d.name, hostAPIName: d.hostAPIName });
                    const rateK = d.defaultSampleRate / 1000;
                    const rate = d.defaultSampleRate ? `${rateK === Math.floor(rateK) ? rateK : rateK.toFixed(1)}k` : "";
                    const label = `${d.name}${d.hostAPIName || rate ? ` [${[d.hostAPIName, rate].filter(Boolean).join(", ")}]` : ""}`;
                    return <option key={d.altName} value={value}>{label}</option>;
                  })}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Sample Rate (Span)</label>
                <div className="grid grid-cols-3 gap-1">
                  {IQ_SAMPLE_RATE_OPTIONS.map(rate => (
                    <button
                      key={rate}
                      onClick={() => {
                        const next = { ...spectrumSettings, iqSampleRate: rate };
                        setSpectrumSettings(next);
                        socket?.emit("save-settings", { spectrumSettings: next });
                      }}
                      className={`py-1.5 px-1 rounded text-[0.5625rem] font-semibold transition-colors ${
                        spectrumSettings.iqSampleRate === rate
                          ? "bg-emerald-600 text-white"
                          : "bg-[#0a0a0a] border border-[#2a2b2e] text-[#8e9299] hover:text-[#e0e0e0]"
                      }`}
                    >
                      {rate / 1000} kHz
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#e0e0e0]">Swap I/Q</div>
                  <div className="text-[0.625rem] text-[#8e9299] mt-0.5">Fixes a mirrored/reversed-sideband display</div>
                </div>
                <button
                  onClick={() => {
                    const next = { ...spectrumSettings, iqSwapChannels: !spectrumSettings.iqSwapChannels };
                    setSpectrumSettings(next);
                    socket?.emit("save-settings", { spectrumSettings: next });
                  }}
                  className={`w-10 h-5 rounded-full transition-colors relative ${spectrumSettings.iqSwapChannels ? "bg-emerald-500" : "bg-[#2a2b2e]"}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${spectrumSettings.iqSwapChannels ? "left-5.5" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          )}

          {/* Color map */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Color Map</label>
            <select
              value={colorMapId}
              onChange={e => { setColorMapId(e.target.value); lsSet(lsKey("colormap"), e.target.value); }}
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-all"
            >
              {COLORMAP_NAMES.map(cm => (
                <option key={cm.id} value={cm.id}>{cm.label}</option>
              ))}
            </select>
          </div>

          {/* Floor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Noise Floor</label>
              <span className="text-xs font-mono text-[#8e9299]">
                {autoLevel.autoFloor ? `${Math.round(autoLevel.displayFloor)} dBm (auto)` : `${autoLevel.floor} dBm`}
              </span>
            </div>
            <input
              type="range" min={-160} max={-10} step={5}
              value={autoLevel.autoFloor ? Math.round(autoLevel.displayFloor) : autoLevel.floor}
              disabled={autoLevel.autoFloor}
              onChange={e => autoLevel.setFloor(Number(e.target.value))}
              className="w-full accent-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <label className="flex items-center gap-2 text-[0.625rem] text-[#8e9299]">
              <input
                type="checkbox"
                checked={autoLevel.autoFloor}
                onChange={e => autoLevel.setAutoFloor(e.target.checked)}
              />
              Auto Floor
            </label>
          </div>

          {/* Ceiling */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Ceiling</label>
              <span className="text-xs font-mono text-[#8e9299]">
                {autoLevel.autoCeiling ? `${Math.round(autoLevel.displayCeiling)} dBm (auto)` : `${autoLevel.ceiling} dBm`}
              </span>
            </div>
            <input
              type="range" min={-100} max={50} step={5}
              value={autoLevel.autoCeiling ? Math.round(autoLevel.displayCeiling) : autoLevel.ceiling}
              disabled={autoLevel.autoCeiling}
              onChange={e => autoLevel.setCeiling(Number(e.target.value))}
              className="w-full accent-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <label className="flex items-center gap-2 text-[0.625rem] text-[#8e9299]">
              <input
                type="checkbox"
                checked={autoLevel.autoCeiling}
                onChange={e => autoLevel.setAutoCeiling(e.target.checked)}
              />
              Auto Ceiling
            </label>
          </div>

          <button
            onClick={() => autoLevel.resetAutoScale()}
            disabled={!autoLevel.autoFloor && !autoLevel.autoCeiling}
            className="flex items-center gap-1.5 text-[0.625rem] text-[#8e9299] hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear tracked auto-scale estimates and re-converge from scratch"
          >
            <RefreshCw size={11} /> Reset Auto-Scale
          </button>

          {/* Requirements */}
          <div className="rounded-lg bg-[#1a1b1e] border border-[#2a2b2e] p-3 text-[0.625rem] text-[#8e9299] space-y-1 leading-relaxed">
            <div className="font-semibold text-[#b0b3b8]">Requirements</div>
            {spectrumSettings.source === "hamlib" ? (
              <>
                <div>• Radio with CI-V spectrum scope: IC-7300, IC-7610, IC-705, IC-9700</div>
                <div>• Serial speed must be 115200 baud for spectrum data</div>
                <div>• CI-V Transceive must remain OFF on the radio</div>
                <div>• CI-V USB Echo must be ON in radio settings</div>
              </>
            ) : spectrumSettings.source === "ft4222" ? (
              <>
                <div>• Yaesu FT-710 connected via USB</div>
                <div>• libft4222 must be installed (FTDI FT4222 driver)</div>
                <div>• <a href="https://github.com/jbdubbs/Rig-Control-Web/blob/main/docs/ft4222-spectrum-setup.md" target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300">See wiki for setup instructions</a></div>
              </>
            ) : (
              <>
                <div>• A radio with a baseband I/Q output (tested: Xiegu G90) wired to a stereo USB audio interface's Line-In — never Mic-In, which can carry bias voltage that may stress the radio's low-level output</div>
                <div>• The displayed span equals the selected sample rate, but a radio's real usable I/Q bandwidth is fixed by its own hardware — sampling faster doesn't create more real spectrum, only more headroom against aliasing</div>
                <div>• If the displayed spectrum is mirrored (a signal appears on the wrong side of center), toggle Swap I/Q</div>
                <div>• <a href="https://github.com/jbdubbs/Rig-Control-Web/blob/main/docs/iq-spectrum-setup.md" target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300">See wiki for setup instructions</a></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderBody = () => {
    if (!spectrumEnabled) {
      return (
        <div className="flex items-center justify-center h-24 text-gray-400 text-xs">
          Spectrum Scope is disabled. Enable it in the panel settings.
        </div>
      );
    }
    if (spectrumSettings.source === "hamlib" && !spectrumSupported && connected) {
      return (
        <div className="flex items-center justify-center h-24 text-gray-400 text-xs">
          This radio does not report spectrum data via Hamlib.
        </div>
      );
    }
    if (!connected) {
      return (
        <div className="flex items-center justify-center h-24 text-gray-400 text-xs">
          Not connected to rig.
        </div>
      );
    }
    const canvasProps = {
      onClick: handleCanvasClick,
      onMouseMove: handleCanvasMouseMove,
      onMouseLeave: handleCanvasMouseLeave,
      style: { cursor: "crosshair" } as React.CSSProperties,
    };
    return (
      <div ref={canvasContainerRef} className="flex flex-col gap-0 relative">
        {cursorLineX !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-px bg-white/30"
            style={{ left: cursorLineX, height: spectrumHeight + waterfallHeight }}
          />
        )}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 px-1.5 py-0.5 rounded bg-black/80 text-[0.6rem] text-emerald-300 whitespace-nowrap"
            style={{ left: tooltip.x + 8, top: tooltip.y - 18 }}
          >
            {tooltip.label}
          </div>
        )}
        <canvas
          ref={spectrumCanvasRef}
          width={600}
          height={spectrumHeight}
          className="w-full"
          style={{ ...canvasProps.style, height: spectrumHeight }}
          onClick={canvasProps.onClick}
          onMouseMove={canvasProps.onMouseMove}
          onMouseLeave={canvasProps.onMouseLeave}
        />
        <canvas
          ref={waterfallCanvasRef}
          width={600}
          height={waterfallHeight}
          className="w-full"
          style={{ ...canvasProps.style, height: waterfallHeight }}
          onClick={canvasProps.onClick}
          onMouseMove={canvasProps.onMouseMove}
          onMouseLeave={canvasProps.onMouseLeave}
        />
        {freqAxisContent}
      </div>
    );
  };

  return (
    <>
      {settingsModal}
      <PanelChrome
        title="Spectrum Scope"
        icon={<Activity size={14} />}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        headerActions={headerActions}
        headerSize="sm"
        bodyClassName="p-0"
      >
        {renderBody()}
      </PanelChrome>
    </>
  );
}
