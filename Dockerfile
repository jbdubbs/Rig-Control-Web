# Headless (no Electron/GUI) deployment image for RigControl Web.
# See https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment
# ("Image runtime dependencies") for usage and the rationale behind the
# package lists below.
#
# Multi-arch (linux/amd64, linux/arm64): the four native helpers in
# bin/linux (rigctld, cw-key-helper, ft4222-scope-reader, wsjtx-bridge) are
# arch-specific. amd64 reuses the committed, CI-built, glibc-floor-checked
# binaries; arm64 has none committed, so it compiles them from source in the
# helpers-arm64 stage. That needs the private hamlib-RCW clone, so an arm64
# build requires a BuildKit secret:
#   docker buildx build --platform linux/arm64 \
#     --secret id=hamlib_rcw_token,env=HAMLIB_RCW_TOKEN .
# BuildKit only builds the stages the selected arch reaches, so an amd64
# build never touches helpers-arm64 and needs no secret.

FROM ubuntu:24.04 AS toolchain

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
      build-essential python3 \
      libasound2-dev libopus-dev \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

########################

FROM toolchain AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

########################

FROM scratch AS helpers-amd64
COPY bin/linux /

########################

# Reuses scripts/build-*.mjs unmodified, as scripts/build-headless-arm64.sh
# does. build-rigctld.mjs shells out to `sudo apt-get install` for its
# autotools/glib/readline deps, so sudo must exist here even as root; the
# packages are installed up front, which turns that call into a no-op.
FROM toolchain AS helpers-arm64-build

RUN apt-get update && apt-get install -y --no-install-recommends \
      autoconf automake libtool pkg-config libglib2.0-dev libreadline-dev \
      git sudo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY scripts/hamlib-repo.mjs scripts/build-rigctld.mjs scripts/build-cw-helper.mjs \
     scripts/build-ft4222-reader.mjs scripts/build-wsjtx-bridge.mjs ./scripts/
COPY cw-key-helper.c ft4222-scope-reader.c wsjtx-bridge.c ./

RUN --mount=type=secret,id=hamlib_rcw_token \
    test -s /run/secrets/hamlib_rcw_token \
      || { echo "ERROR: arm64 builds need the hamlib_rcw_token build secret (see the Dockerfile header)" >&2; exit 1; } \
    && mkdir -p bin/linux \
    && HAMLIB_RCW_TOKEN="$(cat /run/secrets/hamlib_rcw_token)" node scripts/build-rigctld.mjs \
    && node scripts/build-cw-helper.mjs \
    && node scripts/build-ft4222-reader.mjs \
    && node scripts/build-wsjtx-bridge.mjs

FROM scratch AS helpers-arm64
COPY --from=helpers-arm64-build /build/bin/linux /

# TARGETARCH is a BuildKit predefined platform arg (amd64, arm64).
FROM helpers-${TARGETARCH} AS helpers

########################

FROM ubuntu:24.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    RCW_DATA_DIR=/data

# Trimmed subset of package.json's deb/rpm depends lists — see the Headless Deployment wiki page
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
      libasound2t64 libpulse0 libusb-1.0-0 libreadline8t64 libportaudio2 libuuid1 \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin rcw \
    && mkdir -p /data && chown rcw:rcw /data

WORKDIR /app

COPY --from=builder --chown=rcw:rcw /app/dist ./dist
COPY --from=builder --chown=rcw:rcw /app/server ./server
COPY --from=builder --chown=rcw:rcw /app/node_modules ./node_modules
COPY --from=builder --chown=rcw:rcw /app/server.ts ./server.ts
COPY --from=builder --chown=rcw:rcw /app/radios.json ./radios.json
COPY --from=builder --chown=rcw:rcw /app/package.json ./package.json
COPY --from=helpers --chown=rcw:rcw / ./bin/linux

VOLUME ["/data"]
USER rcw
EXPOSE 3000

ENTRYPOINT ["node", "server.ts"]
