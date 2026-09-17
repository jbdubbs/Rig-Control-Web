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

// naudiodon's WASAPI host API only works reliably at a device's Windows-configured default
// sample rate — a mismatch here (rather than an unsupported rate outright) is what actually
// breaks it, so flag it in the option label and disable selecting it instead of letting it
// silently fail to start.
export function formatAudioDeviceOption(
  d: { name: string; hostAPIName: string; defaultSampleRate: number }
): { label: string; disabled: boolean } {
  const api = d.hostAPIName.replace(/^Windows\s+/i, '');
  const isWASAPI = /WASAPI/i.test(api);
  const wasapiIncompatible = isWASAPI && d.defaultSampleRate !== 48000;
  const rateK = d.defaultSampleRate / 1000;
  const rate = d.defaultSampleRate ? `${rateK === Math.floor(rateK) ? rateK : rateK.toFixed(1)}k` : '';
  const label = isWASAPI
    ? `${d.name} [WASAPI${wasapiIncompatible ? ` – set device to 48k in Windows` : ''}]`
    : `${d.name}${api || rate ? ` [${[api, rate].filter(Boolean).join(', ')}]` : ''}`;
  return { label, disabled: wasapiIncompatible };
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

// Pure go/no-go check for rebuilding the local audio playback pipeline
// (issue #113): a backgrounded/frozen tab can leave the AudioContext
// suspended or have its WebCodecs AudioDecoder reclaimed by the browser
// entirely, independent of the server ever reporting "stopped" — neither
// case flips localAudioReady back to false on its own, so nothing would
// otherwise notice the pipeline is dead and rebuild it.
export function shouldRecoverAudioPipeline(input: {
  documentVisible: boolean;
  audioStatus: "playing" | "stopped" | "cooldown";
  localAudioReady: boolean;
  audioContextState: AudioContextState | null;
  decoderState: "unconfigured" | "configured" | "closed" | null;
}): boolean {
  return (
    input.documentVisible &&
    input.audioStatus === "playing" &&
    input.localAudioReady &&
    (input.audioContextState !== "running" || input.decoderState !== "configured")
  );
}

// Shared by SpectrumHamlibPanel/SpectrumAudioPanel's waterfall canvases: shifts the existing
// pixel content down by one row (dropping the bottom row) and paints newRowPixels at the top —
// O(width) work per call instead of rebuilding the full width*height ImageData every frame.
// newRowPixels must have exactly `width` elements.
export function scrollCanvasDown(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  newRowPixels: Uint32Array,
): void {
  if (height > 1) {
    ctx.drawImage(ctx.canvas, 0, 0, width, height - 1, 0, 1, width, height - 1);
  }
  const rowData = ctx.createImageData(width, 1);
  new Uint32Array(rowData.data.buffer).set(newRowPixels);
  ctx.putImageData(rowData, 0, 0);
}
