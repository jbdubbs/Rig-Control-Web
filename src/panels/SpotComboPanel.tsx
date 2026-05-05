import React, { useState } from "react";
import { cn } from "../utils";
import { SpotSettingsGear } from "./SpotsPanel";

type Tab = 'pota' | 'sota' | 'wwff';

const TABS: { key: Tab; label: string; activeClass: string }[] = [
  { key: 'pota', label: 'POTA', activeClass: 'bg-emerald-600 text-white' },
  { key: 'sota', label: 'SOTA', activeClass: 'bg-amber-600 text-white' },
  { key: 'wwff', label: 'WWFF', activeClass: 'bg-sky-600 text-white' },
];

export interface SpotComboPanelProps {
  renderPotaTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaTable: () => React.ReactElement;
  renderWwffTable: () => React.ReactElement;
  onOpenSettings: () => void;
  maxHeightClass?: string;
}

export default function SpotComboPanel({
  renderPotaTable,
  renderSotaTable,
  renderWwffTable,
  onOpenSettings,
  maxHeightClass = 'max-h-64',
}: SpotComboPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const stored = localStorage.getItem('spots-combo-tab') as Tab | null;
    return stored ?? 'pota';
  });

  const handleTab = (tab: Tab) => {
    setActiveTab(tab);
    localStorage.setItem('spots-combo-tab', tab);
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[#2a2b2e] bg-[#1a1b1e] flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTab(t.key)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[0.5625rem] font-bold uppercase tracking-wide transition-all',
              activeTab === t.key
                ? t.activeClass
                : 'text-[#8e9299] hover:bg-white/5'
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto">
          <SpotSettingsGear
            accent={activeTab === 'pota' ? 'emerald' : activeTab === 'sota' ? 'amber' : 'sky'}
            onClick={onOpenSettings}
          />
        </div>
      </div>
      <div className={cn('overflow-y-auto custom-scrollbar', maxHeightClass)}>
        {activeTab === 'pota' && renderPotaTable(false)}
        {activeTab === 'sota' && renderSotaTable()}
        {activeTab === 'wwff' && renderWwffTable()}
      </div>
    </>
  );
}
