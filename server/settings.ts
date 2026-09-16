import fs from "fs";
import { Socket } from "socket.io";
import type { ServerContext } from "./context.ts";
import { vlogInfra as vlog, vlogDx, debugFlags, setDebugFlag, type DebugFlags } from "./vlog.ts";

export function sanitizePollRate(value: unknown, fallback = 2000): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 100 ? n : fallback;
}

export function loadSettings(ctx: ServerContext, settingsFile: string): void {
  if (!fs.existsSync(settingsFile)) return;
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    ctx.rigctldSettings = { ...ctx.rigctldSettings, ...data.settings };
    ctx.autoStartEnabled = data.autoStart || false;
    ctx.videoAutoStart = data.videoAutoStart || false;
    ctx.pollRate = sanitizePollRate(data.pollRate);
    ctx.autoconnectEligible = data.autoconnectEligible || false;
    ctx.clientHost = data.clientHost || "127.0.0.1";
    ctx.clientPort = Number(data.clientPort) || 4532;
    if (data.videoSettings) {
      const vs = data.videoSettings;
      if (vs.resolution && !vs.videoWidth) {
        const parts = (vs.resolution as string).split("x");
        vs.videoWidth = parseInt(parts[0]) || 640;
        vs.videoHeight = parseInt(parts[1]) || 480;
      }
      ctx.videoSettings = { ...ctx.videoSettings, ...vs };
    }
    if (data.audioSettings) {
      ctx.audioSettings = { ...ctx.audioSettings, ...data.audioSettings };
    }
    if (data.potaSettings) {
      ctx.potaSettings = { ...ctx.potaSettings, ...data.potaSettings };
    }
    if (data.sotaSettings) {
      ctx.sotaSettings = { ...ctx.sotaSettings, ...data.sotaSettings };
    }
    if (data.wwffSettings) {
      ctx.wwffSettings = { ...ctx.wwffSettings, ...data.wwffSettings };
    }
    if (data.dxClusterSettings) {
      ctx.dxClusterSettings = { ...ctx.dxClusterSettings, ...data.dxClusterSettings };
    }
    if (data.cwSettings) {
      ctx.cwSettings = { ...ctx.cwSettings, ...data.cwSettings };
    }
    if (data.spectrumSettings) {
      ctx.spectrumSettings = { ...ctx.spectrumSettings, ...data.spectrumSettings };
    }
    if (data.debugFlags) {
      // OR semantics: a persisted "off" must never silently defeat an
      // explicit --debug-x CLI/env flag for this session, but a persisted
      // "on" still restores the user's last Diagnostics-tab choice.
      for (const key of Object.keys(debugFlags) as (keyof DebugFlags)[]) {
        setDebugFlag(key, debugFlags[key] || !!data.debugFlags[key]);
      }
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

export function saveSettings(ctx: ServerContext, settingsFile: string): void {
  vlog(`[SETTINGS] Saving settings to ${settingsFile}...`);
  try {
    fs.writeFileSync(settingsFile, JSON.stringify({
      settings: ctx.rigctldSettings,
      autoStart: ctx.autoStartEnabled,
      videoAutoStart: ctx.videoAutoStart,
      videoSettings: ctx.videoSettings,
      audioSettings: ctx.audioSettings,
      pollRate: Number(ctx.pollRate),
      autoconnectEligible: ctx.autoconnectEligible,
      clientHost: ctx.clientHost,
      clientPort: Number(ctx.clientPort),
      potaSettings: ctx.potaSettings,
      sotaSettings: ctx.sotaSettings,
      wwffSettings: ctx.wwffSettings,
      dxClusterSettings: ctx.dxClusterSettings,
      cwSettings: ctx.cwSettings,
      spectrumSettings: ctx.spectrumSettings,
      debugFlags,
    }, null, 2));
  } catch (e) {
    console.error("[SETTINGS] Failed to save settings:", e);
  }
}

export function registerSettingsHandlers(
  socket: Socket,
  ctx: ServerContext,
  radiosFile: string,
  startPolling: () => void,
  syncKeyerPort: (forceReopen?: boolean) => Promise<void>,
  onSpectrumEnabledChanged?: (enabled: boolean) => void,
  onDxClusterEnabledChanged?: (enabled: boolean) => void,
): void {
  socket.on("save-settings", (data) => {
    const oldRigNumber = ctx.rigctldSettings.rigNumber;

    if (data.settings) {
      ctx.rigctldSettings = { ...ctx.rigctldSettings, ...data.settings };
    }
    // else: individual key saves (e.g. spectrumSettings) — never merge into ctx.rigctldSettings

    if (data.pollRate !== undefined) {
      ctx.pollRate = sanitizePollRate(data.pollRate, ctx.pollRate);
      startPolling();
    }
    if (data.clientHost !== undefined) ctx.clientHost = data.clientHost;
    if (data.clientPort !== undefined) ctx.clientPort = Number(data.clientPort);
    if (data.potaSettings !== undefined) ctx.potaSettings = { ...ctx.potaSettings, ...data.potaSettings };
    if (data.sotaSettings !== undefined) ctx.sotaSettings = { ...ctx.sotaSettings, ...data.sotaSettings };
    if (data.wwffSettings !== undefined) ctx.wwffSettings = { ...ctx.wwffSettings, ...data.wwffSettings };
    if (data.dxClusterSettings !== undefined) {
      const prevDx = ctx.dxClusterSettings;
      ctx.dxClusterSettings = { ...prevDx, ...data.dxClusterSettings };
      // Only restart the live telnet connection when something that actually
      // affects it changed — maxAge/callsignFilter/keywordFilter/bandFilter
      // are applied client-side and must NOT bounce the connection on every
      // edit (each restart is a fresh login against a shared public node).
      const connectionRelevantChanged =
        prevDx.enabled !== ctx.dxClusterSettings.enabled ||
        prevDx.host !== ctx.dxClusterSettings.host ||
        prevDx.port !== ctx.dxClusterSettings.port ||
        prevDx.loginCallsign !== ctx.dxClusterSettings.loginCallsign;
      if (connectionRelevantChanged && onDxClusterEnabledChanged) {
        vlogDx(`[DXCLUSTER] Settings changed (enabled ${prevDx.enabled}->${ctx.dxClusterSettings.enabled}, host ${prevDx.host}->${ctx.dxClusterSettings.host}, port ${prevDx.port}->${ctx.dxClusterSettings.port}) — restarting connection`);
        onDxClusterEnabledChanged(ctx.dxClusterSettings.enabled);
      }
      socket.emit("settings-data", { dxClusterSettings: ctx.dxClusterSettings });
    }
    if (data.cwSettings !== undefined) {
      const oldPolarity = ctx.cwSettings.serialKeyPolarity;
      ctx.cwSettings = { ...ctx.cwSettings, ...data.cwSettings };
      const polarityChanged = data.cwSettings.serialKeyPolarity !== undefined && data.cwSettings.serialKeyPolarity !== oldPolarity;
      syncKeyerPort(polarityChanged);
    }
    if (data.spectrumSettings !== undefined) {
      ctx.spectrumSettings = { ...ctx.spectrumSettings, ...data.spectrumSettings };
      if (onSpectrumEnabledChanged) {
        onSpectrumEnabledChanged(ctx.spectrumSettings.enabled);
      }
      socket.emit("settings-data", { spectrumSettings: ctx.spectrumSettings });
    }

    ctx.saveSettings();
  });

  socket.on("get-radios", () => {
    if (fs.existsSync(radiosFile)) {
      try {
        const radios = JSON.parse(fs.readFileSync(radiosFile, "utf-8"));
        socket.emit("radios-list", radios);
      } catch (e) {
        console.error("Failed to load radios:", e);
        socket.emit("radios-list", []);
      }
    } else {
      socket.emit("radios-list", []);
    }
  });
}
