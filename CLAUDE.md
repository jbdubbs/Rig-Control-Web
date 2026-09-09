# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Global Rules

- Always search for best practices from the latest online research. Don't invent or assume, and don't be a pleaser. Be honest and factual.
- Look at the whole plan from top to bottom. Leave no stone unturned.
- Ask clarifying questions if you aren't 100% sure how to do something. Do not make assumptions.

## Project Overview

RigControl Web (`v1.0.0`) is a full-stack web + Electron desktop application for controlling amateur radio equipment via Hamlib's `rigctld`. It provides a real-time dashboard with frequency/mode/meter display, bidirectional Opus audio, browser-native H.264 video streaming, POTA/SOTA/WWFF spot integration, a CW iambic keyer, a GGMorse-based CW decoder, Hamlib UDP and FT-710 (FT4222 USB-SPI) spectrum scopes, solar/propagation data, a user-configurable panel grid layout, JWT-based user authentication with an admin panel, radio power on/off control (`set_powerstat`) with auto-reconnect, and a WSJTX rig-control/audio bridge for remote digital-mode operation. All transport runs over HTTPS (self-signed EC P-256 certificate, auto-generated at startup).

## Commands

```bash
# Development
npm run dev              # Start Express + Socket.io backend (tsx server.ts)
npm start                # Start the backend standalone (node server.ts) — no Electron; this is the headless entry point, see the wiki's Headless Deployment page
npm run build            # Build Vite frontend to dist/
npm run lint             # TypeScript type-check (tsc --noEmit)
npm run test             # Run Vitest unit tests (jsdom, hardware-independent)
npm run test:watch       # Vitest in watch mode
npm run test:ui          # Vitest interactive UI
npm run test:e2e         # Run Playwright e2e tests against a Dummy rigctld + synthetic UDP (hardware-independent)
npm run test:e2e:ui      # Playwright interactive UI, for debugging e2e tests
npm run test:hardware    # Run Playwright e2e tests requiring a real, USB-connected FT-710 (manual/local only, never CI)
npm run clean            # Remove dist/, dist-electron/, build/
npm run build:cw-helper      # Compile cw-key-helper.c for the current platform (scripts/build-cw-helper.mjs)
npm run build:ft4222-reader  # Compile ft4222-scope-reader.c for the current platform (scripts/build-ft4222-reader.mjs)
npm run build:rigctld-win-cross  # Cross-compile bin/windows/rigctld.exe from Linux via mingw64 (scripts/build-rigctld-win-cross.mjs) — for iterating on Windows-side rigctld fixes without a full CI run; see script header for one-time Fedora setup

# Electron
npm run electron:dev     # Run as Electron desktop app in dev mode
npm run build:electron   # Bundle electron/main.ts and electron/preload.ts via esbuild
npm run electron:build   # Full Electron production build (frontend + electron + package)
```

There is no hot-reload for `server.ts` or any module under `server/` — restart manually after backend changes.

## Testing

Three layers, split by what they need and whether real hardware is required:

- **Vitest unit tests** (`npm test`, jsdom environment) — pure logic only: hook reducers against a stub Socket.io client (`src/hooks/useSpectrum.test.ts`), server-side parsers (`server/rigComm.test.ts`). No real DOM canvas rendering, no real sockets — see `vitest.config.ts`. Server-only test files that don't need jsdom add a `// @vitest-environment node` docblock at the top.
- **Playwright e2e, hardware-independent** (`npm run test:e2e`) — drives the real app in a real browser against a real, isolated server instance, using three techniques to avoid needing physical hardware:
  - **Rig-status panels**: a real `rigctld` bound to Hamlib's built-in **Dummy** rig backend (model 1), not a hand-rolled fake — see `tests/fixtures/rigctld-dummy.ts`. This exercises the actual Hamlib protocol/parsing path end-to-end. Pilot: `tests/e2e/vfo-panel.spec.ts`.
  - **Hamlib UDP spectrum**: `server/spectrum.ts`'s multicast listener trusts any correctly-shaped sender, so `tests/fixtures/synthetic-udp.ts` sends synthetic Hamlib-5.x-shaped JSON packets directly — zero production code changes needed. Pilot: `tests/e2e/spectrum-hamlib-panel.spec.ts`.
  - **Backend audio** (`AudioFeedPanel`/`CwDecodePanel`/`SpectrumAudioPanel`): a real PipeWire `pw-loopback` (`tests/fixtures/audio-loopback.ts`) gives `server/audio.ts`'s `naudiodon` a real device to open, paired with Chromium `--use-fake-device-for-media-stream`/`--use-file-for-fake-audio-capture` flags (`tests/fixtures/fake-audio-wav.ts`) feeding a real WAV signal as the browser mic. See the Backlog note below for the non-obvious constraints this involved. Pilot: `tests/e2e/audio-panels.spec.ts`.
- **Playwright e2e, hardware-dependent** (`npm run test:hardware`, separate `playwright.hardware.config.ts` + `tests/e2e-hardware/`) — requires a real, USB-connected FT-710 with `libft4222` installed. The FT4222 USB-SPI chain can't be meaningfully faked, so this drives the real hardware. Fails fast with a clear message (not a hang) if the reader can't open the device. **Deliberately excluded from CI** — no GitHub-hosted (or typical self-hosted) runner has a physical FT-710 attached.

**Isolation from a real/running instance:** all e2e config is built around never touching a developer's real deployment — this matters because a real, currently-in-use instance (with a real radio attached) may already be running on this machine. `server.ts` accepts `RCW_DATA_DIR` and `RCW_PORT` env var overrides (both purely additive — production behavior is unchanged when unset) so the test webServer always runs on its own port (3177 for `test:e2e`, 3178 for `test:hardware`) against its own scratch `settings.json`/`users.json`/TLS certs, and `reuseExistingServer` is always `false` so Playwright never attaches to whatever's already listening. The synthetic-UDP spectrum test similarly uses a private multicast group/port (`239.255.42.99:24531`), not the app's default `224.0.0.1:4531`, since multicast traffic isn't scoped to one process and could otherwise leak into (or receive crosstalk from) a real deployment's real spectrum feed. All e2e specs share one server process for the run and that server owns exactly one rig connection, so `playwright.config.ts` pins `workers: 1` — running spec files in parallel lets two tests fight over the same connection.

**Login/auth:** a fresh scratch `RCW_DATA_DIR` has no `users.json`, so the server seeds a default `ADMIN`/`admin` account with a forced password change on first login (see `server/auth.ts`). `tests/e2e/global-setup.ts` performs that login + forced change once and saves the resulting session as Playwright `storageState`, so individual spec files start already authenticated.

**Backlog:** empty — every panel/subsystem previously listed here (rig-status panels, CW keyer, MUF map, WSJTX bridge, Spots, Solar data, Auth/admin flows, browser video, and — as of the most recent round — `AudioFeedPanel`/`CwDecodePanel`/`SpectrumAudioPanel`) now has a spec in `tests/e2e/*.spec.ts`, and the full `npm run test:e2e` suite passes reliably end to end (confirmed across repeated runs).

`AudioFeedPanel`/`CwDecodePanel`/`SpectrumAudioPanel` share a real inbound-radio audio graph that requires `server/audio.ts`'s `naudiodon` to open a real OS audio device — unlocked via a PipeWire `pw-loopback` fixture (`tests/fixtures/audio-loopback.ts`, spawned once in `global-setup.ts`) plus `wpctl` (WirePlumber's own CLI) to make the loop's source the default — no PulseAudio server/`pactl` involved. Getting this working surfaced several non-obvious, real constraints worth knowing before touching these specs:

- `naudiodon`'s prebuilt `libportaudio.so.2` dynamically links `libpulse.so.0` even though the ALSA/PipeWire path is what's actually used — CI needs the `libpulse0` runtime package just for the import to succeed.
- The loopback's playback-side node opens fine when addressed directly by name, but naudiodon's capture stream **hangs indefinitely** when opened directly against the paired named source node (reproduced in isolation, outside Playwright). The fix: make that source the WirePlumber default (`wpctl set-default`) and open capture via the generic ALSA `"pipewire"` passthrough device instead — a different PortAudio code path that doesn't hit the hang.
- `server/audio.ts`'s outbound path only writes real mic audio (vs. silence) while `ctx.lastStatus.ptt` is true, and only for the current "active mic client" (requires an explicit unmute, `outboundMuted` defaults to `true`).
- The inbound relay (what feeds these panels' `AnalyserNode`) is deliberately **skipped** while `activeMicClientId && ptt && mode is not CW` — real half-duplex radio behavior — except in CW modes, where sidetone/monitor feedback is expected. The specs run in CW mode specifically to get a non-PTT-gated inbound path.
- Chromium's default fake mic (no `--use-file-for-fake-audio-capture`) is silent, not a tone, and the browser's Audio Enhancements (echo cancellation/noise suppression/AGC, default on) is speech-tuned DSP that suppresses a synthetic test tone almost entirely — both need explicit handling (a real WAV fixture, `tests/fixtures/fake-audio-wav.ts`; enhancements forced off via `localStorage`).
- `ctx.audioStatus`/`ctx.audioSettings` (server/audio.ts) are shared mutable state across the whole suite (one server process, `workers: 1`). AudioSettingsModal's "Backend Audio Engine" section auto-collapses whenever `audioStatus === "playing"` (`useAudio.ts`), including immediately on mount if it's *already* playing when a later spec's page loads — hiding the Backend Input/Output `<select>`s entirely. Worse, while inherited as "already playing," every device selection's `update-audio-settings` round trip triggers `server/audio.ts`'s `if (wasPlaying) startAudio(ctx)` — a real naudiodon stream stop+restart per selection — and stacking two of those back-to-back was enough to destabilize the renderer badly enough to drop its own WebSocket connection with no reconnect (confirmed via server-side connect/disconnect + heartbeat logging that the *server* was never blocked). Fix, applied in both `audio-panels.spec.ts` and `cw-decode-panel.spec.ts`: each spec explicitly clicks "Stop Backend Audio" before ending, so the next spec always starts from a clean "stopped" state; both specs also re-check the collapse state before every interaction with that section (`ensureBackendEngineExpanded()`) as defense in depth.

Windows/macOS audio (`naudiodon`'s WASAPI/CoreAudio backends) remains manual-verification-only — `test.yml`'s `e2e` job only runs on `ubuntu-24.04`, and no CI job exercises those platforms' audio paths at all. Same tier as `test:hardware`'s FT4222 coverage.

### Pre-release Checklist

Run all of these before tagging a release:

1. **Automated test suite**: `npm run lint && npm run test && npm run test:e2e` — also runs automatically on every push/PR via `.github/workflows/test.yml` (signal only, not a hard gate — see that file's header comment for why).
2. **FT4222 hardware test** (if an FT-710 is available): `npm run test:hardware`, radio connected via USB, nothing else using the device concurrently.
3. **Linux Package Smoke Test**: verifies DEB/RPM packages install cleanly and all shared libraries resolve on the minimum supported distros (Ubuntu 24.04, Fedora 39):

   ```bash
   bash scripts/test-linux-packages.sh                          # build + test (slow, ~3 min)
   bash scripts/test-linux-packages.sh path/*.deb path/*.rpm    # test pre-built packages (fast)
   ```

   Requires `podman`. The script installs the DEB in an Ubuntu 24.04 container and the RPM in a Fedora 39 container, then checks: package install succeeds, `.desktop` file and icon are placed correctly, and `ldd` finds all shared libraries for every bundled binary (rigctld, cw-key-helper, ft4222-scope-reader, naudiodon/libportaudio, libopus-node, Electron).

4. **Headless Docker Image Smoke Test**: verifies the headless deployment image (`./Dockerfile`) starts, serves HTTPS, and resolves shared libraries against the same glibc-2.39 floor:

   ```bash
   bash scripts/test-headless-docker.sh                # build from the current tree + test (slow)
   bash scripts/test-headless-docker.sh IMAGE:TAG       # test a pre-built/pulled image (fast)
   ```

   Requires `docker` or `podman` (auto-detected; prefers `docker` if both are present — override with `CONTAINER_ENGINE=docker|podman`). Root-daemon Docker and podman both fully verified (real device passthrough included, on a real Fedora 44 host); rootless podman has a documented device-access limitation — see the wiki's [Headless Deployment](https://github.com/jbdubbs/Rig-Control-Web/wiki/Headless-Deployment) page's Troubleshooting section, which covers the full headless deployment guide (Docker Compose, `docker run`, and systemd — x64 only for now; ARM64/Raspberry Pi support is intentionally deferred until the amd64 image gets sufficient real-world usage reports, per the maintainer's comment on the now-closed issue #23).

   **If this host has real ALSA hardware** (`/dev/snd` + an `audio` group — true of essentially any machine with a sound card, not just a dedicated radio controller), the same script also runs an audio device-enumeration check under the exact `--device`/`security_opt` flags `docker-compose.yml` ships — the regression test for [issue #55](https://github.com/jbdubbs/Rig-Control-Web/issues/55) (Docker/Podman mask `/proc/asound` by default, which broke `naudiodon`'s ALSA card enumeration even with `/dev/snd` correctly passed through). Auto-skipped, not failed, if neither is present. This can't be a GitHub-hosted CI gate: hosted runners can't `modprobe snd-dummy`/`snd-aloop` to fake a card even for this check alone — a long-standing, unresolved upstream limitation (`actions/runner-images#8295`) — so like `npm run test:hardware`, this stays manual/local only. The script's `/proc/asound` visibility check is the authoritative regression test for the masking bug specifically.

   A second, related `naudiodon`/PortAudio robustness gap in this same area — **fixed** as of `naudiodon-gcc15` v2.5.0 (`package.json`'s `naudiodon` pin) — used to make `getDevices()`/`getHostAPIs()` throw and return zero devices at all if *any single host API* failed to initialize, not just a bad device. Live field diagnosis of a real deployment (a headless Docker container bind-mounting only `/dev/snd`, no PulseAudio/PipeWire runtime socket) traced this to PortAudio's own `InitializeHostApis()` (`src/common/pa_front.c`): the PulseAudio host API this fork's build added alongside ALSA (for PipeWire routing convenience) fails hard when it can't reach a socket, and that one failure aborted ALSA too — even though ALSA's own per-device handling (`pa_linux_alsa.c`'s `FillInDevInfo`/`GropeDevice`) already gracefully skips a device it can't probe and always has. Patched upstream PortAudio so a failing host API is skipped instead of aborting every other one; see `naudiodon-gcc15`'s `patches/portaudio/README.md` for the full writeup. Applied to the Linux x64 binary only — arm64/armhf/Windows/macOS builds of that fork still carry the old behavior until next rebuilt.

5. **Headless x64 Bare-Metal Tarball Smoke Test**: verifies the prebuilt headless bare-metal tarball (`scripts/build-headless-x64.sh` — see [issue #57](https://github.com/jbdubbs/Rig-Control-Web/issues/57)) extracts and runs on a fresh Ubuntu 24.04 host with no compiler/build tools, and resolves shared libraries against the same glibc-2.39 floor:

   ```bash
   bash scripts/test-headless-x64.sh                         # build the tarball + test (slow)
   bash scripts/test-headless-x64.sh path/*.tar.gz            # test a pre-built tarball (fast)
   ```

   Requires `docker` or `podman` (auto-detected, same override as item 4). Unlike the Docker image test, this one extracts into a throwaway container standing in for a bare-metal target host, then checks: `node server.ts` boots and serves HTTPS with no `npm ci`/compile step, `ldd` finds all shared libraries for every bundled binary and native addon, and the bundled `rigctld` responds against Hamlib's Dummy backend. A similar tarball exists for arm64 (item 6) but remains a testing build pending real Raspberry Pi hardware verification (issue #54) — the x64 tarball is fully supported since it targets this project's already-CI-tested floor.

6. **Headless arm64 Bare-Metal Tarball Smoke Test** (testing build, issue #54): same idea as item 5, but for the arm64 testing tarball (`scripts/build-headless-arm64.sh`, `scripts/Containerfile.arm64-builder`), extracting into an **emulated arm64 `debian:12`** container (QEMU user-mode, `podman run --arch=arm64` — matches `Containerfile.arm64-builder`'s own base/floor, the actual documented target: Raspberry Pi OS Bookworm/Debian 13) rather than `ubuntu:24.04`:

   ```bash
   bash scripts/test-headless-arm64.sh                        # build the tarball + test (slow — QEMU emulation)
   bash scripts/test-headless-arm64.sh path/*.tar.gz           # test a pre-built tarball (still slow)
   ```

   Podman only (same `--arch` vs `--platform` reason as `build-headless-arm64.sh`), and requires `qemu-user-static` (see that script's header for one-time host setup). Debian 12 predates the 64-bit `time_t` package-renaming transition, so this test installs the plain (non-`t64`-suffixed) runtime library names, unlike item 5's Ubuntu 24.04 names.

`.github/workflows/docker-publish.yml` (triggered on `v*` tag push or manual dispatch) builds/pushes the image to Docker Hub (`jbdubbs/rigcontrol-web`, tags `latest` + the version) and then syncs `DOCKERHUB.md` to the Docker Hub repo page's description via `peter-evans/dockerhub-description`. **`DOCKERHUB.md`'s "Latest release" line must be updated by hand as part of cutting each release** — it doesn't auto-generate from the GitHub Release body.

## Architecture

### Process Model

```
Browser / Electron Renderer
      ↕ Socket.io (WSS — HTTPS)
Express + Socket.io Server  (server.ts orchestrator + server/ modules)
      ↕ TCP socket         ↕ child_process.spawn   ↕ naudiodon (native)   ↕ child_process.spawn   ↕ child_process.spawn
   rigctld (Hamlib)         (unused — FFmpeg        libopus-node            cw-key-helper (C binary) ft4222-scope-reader (C binary)
      ↕ Serial/USB           removed from all        (Opus codec)            DTR/RTS serial line      ↕ libft4222 (dlopen)
   Radio Hardware            paths)                                                                   FT4222H USB-SPI chip
                                                                                                      ↕ SPI
                                                                                                   FT-710 DSP
```

**Video pipeline:** The Electron renderer (always the video source) captures via `getUserMedia` + `MediaStreamTrackProcessor`, encodes H.264 (AVCC, avc1.42001F / OpenH264 Baseline Profile) with `VideoEncoder`, and emits chunks through the Socket.io server. The server buffers the latest keyframe (with its AVCC SPS/PPS description) and relays all chunks to remote browser clients, which decode with `VideoDecoder` and render to a `<canvas>`. FFmpeg is **not** used in any path.

### Key Files — Backend

- **`server.ts`** — 269-line orchestrator. Wires together the 9 modules below and starts the HTTPS server.
- **`server/context.ts`** — `ServerContext` interface; the single shared-mutable-state object passed by reference to every module.
- **`server/tls.ts`** — Auto-generates/reuses an EC P-256 self-signed certificate covering `localhost` and all LAN IPs (required for `getUserMedia`/`setSinkId` in browser contexts).
- **`server/settings.ts`** — Reads/writes `settings.json`; emits `settings-data` on connect or change.
- **`server/rigctld.ts`** — Spawns and monitors the `rigctld` child process; buffers the last 100 log lines.
- **`server/rigComm.ts`** — Owns the TCP socket to `rigctld`; polls rig state every 2 s; implements `executeRigCommand` with extended-mode RPRT handling. Also implements radio power on/off control (`get_powerstat`/`set_powerstat`, see Radio Power Control below) and auto-reconnect: an unexpected socket drop (not a user-initiated disconnect) schedules a reconnect attempt every 5 s until it succeeds; rig log lines are timestamped (`HH:MM:SS.mmm`) so reconnect timing is visible in the log view.
- **`server/audio.ts`** — Manages `naudiodon` I/O streams and `libopus-node` encode/decode; enforces last-interacted-wins mic policy via `activeAudioClientId`.
- **`server/cw.ts`** — Server-side iambic state machine (A/B/straight); drives DTR/RTS via the `cw-key-helper` C binary subprocess; 5 s stuck-key watchdog.
- **`server/video.ts`** — Relays WebCodecs H.264 chunks from the Electron source to remote clients; buffers the latest keyframe.
- **`server/solar.ts`** — Fetches solar/propagation data from hamqsl.com (HF band conditions, VHF phenomena, SFI, SSN); caches server-side and pushes `solar-data` events to clients.
- **`server/spectrum.ts`** — Binds a UDP socket on the configured multicast port and joins the multicast group on every non-loopback IPv4 interface (so packets are received regardless of which adapter `rigctld` uses). Parses Hamlib 5.x JSON (`packet.spectra[0]`) and emits `spectrum-data` Socket.io events to all clients. Started/stopped by `onSpectrumEnabledChanged` in `server/settings.ts`. Gated by `spectrumSettings.enabled` and `spectrumSettings.source === "hamlib"`.
- **`server/yaesuScope.ts`** — Spawns `ft4222-scope-reader` (C binary) and reads its NDJSON stdout line-by-line. Parses span, center frequency, mode variant, and 850-point amplitude array from each frame. Emits `spectrum-data` and `yaesu-scope-status` Socket.io events. Auto-restarts with a 3 s delay after unexpected exit while enabled. Activated when `spectrumSettings.source === "ft4222"`. `getYaesuScopeHelperPath()` resolves the binary path the same way as `getCwHelperPath()`. **Compatible radio: Yaesu FT-710 only.** The FT-710 has the FTDI FT4222H chip built into its USB subsystem; enabling OPERATION SETTING → GENERAL → SCU-LAN10: ON activates the chip's data stream directly over USB (no physical SCU-LAN10 accessory required). The FTDX101MP, FTDX101D, and FTDX10 are SCU-LAN10-compatible radios but stream spectrum data only through the physical SCU-LAN10 Ethernet bridge accessory — no FT4222H USB device is exposed to the host PC on those models.
- **`server/serial.ts`** — On-demand serial port enumeration for the Serial Port (RIGCTLD tab) and Keyer Serial Port (KEYER tab) fields' autocomplete dropdown. `listSerialPorts()` dispatches on `process.platform`: Linux reads `/dev` for `ttyUSB*`/`ttyACM*`/`ttyS*` and prefers a device's stable `/dev/serial/by-id/*` symlink over the raw path when one resolves to it; macOS reads `/dev` for `cu.*` entries (not `tty.*`, which blocks on DCD) excluding the always-present `cu.Bluetooth-Incoming-Port`; Windows shells out to `reg query "HKLM\HARDWARE\DEVICEMAP\SERIALCOMM"` (no native `serialport` dependency — consistent with `cw-key-helper.c` replacing `pyserial` for the same native-module-avoidance reason). Linux `ttyS*` needs extra handling: the `serial8250` driver reserves ~32 device nodes on most x86 systems whether or not real UART hardware backs them, and unlike `ttyUSB*`/`ttyACM*` (which only ever exist when a device is plugged in) there's no sysfs signal that tells a phantom `ttyS*` apart from a real one — confirmed empirically (`/sys/class/tty/ttySN/device` exists identically for all 32 on a real test machine). `/proc/tty/driver/serial` has the real answer (`uart:16550A` vs `uart:unknown` per port) but is commonly unreadable to a non-root process (verified Permission denied on that same test machine) — the same class of restriction as `/proc/asound` masking in containers (see the Docker/Podman audio note below). When it can't be read, `ttyS*` enumeration falls back to just `ttyS0`-`ttyS3` (the classic COM1-4-equivalent range) rather than showing all ~32 phantom entries. Not cached in `ServerContext`; re-enumerated on every `get-serial-ports` request, matching `server/audio.ts`'s on-demand `get-audio-devices` pattern rather than `videoDeviceList`'s cache-and-broadcast pattern, since serial adapters get plugged/unplugged more often than audio hardware.
- **`server/dxCluster.ts`** — Server-owned telnet client for DX-cluster spotting (see DX Cluster Spotting below): opens/reconnects the raw `net.Socket` to `dxClusterSettings.host:port`, logs in with `dxClusterSettings.loginCallsign`, parses `DX de ...` lines via the exported pure `parseDxSpotLine()`, maintains `ctx.dxSpotBuffer`, and emits `dx-spot`/`dx-cluster-status`. `startDxCluster`/`stopDxCluster` are started/stopped by `onDxClusterEnabledChanged` in `server/settings.ts`, exactly like `startSpectrumListener`/`stopSpectrumListener`.
- **`server/vlog.ts`** — Per-subsystem debug logging; exports `vlogRig`, `vlogAudio`, `vlogVideo`, `vlogCw`, `vlogInfra`, `vlogSpectrum`, `vlogSpots`, `vlogDx`, `vlogWsjtx` helpers gated by the corresponding `--debug-*` CLI flag (`--debug-spectrum` for `vlogSpectrum`, `--debug-spots` for `vlogSpots`, `--debug-dxcluster` for `vlogDx`, `--debug-wsjtx` for `vlogWsjtx`) or an equivalent env var (`DEBUG_SPECTRUM=1`, etc.; `DEBUG_ALL=1` enables every subsystem) — the env var form is what headless Docker/systemd deployments use, since there's no CLI invocation to attach flags to (see "Docker / Docker Compose (Headless)" and "systemd (Headless)" in the Diagnostic Logging wiki page). The `spots` flag is also forwarded to the browser via the `debug-flags` Socket.io event, where `usePotaSpots` logs fetch lifecycle (request, response status, spot count, errors) to the browser console with `[spots:pota]`, `[spots:sota]`, and `[spots:wwff]` prefixes. The `wsjtx` flag enables browser-side logging in `useWsjtxBridge` (WebSocket lifecycle, rig command relay with `[wsjtx:bridge]` prefix) and `useAudio` (WSJTX audio output setup with `[wsjtx:audio]` prefix). The `wsjtx-bridge` C helper has its own `--verbose` flag for local diagnostics.

### Key Files — Frontend

- **`src/App.tsx`** — Composition root; assembles hooks and renders `CompactLayout` or `PhoneLayout` based on viewport width (≥768 px → Compact). Contains the WSJTX bridge audio auto-setup effect (watches `bridgeConnected`, auto-detects virtual audio devices — Linux PipeWire devices by name or Windows VB-Audio virtual cables by label — auto-switches audio devices, deferred mic unmute).
- **`src/hooks/`** — All business logic:
  - `useRigControl` — Socket.io rig commands and state
  - `useAudio` — `getUserMedia`, AudioWorklet, WebCodecs Opus decode/encode, GainNode volume
  - `useVideoStream` — WebCodecs H.264 encode (Electron source) and decode (remote clients)
  - `useCWKeyer` — Paddle event emission, sidetone (`AudioContext` oscillator), keyer settings
  - `useCwDecoder` — GGMorse WASM lifecycle, decoded text buffer, pitch/WPM stats
  - `usePotaSpots` — Browser-side POTA/SOTA/WWFF polling, deduplication, filtering
  - `useDxSpots` — DX-cluster spot state fed by server-pushed Socket.io events (`dx-spots-backlog`/`dx-spot`/`dx-cluster-status`), not a browser poll — see DX Cluster Spotting below
  - `useRigctld` — `rigctld` process control and log streaming
  - `useSolarData` — Receives `solar-data` events from server; triggers client-side refresh
  - `useWsjtxBridge` — WebSocket connection to `wsjtx-bridge` helper; relays rig commands between WSJTX (via the helper) and the Socket.io server; forwards `rig-status` updates to the helper's cache
  - `useLayoutState` — Viewport breakpoint and layout-level state
  - `usePanelState` — Per-panel collapse state
  - `useLayoutConfig` — Grid layout persistence to `localStorage`; `addPanel`, `removePanel`, `updateItemPositions`
- **`src/layouts/`** — `CompactLayout.tsx`, `PhoneLayout.tsx`, `PhoneStickyBar.tsx`. No Desktop layout (removed 2026-05-01).
- **`src/panels/`** — 15 panel components (each wrapped in `PanelChrome`): `VfoPanel`, `ControlsPanel`, `TabbedMeterPanel`, `RfLevelsPanel`, `ModeBwPanel`, `AudioFeedPanel`, `VideoFeedPanel`, `SpectrumHamlibPanel`, `SpectrumAudioPanel`, `SpotsPanel`, `SpotComboPanel`, `CwDecodePanel`, `CommandConsolePanel`, `MufMapPanel`, `SolarPanel`.
- **`src/modals/`** — `SettingsModal.tsx` (tabs: RIGCTLD / SPOTS / KEYER), `AudioSettingsModal.tsx`, `VideoSettingsModal.tsx`, `SpotSettingsModal.tsx`, `ComboSpotSettingsModal.tsx`.
- **`src/components/PanelChrome.tsx`** — Shared collapsible/expandable wrapper with title and header-action slots; used by all panels. `hideCollapse` prop suppresses the chevron entirely for body-less panels (e.g. `AudioFeedPanel`).
- **`src/components/EditToolbar.tsx`** — Fixed toolbar rendered during compact/phone layout edit mode. Cols/rows ± controls, Add Panel, Reset, and Done buttons. `showRowsControl` prop gates the size controls (phone view omits them).
- **`src/components/PanelPicker.tsx`** — Two-step modal for adding panels. Step 1 lists available panel types (already-placed panels greyed out). Step 2 (for panels with `PANEL_CONFIG_OPTIONS` entries, e.g. `mufmap`) shows a height slider and Full Width toggle before confirming.
- **`public/audio-processor.js`** — Static file loaded by `AudioWorklet.addModule()`. Defines two `AudioWorkletProcessor` classes: `PlaybackProcessor` (inbound jitter buffer, 60 ms min / 240 ms max at 48 kHz) and `CaptureProcessor` (posts mic PCM frames to the main thread). Must be a static URL-addressable file; cannot be bundled.
- **`cw-key-helper.c`** — C source for the CW keyer serial line helper. Compiled to `bin/linux/cw-key-helper`, `bin/mac/cw-key-helper`, and `bin/windows/cw-key-helper.exe` per platform. Spawned by `server/cw.ts` (`openKeyerPort`) to drive DTR or RTS. Opens the port with `O_RDWR | O_NOCTTY | O_NONBLOCK`, configures raw termios (no flow control, `HUPCL` cleared), deasserts the line before printing `OPEN_OK`, then reads `0`/`1` from stdin and toggles the line via `TIOCMBIS`/`TIOCMBIC` (POSIX) or `EscapeCommFunction` (Windows). Replaces the Python/`pyserial` approach; the Node.js `serialport` package asserts DTR before JS can run on Linux with CP210x adapters, causing stuck-key failures. Run `npm run build:cw-helper` to compile for the local platform in dev.
- **`cw-key-helper.py`** — Original Python/`pyserial` helper. **Superseded by `cw-key-helper.c`**; retained for reference only. No longer bundled or spawned.
- **`ft4222-scope-reader.c`** — C source for the FT-710 spectrum scope reader. Compiled to `bin/linux/ft4222-scope-reader`, `bin/mac/ft4222-scope-reader`, and `bin/windows/ft4222-scope-reader.exe` per platform. Spawned by `server/yaesuScope.ts`. Loads `libft4222` at runtime via `dlopen` (Linux/macOS) or `LoadLibrary` (Windows) — zero link-time dependency; reports a clear error if the library is not installed. On Windows, `SetDllDirectoryA` adds `%APPDATA%\RigControl Web` (Electron's userData directory) to the DLL search path before loading, so DLLs placed there survive app upgrades (the exe directory is still searched as a fallback). Reads 4096-byte SPI frames (FT4222 SPI master, `CLK_DIV_64`, `CLK_IDLE_HIGH`, single I/O), verifies the 4-byte sync pattern at offset 4092 (`FF 01 EE 01`), extracts the 850-byte `wf1` amplitude array at offset 0 (bitwise inverted — higher byte = stronger signal), and reads span/center/mode from the 150-byte metadata block at offset 2900. Outputs `OPEN_OK\n` then one NDJSON line per frame: `{"spanHz":N,"modeVariant":N,"centerHz":N,"lowHz":N,"highHz":N,"wf1":"<1700 hex chars>"}`. Run `npm run build:ft4222-reader` to compile for the local platform in dev. Requires `libft4222` on the host — see the wiki's [FT-710 Spectrum Scope Setup](https://github.com/jbdubbs/Rig-Control-Web/wiki/Spectrum-Scope-FT-710) page.
- **`wsjtx-bridge.c`** — C source for the WSJTX rig-control bridge (v0.2.1). Compiled to `bin/linux/wsjtx-bridge`, `bin/mac/wsjtx-bridge`, and `bin/windows/wsjtx-bridge.exe`. Runs two localhost-only servers in a single `select()` event loop: (1) a TCP server (default port 4540) speaking the Hamlib rigctld extended protocol — WSJTX connects here via "Hamlib NET rigctl"; (2) a WebSocket server (default port 4541) speaking a simple JSON protocol — the RigControl Web browser tab connects here via `useWsjtxBridge` to relay rig commands through Socket.io to the real rigctld. Maintains a cached rig state (frequency, mode, PTT, VFO, split) updated by `rig-status` events from the browser; GET commands (`f`, `m`, `t`, `v`, `s`) respond from cache, SET commands (`F`, `M`, `T`, `V`, `S`) are forwarded to the browser as JSON and responses delivered asynchronously via a pending-command queue with 5 s timeout. `dump_state` returns protocol v1 with `ptt_type=0x1` (RIG_PTT_RIG) so the Hamlib netrigctl backend enables PTT support. Cache guard (3 s) protects SET values from stale poll overwrites. On Linux, auto-creates PipeWire virtual audio devices (`pw-loopback`) for WSJTX audio routing. `--verbose` flag enables timestamped diagnostic logging. Build: `gcc -O2 -o bin/linux/wsjtx-bridge wsjtx-bridge.c` (Linux), `clang -O2` (macOS), `cl /O2 ws2_32.lib advapi32.lib` (Windows).
- **`src/types/solar.ts`** — TypeScript interfaces for solar/propagation data: `HfBandCondition`, `VhfCondition`, `SolarData` (SFI, SSN, A/K-index, X-ray, geomagnetic field, solar wind, aurora, proton/electron flux).
- **`electron/main.ts`** — Electron main process; spawns the Express server, manages `BrowserWindow`, grants camera/mic permissions. Calls `setElectronWindow(win)` and `shutdown()` exported from `server.ts` for lifecycle management.
- **`electron/preload.ts`** — Exposes `window.electron.resizeWindow(width, height)` via `contextBridge`.
- **`radios.json`** — Bundled read-only Hamlib radio model database. Do not modify.
- **`settings.json`** — Auto-created user settings (gitignored). In Electron production, falls back to `/tmp/settings.json`.

### Socket.io Configuration

Per-message deflate compression (`perMessageDeflate: false`) is explicitly disabled on the Socket.io server. The app sends high-frequency binary payloads (audio chunks every 20 ms, video frames continuously); compression would add CPU overhead and latency with negligible bandwidth benefit for already-encoded binary data.

`server.ts` exports `setElectronWindow(win)` and `shutdown()` for Electron lifecycle management. `setElectronWindow` passes the `BrowserWindow` reference so the server can send resize/IPC events; `shutdown()` performs graceful teardown (kills `rigctld`, closes naudiodon streams, closes the HTTPS server) when the Electron window closes. In standalone server mode, `SIGINT`/`SIGTERM` handlers cover the same teardown path.

### Socket.io Communication Patterns

**Client → Server (commands):**
- Rig control: `connect-rig`, `set-frequency`, `set-mode`, `set-ptt`, `set-func`, `set-level`, `set-split-vfo`, `vfo-op`, `send-raw`, `set-power` (`{ state: boolean }` — radio power on/off via `set_powerstat`)
- Process control: `start-rigctld`, `stop-rigctld`, `kill-existing-rigctld`, `test-rigctld`
- Settings: `save-settings`, `toggle-auto-start`, `get-settings`
- Video: `control-video`, `update-video-settings`, `get-video-devices`
- Audio: `control-audio`, `update-audio-settings`, `audio-outbound`, `get-audio-devices`
- CW: `cw-paddle` (`{ dit, dah, straight, t }` — client-relative timestamps)
- Solar: `get-solar-data`
- Serial: `get-serial-ports` — requests a fresh server-side enumeration (see `server/serial.ts`)

**Server → Client (state):**
- `rig-status` — Polled every 2 s: frequency, mode, PTT, VFO state, meters
- `rig-connected` — Includes `{ vfoSupported, powerSupported }` flags from capability probes
- `rigctld-status`, `rigctld-log` — Process health and buffered log (last 100 lines)
- `audio-inbound` — PCM/Opus packets from radio to browser
- `settings-data` — Full settings object on connect or change
- `video-frame` — Encoded H.264 chunks relayed to remote clients
- `solar-data` — HF band conditions, VHF phenomena, SFI, SSN from hamqsl.com
- `spectrum-data` — Live spectrum frame (shared by both Hamlib UDP and FT4222 paths): `{ id, name, type, length, amplitudes, minLevel, maxLevel, centerFreq, span, lowFreq, highFreq, timestamp }`
- `yaesu-scope-status` — FT4222 reader process state: `{ running: boolean, error: string | null }`
- `serial-ports-list` — Result of a `get-serial-ports` request: `{ path: string; label: string }[]`
- `dx-spots-backlog` — Buffered DX-cluster spots (`DxSpot[]`) replayed to a newly-connecting socket; `dx-spot` — one new parsed spot pushed live; `dx-cluster-status` — `{ connected: boolean, error: string | null }`
- `debug-flags` — Mirrors server `--debug-*` flags as a `DebugFlags` object to browser clients

### Audio Pipeline

- **Outbound (browser → radio):** Browser `getUserMedia` → `AudioWorklet` (`CaptureProcessor` in `public/audio-processor.js`) → 48 kHz mono PCM frames (960 samples / 20 ms) → `libopus-node` encoder on server → `naudiodon` playback. An outbound jitter buffer (sole writer via 20 ms `setInterval`) prevents concurrent-write packet loss on Windows.
- **Audio Enhancements toggle** (`localAudioSettings.enhancementsEnabled`, `local-audio-enhancements` in `localStorage`, default on): controls whether `getUserMedia`'s `echoCancellation`/`noiseSuppression`/`autoGainControl` constraints are requested for outbound mic capture (`useAudio.ts` `startMicCapture`), for both the default input and a specifically-selected device. Toggle lives in `AudioSettingsModal` under Local Client Audio. Enabling it is what causes voice-oriented DSP to run on the captured stream; on Windows this also tags the audio session as "communications," which can trigger the OS's Sound Settings → Communications ducking of other apps'/tabs' audio — a known, expected side effect of turning enhancements on, not a bug. Forced off automatically for the duration of a WSJTX/Digital Mode Bridge session (`App.tsx`, keyed on `bridgeEnabled`) and restored after, since AGC/noise suppression/echo cancellation are tuned for speech and will distort FT8/PSK/etc. tones carried over the bridge's virtual audio cable; the toggle stays interactively editable during that session (not locked), so a user can still override it manually.
- **Inbound (radio → browser):** `naudiodon` capture → `libopus-node` encoder → Socket.io `audio-inbound` → Browser WebCodecs `AudioDecoder` → `AudioWorklet` (`PlaybackProcessor` in `public/audio-processor.js`, jitter buffer 60 ms min / 240 ms max) → `GainNode` (0–200% volume) → `AudioContext.destination`.
- Inbound PCM is also fed to `GGMorseDecoder.processSamples()` when CW decoding is enabled, regardless of mute state.
- Multi-client mic uses "last-interacted-wins" policy tracked via `activeAudioClientId`. Persistent `clientId` (localStorage UUID, passed via `socket.handshake.auth`) survives reconnects.
- `naudiodon` is a forked dependency (`github:jbdubbs/naudiodon-gcc15`) patched for GCC 15 compatibility.

### Video Pipeline

- **Source (Electron only):** `getUserMedia` → `MediaStreamTrackProcessor` → `VideoEncoder` (avc1.42001F, AVCC) → Socket.io `video-frame` events.
- **Relay (server):** Buffers latest keyframe + its AVCC description (`EncodedVideoChunkMetadata.decoderConfig.description`). On client connect, sends the buffered keyframe first so the decoder can configure immediately.
- **Sink (remote browsers):** `VideoDecoder` → `<canvas>` via `VideoFrame.copyTo` or `ImageBitmap`.
- FFmpeg is not involved in video.

### Panel System

All functional UI sections live in `src/panels/` as independent components, each wrapped in `PanelChrome` for consistent collapsible/expandable chrome with a title and optional header-action slot.

**Compact layout** uses a segment-based column renderer (`useLayoutConfig`): full-width panels (`w >= cols`) render as rows; per-column panels form `grid-cols-N` stacks that take only the vertical space their content needs. Layout mutations (drag, resize, add, remove, cols/rows) persist to `localStorage`. The `EditToolbar` and `PanelPicker` (two-step for configurable panels like `mufmap`) drive grid edits.

**Phone layout** renders panels sorted by `y`-value from `phoneLayout.items`. Edit mode shows ▲ ▼ × overlays for reordering. `PanelPicker` is restricted to `PHONE_PANEL_TYPES`.

### Spots Integration

POTA, SOTA, and WWFF spots are fetched **browser-side** via `setInterval` (no server relay). Each spot type: deduplicates by activator, applies age/mode/band filters, and supports click-to-tune (SSB resolves to USB/LSB by the 10 MHz ITU boundary). Settings persisted to `settings.json`. Available as individual panels (`spots_pota`, `spots_sota`, `spots_wwff`) or the unified `spots_combo` panel (`SpotComboPanel` with `ComboSpotSettingsModal`).

### DX Cluster Spotting

A fourth spot source (`spots_dx` panel, or the "DX" tab in `spots_combo`) for hunting specific stations/regions rather than "everybody." Unlike POTA/SOTA/WWFF, real DX-spot data is not available as a public JSON API — DXWatch and DX Summit are both web front ends over the classic amateur-radio **DX-cluster telnet network** (DXSpider/AR-Cluster software), the same source tools like POTACAT use. That makes this a fundamentally different integration: a single **server-owned, login-identified TCP connection** (`server/dxCluster.ts`), not a per-browser-tab `fetch()` poll — you can't have every open tab independently telnet into a cluster node under the same callsign.

- **Connection**: `startDxCluster(ctx)` opens a raw `net.Socket` (mirrors `server/rigComm.ts`'s rigctld socket) to `dxClusterSettings.host:port` (default `w3lpl.net:7373` — W3LPL, a well-known high-volume public node; host/port are user-editable). On the login prompt, sends `dxClusterSettings.loginCallsign` (no password required by these nodes). Reconnects every 10s while `dxClusterSettings.enabled` stays true, but is capped at 3 connection attempts per rolling 60s window (`MAX_ATTEMPTS_PER_WINDOW`/`ATTEMPT_WINDOW_MS`) — a public cluster node is a shared, sysop-run resource, and reconnecting rapidly/repeatedly risks the connecting IP getting banned. The budget check lives in `startDxCluster()` itself (not just the close-triggered retry path), so it also guards against any caller invoking start/stop in a tight loop; it resets early on a successful login, and after exhausting it the connection surfaces an error via `dx-cluster-status` and requires an explicit disable/re-enable to try again — `stopDxCluster()` deliberately does *not* reset the budget on its own (see the comment in `server/dxCluster.ts`), since a stop is often immediately followed by a start (e.g. re-applying a host/port change) and resetting there would defeat the cap entirely. Settings saves only restart the connection when a connection-relevant field actually changed (`enabled`/`host`/`port`/`loginCallsign` — checked in `server/settings.ts`); `maxAge`/filter-only edits never touch the socket.
- **Parsing**: `parseDxSpotLine()` (pure, unit-tested in `server/dxCluster.test.ts`) matches the classic fixed-format `DX de <SPOTTER>:   <FREQ>  <DXCALL>   <COMMENT>          <HHMM>Z` line via a whitespace-anchored regex rather than fixed column offsets, which drift slightly between cluster software/versions. Non-spot lines (WWV/WCY, prompts, announcements) are dropped. A rolling buffer (`ctx.dxSpotBuffer`, capped and pruned by `dxClusterSettings.maxAge`) is replayed to newly-connecting sockets as `dx-spots-backlog`; each new parsed line is pushed live as `dx-spot`. `dx-cluster-status` reports `{ connected, error }`.
- **Filtering**: structured, not a poll-rate/mode-checkbox shape like the other three. A **Callsign/Prefix filter** and a **Keyword filter** (each a comma-separated term list, OR'd within a field, AND'd across fields) plus the shared `POTA_BANDS` band-filter checkboxes — reused client-side in `useDxSpots.tsx`. Callsign-prefix filtering doubles as geographic filtering (ham prefixes are geography, e.g. "VP8" = Falklands), so there's no separate DXCC/country lookup. DX spot lines carry no structured mode field (mode, if present at all, is free text in the comment), so there's no mode-filter control — the keyword filter covers it, and the tune handler only best-effort-scans the comment for a mode keyword before falling back to leaving mode untouched.
- **Frontend**: `src/hooks/useDxSpots.tsx` is a separate hook from `usePotaSpots.tsx` (event-driven Socket.io append/prune vs. poll-and-replace `fetch()` — different enough data flow to not fold in) but mirrors its output contract (settings state, filtered/sorted list, `renderDxSpotsTable()`, a tune handler) so it drops into the same `CompactLayout`/`PhoneLayout`/`SpotComboPanel` call sites. `dxClusterSettings` (including `enabled`) is saved via its own scoped `save-settings` emit (`{ dxClusterSettings }`), not bundled into App.tsx's single debounced multi-field save effect — that bundle fires on unrelated rig/pota/sota/wwff settings changes too, and the server treats every `save-settings` call carrying `dxClusterSettings` as an explicit enable/disable request that stops+restarts the telnet connection.

### Spectrum Scope

Three mutually exclusive source modes, selected via `spectrumSettings.source`:

**Hamlib UDP** (`source: "hamlib"`, `server/spectrum.ts`): Receives Hamlib's UDP multicast spectrum stream and relays it as `spectrum-data` events. Joins the multicast group on every non-loopback IPv4 interface via `os.networkInterfaces()` to handle machines where `rigctld`'s send interface differs from the OS routing default (common on Windows with VPN adapters). Hamlib 5.x wraps spectrum data in a `spectra[]` array at the packet root; the parser reads from `packet.spectra[0]` and maps `minStrength`/`maxStrength` (dBm) as the level range. Radio requirements: serial speed 115200 baud, CI-V Transceive OFF, CI-V USB Echo ON. Compatible radios: IC-7300, IC-7300MK2, IC-7610, IC-7850/7851, IC-705, IC-9700, IC-905. Note: the IC-7610 and IC-7850/7851 expose two spectrum scopes (Main + Sub) in Hamlib; RigControl Web currently only uses the first scope (`spectra[0]`). Dual-scope support is deferred — see Known Issues / Tech Debt.

**FT-710 USB** (`source: "ft4222"`, `server/yaesuScope.ts`): Spawns `ft4222-scope-reader` (C binary at `bin/<platform>/ft4222-scope-reader[.exe]`), which opens the FT4222H USB-SPI device via `libft4222` (loaded at runtime with `dlopen`/`LoadLibrary` — no link-time dependency). The binary reads 4096-byte SPI frames from the FT-710 DSP, extracts the 850-point `wf1` amplitude array (bytes 0–849, bitwise inverted), parses the 150-byte metadata block at offset 2900 for span/center/mode, and emits one NDJSON line per frame to stdout. The server parses these and emits `spectrum-data` events. Sync pattern at bytes 4092–4095 (`FF 01 EE 01`) is verified per frame; 5 consecutive failures trigger a device re-initialize. Auto-restarts with 3 s delay on unexpected exit. Requires `libft4222` installed on the host — see the wiki's [FT-710 Spectrum Scope Setup](https://github.com/jbdubbs/Rig-Control-Web/wiki/Spectrum-Scope-FT-710) page. **Compatible radio: Yaesu FT-710 only** — see `server/yaesuScope.ts` note above for why FTDX10/FTDX101 are not supported via this path. **Frequency mapping:** The FT-710 wf1 array physically covers more than the nominal span — 790 of the 850 bins correspond to the nominal span (395 per half-span), with 30 guard bins on each side. `SpectrumHamlibPanel` applies a scale factor of `850/790 ≈ 1.076` to the offset from center when computing click-to-tune frequencies and axis labels for FT-710 data (`data.name === "FT-710"`). This correction is empirically derived from WWV measurements and does not apply to the Hamlib UDP path. Click-to-tune snaps to the nearest 100 Hz.

`ft4222-scope-reader.c` is compiled by `scripts/build-ft4222-reader.mjs` (`npm run build:ft4222-reader`) and placed in `bin/<platform>/`. Like `cw-key-helper`, it is in `asarUnpack` and bundled in all Electron installers.

**Audio I/Q** (`source: "iq"`, `server/iqScope.ts`): For radios with a baseband I/Q output on a stereo jack, captured via a stereo USB audio interface — generic mechanism (no radio-specific driver or child binary), but **tested only against the Xiegu G90**. Unlike the FT4222 path, `naudiodon` is driven directly in-process (reusing `resolveDeviceId()`, exported from `server/audio.ts`, for device resolution) rather than spawning a child binary. Captures 2-channel 16-bit PCM at `spectrumSettings.iqSampleRate` (48/96/192 kHz) into non-overlapping `IQ_FFT_SIZE` (2048-sample) blocks; each block is Hann-windowed, transformed with a hand-rolled radix-2 complex FFT (`server/fft.ts` — deliberately not an npm dependency, backed by `server/fft.test.ts`'s known-tone/DC/Parseval-energy checks), converted to dB magnitude, `fftshift`ed so the array runs most-negative-frequency to most-positive with DC at center, and quantized to the same 0–255 `amplitudes` byte shape the other two sources use (`server/iqScope.test.ts` covers this pure transform, `buildIqSpectrumFrame()`, independent of naudiodon). `spectrumSettings.iqSwapChannels` swaps which channel is treated as I vs Q — the same fix HDSDR uses for this radio's own reversed-sideband/mirror issue. `centerFreq` is the rig's live tuned frequency (`ctx.lastStatus.frequency`); `span` equals the selected sample rate (I/Q complex sampling covers the full sample rate as unambiguous bandwidth, not half of it, unlike real-valued sampling) — see the wiki's [Audio I/Q Spectrum Scope Setup](https://github.com/jbdubbs/Rig-Control-Web/wiki/Spectrum-Scope-Audio-IQ) page for why a radio's *real* usable bandwidth doesn't grow just because a higher capture rate is selected. No power-gating or device-loss retry budget like the FT4222 path needs (the USB audio adapter is a separate device from the radio and doesn't disappear when the radio powers off) — only a short bounded retry against the audio engine's own fire-and-forget startup load. `name: "Audio I/Q"` in emitted frames deliberately avoids the FT-710-only `data.name === "FT-710"` span-scale correction in `SpectrumHamlibPanel`.

### Solar / Propagation Data

`server/solar.ts` fetches HF band conditions, VHF phenomena, SFI, and SSN from `hamqsl.com/solarxml.php` server-side (with a 1-hour cache) and pushes `solar-data` events to clients. `SolarPanel` displays HF band condition rows (day/night) and VHF propagation alerts. `useSolarData` hook manages client-side state.

### MUF Map Panel

`MufMapPanel` embeds SVG world propagation maps from `prop.kc2g.com` (MUFD or foF2). Supports scroll-to-zoom (cursor-anchored), drag, and pinch-to-zoom. Uses `width/height = scale * 100%` on the image wrapper for crisp SVG rasterization. Height is configured at panel-add time via the two-step `PanelPicker` config flow and stored in `GridItem.heightPx`.

### Radio Power Control

For radios that support Hamlib's `set_powerstat`/`get_powerstat` (probed once per connect via `probePowerCapability()` in `server/rigComm.ts`, lowercase `get_powerstat` for the get form since Hamlib's extended protocol is case-sensitive get/set), a Power button appears in the `ControlsPanel` header (`ControlsPanelHeaderAction` in `src/panels/ControlsPanel.tsx`).

- **Power off:** `set_powerstat 0` is sent; the server clears PTT and the CW key, drains the queued-command backlog, stops backend audio (`stopAudio(ctx)`), clears spectrum data, and suspends the normal 2 s poll loop in favor of a `get_powerstat` probe every 5 s so the server notices when the radio comes back on. `status.powerState` becomes `'off'`; the frontend's `effectivelyConnected = connected && status?.powerState !== 'off'` gates all rig controls and a red "Radio powered down — Power on to resume" banner is shown (`src/App.tsx`), taking priority over the CW-mode warning in both compact and phone layouts.
- **Power on:** `set_powerstat 1` is sent, then the server polls `get_powerstat` every 500 ms for up to 10 s waiting for confirmation (a timeout is treated as expected — the radio may still be booting — not surfaced as a user error). The frontend shows an amber spinner (`poweringOn`) during this window. Once confirmed, `onPowerOn(ctx)` resumes polling, restarts backend audio after a 2 s delay (USB re-enumeration), and restarts the FT4222 scope reader if `spectrumSettings.source === "ft4222"`. `onPowerOn(ctx)` is called both from the off→on poll transition and from `probePowerCapability()` on every (re)connect, so a power-on detected via the auto-reconnect path (below) also restarts the FT4222 reader without requiring a manual spectrum source toggle.
- New sockets connecting while the radio is off receive the correct power state immediately via `pushInitialState`.

**Linux note:** on radios whose USB Audio interface disappears from the OS entirely when powered off (e.g. the FT-710), see the "Linux: Radio Power Cycling and USB Audio Reconnection" section of `wiki/Audio-and-Video.md` for a PipeWire default-device caveat that can leave backend audio broken after a power cycle until the user manually reassigns PipeWire's default device.

### CW Keyer

Server-side iambic state machine (A/B/straight) in `server/cw.ts`. Client sends `cw-paddle { dit, dah, straight, t }` events where `t` is ms since socket connect (computed via `performance.now() - cwConnectTimeRef`) to decouple element timing from network jitter. Keying output via DTR or RTS through the `cw-key-helper` C binary subprocess (`bin/<platform>/cw-key-helper[.exe]`); `rigctld-ptt` mode also supported. 5 s stuck-key watchdog. Client-side sidetone (`AudioContext` oscillator, routed via `setSinkId`) provides zero-latency local feedback gated on `localAudioReady`. Phone view shows dit/dah touch paddle buttons when rig is in a CW mode and the keyer is enabled.

The C binary is compiled from `cw-key-helper.c` and placed in the platform `bin/` directory. `getCwHelperPath()` in `server/cw.ts` resolves the path using the same pattern as `getRigctldPath()` in `server/rigctld.ts`. In CI (`build.yml`), the binary is compiled before `npm run electron:build` on each platform runner so it is always bundled in the AppImage/DEB/RPM/DMG/NSIS installer. `bin/**/*` is in `asarUnpack`, so the binary is accessible at runtime outside the ASAR archive.

### CW Decoder

GGMorse library compiled to WASM (`public/ggmorse.js` / `public/ggmorse.wasm`) via Emscripten. `GGMorseDecoder` class (`src/ggmorseDecoder.ts`) loads WASM lazily on first enable and exposes `processSamples(Float32Array)` and `reset()`. Fed raw F32 PCM from the inbound audio path after WebCodecs decoding — runs even when the speaker is muted. Decoded characters stream into a 2000-char rolling buffer; pitch (Hz) and WPM stats shown alongside. Toggle in the KEYER settings tab.

### Native Modules

Native `.node` addons (`naudiodon`) and `.wasm` files (`libopus-node`, `ggmorse`) must be excluded from bundling. In Electron builds they are ASAR-unpacked via `asarUnpack` in `package.json`. In server code, native modules are loaded via dynamic `import()` to bypass esbuild.

### HTTPS / TLS

`server/tls.ts` (`loadOrGenerateCert()`) auto-generates an EC P-256 self-signed certificate at startup, covering `localhost`, `127.0.0.1`, and all current LAN IPv4 addresses in the SAN. Reused if valid for 30+ days and all IPs are still covered; otherwise regenerated. Required so that `getUserMedia` and `setSinkId` work in browser tabs opened to LAN IPs. Certificate files are gitignored.

### Settings Persistence

`settings.json` is read/written by the server via `server/settings.ts`. Fields include: `rigNumber`, `serialPort`, `baudRate`, `rigctldAutoStart`, `pollRate`, video settings, audio device settings, POTA/SOTA/WWFF settings, CW keyer settings. The `radios.json` file is read-only; do not modify it.

### Electron IPC

- `nodeIntegration: false`, `contextIsolation: true` — renderer has no direct Node access.
- Preload exposes only `window.electron.resizeWindow(width, height)`.
- Camera/microphone permissions granted via `setPermissionRequestHandler`.
- `app.setName('RigControl Web')` sets the human-readable app name. `app.setDesktopFileName('rigcontrol-web.desktop')` (called on Linux before `whenReady()`, guarded with a runtime exists-check since it was not available in all Electron 41.x builds) sets the Wayland `xdg_toplevel app_id` and X11 `_GTK_APPLICATION_ID` so GNOME Shell can match the window to the correct `.desktop` file and show the right dock icon.
- Linux AppImage auto-installs GNOME desktop integration (icon + `.desktop` file) on first launch if not already present. The `.desktop` file uses `StartupWMClass=rigcontrol-web` and `Exec="<path>" --class=rigcontrol-web %U`; the `--class` flag forces Electron's `WM_CLASS` to `rigcontrol-web` so it matches `StartupWMClass` exactly (without it, Electron derives `WM_CLASS` from `app.getName()` as `"rigcontrol web"` — lowercase with a space — which does not match). The `--install` / `--uninstall` CLI flags provide explicit control; both exit before `app.whenReady()`.
- **GNOME dock icon on first direct launch**: When the AppImage is launched directly (not via the GNOME Activities menu), the dock icon will show as generic on that first run. This is a GNOME Shell limitation: it matches running windows to `.desktop` files at window-creation time using startup notification tokens, which are only issued when an app is launched through GNOME's own launcher infrastructure. The auto-install writes the correct `.desktop` file and icon before the window appears, so all subsequent launches from the Activities menu show the correct icon immediately.

### Linux Packages (DEB / RPM)

Linux builds produce AppImage, `.deb`, and `.rpm` targets (configured in `package.json` `build.linux.target`). The `deb` and `rpm` config blocks declare full dependency lists — **electron-builder replaces (not merges) defaults when custom `depends` is specified**, so both Electron's standard deps and app-specific deps (ALSA, PulseAudio, libusb, readline) are listed explicitly. The CI workflow (`build.yml`) installs the `rpm` package on the Ubuntu runner to provide `rpmbuild` for RPM generation. Desktop integration (`.desktop` file, icons) is handled automatically by electron-builder for DEB/RPM — the AppImage-specific `autoInstallDesktopIntegration()` code is guarded by `process.env.APPIMAGE` and does not fire for native packages. See the wiki's [Linux DEB & RPM Packages](https://github.com/jbdubbs/Rig-Control-Web/wiki/Linux-Packages) page for supported distros, dependencies, and installation instructions.

### Windows Installer (NSIS)

The Windows target uses a custom NSIS include script (`buildResources/installer.nsh`, referenced via `nsis.include` in `package.json`) that defines three electron-builder hook macros:

- **`customFinishPage`** — Custom finish page with both a "Launch" checkbox and an "Open documentation (GitHub Wiki)" checkbox.
- **`customInit`** — Migrates FT4222 DLLs (`ftd2xx.dll`, `LibFT4222-64.dll`) from the old install directory (`$INSTDIR`) to `%APPDATA%\RigControl Web\` (Electron's userData directory) before the installer wipes the old directory during an upgrade. Only copies files that exist in `$INSTDIR` and don't already exist in the target. This ensures FT-710 spectrum scope users don't have to re-copy the DLLs after every update.
- **`customInstall`** — Adds two inbound Windows Defender Firewall rules post-install: TCP 3000 for the HTTPS web server (scoped to the app executable) and UDP 4531 for the CI-V spectrum scope multicast from `rigctld` (not app-scoped, since `netsh program=` filtering is unreliable for multicast UDP). 4531 is the default `multicast_data_port`; users who change the port in Spectrum settings must adjust the rule manually. Existing rules are skipped; per-user installs trigger a single UAC prompt covering both.
- **`customUnInstall`** — Presents two optional Yes/No prompts (both skipped during a silent uninstall via `${IfNot} ${Silent}`):
  1. **"Remove the Windows firewall rules that were added for RigControl Web (inbound TCP 3000 and UDP 4531)?"** — defaults to **Yes** (`MB_DEFBUTTON1`); deletes both rules (directly when elevated, otherwise via a `runas` UAC prompt).
  2. **"Also delete RigControl Web user data (saved settings and login accounts)?"** — defaults to **No** (`MB_DEFBUTTON2`); choosing Yes runs `RMDir /r "$APPDATA\RigControl Web"`, deleting Electron's userData directory (`settings.json`, `users.json`, `auth.json`, `audit.json`). This is the supported way to reset login accounts/settings on reinstall — the unconditional `deleteAppDataOnUninstall` electron-builder flag is deliberately **not** used, since the data folder otherwise survives a normal uninstall/reinstall.

## Known Issues / Tech Debt

- `rigctld` binary is assumed to be in system PATH (or `bin/[platform]/rigctld` in Electron builds).
- Split VFO support depends on the specific radio model configured in `rigctld`.
- Port conflict: if `rigctld` is already running on the same port externally, the spawned process will fail (error shown in log view).
- Some radios (e.g. FT-891) return `RPRT -11` for certain commands in incompatible modes (e.g. NB in FM). These are handled gracefully as immediate rejections; no socket destruction occurs.
- Verify `rigctld` binary availability in the production Electron environment.
- **CW keying via DTR/RTS on Windows when rigctld shares the same serial port:** On Windows, `CreateFile` on a COM port is exclusive by default (share mode 0). When `rigctld` holds the radio's USB serial port for CI-V, `cw-key-helper` cannot open the same port and fails with `ERROR_ACCESS_DENIED` (error 5). This affects radios like the IC-7300 that expose a single USB virtual COM port for both CI-V and hardware CW keying. **Workaround:** use a separate USB-to-serial adapter wired to the radio's key jack, or install a virtual COM port pair driver (e.g. com0com) and configure `rigctld` to use the virtual port so the real port is free for `cw-key-helper`. On Linux and macOS, Hamlib does not set `TIOCEXCL`, so the port can be shared between `rigctld` and `cw-key-helper` without this issue (see separate note about baud-rate interference in `cw-key-helper.c`).
- **Linux: backend audio doesn't resume correctly after a radio power cycle:** On radios whose USB Audio interface disappears from the OS when powered off (e.g. the FT-710), PipeWire re-targets its default ALSA/Pulse sink and source away from the radio the moment it vanishes, and does not automatically switch back when the device reappears. If the Backend Input/Output selection resolves through that "default" device rather than a device pinned to specific hardware, backend audio stays broken after every power cycle until the user manually reassigns PipeWire's default device back to the radio. The FT-710 additionally requires PipeWire's global sample rate to be forced to 44.1 kHz and the `pipewire [ALSA, 44.1k]` device selected explicitly — its direct hardware device identifier only exposes 48 kHz. See "Linux: Radio Power Cycling and USB Audio Reconnection" in `wiki/Audio-and-Video.md`.
- **IC-7300 single-USB-port CW keying:** The IC-7300's `USB Keying (CW)` and `USB Send` radio menu settings cannot be set to the same line. For CW keying via DTR, set `USB Keying (CW) = DTR` and `USB Send` to any other value (e.g. RTS or OFF). The `rigctld-ptt` CW keying method only toggles PTT per element; it does not assert the radio's CW key input and will not produce a CW tone on the IC-7300.
- **Dual spectrum scope (IC-7610, IC-7850/7851):** The IC-7610 and IC-7850/7851 expose two independent spectrum scopes (Main and Sub) via Hamlib. RigControl Web currently reads only `packet.spectra[0]` (Main scope). To support Sub scope, a scope selector UI, a second `spectrum-data` channel or scope ID field, and possibly a second `SpectrumHamlibPanel` instance would be needed. Deferred for a future release.
- **Audio I/Q spectrum source validated on one radio:** The `source: "iq"` mechanism (stereo USB audio capture + complex FFT) is radio-agnostic by design, but has only actually been tested against a Xiegu G90. The `IQ_ENCODE_MIN_DB`/`IQ_ENCODE_MAX_DB` range and the panel's default floor/ceiling values (`server/iqScope.ts`, `src/panels/SpectrumHamlibPanel.tsx`) are reasoned estimates, not a calibrated reference — expect to retune them (and confirm the Swap I/Q default) against real hardware for any other radio/adapter combination.
- **Auto floor/ceiling not yet validated on the Hamlib UDP source:** `src/utils/autoLevel.ts`'s percentile-based auto-leveling has been confirmed on real hardware for `ft4222` and tuned accordingly (`floorPercentile: 63.2` in `SOURCE_ALGORITHM_OPTIONS`, `src/panels/SpectrumHamlibPanel.tsx`), and the same correction was applied to `iq` on the reasoning that its FFT is likewise single-look/un-averaged (`server/iqScope.ts` — independent, non-overlapping blocks, no temporal averaging) — but that hasn't been checked against real I/Q hardware yet either. `hamlib` is deliberately left at the untuned `floorPercentile: 10` default with Auto Floor/Ceiling off by default (`autoDefault: false`), since its `minLevel`/`maxLevel` come from whatever the radio itself reports over CI-V, which may or may not already reflect radio-side detector/sweep averaging depending on the model — unlike ft4222/iq, this can't be reasoned about from the code alone. Validate on a real hamlib-connected radio before enabling it by default or adding a `floorPercentile` override for that source.
- **Backend audio device list is not preloaded:** `server/audio.ts` (`listAudioDevices`/`get-audio-devices`) only enumerates `naudiodon` devices on-demand when a client emits `get-audio-devices` (triggered by `onFocus` on the Backend Input/Output dropdowns in `AudioSettingsModal.tsx`, or when the audio settings modal opens). This causes a noticeable delay and dropdown layout shift on first use. Fix: cache the enumerated list in `ServerContext` (e.g. `audioDeviceList`, mirroring the existing `videoDeviceList` pattern), populate it once during `initAudioEngine` at startup, send it to clients via `pushInitialState` on connect, and broadcast (`ctx.io.emit`) an updated list to all clients when `get-audio-devices` is used as a manual refresh. Deferred for a future release.
- **WSJTX bridge integration is work-in-progress.** PTT now works (fixed 2026-06-24). Audio device auto-setup implemented (2026-06-24): when the bridge WebSocket connects, the browser auto-detects virtual audio devices and configures bidirectional audio routing. **Linux:** detects `RCW-WSJTX-RX` and `RCW-WSJTX-TX` PipeWire virtual devices created by the bridge helper. **Windows:** detects VB-Audio virtual cable products by label regex — supports VB-CABLE (`VB-Audio Virtual Cable`), Hi-Fi CABLE (`VB-Audio Hi-Fi Cable`), and Cable A–D (`VB-Audio Cable A`–`D`). Requires two distinct cables for bidirectional audio; the first detected cable is assigned as RX (browser → WSJTX), the second as TX (WSJTX → browser). If only one cable is detected, a warning prompts the user to install a second. Platform-specific warning messages guide setup. The browser auto-switches the WSJTX Audio Output and Local Input (Mic) to the detected virtual devices, stashing the previous settings for restoration on disconnect. Mic is auto-unmuted once `localAudioReady` is true; original mute state is restored on disconnect. The user must still manually "Join Audio" before auto-setup takes effect (browser autoplay policy prevents programmatic `AudioContext` creation without a user gesture). Remaining work includes: the bridge helper is manually launched (not yet spawned/managed by the server); the browser sends `sendResult(true)` to the bridge immediately (fire-and-forget) without waiting for server confirmation — a failed `set-ptt` on the server side is reported as success to WSJTX. **Important: after modifying `useWsjtxBridge.ts` or any frontend source, run `npm run build` to rebuild the Vite bundle — the Electron app serves the pre-built `dist/` output, not live source.**
- **TODO: move Windows CI runner off `windows-2022` to a VS2026-based image.** GitHub began migrating `windows-latest`/`windows-2025` to Windows Server 2025 + Visual Studio 2026 on 2026-06-08, which broke `npm ci` in `.github/workflows/build.yml` — the npm-bundled `node-gyp` 11.x cannot detect VS2026 and fails rebuilding `naudiodon`'s native module (`gyp ERR! find VS unknown version "undefined"`). Pinned the Windows job to `windows-2022` (supported for ~3 more years) as a stopgap. To move back to a current image: bump to `npm@>=11.6.3` / `node-gyp@>=12.1.0` (adds VS2026 detection — see nodejs/node-gyp#3282), confirm `naudiodon` and `libopus-node` still rebuild cleanly under the new node-gyp major version on Windows, then switch `windows-2022` back to `windows-latest` in `build.yml`.
