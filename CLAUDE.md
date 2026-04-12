# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Global Rules

- Always search for best practices from the latest online research. Don't invent or assume, and don't be a pleaser. Be honest and factual.
- Look at the whole plan from top to bottom. Leave no stone unturned.
- Ask clarifying questions if you aren't 100% sure how to do something. Do not make assumptions.

## Project Overview

RigControl Web is a full-stack web + Electron desktop application for controlling amateur radio equipment via Hamlib's `rigctld`. It provides a real-time dashboard with frequency/mode/meter display, bidirectional audio (Opus codec), MJPEG video streaming, and process management for `rigctld`.

## Commands

```bash
# Development
npm run dev              # Start Express + Socket.io backend (tsx server.ts)
npm run build            # Build Vite frontend to dist/
npm run lint             # TypeScript type-check (tsc --noEmit)
npm run test             # Run Vitest tests
npm run clean            # Remove dist/, dist-electron/, build/

# Electron
npm run electron:dev     # Run as Electron desktop app in dev mode
npm run build:electron   # Bundle electron/main.ts and electron/preload.ts via esbuild
npm run electron:build   # Full Electron production build (frontend + electron + package)
```

There is no hot-reload for `server.ts` — restart manually after backend changes.

## Architecture

### Process Model

```
Browser / Electron Renderer
      ↕ Socket.io (real-time, bidirectional)
Express + Socket.io Server  (server.ts)
      ↕ TCP socket          ↕ child_process.spawn   ↕ naudiodon (native)
   rigctld (Hamlib)         FFmpeg (video)          libopus-node (audio codec)
      ↕ Serial/USB
   Radio Hardware
```

### Key Files

- **`server.ts`** — Monolithic backend (~1850 lines). Manages all Socket.io events, rigctld TCP connection, FFmpeg video streaming, and native audio I/O. This is the primary file for backend changes.
- **`src/App.tsx`** — Monolithic React frontend (~8000+ lines). Manages all UI state, Socket.io client, WebCodecs audio encoding, and MediaDevices.
- **`electron/main.ts`** — Electron main process; spawns the Express server and manages the BrowserWindow.
- **`electron/preload.ts`** — Exposes a minimal IPC bridge (`electron.resizeWindow()`) to the renderer via contextBridge.
- **`radios.json`** — Bundled read-only Hamlib radio model database.
- **`settings.json`** — Auto-created user settings (gitignored in production). In Electron production, falls back to `/tmp/settings.json`.

### Socket.io Communication Patterns

All real-time state flows through Socket.io. Key event categories:

**Client → Server (commands):**
- Rig control: `connect-rig`, `set-frequency`, `set-mode`, `set-ptt`, `set-func`, `set-level`, `set-split-vfo`, `vfo-op`, `send-raw`
- Process control: `start-rigctld`, `stop-rigctld`, `kill-existing-rigctld`, `test-rigctld`
- Settings: `save-settings`, `toggle-auto-start`, `get-settings`
- Video: `control-video`, `update-video-settings`, `get-video-devices`
- Audio: `control-audio`, `update-audio-settings`, `audio-outbound`, `get-audio-devices`

**Server → Client (state):**
- `rig-status` — Polled every 2s: frequency, mode, PTT, VFO state, meters
- `rigctld-status`, `rigctld-log` — Process health and buffered log (last 100 lines)
- `audio-inbound` — PCM/Opus packets from radio to browser
- `settings-data` — Full settings object on connect or change

### Audio Pipeline

- **Outbound (browser → radio):** Browser `getUserMedia` → `AudioWorklet` → 48kHz mono PCM frames (960 samples/20ms) → `libopus-node` encoder on server → `naudiodon` playback
- **Inbound (radio → browser):** `naudiodon` capture → `libopus-node` encoder → Socket.io `audio-inbound` → Browser WebCodecs decoder → AudioWorklet playback
- Multi-client mic uses "last-interacted-wins" policy tracked via `activeAudioClientId` on the server.
- `naudiodon` is a forked dependency (`github:jbdubbs/naudiodon-gcc15`) patched for GCC 15 compatibility.

### Native Modules

Native `.node` addons (`naudiodon`) and `.wasm` files (`libopus-node`) must be excluded from bundling. In Electron builds, they are ASAR-unpacked via `asarUnpack` in `package.json`. In server code, they are loaded via dynamic `import()` to bypass esbuild.

### Video Streaming

FFmpeg subprocess pipes MJPEG frames to stdout, served via `/api/video-stream`. Session management uses a `sessionId` query parameter with "last-one-wins" per window to prevent resource exhaustion.

### Settings Persistence

`settings.json` is read/written by the server. Fields include: `rigNumber`, `serialPort`, `baudRate`, `rigctldAutoStart`, `pollRate`, video settings, audio device settings. The `radios.json` file is read-only and should not be modified.

### Electron IPC

- `nodeIntegration: false`, `contextIsolation: true` — renderer has no direct Node access
- Preload exposes only `window.electron.resizeWindow(width, height)`
- Media permissions (camera/microphone) granted via `setPermissionRequestHandler`

## Known Issues / Tech Debt

- `rigctld` binary is assumed to be in system PATH (or `bin/[platform]/rigctld` in Electron builds)
- Split VFO support depends on the specific radio model configured in `rigctld`
- Port conflict: if `rigctld` is already running on the same port externally, the spawned process will fail (error shown in log view)
- `server.ts` and `App.tsx` are intentionally large monoliths — the architecture notes in `DEV_NOTES.md` describe planned modular refactoring
