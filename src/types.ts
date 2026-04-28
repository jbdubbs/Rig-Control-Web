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
  nbLevelRange: { min: number; max: number; step: number };
  nrSupported: boolean;
  nrLevelRange: { min: number; max: number; step: number };
  rfPowerRange: { min: number; max: number; step: number };
  anfSupported: boolean;
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
  range: CapabilityRange;
}

export interface NrCapabilities {
  supported: boolean;
  range: CapabilityRange;
}

export interface AnfCapabilities {
  supported: boolean;
}

export interface RfPowerCapabilities {
  range: CapabilityRange;
}
