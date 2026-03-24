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
  const io = new Server(httpServer);
  const PORT = 3000;

  // appPath is for read-only bundled assets (like radios.json and dist/)
  // userDataPath is for writable user settings (settings.json)
  const baseDir = appPath || process.cwd();
  const dataDir = userDataPath || process.cwd();
  
  const SETTINGS_FILE = path.join(dataDir, "settings.json");
  const RADIOS_FILE = path.join(baseDir, "radios.json");
  
  console.log(`Server initializing. Base directory (assets): ${baseDir}`);
  console.log(`Data directory (settings): ${dataDir}`);
  console.log(`NODE_ENV: ${process.env.NODE_ENV}, Electron: ${!!process.versions.electron}`);

  let rigctldProcess: ChildProcess | null = null;
  let rigctldStatus: "running" | "stopped" | "error" | "already_running" = "stopped";
  let rigctldLogs: string[] = [];
  let autoStartEnabled = false;
  
  const getRigctldPath = (): string => {
    const binDir = path.join(baseDir, "bin");
    const binaryName = process.platform === "win32" ? "rigctld.exe" : "rigctld";
    const localPath = path.join(binDir, binaryName);
    
    if (fs.existsSync(localPath)) {
      console.log(`[HAMLIB] Using bundled rigctld at: ${localPath}`);
      return localPath;
    }
    
    console.log(`[HAMLIB] Bundled rigctld not found at ${localPath}, falling back to system PATH`);
    return "rigctld";
  };

  let videoProcess: ChildProcess | null = null;
  const videoEmitter = new EventEmitter();
  videoEmitter.setMaxListeners(0);

  let videoSettings = {
    device: "",
    resolution: "640x480",
    framerate: "30"
  };
  let videoStatus: "playing" | "paused" | "stopped" = "stopped";
  let videoConnections = 0;
  let rigctldSettings = {
    rigNumber: "",
    serialPort: "",
    portNumber: "4532",
    ipAddress: "127.0.0.1",
    serialPortSpeed: "38400"
  };

  // Load settings if they exist
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      rigctldSettings = { ...rigctldSettings, ...data.settings };
      autoStartEnabled = data.autoStart || false;
      if (data.videoSettings) {
        videoSettings = { ...videoSettings, ...data.videoSettings };
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }

  const saveSettings = () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      settings: rigctldSettings,
      autoStart: autoStartEnabled,
      videoSettings: videoSettings
    }, null, 2));
  };

  const emitRigctldStatus = () => {
    io.emit("rigctld-status", rigctldStatus);
  };

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

  const listVideoDevices = (): Promise<string[]> => {
    return new Promise((resolve) => {
      let cmd = "";
      if (process.platform === "linux") {
        cmd = "v4l2-ctl --list-devices || ls /dev/video*";
      } else if (process.platform === "win32") {
        cmd = "ffmpeg -list_devices true -f dshow -i dummy 2>&1";
      } else if (process.platform === "darwin") {
        cmd = "ffmpeg -f avfoundation -list_devices true -i \"\" 2>&1";
      }

      if (!cmd) return resolve([]);

      exec(cmd, (err, stdout, stderr) => {
        const output = stdout + stderr;
        const devices: string[] = [];
        
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
            if (line.includes("DirectShow video devices")) inDirectShow = true;
            if (line.includes("DirectShow audio devices")) inDirectShow = false;
            if (inDirectShow && line.includes("\"")) {
              const match = line.match(/"([^"]+)"/);
              if (match) devices.push(match[1]);
            }
          });
        } else if (process.platform === "darwin") {
          const lines = output.split("\n");
          let inVideo = false;
          lines.forEach(line => {
            if (line.includes("AVFoundation video devices")) inVideo = true;
            if (line.includes("AVFoundation audio devices")) inVideo = false;
            if (inVideo && line.match(/\[\d+\]/)) {
              const parts = line.split("]");
              if (parts.length > 1) devices.push(parts[1].trim());
            }
          });
        }
        
        resolve(devices);
      });
    });
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
    if (!videoSettings.device) {
      console.warn("[VIDEO] Cannot start video: No device selected in settings.");
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

    console.log(`[VIDEO] Executing: ffmpeg ${args.join(" ")}`);
    const currentProcess = spawn("ffmpeg", args);
    videoProcess = currentProcess;
    
    let hasReceivedData = false;
    const startupTimeout = setTimeout(() => {
      if (!hasReceivedData && videoProcess === currentProcess) {
        console.error("[VIDEO] ffmpeg failed to produce data within 10s. Stopping.");
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
    // Kill any existing stream connections to prevent resource exhaustion
    // and ensure only the latest client is active (last-one-wins).
    // This prevents the "6 connection limit" issue in browsers.
    videoEmitter.emit("stop-clients");

    videoConnections++;
    console.log(`[VIDEO] New stream client connected. Total clients: ${videoConnections}`);

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Pragma': 'no-cache'
    });

    let isClosed = false;
    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      videoConnections--;
      console.log(`[VIDEO] Stream client disconnected. Total clients: ${videoConnections}`);
      videoEmitter.removeListener("data", onData);
      videoEmitter.removeListener("stop-clients", cleanup);
      res.end();
    };

    const onData = (data: Buffer) => {
      if (isClosed) return;
      
      const flushed = res.write(data);
      if (!flushed) {
        // Backpressure detected
        // console.log("[VIDEO] Backpressure detected, dropping frame for one client");
      }
    };

    videoEmitter.on("data", onData);
    videoEmitter.once("stop-clients", cleanup);

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
  let pollRate = 2000;
  let rigConfig = { host: "", port: 0 };
  let isConnected = false;

  const connectToRig = (host: string, port: number, socket?: any) => {
    if (rigSocket) {
      rigSocket.destroy();
      rigSocket = null;
    }

    rigConfig = { host, port };
    rigSocket = new net.Socket();
    
    rigSocket.connect(port, host, () => {
      console.log(`Connected to rigctld at ${host}:${port}`);
      isConnected = true;
      if (socket) socket.emit("rig-connected", { host, port });
      startPolling();
    });

    rigSocket.on("error", (err) => {
      console.error("Rig socket error:", err);
      isConnected = false;
      if (socket) socket.emit("rig-error", `Connection Error: ${err.message}`);
    });

    rigSocket.on("close", () => {
      console.log("Rig connection closed");
      isConnected = false;
      if (socket) socket.emit("rig-disconnected");
      stopPolling();
    });
  };

  const startPolling = () => {
    stopPolling();
    const runPoll = async () => {
      if (!isConnected) return;
      await pollRig();
      pollingTimeout = setTimeout(runPoll, pollRate);
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
      const rfpower = parseFloat(await sendToRig("l RFPOWER", true));
      const rflevel = parseFloat(await sendToRig("l RF", true).catch(() => "0"));
      const agc = parseInt(await sendToRig("l AGC", true).catch(() => "6"));
      const vfo = await sendToRig("v", true);
      const splitInfo = await sendToRig("s", true);
      const [isSplitStr, txVFO] = splitInfo.split("\n");
      const att = parseInt(await sendToRig("l ATT", true)) || 0;
      const preamp = parseInt(await sendToRig("l PREAMP", true)) || 0;
      const nb = (await sendToRig("u NB", true)) === "1";
      const nr = (await sendToRig("u NR", true).catch(() => "0")) === "1";
      const nrRaw = parseFloat(await sendToRig("l NR", true).catch(() => "0"));
      const nrLevel = nrRaw > 1.0 ? nrRaw / 15 : nrRaw;
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
        nr,
        nrLevel,
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
      socket.emit("rig-disconnected");
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
      startPolling();
    });

    socket.on("get-settings", () => {
      socket.emit("settings-data", {
        settings: rigctldSettings,
        autoStart: autoStartEnabled,
        videoSettings: videoSettings
      });
      emitRigctldStatus();
      socket.emit("rigctld-log", rigctldLogs);
      socket.emit("video-status", videoStatus);
    });

    socket.on("get-video-devices", async () => {
      console.log("[VIDEO] Client requested video devices list");
      const devices = await listVideoDevices();
      console.log(`[VIDEO] Found ${devices.length} devices: ${devices.join(", ")}`);
      socket.emit("video-devices-list", devices);
    });

    socket.on("update-video-settings", (settings: any) => {
      console.log("[VIDEO] Updating video settings:", settings);
      const oldRes = videoSettings.resolution;
      const oldDev = videoSettings.device;
      const oldFps = videoSettings.framerate;
      
      videoSettings = { ...videoSettings, ...settings };
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
        stopVideo();
        videoStatus = "paused";
        io.emit("video-status", videoStatus);
      } else if (action === "stop") {
        stopVideo();
      }
    });

    socket.on("save-settings", (data) => {
      rigctldSettings = data;
      saveSettings();
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
      startRigctld();
    });

    socket.on("kill-existing-rigctld", async () => {
      addLog("Killing existing rigctld process...");
      await killExistingRigctld();
      addLog("Existing rigctld killed. Starting new process...");
      startRigctld();
    });

    socket.on("stop-rigctld", () => {
      stopRigctld();
    });

    socket.on("test-rigctld", async (data) => {
      const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = data;
      
      addLog("Testing rigctld configuration...");
      
      // 1. Check if rigctld exists
      const check = spawn(getRigctldPath(), ["-V"]);
      check.on("error", () => {
        socket.emit("test-result", { success: false, message: "rigctld binary not found in system PATH or bin folder" });
        addLog("Error: rigctld binary not found");
      });
      
      check.on("close", (code) => {
        if (code !== 0) return; // Error handled above
        
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

if (process.env.NODE_ENV !== "production" && !process.env.ELECTRON_RUN && !process.versions.electron) {
  startServer();
}
