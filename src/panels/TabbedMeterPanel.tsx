import React, { useRef, useState } from "react";
import { cn } from "../utils";
import type { RigStatus } from "../types";

export type MeterTab = "signal" | "swr" | "alc" | "vdd";

export interface TabbedMeterHeaderContentProps {
  isCollapsed: boolean;
  status: RigStatus;
  meterTab: "signal" | "swr" | "alc";
  setMeterTab: React.Dispatch<React.SetStateAction<"signal" | "swr" | "alc">>;
}

export function TabbedMeterHeaderContent({
  isCollapsed,
  status,
  meterTab,
  setMeterTab,
}: TabbedMeterHeaderContentProps) {
  return (
    <div className="flex items-center justify-between w-full pr-2">
      {isCollapsed ? (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-mono font-bold",
              status.ptt ? "text-red-500" : "text-emerald-500"
            )}
          >
            {status.ptt
              ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
              : (status.smeter ?? -54) > 0
              ? `S9+${status.smeter}dB`
              : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
          </span>
          <span className="text-[#3a3b3e]">·</span>
          <span
            className={cn(
              "text-sm font-mono font-bold",
              (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500"
            )}
          >
            {(status.swr ?? 1).toFixed(2)}
          </span>
          <span className="text-[#3a3b3e]">·</span>
          <span className="text-sm font-mono font-bold text-blue-400">
            {(status.alc ?? 0).toFixed(2)}
          </span>
        </div>
      ) : (
        <div className="flex gap-2">
          {(["signal", "swr", "alc"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMeterTab(m)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold uppercase transition-all",
                meterTab === m
                  ? m === "swr" && (status.swr ?? 1) > 3
                    ? "bg-red-500 text-white"
                    : "bg-emerald-500 text-white"
                  : m === "swr" && (status.swr ?? 1) > 3
                  ? "text-red-500 bg-red-500/10"
                  : "text-[#8e9299] hover:bg-white/5"
              )}
            >
              {m === "signal" ? "SIG/PWR" : m.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {!isCollapsed && (
        <div className="flex flex-col items-end">
          {meterTab === "signal" && (
            <span
              className={cn(
                "text-lg font-mono font-bold",
                status.ptt ? "text-red-500" : "text-emerald-500"
              )}
            >
              {status.ptt
                ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                : (status.smeter ?? -54) > 0
                ? `S9+${status.smeter}dB`
                : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
            </span>
          )}
          {meterTab === "swr" && (
            <span
              className={cn(
                "text-lg font-mono font-bold",
                (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500"
              )}
            >
              {(status.swr ?? 1).toFixed(2)}
            </span>
          )}
          {meterTab === "alc" && (
            <span className="text-lg font-mono font-bold text-blue-500">
              {(status.alc ?? 0).toFixed(5)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface ChartLineSpec {
  key: "smeterGraph" | "powerMeter" | "swrGraph" | "vdd" | "alc";
  domain: [number, number];
  color: string;
}

interface TooltipLine {
  label: string;
  value: string;
}

function formatTooltipLines(meterTab: MeterTab, point: any): TooltipLine[] {
  if (meterTab === "signal") {
    const rawSmeter = point.smeter ?? -54;
    return [
      {
        label: "SIGNAL",
        value: rawSmeter > 0 ? `S9+${rawSmeter}dB` : `S${Math.round((rawSmeter + 54) / 6)}`,
      },
      { label: "POWER", value: `${Math.round((point.powerMeter ?? 0) * 100)}W` },
    ];
  }
  if (meterTab === "swr") {
    return [{ label: "SWR", value: (point.swr ?? 1).toFixed(2) }];
  }
  if (meterTab === "vdd") {
    return [{ label: "VDD", value: `${(point.vdd ?? 0).toFixed(1)}V` }];
  }
  return [{ label: "ALC", value: (point.alc ?? 0).toFixed(5) }];
}

// Dependency-free replacement for the recharts <LineChart> this panel used to render.
// Recharts v3 pulls in a full Redux Toolkit state-management stack plus the entire
// d3 scale/shape/time/color/array set (~870 kB pre-minification, see issue #109) just to
// draw 1-2 sparkline traces with a hover tooltip and no animation — this SVG hand-rolls
// that same behavior with zero extra dependencies.
const VIEWBOX_W = 400;
const VIEWBOX_H = 100;

export function MeterHistoryChart({
  status,
  history,
  meterTab,
  dense = false,
}: {
  status: RigStatus;
  history: any[];
  meterTab: MeterTab;
  dense?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);

  let lines: ChartLineSpec[];
  let tickDomain: [number, number] = [0, 1];
  let ticks: number[] = [];

  switch (meterTab) {
    case "signal":
      lines = [
        { key: "smeterGraph", domain: [-54, 0], color: "#10b981" },
        { key: "powerMeter", domain: [0, 1], color: "#ef4444" },
      ];
      break;
    case "swr":
      tickDomain = [1, 4];
      ticks = [1, 2, 3, 4];
      lines = [
        { key: "swrGraph", domain: tickDomain, color: (status.swr ?? 1) > 3 ? "#ef4444" : "#f59e0b" },
      ];
      break;
    case "vdd":
      tickDomain = [11, 16];
      ticks = [11, 12, 13, 14, 15, 16];
      lines = [{ key: "vdd", domain: tickDomain, color: "#10b981" }];
      break;
    case "alc":
    default:
      lines = [{ key: "alc", domain: [0, 1], color: "#3b82f6" }];
      break;
  }

  const showTicks = dense && (meterTab === "swr" || meterTab === "vdd");
  const leftPad = showTicks ? 26 : 6;
  const rightPad = 6;
  const topPad = 8;
  const bottomPad = 8;
  const plotW = VIEWBOX_W - leftPad - rightPad;
  const plotH = VIEWBOX_H - topPad - bottomPad;
  const n = history.length;

  const xAt = (i: number) => (n <= 1 ? leftPad : leftPad + (i / (n - 1)) * plotW);
  const yAt = (val: number, domain: [number, number]) => {
    const [lo, hi] = domain;
    const clamped = Math.min(hi, Math.max(lo, val));
    const t = hi === lo ? 0 : (clamped - lo) / (hi - lo);
    return topPad + (1 - t) * plotH;
  };

  const buildPath = (line: ChartLineSpec) => {
    if (n === 0) return "";
    return history
      .map((pt, i) => {
        const raw = pt[line.key];
        const y = yAt(typeof raw === "number" ? raw : line.domain[0], line.domain);
        return `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const gridLineYs = showTicks
    ? ticks.map((t) => yAt(t, tickDomain))
    : [0, 0.25, 0.5, 0.75, 1].map((f) => topPad + f * plotH);

  const hoverIndex =
    hoverFrac !== null && n > 0
      ? Math.min(
          n - 1,
          Math.max(0, Math.round(((hoverFrac * VIEWBOX_W - leftPad) / plotW) * (n - 1)))
        )
      : null;
  const hoverPoint = hoverIndex !== null ? history[hoverIndex] : null;
  const tooltipLines = hoverPoint ? formatTooltipLines(meterTab, hoverPoint) : null;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (n === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    setHoverFrac(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };

  const strokeWidth = dense ? 1.5 : 2;
  const tickFontSize = dense ? 9 : 11;
  const tooltipFontSize = dense ? "0.5rem" : "0.75rem";

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverFrac(null)}
    >
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        {gridLineYs.map((y, i) => (
          <line
            key={i}
            x1={leftPad}
            x2={VIEWBOX_W - rightPad}
            y1={y}
            y2={y}
            stroke="#2a2b2e"
            strokeOpacity={0.3}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {showTicks &&
          ticks.map((t, i) => (
            <text
              key={i}
              x={leftPad - 4}
              y={yAt(t, tickDomain)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={tickFontSize}
              fill="#4a4b4e"
            >
              {t}
            </text>
          ))}
        {hoverPoint && (
          <line
            x1={xAt(hoverIndex!)}
            x2={xAt(hoverIndex!)}
            y1={topPad}
            y2={VIEWBOX_H - bottomPad}
            stroke="#4a4b4e"
            strokeOpacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {lines.map((line) => (
          <path
            key={line.key}
            d={buildPath(line)}
            fill="none"
            stroke={line.color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {tooltipLines && (
        <div
          className="absolute top-1 px-1.5 py-1 rounded bg-[#151619] border border-[#2a2b2e] pointer-events-none whitespace-nowrap"
          style={{
            left: `${Math.min(85, Math.max(2, hoverFrac! * 100))}%`,
            fontSize: tooltipFontSize,
          }}
        >
          {tooltipLines.map((l) => (
            <div key={l.label} className="text-[#8e9299] font-mono">
              <span className="text-[#5a5b5e]">{l.label}</span>{" "}
              <span className="text-white font-bold">{l.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface TabbedMeterPanelProps {
  status: RigStatus;
  history: any[];
  meterTab: MeterTab;
  dense?: boolean;
}

export default function TabbedMeterPanel({
  status,
  history,
  meterTab,
  dense = false,
}: TabbedMeterPanelProps) {
  return (
    <div className="h-40">
      <MeterHistoryChart status={status} history={history} meterTab={meterTab} dense={dense} />
    </div>
  );
}
