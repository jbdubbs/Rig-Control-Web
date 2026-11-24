import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "../utils";
import { UI_SCALE_DEFAULT } from "../utils/uiScale";

export interface UiScaleControlProps {
  scale: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onReset: () => void;
  /** Jump straight to a scale (clamped and snapped by the hook). */
  onSet: (scale: number) => void;
  canIncrease: boolean;
  canDecrease: boolean;
  /** Tighter sizing for the phone hamburger menu. */
  compact?: boolean;
}

const btnBase =
  "bg-app border border-line rounded-lg text-muted hover:text-ink transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted";

export default function UiScaleControl({
  scale,
  onIncrease,
  onDecrease,
  onReset,
  canIncrease,
  canDecrease,
  compact = false,
}: UiScaleControlProps) {
  const btn = cn(btnBase, compact ? "p-1.5" : "p-2");
  return (
    <div className="flex items-center gap-2" data-testid="ui-scale-control">
      <button onClick={onDecrease} disabled={!canDecrease} className={btn} title="Smaller" aria-label="Decrease UI scale">
        <Minus size={14} />
      </button>
      <span className={cn("text-center text-sm font-mono text-ink", compact ? "w-12" : "w-16")} data-testid="ui-scale-value">
        {Math.round(scale * 100)}%
      </span>
      <button onClick={onIncrease} disabled={!canIncrease} className={btn} title="Larger" aria-label="Increase UI scale">
        <Plus size={14} />
      </button>
      <button
        onClick={onReset}
        disabled={scale === UI_SCALE_DEFAULT}
        className={cn(btn, compact ? "ml-1" : "ml-2")}
        title="Reset to 100%"
        aria-label="Reset UI scale"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
