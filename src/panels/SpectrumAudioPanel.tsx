import React, { useRef, useEffect, useState, useCallback } from "react";
import { RefreshCw, Settings, Waves, X } from "lucide-react";
import PanelChrome from "../components/PanelChrome";
import { COLORMAPS, COLORMAP_NAMES, amplitudeToPixel } from "../utils/spectrumColors";
import { scrollCanvasDown } from "../utils";
import { useAutoLevel } from "../hooks/useAutoLevel";
import type { AutoLevelOptions } from "../utils/autoLevel";

const DEFAULT_HEIGHT = 200;
const SPECTRUM_RATIO = 0.3;
const FLOOR_DEFAULT = -55;
const CEILING_DEFAULT = 0;
const WATERFALL_MAX_LINES = 300;
const LS_PREFIX = "spectrum-audio-";

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
}

export function computeDisplayBandwidth(bandwidth: number, mode: string, maxHz: number): number {
  const isCw = mode === "CW" || mode === "CWR" || mode === "CW-R";
  if (isCw) return Math.min(1400, maxHz);
  const bw = bandwidth === 0 ? 3000 : bandwidth;
  return Math.min(bw + 300, maxHz);
}

function lsGet(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
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
}: Props) {
  const lsKey = useCallback(
    (key: string) => (callsign ? `${callsign.toUpperCase()}:${LS_PREFIX}${key}` : `${LS_PREFIX}${key}`),
    [callsign]
  );
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const waterfallLinesRef = useRef<Float32Array[]>([]);
  const freqDataBufRef = useRef<Float32Array | null>(null);
  const prevDisplayBwRef = useRef<number>(0);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [colorMapId, setColorMapId] = useState(() => lsGet(lsKey("colormap"), "classic"));
  const [bwOverride, setBwOverride] = useState<string>(() => lsGet(lsKey("bwOverride"), "auto"));

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

    if (displayBandwidth !== prevDisplayBwRef.current) {
      waterfallLinesRef.current = [];
      prevDisplayBwRef.current = displayBandwidth;
    }

    const colorMap = COLORMAPS[colorMapId] ?? COLORMAPS.classic;
    // Tracks whether this effect run has done its one-time full waterfall repaint yet —
    // resets (via effect re-run) whenever a dependency below changes, so a bandwidth/mode
    // change or panel resize shows the complete, correctly-colored history immediately
    // instead of only affecting rows painted from that point forward.
    let wfPainted = false;

    const draw = () => {
      const analyser = analyserNodeRef.current;
      const specCanvas = spectrumCanvasRef.current;
      const wfCanvas = waterfallCanvasRef.current;

      if (!analyser || !specCanvas || !wfCanvas) {
        animFrameRef.current = requestAnimationFrame(draw);
        return;
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

      waterfallLinesRef.current = [
        freqData.slice(),
        ...waterfallLinesRef.current,
      ].slice(0, WATERFALL_MAX_LINES);

      autoLevelRef.current.sampleFrame(freqData.subarray(0, endBin), performance.now());
      const effFloor = autoLevelRef.current.getEffectiveFloor();
      const effCeiling = autoLevelRef.current.getEffectiveCeiling();

      const w = specCanvas.width;

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
        sCtx.strokeStyle = "#3b82f6";
        sCtx.fillStyle = "rgba(59,130,246,0.25)";
        sCtx.lineWidth = 1.5;

        const step = endBin / w;
        for (let col = 0; col < w; col++) {
          const binIdx = Math.min(endBin - 1, Math.floor(col * step));
          const dbfs = freqData[binIdx];
          const norm = Math.max(0, Math.min(1, (dbfs - effFloor) / (effCeiling - effFloor)));
          const y = sh - norm * sh;
          if (col === 0) {
            sCtx.moveTo(col, sh);
            sCtx.lineTo(col, y);
          } else {
            sCtx.lineTo(col, y);
          }
        }
        sCtx.lineTo(w, sh);
        sCtx.closePath();
        sCtx.fill();
        sCtx.stroke();
      }

      // --- Waterfall ---
      const wfCtx = wfCanvas.getContext("2d");
      if (wfCtx) {
        const wh = wfCanvas.height;
        const lines = waterfallLinesRef.current;

        if (!wfPainted) {
          // One-time full repaint for this effect run — a fresh mount, colorMapId/bandwidth
          // change, or panel resize should show the complete, correctly-colored history
          // immediately.
          const visibleLines = Math.min(lines.length, wh);
          const imageData = wfCtx.createImageData(w, wh);
          const buf32 = new Uint32Array(imageData.data.buffer);

          for (let row = 0; row < visibleLines; row++) {
            const line = lines[row];
            const step = endBin / w;
            for (let col = 0; col < w; col++) {
              const binIdx = Math.min(endBin - 1, Math.floor(col * step));
              const dbfs = line[binIdx];
              const norm = Math.max(0, Math.min(1, (dbfs - effFloor) / (effCeiling - effFloor)));
              buf32[row * w + col] = amplitudeToPixel(Math.round(norm * 255), 0, 255, colorMap);
            }
          }

          wfCtx.putImageData(imageData, 0, 0);
          wfPainted = true;
        } else {
          // Steady state: scroll the existing image down one row and paint only the newest
          // row — O(width) instead of rebuilding the full width*height ImageData every frame
          // (this file pushes a new row on every rAF tick, so this is the hot path).
          const newest = lines[0];
          const rowBuf = new Uint32Array(w);
          const step = endBin / w;
          for (let col = 0; col < w; col++) {
            const binIdx = Math.min(endBin - 1, Math.floor(col * step));
            const dbfs = newest[binIdx];
            const norm = Math.max(0, Math.min(1, (dbfs - effFloor) / (effCeiling - effFloor)));
            rowBuf[col] = amplitudeToPixel(Math.round(norm * 255), 0, 255, colorMap);
          }
          scrollCanvasDown(wfCtx, w, wh, rowBuf);
        }
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isCollapsed, audioStatus, colorMapId, analyserNodeRef, bandwidth, mode, displayBandwidth, bwOverride, spectrumHeight, waterfallHeight]);

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
    return (
      <div className="flex flex-col gap-0">
        <canvas
          ref={spectrumCanvasRef}
          width={600}
          height={spectrumHeight}
          className="w-full"
          style={{ height: spectrumHeight }}
        />
        <canvas
          ref={waterfallCanvasRef}
          width={600}
          height={waterfallHeight}
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
        icon={<Waves size={14} />}
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

// bandwidth/mode are derived primitives (compare by value) and analyserNodeRef is a stable
// ref, so none of this panel's props actually change on the frequent rig-status polling tick
// that doesn't touch bandwidth/mode — memoizing avoids re-rendering it then.
export default React.memo(SpectrumAudioPanel);
