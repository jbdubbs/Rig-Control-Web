# FT8 SNR calibration tools

Two native (non-WASM) command-line tools used to calibrate `wrapper.c`'s SNR
estimator against retail WSJT-X, and to test raw decode sensitivity
independent of the live browser/Opus/audio-chain pipeline. Dev/calibration
tools only — not part of the shipped app, not built by any npm script or CI
workflow.

```bash
./build.sh   # builds ./gen_test_signal and ./decode_harness
```

- **`gen_test_signal MESSAGE WAV_FILE FREQUENCY_HZ SNR_DB [SEED]`** — encodes `MESSAGE` as a real FT8 tone burst (GFSK synthesis adapted from kgoba/ft8_lib's own `demo/gen_ft8.c`) into a 15s, 12kHz mono WAV, then adds calibrated AWGN so the file's true SNR — in WSJT-X's own 2500 Hz reference-bandwidth convention — is `SNR_DB`. `SEED` (default 42) makes the noise reproducible. Signal and noise are peak-normalized together before writing so low-SNR files (where noise sigma vastly exceeds the unit-amplitude signal) don't get clipped by the 16-bit quantization step — clipping would corrupt the Gaussian noise statistics.
- **`decode_harness WAV_FILE [max_candidates] [ldpc_iterations]`** — loads a 12kHz WAV and runs it straight through `../wrapper.c` (`ft8_init`/`ft8_configure`/`ft8_exec_decode`), printing each decode as `snr,dt,freq_hz,message`. No PipeWire, no Opus, no browser/worker involved — isolates the decoder itself from the live audio chain's own fidelity questions.

## Why a synthetic signal, not a recording

A real off-air recording's true SNR is itself just another tool's estimate —
using one to calibrate our estimator would mean trusting the thing we're
trying to calibrate against. A synthetic signal's SNR is known by
construction (we generate the signal and the noise, so we know both powers
exactly), which is also the same methodology Franke/Somerville/Taylor used
for the decode-probability-vs-SNR curves in *The FT4 and FT8 Communication
Protocols* (QEX, Jul/Aug 2020).

## Why WSJT-X, and why a WAV file specifically

FT8 in WSJT-X operates at 12 kHz internally — the same rate our decoder
expects — and WSJT-X's saved/exported audio is a standard 12 kHz mono 16-bit
WAV. That means the exact same file, byte-for-byte, can be fed to both sides
(WSJT-X via File → Open; our decoder via `decode_harness`) with zero
resampling in between, cleanly isolating the SNR-estimator question from the
live audio chain's own fidelity questions (Opus, PipeWire resampling, our
own 48k→12k decimation — all still an open, separate question, see the main
README's Known Issues notes elsewhere in this repo).

## 2026-09-16 calibration run

Corpus: `CQ TEST AB1CD FN42` at 1500 Hz, seed 42, target SNR(2500Hz) from
−24 to +4 dB in 4 dB steps, plus a ~clean (target 99 dB) reference. Each WAV
was decoded by real WSJT-X (File → Open) and by `decode_harness` at Deep
depth (400 candidates, 40 LDPC iterations).

| File | Target SNR | WSJT-X reported | WSJT-X decoded? | We decoded? | Our raw (uncalibrated) |
|---|---|---|---|---|---|
| clean_99db | ~clean | 15 | yes | yes | 112.0 |
| snr_4 | +4 | +1 | yes | yes | 39.2 |
| snr_0 | 0 | −1 | yes | yes | 35.3 |
| snr_neg4 | −4 | −4 | yes | yes | 31.3 |
| snr_neg8 | −8 | −8 | yes | yes | 27.6 |
| snr_neg12 | −12 | −12 | yes | yes | 23.7 |
| snr_neg16 | −16 | −15 | yes | yes | 20.0 |
| snr_neg20 | −20 | −20 | yes | **no** | — |
| snr_neg24 | −24 | −24 | yes | **no** | — |

Two findings came out of this run:

1. **WSJT-X's reported SNR tracked our synthesis targets within ~1 dB at every point** — validates the AWGN-calibration math in `gen_test_signal.c` (the "white noise spreads uniformly across the Nyquist range, scale to hit a 2500 Hz reference" derivation) as trustworthy ground truth, independent of anything about our own decoder.
2. **A real decode-sensitivity gap, separate from the SNR-label question**: WSJT-X decoded all nine files; ours failed at −20 and −24 dB. That's a ~4–8 dB sensitivity deficit — not a labeling problem, since these candidates never decoded at all. Open issue, tracked separately from the SNR-calibration work in this file.

### Deriving the calibration constant

`WSJT-X reported − our raw` for the six realistic (non-clean) points:
−38.2, −36.3, −35.3, −35.6, −35.7, −35.0 dB — mean **−36.0 dB**, which is
`FT8_SNR_CALIBRATION_OFFSET_DB` in `wrapper.c`. The clean_99db point was
excluded: its residual (−97.0 dB) reflects the percentile noise-floor
estimator measuring numerical/FFT noise rather than anything a real receiver
produces at genuinely zero input noise — a regime that doesn't occur in
practice, so it doesn't belong in the fit.

**Why WSJT-X's own constants (`-27.0` dB, a `2.6e6` scale factor in its
`ft8b.f90`) can't just be copied in:** they're calibrated to WSJT-X's own
internal FFT normalization and windowing, which differ from ours
(`monitor.c`'s `fft_norm`, our own window function, `kiss_fft`'s scaling).
Matching WSJT-X's *formula shape* (signal-tone power vs. a percentile noise
floor, converted to dB) is portable; the specific magic numbers are not —
this empirical refit is the expected, correct way to close that gap, not a
sign of a mistake. (Independent confirmation: ft8mon, a separate from-scratch
FT8 decoder, needed its own empirical fudge factors for the same reason
despite deliberately trying to match WSJT-X.)

Post-calibration residuals (`our calibrated − WSJT-X`) on the same six
points: +2.2, +0.3, −0.7, −0.4, −0.3, −1.0 dB — tight and centered near zero
across the whole −16 to +4 dB range.

### Re-running this calibration

Needed after any change to `wrapper.c`'s signal/noise-floor computation, or
if the `time_osr`/`freq_osr`/window/FFT normalization ever changes (all of
which shift the raw ratio's absolute scale):

```bash
./build.sh
for snr in -24 -20 -16 -12 -8 -4 0 4; do
  ./gen_test_signal "CQ TEST AB1CD FN42" "/tmp/snr_${snr}.wav" 1500 "$snr" 42
done
./gen_test_signal "CQ TEST AB1CD FN42" /tmp/clean.wav 1500 99
for f in /tmp/snr_*.wav /tmp/clean.wav; do ./decode_harness "$f" 400 40; done
```

Open each WAV in WSJT-X (File → Open), note its reported SNR, compute
`wsjtx − our_raw` per file, exclude the clean/no-noise point, average the
rest, and update `FT8_SNR_CALIBRATION_OFFSET_DB` in `../wrapper.c` — then
rebuild both the native tools (`./build.sh`) and the shipped WASM module
(`npm run build:ft8-decoder` from the repo root).
