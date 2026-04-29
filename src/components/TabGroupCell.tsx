import React from "react";
import { cn } from "../utils";
import { PANEL_LABELS } from "../types/layout";
import type { GridItem } from "../types/layout";

interface TabGroupCellProps {
  item: GridItem;
  isEditMode: boolean;
  renderPanel: (item: GridItem) => React.ReactNode;
  onTabChange: (index: number) => void;
  onRemoveTab?: (index: number) => void;
}

export default function TabGroupCell({
  item,
  isEditMode,
  renderPanel,
  onTabChange,
  onRemoveTab,
}: TabGroupCellProps) {
  const { tabGroup } = item;
  if (!tabGroup) return null;

  const { panels, activeIndex } = tabGroup;
  // Clamp activeIndex in case panels changed
  const safeIndex = Math.min(activeIndex, panels.length - 1);
  const activeType = panels[safeIndex];
  const activeItem: GridItem = { ...item, panelType: activeType, tabGroup: undefined };

  return (
    <div className="h-full flex flex-col bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-lg">
      <div className="px-2 py-1 border-b border-[#2a2b2e] flex items-center gap-1 bg-[#1a1b1e] flex-shrink-0 flex-wrap">
        {panels.map((p, idx) => (
          <div key={p} className="flex items-center">
            <button
              onClick={() => onTabChange(idx)}
              className={cn(
                "px-2 py-0.5 rounded text-[0.625rem] font-bold uppercase transition-all",
                idx === safeIndex
                  ? "bg-emerald-500 text-white"
                  : "text-[#8e9299] hover:bg-white/5"
              )}
            >
              {PANEL_LABELS[p] ?? p}
            </button>
            {isEditMode && onRemoveTab && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onRemoveTab(idx); }}
                className="ml-0.5 text-red-400 hover:text-red-200 text-xs w-3 h-3 flex items-center justify-center leading-none"
                title={`Remove ${PANEL_LABELS[p] ?? p}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {renderPanel(activeItem)}
      </div>
    </div>
  );
}
