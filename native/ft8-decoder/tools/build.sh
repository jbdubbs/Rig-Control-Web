#!/usr/bin/env bash
# Builds the native (non-WASM) FT8 calibration tools: a test-signal generator
# (clean FT8 message + calibrated AWGN at a target SNR) and a decode harness
# that runs a WAV straight through our wrapper.c, bypassing the live audio
# chain entirely. Dev/calibration tools only — not part of the shipped app,
# not built by any npm script or CI workflow. See README.md in this directory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

LIB=../ft8_lib
OUT=.

gcc -O2 -I"$LIB" -o "$OUT/gen_test_signal" \
  gen_test_signal.c \
  "$LIB/common/wave.c" \
  "$LIB/ft8/message.c" \
  "$LIB/ft8/text.c" \
  "$LIB/ft8/encode.c" \
  "$LIB/ft8/constants.c" \
  "$LIB/ft8/crc.c" \
  -lm

gcc -O2 -I"$LIB" -I.. -o "$OUT/decode_harness" \
  decode_harness.c \
  ../wrapper.c \
  "$LIB/common/wave.c" \
  "$LIB/common/monitor.c" \
  "$LIB/ft8/message.c" \
  "$LIB/ft8/text.c" \
  "$LIB/ft8/decode.c" \
  "$LIB/ft8/constants.c" \
  "$LIB/ft8/crc.c" \
  "$LIB/ft8/ldpc.c" \
  "$LIB/fft/kiss_fft.c" \
  "$LIB/fft/kiss_fftr.c" \
  -lm

echo "Built gen_test_signal and decode_harness in $(pwd)"
