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
import PanelChrome from "../components/PanelChrome";
import EditToolbar from "../components/EditToolbar";
import PanelPicker from "../components/PanelPicker";
import CommandConsolePanel from "../panels/CommandConsolePanel";
import RfLevelsPanel from "../panels/RfLevelsPanel";
import VfoPanel, { VfoCollapsedHeader } from "../panels/VfoPanel";
import VideoAudioPanel, {
  VideoAudioHeaderActions,
} from "../panels/VideoAudioPanel";
import SpotsPanel from "../panels/SpotsPanel";
import ControlsPanel from "../panels/ControlsPanel";
import TabbedMeterPanel, {
  TabbedMeterHeaderContent,
} from "../panels/TabbedMeterPanel";

const PHONE_PANEL_TYPES: PanelType[] = [
  'vfo', 'videoaudio', 'smeter', 'controls',
  'spots_pota', 'spots_sota', 'commandconsole',
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
  potaEnabled: boolean;
  potaSpotsCollapsed: boolean;
  filteredSpots: any[];
  potaSpotsBoxRef: React.RefObject<HTMLDivElement>;
  setPotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;

  // SOTA spots
  sotaEnabled: boolean;
  sotaSpotsCollapsed: boolean;
  filteredSotaSpots: any[];
  sotaSpotsBoxRef: React.RefObject<HTMLDivElement>;
  setSotaSpotsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  renderSotaSpotsTable: () => React.ReactElement;

  // CW
  cwSettings: CwSettings;
  cwKeyActive: boolean;
  cwStuckAlert: boolean;

  // Command console
  isConsoleCollapsed: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setIsConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;

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
  potaEnabled,
  potaSpotsCollapsed,
  filteredSpots,
  potaSpotsBoxRef,
  setPotaSpotsCollapsed,
  renderSpotsTable,
  sotaEnabled,
  sotaSpotsCollapsed,
  filteredSotaSpots,
  sotaSpotsBoxRef,
  setSotaSpotsCollapsed,
  renderSotaSpotsTable,
  cwSettings,
  cwKeyActive,
  cwStuckAlert,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
  phoneLayout,
  isEditMode,
  gridCallbacks,
}: PhoneLayoutProps) {

  const [showPanelPicker, setShowPanelPicker] = useState(false);

  const existingPhonePanelTypes = useMemo(() => {
    const types = new Set<PanelType>();
    phoneLayout.items.forEach(item => {
      if (item.panelType) types.add(item.panelType);
    });
    return types;
  }, [phoneLayout.items]);

  const visibleItems = useMemo(() => {
    return [...phoneLayout.items]
      .filter(item => {
        if (item.panelType === 'spots_pota' && !potaEnabled) return false;
        if (item.panelType === 'spots_sota' && !sotaEnabled) return false;
        return true;
      })
      .sort((a, b) => a.y - b.y);
  }, [phoneLayout.items, potaEnabled, sotaEnabled]);

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

  function renderPhonePanel(panelType: PanelType | undefined): React.ReactNode {
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
              <span className="text-[0.5rem] text-[#8e9299]">
                {filteredSpots.length} spot{filteredSpots.length !== 1 ? "s" : ""}
              </span>
            }
            outerRef={potaSpotsBoxRef}
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
              <span className="text-[0.5rem] text-[#8e9299]">
                {filteredSotaSpots.length} spot
                {filteredSotaSpots.length !== 1 ? "s" : ""}
              </span>
            }
            outerRef={sotaSpotsBoxRef}
            bodyClassName="p-0"
            headerSize="md"
          >
            <SpotsPanel
              type="sota"
              renderTable={() => renderSotaSpotsTable()}
            />
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
          {renderPhonePanel(item.panelType)}
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
              onSelect={(type) => { gridCallbacks.addPanel(type); setShowPanelPicker(false); }}
              onClose={() => setShowPanelPicker(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(PhoneLayout);
