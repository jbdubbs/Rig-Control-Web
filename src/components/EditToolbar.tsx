import React from "react";
import { Check, Minus, Plus, RotateCcw } from "lucide-react";

interface SizeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function SizeControl({ label, value, min, max, onChange }: SizeControlProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[0.625rem] uppercase tracking-widest text-[#8e9299] font-bold w-8">{label}</span>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-6 h-6 rounded flex items-center justify-center bg-[#1a1b1e] border border-[#2a2b2e] text-[#8e9299] hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <Minus size={10} />
      </button>
      <span className="text-sm font-bold font-mono text-white w-4 text-center">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-6 h-6 rounded flex items-center justify-center bg-[#1a1b1e] border border-[#2a2b2e] text-[#8e9299] hover:text-white hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

interface EditToolbarProps {
  cols: number;
  rows: number;
  maxCols?: number;
  maxRows?: number;
  showColsControl?: boolean;
  showRowsControl?: boolean;
  onColsChange: (cols: number) => void;
  onRowsChange: (rows: number) => void;
  onAddPanel?: () => void;
  onReset: () => void;
  onDone: () => void;
}

export default function EditToolbar({
  cols,
  rows,
  maxCols = 6,
  maxRows = 6,
  showColsControl = true,
  showRowsControl = true,
  onColsChange,
  onRowsChange,
  onAddPanel,
  onReset,
  onDone,
}: EditToolbarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-sm border-t border-[#2a2b2e] px-4 py-2.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        {showColsControl && (
          <SizeControl label="Cols" value={cols} min={1} max={maxCols} onChange={onColsChange} />
        )}
        {showRowsControl && (
          <SizeControl label="Rows" value={rows} min={1} max={maxRows} onChange={onRowsChange} />
        )}
      </div>
      <div className="flex items-center gap-2">
        {onAddPanel && (
          <button
            onClick={onAddPanel}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1.5 rounded border border-emerald-500/40 hover:border-emerald-400/60 transition-all"
          >
            <Plus size={12} />
            Add Panel
          </button>
        )}
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs text-[#8e9299] hover:text-white px-3 py-1.5 rounded border border-[#2a2b2e] hover:border-white/20 transition-all"
          title="Reset to default layout"
        >
          <RotateCcw size={12} />
          Reset
        </button>
        <button
          onClick={onDone}
          className="flex items-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-1.5 rounded transition-all"
        >
          <Check size={14} />
          Done
        </button>
      </div>
    </div>
  );
}
