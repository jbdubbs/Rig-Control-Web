import React from "react";
import type { Socket } from "socket.io-client";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Headphones,
  Link,
  Link2Off,
  Loader2,
  Lock,
  Power,
  Radio,
  X,
} from "lucide-react";
import { cn, splitLocalAudioDevices } from "../utils";

export interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  socket: Socket | null;

  audioStatus: "playing" | "stopped" | "cooldown";
  audioSettings: {
    inputDevice: string;
    outputDevice: string;
    inboundEnabled: boolean;
    outboundEnabled: boolean;
    backendLockedToAdmin: boolean;
  };
  setAudioSettings: React.Dispatch<
    React.SetStateAction<{
      inputDevice: string;
      outputDevice: string;
      inboundEnabled: boolean;
      outboundEnabled: boolean;
      backendLockedToAdmin: boolean;
    }>
  >;
  audioSettingsDenied?: { action: string; reason: string } | null;
  role?: "admin" | "regular";
  localAudioDevices: { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] };
  setLocalAudioDevices: React.Dispatch<
    React.SetStateAction<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>
  >;
  localAudioSettings: { inputDevice: string; outputDevice: string; wsjtxOutputDevice: string; enhancementsEnabled: boolean };
  setLocalAudioSettings: React.Dispatch<
    React.SetStateAction<{ inputDevice: string; outputDevice: string; wsjtxOutputDevice: string; enhancementsEnabled: boolean }>
  >;
  inboundVolume: number;
  setInboundVolume: React.Dispatch<React.SetStateAction<number>>;
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  sidetoneCtxRef: React.MutableRefObject<AudioContext | null>;
  inboundGainRef: React.MutableRefObject<GainNode | null>;
  audioEngineState: { isReady: boolean; error: string | null };
  isBackendEngineCollapsed: boolean;
  onToggleBackendEngineCollapsed: () => void;
  handleStartAudio: () => void;
  startMicCapture: () => void;
  stopMicCapture: () => void;
  activeMicClientId: string | null;
  clientId: string;
  inboundMuted: boolean;
  outboundMuted: boolean;
  localAudioReady: boolean;
  audioDevices: {
    inputs: { name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[];
    outputs: { name: string; altName: string; hostAPIName: string; defaultSampleRate: number }[];
  };
  updateWsjtxOutput: (deviceId: string) => Promise<void>;
  wsjtxBridgeEnabled: boolean;
  setWsjtxBridgeEnabled: (enabled: boolean) => void;
  wsjtxBridgeConnected: boolean;
  wsjtxWsPort: number;
  setWsjtxWsPort: (port: number) => void;
  wsjtxAutoSetupWarning: string | null;
  wsjtxAutoSetupActive: boolean;
}

function AudioSettingsModal({
  isOpen,
  onClose,
  socket,
  audioStatus,
  audioSettings,
  setAudioSettings,
  audioSettingsDenied,
  role = "regular",
  localAudioDevices,
  setLocalAudioDevices,
  localAudioSettings,
  setLocalAudioSettings,
  inboundVolume,
  setInboundVolume,
  audioContextRef,
  sidetoneCtxRef,
  inboundGainRef,
  audioEngineState,
  isBackendEngineCollapsed,
  onToggleBackendEngineCollapsed,
  handleStartAudio,
  startMicCapture,
  stopMicCapture,
  activeMicClientId,
  clientId,
  inboundMuted,
  outboundMuted,
  localAudioReady,
  audioDevices,
  updateWsjtxOutput,
  wsjtxBridgeEnabled,
  setWsjtxBridgeEnabled,
  wsjtxBridgeConnected,
  wsjtxWsPort,
  setWsjtxWsPort,
  wsjtxAutoSetupWarning,
  wsjtxAutoSetupActive,
}: AudioSettingsModalProps) {
  if (!isOpen) return null;
  const backendLocked = audioSettings.backendLockedToAdmin && role !== "admin";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-[#151619] w-full max-w-md rounded-2xl border border-[#2a2b2e] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-[#2a2b2e] flex items-center justify-between bg-[#1a1b1e]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
              <Headphones size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight uppercase italic">Audio Settings</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#2a2b2e] rounded-xl text-[#8e9299] transition-all"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="space-y-4">
            <div className="space-y-4">
              <h4 className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Local Client Audio (Your System)</h4>

              {activeMicClientId && clientId !== activeMicClientId && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-3">
                  <AlertTriangle className="text-amber-500 shrink-0" size={16} />
                  <p className="text-[0.625rem] text-amber-500/80 font-medium leading-tight">
                    Microphone is active in another session. Unmute your mic button to take over.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">Local Input (Microphone)</label>
                  {localAudioDevices.inputs.length > 0 && !localAudioDevices.inputs[0].label && (
                    <button
                      onClick={async () => {
                        try {
                          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                          stream.getTracks().forEach(t => t.stop());
                          const devices = await navigator.mediaDevices.enumerateDevices();
                          setLocalAudioDevices(splitLocalAudioDevices(devices));
                        } catch (err) {
                          console.error("Failed to get mic permission:", err);
                        }
                      }}
                      className="text-[0.5rem] uppercase font-bold text-blue-500 hover:text-blue-400 transition-colors"
                    >
                      Request Permission
                    </button>
                  )}
                </div>
                <select
                  value={localAudioSettings.inputDevice}
                  onFocus={() => navigator.mediaDevices.enumerateDevices().then(devices => {
                    setLocalAudioDevices(splitLocalAudioDevices(devices));
                  }).catch(console.error)}
                  onChange={(e) => {
                    const newSettings = { ...localAudioSettings, inputDevice: e.target.value };
                    setLocalAudioSettings(newSettings);
                    localStorage.setItem("local-audio-input", e.target.value);
                    if (audioStatus === "playing" && audioSettings.outboundEnabled && !outboundMuted && localAudioReady) {
                      stopMicCapture();
                      startMicCapture();
                    }
                  }}
                  className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                >
                  <option value="default">Default Input</option>
                  {localAudioDevices.inputs.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Input ${d.deviceId.slice(0, 5)}`}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">Local Output (Speakers/Headphones)</label>
                <select
                  value={localAudioSettings.outputDevice}
                  onFocus={() => navigator.mediaDevices.enumerateDevices().then(devices => {
                    setLocalAudioDevices(splitLocalAudioDevices(devices));
                  }).catch(console.error)}
                  onChange={(e) => {
                    const newSettings = { ...localAudioSettings, outputDevice: e.target.value };
                    setLocalAudioSettings(newSettings);
                    localStorage.setItem("local-audio-output", e.target.value);
                    if (audioContextRef.current && typeof (audioContextRef.current as any).setSinkId === 'function') {
                      (audioContextRef.current as any).setSinkId(e.target.value).catch(console.error);
                    }
                    if (sidetoneCtxRef.current && typeof (sidetoneCtxRef.current as any).setSinkId === 'function') {
                      (sidetoneCtxRef.current as any).setSinkId(e.target.value).catch(console.error);
                    }
                  }}
                  className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                >
                  <option value="default">Default Output</option>
                  {localAudioDevices.outputs.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 5)}`}</option>
                  ))}
                </select>
                <div className="flex items-center gap-3 pt-1">
                  <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold whitespace-nowrap">Local Speaker Volume</label>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.01}
                    value={inboundVolume}
                    onChange={(e) => {
                      const vol = parseFloat(e.target.value);
                      setInboundVolume(vol);
                      localStorage.setItem("local-audio-inbound-volume", String(vol));
                      if (inboundGainRef.current) inboundGainRef.current.gain.value = inboundMuted ? 0 : vol;
                    }}
                    className="flex-1 accent-blue-500"
                  />
                  <span className="text-xs text-[#8e9299] w-8 text-right">{Math.round(inboundVolume * 100)}%</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">Audio Enhancements (AGC / Noise Suppression / Echo Cancellation)</label>
                <button
                  onClick={() => {
                    const enabled = !localAudioSettings.enhancementsEnabled;
                    setLocalAudioSettings(prev => ({ ...prev, enhancementsEnabled: enabled }));
                    localStorage.setItem("local-audio-enhancements", String(enabled));
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                    localAudioSettings.enhancementsEnabled ? "bg-blue-500" : "bg-[#2a2b2e]"
                  )}
                >
                  <span className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                    localAudioSettings.enhancementsEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  )} />
                </button>
              </div>
            </div>

            {/* WSJTX Bridge Section */}
            <div className="pt-4 border-t border-[#2a2b2e]/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio size={14} className="text-[#8e9299]" />
                  <h4 className="text-[0.625rem] uppercase text-[#8e9299] font-bold">WSJTX / Digital Mode Bridge</h4>
                </div>
                <div className="flex items-center gap-2">
                  {wsjtxBridgeEnabled && (
                    <span className={cn(
                      "text-[0.5rem] uppercase font-bold flex items-center gap-1",
                      wsjtxBridgeConnected ? "text-green-500" : "text-yellow-500"
                    )}>
                      {wsjtxBridgeConnected ? <Link size={10} /> : <Link2Off size={10} />}
                      {wsjtxBridgeConnected ? "Connected" : "Waiting"}
                    </span>
                  )}
                  <button
                    onClick={() => setWsjtxBridgeEnabled(!wsjtxBridgeEnabled)}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      wsjtxBridgeEnabled ? "bg-blue-500" : "bg-[#2a2b2e]"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
                      wsjtxBridgeEnabled ? "translate-x-[18px]" : "translate-x-[3px]"
                    )} />
                  </button>
                </div>
              </div>

              {wsjtxBridgeEnabled && wsjtxAutoSetupWarning && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <AlertTriangle size={12} className="text-yellow-500 mt-0.5 shrink-0" />
                  <p className="text-[0.625rem] text-yellow-400">{wsjtxAutoSetupWarning}</p>
                </div>
              )}

              {wsjtxBridgeEnabled && wsjtxAutoSetupActive && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Link size={12} className="text-emerald-500 shrink-0" />
                  <p className="text-[0.625rem] text-emerald-400">Audio devices auto-configured for WSJTX bridge</p>
                </div>
              )}

              {wsjtxBridgeEnabled && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">WSJTX Audio Output (Virtual Cable)</label>
                    <select
                      value={localAudioSettings.wsjtxOutputDevice}
                      onFocus={() => navigator.mediaDevices.enumerateDevices().then(devices => {
                        setLocalAudioDevices(splitLocalAudioDevices(devices));
                      }).catch(console.error)}
                      onChange={(e) => {
                        const newSettings = { ...localAudioSettings, wsjtxOutputDevice: e.target.value };
                        setLocalAudioSettings(newSettings);
                        updateWsjtxOutput(e.target.value);
                      }}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                    >
                      <option value="">None (Disabled)</option>
                      {localAudioDevices.outputs.map(d => {
                        const label = d.label || `Output ${d.deviceId.slice(0, 5)}`;
                        const isVirtual = /VB-Audio|CABLE|BlackHole|wsjtx|null|virtual/i.test(label);
                        return (
                          <option key={d.deviceId} value={d.deviceId}>
                            {label}{isVirtual ? " ★" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[0.625rem] uppercase text-[#4a4b4e] font-bold">Bridge WebSocket Port</label>
                    <input
                      type="number"
                      value={wsjtxWsPort}
                      onChange={(e) => setWsjtxWsPort(parseInt(e.target.value) || 4541)}
                      className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                    />
                  </div>

                  <p className="text-[0.5rem] uppercase text-[#4a4b4e] font-bold">
                    Run wsjtx-bridge helper on this machine. In WSJTX, set Rig to "Hamlib NET rigctl" → localhost:4540.{" "}
                    <a href="https://jbdubbs.github.io/Rig-Control-Web/downloads/" target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300 normal-case">Download Helper</a>
                    {" · "}
                    <a href="https://github.com/jbdubbs/Rig-Control-Web/blob/main/docs/wsjtx-integration.md" target="_blank" rel="noreferrer" className="text-emerald-400 underline hover:text-emerald-300 normal-case">Setup Guide</a>
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[#2a2b2e]/50">
              <button
                onClick={onToggleBackendEngineCollapsed}
                className="w-full flex items-center justify-between mb-3 group"
              >
                <h4 className="text-[0.625rem] uppercase text-[#8e9299] font-bold group-hover:text-white transition-colors">Backend Audio Engine</h4>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[0.5rem] uppercase font-bold px-1.5 py-0.5 rounded",
                    audioEngineState.isReady ? "bg-emerald-500/20 text-emerald-500" : "bg-red-500/20 text-red-500"
                  )}>
                    {audioEngineState.isReady ? "READY" : "FAILED"}
                  </span>
                  <span className={cn(
                    "text-[0.5rem] uppercase font-bold px-1.5 py-0.5 rounded",
                    audioStatus === "playing" ? "bg-blue-500/20 text-blue-400"
                      : audioStatus === "cooldown" ? "bg-amber-500/20 text-amber-400"
                      : "bg-[#2a2b2e] text-[#4a4b4e]"
                  )}>
                    {audioStatus === "playing" ? "RUNNING" : audioStatus === "cooldown" ? "COOLDOWN" : "STOPPED"}
                  </span>
                  {audioSettings.backendLockedToAdmin && (
                    <span className="text-[0.5rem] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 flex items-center gap-1">
                      <Lock size={9} /> Locked
                    </span>
                  )}
                  {isBackendEngineCollapsed ? <ChevronDown size={12} className="text-[#8e9299]" /> : <ChevronUp size={12} className="text-[#8e9299]" />}
                </div>
              </button>

              {!isBackendEngineCollapsed && (<>
              {role === "admin" && (
                <div className="flex items-center justify-between px-3 py-2 mb-3 bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg">
                  <div className="flex items-center gap-2 text-[0.625rem] uppercase text-[#8e9299] font-bold">
                    <Lock size={12} /> Restrict to Admins
                  </div>
                  <button
                    onClick={() => {
                      const newSettings = { ...audioSettings, backendLockedToAdmin: !audioSettings.backendLockedToAdmin };
                      setAudioSettings(newSettings);
                      socket?.emit("update-audio-settings", newSettings);
                    }}
                    className={cn(
                      "w-8 h-4 rounded-full transition-all relative",
                      audioSettings.backendLockedToAdmin ? "bg-amber-500" : "bg-[#2a2b2e]"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                      audioSettings.backendLockedToAdmin ? "left-4.5" : "left-0.5"
                    )} />
                  </button>
                </div>
              )}

              {backendLocked && (
                <div className="flex items-center gap-2 mb-3 text-[0.625rem] uppercase text-amber-400/80 font-bold">
                  <Lock size={12} /> Locked by Administrator
                </div>
              )}

              {audioSettingsDenied && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-3 mb-3">
                  <Lock className="text-amber-400 shrink-0" size={16} />
                  <p className="text-[0.625rem] text-amber-400/80 font-medium leading-tight">
                    {audioSettingsDenied.reason}
                  </p>
                </div>
              )}

              {audioEngineState.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
                  <AlertTriangle className="text-red-500 shrink-0" size={16} />
                  <p className="text-[0.625rem] text-red-500/80 font-medium leading-tight">
                    Audio Engine Error: {audioEngineState.error}
                  </p>
                </div>
              )}

              <div className={cn("space-y-4", (!audioEngineState.isReady || audioStatus === "cooldown" || backendLocked) && "opacity-50 pointer-events-none")}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Backend Input (Mic/Line)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.5rem] uppercase text-[#4a4b4e]">Enabled</span>
                      <button
                        disabled={backendLocked}
                        onClick={() => {
                          const newSettings = { ...audioSettings, inboundEnabled: !audioSettings.inboundEnabled };
                          setAudioSettings(newSettings);
                          socket?.emit("update-audio-settings", newSettings);
                        }}
                        className={cn(
                          "w-8 h-4 rounded-full transition-all relative",
                          audioSettings.inboundEnabled ? "bg-blue-500" : "bg-[#2a2b2e]"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                          audioSettings.inboundEnabled ? "left-4.5" : "left-0.5"
                        )} />
                      </button>
                    </div>
                  </div>
                  <select
                    value={audioSettings.inputDevice}
                    disabled={backendLocked}
                    onFocus={() => socket?.emit("get-audio-devices")}
                    onChange={(e) => {
                      const newSettings = { ...audioSettings, inputDevice: e.target.value, inboundEnabled: e.target.value !== "" };
                      setAudioSettings(newSettings);
                      socket?.emit("update-audio-settings", newSettings);
                    }}
                    className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                  >
                    <option value="">Select Backend Input</option>
                    {audioDevices.inputs.map(d => {
                      const api = d.hostAPIName.replace(/^Windows\s+/i, '');
                      const isWASAPI = /WASAPI/i.test(api);
                      const wasapiIncompatible = isWASAPI && d.defaultSampleRate !== 48000;
                      const rateK = d.defaultSampleRate / 1000;
                      const rate = d.defaultSampleRate ? `${rateK === Math.floor(rateK) ? rateK : rateK.toFixed(1)}k` : '';
                      const label = isWASAPI
                        ? `${d.name} [WASAPI${wasapiIncompatible ? ` – set device to 48k in Windows` : ''}]`
                        : `${d.name}${api || rate ? ` [${[api, rate].filter(Boolean).join(', ')}]` : ''}`;
                      return <option key={d.altName} value={JSON.stringify({ name: d.name, hostAPIName: d.hostAPIName })} disabled={wasapiIncompatible}>{label}</option>;
                    })}
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[0.625rem] uppercase text-[#8e9299] font-bold">Backend Output (Speakers)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.5rem] uppercase text-[#4a4b4e]">Enabled</span>
                      <button
                        disabled={backendLocked}
                        onClick={() => {
                          const newSettings = { ...audioSettings, outboundEnabled: !audioSettings.outboundEnabled };
                          setAudioSettings(newSettings);
                          socket?.emit("update-audio-settings", newSettings);
                        }}
                        className={cn(
                          "w-8 h-4 rounded-full transition-all relative",
                          audioSettings.outboundEnabled ? "bg-blue-500" : "bg-[#2a2b2e]"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all",
                          audioSettings.outboundEnabled ? "left-4.5" : "left-0.5"
                        )} />
                      </button>
                    </div>
                  </div>
                  <select
                    value={audioSettings.outputDevice}
                    disabled={backendLocked}
                    onFocus={() => socket?.emit("get-audio-devices")}
                    onChange={(e) => {
                      const newSettings = { ...audioSettings, outputDevice: e.target.value, outboundEnabled: e.target.value !== "" };
                      setAudioSettings(newSettings);
                      socket?.emit("update-audio-settings", newSettings);
                    }}
                    className="w-full bg-[#0a0a0a] border border-[#2a2b2e] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 transition-all"
                  >
                    <option value="">Select Backend Output</option>
                    {audioDevices.outputs.map(d => {
                      const api = d.hostAPIName.replace(/^Windows\s+/i, '');
                      const isWASAPI = /WASAPI/i.test(api);
                      const wasapiIncompatible = isWASAPI && d.defaultSampleRate !== 48000;
                      const rateK = d.defaultSampleRate / 1000;
                      const rate = d.defaultSampleRate ? `${rateK === Math.floor(rateK) ? rateK : rateK.toFixed(1)}k` : '';
                      const label = isWASAPI
                        ? `${d.name} [WASAPI${wasapiIncompatible ? ` – set device to 48k in Windows` : ''}]`
                        : `${d.name}${api || rate ? ` [${[api, rate].filter(Boolean).join(', ')}]` : ''}`;
                      return <option key={d.altName} value={JSON.stringify({ name: d.name, hostAPIName: d.hostAPIName })} disabled={wasapiIncompatible}>{label}</option>;
                    })}
                  </select>
                </div>
              </div>

              <div className={cn("flex gap-3 pt-2", backendLocked && "opacity-50 pointer-events-none")}>
                <button
                  onClick={handleStartAudio}
                  disabled={(!audioSettings.inputDevice && !audioSettings.outputDevice) || audioStatus === "playing" || audioStatus === "cooldown" || backendLocked}
                  title={audioStatus === "cooldown" ? "Waiting for the previous audio device to finish closing…" : undefined}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                    audioStatus === "cooldown"
                      ? "bg-amber-500/10 text-amber-300 cursor-not-allowed"
                      : audioStatus === "playing"
                      ? "bg-blue-500/20 text-blue-500 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                  )}
                >
                  {audioStatus === "cooldown" ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
                  Start Backend Audio
                </button>
                <button
                  onClick={() => socket?.emit("control-audio", "stop")}
                  disabled={audioStatus === "stopped" || audioStatus === "cooldown" || backendLocked}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold uppercase text-xs transition-all",
                    audioStatus === "stopped" || audioStatus === "cooldown"
                      ? "bg-red-500/20 text-red-500 cursor-not-allowed"
                      : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                  )}
                >
                  <X size={16} />
                  Stop Backend Audio
                </button>
              </div>

              <div className="flex items-center gap-2 p-3 bg-[#0a0a0a] border border-[#2a2b2e] rounded-xl">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  audioStatus === "playing" ? "bg-blue-500 animate-pulse"
                    : audioStatus === "cooldown" ? "bg-amber-500 animate-pulse"
                    : "bg-[#2a2b2e]"
                )} />
                <span className="text-[0.625rem] uppercase font-bold text-[#8e9299]">
                  Backend Audio: {audioStatus.toUpperCase()}
                </span>
              </div>
              </>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(AudioSettingsModal);
