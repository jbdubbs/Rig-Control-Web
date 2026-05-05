export interface PanelAddConfig {
  heightPx?: number;
  fullWidth?: boolean;
}

export interface PanelConfigOptions {
  hasHeightSlider?: boolean;
  defaultHeightPx?: number;
  hasFullWidth?: boolean;
  defaultFullWidth?: boolean;
}

export const PANEL_CONFIG_OPTIONS: Partial<Record<string, PanelConfigOptions>> = {
  mufmap: {
    hasHeightSlider: true,
    defaultHeightPx: 400,
    hasFullWidth: true,
    defaultFullWidth: true,
  },
};

export type PanelType =
  | 'vfo'
  | 'smeter'
  | 'videoaudio'
  | 'controls'
  | 'rflevels'
  | 'swr'
  | 'alc'
  | 'modebw'
  | 'cwdecode'
  | 'commandconsole'
  | 'spots_pota'
  | 'spots_sota'
  | 'spots_wwff'
  | 'spots_combo'
  | 'solar'
  | 'mufmap';

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
  videoaudio: 'Video & Audio',
  controls: 'Controls',
  rflevels: 'RF Levels',
  swr: 'SWR',
  alc: 'ALC',
  modebw: 'Mode / BW',
  cwdecode: 'CW Decoder',
  commandconsole: 'Command Console',
  spots_pota: 'POTA Spots',
  spots_sota: 'SOTA Spots',
  spots_wwff: 'WWFF Spots',
  spots_combo: 'All Spots',
  solar: 'Solar Conditions',
  mufmap: 'MUF Map',
};

export const PANEL_MIN_SIZES: Partial<Record<PanelType, { minW: number; minH: number }>> = {
  vfo: { minW: 2, minH: 1 },
  videoaudio: { minW: 1, minH: 1 },
  commandconsole: { minW: 1, minH: 1 },
  mufmap: { minW: 1, minH: 1 },
};

export interface GridLayoutCallbacks {
  onExitEditMode: () => void;
  addPanel: (panelType: PanelType, config?: PanelAddConfig) => void;
  removePanel: (itemId: string) => void;
  setGridSize: (cols: number, rows: number) => void;
  updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  resetToDefault: () => void;
}
