import path from "path";
import fs from "fs";
import { spawn, exec, execFile, ChildProcess } from "child_process";
import { Socket } from "socket.io";
import type { ServerContext } from "./context.ts";
import { vlogRig as vlog } from "./vlog.ts";

export function getRigctldPath(baseDir: string): string {
  let platformDir = "";
  if (process.platform === "win32") platformDir = "windows";
  else if (process.platform === "linux") platformDir = "linux";
  else if (process.platform === "darwin") platformDir = "mac";

  const binaryName = process.platform === "win32" ? "rigctld.exe" : "rigctld";

  let binBase = baseDir;
  if (baseDir.endsWith(".asar")) {
    binBase = baseDir.replace(".asar", ".asar.unpacked");
  }

  const localPath = platformDir ? path.join(binBase, "bin", platformDir, binaryName) : "";

  if (localPath && fs.existsSync(localPath)) {
    vlog(`[HAMLIB] Using bundled rigctld at: ${localPath}`);
    return localPath;
  }

  vlog(`[HAMLIB] Bundled rigctld not found at ${localPath || "unsupported platform"}, falling back to system PATH`);
  return "rigctld";
}

export function getRigctldVersion(baseDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(getRigctldPath(baseDir), ["-V"]);
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

export function checkVersionSupported(version: string | null): boolean {
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

export function emitRigctldStatus(ctx: ServerContext): void {
  ctx.io.emit("rigctld-status", {
    status: ctx.rigctldStatus,
    logs: ctx.rigctldLogs,
    version: ctx.rigctldVersion,
    isVersionSupported: ctx.isRigctldVersionSupported,
  });
}

export function addLog(ctx: ServerContext, data: string): void {
  const lines = data.split("\n").filter(l => l.trim());
  ctx.rigctldLogs = [...ctx.rigctldLogs, ...lines].slice(-100);
  ctx.io.emit("rigctld-log", lines);
}

export function stopRigctld(ctx: ServerContext): void {
  if (ctx.rigctldProcess) {
    vlog("Stopping rigctld...");
    const pid = ctx.rigctldProcess.pid;
    // On Windows, kill() doesn't terminate child process trees. Use taskkill
    // with /T (tree) and /F (force) to ensure rigctld and any spawned children
    // are fully terminated.
    if (process.platform === "win32" && pid) {
      exec(`taskkill /PID ${pid} /T /F`, () => {});
    } else {
      ctx.rigctldProcess.kill();
    }
    ctx.rigctldProcess = null;
    ctx.rigctldStatus = "stopped";
    emitRigctldStatus(ctx);
  }
}

export function checkExistingRigctld(): Promise<boolean> {
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

export function killExistingRigctld(): Promise<void> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "taskkill /F /IM rigctld.exe" : "pkill -9 rigctld";
    exec(cmd, () => resolve());
  });
}

export function fetchRadioCapabilities(ctx: ServerContext, rigNumber: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!rigNumber || rigNumber === "" || rigNumber === "1" || !/^\d+$/.test(rigNumber)) {
      resolve(false);
      return;
    }

    const rigctldPath = getRigctldPath(ctx.baseDir);
    vlog(`[HAMLIB] Fetching radio capabilities for rig ${rigNumber}...`);

    execFile(rigctldPath, ["-m", rigNumber, "-u"], (error, stdout) => {
      if (error) {
        console.error(`[HAMLIB] Error getting radio capabilities: ${error.message}`);
        resolve(false);
        return;
      }

      const lines = stdout.split('\n');

      const preampLine = lines.find(line => line.trim().startsWith('Preamp:'));
      ctx.rigctldSettings.preampCapabilities = preampLine
        ? preampLine.replace('Preamp:', '').trim().split(/\s+/).filter(Boolean)
        : [];

      const attenuatorLine = lines.find(line => line.trim().startsWith('Attenuator:'));
      ctx.rigctldSettings.attenuatorCapabilities = attenuatorLine
        ? attenuatorLine.replace('Attenuator:', '').trim().split(/\s+/).filter(Boolean)
        : [];

      const agcLine = lines.find(line => line.trim().startsWith('AGC levels:'));
      ctx.rigctldSettings.agcCapabilities = agcLine
        ? agcLine.replace('AGC levels:', '').trim().split(/\s+/).filter(Boolean)
        : [];

      const setFunctionsLine = lines.find(line => line.trim().startsWith('Set functions:'));
      if (setFunctionsLine) {
        const functions = setFunctionsLine.replace('Set functions:', '').trim().split(/\s+/);
        ctx.rigctldSettings.nbSupported = functions.includes('NB');
        ctx.rigctldSettings.nrSupported = functions.includes('NR');
        ctx.rigctldSettings.anfSupported = functions.includes('ANF');
      } else {
        ctx.rigctldSettings.nbSupported = false;
        ctx.rigctldSettings.nrSupported = false;
        ctx.rigctldSettings.anfSupported = false;
      }

      const getLevelLine = lines.find(line => line.trim().startsWith('Get level:'));
      if (getLevelLine) {
        const nbMatch = getLevelLine.match(/\bNB\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        ctx.rigctldSettings.nbLevelSupported = !!nbMatch;
        ctx.rigctldSettings.nbLevelRange = nbMatch
          ? { min: parseFloat(nbMatch[1]), max: parseFloat(nbMatch[2]), step: parseFloat(nbMatch[3]) }
          : { min: 0, max: 1, step: 0.1 };

        const nrMatch = getLevelLine.match(/\bNR\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        ctx.rigctldSettings.nrLevelSupported = !!nrMatch;
        ctx.rigctldSettings.nrLevelRange = nrMatch
          ? { min: parseFloat(nrMatch[1]), max: parseFloat(nrMatch[2]), step: parseFloat(nrMatch[3]) }
          : { min: 0, max: 1, step: 0.066667 };

        // Some rigs (e.g. Xiegu G90) list RF with a degenerate 0..0/0 range even though get/set
        // RF genuinely work at runtime — treat a degenerate match the same as no match at all.
        const rfMatch = getLevelLine.match(/\bRF\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        const rfParsed = rfMatch
          ? { min: parseFloat(rfMatch[1]), max: parseFloat(rfMatch[2]), step: parseFloat(rfMatch[3]) }
          : null;
        const rfSane = !!rfParsed && rfParsed.max > rfParsed.min && rfParsed.step > 0;
        ctx.rigctldSettings.rfLevelSupported = rfSane;
        ctx.rigctldSettings.rfLevelRange = rfSane
          ? rfParsed!
          : { min: 0, max: 1, step: 0.1 };

        // Some rigs (e.g. Xiegu G90) list RFPOWER with a degenerate 0..0/0 range even though
        // get/set RFPOWER genuinely work at runtime — fall back to the default range in that case.
        const rfPowerMatch = getLevelLine.match(/RFPOWER\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        const rfPowerParsed = rfPowerMatch
          ? { min: parseFloat(rfPowerMatch[1]), max: parseFloat(rfPowerMatch[2]), step: parseFloat(rfPowerMatch[3]) }
          : null;
        ctx.rigctldSettings.rfPowerRange = rfPowerParsed && rfPowerParsed.max > rfPowerParsed.min && rfPowerParsed.step > 0
          ? rfPowerParsed
          : { min: 0, max: 1, step: 0.01 };
      } else {
        ctx.rigctldSettings.nbLevelSupported = false;
        ctx.rigctldSettings.nrLevelSupported = false;
        ctx.rigctldSettings.rfLevelSupported = false;
      }

      resolve(true);
    });
  });
}

export async function startRigctld(ctx: ServerContext): Promise<void> {
  if (ctx.rigctldProcess) {
    stopRigctld(ctx);
  }

  ctx.rigctldVersion = await getRigctldVersion(ctx.baseDir);
  ctx.isRigctldVersionSupported = checkVersionSupported(ctx.rigctldVersion);
  vlog(`[HAMLIB] rigctld version check: ${ctx.rigctldVersion || "unknown"}`);
  addLog(ctx, `Hamlib (rigctld) version check: ${ctx.rigctldVersion || "unknown"}`);
  if (!ctx.isRigctldVersionSupported) {
    console.warn(`rigctld version ${ctx.rigctldVersion} is less than 4.7.0 and is unsupported.`);
    addLog(ctx, `Warning: rigctld version ${ctx.rigctldVersion} is less than 4.7.0 and is unsupported.`);
  }

  const isAlreadyRunning = await checkExistingRigctld();
  if (isAlreadyRunning) {
    console.warn("rigctld is already running on the system");
    ctx.rigctldStatus = "already_running";
    emitRigctldStatus(ctx);
    addLog(ctx, "Error: rigctld is already running on the system. Please stop it or use the 'Kill and Restart' option.");
    return;
  }

  const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = ctx.rigctldSettings;

  if (!rigNumber || !serialPort || !portNumber || !ipAddress || !serialPortSpeed) {
    console.error("Cannot start rigctld: missing settings");
    ctx.rigctldStatus = "error";
    emitRigctldStatus(ctx);
    return;
  }

  const rigctldPath = getRigctldPath(ctx.baseDir);

  const args = [
    "-m", rigNumber,
    "-r", serialPort,
    "-t", portNumber,
    "-T", ipAddress,
    "-s", serialPortSpeed,
  ];

  const pttType = ctx.rigctldSettings.pttType ?? "rig";
  if (pttType !== "rig") {
    args.push("-p", pttType.toUpperCase());
  }

  if (ctx.spectrumSettings.enabled) {
    args.push(
      `--set-conf=multicast_data_addr=${ctx.spectrumSettings.multicastAddr}`,
      `--set-conf=multicast_data_port=${ctx.spectrumSettings.multicastPort}`,
      "--set-conf=async=1",
    );
  }

  vlog(`Starting rigctld: ${rigctldPath} ${args.join(" ")}`);

  ctx.rigctldProcess = spawn(rigctldPath, args, { detached: false });

  ctx.rigctldStatus = "running";
  emitRigctldStatus(ctx);
  addLog(ctx, "rigctld started");

  ctx.rigctldProcess.stdout?.on("data", (data) => {
    const str = data.toString();
    vlog(`rigctld stdout: ${str}`);
    addLog(ctx, str);
  });

  let stderrBuf = "";
  ctx.rigctldProcess.stderr?.on("data", (data) => {
    const str = data.toString();
    stderrBuf += str;
    vlog(`rigctld stderr: ${str}`);
    addLog(ctx, str);
  });

  ctx.rigctldProcess.on("close", (code) => {
    vlog(`rigctld process exited with code ${code}`);
    addLog(ctx, `rigctld exited with code ${code}`);
    ctx.rigctldProcess = null;
    ctx.rigctldStatus = code === 0 ? "stopped" : "error";

    if (code !== 0 && code !== null && ctx.spectrumSettings.enabled && ctx.spectrumSettings.source === "hamlib" && stderrBuf.includes("unknown option")) {
      const msg = "Spectrum Scope (Hamlib UDP) auto-disabled: this rigctld build does not support --set-conf=multicast_data_addr. Upgrade to Hamlib 4.7.x or use the bundled rigctld binary.";
      console.warn(`[SPECTRUM] ${msg}`);
      addLog(ctx, `Warning: ${msg}`);
      ctx.spectrumSettings = { ...ctx.spectrumSettings, enabled: false };
      ctx.saveSettings();
      ctx.io.emit("settings-data", { spectrumSettings: ctx.spectrumSettings });
    }

    emitRigctldStatus(ctx);
  });

  ctx.rigctldProcess.on("error", (err) => {
    console.error("Failed to start rigctld:", err);
    addLog(ctx, `Error: ${err.message}`);
    ctx.rigctldProcess = null;
    ctx.rigctldStatus = "error";
    emitRigctldStatus(ctx);
  });
}

export function registerRigctldHandlers(
  socket: Socket,
  ctx: ServerContext,
): void {
  socket.on("start-rigctld", () => {
    ctx.autoStartEnabled = true;
    ctx.saveSettings();
    startRigctld(ctx);
  });

  socket.on("stop-rigctld", () => {
    ctx.autoStartEnabled = false;
    ctx.saveSettings();
    stopRigctld(ctx);
  });

  socket.on("kill-existing-rigctld", async () => {
    addLog(ctx, "Killing existing rigctld process...");
    await killExistingRigctld();
    addLog(ctx, "Existing rigctld killed. Starting new process...");
    startRigctld(ctx);
  });

  socket.on("test-rigctld", async (data) => {
    const { rigNumber, serialPort, portNumber, ipAddress, serialPortSpeed } = data;

    addLog(ctx, "Testing rigctld configuration...");

    ctx.rigctldVersion = await getRigctldVersion(ctx.baseDir);
    ctx.isRigctldVersionSupported = checkVersionSupported(ctx.rigctldVersion);
    vlog(`[HAMLIB] Test rigctld version check: ${ctx.rigctldVersion || "unknown"}`);
    addLog(ctx, `Hamlib (rigctld) version check: ${ctx.rigctldVersion || "unknown"}`);
    emitRigctldStatus(ctx);

    if (!ctx.rigctldVersion) {
      socket.emit("test-result", { success: false, message: "rigctld binary not found in system PATH or bin folder" });
      addLog(ctx, "Error: rigctld binary not found");
      return;
    }

    if (!ctx.isRigctldVersionSupported) {
      addLog(ctx, `Warning: rigctld version ${ctx.rigctldVersion} is less than 4.7.0 and is unsupported.`);
    }

    const testProc = spawn(getRigctldPath(ctx.baseDir), [
      "-m", rigNumber,
      "-r", serialPort,
      "-t", portNumber,
      "-T", ipAddress,
      "-s", serialPortSpeed,
    ]);

    let errorMsg = "";
    testProc.stderr?.on("data", (d) => errorMsg += d.toString());

    const timeout = setTimeout(() => {
      testProc.kill();
      socket.emit("test-result", { success: true, message: "Configuration looks valid (process started successfully)" });
      addLog(ctx, "Test: Success");
    }, 2000);

    testProc.on("error", (err) => {
      clearTimeout(timeout);
      socket.emit("test-result", { success: false, message: `Failed to start: ${err.message}` });
      addLog(ctx, `Test Failed: ${err.message}`);
    });

    testProc.on("close", (c) => {
      clearTimeout(timeout);
      if (c !== null && c !== 0) {
        socket.emit("test-result", { success: false, message: `Process exited with code ${c}. Error: ${errorMsg}` });
        addLog(ctx, `Test Failed: ${errorMsg}`);
      }
    });
  });
}
