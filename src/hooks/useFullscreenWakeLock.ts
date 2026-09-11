import { useCallback, useEffect, useRef, useState } from "react";
import { shouldReacquireWakeLock } from "../utils";

// Full screen + stay-awake toggle for the phone layout (issue #61). One
// combined feature behind one button: entering full screen also acquires a
// Screen Wake Lock, and exiting full screen (by any means, not just this
// hook's own toggle) releases it too.
export function useFullscreenWakeLock(): { isActive: boolean; toggle: () => void } {
  const [isActive, setIsActive] = useState(false);
  const isActiveRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const toggle = useCallback(async () => {
    if (isActiveRef.current) {
      if (document.fullscreenElement && document.exitFullscreen) {
        try { await document.exitFullscreen(); } catch { /* ignore */ }
      }
      if (wakeLockRef.current) {
        try { await wakeLockRef.current.release(); } catch { /* ignore */ }
        wakeLockRef.current = null;
      }
      setIsActive(false);
    } else {
      // Attempted independently: iOS Safari's Fullscreen API support is
      // still only "partial" (caniuse), a known platform limitation — a
      // rejection there must never prevent the Wake Lock half, which works
      // well on virtually every current device, from being requested.
      if (document.documentElement.requestFullscreen) {
        try { await document.documentElement.requestFullscreen(); } catch { /* ignore */ }
      }
      if ("wakeLock" in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        } catch { /* ignore */ }
      }
      setIsActive(true);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      // Exited via back/swipe/OS chrome rather than our own toggle — treat
      // it as turning the whole feature off, not just the fullscreen half.
      if (!document.fullscreenElement && isActiveRef.current) {
        if (wakeLockRef.current) {
          wakeLockRef.current.release().catch(() => {});
          wakeLockRef.current = null;
        }
        setIsActive(false);
      }
    };

    const onVisibilityChange = () => {
      if (
        "wakeLock" in navigator &&
        shouldReacquireWakeLock({
          documentVisible: document.visibilityState === "visible",
          isActive: isActiveRef.current,
          hasSentinel: wakeLockRef.current != null,
        })
      ) {
        navigator.wakeLock.request("screen")
          .then((sentinel) => { wakeLockRef.current = sentinel; })
          .catch(() => {});
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  return { isActive, toggle };
}
