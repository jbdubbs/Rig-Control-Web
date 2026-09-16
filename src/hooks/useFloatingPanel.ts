import { useEffect, useState, type CSSProperties, type RefObject } from "react";

// Shared by SearchableSelect and SerialPortInput's "combobox" filtering: strips everything
// but lowercase letters/digits so punctuation/spacing differences don't affect matching.
export function normalizeSearchText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface UseFloatingPanelOptions {
  isOpen: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  panelMaxHeight: number;
  panelGap?: number;
}

interface UseFloatingPanelResult {
  panelStyle: CSSProperties;
  positionPanel: () => void;
}

// Shared floating-panel behavior for SearchableSelect and SerialPortInput's dropdown
// popovers, both portaled to document.body: computes fixed-position coordinates anchored to
// a trigger element, flipping above the trigger (and clamping maxHeight) when there isn't
// enough room below, and closes the panel on an outside pointerdown, an outside scroll, or a
// window resize while open.
export function useFloatingPanel({
  isOpen,
  triggerRef,
  panelRef,
  onClose,
  panelMaxHeight,
  panelGap = 4,
}: UseFloatingPanelOptions): UseFloatingPanelResult {
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const positionPanel = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openAbove = spaceBelow < panelMaxHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.min(
      panelMaxHeight,
      (openAbove ? spaceAbove : spaceBelow) - panelGap * 2
    );
    setPanelStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(maxHeight, 100),
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + panelGap }
        : { top: rect.bottom + panelGap }),
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose();
    };
    // Scrolling inside the panel itself (the listbox, or focus/scrollIntoView nudging the
    // search input into view) must not close the popover — only a scroll of whatever's
    // underneath (e.g. the modal's overlay) should.
    const onScroll = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return { panelStyle, positionPanel };
}
