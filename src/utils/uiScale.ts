// UI scale (issue #123): a per-device display preference, so it lives in
// localStorage, not server settings.json (shared by every client).

export const UI_SCALE_KEY = 'ui-scale';
export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 3;
export const UI_SCALE_STEP = 0.25;
export const UI_SCALE_DEFAULT = 1;

/** Phone layout below this width, measured in unscaled (physical) CSS px. */
export const PHONE_BREAKPOINT_PX = 768;

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  const snapped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, snapped));
}

export function parseStoredScale(raw: string | null): number {
  if (raw === null) return UI_SCALE_DEFAULT;
  return clampScale(parseFloat(raw));
}

export function stepScale(current: number, direction: 1 | -1): number {
  return clampScale(current + direction * UI_SCALE_STEP);
}

/**
 * Width the layout breakpoint should compare against. Chromium zoom (Electron,
 * or native browser zoom) shrinks window.innerWidth by the zoom factor, which
 * would flip a zoomed-in desktop window to the Phone layout. Multiplying by the
 * zoom factor recovers the physical width. CSS `zoom` leaves innerWidth
 * untouched, so callers pass 1 in that case.
 */
export function physicalLayoutWidth(innerWidth: number, chromiumZoomFactor: number): number {
  const zoom = Number.isFinite(chromiumZoomFactor) && chromiumZoomFactor > 0 ? chromiumZoomFactor : 1;
  return innerWidth * zoom;
}

export function isPhoneWidth(innerWidth: number, chromiumZoomFactor: number): boolean {
  return Math.round(physicalLayoutWidth(innerWidth, chromiumZoomFactor)) < PHONE_BREAKPOINT_PX;
}
