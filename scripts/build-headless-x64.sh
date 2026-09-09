#!/usr/bin/env bash
# Builds a bare-metal headless x86-64 tarball (Linux server / mini PC,
# Ubuntu 22.04+/Debian 12+/Fedora/RHEL-family) entirely on a local x64 dev
# machine, in a container — see issue #57: the previous "Option 3: systemd"
# bare-metal install path required `git clone` + `npm ci` on the target
# machine, which compiles naudiodon/libopus-node's native addons via
# node-gyp and needs build-essential/python3/ALSA+Opus dev headers
# installed there. This script does that compile step once, here, and
# ships the result as a tarball a user can just extract and run.
#
# Unlike scripts/build-headless-arm64.sh, this needs no QEMU/cross-arch
# emulation (the dev machine is already x86-64) and does NOT rebuild the
# C helper binaries (bin/linux/rigctld, cw-key-helper, ft4222-scope-reader,
# wsjtx-bridge) — those are already committed for x64, built by CI on
# ubuntu-24.04 (see .github/workflows/build.yml's glibc-floor check), so
# this script just verifies that floor still holds and reuses them as-is.
#
# IMPORTANT: naudiodon's binding.gyp bakes an *absolute* rpath
# (module_root_dir/build/Release) into naudiodon.node at build time, so it
# must be built at the exact absolute path it will later run from — the
# repo is built inside the container at /opt/rigcontrol-web, matching the
# install path this script's generated README tells users to extract the
# tarball to. Building at a scratch path like /work and relocating the
# result afterward silently breaks libportaudio.so.2 resolution at runtime
# (same lesson as build-headless-arm64.sh).
#
# Usage:
#   bash scripts/build-headless-x64.sh
#   CONTAINER_ENGINE=docker bash scripts/build-headless-x64.sh   # default: auto-detect
#
# Output: dist-headless-x64/rigcontrol-web-<version>-linux-x64.tar.gz

set -euo pipefail

if [ -n "${CONTAINER_ENGINE:-}" ]; then
  ENGINE="$CONTAINER_ENGINE"
elif command -v docker > /dev/null 2>&1; then
  ENGINE=docker
elif command -v podman > /dev/null 2>&1; then
  ENGINE=podman
else
  echo "[build-headless-x64] ERROR: neither docker nor podman found on PATH." >&2
  exit 1
fi
echo "[build-headless-x64] Using container engine: $ENGINE"

IMAGE="localhost/rcw-x64-builder"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION=$(node -p "require('$REPO_ROOT/package.json').version")
OUT_DIR="$REPO_ROOT/dist-headless-x64"
PKG_NAME="rigcontrol-web-${VERSION}-linux-x64"

if ! command -v objdump > /dev/null 2>&1; then
  echo "[build-headless-x64] ERROR: objdump not found (part of binutils) — needed to verify the committed bin/linux/* binaries' glibc floor before packaging." >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "[build-headless-x64] Archiving the current commit into a scratch build dir..."
mkdir -p "$STAGE/repo"
git -C "$REPO_ROOT" archive HEAD | tar -x -C "$STAGE/repo"

# ── glibc-floor verification (not a rebuild) ────────────────────────────
# The committed bin/linux/* binaries are reused as-is — CI already builds
# them on ubuntu-24.04 (glibc 2.39 floor) and build.yml's dedicated step
# already guards bin/linux/rigctld specifically. This re-checks all four
# right before packaging, in case any were ever rebuilt/recommitted on a
# newer-glibc host without that CI guard catching it.
echo "[build-headless-x64] Verifying glibc floor of committed bin/linux/* binaries..."
FLOOR_MAJOR=2
FLOOR_MINOR=39
for BIN in rigctld cw-key-helper ft4222-scope-reader wsjtx-bridge; do
  BIN_PATH="$STAGE/repo/bin/linux/$BIN"
  MAX_GLIBC=$(objdump -T "$BIN_PATH" | grep -oP 'GLIBC_\K[0-9]+\.[0-9]+' | sort -V | tail -1)
  if [ -z "$MAX_GLIBC" ]; then
    echo "[build-headless-x64] WARNING: could not determine glibc requirement for $BIN — skipping check." >&2
    continue
  fi
  MAJOR=$(echo "$MAX_GLIBC" | cut -d. -f1)
  MINOR=$(echo "$MAX_GLIBC" | cut -d. -f2)
  echo "[build-headless-x64]   $BIN requires glibc <= $MAX_GLIBC"
  if [ "$MAJOR" -gt "$FLOOR_MAJOR" ] || { [ "$MAJOR" -eq "$FLOOR_MAJOR" ] && [ "$MINOR" -gt "$FLOOR_MINOR" ]; }; then
    echo "[build-headless-x64] ERROR: bin/linux/$BIN requires glibc $MAX_GLIBC, newer than this project's floor ($FLOOR_MAJOR.$FLOOR_MINOR, Ubuntu 24.04). Rebuild it inside an 'ubuntu:24.04' container before committing/packaging (see scripts/build-rigctld.mjs for rigctld; the others are a plain 'gcc -O2' compile — see .github/workflows/build.yml)." >&2
    exit 1
  fi
done

echo "[build-headless-x64] Building the x64 builder image (cached after first run)..."
"$ENGINE" build -q -t "$IMAGE" -f "$REPO_ROOT/scripts/Containerfile.x64-builder" "$REPO_ROOT/scripts" > /dev/null

MOUNT_SUFFIX=""
[ "$ENGINE" = "podman" ] && MOUNT_SUFFIX=":Z"

echo "[build-headless-x64] npm ci / npm run build / npm prune --omit=dev (at /opt/rigcontrol-web, matching the install path)..."
# Rootless podman already maps the container's root (its default user) back
# to the invoking host user via subuid remapping, so files written into the
# bind-mounted $STAGE/repo already come out host-owned with no extra flags.
# Rootful docker (what CI's GitHub Actions runners use) has no such
# remapping — the container's root is the host's real root, so anything
# npm writes lands root-owned on the host, and the trap's `rm -rf "$STAGE"`
# cleanup below then fails with "Permission denied" for any invoker that
# isn't itself root (confirmed failing exactly this way in CI). Only docker
# needs --user pinned to the invoking host UID/GID to avoid that; adding it
# unconditionally breaks the podman path instead (its own UID mapping means
# --user's UID doesn't refer to the same host user, confirmed by testing).
# -e HOME=/tmp gives npm a writable home for its cache/config, since the
# pinned UID has no real home directory inside the container.
DOCKER_RUN_USER_ARGS=()
if [ "$ENGINE" = "docker" ]; then
  DOCKER_RUN_USER_ARGS=(--user "$(id -u):$(id -g)" -e HOME=/tmp)
fi
"$ENGINE" run --rm \
  "${DOCKER_RUN_USER_ARGS[@]}" \
  -v "$STAGE/repo:/opt/rigcontrol-web$MOUNT_SUFFIX" \
  "$IMAGE" bash -c '
    set -e
    cd /opt/rigcontrol-web
    npm ci
    npm run build
    npm prune --omit=dev
  '

echo "[build-headless-x64] Assembling $PKG_NAME ..."
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

cat > "$PKG_DIR/README-headless-x64.md" <<EOF
# RigControl Web ${VERSION} — Headless x86-64 Build (Bare Metal)

A prebuilt, bare-metal (no Docker, no Electron/GUI) headless package for
x86-64 Linux servers/mini PCs (Ubuntu 22.04+, Debian 12+, Fedora/RHEL-family).
Everything here — including \`node_modules\` with \`naudiodon\`/\`libopus-node\`
already compiled — is prebuilt against an Ubuntu 24.04 (glibc 2.39) floor,
this project's documented minimum-supported baseline, so **no compiler or
build tools are required on the target machine**. See the
[Headless Deployment](https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment)
wiki page for the full guide (Docker Compose, plain \`docker run\`, and
this systemd path); this package follows that guide's "Option 3: systemd"
path, using the prebuilt tarball instead of building from source on-device.

## Install (systemd, no Docker, no build tools)

\`\`\`bash
# Node.js 24 runtime (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash - && sudo apt-get install -y nodejs
# Node.js 24 runtime (Fedora/RHEL-family) — instead of the line above:
#   sudo dnf module install -y nodejs:24

# Runtime shared libraries naudiodon/rigctld/the FT4222 reader need
# (Debian/Ubuntu; see the wiki page's "Image runtime dependencies" section
# for why each one is needed):
sudo apt-get install -y --no-install-recommends \\
  ca-certificates libasound2t64 libpulse0 libusb-1.0-0 libreadline8t64 libportaudio2 libuuid1
# Fedora/RHEL-family equivalent instead of the line above:
#   sudo dnf install -y ca-certificates alsa-lib pulseaudio-libs libusb1 readline libuuid

sudo useradd --system --home /opt/rigcontrol-web --shell /usr/sbin/nologin --groups dialout,audio rigcontrol-web
sudo tar xzf ${PKG_NAME}.tar.gz -C /opt --strip-components=1 --one-top-level=rigcontrol-web
sudo chown -R rigcontrol-web:rigcontrol-web /opt/rigcontrol-web
sudo mkdir -p /var/lib/rigcontrol-web && sudo chown rigcontrol-web:rigcontrol-web /var/lib/rigcontrol-web
sudo cp /opt/rigcontrol-web/rigcontrol-web.service /etc/systemd/system/rigcontrol-web.service
sudo systemctl daemon-reload && sudo systemctl enable --now rigcontrol-web
\`\`\`

Check status/logs with \`systemctl status rigcontrol-web\` /
\`journalctl -u rigcontrol-web -f\`, then browse to
\`https://<host-ip>:3000\` and log in as \`ADMIN\` / \`admin\` (forced
password change on first login).

See the [Headless Deployment](https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment)
wiki page for device access (serial/audio group GIDs), firewall ports, and
troubleshooting.
EOF

mkdir -p "$OUT_DIR"
tar czf "$OUT_DIR/$PKG_NAME.tar.gz" -C "$STAGE" "$PKG_NAME"
echo "[build-headless-x64] Done: $OUT_DIR/$PKG_NAME.tar.gz"
