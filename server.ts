import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import net from "net";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  let rigSocket: net.Socket | null = null;
  let pollingInterval: NodeJS.Timeout | null = null;
  let pollRate = 2000;
  let rigConfig = { host: "", port: 0 };

  let isMock = false;
  let lastSlowPollTime = 0;
  let isFirstPoll = true;
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
    attenuation: 0,
    preamp: 0,
    nb: false,
    nr: false,
    nrLevel: 0.5,
    tuner: false
  };

  const resetRigState = () => {
    isFirstPoll = true;
    lastSlowPollTime = 0;
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
      attenuation: 0,
      preamp: 0,
      nb: false,
      nr: false,
      nrLevel: 0.5,
      tuner: false
    };
  };

  let mockAtt = 0;
  let mockPreamp = 0;
  let mockNB = 0;
  let mockNR = 0;
  let mockNRLevel = 0.5;
  let mockTuner = 0;
  let mockRFPower = 0.5;

  const sendToRig = (cmd: string): Promise<string> => {
    if (isMock) {
      return new Promise((resolve) => {
        setTimeout(() => {
          if (cmd === "f") resolve("14250000");
          else if (cmd === "m") resolve("USB\n2400");
          else if (cmd === "M ?") resolve("AM CW USB LSB RTTY FM PKTUSB PKTLSB");
          else if (cmd === "t") resolve("0");
          else if (cmd === "v") resolve("VFOA");
          else if (cmd.startsWith("G")) resolve("RPRT 0");
          else if (cmd.startsWith("l STRENGTH")) resolve((Math.random() * -100).toString());
          else if (cmd.startsWith("l SWR")) resolve((1 + Math.random() * 0.5).toString());
          else if (cmd.startsWith("l ALC")) resolve(Math.random().toString());
          else if (cmd.startsWith("l VD_METER")) resolve((13.5 + Math.random() * 0.6).toString());
          else if (cmd.startsWith("l RFPOWER_METER")) resolve((mockRFPower * (0.9 + Math.random() * 0.2)).toString());
          else if (cmd.startsWith("l RFPOWER")) resolve(mockRFPower.toString());
          else if (cmd.startsWith("l ATT")) resolve(mockAtt.toString());
          else if (cmd.startsWith("l PREAMP")) resolve(mockPreamp.toString());
          else if (cmd.startsWith("u NB")) resolve(mockNB.toString());
          else if (cmd.startsWith("u NR")) resolve(mockNR.toString());
          else if (cmd.startsWith("l NR")) resolve(mockNRLevel.toString());
          else if (cmd.startsWith("u TUNER")) resolve(mockTuner.toString());
          else if (cmd.startsWith("L ATT")) {
            mockAtt = parseInt(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("L PREAMP")) {
            mockPreamp = parseInt(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("U NB")) {
            mockNB = parseInt(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("U NR")) {
            mockNR = parseInt(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("L NR")) {
            mockNRLevel = parseFloat(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("U TUNER")) {
            mockTuner = parseInt(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("G TUNE")) {
            mockTuner = 1;
            resolve("RPRT 0");
          }
          else if (cmd.startsWith("L RFPOWER")) {
            mockRFPower = parseFloat(cmd.split(" ")[2]);
            resolve("RPRT 0");
          }
          else resolve("RPRT 0");
        }, 50);
      });
    }
    return new Promise((resolve, reject) => {
      if (!rigSocket || rigSocket.destroyed) {
        return reject("Not connected to rig");
      }
      const onData = (data: Buffer) => {
        rigSocket?.removeListener("error", onError);
        resolve(data.toString().trim());
      };
      const onError = (err: Error) => {
        rigSocket?.removeListener("data", onData);
        reject(err);
      };
      rigSocket.once("data", onData);
      rigSocket.once("error", onError);
      rigSocket.write(cmd + "\n");
    });
  };

  const pollRig = async (forceSlow = false) => {
    if (!isMock && (!rigSocket || rigSocket.destroyed)) return;
    try {
      const now = Date.now();
      const shouldPollSlow = forceSlow || isFirstPoll || (now - lastSlowPollTime > 30000);
      
      // Fast Poll Items (Always)
      const ptt = await sendToRig("t");
      const smeter = await sendToRig("l STRENGTH");
      const isPttActive = ptt === "1";
      
      let alc = "0";
      let powerMeter = "0";
      let swr = "1.0";

      if (isPttActive) {
        try {
          alc = await sendToRig("l ALC");
          powerMeter = await sendToRig("l RFPOWER_METER");
          swr = await sendToRig("l SWR");
        } catch (e) {
          console.warn("TX levels poll failed, might not be supported");
        }
      }

      // VDD Poll (Conditional)
      let vdd = lastStatus.vdd?.toString() || "13.8";
      if (visibleMeters.includes('vdd')) {
        vdd = await sendToRig("l VD_METER").catch(() => "13.8");
      }

      // Slow Poll Items
      let frequency = lastStatus.frequency;
      let mode = lastStatus.mode;
      let bandwidth = lastStatus.bandwidth;
      let rfpower = lastStatus.rfpower;
      let vfo = lastStatus.vfo;
      let att = lastStatus.attenuation;
      let preamp = lastStatus.preamp;
      let nb = lastStatus.nb;
      let nr = lastStatus.nr;
      let nrLevel = lastStatus.nrLevel;
      let tuner = lastStatus.tuner;

      if (shouldPollSlow) {
        frequency = await sendToRig("f");
        const modeBw = await sendToRig("m");
        const [m, bw] = modeBw.split("\n");
        mode = m;
        bandwidth = bw;
        rfpower = parseFloat(await sendToRig("l RFPOWER"));
        vfo = await sendToRig("v");
        att = parseInt(await sendToRig("l ATT")) || 0;
        preamp = parseInt(await sendToRig("l PREAMP")) || 0;
        nb = (await sendToRig("u NB")) === "1";
        nr = (await sendToRig("u NR").catch(() => "0")) === "1";
        nrLevel = parseFloat(await sendToRig("l NR").catch(() => "0"));
        tuner = (await sendToRig("u TUNER").catch(() => "0")) === "1";
        
        lastSlowPollTime = now;
        isFirstPoll = false;
      }

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
        vdd: parseFloat(vdd),
        vfo,
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
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(pollRig, pollRate);
        return;
      }

      isMock = false;
      if (rigSocket) {
        rigSocket.destroy();
        if (pollingInterval) clearInterval(pollingInterval);
      }

      rigConfig = { host, port };
      
      rigSocket = new net.Socket();
      
      rigSocket.connect(port, host, () => {
        console.log(`Connected to rigctld at ${host}:${port}`);
        socket.emit("rig-connected", { host, port });
        
        if (pollingInterval) clearInterval(pollingInterval);
        pollingInterval = setInterval(pollRig, pollRate);
      });

      rigSocket.on("error", (err) => {
        console.error("Rig socket error:", err);
        socket.emit("rig-error", `Connection Failed: ${err.message}. Please check your settings and try again.`);
      });

      rigSocket.on("close", () => {
        console.log("Rig connection closed");
        socket.emit("rig-disconnected");
        if (pollingInterval) clearInterval(pollingInterval);
      });
    });

    socket.on("disconnect-rig", () => {
      isMock = false;
      resetRigState();
      if (rigSocket) {
        rigSocket.destroy();
        rigSocket = null;
      }
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      socket.emit("rig-disconnected");
      console.log("Rig manually disconnected");
    });

    socket.on("set-func", async ({ func, state }) => {
      try {
        await sendToRig(`U ${func} ${state ? "1" : "0"}`);
        pollRig(true);
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${func}`);
      }
    });

    socket.on("set-level", async ({ level, val }) => {
      try {
        await sendToRig(`L ${level} ${val}`);
        pollRig(true);
      } catch (err) {
        socket.emit("rig-error", `Failed to set ${level}`);
      }
    });

    socket.on("set-frequency", async (freq) => {
      try {
        await sendToRig(`F ${freq}`);
        pollRig(true);
      } catch (err) {
        socket.emit("rig-error", "Failed to set frequency");
      }
    });

    socket.on("set-mode", async ({ mode, bandwidth }) => {
      try {
        await sendToRig(`M ${mode} ${bandwidth}`);
        pollRig(true);
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
        pollRig(true);
      } catch (err) {
        socket.emit("rig-error", "Failed to set PTT");
      }
    });

    socket.on("set-vfo", async (vfo) => {
      try {
        await sendToRig(`V ${vfo}`);
        pollRig(true);
      } catch (err) {
        socket.emit("rig-error", "Failed to set VFO");
      }
    });

    socket.on("vfo-op", async (op) => {
      try {
        await sendToRig(`G ${op}`);
        pollRig(true);
      } catch (err) {
        socket.emit("rig-error", `Failed to execute VFO operation: ${op}`);
      }
    });

    socket.on("set-visible-meters", (meters: string[]) => {
      visibleMeters = meters;
    });

    socket.on("set-poll-rate", (rate) => {
      pollRate = rate;
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = setInterval(pollRig, pollRate);
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
