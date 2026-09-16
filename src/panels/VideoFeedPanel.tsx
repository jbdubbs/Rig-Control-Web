import React from "react";
import type { Socket } from "socket.io-client";
import { Monitor, Settings, AlertCircle } from "lucide-react";
import { cn } from "../utils";

export interface VideoFeedHeaderActionsProps {
  variant: "phone" | "compact";
  socket: Socket | null;
  videoStatus: "streaming" | "stopped";
  setIsVideoSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  enumerateVideoDevices: () => void;
  isElectronSource: boolean;
}

export function VideoFeedHeaderActions({
  variant,
  socket,
  videoStatus,
  setIsVideoSettingsOpen,
  enumerateVideoDevices,
  isElectronSource,
}: VideoFeedHeaderActionsProps) {
  const settingsIconSize = variant === "phone" ? 14 : 12;

  const handleSettingsClick = () => {
    setIsVideoSettingsOpen(true);
    // Pull whatever the server currently has cached, in every layout, then
    // ask the Electron source (if any) to re-enumerate and push a fresh
    // list — this lets a remote-only browser session recover from a stale
    // or never-populated device list without a page reload.
    socket?.emit("get-video-devices");
    if (isElectronSource) {
      enumerateVideoDevices();
    } else {
      socket?.emit("request-video-devices-refresh");
    }
  };

  return (
    <div className="flex items-center gap-2">
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
          variant === "phone" ? "p-1.5" : "p-1"
        )}
        title="Video Settings"
      >
        <Settings size={settingsIconSize} />
      </button>
    </div>
  );
}

export interface VideoFeedPanelProps {
  variant: "phone" | "compact";
  socket: Socket | null;
  videoStatus: "streaming" | "stopped";
  isElectronSource: boolean;
  videoError: string | null;
  setVideoError: React.Dispatch<React.SetStateAction<string | null>>;
  videoPreviewCallbackRef: React.RefCallback<HTMLVideoElement>;
  videoCanvasRef: React.RefObject<HTMLCanvasElement>;
}

function VideoFeedPanel({
  variant,
  socket,
  videoStatus,
  isElectronSource,
  videoError,
  setVideoError,
  videoPreviewCallbackRef,
  videoCanvasRef,
}: VideoFeedPanelProps) {
  const isPhone = variant === "phone";

  const stoppedMonitorSize = isPhone ? 32 : 24;
  const stoppedLabel = isPhone ? "Stream Stopped" : "Stopped";
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
          <span className="text-[0.5rem] uppercase font-bold tracking-widest">
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

// None of this panel's props (videoStatus, videoError, etc.) are touched by rig-status
// polling — memoizing avoids re-rendering it on every 2s tick.
export default React.memo(VideoFeedPanel);
