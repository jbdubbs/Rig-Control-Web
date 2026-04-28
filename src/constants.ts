import type { RigStatus } from "./types";

export const POTA_BANDS: { label: string; min: number; max: number }[] = [
  { label: '6M',   min:  50000, max:  52000 },
  { label: '10M',  min:  29000, max:  30000 },
  { label: '12M',  min:  24000, max:  25000 },
  { label: '15M',  min:  21000, max:  22000 },
  { label: '17M',  min:  18000, max:  19000 },
  { label: '20M',  min:  14000, max:  15000 },
  { label: '30M',  min:  10000, max:  11000 },
  { label: '40M',  min:   7000, max:   8000 },
  { label: '60M',  min:   5000, max:   6000 },
  { label: '80M',  min:   3000, max:   4000 },
  { label: '160M', min:   1000, max:   2000 },
  { label: '144',  min: 144000, max: 148000 },
  { label: '220',  min: 219000, max: 225000 },
  { label: '440',  min: 430000, max: 450000 },
];

export const MODES_FALLBACK = [
  "USB", "LSB", "CW", "AM", "FM", "RTTY"
];

export const VOICE_MODES = new Set([
  "LSB", "USB", "PKTUSB", "PKTLSB", "AM", "AMN", "FM", "FMN", "FM-D", "PKTFMN"
]);

export const BANDWIDTHS = [300, 500, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3200, 3500, 4000];

export const VFO_STEPS = [0.00001, 0.0001, 0.001, 0.003, 0.01, 0.1];

export const DEFAULT_STATUS: RigStatus = {
  frequency: "14074000",
  mode: "USB",
  bandwidth: "2400",
  ptt: false,
  smeter: -54,
  swr: 1.0,
  rfpower: 0.5,
  vfo: "VFOA",
  isSplit: false,
  txVFO: "VFOB",
  rfLevel: 0,
  agc: 6,
  attenuation: 0,
  preamp: 0,
  nb: false,
  nbLevel: 0,
  nr: false,
  nrLevel: 0.5,
  anf: false,
  tuner: false,
  alc: 0,
  powerMeter: 0,
  vdd: 13.8,
  timestamp: Date.now()
};

export const CW_SETTINGS_DEFAULTS = {
  enabled: false,
  keyerPort: "",
  keyingMethod: "dtr" as "dtr" | "rts" | "rigctld-ptt",
  serialKeyPolarity: "high" as "high" | "low",
  mode: "iambic-a" as "iambic-a" | "iambic-b" | "straight",
  wpm: 18,
  sidetoneHz: 700,
  sidetoneVolume: 0.5,
  sidetoneEnabled: true,
  ditKey: "ControlLeft",
  dahKey: "ControlRight",
  straightKey: "Space"
};
