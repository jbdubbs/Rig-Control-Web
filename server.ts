import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import net from "net";
import path from "path";
import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";


let electronWin: any = null;
export function setElectronWindow(win: any) {
  electronWin = win;
}

// Populated by startServer(); called from electron/main.ts on will-quit
let _shutdownAudio: (() => Promise<void>) | null = null;
export async function shutdown(): Promise<void> {
  if (_shutdownAudio) await _shutdownAudio();
}

export async function startServer(appPath?: string, userDataPath?: string) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    perMessageDeflate: false
  });
  const PORT = 3000;

  // appPath is for read-only bundled assets (like radios.json and dist/)
  // userDataPath is for writable user settings (settings.json)
  const baseDir = appPath || process.cwd();
  // In Cloud Run, the root is read-only, so use /tmp for settings
  const dataDir = userDataPath || (process.env.NODE_ENV === "production" ? "/tmp" : process.cwd());
  
  const SETTINGS_FILE = path.join(dataDir, "settings.json");
  const RADIOS_FILE = path.join(baseDir, "radios.json");
  
  console.log(`Server initializing. Base directory (assets): ${baseDir}`);
  console.log(`Data directory (settings): ${dataDir}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}, Electron: ${!!process.versions.electron}`);

  let rigctldProcess: ChildProcess | null = null;
  let rigctldStatus: "running" | "stopped" | "error" | "already_running" = "stopped";
  let rigctldVersion: string | null = null;
  let isRigctldVersionSupported = true;
  let rigctldLogs: string[] = [];
  let autoStartEnabled = false;
  let videoAutoStart = false;
  let videoSourceSocketId: string | null = null;
  let lastKeyframe: { data: Buffer; type: string; timestamp: number; description?: Buffer } | null = null;
  let pollRate = 2000;
  let autoconnectEligible = false;
  let clientHost = "127.0.0.1";
  let clientPort = 4532;
  
  const getRigctldPath = (): string => {
    let platformDir = "";
    if (process.platform === "win32") platformDir = "windows";
    else if (process.platform === "linux") platformDir = "linux";
    else if (process.platform === "darwin") platformDir = "mac";
    
    const binaryName = process.platform === "win32" ? "rigctld.exe" : "rigctld";
    
    // In production Electron builds, unpacked binaries are in app.asar.unpacked
    let binBase = baseDir;
    if (baseDir.endsWith(".asar")) {
      binBase = baseDir.replace(".asar", ".asar.unpacked");
    }
    
    const localPath = platformDir ? path.join(binBase, "bin", platformDir, binaryName) : "";
    
    if (localPath && fs.existsSync(localPath)) {
      console.log(`[HAMLIB] Using bundled rigctld at: ${localPath}`);
      return localPath;
    }
    
    console.log(`[HAMLIB] Bundled rigctld not found at ${localPath || "unsupported platform"}, falling back to system PATH`);
    return "rigctld";
  };

  let videoSettings = {
    device: "",
    videoWidth: 640,
    videoHeight: 480,
    framerate: ""
  };
  let videoStatus: "streaming" | "stopped" = "stopped";
  let videoDeviceList: { id: string; label: string }[] = [];
  
  let audioSettings = {
    inputDevice: "",
    outputDevice: "",
    inboundEnabled: false,
    outboundEnabled: false
  };
  let audioStatus: "playing" | "stopped" = "stopped";
  let activeMicClientId: string | null = null;
  let isAudioEngineReady = false;
  let audioEngineError: string | null = null;

  // Dynamic imports for audio
  let portAudio: any = null;
  let libopus: any = null;

  // Audio pipeline state
  let audioInputProcess: any = null; // naudiodon AudioIO (capture)
  let audioOutputProcess: any = null; // naudiodon AudioIO (playback)
  let opusEncoder: any = null; // libopus-node OpusEncoder
  let opusDecoder: any = null; // libopus-node OpusEncoder (used for decoding)

  // Outbound audio state
  const OUTBOUND_SILENCE = Buffer.alloc(960 * 2); // one silence frame (Int16 mono)
  const OUTBOUND_PRE_FILL = 3;  // silence frames written at startup to prime the hardware buffer
  const OUTBOUND_JITTER_MAX = 8; // max jitter buffer depth (8 frames = 160ms); prevents unbounded growth
  let outboundTimer: ReturnType<typeof setInterval> | null = null;
  let outboundJitterBuffer: Buffer[] = [];

  const initAudioEngine = async () => {
    try {
      // Use a Function constructor to hide the dynamic import from the bundler (esbuild/vite).
      // This prevents the bundler from packing libopus-node (which breaks its WASM paths)
      // and prevents it from transpiling the import into a require() (which breaks pure ESM).
      const dynamicImport = new Function('modulePath', 'return import(modulePath)');

      console.log("[AUDIO-INIT] Attempting to load libopus-node...");
      libopus = await dynamicImport("libopus-node");
      console.log("[AUDIO-INIT] libopus-node loaded successfully.");
      
      console.log("[AUDIO-INIT] Attempting to load naudiodon...");
      try {
        portAudio = await dynamicImport("naudiodon");
        console.log("[AUDIO-INIT] naudiodon loaded successfully.");
        try {
          const hostAPIInfo = portAudio.getHostAPIs();
          console.log("[AUDIO-INIT] Host APIs:", JSON.stringify(hostAPIInfo, null, 2));
        } catch (e: any) {
          console.warn("[AUDIO-INIT] Could not enumerate host APIs:", e.message);
        }
        isAudioEngineReady = true;
      } catch (naudioErr: any) {
        console.error("[AUDIO-INIT] Failed to load naudiodon. Audio I/O will be disabled.", naudioErr.message);
        audioEngineError = "naudiodon missing (build tools required)";
      }
    } catch (err: any) {
      console.error("[AUDIO-INIT] Failed to load audio engine:", err);
      audioEngineError = err.message;
    } finally {
      // Fix Issue 4: Broadcast the final state to any clients that connected while we were loading
      if (io) {
        io.emit("audio-engine-state", { isReady: isAudioEngineReady, error: audioEngineError });
      }
    }
  };

  // Start audio engine initialization
  initAudioEngine();

  let rigctldSettings = {
    rigNumber: "",
    serialPort: "",
    portNumber: "4532",
    ipAddress: "127.0.0.1",
    serialPortSpeed: "38400",
    preampCapabilities: [] as string[],
    attenuatorCapabilities: [] as string[],
    agcCapabilities: [] as string[],
    nbSupported: false,
    nbLevelRange: { min: 0, max: 1, step: 0.1 },
    nrSupported: false,
    nrLevelRange: { min: 0, max: 1, step: 0.1 },
    rfPowerRange: { min: 0, max: 1, step: 0.01 },
    anfSupported: false
  };

  // Load settings if they exist
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      rigctldSettings = { ...rigctldSettings, ...data.settings };
      autoStartEnabled = data.autoStart || false;
      videoAutoStart = data.videoAutoStart || false;
      pollRate = Number(data.pollRate) || 2000;
      autoconnectEligible = data.autoconnectEligible || false;
      clientHost = data.clientHost || "127.0.0.1";
      clientPort = Number(data.clientPort) || 4532;
      if (data.videoSettings) {
        const vs = data.videoSettings;
        // Migrate old 'resolution' string (e.g. "640x480") to discrete width/height fields
        if (vs.resolution && !vs.videoWidth) {
          const parts = (vs.resolution as string).split("x");
          vs.videoWidth = parseInt(parts[0]) || 640;
          vs.videoHeight = parseInt(parts[1]) || 480;
        }
        videoSettings = { ...videoSettings, ...vs };
      }
      if (data.audioSettings) {
        audioSettings = { ...audioSettings, ...data.audioSettings };
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }

  const saveSettings = () => {
    console.log(`[SETTINGS] Saving settings to ${SETTINGS_FILE}...`);
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
        settings: rigctldSettings,
        autoStart: autoStartEnabled,
        videoAutoStart: videoAutoStart,
        videoSettings: videoSettings,
        audioSettings: audioSettings,
        pollRate: Number(pollRate),
        autoconnectEligible: autoconnectEligible,
        clientHost: clientHost,
        clientPort: Number(clientPort)
      }, null, 2));
    } catch (e) {
      console.error("[SETTINGS] Failed to save settings:", e);
    }
  };

  const getRigctldVersion = (): Promise<string | null> => {
    return new Promise((resolve) => {
      const proc = spawn(getRigctldPath(), ["-V"]);
      let output = "";
      proc.stdout?.on("data", (d) => output += d.toString());
      proc.stderr?.on("data", (d) => output += d.toString());
      proc.on("close", () => {
        // rigctld -V output is usually like "rigctld hamlib 4.7.0"
        const match = output.match(/hamlib\s+([\d.]+)/i);
        resolve(match ? match[1] : null);
      });
      proc.on("error", () => resolve(null));
    });
  };

  const checkVersionSupported = (version: string | null): boolean => {
    if (!version) return true; // If we can't get version, assume it's okay for now
    const parts = version.split('.').map(Number);
    const min = [4, 7, 0];
    for (let i = 0; i < Math.max(parts.length, min.length); i++) {
      const v = parts[i] || 0;
      const m = min[i] || 0;
      if (v > m) return true;
      if (v < m) return false;
    }
    return true;
  };

  const emitRigctldStatus = () => {
    io.emit("rigctld-status", { 
      status: rigctldStatus, 
      logs: rigctldLogs,
      version: rigctldVersion,
      isVersionSupported: isRigctldVersionSupported
    });
  };

  // Initial version check
  getRigctldVersion().then(v => {
    rigctldVersion = v;
    isRigctldVersionSupported = checkVersionSupported(v);
    console.log(`[HAMLIB] Detected rigctld version: ${v || "unknown"}`);
    emitRigctldStatus();
  });

  const fetchRadioCapabilities = async (rigNumber: string) => {
    if (!rigNumber || rigNumber === "" || rigNumber === "1") {
      rigctldSettings.preampCapabilities = [];
      rigctldSettings.attenuatorCapabilities = [];
      rigctldSettings.agcCapabilities = [];
      saveSettings();
      io.emit("preamp-capabilities", rigctldSettings.preampCapabilities);
      io.emit("attenuator-capabilities", rigctldSettings.attenuatorCapabilities);
      io.emit("agc-capabilities", rigctldSettings.agcCapabilities);
      io.emit("anf-capabilities", rigctldSettings.anfSupported);
      return;
    }

    const rigctldPath = getRigctldPath();
    console.log(`[HAMLIB] Fetching radio capabilities for rig ${rigNumber}...`);
    
    // Use exec to get capabilities
    exec(`"${rigctldPath}" -m ${rigNumber} -u`, (error, stdout, stderr) => {
      if (error) {
        console.error(`[HAMLIB] Error getting radio capabilities: ${error.message}`);
        rigctldSettings.preampCapabilities = [];
        rigctldSettings.attenuatorCapabilities = [];
        rigctldSettings.agcCapabilities = [];
        rigctldSettings.nbSupported = false;
        rigctldSettings.nrSupported = false;
        rigctldSettings.anfSupported = false;
      } else {
        const lines = stdout.split('\n');
        
        // Parse Preamp
        const preampLine = lines.find(line => line.trim().startsWith('Preamp:'));
        if (preampLine) {
          // Example: "Preamp: 10dB 20dB"
          const levels = preampLine.replace('Preamp:', '').trim().split(/\s+/).filter(Boolean);
          rigctldSettings.preampCapabilities = levels;
          console.log(`[HAMLIB] Found preamp capabilities for rig ${rigNumber}: ${rigctldSettings.preampCapabilities.join(", ")}`);
        } else {
          rigctldSettings.preampCapabilities = [];
          console.log(`[HAMLIB] No preamp capabilities found for rig ${rigNumber}`);
        }

        // Parse Attenuator
        const attenuatorLine = lines.find(line => line.trim().startsWith('Attenuator:'));
        if (attenuatorLine) {
          // Example: "Attenuator: 6dB 12dB 18dB"
          const levels = attenuatorLine.replace('Attenuator:', '').trim().split(/\s+/).filter(Boolean);
          rigctldSettings.attenuatorCapabilities = levels;
          console.log(`[HAMLIB] Found attenuator capabilities for rig ${rigNumber}: ${rigctldSettings.attenuatorCapabilities.join(", ")}`);
        } else {
          rigctldSettings.attenuatorCapabilities = [];
          console.log(`[HAMLIB] No attenuator capabilities found for rig ${rigNumber}`);
        }

        // Parse AGC
        const agcLine = lines.find(line => line.trim().startsWith('AGC levels:'));
        if (agcLine) {
          // Example: "AGC levels: 0=OFF 2=FAST 5=MEDIUM 3=SLOW 6=AUTO"
          const levels = agcLine.replace('AGC levels:', '').trim().split(/\s+/).filter(Boolean);
          rigctldSettings.agcCapabilities = levels;
          console.log(`[HAMLIB] Found AGC capabilities for rig ${rigNumber}: ${rigctldSettings.agcCapabilities.join(", ")}`);
        } else {
          rigctldSettings.agcCapabilities = [];
          console.log(`[HAMLIB] No AGC capabilities found for rig ${rigNumber}`);
        }

        // Parse Set functions for NB and NR
        const setFunctionsLine = lines.find(line => line.trim().startsWith('Set functions:'));
        if (setFunctionsLine) {
          const functions = setFunctionsLine.replace('Set functions:', '').trim().split(/\s+/);
          rigctldSettings.nbSupported = functions.includes('NB');
          rigctldSettings.nrSupported = functions.includes('NR');
          rigctldSettings.anfSupported = functions.includes('ANF');
          console.log(`[HAMLIB] NB supported for rig ${rigNumber}: ${rigctldSettings.nbSupported}`);
          console.log(`[HAMLIB] NR supported for rig ${rigNumber}: ${rigctldSettings.nrSupported}`);
          console.log(`[HAMLIB] ANF supported for rig ${rigNumber}: ${rigctldSettings.anfSupported}`);
        } else {
          rigctldSettings.nbSupported = false;
          rigctldSettings.nrSupported = false;
          rigctldSettings.anfSupported = false;
          console.log(`[HAMLIB] NB/NR/ANF not supported for rig ${rigNumber}`);
        }

        // Parse Get level for NB and NR range
        const getLevelLine = lines.find(line => line.trim().startsWith('Get level:'));
        if (getLevelLine) {
          // Example: "Get level: NB(0.000000..10.000000/1.000000)"
          const nbMatch = getLevelLine.match(/NB\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
          if (nbMatch) {
            rigctldSettings.nbLevelRange = {
              min: parseFloat(nbMatch[1]),
              max: parseFloat(nbMatch[2]),
              step: parseFloat(nbMatch[3])
            };
            console.log(`[HAMLIB] NB level range for rig ${rigNumber}: min=${rigctldSettings.nbLevelRange.min}, max=${rigctldSettings.nbLevelRange.max}, step=${rigctldSettings.nbLevelRange.step}`);
          } else {
            rigctldSettings.nbLevelRange = { min: 0, max: 1, step: 0.1 };
          }

          const nrMatch = getLevelLine.match(/NR\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
          if (nrMatch) {
            rigctldSettings.nrLevelRange = {
              min: parseFloat(nrMatch[1]),
              max: parseFloat(nrMatch[2]),
              step: parseFloat(nrMatch[3])
            };
            console.log(`[HAMLIB] NR level range for rig ${rigNumber}: min=${rigctldSettings.nrLevelRange.min}, max=${rigctldSettings.nrLevelRange.max}, step=${rigctldSettings.nrLevelRange.step}`);
          } else {
            rigctldSettings.nrLevelRange = { min: 0, max: 1, step: 0.1 };
          }

          const rfPowerMatch = getLevelLine.match(/RFPOWER\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
          if (rfPowerMatch) {
            rigctldSettings.rfPowerRange = {
              min: parseFloat(rfPowerMatch[1]),
              max: parseFloat(rfPowerMatch[2]),
              step: parseFloat(rfPowerMatch[3])
            };
            console.log(`[HAMLIB] RF Power range for rig ${rigNumber}: min=${rigctldSettings.rfPowerRange.min}, max=${rigctldSettings.rfPowerRange.max}, step=${rigctldSettings.rfPowerRange.step}`);
          } else {
            rigctldSettings.rfPowerRange = { min: 0, max: 1, step: 0.01 };
          }
        }
      }
      saveSettings();
      io.emit("preamp-capabilities", rigctldSettings.preampCapabilities);
      io.emit("attenuator-capabilities", rigctldSettings.attenuatorCapabilities);
      io.emit("agc-capabilities", rigctldSettings.agcCapabilities);
      io.emit("nb-capabilities", { supported: rigctldSettings.nbSupported, range: rigctldSettings.nbLevelRange });
      io.emit("nr-capabilities", { supported: rigctldSettings.nrSupported, range: rigctldSettings.nrLevelRange });
      io.emit("rfpower-capabilities", { range: rigctldSettings.rfPowerRange });
      io.emit("anf-capabilities", { supported: rigctldSettings.anfSupported });
    });
  };

  // Initial fetch of preamp capabilities
  // Removed as per user request to only poll on settings change
  // fetchPreampCapabilities(rigctldSettings.rigNumber);

  const addLog = (data: string) => {
    const lines = data.split("\n").filter(l => l.trim());
    rigctldLogs = [...rigctldLogs, ...lines].slice(-100); // Keep last 100 lines
    io.emit("rigctld-log", lines);
  };

  const stopRigctld = () => {
    if (rigctldProcess) {
      console.log("Stopping rigctld...");
      rigctldProcess.kill();
      rigctldProcess = null;
      rigctldStatus = "stopped";
      emitRigctldStatus();
    }
  };

  const checkExistingRigctld = (): Promise<boolean> => {
    return new Promise((resolve) => {
      // Use pgrep on Linux/Mac, tasklist on Windows
      const cmd = process.platform === "win32" ? 'tasklist /FI "IMAGENAME eq rigctld.exe"' : "pgrep rigctld";
      exec(cmd, (err, stdout) => {
        if (process.platform === "win32") {
          resolve(stdout.toLowerCase().includes("rigctld.exe"));
        } else {
          resolve(!err && !!stdout.trim());
        }
      });
    });
  };

  const listAudioDevices = async (): Promise<{ inputs: { name: string, altName: string, hostAPIName: string }[], outputs: { name: string, altName: string, hostAPIName: string }[], error?: string }> => {
    if (!portAudio) {
      return { inputs: [], outputs: [], error: audioEngineError || "Audio engine not ready" };
    }
    try {
      const devices = portAudio.getDevices();
      const inputs = devices.filter((d: any) => d.maxInputChannels > 0).map((d: any) => ({ name: d.name, altName: d.id.toString(), hostAPIName: d.hostAPIName || "", defaultSampleRate: d.defaultSampleRate || 0 }));
      const outputs = devices.filter((d: any) => d.maxOutputChannels > 0).map((d: any) => ({ name: d.name, altName: d.id.toString(), hostAPIName: d.hostAPIName || "", defaultSampleRate: d.defaultSampleRate || 0 }));
      return { inputs, outputs };
    } catch (err: any) {
      console.error("[AUDIO] Failed to list devices:", err);
      return { inputs: [], outputs: [], error: err.message };
    }
  };

  const stopAudio = async () => {
    console.log("[AUDIO] Stopping audio streaming...");
    if (outboundTimer) { clearInterval(outboundTimer); outboundTimer = null; }
    outboundJitterBuffer = [];
    if (audioInputProcess) {
      try { await audioInputProcess.quit(); } catch (e) {}
      audioInputProcess = null;
    }
    if (audioOutputProcess) {
      try { await audioOutputProcess.quit(); } catch (e) {}
      audioOutputProcess = null;
    }
    opusEncoder = null;
    opusDecoder = null;
    audioStatus = "stopped";
    io.emit("audio-status", audioStatus);
  };

  _shutdownAudio = stopAudio;

  const startAudio = async () => {
    console.log("[AUDIO] Starting audio streaming...");
    await stopAudio();

    if (!isAudioEngineReady) {
      console.warn("[AUDIO] Cannot start audio: Audio engine is not ready.");
      return;
    }

    if (!audioSettings.inputDevice && !audioSettings.outputDevice) {
      console.warn("[AUDIO] Cannot start audio: No devices selected.");
      return;
    }

    try {
      opusEncoder = new libopus.OpusEncoder(48000, 1);
      opusDecoder = new libopus.OpusEncoder(48000, 1);
      console.log("[AUDIO] Opus encoder/decoder initialized at 48000Hz Mono.");
    } catch (err) {
      console.error("[AUDIO] Failed to initialize Opus:", err);
      return;
    }

    // Inbound: Backend -> Frontend (Capture from rig, encode, broadcast)
    if (audioSettings.inputDevice) {
      try {
        const deviceId = parseInt(audioSettings.inputDevice, 10);
        audioInputProcess = new portAudio.AudioIO({
          inOptions: {
            channelCount: 1,
            sampleFormat: portAudio.SampleFormat16Bit,
            sampleRate: 48000,
            deviceId: isNaN(deviceId) ? -1 : deviceId, // -1 is default
            closeOnError: true,
            framesPerBuffer: 0, // Let PortAudio choose native buffer size for the host API
            maxQueue: 10,
            highwaterMark: 256 // small value to keep read() requests tiny and data events firing as frequently as possible
          }
        });

        // PCM Ring Buffer for chunking 960 samples (1920 bytes for 16-bit mono)
        const FRAME_SIZE_BYTES = 960 * 2;
        let pcmBuffer = Buffer.alloc(0);

        audioInputProcess.on('data', (data: Buffer) => {
          try {
            // Don't broadcast rig audio if someone is transmitting (PTT engaged)
            if (activeMicClientId && lastStatus.ptt) return;

            pcmBuffer = Buffer.concat([pcmBuffer, data]);

            while (pcmBuffer.length >= FRAME_SIZE_BYTES) {
              const frame = pcmBuffer.subarray(0, FRAME_SIZE_BYTES);
              pcmBuffer = pcmBuffer.subarray(FRAME_SIZE_BYTES);

              try {
                const encodedPacket = opusEncoder.encode(frame);
                // Broadcast to all clients
                io.emit("audio-inbound", encodedPacket);
              } catch (err) {
                console.error("[AUDIO] Opus encode error:", err);
              }
            }
          } catch (err) {
            console.error("[AUDIO-IN] Unhandled exception in data handler:", err);
          }
        });

        audioInputProcess.on('error', (err: any) => {
          console.error("[AUDIO-IN] naudiodon error:", err);
        });

        audioInputProcess.start();
        console.log(`[AUDIO-IN] Started capture from device ${audioSettings.inputDevice}`);
      } catch (err) {
        console.error("[AUDIO-IN] Failed to start capture:", err);
      }
    }

    // Outbound: Frontend -> Backend (Receive from client, decode, play to rig)
    if (audioSettings.outputDevice) {
      try {
        const deviceId = parseInt(audioSettings.outputDevice, 10);
        audioOutputProcess = new portAudio.AudioIO({
          outOptions: {
            channelCount: 1,
            sampleFormat: portAudio.SampleFormat16Bit,
            sampleRate: 48000,
            deviceId: isNaN(deviceId) ? -1 : deviceId,
            closeOnError: false, // Do not close on underflow — underflow is expected before first write
            framesPerBuffer: 0, // Let PortAudio choose native buffer size for the host API
            maxQueue: 20
          }
        });

        audioOutputProcess.on('error', (err: any) => {
          console.error("[AUDIO-OUT] naudiodon error:", err);
        });

        audioOutputProcess.start();

        // Pre-fill: give PortAudio silence to consume before the first timer tick fires.
        for (let i = 0; i < OUTBOUND_PRE_FILL; i++) {
          audioOutputProcess.write(OUTBOUND_SILENCE);
        }

        // Unified write timer: the sole writer to audioOutputProcess.
        // Drains the jitter buffer when PTT is on and frames are available; writes silence
        // otherwise. Centralising all writes here eliminates race conditions between the
        // socket handler and a separate silence timer.
        outboundTimer = setInterval(() => {
          if (!audioOutputProcess) return;
          let frame: Buffer;
          if (lastStatus.ptt && outboundJitterBuffer.length > 0) {
            frame = outboundJitterBuffer.shift()!;
          } else {
            outboundJitterBuffer = []; // discard stale frames when PTT is off
            frame = OUTBOUND_SILENCE;
          }
          audioOutputProcess.write(frame);
        }, 20);

        console.log(`[AUDIO-OUT] Started playback to device ${audioSettings.outputDevice}`);
      } catch (err) {
        console.error("[AUDIO-OUT] Failed to start playback:", err);
      }
    }

    activeMicClientId = null;
    io.emit("mic-active-client", null);
    io.emit("mic-mute-forced");
    audioStatus = "playing";
    io.emit("audio-status", audioStatus);
  };
  const killExistingRigctld = (): Promise<void> => {
    return new Promise((resolve) => {
      const cmd = process.platform === "win32" ? "taskkill /F /IM rigctld.exe" : "pkill -9 rigctld";
      exec(cmd, () => {
        // We resolve regardless of error (e.g. if process wasn't found)
        resolve();
      });
    });
  };

  const startRigctld = async () => {
    if (rigctldProcess) {
      stopRigctld();
    }

    // Check version first
    rigctldVersion = await getRigctldVersion();
    isRigctldVersionSupported = checkVersionSupported(rigctldVersion);
    console.log(`[HAMLIB] rigctld version check: ${rigctldVersion || "unknown"}`);
    addLog(`Hamlib (rigctld) version check: ${rigctldVersion || "unknown"}`);
    if (!isRigctldVersionSupported) {
      console.warn(`rigctld version ${rigctldVersion} is less than 4.7.0 and is unsupported.`);
      addLog(`Warning: rigctld version ${rigctldVersion} is less than 4.7.0 and is unsupported.`);
    }

    // Check if rigctld is already running on the system (not by us)
    const isAlreadyRunning = await checkExistingRigctld();
    if (isAlreadyRunning) {
      console.warn("rigctld is already running on the system");
      rigctldStatus = "already_running";
      emitRigctldStatus();
      addLog("Error: rigctld is already running on the system. Please stop it or use the 'Kill and Restart' option.");
      return;
    }
    
    const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = rigctldSettings;
    
    if (!rigNumber || !serialPort || !portNumber || !ipAddress || !serialPortSpeed) {
      console.error("Cannot start rigctld: missing settings");
      rigctldStatus = "error";
      emitRigctldStatus();
      return;
    }

    console.log(`Starting rigctld: ${getRigctldPath()} -m ${rigNumber} -r ${serialPort} -t ${portNumber} -T ${ipAddress} -s ${serialPortSpeed}`);
    
    rigctldProcess = spawn(getRigctldPath(), [
      "-m", rigNumber,
      "-r", serialPort,
      "-t", portNumber,
      "-T", ipAddress,
      "-s", serialPortSpeed
    ], { detached: false });

    rigctldStatus = "running";
    emitRigctldStatus();
    addLog("rigctld started");

    rigctldProcess.stdout?.on("data", (data) => {
      const str = data.toString();
      console.log(`rigctld stdout: ${str}`);
      addLog(str);
    });

    rigctldProcess.stderr?.on("data", (data) => {
      const str = data.toString();
      console.error(`rigctld stderr: ${str}`);
      addLog(str);
    });

    rigctldProcess.on("close", (code) => {
      console.log(`rigctld process exited with code ${code}`);
      addLog(`rigctld exited with code ${code}`);
      rigctldProcess = null;
      rigctldStatus = code === 0 ? "stopped" : "error";
      emitRigctldStatus();
    });

    rigctldProcess.on("error", (err) => {
      console.error("Failed to start rigctld:", err);
      addLog(`Error: ${err.message}`);
      rigctldProcess = null;
      rigctldStatus = "error";
      emitRigctldStatus();
    });
  };

  // Start rigctld on server boot if enabled
  if (autoStartEnabled) {
    startRigctld();
  }

  process.on("exit", stopRigctld);
  process.on("SIGINT", () => {
    stopRigctld();
    process.exit();
  });
  process.on("SIGTERM", () => {
    stopRigctld();
    process.exit();
  });

  let rigSocket: net.Socket | null = null;
  let pollingTimeout: NodeJS.Timeout | null = null;
  let rigConfig = { host: "", port: 0 };
  let isConnected = false;

  const connectToRig = (host: string, port: number, socket?: any) => {
    if (isConnected && rigConfig.host === host && rigConfig.port === port) {
      console.log(`Already connected to rigctld at ${host}:${port}. Informing client.`);
      if (socket) {
        socket.emit("rig-connected", { host, port });
      } else {
        io.emit("rig-connected", { host, port });
      }
      return;
    }

    if (rigSocket) {
      rigSocket.destroy();
      rigSocket = null;
    }

    rigConfig = { host, port };
    rigSocket = new net.Socket();
    
    rigSocket.connect(port, host, () => {
      console.log(`Connected to rigctld at ${host}:${port}`);
      isConnected = true;
      io.emit("rig-connected", { host, port });
      startPolling();
    });

    rigSocket.on("error", (err) => {
      console.error("Rig socket error:", err);
      isConnected = false;
      io.emit("rig-error", `Connection Error: ${err.message}`);
    });

    rigSocket.on("close", () => {
      console.log("Rig connection closed");
      isConnected = false;
      io.emit("rig-disconnected");
      stopPolling();
    });
  };

  const startPolling = () => {
    stopPolling();
    const runPoll = async () => {
      if (!isConnected) return;
      const startTime = Date.now();
      await pollRig();
      const duration = Date.now() - startTime;
      const nextDelay = Math.max(0, pollRate - duration);
      pollingTimeout = setTimeout(runPoll, nextDelay);
    };
    pollingTimeout = setTimeout(runPoll, pollRate);
  };

  const stopPolling = () => {
    if (pollingTimeout) {
      clearTimeout(pollingTimeout);
      pollingTimeout = null;
    }
  };

  let visibleMeters: string[] = ['swr', 'alc'];
  let pollCycleCount = 0;
  let lastStatus: any = {
    frequency: "14074000",
    mode: "USB",
    bandwidth: "2400",
    ptt: false,
    smeter: -54,
    swr: 1.0,
    alc: 0,
    powerMeter: 0,
    rfpower: 0.5,
    vdd: 13.8,
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
    anf: false,
    nrLevel: 8 / 15,
    tuner: false
  };

  const resetRigState = () => {
    lastStatus = {
      frequency: "14074000",
      mode: "USB",
      bandwidth: "2400",
      ptt: false,
      smeter: -54,
      swr: 1.0,
      alc: 0,
      powerMeter: 0,
      rfpower: 0.5,
      vdd: 13.8,
      vfo: "VFOA",
      isSplit: false,
      txVFO: "VFOB",
      rfLevel: 0,
      agc: 6,
      attenuation: 0,
      preamp: 0,
      nb: false,
      nr: false,
      anf: false,
      nrLevel: 8 / 15,
      tuner: false
    };
  };

  const formatExtendedCommand = (cmd: string): string => {
    const trimmed = cmd.trim();
    const parts = trimmed.split(/\s+/);
    if (parts[0].length === 1) {
      return `+${trimmed}`;
    }
    return `+\\${trimmed}`;
  };

  const parseExtendedResponse = (resp: string): string => {
    const lines = resp.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) return resp;
    
    const lastLine = lines[lines.length - 1];
    if (lastLine.includes("RPRT 1")) {
      throw new Error("Rig command error (RPRT 1)");
    }
    
    const values: string[] = [];
    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i];
      const colonIndex = line.indexOf(":");
      if (colonIndex !== -1) {
        values.push(line.substring(colonIndex + 1).trim());
      } else {
        values.push(line);
      }
    }
    return values.join("\n");
  };

  const rigCommandQueue: { cmd: string; useExtended: boolean; resolve: (val: string) => void; reject: (err: any) => void }[] = [];
  let isRigBusy = false;

  const processRigQueue = async () => {
    if (isRigBusy || rigCommandQueue.length === 0) return;
    isRigBusy = true;
    const { cmd, useExtended, resolve, reject } = rigCommandQueue.shift()!;
    
    try {
      const resp = await executeRigCommand(cmd, useExtended);
      resolve(resp);
    } catch (err) {
      reject(err);
    } finally {
      isRigBusy = false;
      setTimeout(processRigQueue, 10);
    }
  };

  const sendToRig = (cmd: string, useExtended = false, priority = false): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (priority) {
        rigCommandQueue.unshift({ cmd, useExtended, resolve, reject });
      } else {
        rigCommandQueue.push({ cmd, useExtended, resolve, reject });
      }
      processRigQueue();
    });
  };

  const executeRigCommand = (cmd: string, useExtended = false): Promise<string> => {
    const finalCmd = useExtended ? formatExtendedCommand(cmd) : cmd;
    
    return new Promise((resolve, reject) => {
      if (!rigSocket || rigSocket.destroyed) {
        return reject("Not connected to rig");
      }
      
      let responseBuffer = "";
      const timeout = setTimeout(() => {
        rigSocket?.removeListener("data", onData);
        rigSocket?.removeListener("error", onError);
        
        // On timeout, the socket state is likely corrupted (leftover data).
        // We reconnect to ensure the next command starts clean.
        console.warn("Rig command timeout - reconnecting to reset state");
        if (rigSocket) {
          rigSocket.destroy();
          isConnected = false;
          // Reconnect logic will be handled by the next poll or manual action
          // but for now we just reject.
        }
        
        reject("Rig command timeout");
      }, 10000);

      const onData = (data: Buffer) => {
        responseBuffer += data.toString();
        
        if (useExtended) {
          if (responseBuffer.includes("RPRT 0") || responseBuffer.includes("RPRT 1")) {
            clearTimeout(timeout);
            rigSocket?.removeListener("data", onData);
            rigSocket?.removeListener("error", onError);
            try {
              resolve(parseExtendedResponse(responseBuffer));
            } catch (e) {
              reject(e);
            }
          }
        } else {
          // Standard mode
          clearTimeout(timeout);
          rigSocket?.removeListener("data", onData);
          rigSocket?.removeListener("error", onError);
          resolve(responseBuffer.trim());
        }
      };
      
      const onError = (err: Error) => {
        clearTimeout(timeout);
        rigSocket?.removeListener("data", onData);
        reject(err);
      };
      
      rigSocket.on("data", onData);
      rigSocket.once("error", onError);
      rigSocket.write(finalCmd + "\n");
    });
  };

  const pollRig = async () => {
    if (!isConnected) {
      // If disconnected, try to reconnect occasionally
      if (rigConfig.host && rigConfig.host !== "mock") {
        console.log("Attempting background reconnection...");
        connectToRig(rigConfig.host, rigConfig.port);
      }
      return;
    }
    try {
      const now = Date.now();
      const isSlowPoll = pollCycleCount % 10 === 0;
      pollCycleCount++;

      // Fast Tier: ptt, smeter, and TX meters if PTT
      const ptt = await sendToRig("t", true);
      const smeter = await sendToRig("l STRENGTH", true);
      const isPttActive = ptt === "1";
      
      let alc = lastStatus.alc?.toString() || "0";
      let powerMeter = lastStatus.powerMeter?.toString() || "0";
      let swr = lastStatus.swr?.toString() || "1.0";

      if (isPttActive) {
        try {
          alc = await sendToRig("l ALC", true);
          powerMeter = await sendToRig("l RFPOWER_METER", true);
          swr = await sendToRig("l SWR", true);
        } catch (e) {
          console.warn("TX levels poll failed, might not be supported");
        }
      }

      // Slow Tier: ATT, PREAMP, AGC, NB, NR, ANF, TUNER, RFPOWER, RF, VD_METER, frequency, mode, bandwidth, vfo, split
      let frequency = lastStatus.frequency;
      let mode = lastStatus.mode;
      let bandwidth = lastStatus.bandwidth;
      let rfpower = lastStatus.rfpower;
      let rflevel = lastStatus.rfLevel;
      let agc = lastStatus.agc;
      let vfo = lastStatus.vfo;
      let isSplit = lastStatus.isSplit;
      let txVFO = lastStatus.txVFO;
      let att = lastStatus.attenuation;
      let preamp = lastStatus.preamp;
      let nb = lastStatus.nb;
      let nbLevel = lastStatus.nbLevel;
      let nr = lastStatus.nr;
      let nrLevel = lastStatus.nrLevel;
      let anf = lastStatus.anf;
      let tuner = lastStatus.tuner;
      let vdd = lastStatus.vdd;

      if (isSlowPoll) {
        // VDD Poll (Conditional)
        if (visibleMeters.includes('vdd')) {
          vdd = parseFloat(await sendToRig("l VD_METER", true).catch(() => "13.8"));
        }

        frequency = await sendToRig("f", true);
        const modeBw = await sendToRig("m", true);
        const [m, b] = modeBw.split("\n");
        mode = m;
        bandwidth = b;
        rfpower = parseFloat(await sendToRig("l RFPOWER", true));
        rflevel = parseFloat(await sendToRig("l RF", true).catch(() => "0"));
        agc = parseInt(await sendToRig("l AGC", true).catch(() => "6"));
        vfo = await sendToRig("v", true);
        const splitInfo = await sendToRig("s", true);
        const [isSplitStr, txVFOStr] = splitInfo.split("\n");
        isSplit = isSplitStr === "1";
        txVFO = txVFOStr || "VFOB";
        att = parseInt(await sendToRig("l ATT", true)) || 0;
        preamp = parseInt(await sendToRig("l PREAMP", true)) || 0;
        nb = (await sendToRig("u NB", true).catch(() => "0")) === "1";
        nbLevel = parseFloat(await sendToRig("l NB", true).catch(() => "0"));
        nr = (await sendToRig("u NR", true).catch(() => "0")) === "1";
        nrLevel = parseFloat(await sendToRig("l NR", true).catch(() => "0"));
        anf = (await sendToRig("u ANF", true).catch(() => "0")) === "1";
        tuner = (await sendToRig("u TUNER", true).catch(() => "0")) === "1";
      }

      lastStatus = {
        frequency,
        mode,
        bandwidth,
        ptt: isPttActive,
        smeter: parseFloat(smeter),
        swr: parseFloat(swr),
        alc: parseFloat(alc),
        powerMeter: parseFloat(powerMeter),
        rfpower,
        rfLevel: rflevel,
        agc,
        vdd: parseFloat(vdd),
        vfo,
        isSplit,
        txVFO,
        attenuation: att,
        preamp,
        nb,
        nbLevel,
        nr,
        nrLevel,
        anf,
        tuner,
        timestamp: now,
      };

      io.emit("rig-status", lastStatus);
    } catch (err) {
      console.error("Polling error:", err);
    }
  };

  io.on("connection", (socket) => {
    const clientId = socket.handshake.auth.clientId || socket.id;
    console.log(`Client connected (Socket ID: ${socket.id}, Client ID: ${clientId})`);
    
    socket.emit("audio-engine-state", {
      isReady: isAudioEngineReady,
      error: audioEngineError
    });

    socket.on("connect-rig", ({ host, port }) => {
      resetRigState();
      connectToRig(host, port, socket);
    });

    socket.on("disconnect-rig", () => {
      resetRigState();
      if (rigSocket) {
        rigSocket.destroy();
        rigSocket = null;
      }
      isConnected = false;
      stopPolling();
      io.emit("rig-disconnected");
      console.log("Rig manually disconnected");
    });

    socket.on("set-func", async ({ func, state }) => {
      try {
        await sendToRig(`U ${func} ${state ? "1" : "0"}`, false, true);
        const confirmedState = (await sendToRig(`u ${func}`, true, true)) === "1";
        const key = func.toLowerCase() as any;
        lastStatus = { ...lastStatus, [key]: confirmedState };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${func}`);
      }
    });

    socket.on("set-level", async ({ level, val }) => {
      try {
        await sendToRig(`L ${level} ${val}`, false, true);
        const confirmedVal = parseFloat(await sendToRig(`l ${level}`, true, true));
        const key = level.toLowerCase() === "rfpower" ? "rfpower" : 
                    level.toLowerCase() === "rf" ? "rfLevel" :
                    level.toLowerCase() === "agc" ? "agc" :
                    level.toLowerCase() === "att" ? "attenuation" :
                    level.toLowerCase() === "preamp" ? "preamp" :
                    level.toLowerCase() === "nr" ? "nrLevel" :
                    level.toLowerCase() === "nb" ? "nbLevel" : null;
        if (key) {
          lastStatus = { ...lastStatus, [key]: confirmedVal };
          io.emit("rig-status", lastStatus);
        }
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${level}`);
      }
    });

    socket.on("set-frequency", async (freq) => {
      try {
        await sendToRig(`F ${freq}`, false, true);
        const confirmedFreq = await sendToRig("f", true, true);
        lastStatus = { ...lastStatus, frequency: confirmedFreq };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", "Failed to set frequency");
      }
    });

    socket.on("set-mode", async ({ mode, bandwidth }) => {
      try {
        await sendToRig(`M ${mode} ${bandwidth}`, false, true);
        const modeBw = await sendToRig("m", true, true);
        const [confirmedMode, confirmedBw] = modeBw.split("\n");
        lastStatus = { ...lastStatus, mode: confirmedMode, bandwidth: confirmedBw };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", "Failed to set mode/bandwidth");
      }
    });

    socket.on("get-modes", async () => {
      try {
        const modes = await sendToRig("M ?", false, true);
        // rigctld might return modes separated by spaces or newlines
        const modeList = modes.split(/[\s\n]+/).filter(Boolean);
        socket.emit("available-modes", modeList);
      } catch (err) {
        console.error("Failed to get modes:", err);
      }
    });

    socket.on("set-ptt", async (ptt) => {
      try {
        await sendToRig(`T ${ptt ? "1" : "0"}`, false, true);
        const confirmedPtt = (await sendToRig("t", true, true)) === "1";
        lastStatus = { ...lastStatus, ptt: confirmedPtt };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", "Failed to set PTT");
      }
    });

    socket.on("set-vfo", async (vfo) => {
      try {
        await sendToRig(`V ${vfo}`, false, true);
        const confirmedVfo = await sendToRig("v", true, true);
        lastStatus = { ...lastStatus, vfo: confirmedVfo };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", "Failed to set VFO");
      }
    });

    socket.on("set-split-vfo", async ({ split, txVFO }) => {
      try {
        await sendToRig(`S ${split} ${txVFO}`, false, true);
        const splitInfo = await sendToRig("s", true, true);
        const [isSplitStr, confirmedTxVFO] = splitInfo.split("\n");
        lastStatus = { ...lastStatus, isSplit: isSplitStr === "1", txVFO: confirmedTxVFO || "VFOB" };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", "Failed to set split VFO");
      }
    });

    socket.on("vfo-op", async (op) => {
      try {
        await sendToRig(`G ${op}`, false, true);
        const frequency = await sendToRig("f", true, true);
        const modeBw = await sendToRig("m", true, true);
        const [mode, bandwidth] = modeBw.split("\n");
        const vfo = await sendToRig("v", true, true);
        lastStatus = { ...lastStatus, frequency, mode, bandwidth, vfo };
        io.emit("rig-status", lastStatus);
      } catch (err) {
        socket.emit("rig-error", `Failed to execute VFO operation: ${op}`);
      }
    });

    socket.on("set-visible-meters", (meters: string[]) => {
      visibleMeters = meters;
    });

    socket.on("set-poll-rate", (rate) => {
      pollRate = rate;
      saveSettings();
      startPolling();
    });

    socket.on("set-autoconnect-eligible", (eligible) => {
      autoconnectEligible = eligible;
      saveSettings();
    });

    socket.on("set-client-config", ({ host, port }) => {
      clientHost = host;
      clientPort = port;
      saveSettings();
    });

    socket.on("get-settings", async () => {
      // Check if rigctld is already running on the system if we think it's stopped
      if (rigctldStatus === "stopped" || rigctldStatus === "error") {
        const isRunning = await checkExistingRigctld();
        if (isRunning) {
          rigctldStatus = "already_running";
        }
      }

      socket.emit("settings-data", {
        settings: rigctldSettings,
        autoStart: autoStartEnabled,
        videoAutoStart: videoAutoStart,
        videoSettings: videoSettings,
        audioSettings: audioSettings,
        pollRate: pollRate,
        autoconnectEligible: autoconnectEligible,
        clientHost: clientHost,
        clientPort: clientPort,
        isConnected: isConnected
      });
      emitRigctldStatus();
      socket.emit("rigctld-log", rigctldLogs);
      // Inform this client of current video source status; if streaming, also send last keyframe
      console.log(`[VIDEO] New client ${socket.id} connected. videoStatus=${videoStatus} hasKeyframe=${!!lastKeyframe}`);
      socket.emit("video-source-status", {
        status: videoStatus,
        videoWidth: videoSettings.videoWidth,
        videoHeight: videoSettings.videoHeight,
        framerate: videoSettings.framerate
      });
      socket.emit("video-devices-list", videoDeviceList);
      if (videoStatus === "streaming" && lastKeyframe) {
        console.log(`[VIDEO] Sending buffered keyframe to ${socket.id}: type=${lastKeyframe.type} dataBytes=${lastKeyframe.data.byteLength} hasDescription=${!!lastKeyframe.description}`);
        socket.emit("video-frame", lastKeyframe);
      }
      socket.emit("audio-status", audioStatus);
      socket.emit("preamp-capabilities", rigctldSettings.preampCapabilities);
      socket.emit("nb-capabilities", { supported: rigctldSettings.nbSupported, range: rigctldSettings.nbLevelRange });
      socket.emit("nr-capabilities", { supported: rigctldSettings.nrSupported, range: rigctldSettings.nrLevelRange });
      socket.emit("mic-active-client", activeMicClientId);
      socket.emit("rfpower-capabilities", { range: rigctldSettings.rfPowerRange });
      socket.emit("anf-capabilities", { supported: rigctldSettings.anfSupported });
      // If the rig is already connected when this client joins, fire rig-connected so the
      // client populates its mode list without needing to witness the original connection event.
      if (isConnected) {
        socket.emit("rig-connected", { host: rigConfig.host, port: rigConfig.port });
      }
    });


    socket.on("get-audio-devices", async () => {
      console.log("[AUDIO] Client requested audio devices list");
      const { inputs, outputs, error } = await listAudioDevices();
      if (error) {
        socket.emit("audio-error", error);
      }
      socket.emit("audio-devices-list", { inputs, outputs });
    });

    socket.on("update-audio-settings", async (settings: any) => {
      console.log("[AUDIO] Updating audio settings:", settings);
      const wasPlaying = audioStatus === "playing";
      audioSettings = { ...audioSettings, ...settings };
      saveSettings();
      io.emit("settings-data", { audioSettings });
      // If audio is running and the device changed, restart with the new device.
      // Without this, the old pacat process keeps the old device open and the
      // new selection has no effect until the user manually stops and restarts.
      if (wasPlaying) {
        await startAudio();
      }
    });

    socket.on("control-audio", async (action: "start" | "stop") => {
      console.log(`[AUDIO] Control action received: ${action}`);
      if (action === "start") {
        await startAudio();
      } else if (action === "stop") {
        await stopAudio();
      }
    });

    socket.on("mic-unmute-request", () => {
      activeMicClientId = clientId;
      console.log(`[AUDIO] Mic claimed by client: ${clientId}`);
      
      // Tell all OTHER clients to mute themselves
      socket.broadcast.emit("mic-mute-forced");
      
      // Tell everyone who currently holds the mic (for UI indicator)
      io.emit("mic-active-client", activeMicClientId);
    });

    socket.on("mic-mute-notify", () => {
      // Client is voluntarily muting — release the mic if they held it
      if (activeMicClientId === clientId) {
        activeMicClientId = null;
        io.emit("mic-active-client", null);
      }
    });

    let outboundDiagCount = 0;
    let outboundRecvCount = 0;
    socket.on("audio-outbound", (data: Buffer) => {
      outboundRecvCount++;
      if (outboundRecvCount <= 5 || outboundRecvCount % 50 === 0) {
        console.log(`[AUDIO-DIAG] audio-outbound received #${outboundRecvCount} from clientId=${clientId}, bytes=${data.length}, activeMic=${activeMicClientId}, ptt=${lastStatus.ptt}`);
      }
      if (activeMicClientId !== clientId) return; // Only accept audio from the active mic
      if (!audioOutputProcess || !opusDecoder) return;
      if (!lastStatus.ptt) return; // Drop when PTT is off; timer keeps stream alive with silence

      try {
        const pcmData = opusDecoder.decode(data);
        if (outboundDiagCount < 5) {
          console.log(`[AUDIO-DIAG] encoded packet bytes=${data.length} decoded bytes=${pcmData.length} (expected 1920 for 48kHz/mono/20ms)`);
          outboundDiagCount++;
        }
        outboundJitterBuffer.push(pcmData);
        // Cap to prevent unbounded growth if the write timer falls behind
        while (outboundJitterBuffer.length > OUTBOUND_JITTER_MAX) {
          outboundJitterBuffer.shift();
        }
      } catch (err) {
        console.error("[AUDIO-OUT] Opus decode error:", err);
      }
    });

    // Any client can request the current video device list.
    socket.on("get-video-devices", () => {
      socket.emit("video-devices-list", videoDeviceList);
    });

    // The Electron source pushes its enumerated camera device list up to the server.
    socket.on("video-devices-update", (devices: { id: string; label: string }[]) => {
      console.log(`[VIDEO] Device list updated by source (${devices.length} devices):`, devices.map(d => d.label));
      videoDeviceList = devices;
      io.emit("video-devices-list", videoDeviceList);
    });

    // Any client can update video settings; server saves and broadcasts to all (including Electron source).
    socket.on("update-video-settings", (settings: { device?: string; videoWidth?: number; videoHeight?: number; framerate?: string }) => {
      console.log("[VIDEO] Updating video settings:", settings);
      videoSettings = { ...videoSettings, ...settings };
      saveSettings();
      io.emit("video-settings-updated", videoSettings);
    });

    // Any client can request the Electron source to start streaming.
    socket.on("request-video-start", () => {
      console.log(`[VIDEO] Start requested by socket=${socket.id}`);
      videoAutoStart = true;
      saveSettings();
      io.emit("video-start-requested");
    });

    // Any client can request the Electron source to stop streaming.
    socket.on("request-video-stop", () => {
      console.log(`[VIDEO] Stop requested by socket=${socket.id}`);
      videoAutoStart = false;
      saveSettings();
      io.emit("video-stop-requested");
    });

    // Electron source announces it has started capturing and encoding.
    socket.on("video-source-start", (config: { device: string; videoWidth: number; videoHeight: number; framerate: string }) => {
      console.log(`[VIDEO] Source started: socket=${socket.id}`, config);
      videoSourceSocketId = socket.id;
      lastKeyframe = null;
      videoSettings = { ...videoSettings, ...config };
      videoStatus = "streaming";
      videoAutoStart = true;
      saveSettings();
      io.emit("video-source-status", {
        status: "streaming",
        videoWidth: config.videoWidth,
        videoHeight: config.videoHeight,
        framerate: config.framerate
      });
    });

    // Encoded H.264 video chunk from the Electron source — relay to all other clients.
    let videoFrameRelayCount = 0;
    socket.on("video-frame", (chunk: { data: Buffer; type: string; timestamp: number; description?: Buffer }) => {
      if (socket.id !== videoSourceSocketId) return; // Only accept frames from the registered source
      if (chunk.type === "key") {
        lastKeyframe = chunk; // Buffer latest keyframe for late-joining clients
      }
      videoFrameRelayCount++;
      if (chunk.type === "key" || videoFrameRelayCount <= 5) {
        console.log(`[VIDEO] Relaying frame #${videoFrameRelayCount} type=${chunk.type} dataBytes=${chunk.data.byteLength} connectedClients=${io.engine.clientsCount}`);
      }
      socket.broadcast.emit("video-frame", chunk);
    });

    // Electron source announces it has stopped capturing.
    socket.on("video-source-stop", () => {
      if (socket.id !== videoSourceSocketId) return;
      console.log("[VIDEO] Source stopped.");
      videoSourceSocketId = null;
      lastKeyframe = null;
      videoStatus = "stopped";
      videoAutoStart = false;
      saveSettings();
      io.emit("video-source-status", { status: "stopped" });
    });

    socket.on("save-settings", (data) => {
      const oldRigNumber = rigctldSettings.rigNumber;
      
      // Handle both flat and nested data for backward compatibility
      if (data.settings) {
        rigctldSettings = { ...rigctldSettings, ...data.settings };
      } else {
        // If it's the old flat format, we need to filter out top-level fields
        const { pollRate: pr, clientHost: ch, clientPort: cp, ...rest } = data;
        rigctldSettings = { ...rigctldSettings, ...rest };
      }

      if (data.pollRate !== undefined) {
        pollRate = Number(data.pollRate);
        startPolling(); // Restart polling with new rate
      }
      if (data.clientHost !== undefined) clientHost = data.clientHost;
      if (data.clientPort !== undefined) clientPort = Number(data.clientPort);

      saveSettings();
      if (oldRigNumber !== rigctldSettings.rigNumber) {
        fetchRadioCapabilities(rigctldSettings.rigNumber);
      }
    });

    socket.on("toggle-auto-start", (enabled) => {
      autoStartEnabled = enabled;
      saveSettings();
      if (enabled) {
        startRigctld();
      } else {
        stopRigctld();
      }
    });

    socket.on("start-rigctld", () => {
      autoStartEnabled = true;
      saveSettings();
      startRigctld();
    });

    socket.on("kill-existing-rigctld", async () => {
      addLog("Killing existing rigctld process...");
      await killExistingRigctld();
      addLog("Existing rigctld killed. Starting new process...");
      startRigctld();
    });

    socket.on("stop-rigctld", () => {
      autoStartEnabled = false;
      saveSettings();
      stopRigctld();
    });

    socket.on("test-rigctld", async (data) => {
      const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = data;
      
      addLog("Testing rigctld configuration...");
      
      // 1. Check if rigctld exists and its version
      rigctldVersion = await getRigctldVersion();
      isRigctldVersionSupported = checkVersionSupported(rigctldVersion);
      console.log(`[HAMLIB] Test rigctld version check: ${rigctldVersion || "unknown"}`);
      addLog(`Hamlib (rigctld) version check: ${rigctldVersion || "unknown"}`);
      emitRigctldStatus();

      if (!rigctldVersion) {
        socket.emit("test-result", { success: false, message: "rigctld binary not found in system PATH or bin folder" });
        addLog("Error: rigctld binary not found");
        return;
      }

      if (!isRigctldVersionSupported) {
        addLog(`Warning: rigctld version ${rigctldVersion} is less than 4.7.0 and is unsupported.`);
      }
      
      // 2. Try to start it briefly
      const testProc = spawn(getRigctldPath(), [
        "-m", rigNumber,
        "-r", serialPort,
        "-t", portNumber,
        "-T", ipAddress,
        "-s", serialPortSpeed
      ]);
        
        let errorMsg = "";
        testProc.stderr?.on("data", (d) => errorMsg += d.toString());
        
        const timeout = setTimeout(() => {
          testProc.kill();
          socket.emit("test-result", { success: true, message: "Configuration looks valid (process started successfully)" });
          addLog("Test: Success");
        }, 2000);
        
        testProc.on("error", (err) => {
          clearTimeout(timeout);
          socket.emit("test-result", { success: false, message: `Failed to start: ${err.message}` });
          addLog(`Test Failed: ${err.message}`);
        });
        
        testProc.on("close", (c) => {
          clearTimeout(timeout);
          if (c !== null && c !== 0) {
            socket.emit("test-result", { success: false, message: `Process exited with code ${c}. Error: ${errorMsg}` });
            addLog(`Test Failed: ${errorMsg}`);
          }
        });
      });

    socket.on("get-radios", () => {
      if (fs.existsSync(RADIOS_FILE)) {
        try {
          const radios = JSON.parse(fs.readFileSync(RADIOS_FILE, "utf-8"));
          socket.emit("radios-list", radios);
        } catch (e) {
          console.error("Failed to load radios:", e);
          socket.emit("radios-list", []);
        }
      } else {
        socket.emit("radios-list", []);
      }
    });

    socket.on("send-raw", async (cmd) => {
      try {
        const resp = await sendToRig(cmd, false, true);
        socket.emit("raw-response", { cmd, resp });
      } catch (err) {
        socket.emit("raw-response", { cmd, resp: `Error: ${err}` });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected (Socket ID: ${socket.id}, Client ID: ${clientId})`);
      // If the video source disconnects, clear its state and notify all other clients
      if (socket.id === videoSourceSocketId) {
        console.log("[VIDEO] Source client disconnected — stopping stream.");
        videoSourceSocketId = null;
        lastKeyframe = null;
        videoStatus = "stopped";
        videoAutoStart = false;
        saveSettings();
        io.emit("video-source-status", { status: "stopped" });
      }
      if (activeMicClientId === clientId) {
        // Give the client 5 seconds to reconnect before releasing the mic
        setTimeout(() => {
          let hasActiveSocket = false;
          io.sockets.sockets.forEach(s => {
            if ((s.handshake.auth.clientId || s.id) === clientId) {
              hasActiveSocket = true;
            }
          });
          
          if (!hasActiveSocket && activeMicClientId === clientId) {
            console.log(`[AUDIO] Releasing mic for disconnected client: ${clientId}`);
            activeMicClientId = null;
            io.emit("mic-active-client", null);
          }
        }, 5000);
      }
    });
  });

  if (process.env.NODE_ENV !== "production" && !process.versions.electron) {
    try {
      // Use a dynamic string to prevent bundlers from statically analyzing the import
      const v = ["v", "i", "t", "e"].join("");
      const { createServer: createViteServer } = await import(v);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite development middleware loaded.");
    } catch (e) {
      console.warn("Vite middleware not loaded:", e);
    }
  } else {
    // In production or Electron, serve static files
    let distPath;
    if (process.versions.electron && appPath) {
      // In Electron production, dist is relative to the app path
      distPath = path.join(appPath, "dist");
    } else {
      distPath = path.join(process.cwd(), "dist");
    }

    console.log(`Serving static files from: ${distPath}`);

    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        const indexPath = path.join(distPath, "index.html");
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          console.error(`File not found: ${indexPath}`);
          res.status(404).send(`Not Found: index.html missing in ${distPath}`);
        }
      });
    } else {
      console.error(`Static directory not found: ${distPath}`);
      app.get("*", (req, res) => {
        res.status(404).send(`Static directory not found: ${distPath}. Current directory: ${process.cwd()}`);
      });
    }
  }

  return new Promise<void>((resolve) => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

if (!process.env.ELECTRON_RUN && !process.versions.electron) {
  console.log("Starting server in standalone mode...");
  startServer().catch(err => {
    console.error("CRITICAL: Failed to start server:", err);
    process.exit(1);
  });
}
