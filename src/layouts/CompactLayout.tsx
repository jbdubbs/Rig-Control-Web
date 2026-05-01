import React, { useCallback, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";
import { Monitor, Radio, Settings, ChevronDown, ChevronUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
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
import ControlsPanel from "../panels/ControlsPanel";
import CwDecodePanel from "../panels/CwDecodePanel";

export type { GridLayoutCallbacks };

const COMPACT_PANEL_TYPES: PanelType[] = [
  'vfo', 'smeter', 'videoaudio', 'controls', 'rflevels',
  'cwdecode', 'commandconsole', 'spots_pota', 'spots_sota',
];

export interface CompactLayoutProps {
  // Core rig state
  status: RigStatus;
  connected: boolean;
  availableModes: string[];
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

  // Meters
  history: any[];
  activeMeter: "signal" | "swr" | "alc" | "vdd";
  isCompactSMeterCollapsed: boolean;
  setActiveMeter: React.Dispatch<
    React.SetStateAction<"signal" | "swr" | "alc" | "vdd">
  >;
  setIsCompactSMeterCollapsed: React.Dispatch<React.SetStateAction<boolean>>;

  // CW decoder
  cwDecodeEnabled: boolean;
  cwDecodedText: string;
  cwStats: { pitch: number; speed: number };
  cwScrollContainerRef: React.RefObject<HTMLDivElement>;
  setCwDecodedText: React.Dispatch<React.SetStateAction<string>>;

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

  // Controls
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

  // POTA/SOTA spots
  potaEnabled: boolean;
  sotaEnabled: boolean;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaSpotsTable: () => React.ReactElement;

  // Command console
  isConsoleCollapsed: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setIsConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;

  // Grid layout
  compactLayout: ViewLayout;
  setCompactLayout: (layout: ViewLayout) => void;
  isEditMode: boolean;
  gridCallbacks?: GridLayoutCallbacks;
}

function CompactLayout({
  status,
  connected,
  availableModes,
  socket,
  vfoSupported,
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
  cwDecodeEnabled,
  cwDecodedText,
  cwStats,
  cwScrollContainerRef,
  setCwDecodedText,
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
  potaEnabled,
  sotaEnabled,
  renderSpotsTable,
  renderSotaSpotsTable,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
  compactLayout,
  setCompactLayout,
  isEditMode,
  gridCallbacks,
}: CompactLayoutProps) {

  const [showPanelPicker, setShowPanelPicker] = useState(false);

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
                  : "border-blue-500/30"
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
                    className={cn(
                      "px-2 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                      activeMeter === m
                        ? (m === 'swr' && (status.swr ?? 1) > 3 ? "bg-red-500 text-white" : "bg-emerald-500 text-white")
                        : (m === 'swr' && (status.swr ?? 1) > 3 ? "text-red-500 bg-red-500/10" : "text-[#8e9299] hover:bg-white/5")
                    )}
                  >
                    {m === 'signal' ? (status.ptt ? 'power' : 'signal') : m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
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
                  className="p-0.5 hover:bg-white/5 rounded text-[#8e9299] ml-0.5"
                >
                  {isCompactSMeterCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </div>
            </div>
            {!isCompactSMeterCollapsed && (
              <div className="p-2 h-[120px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2b2e" vertical={false} opacity={0.3} />
                    <XAxis dataKey="time" hide />
                    <YAxis
                      domain={
                        activeMeter === 'signal' ? (status.ptt ? [0, 1] : [-54, 0]) :
                        activeMeter === 'swr' ? [1, 4] :
                        activeMeter === 'vdd' ? [11, 16] : [0, 1]
                      }
                      hide={activeMeter !== 'swr' && activeMeter !== 'vdd'}
                      ticks={activeMeter === 'swr' ? [1, 2, 3, 4] : activeMeter === 'vdd' ? [11, 12, 13, 14, 15, 16] : undefined}
                      width={15}
                      style={{ fontSize: '6px', fill: '#4a4b4e' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#151619', border: '1px solid #2a2b2e', fontSize: '8px' }}
                      itemStyle={{
                        color: activeMeter === 'signal' ? (status.ptt ? '#ef4444' : '#10b981') :
                               activeMeter === 'swr' ? ((status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b') :
                               activeMeter === 'alc' ? '#3b82f6' : '#10b981'
                      }}
                      formatter={(val: number, _name: string, props: any) => {
                        if (activeMeter === 'signal') {
                          const rawVal = props.payload?.smeter ?? val;
                          return [status.ptt ? `${Math.round((val ?? 0) * 100)}W` : (rawVal > 0 ? `S9+${rawVal}dB` : `S${Math.round((rawVal + 54) / 6)}`), status.ptt ? "POWER" : "SIGNAL"];
                        }
                        if (activeMeter === 'swr') return [(props.payload?.swr ?? 1).toFixed(2), 'SWR'];
                        if (activeMeter === 'vdd') return [`${(val ?? 0).toFixed(1)}V`, 'VDD'];
                        return [(val ?? 0).toFixed(activeMeter === 'alc' ? 5 : 2), activeMeter.toUpperCase()];
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={
                        activeMeter === 'signal' ? (status.ptt ? "powerMeter" : "smeterGraph") :
                        activeMeter === 'swr' ? 'swrGraph' : activeMeter
                      }
                      stroke={
                        activeMeter === 'signal' ? (status.ptt ? "#ef4444" : "#10b981") :
                        activeMeter === 'swr' ? ((status.swr ?? 1) > 3 ? '#ef4444' : '#f59e0b') :
                        activeMeter === 'alc' ? '#3b82f6' : '#10b981'
                      }
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
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
                variant="compact"
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
            headerSize="sm"
          >
            <VideoAudioPanel
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
          />
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
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-lg">
            <div className="p-2 border-b border-[#2a2b2e] bg-[#1a1b1e]">
              <span className="text-[0.5625rem] uppercase tracking-widest font-bold text-[#8e9299]">POTA Spots</span>
            </div>
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {renderSpotsTable(false)}
            </div>
          </div>
        );

      case 'spots_sota':
        return (
          <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] overflow-hidden shadow-lg">
            <div className="p-2 border-b border-[#2a2b2e] bg-[#1a1b1e]">
              <span className="text-[0.5625rem] uppercase tracking-widest font-bold text-[#8e9299]">SOTA Spots</span>
            </div>
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {renderSotaSpotsTable()}
            </div>
          </div>
        );

      default:
        return null;
    }
  }

  // ── Edit mode movement ────────────────────────────────────────────────────

  function moveCompactPanel(item: GridItem, direction: 'up' | 'down') {
    const cols = compactLayout.cols;
    const isFullWidth = item.w >= cols;
    const colItems = compactLayout.items
      .filter(i => isFullWidth ? i.w >= cols : (i.x === item.x && i.w < cols))
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

  // ── Column layout renderer ────────────────────────────────────────────────

  const renderPanel = useCallback((item: GridItem): React.ReactNode => {
    return renderPanelByType(item.panelType, item);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status, connected, availableModes, socket, vfoSupported,
    isPhoneVFOCollapsed,
    vfoStep, inputVfoA, inputVfoB, localMode,
    history, activeMeter, isCompactSMeterCollapsed, cwDecodeEnabled,
    cwDecodedText, cwStats, cwScrollContainerRef,
    videoStatus, isVideoCollapsed, isElectronSource, videoError,
    audioStatus, localAudioReady, inboundMuted, outboundMuted, audioSettings, audioWasRestarted,
    isCompactControlsCollapsed, isCompactRFPowerCollapsed,
    isTuning, tuneJustFinished, attenuatorLevels, preampLevels, agcLevels,
    nbCapabilities, nrCapabilities, anfCapabilities,
    localRFPower, rfPowerCapabilities, localRFLevel, localNRLevel, localNBLevel,
    cwSettings, cwKeyActive, cwStuckAlert,
    potaEnabled, sotaEnabled,
    isConsoleCollapsed, consoleLogs, rawCommand,
    compactLayout, isEditMode, gridCallbacks,
  ]);

  const columnLayout = useMemo(() => {
    const cols = compactLayout.cols;
    const sorted = [...compactLayout.items].sort((a, b) => a.y - b.y || a.x - b.x);

    type Segment =
      | { type: 'full'; item: GridItem }
      | { type: 'cols'; items: GridItem[] };

    const segments: Segment[] = [];
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

  function wrapWithEditOverlay(item: GridItem, content: React.ReactNode, idx: number, siblings: GridItem[], isFullWidth: boolean): React.ReactNode {
    if (!isEditMode) return content;
    return (
      <div className="relative">
        {content}
        <div className="absolute top-1.5 right-1.5 z-30 flex items-center gap-0.5">
          <span className="text-[0.5rem] uppercase tracking-widest font-bold text-[#5a5b5e] mr-1 select-none">
            {PANEL_LABELS[item.panelType!] ?? item.panelType}
          </span>
          <button
            disabled={idx === 0}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); moveCompactPanel(item, 'up'); }}
            className="w-6 h-6 flex items-center justify-center rounded bg-[#0a0a0a]/90 border border-[#3a3b3e] text-[#aaaaaa] hover:text-white disabled:opacity-20 disabled:cursor-not-allowed text-[10px] transition-all"
            title="Move up"
          >▲</button>
          <button
            disabled={idx === siblings.length - 1}
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
      <div className="flex flex-col gap-2">
        {columnLayout.segments.map((seg, si) => {
          if (seg.type === 'full') {
            const fullWidthPeers = columnLayout.segments
              .filter((s): s is { type: 'full'; item: GridItem } => s.type === 'full')
              .map(s => s.item);
            const peerIdx = fullWidthPeers.findIndex(i => i.i === seg.item.i);
            return (
              <div key={seg.item.i}>
                {wrapWithEditOverlay(seg.item, renderPanel(seg.item), peerIdx, fullWidthPeers, true)}
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
                <div key={c} className="flex flex-col gap-2">
                  {colItems.map((item, idx) =>
                    wrapWithEditOverlay(item, renderPanel(item), idx, colItems, false)
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
              onSelect={(type) => { gridCallbacks.addPanel(type); setShowPanelPicker(false); }}
              onClose={() => setShowPanelPicker(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(CompactLayout);
