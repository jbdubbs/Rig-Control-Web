import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatStep(s: number): string {
  if (s >= 1) return `${s} MHz`;
  if (s >= 0.001) return `${s * 1000} kHz`;
  return `${s * 1000000} Hz`;
}

// Chromium's enumerateDevices() includes its own synthetic deviceId "default" entry
// alongside real devices. Our device pickers already render a hardcoded "Default"
// option, so keeping the browser's copy creates two <option value="default"> siblings
// and the <select> always displays whichever one is first in DOM order regardless of
// which the user actually picked. Drop it here so "default" appears exactly once.
export function splitLocalAudioDevices(devices: MediaDeviceInfo[]): { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] } {
  const real = devices.filter(d => d.deviceId !== "default");
  return {
    inputs: real.filter(d => d.kind === "audioinput"),
    outputs: real.filter(d => d.kind === "audiooutput"),
  };
}

// Pure go/no-go check for auto-joining the local audio pipeline (issue #51):
// only attempt it once the page has seen a user gesture (browser autoplay
// policy) and only while there's actually a session to join.
export function shouldAttemptAutoJoin(
  audioStatus: "playing" | "stopped" | "cooldown",
  localAudioReady: boolean,
  hasGestured: boolean,
): boolean {
  return hasGestured && audioStatus === "playing" && !localAudioReady;
}

// Pure go/no-go check for re-requesting the Screen Wake Lock (issue #61):
// a held sentinel is unconditionally released by the browser when the page
// is hidden, so it must be re-acquired on return, but only while the
// feature is still meant to be on and only if we don't already hold one.
export function shouldReacquireWakeLock(input: {
  documentVisible: boolean;
  isActive: boolean;
  hasSentinel: boolean;
}): boolean {
  return input.documentVisible && input.isActive && !input.hasSentinel;
}
