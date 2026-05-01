import React from "react";
import type { Socket } from "socket.io-client";
import {
  Monitor,
  Settings,
  Headphones,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  AlertCircle,
} from "lucide-react";
import { cn } from "../utils";
import type { AudioSettings } from "../types";

export interface VideoAudioHeaderActionsProps {
  variant: "phone" | "compact";
  socket: Socket | null;
  videoStatus: "streaming" | "stopped";
  setIsVideoSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  enumerateVideoDevices: () => void;
  isElectronSource: boolean;
  audioStatus: "playing" | "stopped";
  localAudioReady: boolean;
  audioWasRestarted: boolean;
  audioSettings: AudioSettings;
  inboundMuted: boolean;
  setInboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  outboundMuted: boolean;
  setOutboundMuted: React.Dispatch<React.SetStateAction<boolean>>;
  handleJoinAudio: () => void;
}

export function VideoAudioHeaderActions({
  variant,
  socket,
  videoStatus,
  setIsVideoSettingsOpen,
  enumerateVideoDevices,
  isElectronSource,
  audioStatus,
  localAudioReady,
  audioWasRestarted,
  audioSettings,
  inboundMuted,
  setInboundMuted,
  outboundMuted,
  setOutboundMuted,
  handleJoinAudio,
}: VideoAudioHeaderActionsProps) {
  const isPhone = variant === "phone";
  const settingsIconSize = isPhone ? 14 : 12;
  const headerGap = "gap-2";

  const handleSettingsClick = () => {
    setIsVideoSettingsOpen(true);
    if (variant !== "compact") socket?.emit("get-video-devices");
    socket?.emit("get-audio-devices");
    if (isElectronSource) enumerateVideoDevices();
  };

  return (
    <div className={cn("flex items-center", headerGap)}>
      {audioStatus === "playing" && !localAudioReady ? (
        <button
          onClick={handleJoinAudio}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[0.5rem] uppercase font-bold bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-all border border-blue-500/30 mr-1"
          title="Join the active audio session"
        >
          <Headphones size={10} />
          {audioWasRestarted ? "Restarted — Join Audio" : "Join Audio"}
        </button>
      ) : (
        <div className="flex items-center gap-1 mr-1">
          <button
            onClick={() => setInboundMuted(!inboundMuted)}
            disabled={audioStatus !== "playing" || !localAudioReady}
            className={cn(
              "p-1 rounded-lg transition-all",
              audioStatus !== "playing" || !localAudioReady
                ? "opacity-30 cursor-not-allowed"
                : inboundMuted
                ? "text-red-500 bg-red-500/10"
                : "text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20"
            )}
            title={inboundMuted ? "Unmute Inbound Audio" : "Mute Inbound Audio"}
          >
            {inboundMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
          <button
            onClick={() => {
              const newMuted = !outboundMuted;
              setOutboundMuted(newMuted);
              if (newMuted) {
                socket?.emit("mic-mute-notify");
              } else {
                socket?.emit("mic-unmute-request");
              }
            }}
            disabled={
              audioStatus !== "playing" ||
              !audioSettings.outboundEnabled ||
              !localAudioReady
            }
            className={cn(
              "p-1 rounded-lg transition-all",
              audioStatus !== "playing" ||
                !audioSettings.outboundEnabled ||
                !localAudioReady
                ? "opacity-30 cursor-not-allowed"
                : outboundMuted
                ? "text-red-500 bg-red-500/10"
                : "text-blue-500 bg-blue-500/10 hover:bg-blue-500/20"
            )}
            title={
              outboundMuted ? "Unmute Outbound Audio" : "Mute Outbound Audio"
            }
          >
            {outboundMuted ? <MicOff size={12} /> : <Mic size={12} />}
          </button>
        </div>
      )}
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          videoStatus === "streaming"
            ? "bg-emerald-500 animate-pulse"
            : "bg-[#2a2b2e]"
        )}
      />
      <button
        onClick={handleSettingsClick}
        className={cn(
          "hover:bg-[#2a2b2e] rounded-lg text-[#8e9299] transition-all",
          isPhone ? "p-1.5" : "p-1"
        )}
        title="Video & Audio Settings"
      >
        <Settings size={settingsIconSize} />
      </button>
    </div>
  );
}

export interface VideoAudioPanelProps {
  variant: "phone" | "compact";
  socket: Socket | null;
  videoStatus: "streaming" | "stopped";
  isElectronSource: boolean;
  videoError: string | null;
  setVideoError: React.Dispatch<React.SetStateAction<string | null>>;
  videoPreviewCallbackRef: React.RefCallback<HTMLVideoElement>;
  videoCanvasRef: React.RefObject<HTMLCanvasElement>;
}

export default function VideoAudioPanel({
  variant,
  socket,
  videoStatus,
  isElectronSource,
  videoError,
  setVideoError,
  videoPreviewCallbackRef,
  videoCanvasRef,
}: VideoAudioPanelProps) {
  const isPhone = variant === "phone";

  const stoppedMonitorSize = isPhone ? 32 : 24;
  const stoppedLabel = isPhone ? "Stream Stopped" : "Stopped";
  const stoppedLabelClass = "text-[0.5rem]";

  const errorIconClass = isPhone ? "w-8 h-8" : "w-6 h-6";
  const errorTextClass = isPhone ? "text-xs" : "text-[10px]";
  const errorRetryClass = isPhone
    ? "mt-3 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-[10px] transition-colors"
    : "mt-2 px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-500/30 rounded text-[9px] transition-colors";

  return (
    <div className="relative aspect-video bg-black flex items-center justify-center">
      <video
        ref={videoPreviewCallbackRef}
        autoPlay
        muted
        playsInline
        className={cn(
          "w-full h-full object-contain",
          (!isElectronSource || videoStatus !== "streaming") && "hidden"
        )}
      />
      <canvas
        ref={videoCanvasRef}
        className={cn(
          "w-full h-full object-contain",
          (isElectronSource || videoStatus !== "streaming") && "hidden"
        )}
      />
      {videoStatus !== "streaming" && (
        <div className="flex flex-col items-center gap-4 text-[#3a3b3e]">
          <Monitor size={stoppedMonitorSize} strokeWidth={1} />
          <span
            className={cn(
              stoppedLabelClass,
              "uppercase font-bold tracking-widest"
            )}
          >
            {stoppedLabel}
          </span>
        </div>
      )}
      {videoError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-4 text-center z-10">
          <AlertCircle className={cn(errorIconClass, "text-red-500 mb-3")} />
          <p className={cn(errorTextClass, "text-red-400 font-medium")}>
            {videoError}
          </p>
          {isElectronSource && (
            <button
              onClick={() => {
                setVideoError(null);
                socket?.emit("request-video-start");
              }}
              className={errorRetryClass}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
