import React, { useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { Radio, Monitor, Zap, MapPin, Settings } from "lucide-react";
import { cn } from "../utils";
import type {
  RigStatus,
  CwSettings,
  AudioSettings,
  NbCapabilities,
  NrCapabilities,
  AnfCapabilities,
  RfPowerCapabilities,
  ConsoleLog,
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
import RfLevelsPanel from "../panels/RfLevelsPanel";
import VfoPanel, { VfoCollapsedHeader } from "../panels/VfoPanel";
import VideoAudioPanel, {
  VideoAudioHeaderActions,
} from "../panels/VideoAudioPanel";
import SpotsPanel, { SpotSettingsGear } from "../panels/SpotsPanel";
import SpotComboPanel from "../panels/SpotComboPanel";
import SpotSettingsModal from "../modals/SpotSettingsModal";
import ComboSpotSettingsModal from "../modals/ComboSpotSettingsModal";
import ControlsPanel from "../panels/ControlsPanel";
import TabbedMeterPanel, {
  TabbedMeterHeaderContent,
} from "../panels/TabbedMeterPanel";

const PHONE_PANEL_TYPES: PanelType[] = [
  'vfo', 'videoaudio', 'smeter', 'controls',
  'spots_pota', 'spots_sota', 'spots_wwff', 'spots_combo', 'cwdecode', 'commandconsole', 'solar', 'mufmap',
];

export interface PhoneLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
  socket: Socket | null;

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

  // CW
  cwSettings: CwSettings;
  cwKeyActive: boolean;
  cwStuckAlert: boolean;
  cwDecodedText: string;
  setCwDecodedText: React.Dispatch<React.SetStateAction<string>>;
  cwStats: { pitch: number; speed: number };
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;

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

  // Grid layout
  phoneLayout: ViewLayout;
  isEditMode: boolean;
  gridCallbacks?: GridLayoutCallbacks;
}

function PhoneLayout({
  status,
  connected,
  availableModes,
  socket,
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
  cwSettings,
  cwKeyActive,
  cwStuckAlert,
  cwDecodedText,
  setCwDecodedText,
  cwStats,
  cwScrollContainerRef,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
  solarData,
  requestSolarData,
  phoneLayout,
  isEditMode,
  gridCallbacks,
}: PhoneLayoutProps) {

  const [showPanelPicker, setShowPanelPicker] = useState(false);
  const [showPotaSettings, setShowPotaSettings] = useState(false);
  const [showSotaSettings, setShowSotaSettings] = useState(false);
  const [showWwffSettings, setShowWwffSettings] = useState(false);
  const [showComboSettings, setShowComboSettings] = useState(false);
  const [spotsComboCollapsed, setSpotsComboCollapsed] = useState(false);
  const [isSolarCollapsed, setIsSolarCollapsed] = useState(false);

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
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= visibleItems.length) return;
    const a = item;
    const b = visibleItems[targetIdx];
    gridCallbacks?.updateItemPositions([
      { i: a.i, x: a.x, y: b.y, w: a.w, h: a.h },
      { i: b.i, x: b.x, y: a.y, w: b.w, h: b.h },
    ]);
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
                : "border-blue-500/30"
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
            />
          </PanelChrome>
        );

      case 'videoaudio':
        return (
          <PanelChrome
            title="Video & Audio"
            icon={<Monitor size={12} />}
            isCollapsed={isVideoCollapsed}
            setIsCollapsed={setIsVideoCollapsed}
            headerActions={
              <VideoAudioHeaderActions
                variant="phone"
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
            headerSize="md"
          >
            <VideoAudioPanel
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

      case 'spots_combo':
        return (
          <PanelChrome
            title="All Spots"
            icon={<MapPin size={12} />}
            isCollapsed={spotsComboCollapsed}
            setIsCollapsed={setSpotsComboCollapsed}
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotComboPanel
              renderPotaTable={renderSpotsTable}
              renderSotaTable={renderSotaSpotsTable}
              renderWwffTable={renderWwffSpotsTable}
              onOpenSettings={() => setShowComboSettings(true)}
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
          />
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
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-lg flex flex-col">
            <div className="p-2 border-b border-[#2a2b2e] bg-[#1a1b1e]">
              <span className="text-[0.5625rem] uppercase tracking-widest font-bold text-[#8e9299]">MUF Map</span>
            </div>
            <MufMapPanel heightPx={item.heightPx} />
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <div className={cn("space-y-2 animate-in fade-in duration-300", isEditMode && "pb-16")}>
      {/* CW mode warning — always at top, not part of the configurable panel order */}
      {cwSettings.enabled &&
        connected &&
        !["CW", "CWR", "CW-R"].includes(status?.mode || "") && (
          <div className="bg-amber-900/40 border border-amber-500/60 text-amber-300 text-xs font-bold px-3 py-2 rounded-xl text-center">
            Radio not in CW mode — Switch mode to key
          </div>
        )}

      {visibleItems.map((item, idx) => (
        <div key={item.i} className="relative">
          {renderPhonePanel(item)}
          {isEditMode && (
            <div className="absolute top-1.5 right-1.5 z-30 flex items-center gap-0.5">
              <span className="text-[0.5rem] uppercase tracking-widest font-bold text-[#5a5b5e] mr-1 select-none">
                {PANEL_LABELS[item.panelType!] ?? item.panelType}
              </span>
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
      />
    </div>
  );
}

export default React.memo(PhoneLayout);
