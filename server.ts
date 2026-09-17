import express from "express";
import https from "https";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";

import { loadOrGenerateCert } from "./server/tls.ts";
import { vlogInfra, vlogRig, vlogVideo, vlogAudio, debugFlags } from "./server/vlog.ts";
import { initDiagnosticsLog, registerDiagnosticsHandlers } from "./server/diagnostics.ts";
import { createInitialContext, getAppVersion } from "./server/context.ts";
import { loadSettings, saveSettings, registerSettingsHandlers } from "./server/settings.ts";
import { getRigctldVersion, checkVersionSupported, emitRigctldStatus, startRigctld, stopRigctld, registerRigctldHandlers } from "./server/rigctld.ts";
import { sendToRig, startPolling, stopPolling, registerRigCommHandlers } from "./server/rigComm.ts";
import { initAudioEngine, stopAudio, registerAudioHandlers } from "./server/audio.ts";
import { syncKeyerPort, closeKeyerPort, cwSetKey, stopCwTick, registerCwHandlers } from "./server/cw.ts";
import { registerVideoHandlers } from "./server/video.ts";
import { registerSerialHandlers } from "./server/serial.ts";
import { registerSolarHandlers, pushSolarData } from "./server/solar.ts";
import { startSpectrumListener, stopSpectrumListener } from "./server/spectrum.ts";
import { startYaesuScope, stopYaesuScope } from "./server/yaesuScope.ts";
import { startIqScope, stopIqScope } from "./server/iqScope.ts";
import { startDxCluster, stopDxCluster } from "./server/dxCluster.ts";
import {
  initAuth,
  issueToken,
  resolveToken,
  registerAuthHandlers,
  registerAdminHandlers,
} from "./server/auth.ts";

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
  const PORT = Number(process.env.RCW_PORT) || 3000;

  const baseDir = appPath || process.cwd();
  const dataDir = userDataPath || process.env.RCW_DATA_DIR || (process.env.NODE_ENV === "production" ? "/tmp" : process.cwd());

  const SETTINGS_FILE = path.join(dataDir, "settings.json");
  const RADIOS_FILE = path.join(baseDir, "radios.json");

  vlogInfra(`Server initializing. Base directory (assets): ${baseDir}`);
  vlogInfra(`Data directory (settings): ${dataDir}`);
  vlogInfra(`NODE_ENV: ${process.env.NODE_ENV}, Electron: ${!!process.versions.electron}`);

  const { key: tlsKey, cert: tlsCert } = await loadOrGenerateCert(dataDir);
  const httpServer = https.createServer({ key: tlsKey, cert: tlsCert }, app);
  const io = new Server(httpServer, { perMessageDeflate: false });

  // Track every raw TCP socket so we can destroy them during shutdown.
  // closeAllConnections() (Node 18.2+) does not destroy upgraded WebSocket
  // connections (Node.js bug #53536), so we handle it manually.
  const openSockets = new Set<import("net").Socket>();
  httpServer.on("connection", (socket: import("net").Socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
  });

  const ctx = createInitialContext(io, baseDir, dataDir);

  // Capture all console output (vlog* subsystem lines + plain console.*)
  // into ctx.diagnosticsLog as early as possible, for the Diagnostics tab.
  initDiagnosticsLog(ctx);

  // Self-identify the running build in every log (journalctl, terminal, and
  // the browser Diagnostics tab) — unconditional, not vlogInfra, since a bug
  // report's log dump otherwise carries no version info at all (see #54,
  // where it was impossible to tell whether a crash report was from a
  // pre-fix or post-fix testing build).
  const appVersion = getAppVersion(baseDir);
  console.log(`RigControl Web v${appVersion}`);

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
    vlogRig(`[HAMLIB] Detected rigctld version: ${v || "unknown"}`);
    emitRigctldStatus(ctx);
  });

  // Auto-start rigctld if configured
  if (ctx.autoStartEnabled) {
    startRigctld(ctx);
  }

  // Start spectrum listener if enabled
  if (ctx.spectrumSettings.enabled) {
    if (ctx.spectrumSettings.source === "ft4222") {
      startYaesuScope(ctx);
    } else if (ctx.spectrumSettings.source === "iq") {
      startIqScope(ctx);
    } else {
      startSpectrumListener(ctx);
    }
  }

  // Start DX cluster telnet connection if enabled
  if (ctx.dxClusterSettings.enabled) {
    startDxCluster(ctx);
  }

  // Open CW keyer serial port if needed
  await syncKeyerPort(ctx);

  // Initialize auth (loads/generates JWT secret, seeds default ADMIN user)
  await initAuth(ctx);

  // Signal handlers for clean shutdown
  process.on("exit", () => stopRigctld(ctx));
  process.on("SIGINT", () => { closeKeyerPort(ctx); stopRigctld(ctx); process.exit(); });
  process.on("SIGTERM", () => { closeKeyerPort(ctx); stopRigctld(ctx); process.exit(); });

  // Pushes all initial state to a newly-authenticated socket. Called both from
  // registerFunctionalHandlers (on auth) and from the get-settings handler
  // (explicit client re-request). Using targeted socket.emit throughout so we
  // don't accidentally broadcast to all clients.
  const pushInitialState = async (socket: import("socket.io").Socket) => {
    const { checkExistingRigctld } = await import("./server/rigctld.ts");
    if (ctx.rigctldStatus === "stopped" || ctx.rigctldStatus === "error") {
      const isRunning = await checkExistingRigctld();
      if (isRunning) ctx.rigctldStatus = "already_running";
    }

    socket.emit("settings-data", {
      appVersion: getAppVersion(baseDir),
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
      wwffSettings: ctx.wwffSettings,
      dxClusterSettings: ctx.dxClusterSettings,
      cwSettings: ctx.cwSettings,
      cwPortStatus: (ctx.cwKeyerProcess && !ctx.cwKeyerProcess.killed)
        ? { open: true, port: ctx.cwSettings.keyerPort }
        : { open: false, port: ctx.cwSettings.keyerPort },
      spectrumSettings: ctx.spectrumSettings,
    });
    socket.emit("spectrum-supported", ctx.spectrumSupported);
    socket.emit("yaesu-scope-status", { running: ctx.yaesuScopeRunning, error: ctx.yaesuScopeError });
    socket.emit("iq-scope-status", { running: ctx.iqScopeRunning, error: ctx.iqScopeError });
    socket.emit("dx-cluster-status", { connected: ctx.dxClusterConnected, error: ctx.dxClusterError });
    socket.emit("dx-spots-backlog", ctx.dxSpotBuffer);
    socket.emit("rigctld-status", {
      status: ctx.rigctldStatus,
      logs: ctx.rigctldLogs,
      version: ctx.rigctldVersion,
      isVersionSupported: ctx.isRigctldVersionSupported,
    });
    socket.emit("rigctld-log", ctx.rigctldLogs);

    vlogVideo(`[VIDEO] New client ${socket.id} connected. videoStatus=${ctx.videoStatus} hasKeyframe=${!!ctx.lastKeyframe}`);
    socket.emit("video-source-status", {
      status: ctx.videoStatus,
      videoWidth: ctx.videoSettings.videoWidth,
      videoHeight: ctx.videoSettings.videoHeight,
      framerate: ctx.videoSettings.framerate,
    });
    socket.emit("video-devices-list", ctx.videoDeviceList);
    if (ctx.videoStatus === "streaming" && ctx.lastKeyframe) {
      vlogVideo(`[VIDEO] Sending buffered keyframe to ${socket.id}: type=${ctx.lastKeyframe.type} dataBytes=${ctx.lastKeyframe.data.byteLength} hasDescription=${!!ctx.lastKeyframe.description}`);
      socket.emit("video-frame", ctx.lastKeyframe);
    }

    socket.emit("audio-status", ctx.audioStatus);
    socket.emit("preamp-capabilities", ctx.rigctldSettings.preampCapabilities);
    socket.emit("attenuator-capabilities", ctx.rigctldSettings.attenuatorCapabilities);
    socket.emit("agc-capabilities", ctx.rigctldSettings.agcCapabilities);
    socket.emit("nb-capabilities", { supported: ctx.rigctldSettings.nbSupported, levelSupported: ctx.rigctldSettings.nbLevelSupported, range: ctx.rigctldSettings.nbLevelRange });
    socket.emit("nr-capabilities", { supported: ctx.rigctldSettings.nrSupported, levelSupported: ctx.rigctldSettings.nrLevelSupported, range: ctx.rigctldSettings.nrLevelRange });
    socket.emit("mic-active-client", ctx.activeMicClientId);
    socket.emit("rfpower-capabilities", { range: ctx.rigctldSettings.rfPowerRange });
    socket.emit("rflevel-capabilities", { supported: ctx.rigctldSettings.rfLevelSupported, range: ctx.rigctldSettings.rfLevelRange });
    socket.emit("anf-capabilities", { supported: ctx.rigctldSettings.anfSupported });

    if (ctx.isConnected) {
      socket.emit("rig-connected", {
        host: ctx.rigConfig.host,
        port: ctx.rigConfig.port,
        vfoSupported: ctx.vfoSupported,
        powerSupported: ctx.powerSupported,
      });
      socket.emit("rig-status", ctx.lastStatus);
    }

    if (fs.existsSync(RADIOS_FILE)) {
      try {
        socket.emit("radios-list", JSON.parse(fs.readFileSync(RADIOS_FILE, "utf-8")));
      } catch (e) {
        console.error("Failed to load radios:", e);
        socket.emit("radios-list", []);
      }
    } else {
      socket.emit("radios-list", []);
    }
  };

  // Registers all functional (post-auth) socket handlers for a given socket
  const registerFunctionalHandlers = (socket: import("socket.io").Socket, clientId: string) => {
    socket.emit("audio-engine-state", { isReady: ctx.isAudioEngineReady, error: ctx.audioEngineError });
    socket.emit("debug-flags", debugFlags);

    registerRigCommHandlers(socket, ctx);
    registerRigctldHandlers(socket, ctx);
    registerAudioHandlers(socket, ctx, clientId);
    registerCwHandlers(socket, ctx);
    registerVideoHandlers(socket, ctx);
    registerSerialHandlers(socket);
    registerSolarHandlers(socket, ctx);
    pushSolarData(socket, ctx);
    registerAdminHandlers(socket, ctx);
    registerDiagnosticsHandlers(socket, ctx);
    registerSettingsHandlers(
      socket,
      ctx,
      RADIOS_FILE,
      () => startPolling(ctx),
      (forceReopen) => syncKeyerPort(ctx, forceReopen),
      (_enabled) => {
        /* Always stop all sources first, then start whichever is now active */
        stopSpectrumListener(ctx);
        stopYaesuScope(ctx);
        stopIqScope(ctx);
        if (ctx.spectrumSettings.enabled) {
          if (ctx.spectrumSettings.source === "ft4222") {
            startYaesuScope(ctx);
          } else if (ctx.spectrumSettings.source === "iq") {
            startIqScope(ctx);
          } else {
            startSpectrumListener(ctx);
          }
        }
      },
      (enabled) => {
        stopDxCluster(ctx, "settings changed");
        if (enabled) {
          startDxCluster(ctx);
        }
      },
    );

    socket.on("get-settings", async () => { await pushInitialState(socket); });

    pushInitialState(socket).catch(e => console.error("[INIT] pushInitialState error:", e));
  };

  io.on("connection", (socket) => {
    const clientId = socket.handshake.auth.clientId || socket.id;
    const token = socket.handshake.auth.token as string | undefined;
    vlogInfra(`Client connected (Socket ID: ${socket.id}, Client ID: ${clientId})`);
    ctx.socketConnectTimes.set(socket.id, Date.now());

    // Ensure functional handlers are only registered once per socket
    let functionalHandlersRegistered = false;
    const registerFunctionalOnce = () => {
      if (functionalHandlersRegistered) return;
      functionalHandlersRegistered = true;
      registerFunctionalHandlers(socket, clientId);
    };

    // Auth handlers are always registered (login works pre-auth)
    registerAuthHandlers(socket, ctx, registerFunctionalOnce);

    // Attempt token verification on connect — resolveToken validates the signature
    // AND confirms the user still exists in users.json with their current role.
    const resolved = token ? resolveToken(token, ctx) : null;
    if (resolved) {
      ctx.authenticatedSockets.set(socket.id, {
        callsign: resolved.callsign,
        role: resolved.role,
        connectedAt: Date.now(),
        ip: socket.handshake.address,
      });
      socket.emit("auth:token-refreshed", {
        token: issueToken(resolved.callsign, resolved.role, ctx),
        callsign: resolved.callsign,
        role: resolved.role,
        mustChangePassword: resolved.mustChangePassword,
      });
      if (!resolved.mustChangePassword) {
        registerFunctionalOnce();
      }
      // If mustChangePassword, functional handlers are registered after
      // auth:change-password succeeds (onAuthenticated closure in auth.ts).
    } else {
      socket.emit("auth:required");
    }

    socket.on("disconnect", () => {
      vlogInfra(`Client disconnected (Socket ID: ${socket.id}, Client ID: ${clientId})`);
      ctx.socketConnectTimes.delete(socket.id);
      ctx.authenticatedSockets.delete(socket.id);

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
        vlogVideo("[VIDEO] Source client disconnected — stopping stream.");
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
            vlogAudio(`[AUDIO] Releasing mic for disconnected client: ${clientId}`);
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
      vlogInfra("Vite development middleware loaded.");
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

    vlogInfra(`Serving static files from: ${distPath}`);

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
    const step = (label: string) => {
      const start = Date.now();
      vlogInfra(`[SHUTDOWN] ${label}`);
      return () => vlogInfra(`[SHUTDOWN] ${label} done (${Date.now() - start}ms)`);
    };

    let done = step("closeKeyerPort");
    await closeKeyerPort(ctx);
    done();

    // stopAudio can deadlock on Windows WASAPI; cap it so shutdown always proceeds.
    done = step("stopAudio (3s cap)");
    await Promise.race([stopAudio(ctx), new Promise<void>(r => setTimeout(r, 3000))]);
    done();

    // stopRigctld itself awaits the process's actual exit (racing a 3s timeout),
    // so both rigctld and, on Windows, its taskkill helper are gone before we proceed.
    done = step("stopRigctld + await exit");
    await stopRigctld(ctx);
    done();

    done = step("stopPolling");
    stopPolling(ctx);
    done();

    done = step("stopSpectrumListener");
    stopSpectrumListener(ctx);
    done();

    done = step("stopYaesuScope");
    stopYaesuScope(ctx);
    done();

    done = step("stopDxCluster");
    stopDxCluster(ctx, "server shutdown");
    done();

    // stopIqScope awaits naudiodon's async quit(); cap it like stopAudio so shutdown always proceeds.
    done = step("stopIqScope (3s cap)");
    await Promise.race([stopIqScope(ctx), new Promise<void>(r => setTimeout(r, 3000))]);
    done();

    done = step("destroy rigSocket");
    if (ctx.rigSocket) { ctx.rigSocket.destroy(); ctx.rigSocket = null; }
    done();

    done = step("disconnectSockets");
    ctx.io.disconnectSockets(true);
    done();

    // Destroy all tracked TCP sockets (including WebSocket-upgraded ones that
    // closeAllConnections() misses per Node.js bug #53536) so httpServer.close()
    // fires immediately rather than waiting for connections to drain.
    done = step(`destroy openSockets (${openSockets.size})`);
    openSockets.forEach(s => s.destroy());
    done();

    done = step("httpServer.close()");
    await Promise.race([
      new Promise<void>((resolve) => httpServer.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(() => { vlogInfra("[SHUTDOWN] httpServer.close() timed out after 2s"); resolve(); }, 2000)),
    ]);
    done();

    // Log any handles still keeping the event loop alive so we can identify blockers.
    if (typeof (process as any)._getActiveHandles === "function") {
      const handles: any[] = (process as any)._getActiveHandles();
      vlogInfra(`[SHUTDOWN] Active handles: ${handles.length}`);
      handles.forEach(h => vlogInfra(`[SHUTDOWN]   ${h?.constructor?.name ?? typeof h}`));
    }
    if (typeof (process as any)._getActiveRequests === "function") {
      const reqs: any[] = (process as any)._getActiveRequests();
      if (reqs.length) vlogInfra(`[SHUTDOWN] Active requests: ${reqs.length}`);
    }

    vlogInfra("[SHUTDOWN] Sequence complete");
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
