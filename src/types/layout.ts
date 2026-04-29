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
  | 'spots_sota';

export interface TabGroupConfig {
  panels: PanelType[];
  activeIndex: number;
}

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
  // Custom fields (preserved through react-grid-layout, ignored by the library)
  panelType?: PanelType;
  tabGroup?: TabGroupConfig;
  isPlaceholder?: boolean; // edit-mode empty-cell sentinel, never persisted
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
};

export const PANEL_MIN_SIZES: Partial<Record<PanelType, { minW: number; minH: number }>> = {
  vfo: { minW: 2, minH: 1 },
  videoaudio: { minW: 1, minH: 1 },
  commandconsole: { minW: 1, minH: 1 },
};

export interface GridLayoutCallbacks {
  onExitEditMode: () => void;
  addPanel: (panelType: PanelType) => void;
  removePanel: (itemId: string) => void;
  setGridSize: (cols: number, rows: number) => void;
  mergeIntoTabGroup: (targetId: string, sourceId: string) => void;
  removeFromTabGroup: (groupId: string, panelType: PanelType) => void;
  setTabGroupActiveIndex: (itemId: string, index: number) => void;
  updateItemPositions: (positions: Array<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  resetToDefault: () => void;
}
