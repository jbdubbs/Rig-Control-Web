import { useState, useEffect, useRef } from "react";
import { isPhoneWidth } from "../utils/uiScale";

export function useLayoutState() {
  const [isCompact, setIsCompact] = useState(() => {
    const saved = localStorage.getItem("is-compact");
    return saved === null ? true : saved === "true";
  });
  const [isPhone, setIsPhone] = useState(false);
  const [stickyBarHeight, setStickyBarHeight] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const stickyBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      // Electron's Chromium zoom shrinks innerWidth; scale it back so a
      // zoomed-in desktop window doesn't flip to the Phone layout (#123).
      const mobile = isPhoneWidth(window.innerWidth, window.electron?.getZoomFactor?.() ?? 1);
      setIsPhone(mobile);
      setIsCompact(!mobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const el = stickyBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStickyBarHeight(el.offsetHeight));
    ro.observe(el);
    setStickyBarHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [isPhone]);

  useEffect(() => {
    localStorage.setItem("is-compact", isCompact.toString());
  }, [isCompact]);

  return {
    isCompact,
    isPhone,
    stickyBarHeight,
    containerRef,
    stickyBarRef,
  };
}
