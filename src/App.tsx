import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import {
  Signal,
  Power,
  Settings,
  Mic,
  Server,
  Monitor,
  Zap,
  X,
  LayoutGrid,
} from "lucide-react";
import { cn } from "./utils";
import PhoneLayout from "./layouts/PhoneLayout";
import CompactLayout from "./layouts/CompactLayout";
import PhoneStickyBar from "./layouts/PhoneStickyBar";
import SettingsModal from "./modals/SettingsModal";
import VideoSettingsModal from "./modals/VideoSettingsModal";
import { usePotaSpots } from "./hooks/usePotaSpots";
import { useRigctld } from "./hooks/useRigctld";
import { useCWKeyer } from "./hooks/useCWKeyer";
import { useVideoStream } from "./hooks/useVideoStream";
import { useAudio } from "./hooks/useAudio";
import { useRigControl } from "./hooks/useRigControl";
import { useLayoutState } from "./hooks/useLayoutState";
import { useCwDecoder } from "./hooks/useCwDecoder";
import { usePanelState } from "./hooks/usePanelState";
import { useLayoutConfig } from "./hooks/useLayoutConfig";
import type { PanelType } from "./types/layout";

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [backendUrl, setBackendUrl] = useState(() => {
    const stored = localStorage.getItem("backend-url");
    if (!stored) return window.location.origin;
    try {
      const storedUrl = new URL(stored);
      const currentUrl = new URL(window.location.origin);
      if (storedUrl.hostname === currentUrl.hostname && storedUrl.port === currentUrl.port && storedUrl.protocol !== currentUrl.protocol) {
        console.log(`[INIT] Correcting stale backend-url: ${stored} → ${window.location.origin}`);
        localStorage.setItem("backend-url", window.location.origin);
        return window.location.origin;
      }
    } catch (_) {
      console.warn("[INIT] Invalid backend-url in storage, resetting to current origin.");
      localStorage.setItem("backend-url", window.location.origin);
      return window.location.origin;
    }
    return stored;
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
    const newSocket = io(backendUrl, { transports: ['websocket'], auth: { clientId } });
    setSocket(newSocket);
    return () => { newSocket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const { isCompact, isPhone, stickyBarHeight, containerRef, stickyBarRef } = useLayoutState();
  const [isCompactEditMode, setIsCompactEditMode] = useState(false);
  const [isPhoneEditMode, setIsPhoneEditMode] = useState(false);
  const {
    compactLayout, setCompactLayout,
    phoneLayout, setPhoneLayout,
    addPanel, removePanel, setGridSize,
    updateItemPositions, resetToDefault,
  } = useLayoutConfig();

  const compactGridCallbacks = useMemo(() => ({
    onExitEditMode: () => setIsCompactEditMode(false),
    addPanel: (panelType: PanelType) => addPanel('compact', panelType),
    removePanel: (itemId: string) => removePanel('compact', itemId),
    setGridSize: (cols: number, rows: number) => setGridSize('compact', cols, rows),
    updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => updateItemPositions('compact', positions),
    resetToDefault: () => resetToDefault('compact'),
  }), [addPanel, removePanel, setGridSize, updateItemPositions, resetToDefault]);

  const phoneGridCallbacks = useMemo(() => ({
    onExitEditMode: () => setIsPhoneEditMode(false),
    addPanel: (panelType: PanelType) => addPanel('phone', panelType),
    removePanel: (itemId: string) => removePanel('phone', itemId),
    setGridSize: (cols: number, rows: number) => setGridSize('phone', cols, rows),
    updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => updateItemPositions('phone', positions),
    resetToDefault: () => resetToDefault('phone'),
  }), [addPanel, removePanel, setGridSize, updateItemPositions, resetToDefault]);

  const {
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
  } = usePanelState();

  const {
    cwDecodeEnabled, setCwDecodeEnabled,
    cwDecodedText, setCwDecodedText,
    cwWasmReady,
    cwStats,
    cwDecoderRef,
    cwDecodeEnabledRef,
    cwScrollContainerRef,
  } = useCwDecoder();

  const {
    rigctldSettings, setRigctldSettings,
    settingsLoaded, setSettingsLoaded,
    statusLoaded,
    isSettingsOpen, setIsSettingsOpen,
    activeSettingsTab, setActiveSettingsTab,
    radios,
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
    isVideoCollapsed, setIsVideoCollapsed,
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

  const {
    activeMicClientId,
    audioStatus,
    audioEngineState,
    audioDevices,
    audioSettings, setAudioSettings,
    localAudioDevices, setLocalAudioDevices,
    localAudioSettings, setLocalAudioSettings,
    inboundMuted, setInboundMuted,
    inboundVolume, setInboundVolume,
    outboundMuted, setOutboundMuted,
    localAudioReady,
    audioWasRestarted, setAudioWasRestarted,
    isBackendEngineCollapsed, setIsBackendEngineCollapsed,
    audioContextRef,
    inboundGainRef,
    initLocalAudioPipeline,
    handleStartAudio,
    startMicCapture,
    stopMicCapture,
  } = useAudio({ socket, cwDecodeEnabledRef, cwDecoderRef });

  const {
    connected,
    vfoSupported,
    host, setHost,
    port, setPort,
    status, setStatus,
    history,
    pollRate,
    vfoA, setVfoA,
    vfoB, setVfoB,
    error,
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
    sidetoneOscRef,
    sidetoneCtxRef,
    emitCwPaddle,
    ditPressedRef,
    dahPressedRef,
  } = useCWKeyer({ socket, connected, localAudioOutputDevice: localAudioSettings.outputDevice });

  const {
    potaEnabled, setPotaEnabled,
    potaPollRate, setPotaPollRate,
    potaMaxAge, setPotaMaxAge,
    potaModeFilter, setPotaModeFilter,
    potaBandFilter, setPotaBandFilter,
    potaSortCol,
    potaSortDir,
    potaSpotsCollapsed, setPotaSpotsCollapsed,
    sotaEnabled, setSotaEnabled,
    sotaPollRate, setSotaPollRate,
    sotaMaxAge, setSotaMaxAge,
    sotaModeFilter, setSotaModeFilter,
    sotaBandFilter, setSotaBandFilter,
    sotaSortCol,
    sotaSortDir,
    sotaSpotsCollapsed, setSotaSpotsCollapsed,
    potaSpotsVisible,
    sotaSpotsVisible,
    potaSpotsBoxRef,
    sotaSpotsBoxRef,
    filteredSpots,
    filteredSotaSpots,
    displayedSpots,
    displayedSotaSpots,
    renderSpotsTable,
    renderSotaSpotsTable,
  } = usePotaSpots({
    socket,
    connected,
    status,
    inputVfoA,
    inputVfoB,
    availableModes,
    containerRef,
    skipPollsCount,
    setStatus,
    isPhone,
  });

  // ── Effects ───────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("backend-url", backendUrl);
  }, [backendUrl]);

  // Save settings debounce (skip first mount to avoid overwriting on load)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const timer = setTimeout(() => {
      socket?.emit("save-settings", {
        settings: rigctldSettings,
        pollRate,
        clientHost: host,
        clientPort: port,
        potaSettings: { enabled: potaEnabled, pollRate: potaPollRate, maxAge: potaMaxAge, modeFilter: potaModeFilter, bandFilter: potaBandFilter },
        sotaSettings: { enabled: sotaEnabled, pollRate: sotaPollRate, maxAge: sotaMaxAge, modeFilter: sotaModeFilter, bandFilter: sotaBandFilter }
      });
      localStorage.setItem("last-poll-rate", pollRate.toString());
      localStorage.setItem("last-host", host);
      localStorage.setItem("last-port", port.toString());
    }, 1000);
    return () => clearTimeout(timer);
  }, [rigctldSettings, host, port, pollRate, socket, potaEnabled, potaPollRate, potaMaxAge, potaModeFilter, potaBandFilter, sotaEnabled, sotaPollRate, sotaMaxAge, sotaModeFilter, sotaBandFilter]);

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
  const getPreampLabel = useCallback(() => {
    if (status.preamp === 0) return (isCompact || isPhone) ? "P.AMP" : "OFF";
    return `${status.preamp}dB`;
  }, [status.preamp, isCompact, isPhone]);

  const getAttenuatorLabel = useCallback(() => {
    if (status.attenuation === 0) return (isCompact || isPhone) ? "ATT" : "OFF";
    return `${status.attenuation}dB`;
  }, [status.attenuation, isCompact, isPhone]);

  const getAgcLabel = useCallback(() => {
    if (agcLevels.length === 0) return "OFF";
    const parsed = agcLevels.map(l => { const p = l.split('='); return { value: parseInt(p[0]), label: p[1] }; });
    const current = parsed.find(p => p.value === status.agc);
    return current ? current.label : (status.agc === 0 ? "OFF" : status.agc.toString());
  }, [status.agc, agcLevels]);

  // ── Cross-hook bridge ─────────────────────────────────────────────────────
  const handleJoinAudio = useCallback(async () => {
    const explicitInput = localStorage.getItem("local-audio-input");
    const explicitOutput = localStorage.getItem("local-audio-output");
    if (!explicitInput && !explicitOutput) {
      setIsVideoSettingsOpen(true);
      socket?.emit("get-video-devices");
      socket?.emit("get-audio-devices");
      if (isElectronSource) enumerateVideoDevices();
      return;
    }
    await initLocalAudioPipeline();
  }, [socket, isElectronSource, enumerateVideoDevices, initLocalAudioPipeline, setIsVideoSettingsOpen]);

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
        <header className="bg-[#151619] rounded-xl border border-[#2a2b2e] shadow-2xl py-1.5 px-3 sm:p-4 flex items-center justify-between gap-2">
          <div className="flex sm:hidden items-center gap-2 flex-shrink-0">
            <div className={cn("w-2 h-2 rounded-full flex-shrink-0", connected ? "bg-emerald-500" : "bg-red-500/70")} />
            <span className="text-sm font-bold tracking-tight uppercase italic text-center">RigControl Web</span>
          </div>
          <div className="hidden sm:flex items-center gap-3 min-w-0">
            <Signal size={24} className="text-emerald-500 flex-shrink-0" />
            <h1 className="text-xl font-bold tracking-tighter uppercase italic truncate">RigControl Web</h1>
          </div>
          {isCompact && cwSettings.enabled && connected && !['CW', 'CWR', 'CW-R'].includes(status?.mode || '') && (
            <div className="flex-1 flex justify-center px-2">
              <span className="bg-amber-900/40 border border-amber-500/60 text-amber-300 text-xs font-bold px-3 py-1 rounded-lg text-center">
                Radio not in CW mode — Switch mode to key
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <button
              onClick={handleConnect}
              className={cn(
                "p-1.5 sm:px-6 sm:py-2 rounded-lg font-bold uppercase text-sm transition-all flex items-center gap-2",
                connected
                  ? "bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white"
                  : "bg-emerald-500/20 text-emerald-500 border border-emerald-500/50 hover:bg-emerald-500 hover:text-white"
              )}
            >
              <Power size={16} className="flex-shrink-0" />
              <span className="hidden sm:inline">{connected ? "Disconnect" : "Connect"}</span>
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
            {(isCompact || isPhone) && (
              <button
                onClick={() => isCompact ? setIsCompactEditMode(v => !v) : setIsPhoneEditMode(v => !v)}
                className={cn(
                  "p-1.5 sm:p-2 bg-[#0a0a0a] border rounded-lg transition-all flex-shrink-0",
                  (isCompact ? isCompactEditMode : isPhoneEditMode)
                    ? "text-emerald-400 border-emerald-500/70 bg-emerald-500/10"
                    : "text-[#8e9299] border-[#2a2b2e] hover:text-emerald-400"
                )}
                title={(isCompact ? isCompactEditMode : isPhoneEditMode) ? "Exit layout editor" : "Edit layout"}
              >
                <LayoutGrid size={18} />
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
            <div className="p-2 bg-red-500/20 rounded-full text-red-500">
              <Settings size={20} />
            </div>
            <div className="flex-1">
              <h3 className="text-red-500 font-bold text-sm uppercase tracking-tight">Connection Error</h3>
              <p className="text-xs text-red-400/80 mt-1 leading-relaxed">{error}</p>
              <div className="mt-4 p-3 bg-black/40 rounded border border-red-500/20 space-y-2">
                <p className="text-[0.625rem] text-[#8e9299] uppercase font-bold">How to fix this:</p>
                <ul className="text-[0.6875rem] list-disc list-inside space-y-1 text-red-300/70">
                  <li><strong>Use ngrok:</strong> Run <code className="bg-black px-1">ngrok tcp 4532</code> on your radio computer and use the provided <code className="text-white">0.tcp.ngrok.io</code> address.</li>
                  <li><strong>Port Forwarding:</strong> Forward port <code className="text-white">4532</code> on your router to <code className="text-white">192.168.86.34</code>.</li>
                  <li><strong>Public IP:</strong> Ensure you use your <em>Public</em> IP (search "What is my IP") and not your local 192.168.x.x address.</li>
                </ul>
              </div>
              <div className="mt-3 flex gap-4">
                <a
                  href="https://github.com/Hamlib/Hamlib/wiki/rigctld"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[0.625rem] uppercase font-bold text-emerald-500 hover:underline"
                >
                  Rigctld Setup Guide
                </a>
              </div>
            </div>
          </div>
        )}


        {/* Main Interface */}
        {isPhone ? (
          <PhoneLayout
            status={status}
            connected={connected}
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
            videoStatus={videoStatus}
            isVideoCollapsed={isVideoCollapsed}
            isElectronSource={isElectronSource}
            videoError={videoError}
            videoPreviewCallbackRef={videoPreviewCallbackRef}
            videoCanvasRef={videoCanvasRef}
            setIsVideoCollapsed={setIsVideoCollapsed}
            setIsVideoSettingsOpen={setIsVideoSettingsOpen}
            setVideoError={setVideoError}
            enumerateVideoDevices={enumerateVideoDevices}
            audioStatus={audioStatus}
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
            potaEnabled={potaEnabled}
            potaSpotsCollapsed={potaSpotsCollapsed}
            filteredSpots={filteredSpots}
            potaSpotsBoxRef={potaSpotsBoxRef}
            setPotaSpotsCollapsed={setPotaSpotsCollapsed}
            renderSpotsTable={renderSpotsTable}
            sotaEnabled={sotaEnabled}
            sotaSpotsCollapsed={sotaSpotsCollapsed}
            filteredSotaSpots={filteredSotaSpots}
            sotaSpotsBoxRef={sotaSpotsBoxRef}
            setSotaSpotsCollapsed={setSotaSpotsCollapsed}
            renderSotaSpotsTable={renderSotaSpotsTable}
            cwSettings={cwSettings}
            cwKeyActive={cwKeyActive}
            cwStuckAlert={cwStuckAlert}
            handleSetPTT={handleSetPTT}
            isConsoleCollapsed={isConsoleCollapsed}
            consoleLogs={consoleLogs}
            rawCommand={rawCommand}
            setIsConsoleCollapsed={setIsConsoleCollapsed}
            setRawCommand={setRawCommand}
            handleSendRaw={handleSendRaw}
            phoneLayout={phoneLayout}
            isEditMode={isPhoneEditMode}
            gridCallbacks={phoneGridCallbacks}
          />
        ) : (
          <CompactLayout
            status={status}
            connected={connected}
            availableModes={availableModes}
            socket={socket}
            vfoSupported={vfoSupported}
            isPhoneVFOCollapsed={isPhoneVFOCollapsed}
            setIsPhoneVFOCollapsed={setIsPhoneVFOCollapsed}
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
            history={history}
            activeMeter={activeMeter}
            isCompactSMeterCollapsed={isCompactSMeterCollapsed}
            setActiveMeter={setActiveMeter}
            setIsCompactSMeterCollapsed={setIsCompactSMeterCollapsed}
            cwDecodeEnabled={cwDecodeEnabled}
            cwDecodedText={cwDecodedText}
            cwStats={cwStats}
            cwScrollContainerRef={cwScrollContainerRef}
            setCwDecodedText={setCwDecodedText}
            videoStatus={videoStatus}
            isVideoCollapsed={isVideoCollapsed}
            isElectronSource={isElectronSource}
            videoError={videoError}
            videoPreviewCallbackRef={videoPreviewCallbackRef}
            videoCanvasRef={videoCanvasRef}
            setIsVideoCollapsed={setIsVideoCollapsed}
            setIsVideoSettingsOpen={setIsVideoSettingsOpen}
            setVideoError={setVideoError}
            enumerateVideoDevices={enumerateVideoDevices}
            audioStatus={audioStatus}
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
            cwSettings={cwSettings}
            cwKeyActive={cwKeyActive}
            cwStuckAlert={cwStuckAlert}
            potaEnabled={potaEnabled}
            sotaEnabled={sotaEnabled}
            renderSpotsTable={renderSpotsTable}
            renderSotaSpotsTable={renderSotaSpotsTable}
            isConsoleCollapsed={isConsoleCollapsed}
            consoleLogs={consoleLogs}
            rawCommand={rawCommand}
            setIsConsoleCollapsed={setIsConsoleCollapsed}
            setRawCommand={setRawCommand}
            handleSendRaw={handleSendRaw}
            compactLayout={compactLayout}
            setCompactLayout={setCompactLayout}
            isEditMode={isCompactEditMode}
            gridCallbacks={compactGridCallbacks}
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
          audioStatus={audioStatus}
          audioSettings={audioSettings}
          setAudioSettings={setAudioSettings}
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
          setIsBackendEngineCollapsed={setIsBackendEngineCollapsed}
          handleStartAudio={handleStartAudio}
          startMicCapture={startMicCapture}
          stopMicCapture={stopMicCapture}
          activeMicClientId={activeMicClientId}
          clientId={clientId}
          outboundMuted={outboundMuted}
          localAudioReady={localAudioReady}
          audioDevices={audioDevices}
        />

        {/* Rigctld Settings Modal */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          socket={socket}
          activeSettingsTab={activeSettingsTab}
          setActiveSettingsTab={setActiveSettingsTab}
          rigctldSettings={rigctldSettings}
          setRigctldSettings={setRigctldSettings}
          rigctldProcessStatus={rigctldProcessStatus}
          rigctldLogs={rigctldLogs}
          setRigctldLogs={setRigctldLogs}
          testResult={testResult}
          radios={radios}
          host={host}
          setHost={setHost}
          port={port}
          setPort={setPort}
          pollRate={pollRate}
          handlePollRateChange={handlePollRateChange}
          rigctldVersionInfo={rigctldVersionInfo}
          logEndRef={logEndRef}
          potaEnabled={potaEnabled}
          setPotaEnabled={setPotaEnabled}
          potaBandFilter={potaBandFilter}
          setPotaBandFilter={setPotaBandFilter}
          potaModeFilter={potaModeFilter}
          setPotaModeFilter={setPotaModeFilter}
          potaPollRate={potaPollRate}
          setPotaPollRate={setPotaPollRate}
          potaMaxAge={potaMaxAge}
          setPotaMaxAge={setPotaMaxAge}
          sotaEnabled={sotaEnabled}
          setSotaEnabled={setSotaEnabled}
          sotaBandFilter={sotaBandFilter}
          setSotaBandFilter={setSotaBandFilter}
          sotaModeFilter={sotaModeFilter}
          setSotaModeFilter={setSotaModeFilter}
          sotaPollRate={sotaPollRate}
          setSotaPollRate={setSotaPollRate}
          sotaMaxAge={sotaMaxAge}
          setSotaMaxAge={setSotaMaxAge}
          cwSettings={cwSettings}
          setCwSettings={setCwSettings}
          cwDecodeEnabled={cwDecodeEnabled}
          setCwDecodeEnabled={setCwDecodeEnabled}
          cwWasmReady={cwWasmReady}
          cwSettingsRef={cwSettingsRef}
          cwPortStatus={cwPortStatus}
          sidetoneOscRef={sidetoneOscRef}
          rebindTarget={rebindTarget}
          setRebindTarget={setRebindTarget}
        />
      </div>

      {/* Phone sticky PTT/CW bar */}
      {isPhone && (
        <PhoneStickyBar
          stickyBarRef={stickyBarRef}
          cwDecodeEnabled={cwDecodeEnabled}
          cwStats={cwStats}
          cwDecodedText={cwDecodedText}
          setCwDecodedText={setCwDecodedText}
          cwScrollContainerRef={cwScrollContainerRef}
          cwSettings={cwSettings}
          status={status}
          connected={connected}
          handleSetPTT={handleSetPTT}
          ditPressedRef={ditPressedRef}
          dahPressedRef={dahPressedRef}
          emitCwPaddle={emitCwPaddle}
        />
      )}
    </div>
  );
}
