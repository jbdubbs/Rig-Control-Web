import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import {
  Plug,
  Unplug,
  Settings,
  Mic,
  Server,
  Monitor,
  Zap,
  X,
  LayoutGrid,
  LogOut,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "./utils";
import PhoneLayout from "./layouts/PhoneLayout";
import CompactLayout from "./layouts/CompactLayout";
import PhoneStickyBar from "./layouts/PhoneStickyBar";
import SettingsModal from "./modals/SettingsModal";
import VideoSettingsModal from "./modals/VideoSettingsModal";
import AudioSettingsModal from "./modals/AudioSettingsModal";
import LoginScreen from "./components/LoginScreen";
import ChangePasswordModal from "./components/ChangePasswordModal";
import PhoneHeaderMenu from "./components/PhoneHeaderMenu";
import { useAuth } from "./hooks/useAuth";
import { usePotaSpots } from "./hooks/usePotaSpots";
import { useDxSpots } from "./hooks/useDxSpots";
import { useSolarData } from "./hooks/useSolarData";
import { useRigctld } from "./hooks/useRigctld";
import { useCWKeyer } from "./hooks/useCWKeyer";
import { usePttHotkey } from "./hooks/usePttHotkey";
import { useVideoStream } from "./hooks/useVideoStream";
import { useAudio } from "./hooks/useAudio";
import { useRigControl } from "./hooks/useRigControl";
import { useLayoutState } from "./hooks/useLayoutState";
import { useCwDecoder } from "./hooks/useCwDecoder";
import { usePanelState } from "./hooks/usePanelState";
import { useLayoutConfig } from "./hooks/useLayoutConfig";
import { useSpectrum } from "./hooks/useSpectrum";
import { useWsjtxBridge } from "./hooks/useWsjtxBridge";
import { useConsoleCapture } from "./hooks/useConsoleCapture";
import { useFullscreenWakeLock } from "./hooks/useFullscreenWakeLock";
import type { PanelType, PanelAddConfig } from "./types/layout";

// Reconciles a stored backend-url against the page's current origin.
// "protocol-mismatch" self-corrects a stale http<->https value for the same
// host/port (e.g. after the app switched to HTTPS); "invalid" covers a
// stored value that isn't parseable as a URL at all. Pure decision logic —
// the caller is responsible for the localStorage write and the console
// log/warn that accompany each correction.
export function resolveBackendUrl(
  stored: string | null,
  currentOrigin: string,
): { url: string; reason: "none" | "protocol-mismatch" | "invalid" } {
  if (!stored) return { url: currentOrigin, reason: "none" };
  try {
    const storedUrl = new URL(stored);
    const currentUrl = new URL(currentOrigin);
    if (
      storedUrl.hostname === currentUrl.hostname &&
      storedUrl.port === currentUrl.port &&
      storedUrl.protocol !== currentUrl.protocol
    ) {
      return { url: currentOrigin, reason: "protocol-mismatch" };
    }
  } catch {
    return { url: currentOrigin, reason: "invalid" };
  }
  return { url: stored, reason: "none" };
}

export function formatPreampLabel(preamp: number, compact: boolean, levelCount: number = 2): string {
  if (preamp === 0) return compact ? "P.AMP" : "OFF";
  // A single preamp level (e.g. the FT-857's IPO EEPROM bit) is a bypass toggle,
  // not a documented gain figure -- showing a fabricated "NdB" overstates precision
  // that doesn't exist. Multi-level rigs (e.g. FT-710 AMP1/AMP2) have real dB specs.
  if (levelCount <= 1) return "ON";
  return `${preamp}dB`;
}

export function formatAttenuatorLabel(attenuation: number, compact: boolean): string {
  if (attenuation === 0) return compact ? "ATT" : "OFF";
  return `${attenuation}dB`;
}

export function formatAgcLabel(agc: number, agcLevels: string[]): string {
  if (agcLevels.length === 0) return "OFF";
  const parsed = agcLevels.map(l => { const p = l.split('='); return { value: parseInt(p[0]), label: p[1] }; });
  const current = parsed.find(p => p.value === agc);
  return current ? current.label : (agc === 0 ? "OFF" : agc.toString());
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [backendUrl, setBackendUrl] = useState(() => {
    const stored = localStorage.getItem("backend-url");
    const { url, reason } = resolveBackendUrl(stored, window.location.origin);
    if (reason === "protocol-mismatch") {
      console.log(`[INIT] Correcting stale backend-url: ${stored} → ${url}`);
      localStorage.setItem("backend-url", url);
    } else if (reason === "invalid") {
      console.warn("[INIT] Invalid backend-url in storage, resetting to current origin.");
      localStorage.setItem("backend-url", url);
    }
    return url;
  });

  const clientId = useMemo(() => {
    let id = localStorage.getItem("client-id");
    if (!id) {
      id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem("client-id", id);
    }
    return id;
  }, []);

  // ── Socket creation ───────────────────────────────────────────────────────
  useEffect(() => {
    const authToken = localStorage.getItem("auth-token");
    const newSocket = io(backendUrl, {
      transports: ['websocket'],
      auth: { clientId, token: authToken },
    });
    setSocket(newSocket);
    return () => { newSocket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useConsoleCapture(socket, clientId);

  const {
    authState,
    currentUser,
    mustChangePassword,
    loginError,
    retryAfter,
    login,
    logout,
    onPasswordChanged,
  } = useAuth(socket);

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { isCompact, isPhone, stickyBarHeight, containerRef, stickyBarRef } = useLayoutState();
  const [isCompactEditMode, setIsCompactEditMode] = useState(false);
  const [isPhoneEditMode, setIsPhoneEditMode] = useState(false);
  const {
    compactLayout, setCompactLayout,
    phoneLayout, setPhoneLayout,
    addPanel, removePanel, setGridSize,
    updateItemPositions, resetToDefault,
  } = useLayoutConfig(currentUser?.callsign ?? "");

  const hasCwDecodePanel = useMemo(() =>
    compactLayout.items.some(i => i.panelType === 'cwdecode') ||
    phoneLayout.items.some(i => i.panelType === 'cwdecode'),
    [compactLayout.items, phoneLayout.items]
  );

  const hasSolarPanel = useMemo(() =>
    compactLayout.items.some(i => i.panelType === 'solar') ||
    phoneLayout.items.some(i => i.panelType === 'solar'),
    [compactLayout.items, phoneLayout.items]
  );

  const hasWaterfallPanel = useMemo(() =>
    compactLayout.items.some(i => i.panelType === 'spectrum_audio') ||
    phoneLayout.items.some(i => i.panelType === 'spectrum_audio'),
    [compactLayout.items, phoneLayout.items]
  );

  const compactGridCallbacks = useMemo(() => ({
    onExitEditMode: () => setIsCompactEditMode(false),
    addPanel: (panelType: PanelType, config?: PanelAddConfig) => addPanel('compact', panelType, config),
    removePanel: (itemId: string) => removePanel('compact', itemId),
    setGridSize: (cols: number, rows: number) => setGridSize('compact', cols, rows),
    updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => updateItemPositions('compact', positions),
    resetToDefault: () => resetToDefault('compact'),
  }), [addPanel, removePanel, setGridSize, updateItemPositions, resetToDefault]);

  const phoneGridCallbacks = useMemo(() => ({
    onExitEditMode: () => setIsPhoneEditMode(false),
    addPanel: (panelType: PanelType, config?: PanelAddConfig) => addPanel('phone', panelType, config),
    removePanel: (itemId: string) => removePanel('phone', itemId),
    setGridSize: (cols: number, rows: number) => setGridSize('phone', cols, rows),
    updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => updateItemPositions('phone', positions),
    resetToDefault: () => resetToDefault('phone'),
  }), [addPanel, removePanel, setGridSize, updateItemPositions, resetToDefault]);

  const {
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
  } = usePanelState(currentUser?.callsign ?? "");

  const {
    cwDecodedText, setCwDecodedText,
    cwStats,
    cwDecoderRef,
    cwDecodeEnabledRef,
    cwScrollContainerRef,
  } = useCwDecoder(hasCwDecodePanel);

  const { solarData, requestSolarData } = useSolarData(socket, hasSolarPanel);

  const {
    spectrumSupported,
    spectrumEnabled,
    spectrumSettings,
    setSpectrumSettings,
    latestSpectrumRef,
    waterfallHistoryRef,
  } = useSpectrum(socket);

  const {
    rigctldSettings, setRigctldSettings,
    rigctldSettingsRef,
    settingsLoaded, setSettingsLoaded,
    statusLoaded,
    isSettingsOpen, setIsSettingsOpen,
    activeSettingsTab, setActiveSettingsTab,
    radios,
    serialPorts,
    rigctldProcessStatus,
    preampLevels,
    attenuatorLevels,
    agcLevels,
    rigctldLogs, setRigctldLogs,
    rigctldVersionInfo,
    testResult,
    nbCapabilities,
    nrCapabilities,
    anfCapabilities,
    rfPowerCapabilities,
    rfLevelCapabilities,
    logEndRef,
    isSettingsValid,
  } = useRigctld({ socket });

  const {
    videoError, setVideoError,
    videoStatus,
    videoSettings, setVideoSettings,
    videoAutoStart,
    videoDevices,
    isElectronSource,
    isVideoSettingsOpen, setIsVideoSettingsOpen,
    resolutionDraft, setResolutionDraft,
    resolutionDraftRef,
    isResolutionFocusedRef,
    resolutionDebounceRef,
    videoSettingsRef,
    videoCanvasRef,
    videoPreviewCallbackRef,
    enumerateVideoDevices,
    startVideoCapture,
    stopVideoCapture,
  } = useVideoStream({ socket, settingsLoaded });

  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState(false);

  const waterfallActiveRef = useRef(false);
  useEffect(() => {
    const collapsed = isCompact ? isCompactSpectrumAudioCollapsed : isPhoneSpectrumAudioCollapsed;
    waterfallActiveRef.current = hasWaterfallPanel && !collapsed;
  }, [hasWaterfallPanel, isCompact, isCompactSpectrumAudioCollapsed, isPhoneSpectrumAudioCollapsed]);

  const {
    activeMicClientId,
    audioStatus,
    audioEngineState,
    audioDevices,
    audioSettings, setAudioSettings,
    audioSettingsDenied,
    localAudioDevices, setLocalAudioDevices,
    localAudioSettings, setLocalAudioSettings,
    inboundMuted, setInboundMuted,
    inboundVolume, setInboundVolume,
    outboundMuted, setOutboundMuted,
    localAudioReady,
    audioWasRestarted, setAudioWasRestarted,
    isBackendEngineCollapsed, toggleBackendEngineCollapsed,
    audioContextRef,
    inboundGainRef,
    analyserNodeRef,
    initLocalAudioPipeline,
    handleStartAudio,
    startMicCapture,
    stopMicCapture,
    updateWsjtxOutput,
  } = useAudio({ socket, cwDecodeEnabledRef, cwDecoderRef, waterfallActiveRef });

  const { isActive: isFullscreenWakeLockActive, toggle: toggleFullscreenWakeLock } = useFullscreenWakeLock();

  const {
    connected,
    uiConnected,
    vfoSupported,
    host, setHost,
    port, setPort,
    status, setStatus,
    history,
    pollRate,
    vfoA, setVfoA,
    vfoB, setVfoB,
    error,
    rigConnecting,
    opError,
    rawCommand, setRawCommand,
    consoleLogs,
    availableModes,
    vfoStep, setVfoStep,
    inputVfoA, setInputVfoA,
    inputVfoB, setInputVfoB,
    localMode,
    localRFPower, setLocalRFPower,
    localRFLevel, setLocalRFLevel,
    localNRLevel, setLocalNRLevel,
    localNBLevel, setLocalNBLevel,
    isTuning,
    tuneJustFinished,
    isDraggingRF,
    isDraggingRFLevel,
    isDraggingNR,
    isDraggingNB,
    skipPollsCount,
    handleConnect,
    handleSetFreq,
    adjustVfoFrequency,
    handleSetMode,
    handleSetBw,
    handleSetPTT,
    handleSetVFO,
    handleToggleSplit,
    handlePollRateChange,
    handleSetFunc,
    handleSetLevel,
    cyclePreamp,
    cycleAttenuator,
    cycleAgc,
    handleVfoOp,
    handleSendRaw,
    powerSupported,
    poweringOn,
    handleSetPower,
    effectivelyConnected,
  } = useRigControl({
    socket,
    nrCapabilities,
    preampLevels,
    attenuatorLevels,
    agcLevels,
    localAudioReady,
    outboundMuted,
    setOutboundMuted,
  });

  const {
    cwSettings, setCwSettings,
    cwSettingsRef,
    cwPortStatus,
    cwKeyActive,
    cwStuckAlert, setCwStuckAlert,
    rebindTarget, setRebindTarget,
    rebindError: cwRebindError,
    sidetoneOscRef,
    sidetoneCtxRef,
    emitCwPaddle,
    ditPressedRef,
    dahPressedRef,
  } = useCWKeyer({ socket, connected, localAudioOutputDevice: localAudioSettings.outputDevice, pttKeyRef: rigctldSettingsRef });

  const {
    pttRebindActive, setPttRebindActive,
    pttRebindError,
  } = usePttHotkey({
    connected: effectivelyConnected,
    rigctldSettings,
    setRigctldSettings,
    handleSetPTT,
    cwSettingsRef,
  });

  const {
    bridgeEnabled, setBridgeEnabled,
    wsPort: wsjtxWsPort, setWsPort: setWsjtxWsPort,
    bridgeConnected,
  } = useWsjtxBridge({ socket, rigStatus: status });

  const potaEnabled = useMemo(() => {
    const items = isPhone ? phoneLayout.items : compactLayout.items;
    return items.some(i => i.panelType === 'spots_pota' || i.panelType === 'spots_combo');
  }, [isPhone, compactLayout.items, phoneLayout.items]);

  const sotaEnabled = useMemo(() => {
    const items = isPhone ? phoneLayout.items : compactLayout.items;
    return items.some(i => i.panelType === 'spots_sota' || i.panelType === 'spots_combo');
  }, [isPhone, compactLayout.items, phoneLayout.items]);

  const wwffEnabled = useMemo(() => {
    const items = isPhone ? phoneLayout.items : compactLayout.items;
    return items.some(i => i.panelType === 'spots_wwff' || i.panelType === 'spots_combo');
  }, [isPhone, compactLayout.items, phoneLayout.items]);

  const {
    potaPollRate, setPotaPollRate,
    potaMaxAge, setPotaMaxAge,
    potaModeFilter, setPotaModeFilter,
    potaBandFilter, setPotaBandFilter,
    potaSortCol,
    potaSortDir,
    isCompactPotaSpotsCollapsed, setIsCompactPotaSpotsCollapsed,
    isPhonePotaSpotsCollapsed, setIsPhonePotaSpotsCollapsed,
    sotaPollRate, setSotaPollRate,
    sotaMaxAge, setSotaMaxAge,
    sotaModeFilter, setSotaModeFilter,
    sotaBandFilter, setSotaBandFilter,
    sotaSortCol,
    sotaSortDir,
    isCompactSotaSpotsCollapsed, setIsCompactSotaSpotsCollapsed,
    isPhoneSotaSpotsCollapsed, setIsPhoneSotaSpotsCollapsed,
    wwffPollRate, setWwffPollRate,
    wwffMaxAge, setWwffMaxAge,
    wwffModeFilter, setWwffModeFilter,
    wwffBandFilter, setWwffBandFilter,
    wwffSortCol,
    wwffSortDir,
    isCompactWwffSpotsCollapsed, setIsCompactWwffSpotsCollapsed,
    isPhoneWwffSpotsCollapsed, setIsPhoneWwffSpotsCollapsed,
    filteredSpots,
    filteredSotaSpots,
    filteredWwffSpots,
    displayedSpots,
    displayedSotaSpots,
    displayedWwffSpots,
    renderSpotsTable,
    renderSotaSpotsTable,
    renderWwffSpotsTable,
  } = usePotaSpots({
    socket,
    connected,
    status,
    inputVfoA,
    inputVfoB,
    availableModes,
    skipPollsCount,
    setStatus,
    potaEnabled,
    sotaEnabled,
    wwffEnabled,
    callsign: currentUser?.callsign ?? "",
  });

  const {
    dxClusterEnabled, setDxClusterEnabled,
    dxHost, setDxHost,
    dxPort, setDxPort,
    dxLoginCallsign, setDxLoginCallsign,
    dxMaxAge, setDxMaxAge,
    dxCallsignFilter, setDxCallsignFilter,
    dxKeywordFilter, setDxKeywordFilter,
    dxBandFilter, setDxBandFilter,
    dxConnected,
    dxError,
    isCompactDxSpotsCollapsed, setIsCompactDxSpotsCollapsed,
    isPhoneDxSpotsCollapsed, setIsPhoneDxSpotsCollapsed,
    filteredDxSpots,
    renderDxSpotsTable,
  } = useDxSpots({
    socket,
    connected,
    status,
    inputVfoA,
    inputVfoB,
    availableModes,
    skipPollsCount,
    setStatus,
    settingsLoaded,
    callsign: currentUser?.callsign ?? "",
  });

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("backend-url", backendUrl);
  }, [backendUrl]);

  // Save settings debounce — only fires after server settings have been loaded to prevent
  // overwriting persisted values with React's initial default state during startup.
  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = setTimeout(() => {
      socket?.emit("save-settings", {
        settings: rigctldSettings,
        pollRate,
        clientHost: host,
        clientPort: port,
        potaSettings: { pollRate: potaPollRate, maxAge: potaMaxAge, modeFilter: potaModeFilter, bandFilter: potaBandFilter },
        sotaSettings: { pollRate: sotaPollRate, maxAge: sotaMaxAge, modeFilter: sotaModeFilter, bandFilter: sotaBandFilter },
        wwffSettings: { pollRate: wwffPollRate, maxAge: wwffMaxAge, modeFilter: wwffModeFilter, bandFilter: wwffBandFilter },
      });
      localStorage.setItem("last-poll-rate", pollRate.toString());
      localStorage.setItem("last-host", host);
      localStorage.setItem("last-port", port.toString());
    }, 1000);
    return () => clearTimeout(timer);
  }, [rigctldSettings, host, port, pollRate, socket, settingsLoaded, potaPollRate, potaMaxAge, potaModeFilter, potaBandFilter, sotaPollRate, sotaMaxAge, sotaModeFilter, sotaBandFilter, wwffPollRate, wwffMaxAge, wwffModeFilter, wwffBandFilter]);

  // Notify server which meters need computing based on visible layout
  useEffect(() => {
    if (!socket) return;
    const visible = [];
    const isPtt = status?.ptt || false;
    if (isCompact) {
      if (activeMeter === 'swr' && isPtt) visible.push('swr');
      if (activeMeter === 'alc' && isPtt) visible.push('alc');
      if (activeMeter === 'vdd') visible.push('vdd');
    } else {
      if (isPtt) { visible.push('swr', 'alc', 'vdd'); }
    }
    socket.emit("set-visible-meters", visible);
  }, [socket, isCompact, activeMeter, status?.ptt]);

  // ── Label helpers (depend on isCompact/isPhone layout state) ─────────────
  const getPreampLabel = useCallback(
    () => formatPreampLabel(status.preamp, isCompact || isPhone, preampLevels.length),
    [status.preamp, isCompact, isPhone, preampLevels.length]
  );

  const getAttenuatorLabel = useCallback(
    () => formatAttenuatorLabel(status.attenuation, isCompact || isPhone),
    [status.attenuation, isCompact, isPhone]
  );

  const getAgcLabel = useCallback(
    () => formatAgcLabel(status.agc, agcLevels),
    [status.agc, agcLevels]
  );

  // ── WSJTX bridge auto-setup ───────────────────────────────────────────────
  const [wsjtxAutoSetupActive, setWsjtxAutoSetupActive] = useState(false);
  const [wsjtxAutoSetupWarning, setWsjtxAutoSetupWarning] = useState<string | null>(null);
  const preWsjtxStateRef = useRef<{
    inputDevice: string;
    outboundMuted: boolean;
  } | null>(null);
  const wsjtxPendingUnmuteRef = useRef(false);
  const preBridgeEnhancementsRef = useRef<boolean | null>(null);

  // Digital-mode audio (FT8/PSK/etc tones) is corrupted by voice-oriented DSP —
  // force Audio Enhancements off for the duration of the bridge session, restore after.
  useEffect(() => {
    if (bridgeEnabled) {
      preBridgeEnhancementsRef.current = localAudioSettings.enhancementsEnabled;
      setLocalAudioSettings(prev => ({ ...prev, enhancementsEnabled: false }));
      localStorage.setItem("local-audio-enhancements", "false");
    } else if (preBridgeEnhancementsRef.current !== null) {
      const restored = preBridgeEnhancementsRef.current;
      setLocalAudioSettings(prev => ({ ...prev, enhancementsEnabled: restored }));
      localStorage.setItem("local-audio-enhancements", String(restored));
      preBridgeEnhancementsRef.current = null;
    }
  }, [bridgeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bridgeConnected) {
      // Bridge disconnected — restore stashed state if we auto-configured
      if (wsjtxAutoSetupActive) {
        const stashed = preWsjtxStateRef.current;
        if (stashed) {
          setLocalAudioSettings(prev => ({ ...prev, inputDevice: stashed.inputDevice }));
          localStorage.setItem("local-audio-input", stashed.inputDevice);
          setOutboundMuted(stashed.outboundMuted);
          if (stashed.outboundMuted) {
            socket?.emit("mic-mute-notify");
          } else {
            socket?.emit("mic-unmute-request");
          }
        }
        updateWsjtxOutput("");
        preWsjtxStateRef.current = null;
        setWsjtxAutoSetupActive(false);
        wsjtxPendingUnmuteRef.current = false;
      }
      setWsjtxAutoSetupWarning(null);
      return;
    }

    // Bridge just connected — auto-configure audio devices
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter(d => d.kind === "audiooutput");
        const inputs = devices.filter(d => d.kind === "audioinput");

        // Try Linux PipeWire devices first
        let rxDevice = outputs.find(d => /RCW-WSJTX-RX/i.test(d.label));
        let txDevice = inputs.find(d => /RCW-WSJTX-TX/i.test(d.label));

        // Fall back to Windows VB-Audio virtual cables (need two distinct cables for bidirectional audio)
        if (!rxDevice || !txDevice) {
          const cablePatterns = [
            { id: "vb-cable", pattern: /VB-Audio Virtual Cable/i },
            { id: "hifi",    pattern: /VB-Audio Hi-Fi Cable/i },
            { id: "cable-a", pattern: /VB-Audio Cable A\b/i },
            { id: "cable-b", pattern: /VB-Audio Cable B\b/i },
            { id: "cable-c", pattern: /VB-Audio Cable C\b/i },
            { id: "cable-d", pattern: /VB-Audio Cable D\b/i },
          ];
          const foundCables: { id: string; output: MediaDeviceInfo; input: MediaDeviceInfo }[] = [];
          for (const { id, pattern } of cablePatterns) {
            const out = outputs.find(d => pattern.test(d.label));
            const inp = inputs.find(d => pattern.test(d.label));
            if (out && inp) foundCables.push({ id, output: out, input: inp });
          }
          if (foundCables.length >= 2) {
            rxDevice = foundCables[0].output;
            txDevice = foundCables[1].input;
            console.log(`[WSJTX-AUTO] RX (browser→WSJTX): ${foundCables[0].id} — "${rxDevice.label}"`);
            console.log(`[WSJTX-AUTO] TX (WSJTX→browser): ${foundCables[1].id} — "${txDevice.label}"`);
          } else if (foundCables.length === 1) {
            setWsjtxAutoSetupWarning(
              `Only one virtual cable detected (${foundCables[0].id}). Install a second VB-Audio cable (either adding Hi-Fi CABLE or donating for VB-CABLE A&B at vb-audio.com), or configure manually.`
            );
            return;
          }
        }

        if (!rxDevice || !txDevice) {
          const isWindows = /windows/i.test(navigator.userAgent);
          setWsjtxAutoSetupWarning(isWindows
            ? "Virtual audio cables not detected — install VB-CABLE A&B (donation) or VB-CABLE and Hi-Fi CABLE from vb-audio.com, or configure manually."
            : "Virtual audio devices not found. Run wsjtx-bridge-linux in a terminal first, or configure manually."
          );
          return;
        }

        setWsjtxAutoSetupWarning(null);

        // Stash current state before switching
        preWsjtxStateRef.current = {
          inputDevice: localAudioSettings.inputDevice,
          outboundMuted,
        };

        // Switch to virtual devices
        setLocalAudioSettings(prev => ({ ...prev, inputDevice: txDevice.deviceId }));
        localStorage.setItem("local-audio-input", txDevice.deviceId);
        await updateWsjtxOutput(rxDevice.deviceId);

        setWsjtxAutoSetupActive(true);

        // Defer unmute until localAudioReady is true
        wsjtxPendingUnmuteRef.current = true;
      } catch (err) {
        console.error("[WSJTX-AUTO] Failed to auto-configure audio:", err);
        setWsjtxAutoSetupWarning("Failed to detect audio devices — configure manually.");
      }
    })();
  }, [bridgeConnected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Complete the auto-unmute once the audio pipeline is ready
  useEffect(() => {
    if (wsjtxPendingUnmuteRef.current && localAudioReady && audioStatus === "playing") {
      wsjtxPendingUnmuteRef.current = false;
      setOutboundMuted(false);
      socket?.emit("mic-unmute-request");
    }
  }, [localAudioReady, audioStatus, socket, setOutboundMuted]);

  // ── Cross-hook bridge ─────────────────────────────────────────────────────
  const handleJoinAudio = useCallback(async () => {
    const explicitInput = localStorage.getItem("local-audio-input");
    const explicitOutput = localStorage.getItem("local-audio-output");
    if (!explicitInput && !explicitOutput) {
      setIsAudioSettingsOpen(true);
      socket?.emit("get-audio-devices");
      return;
    }
    await initLocalAudioPipeline();
  }, [socket, initLocalAudioPipeline]);

  // ── Auth gates ────────────────────────────────────────────────────────────
  if (authState === "unknown") {
    return <div className="min-h-screen bg-[#0a0a0a]" />;
  }
  if (authState === "unauthenticated") {
    return (
      <LoginScreen
        onLogin={login}
        loginError={loginError}
        retryAfter={retryAfter}
      />
    );
  }
  if (authState === "must-change-password") {
    return (
      <ChangePasswordModal
        socket={socket}
        callsign={currentUser?.callsign ?? ""}
        forced={true}
        onSuccess={onPasswordChanged}
      />
    );
  }

  const isHeaderCollapsed = isPhone ? isPhoneHeaderCollapsed : isCompactHeaderCollapsed;
  const setHeaderCollapsed = isPhone ? setIsPhoneHeaderCollapsed : setIsCompactHeaderCollapsed;
  const headerNotice = status?.powerState === 'off'
    ? { tone: 'red' as const, text: 'Radio powered down — Power on to resume', shortText: 'Radio powered down' }
    : cwSettings.enabled && connected && !['CW', 'CWR', 'CW-R'].includes(status?.mode || '')
      ? { tone: 'amber' as const, text: 'Radio not in CW mode — Switch mode to key', shortText: 'Not in CW mode' }
      : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={cn(
      "bg-[#0a0a0a] text-[#e0e0e0] font-mono",
      isPhone ? "h-[100dvh] flex flex-col overflow-hidden" : "p-2 min-h-screen"
    )}>
      {/* CW stuck-key safety alert */}
      {cwStuckAlert && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500 text-red-200 text-xs font-bold px-4 py-2 rounded-lg shadow-xl flex items-center gap-2">
          <span className="text-red-400">⚠</span>
          CW stuck-key safety triggered — release key to continue
          <button onClick={() => setCwStuckAlert(false)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      <div
        ref={containerRef}
        className={cn(
          isPhone ? "flex-1 overflow-y-auto p-2 w-full space-y-4" : "mx-auto space-y-4",
          !isPhone && "w-full"
        )}
      >
        {/* Header / Connection */}
        {isHeaderCollapsed ? (
          <header className="bg-[#151619] rounded-xl border border-[#2a2b2e] shadow-2xl py-1 px-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <img src="/rcw-r-64.png" className="w-5 h-5 flex-shrink-0" alt="" />
            </div>
            {headerNotice ? (
              <span className={cn(
                "flex-1 text-center truncate text-[10px] font-bold px-2 py-0.5 rounded border",
                headerNotice.tone === 'red'
                  ? "bg-red-900/40 border-red-500/60 text-red-300"
                  : "bg-amber-900/40 border-amber-500/60 text-amber-300"
              )}>
                {headerNotice.shortText}
              </span>
            ) : (
              <div className="flex-1" />
            )}
            <div className="flex items-center gap-1 flex-shrink-0">
              {isCompact && (
                <>
                  <button
                    onClick={handleConnect}
                    className={cn(
                      "p-1 rounded transition-all flex-shrink-0",
                      uiConnected
                        ? "text-red-500 hover:bg-red-500/10"
                        : "text-emerald-500 hover:bg-emerald-500/10"
                    )}
                    title={uiConnected ? "Disconnect" : "Connect"}
                  >
                    {uiConnected ? <Unplug size={14} /> : <Plug size={14} />}
                  </button>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className={cn(
                      "p-1 rounded transition-all flex-shrink-0",
                      rigctldProcessStatus === "running" ? "text-emerald-500 hover:bg-emerald-500/10" : "text-red-500 hover:bg-red-500/10"
                    )}
                    title="Rigctld Settings"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    onClick={() => setIsCompactEditMode(v => !v)}
                    className={cn(
                      "p-1 rounded transition-all flex-shrink-0",
                      isCompactEditMode
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-[#8e9299] hover:text-emerald-400"
                    )}
                    title={isCompactEditMode ? "Exit layout editor" : "Edit layout"}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    onClick={logout}
                    className="p-1 rounded text-[#8e9299] hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0"
                    title={`Sign out (${currentUser?.callsign ?? ''})`}
                  >
                    <LogOut size={14} />
                  </button>
                </>
              )}
              {isPhone && (
                <PhoneHeaderMenu
                  variant="collapsed"
                  uiConnected={uiConnected}
                  onToggleConnect={handleConnect}
                  rigctldRunning={rigctldProcessStatus === "running"}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                  isEditMode={isPhoneEditMode}
                  onToggleEditMode={() => setIsPhoneEditMode(v => !v)}
                  isFullscreenActive={isFullscreenWakeLockActive}
                  onToggleFullscreen={toggleFullscreenWakeLock}
                  onLogout={logout}
                  callsign={currentUser?.callsign ?? ''}
                />
              )}
              <button
                onClick={() => setHeaderCollapsed(false)}
                className="p-1 hover:bg-white/5 rounded text-[#8e9299] flex-shrink-0"
                title="Expand header"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </header>
        ) : (
          <header className="bg-[#151619] rounded-xl border border-[#2a2b2e] shadow-2xl py-1.5 px-3 sm:p-4 flex items-center justify-between gap-2">
            <div className="flex sm:hidden items-center gap-2 flex-shrink-0">
              <span className="text-sm font-bold tracking-tight uppercase text-center">RigControl Web</span>
            </div>
            <div className="hidden sm:flex items-center gap-3 min-w-0">
              <img src="/rcw-r-64.png" className="w-7 h-7 flex-shrink-0" alt="" />
              <h1 className="text-xl font-bold tracking-tighter uppercase truncate">RigControl Web</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              {isCompact && (
                <>
                  <button
                    onClick={handleConnect}
                    className={cn(
                      "p-1.5 sm:px-6 sm:py-2 rounded-lg font-bold uppercase text-sm transition-all flex items-center gap-2",
                      uiConnected
                        ? "bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white"
                        : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 hover:bg-emerald-500 hover:text-white"
                    )}
                  >
                    {uiConnected ? <Unplug size={16} className="flex-shrink-0" /> : <Plug size={16} className="flex-shrink-0" />}
                    <span className="hidden sm:inline">{uiConnected ? "Disconnect" : "Connect"}</span>
                  </button>
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className={cn(
                      "p-1.5 sm:p-2 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg transition-all flex-shrink-0",
                      rigctldProcessStatus === "running" ? "text-emerald-500 border-emerald-500/50" : "text-red-500 border-red-500/50"
                    )}
                    title="Rigctld Settings"
                  >
                    <Settings size={18} />
                  </button>
                  <button
                    onClick={() => setIsCompactEditMode(v => !v)}
                    className={cn(
                      "p-1.5 sm:p-2 bg-[#0a0a0a] border rounded-lg transition-all flex-shrink-0",
                      isCompactEditMode
                        ? "text-emerald-400 border-emerald-500/70 bg-emerald-500/10"
                        : "text-[#8e9299] border-[#2a2b2e] hover:text-emerald-400"
                    )}
                    title={isCompactEditMode ? "Exit layout editor" : "Edit layout"}
                  >
                    <LayoutGrid size={18} />
                  </button>
                  <button
                    onClick={logout}
                    className="p-1.5 sm:p-2 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-[#8e9299] hover:text-red-400 hover:border-red-500/50 transition-all flex-shrink-0"
                    title={`Sign out (${currentUser?.callsign ?? ''})`}
                  >
                    <LogOut size={18} />
                  </button>
                </>
              )}
              {isPhone && (
                <PhoneHeaderMenu
                  variant="expanded"
                  uiConnected={uiConnected}
                  onToggleConnect={handleConnect}
                  rigctldRunning={rigctldProcessStatus === "running"}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                  isEditMode={isPhoneEditMode}
                  onToggleEditMode={() => setIsPhoneEditMode(v => !v)}
                  isFullscreenActive={isFullscreenWakeLockActive}
                  onToggleFullscreen={toggleFullscreenWakeLock}
                  onLogout={logout}
                  callsign={currentUser?.callsign ?? ''}
                />
              )}
              <button
                onClick={() => setHeaderCollapsed(true)}
                className="p-1.5 sm:p-2 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg text-[#8e9299] hover:text-white transition-all flex-shrink-0"
                title="Collapse header"
              >
                <ChevronUp size={18} />
              </button>
            </div>
          </header>
        )}

        {!isHeaderCollapsed && headerNotice && (
          <div className={cn(
            "text-xs font-bold px-3 py-2 rounded-xl text-center border",
            headerNotice.tone === 'red'
              ? "bg-red-900/40 border-red-500/60 text-red-300"
              : "bg-amber-900/40 border-amber-500/60 text-amber-300"
          )}>
            {headerNotice.text}
          </div>
        )}

        {rigConnecting && !rigConnecting.auto && !error && !rigConnecting.knownPoweredOff && (
          <div className="bg-blue-500/10 border border-blue-500/30 px-4 py-3 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
            <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
            <span className="text-xs text-blue-300">
              {rigConnecting.attempt === 1
                ? "Connecting to rigctld…"
                : `Connecting to rigctld… (retry ${rigConnecting.attempt - 1} of ${rigConnecting.maxAttempts - 1})`}
            </span>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 px-4 py-3 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
            <div className="p-1.5 bg-red-500/20 rounded-full text-red-500 shrink-0">
              <Settings size={16} />
            </div>
            <p className="text-xs text-red-400/90">{error}</p>
          </div>
        )}

        {opError && (
          <div className="bg-amber-500/10 border border-amber-500/40 px-4 py-2.5 rounded-lg flex items-center gap-3 text-sm text-amber-400 animate-in fade-in slide-in-from-top-2">
            <Zap size={14} className="shrink-0" />
            <span className="flex-1">{opError}</span>
          </div>
        )}

        {/* Main Interface */}
        {isPhone ? (
          <PhoneLayout
            status={status}
            connected={effectivelyConnected}
            powerSupported={powerSupported}
            poweringOn={poweringOn}
            knownPoweredOff={rigConnecting?.knownPoweredOff === true}
            handleSetPower={handleSetPower}
            availableModes={availableModes}
            socket={socket}
            vfoStep={vfoStep}
            inputVfoA={inputVfoA}
            inputVfoB={inputVfoB}
            localMode={localMode}
            setVfoStep={setVfoStep}
            setInputVfoA={setInputVfoA}
            setInputVfoB={setInputVfoB}
            isPhoneVFOCollapsed={isPhoneVFOCollapsed}
            setIsPhoneVFOCollapsed={setIsPhoneVFOCollapsed}
            adjustVfoFrequency={adjustVfoFrequency}
            handleSetVFO={handleSetVFO}
            handleToggleSplit={handleToggleSplit}
            handleSetFreq={handleSetFreq}
            handleSetMode={handleSetMode}
            handleSetBw={handleSetBw}
            bwDisabled={connected && status?.bandwidth === "0"}
            videoStatus={videoStatus}
            isVideoCollapsed={isPhoneVideoCollapsed}
            isElectronSource={isElectronSource}
            videoError={videoError}
            videoPreviewCallbackRef={videoPreviewCallbackRef}
            videoCanvasRef={videoCanvasRef}
            setIsVideoCollapsed={setIsPhoneVideoCollapsed}
            setIsVideoSettingsOpen={setIsVideoSettingsOpen}
            setVideoError={setVideoError}
            enumerateVideoDevices={enumerateVideoDevices}
            audioStatus={audioStatus}
            isAudioFeedCollapsed={isPhoneAudioFeedCollapsed}
            setIsAudioFeedCollapsed={setIsPhoneAudioFeedCollapsed}
            setIsAudioSettingsOpen={setIsAudioSettingsOpen}
            localAudioReady={localAudioReady}
            inboundMuted={inboundMuted}
            outboundMuted={outboundMuted}
            audioSettings={audioSettings}
            audioWasRestarted={audioWasRestarted}
            setInboundMuted={setInboundMuted}
            setOutboundMuted={setOutboundMuted}
            handleJoinAudio={handleJoinAudio}
            isPhoneMeterCollapsed={isPhoneMeterCollapsed}
            phoneMeterTab={phoneMeterTab}
            history={history}
            setIsPhoneMeterCollapsed={setIsPhoneMeterCollapsed}
            setPhoneMeterTab={setPhoneMeterTab}
            isPhoneQuickControlsCollapsed={isPhoneQuickControlsCollapsed}
            isTuning={isTuning}
            tuneJustFinished={tuneJustFinished}
            attenuatorLevels={attenuatorLevels}
            preampLevels={preampLevels}
            agcLevels={agcLevels}
            nbCapabilities={nbCapabilities}
            nrCapabilities={nrCapabilities}
            anfCapabilities={anfCapabilities}
            localRFPower={localRFPower}
            rfPowerCapabilities={rfPowerCapabilities}
            rfLevelCapabilities={rfLevelCapabilities}
            localRFLevel={localRFLevel}
            localNRLevel={localNRLevel}
            localNBLevel={localNBLevel}
            isDraggingRF={isDraggingRF}
            isDraggingRFLevel={isDraggingRFLevel}
            isDraggingNR={isDraggingNR}
            isDraggingNB={isDraggingNB}
            setIsPhoneQuickControlsCollapsed={setIsPhoneQuickControlsCollapsed}
            setLocalRFPower={setLocalRFPower}
            setLocalRFLevel={setLocalRFLevel}
            setLocalNRLevel={setLocalNRLevel}
            setLocalNBLevel={setLocalNBLevel}
            handleSetFunc={handleSetFunc}
            handleVfoOp={handleVfoOp}
            cycleAttenuator={cycleAttenuator}
            cyclePreamp={cyclePreamp}
            cycleAgc={cycleAgc}
            getAttenuatorLabel={getAttenuatorLabel}
            getPreampLabel={getPreampLabel}
            getAgcLabel={getAgcLabel}
            potaSpotsCollapsed={isPhonePotaSpotsCollapsed}
            filteredSpots={filteredSpots}
            setPotaSpotsCollapsed={setIsPhonePotaSpotsCollapsed}
            potaPollRate={potaPollRate}
            setPotaPollRate={setPotaPollRate}
            potaMaxAge={potaMaxAge}
            setPotaMaxAge={setPotaMaxAge}
            potaModeFilter={potaModeFilter}
            setPotaModeFilter={setPotaModeFilter}
            potaBandFilter={potaBandFilter}
            setPotaBandFilter={setPotaBandFilter}
            renderSpotsTable={renderSpotsTable}
            sotaSpotsCollapsed={isPhoneSotaSpotsCollapsed}
            filteredSotaSpots={filteredSotaSpots}
            setSotaSpotsCollapsed={setIsPhoneSotaSpotsCollapsed}
            sotaPollRate={sotaPollRate}
            setSotaPollRate={setSotaPollRate}
            sotaMaxAge={sotaMaxAge}
            setSotaMaxAge={setSotaMaxAge}
            sotaModeFilter={sotaModeFilter}
            setSotaModeFilter={setSotaModeFilter}
            sotaBandFilter={sotaBandFilter}
            setSotaBandFilter={setSotaBandFilter}
            renderSotaSpotsTable={renderSotaSpotsTable}
            wwffSpotsCollapsed={isPhoneWwffSpotsCollapsed}
            filteredWwffSpots={filteredWwffSpots}
            setWwffSpotsCollapsed={setIsPhoneWwffSpotsCollapsed}
            wwffPollRate={wwffPollRate}
            setWwffPollRate={setWwffPollRate}
            wwffMaxAge={wwffMaxAge}
            setWwffMaxAge={setWwffMaxAge}
            wwffModeFilter={wwffModeFilter}
            setWwffModeFilter={setWwffModeFilter}
            wwffBandFilter={wwffBandFilter}
            setWwffBandFilter={setWwffBandFilter}
            renderWwffSpotsTable={renderWwffSpotsTable}
            dxSpotsCollapsed={isPhoneDxSpotsCollapsed}
            filteredDxSpots={filteredDxSpots}
            setDxSpotsCollapsed={setIsPhoneDxSpotsCollapsed}
            dxClusterEnabled={dxClusterEnabled}
            setDxClusterEnabled={setDxClusterEnabled}
            dxHost={dxHost}
            setDxHost={setDxHost}
            dxPort={dxPort}
            setDxPort={setDxPort}
            dxLoginCallsign={dxLoginCallsign}
            setDxLoginCallsign={setDxLoginCallsign}
            dxMaxAge={dxMaxAge}
            setDxMaxAge={setDxMaxAge}
            dxCallsignFilter={dxCallsignFilter}
            setDxCallsignFilter={setDxCallsignFilter}
            dxKeywordFilter={dxKeywordFilter}
            setDxKeywordFilter={setDxKeywordFilter}
            dxBandFilter={dxBandFilter}
            setDxBandFilter={setDxBandFilter}
            dxConnected={dxConnected}
            dxError={dxError}
            renderDxSpotsTable={renderDxSpotsTable}
            cwDecodedText={cwDecodedText}
            setCwDecodedText={setCwDecodedText}
            cwStats={cwStats}
            cwScrollContainerRef={cwScrollContainerRef}
            handleSetPTT={handleSetPTT}
            isConsoleCollapsed={isPhoneConsoleCollapsed}
            consoleLogs={consoleLogs}
            rawCommand={rawCommand}
            setIsConsoleCollapsed={setIsPhoneConsoleCollapsed}
            setRawCommand={setRawCommand}
            handleSendRaw={handleSendRaw}
            solarData={solarData}
            requestSolarData={requestSolarData}
            latestSpectrumRef={latestSpectrumRef}
            waterfallHistoryRef={waterfallHistoryRef}
            spectrumSupported={spectrumSupported}
            spectrumEnabled={spectrumEnabled}
            spectrumSettings={spectrumSettings}
            setSpectrumSettings={setSpectrumSettings}
            analyserNodeRef={analyserNodeRef}
            phoneLayout={phoneLayout}
            isEditMode={isPhoneEditMode}
            gridCallbacks={phoneGridCallbacks}
            callsign={currentUser?.callsign ?? ""}
            isComboSpotsCollapsed={isPhoneComboSpotsCollapsed}
            setIsComboSpotsCollapsed={setIsPhoneComboSpotsCollapsed}
            isSolarCollapsed={isPhoneSolarCollapsed}
            setIsSolarCollapsed={setIsPhoneSolarCollapsed}
            isMufMapCollapsed={isPhoneMufMapCollapsed}
            setIsMufMapCollapsed={setIsPhoneMufMapCollapsed}
            isCwDecodeCollapsed={isPhoneCwDecodeCollapsed}
            setIsCwDecodeCollapsed={setIsPhoneCwDecodeCollapsed}
            isSpectrumHamlibCollapsed={isPhoneSpectrumHamlibCollapsed}
            setIsSpectrumHamlibCollapsed={setIsPhoneSpectrumHamlibCollapsed}
            isSpectrumAudioCollapsed={isPhoneSpectrumAudioCollapsed}
            setIsSpectrumAudioCollapsed={setIsPhoneSpectrumAudioCollapsed}
          />
        ) : (
          <CompactLayout
            status={status}
            connected={effectivelyConnected}
            availableModes={availableModes}
            socket={socket}
            vfoSupported={vfoSupported}
            powerSupported={powerSupported}
            poweringOn={poweringOn}
            knownPoweredOff={rigConnecting?.knownPoweredOff === true}
            handleSetPower={handleSetPower}
            isPhoneVFOCollapsed={isCompactVFOCollapsed}
            setIsPhoneVFOCollapsed={setIsCompactVFOCollapsed}
            vfoStep={vfoStep}
            inputVfoA={inputVfoA}
            inputVfoB={inputVfoB}
            localMode={localMode}
            setVfoStep={setVfoStep}
            setInputVfoA={setInputVfoA}
            setInputVfoB={setInputVfoB}
            adjustVfoFrequency={adjustVfoFrequency}
            handleSetVFO={handleSetVFO}
            handleToggleSplit={handleToggleSplit}
            handleSetFreq={handleSetFreq}
            handleSetMode={handleSetMode}
            handleSetBw={handleSetBw}
            bwDisabled={connected && status?.bandwidth === "0"}
            history={history}
            activeMeter={activeMeter}
            isCompactSMeterCollapsed={isCompactSMeterCollapsed}
            setActiveMeter={setActiveMeter}
            setIsCompactSMeterCollapsed={setIsCompactSMeterCollapsed}
            cwDecodedText={cwDecodedText}
            cwStats={cwStats}
            cwScrollContainerRef={cwScrollContainerRef}
            setCwDecodedText={setCwDecodedText}
            videoStatus={videoStatus}
            isVideoCollapsed={isCompactVideoCollapsed}
            isElectronSource={isElectronSource}
            videoError={videoError}
            videoPreviewCallbackRef={videoPreviewCallbackRef}
            videoCanvasRef={videoCanvasRef}
            setIsVideoCollapsed={setIsCompactVideoCollapsed}
            setIsVideoSettingsOpen={setIsVideoSettingsOpen}
            setVideoError={setVideoError}
            enumerateVideoDevices={enumerateVideoDevices}
            audioStatus={audioStatus}
            isAudioFeedCollapsed={isCompactAudioFeedCollapsed}
            setIsAudioFeedCollapsed={setIsCompactAudioFeedCollapsed}
            setIsAudioSettingsOpen={setIsAudioSettingsOpen}
            localAudioReady={localAudioReady}
            inboundMuted={inboundMuted}
            outboundMuted={outboundMuted}
            audioSettings={audioSettings}
            audioWasRestarted={audioWasRestarted}
            setInboundMuted={setInboundMuted}
            setOutboundMuted={setOutboundMuted}
            handleJoinAudio={handleJoinAudio}
            isCompactControlsCollapsed={isCompactControlsCollapsed}
            isCompactRFPowerCollapsed={isCompactRFPowerCollapsed}
            setIsCompactControlsCollapsed={setIsCompactControlsCollapsed}
            setIsCompactRFPowerCollapsed={setIsCompactRFPowerCollapsed}
            isTuning={isTuning}
            tuneJustFinished={tuneJustFinished}
            attenuatorLevels={attenuatorLevels}
            preampLevels={preampLevels}
            agcLevels={agcLevels}
            nbCapabilities={nbCapabilities}
            nrCapabilities={nrCapabilities}
            anfCapabilities={anfCapabilities}
            localRFPower={localRFPower}
            rfPowerCapabilities={rfPowerCapabilities}
            rfLevelCapabilities={rfLevelCapabilities}
            localRFLevel={localRFLevel}
            localNRLevel={localNRLevel}
            localNBLevel={localNBLevel}
            isDraggingRF={isDraggingRF}
            isDraggingRFLevel={isDraggingRFLevel}
            isDraggingNR={isDraggingNR}
            isDraggingNB={isDraggingNB}
            setLocalRFPower={setLocalRFPower}
            setLocalRFLevel={setLocalRFLevel}
            setLocalNRLevel={setLocalNRLevel}
            setLocalNBLevel={setLocalNBLevel}
            handleSetPTT={handleSetPTT}
            handleSetFunc={handleSetFunc}
            handleVfoOp={handleVfoOp}
            cycleAttenuator={cycleAttenuator}
            cyclePreamp={cyclePreamp}
            cycleAgc={cycleAgc}
            getAttenuatorLabel={getAttenuatorLabel}
            getPreampLabel={getPreampLabel}
            getAgcLabel={getAgcLabel}
            potaPollRate={potaPollRate}
            setPotaPollRate={setPotaPollRate}
            potaMaxAge={potaMaxAge}
            setPotaMaxAge={setPotaMaxAge}
            potaModeFilter={potaModeFilter}
            setPotaModeFilter={setPotaModeFilter}
            potaBandFilter={potaBandFilter}
            setPotaBandFilter={setPotaBandFilter}
            sotaPollRate={sotaPollRate}
            setSotaPollRate={setSotaPollRate}
            sotaMaxAge={sotaMaxAge}
            setSotaMaxAge={setSotaMaxAge}
            sotaModeFilter={sotaModeFilter}
            setSotaModeFilter={setSotaModeFilter}
            sotaBandFilter={sotaBandFilter}
            setSotaBandFilter={setSotaBandFilter}
            renderSpotsTable={renderSpotsTable}
            renderSotaSpotsTable={renderSotaSpotsTable}
            wwffPollRate={wwffPollRate}
            setWwffPollRate={setWwffPollRate}
            wwffMaxAge={wwffMaxAge}
            setWwffMaxAge={setWwffMaxAge}
            wwffModeFilter={wwffModeFilter}
            setWwffModeFilter={setWwffModeFilter}
            wwffBandFilter={wwffBandFilter}
            setWwffBandFilter={setWwffBandFilter}
            renderWwffSpotsTable={renderWwffSpotsTable}
            dxClusterEnabled={dxClusterEnabled}
            setDxClusterEnabled={setDxClusterEnabled}
            dxHost={dxHost}
            setDxHost={setDxHost}
            dxPort={dxPort}
            setDxPort={setDxPort}
            dxLoginCallsign={dxLoginCallsign}
            setDxLoginCallsign={setDxLoginCallsign}
            dxMaxAge={dxMaxAge}
            setDxMaxAge={setDxMaxAge}
            dxCallsignFilter={dxCallsignFilter}
            setDxCallsignFilter={setDxCallsignFilter}
            dxKeywordFilter={dxKeywordFilter}
            setDxKeywordFilter={setDxKeywordFilter}
            dxBandFilter={dxBandFilter}
            setDxBandFilter={setDxBandFilter}
            dxConnected={dxConnected}
            dxError={dxError}
            renderDxSpotsTable={renderDxSpotsTable}
            dxSpotsCollapsed={isCompactDxSpotsCollapsed}
            setDxSpotsCollapsed={setIsCompactDxSpotsCollapsed}
            potaSpotsCollapsed={isCompactPotaSpotsCollapsed}
            setPotaSpotsCollapsed={setIsCompactPotaSpotsCollapsed}
            sotaSpotsCollapsed={isCompactSotaSpotsCollapsed}
            setSotaSpotsCollapsed={setIsCompactSotaSpotsCollapsed}
            wwffSpotsCollapsed={isCompactWwffSpotsCollapsed}
            setWwffSpotsCollapsed={setIsCompactWwffSpotsCollapsed}
            isComboSpotsCollapsed={isCompactComboSpotsCollapsed}
            setIsComboSpotsCollapsed={setIsCompactComboSpotsCollapsed}
            isCwDecodeCollapsed={isCompactCwDecodeCollapsed}
            setIsCwDecodeCollapsed={setIsCompactCwDecodeCollapsed}
            isConsoleCollapsed={isCompactConsoleCollapsed}
            consoleLogs={consoleLogs}
            rawCommand={rawCommand}
            setIsConsoleCollapsed={setIsCompactConsoleCollapsed}
            setRawCommand={setRawCommand}
            handleSendRaw={handleSendRaw}
            solarData={solarData}
            requestSolarData={requestSolarData}
            isSolarCollapsed={isCompactSolarCollapsed}
            setIsSolarCollapsed={setIsCompactSolarCollapsed}
            isMufMapCollapsed={isCompactMufMapCollapsed}
            setIsMufMapCollapsed={setIsCompactMufMapCollapsed}
            compactLayout={compactLayout}
            setCompactLayout={setCompactLayout}
            isEditMode={isCompactEditMode}
            gridCallbacks={compactGridCallbacks}
            callsign={currentUser?.callsign ?? ""}
            latestSpectrumRef={latestSpectrumRef}
            waterfallHistoryRef={waterfallHistoryRef}
            spectrumSupported={spectrumSupported}
            spectrumEnabled={spectrumEnabled}
            spectrumSettings={spectrumSettings}
            setSpectrumSettings={setSpectrumSettings}
            analyserNodeRef={analyserNodeRef}
            isSpectrumHamlibCollapsed={isCompactSpectrumHamlibCollapsed}
            setIsSpectrumHamlibCollapsed={setIsCompactSpectrumHamlibCollapsed}
            isSpectrumAudioCollapsed={isCompactSpectrumAudioCollapsed}
            setIsSpectrumAudioCollapsed={setIsCompactSpectrumAudioCollapsed}
          />
        )}

        {/* Portable Setup Modal */}
        {showSetupModal && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
            <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg">
                    <Server size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold uppercase tracking-tight">Portable Setup</h2>
                    <p className="text-[0.625rem] text-[#8e9299] uppercase tracking-widest">Run RigControl locally on your computer</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSetupModal(false)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-400">
                    <Monitor size={16} />
                    <h3 className="text-sm font-bold uppercase">1. Install the App</h3>
                  </div>
                  <p className="text-xs text-[#8e9299] leading-relaxed">
                    Click the <span className="text-blue-400 font-bold">INSTALL</span> button in the header to add RigControl to your desktop or home screen.
                  </p>
                </section>
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <Zap size={16} />
                    <h3 className="text-sm font-bold uppercase">2. Run the Portable Backend</h3>
                  </div>
                  <div className="space-y-3">
                    <p className="text-xs text-[#8e9299] leading-relaxed">
                      To control your local radio without port forwarding, run the backend server on the same computer as your radio.
                    </p>
                    <div className="bg-[#0a0a0a] p-4 rounded-lg border border-[#2a2b2e] space-y-3">
                      <p className="text-[0.625rem] text-emerald-500/70 font-bold uppercase">Quick Start Command:</p>
                      <code className="block text-[0.6875rem] text-white bg-black/50 p-3 rounded border border-white/5 break-all">
                        git clone https://github.com/example/rigcontrol-web.git<br/>
                        cd rigcontrol-web && npm install && npm start
                      </code>
                      <p className="text-[0.625rem] text-[#4a4b4e] italic">* Requires Node.js and Hamlib (rigctld) installed on your system.</p>
                    </div>
                  </div>
                </section>
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Settings size={16} />
                    <h3 className="text-sm font-bold uppercase">3. Configure Backend URL</h3>
                  </div>
                  <div className="space-y-4">
                    <p className="text-xs text-[#8e9299] leading-relaxed">
                      Once your local backend is running, point this app to it. If running on the same machine, use <code className="text-white">https://localhost:3000</code>.
                    </p>
                    <div className="flex flex-col gap-2">
                      <label className="text-[0.625rem] uppercase text-[#8e9299]">Local Backend URL</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={backendUrl}
                          onChange={(e) => setBackendUrl(e.target.value)}
                          className="flex-1 bg-[#0a0a0a] border border-[#2a2b2e] rounded px-4 py-2 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                          placeholder="https://localhost:3000"
                        />
                        <button
                          onClick={() => window.location.reload()}
                          className="px-4 py-2 bg-blue-500/20 text-blue-500 border border-blue-500/50 rounded text-xs font-bold uppercase hover:bg-blue-500 hover:text-white transition-all"
                        >
                          Apply
                        </button>
                      </div>
                      <p className="text-[0.5625rem] text-amber-500/70 italic">* Changing this will refresh the page to reconnect.</p>
                    </div>
                  </div>
                </section>
              </div>
              <div className="p-6 bg-[#1a1b1e] border-t border-[#2a2b2e] flex justify-end">
                <button
                  onClick={() => setShowSetupModal(false)}
                  className="px-6 py-2 bg-[#2a2b2e] hover:bg-[#3a3b3e] text-white rounded font-bold uppercase text-xs transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Video Settings Modal */}
        <VideoSettingsModal
          isOpen={isVideoSettingsOpen}
          onClose={() => setIsVideoSettingsOpen(false)}
          socket={socket}
          videoDevices={videoDevices}
          videoSettings={videoSettings}
          setVideoSettings={setVideoSettings}
          videoStatus={videoStatus}
          isElectronSource={isElectronSource}
          resolutionDraft={resolutionDraft}
          setResolutionDraft={setResolutionDraft}
          isResolutionFocusedRef={isResolutionFocusedRef}
          resolutionDebounceRef={resolutionDebounceRef}
          resolutionDraftRef={resolutionDraftRef}
          videoSettingsRef={videoSettingsRef}
        />

        {/* Audio Settings Modal */}
        <AudioSettingsModal
          isOpen={isAudioSettingsOpen}
          onClose={() => setIsAudioSettingsOpen(false)}
          socket={socket}
          audioStatus={audioStatus}
          audioSettings={audioSettings}
          setAudioSettings={setAudioSettings}
          audioSettingsDenied={audioSettingsDenied}
          role={currentUser?.role ?? "regular"}
          localAudioDevices={localAudioDevices}
          setLocalAudioDevices={setLocalAudioDevices}
          localAudioSettings={localAudioSettings}
          setLocalAudioSettings={setLocalAudioSettings}
          inboundVolume={inboundVolume}
          setInboundVolume={setInboundVolume}
          audioContextRef={audioContextRef}
          sidetoneCtxRef={sidetoneCtxRef}
          inboundGainRef={inboundGainRef}
          audioEngineState={audioEngineState}
          isBackendEngineCollapsed={isBackendEngineCollapsed}
          onToggleBackendEngineCollapsed={toggleBackendEngineCollapsed}
          handleStartAudio={handleStartAudio}
          startMicCapture={startMicCapture}
          stopMicCapture={stopMicCapture}
          activeMicClientId={activeMicClientId}
          clientId={clientId}
          inboundMuted={inboundMuted}
          outboundMuted={outboundMuted}
          localAudioReady={localAudioReady}
          audioDevices={audioDevices}
          updateWsjtxOutput={updateWsjtxOutput}
          wsjtxBridgeEnabled={bridgeEnabled}
          setWsjtxBridgeEnabled={setBridgeEnabled}
          wsjtxBridgeConnected={bridgeConnected}
          wsjtxWsPort={wsjtxWsPort}
          setWsjtxWsPort={setWsjtxWsPort}
          wsjtxAutoSetupWarning={wsjtxAutoSetupWarning}
          wsjtxAutoSetupActive={wsjtxAutoSetupActive}
        />

        {/* Rigctld Settings Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          socket={socket}
          callsign={currentUser?.callsign ?? ""}
          role={currentUser?.role ?? "regular"}
          activeSettingsTab={activeSettingsTab}
          setActiveSettingsTab={setActiveSettingsTab}
          rigctldSettings={rigctldSettings}
          setRigctldSettings={setRigctldSettings}
          rigctldProcessStatus={rigctldProcessStatus}
          rigctldLogs={rigctldLogs}
          setRigctldLogs={setRigctldLogs}
          testResult={testResult}
          radios={radios}
          serialPorts={serialPorts}
          host={host}
          setHost={setHost}
          port={port}
          setPort={setPort}
          pollRate={pollRate}
          handlePollRateChange={handlePollRateChange}
          rigctldVersionInfo={rigctldVersionInfo}
          logEndRef={logEndRef}
          cwSettings={cwSettings}
          setCwSettings={setCwSettings}
          cwSettingsRef={cwSettingsRef}
          cwPortStatus={cwPortStatus}
          sidetoneOscRef={sidetoneOscRef}
          rebindTarget={rebindTarget}
          setRebindTarget={setRebindTarget}
          cwRebindError={cwRebindError}
          pttRebindActive={pttRebindActive}
          setPttRebindActive={setPttRebindActive}
          pttRebindError={pttRebindError}
        />
      </div>

      {/* Phone sticky PTT/CW bar */}
      {isPhone && (
        <PhoneStickyBar
          stickyBarRef={stickyBarRef}
          cwSettings={cwSettings}
          status={status}
          connected={effectivelyConnected}
          handleSetPTT={handleSetPTT}
          ditPressedRef={ditPressedRef}
          dahPressedRef={dahPressedRef}
          emitCwPaddle={emitCwPaddle}
        />
      )}
    </div>
  );
}
