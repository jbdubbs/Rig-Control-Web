import React from "react";
import type { Socket } from "socket.io-client";
import { cn } from "../utils";
import type {
  RigStatus,
  CwSettings,
  AudioSettings,
  NbCapabilities,
  NrCapabilities,
  AnfCapabilities,
  RfPowerCapabilities,
} from "../types";
import PanelChrome from "../components/PanelChrome";
import RfLevelsPanel from "../panels/RfLevelsPanel";
import ModeBwPanel from "../panels/ModeBwPanel";
import VfoPanel from "../panels/VfoPanel";
import VideoAudioPanel, {
  VideoAudioHeaderActions,
} from "../panels/VideoAudioPanel";
import SpotsPanel from "../panels/SpotsPanel";
import ControlsPanel from "../panels/ControlsPanel";
import SMeterPanel from "../panels/SMeterPanel";
import SwrPanel from "../panels/SwrPanel";
import AlcPanel from "../panels/AlcPanel";

export interface DesktopLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
  socket: Socket | null;
  vfoSupported: boolean;

  // VFO
  vfoStep: number;
  inputVfoA: string;
  inputVfoB: string;
  localMode: string;
  setVfoStep: React.Dispatch<React.SetStateAction<number>>;
  setInputVfoA: React.Dispatch<React.SetStateAction<string>>;
  setInputVfoB: React.Dispatch<React.SetStateAction<string>>;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
  handleSetVFO: (vfo: string) => void;
  handleToggleSplit: () => void;
  handleSetFreq: (freq: string) => void;
  handleSetMode: (mode: string) => void;
  handleSetBw: (bw: number) => void;

  // Desktop-specific collapse states
  isDesktopControlsCollapsed: boolean;
  setIsDesktopControlsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopModeCollapsed: boolean;
  setIsDesktopModeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopBwCollapsed: boolean;
  setIsDesktopBwCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopRFPowerCollapsed: boolean;
  setIsDesktopRFPowerCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopSMeterCollapsed: boolean;
  setIsDesktopSMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopSWRCollapsed: boolean;
  setIsDesktopSWRCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isDesktopALCCollapsed: boolean;
  setIsDesktopALCCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // Video
  videoStatus: "streaming" | "stopped";
  isVideoCollapsed: boolean;
  isElectronSource: boolean;
  videoError: string | null;
  videoPreviewCallbackRef: React.RefCallback<HTMLVideoElement>;
  videoCanvasRef: React.RefObject<HTMLCanvasElement>;
  setIsVideoCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsVideoSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setVideoError: React.Dispatch<React.SetStateAction<string | null>>;
  enumerateVideoDevices: () => Promise<void>;

  // Audio
  audioStatus: "playing" | "stopped";
  localAudioReady: boolean;
  inboundMuted: boolean;
  outboundMuted: boolean;
  audioSettings: AudioSettings;
  audioWasRestarted: boolean;
  setInboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setOutboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleJoinAudio: () => void;

  // Controls / levels
  isTuning: boolean;
  tuneJustFinished: boolean;
  attenuatorLevels: string[];
  preampLevels: string[];
  agcLevels: string[];
  nbCapabilities: NbCapabilities;
  nrCapabilities: NrCapabilities;
  anfCapabilities: AnfCapabilities;
  localRFPower: number;
  rfPowerCapabilities: RfPowerCapabilities;
  localRFLevel: number;
  localNRLevel: number;
  localNBLevel: number;
  isDraggingRF: React.MutableRefObject<boolean>;
  isDraggingRFLevel: React.MutableRefObject<boolean>;
  isDraggingNR: React.MutableRefObject<boolean>;
  isDraggingNB: React.MutableRefObject<boolean>;
  setLocalRFPower: React.Dispatch<React.SetStateAction<number>>;
  setLocalRFLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNRLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNBLevel: React.Dispatch<React.SetStateAction<number>>;
  handleSetPTT: (state: boolean) => void;
  handleSetFunc: (func: string, state: boolean) => void;
  handleVfoOp: (op: string) => void;
  cycleAttenuator: () => void;
  cyclePreamp: () => void;
  cycleAgc: () => void;
  getAttenuatorLabel: () => string;
  getPreampLabel: () => string;
  getAgcLabel: () => string;

  // CW keyer
  cwSettings: CwSettings;
  cwKeyActive: boolean;
  cwStuckAlert: boolean;

  // History / meters
  history: any[];

  // POTA/SOTA spots
  potaEnabled: boolean;
  sotaEnabled: boolean;
  potaSpotsCollapsed: boolean;
  sotaSpotsCollapsed: boolean;
  filteredSpots: any[];
  filteredSotaSpots: any[];
  setPotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setSotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaSpotsTable: () => React.ReactElement;
}

function DesktopLayout({
  status,
  connected,
  availableModes,
  socket,
  vfoSupported,
  vfoStep,
  inputVfoA,
  inputVfoB,
  localMode,
  setVfoStep,
  setInputVfoA,
  setInputVfoB,
  adjustVfoFrequency,
  handleSetVFO,
  handleToggleSplit,
  handleSetFreq,
  handleSetMode,
  handleSetBw,
  isDesktopControlsCollapsed,
  setIsDesktopControlsCollapsed,
  isDesktopModeCollapsed,
  setIsDesktopModeCollapsed,
  isDesktopBwCollapsed,
  setIsDesktopBwCollapsed,
  isDesktopRFPowerCollapsed,
  setIsDesktopRFPowerCollapsed,
  isDesktopSMeterCollapsed,
  setIsDesktopSMeterCollapsed,
  isDesktopSWRCollapsed,
  setIsDesktopSWRCollapsed,
  isDesktopALCCollapsed,
  setIsDesktopALCCollapsed,
  videoStatus,
  isVideoCollapsed,
  isElectronSource,
  videoError,
  videoPreviewCallbackRef,
  videoCanvasRef,
  setIsVideoCollapsed,
  setIsVideoSettingsOpen,
  setVideoError,
  enumerateVideoDevices,
  audioStatus,
  localAudioReady,
  inboundMuted,
  outboundMuted,
  audioSettings,
  audioWasRestarted,
  setInboundMuted,
  setOutboundMuted,
  handleJoinAudio,
  isTuning,
  tuneJustFinished,
  attenuatorLevels,
  preampLevels,
  agcLevels,
  nbCapabilities,
  nrCapabilities,
  anfCapabilities,
  localRFPower,
  rfPowerCapabilities,
  localRFLevel,
  localNRLevel,
  localNBLevel,
  isDraggingRF,
  isDraggingRFLevel,
  isDraggingNR,
  isDraggingNB,
  setLocalRFPower,
  setLocalRFLevel,
  setLocalNRLevel,
  setLocalNBLevel,
  handleSetPTT,
  handleSetFunc,
  handleVfoOp,
  cycleAttenuator,
  cyclePreamp,
  cycleAgc,
  getAttenuatorLabel,
  getPreampLabel,
  getAgcLabel,
  cwSettings,
  cwKeyActive,
  cwStuckAlert,
  history,
  potaEnabled,
  sotaEnabled,
  potaSpotsCollapsed,
  sotaSpotsCollapsed,
  filteredSpots,
  filteredSotaSpots,
  setPotaSpotsCollapsed,
  setSotaSpotsCollapsed,
  renderSpotsTable,
  renderSotaSpotsTable,
}: DesktopLayoutProps) {
  return (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    
    {/* Left Column: Frequency & Controls */}
    <div className="lg:col-span-2 space-y-6">
    
    {/* Frequency Displays */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <VfoPanel
        variant="desktop"
        vfo="A"
        connected={connected}
        status={status}
        vfoStep={vfoStep}
        setVfoStep={setVfoStep}
        inputVfoA={inputVfoA}
        setInputVfoA={setInputVfoA}
        inputVfoB={inputVfoB}
        setInputVfoB={setInputVfoB}
        vfoSupported={vfoSupported}
        adjustVfoFrequency={adjustVfoFrequency}
        handleSetVFO={handleSetVFO}
        handleToggleSplit={handleToggleSplit}
        handleSetFreq={handleSetFreq}
      />
      <VfoPanel
        variant="desktop"
        vfo="B"
        connected={connected}
        status={status}
        vfoStep={vfoStep}
        setVfoStep={setVfoStep}
        inputVfoA={inputVfoA}
        setInputVfoA={setInputVfoA}
        inputVfoB={inputVfoB}
        setInputVfoB={setInputVfoB}
        vfoSupported={vfoSupported}
        adjustVfoFrequency={adjustVfoFrequency}
        handleSetVFO={handleSetVFO}
        handleToggleSplit={handleToggleSplit}
        handleSetFreq={handleSetFreq}
      />
    </div>

    <PanelChrome
      title="Quick Controls"
      isCollapsed={isDesktopControlsCollapsed}
      setIsCollapsed={setIsDesktopControlsCollapsed}
      bodyClassName="p-6"
      headerSize="lg"
    >
      <ControlsPanel
        variant="desktop"
        connected={connected}
        status={status}
        isTuning={isTuning}
        tuneJustFinished={tuneJustFinished}
        cwSettings={cwSettings}
        cwKeyActive={cwKeyActive}
        cwStuckAlert={cwStuckAlert}
        attenuatorLevels={attenuatorLevels}
        preampLevels={preampLevels}
        agcLevels={agcLevels}
        nbCapabilities={nbCapabilities}
        nrCapabilities={nrCapabilities}
        anfCapabilities={anfCapabilities}
        handleSetPTT={handleSetPTT}
        handleSetFunc={handleSetFunc}
        handleVfoOp={handleVfoOp}
        cycleAttenuator={cycleAttenuator}
        cyclePreamp={cyclePreamp}
        cycleAgc={cycleAgc}
        getAttenuatorLabel={getAttenuatorLabel}
        getPreampLabel={getPreampLabel}
        getAgcLabel={getAgcLabel}
      />
    </PanelChrome>

    {/* Mode & Bandwidth */}
    <ModeBwPanel
      variant="desktop"
      connected={connected}
      localMode={localMode}
      availableModes={availableModes}
      handleSetMode={handleSetMode}
      bandwidth={status?.bandwidth || "2400"}
      handleSetBw={handleSetBw}
      isModeCollapsed={isDesktopModeCollapsed}
      setIsModeCollapsed={setIsDesktopModeCollapsed}
      isBwCollapsed={isDesktopBwCollapsed}
      setIsBwCollapsed={setIsDesktopBwCollapsed}
    />

    {/* Video Feed Section */}
    <PanelChrome
      title="Video & Audio"
      isCollapsed={isVideoCollapsed}
      setIsCollapsed={setIsVideoCollapsed}
      headerActions={
        <VideoAudioHeaderActions
          variant="desktop"
          socket={socket}
          videoStatus={videoStatus}
          setIsVideoSettingsOpen={setIsVideoSettingsOpen}
          enumerateVideoDevices={enumerateVideoDevices}
          isElectronSource={isElectronSource}
          audioStatus={audioStatus}
          localAudioReady={localAudioReady}
          audioWasRestarted={audioWasRestarted}
          audioSettings={audioSettings}
          inboundMuted={inboundMuted}
          setInboundMuted={setInboundMuted}
          outboundMuted={outboundMuted}
          setOutboundMuted={setOutboundMuted}
          handleJoinAudio={handleJoinAudio}
        />
      }
      className="shadow-lg"
      bodyClassName="p-0"
      headerSize="lg"
    >
      <VideoAudioPanel
        variant="desktop"
        socket={socket}
        videoStatus={videoStatus}
        isElectronSource={isElectronSource}
        videoError={videoError}
        setVideoError={setVideoError}
        videoPreviewCallbackRef={videoPreviewCallbackRef}
        videoCanvasRef={videoCanvasRef}
      />
    </PanelChrome>

    {potaEnabled && (
      <PanelChrome
        title="POTA Spots"
        isCollapsed={potaSpotsCollapsed}
        setIsCollapsed={setPotaSpotsCollapsed}
        headerActions={
          <span className="text-[0.5rem] text-[#8e9299]">
            {filteredSpots.length} spot{filteredSpots.length !== 1 ? "s" : ""}
          </span>
        }
        bodyClassName="p-0"
        headerSize="lg"
      >
        <SpotsPanel
          variant="desktop"
          type="pota"
          renderTable={() => renderSpotsTable(true)}
        />
      </PanelChrome>
    )}
    {sotaEnabled && (
      <PanelChrome
        title="SOTA Spots"
        isCollapsed={sotaSpotsCollapsed}
        setIsCollapsed={setSotaSpotsCollapsed}
        headerActions={
          <span className="text-[0.5rem] text-[#8e9299]">
            {filteredSotaSpots.length} spot{filteredSotaSpots.length !== 1 ? "s" : ""}
          </span>
        }
        bodyClassName="p-0"
        headerSize="lg"
      >
        <SpotsPanel
          variant="desktop"
          type="sota"
          renderTable={() => renderSotaSpotsTable()}
        />
      </PanelChrome>
    )}
  </div>

  {/* Right Column: Meters & Graphs */}
  <div className="space-y-6">

    {/* RF Power & DNR Slider */}
    <RfLevelsPanel
      variant="desktop"
      connected={connected}
      localRFPower={localRFPower}
      setLocalRFPower={setLocalRFPower}
      rfPowerCapabilities={rfPowerCapabilities}
      isDraggingRF={isDraggingRF}
      localRFLevel={localRFLevel}
      setLocalRFLevel={setLocalRFLevel}
      isDraggingRFLevel={isDraggingRFLevel}
      localNRLevel={localNRLevel}
      setLocalNRLevel={setLocalNRLevel}
      nrCapabilities={nrCapabilities}
      isDraggingNR={isDraggingNR}
      localNBLevel={localNBLevel}
      setLocalNBLevel={setLocalNBLevel}
      nbCapabilities={nbCapabilities}
      isDraggingNB={isDraggingNB}
      isCollapsed={isDesktopRFPowerCollapsed}
      setIsCollapsed={setIsDesktopRFPowerCollapsed}
    />

    <SMeterPanel
      status={status}
      history={history}
      isCollapsed={isDesktopSMeterCollapsed}
      setIsCollapsed={setIsDesktopSMeterCollapsed}
    />

    <SwrPanel
      status={status}
      history={history}
      isCollapsed={isDesktopSWRCollapsed}
      setIsCollapsed={setIsDesktopSWRCollapsed}
    />

    <AlcPanel
      history={history}
      isCollapsed={isDesktopALCCollapsed}
      setIsCollapsed={setIsDesktopALCCollapsed}
    />
  </div>
</div>
  );
}

export default React.memo(DesktopLayout);
