// Automated regression check for wrapper.c's SNR calibration (see
// FT8_SNR_CALIBRATION_OFFSET_DB and tools/README.md). Regenerates the
// reference corpus from source (deterministic: fixed message/frequency/seed,
// see tools/README.md's 2026-09-16 calibration run) rather than committing
// binary WAV fixtures, decodes each with decode_harness (no PipeWire/Opus/
// browser involved), and asserts the SNR we report stays within tolerance of
// what real WSJT-X reported for the same file.
//
// Requires gcc (native build, no Emscripten needed). Not part of `npm test` —
// run explicitly via `npm run test:ft8-calibration`.
import { execFileSync, execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGE = "CQ TEST AB1CD FN42";
const FREQUENCY_HZ = 1500;
const SEED = 42;
const TOLERANCE_DB = 3.0;

// wsjtxSnr: real WSJT-X's reported SNR for this file, from the 2026-09-16
// calibration run (tools/README.md). Only the range that reliably decodes
// today (-16..+4 dB) is checked here — -20/-24 dB are a known, separately
// tracked decode-sensitivity gap (WSJT-X decodes them, we don't yet), not
// something this SNR-calibration check should fail on.
const REFERENCE_POINTS = [
  { targetSnr: -16, wsjtxSnr: -15 },
  { targetSnr: -12, wsjtxSnr: -12 },
  { targetSnr: -8, wsjtxSnr: -8 },
  { targetSnr: -4, wsjtxSnr: -4 },
  { targetSnr: 0, wsjtxSnr: -1 },
  { targetSnr: 4, wsjtxSnr: 1 },
];

function checkGcc() {
  try {
    execSync("gcc --version", { stdio: "ignore" });
  } catch {
    console.error("gcc not found on PATH — required to build the native calibration tools.");
    process.exit(1);
  }
}

function buildTools() {
  console.log("Building calibration tools...");
  execSync("./build.sh", { cwd: __dirname, stdio: "inherit" });
}

function main() {
  checkGcc();
  buildTools();

  const genTestSignal = path.join(__dirname, "gen_test_signal");
  const decodeHarness = path.join(__dirname, "decode_harness");
  if (!existsSync(genTestSignal) || !existsSync(decodeHarness)) {
    console.error("Build did not produce gen_test_signal/decode_harness.");
    process.exit(1);
  }

  const tmpDir = mkdtempSync(path.join(tmpdir(), "ft8-calibration-"));
  let failures = 0;

  try {
    for (const { targetSnr, wsjtxSnr } of REFERENCE_POINTS) {
      const wavPath = path.join(tmpDir, `snr_${targetSnr}.wav`);
      execFileSync(genTestSignal, [MESSAGE, wavPath, String(FREQUENCY_HZ), String(targetSnr), String(SEED)], { stdio: "ignore" });

      // ft8_lib's decode.c logs a few fixed debug lines to stderr on every
      // run (its own LOG_LEVEL, unrelated to our --debug-ft8 flag) — ignore
      // stderr here so the calibration report stays readable.
      const output = execFileSync(decodeHarness, [wavPath, "400", "40"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const lines = output.trim().split("\n");
      const decodeCountMatch = /: (\d+) decode\(s\)/.exec(lines[0]);
      const decodeCount = decodeCountMatch ? parseInt(decodeCountMatch[1], 10) : 0;

      if (decodeCount < 1) {
        console.error(`FAIL  target=${targetSnr}dB (WSJT-X=${wsjtxSnr}dB): did not decode at all (expected to, per the 2026-09-16 calibration run)`);
        failures++;
        continue;
      }

      const resultLine = lines[1];
      const ourSnr = parseFloat(resultLine.split(",")[0]);
      const delta = ourSnr - wsjtxSnr;
      const ok = Math.abs(delta) <= TOLERANCE_DB;
      const status = ok ? "ok  " : "FAIL";
      console.log(`${status}  target=${targetSnr}dB  WSJT-X=${wsjtxSnr}dB  ours=${ourSnr.toFixed(1)}dB  delta=${delta.toFixed(1)}dB`);
      if (!ok) failures++;
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} of ${REFERENCE_POINTS.length} reference point(s) outside +/-${TOLERANCE_DB}dB tolerance or failed to decode.`);
    console.error("If wrapper.c's signal/noise-floor computation changed intentionally, re-run the calibration procedure in tools/README.md and update FT8_SNR_CALIBRATION_OFFSET_DB.");
    process.exit(1);
  }
  console.log(`\nAll ${REFERENCE_POINTS.length} reference points within +/-${TOLERANCE_DB}dB of WSJT-X.`);
}

main();
