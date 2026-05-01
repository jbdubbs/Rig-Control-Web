import React from "react";
import { cn } from "../utils";
import type { NbCapabilities, NrCapabilities, RfPowerCapabilities } from "../types";

export interface RfLevelsPanelProps {
  variant: "phone" | "compact";
  connected: boolean;
  localRFPower: number;
  setLocalRFPower: (v: number) => void;
  rfPowerCapabilities: RfPowerCapabilities;
  isDraggingRF: React.MutableRefObject<boolean>;
  localRFLevel: number;
  setLocalRFLevel: (v: number) => void;
  isDraggingRFLevel: React.MutableRefObject<boolean>;
  localNRLevel: number;
  setLocalNRLevel: (v: number) => void;
  nrCapabilities: NrCapabilities;
  isDraggingNR: React.MutableRefObject<boolean>;
  localNBLevel: number;
  setLocalNBLevel: (v: number) => void;
  nbCapabilities: NbCapabilities;
  isDraggingNB: React.MutableRefObject<boolean>;
}

export default function RfLevelsPanel({
  variant,
  connected,
  localRFPower,
  setLocalRFPower,
  rfPowerCapabilities,
  isDraggingRF,
  localRFLevel,
  setLocalRFLevel,
  isDraggingRFLevel,
  localNRLevel,
  setLocalNRLevel,
  nrCapabilities,
  isDraggingNR,
  localNBLevel,
  setLocalNBLevel,
  nbCapabilities,
  isDraggingNB,
}: RfLevelsPanelProps) {
  const isPhone = variant === "phone";
  const sliderH = isPhone ? "h-2" : "h-1";

  const sliders = (
    <>
      {/* RF Power */}
      <div className={isPhone ? "space-y-1.5" : ""}>
          <div className="flex justify-between items-center">
            <span className="text-xs uppercase text-[#8e9299]">RF Power</span>
            <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFPower * 100)}W</span>
          </div>
          <input
            type="range"
            min={rfPowerCapabilities.range.min * 100}
            max={rfPowerCapabilities.range.max * 100}
            step={rfPowerCapabilities.range.step * 100}
            value={localRFPower * 100}
            disabled={!connected}
            onChange={(e) => { isDraggingRF.current = true; setLocalRFPower(parseFloat(e.target.value) / 100); }}
            className={cn(`w-full accent-emerald-500 ${sliderH} bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer`, !connected && "opacity-50 cursor-not-allowed")}
          />
        </div>

      {/* RF Level */}
      <div className={isPhone ? "space-y-1.5" : "mt-3"}>
          <div className="flex justify-between items-center">
            <span className="text-xs uppercase text-[#8e9299]">RF Level</span>
            <span className="text-sm text-emerald-500 font-bold">{Math.round(localRFLevel * 100)}%</span>
          </div>
          <input
            type="range" min="0" max="1" step="0.1" value={localRFLevel}
            disabled={!connected}
            onChange={(e) => { isDraggingRFLevel.current = true; setLocalRFLevel(parseFloat(e.target.value)); }}
            className={cn(`w-full accent-emerald-500 ${sliderH} bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer`, !connected && "opacity-50 cursor-not-allowed")}
          />
        </div>

      {/* DNR Level */}
      <div className={isPhone ? "space-y-1.5" : "mt-3"}>
          <div className="flex justify-between items-center">
            <span className="text-xs uppercase text-[#8e9299]">DNR Level</span>
            <span className="text-sm text-emerald-500 font-bold">Lvl {Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}</span>
          </div>
          <input
            type="range" min="1"
            max={Math.round((nrCapabilities.range.max - nrCapabilities.range.min) / nrCapabilities.range.step)}
            step="1"
            value={Math.max(1, Math.round((localNRLevel - nrCapabilities.range.min) / nrCapabilities.range.step))}
            disabled={!connected || !nrCapabilities.supported}
            onChange={(e) => {
              isDraggingNR.current = true;
              const stepIdx = parseInt(e.target.value);
              setLocalNRLevel(Math.min(nrCapabilities.range.max, nrCapabilities.range.min + stepIdx * nrCapabilities.range.step));
            }}
            className={cn(`w-full accent-emerald-500 ${sliderH} bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer`, (!connected || !nrCapabilities.supported) && "opacity-50 cursor-not-allowed")}
          />
        </div>

      {/* NB Level */}
      {nbCapabilities.supported && (
        <div className={isPhone ? "space-y-1.5" : "mt-3"}>
            <div className="flex justify-between items-center">
              <span className="text-xs uppercase text-[#8e9299]">NB Level</span>
              <span className="text-sm text-emerald-500 font-bold">Lvl {Math.round(localNBLevel)}</span>
            </div>
            <input
              type="range"
              min={nbCapabilities.range.min} max={nbCapabilities.range.max} step={nbCapabilities.range.step}
              value={localNBLevel}
              disabled={!connected}
              onChange={(e) => { isDraggingNB.current = true; setLocalNBLevel(parseFloat(e.target.value)); }}
              className={cn(`w-full accent-emerald-500 ${sliderH} bg-[#0a0a0a] rounded-lg appearance-none cursor-pointer`, !connected && "opacity-50 cursor-not-allowed")}
            />
          </div>
      )}
    </>
  );

  return sliders;
}
