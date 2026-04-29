import React from "react";
import type { Socket } from "socket.io-client";
import { Monitor, Settings, ChevronDown, ChevronUp } from "lucide-react";
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
import PanelChrome from "../components/PanelChrome";
import CommandConsolePanel from "../panels/CommandConsolePanel";
import RfLevelsPanel from "../panels/RfLevelsPanel";
import VfoPanel from "../panels/VfoPanel";
import VideoAudioPanel, {
  VideoAudioHeaderActions,
} from "../panels/VideoAudioPanel";
import ControlsPanel from "../panels/ControlsPanel";
import CwDecodePanel from "../panels/CwDecodePanel";

export interface CompactLayoutProps {
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
  activeCompactPowerTab: "levels" | "pota" | "sota";
  setActiveCompactPowerTab: React.Dispatch<
    React.SetStateAction<"levels" | "pota" | "sota">
  >;
  renderSpotsTable: (showFullLocation: boolean) => React.ReactElement;
  renderSotaSpotsTable: () => React.ReactElement;

  // Command console
  showCommandConsole: boolean;
  isConsoleCollapsed: boolean;
  consoleLogs: ConsoleLog[];
  rawCommand: string;
  setIsConsoleCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setRawCommand: React.Dispatch<React.SetStateAction<string>>;
  handleSendRaw: (e: React.FormEvent) => void;
}

function CompactLayout({
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
  activeCompactPowerTab,
  setActiveCompactPowerTab,
  renderSpotsTable,
  renderSotaSpotsTable,
  showCommandConsole,
  isConsoleCollapsed,
  consoleLogs,
  rawCommand,
  setIsConsoleCollapsed,
  setRawCommand,
  handleSendRaw,
}: CompactLayoutProps) {
  return (
    <div className="space-y-2 animate-in fade-in duration-300">
      {/* Unified VFO & Mode/BW Box */}
      <VfoPanel
        variant="compact"
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
        localMode={localMode}
        availableModes={availableModes}
        handleSetMode={handleSetMode}
        handleSetBw={handleSetBw}
        bandwidth={status?.bandwidth || "2400"}
      />

      <div className="grid grid-cols-2 gap-2">
        {/* Combined Meter Box */}
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
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-xs font-mono font-bold",
                activeMeter === 'signal' ? (status.ptt ? "text-red-500" : "text-emerald-500") :
                activeMeter === 'swr' ? ((status.swr ?? 1) > 3 ? "text-red-500" : "text-amber-500") :
                activeMeter === 'alc' ? "text-blue-500" : "text-emerald-500"
              )}>
                {activeMeter === 'signal' ? (
                  status.ptt
                    ? `${Math.round((status.powerMeter ?? 0) * 100)}W`
                    : (status.smeter ?? -54) > 0 ? `S9+${status.smeter}dB` : `S${Math.round(((status.smeter ?? -54) + 54) / 6)}`
                ) : activeMeter === 'swr' ? (
                  (status.swr ?? 1).toFixed(2)
                ) : activeMeter === 'alc' ? (
                  (status.alc ?? 0).toFixed(5)
                ) : (
                  `${(status.vdd ?? 0).toFixed(1)}V`
                )}
              </span>
              <button
                onClick={() => setIsCompactSMeterCollapsed(!isCompactSMeterCollapsed)}
                className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
              >
                {isCompactSMeterCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            </div>
          </div>
          {!isCompactSMeterCollapsed && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className={cn("p-2 flex-1", cwDecodeEnabled ? "min-h-[60px]" : "min-h-[80px]")}>
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
                      formatter={(val: number, name: string, props: any) => {
                        if (activeMeter === 'signal') {
                          const rawVal = props.payload?.smeter ?? val;
                          return [status.ptt ? `${Math.round((val ?? 0) * 100)}W` : (rawVal > 0 ? `S9+${rawVal}dB` : `S${Math.round((rawVal + 54) / 6)}`), status.ptt ? "POWER" : "SIGNAL"];
                        }
                        if (activeMeter === 'swr') {
                          return [(props.payload?.swr ?? 1).toFixed(2), 'SWR'];
                        }
                        if (activeMeter === 'vdd') {
                          return [`${(val ?? 0).toFixed(1)}V`, 'VDD'];
                        }
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
              {cwDecodeEnabled && (
                <CwDecodePanel
                  variant="compact-embedded"
                  cwDecodedText={cwDecodedText}
                  setCwDecodedText={setCwDecodedText}
                  cwStats={cwStats}
                  cwScrollContainerRef={cwScrollContainerRef}
                />
              )}
            </div>
          )}
        </div>

        {/* Video Feed Section */}
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
          className="flex flex-col shadow-lg"
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
      </div>

      {/* Compact Controls & RF Power */}
      <div className="grid grid-cols-2 gap-2">
        <PanelChrome
          title="Controls"
          isCollapsed={isCompactControlsCollapsed}
          setIsCollapsed={setIsCompactControlsCollapsed}
          className="flex flex-col shadow-lg"
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

        <div className="bg-[#151619] rounded-xl border border-[#2a2b2e] flex flex-col shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
            <div className="flex items-center gap-1">
              {(['levels', ...(potaEnabled ? ['pota'] : []), ...(sotaEnabled ? ['sota'] : [])] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveCompactPowerTab(tab)}
                  className={cn(
                    "px-2 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                    activeCompactPowerTab === tab
                      ? "bg-emerald-500 text-white"
                      : "text-[#8e9299] hover:bg-white/5"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              onClick={() => setIsCompactRFPowerCollapsed(!isCompactRFPowerCollapsed)}
              className="p-0.5 hover:bg-white/5 rounded text-[#8e9299]"
            >
              {isCompactRFPowerCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          </div>
          {!isCompactRFPowerCollapsed && (
            <div className="relative overflow-hidden">
              {/* LEVELS — always rendered to establish the box height; invisible when POTA or SOTA tab is active */}
              <div className={cn(
                "p-2 flex flex-col justify-center gap-1",
                (activeCompactPowerTab === 'pota' || activeCompactPowerTab === 'sota') && "invisible"
              )}>
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
              {/* POTA — absolutely positioned so it never influences the box height */}
              {potaEnabled && activeCompactPowerTab === 'pota' && (
                <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
                  {renderSpotsTable(false)}
                </div>
              )}
              {/* SOTA — absolutely positioned so it never influences the box height */}
              {sotaEnabled && activeCompactPowerTab === 'sota' && (
                <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
                  {renderSotaSpotsTable()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCommandConsole && (
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
      )}
    </div>
  );
}

export default React.memo(CompactLayout);
