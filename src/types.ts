export interface PotaSpot {
  spotId: number;
  spotTime: string;
  activator: string;
  frequency: number;
  mode: string;
  reference: string;
  name: string;
  locationDesc: string;
  spotter: string;
  source: string;
  comments: string;
}

export interface SotaSpot {
  id: number;
  activatorCallsign: string;
  frequency: string;
  mode: string;
  associationCode: string;
  summitCode: string;
  timeStamp: string;
}

export interface WwffSpot {
  id: number;
  activator: string;
  frequency_khz: number;
  mode: string;
  reference: string;
  reference_name: string;
  remarks: string;
  spotter: string;
  latitude: number;
  longitude: number;
  spot_time: number;
  spot_time_formatted: string;
}

export interface DxSpot {
  id: string;
  spotTime: number; // epoch ms
  spotter: string;
  dxCall: string;
  frequency: number; // kHz
  comment: string;
}

export interface RigStatus {
  frequency: string;
  mode: string;
  bandwidth: string;
  ptt: boolean;
  smeter: number;
  swr: number;
  rfpower: number;
  vfo: string;
  isSplit: boolean;
  txVFO: string;
  rfLevel: number;
  agc: number;
  attenuation: number;
  preamp: number;
  nb: boolean;
  nbLevel: number;
  nr: boolean;
  nrLevel: number;
  anf: boolean;
  tuner: boolean;
  alc: number;
  powerMeter: number;
  vdd: number;
  powerState: 'on' | 'off' | 'unknown';
  powerPending: boolean;
  timestamp: number;
}

export interface CwSettings {
  enabled: boolean;
  keyerPort: string;
  keyingMethod: "dtr" | "rts" | "rigctld-ptt";
  serialKeyPolarity: "high" | "low";
  mode: "iambic-a" | "iambic-b" | "straight";
  wpm: number;
  sidetoneHz: number;
  sidetoneVolume: number;
  sidetoneEnabled: boolean;
  ditKey: string;
  dahKey: string;
  straightKey: string;
}

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
}

export interface VideoSettings {
  device: string;
  videoWidth: number;
  videoHeight: number;
  framerate: string;
}

export interface RigctldSettings {
  rigNumber: string;
  serialPort: string;
  portNumber: string;
  ipAddress: string;
  serialPortSpeed: string;
  preampCapabilities: string[];
  attenuatorCapabilities: string[];
  agcCapabilities: string[];
  nbSupported: boolean;
  nbLevelSupported: boolean;
  nbLevelRange: { min: number; max: number; step: number };
  nrSupported: boolean;
  nrLevelSupported: boolean;
  nrLevelRange: { min: number; max: number; step: number };
  rfLevelSupported: boolean;
  rfLevelRange: { min: number; max: number; step: number };
  rfPowerRange: { min: number; max: number; step: number };
  anfSupported: boolean;
  pttType: "rig" | "dtr" | "rts" | "none";
  pttKey: string;
}

export interface ConsoleLog {
  cmd: string;
  resp: string;
  time: string;
}

export interface CapabilityRange {
  min: number;
  max: number;
  step: number;
}

export interface NbCapabilities {
  supported: boolean;
  levelSupported: boolean;
  range: CapabilityRange;
}

export interface NrCapabilities {
  supported: boolean;
  levelSupported: boolean;
  range: CapabilityRange;
}

export interface AnfCapabilities {
  supported: boolean;
}

export interface RfPowerCapabilities {
  range: CapabilityRange;
}

export interface RfLevelCapabilities {
  supported: boolean;
  range: CapabilityRange;
}

export interface SpectrumData {
  id: number;
  name: string;
  type: "FIXED" | "CENTER";
  length: number;
  amplitudes: number[];
  minLevel: number;
  maxLevel: number;
  centerFreq: number;
  span: number;
  lowFreq: number;
  highFreq: number;
  timestamp: number;
}

export interface SpectrumSettings {
  enabled: boolean;
  source: "hamlib" | "ft4222" | "iq";
  multicastAddr: string;
  multicastPort: number;
  ft4222SpanIndex: number;
  iqAudioDevice: string;
  iqSampleRate: number;
  iqSwapChannels: boolean;
}

export interface DebugFlags {
  rig: boolean;
  audio: boolean;
  video: boolean;
  cw: boolean;
  infra: boolean;
  spectrum: boolean;
  spots: boolean;
  dxcluster: boolean;
  wsjtx: boolean;
  ft8: boolean;
}
