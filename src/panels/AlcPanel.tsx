import React from "react";
import { Waves, ChevronDown, ChevronUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface AlcPanelProps {
  history: any[];
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

export default function AlcPanel({ history, isCollapsed, setIsCollapsed }: AlcPanelProps) {
  return (
    <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden flex flex-col">
      <div className="p-4 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
        <div className="flex items-center gap-2 text-[#8e9299]">
          <Waves size={14} />
          <span className="text-[0.625rem] uppercase tracking-widest font-bold">ALC Level</span>
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 hover:bg-white/5 rounded text-[#8e9299]"
          title={isCollapsed ? "Expand ALC Graph" : "Collapse ALC Graph"}
        >
          {isCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </div>
      {!isCollapsed && (
        <div className="p-6 h-[210px]">
          <div className="h-full pb-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} />
                <XAxis dataKey="time" hide />
                <YAxis
                  domain={[0, 1]}
                  width={45}
                  style={{ fontSize: '8px', fill: '#4a4b4e' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => (val ?? 0).toFixed(1)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '10px' }}
                  itemStyle={{ color: '#3b82f6' }}
                  formatter={(value: number) => [(value ?? 0).toFixed(5), 'ALC']}
                />
                <Line
                  type="monotone"
                  dataKey="alc"
                  stroke="#3b82f6"
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
