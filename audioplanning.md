# Audio Subsystem Rebuild Plan

## 1. Goals and Scope
*   **Objective:** Completely rewrite the audio subsystem from scratch, removing all legacy FFmpeg/pacat/aplay subprocesses and previous audio routing logic.
*   **Technology Stack:**
    *   **Server:** Node.js, `libopus-node` (Opus 1.5.2 encoding/decoding).
    *   **Client:** Web Audio API, WebCodecs API (`AudioEncoder` / `AudioDecoder`).
    *   **Transport:** WebSockets (Raw Opus frames, no container like Ogg/WebM required).
*   **Audio Specs:** 1 Channel (Mono), 16000 Hz or 48000 Hz Sample Rate (TBD based on hardware constraints), 20ms frames. Opus configured for VoIP/Speech.
*   **Duplex Mode:** Half-duplex, strictly controlled by the PTT (Push-To-Talk) state.

## 2. UI & Interactions
*   **Video & Audio Settings:** Reuse existing modal. Retain Backend Input/Output and Local Input/Output device selections.
*   **Audio Subsystem Status & UI Locking:**
    *   **State: LOADING:** "AUDIO STATUS: Loading Audio Engine...". All audio-related dropdowns, Start/Stop buttons, Mute, and PTT buttons are disabled.
    *   **State: READY:** "AUDIO STATUS: Ready". All UI elements are enabled.
    *   **State: FAILED:** "AUDIO STATUS: Unavailable (Engine Failed to Load)". All audio UI elements remain disabled permanently for that session.
*   **Start/Stop Audio:** Reuse existing buttons to mount/unmount the new WebCodecs/WebSocket pipeline.
*   **Mute Buttons:** Reuse existing speaker and mic mute buttons. These will only mute the audio locally (e.g., via GainNode or dropping frames) and will *not* affect PTT state or take control of the feed.
*   **PTT Button:**
    *   **Phone View:** Momentary press (Push and hold to talk, release to stop).
    *   **Compact/Desktop Views:** Maintained press (Toggle on/off).
    *   **Behavior:** Engaging PTT grants the user the exclusive audio path from their client mic to the server speaker output.

## 3. Architecture Overview

### State A: RX Mode (PTT Disengaged - Default)
1.  **Server:** Captures raw PCM from the Backend Input device.
2.  **Server:** Encodes PCM to Opus (48kHz, Mono, 20ms) using `libopus-node`.
3.  **Server:** Broadcasts raw Opus frames via WebSocket to all connected clients.
4.  **Client:** Receives raw Opus frames.
5.  **Client:** Decodes using WebCodecs `AudioDecoder`.
6.  **Client:** Renders PCM audio via Web Audio API to the selected Local Output device.
7.  **Muted paths:** Client microphone capture is ignored. Server output to the rig is silent.

### State B: TX Mode (PTT Engaged)
1.  **Client (Active):** Captures mic via `getUserMedia`.
2.  **Client (Active):** Encodes to Opus (48kHz, Mono, 20ms) using WebCodecs `AudioEncoder`.
3.  **Client (Active):** Sends raw Opus frames via WebSocket to the server.
4.  **Server:** Receives raw Opus frames from the active client (rejects others).
5.  **Server:** Decodes using `libopus-node`.
6.  **Server:** Writes raw PCM to the Backend Output device.
7.  **Muted paths:** Server capture from the rig is ignored (prevents echo).

## 4. Architectural Decisions & Implementation Details

### A. Backend Audio I/O: `naudiodon`
*   **Decision:** Use `naudiodon` (Node.js wrapper for PortAudio) for native PCM audio capture and playback.
*   **Rationale:** Eliminates subprocess overhead and provides direct memory access to PCM buffers required by `libopus-node`.
*   **Deployment Constraint:** Native addons (`.node` files) are architecture and OS-specific. Cross-compiling for Windows/macOS from a Linux host requires specific toolchains (e.g., Wine, MinGW, or macOS cross-compilers) via Electron builder tools.

### B. Module Loading: Dynamic Imports
*   **Decision:** Load the pure ESM `libopus-node` package using dynamic `await import()` during the server startup sequence.
*   **Precautions & Initialization:**
    *   The audio subsystem will maintain a global `isAudioEngineReady` boolean and an initialization Promise.
    *   Any client requests to start audio will be rejected or queued until the initialization Promise resolves.
    *   **Logging:** Extremely verbose logging will be implemented at every stage:
        *   `[AUDIO-INIT] Attempting to load libopus-node...`
        *   `[AUDIO-INIT] libopus-node loaded successfully.`
        *   `[AUDIO-INIT] Failed to load libopus-node: <error>`
        *   State changes (PTT engaged/disengaged, stream started/stopped) will be logged.
        *   Frame-level errors (e.g., encoder/decoder buffer underflows) will be logged (potentially throttled to avoid console flooding).

### C. Client Playback & Capture: WebCodecs + `AudioWorklet`
*   **Decision:** Use `AudioWorklet` for BOTH playback and capture.
*   **Rationale for Playback:** `MediaStreamTrackGenerator` is not supported in Safari/WebKit. `AudioWorklet` is universally supported across all modern browsers.
*   **Rationale for Capture (CRITICAL):** Safari does *not* support `MediaStreamTrackProcessor`. We cannot easily pipe `getUserMedia` directly to `AudioEncoder` using modern streams. We MUST use an `AudioWorkletNode` to capture the microphone PCM data, send it to the main thread via `postMessage`, manually construct `AudioData` objects, and feed them to the `AudioEncoder`.
*   **Permissions Required:**
    *   **Microphone:** `navigator.mediaDevices.getUserMedia({ audio: true })`. Must handle "Permission Denied" gracefully.
    *   **Output Device Selection:** Requires microphone permission to be granted first in some browsers to expose full device labels via `enumerateDevices()`.
*   **Safari/Mobile Considerations:**
    *   **Autoplay Policy:** Safari strictly requires the `AudioContext` to be created or resumed inside a synchronous user interaction event (e.g., the "Start Audio" button click).
    *   **Sample Rate:** iOS Safari can be rigid about hardware sample rates. We will explicitly request our target sample rate when creating the `AudioContext`.

### D. Opus Configuration & PCM Chunking (CRITICAL)
*   **Sample Rate:** We will configure the Opus encoders/decoders strictly for **48000 Hz**.
    *   *Why:* The WebCodecs specification for Opus states that if the `description` (extradata/OpusHead) is omitted, the decoder assumes 48kHz. By sticking to Opus's native 48kHz, we avoid having to manually construct and transmit a 19-byte OpusHead buffer over WebSockets. The Web Audio API will handle resampling to/from the hardware rate automatically.
*   **Node.js PCM Chunking:** `naudiodon` outputs arbitrary-sized PCM buffers. `libopus-node` requires *exact* frame sizes (e.g., 20ms = 960 samples at 48kHz). We MUST implement a PCM ring buffer in Node.js to accumulate `naudiodon` output and slice it into exact 960-sample 16-bit PCM (`Int16Array`) chunks before encoding. Failure to do this will cause the Opus encoder to crash or output garbage.

### E. Secure Context & HTTPS Strategy
*   **Requirement:** `getUserMedia` and `AudioWorklet` **strictly require a Secure Context**. They will instantly fail on `http://` unless accessed via `http://localhost`.
*   **Decision:** Do NOT implement a built-in HTTPS server (Node.js `https` module) with self-signed certificates.
*   **Rationale:** Self-signed certificates cause severe browser warnings ("Your connection is not private"), block WebSocket connections (`wss://`) silently in some browsers, and create a poor user experience.
*   **Implementation:** The application will run on standard HTTP. For remote access, the user is responsible for deploying a reverse proxy (e.g., Caddy, Nginx, or Cloudflare Tunnels) to handle SSL/TLS termination. This is the industry standard for Node.js web applications.
