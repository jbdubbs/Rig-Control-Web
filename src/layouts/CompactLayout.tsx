import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { Monitor, Radio, Settings, ChevronDown, ChevronUp, Sun, Map, MapPin } from "lucide-react";
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
} from "../types";
import type { GridItem, GridLayoutCallbacks, PanelType, ViewLayout } from "../types/layout";
import { PANEL_LABELS } from "../types/layout";
import type { SolarData } from "../types/solar";
import SolarPanel from "../panels/SolarPanel";
import MufMapPanel from "../panels/MufMapPanel";
import SpectrumHamlibPanel from "../panels/SpectrumHamlibPanel";
import SpectrumAudioPanel from "../panels/SpectrumAudioPanel";
import PanelChrome from "../components/PanelChrome";
import EditToolbar from "../components/EditToolbar";
import PanelPicker from "../components/PanelPicker";
import CommandConsolePanel from "../panels/CommandConsolePanel";
import RfLevelsPanel from "../panels/RfLevelsPanel";
import { MeterHistoryChart } from "../panels/TabbedMeterPanel";
import VfoPanel, { VfoCollapsedHeader } from "../panels/VfoPanel";
import VideoFeedPanel, { VideoFeedHeaderActions } from "../panels/VideoFeedPanel";
import { AudioFeedHeaderActions } from "../panels/AudioFeedPanel";
import ControlsPanel from "../panels/ControlsPanel";
import CwDecodePanel from "../panels/CwDecodePanel";
import Ft8DecodePanel, { Ft8DepthSelect } from "../panels/Ft8DecodePanel";
import type { Ft8Decode, Ft8Depth } from "../ft8Decoder";
import { SpotSettingsGear } from "../panels/SpotsPanel";
import SpotComboPanel from "../panels/SpotComboPanel";
import SpotSettingsModal from "../modals/SpotSettingsModal";
import ComboSpotSettingsModal from "../modals/ComboSpotSettingsModal";
import DxSpotSettingsModal from "../modals/DxSpotSettingsModal";

export type { GridLayoutCallbacks };

const COMPACT_PANEL_TYPES: PanelType[] = [
  'vfo', 'smeter', 'video_feed', 'audio_feed', 'controls', 'rflevels',
  'cwdecode', 'ft8decode', 'commandconsole', 'spots_pota', 'spots_sota', 'spots_wwff', 'spots_dx', 'spots_combo', 'solar', 'mufmap',
  'spectrum_hamlib', 'spectrum_audio',
];

export type CompactSegment =
  | { type: 'full'; item: GridItem }
  | { type: 'cols'; items: GridItem[] };

// Reassigns dense, sequential `y` values based on segment order, preserving
// the relative row order of items within each cols segment. Used to let
// full-width panels swap places with the cols block (or another full-width
// panel) so multiple full-width panels can stack at the top or bottom.
export function renumberSegments(segments: CompactSegment[]): Array<{ i: string; x: number; y: number; w: number; h: number }> {
  const updates: Array<{ i: string; x: number; y: number; w: number; h: number }> = [];
  let row = 0;
  for (const seg of segments) {
    if (seg.type === 'full') {
      updates.push({ i: seg.item.i, x: seg.item.x, y: row, w: seg.item.w, h: seg.item.h });
      row++;
    } else {
      const distinctYs = Array.from(new Set(seg.items.map(it => it.y))).sort((a, b) => a - b);
      const yLookup: Record<number, number> = {};
      distinctYs.forEach((y, idx) => { yLookup[y] = row + idx; });
      for (const it of seg.items) {
        updates.push({ i: it.i, x: it.x, y: yLookup[it.y], w: it.w, h: it.h });
      }
      row += distinctYs.length;
    }
  }
  return updates;
}

export interface CompactLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
  callsign?: string;
  socket: Socket | null;
  vfoSupported: boolean;

  // VFO
  isPhoneVFOCollapsed: boolean;
  setIsPhoneVFOCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
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
  bwDisabled: boolean;

  // Meters
  history: any[];
  activeMeter: "signal" | "swr" | "alc" | "vdd";
  isCompactSMeterCollapsed: boolean;
  setActiveMeter: React.Dispatch<
    React.SetStateAction<"signal" | "swr" | "alc" | "vdd">
  >;
  setIsCompactSMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // CW decoder
  cwDecodedText: string;
  cwStats: { pitch: number; speed: number };
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;
  setCwDecodedText: React.Dispatch<React.SetStateAction<string>>;
  ft8Decodes: Ft8Decode[];
  ft8Depth: Ft8Depth;
  setFt8Depth: (depth: Ft8Depth) => void;
  ft8ScrollContainerRef: React.RefObject<HTMLDivElement>;

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

  // Controls
  powerSupported: boolean;
  poweringOn: boolean;
  knownPoweredOff: boolean;
  handleSetPower: (state: boolean) => void;
  isCompactControlsCollapsed: boolean;
  isCompactRFPowerCollapsed: boolean;
  setIsCompactControlsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCompactRFPowerCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
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

  // POTA/SOTA spots
  potaPollRate: number;
  setPotaPollRate: (v: number) => void;
  potaMaxAge: number;
  setPotaMaxAge: (v: number) => void;
  potaModeFilter: string[];
  setPotaModeFilter: (v: string[]) => void;
  potaBandFilter: string[];
  setPotaBandFilter: (v: string[]) => void;
  sotaPollRate: number;
  setSotaPollRate: (v: number) => void;
  sotaMaxAge: number;
  setSotaMaxAge: (v: number) => void;
  sotaModeFilter: string[];
  setSotaModeFilter: (v: string[]) => void;
  sotaBandFilter: string[];
  setSotaBandFilter: (v: string[]) => void;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaSpotsTable: () => React.ReactElement;
  wwffPollRate: number;
  setWwffPollRate: (v: number) => void;
  wwffMaxAge: number;
  setWwffMaxAge: (v: number) => void;
  wwffModeFilter: string[];
  setWwffModeFilter: (v: string[]) => void;
  wwffBandFilter: string[];
  setWwffBandFilter: (v: string[]) => void;
  renderWwffSpotsTable: () => React.ReactElement;
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
  potaSpotsCollapsed: boolean;
  setPotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  sotaSpotsCollapsed: boolean;
  setSotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  wwffSpotsCollapsed: boolean;
  setWwffSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  dxSpotsCollapsed: boolean;
  setDxSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isComboSpotsCollapsed: boolean;
  setIsComboSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isCwDecodeCollapsed: boolean;
  setIsCwDecodeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isFt8DecodeCollapsed: boolean;
  setIsFt8DecodeCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

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
  isSolarCollapsed: boolean;
  setIsSolarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isMufMapCollapsed: boolean;
  setIsMufMapCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // Grid layout
  compactLayout: ViewLayout;
  setCompactLayout: (layout: ViewLayout) => void;
  isEditMode: boolean;
  gridCallbacks?: GridLayoutCallbacks;

  // Spectrum panels
  latestSpectrumRef: React.MutableRefObject<SpectrumData | null>;
  waterfallHistoryRef: React.MutableRefObject<number[][]>;
  spectrumSupported: boolean;
  spectrumEnabled: boolean;
  spectrumSettings: import("../types").SpectrumSettings;
  setSpectrumSettings: React.Dispatch<React.SetStateAction<import("../types").SpectrumSettings>>;
  analyserNodeRef: React.MutableRefObject<AnalyserNode | null>;
  isSpectrumHamlibCollapsed: boolean;
  setIsSpectrumHamlibCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isSpectrumAudioCollapsed: boolean;
  setIsSpectrumAudioCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

function CompactLayout({
  status,
  connected,
  availableModes,
  socket,
  vfoSupported,
  callsign = "",
  isPhoneVFOCollapsed,
  setIsPhoneVFOCollapsed,
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
  history,
  activeMeter,
  isCompactSMeterCollapsed,
  setActiveMeter,
  setIsCompactSMeterCollapsed,
  cwDecodedText,
  cwStats,
  cwScrollContainerRef,
  setCwDecodedText,
  ft8Decodes,
  ft8Depth,
  setFt8Depth,
  ft8ScrollContainerRef,
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
  isCompactControlsCollapsed,
  isCompactRFPowerCollapsed,
  setIsCompactControlsCollapsed,
  setIsCompactRFPowerCollapsed,
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
  potaPollRate,
  setPotaPollRate,
  potaMaxAge,
  setPotaMaxAge,
  potaModeFilter,
  setPotaModeFilter,
  potaBandFilter,
  setPotaBandFilter,
  sotaPollRate,
  setSotaPollRate,
  sotaMaxAge,
  setSotaMaxAge,
  sotaModeFilter,
  setSotaModeFilter,
  sotaBandFilter,
  setSotaBandFilter,
  renderSpotsTable,
  renderSotaSpotsTable,
  wwffPollRate,
  setWwffPollRate,
  wwffMaxAge,
  setWwffMaxAge,
  wwffModeFilter,
  setWwffModeFilter,
  wwffBandFilter,
  setWwffBandFilter,
  renderWwffSpotsTable,
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
  potaSpotsCollapsed,
  setPotaSpotsCollapsed,
  sotaSpotsCollapsed,
  setSotaSpotsCollapsed,
  wwffSpotsCollapsed,
  setWwffSpotsCollapsed,
  dxSpotsCollapsed,
  setDxSpotsCollapsed,
  isComboSpotsCollapsed,
  setIsComboSpotsCollapsed,
  isCwDecodeCollapsed,
  setIsCwDecodeCollapsed,
  isFt8DecodeCollapsed,
  setIsFt8DecodeCollapsed,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
  solarData,
  requestSolarData,
  isSolarCollapsed,
  setIsSolarCollapsed,
  isMufMapCollapsed,
  setIsMufMapCollapsed,
  compactLayout,
  setCompactLayout,
  isEditMode,
  gridCallbacks,
  latestSpectrumRef,
  waterfallHistoryRef,
  spectrumSupported,
  spectrumEnabled,
  spectrumSettings,
  setSpectrumSettings,
  analyserNodeRef,
  isSpectrumHamlibCollapsed,
  setIsSpectrumHamlibCollapsed,
  isSpectrumAudioCollapsed,
  setIsSpectrumAudioCollapsed,
  bwDisabled,
}: CompactLayoutProps) {

  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [showPotaSettings, setShowPotaSettings] = useState(false);
  const [showSotaSettings, setShowSotaSettings] = useState(false);
  const [showWwffSettings, setShowWwffSettings] = useState(false);
  const [showDxSettings, setShowDxSettings] = useState(false);
  const [showComboSettings, setShowComboSettings] = useState(false);

  const existingPanelTypes = useMemo(() => {
    const types = new Set<PanelType>();
    compactLayout.items.forEach(item => {
      if (item.panelType) types.add(item.panelType);
    });
    return types;
  }, [compactLayout.items]);

  // ── Panel content renderer ────────────────────────────────────────────────

  function renderPanelByType(type: GridItem['panelType'], _item: GridItem): React.ReactNode {
    switch (type) {
      case 'vfo': {
        const isColumnVfo = _item.w < compactLayout.cols;
        const vfoProps = {
          connected, status, vfoStep, setVfoStep,
          inputVfoA, setInputVfoA, inputVfoB, setInputVfoB,
          vfoSupported, adjustVfoFrequency, handleSetVFO, handleToggleSplit,
          handleSetFreq, localMode, availableModes, handleSetMode, handleSetBw,
          bandwidth: status?.bandwidth || "2400",
          bwDisabled,
        };
        if (isColumnVfo) {
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
              headerSize="sm"
            >
              <VfoPanel variant="phone" {...vfoProps} />
            </PanelChrome>
          );
        }
        return <VfoPanel variant="compact" {...vfoProps} />;
      }

      case 'smeter':
        return (
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
            <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
              <div className="flex gap-1">
                {(['signal', 'swr', 'alc', 'vdd'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setActiveMeter(m)}
                    data-testid={`meter-tab-${m}`}
                    className={cn(
                      "px-2 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                      activeMeter === m
                        ? (m === 'swr' && (status.swr ?? 1) > 3 ? "bg-red-500 text-white" : "bg-emerald-500 text-white")
                        : (m === 'swr' && (status.swr ?? 1) > 3 ? "text-red-500 bg-red-500/10" : "text-[#8e9299] hover:bg-white/5")
                    )}
                  >
                    {m === 'signal' ? 'SIG/PWR' : m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5" data-testid="meter-readout-summary">
                <span className={cn("text-[0.625rem] font-mono font-bold", status.ptt ? "text-red-500" : "text-emerald-500")}>
                  {status.ptt
                    ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                    : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`}
                </span>
                <span className="text-[#3a3b3e] text-[0.5rem]">·</span>
                <span className={cn("text-[0.625rem] font-mono font-bold", (status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500")}>
                  {(status.swr ?? 1).toFixed(2)}
                </span>
                <span className="text-[#3a3b3e] text-[0.5rem]">·</span>
                <span className="text-[0.625rem] font-mono font-bold text-blue-400">
                  {(status.alc ?? 0).toFixed(2)}
                </span>
                <span className="text-[#3a3b3e] text-[0.5rem]">·</span>
                <span className="text-[0.625rem] font-mono font-bold text-emerald-400">
                  {(status.vdd ?? 0).toFixed(1)}V
                </span>
                <button
                  onClick={() => setIsCompactSMeterCollapsed(!isCompactSMeterCollapsed)}
                  data-testid="meter-collapse-toggle"
                  className="p-0.5 hover:bg-white/5 rounded text-[#8e9299] ml-0.5"
                >
                  {isCompactSMeterCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </div>
            </div>
            {!isCompactSMeterCollapsed && (
              <div className="p-2 h-[120px]" data-testid="meter-chart">
                <MeterHistoryChart status={status} history={history} meterTab={activeMeter} dense />
              </div>
            )}
          </div>
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
                variant="compact"
                socket={socket}
                videoStatus={videoStatus}
                setIsVideoSettingsOpen={setIsVideoSettingsOpen}
                enumerateVideoDevices={enumerateVideoDevices}
                isElectronSource={isElectronSource}
              />
            }
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
          >
            <VideoFeedPanel
              variant="compact"
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
                variant="compact"
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
            headerSize="sm"
            hideCollapse
          >
            {null}
          </PanelChrome>
        );

      case 'controls':
        return (
          <PanelChrome
            title="Controls"
            isCollapsed={isCompactControlsCollapsed}
            setIsCollapsed={setIsCompactControlsCollapsed}
            className="shadow-lg"
            bodyClassName="p-2"
            headerSize="sm"
          >
            <ControlsPanel
              variant="compact"
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
          </PanelChrome>
        );

      case 'rflevels':
        return (
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
            <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
              <span className="text-[0.5625rem] uppercase tracking-widest font-bold text-[#8e9299]">RF Levels</span>
              <button
                onClick={() => setIsCompactRFPowerCollapsed(!isCompactRFPowerCollapsed)}
                className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
              >
                {isCompactRFPowerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
            {!isCompactRFPowerCollapsed && (
              <div className="p-2 flex flex-col justify-center gap-1">
                <RfLevelsPanel
                  variant="compact"
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
            )}
          </div>
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
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
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
            className="shadow-lg"
            bodyClassName="p-3"
            headerSize="sm"
          >
            <CommandConsolePanel
              variant="compact"
              connected={connected}
              consoleLogs={consoleLogs}
              rawCommand={rawCommand}
              setRawCommand={setRawCommand}
              handleSendRaw={handleSendRaw}
            />
          </PanelChrome>
        );

      case 'spots_pota':
        return (
          <PanelChrome
            title="POTA Spots"
            icon={<MapPin size={12} />}
            isCollapsed={potaSpotsCollapsed}
            setIsCollapsed={setPotaSpotsCollapsed}
            headerActions={<SpotSettingsGear accent="emerald" onClick={() => setShowPotaSettings(true)} />}
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
          >
            <div className="max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
              {renderSpotsTable(false)}
            </div>
          </PanelChrome>
        );

      case 'spots_sota':
        return (
          <PanelChrome
            title="SOTA Spots"
            icon={<MapPin size={12} />}
            isCollapsed={sotaSpotsCollapsed}
            setIsCollapsed={setSotaSpotsCollapsed}
            headerActions={<SpotSettingsGear accent="amber" onClick={() => setShowSotaSettings(true)} />}
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
          >
            <div className="max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
              {renderSotaSpotsTable()}
            </div>
          </PanelChrome>
        );

      case 'spots_wwff':
        return (
          <PanelChrome
            title="WWFF Spots"
            icon={<MapPin size={12} />}
            isCollapsed={wwffSpotsCollapsed}
            setIsCollapsed={setWwffSpotsCollapsed}
            headerActions={<SpotSettingsGear accent="sky" onClick={() => setShowWwffSettings(true)} />}
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
          >
            <div className="max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
              {renderWwffSpotsTable()}
            </div>
          </PanelChrome>
        );

      case 'spots_dx':
        return (
          <PanelChrome
            title="DX Cluster"
            icon={<MapPin size={12} />}
            isCollapsed={dxSpotsCollapsed}
            setIsCollapsed={setDxSpotsCollapsed}
            headerActions={<SpotSettingsGear accent="rose" onClick={() => setShowDxSettings(true)} />}
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
          >
            <div className="max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
              {renderDxSpotsTable()}
            </div>
          </PanelChrome>
        );

      case 'spots_combo':
        return (
          <PanelChrome
            title="All Spots"
            icon={<MapPin size={12} />}
            isCollapsed={isComboSpotsCollapsed}
            setIsCollapsed={setIsComboSpotsCollapsed}
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
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

      case 'solar':
        return (
          <PanelChrome
            title="Solar Conditions"
            icon={<Sun size={12} />}
            isCollapsed={isSolarCollapsed}
            setIsCollapsed={setIsSolarCollapsed}
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
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
            className="shadow-lg"
            bodyClassName="p-0"
            headerSize="sm"
          >
            <MufMapPanel heightPx={_item.heightPx} callsign={callsign} />
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
            heightPx={_item.heightPx}
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
            heightPx={_item.heightPx}
            bandwidth={parseInt(status?.bandwidth ?? "0", 10) || 0}
            mode={status?.mode ?? ""}
            callsign={callsign}
          />
        );

      default:
        return null;
    }
  }

  // ── Edit mode movement ────────────────────────────────────────────────────

  function moveCompactPanel(item: GridItem, direction: 'up' | 'down') {
    const cols = compactLayout.cols;
    const isFullWidth = item.w >= cols;

    if (isFullWidth) {
      // Swap this full-width panel's segment with the adjacent segment
      // (another full-width panel, or the whole cols block) so full-width
      // panels can stack together at the top or bottom.
      const segments = columnLayout.segments;
      const segIdx = segments.findIndex(s => s.type === 'full' && s.item.i === item.i);
      const targetIdx = direction === 'up' ? segIdx - 1 : segIdx + 1;
      if (segIdx < 0 || targetIdx < 0 || targetIdx >= segments.length) return;
      const reordered = [...segments];
      [reordered[segIdx], reordered[targetIdx]] = [reordered[targetIdx], reordered[segIdx]];
      gridCallbacks?.updateItemPositions(renumberSegments(reordered));
      return;
    }

    const colItems = compactLayout.items
      .filter(i => i.x === item.x && i.w < cols)
      .sort((a, b) => a.y - b.y);
    const idx = colItems.findIndex(i => i.i === item.i);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= colItems.length) return;
    const a = item;
    const b = colItems[targetIdx];
    gridCallbacks?.updateItemPositions([
      { i: a.i, x: a.x, y: b.y, w: a.w, h: a.h },
      { i: b.i, x: b.x, y: a.y, w: b.w, h: b.h },
    ]);
  }

  function moveCompactPanelColumn(item: GridItem, direction: 'left' | 'right') {
    const newX = item.x + (direction === 'left' ? -1 : 1);
    if (newX < 0 || newX >= compactLayout.cols) return;
    const maxY = compactLayout.items
      .filter(i => i.x === newX && i.w < compactLayout.cols)
      .reduce((m, i) => Math.max(m, i.y + 1), 0);
    gridCallbacks?.updateItemPositions([
      { i: item.i, x: newX, y: maxY, w: item.w, h: item.h },
    ]);
  }

  // Picks the column with the least real rendered height (not an estimate),
  // so a newly-added panel lands somewhere likely to be on-screen. Measures
  // each column's *children* (the individual panels) rather than the column
  // wrapper div itself — the wrapper is a CSS grid item and gets stretched
  // by the grid's default align-items:stretch to match the tallest column,
  // so every wrapper reports the same height regardless of real content.
  // Ties go to the leftmost column since indexOf(Math.min(...)) resolves to
  // the first match.
  function findShortestColumn(): number {
    const container = gridContainerRef.current;
    if (!container) return 0;
    const heights = Array.from({ length: compactLayout.cols }, (_, c) => {
      const els = container.querySelectorAll<HTMLElement>(`[data-column-idx="${c}"]`);
      return Array.from(els).reduce((sum, el) => {
        const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
        const children = Array.from(el.children) as HTMLElement[];
        const contentHeight = children.reduce((s, child) => s + child.getBoundingClientRect().height, 0);
        return sum + contentHeight + Math.max(0, children.length - 1) * gap;
      }, 0);
    });
    return heights.indexOf(Math.min(...heights));
  }

  // ── Column layout renderer ────────────────────────────────────────────────

  const renderPanel = useCallback((item: GridItem): React.ReactNode => {
    return renderPanelByType(item.panelType, item);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status, connected, availableModes, socket, vfoSupported,
    isPhoneVFOCollapsed,
    vfoStep, inputVfoA, inputVfoB, localMode,
    history, activeMeter, isCompactSMeterCollapsed,
    cwDecodedText, cwStats, cwScrollContainerRef,
    ft8Decodes, ft8Depth, ft8ScrollContainerRef, isFt8DecodeCollapsed,
    videoStatus, isVideoCollapsed, isElectronSource, videoError,
    audioStatus, localAudioReady, inboundMuted, outboundMuted, audioSettings, audioWasRestarted,
    isCompactControlsCollapsed, isCompactRFPowerCollapsed,
    isTuning, tuneJustFinished, attenuatorLevels, preampLevels, agcLevels,
    nbCapabilities, nrCapabilities, anfCapabilities,
    localRFPower, rfPowerCapabilities, rfLevelCapabilities, localRFLevel, localNRLevel, localNBLevel,
    potaPollRate, potaMaxAge, potaModeFilter, potaBandFilter,
    sotaPollRate, sotaMaxAge, sotaModeFilter, sotaBandFilter,
    wwffPollRate, wwffMaxAge, wwffModeFilter, wwffBandFilter,
    potaSpotsCollapsed, sotaSpotsCollapsed, wwffSpotsCollapsed, isComboSpotsCollapsed, isCwDecodeCollapsed,
    isConsoleCollapsed, consoleLogs, rawCommand,
    solarData, requestSolarData, isSolarCollapsed, isMufMapCollapsed,
    compactLayout, isEditMode, gridCallbacks,
    spectrumSettings, spectrumEnabled, spectrumSupported,
    isSpectrumHamlibCollapsed, isSpectrumAudioCollapsed,
  ]);

  const columnLayout = useMemo(() => {
    const cols = compactLayout.cols;
    const sorted = [...compactLayout.items].sort((a, b) => a.y - b.y || a.x - b.x);

    const segments: CompactSegment[] = [];
    let i = 0;
    while (i < sorted.length) {
      if (sorted[i].w >= cols) {
        segments.push({ type: 'full', item: sorted[i] });
        i++;
      } else {
        const colItems: GridItem[] = [];
        while (i < sorted.length && sorted[i].w < cols) {
          colItems.push(sorted[i]);
          i++;
        }
        segments.push({ type: 'cols', items: colItems });
      }
    }
    return { cols, segments };
  }, [compactLayout.items, compactLayout.cols]);

  function wrapWithEditOverlay(item: GridItem, content: React.ReactNode, idx: number, siblingsCount: number, isFullWidth: boolean): React.ReactNode {
    if (!isEditMode) return content;
    return (
      <div className="relative">
        {content}
        <div className="absolute top-1.5 right-1.5 z-30 flex items-center gap-0.5">
          <button
            disabled={idx === 0}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); moveCompactPanel(item, 'up'); }}
            className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
            title="Move up"
          >▲</button>
          <button
            disabled={idx === siblingsCount - 1}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); moveCompactPanel(item, 'down'); }}
            className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
            title="Move down"
          >▼</button>
          {!isFullWidth && (
            <>
              <button
                disabled={item.x === 0}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); moveCompactPanelColumn(item, 'left'); }}
                className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
                title="Move to left column"
              >◄</button>
              <button
                disabled={item.x >= compactLayout.cols - 1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); moveCompactPanelColumn(item, 'right'); }}
                className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
                title="Move to right column"
              >►</button>
            </>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); gridCallbacks?.removePanel(item.i); }}
            className="w-6 h-6 flex items-center justify-center rounded bg-red-500/80 hover:bg-red-500 text-white text-[10px] ml-0.5 transition-all"
            title={`Remove ${PANEL_LABELS[item.panelType!] ?? item.panelType}`}
          >×</button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("animate-in fade-in duration-300", isEditMode && "pb-16")}>
      <div ref={gridContainerRef} className="flex flex-col gap-2">
        {columnLayout.segments.map((seg, si) => {
          if (seg.type === 'full') {
            return (
              <div key={seg.item.i}>
                {wrapWithEditOverlay(seg.item, renderPanel(seg.item), si, columnLayout.segments.length, true)}
              </div>
            );
          }

          // cols segment: build per-column stacks
          const { cols } = columnLayout;
          const columns = Array.from({ length: cols }, (_, c) =>
            seg.items.filter(item => item.x === c).sort((a, b) => a.y - b.y)
          );

          return (
            <div
              key={si}
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {columns.map((colItems, c) => (
                <div key={c} data-column-idx={c} className="flex flex-col gap-2">
                  {colItems.map((item, idx) =>
                    wrapWithEditOverlay(item, renderPanel(item), idx, colItems.length, false)
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {isEditMode && gridCallbacks && (
        <>
          <EditToolbar
            cols={compactLayout.cols}
            rows={compactLayout.rows}
            showRowsControl={false}
            onColsChange={(c) => gridCallbacks.setGridSize(c, compactLayout.rows)}
            onRowsChange={() => {}}
            onAddPanel={() => setShowPanelPicker(true)}
            onReset={() => gridCallbacks.resetToDefault()}
            onDone={() => gridCallbacks.onExitEditMode()}
          />
          {showPanelPicker && (
            <PanelPicker
              availableTypes={COMPACT_PANEL_TYPES}
              existingTypes={existingPanelTypes}
              onSelect={(type, config) => {
                const targetX = config?.fullWidth ? undefined : findShortestColumn();
                gridCallbacks.addPanel(type, { ...config, targetX });
                setShowPanelPicker(false);
              }}
              onClose={() => setShowPanelPicker(false)}
            />
          )}
        </>
      )}

      <SpotSettingsModal
        isOpen={showPotaSettings}
        onClose={() => setShowPotaSettings(false)}
        type="pota"
        pollRate={potaPollRate} setPollRate={setPotaPollRate}
        maxAge={potaMaxAge} setMaxAge={setPotaMaxAge}
        modeFilter={potaModeFilter} setModeFilter={setPotaModeFilter}
        bandFilter={potaBandFilter} setBandFilter={setPotaBandFilter}
      />
      <SpotSettingsModal
        isOpen={showSotaSettings}
        onClose={() => setShowSotaSettings(false)}
        type="sota"
        pollRate={sotaPollRate} setPollRate={setSotaPollRate}
        maxAge={sotaMaxAge} setMaxAge={setSotaMaxAge}
        modeFilter={sotaModeFilter} setModeFilter={setSotaModeFilter}
        bandFilter={sotaBandFilter} setBandFilter={setSotaBandFilter}
      />
      <SpotSettingsModal
        isOpen={showWwffSettings}
        onClose={() => setShowWwffSettings(false)}
        type="wwff"
        pollRate={wwffPollRate} setPollRate={setWwffPollRate}
        maxAge={wwffMaxAge} setMaxAge={setWwffMaxAge}
        modeFilter={wwffModeFilter} setModeFilter={setWwffModeFilter}
        bandFilter={wwffBandFilter} setBandFilter={setWwffBandFilter}
      />
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
    </div>
  );
}

export default React.memo(CompactLayout);
