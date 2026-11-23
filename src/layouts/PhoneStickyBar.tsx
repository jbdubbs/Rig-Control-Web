import React, { useState, useRef, useEffect } from "react";
import { Mic } from "lucide-react";
import { cn } from "../utils";
import type { RigStatus, CwSettings } from "../types";

// iOS "Add to Home Screen" PWA (no browser chrome). `navigator.standalone` is iOS-only; the
// display-mode query covers manifest-based installs. Evaluated once; it can't change at runtime.
const IOS_STANDALONE = (() => {
  if (typeof window === "undefined") return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return isIos && standalone;
})();

interface PhoneStickyBarProps {
  stickyBarRef: React.RefObject<HTMLDivElement>;
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
  const pttHeldRef = useRef(false);

  const isCwMode = ['CW', 'CWR', 'CW-R'].includes(status?.mode || '');

  // If the page is backgrounded or loses focus mid-press (e.g. iOS taking over a home-bar swipe),
  // the browser may never deliver pointerup/pointercancel, which would leave PTT or the CW paddle
  // held (#124). Force-release on blur / hidden / pagehide. emitCwPaddle isn't memoized, so read
  // the latest props through a ref instead of re-subscribing every render.
  const latestRef = useRef({ handleSetPTT, emitCwPaddle });
  latestRef.current = { handleSetPTT, emitCwPaddle };
  useEffect(() => {
    const releaseAll = () => {
      const { handleSetPTT: setPtt, emitCwPaddle: paddle } = latestRef.current;
      if (pttHeldRef.current) {
        pttHeldRef.current = false;
        setPtt(false);
      }
      if (ditPressedRef.current || dahPressedRef.current) {
        ditPressedRef.current = false;
        dahPressedRef.current = false;
        paddle(false, false, false);
      }
      setDitButtonActive(false);
      setDahButtonActive(false);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') releaseAll(); };
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', releaseAll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [ditPressedRef, dahPressedRef]);

  return (
    <div
      ref={stickyBarRef}
      className="flex-shrink-0 px-3 pt-3 bg-panel border-t border-line"
      // Keep the controls clear of the iOS home-indicator gesture zone: the system swipe-up
      // gesture starts at the bottom edge and would otherwise hit the button (#124). The extra
      // clearance applies to iOS standalone (Add to Home Screen) only; env() is 0 elsewhere.
      style={{ paddingBottom: `calc(0.75rem + env(safe-area-inset-bottom, 0px) + ${IOS_STANDALONE ? 12 : 0}px)` }}
    >
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
              ditButtonActive ? "bg-amber-500/20 border-amber-400 text-amber-300" : "bg-app border-line text-ink"
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
              dahButtonActive ? "bg-amber-500/20 border-amber-400 text-amber-500" : "bg-app border-line text-ink"
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
            pttHeldRef.current = true;
            handleSetPTT(true);
          }}
          onPointerUp={(e) => {
            if (!connected) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            pttHeldRef.current = false;
            handleSetPTT(false);
          }}
          onPointerCancel={() => {
            if (!connected) return;
            pttHeldRef.current = false;
            handleSetPTT(false);
          }}
          disabled={!connected}
          data-testid="phone-ptt-button"
          className={cn(
            "flex flex-col items-center justify-center w-full h-16 rounded-xl border transition-all gap-1 touch-none select-none",
            !connected && "opacity-50 cursor-not-allowed",
            status.ptt ? "bg-red-500/20 border-red-500 text-red-500" : "bg-app border-line"
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
