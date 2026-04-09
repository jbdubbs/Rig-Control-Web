# Audio Subsystem Implementation Tracker

## Step 1: Cleanup Old Audio Subsystem
- [x] Remove old `ffmpeg`, `pacat`, `arecord`, `aplay` spawn logic from `server.ts`.
- [x] Remove old `playInboundAudio` ulaw decoding logic from `App.tsx`.
- [x] Remove old `outboundAudioProcess` and `inboundAudioProcess` variables and logic.

## Step 2: Setup New Dependencies
- [x] Install `libopus-node`.
- [x] Add `naudiodon` to `optionalDependencies` (to avoid build failures in environments without native build tools, while allowing it to work on the user's machine).

## Step 3: Server-Side Implementation (`server.ts`)
- [x] Implement dynamic imports for `libopus-node` and `naudiodon`.
- [x] Implement `listAudioDevices` using `naudiodon.getDevices()`.
- [x] Implement `startAudio` using `naudiodon.AudioIO` for capture and playback.
- [x] Implement PCM ring buffer for chunking `naudiodon` output into exact 960-sample (20ms) frames for Opus encoding.
- [x] Implement Opus encoding (48kHz) using `libopus-node`.
- [x] Implement WebSocket broadcasting of raw Opus frames to clients.
- [x] Implement Opus decoding (48kHz) for incoming client audio.
- [x] Implement PTT state management (rejecting client audio unless PTT is engaged, muting server output when PTT is engaged).

## Step 4: Client-Side Implementation (`App.tsx` & `AudioWorklet`)
- [x] Create `audio-processor.js` (AudioWorkletProcessor) for PCM playback and capture.
- [x] Implement `WebCodecs` `AudioDecoder` to decode incoming Opus frames and send PCM to the Worklet.
- [x] Implement `WebCodecs` `AudioEncoder` to encode captured PCM from the Worklet into Opus frames.
- [x] Implement `getUserMedia` for microphone access.
- [x] Implement WebSocket transmission of encoded Opus frames.
- [x] Implement PTT button logic (momentary on phone, toggle on desktop).
- [x] Implement UI state locking (LOADING, READY, FAILED).

## Step 5: Final Review
- [x] Update `DEV_NOTES.md`.
