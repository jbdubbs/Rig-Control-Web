// Cross-compiles bin/windows/rigctld.exe FROM Linux, using Fedora's mingw64
// toolchain, instead of waiting on the CI Windows MSYS2 build (see
// .github/workflows/build.yml) for every iteration of a Windows-side
// rigctld fix. Always rebuilds — unlike build-rigctld.mjs, this has no
// "skip if it already exists" guard, since refreshing the binary on demand
// is the entire point.
//
// One-time setup on Fedora:
//   sudo dnf install -y mingw64-gcc mingw64-glib2 mingw64-glib2-static \
//     mingw64-readline mingw64-readline-static
//   sudo dnf install -y wine   # optional, enables the --version smoke test
import { execSync } from "child_process";
import { existsSync, copyFileSync, chmodSync, rmSync } from "fs";
import { cpus, platform } from "os";
import { getHamlibRepoUrl } from "./hamlib-repo.mjs";

const MINGW_PREFIX = "x86_64-w64-mingw32";
const MINGW_SYSROOT = `/usr/${MINGW_PREFIX}/sys-root/mingw`;
const srcDir = "hamlib-src-win-cross";
const outDir = "bin/windows";
const jobs = cpus().length;

// Runtime DLLs rigctld.exe dynamically links against, beyond stock Windows
// system DLLs (KERNEL32/msvcrt/WS2_32/IPHLPAPI, always present) — confirmed
// via `x86_64-w64-mingw32-objdump -p tests/rigctld.exe | grep "DLL Name"`.
// libtermcap-0.dll is readline's own transitive dependency. Same set the
// CI MSYS2 build bundles, just resolved from Fedora's mingw64 sysroot
// instead of MSYS2's.
const RUNTIME_DLLS = ["libwinpthread-1.dll", "libreadline8.dll", "libtermcap-0.dll"];

if (platform() !== "linux") {
  console.error("[rigctld-win-cross] This cross-compiles FROM Linux using Fedora's mingw64 toolchain — run it on a Linux dev machine, not the target platform.");
  process.exit(1);
}

function haveCommand(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!haveCommand(`${MINGW_PREFIX}-gcc`)) {
  console.error(
    "[rigctld-win-cross] mingw64 cross-compiler not found. On Fedora, install it with:\n\n" +
    "  sudo dnf install -y mingw64-gcc mingw64-glib2 mingw64-glib2-static mingw64-readline mingw64-readline-static\n"
  );
  process.exit(1);
}

for (const dll of RUNTIME_DLLS) {
  if (!existsSync(`${MINGW_SYSROOT}/bin/${dll}`)) {
    console.error(`[rigctld-win-cross] Required runtime DLL not found: ${MINGW_SYSROOT}/bin/${dll} — is mingw64-readline installed?`);
    process.exit(1);
  }
}

const hamlibRepoUrl = getHamlibRepoUrl();

if (existsSync(srcDir)) {
  console.log(`[rigctld-win-cross] Removing leftover ${srcDir} from a previous run...`);
  rmSync(srcDir, { recursive: true, force: true });
}

let buildFailed = false;
try {
  console.log("[rigctld-win-cross] Cloning hamlib-RCW source (master)...");
  execSync(`git clone --depth=1 ${hamlibRepoUrl} ${srcDir}`, { stdio: ["ignore", "inherit", "inherit"] });

  console.log("[rigctld-win-cross] Running autoreconf...");
  execSync("autoreconf -fi", { cwd: srcDir, stdio: "inherit" });

  console.log(`[rigctld-win-cross] Configuring for ${MINGW_PREFIX}...`);
  execSync(
    `./configure --host=${MINGW_PREFIX} --disable-shared --enable-static --without-tcl --without-cxx-binding --without-libusb LDFLAGS="-static-libgcc -static-libstdc++"`,
    {
      cwd: srcDir,
      stdio: "inherit",
      env: { ...process.env, PKG_CONFIG: `/usr/bin/${MINGW_PREFIX}-pkg-config` },
    },
  );

  console.log(`[rigctld-win-cross] Building with ${jobs} parallel jobs...`);
  execSync(`make -j${jobs}`, { cwd: srcDir, stdio: "inherit" });

  const builtBin = `${srcDir}/tests/rigctld.exe`;
  if (!existsSync(builtBin)) {
    throw new Error(`Built binary not found at ${builtBin}`);
  }

  copyFileSync(builtBin, `${outDir}/rigctld.exe`);
  chmodSync(`${outDir}/rigctld.exe`, 0o755);
  for (const dll of RUNTIME_DLLS) {
    copyFileSync(`${MINGW_SYSROOT}/bin/${dll}`, `${outDir}/${dll}`);
    chmodSync(`${outDir}/${dll}`, 0o644);
  }

  console.log(`[rigctld-win-cross] Installed to ${outDir}/rigctld.exe (+ ${RUNTIME_DLLS.join(", ")})`);

  if (haveCommand("wine")) {
    console.log("[rigctld-win-cross] Smoke-testing under Wine...");
    try {
      const version = execSync("wine rigctld.exe --version", {
        cwd: outDir,
        env: { ...process.env, WINEDEBUG: "-all" },
        timeout: 30_000,
      }).toString().trim();
      console.log(`[rigctld-win-cross] ${version}`);
    } catch (err) {
      console.warn(`[rigctld-win-cross] Wine smoke test failed (binary was still installed — this doesn't necessarily mean it's broken on real Windows): ${err.message}`);
    }
  } else {
    console.log("[rigctld-win-cross] Wine not found — skipping smoke test. `sudo dnf install -y wine` to verify --version/basic startup without a real Windows machine.");
  }
} catch (err) {
  console.error(`[rigctld-win-cross] Build failed: ${err.message}`);
  buildFailed = true;
} finally {
  if (existsSync(srcDir)) {
    rmSync(srcDir, { recursive: true, force: true });
  }
}

if (buildFailed) process.exit(1);
