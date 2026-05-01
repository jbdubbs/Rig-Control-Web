import { useState, useCallback } from 'react';
import type { LayoutConfig, ViewLayout, GridItem, PanelType } from '../types/layout';
import { PANEL_MIN_SIZES } from '../types/layout';


const STORAGE_KEY = 'grid-layout-v1';

export const DEFAULT_COMPACT_LAYOUT: ViewLayout = {
  cols: 2,
  rows: 4,
  items: [
    { i: 'vfo', x: 0, y: 0, w: 2, h: 1, minW: 2, minH: 1, panelType: 'vfo' },
    { i: 'smeter', x: 0, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'smeter' },
    { i: 'videoaudio', x: 1, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'videoaudio' },
    { i: 'controls', x: 0, y: 2, w: 1, h: 1, minW: 1, minH: 1, panelType: 'controls' },
    { i: 'rflevels', x: 1, y: 2, w: 1, h: 1, minW: 1, minH: 1, panelType: 'rflevels' },
    { i: 'commandconsole', x: 0, y: 3, w: 2, h: 1, minW: 1, minH: 1, panelType: 'commandconsole' },
  ],
};

export const DEFAULT_PHONE_LAYOUT: ViewLayout = {
  cols: 1,
  rows: 7,
  items: [
    { i: 'vfo', x: 0, y: 0, w: 1, h: 1, minW: 1, minH: 1, panelType: 'vfo' },
    { i: 'videoaudio', x: 0, y: 1, w: 1, h: 1, minW: 1, minH: 1, panelType: 'videoaudio' },
    { i: 'smeter', x: 0, y: 2, w: 1, h: 1, minW: 1, minH: 1, panelType: 'smeter' },
    { i: 'controls', x: 0, y: 3, w: 1, h: 2, minW: 1, minH: 1, panelType: 'controls' },
    { i: 'spots_pota', x: 0, y: 5, w: 1, h: 1, minW: 1, minH: 1, panelType: 'spots_pota' },
    { i: 'spots_sota', x: 0, y: 6, w: 1, h: 1, minW: 1, minH: 1, panelType: 'spots_sota' },
    { i: 'commandconsole', x: 0, y: 7, w: 1, h: 1, minW: 1, minH: 1, panelType: 'commandconsole' },
  ],
};

const DEFAULT_LAYOUT: LayoutConfig = {
  compact: DEFAULT_COMPACT_LAYOUT,
  phone: DEFAULT_PHONE_LAYOUT,
};

function loadFromStorage(): LayoutConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LayoutConfig;
  } catch {
    return null;
  }
}

function saveToStorage(config: LayoutConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function useLayoutConfig() {
  const [config, setConfig] = useState<LayoutConfig>(() => loadFromStorage() ?? DEFAULT_LAYOUT);

  const setCompactLayout = useCallback((layout: ViewLayout) => {
    setConfig(prev => {
      const next = { ...prev, compact: layout };
      saveToStorage(next);
      return next;
    });
  }, []);

  const setPhoneLayout = useCallback((layout: ViewLayout) => {
    setConfig(prev => {
      const next = { ...prev, phone: layout };
      saveToStorage(next);
      return next;
    });
  }, []);

  const addPanel = useCallback((view: 'compact' | 'phone', panelType: PanelType, cell?: { x: number; y: number }) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const mins = PANEL_MIN_SIZES[panelType];
      const newItem: GridItem = {
        i: `${panelType}-${Date.now()}`,
        x: cell?.x ?? 0,
        y: cell?.y ?? viewLayout.items.reduce((max, item) => Math.max(max, item.y + item.h), 0),
        w: mins?.minW ?? 1,
        h: mins?.minH ?? 1,
        minW: mins?.minW ?? 1,
        minH: mins?.minH ?? 1,
        panelType,
      };
      const next = { ...prev, [view]: { ...viewLayout, items: [...viewLayout.items, newItem] } };
      saveToStorage(next);
      return next;
    });
  }, []);

  const removePanel = useCallback((view: 'compact' | 'phone', itemId: string) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const next = { ...prev, [view]: { ...viewLayout, items: viewLayout.items.filter(i => i.i !== itemId) } };
      saveToStorage(next);
      return next;
    });
  }, []);

  const setGridSize = useCallback((view: 'compact' | 'phone', cols: number, rows: number) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const clampedItems = viewLayout.items
        .filter(item => item.x < cols && item.y < rows)
        .map(item => ({
          ...item,
          w: Math.min(item.w, cols - item.x),
          h: Math.min(item.h, rows - item.y),
        }));
      const next = { ...prev, [view]: { ...viewLayout, cols, rows, items: clampedItems } };
      saveToStorage(next);
      return next;
    });
  }, []);

  const updateItemPositions = useCallback((view: 'compact' | 'phone', updatedItems: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
    setConfig(prev => {
      const viewLayout = prev[view];
      const posMap = new Map(updatedItems.map(u => [u.i, u]));
      const mergedItems = viewLayout.items.map(item => {
        const update = posMap.get(item.i);
        return update ? { ...item, x: update.x, y: update.y, w: update.w, h: update.h } : item;
      });
      const next = { ...prev, [view]: { ...viewLayout, items: mergedItems } };
      saveToStorage(next);
      return next;
    });
  }, []);

  const resetToDefault = useCallback((view?: 'compact' | 'phone') => {
    setConfig(() => {
      const next = view ? { ...DEFAULT_LAYOUT, [view]: DEFAULT_LAYOUT[view] } : DEFAULT_LAYOUT;
      saveToStorage(next);
      return next;
    });
  }, []);

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
