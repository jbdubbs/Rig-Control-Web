import { useEffect, useRef, useState } from "react";
import { RotateCcw, ZoomIn } from "lucide-react";
import { cn } from "../utils";
import { UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP } from "../utils/uiScale";
import type { UiScaleControlProps } from "./UiScaleControl";

const PCT_MIN = Math.round(UI_SCALE_MIN * 100);
const PCT_MAX = Math.round(UI_SCALE_MAX * 100);
const PCT_STEP = Math.round(UI_SCALE_STEP * 100);
const TICKS = Array.from({ length: (PCT_MAX - PCT_MIN) / PCT_STEP + 1 }, (_, i) => PCT_MIN + i * PCT_STEP);

// Compact-layout header control for the per-device UI scale (issue #123): one
// zoom button that opens a slider popover. The phone layout uses a stepper row
// in PhoneHeaderMenu instead.
export default function UiScaleHeaderControl({
  scale,
  onSet,
  onReset,
  variant,
}: Pick<UiScaleControlProps, "scale" | "onSet" | "onReset"> & { variant: "collapsed" | "expanded" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftPct, setDraftPct] = useState(() => Math.round(scale * 100));
  const containerRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;

  // Follow external changes (reset, another control, reload).
  useEffect(() => setDraftPct(Math.round(scale * 100)), [scale]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Commit on the native `change` event (fires when the thumb is released, or per
  // keyboard step), not on every `input` while dragging: zooming resizes this very
  // popover under the pointer, which would make the thumb jump mid-drag.
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const commit = () => onSetRef.current(Number(el.value) / 100);
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [isOpen]);

  const pct = Math.round(scale * 100);
  const changed = scale !== UI_SCALE_DEFAULT;
  const iconSize = variant === "collapsed" ? 14 : 18;
  const triggerClass = cn(
    "transition-all flex-shrink-0",
    variant === "collapsed" ? "p-1 rounded" : "p-1.5 sm:p-2 bg-app border rounded-lg",
    changed
      ? variant === "collapsed"
        ? "text-emerald-400 bg-emerald-500/10"
        : "text-emerald-400 border-emerald-500/70 bg-emerald-500/10"
      : variant === "collapsed"
        ? "text-muted hover:text-ink"
        : "text-muted border-line hover:text-ink"
  );

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={triggerClass}
        title={`UI scale (${pct}%)`}
        aria-label="UI scale"
        aria-expanded={isOpen}
      >
        <ZoomIn size={iconSize} />
      </button>
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-64 bg-panel border border-line rounded-lg shadow-2xl p-3 z-50 space-y-2"
          data-testid="ui-scale-popover"
        >
          <div className="flex items-center justify-between">
            <span className="text-[0.625rem] uppercase font-bold text-muted">UI Scale</span>
            <span className="text-sm font-mono text-ink" data-testid="ui-scale-value">{draftPct}%</span>
          </div>
          <input
            ref={sliderRef}
            type="range"
            min={PCT_MIN}
            max={PCT_MAX}
            step={PCT_STEP}
            value={draftPct}
            onChange={(e) => setDraftPct(Number(e.target.value))}
            aria-label="UI scale"
            className="w-full accent-emerald-500 cursor-pointer"
          />
          <div className="flex justify-between px-[7px]" aria-hidden="true">
            {TICKS.map((t) => (
              <span key={t} className={cn("w-px bg-line", t === 100 ? "h-2 bg-muted" : "h-1")} />
            ))}
          </div>
          <div className="flex justify-between text-[0.625rem] text-muted font-mono">
            <span>{PCT_MIN}%</span>
            <span>100%</span>
            <span>{PCT_MAX}%</span>
          </div>
          <button
            onClick={() => { onReset(); }}
            disabled={!changed}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded border border-line bg-app text-muted hover:text-ink transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted"
            aria-label="Reset UI scale"
          >
            <RotateCcw size={12} />
            Reset to 100%
          </button>
        </div>
      )}
    </div>
  );
}
