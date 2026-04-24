#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GGMORSE_SRC="$HOME/ggmorse"

source "$HOME/emsdk/emsdk_env.sh"

emcc \
  -I"$GGMORSE_SRC/include" \
  "$GGMORSE_SRC/src/ggmorse.cpp" \
  "$GGMORSE_SRC/src/resampler.cpp" \
  "$SCRIPT_DIR/ggmorse_wrap.cpp" \
  -O3 \
  -std=c++17 \
  -sWASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=GGMorseModule \
  -sEXPORTED_FUNCTIONS=_ggmorse_init,_ggmorse_queue_samples,_ggmorse_decode,_ggmorse_get_result,_ggmorse_get_pitch,_ggmorse_get_speed,_ggmorse_reset,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,HEAPF32 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sENVIRONMENT=web \
  -o "$PROJECT_ROOT/public/ggmorse.js"

echo "Built: $PROJECT_ROOT/public/ggmorse.js + ggmorse.wasm"
