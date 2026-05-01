import net from "net";
import { Socket } from "socket.io";
import { ServerContext } from "./context.ts";
import { vlog } from "./vlog.ts";

export function formatExtendedCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const parts = trimmed.split(/\s+/);
  if (parts[0].length === 1) {
    return `+${trimmed}`;
  }
  return `+\\${trimmed}`;
}

export function parseExtendedResponse(resp: string): string {
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

export function executeRigCommand(ctx: ServerContext, cmd: string, useExtended = false): Promise<string> {
  const finalCmd = useExtended ? formatExtendedCommand(cmd) : cmd;

  return new Promise((resolve, reject) => {
    if (!ctx.rigSocket || ctx.rigSocket.destroyed) {
      console.error(`[RIG] Command rejected (not connected): "${cmd}"`);
      return reject("Not connected to rig");
    }

    let responseBuffer = "";
    const timeout = setTimeout(() => {
      ctx.rigSocket?.removeListener("data", onData);
      ctx.rigSocket?.removeListener("error", onError);
      console.warn(`[RIG] Command timed out: "${cmd}" (extended=${useExtended}) — destroying socket to reset state`);
      if (ctx.rigSocket) {
        ctx.rigSocket.destroy();
        ctx.isConnected = false;
      }
      reject(`Rig command timeout: "${cmd}"`);
    }, 10000);

    const onData = (data: Buffer) => {
      responseBuffer += data.toString();

      if (useExtended) {
        const rprtMatch = responseBuffer.match(/RPRT (-?\d+)/);
        if (rprtMatch) {
          clearTimeout(timeout);
          ctx.rigSocket?.removeListener("data", onData);
          ctx.rigSocket?.removeListener("error", onError);
          vlog(`[RIG] Response for "${cmd}": ${responseBuffer.trim()}`);
          const rprtCode = parseInt(rprtMatch[1], 10);
          if (rprtCode === 0 || rprtCode === 1) {
            try {
              resolve(parseExtendedResponse(responseBuffer));
            } catch (e) {
              console.error(`[RIG] Parse error for "${cmd}":`, e);
              reject(e);
            }
          } else {
            reject(`RPRT ${rprtCode}: "${cmd}"`);
          }
        }
      } else {
        clearTimeout(timeout);
        ctx.rigSocket?.removeListener("data", onData);
        ctx.rigSocket?.removeListener("error", onError);
        vlog(`[RIG] Response for "${cmd}": ${responseBuffer.trim()}`);
        resolve(responseBuffer.trim());
      }
    };

    const onError = (err: Error) => {
      clearTimeout(timeout);
      ctx.rigSocket?.removeListener("data", onData);
      console.error(`[RIG] Socket error during command "${cmd}":`, err.message);
      reject(err);
    };

    vlog(`[RIG] Sending command: "${cmd}"`);
    ctx.rigSocket.on("data", onData);
    ctx.rigSocket.once("error", onError);
    ctx.rigSocket.write(finalCmd + "\n");
  });
}

const processRigQueue = async (ctx: ServerContext) => {
  if (ctx.isRigBusy || ctx.rigCommandQueue.length === 0) return;
  ctx.isRigBusy = true;
  const { cmd, useExtended, resolve, reject } = ctx.rigCommandQueue.shift()!;
  try {
    const resp = await executeRigCommand(ctx, cmd, useExtended);
    resolve(resp);
  } catch (err) {
    reject(err);
  } finally {
    ctx.isRigBusy = false;
    setTimeout(() => processRigQueue(ctx), 10);
  }
};

export function sendToRig(ctx: ServerContext, cmd: string, useExtended = false, priority = false): Promise<string> {
  return new Promise((resolve, reject) => {
    if (priority) {
      ctx.rigCommandQueue.unshift({ cmd, useExtended, resolve, reject });
    } else {
      ctx.rigCommandQueue.push({ cmd, useExtended, resolve, reject });
    }
    processRigQueue(ctx);
  });
}

export async function probeVfoCapability(ctx: ServerContext): Promise<void> {
  try {
    const result = await sendToRig(ctx, "v", false);
    if (result.includes("RPRT -11")) {
      ctx.vfoSupported = false;
      console.log("VFO not supported by this radio (RPRT -11); disabling VFO B and split");
      const freq = await sendToRig(ctx, "f", false);
      if (!freq || freq.includes("RPRT")) {
        console.warn("get_freq also failed after VFO probe — rig may not be responding");
      }
    } else {
      ctx.vfoSupported = true;
      console.log(`VFO supported (reported: ${result})`);
    }
  } catch (err) {
    ctx.vfoSupported = false;
    console.log("VFO probe failed; disabling VFO B and split:", err);
  }
}

export function stopPolling(ctx: ServerContext): void {
  if (ctx.pollingTimeout) {
    clearTimeout(ctx.pollingTimeout);
    ctx.pollingTimeout = null;
  }
}

export async function pollRig(ctx: ServerContext): Promise<void> {
  if (!ctx.isConnected) {
    if (ctx.rigConfig.host && ctx.rigConfig.host !== "mock") {
      console.log("Attempting background reconnection...");
      connectToRig(ctx, ctx.rigConfig.host, ctx.rigConfig.port);
    }
    return;
  }
  try {
    const now = Date.now();
    const isSlowPoll = ctx.pollCycleCount % 10 === 0;
    ctx.pollCycleCount++;

    const ptt = await sendToRig(ctx, "t", true);
    const smeter = await sendToRig(ctx, "l STRENGTH", true);
    const isPttActive = ptt === "1";

    let alc = ctx.lastStatus.alc?.toString() || "0";
    let powerMeter = ctx.lastStatus.powerMeter?.toString() || "0";
    let swr = ctx.lastStatus.swr?.toString() || "1.0";

    if (isPttActive) {
      try {
        alc = await sendToRig(ctx, "l ALC", true);
        powerMeter = await sendToRig(ctx, "l RFPOWER_METER", true);
        swr = await sendToRig(ctx, "l SWR", true);
      } catch (e) {
        console.warn("TX levels poll failed, might not be supported");
      }
    }

    let frequency = ctx.lastStatus.frequency;
    let mode = ctx.lastStatus.mode;
    let bandwidth = ctx.lastStatus.bandwidth;
    let rfpower = ctx.lastStatus.rfpower;
    let rflevel = ctx.lastStatus.rfLevel;
    let agc = ctx.lastStatus.agc;
    let vfo = ctx.lastStatus.vfo;
    let isSplit = ctx.lastStatus.isSplit;
    let txVFO = ctx.lastStatus.txVFO;
    let att = ctx.lastStatus.attenuation;
    let preamp = ctx.lastStatus.preamp;
    let nb = ctx.lastStatus.nb;
    let nbLevel = ctx.lastStatus.nbLevel;
    let nr = ctx.lastStatus.nr;
    let nrLevel = ctx.lastStatus.nrLevel;
    let anf = ctx.lastStatus.anf;
    let tuner = ctx.lastStatus.tuner;
    let vdd = ctx.lastStatus.vdd;

    if (isSlowPoll) {
      if (ctx.visibleMeters.includes('vdd')) {
        vdd = parseFloat(await sendToRig(ctx, "l VD_METER", true).catch(() => "13.8"));
      }
      frequency = await sendToRig(ctx, "f", true);
      const modeBw = await sendToRig(ctx, "m", true);
      const [m, b] = modeBw.split("\n");
      mode = m;
      bandwidth = b;
      rfpower = parseFloat(await sendToRig(ctx, "l RFPOWER", true));
      rflevel = parseFloat(await sendToRig(ctx, "l RF", true).catch(() => "0"));
      agc = parseInt(await sendToRig(ctx, "l AGC", true).catch(() => "6"));
      if (ctx.vfoSupported) {
        vfo = await sendToRig(ctx, "v", true);
        const splitInfo = await sendToRig(ctx, "s", true);
        const [isSplitStr, txVFOStr] = splitInfo.split("\n");
        isSplit = isSplitStr === "1";
        txVFO = txVFOStr || "VFOB";
      }
      att = parseInt(await sendToRig(ctx, "l ATT", true)) || 0;
      preamp = parseInt(await sendToRig(ctx, "l PREAMP", true)) || 0;
      nb = (await sendToRig(ctx, "u NB", true).catch(() => "0")) === "1";
      nbLevel = parseFloat(await sendToRig(ctx, "l NB", true).catch(() => "0"));
      nr = (await sendToRig(ctx, "u NR", true).catch(() => "0")) === "1";
      nrLevel = parseFloat(await sendToRig(ctx, "l NR", true).catch(() => "0"));
      anf = (await sendToRig(ctx, "u ANF", true).catch(() => "0")) === "1";
      tuner = (await sendToRig(ctx, "u TUNER", true).catch(() => "0")) === "1";
    }

    ctx.lastStatus = {
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
      vdd: parseFloat(vdd as unknown as string),
      vfo,
      isSplit,
      txVFO,
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

    ctx.io.emit("rig-status", ctx.lastStatus);
  } catch (err) {
    console.error(`[RIG] Poll cycle ${ctx.pollCycleCount} failed:`, err);
  }
}

export function startPolling(ctx: ServerContext): void {
  stopPolling(ctx);
  const runPoll = async () => {
    if (!ctx.isConnected) return;
    if (ctx.cwIsKeying) {
      ctx.pollingTimeout = setTimeout(runPoll, 200);
      return;
    }
    const startTime = Date.now();
    await pollRig(ctx);
    const duration = Date.now() - startTime;
    const nextDelay = Math.max(0, ctx.pollRate - duration);
    ctx.pollingTimeout = setTimeout(runPoll, nextDelay);
  };
  ctx.pollingTimeout = setTimeout(runPoll, ctx.pollRate);
}

export function resetRigState(ctx: ServerContext): void {
  ctx.vfoSupported = true;
  ctx.lastStatus = {
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
    nrLevel: 8 / 15,
    anf: false,
    tuner: false,
  };
}

export function connectToRig(ctx: ServerContext, host: string, port: number, socket?: Socket): void {
  if (ctx.isConnected && ctx.rigConfig.host === host && ctx.rigConfig.port === port) {
    console.log(`Already connected to rigctld at ${host}:${port}. Informing client.`);
    if (socket) {
      socket.emit("rig-connected", { host, port });
    } else {
      ctx.io.emit("rig-connected", { host, port });
    }
    return;
  }

  if (ctx.rigSocket) {
    ctx.rigSocket.destroy();
    ctx.rigSocket = null;
  }

  ctx.rigConfig = { host, port };
  ctx.rigSocket = new net.Socket();

  ctx.rigSocket.connect(port, host, async () => {
    console.log(`Connected to rigctld at ${host}:${port}`);
    ctx.isConnected = true;
    await probeVfoCapability(ctx);
    ctx.io.emit("rig-connected", { host, port, vfoSupported: ctx.vfoSupported });
    startPolling(ctx);
  });

  ctx.rigSocket.on("error", (err) => {
    console.error("Rig socket error:", err);
    ctx.isConnected = false;
    ctx.io.emit("rig-error", `Connection Error: ${err.message}`);
  });

  ctx.rigSocket.on("close", () => {
    console.log("Rig connection closed");
    ctx.isConnected = false;
    ctx.io.emit("rig-disconnected");
    stopPolling(ctx);
  });
}

export function registerRigCommHandlers(socket: Socket, ctx: ServerContext): void {
  socket.on("connect-rig", ({ host, port }) => {
    resetRigState(ctx);
    connectToRig(ctx, host, port, socket);
  });

  socket.on("disconnect-rig", () => {
    resetRigState(ctx);
    if (ctx.rigSocket) {
      ctx.rigSocket.destroy();
      ctx.rigSocket = null;
    }
    ctx.isConnected = false;
    stopPolling(ctx);
    ctx.io.emit("rig-disconnected");
    console.log("Rig manually disconnected");
  });

  socket.on("set-func", async ({ func, state }) => {
    try {
      await sendToRig(ctx, `U ${func} ${state ? "1" : "0"}`, false, true);
      const confirmedState = (await sendToRig(ctx, `u ${func}`, true, true)) === "1";
      const key = func.toLowerCase() as any;
      ctx.lastStatus = { ...ctx.lastStatus, [key]: confirmedState };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", `Failed to set ${func}`);
    }
  });

  socket.on("set-level", async ({ level, val }) => {
    try {
      await sendToRig(ctx, `L ${level} ${val}`, false, true);
      const confirmedVal = parseFloat(await sendToRig(ctx, `l ${level}`, true, true));
      const key = level.toLowerCase() === "rfpower" ? "rfpower" :
                  level.toLowerCase() === "rf" ? "rfLevel" :
                  level.toLowerCase() === "agc" ? "agc" :
                  level.toLowerCase() === "att" ? "attenuation" :
                  level.toLowerCase() === "preamp" ? "preamp" :
                  level.toLowerCase() === "nr" ? "nrLevel" :
                  level.toLowerCase() === "nb" ? "nbLevel" : null;
      if (key) {
        ctx.lastStatus = { ...ctx.lastStatus, [key]: confirmedVal };
        ctx.io.emit("rig-status", ctx.lastStatus);
      }
    } catch (err) {
      socket.emit("rig-error", `Failed to set ${level}`);
    }
  });

  socket.on("tune-to-spot", async ({ freqHz, mode, modeChanged }: { freqHz: string; mode: string; modeChanged: boolean }) => {
    try {
      await sendToRig(ctx, `F ${freqHz}`, false, true);
      if (modeChanged) {
        await sendToRig(ctx, `M ${mode} -1`, false, true);
        const modeBw = await sendToRig(ctx, "m", true, true);
        const [confirmedMode, confirmedBw] = modeBw.split("\n");
        ctx.lastStatus = { ...ctx.lastStatus, mode: confirmedMode, bandwidth: confirmedBw };
        await new Promise(resolve => setTimeout(resolve, 200));
        await sendToRig(ctx, `F ${freqHz}`, false, true);
      }
      const confirmedFreq = await sendToRig(ctx, "f", true, true);
      ctx.lastStatus = { ...ctx.lastStatus, frequency: confirmedFreq };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to tune to spot");
    }
  });

  socket.on("set-frequency", async (freq) => {
    try {
      await sendToRig(ctx, `F ${freq}`, false, true);
      const confirmedFreq = await sendToRig(ctx, "f", true, true);
      ctx.lastStatus = { ...ctx.lastStatus, frequency: confirmedFreq };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set frequency");
    }
  });

  socket.on("set-mode", async ({ mode, bandwidth }) => {
    try {
      await sendToRig(ctx, `M ${mode} ${bandwidth}`, false, true);
      const modeBw = await sendToRig(ctx, "m", true, true);
      const [confirmedMode, confirmedBw] = modeBw.split("\n");
      ctx.lastStatus = { ...ctx.lastStatus, mode: confirmedMode, bandwidth: confirmedBw };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set mode/bandwidth");
    }
  });

  socket.on("get-modes", async () => {
    try {
      const modes = await sendToRig(ctx, "M ?", false, true);
      const modeList = modes.split(/[\s\n]+/).filter(m => Boolean(m) && m !== "RPRT" && !/^\d+$/.test(m));
      socket.emit("available-modes", modeList);
    } catch (err) {
      console.error("Failed to get modes:", err);
    }
  });

  socket.on("set-ptt", async (ptt) => {
    try {
      await sendToRig(ctx, `T ${ptt ? "1" : "0"}`, false, true);
      const confirmedPtt = (await sendToRig(ctx, "t", true, true)) === "1";
      ctx.lastStatus = { ...ctx.lastStatus, ptt: confirmedPtt };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set PTT");
    }
  });

  socket.on("set-vfo", async (vfo) => {
    if (!ctx.vfoSupported) return;
    try {
      await sendToRig(ctx, `V ${vfo}`, false, true);
      const confirmedVfo = await sendToRig(ctx, "v", true, true);
      ctx.lastStatus = { ...ctx.lastStatus, vfo: confirmedVfo };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set VFO");
    }
  });

  socket.on("set-split-vfo", async ({ split, txVFO }) => {
    if (!ctx.vfoSupported) return;
    try {
      await sendToRig(ctx, `S ${split} ${txVFO}`, false, true);
      const splitInfo = await sendToRig(ctx, "s", true, true);
      const [isSplitStr, confirmedTxVFO] = splitInfo.split("\n");
      ctx.lastStatus = { ...ctx.lastStatus, isSplit: isSplitStr === "1", txVFO: confirmedTxVFO || "VFOB" };
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", "Failed to set split VFO");
    }
  });

  socket.on("vfo-op", async (op) => {
    try {
      await sendToRig(ctx, `G ${op}`, false, true);
      const frequency = await sendToRig(ctx, "f", true, true);
      const modeBw = await sendToRig(ctx, "m", true, true);
      const [mode, bandwidth] = modeBw.split("\n");
      if (ctx.vfoSupported) {
        const vfo = await sendToRig(ctx, "v", true, true);
        ctx.lastStatus = { ...ctx.lastStatus, frequency, mode, bandwidth, vfo };
      } else {
        ctx.lastStatus = { ...ctx.lastStatus, frequency, mode, bandwidth };
      }
      ctx.io.emit("rig-status", ctx.lastStatus);
    } catch (err) {
      socket.emit("rig-error", `Failed to execute VFO operation: ${op}`);
    }
  });

  socket.on("set-visible-meters", (meters: string[]) => {
    ctx.visibleMeters = meters;
  });

  socket.on("set-poll-rate", (rate) => {
    ctx.pollRate = rate;
    ctx.saveSettings();
    startPolling(ctx);
  });

  socket.on("set-autoconnect-eligible", (eligible) => {
    ctx.autoconnectEligible = eligible;
    ctx.saveSettings();
  });

  socket.on("set-client-config", ({ host, port }) => {
    ctx.clientHost = host;
    ctx.clientPort = port;
    ctx.saveSettings();
  });

  socket.on("send-raw", async (cmd) => {
    try {
      const resp = await sendToRig(ctx, cmd, false, true);
      socket.emit("raw-response", { cmd, resp });
    } catch (err) {
      socket.emit("raw-response", { cmd, resp: `Error: ${err}` });
    }
  });
}
