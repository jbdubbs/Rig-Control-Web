import { useState, useCallback } from 'react';
import type { LayoutConfig, ViewLayout, GridItem, PanelType, PanelAddConfig } from '../types/layout';
import { PANEL_MIN_SIZES, mufMapStorageKey } from '../types/layout';


const BASE_STORAGE_KEY = 'grid-layout-v1';

export const DEFAULT_COMPACT_LAYOUT: ViewLayout = {
  cols: 3,
  rows: 6,
  items: [
    { i: 'vfo',             x: 0, y: 0, w: 9999, h: 1, minW: 2, minH: 1, panelType: 'vfo', fullWidth: true },
    { i: 'controls',        x: 0, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'controls' },
    { i: 'rflevels',        x: 0, y: 2, w: 1, h: 1, minW: 1, minH: 1, panelType: 'rflevels' },
    { i: 'smeter',          x: 1, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'smeter' },
    { i: 'audio_feed',      x: 1, y: 2, w: 1, h: 1, minW: 1, minH: 1, panelType: 'audio_feed' },
    { i: 'video_feed',      x: 1, y: 3, w: 1, h: 1, minW: 1, minH: 1, panelType: 'video_feed' },
    { i: 'spectrum_hamlib', x: 1, y: 4, w: 1, h: 2, minW: 1, minH: 2, panelType: 'spectrum_hamlib' },
    { i: 'spots_combo',     x: 2, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'spots_combo' },
    { i: 'solar',           x: 2, y: 2, w: 1, h: 1, minW: 1, minH: 1, panelType: 'solar' },
    { i: 'mufmap',          x: 2, y: 3, w: 1, h: 1, minW: 1, minH: 1, panelType: 'mufmap' },
  ],
};

export const DEFAULT_PHONE_LAYOUT: ViewLayout = {
  cols: 1,
  rows: 10,
  items: [
    { i: 'vfo',             x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1, panelType: 'vfo' },
    { i: 'spectrum_hamlib', x: 0, y: 1, w: 1, h: 2, minW: 1, minH: 2, panelType: 'spectrum_hamlib' },
    { i: 'controls',        x: 0, y: 3, w: 1, h: 1, minW: 1, minH: 1, panelType: 'controls' },
    { i: 'rflevels',        x: 0, y: 4, w: 1, h: 1, minW: 1, minH: 1, panelType: 'rflevels' },
    { i: 'audio_feed',      x: 0, y: 5, w: 1, h: 1, minW: 1, minH: 1, panelType: 'audio_feed' },
    { i: 'video_feed',      x: 0, y: 6, w: 1, h: 1, minW: 1, minH: 1, panelType: 'video_feed' },
    { i: 'spots_combo',     x: 0, y: 7, w: 1, h: 1, minW: 1, minH: 1, panelType: 'spots_combo' },
    { i: 'solar',           x: 0, y: 8, w: 1, h: 1, minW: 1, minH: 1, panelType: 'solar' },
    { i: 'mufmap',          x: 0, y: 9, w: 1, h: 1, minW: 1, minH: 1, panelType: 'mufmap' },
  ],
};

const DEFAULT_LAYOUT: LayoutConfig = {
  compact: DEFAULT_COMPACT_LAYOUT,
  phone: DEFAULT_PHONE_LAYOUT,
};

function loadFromStorage(storageKey: string): LayoutConfig | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const config = JSON.parse(raw) as LayoutConfig;
    const hasLegacyPanel = (items: { panelType?: string }[]) =>
      items.some(item => item.panelType === 'videoaudio');
    if (hasLegacyPanel(config.compact.items) || hasLegacyPanel(config.phone.items)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return config;
  } catch {
    return null;
  }
}

function saveToStorage(storageKey: string, config: LayoutConfig): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(config));
  } catch {
    // ignore
  }
}

// Reset MufMapPanel's saved pan/zoom + tab selection so re-adding the panel starts fresh.
function clearMufMapState(callsign: string): void {
  try {
    localStorage.removeItem(mufMapStorageKey(callsign));
  } catch {
    // ignore
  }
}

export function useLayoutConfig(callsign = "") {
  const storageKey = callsign
    ? `${callsign.toUpperCase()}:${BASE_STORAGE_KEY}`
    : BASE_STORAGE_KEY;
  const [config, setConfig] = useState<LayoutConfig>(() => loadFromStorage(storageKey) ?? DEFAULT_LAYOUT);

  const setCompactLayout = useCallback((layout: ViewLayout) => {
    setConfig(prev => {
      const next = { ...prev, compact: layout };
      saveToStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const setPhoneLayout = useCallback((layout: ViewLayout) => {
    setConfig(prev => {
      const next = { ...prev, phone: layout };
      saveToStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const addPanel = useCallback((view: 'compact' | 'phone', panelType: PanelType, config?: PanelAddConfig) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const mins = PANEL_MIN_SIZES[panelType];
      const isFullWidth = config?.fullWidth ?? false;
      // Placement in a specific column (measured from real rendered column
      // heights by the caller) only applies to per-column compact panels;
      // full-width panels and phone view keep the original append-at-end behavior.
      const useColumnPlacement = view === 'compact' && !isFullWidth && config?.targetX !== undefined;
      const x = useColumnPlacement ? config!.targetX! : 0;
      const y = useColumnPlacement
        ? viewLayout.items
            .filter(item => item.x === x && item.w < viewLayout.cols)
            .reduce((max, item) => Math.max(max, item.y + item.h), 0)
        : viewLayout.items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
      const newItem: GridItem = {
        i: `${panelType}-${Date.now()}`,
        x,
        y,
        w: isFullWidth ? 9999 : (mins?.minW ?? 1),
        h: mins?.minH ?? 1,
        minW: mins?.minW ?? 1,
        minH: mins?.minH ?? 1,
        panelType,
        ...(config?.heightPx !== undefined && { heightPx: config.heightPx }),
        ...(config?.fullWidth !== undefined && { fullWidth: config.fullWidth }),
      };
      const next = { ...prev, [view]: { ...viewLayout, items: [...viewLayout.items, newItem] } };
      saveToStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const removePanel = useCallback((view: 'compact' | 'phone', itemId: string) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const removedItem = viewLayout.items.find(i => i.i === itemId);
      if (removedItem?.panelType === 'mufmap') clearMufMapState(callsign);
      const next = { ...prev, [view]: { ...viewLayout, items: viewLayout.items.filter(i => i.i !== itemId) } };
      saveToStorage(storageKey, next);
      return next;
    });
  }, [callsign]);

  const setGridSize = useCallback((view: 'compact' | 'phone', cols: number, rows: number) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const oldCols = viewLayout.cols;
      const clampedItems = viewLayout.items
        .filter(item => item.x < cols && item.y < rows)
        .map(item => ({
          ...item,
          // Full-width items keep their (large) w so they stay full-width
          // regardless of how many columns the grid is resized to.
          w: item.w >= oldCols ? item.w : Math.min(item.w, cols - item.x),
          h: Math.min(item.h, rows - item.y),
        }));
      const next = { ...prev, [view]: { ...viewLayout, cols, rows, items: clampedItems } };
      saveToStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const updateItemPositions = useCallback((view: 'compact' | 'phone', updatedItems: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const posMap = new Map(updatedItems.map(u => [u.i, u]));
      const mergedItems = viewLayout.items.map(item => {
        const update = posMap.get(item.i);
        return update ? { ...item, x: update.x, y: update.y, w: update.w, h: update.h } : item;
      });
      const next = { ...prev, [view]: { ...viewLayout, items: mergedItems } };
      saveToStorage(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const resetToDefault = useCallback((view?: 'compact' | 'phone') => {
    setConfig(prev => {
      const views: ('compact' | 'phone')[] = view ? [view] : ['compact', 'phone'];
      if (views.some(v => prev[v].items.some(item => item.panelType === 'mufmap'))) {
        clearMufMapState(callsign);
      }
      const next = view ? { ...DEFAULT_LAYOUT, [view]: DEFAULT_LAYOUT[view] } : DEFAULT_LAYOUT;
      saveToStorage(storageKey, next);
      return next;
    });
  }, [callsign]);

  return {
    compactLayout: config.compact,
    phoneLayout: config.phone,
    setCompactLayout,
    setPhoneLayout,
    addPanel,
    removePanel,
    setGridSize,
    updateItemPositions,
    resetToDefault,
  };
}
