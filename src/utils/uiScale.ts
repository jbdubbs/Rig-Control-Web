// UI scale (issue #123): a per-device display preference, so it lives in
// localStorage, not server settings.json (shared by every client).

export const UI_SCALE_KEY = 'ui-scale';
export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 2;
export const UI_SCALE_STEP = 0.25;
export const UI_SCALE_DEFAULT = 1;

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
 * Width the Compact/Phone breakpoint should compare against. Electron applies
 * the scale as Chromium zoom, which already shrinks window.innerWidth, so
 * nothing to correct there. The browser path uses CSS `zoom`, which leaves
 * innerWidth untouched, so divide it by the scale to get the width the layout
 * actually has to fit into.
 */
export function layoutWidth(innerWidth: number, scale: number, cssZoomActive: boolean): number {
  return cssZoomActive && scale > 0 ? innerWidth / scale : innerWidth;
}
