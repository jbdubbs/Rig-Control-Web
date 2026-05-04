import express from "express";
import https from "https";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";

import { loadOrGenerateCert } from "./server/tls.ts";
import { VERBOSE, vlog } from "./server/vlog.ts";
import { createInitialContext } from "./server/context.ts";
import { loadSettings, saveSettings, registerSettingsHandlers } from "./server/settings.ts";
import { getRigctldVersion, checkVersionSupported, emitRigctldStatus, startRigctld, stopRigctld, fetchRadioCapabilities, registerRigctldHandlers } from "./server/rigctld.ts";
import { sendToRig, startPolling, stopPolling, registerRigCommHandlers } from "./server/rigComm.ts";
import { initAudioEngine, stopAudio, registerAudioHandlers } from "./server/audio.ts";
import { syncKeyerPort, closeKeyerPort, cwSetKey, stopCwTick, registerCwHandlers } from "./server/cw.ts";
import { registerVideoHandlers } from "./server/video.ts";
import { registerSolarHandlers } from "./server/solar.ts";

let electronWin: any = null;
export function setElectronWindow(win: any) {
  electronWin = win;
}

let _shutdown: (() => Promise<void>) | null = null;
export async function shutdown(): Promise<void> {
  if (_shutdown) await _shutdown();
}

export async function startServer(appPath?: string, userDataPath?: string) {
  const app = express();
  const PORT = 3000;

  const baseDir = appPath || process.cwd();
  const dataDir = userDataPath || (process.env.NODE_ENV === "production" ? "/tmp" : process.cwd());

  const SETTINGS_FILE = path.join(dataDir, "settings.json");
  const RADIOS_FILE = path.join(baseDir, "radios.json");

  vlog(`Server initializing. Base directory (assets): ${baseDir}`);
  vlog(`Data directory (settings): ${dataDir}`);
  vlog(`NODE_ENV: ${process.env.NODE_ENV}, Electron: ${!!process.versions.electron}`);

  const { key: tlsKey, cert: tlsCert } = await loadOrGenerateCert(dataDir);
  const httpServer = https.createServer({ key: tlsKey, cert: tlsCert }, app);
  const io = new Server(httpServer, { perMessageDeflate: false });

  const ctx = createInitialContext(io, baseDir, dataDir);

  // Wire cross-module callbacks
  ctx.saveSettings = () => saveSettings(ctx, SETTINGS_FILE);
  ctx.sendToRig = (cmd, ext, pri) => sendToRig(ctx, cmd, ext, pri);

  // Load persisted settings
  loadSettings(ctx, SETTINGS_FILE);

  // Start audio engine (fire-and-forget)
  initAudioEngine(ctx);

  // Initial rigctld version check
  getRigctldVersion(baseDir).then(v => {
    ctx.rigctldVersion = v;
    ctx.isRigctldVersionSupported = checkVersionSupported(v);
    vlog(`[HAMLIB] Detected rigctld version: ${v || "unknown"}`);
    emitRigctldStatus(ctx);
  });

  // Auto-start rigctld if configured
  if (ctx.autoStartEnabled) {
    startRigctld(ctx);
  }

  // Open CW keyer serial port if needed
  await syncKeyerPort(ctx);

  // Signal handlers for clean shutdown
  process.on("exit", () => stopRigctld(ctx));
  process.on("SIGINT", () => { closeKeyerPort(ctx); stopRigctld(ctx); process.exit(); });
  process.on("SIGTERM", () => { closeKeyerPort(ctx); stopRigctld(ctx); process.exit(); });

  io.on("connection", (socket) => {
    const clientId = socket.handshake.auth.clientId || socket.id;
    console.log(`Client connected (Socket ID: ${socket.id}, Client ID: ${clientId})`);
    ctx.socketConnectTimes.set(socket.id, Date.now());

    socket.emit("audio-engine-state", { isReady: ctx.isAudioEngineReady, error: ctx.audioEngineError });
    socket.emit("verbose-mode", VERBOSE);

    // Register per-subsystem socket handlers
    registerRigCommHandlers(socket, ctx);
    registerRigctldHandlers(socket, ctx);
    registerAudioHandlers(socket, ctx, clientId);
    registerCwHandlers(socket, ctx);
    registerVideoHandlers(socket, ctx);
    registerSolarHandlers(socket, ctx);
    registerSettingsHandlers(
      socket,
      ctx,
      RADIOS_FILE,
      (rigNumber) => fetchRadioCapabilities(ctx, rigNumber),
      () => startPolling(ctx),
      (forceReopen) => syncKeyerPort(ctx, forceReopen),
    );

    // get-settings: initial state dump for newly connected client
    socket.on("get-settings", async () => {
      const { checkExistingRigctld } = await import("./server/rigctld.ts");
      if (ctx.rigctldStatus === "stopped" || ctx.rigctldStatus === "error") {
        const isRunning = await checkExistingRigctld();
        if (isRunning) ctx.rigctldStatus = "already_running";
      }

      socket.emit("settings-data", {
        settings: ctx.rigctldSettings,
        autoStart: ctx.autoStartEnabled,
        videoAutoStart: ctx.videoAutoStart,
        videoSettings: ctx.videoSettings,
        audioSettings: ctx.audioSettings,
        pollRate: ctx.pollRate,
        autoconnectEligible: ctx.autoconnectEligible,
        clientHost: ctx.clientHost,
        clientPort: ctx.clientPort,
        isConnected: ctx.isConnected,
        potaSettings: ctx.potaSettings,
        sotaSettings: ctx.sotaSettings,
        cwSettings: ctx.cwSettings,
        cwPortStatus: (ctx.cwKeyerProcess && !ctx.cwKeyerProcess.killed)
          ? { open: true, port: ctx.cwSettings.keyerPort }
          : { open: false, port: ctx.cwSettings.keyerPort },
      });
      emitRigctldStatus(ctx);
      socket.emit("rigctld-log", ctx.rigctldLogs);

      vlog(`[VIDEO] New client ${socket.id} connected. videoStatus=${ctx.videoStatus} hasKeyframe=${!!ctx.lastKeyframe}`);
      socket.emit("video-source-status", {
        status: ctx.videoStatus,
        videoWidth: ctx.videoSettings.videoWidth,
        videoHeight: ctx.videoSettings.videoHeight,
        framerate: ctx.videoSettings.framerate,
      });
      socket.emit("video-devices-list", ctx.videoDeviceList);
      if (ctx.videoStatus === "streaming" && ctx.lastKeyframe) {
        vlog(`[VIDEO] Sending buffered keyframe to ${socket.id}: type=${ctx.lastKeyframe.type} dataBytes=${ctx.lastKeyframe.data.byteLength} hasDescription=${!!ctx.lastKeyframe.description}`);
        socket.emit("video-frame", ctx.lastKeyframe);
      }

      socket.emit("audio-status", ctx.audioStatus);
      socket.emit("preamp-capabilities", ctx.rigctldSettings.preampCapabilities);
      socket.emit("nb-capabilities", { supported: ctx.rigctldSettings.nbSupported, range: ctx.rigctldSettings.nbLevelRange });
      socket.emit("nr-capabilities", { supported: ctx.rigctldSettings.nrSupported, range: ctx.rigctldSettings.nrLevelRange });
      socket.emit("mic-active-client", ctx.activeMicClientId);
      socket.emit("rfpower-capabilities", { range: ctx.rigctldSettings.rfPowerRange });
      socket.emit("anf-capabilities", { supported: ctx.rigctldSettings.anfSupported });

      if (ctx.isConnected) {
        socket.emit("rig-connected", { host: ctx.rigConfig.host, port: ctx.rigConfig.port });
      }
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected (Socket ID: ${socket.id}, Client ID: ${clientId})`);
      ctx.socketConnectTimes.delete(socket.id);

      if (ctx.activeCwClientId === socket.id) {
        stopCwTick(ctx);
        if (ctx.cwClaimIdleTimer) { clearTimeout(ctx.cwClaimIdleTimer); ctx.cwClaimIdleTimer = null; }
        cwSetKey(ctx, false);
        ctx.cwKeyLockedOut = false;
        ctx.cwMachine = "IDLE";
        ctx.cwPaddleBuffer = [];
        ctx.activeCwClientId = null;
        ctx.cwIsKeying = false;
        if (ctx.cwIdleTimer) { clearTimeout(ctx.cwIdleTimer); ctx.cwIdleTimer = null; }
        if (ctx.cwStuckKeyTimer) { clearTimeout(ctx.cwStuckKeyTimer); ctx.cwStuckKeyTimer = null; }
      }

      if (socket.id === ctx.videoSourceSocketId) {
        vlog("[VIDEO] Source client disconnected — stopping stream.");
        ctx.videoSourceSocketId = null;
        ctx.lastKeyframe = null;
        ctx.videoStatus = "stopped";
        ctx.videoAutoStart = false;
        ctx.saveSettings();
        ctx.io.emit("video-source-status", { status: "stopped" });
      }

      if (ctx.activeMicClientId === clientId) {
        setTimeout(() => {
          let hasActiveSocket = false;
          ctx.io.sockets.sockets.forEach(s => {
            if ((s.handshake.auth.clientId || s.id) === clientId) {
              hasActiveSocket = true;
            }
          });
          if (!hasActiveSocket && ctx.activeMicClientId === clientId) {
            vlog(`[AUDIO] Releasing mic for disconnected client: ${clientId}`);
            ctx.activeMicClientId = null;
            ctx.io.emit("mic-active-client", null);
          }
        }, 5000);
      }
    });
  });

  // Dev / production static serving
  if (process.env.NODE_ENV !== "production" && !process.versions.electron) {
    try {
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
    let distPath;
    if (process.versions.electron && appPath) {
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

  // Ordered shutdown: keyer → audio → rigctld → polling → sockets → HTTP
  _shutdown = async () => {
    await closeKeyerPort(ctx);
    await stopAudio(ctx);
    stopRigctld(ctx);
    stopPolling(ctx);
    if (ctx.rigSocket) { ctx.rigSocket.destroy(); ctx.rigSocket = null; }
    ctx.io.disconnectSockets(true);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return new Promise<void>((resolve) => {
    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on https://localhost:${PORT}`);
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
