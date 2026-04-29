import React from "react";
import { Gauge, Signal, ChevronDown, ChevronUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "../utils";
import type { RigStatus } from "../types";

export interface SMeterPanelProps {
  status: RigStatus;
  history: any[];
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function SMeterPanel({ status, history, isCollapsed, setIsCollapsed }: SMeterPanelProps) {
  return (
    <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
      <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
        <div className="flex items-center gap-2 text-[#8e9299]">
          {status.ptt ? <Gauge size={14} className="text-red-500" /> : <Signal size={14} />}
          <span className={cn(
            "text-[0.625rem] uppercase tracking-widest font-bold",
            status.ptt ? "text-red-500" : "text-[#8e9299]"
          )}>
            {status.ptt ? "POWER OUT" : "S-Meter"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            "text-xs font-mono font-bold",
            status.ptt ? "text-red-500" : "text-emerald-500"
          )}>
            {status.ptt
              ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
              : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`
            }
          </span>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
            title={isCollapsed ? "Expand S-Meter" : "Collapse S-Meter"}
          >
            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div className="p-6 space-y-6 h-[280px]">
          <div className="space-y-1">
            <div className="h-4 bg-[#0a0a0a] rounded border border-[#2a2b2e] relative overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-150 ease-out",
                  status.ptt ? "bg-red-500" : "bg-gradient-to-r from-blue-600 via-emerald-500 to-red-600"
                )}
                style={{
                  width: status.ptt
                    ? `${Math.max(0, Math.min(100, status.powerMeter * 100))}%`
                    : `${Math.max(0, Math.min(100, (Math.min(0, status.smeter) + 54) / 54 * 100))}%`
                }}
              />
              <div className="absolute inset-0 flex pointer-events-none">
                {status.ptt ? (
                  <>
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '0%' }} />
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '25%' }} />
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '50%' }} />
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '75%' }} />
                  </>
                ) : (
                  <>
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '0%' }} />
                    <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '55.5%' }} />
                  </>
                )}
                <div className="h-full border-r border-[#2a2b2e]/50" style={{ width: '100%' }} />
              </div>
            </div>
            <div className="flex justify-between text-[0.5rem] text-[#4a4b4e] font-mono uppercase tracking-tighter">
              {status.ptt ? (
                <>
                  <span>0W</span>
                  <span>25W</span>
                  <span>50W</span>
                  <span>75W</span>
                  <span>100W</span>
                </>
              ) : (
                <>
                  <span>S0</span>
                  <span className="ml-[-10%]">S5</span>
                  <span>S9</span>
                </>
              )}
            </div>
          </div>

          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                <XAxis dataKey="time" hide />
                <YAxis
                  domain={status.ptt ? [0, 1] : [-54, 0]}
                  ticks={status.ptt ? [0, 0.25, 0.5, 0.75, 1] : [-54, -24, 0]}
                  tickFormatter={(val) => {
                    if (status.ptt) return `${Math.round(val * 100)}W`;
                    if (val === -54) return "S0";
                    if (val === -24) return "S5";
                    if (val === 0) return "S9";
                    return "";
                  }}
                  width={35}
                  style={{ fontSize: '8px', fill: '#4a4b4e' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                  itemStyle={{ color: status.ptt ? '#ef4444' : '#10b981' }}
                  labelStyle={{ display: 'none' }}
                  formatter={(value: number, name: string, props: any) => {
                    const rawVal = props.payload?.smeter ?? value;
                    return [
                      status.ptt
                        ? `${Math.round(value * 100)} Watts`
                        : rawVal > 0 ? `S9+${rawVal}dB` : `S${Math.round((rawVal + 54) / 6)}`,
                      status.ptt ? 'Power' : 'Signal'
                    ];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey={status.ptt ? "powerMeter" : "smeterGraph"}
                  stroke={status.ptt ? "#ef4444" : "#10b981"}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
