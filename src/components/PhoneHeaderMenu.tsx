import React, { useEffect, useRef, useState } from "react";
import { LayoutGrid, LogOut, Maximize, Menu, Minimize, Plug, Settings, Unplug } from "lucide-react";
import { cn } from "../utils";

export interface PhoneHeaderMenuProps {
  variant: "collapsed" | "expanded";
  uiConnected: boolean;
  onToggleConnect: () => void;
  rigctldRunning: boolean;
  onOpenSettings: () => void;
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isFullscreenActive: boolean;
  onToggleFullscreen: () => void;
  onLogout: () => void;
  callsign: string;
}

// Phone-only hamburger menu (issue #61): the phone header has no room for a
// 6th icon at any realistic width (measured empirically — the icon
// cluster's trailing margin stays ~21px regardless of viewport width from
// 360px up, while a 6th icon needs ~40px), so every action besides the
// collapse/expand chevron lives here instead of inline.
function PhoneHeaderMenu({
  variant,
  uiConnected,
  onToggleConnect,
  rigctldRunning,
  onOpenSettings,
  isEditMode,
  onToggleEditMode,
  isFullscreenActive,
  onToggleFullscreen,
  onLogout,
  callsign,
}: PhoneHeaderMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isOpen]);

  // Connect/Settings used to double as at-a-glance status icons (red/green)
  // in the header before they moved into this menu — the trigger button
  // itself picks up the same coloring so that status is still visible
  // without opening the menu.
  const statusOk = uiConnected && rigctldRunning;

  const triggerClass = variant === "collapsed"
    ? "p-1 rounded transition-all flex-shrink-0"
    : "p-1.5 sm:p-2 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg transition-all flex-shrink-0";
  const iconSize = variant === "collapsed" ? 14 : 18;

  const rowClass = (active: boolean, danger?: boolean) => cn(
    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-all",
    active
      ? "text-emerald-400 bg-emerald-500/10"
      : danger
        ? "text-[#8e9299] hover:text-red-400 hover:bg-red-500/10"
        : "text-[#e0e0e0] hover:bg-white/5"
  );

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className={cn(triggerClass, statusOk ? "text-emerald-500 hover:bg-emerald-500/10" : "text-red-500 hover:bg-red-500/10")}
        title="Menu"
      >
        <Menu size={iconSize} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-[#151619] border border-[#2a2b2e] rounded-lg shadow-2xl py-1 z-50">
          <button
            onClick={() => { setIsOpen(false); onToggleConnect(); }}
            className={rowClass(false)}
          >
            {uiConnected ? <Unplug size={16} className="text-red-500" /> : <Plug size={16} className="text-emerald-500" />}
            {uiConnected ? "Disconnect" : "Connect"}
          </button>
          <button
            onClick={() => { setIsOpen(false); onOpenSettings(); }}
            className={rowClass(false)}
          >
            <Settings size={16} className={rigctldRunning ? "text-emerald-500" : "text-red-500"} />
            Rigctld Settings
          </button>
          <button
            onClick={() => { setIsOpen(false); onToggleEditMode(); }}
            className={rowClass(isEditMode)}
          >
            <LayoutGrid size={16} />
            {isEditMode ? "Exit Layout Editor" : "Edit Layout"}
          </button>
          <button
            onClick={() => { setIsOpen(false); onToggleFullscreen(); }}
            className={rowClass(isFullscreenActive)}
          >
            {isFullscreenActive ? <Minimize size={16} /> : <Maximize size={16} />}
            {isFullscreenActive ? "Exit Full Screen" : "Full Screen & Stay Awake"}
          </button>
          <button
            onClick={() => { setIsOpen(false); onLogout(); }}
            className={rowClass(false, true)}
          >
            <LogOut size={16} />
            {`Sign out (${callsign})`}
          </button>
        </div>
      )}
    </div>
  );
}

export default React.memo(PhoneHeaderMenu);
