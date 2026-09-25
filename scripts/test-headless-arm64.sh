#!/bin/bash
#
# Smoke test for the headless arm64 bare-metal tarball
# (scripts/build-headless-arm64.sh, issue #54). Extracts the tarball into
# a clean, throwaway Debian 12 "bookworm" container — matching
# scripts/Containerfile.arm64-builder's own base/glibc floor, i.e. the
# actual documented target (Raspberry Pi OS Bookworm / Debian 13) rather
# than this project's Ubuntu 24.04 x64 floor — run under QEMU aarch64
# user-mode emulation (`podman run --arch=arm64`), standing in for a
# fresh Pi. Verifies:
#   - the bundled binaries and native Node addons resolve all shared
#     libraries (same `ldd` technique as scripts/test-headless-x64.sh)
#   - the HTTPS server boots and answers, with no `npm ci`/compile step
#   - a Hamlib Dummy-backend rigctld can be reached
#
# Slower than test-headless-x64.sh — everything here runs under QEMU
# emulation, not natively — so this can take several minutes.
#
# Deliberately does NOT replicate scripts/test-headless-docker.sh's Phase 5
# (/proc/asound masking, issue #55) — same rationale as
# test-headless-x64.sh: that's a container-networking regression specific
# to the Docker/Compose path, not this bare-metal tarball.
#
# Podman only (same reason as build-headless-arm64.sh: docker's
# --platform vs podman's --arch flags differ, and this needs the same
# one-time host setup — qemu-user-static — as that script).
#
# Usage:
#   bash scripts/test-headless-arm64.sh                                    # builds the tarball first via build-headless-arm64.sh
#   bash scripts/test-headless-arm64.sh path/to/rigcontrol-web-*.tar.gz     # test an already-built tarball

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
RESET='\033[0m'

pass() { echo -e "${GREEN}${BOLD}  PASS${RESET} $1"; }
fail() { echo -e "${RED}${BOLD}  FAIL${RESET} $1"; FAILURES=$((FAILURES + 1)); }
FAILURES=0

ENGINE="${CONTAINER_ENGINE:-podman}"
if [ "$ENGINE" != "podman" ]; then
  echo "[test-headless-arm64] Only podman is supported (docker's --platform vs podman's --arch flags differ) — set CONTAINER_ENGINE=podman or leave it unset." >&2
  exit 1
fi

if ! "$ENGINE" run --rm --arch=arm64 docker.io/library/debian:12 true > /dev/null 2>&1; then
  echo "[test-headless-arm64] Can't run an emulated arm64 container. Install qemu-user-static (see scripts/build-headless-arm64.sh's header) and retry." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TARBALL="${1:-}"
if [ -z "$TARBALL" ]; then
  echo "=== No tarball given — building via scripts/build-headless-arm64.sh ==="
  bash "$REPO_ROOT/scripts/build-headless-arm64.sh"
  VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
  TARBALL="$REPO_ROOT/dist-headless-arm64/rigcontrol-web-${VERSION}-linux-arm64.tar.gz"
fi
if [ ! -f "$TARBALL" ]; then
  echo "ERROR: tarball not found at $TARBALL" >&2
  exit 1
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"
TARBALL_DIR="$(dirname "$TARBALL")"
TARBALL_NAME="$(basename "$TARBALL")"
echo "=== Testing: $TARBALL ==="

CONTAINER=rigcontrol-web-arm64-headless-test
cleanup() { "$ENGINE" rm -f "$CONTAINER" > /dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

# ── Phase 1: Bring up a throwaway emulated arm64 Debian 12 host, install
#    runtime deps, extract the tarball, start the server ─────────────────

echo ""
echo -e "${BOLD}=== SETUP: throwaway emulated arm64 debian:12 host + tarball extraction ===${RESET}"

"$ENGINE" run -d --name "$CONTAINER" --arch=arm64 \
  -p 13002:3000 -p 14534:4532 \
  -v "$TARBALL_DIR:/pkg:ro,Z" \
  docker.io/library/debian:12 sleep infinity > /dev/null

# Debian 12 "bookworm" predates the 64-bit time_t package-renaming
# transition (unlike this project's Ubuntu 24.04 x64 floor — see
# test-headless-x64.sh), so these are the plain, non-"t64"-suffixed names.
"$ENGINE" exec "$CONTAINER" bash -c "
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends \
    ca-certificates curl gnupg \
    libasound2 libpulse0 libusb-1.0-0 libreadline8 libportaudio2 libuuid1
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - > /dev/null
  apt-get install -y -qq --no-install-recommends nodejs
  mkdir -p /opt/rigcontrol-web /data
  tar xzf /pkg/$TARBALL_NAME -C /opt/rigcontrol-web --strip-components=1
"

"$ENGINE" exec -d "$CONTAINER" bash -c '
  cd /opt/rigcontrol-web
  NODE_ENV=production RCW_DATA_DIR=/data node server.ts > /tmp/rcw-server.log 2>&1
'

echo ""
echo -e "${BOLD}=== TEST: Server boots (no npm ci/compile) and serves HTTPS ===${RESET}"

# Generous retry budget — QEMU emulation makes Node startup noticeably
# slower than test-headless-x64.sh's native run.
HTTP_CODE="000"
for i in $(seq 1 60); do
  HTTP_CODE=$(curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1:13002/ 2>/dev/null || echo "000")
  [ "$HTTP_CODE" = "200" ] && break
  sleep 2
done
if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTPS server answers (200)"
else
  fail "HTTPS server did not answer (got $HTTP_CODE) — see log:"
  "$ENGINE" exec "$CONTAINER" cat /tmp/rcw-server.log 2>&1 || true
fi

RUNNING=$("$ENGINE" inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)
[ "$RUNNING" = "true" ] && pass "Container still running (no crash)" || fail "Container exited unexpectedly"

# ── Phase 2: shared library resolution — ldd every bundled binary/addon ──

echo ""
echo -e "${BOLD}=== TEST: Shared library resolution ===${RESET}"

LDD_OUTPUT=$("$ENGINE" exec "$CONTAINER" bash -c '
  cd /opt/rigcontrol-web
  for BIN in bin/linux/rigctld bin/linux/cw-key-helper bin/linux/ft4222-scope-reader bin/linux/wsjtx-bridge; do
    if [ -f "$BIN" ]; then
      MISSING=$(ldd "$BIN" 2>&1 | grep "not found" || true)
      echo "LDD_$(basename "$BIN")=${MISSING:-OK}"
    fi
  done
  NA=$(find node_modules/naudiodon -name "*.node" -type f 2>/dev/null | head -1)
  [ -n "$NA" ] && { MISSING=$(ldd "$NA" 2>&1 | grep "not found" || true); echo "LDD_naudiodon=${MISSING:-OK}"; }
  LO=$(find node_modules/libopus-node -name "*.node" -type f 2>/dev/null | head -1)
  [ -n "$LO" ] && { MISSING=$(ldd "$LO" 2>&1 | grep "not found" || true); echo "LDD_libopus=${MISSING:-OK}"; }
' 2>&1)

for CHECK in LDD_rigctld LDD_cw-key-helper LDD_ft4222-scope-reader LDD_wsjtx-bridge LDD_naudiodon LDD_libopus; do
  echo "$LDD_OUTPUT" | grep "${CHECK}=OK" > /dev/null && pass "$CHECK" || fail "$CHECK — missing libs (see output above)"
done

# ── Phase 3: rigctld against Hamlib's Dummy backend ─────────────────────

echo ""
echo -e "${BOLD}=== TEST: Bundled rigctld runs against Hamlib Dummy backend ===${RESET}"

"$ENGINE" exec -d "$CONTAINER" bash -c 'cd /opt/rigcontrol-web && ./bin/linux/rigctld -m 1 -t 4532 > /tmp/rigctld-dummy.log 2>&1'
sleep 2
FREQ=$(python3 -c '
import socket, sys
try:
    s = socket.create_connection(("127.0.0.1", 14534), timeout=5)
    s.settimeout(5)
    s.sendall(b"f\n")
    print(s.recv(1024).decode().strip())
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
' 2>/dev/null)
if [[ "$FREQ" =~ ^[0-9]+$ ]]; then
  pass "Dummy rigctld responded with a frequency ($FREQ)"
else
  fail "Dummy rigctld did not respond as expected (got: '$FREQ')"
fi

# ── Summary ──────────────────────────────────────────────────────────

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All checks passed.${RESET}"
else
  echo -e "${RED}${BOLD}$FAILURES check(s) failed.${RESET}"
  exit 1
fi
