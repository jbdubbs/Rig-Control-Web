export interface PanelAddConfig {
  heightPx?: number;
  fullWidth?: boolean;
  targetX?: number;
}

export interface PanelConfigOptions {
  hasHeightSlider?: boolean;
  defaultHeightPx?: number;
  hasFullWidth?: boolean;
  defaultFullWidth?: boolean;
}

export const PANEL_CONFIG_OPTIONS: Partial<Record<string, PanelConfigOptions>> = {
  vfo: {
    hasFullWidth: true,
    defaultFullWidth: true,
  },
  mufmap: {
    hasHeightSlider: true,
    defaultHeightPx: 200,
  },
  spectrum_hamlib: {
    hasHeightSlider: true,
    defaultHeightPx: 200,
    hasFullWidth: true,
    defaultFullWidth: false,
  },
  spectrum_audio: {
    hasHeightSlider: true,
    defaultHeightPx: 200,
  },
  ft8decode: {
    hasFullWidth: true,
    defaultFullWidth: false,
  },
};

// localStorage key for MufMapPanel's saved pan/zoom + tab selection.
// Cleared by useLayoutConfig when the mufmap panel is removed/reset, so
// re-adding the panel always starts from defaults.
export const MUFMAP_STORAGE_KEY = 'mufmap-view-v1';

export function mufMapStorageKey(callsign: string): string {
  return callsign ? `${callsign.toUpperCase()}:${MUFMAP_STORAGE_KEY}` : MUFMAP_STORAGE_KEY;
}

export type PanelType =
  | 'vfo'
  | 'smeter'
  | 'video_feed'
  | 'audio_feed'
  | 'controls'
  | 'rflevels'
  | 'swr'
  | 'alc'
  | 'modebw'
  | 'cwdecode'
  | 'ft8decode'
  | 'commandconsole'
  | 'spots_pota'
  | 'spots_sota'
  | 'spots_wwff'
  | 'spots_dx'
  | 'spots_combo'
  | 'solar'
  | 'mufmap'
  | 'spectrum_hamlib'
  | 'spectrum_audio';

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  panelType?: PanelType;
  isPlaceholder?: boolean;
  heightPx?: number;
  fullWidth?: boolean;
}

export interface ViewLayout {
  cols: number;
  rows: number;
  items: GridItem[];
}

export interface LayoutConfig {
  compact: ViewLayout;
  phone: ViewLayout;
}

export const PANEL_LABELS: Record<PanelType, string> = {
  vfo: 'VFO',
  smeter: 'Signal Meter',
  video_feed: 'Video Feed',
  audio_feed: 'Audio Feed',
  controls: 'Controls',
  rflevels: 'RF Levels',
  swr: 'SWR',
  alc: 'ALC',
  modebw: 'Mode / BW',
  cwdecode: 'CW Decoder',
  ft8decode: 'FT8 Decoder',
  commandconsole: 'Command Console',
  spots_pota: 'POTA Spots',
  spots_sota: 'SOTA Spots',
  spots_wwff: 'WWFF Spots',
  spots_dx: 'DX Cluster',
  spots_combo: 'All Spots',
  solar: 'Solar Conditions',
  mufmap: 'MUF Map',
  spectrum_hamlib: 'Spectrum Scope',
  spectrum_audio: 'Audio Waterfall',
};

export const PANEL_MIN_SIZES: Partial<Record<PanelType, { minW: number; minH: number }>> = {
  vfo: { minW: 2, minH: 1 },
  video_feed: { minW: 1, minH: 1 },
  audio_feed: { minW: 1, minH: 1 },
  commandconsole: { minW: 1, minH: 1 },
  mufmap: { minW: 1, minH: 1 },
  spectrum_hamlib: { minW: 1, minH: 2 },
  spectrum_audio: { minW: 1, minH: 2 },
};

export interface GridLayoutCallbacks {
  onExitEditMode: () => void;
  addPanel: (panelType: PanelType, config?: PanelAddConfig) => void;
  removePanel: (itemId: string) => void;
  setGridSize: (cols: number, rows: number) => void;
  updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  resetToDefault: () => void;
}
