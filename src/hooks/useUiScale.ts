import {useCallback, useEffect, useRef, useState} from 'react';
import {
  UI_SCALE_DEFAULT,
  UI_SCALE_KEY,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampScale,
  parseStoredScale,
  stepScale,
} from '../utils/uiScale';

export function readStoredScale(): number {
  try {
    return parseStoredScale(localStorage.getItem(UI_SCALE_KEY));
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

// Electron: real Chromium zoom through the preload bridge, which keeps canvases
// crisp and mouse coordinates consistent. Browsers: CSS `zoom` on <html>
// (native Ctrl +/- keeps working independently).
export function applyScale(scale: number) {
  if (window.electron?.setZoomFactor) {
    window.electron.setZoomFactor(scale);
    return;
  }
  const root = document.documentElement;
  if (scale === UI_SCALE_DEFAULT) {
    root.style.zoom = '';
    root.style.removeProperty('--ui-scale');
    delete root.dataset.uiZoom;
    return;
  }
  root.style.zoom = String(scale);
  // CSS zoom also multiplies vh/dvh lengths, so full-height containers would
  // overflow the viewport; index.css divides them back out via this variable.
  root.style.setProperty('--ui-scale', String(scale));
  root.dataset.uiZoom = '';
}

export function useUiScale() {
  const [scale, setScaleState] = useState<number>(readStoredScale);

  // Last scale pushed to the page, or null before the first push.
  const appliedRef = useRef<number | null>(null);

  useEffect(() => {
    // Electron: on a fresh load at the default scale, leave Chromium's own zoom
    // (the user's Ctrl +/- zoom) alone instead of resetting it to 100% on every
    // load. Once applied (including a later reset to 100%), changes always push.
    // The ref, not a mount flag, keeps this correct under StrictMode's
    // double-invoked effects.
    const keepNativeZoom =
      appliedRef.current === null && scale === UI_SCALE_DEFAULT && !!window.electron?.setZoomFactor;
    if (!keepNativeZoom) {
      applyScale(scale);
      appliedRef.current = scale;
    }
    try {
      localStorage.setItem(UI_SCALE_KEY, String(scale));
    } catch {
      // storage unavailable; scale still applies for this session
    }
  }, [scale]);

  const setScale = useCallback((value: number) => setScaleState(clampScale(value)), []);
  const increase = useCallback(() => setScaleState((s) => stepScale(s, 1)), []);
  const decrease = useCallback(() => setScaleState((s) => stepScale(s, -1)), []);
  const reset = useCallback(() => setScaleState(UI_SCALE_DEFAULT), []);

  return {
    scale,
    setScale,
    increase,
    decrease,
    reset,
    canIncrease: scale < UI_SCALE_MAX,
    canDecrease: scale > UI_SCALE_MIN,
  };
}
