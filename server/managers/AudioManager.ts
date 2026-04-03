import { spawn, ChildProcess, exec } from "child_process";
import fs from "fs";
import path from "path";
import { Server } from "socket.io";
import { SettingsManager } from "./SettingsManager.js";

export class AudioManager {
  private inboundAudioProcess: ChildProcess | null = null;
  private outboundAudioProcess: ChildProcess | null = null;
  private audioStatus: "playing" | "stopped" = "stopped";
  private activeAudioClientId: string | null = null;
  private baseDir: string;
  private io: Server;
  private settingsManager: SettingsManager;

  constructor(baseDir: string, io: Server, settingsManager: SettingsManager) {
    this.baseDir = baseDir;
    this.io = io;
    this.settingsManager = settingsManager;
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

  public async listAudioDevices(): Promise<{ inputs: string[], outputs: string[], error?: string }> {
    return new Promise((resolve) => {
      const ffmpegPath = this.getFfmpegPath();
      let cmd = "";
      if (process.platform === "linux") {
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
          const isPactl = output.includes("\t") || lines.some(l => /^\d+\s+/.test(l));
          
          if (isPactl) {
            exec("pactl list short sources", (errS, stdoutS) => {
              stdoutS.split("\n").forEach(l => {
                const p = l.split("\t");
                if (p.length >= 2) inputs.push(`${p[1]} [pulse]`);
              });
              exec("pactl list short sinks", (errO, stdoutO) => {
                stdoutO.split("\n").forEach(l => {
                  const p = l.split("\t");
                  if (p.length >= 2) outputs.push(`${p[1]} [pulse]`);
                });
                resolve({ inputs, outputs });
              });
            });
            return;
          } else {
            this.parseAlsa(output, inputs, outputs);
          }
        } else if (process.platform === "win32") {
          const lines = output.split("\n");
          let inAudio = false;
          lines.forEach(line => {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes("directshow audio devices")) inAudio = true;
            if (inAudio && line.includes("\"")) {
              const match = line.match(/"([^"]+)"/);
              if (match && !match[1].startsWith("@device_pnp_")) {
                inputs.push(match[1]);
                outputs.push(match[1]);
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
  }

  private parseAlsa(output: string, inputs: string[], outputs: string[]) {
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
          const hwId = `hw:${match[1]},${match[3]}`;
          const displayName = `${match[2].trim()}: ${match[4].trim()} [${hwId}]`;
          if (parsingOutputs) outputs.push(displayName);
          else inputs.push(displayName);
        }
      }
    });
  }

  public stopAudio() {
    if (this.inboundAudioProcess) {
      this.inboundAudioProcess.kill('SIGKILL');
      this.inboundAudioProcess = null;
    }
    if (this.outboundAudioProcess) {
      this.outboundAudioProcess.kill('SIGKILL');
      this.outboundAudioProcess = null;
    }
    this.audioStatus = "stopped";
    this.io.emit("audio-status", this.audioStatus);
  }

  public startAudio() {
    this.stopAudio();
    const { inputDevice: rawInput, outputDevice: rawOutput } = this.settingsManager.getSettings().audioSettings;

    if (!rawInput && !rawOutput) return;

    if (rawInput) {
      let inputDevice = rawInput;
      const hwMatch = inputDevice.match(/\[(hw:\d+,\d+)\]/);
      if (hwMatch) {
        inputDevice = hwMatch[1];
        if (process.platform === "linux") inputDevice = inputDevice.replace("hw:", "plughw:");
      }

      if (process.platform === "linux") {
        if (inputDevice.includes("[pulse]")) {
          const pulseDevice = inputDevice.split(" [pulse]")[0];
          const pacatProcess = spawn("pacat", ["--record", "--device", pulseDevice, "--format", "s16le", "--rate", "48000", "--channels", "1", "--raw", "--latency-msec=100"]);
          this.inboundAudioProcess = pacatProcess;
          const encoderProcess = spawn(this.getFfmpegPath(), ["-f", "s16le", "-ar", "48000", "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-application", "voip", "-b:a", "24k", "-vbr", "on", "-compression_level", "5", "-frame_duration", "20", "-f", "ogg", "-flush_packets", "1", "pipe:1"]);
          
          pacatProcess.stderr?.on("data", (data) => console.error(`[AUDIO-PACAT-IN-ERR] ${data}`));
          encoderProcess.stderr?.on("data", (data) => console.error(`[AUDIO-FFMPEG-IN-ERR] ${data}`));

          pacatProcess.stdout?.pipe(encoderProcess.stdin!);
          encoderProcess.stdout?.on("data", (data) => this.io.emit("audio-inbound", data));
          encoderProcess.on("close", () => pacatProcess.kill());
        } else {
          const arecordProcess = spawn("arecord", ["-D", inputDevice, "-f", "S16_LE", "-r", "48000", "-c", "1", "-t", "raw", "--buffer-time=200000"]);
          this.inboundAudioProcess = arecordProcess;
          const encoderProcess = spawn(this.getFfmpegPath(), ["-f", "s16le", "-ar", "48000", "-ac", "1", "-i", "pipe:0", "-c:a", "libopus", "-application", "voip", "-b:a", "24k", "-vbr", "on", "-compression_level", "5", "-frame_duration", "20", "-f", "ogg", "-flush_packets", "1", "pipe:1"]);
          
          arecordProcess.stderr?.on("data", (data) => console.error(`[AUDIO-ARECORD-ERR] ${data}`));
          encoderProcess.stderr?.on("data", (data) => console.error(`[AUDIO-FFMPEG-IN-ERR] ${data}`));

          arecordProcess.stdout?.pipe(encoderProcess.stdin!);
          encoderProcess.stdout?.on("data", (data) => this.io.emit("audio-inbound", data));
          arecordProcess.on("close", () => encoderProcess.kill());
        }
      } else {
        let inputFormat = process.platform === "win32" ? "dshow" : "avfoundation";
        let dev = process.platform === "win32" ? `audio=${rawInput}` : rawInput;
        const inboundArgs = ["-f", inputFormat, "-thread_queue_size", "1024", "-ar", "48000", "-ac", "1", "-i", dev, "-fflags", "nobuffer", "-probesize", "32", "-analyzeduration", "0", "-c:a", "libopus", "-application", "voip", "-b:a", "24k", "-vbr", "on", "-compression_level", "5", "-frame_duration", "20", "-f", "ogg", "-flush_packets", "1", "pipe:1"];
        this.inboundAudioProcess = spawn(this.getFfmpegPath(), inboundArgs);
        this.inboundAudioProcess.stderr?.on("data", (data) => console.error(`[AUDIO-FFMPEG-IN-ERR] ${data}`));
        this.inboundAudioProcess.stdout?.on("data", (data) => this.io.emit("audio-inbound", data));
      }
    }

    if (rawOutput) {
      let outputDevice = rawOutput;
      const hwMatch = outputDevice.match(/\[(hw:\d+,\d+)\]/);
      if (hwMatch) {
        outputDevice = hwMatch[1];
        if (process.platform === "linux") outputDevice = outputDevice.replace("hw:", "plughw:");
      }

      if (process.platform === "linux") {
        const decoderProcess = spawn(this.getFfmpegPath(), ["-f", "ogg", "-probesize", "32", "-analyzeduration", "0", "-i", "pipe:0", "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"]);
        this.outboundAudioProcess = decoderProcess;
        decoderProcess.stderr?.on("data", (data) => console.error(`[AUDIO-FFMPEG-OUT-ERR] ${data}`));
        if (outputDevice.includes("[pulse]")) {
          const pulseDevice = outputDevice.split(" [pulse]")[0];
          const pacatProcess = spawn("pacat", ["--playback", "--device", pulseDevice, "--format", "s16le", "--rate", "16000", "--channels", "1", "--raw", "--process-time-msec=10"]);
          pacatProcess.stderr?.on("data", (data) => console.error(`[AUDIO-PACAT-OUT-ERR] ${data}`));
          decoderProcess.stdout?.pipe(pacatProcess.stdin!);
          pacatProcess.on("close", () => decoderProcess.kill());
        } else {
          const aplayProcess = spawn("aplay", ["-D", outputDevice, "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "raw", "--buffer-size=1024"]);
          aplayProcess.stderr?.on("data", (data) => console.error(`[AUDIO-APLAY-ERR] ${data}`));
          decoderProcess.stdout?.pipe(aplayProcess.stdin!);
          aplayProcess.on("close", () => decoderProcess.kill());
        }
      } else {
        let outputFormat = process.platform === "win32" ? "dshow" : "avfoundation";
        let dev = process.platform === "win32" ? `audio=${rawOutput}` : rawOutput;
        this.outboundAudioProcess = spawn(this.getFfmpegPath(), ["-f", "ogg", "-probesize", "32", "-analyzeduration", "0", "-i", "pipe:0", "-fflags", "nobuffer", "-f", outputFormat, dev]);
        this.outboundAudioProcess.stderr?.on("data", (data) => console.error(`[AUDIO-FFMPEG-OUT-ERR] ${data}`));
      }
    }

    this.audioStatus = "playing";
    this.io.emit("audio-status", this.audioStatus);
  }

  public handleOutboundAudio(socketId: string, data: Buffer) {
    if (socketId !== this.activeAudioClientId) return;
    if (this.outboundAudioProcess && this.outboundAudioProcess.stdin) {
      this.outboundAudioProcess.stdin.write(data);
    }
  }

  public setActiveClient(socketId: string | null) {
    this.activeAudioClientId = socketId;
    this.io.emit("active-audio-client", socketId);
  }

  public getActiveClient() {
    return this.activeAudioClientId;
  }

  public getStatus() {
    return this.audioStatus;
  }
}
