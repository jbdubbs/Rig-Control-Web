import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";
import path from "path";
import { Server } from "socket.io";
import { EventEmitter } from "events";
import { SettingsManager } from "./SettingsManager.js";
import express from "express";

export class VideoStreamManager {
  private videoProcess: ChildProcess | null = null;
  private videoEmitter = new EventEmitter();
  private videoStatus: "playing" | "paused" | "stopped" = "stopped";
  private videoConnections = 0;
  private baseDir: string;
  private io: Server;
  private settingsManager: SettingsManager;

  constructor(baseDir: string, io: Server, settingsManager: SettingsManager) {
    this.baseDir = baseDir;
    this.io = io;
    this.settingsManager = settingsManager;
    this.videoEmitter.setMaxListeners(0);
  }

  private getFfmpegPath(): string {
    let platformDir = "";
    if (process.platform === "win32") platformDir = "windows";
    else if (process.platform === "linux") platformDir = "linux";
    else if (process.platform === "darwin") platformDir = "mac";
    
    const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    
    let binBase = this.baseDir;
    if (this.baseDir.endsWith(".asar")) {
      binBase = this.baseDir.replace(".asar", ".asar.unpacked");
    }
    
    const localPath = platformDir ? path.join(binBase, "bin", platformDir, binaryName) : "";
    
    if (localPath && fs.existsSync(localPath)) {
      return localPath;
    }
    return "ffmpeg";
  }

  public async listVideoDevices(): Promise<{ devices: string[], error?: string }> {
    return new Promise((resolve) => {
      const ffmpegPath = this.getFfmpegPath();
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
            if (lowerLine.includes("directshow video devices")) inDirectShow = true;
            if (lowerLine.includes("directshow audio devices")) inDirectShow = false;
            
            if (inDirectShow && line.includes("\"")) {
              const match = line.match(/"([^"]+)"/);
              if (match && !match[1].startsWith("@device_pnp_") && !devices.includes(match[1])) {
                devices.push(match[1]);
              }
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
              if (parts.length > 1) {
                const deviceName = parts[1].trim();
                if (!devices.includes(deviceName)) {
                  devices.push(deviceName);
                }
              }
            }
          });
        }
        
        resolve({ devices, error });
      });
    });
  }

  public stopVideo() {
    console.log("[VIDEO] Stopping video feed...");
    this.videoEmitter.emit("stop-clients");
    if (this.videoProcess) {
      this.videoProcess.kill('SIGKILL');
      this.videoProcess = null;
    }
    this.videoStatus = "stopped";
    this.io.emit("video-status", this.videoStatus);
  }

  public startVideo() {
    console.log("[VIDEO] Starting video feed...");
    this.stopVideo();
    const { device, resolution, framerate } = this.settingsManager.getSettings().videoSettings;
    
    if (!device || !resolution || !framerate) {
      console.warn("[VIDEO] Cannot start video: Missing settings.");
      return;
    }

    let inputFormat = "";
    let inputDevice = device;
    
    if (process.platform === "linux") {
      inputFormat = "v4l2";
    } else if (process.platform === "win32") {
      inputFormat = "dshow";
      inputDevice = `video=${device}`;
    } else if (process.platform === "darwin") {
      inputFormat = "avfoundation";
    }

    const args = [
      "-f", inputFormat,
      "-framerate", framerate,
      "-video_size", resolution,
      "-i", inputDevice,
      "-vf", `scale=${resolution.replace('x', ':')}`,
      "-f", "mpjpeg",
      "-q:v", "5",
      "pipe:1"
    ];

    const ffmpegPath = this.getFfmpegPath();
    const currentProcess = spawn(ffmpegPath, args);
    this.videoProcess = currentProcess;
    
    let hasReceivedData = false;
    const startupTimeout = setTimeout(() => {
      if (!hasReceivedData && this.videoProcess === currentProcess) {
        this.settingsManager.saveSettings({ videoAutoStart: false });
        this.stopVideo();
        this.io.emit("video-error", "Video device failed to start producing data.");
      }
    }, 10000);

    currentProcess.stdout?.on("data", (data) => {
      if (!hasReceivedData && this.videoProcess === currentProcess) {
        hasReceivedData = true;
        clearTimeout(startupTimeout);
        this.videoStatus = "playing";
        this.settingsManager.saveSettings({ videoAutoStart: true });
        this.io.emit("video-status", this.videoStatus);
      }
      
      if (this.videoEmitter.listenerCount("data") > 0) {
        this.videoEmitter.emit("data", data);
      }
    });

    currentProcess.on("exit", (code, signal) => {
      if (this.videoProcess === currentProcess) {
        this.videoStatus = "stopped";
        this.io.emit("video-status", this.videoStatus);
        this.videoProcess = null;
        clearTimeout(startupTimeout);
      }
    });
  }

  public handleStreamRequest(req: express.Request, res: express.Response) {
    const sessionId = (req.query.sessionId as string) || "default";
    this.videoEmitter.emit(`stop-clients-${sessionId}`);

    this.videoConnections++;
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
      this.videoConnections--;
      this.videoEmitter.removeListener("data", onData);
      this.videoEmitter.removeListener("stop-clients", cleanup);
      this.videoEmitter.removeListener(`stop-clients-${sessionId}`, cleanup);
      res.end();
    };

    const onData = (data: Buffer) => {
      if (isClosed || isCongested) return;
      const flushed = res.write(data);
      if (!flushed) {
        isCongested = true;
        res.once('drain', () => isCongested = false);
      }
    };

    this.videoEmitter.on("data", onData);
    this.videoEmitter.once("stop-clients", cleanup);
    this.videoEmitter.once(`stop-clients-${sessionId}`, cleanup);

    req.on("close", cleanup);
    req.on("end", cleanup);
    res.on("error", cleanup);
  }

  public getStatus() {
    return this.videoStatus;
  }
}
