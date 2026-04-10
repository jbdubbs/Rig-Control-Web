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
- [x] Increment app version to 04.05.2026-Alpha2.
- [x] Implement Opus audio decoding for inbound audio (rig -> client).
- [x] Implement Opus audio encoding for outbound audio (client -> rig).
- [x] Add server-side FFmpeg-based Opus encoding/decoding.
- [x] Implement client-side local audio device selection (input/output).
- [x] Fix "white screen" crash in non-secure browser contexts.
- [x] Implement "last-interacted-wins" policy for multi-client microphone recording.
- [x] Optimize audio latency (16kHz, AudioWorklet, jitter buffering, Socket.io tuning).
- [ ] Verify `rigctld` binary availability in the production environment.

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

## Known Issues / Tech Debt
- `rigctld` path is assumed to be in the system PATH.
- If `rigctld` is already running outside the app on the same port, the spawned process will fail with an error, which we now catch and display in the log view.
- Split VFO support depends on the specific radio model configured in `rigctld`.

## Architecture Notes
- **Modular Backend**: Extracted logic into `RigctldManager`, `VideoStreamManager`, and `SettingsManager` to separate concerns and allow for easier testing.
- **Componentized Frontend**: Moved UI logic into smaller components (`VFOControl`, `MeterDisplay`, etc.) and used a `RigContext` to manage shared state.
- **Server-as-Manager**: The Express server is not just a proxy but a process manager for `rigctld`.
- **Event-Driven**: All radio state changes flow through Socket.io to ensure low latency.
- **Graceful Shutdown**: The server listens for `SIGINT`/`SIGTERM` to kill the `rigctld` child process, preventing orphaned processes.
- **Log Buffering**: The server keeps the last 100 lines of `rigctld` output in memory to provide context to newly connected clients.
- **Split VFO State**: Managed as a boolean in the rig status, triggering specific UI color overrides.
- **Multi-Window Awareness**: The backend now avoids resetting the rig connection if a new client connects to the same host/port, ensuring stability across multiple tabs.
- **Video Session Management**: Uses a `sessionId` query parameter to enforce a "last-one-wins" policy per window, preventing resource exhaustion from multiple concurrent streams.
- **Client Audio Routing**: Uses `getUserMedia` with specific `deviceId` for input and `setSinkId` for output, allowing full control over local audio hardware.
- **Native Audio Backend**: Uses `naudiodon` for direct access to host audio devices (ALSA/Pulse/CoreAudio/WASAPI) without spawning external processes, improving reliability and latency.
- **Multi-Client Mic Policy**: Server tracks `activeAudioClientId` based on client interaction events, enforcing a single-source audio stream to the backend.
- **Low-Latency Audio Pipeline**: Uses 48kHz mono Opus encoding via `libopus-node` and WebCodecs, with `AudioWorklet` for capture/playback and a PCM ring buffer for precise frame slicing.

## Breadcrumbs
> [2026-04-02 13:00 UTC] Refactored the core codebase into modular files and components. This significantly reduces the size of `server.ts` and `App.tsx`, making the project easier to maintain and test.

> [2026-04-02 19:00 UTC] Implemented local audio device selection and fixed browser stability issues. The app now handles missing `mediaDevices` gracefully and allows users to choose their local hardware for bi-directional audio.

> [2026-04-02 19:20 UTC] Added "last-interacted-wins" policy for microphone recording. This prevents multiple windows from sending audio simultaneously, ensuring only the active window's mic is routed to the server.

> [2026-04-02 19:40 UTC] Optimized audio latency across the entire stack. Switched to 16kHz sample rate, implemented `AudioWorklet` for mic capture, added jitter buffering for playback, and disabled Socket.io compression to achieve near real-time performance.

> [2026-04-05 18:10 UTC] Implemented Opus audio codec for bi-directional communication. The server now uses FFmpeg to encode/decode Opus, and the client uses the WebCodecs API for low-latency, high-quality audio at 16kbps. This significantly improves performance on bandwidth-constrained connections.

> [2026-04-09 15:30 UTC] Completely redesigned the backend audio subsystem. Replaced brittle FFmpeg/pacat subprocesses with native Node.js addons (`naudiodon` and `libopus-node`). This provides a robust, cross-platform, low-latency audio pipeline operating strictly at 48kHz with precise 20ms Opus frame chunking.

> [2026-04-10 09:45 UTC] Finalized the audio subsystem build pipeline. Implemented a dynamic import bypass to prevent bundler interference with native modules, configured Electron's `asarUnpack` for `.node` and `.wasm` files, and forked `naudiodon` to resolve GCC 15 compilation errors and remove legacy dependencies. `naudiodon` is now a strict dependency.

> **Next Step**: Implement the test-driven development framework and write unit tests for the new modules and components.
