import net from "net";
import dgram from "dgram";
import { Server } from "socket.io";
import { ChildProcess } from "child_process";
import type { AuthenticatedSocket } from "./authTypes.ts";

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

export interface DxSpot {
  id: string;
  spotTime: number;
  spotter: string;
  dxCall: string;
  frequency: number;
  comment: string;
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
  /** Overrides the default 10s per-command timeout — used for power-on-transition commands,
   *  which can legitimately take much longer to ack while the radio is mid-boot. */
  timeoutMs?: number;
}

export interface ServerContext {
  io: Server;
  baseDir: string;
  dataDir: string;

  // Auth
  jwtSecret: string;
  authenticatedSockets: Map<string, AuthenticatedSocket>;
  serverStartTime: number;

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
  };
  audioSettings: {
    inputDevice: string;
    outputDevice: string;
    inboundEnabled: boolean;
    outboundEnabled: boolean;
    backendLockedToAdmin: boolean;
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
  wwffSettings: { enabled: boolean; pollRate: number; maxAge: number };
  dxClusterSettings: {
    enabled: boolean;
    host: string;
    port: number;
    loginCallsign: string;
    maxAge: number;
    callsignFilter: string[];
    keywordFilter: string[];
    bandFilter: string[];
  };
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
  autoReconnect: boolean;
  autoReconnectStartedAt: number | null;
  vfoSupported: boolean;
  powerSupported: boolean;
  powerState: 'on' | 'off' | 'unknown';
  powerOpInProgress: boolean;
  lastPowerCheck: number;
  /** Consecutive get_powerstat failures (RPRT error or command timeout) while polling a
   *  powered-off radio. A radio whose serial link never recovers can drive rigctld itself
   *  into a crash after enough of these (observed in the field as a Windows heap-corruption
   *  exit); once this crosses POWER_OFF_PROBE_FAILURE_LIMIT, pollRig proactively restarts
   *  rigctld rather than waiting for it to die on its own. Reset to 0 on any successful probe
   *  response and whenever a fresh power-off period begins. */
  powerOffProbeFailureCount: number;
  audioWasPlaying: boolean;
  /** One-shot flag: set when a connect restores a persisted "radio was off at last
   *  exit" state and skips the initial capability probes (which would otherwise
   *  hang against an unresponsive radio). Consumed by onPowerOn() to run the
   *  deferred probeVfoCapability/probeCapabilities once the radio actually answers. */
  pendingCapabilityProbe: boolean;
  /** Computed once per fresh (non-auto) connect request: does the persisted power-off
   *  file match the currently configured rig? Threaded into every "rig-connecting" event
   *  for the duration of that connection attempt sequence so the frontend can suppress the
   *  generic reconnect spinner when the radio is already known to be powered off. */
  knownPoweredOff: boolean;
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
    powerState: 'on' | 'off' | 'unknown';
    powerPending: boolean;
    timestamp?: number;
  };
  visibleMeters: string[];
  pollCycleCount: number;
  pollingTimeout: NodeJS.Timeout | null;
  rigCommandQueue: RigCommandEntry[];
  isRigBusy: boolean;
  pendingQuickPolls: Set<string>;

  // Rigctld process state
  rigctldProcess: ChildProcess | null;
  rigctldStatus: "running" | "stopped" | "error" | "already_running";
  rigctldVersion: string | null;
  isRigctldVersionSupported: boolean;
  rigctldLogs: string[];
  /** True while an auto-recovery restart of rigctld (crash detected, or proactive restart
   *  after repeated get_powerstat failures) is in flight. Guards against the two independent
   *  recovery paths in rigComm.ts racing each other into a double-spawn. */
  rigctldRespawnInFlight: boolean;

  // Diagnostics log (Diagnostics settings tab): merged server console output
  // plus forwarded browser/Electron-renderer console output. Rolling window
  // — see MAX_AGE_MS in server/diagnostics.ts. diagnosticsLogTimestamps is a
  // parallel array (push epoch ms, one per diagnosticsLog entry, same index)
  // used to prune by age.
  diagnosticsLog: string[];
  diagnosticsLogTimestamps: number[];

  // Audio engine state
  portAudio: any;
  libopus: any;
  audioInputProcess: any;
  audioOutputProcess: any;
  opusEncoder: any;
  opusDecoder: any;
  audioStatus: "playing" | "stopped" | "cooldown";
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
  cwLastSentElement: "dit" | "dah" | null;
  cwElementEndMs: number;
  cwKeyIsDown: boolean;
  cwBufferReady: boolean;
  cwTickTimer: ReturnType<typeof setTimeout> | null;
  cwClaimIdleTimer: ReturnType<typeof setTimeout> | null;

  // Per-socket connection timestamps (used by CW jitter buffer)
  socketConnectTimes: Map<string, number>;

  // Spectrum scope
  spectrumSettings: {
    enabled: boolean;
    source: "hamlib" | "ft4222" | "iq";
    multicastAddr: string;
    multicastPort: number;
    ft4222SpanIndex: number;
    iqAudioDevice: string;
    iqSampleRate: number;
    iqSwapChannels: boolean;
  };
  spectrumSocket: dgram.Socket | null;
  spectrumSupported: boolean;
  yaesuScopeProcess: ChildProcess | null;
  yaesuScopeRunning: boolean;
  yaesuScopeError: string | null;
  yaesuScopeRestartTimer: NodeJS.Timeout | null;
  yaesuScopeRetryStartedAt: number | null;

  // I/Q audio spectrum scope (Xiegu G90 and similar radios with a baseband
  // I/Q output, captured via a stereo USB audio interface). Unlike the
  // FT4222 path this drives naudiodon directly in-process rather than
  // spawning a child binary.
  iqCaptureProcess: any;
  iqScopeRunning: boolean;
  iqScopeError: string | null;

  // DX cluster (telnet feed of manually-spotted DX stations — server-owned,
  // login-identified TCP connection, unlike the browser-polled POTA/SOTA/WWFF
  // HTTP APIs; see server/dxCluster.ts)
  dxSpotBuffer: DxSpot[];
  dxClusterSocket: net.Socket | null;
  dxClusterConnected: boolean;
  dxClusterError: string | null;
  dxClusterRestartTimer: NodeJS.Timeout | null;
  /** Start of the current 60s connection-attempt budget window (see
   *  DX_CLUSTER_MAX_ATTEMPTS in dxCluster.ts) — not a per-attempt timestamp. */
  dxClusterRetryStartedAt: number | null;
  /** Connection attempts made within the current window. Reset on a
   *  successful login and on explicit stop (user disables/re-enables). */
  dxClusterAttemptCount: number;
  dxClusterLoggedIn: boolean;

  // Cross-module callbacks (wired in orchestrator after modules init)
  saveSettings: () => void;
  sendToRig: (cmd: string, useExtended?: boolean, priority?: boolean) => Promise<string>;
}

export function createInitialContext(io: Server, baseDir: string, dataDir: string): ServerContext {
  return {
    io,
    baseDir,
    dataDir,

    jwtSecret: "",
    authenticatedSockets: new Map(),
    serverStartTime: Date.now(),

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
      nbLevelSupported: false,
      nbLevelRange: { min: 0, max: 1, step: 0.1 },
      nrSupported: false,
      nrLevelSupported: false,
      nrLevelRange: { min: 0, max: 1, step: 0.1 },
      rfLevelSupported: false,
      rfLevelRange: { min: 0, max: 1, step: 0.1 },
      rfPowerRange: { min: 0, max: 1, step: 0.01 },
      anfSupported: false,
      pttType: "rig",
      pttKey: "AltLeft",
    },
    audioSettings: {
      inputDevice: "",
      outputDevice: "",
      inboundEnabled: false,
      outboundEnabled: false,
      backendLockedToAdmin: false,
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
    wwffSettings: { enabled: false, pollRate: 5, maxAge: 15 },
    dxClusterSettings: {
      enabled: false,
      host: "w3lpl.net",
      port: 7373,
      loginCallsign: "",
      maxAge: 30,
      callsignFilter: [],
      keywordFilter: [],
      bandFilter: [],
    },
    solarData: null,

    pollRate: 2000,
    autoStartEnabled: false,
    videoAutoStart: false,
    autoconnectEligible: false,
    clientHost: "127.0.0.1",
    clientPort: 4532,

    rigSocket: null,
    isConnected: false,
    autoReconnect: false,
    autoReconnectStartedAt: null,
    vfoSupported: true,
    powerSupported: false,
    powerState: 'unknown',
    powerOpInProgress: false,
    lastPowerCheck: 0,
    powerOffProbeFailureCount: 0,
    audioWasPlaying: false,
    pendingCapabilityProbe: false,
    knownPoweredOff: false,
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
      powerState: 'unknown',
      powerPending: false,
    },
    visibleMeters: ["swr", "alc"],
    pollCycleCount: 0,
    pollingTimeout: null,
    rigCommandQueue: [],
    isRigBusy: false,
    pendingQuickPolls: new Set(),

    rigctldProcess: null,
    rigctldStatus: "stopped",
    rigctldVersion: null,
    isRigctldVersionSupported: true,
    rigctldLogs: [],
    rigctldRespawnInFlight: false,
    diagnosticsLog: [],
    diagnosticsLogTimestamps: [],

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
    cwLastSentElement: null,
    cwElementEndMs: 0,
    cwKeyIsDown: false,
    cwBufferReady: false,
    cwTickTimer: null,
    cwClaimIdleTimer: null,

    socketConnectTimes: new Map(),

    spectrumSettings: {
      enabled: false,
      source: "hamlib",
      multicastAddr: "224.0.0.1",
      multicastPort: 4531,
      ft4222SpanIndex: 5,
      iqAudioDevice: "",
      iqSampleRate: 48000,
      iqSwapChannels: false,
    },
    spectrumSocket: null,
    spectrumSupported: false,
    yaesuScopeProcess: null,
    yaesuScopeRunning: false,
    yaesuScopeError: null,
    yaesuScopeRestartTimer: null,
    yaesuScopeRetryStartedAt: null,

    iqCaptureProcess: null,
    iqScopeRunning: false,
    iqScopeError: null,

    dxSpotBuffer: [],
    dxClusterSocket: null,
    dxClusterConnected: false,
    dxClusterError: null,
    dxClusterRestartTimer: null,
    dxClusterRetryStartedAt: null,
    dxClusterAttemptCount: 0,
    dxClusterLoggedIn: false,

    saveSettings: () => {},
    sendToRig: () => Promise.reject("sendToRig not yet initialized"),
  };
}
