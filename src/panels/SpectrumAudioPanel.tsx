import React, { useRef, useEffect, useState, useCallback } from "react";
import { RefreshCw, Settings, Waves, X } from "lucide-react";
import PanelChrome from "../components/PanelChrome";
import { COLORMAPS, COLORMAP_NAMES } from "../utils/spectrumColors";
import { scrollCanvasDown } from "../utils";
import { lsGet, lsSet, drawDbGridLines, drawFilledSpectrumLine, paintWaterfallRow, paintWaterfallFull } from "../utils/spectrumCanvas";
import { useAutoLevel } from "../hooks/useAutoLevel";
import type { AutoLevelOptions } from "../utils/autoLevel";
import { averagePowerFrames, binAveragePower, dbToPower, flattenLinearDetrend } from "../utils/wsjtxWaterfall";

const DEFAULT_HEIGHT = 200;
const SPECTRUM_RATIO = 0.3;
const FLOOR_DEFAULT = -55;
const CEILING_DEFAULT = 0;
const WATERFALL_MAX_LINES = 300;
const LS_PREFIX = "spectrum-audio-";

// "WSJT-X" waterfall mode fixed preset — mimics WSJT-X's default Wide Graph
// settings (Bins/Pixel 4, N Avg 2, Flatten on). WSJTX_MEASUREMENT_INTERVAL_MS
// approximates WSJT-X's own per-half-symbol raw-spectrum cadence
// (widgets/widegraph.cpp's dataSink2() is called once per half-symbol and
// averages N Avg calls together before pushing a row). For FT8 — the mode
// this was calibrated against — symbol period is 0.16s, so a half-symbol is
// 80ms; N Avg 2 × 80ms ≈ 160ms/row (~6 rows/sec) matches real WSJT-X's FT8
// waterfall speed, versus this panel's normal one-row-per-rAF-tick
// (~60/sec) "Live" behavior. Other WSJT-X modes (FT4, JT65, MSK144, ...)
// use a different symbol period and would imply a different interval —
// this is deliberately tuned to FT8 specifically, not a universal constant.
const WSJTX_BINS_PER_PIXEL = 4;
const WSJTX_N_AVG = 2;
const WSJTX_MEASUREMENT_INTERVAL_MS = 80;

// Native frequency resolution (Hz/bin = sampleRate / fftSize) is what
// actually limits waterfall detail, independent of Bins/Pixel. Live mode
// keeps the original 4096 (fast ~85ms time response). WSJT-X mode raises
// this to the Web Audio spec's max (32768) — an 8x finer native resolution
// (~1.46 Hz/bin @ 48kHz, versus WSJT-X's own ~0.73 Hz/bin) — accepting a
// ~683ms analysis window in exchange, a trade-off only worth paying in the
// slower-scrolling WSJT-X mode.
const LIVE_FFT_SIZE = 4096;
const WSJTX_FFT_SIZE = 32768;

// autoLevel.ts's default floorMarginDb (5) renders the noise floor 5dB
// *above* the bottom edge — appropriate when the goal is "don't clip the
// noise off-screen." For this panel's AnalyserNode-fed waterfall, visual
// tuning against real audio found the opposite goal reads better: the
// default committed floor sits ~15dB lower than looks right (e.g. -85dBFS
// vs. an optimal ~-70dBFS), spending most of the color gradient on noise
// texture instead of real signal. A negative margin renders the floor
// *above* the measured p10 trend by the same amount, intentionally
// clipping the deepest noise to the bottom color band for more contrast on
// real signals. Empirically derived; audio-source-only (see
// SOURCE_ALGORITHM_OPTIONS in SpectrumHamlibPanel.tsx for the analogous
// per-source override on the other spectrum sources).
const AUDIO_ALGORITHM_OPTIONS: Partial<AutoLevelOptions> = {
  floorMarginDb: -10,
};

const BW_OPTIONS: { label: string; value: string }[] = [
  { label: "Automatic", value: "auto" },
  { label: "300 Hz", value: "300" },
  { label: "500 Hz", value: "500" },
  { label: "750 Hz", value: "750" },
  { label: "1.0 kHz", value: "1000" },
  { label: "1.5 kHz", value: "1500" },
  { label: "2.0 kHz", value: "2000" },
  { label: "2.7 kHz", value: "2700" },
  { label: "3.0 kHz", value: "3000" },
  { label: "3.2 kHz", value: "3200" },
  { label: "4.0 kHz", value: "4000" },
  { label: "6.0 kHz", value: "6000" },
  { label: "8.0 kHz", value: "8000" },
  { label: "10.0 kHz", value: "10000" },
  { label: "12.0 kHz", value: "12000" },
  { label: "15.0 kHz", value: "15000" },
];

interface Props {
  analyserNodeRef: React.MutableRefObject<AnalyserNode | null>;
  audioStatus: "playing" | "stopped" | "cooldown";
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  heightPx?: number;
  bandwidth?: number;
  mode?: string;
  callsign?: string;
  /** Defaults to "compact". */
  variant?: "compact" | "phone";
}

export function computeDisplayBandwidth(bandwidth: number, mode: string, maxHz: number): number {
  const isCw = mode === "CW" || mode === "CWR" || mode === "CW-R";
  if (isCw) return Math.min(1400, maxHz);
  const bw = bandwidth === 0 ? 3000 : bandwidth;
  return Math.min(bw + 300, maxHz);
}

function SpectrumAudioPanel({
  analyserNodeRef,
  audioStatus,
  isCollapsed,
  setIsCollapsed,
  heightPx = DEFAULT_HEIGHT,
  bandwidth = 0,
  mode = "",
  callsign = "",
  variant = "compact",
}: Props) {
  const lsKey = useCallback(
    (key: string) => (callsign ? `${callsign.toUpperCase()}:${LS_PREFIX}${key}` : `${LS_PREFIX}${key}`),
    [callsign]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const waterfallLinesRef = useRef<Float32Array[]>([]);
  const freqDataBufRef = useRef<Float32Array | null>(null);
  const prevDisplayBwRef = useRef<number>(0);
  const prevWaterfallModeRef = useRef<string>("live");

  // "wsjtx" mode accumulators: power-domain sum for the in-progress ~500ms
  // measurement window, plus up to WSJTX_N_AVG completed measurements
  // awaiting averaging into the next displayed row.
  const powerAccumRef = useRef<Float64Array | null>(null);
  const powerAccumCountRef = useRef(0);
  const intervalStartMsRef = useRef(0);
  const measurementsRef = useRef<Float32Array[]>([]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [colorMapId, setColorMapId] = useState(() => lsGet(lsKey("colormap"), "classic"));
  const [bwOverride, setBwOverride] = useState<string>(() => lsGet(lsKey("bwOverride"), "auto"));
  const [waterfallMode, setWaterfallMode] = useState<"live" | "wsjtx">(
    () => (lsGet(lsKey("waterfallMode"), "live") === "wsjtx" ? "wsjtx" : "live")
  );
  // CSS width of the canvases' container, in CSS px — combined with
  // devicePixelRatio to size the canvas bitmaps for crisp rendering at
  // whatever width the panel actually renders at, instead of a fixed
  // buffer stretched (and blurred) to fit. 600 is just a sane pre-measure
  // fallback so the first paint isn't 0-width.
  const [canvasCssWidth, setCanvasCssWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setCanvasCssWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const autoLevel = useAutoLevel({
    lsKey,
    sourceSuffix: "",
    manualFloorDefault: FLOOR_DEFAULT,
    manualCeilingDefault: CEILING_DEFAULT,
    autoFloorDefault: true,
    autoCeilingDefault: true,
    algorithmOptions: AUDIO_ALGORITHM_OPTIONS,
  });
  // See SpectrumHamlibPanel.tsx for why the draw loop reads through a ref
  // rather than depending on floor/ceiling/auto-toggle state directly.
  const autoLevelRef = useRef(autoLevel);
  autoLevelRef.current = autoLevel;

  const spectrumHeight = Math.floor(heightPx * SPECTRUM_RATIO);
  const waterfallHeight = heightPx - spectrumHeight - 20;

  const sampleRate = analyserNodeRef.current?.context.sampleRate ?? 48000;
  const maxHz = sampleRate / 2;
  const autoBw = computeDisplayBandwidth(bandwidth, mode, maxHz);
  const displayBandwidth = bwOverride === "auto" ? autoBw : Math.min(Number(bwOverride), maxHz);

  useEffect(() => {
    if (isCollapsed || audioStatus !== "playing") return;

    if (displayBandwidth !== prevDisplayBwRef.current || waterfallMode !== prevWaterfallModeRef.current) {
      waterfallLinesRef.current = [];
      prevDisplayBwRef.current = displayBandwidth;
      prevWaterfallModeRef.current = waterfallMode;
      powerAccumRef.current = null;
      powerAccumCountRef.current = 0;
      measurementsRef.current = [];
    }

    const colorMap = COLORMAPS[colorMapId] ?? COLORMAPS.classic;
    // Tracks whether this effect run has done its one-time full waterfall repaint yet —
    // resets (via effect re-run) whenever a dependency below changes, so a bandwidth/mode
    // change or panel resize shows the complete, correctly-colored history immediately
    // instead of only affecting rows painted from that point forward.
    let wfPainted = false;
    let fftSizeApplied = false;

    const draw = () => {
      const analyser = analyserNodeRef.current;
      const specCanvas = spectrumCanvasRef.current;
      const wfCanvas = waterfallCanvasRef.current;

      if (!analyser || !specCanvas || !wfCanvas) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      if (!fftSizeApplied) {
        // Reassigning fftSize clears the AnalyserNode's internal buffer, so this
        // must run at most once per effect run (mode/bandwidth change), never
        // per-tick.
        const desiredFftSize = waterfallMode === "wsjtx" ? WSJTX_FFT_SIZE : LIVE_FFT_SIZE;
        if (analyser.fftSize !== desiredFftSize) analyser.fftSize = desiredFftSize;
        fftSizeApplied = true;
      }

      const totalBins = analyser.frequencyBinCount;
      const sr = analyser.context.sampleRate;
      const nyquist = sr / 2;
      const overrideVal = bwOverride === "auto" ? null : Math.min(Number(bwOverride), nyquist);
      const displayBw = overrideVal ?? computeDisplayBandwidth(bandwidth, mode, nyquist);
      const endBin = Math.min(totalBins, Math.round((displayBw / nyquist) * totalBins));

      if (!freqDataBufRef.current || freqDataBufRef.current.length !== totalBins) {
        freqDataBufRef.current = new Float32Array(totalBins);
      }
      analyser.getFloatFrequencyData(freqDataBufRef.current);
      const freqData = freqDataBufRef.current;

      // frame/length actually handed to the paint helpers below. In "live" mode this is
      // just the raw per-tick freqData (unchanged behavior). In "wsjtx" mode a new frame
      // only becomes available once per ~160ms (WSJTX_N_AVG measurements, each accumulated
      // over WSJTX_MEASUREMENT_INTERVAL_MS) — most ticks have nothing new to paint.
      let displayFrame: ArrayLike<number> | null = null;
      let effectiveLength = endBin;

      if (waterfallMode === "wsjtx") {
        if (!powerAccumRef.current || powerAccumRef.current.length !== endBin) {
          powerAccumRef.current = new Float64Array(endBin);
          powerAccumCountRef.current = 0;
          intervalStartMsRef.current = performance.now();
          measurementsRef.current = [];
        }
        const accum = powerAccumRef.current;
        for (let i = 0; i < endBin; i++) accum[i] += dbToPower(freqData[i]);
        powerAccumCountRef.current += 1;

        const now = performance.now();
        if (now - intervalStartMsRef.current >= WSJTX_MEASUREMENT_INTERVAL_MS) {
          const count = powerAccumCountRef.current || 1;
          const measurement = new Float32Array(endBin);
          for (let i = 0; i < endBin; i++) measurement[i] = 10 * Math.log10(Math.max(accum[i] / count, 1e-300));
          measurementsRef.current = [...measurementsRef.current, measurement].slice(-WSJTX_N_AVG);

          accum.fill(0);
          powerAccumCountRef.current = 0;
          intervalStartMsRef.current = now;

          if (measurementsRef.current.length >= WSJTX_N_AVG) {
            const avgDb = averagePowerFrames(measurementsRef.current);
            const binned = binAveragePower(avgDb, endBin, WSJTX_BINS_PER_PIXEL);
            displayFrame = flattenLinearDetrend(binned);
            effectiveLength = displayFrame.length;
            measurementsRef.current = [];
          }
        }
      } else {
        displayFrame = freqData;
        effectiveLength = endBin;
      }

      if (!displayFrame) {
        // Still accumulating this measurement/row — nothing new to paint this tick.
        animFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      waterfallLinesRef.current = [
        waterfallMode === "wsjtx" ? (displayFrame as Float32Array) : freqData.slice(),
        ...waterfallLinesRef.current,
      ].slice(0, WATERFALL_MAX_LINES);

      autoLevelRef.current.sampleFrame(
        waterfallMode === "wsjtx" ? displayFrame : freqData.subarray(0, endBin),
        performance.now()
      );
      const effFloor = autoLevelRef.current.getEffectiveFloor();
      const effCeiling = autoLevelRef.current.getEffectiveCeiling();

      const w = specCanvas.width;

      // --- Spectrum line ---
      const sCtx = specCanvas.getContext("2d");
      if (sCtx) {
        const sh = specCanvas.height;
        sCtx.clearRect(0, 0, w, sh);

        drawDbGridLines(sCtx, w, sh, effFloor, effCeiling);

        const step = effectiveLength / w;
        const frame = displayFrame;
        drawFilledSpectrumLine(
          sCtx, w, sh, w,
          col => col, col => frame[Math.min(effectiveLength - 1, Math.floor(col * step))],
          effFloor, effCeiling,
          "#3b82f6", "rgba(59,130,246,0.25)"
        );
      }

      // --- Waterfall ---
      const wfCtx = wfCanvas.getContext("2d");
      if (wfCtx) {
        const wh = wfCanvas.height;
        const lines = waterfallLinesRef.current;

        const toDb = (raw: number) => raw;

        if (!wfPainted) {
          // One-time full repaint for this effect run — a fresh mount, colorMapId/bandwidth
          // change, or panel resize should show the complete, correctly-colored history
          // immediately.
          paintWaterfallFull(wfCtx, w, wh, lines, effectiveLength, toDb, effFloor, effCeiling, colorMap);
          wfPainted = true;
        } else {
          // Steady state: scroll the existing image down one row and paint only the newest
          // row — O(width) instead of rebuilding the full width*height ImageData every frame
          // ("live" mode pushes a new row on every rAF tick, so this is its hot path;
          // "wsjtx" mode reaches here only once per new averaged row).
          const newest = lines[0];
          const rowBuf = new Uint32Array(w);
          paintWaterfallRow(rowBuf, newest, effectiveLength, w, toDb, effFloor, effCeiling, colorMap);
          scrollCanvasDown(wfCtx, w, wh, rowBuf);
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isCollapsed, audioStatus, colorMapId, analyserNodeRef, bandwidth, mode, displayBandwidth, bwOverride, waterfallMode, spectrumHeight, waterfallHeight, canvasCssWidth]);

  const freqAxisContent = (
    <div className="relative h-5 text-[0.5rem] text-gray-400 select-none">
      {[0, 0.25, 0.5, 0.75, 1.0].map((frac, i) => {
        const hz = frac * displayBandwidth;
        const label = hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
        return (
          <span
            key={i}
            className="absolute -translate-x-1/2"
            style={{ left: `${frac * 100}%` }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );

  const headerActions = (
    <button
      onClick={e => { e.stopPropagation(); setIsSettingsOpen(true); }}
      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors mr-1"
      title="Waterfall settings"
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
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Waves size={18} />
            </div>
            <h2 className="text-sm font-bold tracking-tight uppercase italic">Audio Waterfall Settings</h2>
          </div>
          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-2 hover:bg-[#2a2b2e] rounded-xl text-[#8e9299] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Waterfall style */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Waterfall Style</label>
            <div className="grid grid-cols-2 gap-1 bg-[#0a0a0a] rounded-lg p-1 border border-[#2a2b2e]">
              {(["live", "wsjtx"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => {
                    setWaterfallMode(m);
                    lsSet(lsKey("waterfallMode"), m);
                    waterfallLinesRef.current = [];
                  }}
                  className={`py-1.5 px-2 rounded text-[0.625rem] font-semibold transition-colors ${
                    waterfallMode === m
                      ? "bg-emerald-600 text-white"
                      : "text-[#8e9299] hover:text-[#e0e0e0]"
                  }`}
                >
                  {m === "live" ? "Live" : "WSJT-X"}
                </button>
              ))}
            </div>
            {waterfallMode === "wsjtx" && (
              <p className="text-[0.5rem] text-[#4a4b4e] uppercase font-bold">
                Mimics WSJT-X's default FT8 Wide Graph: Bins/Pixel 4, N Avg 2, Flatten on — scrolls ~6 rows/sec
              </p>
            )}
          </div>

          {/* Bandwidth */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Display Bandwidth</label>
            <select
              value={bwOverride}
              onChange={e => {
                setBwOverride(e.target.value);
                lsSet(lsKey("bwOverride"), e.target.value);
                waterfallLinesRef.current = [];
              }}
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
            >
              {BW_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {bwOverride === "auto" && (
              <p className="text-[0.5rem] text-[#4a4b4e] uppercase font-bold">
                Currently {displayBandwidth >= 1000 ? `${(displayBandwidth / 1000).toFixed(1)} kHz` : `${displayBandwidth} Hz`}
                {mode === "CW" || mode === "CWR" ? " (CW ×2)" : ""}
              </p>
            )}
          </div>

          {/* Color map */}
          <div className="space-y-2">
            <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Color Map</label>
            <select
              value={colorMapId}
              onChange={e => { setColorMapId(e.target.value); lsSet(lsKey("colormap"), e.target.value); }}
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
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
                {autoLevel.autoFloor ? `${Math.round(autoLevel.displayFloor)} dBFS (auto)` : `${autoLevel.floor} dBFS`}
              </span>
            </div>
            <input
              type="range" min={-160} max={-20} step={5}
              value={autoLevel.autoFloor ? Math.round(autoLevel.displayFloor) : autoLevel.floor}
              disabled={autoLevel.autoFloor}
              onChange={e => autoLevel.setFloor(Number(e.target.value))}
              className="w-full accent-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
                {autoLevel.autoCeiling ? `${Math.round(autoLevel.displayCeiling)} dBFS (auto)` : `${autoLevel.ceiling} dBFS`}
              </span>
            </div>
            <input
              type="range" min={-80} max={0} step={5}
              value={autoLevel.autoCeiling ? Math.round(autoLevel.displayCeiling) : autoLevel.ceiling}
              disabled={autoLevel.autoCeiling}
              onChange={e => autoLevel.setCeiling(Number(e.target.value))}
              className="w-full accent-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
            className="flex items-center gap-1.5 text-[0.625rem] text-[#8e9299] hover:text-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Clear tracked auto-scale estimates and re-converge from scratch"
          >
            <RefreshCw size={11} /> Reset Auto-Scale
          </button>
        </div>
      </div>
    </div>
  );

  const renderBody = () => {
    if (audioStatus !== "playing") {
      return (
        <div className="flex items-center justify-center h-24 text-gray-400 text-xs">
          Start audio to see the waterfall.
        </div>
      );
    }
    const dpr = window.devicePixelRatio || 1;
    const canvasPxWidth = Math.round(canvasCssWidth * dpr);
    return (
      <div ref={containerRef} className="flex flex-col gap-0">
        <canvas
          ref={spectrumCanvasRef}
          width={canvasPxWidth}
          height={Math.round(spectrumHeight * dpr)}
          className="w-full"
          style={{ height: spectrumHeight }}
        />
        <canvas
          ref={waterfallCanvasRef}
          width={canvasPxWidth}
          height={Math.round(waterfallHeight * dpr)}
          className="w-full"
          style={{ height: waterfallHeight }}
        />
        {freqAxisContent}
      </div>
    );
  };

  return (
    <>
      {settingsModal}
      <PanelChrome
        title="Audio Waterfall"
        icon={<Waves size={12} />}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        headerActions={headerActions}
        headerSize={variant === "phone" ? "md" : "sm"}
        bodyClassName="p-0"
      >
        {renderBody()}
      </PanelChrome>
    </>
  );
}

// bandwidth/mode are derived primitives (compare by value) and analyserNodeRef is a stable
// ref, so none of this panel's props actually change on the frequent rig-status polling tick
// that doesn't touch bandwidth/mode — memoizing avoids re-rendering it then.
export default React.memo(SpectrumAudioPanel);
