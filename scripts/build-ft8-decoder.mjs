// Compiles native/ft8-decoder (kgoba/ft8_lib decode pipeline + wrapper.c) to WebAssembly
// via Emscripten, producing public/ft8-decoder.js + public/ft8-decoder.wasm.
//
// Not run automatically by `npm run build` or any CI workflow — same precedent as
// public/ggmorse.js/.wasm, which is a committed prebuilt binary, not rebuilt from source
// in this repo. Requires the Emscripten SDK (emcc) on PATH; see
// https://emscripten.org/docs/getting_started/downloads.html. Re-run this after changing
// native/ft8-decoder/wrapper.c or bumping the vendored ft8_lib commit.
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const nativeDir = path.join(root, "native", "ft8-decoder");
const libDir = path.join(nativeDir, "ft8_lib");

const sources = [
  path.join(nativeDir, "wrapper.c"),
  path.join(libDir, "ft8", "message.c"),
  path.join(libDir, "ft8", "text.c"),
  path.join(libDir, "ft8", "decode.c"),
  path.join(libDir, "ft8", "constants.c"),
  path.join(libDir, "ft8", "crc.c"),
  path.join(libDir, "ft8", "ldpc.c"),
  path.join(libDir, "common", "monitor.c"),
  path.join(libDir, "fft", "kiss_fft.c"),
  path.join(libDir, "fft", "kiss_fftr.c"),
];

const outJs = path.join(root, "public", "ft8-decoder.js");

const cmd = [
  "emcc",
  "-O3",
  "-flto",
  `-I "${libDir}"`,
  ...sources.map((f) => `"${f}"`),
  `-o "${outJs}"`,
  `-s EXPORT_NAME="'FT8DecoderModule'"`,
  `-s EXPORTED_FUNCTIONS='["_ft8_init","_ft8_configure","_ft8_exec_decode","_malloc","_free"]'`,
  // HEAPF32 must be listed explicitly or this Emscripten version neither
  // generates the view in updateMemoryViews() nor attaches it to the
  // returned Module — without it, Module.HEAPF32 is undefined at runtime.
  `-s EXPORTED_RUNTIME_METHODS='["cwrap","UTF8ToString","HEAPF32"]'`,
  // Matches e04/ft8js's own build for this pipeline — the FFT/LDPC decode
  // routines' stack usage overflows Emscripten's default WASM stack without this.
  "-s STACK_SIZE=5MB",
  "-s ALLOW_MEMORY_GROWTH=1",
  "-s NO_FILESYSTEM=1",
  "-s EXPORT_ES6=1",
  "-s ENVIRONMENT=worker",
  "--no-entry",
].join(" ");

console.log("Building ft8-decoder WASM module...");
execSync(cmd, { stdio: "inherit" });
console.log("Done.");
