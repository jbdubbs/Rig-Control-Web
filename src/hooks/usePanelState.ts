import { useState, useEffect, useRef } from "react";

export function usePanelState() {
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [phoneMeterTab, setPhoneMeterTab] = useState<'signal' | 'swr' | 'alc'>('signal');
  const [activeMeter, setActiveMeter] = useState<'signal' | 'swr' | 'alc' | 'vdd'>('signal');

  const [isPhoneVFOCollapsed, setIsPhoneVFOCollapsed] = useState(true);
  const [isPhoneMeterCollapsed, setIsPhoneMeterCollapsed] = useState(true);
  const [isPhoneQuickControlsCollapsed, setIsPhoneQuickControlsCollapsed] = useState(true);

  const [isCompactSMeterCollapsed, setIsCompactSMeterCollapsed] = useState(() => localStorage.getItem("is-compact-smeter-collapsed") === "true");
  const [isCompactControlsCollapsed, setIsCompactControlsCollapsed] = useState(() => localStorage.getItem("is-compact-controls-collapsed") === "true");
  const [isCompactRFPowerCollapsed, setIsCompactRFPowerCollapsed] = useState(() => localStorage.getItem("is-compact-rfpower-collapsed") === "true");

  const [isDesktopControlsCollapsed, setIsDesktopControlsCollapsed] = useState(() => localStorage.getItem("is-desktop-controls-collapsed") === "true");
  const [isDesktopModeCollapsed, setIsDesktopModeCollapsed] = useState(false);
  const [isDesktopBwCollapsed, setIsDesktopBwCollapsed] = useState(false);
  const [isDesktopRFPowerCollapsed, setIsDesktopRFPowerCollapsed] = useState(false);
  const [isDesktopSMeterCollapsed, setIsDesktopSMeterCollapsed] = useState(false);
  const [isDesktopSWRCollapsed, setIsDesktopSWRCollapsed] = useState(false);
  const [isDesktopALCCollapsed, setIsDesktopALCCollapsed] = useState(false);

  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(() => localStorage.getItem("console-collapsed") === "true");
  const [showCommandConsole, setShowCommandConsole] = useState(() => localStorage.getItem("show-command-console") === "true");

  const prevShowCommandConsoleRef = useRef(localStorage.getItem("show-command-console") === "true");

  useEffect(() => {
    localStorage.setItem("console-collapsed", isConsoleCollapsed.toString());
  }, [isConsoleCollapsed]);

  useEffect(() => {
    localStorage.setItem("show-command-console", showCommandConsole.toString());
    if (showCommandConsole && !prevShowCommandConsoleRef.current) {
      setIsConsoleCollapsed(false);
    }
    prevShowCommandConsoleRef.current = showCommandConsole;
  }, [showCommandConsole]);

  useEffect(() => {
    localStorage.setItem("is-compact-smeter-collapsed", isCompactSMeterCollapsed.toString());
    localStorage.setItem("is-compact-controls-collapsed", isCompactControlsCollapsed.toString());
    localStorage.setItem("is-compact-rfpower-collapsed", isCompactRFPowerCollapsed.toString());
    localStorage.setItem("is-desktop-controls-collapsed", isDesktopControlsCollapsed.toString());
  }, [isCompactSMeterCollapsed, isCompactControlsCollapsed, isCompactRFPowerCollapsed, isDesktopControlsCollapsed]);

  return {
    showSetupModal, setShowSetupModal,
    phoneMeterTab, setPhoneMeterTab,
    activeMeter, setActiveMeter,
    isPhoneVFOCollapsed, setIsPhoneVFOCollapsed,
    isPhoneMeterCollapsed, setIsPhoneMeterCollapsed,
    isPhoneQuickControlsCollapsed, setIsPhoneQuickControlsCollapsed,
    isCompactSMeterCollapsed, setIsCompactSMeterCollapsed,
    isCompactControlsCollapsed, setIsCompactControlsCollapsed,
    isCompactRFPowerCollapsed, setIsCompactRFPowerCollapsed,
    isDesktopControlsCollapsed, setIsDesktopControlsCollapsed,
    isDesktopModeCollapsed, setIsDesktopModeCollapsed,
    isDesktopBwCollapsed, setIsDesktopBwCollapsed,
    isDesktopRFPowerCollapsed, setIsDesktopRFPowerCollapsed,
    isDesktopSMeterCollapsed, setIsDesktopSMeterCollapsed,
    isDesktopSWRCollapsed, setIsDesktopSWRCollapsed,
    isDesktopALCCollapsed, setIsDesktopALCCollapsed,
    isConsoleCollapsed, setIsConsoleCollapsed,
    showCommandConsole, setShowCommandConsole,
  };
}
