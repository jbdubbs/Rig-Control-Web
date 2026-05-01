import { useState, useEffect } from "react";

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

  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(() => localStorage.getItem("console-collapsed") === "true");

  useEffect(() => {
    localStorage.setItem("console-collapsed", isConsoleCollapsed.toString());
  }, [isConsoleCollapsed]);

  useEffect(() => {
    localStorage.setItem("is-compact-smeter-collapsed", isCompactSMeterCollapsed.toString());
    localStorage.setItem("is-compact-controls-collapsed", isCompactControlsCollapsed.toString());
    localStorage.setItem("is-compact-rfpower-collapsed", isCompactRFPowerCollapsed.toString());
  }, [isCompactSMeterCollapsed, isCompactControlsCollapsed, isCompactRFPowerCollapsed]);

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
    isConsoleCollapsed, setIsConsoleCollapsed,
  };
}
