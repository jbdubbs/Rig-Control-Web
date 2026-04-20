# Dev Notes — RigControl Web

## Current State
A full-stack web application (Express + Vite + Socket.io) designed to control amateur radio equipment via Hamlib's `rigctld`. It features a real-time dashboard with frequency, mode, and meter displays. Recent updates added the ability to automatically start and manage a local `rigctld` process directly from the web interface. The app now supports stable multi-window operation and optimized video streaming.

## Active Work
- [x] Implement `rigctld` auto-start logic in backend.
- [x] Create settings persistence (`settings.json`).
- [x] Build frontend settings modal for radio configuration.
- [x] Add status feedback for the `rigctld` process (is it actually running?).
- [x] Add manual "Start/Stop" controls for `rigctld` in the settings modal.
- [x] Implement a "Log" view in the settings modal to see `rigctld` output.
- [x] Add a "Test Connection" button in the settings modal to verify serial port access.
- [x] Implement split VFO mode functionality (UI, backend, visual feedback).
- [x] Optimize multi-window connection stability.
- [x] Stabilize video streaming session management.
- [x] Increment app version to 04.14.2026-Alpha3.
- [x] Implement Opus audio decoding for inbound audio (rig -> client).
- [x] Implement Opus audio encoding for outbound audio (client -> rig).
- [x] Add server-side FFmpeg-based Opus encoding/decoding.
- [x] Implement client-side local audio device selection (input/output).
- [x] Fix "white screen" crash in non-secure browser contexts.
- [x] Implement "last-interacted-wins" policy for multi-client microphone recording.
- [x] Optimize audio latency (16kHz, AudioWorklet, jitter buffering, Socket.io tuning).
- [x] Fix stale `clientId` mic tracking and `getUserMedia` device fallback for remote browsers.
- [x] Phone UI: collapsible VFO box with inline tuning arrows, step chips, and consistent left/right arrow language.
- [x] Phone UI: consolidate Quick Controls, RF Power, and More Controls into single collapsed box; PTT standalone.
- [x] Fix white browser background on all views via global CSS body color.
- [x] Replace FFmpeg video streaming with browser-native WebCodecs H.264 pipeline.
- [x] Compact view VFO header: center tune arrows between VFO/SPLIT buttons and Mode/BW selects using 3-column grid layout.
- [x] Compact view VFO header: right-justify Mode and BW dropdowns.
- [x] Phone view collapsed VFO header: add `—` separator between VFO letter and frequency to match the existing MHz/mode separator.
- [ ] Verify `rigctld` binary availability in the production environment.
- [x] Fix Windows inbound audio (22–50 second gaps) — root cause: USB device sample rate mismatch + naudiodon highWaterMark blocking.
- [x] Fix Windows outbound audio (every-other-packet loss) — root cause: competing writes from socket handler and silence timer; fixed with jitter buffer.
- [x] Expose host API name and native sample rate in device selector; disable incompatible WASAPI entries.
- [x] Add `-v` verbose flag to gate diagnostic console output on server and browser clients.
- [x] Bump version to 04.14.2026-Beta1.
- [x] Rename settings modal to "General Settings" with tab-based interface (RIGCTLD / SPOTS tabs).
- [x] Integrate POTA Spots: browser-side API polling, deduplication, UTC time fix, age/mode/band filters.
- [x] SPOTS box: phone view (below Quick Controls + scroll pill), compact view (slide-in drawer), desktop view (below Video & Audio).
- [x] Click-to-tune from spot row: set VFO frequency and mode; SSB resolves to USB/LSB by 10 MHz boundary.

## Decisions Log
| Decision | Rationale | Date |
|----------|-----------|------|
| Used `spawn` for `rigctld` | Provides better lifecycle management (PID tracking, stream handling) than `exec`. | 2026-03-18 |
| JSON for persistence | `settings.json` and `radios.json` are simple, human-readable, and don't require a database engine. | 2026-03-18 |
| Socket.io for settings | Ensures the backend and frontend stay in sync when auto-start is toggled or settings change. | 2026-03-18 |
| Combined VFO/Mode UI | In compact mode, grouping these saves vertical space for mobile/tablet use. | 2026-03-18 |
| Added `rigctld-status` event | Allows real-time UI feedback on the health of the background process. | 2026-03-18 |
| Manual Start/Stop buttons | Provides user control without needing to toggle the auto-start preference. | 2026-03-18 |
| Buffered Log View | Essential for debugging serial port issues or rigctld crashes without server access. | 2026-03-18 |
| Connection Test Logic | Spawns `rigctld` briefly to verify it can bind to the port and open the serial device. | 2026-03-18 |
| Split VFO Visuals | Used Amber/Red colors to clearly distinguish VFO A and B when in Split mode, matching common radio UI patterns. | 2026-03-19 |
| Shared `isConnected` state | New browser windows now receive the current rig connection status on initial load, preventing redundant connection attempts. | 2026-03-31 |
| Stable `videoSessionId` | Prevented multiple video streams from being opened when switching between UI views (Phone/Compact/Desktop) by making the session ID stable per window. | 2026-03-31 |
| Removed `DEBUG_RIG` env var | Cleaned up unused legacy configuration to simplify the user setup experience in AI Studio. | 2026-04-02 |
| Modular Refactoring | Broke down `server.ts` and `App.tsx` into smaller, task-specific files to improve maintainability and simplify future development. | 2026-04-02 |
| Local Audio Selection | Enabled users to select their local system mic and speakers in the client UI, persisting choices in `localStorage`. | 2026-04-02 |
| MediaDevices Safety | Added null-checks for `navigator.mediaDevices` to prevent app crashes in non-secure browser contexts where the API is restricted. | 2026-04-02 |
| PulseAudio Integration | Switched Linux backend to use `pactl`/`pacat` when available, providing a robust abstraction over ALSA and fixing "Device busy" errors. | 2026-04-02 |
| Last-Interacted-Wins | Implemented a policy where only the most recently interacted-with window can record mic audio, preventing multi-client audio collisions. | 2026-04-02 |
| Audio Latency Opt | Reduced sample rate to 16kHz, switched to AudioWorklet, implemented jitter buffering, and tuned Socket.io/FFmpeg for near real-time performance. | 2026-04-02 |
| Opus Audio Codec | Implemented Opus encoding/decoding for both inbound and outbound audio using FFmpeg on the server and WebCodecs on the client, significantly reducing bandwidth while maintaining quality. | 2026-04-05 |
| Native Audio Subsystem | Replaced FFmpeg/pacat subprocesses with `naudiodon` and `libopus-node` for robust, cross-platform, low-latency audio I/O and encoding directly within the Node.js process. | 2026-04-09 |
| Audio Build Pipeline | Implemented bundler bypass for native modules, configured ASAR unpacking, and forked `naudiodon` to fix GCC 15 compatibility and remove outdated dependencies. | 2026-04-10 |
| Persistent `clientId` for Audio | Used a `localStorage` UUID passed via `socket.handshake.auth` instead of the transient `socket.id` to track the active mic client, surviving reconnects without losing mic ownership. | 2026-04-11 |
| `getUserMedia` Device Fallback | Added try/catch around `getUserMedia` with `{ exact: deviceId }` to fall back to the default device when a stored device ID is stale or unavailable, preventing silent capture failure. | 2026-04-11 |
| Phone UI — VFO Box Redesign | Replaced the phone VFO controls with a collapsible box: collapsed state shows frequency/mode summary with `[◁ step]` / `[step ▷]` inline tuning buttons and a vertical chevron for expand/collapse, eliminating ambiguity between the two controls. Expanded state uses step chips and left/right arrows for consistency. | 2026-04-11 |
| Phone UI — Controls Consolidation | Moved PTT to a standalone always-visible button above a single collapsed-by-default Quick Controls box containing Tune/Att/Preamp, NB/AGC/DNR/ANF toggles, and all RF/level sliders. Removed the separate RF Power box and the MORE CONTROLS progressive disclosure toggle. | 2026-04-11 |
| Global Background Color | Set `html, body { background-color: #0a0a0a }` in `index.css` so the browser chrome behind all views (phone, compact, desktop) matches the app background instead of defaulting to white. | 2026-04-11 |
| Compact VFO Header 3-Column Grid | Replaced `justify-between` flex with a `grid-cols-3` layout in the compact view VFO header so tune arrows sit visually centered over the frequency display, with VFO/SPLIT buttons anchored left and Mode/BW selects anchored right. | 2026-04-14 |
| Phone Collapsed VFO Separator | Added a `—` separator between the VFO letter and frequency in the phone collapsed header (e.g. `● A — 14.225 MHz — USB`) to match the existing MHz/mode separator and improve scannability. | 2026-04-14 |
| Windows Inbound Audio Fix | Root cause of 22–50 second audio gaps was a USB device sample rate mismatch combined with naudiodon's `highWaterMark` blocking: `audioIOAdon.read(N)` waits for exactly N bytes before resolving, so a large `highWaterMark` (16384) caused very long waits. Fix: `framesPerBuffer: 0` (lets PortAudio negotiate native buffer size), `highWaterMark: 256`, `maxQueue: 10`. Device must also be at 44.1 kHz or the same rate that Windows reports; MME/DirectSound resample transparently, WASAPI requires an exact 48 kHz match. | 2026-04-14 |
| Windows Outbound Audio Fix | Every-other-packet audio loss was caused by two concurrent writers to naudiodon's Writable stream: the socket `audio-outbound` handler wrote PCM directly while a `setInterval` silence timer also wrote. On Windows, the naudiodon write mechanism serialises writes and the race between the two sources caused frames to be dropped or mis-ordered. Fix: introduce an outbound jitter buffer (`outboundJitterBuffer[]`); socket handler only decodes Opus and enqueues PCM; the unified 20 ms `setInterval` is the sole writer, draining the buffer when PTT is on and writing silence otherwise. `framesPerBuffer: 0` applied to output stream as well. | 2026-04-14 |
| Host API + Sample Rate in Device Selector | Added `hostAPIName` and `defaultSampleRate` to the naudiodon device listing. Dropdowns display `[MME, 44.1k]` / `[DirectSound, 48k]` etc. WASAPI entries at ≠ 48 kHz are disabled with a "set device to 48k in Windows" hint, since WASAPI shared mode requires an exact format match and the app always requests 48 kHz. | 2026-04-14 |
| Verbose Logging Flag | Added `-v` / `--verbose` CLI flag (checked via `process.argv`). Server defines `VERBOSE` and `vlog()` at module level; all chatty diagnostic logs (Hamlib capability detection, audio packet diagnostics, per-frame video relay, etc.) go through `vlog`. Server emits `verbose-mode` event on socket connect so browser clients can mirror the same flag via a module-level `clientVerbose` variable and matching `vlog`. | 2026-04-14 |
| WebCodecs Video Pipeline | Replaced FFmpeg MJPEG streaming with a browser-native WebCodecs H.264 pipeline. The Electron app captures via `getUserMedia` + `MediaStreamTrackProcessor`, encodes with `VideoEncoder` (avc1.42001F / OpenH264), and relays encoded chunks through the Socket.io server to remote browser clients which decode with `VideoDecoder` and render to a `<canvas>`. Removes all FFmpeg dependency from the video path. | 2026-04-14 |
| General Settings Tabs | Renamed the settings modal from "Rigctld Auto-Start Settings" to "General Settings" and introduced a tab bar (RIGCTLD / SPOTS) so the modal can grow to cover non-rig settings without bloating a single panel. Active tab uses an emerald underline border; tab state is local (not persisted). | 2026-04-16 |
| Browser-Side POTA Polling | POTA spot data is fetched client-side via `fetch()` on a `setInterval` rather than through the server. The POTA API is public/read-only with no auth, and browser polling avoids pushing spot data to all connected clients who may not have it enabled. | 2026-04-16 |
| POTA UTC Time Fix | The POTA API returns `spotTime` without a timezone suffix (e.g. `"2026-04-16T14:51:11"`). JavaScript parses bare ISO strings as local time, not UTC, causing all spots to appear far in the future relative to `Date.now()` (UTC). Fixed by appending `'Z'` before parsing: `new Date(s.spotTime + 'Z')`. Applied in both the age filter and the age display formatter. | 2026-04-16 |
| POTA Activator Deduplication | The POTA API returns multiple spots per activator as different spotters hear them. Only the latest spot per activator callsign is retained before applying the age and mode/band filters. ISO 8601 strings compare correctly with `>` without parsing. | 2026-04-16 |
| POTA Band Filter as Multi-Select | Band filtering uses a `string[]` (empty = all bands) rather than single-select to match typical operating practice where operators monitor multiple bands simultaneously. Band ranges are defined as a `POTA_BANDS` constant array in kHz (matching the POTA API's frequency unit). | 2026-04-16 |
| POTA SSB Frequency Resolution | Clicking a spot with mode `SSB` resolves to `USB` if the frequency is ≥ 10 MHz, `LSB` if below. This matches ITU/band-plan convention and avoids presenting an invalid mode to the rig. | 2026-04-16 |
| POTA Compact View Drawer | In compact view, the SPOTS box is surfaced as a slide-in drawer from the right edge rather than a popup window (which would require a user-gesture to re-open after page reload and complex Electron `window.open` handling). A MapPin button appears in the app header when POTA is enabled; clicking opens the drawer with a click-outside-to-dismiss backdrop. | 2026-04-16 |
| AVCC Description Propagation | WebCodecs H.264 encoder outputs AVCC-formatted frames. SPS/PPS (the `avcC` box) is delivered once in `EncodedVideoChunkMetadata.decoderConfig.description` after `configure()`. It is attached to every keyframe emission so the server's buffered keyframe always carries it, and any late-joining remote client can correctly configure its `VideoDecoder` on arrival. | 2026-04-14 |
| Video Device ID vs. Label | Separated `deviceId` (opaque browser UUID used by `getUserMedia`) from human-readable `label` in the device list. `enumerateVideoDevices()` now emits `{ id, label }` pairs; settings store the `deviceId`; the dropdown displays the label. Prevents `OverconstrainedError` from passing a label as a `deviceId` constraint. | 2026-04-14 |
| VFO Capability Probe | On TCP connect, before polling starts, `probeVfoCapability()` sends `get_vfo` in standard mode and checks the raw response. `RPRT -11` means the radio doesn't implement VFO switching; the `vfoSupported` flag is set to `false` for the session. The flag is included in the `rig-connected` payload so the client can immediately disable VFO B, Split, and related UI controls. Resets to `true` on disconnect/reconnect. Standard mode (not extended) is used for the probe so that `RPRT -11` resolves immediately rather than waiting for a terminator that never arrives. | 2026-04-20 |
| Extended Mode RPRT Handling | `executeRigCommand` in extended mode previously only resolved on `RPRT 0` or `RPRT 1`, causing any other RPRT code (e.g. `RPRT -11` for unsupported command) to hang until the 10-second timeout fired and destroyed the socket. Fixed by matching any `RPRT (-?\d+)` in the response: codes 0/1 resolve normally, all others reject with the code as the error message. Existing `.catch()` guards on per-command poll calls absorb mode-incompatible rejections cleanly without disrupting the connection. | 2026-04-20 |
| Verbose Rig Command Logging | Added `[RIG]` prefixed logging to `executeRigCommand`: every send and response logs under `vlog` (verbose-only); timeouts, socket errors, and "not connected" rejections always log at `console.warn`/`console.error` and include the command string so failures are immediately identifiable in the console without needing to reproduce under a debugger. | 2026-04-20 |
| Self-Signed TLS Certificate | Replaced plain HTTP server (`http.createServer`) with `https.createServer` backed by a self-signed EC P-256 certificate generated via `selfsigned`. `loadOrGenerateCert()` runs at startup: if a valid certificate exists (expiry > 30 days, SAN covers all current LAN IPs) it is reused; otherwise a new 1-year cert is generated and saved to `dataDir`. SAN entries include `localhost`, `127.0.0.1`, and all non-loopback IPv4 addresses at generation time. HTTPS is required so that `getUserMedia` and `setSinkId` work in browser tabs opened to LAN IPs (browsers restrict these APIs to secure contexts). Certificate files are gitignored. | 2026-04-20 |

## Known Issues / Tech Debt
- `rigctld` path is assumed to be in the system PATH.
- If `rigctld` is already running outside the app on the same port, the spawned process will fail with an error, which we now catch and display in the log view.
- Split VFO support depends on the specific radio model configured in `rigctld`.
- Some radios (e.g. FT-891) return `RPRT -11` for certain commands in incompatible modes (e.g. NB in FM). These are now handled gracefully as immediate rejections rather than timeouts; no socket destruction occurs.

## Architecture Notes
- **Modular Backend**: Extracted logic into `RigctldManager`, `VideoStreamManager`, and `SettingsManager` to separate concerns and allow for easier testing.
- **Componentized Frontend**: Moved UI logic into smaller components (`VFOControl`, `MeterDisplay`, etc.) and used a `RigContext` to manage shared state.
- **Server-as-Manager**: The Express server is not just a proxy but a process manager for `rigctld`.
- **Event-Driven**: All radio state changes flow through Socket.io to ensure low latency.
- **Graceful Shutdown**: The server listens for `SIGINT`/`SIGTERM` to kill the `rigctld` child process, preventing orphaned processes.
- **Log Buffering**: The server keeps the last 100 lines of `rigctld` output in memory to provide context to newly connected clients.
- **Split VFO State**: Managed as a boolean in the rig status, triggering specific UI color overrides.
- **Multi-Window Awareness**: The backend now avoids resetting the rig connection if a new client connects to the same host/port, ensuring stability across multiple tabs.
- **WebCodecs Video Pipeline**: The Electron app is always the video source. It captures via `getUserMedia` + `MediaStreamTrackProcessor`, encodes H.264 (AVCC, avc1.42001F) with `VideoEncoder`, and emits chunks to the server. The server buffers the latest keyframe (with its AVCC description) and relays all chunks to remote clients, which decode with `VideoDecoder` and render to a `<canvas>`. Any client can configure video settings and request start/stop; the server broadcasts changes to the Electron source.
- **Client Audio Routing**: Uses `getUserMedia` with specific `deviceId` for input and `setSinkId` for output, allowing full control over local audio hardware.
- **Native Audio Backend**: Uses `naudiodon` for direct access to host audio devices (ALSA/Pulse/CoreAudio/WASAPI) without spawning external processes, improving reliability and latency.
- **Multi-Client Mic Policy**: Server tracks `activeAudioClientId` based on client interaction events, enforcing a single-source audio stream to the backend.
- **Low-Latency Audio Pipeline**: Uses 48kHz mono Opus encoding via `libopus-node` and WebCodecs, with `AudioWorklet` for capture/playback and a PCM ring buffer for precise frame slicing.
- **POTA Spots Pipeline**: Browser polls `https://api.pota.app/spot/` on a client-side `setInterval`. Raw results are deduplicated by activator callsign (latest `spotTime` wins), filtered by max age (UTC-corrected by appending `'Z'` to bare ISO strings), mode, and band before being passed to a `useMemo`-derived sorted list. `POTA_BANDS` defines 14 amateur bands as kHz min/max ranges. Settings (`enabled`, `pollRate`, `maxAge`, `modeFilter`, `bandFilter`) are persisted to `settings.json` via the existing `save-settings` socket event.
- **General Settings Modal Tabs**: The settings modal uses a tab bar rendered between the header and content area. `activeSettingsTab` state drives which panel is visible. Adding new tabs requires only adding a string literal to the tab array and a corresponding conditional content block.

## Breadcrumbs
> [2026-04-02 13:00 UTC] Refactored the core codebase into modular files and components. This significantly reduces the size of `server.ts` and `App.tsx`, making the project easier to maintain and test.

> [2026-04-02 19:00 UTC] Implemented local audio device selection and fixed browser stability issues. The app now handles missing `mediaDevices` gracefully and allows users to choose their local hardware for bi-directional audio.

> [2026-04-02 19:20 UTC] Added "last-interacted-wins" policy for microphone recording. This prevents multiple windows from sending audio simultaneously, ensuring only the active window's mic is routed to the server.

> [2026-04-02 19:40 UTC] Optimized audio latency across the entire stack. Switched to 16kHz sample rate, implemented `AudioWorklet` for mic capture, added jitter buffering for playback, and disabled Socket.io compression to achieve near real-time performance.

> [2026-04-05 18:10 UTC] Implemented Opus audio codec for bi-directional communication. The server now uses FFmpeg to encode/decode Opus, and the client uses the WebCodecs API for low-latency, high-quality audio at 16kbps. This significantly improves performance on bandwidth-constrained connections.

> [2026-04-09 15:30 UTC] Completely redesigned the backend audio subsystem. Replaced brittle FFmpeg/pacat subprocesses with native Node.js addons (`naudiodon` and `libopus-node`). This provides a robust, cross-platform, low-latency audio pipeline operating strictly at 48kHz with precise 20ms Opus frame chunking.

> [2026-04-10 09:45 UTC] Finalized the audio subsystem build pipeline. Implemented a dynamic import bypass to prevent bundler interference with native modules, configured Electron's `asarUnpack` for `.node` and `.wasm` files, and forked `naudiodon` to resolve GCC 15 compilation errors and remove legacy dependencies. `naudiodon` is now a strict dependency.

> [2026-04-11 00:00 UTC] Fixed remote browser audio: resolved stale `activeMicClientId` server state by switching from transient `socket.id` to a persistent `clientId` (localStorage UUID via `socket.handshake.auth`). Added `getUserMedia` try/catch fallback to default device when a stored `deviceId` is unavailable, preventing silent capture failure after device changes.

> [2026-04-11 00:00 UTC] Phone UI iteration: redesigned VFO box with collapsible header showing frequency/mode summary and inline `[◁ step]` / `[step ▷]` tuning buttons. Expanded view uses left/right arrows (matching collapsed) and horizontal step chips. Slimmed the phone header to show "RIGCONTROL WEB" with a status dot. Consolidated Quick Controls, RF Power, and More Controls into a single collapsed-by-default box. PTT moved outside as an always-visible standalone button. Fixed white browser background globally via `html, body { background-color: #0a0a0a }` in `index.css`.

> [2026-04-14 00:00 UTC] Replaced FFmpeg-based MJPEG video streaming with a fully browser-native WebCodecs H.264 pipeline. The Electron app captures via `getUserMedia` + `MediaStreamTrackProcessor` and encodes with `VideoEncoder` (avc1.42001F / OpenH264 Baseline Profile). Encoded AVCC chunks relay through Socket.io to remote clients which decode with `VideoDecoder` and render to `<canvas>`. AVCC SPS/PPS description is extracted from `EncodedVideoChunkMetadata` and attached to every keyframe so late-joining clients can configure their decoder on arrival. Video device list now carries `{ id, label }` pairs to correctly separate browser `deviceId` from human-readable label, preventing `OverconstrainedError`. FFmpeg is no longer a dependency.

> [2026-04-14 00:00 UTC] UI polish pass on compact and phone views. Compact VFO header refactored from `justify-between` flex to a `grid-cols-3` layout: tune arrows now sit centered between the VFO/SPLIT buttons and Mode/BW selects; Mode/BW dropdowns right-justified. Phone collapsed VFO header gains a `—` separator between the VFO letter and frequency to match the existing MHz/mode separator. Version bumped to `04.14.2026-Alpha3`.

> [2026-04-16 00:00 UTC] Introduced tab-based General Settings modal (RIGCTLD / SPOTS tabs). Built full POTA Spots integration: browser-side polling of `api.pota.app/spot/`, per-activator deduplication, UTC time fix (`+ 'Z'`), age/mode/band filtering, 3-state sortable table, and click-to-tune (SSB resolves USB/LSB by 10 MHz boundary). Layout-aware: phone view shows inline box below Quick Controls with a fixed scroll pill; compact view uses a slide-in right drawer toggled from the app header; desktop view shows inline box below Video & Audio. All POTA settings persisted to `settings.json`.

> [2026-04-20 00:00 UTC] Added VFO capability probe: `probeVfoCapability()` runs once after TCP connect (standard mode, not extended) and sets `vfoSupported` before polling begins. `rig-connected` payload now includes `{ vfoSupported }` so the client can disable VFO B, Split, and Select VFO B controls immediately. `resetRigState()` clears the flag on disconnect. Fixed extended-mode command handling to resolve/reject on any `RPRT` code rather than only `RPRT 0`/`1` — prevents mode-incompatible commands (e.g. NB in FM on FT-891) from timing out and destroying the socket. Added `[RIG]`-prefixed verbose and error logging to `executeRigCommand` so timeouts and failures identify the exact command in the console output.

> [2026-04-20 00:00 UTC] Switched server transport from plain HTTP to HTTPS. `loadOrGenerateCert()` auto-generates an EC P-256 self-signed certificate via `selfsigned` on first launch, saving key/cert PEM files to `dataDir`. Certificate is reused if valid for 30+ days and all current LAN IPs are covered by the SAN; otherwise it regenerates. This satisfies the secure-context requirement for `getUserMedia` and `setSinkId` on LAN browsers without needing a reverse proxy. Server startup log now reads `https://localhost:3000`.

> **Next Step**: Implement debounce on resolution text inputs to prevent mid-edit pipeline restarts.
