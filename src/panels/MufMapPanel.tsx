import React, { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../utils";

type Metric = "mufd" | "fof2";
type TimeSlot = "now" | "1h" | "12h" | "24h";

const METRIC_LABELS: Record<Metric, string> = { mufd: "MUFD", fof2: "foF2" };
const TIME_LABELS: Record<TimeSlot, string> = { now: "Now", "1h": "−1h", "12h": "−12h", "24h": "−24h" };
const METRIC_DESC: Record<Metric, string> = {
  mufd: "MUF (3000 km path)",
  fof2: "foF2 (F2 critical freq)",
};

const REFRESH_MS = 10 * 60 * 1000;
const DEFAULT_HEIGHT = 400;
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const ZOOM_FACTOR = 1.15;

interface Transform { scale: number; x: number; y: number }
const IDENTITY: Transform = { scale: 1, x: 0, y: 0 };

interface Props { heightPx?: number }

export default function MufMapPanel({ heightPx = DEFAULT_HEIGHT }: Props) {
  const [metric, setMetric] = useState<Metric>("mufd");
  const [timeSlot, setTimeSlot] = useState<TimeSlot>("now");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => new Date());
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>(IDENTITY);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const lastTouchDistRef = useRef<number | null>(null);

  // Clamp (x, y) so the scaled image always covers the container — no panning into empty space.
  // The wrapper is physically cw*scale × ch*scale. Translate keeps it covering [0, cw] × [0, ch].
  const clampXY = useCallback((x: number, y: number, scale: number): { x: number; y: number } => {
    const el = containerRef.current;
    if (!el || scale <= 1) return { x: 0, y: 0 };
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    return {
      x: Math.min(0, Math.max(cw * (1 - scale), x)),
      y: Math.min(0, Math.max(ch * (1 - scale), y)),
    };
  }, []);

  const applyTransform = useCallback((t: Transform) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale));
    const { x, y } = clampXY(t.x, t.y, scale);
    const next: Transform = { scale, x, y };
    transformRef.current = next;
    setTransform(next);
  }, [clampXY]);

  const resetTransform = useCallback(() => {
    transformRef.current = IDENTITY;
    setTransform(IDENTITY);
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    setLoading(true);
    setError(false);
    setLastRefreshed(new Date());
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Reset zoom when metric or time slot changes
  useEffect(() => {
    setLoading(true);
    setError(false);
    resetTransform();
  }, [metric, timeSlot, resetTransform]);

  // Wheel zoom toward cursor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const { scale, x, y } = transformRef.current;
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
      if (newScale === 1) { applyTransform(IDENTITY); return; }
      // Zoom toward cursor: keep the image point under the cursor stationary.
      // With translate-only (no CSS scale), the ratio math is the same as the scale-transform
      // case because both dimensions scale proportionally.
      const ratio = newScale / scale;
      applyTransform({ scale: newScale, x: cx - (cx - x) * ratio, y: cy - (cy - y) * ratio });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyTransform]);

  // Mouse drag (document-level move/up so dragging outside container works)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseDown = (e: MouseEvent) => {
      if (transformRef.current.scale <= 1) return;
      e.preventDefault();
      isDraggingRef.current = true;
      setIsDragging(true);
      dragStartRef.current = { mx: e.clientX, my: e.clientY, tx: transformRef.current.x, ty: transformRef.current.y };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      applyTransform({
        scale: transformRef.current.scale,
        x: dragStartRef.current.tx + (e.clientX - dragStartRef.current.mx),
        y: dragStartRef.current.ty + (e.clientY - dragStartRef.current.my),
      });
    };
    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
    };

    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [applyTransform]);

  // Touch: pinch-to-zoom + single-finger drag
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList, rect: DOMRect) => ({
      x: (t[0].clientX + t[1].clientX) / 2 - rect.left,
      y: (t[0].clientY + t[1].clientY) / 2 - rect.top,
    });

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        lastTouchDistRef.current = dist(e.touches);
      } else if (e.touches.length === 1 && transformRef.current.scale > 1) {
        isDraggingRef.current = true;
        setIsDragging(true);
        dragStartRef.current = { mx: e.touches[0].clientX, my: e.touches[0].clientY, tx: transformRef.current.x, ty: transformRef.current.y };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const rect = el.getBoundingClientRect();
        const d = dist(e.touches);
        const m = mid(e.touches, rect);
        const prev = lastTouchDistRef.current ?? d;
        const { scale, x, y } = transformRef.current;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * (d / prev)));
        if (newScale === 1) { applyTransform(IDENTITY); }
        else {
          const ratio = newScale / scale;
          applyTransform({ scale: newScale, x: m.x - (m.x - x) * ratio, y: m.y - (m.y - y) * ratio });
        }
        lastTouchDistRef.current = d;
      } else if (e.touches.length === 1 && isDraggingRef.current) {
        applyTransform({
          scale: transformRef.current.scale,
          x: dragStartRef.current.tx + (e.touches[0].clientX - dragStartRef.current.mx),
          y: dragStartRef.current.ty + (e.touches[0].clientY - dragStartRef.current.my),
        });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) lastTouchDistRef.current = null;
      if (e.touches.length === 0) { isDraggingRef.current = false; setIsDragging(false); }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [applyTransform]);

  const url = `https://prop.kc2g.com/renders/current/${metric}-normal-${timeSlot}.svg?v=${refreshKey}`;
  const isZoomed = transform.scale > 1;
  const zoomPct = Math.round(transform.scale * 100);

  return (
    <div className="flex flex-col">
      {/* Controls bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#2a2b2e] bg-[#1a1b1e] flex-shrink-0">
        <div className="flex gap-0.5">
          {(["mufd", "fof2"] as Metric[]).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={cn(
                "px-1.5 py-0.5 rounded text-[0.5625rem] font-bold uppercase tracking-wide transition-all",
                metric === m ? "bg-sky-600 text-white" : "text-[#8e9299] hover:bg-white/5"
              )}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
        <span className="text-[#3a3b3e] text-[0.5rem] select-none">|</span>
        <div className="flex gap-0.5">
          {(["now", "1h", "12h", "24h"] as TimeSlot[]).map(t => (
            <button
              key={t}
              onClick={() => setTimeSlot(t)}
              className={cn(
                "px-1.5 py-0.5 rounded text-[0.5625rem] font-bold uppercase tracking-wide transition-all",
                timeSlot === t ? "bg-emerald-600 text-white" : "text-[#8e9299] hover:bg-white/5"
              )}
            >
              {TIME_LABELS[t]}
            </button>
          ))}
        </div>
        {isZoomed && (
          <button
            onClick={resetTransform}
            title="Reset zoom"
            className="ml-1 px-1.5 py-0.5 rounded text-[0.5625rem] font-bold font-mono text-amber-400 hover:bg-amber-400/10 transition-colors"
          >
            {zoomPct}%
          </button>
        )}
        <button
          onClick={refresh}
          title="Refresh map"
          className="ml-auto p-0.5 text-[#8e9299] hover:text-white hover:bg-white/5 rounded transition-colors"
        >
          <RefreshCw size={9} />
        </button>
      </div>

      {/* Map area */}
      <div
        ref={containerRef}
        className="relative overflow-hidden bg-white select-none"
        style={{
          height: `${heightPx}px`,
          cursor: isDragging ? 'grabbing' : isZoomed ? 'grab' : 'default',
        }}
        onDoubleClick={resetTransform}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#151619] z-10">
            <span className="text-[#8e9299] text-[0.625rem]">Loading map…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#151619] z-10">
            <span className="text-red-400 text-[0.625rem]">Map unavailable — check connection</span>
          </div>
        )}

        {/* Zoomable/pannable layer.
            Width/height are set to scale * 100% instead of using CSS scale() so the browser
            rasterizes the SVG at the actual display size, keeping it crisp at every zoom level. */}
        <div
          style={{
            width: `${transform.scale * 100}%`,
            height: `${transform.scale * 100}%`,
            transform: `translate(${transform.x}px, ${transform.y}px)`,
            willChange: 'transform',
          }}
        >
          {/* No key prop — src change updates in-place so panel height never collapses */}
          <img
            src={url}
            alt={`${METRIC_LABELS[metric]} world map`}
            className="w-full h-full object-contain pointer-events-none"
            draggable={false}
            onLoad={() => { setLoading(false); setError(false); }}
            onError={() => { setLoading(false); setError(true); }}
          />
        </div>

        {/* Scroll-to-zoom hint */}
        {!isZoomed && (
          <div className="absolute bottom-1 right-1 text-[0.5rem] text-black/30 pointer-events-none select-none">
            scroll to zoom · dbl-click to reset
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-2 py-1 border-t border-[#2a2b2e] flex items-center justify-between text-[0.55rem] text-[#5a5b5e] flex-shrink-0">
        <span>
          {METRIC_DESC[metric]} · <span className="text-[#6a6b6e]">prop.kc2g.com</span> (KC2G/WWROF/GIRO)
        </span>
        <span className="text-[#4a4b4e]">
          {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}
