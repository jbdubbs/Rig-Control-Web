import { useState, useEffect, useRef } from "react";
import { layoutWidth } from "../utils/uiScale";

// uiScale is a dependency because browser CSS zoom changes the usable width
// without firing a resize event (issue #123).
export function useLayoutState(uiScale = 1) {
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
      const width = layoutWidth(window.innerWidth, uiScale, !window.electron?.setZoomFactor);
      const mobile = width < 768;
      setIsPhone(mobile);
      setIsCompact(!mobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [uiScale]);

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
