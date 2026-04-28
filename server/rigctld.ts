import path from "path";
import fs from "fs";
import { spawn, exec, ChildProcess } from "child_process";
import { Socket } from "socket.io";
import { ServerContext } from "./context.ts";
import { vlog } from "./vlog.ts";

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
    console.log(`[HAMLIB] Using bundled rigctld at: ${localPath}`);
    return localPath;
  }

  console.log(`[HAMLIB] Bundled rigctld not found at ${localPath || "unsupported platform"}, falling back to system PATH`);
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
    console.log("Stopping rigctld...");
    ctx.rigctldProcess.kill();
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

export async function fetchRadioCapabilities(ctx: ServerContext, rigNumber: string): Promise<void> {
  if (!rigNumber || rigNumber === "" || rigNumber === "1") {
    ctx.rigctldSettings.preampCapabilities = [];
    ctx.rigctldSettings.attenuatorCapabilities = [];
    ctx.rigctldSettings.agcCapabilities = [];
    ctx.saveSettings();
    ctx.io.emit("preamp-capabilities", ctx.rigctldSettings.preampCapabilities);
    ctx.io.emit("attenuator-capabilities", ctx.rigctldSettings.attenuatorCapabilities);
    ctx.io.emit("agc-capabilities", ctx.rigctldSettings.agcCapabilities);
    ctx.io.emit("anf-capabilities", ctx.rigctldSettings.anfSupported);
    return;
  }

  const rigctldPath = getRigctldPath(ctx.baseDir);
  vlog(`[HAMLIB] Fetching radio capabilities for rig ${rigNumber}...`);

  exec(`"${rigctldPath}" -m ${rigNumber} -u`, (error, stdout) => {
    if (error) {
      console.error(`[HAMLIB] Error getting radio capabilities: ${error.message}`);
      ctx.rigctldSettings.preampCapabilities = [];
      ctx.rigctldSettings.attenuatorCapabilities = [];
      ctx.rigctldSettings.agcCapabilities = [];
      ctx.rigctldSettings.nbSupported = false;
      ctx.rigctldSettings.nrSupported = false;
      ctx.rigctldSettings.anfSupported = false;
    } else {
      const lines = stdout.split('\n');

      const preampLine = lines.find(line => line.trim().startsWith('Preamp:'));
      if (preampLine) {
        ctx.rigctldSettings.preampCapabilities = preampLine.replace('Preamp:', '').trim().split(/\s+/).filter(Boolean);
        vlog(`[HAMLIB] Found preamp capabilities for rig ${rigNumber}: ${ctx.rigctldSettings.preampCapabilities.join(", ")}`);
      } else {
        ctx.rigctldSettings.preampCapabilities = [];
        vlog(`[HAMLIB] No preamp capabilities found for rig ${rigNumber}`);
      }

      const attenuatorLine = lines.find(line => line.trim().startsWith('Attenuator:'));
      if (attenuatorLine) {
        ctx.rigctldSettings.attenuatorCapabilities = attenuatorLine.replace('Attenuator:', '').trim().split(/\s+/).filter(Boolean);
        vlog(`[HAMLIB] Found attenuator capabilities for rig ${rigNumber}: ${ctx.rigctldSettings.attenuatorCapabilities.join(", ")}`);
      } else {
        ctx.rigctldSettings.attenuatorCapabilities = [];
        vlog(`[HAMLIB] No attenuator capabilities found for rig ${rigNumber}`);
      }

      const agcLine = lines.find(line => line.trim().startsWith('AGC levels:'));
      if (agcLine) {
        ctx.rigctldSettings.agcCapabilities = agcLine.replace('AGC levels:', '').trim().split(/\s+/).filter(Boolean);
        vlog(`[HAMLIB] Found AGC capabilities for rig ${rigNumber}: ${ctx.rigctldSettings.agcCapabilities.join(", ")}`);
      } else {
        ctx.rigctldSettings.agcCapabilities = [];
        vlog(`[HAMLIB] No AGC capabilities found for rig ${rigNumber}`);
      }

      const setFunctionsLine = lines.find(line => line.trim().startsWith('Set functions:'));
      if (setFunctionsLine) {
        const functions = setFunctionsLine.replace('Set functions:', '').trim().split(/\s+/);
        ctx.rigctldSettings.nbSupported = functions.includes('NB');
        ctx.rigctldSettings.nrSupported = functions.includes('NR');
        ctx.rigctldSettings.anfSupported = functions.includes('ANF');
        vlog(`[HAMLIB] NB supported for rig ${rigNumber}: ${ctx.rigctldSettings.nbSupported}`);
        vlog(`[HAMLIB] NR supported for rig ${rigNumber}: ${ctx.rigctldSettings.nrSupported}`);
        vlog(`[HAMLIB] ANF supported for rig ${rigNumber}: ${ctx.rigctldSettings.anfSupported}`);
      } else {
        ctx.rigctldSettings.nbSupported = false;
        ctx.rigctldSettings.nrSupported = false;
        ctx.rigctldSettings.anfSupported = false;
        vlog(`[HAMLIB] NB/NR/ANF not supported for rig ${rigNumber}`);
      }

      const getLevelLine = lines.find(line => line.trim().startsWith('Get level:'));
      if (getLevelLine) {
        const nbMatch = getLevelLine.match(/NB\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        if (nbMatch) {
          ctx.rigctldSettings.nbLevelRange = {
            min: parseFloat(nbMatch[1]),
            max: parseFloat(nbMatch[2]),
            step: parseFloat(nbMatch[3]),
          };
          vlog(`[HAMLIB] NB level range for rig ${rigNumber}: min=${ctx.rigctldSettings.nbLevelRange.min}, max=${ctx.rigctldSettings.nbLevelRange.max}, step=${ctx.rigctldSettings.nbLevelRange.step}`);
        } else {
          ctx.rigctldSettings.nbLevelRange = { min: 0, max: 1, step: 0.1 };
        }

        const nrMatch = getLevelLine.match(/NR\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        if (nrMatch) {
          ctx.rigctldSettings.nrLevelRange = {
            min: parseFloat(nrMatch[1]),
            max: parseFloat(nrMatch[2]),
            step: parseFloat(nrMatch[3]),
          };
          vlog(`[HAMLIB] NR level range for rig ${rigNumber}: min=${ctx.rigctldSettings.nrLevelRange.min}, max=${ctx.rigctldSettings.nrLevelRange.max}, step=${ctx.rigctldSettings.nrLevelRange.step}`);
        } else {
          ctx.rigctldSettings.nrLevelRange = { min: 0, max: 1, step: 0.1 };
        }

        const rfPowerMatch = getLevelLine.match(/RFPOWER\(([\d.-]+)\.\.([\d.-]+)\/([\d.-]+)\)/);
        if (rfPowerMatch) {
          ctx.rigctldSettings.rfPowerRange = {
            min: parseFloat(rfPowerMatch[1]),
            max: parseFloat(rfPowerMatch[2]),
            step: parseFloat(rfPowerMatch[3]),
          };
          vlog(`[HAMLIB] RF Power range for rig ${rigNumber}: min=${ctx.rigctldSettings.rfPowerRange.min}, max=${ctx.rigctldSettings.rfPowerRange.max}, step=${ctx.rigctldSettings.rfPowerRange.step}`);
        } else {
          ctx.rigctldSettings.rfPowerRange = { min: 0, max: 1, step: 0.01 };
        }
      }
    }

    ctx.saveSettings();
    ctx.io.emit("preamp-capabilities", ctx.rigctldSettings.preampCapabilities);
    ctx.io.emit("attenuator-capabilities", ctx.rigctldSettings.attenuatorCapabilities);
    ctx.io.emit("agc-capabilities", ctx.rigctldSettings.agcCapabilities);
    ctx.io.emit("nb-capabilities", { supported: ctx.rigctldSettings.nbSupported, range: ctx.rigctldSettings.nbLevelRange });
    ctx.io.emit("nr-capabilities", { supported: ctx.rigctldSettings.nrSupported, range: ctx.rigctldSettings.nrLevelRange });
    ctx.io.emit("rfpower-capabilities", { range: ctx.rigctldSettings.rfPowerRange });
    ctx.io.emit("anf-capabilities", { supported: ctx.rigctldSettings.anfSupported });
  });
}

export async function startRigctld(ctx: ServerContext): Promise<void> {
  if (ctx.rigctldProcess) {
    stopRigctld(ctx);
  }

  ctx.rigctldVersion = await getRigctldVersion(ctx.baseDir);
  ctx.isRigctldVersionSupported = checkVersionSupported(ctx.rigctldVersion);
  console.log(`[HAMLIB] rigctld version check: ${ctx.rigctldVersion || "unknown"}`);
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
  console.log(`Starting rigctld: ${rigctldPath} -m ${rigNumber} -r ${serialPort} -t ${portNumber} -T ${ipAddress} -s ${serialPortSpeed}`);

  ctx.rigctldProcess = spawn(rigctldPath, [
    "-m", rigNumber,
    "-r", serialPort,
    "-t", portNumber,
    "-T", ipAddress,
    "-s", serialPortSpeed,
  ], { detached: false });

  ctx.rigctldStatus = "running";
  emitRigctldStatus(ctx);
  addLog(ctx, "rigctld started");

  ctx.rigctldProcess.stdout?.on("data", (data) => {
    const str = data.toString();
    vlog(`rigctld stdout: ${str}`);
    addLog(ctx, str);
  });

  ctx.rigctldProcess.stderr?.on("data", (data) => {
    const str = data.toString();
    console.error(`rigctld stderr: ${str}`);
    addLog(ctx, str);
  });

  ctx.rigctldProcess.on("close", (code) => {
    console.log(`rigctld process exited with code ${code}`);
    addLog(ctx, `rigctld exited with code ${code}`);
    ctx.rigctldProcess = null;
    ctx.rigctldStatus = code === 0 ? "stopped" : "error";
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
    console.log(`[HAMLIB] Test rigctld version check: ${ctx.rigctldVersion || "unknown"}`);
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
