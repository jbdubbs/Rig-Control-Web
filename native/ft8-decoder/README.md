# FT8 Decoder (native)

WASM decode backend for the FT8 Decoder panel. Two parts:

- **`ft8_lib/`** — vendored subset (`common/`, `fft/`, `ft8/`) of [kgoba/ft8_lib](https://github.com/kgoba/ft8_lib), pinned at commit `9fec6ca39886edbf96f4f5e71edc76da5074e871` (2025-08-23). MIT license, preserved as `ft8_lib/LICENSE`. The shipped WASM build only compiles the decode-side sources — `common/audio.c` (device I/O, unused — JS owns all I/O) is vendored for completeness but not compiled anywhere; `common/wave.c` and `ft8/encode.c` aren't compiled into the WASM module either, but are used by the native calibration tools in `tools/` (WAV I/O and test-signal generation, respectively — see `tools/README.md`).
- **`wrapper.c`** — our own Emscripten wrapper exposing a scalar-only FFI (`ft8_init`, `ft8_configure`, `ft8_exec_decode`) around `ft8_lib`'s `monitor_process`/`ftx_find_candidates`/`ftx_decode_candidate` pipeline. Decode-loop structure adapted from [e04/ft8js](https://github.com/e04/ft8js)'s `src/decode.c` (MIT license), with depth made runtime-configurable and bounds-checked output instead of unbounded `strcat`. SNR is computed from Costas sync-tone power vs. a percentile noise floor (see `tools/README.md`'s calibration procedure) — not `ft8js`'s original `score * 0.5` placeholder, and not WSJT-X's own formula/constants verbatim (its internal FFT normalization differs from ours), but empirically calibrated against real WSJT-X output to land on the same dB scale.

## Calibration tools

`tools/` has two native (non-WASM) command-line utilities — a calibrated-AWGN test-signal generator and a standalone decode harness that bypasses the live audio chain entirely — used to fit the SNR calibration constant against real WSJT-X output and to test raw decode sensitivity in isolation. See `tools/README.md` for usage, the full 2026-09-16 calibration run's data, and how to re-run it.

## Rebuilding

Requires the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (`emcc`) on `PATH`:

```bash
npm run build:ft8-decoder
```

Produces `public/ft8-decoder.js` + `public/ft8-decoder.wasm` (committed to the repo, same as `public/ggmorse.js`/`.wasm` — not rebuilt by CI). Re-run after changing `wrapper.c` or bumping the vendored `ft8_lib` commit.

## Troubleshooting

**Decode fails every slot with `TypeError: Cannot read properties of undefined (reading 'set')` (visible via `[FT8-MAIN] worker error:` — enable the "FT8" flag in Settings → Diagnostics):** `Module.HEAPF32` is `undefined`. This Emscripten version (confirmed on 6.0.9) does not generate or attach the `HEAPF32` typed-array view unless it's listed explicitly in `EXPORTED_RUNTIME_METHODS` — unlike older Emscripten builds (e.g. whatever built `public/ggmorse.wasm`), it is *not* on by default just because `UTF8ToString`/`cwrap` are requested. Confirm `scripts/build-ft8-decoder.mjs` passes `-s EXPORTED_RUNTIME_METHODS='["cwrap","UTF8ToString","HEAPF32"]'` (all three, `HEAPF32` included) and that `public/ft8-decoder.js` actually contains `Module["HEAPF32"]=` after rebuilding (`grep 'Module\["HEAPF32"\]' public/ft8-decoder.js`).

**No decodes at all, with `[FT8-WINDOW] extracted window` repeating the same slot forever and `[FT8-AUDIO]` queue depth climbing without bound:** this is the *symptom* of any uncaught exception inside `decodeWindow()` in `src/workers/ft8Decoder.worker.ts` — without its `try/catch`, an exception thrown mid-decode skips the queue/boundary-advancement code at the bottom of `tryExtractWindow()`, so every subsequent audio chunk re-attempts the identical already-failed slot forever instead of moving on. The `try/catch` (plus the top-level `try/catch` in the worker's `onmessage` and `Ft8Decoder`'s `worker.onerror` on the main thread) turns this into a visible `[FT8-MAIN] worker error:` line instead — if you see this runaway-repeat pattern with *no* error line at all, something is swallowing the exception before it reaches `post({type: 'error', ...})`; that's a regression in the error handling itself, not the original decode bug.
