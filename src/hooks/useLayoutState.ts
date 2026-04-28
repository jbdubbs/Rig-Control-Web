import { useState, useEffect, useRef } from "react";

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
      const width = window.innerWidth;
      const mobile = width < 768;
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
