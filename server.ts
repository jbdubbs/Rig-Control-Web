import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { SettingsManager } from "./server/managers/SettingsManager.js";
import { RigctldManager } from "./server/managers/RigctldManager.js";
import { VideoStreamManager } from "./server/managers/VideoStreamManager.js";
import { AudioManager } from "./server/managers/AudioManager.js";
import { RigConnectionManager } from "./server/managers/RigConnectionManager.js";

export async function startServer(appPath?: string, userDataPath?: string) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    perMessageDeflate: false
  });
  const PORT = 3000;

  const baseDir = appPath || process.cwd();
  const dataDir = userDataPath || (process.env.NODE_ENV === "production" ? "/tmp" : process.cwd());
  
  const RADIOS_FILE = path.join(baseDir, "radios.json");
  
  console.log(`Server initializing. Base directory: ${baseDir}`);
  console.log(`Data directory: ${dataDir}`);

  // Initialize Managers
  const settingsManager = new SettingsManager(dataDir);
  const rigctldManager = new RigctldManager(baseDir, io, settingsManager);
  const videoStreamManager = new VideoStreamManager(baseDir, io, settingsManager);
  const audioManager = new AudioManager(baseDir, io, settingsManager);
  const rigConnectionManager = new RigConnectionManager(io);

  const settings = settingsManager.getSettings();
  rigConnectionManager.setPollRate(settings.pollRate);
  if (settings.clientHost && settings.clientPort) {
    rigConnectionManager.connectToRig(settings.clientHost, settings.clientPort);
  }

  // Auto-start services if enabled
  if (settings.autoStart) {
    rigctldManager.startRigctld();
  }
  if (settings.videoAutoStart) {
    videoStreamManager.startVideo();
  }

  // API Routes
  app.get("/api/video-stream", (req, res) => {
    videoStreamManager.handleStreamRequest(req, res);
  });

  app.get("/opus-decoder.wasm", (req, res) => {
    const wasmPath = path.join(process.cwd(), "node_modules", "opus-recorder", "dist", "decoderWorker.min.wasm");
    res.sendFile(wasmPath);
  });

  app.get("/opus-encoder.wasm", (req, res) => {
    const wasmPath = path.join(process.cwd(), "node_modules", "opus-recorder", "dist", "decoderWorker.min.wasm");
    res.sendFile(wasmPath);
  });

  // Socket.io Events
  io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("connect-rig", ({ host, port }) => {
      rigConnectionManager.connectToRig(host, port);
    });

    socket.on("disconnect-rig", () => {
      rigConnectionManager.disconnectRig();
    });

    socket.on("set-func", async ({ func, state }) => {
      try {
        await rigConnectionManager.sendToRig(`U ${func} ${state ? "1" : "0"}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${func}`);
      }
    });

    socket.on("set-level", async ({ level, val }) => {
      try {
        await rigConnectionManager.sendToRig(`L ${level} ${val}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${level}`);
      }
    });

    socket.on("set-frequency", async (freq) => {
      try {
        await rigConnectionManager.sendToRig(`F ${freq}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set frequency");
      }
    });

    socket.on("set-mode", async ({ mode, bandwidth }) => {
      try {
        await rigConnectionManager.sendToRig(`M ${mode} ${bandwidth}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set mode/bandwidth");
      }
    });

    socket.on("get-modes", async () => {
      try {
        const modes = await rigConnectionManager.sendToRig("M ?");
        const modeList = modes.split(/[\s\n]+/).filter(Boolean);
        socket.emit("available-modes", modeList);
      } catch (err) {
        console.error("Failed to get modes:", err);
      }
    });

    socket.on("set-ptt", async (ptt) => {
      try {
        await rigConnectionManager.sendToRig(`T ${ptt ? "1" : "0"}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set PTT");
      }
    });

    socket.on("set-vfo", async (vfo) => {
      try {
        await rigConnectionManager.sendToRig(`V ${vfo}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set VFO");
      }
    });

    socket.on("set-split-vfo", async ({ split, txVFO }) => {
      try {
        await rigConnectionManager.sendToRig(`S ${split} ${txVFO}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set split VFO");
      }
    });

    socket.on("vfo-op", async (op) => {
      try {
        await rigConnectionManager.sendToRig(`G ${op}`);
        rigConnectionManager.pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to execute VFO operation: ${op}`);
      }
    });

    socket.on("set-visible-meters", (meters: string[]) => {
      rigConnectionManager.setVisibleMeters(meters);
    });

    socket.on("set-poll-rate", (rate) => {
      rigConnectionManager.setPollRate(rate);
      settingsManager.saveSettings({ pollRate: rate });
    });

    socket.on("set-autoconnect-eligible", (eligible) => {
      settingsManager.saveSettings({ autoconnectEligible: eligible });
    });

    socket.on("set-client-config", ({ host, port }) => {
      settingsManager.saveSettings({ clientHost: host, clientPort: port });
    });

    socket.on("get-settings", async () => {
      const currentSettings = settingsManager.getSettings();
      socket.emit("settings-data", {
        ...currentSettings,
        isConnected: rigConnectionManager.getIsConnected()
      });
      rigctldManager.emitStatus();
      socket.emit("video-status", videoStreamManager.getStatus());
      socket.emit("audio-status", audioManager.getStatus());
      socket.emit("active-audio-client", audioManager.getActiveClient());
    });

    socket.on("get-video-devices", async () => {
      const { devices, error } = await videoStreamManager.listVideoDevices();
      if (error) socket.emit("video-error", error);
      socket.emit("video-devices-list", devices);
    });

    socket.on("get-audio-devices", async () => {
      const { inputs, outputs, error } = await audioManager.listAudioDevices();
      if (error) socket.emit("audio-error", error);
      socket.emit("audio-devices-list", { inputs, outputs });
    });

    socket.on("update-audio-settings", (settings: any) => {
      settingsManager.updateAudioSettings(settings);
    });

    socket.on("control-audio", (action: "start" | "stop") => {
      if (action === "start") {
        if (!audioManager.getActiveClient()) {
          audioManager.setActiveClient(socket.id);
        }
        audioManager.startAudio();
      } else {
        audioManager.stopAudio();
      }
    });

    socket.on("audio-interaction", () => {
      audioManager.setActiveClient(socket.id);
    });

    socket.on("audio-outbound", (data: Buffer) => {
      audioManager.handleOutboundAudio(socket.id, data);
    });

    socket.on("update-video-settings", (settings: any) => {
      videoStreamManager.stopVideo();
      settingsManager.updateVideoSettings(settings);
    });

    socket.on("control-video", (action: "play" | "pause" | "stop") => {
      if (action === "play") {
        videoStreamManager.startVideo();
      } else {
        videoStreamManager.stopVideo();
      }
    });

    socket.on("save-settings", (data) => {
      const oldRig = settingsManager.getSettings().settings.rigNumber;
      settingsManager.saveSettings(data);
      if (oldRig !== settingsManager.getSettings().settings.rigNumber) {
        rigctldManager.fetchRadioCapabilities(settingsManager.getSettings().settings.rigNumber);
      }
    });

    socket.on("toggle-auto-start", (enabled) => {
      settingsManager.saveSettings({ autoStart: enabled });
      if (enabled) rigctldManager.startRigctld();
      else rigctldManager.stopRigctld();
    });

    socket.on("start-rigctld", () => {
      settingsManager.saveSettings({ autoStart: true });
      rigctldManager.startRigctld();
    });

    socket.on("kill-existing-rigctld", async () => {
      await rigctldManager.killExistingRigctld();
      rigctldManager.startRigctld();
    });

    socket.on("stop-rigctld", () => {
      settingsManager.saveSettings({ autoStart: false });
      rigctldManager.stopRigctld();
    });

    socket.on("get-radios", () => {
      if (fs.existsSync(RADIOS_FILE)) {
        try {
          const radios = JSON.parse(fs.readFileSync(RADIOS_FILE, "utf-8"));
          socket.emit("radios-list", radios);
        } catch (e) {
          socket.emit("radios-list", []);
        }
      } else {
        socket.emit("radios-list", []);
      }
    });

    socket.on("send-raw", async (cmd) => {
      try {
        const resp = await rigConnectionManager.sendToRig(cmd);
        socket.emit("raw-response", { cmd, resp });
      } catch (err) {
        socket.emit("raw-response", { cmd, resp: `Error: ${err}` });
      }
    });

    socket.on("disconnect", () => {
      if (audioManager.getActiveClient() === socket.id) {
        audioManager.setActiveClient(null);
      }
    });
  });

  // Static files and Vite middleware
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn("Vite middleware not loaded:", e);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
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
  startServer().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
