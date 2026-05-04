import net from "net";
import { Server } from "socket.io";
import { ChildProcess } from "child_process";

export interface HfBandCondition {
  name: string;
  day: string;
  night: string;
}

export interface VhfCondition {
  name: string;
  location: string;
  condition: string;
}

export interface SolarData {
  updated: string;
  solarflux: number;
  sunspots: number;
  aindex: number;
  kindex: number;
  xray: string;
  signalnoise: string;
  geomagfield: string;
  solarwind: number;
  magneticfield: number;
  aurora: number;
  protonflux: number;
  electonflux: number;
  esfi: number | null;
  essn: number | null;
  hfBands: HfBandCondition[];
  vhfConditions: VhfCondition[];
  fetchedAt: number;
}

export interface CwPaddleEvent {
  t: number;
  dit: boolean;
  dah: boolean;
  straight: boolean;
}

export interface RigCommandEntry {
  cmd: string;
  useExtended: boolean;
  resolve: (val: string) => void;
  reject: (err: any) => void;
}

export interface ServerContext {
  io: Server;
  baseDir: string;
  dataDir: string;

  // Settings sub-objects
  rigctldSettings: {
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
  };
  audioSettings: {
    inputDevice: string;
    outputDevice: string;
    inboundEnabled: boolean;
    outboundEnabled: boolean;
  };
  videoSettings: {
    device: string;
    videoWidth: number;
    videoHeight: number;
    framerate: string;
  };
  cwSettings: {
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
  };
  potaSettings: { enabled: boolean; pollRate: number; maxAge: number };
  sotaSettings: { enabled: boolean; pollRate: number; maxAge: number };
  solarData: SolarData | null;

  // General settings
  pollRate: number;
  autoStartEnabled: boolean;
  videoAutoStart: boolean;
  autoconnectEligible: boolean;
  clientHost: string;
  clientPort: number;

  // Rig connection state
  rigSocket: net.Socket | null;
  isConnected: boolean;
  vfoSupported: boolean;
  rigConfig: { host: string; port: number };
  lastStatus: {
    frequency: string;
    mode: string;
    bandwidth: string;
    ptt: boolean;
    smeter: number;
    swr: number;
    alc: number;
    powerMeter: number;
    rfpower: number;
    rfLevel: number;
    agc: number;
    vdd: number;
    vfo: string;
    isSplit: boolean;
    txVFO: string;
    attenuation: number;
    preamp: number;
    nb: boolean;
    nbLevel: number;
    nr: boolean;
    nrLevel: number;
    anf: boolean;
    tuner: boolean;
    timestamp?: number;
  };
  visibleMeters: string[];
  pollCycleCount: number;
  pollingTimeout: NodeJS.Timeout | null;
  rigCommandQueue: RigCommandEntry[];
  isRigBusy: boolean;

  // Rigctld process state
  rigctldProcess: ChildProcess | null;
  rigctldStatus: "running" | "stopped" | "error" | "already_running";
  rigctldVersion: string | null;
  isRigctldVersionSupported: boolean;
  rigctldLogs: string[];

  // Audio engine state
  portAudio: any;
  libopus: any;
  audioInputProcess: any;
  audioOutputProcess: any;
  opusEncoder: any;
  opusDecoder: any;
  audioStatus: "playing" | "stopped";
  activeMicClientId: string | null;
  isAudioEngineReady: boolean;
  audioEngineError: string | null;
  outboundTimer: ReturnType<typeof setInterval> | null;
  outboundJitterBuffer: Buffer[];

  // Video state
  videoSourceSocketId: string | null;
  lastKeyframe: { data: Buffer; type: string; timestamp: number; description?: Buffer } | null;
  videoStatus: "streaming" | "stopped";
  videoDeviceList: { id: string; label: string }[];

  // CW keyer state
  cwKeyerProcess: ChildProcess | null;
  activeCwClientId: string | null;
  cwKeyLockedOut: boolean;
  cwStuckKeyTimer: ReturnType<typeof setTimeout> | null;
  cwIsKeying: boolean;
  cwIdleTimer: ReturnType<typeof setTimeout> | null;
  cwPaddleBuffer: CwPaddleEvent[];
  cwPlayheadDit: boolean;
  cwPlayheadDah: boolean;
  cwPlayheadStraight: boolean;
  cwMachine: "IDLE" | "SENDING_DIT" | "SENDING_DAH" | "INTER_ELEMENT";
  cwPendingElement: "dit" | "dah" | null;
  cwElementEndMs: number;
  cwKeyIsDown: boolean;
  cwBufferReady: boolean;
  cwTickTimer: ReturnType<typeof setTimeout> | null;
  cwClaimIdleTimer: ReturnType<typeof setTimeout> | null;

  // Per-socket connection timestamps (used by CW jitter buffer)
  socketConnectTimes: Map<string, number>;

  // Cross-module callbacks (wired in orchestrator after modules init)
  saveSettings: () => void;
  sendToRig: (cmd: string, useExtended?: boolean, priority?: boolean) => Promise<string>;
}

export function createInitialContext(io: Server, baseDir: string, dataDir: string): ServerContext {
  return {
    io,
    baseDir,
    dataDir,

    rigctldSettings: {
      rigNumber: "",
      serialPort: "",
      portNumber: "4532",
      ipAddress: "127.0.0.1",
      serialPortSpeed: "38400",
      preampCapabilities: [],
      attenuatorCapabilities: [],
      agcCapabilities: [],
      nbSupported: false,
      nbLevelRange: { min: 0, max: 1, step: 0.1 },
      nrSupported: false,
      nrLevelRange: { min: 0, max: 1, step: 0.1 },
      rfPowerRange: { min: 0, max: 1, step: 0.01 },
      anfSupported: false,
    },
    audioSettings: {
      inputDevice: "",
      outputDevice: "",
      inboundEnabled: false,
      outboundEnabled: false,
    },
    videoSettings: {
      device: "",
      videoWidth: 640,
      videoHeight: 480,
      framerate: "",
    },
    cwSettings: {
      enabled: false,
      keyerPort: "",
      keyingMethod: "dtr",
      serialKeyPolarity: "high",
      mode: "iambic-a",
      wpm: 18,
      sidetoneHz: 700,
      sidetoneVolume: 0.5,
      sidetoneEnabled: true,
      ditKey: "ControlLeft",
      dahKey: "ControlRight",
      straightKey: "Space",
    },
    potaSettings: { enabled: false, pollRate: 5, maxAge: 15 },
    sotaSettings: { enabled: false, pollRate: 5, maxAge: 15 },
    solarData: null,

    pollRate: 2000,
    autoStartEnabled: false,
    videoAutoStart: false,
    autoconnectEligible: false,
    clientHost: "127.0.0.1",
    clientPort: 4532,

    rigSocket: null,
    isConnected: false,
    vfoSupported: true,
    rigConfig: { host: "", port: 0 },
    lastStatus: {
      frequency: "14074000",
      mode: "USB",
      bandwidth: "2400",
      ptt: false,
      smeter: -54,
      swr: 1.0,
      alc: 0,
      powerMeter: 0,
      rfpower: 0.5,
      rfLevel: 0,
      agc: 6,
      vdd: 13.8,
      vfo: "VFOA",
      isSplit: false,
      txVFO: "VFOB",
      attenuation: 0,
      preamp: 0,
      nb: false,
      nbLevel: 0,
      nr: false,
      nrLevel: 8 / 15,
      anf: false,
      tuner: false,
    },
    visibleMeters: ["swr", "alc"],
    pollCycleCount: 0,
    pollingTimeout: null,
    rigCommandQueue: [],
    isRigBusy: false,

    rigctldProcess: null,
    rigctldStatus: "stopped",
    rigctldVersion: null,
    isRigctldVersionSupported: true,
    rigctldLogs: [],

    portAudio: null,
    libopus: null,
    audioInputProcess: null,
    audioOutputProcess: null,
    opusEncoder: null,
    opusDecoder: null,
    audioStatus: "stopped",
    activeMicClientId: null,
    isAudioEngineReady: false,
    audioEngineError: null,
    outboundTimer: null,
    outboundJitterBuffer: [],

    videoSourceSocketId: null,
    lastKeyframe: null,
    videoStatus: "stopped",
    videoDeviceList: [],

    cwKeyerProcess: null,
    activeCwClientId: null,
    cwKeyLockedOut: false,
    cwStuckKeyTimer: null,
    cwIsKeying: false,
    cwIdleTimer: null,
    cwPaddleBuffer: [],
    cwPlayheadDit: false,
    cwPlayheadDah: false,
    cwPlayheadStraight: false,
    cwMachine: "IDLE",
    cwPendingElement: null,
    cwElementEndMs: 0,
    cwKeyIsDown: false,
    cwBufferReady: false,
    cwTickTimer: null,
    cwClaimIdleTimer: null,

    socketConnectTimes: new Map(),

    saveSettings: () => {},
    sendToRig: () => Promise.reject("sendToRig not yet initialized"),
  };
}
