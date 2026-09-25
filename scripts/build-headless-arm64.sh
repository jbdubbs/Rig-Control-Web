#!/usr/bin/env bash
# Cross-builds a bare-metal headless arm64 (Raspberry Pi 3/4/5, 64-bit
# Raspberry Pi OS or Debian 13) tarball entirely on a local x64 dev machine —
# no CI, no real cross-toolchain. Uses podman + QEMU user-mode emulation to
# run a real aarch64 Debian 12 userspace, so every existing per-platform
# build script (build-rigctld.mjs, build-cw-helper.mjs,
# build-ft4222-reader.mjs, build-wsjtx-bridge.mjs) runs completely
# unmodified inside it — os.platform() still reports "linux" and the native
# gcc/node-gyp in the container is a real aarch64 toolchain.
#
# See wiki/Headless-Deployment.md ("Platform support") and issue #54 for
# background — this is currently a testing build, not an officially
# supported release artifact.
#
# IMPORTANT: naudiodon's binding.gyp bakes an *absolute* rpath
# (module_root_dir/build/Release) into naudiodon.node at build time, so it
# must be built at the exact absolute path it will later run from — the
# repo is built inside the container at /opt/rigcontrol-web, matching the
# install path this script's generated README tells users to extract the
# tarball to. Building at a scratch path like /work and relocating the
# result afterward silently breaks libportaudio.so.2 resolution at runtime.
#
# One-time host setup (Fedora):
#   sudo dnf install -y qemu-user-static
#   podman run --rm --arch=arm64 docker.io/library/debian:12 uname -m  # expect: aarch64
#
# Usage:
#   bash scripts/build-headless-arm64.sh [HAMLIB_RCW_TOKEN]
#   (falls back to the HAMLIB_RCW_TOKEN env var, then `gh auth token` —
#   needed to clone the private jbdubbs/hamlib-RCW fork for rigctld)
#
# Also runs unmodified on a native arm64 host (e.g. GitHub's free
# `ubuntu-24.04-arm` runner, see .github/workflows/release-headless.yml) —
# `--arch=arm64` is a no-op there, so no QEMU is involved and the Debian 12
# container still pins the glibc 2.36 floor regardless of the host distro.
#
# Output: dist-headless-arm64/rigcontrol-web-<version>-linux-arm64.tar.gz

set -euo pipefail

ENGINE="${CONTAINER_ENGINE:-podman}"
IMAGE="localhost/rcw-arm64-builder"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
OUT_DIR="$REPO_ROOT/dist-headless-arm64"
PKG_NAME="rigcontrol-web-${VERSION}-linux-arm64"

if [ "$ENGINE" != "podman" ]; then
  echo "[build-headless-arm64] Only podman is supported (docker's --platform vs podman's --arch flags differ) — set CONTAINER_ENGINE=podman or leave it unset." >&2
  exit 1
fi

if ! "$ENGINE" run --rm --arch=arm64 docker.io/library/debian:12 true >/dev/null 2>&1; then
  echo "[build-headless-arm64] Can't run an emulated arm64 container. Install qemu-user-static (see script header) and retry." >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "[build-headless-arm64] Building the aarch64 builder image (cached after first run)..."
"$ENGINE" build --arch=arm64 -q -t "$IMAGE" -f "$REPO_ROOT/scripts/Containerfile.arm64-builder" "$REPO_ROOT/scripts" >/dev/null

echo "[build-headless-arm64] Archiving the current commit into a scratch build dir..."
mkdir -p "$STAGE/repo"
git -C "$REPO_ROOT" archive HEAD | tar -x -C "$STAGE/repo"
# Force a real rebuild of the C helpers for arm64 instead of reusing (or
# silently skipping, per build-rigctld.mjs's exists-check) the committed x64
# binaries this archive would otherwise contain.
rm -f "$STAGE/repo/bin/linux/rigctld" "$STAGE/repo/bin/linux/cw-key-helper" \
      "$STAGE/repo/bin/linux/ft4222-scope-reader" "$STAGE/repo/bin/linux/wsjtx-bridge"

TOKEN="${1:-${HAMLIB_RCW_TOKEN:-$(gh auth token 2>/dev/null || true)}}"
if [ -z "$TOKEN" ]; then
  echo "[build-headless-arm64] Warning: no HAMLIB_RCW_TOKEN and 'gh auth token' returned nothing — the private hamlib-RCW clone will fail unless this host already has its own git credentials for that repo." >&2
fi

echo "[build-headless-arm64] Building C helper binaries (rigctld, cw-key-helper, ft4222-scope-reader, wsjtx-bridge)..."
"$ENGINE" run --rm --arch=arm64 \
  -v "$STAGE/repo:/opt/rigcontrol-web:Z" \
  -e HAMLIB_RCW_TOKEN="$TOKEN" \
  "$IMAGE" bash -c '
    set -e
    cd /opt/rigcontrol-web
    node scripts/build-rigctld.mjs
    node scripts/build-cw-helper.mjs
    node scripts/build-ft4222-reader.mjs
    node scripts/build-wsjtx-bridge.mjs
  '

echo "[build-headless-arm64] npm ci / npm run build / npm prune --omit=dev..."
"$ENGINE" run --rm --arch=arm64 \
  -v "$STAGE/repo:/opt/rigcontrol-web:Z" \
  "$IMAGE" bash -c '
    set -e
    cd /opt/rigcontrol-web
    npm ci
    npm run build
    npm prune --omit=dev
  '

echo "[build-headless-arm64] Assembling $PKG_NAME ..."
PKG_DIR="$STAGE/$PKG_NAME"
mkdir -p "$PKG_DIR/bin/linux"
cp -r "$STAGE/repo/dist" "$PKG_DIR/dist"
cp -r "$STAGE/repo/server" "$PKG_DIR/server"
cp -r "$STAGE/repo/node_modules" "$PKG_DIR/node_modules"
cp "$STAGE/repo/server.ts" "$STAGE/repo/radios.json" "$STAGE/repo/package.json" "$PKG_DIR/"
cp "$STAGE/repo/bin/linux/rigctld" "$STAGE/repo/bin/linux/cw-key-helper" \
   "$STAGE/repo/bin/linux/ft4222-scope-reader" "$STAGE/repo/bin/linux/wsjtx-bridge" \
   "$PKG_DIR/bin/linux/"
cp "$REPO_ROOT/docs/rigcontrol-web.service" "$PKG_DIR/rigcontrol-web.service"

cat > "$PKG_DIR/README-arm64-testing.md" <<EOF
# RigControl Web ${VERSION} — arm64 Testing Build (Raspberry Pi)

**This is an untested testing build, not an official release.** See
https://github.com/jbdubbs/Rig-Control-Web/issues/54 for status and to
report results. Built by cross-compiling under QEMU aarch64 emulation, not
verified on real Raspberry Pi hardware — real ALSA/USB/serial device
behavior, real RAM usage on a 2GB board, and FT4222/libft4222 arm64
availability are all unverified.

Targets Raspberry Pi 3/4/5 (generic aarch64, no per-model tuning) running
64-bit Raspberry Pi OS (Bookworm or later) or Debian 13. Built against a
Debian 12 "bookworm" glibc floor (2.36) for broad compatibility.

## Install (systemd, no Docker)

\`\`\`bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y nodejs
sudo useradd --system --home /opt/rigcontrol-web --shell /usr/sbin/nologin --groups dialout,audio rigcontrol-web
sudo tar xzf ${PKG_NAME}.tar.gz -C /opt --strip-components=1 --one-top-level=rigcontrol-web
sudo chown -R rigcontrol-web:rigcontrol-web /opt/rigcontrol-web
sudo mkdir -p /var/lib/rigcontrol-web && sudo chown rigcontrol-web:rigcontrol-web /var/lib/rigcontrol-web
sudo cp /opt/rigcontrol-web/rigcontrol-web.service /etc/systemd/system/rigcontrol-web.service
sudo systemctl daemon-reload && sudo systemctl enable --now rigcontrol-web
\`\`\`

No build tools or compile step needed on the Pi itself — everything here
(including \`node_modules\`) is prebuilt. Check status/logs with
\`systemctl status rigcontrol-web\` / \`journalctl -u rigcontrol-web -f\`, then
browse to \`https://<pi-ip>:3000\` and log in as \`ADMIN\` / \`admin\` (forced
password change on first login).

See the [Headless Deployment](https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment)
wiki page for device access (serial/audio group GIDs), firewall ports, and
troubleshooting — this package follows that guide's "Option 3: systemd"
path, just with everything prebuilt instead of built from source on-device.
EOF

mkdir -p "$OUT_DIR"
tar czf "$OUT_DIR/$PKG_NAME.tar.gz" -C "$STAGE" "$PKG_NAME"
echo "[build-headless-arm64] Done: $OUT_DIR/$PKG_NAME.tar.gz"
