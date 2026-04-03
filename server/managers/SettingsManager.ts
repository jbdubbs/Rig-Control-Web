import fs from "fs";
import path from "path";

export interface RigctldSettings {
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
}

export interface VideoSettings {
  device: string;
  resolution: string;
  framerate: string;
}

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
}

export interface AppSettings {
  settings: RigctldSettings;
  autoStart: boolean;
  videoAutoStart: boolean;
  videoSettings: VideoSettings;
  audioSettings: AudioSettings;
  pollRate: number;
  autoconnectEligible: boolean;
  clientHost: string;
  clientPort: number;
}

export class SettingsManager {
  private settingsFile: string;
  private currentSettings: AppSettings;

  constructor(dataDir: string) {
    this.settingsFile = path.join(dataDir, "settings.json");
    this.currentSettings = this.getDefaultSettings();
    this.loadSettings();
  }

  private getDefaultSettings(): AppSettings {
    return {
      settings: {
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
        anfSupported: false
      },
      autoStart: false,
      videoAutoStart: false,
      videoSettings: {
        device: "",
        resolution: "",
        framerate: ""
      },
      audioSettings: {
        inputDevice: "",
        outputDevice: "",
        inboundEnabled: false,
        outboundEnabled: false
      },
      pollRate: 2000,
      autoconnectEligible: false,
      clientHost: "127.0.0.1",
      clientPort: 4532
    };
  }

  public loadSettings(): AppSettings {
    if (fs.existsSync(this.settingsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.settingsFile, "utf-8"));
        this.currentSettings = {
          ...this.getDefaultSettings(),
          ...data,
          settings: { ...this.getDefaultSettings().settings, ...data.settings },
          videoSettings: { ...this.getDefaultSettings().videoSettings, ...data.videoSettings },
          audioSettings: { ...this.getDefaultSettings().audioSettings, ...data.audioSettings }
        };
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    }
    return this.currentSettings;
  }

  public saveSettings(settings?: Partial<AppSettings>): void {
    if (settings) {
      this.currentSettings = { ...this.currentSettings, ...settings };
    }
    console.log(`[SETTINGS] Saving settings to ${this.settingsFile}...`);
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.currentSettings, null, 2));
    } catch (e) {
      console.error("[SETTINGS] Failed to save settings:", e);
    }
  }

  public getSettings(): AppSettings {
    return this.currentSettings;
  }

  public updateRigctldSettings(settings: Partial<RigctldSettings>): void {
    this.currentSettings.settings = { ...this.currentSettings.settings, ...settings };
    this.saveSettings();
  }

  public updateVideoSettings(settings: Partial<VideoSettings>): void {
    this.currentSettings.videoSettings = { ...this.currentSettings.videoSettings, ...settings };
    this.saveSettings();
  }

  public updateAudioSettings(settings: Partial<AudioSettings>): void {
    this.currentSettings.audioSettings = { ...this.currentSettings.audioSettings, ...settings };
    this.saveSettings();
  }
}
