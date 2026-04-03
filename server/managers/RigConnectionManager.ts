import net from "net";
import { Server } from "socket.io";

export interface RigStatus {
  frequency: string;
  mode: string;
  bandwidth: string;
  ptt: boolean;
  smeter: number;
  swr: number;
  alc: number;
  powerMeter: number;
  rfpower: number;
  vdd: number;
  vfo: string;
  isSplit: boolean;
  txVFO: string;
  rfLevel: number;
  agc: number;
  attenuation: number;
  preamp: number;
  nb: boolean;
  nbLevel: number;
  nr: boolean;
  anf: boolean;
  nrLevel: number;
  tuner: boolean;
  timestamp: number;
}

export class RigConnectionManager {
  private rigSocket: net.Socket | null = null;
  private pollingTimeout: NodeJS.Timeout | null = null;
  private rigConfig = { host: "", port: 0 };
  private isConnected = false;
  private io: Server;
  private pollRate: number = 2000;
  private visibleMeters: string[] = ['swr', 'alc'];
  
  private lastStatus: RigStatus = this.getDefaultStatus();
  private rigCommandQueue: { cmd: string; useExtended: boolean; resolve: (val: string) => void; reject: (err: any) => void }[] = [];
  private isRigBusy = false;

  constructor(io: Server) {
    this.io = io;
  }

  private getDefaultStatus(): RigStatus {
    return {
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
      nbLevel: 0,
      nr: false,
      anf: false,
      nrLevel: 8 / 15,
      tuner: false,
      timestamp: Date.now()
    };
  }

  public connectToRig(host: string, port: number) {
    if (this.isConnected && this.rigConfig.host === host && this.rigConfig.port === port) {
      this.io.emit("rig-connected", { host, port });
      return;
    }

    if (this.rigSocket) {
      this.rigSocket.destroy();
      this.rigSocket = null;
    }

    this.rigConfig = { host, port };
    this.rigSocket = new net.Socket();
    
    // Start polling even if not connected yet, it will handle retries
    this.startPolling();

    this.rigSocket.connect(port, host, () => {
      console.log(`Connected to rigctld at ${host}:${port}`);
      this.isConnected = true;
      this.io.emit("rig-connected", { host, port });
      // Fetch capabilities once connected
      this.fetchCapabilities();
    });

    this.rigSocket.on("error", (err: any) => {
      this.isConnected = false;
      // Only log and emit error if it's not a connection refusal during polling
      if (err.code !== 'ECONNREFUSED') {
        console.error("Rig socket error:", err);
        this.io.emit("rig-error", `Connection Error: ${err.message}`);
      } else {
        // Silent log for refusal
        console.log(`Connection to rigctld at ${host}:${port} refused (rigctld might still be starting)`);
      }
    });

    this.rigSocket.on("close", () => {
      console.log("Rig connection closed");
      this.isConnected = false;
      this.io.emit("rig-disconnected");
      this.stopPolling();
    });
  }

  private async fetchCapabilities() {
    if (!this.isConnected) return;
    try {
      // Command '1' is dump_caps in rigctld
      const caps = await this.sendToRig("1", false);
      const lines = caps.split('\n');
      
      const hasNB = lines.some(l => l.includes('NB'));
      const hasNR = lines.some(l => l.includes('NR'));
      const hasANF = lines.some(l => l.includes('ANF'));

      const preampLine = lines.find(line => line.trim().startsWith('Preamp:'));
      const preampLevels = preampLine ? preampLine.replace('Preamp:', '').trim().split(/\s+/).filter(Boolean) : [];

      const attenuatorLine = lines.find(line => line.trim().startsWith('Attenuator:'));
      const attenuatorLevels = attenuatorLine ? attenuatorLine.replace('Attenuator:', '').trim().split(/\s+/).filter(Boolean) : [];

      const agcLine = lines.find(line => line.trim().startsWith('AGC levels:'));
      const agcLevels = agcLine ? agcLine.replace('AGC levels:', '').trim().split(/\s+/).filter(Boolean) : [];

      const rfPowerMatch = caps.match(/RFPOWER\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
      const rfPowerRange = rfPowerMatch 
        ? { min: parseFloat(rfPowerMatch[1]), max: parseFloat(rfPowerMatch[2]), step: parseFloat(rfPowerMatch[3]) }
        : { min: 0, max: 1, step: 0.01 };

      this.io.emit("nb-capabilities", { supported: hasNB, range: { min: 0, max: 1, step: 0.1 } });
      this.io.emit("nr-capabilities", { supported: hasNR, range: { min: 0, max: 1, step: 0.066667 } });
      this.io.emit("anf-capabilities", { supported: hasANF });
      this.io.emit("preamp-capabilities", preampLevels);
      this.io.emit("attenuator-capabilities", attenuatorLevels);
      this.io.emit("agc-capabilities", agcLevels);
      this.io.emit("rfpower-capabilities", { range: rfPowerRange });
      
      console.log(`[RIG] Capabilities fetched: NB=${hasNB}, NR=${hasNR}, ANF=${hasANF}, Preamp=${preampLevels.length}, Att=${attenuatorLevels.length}, AGC=${agcLevels.length}, RFPower=${rfPowerRange.max}`);
    } catch (err) {
      console.error("Error fetching capabilities:", err);
    }
  }

  public disconnectRig() {
    this.resetRigState();
    if (this.rigSocket) {
      this.rigSocket.destroy();
      this.rigSocket = null;
    }
    this.isConnected = false;
    this.stopPolling();
    this.io.emit("rig-disconnected");
  }

  public setPollRate(rate: number) {
    this.pollRate = rate;
    if (this.isConnected) {
      this.startPolling();
    }
  }

  public setVisibleMeters(meters: string[]) {
    this.visibleMeters = meters;
  }

  private startPolling() {
    this.stopPolling();
    const runPoll = async () => {
      const startTime = Date.now();
      await this.pollRig();
      const duration = Date.now() - startTime;
      const nextDelay = Math.max(0, this.pollRate - duration);
      this.pollingTimeout = setTimeout(runPoll, nextDelay);
    };
    this.pollingTimeout = setTimeout(runPoll, this.pollRate);
  }

  private stopPolling() {
    if (this.pollingTimeout) {
      clearTimeout(this.pollingTimeout);
      this.pollingTimeout = null;
    }
  }

  private resetRigState() {
    this.lastStatus = this.getDefaultStatus();
  }

  private formatExtendedCommand(cmd: string): string {
    const trimmed = cmd.trim();
    const parts = trimmed.split(/\s+/);
    if (parts[0].length === 1) {
      return `+${trimmed}`;
    }
    return `+\\${trimmed}`;
  }

  private parseExtendedResponse(resp: string): string {
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
  }

  private async processRigQueue() {
    if (this.isRigBusy || this.rigCommandQueue.length === 0) return;
    this.isRigBusy = true;
    const { cmd, useExtended, resolve, reject } = this.rigCommandQueue.shift()!;
    
    try {
      const resp = await this.executeRigCommand(cmd, useExtended);
      resolve(resp);
    } catch (err) {
      reject(err);
    } finally {
      this.isRigBusy = false;
      setTimeout(() => this.processRigQueue(), 10);
    }
  }

  public sendToRig(cmd: string, useExtended = false): Promise<string> {
    return new Promise((resolve, reject) => {
      this.rigCommandQueue.push({ cmd, useExtended, resolve, reject });
      this.processRigQueue();
    });
  }

  private executeRigCommand(cmd: string, useExtended = false): Promise<string> {
    const finalCmd = useExtended ? this.formatExtendedCommand(cmd) : cmd;
    
    return new Promise((resolve, reject) => {
      if (!this.rigSocket || this.rigSocket.destroyed) {
        return reject("Not connected to rig");
      }
      
      let responseBuffer = "";
      const timeout = setTimeout(() => {
        this.rigSocket?.removeListener("data", onData);
        this.rigSocket?.removeListener("error", onError);
        
        console.warn("Rig command timeout - reconnecting to reset state");
        if (this.rigSocket) {
          this.rigSocket.destroy();
          this.isConnected = false;
        }
        
        reject("Rig command timeout");
      }, 10000);

      const onData = (data: Buffer) => {
        responseBuffer += data.toString();
        
        if (useExtended) {
          if (responseBuffer.includes("RPRT 0") || responseBuffer.includes("RPRT 1")) {
            clearTimeout(timeout);
            this.rigSocket?.removeListener("data", onData);
            this.rigSocket?.removeListener("error", onError);
            try {
              resolve(this.parseExtendedResponse(responseBuffer));
            } catch (e) {
              reject(e);
            }
          }
        } else {
          clearTimeout(timeout);
          this.rigSocket?.removeListener("data", onData);
          this.rigSocket?.removeListener("error", onError);
          resolve(responseBuffer.trim());
        }
      };
      
      const onError = (err: Error) => {
        clearTimeout(timeout);
        this.rigSocket?.removeListener("data", onData);
        reject(err);
      };
      
      this.rigSocket.on("data", onData);
      this.rigSocket.once("error", onError);
      this.rigSocket.write(finalCmd + "\n");
    });
  }

  public async pollRig() {
    if (!this.isConnected) {
      if (this.rigConfig.host && this.rigConfig.host !== "mock") {
        this.connectToRig(this.rigConfig.host, this.rigConfig.port);
      }
      return;
    }
    try {
      const now = Date.now();
      
      const ptt = await this.sendToRig("t", true);
      const smeter = await this.sendToRig("l STRENGTH", true);
      const isPttActive = ptt === "1";
      
      let alc = "0";
      let powerMeter = "0";
      let swr = "1.0";

      if (isPttActive) {
        try {
          alc = await this.sendToRig("l ALC", true);
          powerMeter = await this.sendToRig("l RFPOWER_METER", true);
          swr = await this.sendToRig("l SWR", true);
        } catch (e) {
          // TX levels poll failed
        }
      }

      let vdd = this.lastStatus.vdd?.toString() || "13.8";
      if (this.visibleMeters.includes('vdd')) {
        vdd = await this.sendToRig("l VD_METER", true).catch(() => "13.8");
      }

      const frequency = await this.sendToRig("f", true);
      const modeBw = await this.sendToRig("m", true);
      const [mode, bandwidth] = modeBw.split("\n");
      let rfpower = parseFloat(await this.sendToRig("l RFPOWER", true));
      const rflevel = parseFloat(await this.sendToRig("l RF", true).catch(() => "0"));
      const agc = parseInt(await this.sendToRig("l AGC", true).catch(() => "6"));
      const vfo = await this.sendToRig("v", true);
      const splitInfo = await this.sendToRig("s", true);
      const [isSplitStr, txVFO] = splitInfo.split("\n");
      const att = parseInt(await this.sendToRig("l ATT", true)) || 0;
      const preamp = parseInt(await this.sendToRig("l PREAMP", true)) || 0;
      const nb = (await this.sendToRig("u NB", true).catch(() => "0")) === "1";
      const nbLevel = parseFloat(await this.sendToRig("l NB", true).catch(() => "0"));
      const nr = (await this.sendToRig("u NR", true).catch(() => "0")) === "1";
      const nrLevel = parseFloat(await this.sendToRig("l NR", true).catch(() => "0"));
      const anf = (await this.sendToRig("u ANF", true).catch(() => "0")) === "1";
      const tuner = (await this.sendToRig("u TUNER", true).catch(() => "0")) === "1";

      this.lastStatus = {
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
        nbLevel,
        nr,
        nrLevel,
        anf,
        tuner,
        timestamp: now,
      };

      this.io.emit("rig-status", this.lastStatus);
    } catch (err) {
      console.error("Polling error:", err);
    }
  }

  public getStatus() {
    return this.lastStatus;
  }

  public getIsConnected() {
    return this.isConnected;
  }
}
