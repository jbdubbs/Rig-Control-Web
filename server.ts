import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import net from "net";
import path from "path";
import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";
import { EventEmitter } from "events";

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

  const getFfmpegPath = (): string => {
    let platformDir = "";
    if (process.platform === "win32") platformDir = "windows";
    else if (process.platform === "linux") platformDir = "linux";
    else if (process.platform === "darwin") platformDir = "mac";
    
    const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    
    let binBase = baseDir;
    if (baseDir.endsWith(".asar")) {
      binBase = baseDir.replace(".asar", ".asar.unpacked");
    }
    
    const localPath = platformDir ? path.join(binBase, "bin", platformDir, binaryName) : "";
    
    if (localPath && fs.existsSync(localPath)) {
      console.log(`[VIDEO] Using bundled ffmpeg at: ${localPath}`);
      return localPath;
    }
    
    console.log(`[VIDEO] Bundled ffmpeg not found at ${localPath || "unsupported platform"}, falling back to system PATH`);
    return "ffmpeg";
  };

  let videoProcess: ChildProcess | null = null;
  const videoEmitter = new EventEmitter();
  videoEmitter.setMaxListeners(0);

  let videoSettings = {
    device: "",
    resolution: "",
    framerate: ""
  };
  let videoStatus: "playing" | "paused" | "stopped" = "stopped";
  let videoConnections = 0;
  
  let audioSettings = {
    inputDevice: "",
    outputDevice: "",
    inboundEnabled: false,
    outboundEnabled: false
  };
  let audioStatus: "playing" | "stopped" = "stopped";
  let inboundAudioProcess: ChildProcess | null = null;
  let outboundAudioProcess: ChildProcess | null = null;
  let activeMicClientId: string | null = null;

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
        videoSettings = { ...videoSettings, ...data.videoSettings };
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

  const listVideoDevices = (): Promise<{ devices: string[], error?: string }> => {
    return new Promise((resolve) => {
      const ffmpegPath = getFfmpegPath();
      let cmd = "";
      if (process.platform === "linux") {
        cmd = "v4l2-ctl --list-devices || ls /dev/video*";
      } else if (process.platform === "win32") {
        cmd = `"${ffmpegPath}" -list_devices true -f dshow -i dummy 2>&1`;
      } else if (process.platform === "darwin") {
        cmd = `"${ffmpegPath}" -f avfoundation -list_devices true -i "" 2>&1`;
      }

      if (!cmd) return resolve({ devices: [] });

      exec(cmd, (err, stdout, stderr) => {
        const output = stdout + stderr;
        const devices: string[] = [];
        let error: string | undefined;
        
        if (process.platform === "linux") {
          const lines = output.split("\n");
          lines.forEach(line => {
            if (line.includes("/dev/video")) {
              const match = line.match(/\/dev\/video\d+/);
              if (match && !devices.includes(match[0])) {
                devices.push(match[0]);
              }
            }
          });
        } else if (process.platform === "win32") {
          const lines = output.split("\n");
          let inDirectShow = false;
          lines.forEach(line => {
            const lowerLine = line.toLowerCase();
            // FFmpeg output for dshow devices
            if (lowerLine.includes("directshow video devices")) inDirectShow = true;
            if (lowerLine.includes("directshow audio devices")) inDirectShow = false;
            
            if (inDirectShow && line.includes("\"")) {
              const match = line.match(/"([^"]+)"/);
              if (match) {
                const deviceName = match[1];
                // Filter out alternative names (starting with @device_pnp_)
                if (!deviceName.startsWith("@device_pnp_") && !devices.includes(deviceName)) {
                  devices.push(deviceName);
                }
              }
            }
          });
          
          // Fallback parsing: look for anything in quotes followed by (video)
          if (devices.length === 0) {
            lines.forEach(line => {
              if (line.includes("\"") && line.toLowerCase().includes("(video)")) {
                const match = line.match(/"([^"]+)"/);
                if (match && !match[1].startsWith("@device_pnp_") && !devices.includes(match[1])) {
                  devices.push(match[1]);
                }
              }
            });
          }
          
          // If still no devices from ffmpeg, try PowerShell as a discovery fallback
          if (devices.length === 0) {
            console.log("[VIDEO] No devices found via ffmpeg, trying PowerShell fallback...");
            const psCmd = 'powershell -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Service -eq \'usbvideo\' } | Select-Object -ExpandProperty Caption"';
            exec(psCmd, (psErr, psStdout) => {
              if (!psErr && psStdout.trim()) {
                const psDevices = psStdout.split("\n").map(d => d.trim()).filter(Boolean);
                psDevices.forEach(d => {
                  if (!devices.includes(d)) devices.push(d);
                });
                console.log(`[VIDEO] PowerShell found ${devices.length} devices:`, devices);
                resolve({ devices, error });
              } else {
                if (err) {
                  console.error("[VIDEO] Failed to list Windows video devices via ffmpeg:", err.message);
                  if (output.includes("not recognized") || output.includes("not found")) {
                    error = "ffmpeg not found in system PATH. Please install ffmpeg to use the video feed feature.";
                    console.error(`[VIDEO] ${error}`);
                  }
                }
                console.log(`[VIDEO] Found ${devices.length} video devices on ${process.platform}:`, devices);
                resolve({ devices, error });
              }
            });
            return; // Exit early as we're resolving inside the nested exec
          }
        } else if (process.platform === "darwin") {
          const lines = output.split("\n");
          let inVideo = false;
          lines.forEach(line => {
            if (line.includes("AVFoundation video devices")) inVideo = true;
            if (line.includes("AVFoundation audio devices")) inVideo = false;
            if (inVideo && line.match(/\[\d+\]/)) {
              const parts = line.split("]");
              if (parts.length > 1) {
                const deviceName = parts[1].trim();
                if (!devices.includes(deviceName)) {
                  devices.push(deviceName);
                }
              }
            }
          });
        }
        
        console.log(`[VIDEO] Found ${devices.length} video devices on ${process.platform}:`, devices);
        resolve({ devices, error });
      });
    });
  };

  const listAudioDevices = (): Promise<{ inputs: string[], outputs: string[], error?: string }> => {
    return new Promise((resolve) => {
      const ffmpegPath = getFfmpegPath();
      let cmd = "";
      if (process.platform === "linux") {
        // Try pactl first for PulseAudio/Pipewire, fallback to arecord/aplay
        cmd = "pactl list short sources && pactl list short sinks || (arecord -l && aplay -l)";
      } else if (process.platform === "win32") {
        cmd = `"${ffmpegPath}" -list_devices true -f dshow -i dummy 2>&1`;
      } else if (process.platform === "darwin") {
        cmd = `"${ffmpegPath}" -f avfoundation -list_devices true -i "" 2>&1`;
      }

      if (!cmd) return resolve({ inputs: [], outputs: [] });

      exec(cmd, (err, stdout, stderr) => {
        const output = stdout + stderr;
        const inputs: string[] = [];
        const outputs: string[] = [];
        let error: string | undefined;

        if (process.platform === "linux") {
          const lines = output.split("\n");
          
          // Check if we got pactl output (usually starts with numbers or has tab-separated fields)
          const isPactl = output.includes("\t") || lines.some(l => /^\d+\s+/.test(l));
          
          if (isPactl) {
            let parsingSinks = false;
            lines.forEach(line => {
              if (line.includes("List of PLAYBACK Hardware Devices")) {
                // This means we fell back to aplay -l mid-stream or it's mixed
                return;
              }
              const parts = line.split("\t");
              if (parts.length >= 2) {
                const name = parts[1];
                // Sources are usually inputs, Sinks are outputs
                // pactl list short sources lists sources
                // pactl list short sinks lists sinks
                // We need to know which is which. 
                // Let's re-run them separately if needed, but for now let's try to parse
                if (name.includes(".monitor")) {
                  // Usually monitors are not what we want for primary input
                  // but we'll include them for now
                }
                
                // In our combined command, we'll just try to guess or use a better approach
              }
            });
            
            // Better approach: run them separately to be sure
            exec("pactl list short sources", (errS, stdoutS) => {
              const inLines = stdoutS.split("\n");
              inLines.forEach(l => {
                const p = l.split("\t");
                if (p.length >= 2) inputs.push(`${p[1]} [pulse]`);
              });
              
              exec("pactl list short sinks", (errO, stdoutO) => {
                const outLines = stdoutO.split("\n");
                outLines.forEach(l => {
                  const p = l.split("\t");
                  if (p.length >= 2) outputs.push(`${p[1]} [pulse]`);
                });
                
                // If we got nothing from pulse, try ALSA
                if (inputs.length === 0 && outputs.length === 0) {
                  // Fallback to ALSA parsing (already implemented below, but we'll just re-run it)
                  exec("arecord -l && aplay -l", (errA, stdoutA) => {
                    parseAlsa(stdoutA, inputs, outputs);
                    resolve({ inputs, outputs });
                  });
                } else {
                  resolve({ inputs, outputs });
                }
              });
            });
            return;
          } else {
            parseAlsa(output, inputs, outputs);
          }
        } else if (process.platform === "win32") {
          const lines = output.split("\n");
          let inAudio = false;
          lines.forEach(line => {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes("directshow audio devices")) inAudio = true;
            if (inAudio && line.includes("\"")) {
              const match = line.match(/"([^"]+)"/);
              if (match) {
                const deviceName = match[1];
                if (!deviceName.startsWith("@device_pnp_")) {
                  inputs.push(deviceName);
                  outputs.push(deviceName); // In dshow, audio devices are often listed once but can be both
                }
              }
            }
          });
        } else if (process.platform === "darwin") {
          const lines = output.split("\n");
          let inAudio = false;
          lines.forEach(line => {
            if (line.includes("AVFoundation audio devices")) inAudio = true;
            if (inAudio && line.match(/\[\d+\]/)) {
              const parts = line.split("]");
              if (parts.length > 1) {
                const deviceName = parts[1].trim();
                inputs.push(deviceName);
                outputs.push(deviceName);
              }
            }
          });
        }

        resolve({ inputs, outputs, error });
      });
    });
  };

  const stopAudio = () => {
    console.log("[AUDIO] Stopping audio streaming...");
    if (inboundAudioProcess) {
      inboundAudioProcess.kill('SIGKILL');
      inboundAudioProcess = null;
    }
    if (outboundAudioProcess) {
      outboundAudioProcess.kill('SIGKILL');
      outboundAudioProcess = null;
    }
    audioStatus = "stopped";
    io.emit("audio-status", audioStatus);
  };

  const parseAlsa = (output: string, inputs: string[], outputs: string[]) => {
    const combinedLines = output.split("\n");
    let parsingOutputs = false;
    
    combinedLines.forEach(line => {
      if (line.includes("List of PLAYBACK Hardware Devices")) {
        parsingOutputs = true;
        return;
      }
      
      if (line.startsWith("card")) {
        const match = line.match(/card (\d+): (.*), device (\d+): (.*)/);
        if (match) {
          const cardNum = match[1];
          const cardName = match[2].trim();
          const deviceNum = match[3];
          const deviceName = match[4].trim();
          const hwId = `hw:${cardNum},${deviceNum}`;
          const displayName = `${cardName}: ${deviceName} [${hwId}]`;
          
          if (parsingOutputs) {
            outputs.push(displayName);
          } else {
            inputs.push(displayName);
          }
        }
      }
    });
  };

  const startAudio = () => {
    console.log("[AUDIO] Starting audio streaming...");
    stopAudio();

    if (!audioSettings.inputDevice && !audioSettings.outputDevice) {
      console.warn("[AUDIO] Cannot start audio: No devices selected.");
      return;
    }

    // Inbound: Backend -> Frontend
    if (audioSettings.inputDevice) {
      let inputDevice = audioSettings.inputDevice;
      // Extract hw:x,x from "Name [hw:x,x]" if present
      const hwMatch = inputDevice.match(/\[(hw:\d+,\d+)\]/);
      if (hwMatch) {
        inputDevice = hwMatch[1];
        // Use plughw for better compatibility with different sample rates/channels
        if (process.platform === "linux") {
          inputDevice = inputDevice.replace("hw:", "plughw:");
        }
      }

      if (process.platform === "linux") {
        if (inputDevice.includes("[pulse]")) {
          const pulseDevice = inputDevice.split(" [pulse]")[0];
          const pacatArgs = [
            "--record",
            "--device", pulseDevice,
            "--format", "s16le",
            "--rate", "16000",
            "--channels", "1",
            "--raw",
            "--latency-msec=20",
            "--process-time-msec=10"
          ];
          console.log(`[AUDIO-IN] Spawning pacat: pacat ${pacatArgs.join(" ")}`);
          inboundAudioProcess = spawn("pacat", pacatArgs);
          
          inboundAudioProcess.stdout?.on("data", (data) => {
            io.emit("audio-inbound", data);
          });

          inboundAudioProcess.stderr?.on("data", (data) => {
            console.log(`[AUDIO-IN-PACAT] ${data.toString()}`);
          });

          inboundAudioProcess.on("error", (err) => {
            console.error("[AUDIO-IN] pacat process error:", err);
          });

          inboundAudioProcess.on("close", (code) => {
            console.log(`[AUDIO-IN] pacat process closed with code ${code}`);
          });
        } else {
          // Workaround for bundled FFmpeg missing ALSA support: use arecord directly
          const arecordArgs = [
            "-D", inputDevice,
            "-f", "S16_LE",
            "-r", "16000",
            "-c", "1",
            "-t", "raw",
            "--buffer-size=1024"
          ];
          console.log(`[AUDIO-IN] Spawning arecord: arecord ${arecordArgs.join(" ")}`);
          inboundAudioProcess = spawn("arecord", arecordArgs);
          
          inboundAudioProcess.stdout?.on("data", (data) => {
            io.emit("audio-inbound", data);
          });

          inboundAudioProcess.stderr?.on("data", (data) => {
            console.log(`[AUDIO-IN-ARECORD] ${data.toString()}`);
          });

          inboundAudioProcess.on("error", (err) => {
            console.error("[AUDIO-IN] arecord process error:", err);
          });

          inboundAudioProcess.on("close", (code) => {
            console.log(`[AUDIO-IN] arecord process closed with code ${code}`);
          });
        }
      } else {
        let inputFormat = "";
        if (process.platform === "win32") {
          inputFormat = "dshow";
          inputDevice = `audio=${audioSettings.inputDevice}`;
        } else if (process.platform === "darwin") {
          inputFormat = "avfoundation";
        }

        const inboundArgs = [
          "-f", inputFormat,
          "-thread_queue_size", "1024",
          "-ar", "16000",
          "-ac", "1",
          "-i", inputDevice,
          "-fflags", "nobuffer",
          "-probesize", "32",
          "-analyzeduration", "0",
          "-f", "s16le",
          "-ac", "1",
          "-ar", "16000",
          "pipe:1"
        ];

        const ffmpegPath = getFfmpegPath();
        console.log(`[AUDIO-IN] Spawning FFmpeg: ${ffmpegPath} ${inboundArgs.join(" ")}`);
        inboundAudioProcess = spawn(ffmpegPath, inboundArgs);
        
        inboundAudioProcess.stdout?.on("data", (data) => {
          io.emit("audio-inbound", data);
        });

        inboundAudioProcess.stderr?.on("data", (data) => {
          console.log(`[AUDIO-IN-FFMPEG] ${data.toString()}`);
        });

        inboundAudioProcess.on("error", (err) => {
          console.error("[AUDIO-IN] FFmpeg process error:", err);
        });

        inboundAudioProcess.on("close", (code) => {
          console.log(`[AUDIO-IN] FFmpeg process closed with code ${code}`);
        });
      }
    }

    // Outbound: Frontend -> Backend
    if (audioSettings.outputDevice) {
      let outputDevice = audioSettings.outputDevice;
      // Extract hw:x,x from "Name [hw:x,x]" if present
      const hwMatch = outputDevice.match(/\[(hw:\d+,\d+)\]/);
      if (hwMatch) {
        outputDevice = hwMatch[1];
        // Use plughw for better compatibility with different sample rates/channels
        if (process.platform === "linux") {
          outputDevice = outputDevice.replace("hw:", "plughw:");
        }
      }

      if (process.platform === "linux") {
        if (outputDevice.includes("[pulse]")) {
          const pulseDevice = outputDevice.split(" [pulse]")[0];
          const pacatArgs = [
            "--playback",
            "--device", pulseDevice,
            "--format", "s16le",
            "--rate", "16000",
            "--channels", "1",
            "--raw",
            "--latency-msec=100",
            "--process-time-msec=50"
          ];
          console.log(`[AUDIO-OUT] Spawning pacat: pacat ${pacatArgs.join(" ")}`);
          outboundAudioProcess = spawn("pacat", pacatArgs);
          
          outboundAudioProcess.stderr?.on("data", (data) => {
            console.log(`[AUDIO-OUT-PACAT] ${data.toString()}`);
          });

          outboundAudioProcess.on("error", (err) => {
            console.error("[AUDIO-OUT] pacat process error:", err);
          });

          outboundAudioProcess.on("close", (code) => {
            console.log(`[AUDIO-OUT] pacat process closed with code ${code}`);
          });
        } else {
          // Workaround for bundled FFmpeg missing ALSA support: use aplay directly
          const aplayArgs = [
            "-D", outputDevice,
            "-f", "S16_LE",
            "-r", "16000",
            "-c", "1",
            "-t", "raw",
            "--buffer-size=1024"
          ];
          console.log(`[AUDIO-OUT] Spawning aplay: aplay ${aplayArgs.join(" ")}`);
          outboundAudioProcess = spawn("aplay", aplayArgs);
          
          outboundAudioProcess.stderr?.on("data", (data) => {
            console.log(`[AUDIO-OUT-APLAY] ${data.toString()}`);
          });

          outboundAudioProcess.on("error", (err) => {
            console.error("[AUDIO-OUT] aplay process error:", err);
          });

          outboundAudioProcess.on("close", (code) => {
            console.log(`[AUDIO-OUT] aplay process closed with code ${code}`);
          });
        }
      } else {
        let outputFormat = "";
        if (process.platform === "win32") {
          outputFormat = "dshow";
          outputDevice = `audio=${audioSettings.outputDevice}`;
        } else if (process.platform === "darwin") {
          outputFormat = "avfoundation";
        }

        const outboundArgs = [
          "-f", "s16le",
          "-ac", "1",
          "-ar", "16000",
          "-i", "pipe:0",
          "-fflags", "nobuffer",
          "-probesize", "32",
          "-analyzeduration", "0",
          "-f", outputFormat,
          outputDevice
        ];

        const ffmpegPath = getFfmpegPath();
        console.log(`[AUDIO-OUT] Spawning FFmpeg: ${ffmpegPath} ${outboundArgs.join(" ")}`);
        outboundAudioProcess = spawn(ffmpegPath, outboundArgs);

        outboundAudioProcess.stderr?.on("data", (data) => {
          console.log(`[AUDIO-OUT-FFMPEG] ${data.toString()}`);
        });

        outboundAudioProcess.on("error", (err) => {
          console.error("[AUDIO-OUT] FFmpeg process error:", err);
        });

        outboundAudioProcess.on("close", (code) => {
          console.log(`[AUDIO-OUT] FFmpeg process closed with code ${code}`);
        });
      }
    }

    audioStatus = "playing";
    io.emit("audio-status", audioStatus);
  };

  const stopVideo = () => {
    console.log("[VIDEO] Stopping video feed...");
    videoEmitter.emit("stop-clients"); // Force close all active MJPEG connections
    if (videoProcess) {
      console.log(`[VIDEO] Killing ffmpeg process (PID: ${videoProcess.pid})`);
      videoProcess.kill('SIGKILL');
      videoProcess = null;
    } else {
      console.log("[VIDEO] No active video process to stop.");
    }
    videoStatus = "stopped";
    io.emit("video-status", videoStatus);
  };

  const startVideo = () => {
    console.log("[VIDEO] Starting video feed...");
    stopVideo();
    if (!videoSettings.device || !videoSettings.resolution || !videoSettings.framerate) {
      console.warn("[VIDEO] Cannot start video: Missing settings (device, resolution, or framerate).");
      return;
    }

    let inputFormat = "";
    let inputDevice = videoSettings.device;
    
    console.log(`[VIDEO] Platform detected: ${process.platform}`);
    if (process.platform === "linux") {
      inputFormat = "v4l2";
    } else if (process.platform === "win32") {
      inputFormat = "dshow";
      inputDevice = `video=${videoSettings.device}`;
    } else if (process.platform === "darwin") {
      inputFormat = "avfoundation";
    }
    console.log(`[VIDEO] Using input format: ${inputFormat}, device: ${inputDevice}`);

    const args = [
      "-f", inputFormat,
      "-framerate", videoSettings.framerate,
      "-video_size", videoSettings.resolution,
      "-i", inputDevice,
      "-vf", `scale=${videoSettings.resolution.replace('x', ':')}`,
      "-f", "mpjpeg",
      "-q:v", "5",
      "pipe:1"
    ];

    const ffmpegPath = getFfmpegPath();
    console.log(`[VIDEO] Executing: ${ffmpegPath} ${args.join(" ")}`);
    const currentProcess = spawn(ffmpegPath, args);
    videoProcess = currentProcess;
    
    let hasReceivedData = false;
    const startupTimeout = setTimeout(() => {
      if (!hasReceivedData && videoProcess === currentProcess) {
        console.error("[VIDEO] ffmpeg failed to produce data within 10s. Stopping.");
        videoAutoStart = false;
        saveSettings();
        stopVideo();
        io.emit("video-error", "Video device failed to start producing data. Please check if it is in use by another application.");
      }
    }, 10000);

    currentProcess.stdout?.on("data", (data) => {
      if (!hasReceivedData && videoProcess === currentProcess) {
        hasReceivedData = true;
        clearTimeout(startupTimeout);
        console.log("[VIDEO] First data chunk received. Stream is now playing.");
        videoStatus = "playing";
        videoAutoStart = true;
        saveSettings();
        io.emit("video-status", videoStatus);
      }
      
      if (videoEmitter.listenerCount("data") > 0) {
        videoEmitter.emit("data", data);
      }
    });

    currentProcess.stderr?.on("data", (data) => {
      const msg = data.toString();
      if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("failed") || msg.toLowerCase().includes("cannot open")) {
        console.error(`[VIDEO] ffmpeg stderr: ${msg.trim()}`);
      }
    });

    currentProcess.on("error", (err) => {
      if (videoProcess === currentProcess) {
        console.error("[VIDEO] ffmpeg process error:", err);
        stopVideo();
      }
    });

    currentProcess.on("exit", (code, signal) => {
      if (videoProcess === currentProcess) {
        console.log(`[VIDEO] Current ffmpeg process exited with code ${code} and signal ${signal}`);
        videoStatus = "stopped";
        io.emit("video-status", videoStatus);
        videoProcess = null;
        clearTimeout(startupTimeout);
      } else {
        console.log(`[VIDEO] Old ffmpeg process (PID: ${currentProcess.pid}) exited with code ${code} and signal ${signal}`);
      }
    });
  };

  // Express route for MJPEG stream
  app.get("/api/video-stream", (req, res) => {
    const sessionId = (req.query.sessionId as string) || "default";

    // Kill any existing stream connections for THIS SESSION ONLY to prevent resource exhaustion
    // and ensure only the latest client for this window is active (last-one-wins per session).
    // This prevents the "6 connection limit" issue in browsers while allowing multiple windows.
    videoEmitter.emit(`stop-clients-${sessionId}`);

    videoConnections++;
    console.log(`[VIDEO] New stream client connected (Session: ${sessionId}). Total clients: ${videoConnections}`);

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache'
    });

    let isClosed = false;
    let isCongested = false;
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      videoConnections--;
      console.log(`[VIDEO] Stream client disconnected (Session: ${sessionId}). Total clients: ${videoConnections}`);
      videoEmitter.removeListener("data", onData);
      videoEmitter.removeListener("stop-clients", cleanup);
      videoEmitter.removeListener(`stop-clients-${sessionId}`, cleanup);
      res.end();
    };

    const onData = (data: Buffer) => {
      if (isClosed || isCongested) return;
      
      const flushed = res.write(data);
      if (!flushed) {
        // Backpressure detected: drop subsequent frames until the buffer is drained
        isCongested = true;
        res.once('drain', () => {
          isCongested = false;
        });
      }
    };

    videoEmitter.on("data", onData);
    videoEmitter.once("stop-clients", cleanup);
    videoEmitter.once(`stop-clients-${sessionId}`, cleanup);

    req.on("close", cleanup);
    req.on("end", cleanup);
    res.on("error", cleanup);
  });

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

  // Start video on server boot if enabled and settings are complete
  if (videoAutoStart && videoSettings.device && videoSettings.resolution && videoSettings.framerate) {
    console.log("[VIDEO] Auto-starting video feed on boot...");
    startVideo();
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

  const sendToRig = (cmd: string, useExtended = false): Promise<string> => {
    return new Promise((resolve, reject) => {
      rigCommandQueue.push({ cmd, useExtended, resolve, reject });
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
      
      // Poll all items at the user-selected pollRate
      const ptt = await sendToRig("t", true);
      const smeter = await sendToRig("l STRENGTH", true);
      const isPttActive = ptt === "1";
      
      let alc = "0";
      let powerMeter = "0";
      let swr = "1.0";

      if (isPttActive) {
        try {
          alc = await sendToRig("l ALC", true);
          powerMeter = await sendToRig("l RFPOWER_METER", true);
          swr = await sendToRig("l SWR", true);
        } catch (e) {
          console.warn("TX levels poll failed, might not be supported");
        }
      }

      // VDD Poll (Conditional)
      let vdd = lastStatus.vdd?.toString() || "13.8";
      if (visibleMeters.includes('vdd')) {
        vdd = await sendToRig("l VD_METER", true).catch(() => "13.8");
      }

      const frequency = await sendToRig("f", true);
      const modeBw = await sendToRig("m", true);
      const [mode, bandwidth] = modeBw.split("\n");
      let rfpower = parseFloat(await sendToRig("l RFPOWER", true));
      const rflevel = parseFloat(await sendToRig("l RF", true).catch(() => "0"));
      const agc = parseInt(await sendToRig("l AGC", true).catch(() => "6"));
      const vfo = await sendToRig("v", true);
      const splitInfo = await sendToRig("s", true);
      const [isSplitStr, txVFO] = splitInfo.split("\n");
      const att = parseInt(await sendToRig("l ATT", true)) || 0;
      const preamp = parseInt(await sendToRig("l PREAMP", true)) || 0;
      const nb = (await sendToRig("u NB", true).catch(() => "0")) === "1";
      const nbLevel = parseFloat(await sendToRig("l NB", true).catch(() => "0"));
      const nr = (await sendToRig("u NR", true).catch(() => "0")) === "1";
      const nrLevel = parseFloat(await sendToRig("l NR", true).catch(() => "0"));
      const anf = (await sendToRig("u ANF", true).catch(() => "0")) === "1";
      const tuner = (await sendToRig("u TUNER", true).catch(() => "0")) === "1";

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
        isSplit: isSplitStr === "1",
        txVFO: txVFO || "VFOB",
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
    console.log("Client connected");

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
        await sendToRig(`U ${func} ${state ? "1" : "0"}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${func}`);
      }
    });

    socket.on("set-level", async ({ level, val }) => {
      try {
        await sendToRig(`L ${level} ${val}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${level}`);
      }
    });

    socket.on("set-frequency", async (freq) => {
      try {
        await sendToRig(`F ${freq}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set frequency");
      }
    });

    socket.on("set-mode", async ({ mode, bandwidth }) => {
      try {
        await sendToRig(`M ${mode} ${bandwidth}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set mode/bandwidth");
      }
    });

    socket.on("get-modes", async () => {
      try {
        const modes = await sendToRig("M ?");
        // rigctld might return modes separated by spaces or newlines
        const modeList = modes.split(/[\s\n]+/).filter(Boolean);
        socket.emit("available-modes", modeList);
      } catch (err) {
        console.error("Failed to get modes:", err);
      }
    });

    socket.on("set-ptt", async (ptt) => {
      try {
        await sendToRig(`T ${ptt ? "1" : "0"}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set PTT");
      }
    });

    socket.on("set-vfo", async (vfo) => {
      try {
        await sendToRig(`V ${vfo}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set VFO");
      }
    });

    socket.on("set-split-vfo", async ({ split, txVFO }) => {
      try {
        await sendToRig(`S ${split} ${txVFO}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set split VFO");
      }
    });

    socket.on("vfo-op", async (op) => {
      try {
        await sendToRig(`G ${op}`);
        pollRig();
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
      socket.emit("video-status", videoStatus);
      socket.emit("audio-status", audioStatus);
      socket.emit("preamp-capabilities", rigctldSettings.preampCapabilities);
      socket.emit("nb-capabilities", { supported: rigctldSettings.nbSupported, range: rigctldSettings.nbLevelRange });
      socket.emit("nr-capabilities", { supported: rigctldSettings.nrSupported, range: rigctldSettings.nrLevelRange });
      socket.emit("mic-active-client", activeMicClientId);
      socket.emit("rfpower-capabilities", { range: rigctldSettings.rfPowerRange });
      socket.emit("anf-capabilities", { supported: rigctldSettings.anfSupported });
    });

    socket.on("get-video-devices", async () => {
      console.log("[VIDEO] Client requested video devices list");
      const { devices, error } = await listVideoDevices();
      if (error) {
        socket.emit("video-error", error);
      }
      console.log(`[VIDEO] Found ${devices.length} devices: ${devices.join(", ")}`);
      socket.emit("video-devices-list", devices);
    });

    socket.on("get-audio-devices", async () => {
      console.log("[AUDIO] Client requested audio devices list");
      const { inputs, outputs, error } = await listAudioDevices();
      if (error) {
        socket.emit("audio-error", error);
      }
      socket.emit("audio-devices-list", { inputs, outputs });
    });

    socket.on("update-audio-settings", (settings: any) => {
      console.log("[AUDIO] Updating audio settings:", settings);
      audioSettings = { ...audioSettings, ...settings };
      saveSettings();
      io.emit("settings-data", { audioSettings });
    });

    socket.on("control-audio", (action: "start" | "stop") => {
      console.log(`[AUDIO] Control action received: ${action}`);
      if (action === "start") {
        startAudio();
      } else if (action === "stop") {
        stopAudio();
      }
    });

    socket.on("mic-unmute-request", () => {
      activeMicClientId = socket.id;
      console.log(`[AUDIO] Mic claimed by client: ${socket.id}`);
      
      // Tell all OTHER clients to mute themselves
      socket.broadcast.emit("mic-mute-forced");
      
      // Tell everyone who currently holds the mic (for UI indicator)
      io.emit("mic-active-client", activeMicClientId);
    });

    socket.on("mic-mute-notify", () => {
      // Client is voluntarily muting — release the mic if they held it
      if (activeMicClientId === socket.id) {
        activeMicClientId = null;
        io.emit("mic-active-client", null);
      }
    });

    socket.on("audio-outbound", (data: Buffer) => {
      if (outboundAudioProcess && outboundAudioProcess.stdin) {
        outboundAudioProcess.stdin.write(data);
      }
    });

    socket.on("update-video-settings", (settings: any) => {
      console.log("[VIDEO] Updating video settings:", settings);
      const oldRes = videoSettings.resolution;
      const oldDev = videoSettings.device;
      const oldFps = videoSettings.framerate;
      
      videoSettings = { ...videoSettings, ...settings };
      
      // If settings are cleared, disable auto-start
      if (!videoSettings.device || !videoSettings.resolution || !videoSettings.framerate) {
        videoAutoStart = false;
      }
      
      saveSettings();

      // Restart video if settings changed and it's currently playing
      if (videoStatus === "playing" && (oldRes !== videoSettings.resolution || oldDev !== videoSettings.device || oldFps !== videoSettings.framerate)) {
        console.log("[VIDEO] Settings changed while playing, restarting stream...");
        startVideo();
      }
    });

    socket.on("control-video", (action: "play" | "pause" | "stop") => {
      console.log(`[VIDEO] Control action received: ${action}`);
      if (action === "play") {
        startVideo();
      } else if (action === "pause") {
        // MJPEG doesn't really pause well, we just stop it for now
        console.log("[VIDEO] Pausing (stopping) stream...");
        videoAutoStart = false;
        saveSettings();
        stopVideo();
        videoStatus = "paused";
        io.emit("video-status", videoStatus);
      } else if (action === "stop") {
        videoAutoStart = false;
        saveSettings();
        stopVideo();
      }
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
        const resp = await sendToRig(cmd);
        socket.emit("raw-response", { cmd, resp });
      } catch (err) {
        socket.emit("raw-response", { cmd, resp: `Error: ${err}` });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
      if (activeMicClientId === socket.id) {
        activeMicClientId = null;
        // Notify others that the active client is gone
        io.emit("mic-active-client", null);
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
