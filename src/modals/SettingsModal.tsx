import React from "react";
import type { Socket } from "socket.io-client";
import {
  AlertCircle,
  Radio,
  Server,
  Settings,
  X,
} from "lucide-react";
import { cn } from "../utils";
import { POTA_BANDS } from "../constants";
import type { CwSettings, RigctldSettings } from "../types";

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  socket: Socket | null;

  // Tab state
  activeSettingsTab: "rigctld" | "spots" | "cw";
  setActiveSettingsTab: React.Dispatch<
    React.SetStateAction<"rigctld" | "spots" | "cw">
  >;

  // Rigctld tab
  rigctldSettings: RigctldSettings;
  setRigctldSettings: React.Dispatch<React.SetStateAction<RigctldSettings>>;
  rigctldProcessStatus: "running" | "stopped" | "error" | "already_running";
  rigctldLogs: string[];
  setRigctldLogs: React.Dispatch<React.SetStateAction<string[]>>;
  testResult: { success: boolean; message: string } | null;
  radios: { id: string; mfg: string; model: string }[];
  host: string;
  setHost: React.Dispatch<React.SetStateAction<string>>;
  port: number;
  setPort: React.Dispatch<React.SetStateAction<number>>;
  pollRate: number;
  handlePollRateChange: (rate: number) => void;
  rigctldVersionInfo: { version: string | null; isSupported: boolean };
  logEndRef: React.RefObject<HTMLDivElement>;

  // Spots tab
  potaEnabled: boolean;
  setPotaEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  potaBandFilter: string[];
  setPotaBandFilter: React.Dispatch<React.SetStateAction<string[]>>;
  potaModeFilter: string;
  setPotaModeFilter: React.Dispatch<React.SetStateAction<string>>;
  potaPollRate: number;
  setPotaPollRate: React.Dispatch<React.SetStateAction<number>>;
  potaMaxAge: number;
  setPotaMaxAge: React.Dispatch<React.SetStateAction<number>>;
  sotaEnabled: boolean;
  setSotaEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  sotaBandFilter: string[];
  setSotaBandFilter: React.Dispatch<React.SetStateAction<string[]>>;
  sotaModeFilter: string;
  setSotaModeFilter: React.Dispatch<React.SetStateAction<string>>;
  sotaPollRate: number;
  setSotaPollRate: React.Dispatch<React.SetStateAction<number>>;
  sotaMaxAge: number;
  setSotaMaxAge: React.Dispatch<React.SetStateAction<number>>;

  // CW tab
  cwSettings: CwSettings;
  setCwSettings: React.Dispatch<React.SetStateAction<CwSettings>>;
  cwDecodeEnabled: boolean;
  setCwDecodeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  cwWasmReady: boolean;
  cwSettingsRef: React.MutableRefObject<CwSettings>;
  cwPortStatus: { open: boolean; port: string; error?: string };
  sidetoneOscRef: React.MutableRefObject<OscillatorNode | null>;
  rebindTarget: "ditKey" | "dahKey" | "straightKey" | null;
  setRebindTarget: React.Dispatch<
    React.SetStateAction<"ditKey" | "dahKey" | "straightKey" | null>
  >;

}

function SettingsModal({
  isOpen,
  onClose,
  socket,
  activeSettingsTab,
  setActiveSettingsTab,
  rigctldSettings,
  setRigctldSettings,
  rigctldProcessStatus,
  rigctldLogs,
  setRigctldLogs,
  testResult,
  radios,
  host,
  setHost,
  port,
  setPort,
  pollRate,
  handlePollRateChange,
  rigctldVersionInfo,
  logEndRef,
  potaEnabled,
  setPotaEnabled,
  potaBandFilter,
  setPotaBandFilter,
  potaModeFilter,
  setPotaModeFilter,
  potaPollRate,
  setPotaPollRate,
  potaMaxAge,
  setPotaMaxAge,
  sotaEnabled,
  setSotaEnabled,
  sotaBandFilter,
  setSotaBandFilter,
  sotaModeFilter,
  setSotaModeFilter,
  sotaPollRate,
  setSotaPollRate,
  sotaMaxAge,
  setSotaMaxAge,
  cwSettings,
  setCwSettings,
  cwDecodeEnabled,
  setCwDecodeEnabled,
  cwWasmReady,
  cwSettingsRef,
  cwPortStatus,
  sidetoneOscRef,
  rebindTarget,
  setRebindTarget,
}: SettingsModalProps) {
  if (!isOpen) return null;
  return (
<div className="fixed inset-0 z-[60] flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
  <div className="bg-[#151619] border border-[#2a2b2e] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
    <div className="p-4 border-b border-[#2a2b2e] flex justify-between items-center bg-[#1a1b1e]">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-emerald-500/10 text-emerald-500 rounded-lg">
          <Settings size={16} />
        </div>
        <h2 className="text-sm font-bold uppercase tracking-tight">General Settings</h2>
      </div>
      <button
        onClick={() => onClose()}
        className="p-1.5 hover:bg-white/5 rounded-full transition-colors text-[#8e9299] hover:text-white"
      >
        <X size={18} />
      </button>
    </div>

    {/* Tab Bar */}
    <div className="flex border-b border-[#2a2b2e] bg-[#1a1b1e]">
      {(['rigctld', 'spots', 'cw'] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveSettingsTab(tab)}
          className={cn(
            "px-5 py-2.5 text-[0.625rem] font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px",
            activeSettingsTab === tab
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-[#8e9299] hover:text-white"
          )}
        >
          {tab}
        </button>
      ))}
    </div>

    {activeSettingsTab === 'rigctld' && (
    <div className="p-6 space-y-6">
      {/* Client Side Settings */}
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Client Side Settings (Connection to Rigctld)</h3>
        <div className="space-y-1">
          <label className="text-[0.625rem] uppercase text-[#8e9299]">Host Address</label>
          <input 
            type="text" 
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
            placeholder="127.0.0.1"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Port</label>
            <input 
              type="number" 
              value={(port === null || isNaN(port)) ? "" : port}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setPort(isNaN(val) ? NaN : val);
              }}
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Rate</label>
            <select 
              value={pollRate}
              onChange={(e) => handlePollRateChange(parseInt(e.target.value))}
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
            >
              <option value={250}>250 ms</option>
              <option value={500}>500 ms</option>
              <option value={1000}>1000 ms</option>
              <option value={1500}>1500 ms</option>
              <option value={2000}>2000 ms</option>
              <option value={5000}>5000 ms</option>
            </select>
          </div>
        </div>
      </div>

      {/* Server Side Settings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-blue-500/20 pb-1">
          <h3 className="text-[0.625rem] uppercase text-blue-500 font-bold">Server Side / Backend Settings</h3>
          <span className="text-[0.5rem] text-[#8e9299] font-medium italic">Hamlib 4.7.0+ Recommended</span>
        </div>
        {!rigctldVersionInfo.isSupported && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/50 rounded-xl text-amber-500 text-[0.6875rem] animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle size={14} />
              <p className="font-bold uppercase">Unsupported Hamlib Version</p>
            </div>
            <p className="opacity-80">
              Detected rigctld version {rigctldVersionInfo.version}. Hamlib versions less than 4.7.0 are unsupported and may cause issues. Please upgrade to Hamlib 4.7.0 or newer.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-[0.625rem] uppercase text-[#8e9299]">Rig Model (Hamlib Rig #)</label>
          <select 
            value={rigctldSettings.rigNumber}
            onChange={(e) => setRigctldSettings(prev => ({ ...prev, rigNumber: e.target.value }))}
            className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
          >
            <option value="">Select a Radio...</option>
            {radios.map(r => (
              <option key={`${r.id}-${r.mfg}-${r.model}`} value={r.id}>
                {r.id}: {r.mfg} {r.model}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[0.625rem] uppercase text-[#8e9299]">Serial Port (e.g. /dev/ttyUSB0 or COM3)</label>
          <input 
            type="text"
            value={rigctldSettings.serialPort}
            onChange={(e) => setRigctldSettings(prev => ({ ...prev, serialPort: e.target.value }))}
            placeholder="/dev/ttyUSB0"
            className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Server Port</label>
            <input 
              type="text"
              value={rigctldSettings.portNumber}
              onChange={(e) => setRigctldSettings(prev => ({ ...prev, portNumber: e.target.value }))}
              placeholder="4532"
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Serial Speed</label>
            <input 
              type="text"
              value={rigctldSettings.serialPortSpeed}
              onChange={(e) => setRigctldSettings(prev => ({ ...prev, serialPortSpeed: e.target.value }))}
              placeholder="38400"
              className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[0.625rem] uppercase text-[#8e9299]">Listen Address</label>
          <input 
            type="text"
            value={rigctldSettings.ipAddress}
            onChange={(e) => setRigctldSettings(prev => ({ ...prev, ipAddress: e.target.value }))}
            placeholder="127.0.0.1"
            className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white"
          />
        </div>
      </div>

      <div className="pt-4 space-y-3">
        <div className="flex items-center justify-between text-[0.5rem] text-[#8e9299] opacity-50 uppercase font-bold tracking-widest border-t border-[#2a2b2e] pt-4">
          <span>App Version</span>
          <span>v05.01.2026-Beta8</span>
        </div>

        {rigctldProcessStatus === "already_running" && (
          <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-[0.6875rem] animate-in slide-in-from-top-2">
            <p className="font-bold uppercase mb-1">Process Conflict</p>
            <p className="opacity-80">rigctld is already running on the system. You must stop it or kill it to start a new instance from this app.</p>
            <button 
              onClick={() => socket?.emit("kill-existing-rigctld")}
              className="mt-2 w-full py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold uppercase text-[0.625rem] transition-all"
            >
              Kill and Restart
            </button>
          </div>
        )}

        {testResult && (
          <div className={cn(
            "p-3 rounded-lg border text-[0.6875rem] animate-in slide-in-from-top-2",
            testResult.success ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400" : "bg-red-500/10 border-red-500/50 text-red-400"
          )}>
            <p className="font-bold uppercase mb-1">{testResult.success ? "Test Passed" : "Test Failed"}</p>
            <p className="opacity-80">{testResult.message}</p>
          </div>
        )}

        <div className="flex items-center justify-between p-3 bg-[#0a0a0a] border border-[#2a2b2e] rounded-xl">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              rigctldProcessStatus === "running" ? "bg-emerald-500 animate-pulse" : 
              rigctldProcessStatus === "error" || rigctldProcessStatus === "already_running" ? "bg-red-500" : "bg-[#2a2b2e]"
            )} />
            <span className="text-[0.625rem] uppercase font-bold text-[#8e9299]">
              Status: {rigctldProcessStatus.toUpperCase()}
            </span>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => socket?.emit("test-rigctld", rigctldSettings)}
              disabled={rigctldProcessStatus === "running"}
              className={cn(
                "px-3 py-1 rounded text-[0.625rem] font-bold uppercase transition-all",
                rigctldProcessStatus === "running" 
                  ? "bg-gray-500/10 text-gray-500 border border-gray-500/20 cursor-not-allowed" 
                  : "bg-blue-500/10 text-blue-500 border border-blue-500/50 hover:bg-blue-500 hover:text-white"
              )}
            >
              Test
            </button>
            {rigctldProcessStatus === "running" ? (
              <button 
                onClick={() => {
                  socket?.emit("set-autoconnect-eligible", false);
                  socket?.emit("stop-rigctld");
                }}
                className="px-3 py-1 bg-red-500/10 text-red-500 border border-red-500/50 rounded text-[0.625rem] font-bold uppercase hover:bg-red-500 hover:text-white transition-all"
              >
                Stop
              </button>
            ) : (
              <button 
                onClick={() => socket?.emit("start-rigctld")}
                className="px-3 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/50 rounded text-[0.625rem] font-bold uppercase hover:bg-emerald-500 hover:text-white transition-all"
              >
                Start
              </button>
            )}
          </div>
        </div>


      </div>

      {/* Log View */}
      <div className="space-y-2 pt-4 border-t border-[#2a2b2e]">
        <div className="flex items-center justify-between">
          <label className="text-[0.625rem] uppercase text-[#8e9299]">Process Logs</label>
          <button 
            onClick={() => setRigctldLogs([])}
            className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg p-3 h-32 overflow-y-auto custom-scrollbar font-mono text-[0.625rem] space-y-1">
          {rigctldLogs.length === 0 ? (
            <p className="text-[#4a4b4e] italic">No logs available...</p>
          ) : (
            rigctldLogs.map((log, i) => (
              <div key={i} className="text-[#8e9299] break-all">
                <span className="text-emerald-500/50 mr-2">[{i+1}]</span>
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
    )}

    {activeSettingsTab === 'spots' && (
    <div className="p-6 space-y-6">
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Spot Sources</h3>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="pota-enabled"
            checked={potaEnabled}
            onChange={(e) => setPotaEnabled(e.target.checked)}
            className="w-4 h-4 accent-emerald-500 cursor-pointer"
          />
          <label htmlFor="pota-enabled" className="text-sm font-bold cursor-pointer select-none">POTA</label>
          <span className="text-[0.5625rem] text-[#8e9299]">Parks on the Air</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="sota-enabled"
            checked={sotaEnabled}
            onChange={(e) => setSotaEnabled(e.target.checked)}
            className="w-4 h-4 accent-amber-500 cursor-pointer"
          />
          <label htmlFor="sota-enabled" className="text-sm font-bold cursor-pointer select-none">SOTA</label>
          <span className="text-[0.5625rem] text-[#8e9299]">Summits on the Air</span>
        </div>
      </div>

      {potaEnabled && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <h3 className="text-[0.625rem] uppercase text-blue-500 font-bold border-b border-blue-500/20 pb-1">POTA Options</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Frequency</label>
              <select
                value={potaPollRate}
                onChange={(e) => setPotaPollRate(Number(e.target.value))}
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
              >
                {[1, 2, 3, 4, 5].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
              <select
                value={potaMaxAge}
                onChange={(e) => setPotaMaxAge(Number(e.target.value))}
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-white appearance-none cursor-pointer"
              >
                {[1, 3, 5, 10, 15].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
              {potaBandFilter.length > 0 && (
                <button
                  onClick={() => setPotaBandFilter([])}
                  className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
                >
                  Clear (ALL)
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {POTA_BANDS.map(({ label }) => {
                const active = potaBandFilter.includes(label);
                return (
                  <label
                    key={label}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
                      active
                        ? "bg-emerald-500/10 border-emerald-500/60 text-emerald-400"
                        : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/40 hover:text-white"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() =>
                        setPotaBandFilter(prev =>
                          active ? prev.filter(b => b !== label) : [...prev, label]
                        )
                      }
                      className="w-3 h-3 accent-emerald-500 cursor-pointer flex-shrink-0"
                    />
                    <span className="text-[0.5625rem] font-bold uppercase">{label}</span>
                  </label>
                );
              })}
            </div>
            {potaBandFilter.length === 0 && (
              <p className="text-[0.5rem] text-[#4a4b4e] italic">No bands selected — showing all bands</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Mode Filter</label>
            <div className="flex gap-2 flex-wrap">
              {(['ALL', 'SSB', 'CW', 'FT8', 'FT4'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setPotaModeFilter(m)}
                  className={cn(
                    "px-3 py-1 rounded text-[0.625rem] font-bold uppercase transition-all border",
                    potaModeFilter === m
                      ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                      : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-emerald-500/50 hover:text-white"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sotaEnabled && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <h3 className="text-[0.625rem] uppercase text-amber-500 font-bold border-b border-amber-500/20 pb-1">SOTA Options</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Poll Frequency</label>
              <select
                value={sotaPollRate}
                onChange={(e) => setSotaPollRate(Number(e.target.value))}
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 text-white appearance-none cursor-pointer"
              >
                {[1, 2, 3, 4, 5].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Max Spot Age</label>
              <select
                value={sotaMaxAge}
                onChange={(e) => setSotaMaxAge(Number(e.target.value))}
                className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 text-white appearance-none cursor-pointer"
              >
                {[1, 3, 5, 10, 15].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[0.625rem] uppercase text-[#8e9299]">Band Filter</label>
              {sotaBandFilter.length > 0 && (
                <button
                  onClick={() => setSotaBandFilter([])}
                  className="text-[0.5rem] uppercase font-bold text-[#8e9299] hover:text-white transition-colors"
                >
                  Clear (ALL)
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {POTA_BANDS.map(({ label }) => {
                const active = sotaBandFilter.includes(label);
                return (
                  <label
                    key={label}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-all select-none",
                      active
                        ? "bg-amber-500/10 border-amber-500/60 text-amber-400"
                        : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-amber-500/40 hover:text-white"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() =>
                        setSotaBandFilter(prev =>
                          active ? prev.filter(b => b !== label) : [...prev, label]
                        )
                      }
                      className="w-3 h-3 accent-amber-500 cursor-pointer flex-shrink-0"
                    />
                    <span className="text-[0.5625rem] font-bold uppercase">{label}</span>
                  </label>
                );
              })}
            </div>
            {sotaBandFilter.length === 0 && (
              <p className="text-[0.5rem] text-[#4a4b4e] italic">No bands selected — showing all bands</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[0.625rem] uppercase text-[#8e9299]">Mode Filter</label>
            <div className="flex gap-2 flex-wrap">
              {(['ALL', 'SSB', 'CW', 'FT8', 'FT4'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setSotaModeFilter(m)}
                  className={cn(
                    "px-3 py-1 rounded text-[0.625rem] font-bold uppercase transition-all border",
                    sotaModeFilter === m
                      ? "bg-amber-500/20 border-amber-500 text-amber-400"
                      : "bg-[#0a0a0a] border-[#2a2b2e] text-[#8e9299] hover:border-amber-500/50 hover:text-white"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
    )}

    {activeSettingsTab === 'cw' && (
    <div className="p-6 space-y-6">

      {/* CW Decoder */}
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">CW Decoder</h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[#e0e0e0] font-bold">Enable CW Decoder</div>
            <div className="text-[0.625rem] text-[#8e9299] mt-0.5">Decode incoming audio to text in real time</div>
          </div>
          <button
            onClick={() => {
              const next = !cwDecodeEnabled;
              setCwDecodeEnabled(next);
              localStorage.setItem('cw-decode-enabled', String(next));
            }}
            disabled={cwDecodeEnabled && !cwWasmReady}
            title={cwDecodeEnabled && !cwWasmReady ? 'Loading decoder…' : undefined}
            className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0", cwDecodeEnabled ? "bg-emerald-500" : "bg-[#2a2b2e]", cwDecodeEnabled && !cwWasmReady && "opacity-50 cursor-wait")}
          >
            <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", cwDecodeEnabled ? "translate-x-6" : "translate-x-1")} />
          </button>
        </div>
      </div>

      {/* Enable & Keying Method */}
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">CW Keyer</h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[#e0e0e0] font-bold">Enable CW Keyer</div>
            <div className="text-[0.625rem] text-[#8e9299] mt-0.5">Activates keyboard CW keying and sidetone</div>
          </div>
          <button
            onClick={() => {
              const next = { ...cwSettings, enabled: !cwSettings.enabled };
              setCwSettings(next);
              cwSettingsRef.current = next;
              socket?.emit("update-cw-settings", { enabled: !cwSettings.enabled });
            }}
            className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0", cwSettings.enabled ? "bg-emerald-500" : "bg-[#2a2b2e]")}
          >
            <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", cwSettings.enabled ? "translate-x-6" : "translate-x-1")} />
          </button>
        </div>

        {/* Keying Method */}
        <div className="space-y-1">
          <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Keying Method</label>
          <div className="flex gap-2 flex-wrap">
            {([
              { id: 'dtr', label: 'DTR' },
              { id: 'rts', label: 'RTS' },
              { id: 'rigctld-ptt', label: 'CAT PTT' }
            ] as const).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => {
                  const next = { ...cwSettings, keyingMethod: id };
                  setCwSettings(next);
                  cwSettingsRef.current = next;
                  socket?.emit("update-cw-settings", { keyingMethod: id });
                }}
                className={cn("px-3 py-1 rounded text-xs font-bold border transition-colors", cwSettings.keyingMethod === id ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" : "border-[#2a2b2e] text-[#8e9299] bg-[#1a1b1e]")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* CAT PTT note */}
        {cwSettings.keyingMethod === 'rigctld-ptt' && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[0.625rem] text-amber-300 space-y-1">
            <div className="font-bold uppercase">CAT PTT Mode</div>
            <div>Radio must be in CW mode with full or semi break-in (QSK) enabled. T-R switching is handled by the radio's internal QSK/break-in timing. No serial port required.</div>
          </div>
        )}

        {/* Serial port + polarity (hidden for CAT PTT) */}
        {cwSettings.keyingMethod !== 'rigctld-ptt' && (
          <>
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Keyer Serial Port</label>
              <div className="text-[0.625rem] text-[#8e9299]">
                {cwSettings.keyingMethod === 'dtr'
                  ? 'DTR line on this port keys the radio (e.g. /dev/ttyUSB1, COM4)'
                  : 'RTS line on this port keys the radio (e.g. /dev/ttyUSB1, COM4)'}
              </div>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={cwSettings.keyerPort}
                  onChange={(e) => setCwSettings(prev => ({ ...prev, keyerPort: e.target.value }))}
                  onBlur={(e) => {
                    const next = { ...cwSettings, keyerPort: e.target.value };
                    cwSettingsRef.current = next;
                    socket?.emit("update-cw-settings", { keyerPort: e.target.value });
                  }}
                  placeholder="/dev/ttyUSB1"
                  className="flex-1 bg-[#1a1b1e] border border-[#2a2b2e] rounded px-2 py-1 text-sm text-[#e0e0e0] font-mono"
                />
                <div className={cn("text-[0.625rem] font-bold px-2 py-0.5 rounded", cwPortStatus.open ? "text-emerald-400 bg-emerald-400/10" : "text-[#8e9299] bg-[#2a2b2e]")}>
                  {cwPortStatus.open ? "OPEN" : cwPortStatus.error ? "ERROR" : "CLOSED"}
                </div>
              </div>
              {cwPortStatus.error && <div className="text-[0.625rem] text-red-400">{cwPortStatus.error}</div>}
            </div>
            <div className="space-y-1">
              <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Key Polarity</label>
              <div className="text-[0.625rem] text-[#8e9299]">Whether line high or line low activates the key. Most interfaces use Active High.</div>
              <div className="flex gap-2">
                {(['high', 'low'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => {
                      const next = { ...cwSettings, serialKeyPolarity: p };
                      setCwSettings(next);
                      cwSettingsRef.current = next;
                      socket?.emit("update-cw-settings", { serialKeyPolarity: p });
                    }}
                    className={cn("px-3 py-1 rounded text-xs font-bold border transition-colors", cwSettings.serialKeyPolarity === p ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" : "border-[#2a2b2e] text-[#8e9299] bg-[#1a1b1e]")}
                  >
                    Active {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Mode & Speed */}
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Mode & Speed</h3>
        <div className="space-y-1">
          <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Keyer Mode</label>
          <div className="flex gap-2">
            {(['iambic-a', 'iambic-b', 'straight'] as const).map(m => (
              <button
                key={m}
                onClick={() => {
                  const next = { ...cwSettings, mode: m };
                  setCwSettings(next);
                  cwSettingsRef.current = next;
                  socket?.emit("update-cw-settings", { mode: m });
                }}
                className={cn("px-3 py-1 rounded text-xs font-bold border transition-colors capitalize", cwSettings.mode === m ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" : "border-[#2a2b2e] text-[#8e9299] bg-[#1a1b1e]")}
              >
                {m === 'iambic-a' ? 'Iambic A' : m === 'iambic-b' ? 'Iambic B' : 'Straight'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Speed</label>
            <span className="text-sm text-emerald-400 font-bold">{cwSettings.wpm} WPM</span>
          </div>
          <input
            type="range" min={5} max={30} step={1}
            value={cwSettings.wpm}
            onChange={(e) => {
              const wpm = Number(e.target.value);
              const next = { ...cwSettings, wpm };
              setCwSettings(next);
              cwSettingsRef.current = next;
            }}
            onMouseUp={(e) => socket?.emit("update-cw-settings", { wpm: Number((e.target as HTMLInputElement).value) })}
            onTouchEnd={(e) => socket?.emit("update-cw-settings", { wpm: Number((e.target as HTMLInputElement).value) })}
            className="w-full accent-emerald-500"
          />
          <div className="flex justify-between text-[0.5rem] text-[#8e9299]"><span>5</span><span>30</span></div>
        </div>
      </div>

      {/* Sidetone */}
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Sidetone</h3>
        <div className="flex items-center justify-between">
          <div className="text-sm text-[#e0e0e0] font-bold">Enable Sidetone</div>
          <button
            onClick={() => {
              const next = { ...cwSettings, sidetoneEnabled: !cwSettings.sidetoneEnabled };
              setCwSettings(next);
              cwSettingsRef.current = next;
              socket?.emit("update-cw-settings", { sidetoneEnabled: !cwSettings.sidetoneEnabled });
            }}
            className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0", cwSettings.sidetoneEnabled ? "bg-emerald-500" : "bg-[#2a2b2e]")}
          >
            <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", cwSettings.sidetoneEnabled ? "translate-x-6" : "translate-x-1")} />
          </button>
        </div>
        {cwSettings.sidetoneEnabled && (<>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Frequency</label>
              <span className="text-sm text-emerald-400 font-bold">{cwSettings.sidetoneHz} Hz</span>
            </div>
            <input type="range" min={400} max={1200} step={10}
              value={cwSettings.sidetoneHz}
              onChange={(e) => {
                const hz = Number(e.target.value);
                const next = { ...cwSettings, sidetoneHz: hz };
                setCwSettings(next);
                cwSettingsRef.current = next;
                if (sidetoneOscRef.current) sidetoneOscRef.current.frequency.value = hz;
              }}
              onMouseUp={(e) => socket?.emit("update-cw-settings", { sidetoneHz: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => socket?.emit("update-cw-settings", { sidetoneHz: Number((e.target as HTMLInputElement).value) })}
              className="w-full accent-emerald-500"
            />
            <div className="flex justify-between text-[0.5rem] text-[#8e9299]"><span>400 Hz</span><span>1200 Hz</span></div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Volume</label>
              <span className="text-sm text-emerald-400 font-bold">{Math.round(cwSettings.sidetoneVolume * 100)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.01}
              value={cwSettings.sidetoneVolume}
              onChange={(e) => {
                const vol = Number(e.target.value);
                const next = { ...cwSettings, sidetoneVolume: vol };
                setCwSettings(next);
                cwSettingsRef.current = next;
              }}
              onMouseUp={(e) => socket?.emit("update-cw-settings", { sidetoneVolume: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => socket?.emit("update-cw-settings", { sidetoneVolume: Number((e.target as HTMLInputElement).value) })}
              className="w-full accent-emerald-500"
            />
            <div className="flex justify-between text-[0.5rem] text-[#8e9299]"><span>0%</span><span>100%</span></div>
          </div>
        </>)}
      </div>

      {/* Key Bindings */}
      <div className="space-y-4">
        <h3 className="text-[0.625rem] uppercase text-emerald-500 font-bold border-b border-emerald-500/20 pb-1">Key Bindings</h3>
        <div className="text-[0.625rem] text-[#8e9299]">Default L-CTRL / R-CTRL matches vband USB paddle interface. Click a binding to rebind.</div>
        {([
          { key: 'ditKey', label: cwSettings.mode === 'straight' ? 'N/A' : 'Dit (left paddle)' },
          { key: 'dahKey', label: cwSettings.mode === 'straight' ? 'N/A' : 'Dah (right paddle)' },
          { key: 'straightKey', label: 'Straight Key' }
        ] as const).filter(b => cwSettings.mode === 'straight' ? b.key === 'straightKey' : b.key !== 'straightKey').map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-xs text-[#e0e0e0]">{label}</span>
            <button
              onClick={() => setRebindTarget(rebindTarget === key ? null : key)}
              className={cn("px-3 py-1 rounded text-xs font-mono border transition-colors", rebindTarget === key ? "bg-amber-500/20 border-amber-400 text-amber-300 animate-pulse" : "bg-[#1a1b1e] border-[#2a2b2e] text-[#e0e0e0]")}
            >
              {rebindTarget === key ? 'Press a key…' : cwSettings[key]}
            </button>
          </div>
        ))}
      </div>

    </div>
    )}

  </div>
</div>
  );
}

export default React.memo(SettingsModal);
