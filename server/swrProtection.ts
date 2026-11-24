// Pure decision logic for SWR protection (#128). Kept free of sockets/timers so it can be unit
// tested; the runtime guard loop and trip action live in rigComm.ts.
import type { TuneWindow } from "./context.ts";

export const SWR_THRESHOLD_MIN = 1.1;
export const SWR_THRESHOLD_MAX = 10;
export const SWR_THRESHOLD_DEFAULT = 3.0;

/** Consecutive over-threshold samples required to trip, so a single key-up transient can't. */
export const SWR_TRIP_CONSECUTIVE = 2;

/** An app-initiated tune that never makes the rig transmit closes its window after this long. */
export const TUNE_NO_PTT_TIMEOUT_MS = 5000;

/**
 * Hard cap on a tune window. SWR is deliberately high during an ATU tune cycle, so protection is
 * suspended for it, but a tune whose carrier hangs on past this must be caught by normal protection.
 */
export const TUNE_WINDOW_MAX_MS = 20000;

export function sanitizeSwrThreshold(value: unknown, fallback = SWR_THRESHOLD_DEFAULT): number {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return fallback;
  return Math.min(SWR_THRESHOLD_MAX, Math.max(SWR_THRESHOLD_MIN, n));
}

export interface SwrTripInput {
  swr: number;
  /** The rig is transmitting (PTT or CW key). */
  keyed: boolean;
  /** Inside an app-initiated tune window: SWR is intentionally high, never trip. */
  tuning: boolean;
  enabled: boolean;
  threshold: number;
  alreadyTripped: boolean;
  /** Over-threshold samples seen in a row so far. */
  consecutive: number;
}

export interface SwrTripDecision {
  trip: boolean;
  /** Carry into the next call. */
  consecutive: number;
}

export function evaluateSwrTrip(input: SwrTripInput): SwrTripDecision {
  const { swr, keyed, tuning, enabled, threshold, alreadyTripped, consecutive } = input;
  if (!enabled || !keyed || tuning || alreadyTripped) return { trip: false, consecutive: 0 };
  // Rigs without a usable SWR meter (Hamlib Dummy, some G90 builds) report 0 or garbage; < 1 is
  // not a real ratio and must never trip.
  if (!Number.isFinite(swr) || swr < 1) return { trip: false, consecutive: 0 };
  if (swr <= threshold) return { trip: false, consecutive: 0 };
  const next = consecutive + 1;
  return { trip: next >= SWR_TRIP_CONSECUTIVE, consecutive: next };
}

export function openTuneWindow(now: number): TuneWindow {
  return { startedAt: now, seenPtt: false };
}

/**
 * Advances a tune window given the rig's current PTT state. Returns null once the window should
 * close: PTT dropped after the tune keyed the rig, the rig never keyed within
 * TUNE_NO_PTT_TIMEOUT_MS, or the hard cap passed.
 */
export function advanceTuneWindow(
  win: TuneWindow | null,
  ptt: boolean,
  now: number,
): TuneWindow | null {
  if (!win) return null;
  const elapsed = now - win.startedAt;
  if (elapsed >= TUNE_WINDOW_MAX_MS) return null;
  if (ptt) return win.seenPtt ? win : { ...win, seenPtt: true };
  if (win.seenPtt) return null;
  if (elapsed >= TUNE_NO_PTT_TIMEOUT_MS) return null;
  return win;
}
