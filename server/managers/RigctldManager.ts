import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";
import path from "path";
import { Server } from "socket.io";
import { SettingsManager } from "./SettingsManager.js";

export class RigctldManager {
  private rigctldProcess: ChildProcess | null = null;
  private rigctldStatus: "running" | "stopped" | "error" | "already_running" = "stopped";
  private rigctldVersion: string | null = null;
  private isRigctldVersionSupported = true;
  private rigctldLogs: string[] = [];
  private baseDir: string;
  private io: Server;
  private settingsManager: SettingsManager;

  constructor(baseDir: string, io: Server, settingsManager: SettingsManager) {
    this.baseDir = baseDir;
    this.io = io;
    this.settingsManager = settingsManager;
    this.init();
  }

  private async init() {
    this.rigctldVersion = await this.getRigctldVersion();
    this.isRigctldVersionSupported = this.checkVersionSupported(this.rigctldVersion);
    console.log(`[HAMLIB] Detected rigctld version: ${this.rigctldVersion || "unknown"}`);
    this.emitStatus();
  }

  private getRigctldPath(): string {
    let platformDir = "";
    if (process.platform === "win32") platformDir = "windows";
    else if (process.platform === "linux") platformDir = "linux";
    else if (process.platform === "darwin") platformDir = "mac";
    
    const binaryName = process.platform === "win32" ? "rigctld.exe" : "rigctld";
    
    let binBase = this.baseDir;
    if (this.baseDir.endsWith(".asar")) {
      binBase = this.baseDir.replace(".asar", ".asar.unpacked");
    }
    
    const localPath = platformDir ? path.join(binBase, "bin", platformDir, binaryName) : "";
    
    if (localPath && fs.existsSync(localPath)) {
      return localPath;
    }
    return "rigctld";
  }

  public async getRigctldVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn(this.getRigctldPath(), ["-V"]);
      let output = "";
      proc.stdout?.on("data", (d) => output += d.toString());
      proc.stderr?.on("data", (d) => output += d.toString());
      proc.on("close", () => {
        const match = output.match(/hamlib\s+([\d.]+)/i);
        resolve(match ? match[1] : null);
      });
      proc.on("error", () => resolve(null));
    });
  }

  private checkVersionSupported(version: string | null): boolean {
    if (!version) return true;
    const parts = version.split('.').map(Number);
    const min = [4, 7, 0];
    for (let i = 0; i < Math.max(parts.length, min.length); i++) {
      const v = parts[i] || 0;
      const m = min[i] || 0;
      if (v > m) return true;
      if (v < m) return false;
    }
    return true;
  }

  public emitStatus() {
    this.io.emit("rigctld-status", { 
      status: this.rigctldStatus, 
      logs: this.rigctldLogs,
      version: this.rigctldVersion,
      isVersionSupported: this.isRigctldVersionSupported
    });
  }

  public addLog(data: string) {
    const lines = data.split("\n").filter(l => l.trim());
    this.rigctldLogs = [...this.rigctldLogs, ...lines].slice(-100);
    this.io.emit("rigctld-log", lines);
  }

  public async checkExistingRigctld(): Promise<boolean> {
    return new Promise((resolve) => {
      const cmd = process.platform === "win32" ? 'tasklist /FI "IMAGENAME eq rigctld.exe"' : "pgrep rigctld";
      exec(cmd, (err, stdout) => {
        if (process.platform === "win32") {
          resolve(stdout.toLowerCase().includes("rigctld.exe"));
        } else {
          resolve(!err && !!stdout.trim());
        }
      });
    });
  }

  public async killExistingRigctld(): Promise<void> {
    return new Promise((resolve) => {
      const cmd = process.platform === "win32" ? "taskkill /F /IM rigctld.exe" : "pkill -9 rigctld";
      exec(cmd, () => resolve());
    });
  }

  public stopRigctld() {
    if (this.rigctldProcess) {
      console.log("Stopping rigctld...");
      this.rigctldProcess.kill();
      this.rigctldProcess = null;
      this.rigctldStatus = "stopped";
      this.emitStatus();
    }
  }

  public async startRigctld() {
    if (this.rigctldProcess) {
      this.stopRigctld();
    }

    this.rigctldVersion = await this.getRigctldVersion();
    this.isRigctldVersionSupported = this.checkVersionSupported(this.rigctldVersion);
    this.addLog(`Hamlib (rigctld) version check: ${this.rigctldVersion || "unknown"}`);
    
    if (!this.isRigctldVersionSupported) {
      this.addLog(`Warning: rigctld version ${this.rigctldVersion} is less than 4.7.0 and is unsupported.`);
    }

    const isAlreadyRunning = await this.checkExistingRigctld();
    if (isAlreadyRunning) {
      this.rigctldStatus = "already_running";
      this.emitStatus();
      this.addLog("Error: rigctld is already running on the system. Please stop it or use the 'Kill and Restart' option.");
      return;
    }
    
    const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = this.settingsManager.getSettings().settings;
    
    if (!rigNumber || !serialPort || !portNumber || !ipAddress || !serialPortSpeed) {
      this.rigctldStatus = "error";
      this.emitStatus();
      return;
    }

    console.log(`Starting rigctld: ${this.getRigctldPath()} -m ${rigNumber} -r ${serialPort} -t ${portNumber} -T ${ipAddress} -s ${serialPortSpeed}`);
    
    this.rigctldProcess = spawn(this.getRigctldPath(), [
      "-m", rigNumber,
      "-r", serialPort,
      "-t", portNumber,
      "-T", ipAddress,
      "-s", serialPortSpeed
    ]);

    this.rigctldStatus = "running";
    this.emitStatus();
    this.addLog("rigctld started");

    this.rigctldProcess.stdout?.on("data", (data) => this.addLog(data.toString()));
    this.rigctldProcess.stderr?.on("data", (data) => this.addLog(data.toString()));
    this.rigctldProcess.on("close", (code) => {
      this.addLog(`rigctld exited with code ${code}`);
      this.rigctldProcess = null;
      this.rigctldStatus = code === 0 ? "stopped" : "error";
      this.emitStatus();
    });
    this.rigctldProcess.on("error", (err) => {
      this.addLog(`Error: ${err.message}`);
      this.rigctldProcess = null;
      this.rigctldStatus = "error";
      this.emitStatus();
    });
  }

  public async fetchRadioCapabilities(rigNumber: string) {
    if (!rigNumber || rigNumber === "" || rigNumber === "1") {
      this.settingsManager.updateRigctldSettings({
        preampCapabilities: [],
        attenuatorCapabilities: [],
        agcCapabilities: [],
        anfSupported: false
      });
      this.io.emit("preamp-capabilities", []);
      this.io.emit("attenuator-capabilities", []);
      this.io.emit("agc-capabilities", []);
      this.io.emit("anf-capabilities", false);
      return;
    }

    const rigctldPath = this.getRigctldPath();
    exec(`"${rigctldPath}" -m ${rigNumber} -u`, (error, stdout) => {
      if (error) {
        this.settingsManager.updateRigctldSettings({
          preampCapabilities: [],
          attenuatorCapabilities: [],
          agcCapabilities: [],
          nbSupported: false,
          nrSupported: false,
          anfSupported: false
        });
      } else {
        const lines = stdout.split('\n');
        const updates: any = {};
        
        const preampLine = lines.find(line => line.trim().startsWith('Preamp:'));
        updates.preampCapabilities = preampLine ? preampLine.replace('Preamp:', '').trim().split(/\s+/).filter(Boolean) : [];

        const attenuatorLine = lines.find(line => line.trim().startsWith('Attenuator:'));
        updates.attenuatorCapabilities = attenuatorLine ? attenuatorLine.replace('Attenuator:', '').trim().split(/\s+/).filter(Boolean) : [];

        const agcLine = lines.find(line => line.trim().startsWith('AGC levels:'));
        updates.agcCapabilities = agcLine ? agcLine.replace('AGC levels:', '').trim().split(/\s+/).filter(Boolean) : [];

        const setFunctionsLine = lines.find(line => line.trim().startsWith('Set functions:'));
        if (setFunctionsLine) {
          const functions = setFunctionsLine.replace('Set functions:', '').trim().split(/\s+/);
          updates.nbSupported = functions.includes('NB');
          updates.nrSupported = functions.includes('NR');
          updates.anfSupported = functions.includes('ANF');
        }

        const getLevelLine = lines.find(line => line.trim().startsWith('Get level:'));
        if (getLevelLine) {
          const nbMatch = getLevelLine.match(/NB\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
          updates.nbLevelRange = nbMatch 
            ? { min: parseFloat(nbMatch[1]), max: parseFloat(nbMatch[2]), step: parseFloat(nbMatch[3]) }
            : { min: 0, max: 1, step: 0.1 };
          
          const nrMatch = getLevelLine.match(/NR\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
          updates.nrLevelRange = nrMatch 
            ? { min: parseFloat(nrMatch[1]), max: parseFloat(nrMatch[2]), step: parseFloat(nrMatch[3]) }
            : { min: 0, max: 1, step: 0.1 };

          const rfPowerMatch = getLevelLine.match(/RFPOWER\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
          updates.rfPowerRange = rfPowerMatch 
            ? { min: parseFloat(rfPowerMatch[1]), max: parseFloat(rfPowerMatch[2]), step: parseFloat(rfPowerMatch[3]) }
            : { min: 0, max: 1, step: 0.01 };
        } else {
          updates.nbLevelRange = { min: 0, max: 1, step: 0.1 };
          updates.nrLevelRange = { min: 0, max: 1, step: 0.1 };
          updates.rfPowerRange = { min: 0, max: 1, step: 0.01 };
        }

        this.settingsManager.updateRigctldSettings(updates);
        this.io.emit("preamp-capabilities", updates.preampCapabilities);
        this.io.emit("attenuator-capabilities", updates.attenuatorCapabilities);
        this.io.emit("agc-capabilities", updates.agcCapabilities);
        this.io.emit("nb-capabilities", { supported: updates.nbSupported, range: updates.nbLevelRange });
        this.io.emit("nr-capabilities", { supported: updates.nrSupported, range: updates.nrLevelRange });
        this.io.emit("rfpower-capabilities", { range: updates.rfPowerRange });
        this.io.emit("anf-capabilities", { supported: updates.anfSupported });
      }
    });
  }

  public getStatus() {
    return {
      status: this.rigctldStatus,
      logs: this.rigctldLogs,
      version: this.rigctldVersion,
      isVersionSupported: this.isRigctldVersionSupported
    };
  }
}
