import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "../utils";
import { UI_SCALE_DEFAULT } from "../utils/uiScale";

export interface UiScaleControlProps {
  scale: number;
  onIncrease: () => void;
  onDecrease: () => void;
  onReset: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
}

const btn =
  "p-2 bg-app border border-line rounded-lg text-muted hover:text-ink transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-muted";

export default function UiScaleControl({
  scale,
  onIncrease,
  onDecrease,
  onReset,
  canIncrease,
  canDecrease,
}: UiScaleControlProps) {
  return (
    <div className="flex items-center gap-2" data-testid="ui-scale-control">
      <button onClick={onDecrease} disabled={!canDecrease} className={btn} title="Smaller" aria-label="Decrease UI scale">
        <Minus size={14} />
      </button>
      <span className="w-16 text-center text-sm font-mono text-ink" data-testid="ui-scale-value">
        {Math.round(scale * 100)}%
      </span>
      <button onClick={onIncrease} disabled={!canIncrease} className={btn} title="Larger" aria-label="Increase UI scale">
        <Plus size={14} />
      </button>
      <button
        onClick={onReset}
        disabled={scale === UI_SCALE_DEFAULT}
        className={cn(btn, "ml-2")}
        title="Reset to 100%"
        aria-label="Reset UI scale"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  );
}
