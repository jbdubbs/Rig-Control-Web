import { useState } from "react";
import { usePersistedCollapsed } from "./usePersistedCollapsed";

export function usePanelState(callsign = "") {
  const ns = (key: string) =>
    callsign ? `${callsign.toUpperCase()}:${key}` : key;
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [phoneMeterTab, setPhoneMeterTab] = useState<'signal' | 'swr' | 'alc'>('signal');
  const [activeMeter, setActiveMeter] = useState<'signal' | 'swr' | 'alc' | 'vdd'>('signal');

  const [isCompactVFOCollapsed, setIsCompactVFOCollapsed] = usePersistedCollapsed(ns, "compact-vfo-collapsed", "vfo-collapsed", true, callsign);
  const [isPhoneVFOCollapsed, setIsPhoneVFOCollapsed] = usePersistedCollapsed(ns, "phone-vfo-collapsed", "vfo-collapsed", true, callsign);

  const [isCompactVideoCollapsed, setIsCompactVideoCollapsed] = usePersistedCollapsed(ns, "compact-video-feed-collapsed", "video-feed-collapsed", true, callsign);
  const [isPhoneVideoCollapsed, setIsPhoneVideoCollapsed] = usePersistedCollapsed(ns, "phone-video-feed-collapsed", "video-feed-collapsed", true, callsign);

  const [isCompactAudioFeedCollapsed, setIsCompactAudioFeedCollapsed] = usePersistedCollapsed(ns, "compact-audio-feed-collapsed", "audio-feed-collapsed", true, callsign);
  const [isPhoneAudioFeedCollapsed, setIsPhoneAudioFeedCollapsed] = usePersistedCollapsed(ns, "phone-audio-feed-collapsed", "audio-feed-collapsed", true, callsign);

  const [isCompactConsoleCollapsed, setIsCompactConsoleCollapsed] = usePersistedCollapsed(ns, "compact-console-collapsed", "console-collapsed", false, callsign);
  const [isPhoneConsoleCollapsed, setIsPhoneConsoleCollapsed] = usePersistedCollapsed(ns, "phone-console-collapsed", "console-collapsed", false, callsign);

  const [isCompactComboSpotsCollapsed, setIsCompactComboSpotsCollapsed] = usePersistedCollapsed(ns, "compact-combospots-collapsed", "combospots-collapsed", false, callsign);
  const [isPhoneComboSpotsCollapsed, setIsPhoneComboSpotsCollapsed] = usePersistedCollapsed(ns, "phone-combospots-collapsed", null, false, callsign);

  const [isCompactSolarCollapsed, setIsCompactSolarCollapsed] = usePersistedCollapsed(ns, "compact-solar-collapsed", "solar-collapsed", false, callsign);
  const [isPhoneSolarCollapsed, setIsPhoneSolarCollapsed] = usePersistedCollapsed(ns, "phone-solar-collapsed", null, false, callsign);

  const [isCompactMufMapCollapsed, setIsCompactMufMapCollapsed] = usePersistedCollapsed(ns, "compact-mufmap-collapsed", "mufmap-collapsed", true, callsign);
  const [isPhoneMufMapCollapsed, setIsPhoneMufMapCollapsed] = usePersistedCollapsed(ns, "phone-mufmap-collapsed", null, false, callsign);

  const [isCompactCwDecodeCollapsed, setIsCompactCwDecodeCollapsed] = usePersistedCollapsed(ns, "compact-cwdecode-collapsed", "cwdecode-collapsed", false, callsign);
  const [isPhoneCwDecodeCollapsed, setIsPhoneCwDecodeCollapsed] = usePersistedCollapsed(ns, "phone-cwdecode-collapsed", null, false, callsign);

  const [isCompactFt8DecodeCollapsed, setIsCompactFt8DecodeCollapsed] = usePersistedCollapsed(ns, "compact-ft8decode-collapsed", "ft8decode-collapsed", false, callsign);
  const [isPhoneFt8DecodeCollapsed, setIsPhoneFt8DecodeCollapsed] = usePersistedCollapsed(ns, "phone-ft8decode-collapsed", null, false, callsign);

  const [isCompactSpectrumHamlibCollapsed, setIsCompactSpectrumHamlibCollapsed] = usePersistedCollapsed(ns, "compact-spectrum-hamlib-collapsed", "spectrum-hamlib-collapsed", false, callsign);
  const [isPhoneSpectrumHamlibCollapsed, setIsPhoneSpectrumHamlibCollapsed] = usePersistedCollapsed(ns, "phone-spectrum-hamlib-collapsed", null, false, callsign);

  const [isCompactSpectrumAudioCollapsed, setIsCompactSpectrumAudioCollapsed] = usePersistedCollapsed(ns, "compact-spectrum-audio-collapsed", "spectrum-audio-collapsed", false, callsign);
  const [isPhoneSpectrumAudioCollapsed, setIsPhoneSpectrumAudioCollapsed] = usePersistedCollapsed(ns, "phone-spectrum-audio-collapsed", null, false, callsign);

  const [isCompactSMeterCollapsed, setIsCompactSMeterCollapsed] = usePersistedCollapsed(ns, "compact-smeter-collapsed", "is-compact-smeter-collapsed", false, callsign);
  const [isCompactControlsCollapsed, setIsCompactControlsCollapsed] = usePersistedCollapsed(ns, "compact-controls-collapsed", "is-compact-controls-collapsed", false, callsign);
  const [isCompactRFPowerCollapsed, setIsCompactRFPowerCollapsed] = usePersistedCollapsed(ns, "compact-rfpower-collapsed", "is-compact-rfpower-collapsed", false, callsign);

  const [isPhoneMeterCollapsed, setIsPhoneMeterCollapsed] = usePersistedCollapsed(ns, "phone-meter-collapsed", null, true, callsign);
  const [isPhoneQuickControlsCollapsed, setIsPhoneQuickControlsCollapsed] = usePersistedCollapsed(ns, "phone-quickcontrols-collapsed", null, true, callsign);

  const [isCompactHeaderCollapsed, setIsCompactHeaderCollapsed] = usePersistedCollapsed(ns, "compact-header-collapsed", null, false, callsign);
  const [isPhoneHeaderCollapsed, setIsPhoneHeaderCollapsed] = usePersistedCollapsed(ns, "phone-header-collapsed", null, false, callsign);

  return {
    showSetupModal, setShowSetupModal,
    phoneMeterTab, setPhoneMeterTab,
    activeMeter, setActiveMeter,
    isCompactVFOCollapsed, setIsCompactVFOCollapsed,
    isPhoneVFOCollapsed, setIsPhoneVFOCollapsed,
    isCompactVideoCollapsed, setIsCompactVideoCollapsed,
    isPhoneVideoCollapsed, setIsPhoneVideoCollapsed,
    isCompactAudioFeedCollapsed, setIsCompactAudioFeedCollapsed,
    isPhoneAudioFeedCollapsed, setIsPhoneAudioFeedCollapsed,
    isCompactConsoleCollapsed, setIsCompactConsoleCollapsed,
    isPhoneConsoleCollapsed, setIsPhoneConsoleCollapsed,
    isCompactComboSpotsCollapsed, setIsCompactComboSpotsCollapsed,
    isPhoneComboSpotsCollapsed, setIsPhoneComboSpotsCollapsed,
    isCompactSolarCollapsed, setIsCompactSolarCollapsed,
    isPhoneSolarCollapsed, setIsPhoneSolarCollapsed,
    isCompactMufMapCollapsed, setIsCompactMufMapCollapsed,
    isPhoneMufMapCollapsed, setIsPhoneMufMapCollapsed,
    isCompactCwDecodeCollapsed, setIsCompactCwDecodeCollapsed,
    isPhoneCwDecodeCollapsed, setIsPhoneCwDecodeCollapsed,
    isCompactFt8DecodeCollapsed, setIsCompactFt8DecodeCollapsed,
    isPhoneFt8DecodeCollapsed, setIsPhoneFt8DecodeCollapsed,
    isCompactSpectrumHamlibCollapsed, setIsCompactSpectrumHamlibCollapsed,
    isPhoneSpectrumHamlibCollapsed, setIsPhoneSpectrumHamlibCollapsed,
    isCompactSpectrumAudioCollapsed, setIsCompactSpectrumAudioCollapsed,
    isPhoneSpectrumAudioCollapsed, setIsPhoneSpectrumAudioCollapsed,
    isCompactSMeterCollapsed, setIsCompactSMeterCollapsed,
    isCompactControlsCollapsed, setIsCompactControlsCollapsed,
    isCompactRFPowerCollapsed, setIsCompactRFPowerCollapsed,
    isPhoneMeterCollapsed, setIsPhoneMeterCollapsed,
    isPhoneQuickControlsCollapsed, setIsPhoneQuickControlsCollapsed,
    isCompactHeaderCollapsed, setIsCompactHeaderCollapsed,
    isPhoneHeaderCollapsed, setIsPhoneHeaderCollapsed,
  };
}
