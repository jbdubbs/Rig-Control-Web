import React, { useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "../utils";
import type { RigStatus, CwSettings } from "../types";

interface PhoneStickyBarProps {
  stickyBarRef: React.RefObject<HTMLDivElement>;
  cwDecodeEnabled: boolean;
  cwStats: { pitch: number; speed: number };
  cwDecodedText: string;
  setCwDecodedText: (text: string) => void;
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;
  cwSettings: CwSettings;
  status: RigStatus;
  connected: boolean;
  handleSetPTT: (state: boolean) => void;
  ditPressedRef: React.MutableRefObject<boolean>;
  dahPressedRef: React.MutableRefObject<boolean>;
  emitCwPaddle: (dit: boolean, dah: boolean, release: boolean) => void;
}

function PhoneStickyBar({
  stickyBarRef,
  cwDecodeEnabled,
  cwStats,
  cwDecodedText,
  setCwDecodedText,
  cwScrollContainerRef,
  cwSettings,
  status,
  connected,
  handleSetPTT,
  ditPressedRef,
  dahPressedRef,
  emitCwPaddle,
}: PhoneStickyBarProps) {
  const [ditButtonActive, setDitButtonActive] = useState(false);
  const [dahButtonActive, setDahButtonActive] = useState(false);

  const isCwMode = ['CW', 'CWR', 'CW-R'].includes(status?.mode || '');

  return (
    <div ref={stickyBarRef} className="flex-shrink-0 px-3 py-3 bg-[#151619] border-t border-[#2a2b2e]">
      {cwDecodeEnabled && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-[0.625rem] uppercase text-emerald-500 font-bold tracking-wider">CW Decode</span>
              {cwStats.pitch > 0 && (
                <span className="text-[0.625rem] text-[#8e9299]">
                  {Math.round(cwStats.pitch)}Hz&nbsp;{Math.round(cwStats.speed)}wpm
                </span>
              )}
            </div>
            <button onClick={() => setCwDecodedText('')} className="px-1.5 py-0.5 hover:bg-white/5 rounded text-[0.5rem] uppercase tracking-wider text-[#8e9299] hover:text-white/60">Clear</button>
          </div>
          <div ref={cwScrollContainerRef} className="bg-[#0a0a0a] rounded-lg border border-[#2a2b2e] p-2 h-14 overflow-y-auto cw-scroll font-mono text-[0.625rem] text-emerald-400 leading-relaxed break-all">
            {cwDecodedText || <span className="text-[#4a4b4e]">waiting for CW…</span>}
          </div>
        </div>
      )}
      {cwSettings.enabled && isCwMode ? (
        <div className="flex gap-3">
          <button
            onPointerDown={(e) => {
              if (!connected) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDitButtonActive(true);
              ditPressedRef.current = true;
              emitCwPaddle(true, dahPressedRef.current, false);
            }}
            onPointerUp={(e) => {
              if (!connected) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              setDitButtonActive(false);
              ditPressedRef.current = false;
              emitCwPaddle(false, dahPressedRef.current, false);
            }}
            onPointerCancel={() => {
              if (!connected) return;
              setDitButtonActive(false);
              ditPressedRef.current = false;
              emitCwPaddle(false, dahPressedRef.current, false);
            }}
            disabled={!connected}
            className={cn(
              "flex flex-col items-center justify-center flex-1 h-16 rounded-xl border transition-all gap-1 touch-none select-none",
              !connected && "opacity-50 cursor-not-allowed",
              ditButtonActive ? "bg-amber-500/20 border-amber-400 text-amber-300" : "bg-[#0a0a0a] border-[#2a2b2e] text-[#e0e0e0]"
            )}
          >
            <span className="text-2xl font-bold leading-none">·</span>
            <span className="text-xs uppercase font-bold leading-none">dit</span>
          </button>
          <button
            onPointerDown={(e) => {
              if (!connected) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDahButtonActive(true);
              dahPressedRef.current = true;
              emitCwPaddle(ditPressedRef.current, true, false);
            }}
            onPointerUp={(e) => {
              if (!connected) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              setDahButtonActive(false);
              dahPressedRef.current = false;
              emitCwPaddle(ditPressedRef.current, false, false);
            }}
            onPointerCancel={() => {
              if (!connected) return;
              setDahButtonActive(false);
              dahPressedRef.current = false;
              emitCwPaddle(ditPressedRef.current, false, false);
            }}
            disabled={!connected}
            className={cn(
              "flex flex-col items-center justify-center flex-1 h-16 rounded-xl border transition-all gap-1 touch-none select-none",
              !connected && "opacity-50 cursor-not-allowed",
              dahButtonActive ? "bg-amber-500/20 border-amber-400 text-amber-300" : "bg-[#0a0a0a] border-[#2a2b2e] text-[#e0e0e0]"
            )}
          >
            <span className="text-2xl font-bold leading-none">—</span>
            <span className="text-xs uppercase font-bold leading-none">dah</span>
          </button>
        </div>
      ) : (
        <button
          onPointerDown={(e) => {
            if (!connected) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            handleSetPTT(true);
          }}
          onPointerUp={(e) => {
            if (!connected) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            handleSetPTT(false);
          }}
          onPointerCancel={() => {
            if (!connected) return;
            handleSetPTT(false);
          }}
          disabled={!connected}
          className={cn(
            "flex flex-col items-center justify-center w-full h-16 rounded-xl border transition-all gap-1 touch-none select-none",
            !connected && "opacity-50 cursor-not-allowed",
            status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-[#0a0a0a] border-[#2a2b2e]"
          )}
        >
          <Mic size={24} />
          <span className="text-xs uppercase font-bold leading-none">PTT</span>
        </button>
      )}
    </div>
  );
}

export default React.memo(PhoneStickyBar);
