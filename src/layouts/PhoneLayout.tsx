import React, { useMemo, useState, lazy, Suspense } from "react";
import type { Socket } from "socket.io-client";
import { Radio, Monitor, Zap, MapPin, Settings, Map } from "lucide-react";
import { cn } from "../utils";
import type {
  RigStatus,
  AudioSettings,
  NbCapabilities,
  NrCapabilities,
  AnfCapabilities,
  RfPowerCapabilities,
  RfLevelCapabilities,
  ConsoleLog,
  SpectrumData,
  SpectrumSettings,
} from "../types";
import type { GridItem, GridLayoutCallbacks, PanelType, ViewLayout } from "../types/layout";
import { PANEL_LABELS } from "../types/layout";
import type { SolarData } from "../types/solar";
import SolarPanel from "../panels/SolarPanel";
import MufMapPanel from "../panels/MufMapPanel";
import PanelChrome from "../components/PanelChrome";
import EditToolbar from "../components/EditToolbar";
import PanelPicker from "../components/PanelPicker";
import CommandConsolePanel from "../panels/CommandConsolePanel";
import CwDecodePanel from "../panels/CwDecodePanel";
import Ft8DecodePanel, { Ft8DepthSelect } from "../panels/Ft8DecodePanel";
import type { Ft8Decode, Ft8Depth } from "../ft8Decoder";
import RfLevelsPanel from "../panels/RfLevelsPanel";
import VfoPanel, { VfoCollapsedHeader } from "../panels/VfoPanel";
import VideoFeedPanel, { VideoFeedHeaderActions } from "../panels/VideoFeedPanel";
import { AudioFeedHeaderActions } from "../panels/AudioFeedPanel";
import SpotsPanel, { SpotSettingsGear } from "../panels/SpotsPanel";
import SpotComboPanel from "../panels/SpotComboPanel";
// Lazy-loaded: only opened via explicit user action (settings gear icons), see issue #109.
const SpotSettingsModal = lazy(() => import("../modals/SpotSettingsModal"));
const ComboSpotSettingsModal = lazy(() => import("../modals/ComboSpotSettingsModal"));
const DxSpotSettingsModal = lazy(() => import("../modals/DxSpotSettingsModal"));
import ControlsPanel from "../panels/ControlsPanel";
import TabbedMeterPanel, {
  TabbedMeterHeaderContent,
} from "../panels/TabbedMeterPanel";
import SpectrumHamlibPanel from "../panels/SpectrumHamlibPanel";
import SpectrumAudioPanel from "../panels/SpectrumAudioPanel";

const PHONE_PANEL_TYPES: PanelType[] = [
  'vfo', 'video_feed', 'audio_feed', 'smeter', 'controls',
  'spots_pota', 'spots_sota', 'spots_wwff', 'spots_dx', 'spots_combo', 'cwdecode', 'ft8decode', 'commandconsole', 'solar', 'mufmap',
  'spectrum_hamlib', 'spectrum_audio',
];

export interface PhoneLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
  socket: Socket | null;
  callsign?: string;

  // VFO
  vfoStep: number;
  inputVfoA: string;
  inputVfoB: string;
  localMode: string;
  setVfoStep: React.Dispatch<React.SetStateAction<number>>;
  setInputVfoA: React.Dispatch<React.SetStateAction<string>>;
  setInputVfoB: React.Dispatch<React.SetStateAction<string>>;
  isPhoneVFOCollapsed: boolean;
  setIsPhoneVFOCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  adjustVfoFrequency: (targetVfo: "A" | "B", direction: 1 | -1) => void;
  handleSetVFO: (vfo: string) => void;
  handleToggleSplit: () => void;
  handleSetFreq: (freq: string) => void;
  handleSetMode: (mode: string) => void;
  handleSetBw: (bw: number) => void;
  bwDisabled: boolean;

  // Video feed
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

  // Audio feed
  audioStatus: "playing" | "stopped" | "cooldown";
  isAudioFeedCollapsed: boolean;
  setIsAudioFeedCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAudioSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  localAudioReady: boolean;
  inboundMuted: boolean;
  outboundMuted: boolean;
  audioSettings: AudioSettings;
  audioWasRestarted: boolean;
  setInboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setOutboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleJoinAudio: () => void;

  // Meters
  isPhoneMeterCollapsed: boolean;
  phoneMeterTab: "signal" | "swr" | "alc";
  history: any[];
  setIsPhoneMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setPhoneMeterTab: React.Dispatch<
    React.SetStateAction<"signal" | "swr" | "alc">
  >;

  // Quick controls
  isPhoneQuickControlsCollapsed: boolean;
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
  rfLevelCapabilities: RfLevelCapabilities;
  localRFLevel: number;
  localNRLevel: number;
  localNBLevel: number;
  isDraggingRF: React.MutableRefObject<boolean>;
  isDraggingRFLevel: React.MutableRefObject<boolean>;
  isDraggingNR: React.MutableRefObject<boolean>;
  isDraggingNB: React.MutableRefObject<boolean>;
  setIsPhoneQuickControlsCollapsed: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  setLocalRFPower: React.Dispatch<React.SetStateAction<number>>;
  setLocalRFLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNRLevel: React.Dispatch<React.SetStateAction<number>>;
  setLocalNBLevel: React.Dispatch<React.SetStateAction<number>>;
  powerSupported: boolean;
  poweringOn: boolean;
  knownPoweredOff: boolean;
  handleSetPower: (state: boolean) => void;
  handleSetPTT: (state: boolean) => void;
  handleSetFunc: (func: string, state: boolean) => void;
  handleVfoOp: (op: string) => void;
  cycleAttenuator: () => void;
  cyclePreamp: () => void;
  cycleAgc: () => void;
  getAttenuatorLabel: () => string;
  getPreampLabel: () => string;
  getAgcLabel: () => string;

  // POTA spots
  potaSpotsCollapsed: boolean;
  filteredSpots: any[];
  setPotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  potaPollRate: number;
  setPotaPollRate: (v: number) => void;
  potaMaxAge: number;
  setPotaMaxAge: (v: number) => void;
  potaModeFilter: string[];
  setPotaModeFilter: (v: string[]) => void;
  potaBandFilter: string[];
  setPotaBandFilter: (v: string[]) => void;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;

  // SOTA spots
  sotaSpotsCollapsed: boolean;
  filteredSotaSpots: any[];
  setSotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  sotaPollRate: number;
  setSotaPollRate: (v: number) => void;
  sotaMaxAge: number;
  setSotaMaxAge: (v: number) => void;
  sotaModeFilter: string[];
  setSotaModeFilter: (v: string[]) => void;
  sotaBandFilter: string[];
  setSotaBandFilter: (v: string[]) => void;
  renderSotaSpotsTable: () => React.ReactElement;

  // WWFF spots
  wwffSpotsCollapsed: boolean;
  filteredWwffSpots: any[];
  setWwffSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  wwffPollRate: number;
  setWwffPollRate: (v: number) => void;
  wwffMaxAge: number;
  setWwffMaxAge: (v: number) => void;
  wwffModeFilter: string[];
  setWwffModeFilter: (v: string[]) => void;
  wwffBandFilter: string[];
  setWwffBandFilter: (v: string[]) => void;
  renderWwffSpotsTable: () => React.ReactElement;

  // DX cluster spots
  dxSpotsCollapsed: boolean;
  filteredDxSpots: any[];
  setDxSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  dxClusterEnabled: boolean;
  setDxClusterEnabled: (v: boolean) => void;
  dxHost: string;
  setDxHost: (v: string) => void;
  dxPort: number;
  setDxPort: (v: number) => void;
  dxLoginCallsign: string;
  setDxLoginCallsign: (v: string) => void;
  dxMaxAge: number;
  setDxMaxAge: (v: number) => void;
  dxCallsignFilter: string[];
  setDxCallsignFilter: (v: string[]) => void;
  dxKeywordFilter: string[];
  setDxKeywordFilter: (v: string[]) => void;
  dxBandFilter: string[];
  setDxBandFilter: (v: string[]) => void;
  dxConnected: boolean;
  dxError: string | null;
  renderDxSpotsTable: () => React.ReactElement;

  // CW
  cwDecodedText: string;
  setCwDecodedText: React.Dispatch<React.SetStateAction<string>>;
  cwStats: { pitch: number; speed: number };
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;
  ft8Decodes: Ft8Decode[];
  ft8Depth: Ft8Depth;
  setFt8Depth: (depth: Ft8Depth) => void;
  ft8ScrollContainerRef: React.RefObject<HTMLDivElement>;

  // Command console
  isConsoleCollapsed: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setIsConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;

  // Solar conditions
  solarData: SolarData | null;
  requestSolarData: () => void;

  // Spectrum scope (CI-V)
  latestSpectrumRef: React.MutableRefObject<SpectrumData | null>;
  waterfallHistoryRef: React.MutableRefObject<number[][]>;
  spectrumSupported: boolean;
  spectrumEnabled: boolean;
  spectrumSettings: SpectrumSettings;
  setSpectrumSettings: React.Dispatch<React.SetStateAction<SpectrumSettings>>;

  // Audio waterfall
  analyserNodeRef: React.MutableRefObject<AnalyserNode | null>;

  // Collapse state for combo spots / solar / mufmap / cwdecode / spectrum panels
  isComboSpotsCollapsed: boolean;
  setIsComboSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isSolarCollapsed: boolean;
  setIsSolarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isMufMapCollapsed: boolean;
  setIsMufMapCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isCwDecodeCollapsed: boolean;
  setIsCwDecodeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isFt8DecodeCollapsed: boolean;
  setIsFt8DecodeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isSpectrumHamlibCollapsed: boolean;
  setIsSpectrumHamlibCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isSpectrumAudioCollapsed: boolean;
  setIsSpectrumAudioCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // Grid layout
  phoneLayout: ViewLayout;
  isEditMode: boolean;
  gridCallbacks?: GridLayoutCallbacks;
}

// Computes the two updated {i, x, y, w, h} entries produced by swapping
// `item` with its adjacent neighbor (by sorted y) in `direction`. Returns
// null at either boundary — first item can't move up, last can't move down.
export function computeSwappedPositions(
  item: GridItem,
  direction: 'up' | 'down',
  idx: number,
  visibleItems: GridItem[],
): Array<{ i: string; x: number; y: number; w: number; h: number }> | null {
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= visibleItems.length) return null;
  const a = item;
  const b = visibleItems[targetIdx];
  return [
    { i: a.i, x: a.x, y: b.y, w: a.w, h: a.h },
    { i: b.i, x: b.x, y: a.y, w: b.w, h: b.h },
  ];
}

function PhoneLayout({
  status,
  connected,
  availableModes,
  socket,
  callsign = "",
  vfoStep,
  inputVfoA,
  inputVfoB,
  localMode,
  setVfoStep,
  setInputVfoA,
  setInputVfoB,
  isPhoneVFOCollapsed,
  setIsPhoneVFOCollapsed,
  adjustVfoFrequency,
  handleSetVFO,
  handleToggleSplit,
  handleSetFreq,
  handleSetMode,
  handleSetBw,
  bwDisabled,
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
  isAudioFeedCollapsed,
  setIsAudioFeedCollapsed,
  setIsAudioSettingsOpen,
  localAudioReady,
  inboundMuted,
  outboundMuted,
  audioSettings,
  audioWasRestarted,
  setInboundMuted,
  setOutboundMuted,
  handleJoinAudio,
  isPhoneMeterCollapsed,
  phoneMeterTab,
  history,
  setIsPhoneMeterCollapsed,
  setPhoneMeterTab,
  isPhoneQuickControlsCollapsed,
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
  rfLevelCapabilities,
  localRFLevel,
  localNRLevel,
  localNBLevel,
  isDraggingRF,
  isDraggingRFLevel,
  isDraggingNR,
  isDraggingNB,
  setIsPhoneQuickControlsCollapsed,
  setLocalRFPower,
  setLocalRFLevel,
  setLocalNRLevel,
  setLocalNBLevel,
  powerSupported,
  poweringOn,
  knownPoweredOff,
  handleSetPower,
  handleSetPTT,
  handleSetFunc,
  handleVfoOp,
  cycleAttenuator,
  cyclePreamp,
  cycleAgc,
  getAttenuatorLabel,
  getPreampLabel,
  getAgcLabel,
  potaSpotsCollapsed,
  filteredSpots,
  setPotaSpotsCollapsed,
  potaPollRate,
  setPotaPollRate,
  potaMaxAge,
  setPotaMaxAge,
  potaModeFilter,
  setPotaModeFilter,
  potaBandFilter,
  setPotaBandFilter,
  renderSpotsTable,
  sotaSpotsCollapsed,
  filteredSotaSpots,
  setSotaSpotsCollapsed,
  sotaPollRate,
  setSotaPollRate,
  sotaMaxAge,
  setSotaMaxAge,
  sotaModeFilter,
  setSotaModeFilter,
  sotaBandFilter,
  setSotaBandFilter,
  renderSotaSpotsTable,
  wwffSpotsCollapsed,
  filteredWwffSpots,
  setWwffSpotsCollapsed,
  wwffPollRate,
  setWwffPollRate,
  wwffMaxAge,
  setWwffMaxAge,
  wwffModeFilter,
  setWwffModeFilter,
  wwffBandFilter,
  setWwffBandFilter,
  renderWwffSpotsTable,
  dxSpotsCollapsed,
  filteredDxSpots,
  setDxSpotsCollapsed,
  dxClusterEnabled,
  setDxClusterEnabled,
  dxHost,
  setDxHost,
  dxPort,
  setDxPort,
  dxLoginCallsign,
  setDxLoginCallsign,
  dxMaxAge,
  setDxMaxAge,
  dxCallsignFilter,
  setDxCallsignFilter,
  dxKeywordFilter,
  setDxKeywordFilter,
  dxBandFilter,
  setDxBandFilter,
  dxConnected,
  dxError,
  renderDxSpotsTable,
  cwDecodedText,
  setCwDecodedText,
  cwStats,
  cwScrollContainerRef,
  ft8Decodes,
  ft8Depth,
  setFt8Depth,
  ft8ScrollContainerRef,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
  solarData,
  requestSolarData,
  latestSpectrumRef,
  waterfallHistoryRef,
  spectrumSupported,
  spectrumEnabled,
  spectrumSettings,
  setSpectrumSettings,
  analyserNodeRef,
  isComboSpotsCollapsed,
  setIsComboSpotsCollapsed,
  isSolarCollapsed,
  setIsSolarCollapsed,
  isMufMapCollapsed,
  setIsMufMapCollapsed,
  isCwDecodeCollapsed,
  setIsCwDecodeCollapsed,
  isFt8DecodeCollapsed,
  setIsFt8DecodeCollapsed,
  isSpectrumHamlibCollapsed,
  setIsSpectrumHamlibCollapsed,
  isSpectrumAudioCollapsed,
  setIsSpectrumAudioCollapsed,
  phoneLayout,
  isEditMode,
  gridCallbacks,
}: PhoneLayoutProps) {

  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const [showPotaSettings, setShowPotaSettings] = useState(false);
  const [showSotaSettings, setShowSotaSettings] = useState(false);
  const [showWwffSettings, setShowWwffSettings] = useState(false);
  const [showDxSettings, setShowDxSettings] = useState(false);
  const [showComboSettings, setShowComboSettings] = useState(false);

  const existingPhonePanelTypes = useMemo(() => {
    const types = new Set<PanelType>();
    phoneLayout.items.forEach(item => {
      if (item.panelType) types.add(item.panelType);
    });
    return types;
  }, [phoneLayout.items]);

  const visibleItems = useMemo(() => {
    return [...phoneLayout.items].sort((a, b) => a.y - b.y);
  }, [phoneLayout.items]);

  function movePhonePanel(item: GridItem, direction: 'up' | 'down', idx: number) {
    const updates = computeSwappedPositions(item, direction, idx, visibleItems);
    if (updates) gridCallbacks?.updateItemPositions(updates);
  }

  function renderPhonePanel(item: GridItem): React.ReactNode {
    const panelType = item.panelType;
    switch (panelType) {
      case 'vfo':
        return (
          <PanelChrome
            title="VFO"
            icon={<Radio size={12} />}
            isCollapsed={isPhoneVFOCollapsed}
            setIsCollapsed={setIsPhoneVFOCollapsed}
            collapsedContent={
              <VfoCollapsedHeader
                status={status}
                inputVfoA={inputVfoA}
                inputVfoB={inputVfoB}
                localMode={localMode}
                vfoStep={vfoStep}
                connected={connected}
                adjustVfoFrequency={adjustVfoFrequency}
              />
            }
            className={cn(
              "shadow-lg",
              status.isSplit
                ? "border-amber-500/30"
                : status.vfo === "VFOA"
                ? "border-emerald-500/30"
                : status.vfo === "VFOB"
                ? "border-blue-500/30"
                : "border-[#2a2b2e]"
            )}
            bodyClassName="p-3 space-y-2"
            headerSize="md"
          >
            <VfoPanel
              variant="phone"
              connected={connected}
              status={status}
              vfoStep={vfoStep}
              setVfoStep={setVfoStep}
              inputVfoA={inputVfoA}
              setInputVfoA={setInputVfoA}
              inputVfoB={inputVfoB}
              setInputVfoB={setInputVfoB}
              adjustVfoFrequency={adjustVfoFrequency}
              handleSetVFO={handleSetVFO}
              handleToggleSplit={handleToggleSplit}
              handleSetFreq={handleSetFreq}
              localMode={localMode}
              availableModes={availableModes}
              handleSetMode={handleSetMode}
              handleSetBw={handleSetBw}
              bandwidth={status?.bandwidth || "2400"}
              bwDisabled={bwDisabled}
            />
          </PanelChrome>
        );

      case 'video_feed':
        return (
          <PanelChrome
            title="Video Feed"
            icon={<Monitor size={12} />}
            isCollapsed={isVideoCollapsed}
            setIsCollapsed={setIsVideoCollapsed}
            headerActions={
              <VideoFeedHeaderActions
                variant="phone"
                socket={socket}
                videoStatus={videoStatus}
                setIsVideoSettingsOpen={setIsVideoSettingsOpen}
                enumerateVideoDevices={enumerateVideoDevices}
                isElectronSource={isElectronSource}
              />
            }
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="md"
          >
            <VideoFeedPanel
              variant="phone"
              socket={socket}
              videoStatus={videoStatus}
              isElectronSource={isElectronSource}
              videoError={videoError}
              setVideoError={setVideoError}
              videoPreviewCallbackRef={videoPreviewCallbackRef}
              videoCanvasRef={videoCanvasRef}
            />
          </PanelChrome>
        );

      case 'audio_feed':
        return (
          <PanelChrome
            title="Audio Feed"
            icon={<Radio size={12} />}
            isCollapsed={isAudioFeedCollapsed}
            setIsCollapsed={setIsAudioFeedCollapsed}
            headerActions={
              <AudioFeedHeaderActions
                variant="phone"
                socket={socket}
                audioStatus={audioStatus}
                localAudioReady={localAudioReady}
                audioWasRestarted={audioWasRestarted}
                audioSettings={audioSettings}
                inboundMuted={inboundMuted}
                setInboundMuted={setInboundMuted}
                outboundMuted={outboundMuted}
                setOutboundMuted={setOutboundMuted}
                handleJoinAudio={handleJoinAudio}
                setIsAudioSettingsOpen={setIsAudioSettingsOpen}
              />
            }
            className="shadow-lg"
            headerSize="md"
            hideCollapse
          >
            {null}
          </PanelChrome>
        );

      case 'smeter':
        return (
          <PanelChrome
            isCollapsed={isPhoneMeterCollapsed}
            setIsCollapsed={setIsPhoneMeterCollapsed}
            customHeaderContent={
              <TabbedMeterHeaderContent
                isCollapsed={isPhoneMeterCollapsed}
                status={status}
                meterTab={phoneMeterTab}
                setMeterTab={setPhoneMeterTab}
              />
            }
            bodyClassName="p-3"
            headerSize="md"
          >
            <TabbedMeterPanel
              status={status}
              history={history}
              meterTab={phoneMeterTab}
            />
          </PanelChrome>
        );

      case 'controls':
        return (
          <PanelChrome
            title="Quick Controls"
            icon={<Zap size={12} />}
            isCollapsed={isPhoneQuickControlsCollapsed}
            setIsCollapsed={setIsPhoneQuickControlsCollapsed}
            bodyClassName="p-3 flex flex-col gap-4"
            headerSize="md"
          >
            <ControlsPanel
              variant="phone"
              connected={connected}
              status={status}
              isTuning={isTuning}
              tuneJustFinished={tuneJustFinished}
              attenuatorLevels={attenuatorLevels}
              preampLevels={preampLevels}
              agcLevels={agcLevels}
              nbCapabilities={nbCapabilities}
              nrCapabilities={nrCapabilities}
              anfCapabilities={anfCapabilities}
              powerSupported={powerSupported}
              powerState={status.powerState ?? 'unknown'}
              poweringOn={poweringOn}
              knownPoweredOff={knownPoweredOff}
              handleSetPower={handleSetPower}
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
            <div className="flex flex-col gap-3">
              <RfLevelsPanel
                variant="phone"
                connected={connected}
                localRFPower={localRFPower}
                setLocalRFPower={setLocalRFPower}
                rfPowerCapabilities={rfPowerCapabilities}
                isDraggingRF={isDraggingRF}
                localRFLevel={localRFLevel}
                setLocalRFLevel={setLocalRFLevel}
                rfLevelCapabilities={rfLevelCapabilities}
                isDraggingRFLevel={isDraggingRFLevel}
                localNRLevel={localNRLevel}
                setLocalNRLevel={setLocalNRLevel}
                nrCapabilities={nrCapabilities}
                isDraggingNR={isDraggingNR}
                localNBLevel={localNBLevel}
                setLocalNBLevel={setLocalNBLevel}
                nbCapabilities={nbCapabilities}
                isDraggingNB={isDraggingNB}
              />
            </div>
          </PanelChrome>
        );

      case 'spots_pota':
        return (
          <PanelChrome
            title="POTA Spots"
            icon={<MapPin size={12} />}
            isCollapsed={potaSpotsCollapsed}
            setIsCollapsed={setPotaSpotsCollapsed}
            headerActions={
              <div className="flex items-center gap-1.5">
                <span className="text-[0.5rem] text-[#8e9299]">
                  {filteredSpots.length} spot{filteredSpots.length !== 1 ? "s" : ""}
                </span>
                <SpotSettingsGear accent="emerald" onClick={() => setShowPotaSettings(true)} />
              </div>
            }
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotsPanel
              type="pota"
              renderTable={() => renderSpotsTable(false)}
            />
          </PanelChrome>
        );

      case 'spots_sota':
        return (
          <PanelChrome
            title="SOTA Spots"
            icon={<MapPin size={12} />}
            isCollapsed={sotaSpotsCollapsed}
            setIsCollapsed={setSotaSpotsCollapsed}
            headerActions={
              <div className="flex items-center gap-1.5">
                <span className="text-[0.5rem] text-[#8e9299]">
                  {filteredSotaSpots.length} spot{filteredSotaSpots.length !== 1 ? "s" : ""}
                </span>
                <SpotSettingsGear accent="amber" onClick={() => setShowSotaSettings(true)} />
              </div>
            }
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotsPanel
              type="sota"
              renderTable={() => renderSotaSpotsTable()}
            />
          </PanelChrome>
        );

      case 'spots_wwff':
        return (
          <PanelChrome
            title="WWFF Spots"
            icon={<MapPin size={12} />}
            isCollapsed={wwffSpotsCollapsed}
            setIsCollapsed={setWwffSpotsCollapsed}
            headerActions={
              <div className="flex items-center gap-1.5">
                <span className="text-[0.5rem] text-[#8e9299]">
                  {filteredWwffSpots.length} spot{filteredWwffSpots.length !== 1 ? "s" : ""}
                </span>
                <SpotSettingsGear accent="sky" onClick={() => setShowWwffSettings(true)} />
              </div>
            }
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotsPanel
              type="wwff"
              renderTable={() => renderWwffSpotsTable()}
            />
          </PanelChrome>
        );

      case 'spots_dx':
        return (
          <PanelChrome
            title="DX Cluster"
            icon={<MapPin size={12} />}
            isCollapsed={dxSpotsCollapsed}
            setIsCollapsed={setDxSpotsCollapsed}
            headerActions={
              <div className="flex items-center gap-1.5">
                <span className="text-[0.5rem] text-[#8e9299]">
                  {filteredDxSpots.length} spot{filteredDxSpots.length !== 1 ? "s" : ""}
                </span>
                <SpotSettingsGear accent="rose" onClick={() => setShowDxSettings(true)} />
              </div>
            }
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotsPanel
              type="dx"
              renderTable={() => renderDxSpotsTable()}
            />
          </PanelChrome>
        );

      case 'spots_combo':
        return (
          <PanelChrome
            title="All Spots"
            icon={<MapPin size={12} />}
            isCollapsed={isComboSpotsCollapsed}
            setIsCollapsed={setIsComboSpotsCollapsed}
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotComboPanel
              renderPotaTable={renderSpotsTable}
              renderSotaTable={renderSotaSpotsTable}
              renderWwffTable={renderWwffSpotsTable}
              renderDxTable={renderDxSpotsTable}
              onOpenSettings={() => setShowComboSettings(true)}
              callsign={callsign}
            />
          </PanelChrome>
        );

      case 'cwdecode':
        return (
          <CwDecodePanel
            variant="standalone"
            cwDecodedText={cwDecodedText}
            setCwDecodedText={setCwDecodedText}
            cwStats={cwStats}
            cwScrollContainerRef={cwScrollContainerRef}
            isCollapsed={isCwDecodeCollapsed}
            setIsCollapsed={setIsCwDecodeCollapsed}
          />
        );

      case 'ft8decode':
        return (
          <PanelChrome
            title="FT8 Decoder"
            icon={<Radio size={12} />}
            isCollapsed={isFt8DecodeCollapsed}
            setIsCollapsed={setIsFt8DecodeCollapsed}
            headerActions={<Ft8DepthSelect depth={ft8Depth} onChange={setFt8Depth} />}
            bodyClassName="p-0"
            headerSize="md"
          >
            <Ft8DecodePanel ft8Decodes={ft8Decodes} ft8ScrollContainerRef={ft8ScrollContainerRef} />
          </PanelChrome>
        );

      case 'commandconsole':
        return (
          <PanelChrome
            title="Rigctld Command Console"
            icon={<Settings size={12} />}
            isCollapsed={isConsoleCollapsed}
            setIsCollapsed={setIsConsoleCollapsed}
            bodyClassName="p-3"
            headerSize="md"
          >
            <CommandConsolePanel
              variant="phone"
              connected={connected}
              consoleLogs={consoleLogs}
              rawCommand={rawCommand}
              setRawCommand={setRawCommand}
              handleSendRaw={handleSendRaw}
            />
          </PanelChrome>
        );

      case 'solar':
        return (
          <PanelChrome
            title="Solar Conditions"
            icon={<span className="text-sky-400 text-[0.6rem]">☀</span>}
            isCollapsed={isSolarCollapsed}
            setIsCollapsed={setIsSolarCollapsed}
            bodyClassName="p-0"
            headerSize="md"
          >
            <SolarPanel solarData={solarData} onRefresh={requestSolarData} />
          </PanelChrome>
        );

      case 'mufmap':
        return (
          <PanelChrome
            title="MUF Map"
            icon={<Map size={12} />}
            isCollapsed={isMufMapCollapsed}
            setIsCollapsed={setIsMufMapCollapsed}
            bodyClassName="p-0"
            headerSize="md"
          >
            <MufMapPanel heightPx={item.heightPx} callsign={callsign} />
          </PanelChrome>
        );

      case 'spectrum_hamlib':
        return (
          <SpectrumHamlibPanel
            latestSpectrumRef={latestSpectrumRef}
            waterfallHistoryRef={waterfallHistoryRef}
            spectrumSupported={spectrumSupported}
            spectrumEnabled={spectrumEnabled}
            spectrumSettings={spectrumSettings}
            setSpectrumSettings={setSpectrumSettings}
            socket={socket}
            connected={connected}
            handleSetFreq={handleSetFreq}
            isCollapsed={isSpectrumHamlibCollapsed}
            setIsCollapsed={setIsSpectrumHamlibCollapsed}
            heightPx={item.heightPx}
            callsign={callsign}
          />
        );

      case 'spectrum_audio':
        return (
          <SpectrumAudioPanel
            analyserNodeRef={analyserNodeRef}
            audioStatus={audioStatus}
            isCollapsed={isSpectrumAudioCollapsed}
            setIsCollapsed={setIsSpectrumAudioCollapsed}
            heightPx={item.heightPx}
            bandwidth={parseInt(status?.bandwidth ?? "0", 10) || 0}
            mode={status?.mode ?? ""}
            callsign={callsign}
          />
        );

      default:
        return null;
    }
  }

  return (
    <div className={cn("space-y-2 animate-in fade-in duration-300", isEditMode && "pb-16")}>
      {visibleItems.map((item, idx) => (
        <div key={item.i} className="relative">
          {renderPhonePanel(item)}
          {isEditMode && (
            <div className="absolute top-1.5 right-1.5 z-30 flex items-center gap-0.5">
              <button
                disabled={idx === 0}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); movePhonePanel(item, 'up', idx); }}
                className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
                title="Move up"
              >▲</button>
              <button
                disabled={idx === visibleItems.length - 1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); movePhonePanel(item, 'down', idx); }}
                className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
                title="Move down"
              >▼</button>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); gridCallbacks?.removePanel(item.i); }}
                className="w-6 h-6 flex items-center justify-center rounded bg-red-500/80 hover:bg-red-500 text-white text-[10px] ml-0.5 transition-all"
                title={`Remove ${PANEL_LABELS[item.panelType!] ?? item.panelType}`}
              >×</button>
            </div>
          )}
        </div>
      ))}

      {isEditMode && gridCallbacks && (
        <>
          <EditToolbar
            cols={1}
            rows={phoneLayout.items.length}
            showColsControl={false}
            showRowsControl={false}
            onColsChange={() => {}}
            onRowsChange={() => {}}
            onAddPanel={() => setShowPanelPicker(true)}
            onReset={() => gridCallbacks.resetToDefault()}
            onDone={() => gridCallbacks.onExitEditMode()}
          />
          {showPanelPicker && (
            <PanelPicker
              availableTypes={PHONE_PANEL_TYPES}
              existingTypes={existingPhonePanelTypes}
              onSelect={(type, config) => { gridCallbacks.addPanel(type, config); setShowPanelPicker(false); }}
              onClose={() => setShowPanelPicker(false)}
            />
          )}
        </>
      )}

      {(showPotaSettings || showSotaSettings || showWwffSettings) && (
        <Suspense fallback={null}>
          {showPotaSettings && (
            <SpotSettingsModal
              isOpen={showPotaSettings}
              onClose={() => setShowPotaSettings(false)}
              type="pota"
              pollRate={potaPollRate} setPollRate={setPotaPollRate}
              maxAge={potaMaxAge} setMaxAge={setPotaMaxAge}
              modeFilter={potaModeFilter} setModeFilter={setPotaModeFilter}
              bandFilter={potaBandFilter} setBandFilter={setPotaBandFilter}
            />
          )}
          {showSotaSettings && (
            <SpotSettingsModal
              isOpen={showSotaSettings}
              onClose={() => setShowSotaSettings(false)}
              type="sota"
              pollRate={sotaPollRate} setPollRate={setSotaPollRate}
              maxAge={sotaMaxAge} setMaxAge={setSotaMaxAge}
              modeFilter={sotaModeFilter} setModeFilter={setSotaModeFilter}
              bandFilter={sotaBandFilter} setBandFilter={setSotaBandFilter}
            />
          )}
          {showWwffSettings && (
            <SpotSettingsModal
              isOpen={showWwffSettings}
              onClose={() => setShowWwffSettings(false)}
              type="wwff"
              pollRate={wwffPollRate} setPollRate={setWwffPollRate}
              maxAge={wwffMaxAge} setMaxAge={setWwffMaxAge}
              modeFilter={wwffModeFilter} setModeFilter={setWwffModeFilter}
              bandFilter={wwffBandFilter} setBandFilter={setWwffBandFilter}
            />
          )}
        </Suspense>
      )}
      {showDxSettings && (
        <Suspense fallback={null}>
          <DxSpotSettingsModal
            isOpen={showDxSettings}
            onClose={() => setShowDxSettings(false)}
            dxClusterEnabled={dxClusterEnabled} setDxClusterEnabled={setDxClusterEnabled}
            dxHost={dxHost} setDxHost={setDxHost}
            dxPort={dxPort} setDxPort={setDxPort}
            dxLoginCallsign={dxLoginCallsign} setDxLoginCallsign={setDxLoginCallsign}
            dxMaxAge={dxMaxAge} setDxMaxAge={setDxMaxAge}
            dxCallsignFilter={dxCallsignFilter} setDxCallsignFilter={setDxCallsignFilter}
            dxKeywordFilter={dxKeywordFilter} setDxKeywordFilter={setDxKeywordFilter}
            dxBandFilter={dxBandFilter} setDxBandFilter={setDxBandFilter}
            dxConnected={dxConnected}
            dxError={dxError}
          />
        </Suspense>
      )}
      {showComboSettings && (
        <Suspense fallback={null}>
          <ComboSpotSettingsModal
            isOpen={showComboSettings}
            onClose={() => setShowComboSettings(false)}
            potaPollRate={potaPollRate} setPotaPollRate={setPotaPollRate}
            potaMaxAge={potaMaxAge} setPotaMaxAge={setPotaMaxAge}
            potaModeFilter={potaModeFilter} setPotaModeFilter={setPotaModeFilter}
            potaBandFilter={potaBandFilter} setPotaBandFilter={setPotaBandFilter}
            sotaPollRate={sotaPollRate} setSotaPollRate={setSotaPollRate}
            sotaMaxAge={sotaMaxAge} setSotaMaxAge={setSotaMaxAge}
            sotaModeFilter={sotaModeFilter} setSotaModeFilter={setSotaModeFilter}
            sotaBandFilter={sotaBandFilter} setSotaBandFilter={setSotaBandFilter}
            wwffPollRate={wwffPollRate} setWwffPollRate={setWwffPollRate}
            wwffMaxAge={wwffMaxAge} setWwffMaxAge={setWwffMaxAge}
            wwffModeFilter={wwffModeFilter} setWwffModeFilter={setWwffModeFilter}
            wwffBandFilter={wwffBandFilter} setWwffBandFilter={setWwffBandFilter}
            dxClusterEnabled={dxClusterEnabled} setDxClusterEnabled={setDxClusterEnabled}
            dxHost={dxHost} setDxHost={setDxHost}
            dxPort={dxPort} setDxPort={setDxPort}
            dxLoginCallsign={dxLoginCallsign} setDxLoginCallsign={setDxLoginCallsign}
            dxMaxAge={dxMaxAge} setDxMaxAge={setDxMaxAge}
            dxCallsignFilter={dxCallsignFilter} setDxCallsignFilter={setDxCallsignFilter}
            dxKeywordFilter={dxKeywordFilter} setDxKeywordFilter={setDxKeywordFilter}
            dxBandFilter={dxBandFilter} setDxBandFilter={setDxBandFilter}
            dxConnected={dxConnected}
            dxError={dxError}
          />
        </Suspense>
      )}
    </div>
  );
}

export default React.memo(PhoneLayout);
