import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import net from "net";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  const SETTINGS_FILE = path.join(process.cwd(), "settings.json");
  const RADIOS_FILE = path.join(process.cwd(), "radios.json");

  let rigctldProcess: ChildProcess | null = null;
  let rigctldStatus: "running" | "stopped" | "error" = "stopped";
  let rigctldLogs: string[] = [];
  let autoStartEnabled = false;
  let rigctldSettings = {
    rigNumber: "",
    serialPort: "",
    portNumber: "4532",
    ipAddress: "127.0.0.1",
    serialPortSpeed: "38400"
  };

  // Load settings if they exist
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      rigctldSettings = { ...rigctldSettings, ...data.settings };
      autoStartEnabled = data.autoStart || false;
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  }

  const saveSettings = () => {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
      settings: rigctldSettings,
      autoStart: autoStartEnabled
    }, null, 2));
  };

  const emitRigctldStatus = () => {
    io.emit("rigctld-status", rigctldStatus);
  };

  const addLog = (data: string) => {
    const lines = data.split("\n").filter(l => l.trim());
    rigctldLogs = [...rigctldLogs, ...lines].slice(-100); // Keep last 100 lines
    io.emit("rigctld-log", lines);
  };

  const stopRigctld = () => {
    if (rigctldProcess) {
      console.log("Stopping rigctld...");
      rigctldProcess.kill();
      rigctldProcess = null;
      rigctldStatus = "stopped";
      emitRigctldStatus();
    }
  };

  const startRigctld = () => {
    stopRigctld();
    
    const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = rigctldSettings;
    
    if (!rigNumber || !serialPort || !portNumber || !ipAddress || !serialPortSpeed) {
      console.error("Cannot start rigctld: missing settings");
      rigctldStatus = "error";
      emitRigctldStatus();
      return;
    }

    console.log(`Starting rigctld: rigctld -m ${rigNumber} -r ${serialPort} -t ${portNumber} -T ${ipAddress} -s ${serialPortSpeed}`);
    
    rigctldProcess = spawn("rigctld", [
      "-m", rigNumber,
      "-r", serialPort,
      "-t", portNumber,
      "-T", ipAddress,
      "-s", serialPortSpeed
    ], { detached: false });

    rigctldStatus = "running";
    emitRigctldStatus();
    addLog("rigctld started");

    rigctldProcess.stdout?.on("data", (data) => {
      const str = data.toString();
      console.log(`rigctld stdout: ${str}`);
      addLog(str);
    });

    rigctldProcess.stderr?.on("data", (data) => {
      const str = data.toString();
      console.error(`rigctld stderr: ${str}`);
      addLog(str);
    });

    rigctldProcess.on("close", (code) => {
      console.log(`rigctld process exited with code ${code}`);
      addLog(`rigctld exited with code ${code}`);
      rigctldProcess = null;
      rigctldStatus = code === 0 ? "stopped" : "error";
      emitRigctldStatus();
    });

    rigctldProcess.on("error", (err) => {
      console.error("Failed to start rigctld:", err);
      addLog(`Error: ${err.message}`);
      rigctldProcess = null;
      rigctldStatus = "error";
      emitRigctldStatus();
    });
  };

  // Start rigctld on server boot if enabled
  if (autoStartEnabled) {
    startRigctld();
  }

  process.on("exit", stopRigctld);
  process.on("SIGINT", () => {
    stopRigctld();
    process.exit();
  });
  process.on("SIGTERM", () => {
    stopRigctld();
    process.exit();
  });

  let rigSocket: net.Socket | null = null;
  let pollingTimeout: NodeJS.Timeout | null = null;
  let pollRate = 2000;
  let rigConfig = { host: "", port: 0 };
  let isConnected = false;

  const connectToRig = (host: string, port: number, socket?: any) => {
    if (rigSocket) {
      rigSocket.destroy();
      rigSocket = null;
    }

    rigConfig = { host, port };
    rigSocket = new net.Socket();
    
    rigSocket.connect(port, host, () => {
      console.log(`Connected to rigctld at ${host}:${port}`);
      isConnected = true;
      if (socket) socket.emit("rig-connected", { host, port });
      startPolling();
    });

    rigSocket.on("error", (err) => {
      console.error("Rig socket error:", err);
      isConnected = false;
      if (socket) socket.emit("rig-error", `Connection Error: ${err.message}`);
    });

    rigSocket.on("close", () => {
      console.log("Rig connection closed");
      isConnected = false;
      if (socket) socket.emit("rig-disconnected");
      stopPolling();
    });
  };

  const startPolling = () => {
    stopPolling();
    const runPoll = async () => {
      if (!isConnected && !isMock) return;
      await pollRig();
      pollingTimeout = setTimeout(runPoll, pollRate);
    };
    pollingTimeout = setTimeout(runPoll, pollRate);
  };

  const stopPolling = () => {
    if (pollingTimeout) {
      clearTimeout(pollingTimeout);
      pollingTimeout = null;
    }
  };

  let isMock = false;
  let visibleMeters: string[] = ['swr', 'alc'];
  let lastStatus: any = {
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
    nr: false,
    nrLevel: 0.5,
    tuner: false
  };

  const resetRigState = () => {
    lastStatus = {
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
      nr: false,
      nrLevel: 0.5,
      tuner: false
    };
  };

  const formatExtendedCommand = (cmd: string): string => {
    const trimmed = cmd.trim();
    const parts = trimmed.split(/\s+/);
    if (parts[0].length === 1) {
      return `+${trimmed}`;
    }
    return `+\\${trimmed}`;
  };

  const parseExtendedResponse = (resp: string): string => {
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
  };

  let mockAtt = 0;
  let mockPreamp = 0;
  let mockNB = 0;
  let mockNR = 0;
  let mockNRLevel = 0.5;
  let mockTuner = 0;
  let mockRFPower = 0.5;
  let mockRFLevel = 0;
  let mockAGC = 6;
  let mockSplit = 0;
  let mockTxVFO = "VFOB";

  const rigCommandQueue: { cmd: string; useExtended: boolean; resolve: (val: string) => void; reject: (err: any) => void }[] = [];
  let isRigBusy = false;

  const processRigQueue = async () => {
    if (isRigBusy || rigCommandQueue.length === 0) return;
    isRigBusy = true;
    const { cmd, useExtended, resolve, reject } = rigCommandQueue.shift()!;
    
    try {
      const resp = await executeRigCommand(cmd, useExtended);
      resolve(resp);
    } catch (err) {
      reject(err);
    } finally {
      isRigBusy = false;
      setTimeout(processRigQueue, 10);
    }
  };

  const sendToRig = (cmd: string, useExtended = false): Promise<string> => {
    return new Promise((resolve, reject) => {
      rigCommandQueue.push({ cmd, useExtended, resolve, reject });
      processRigQueue();
    });
  };

  const executeRigCommand = (cmd: string, useExtended = false): Promise<string> => {
    const finalCmd = useExtended ? formatExtendedCommand(cmd) : cmd;
    
    if (isMock) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let response = "";
          let longCmd = "";
          
          // Determine long command name for extended protocol
          if (cmd === "f") longCmd = "get_freq";
          else if (cmd === "m") longCmd = "get_mode";
          else if (cmd === "t") longCmd = "get_ptt";
          else if (cmd === "v") longCmd = "get_vfo";
          else if (cmd === "s") longCmd = "get_split_vfo";
          else if (cmd.startsWith("l")) longCmd = "get_level";
          else if (cmd.startsWith("u")) longCmd = "get_func";
          else longCmd = cmd;

          if (cmd === "f") response = "14250000";
          else if (cmd === "m") response = "USB\n2400";
          else if (cmd === "M ?") response = "AM CW USB LSB RTTY FM PKTUSB PKTLSB";
          else if (cmd === "t") response = "0";
          else if (cmd === "v") response = "VFOA";
          else if (cmd === "s") response = `${mockSplit}\n${mockTxVFO}`;
          else if (cmd.startsWith("G")) response = "RPRT 0";
          else if (cmd.startsWith("l STRENGTH")) response = (Math.random() * -100).toString();
          else if (cmd.startsWith("l SWR")) response = (1 + Math.random() * 0.5).toString();
          else if (cmd.startsWith("l ALC")) response = Math.random().toString();
          else if (cmd.startsWith("l VD_METER")) response = (13.5 + Math.random() * 0.6).toString();
          else if (cmd.startsWith("l RFPOWER_METER")) response = (mockRFPower * (0.9 + Math.random() * 0.2)).toString();
          else if (cmd.startsWith("l RFPOWER")) response = mockRFPower.toString();
          else if (cmd.startsWith("l RF")) response = mockRFLevel.toString();
          else if (cmd.startsWith("l AGC")) response = mockAGC.toString();
          else if (cmd.startsWith("l ATT")) response = mockAtt.toString();
          else if (cmd.startsWith("l PREAMP")) response = mockPreamp.toString();
          else if (cmd.startsWith("u NB")) response = mockNB.toString();
          else if (cmd.startsWith("u NR")) response = mockNR.toString();
          else if (cmd.startsWith("l NR")) response = mockNRLevel.toString();
          else if (cmd.startsWith("u TUNER")) response = mockTuner.toString();
          else if (cmd.startsWith("L ATT")) {
            mockAtt = parseInt(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("L PREAMP")) {
            mockPreamp = parseInt(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("U NB")) {
            mockNB = parseInt(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("U NR")) {
            mockNR = parseInt(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("L NR")) {
            mockNRLevel = parseFloat(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("U TUNER")) {
            mockTuner = parseInt(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("G TUNE")) {
            mockTuner = 1;
            response = "RPRT 0";
          }
          else if (cmd.startsWith("L RFPOWER")) {
            mockRFPower = parseFloat(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("L RF")) {
            mockRFLevel = parseFloat(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("L AGC")) {
            mockAGC = parseInt(cmd.split(" ")[2]);
            response = "RPRT 0";
          }
          else if (cmd.startsWith("S ")) {
            const parts = cmd.split(" ");
            mockSplit = parseInt(parts[1]);
            mockTxVFO = parts[2];
            response = "RPRT 0";
          }
          else response = "RPRT 0";

          if (useExtended) {
            let extendedResp = `${longCmd}:\n`;
            const lines = response.split("\n");
            if (cmd === "m") {
              extendedResp += `Mode: ${lines[0]}\nPassband: ${lines[1]}\n`;
            } else if (cmd.startsWith("l")) {
              const param = cmd.split(" ")[1];
              extendedResp += `${param}: ${response}\n`;
            } else if (cmd.startsWith("u")) {
              const param = cmd.split(" ")[1];
              extendedResp += `${param}: ${response}\n`;
            } else {
              extendedResp += `Value: ${response}\n`;
            }
            extendedResp += "RPRT 0";
            try {
              resolve(parseExtendedResponse(extendedResp));
            } catch (e) {
              reject(e);
            }
          } else {
            resolve(response.trim());
          }
        }, 50);
      });
    }
    return new Promise((resolve, reject) => {
      if (!rigSocket || rigSocket.destroyed) {
        return reject("Not connected to rig");
      }
      
      let responseBuffer = "";
      const timeout = setTimeout(() => {
        rigSocket?.removeListener("data", onData);
        rigSocket?.removeListener("error", onError);
        
        // On timeout, the socket state is likely corrupted (leftover data).
        // We reconnect to ensure the next command starts clean.
        console.warn("Rig command timeout - reconnecting to reset state");
        if (rigSocket) {
          rigSocket.destroy();
          isConnected = false;
          // Reconnect logic will be handled by the next poll or manual action
          // but for now we just reject.
        }
        
        reject("Rig command timeout");
      }, 10000);

      const onData = (data: Buffer) => {
        responseBuffer += data.toString();
        
        if (useExtended) {
          if (responseBuffer.includes("RPRT 0") || responseBuffer.includes("RPRT 1")) {
            clearTimeout(timeout);
            rigSocket?.removeListener("data", onData);
            rigSocket?.removeListener("error", onError);
            try {
              resolve(parseExtendedResponse(responseBuffer));
            } catch (e) {
              reject(e);
            }
          }
        } else {
          // Standard mode
          clearTimeout(timeout);
          rigSocket?.removeListener("data", onData);
          rigSocket?.removeListener("error", onError);
          resolve(responseBuffer.trim());
        }
      };
      
      const onError = (err: Error) => {
        clearTimeout(timeout);
        rigSocket?.removeListener("data", onData);
        reject(err);
      };
      
      rigSocket.on("data", onData);
      rigSocket.once("error", onError);
      rigSocket.write(finalCmd + "\n");
    });
  };

  const pollRig = async () => {
    if (!isMock && !isConnected) {
      // If disconnected, try to reconnect occasionally
      if (rigConfig.host && rigConfig.host !== "mock" && !isMock) {
        console.log("Attempting background reconnection...");
        connectToRig(rigConfig.host, rigConfig.port);
      }
      return;
    }
    try {
      const now = Date.now();
      
      // Poll all items at the user-selected pollRate
      const ptt = await sendToRig("t", true);
      const smeter = await sendToRig("l STRENGTH", true);
      const isPttActive = ptt === "1";
      
      let alc = "0";
      let powerMeter = "0";
      let swr = "1.0";

      if (isPttActive) {
        try {
          alc = await sendToRig("l ALC", true);
          powerMeter = await sendToRig("l RFPOWER_METER", true);
          swr = await sendToRig("l SWR", true);
        } catch (e) {
          console.warn("TX levels poll failed, might not be supported");
        }
      }

      // VDD Poll (Conditional)
      let vdd = lastStatus.vdd?.toString() || "13.8";
      if (visibleMeters.includes('vdd')) {
        vdd = await sendToRig("l VD_METER", true).catch(() => "13.8");
      }

      const frequency = await sendToRig("f", true);
      const modeBw = await sendToRig("m", true);
      const [mode, bandwidth] = modeBw.split("\n");
      const rfpower = parseFloat(await sendToRig("l RFPOWER", true));
      const rflevel = parseFloat(await sendToRig("l RF", true).catch(() => "0"));
      const agc = parseInt(await sendToRig("l AGC", true).catch(() => "6"));
      const vfo = await sendToRig("v", true);
      const splitInfo = await sendToRig("s", true);
      const [isSplitStr, txVFO] = splitInfo.split("\n");
      const att = parseInt(await sendToRig("l ATT", true)) || 0;
      const preamp = parseInt(await sendToRig("l PREAMP", true)) || 0;
      const nb = (await sendToRig("u NB", true)) === "1";
      const nr = (await sendToRig("u NR", true).catch(() => "0")) === "1";
      const nrLevel = parseFloat(await sendToRig("l NR", true).catch(() => "0"));
      const tuner = (await sendToRig("u TUNER", true).catch(() => "0")) === "1";

      lastStatus = {
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
        nr,
        nrLevel,
        tuner,
        timestamp: now,
      };

      io.emit("rig-status", lastStatus);
    } catch (err) {
      console.error("Polling error:", err);
    }
  };

  io.on("connection", (socket) => {
    console.log("Client connected");

    socket.on("connect-rig", ({ host, port }) => {
      resetRigState();
      if (host === "mock") {
        isMock = true;
        console.log("Starting Mock Rig Mode");
        socket.emit("rig-connected", { host: "MOCK", port: 0 });
        startPolling();
        return;
      }

      isMock = false;
      connectToRig(host, port, socket);
    });

    socket.on("disconnect-rig", () => {
      isMock = false;
      resetRigState();
      if (rigSocket) {
        rigSocket.destroy();
        rigSocket = null;
      }
      isConnected = false;
      stopPolling();
      socket.emit("rig-disconnected");
      console.log("Rig manually disconnected");
    });

    socket.on("set-func", async ({ func, state }) => {
      try {
        await sendToRig(`U ${func} ${state ? "1" : "0"}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${func}`);
      }
    });

    socket.on("set-level", async ({ level, val }) => {
      try {
        await sendToRig(`L ${level} ${val}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${level}`);
      }
    });

    socket.on("set-frequency", async (freq) => {
      try {
        await sendToRig(`F ${freq}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set frequency");
      }
    });

    socket.on("set-mode", async ({ mode, bandwidth }) => {
      try {
        await sendToRig(`M ${mode} ${bandwidth}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set mode/bandwidth");
      }
    });

    socket.on("get-modes", async () => {
      try {
        const modes = await sendToRig("M ?");
        // rigctld might return modes separated by spaces or newlines
        const modeList = modes.split(/[\s\n]+/).filter(Boolean);
        socket.emit("available-modes", modeList);
      } catch (err) {
        console.error("Failed to get modes:", err);
      }
    });

    socket.on("set-ptt", async (ptt) => {
      try {
        await sendToRig(`T ${ptt ? "1" : "0"}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set PTT");
      }
    });

    socket.on("set-vfo", async (vfo) => {
      try {
        await sendToRig(`V ${vfo}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set VFO");
      }
    });

    socket.on("set-split-vfo", async ({ split, txVFO }) => {
      try {
        await sendToRig(`S ${split} ${txVFO}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", "Failed to set split VFO");
      }
    });

    socket.on("vfo-op", async (op) => {
      try {
        await sendToRig(`G ${op}`);
        pollRig();
      } catch (err) {
        socket.emit("rig-error", `Failed to execute VFO operation: ${op}`);
      }
    });

    socket.on("set-visible-meters", (meters: string[]) => {
      visibleMeters = meters;
    });

    socket.on("set-poll-rate", (rate) => {
      pollRate = rate;
      startPolling();
    });

    socket.on("get-settings", () => {
      socket.emit("settings-data", {
        settings: rigctldSettings,
        autoStart: autoStartEnabled
      });
      emitRigctldStatus();
      socket.emit("rigctld-log", rigctldLogs);
    });

    socket.on("save-settings", (data) => {
      rigctldSettings = data;
      saveSettings();
      if (autoStartEnabled) {
        startRigctld();
      }
    });

    socket.on("toggle-auto-start", (enabled) => {
      autoStartEnabled = enabled;
      saveSettings();
      if (enabled) {
        startRigctld();
      } else {
        stopRigctld();
      }
    });

    socket.on("start-rigctld", () => {
      startRigctld();
    });

    socket.on("stop-rigctld", () => {
      stopRigctld();
    });

    socket.on("test-rigctld", async (data) => {
      const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = data;
      
      addLog("Testing rigctld configuration...");
      
      // 1. Check if rigctld exists
      const check = spawn("rigctld", ["-V"]);
      check.on("error", () => {
        socket.emit("test-result", { success: false, message: "rigctld binary not found in system PATH" });
        addLog("Error: rigctld binary not found");
      });
      
      check.on("close", (code) => {
        if (code !== 0) return; // Error handled above
        
        // 2. Try to start it briefly
        const testProc = spawn("rigctld", [
          "-m", rigNumber,
          "-r", serialPort,
          "-t", portNumber,
          "-T", ipAddress,
          "-s", serialPortSpeed
        ]);
        
        let errorMsg = "";
        testProc.stderr?.on("data", (d) => errorMsg += d.toString());
        
        const timeout = setTimeout(() => {
          testProc.kill();
          socket.emit("test-result", { success: true, message: "Configuration looks valid (process started successfully)" });
          addLog("Test: Success");
        }, 2000);
        
        testProc.on("error", (err) => {
          clearTimeout(timeout);
          socket.emit("test-result", { success: false, message: `Failed to start: ${err.message}` });
          addLog(`Test Failed: ${err.message}`);
        });
        
        testProc.on("close", (c) => {
          clearTimeout(timeout);
          if (c !== null && c !== 0) {
            socket.emit("test-result", { success: false, message: `Process exited with code ${c}. Error: ${errorMsg}` });
            addLog(`Test Failed: ${errorMsg}`);
          }
        });
      });
    });

    socket.on("get-radios", () => {
      if (fs.existsSync(RADIOS_FILE)) {
        try {
          const radios = JSON.parse(fs.readFileSync(RADIOS_FILE, "utf-8"));
          socket.emit("radios-list", radios);
        } catch (e) {
          console.error("Failed to load radios:", e);
          socket.emit("radios-list", []);
        }
      } else {
        socket.emit("radios-list", []);
      }
    });

    socket.on("send-raw", async (cmd) => {
      try {
        const resp = await sendToRig(cmd);
        socket.emit("raw-response", { cmd, resp });
      } catch (err) {
        socket.emit("raw-response", { cmd, resp: `Error: ${err}` });
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
