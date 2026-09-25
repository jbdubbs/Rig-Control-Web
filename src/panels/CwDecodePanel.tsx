import React from "react";
import { Radio } from "lucide-react";
import PanelChrome from "../components/PanelChrome";

export interface CwDecodePanelProps {
  variant: "compact-embedded" | "phone-embedded" | "standalone";
  cwDecodedText: string;
  setCwDecodedText: React.Dispatch<React.SetStateAction<string>>;
  cwStats: { pitch: number; speed: number };
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;
  isCollapsed?: boolean;
  setIsCollapsed?: React.Dispatch<React.SetStateAction<boolean>>;
}

function CwDecodePanel({
  variant,
  cwDecodedText,
  setCwDecodedText,
  cwStats,
  cwScrollContainerRef,
  isCollapsed,
  setIsCollapsed,
}: CwDecodePanelProps) {
  const statsSpan = cwStats.pitch > 0 ? (
    <span className="text-[0.625rem] text-[#8e9299]">
      {Math.round(cwStats.pitch)}Hz&nbsp;{Math.round(cwStats.speed)}wpm
    </span>
  ) : null;

  const clearBtn = (
    <button
      onClick={() => setCwDecodedText('')}
      className="px-1.5 py-0.5 hover:bg-white/5 rounded text-[0.5rem] uppercase tracking-wider text-[#8e9299] hover:text-white/60"
    >
      Clear
    </button>
  );

  if (variant === "compact-embedded") {
    return (
      <div className="flex flex-col h-[80px] border-t border-[#2a2b2e] overflow-hidden">
        <div className="px-2 py-1 flex items-center justify-between border-b border-[#2a2b2e]">
          <div className="flex items-center gap-2">
            <span className="text-[0.625rem] uppercase text-emerald-500 font-bold tracking-wider">CW Decode</span>
            {statsSpan}
          </div>
          {clearBtn}
        </div>
        <div ref={cwScrollContainerRef} className="flex-1 overflow-y-auto cw-scroll p-2 font-mono text-[0.625rem] text-emerald-400 leading-relaxed break-all">
          {cwDecodedText || <span className="text-[#4a4b4e]">waiting for CW…</span>}
        </div>
      </div>
    );
  }

  if (variant === "phone-embedded") {
    return (
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[0.625rem] uppercase text-emerald-500 font-bold tracking-wider">CW Decode</span>
            {statsSpan}
          </div>
          {clearBtn}
        </div>
        <div ref={cwScrollContainerRef} className="bg-[#0a0a0a] rounded-lg border border-[#2a2b2e] p-2 h-14 overflow-y-auto cw-scroll font-mono text-[0.625rem] text-emerald-400 leading-relaxed break-all">
          {cwDecodedText || <span className="text-[#4a4b4e]">waiting for CW…</span>}
        </div>
      </div>
    );
  }

  // standalone — collapsible panel box
  return (
    <PanelChrome
      title="CW Decode"
      icon={<Radio size={12} />}
      isCollapsed={isCollapsed ?? false}
      setIsCollapsed={setIsCollapsed ?? (() => {})}
      headerActions={
        <>
          {statsSpan}
          {clearBtn}
        </>
      }
      headerSize="sm"
      bodyClassName="p-3"
    >
      <div ref={cwScrollContainerRef} className="font-mono text-[0.625rem] text-emerald-400 leading-relaxed break-all h-20 overflow-y-auto cw-scroll">
        {cwDecodedText || <span className="text-[#4a4b4e]">waiting for CW…</span>}
      </div>
    </PanelChrome>
  );
}

// cwDecodedText/cwStats update on decoded characters, independent of rig-status polling —
// memoizing avoids re-rendering this panel on every 2s tick.
export default React.memo(CwDecodePanel);
