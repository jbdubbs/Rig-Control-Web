import React from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
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

export interface SwrPanelProps {
  status: RigStatus;
  history: any[];
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function SwrPanel({ status, history, isCollapsed, setIsCollapsed }: SwrPanelProps) {
  return (
    <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
      <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
        <div className={cn(
          "flex items-center gap-2",
          (status.swr ?? 1) > 3 ? "text-red-500" : "text-[#8e9299]"
        )}>
          <Activity size={14} />
          <span className="text-[0.625rem] uppercase tracking-widest font-bold">SWR Ratio</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn(
            "text-xs font-mono font-bold",
            (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500"
          )}>
            {(status.swr ?? 1).toFixed(2)}
          </span>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
            title={isCollapsed ? "Expand SWR Graph" : "Collapse SWR Graph"}
          >
            {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div className="p-6 h-[210px]">
          <div className="h-full pb-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis
                  domain={[1, 4]}
                  ticks={[1, 2, 3, 4]}
                  width={25}
                  style={{ fontSize: '8px', fill: '#4a4b4e' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                  itemStyle={{ color: (status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b' }}
                  formatter={(val: number, name: string, props: any) => [(props.payload?.swr ?? 1).toFixed(2), 'SWR']}
                />
                <Line
                  type="monotone"
                  dataKey="swrGraph"
                  stroke={(status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b'}
                  strokeWidth={2}
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
