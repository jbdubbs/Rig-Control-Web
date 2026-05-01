import fs from "fs";
import { Socket } from "socket.io";
import { ServerContext } from "./context.ts";
import { vlog } from "./vlog.ts";

export function loadSettings(ctx: ServerContext, settingsFile: string): void {
  if (!fs.existsSync(settingsFile)) return;
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    ctx.rigctldSettings = { ...ctx.rigctldSettings, ...data.settings };
    ctx.autoStartEnabled = data.autoStart || false;
    ctx.videoAutoStart = data.videoAutoStart || false;
    ctx.pollRate = Number(data.pollRate) || 2000;
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
    if (data.cwSettings) {
      ctx.cwSettings = { ...ctx.cwSettings, ...data.cwSettings };
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
      cwSettings: ctx.cwSettings,
    }, null, 2));
  } catch (e) {
    console.error("[SETTINGS] Failed to save settings:", e);
  }
}

export function registerSettingsHandlers(
  socket: Socket,
  ctx: ServerContext,
  radiosFile: string,
  onRigNumberChanged: (rigNumber: string) => void,
  startPolling: () => void,
  syncKeyerPort: (forceReopen?: boolean) => Promise<void>,
): void {
  socket.on("save-settings", (data) => {
    const oldRigNumber = ctx.rigctldSettings.rigNumber;

    if (data.settings) {
      ctx.rigctldSettings = { ...ctx.rigctldSettings, ...data.settings };
    } else {
      const { pollRate: pr, clientHost: ch, clientPort: cp, ...rest } = data;
      ctx.rigctldSettings = { ...ctx.rigctldSettings, ...rest };
    }

    if (data.pollRate !== undefined) {
      ctx.pollRate = Number(data.pollRate);
      startPolling();
    }
    if (data.clientHost !== undefined) ctx.clientHost = data.clientHost;
    if (data.clientPort !== undefined) ctx.clientPort = Number(data.clientPort);
    if (data.potaSettings !== undefined) ctx.potaSettings = { ...ctx.potaSettings, ...data.potaSettings };
    if (data.sotaSettings !== undefined) ctx.sotaSettings = { ...ctx.sotaSettings, ...data.sotaSettings };
    if (data.cwSettings !== undefined) {
      const oldPolarity = ctx.cwSettings.serialKeyPolarity;
      ctx.cwSettings = { ...ctx.cwSettings, ...data.cwSettings };
      const polarityChanged = data.cwSettings.serialKeyPolarity !== undefined && data.cwSettings.serialKeyPolarity !== oldPolarity;
      syncKeyerPort(polarityChanged);
    }

    ctx.saveSettings();
    if (oldRigNumber !== ctx.rigctldSettings.rigNumber) {
      onRigNumberChanged(ctx.rigctldSettings.rigNumber);
    }
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
