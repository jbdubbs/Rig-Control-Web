# Audio Subsystem Fix Plan

## 1. PTT Audio Routing Enforcement
**Issue:** Currently, the client sends outbound audio (mic capture) continuously as long as the mic is unmuted (`outboundMutedRef.current === false`), and the server writes it to the rig's audio output device regardless of the PTT state. This violates the plan which states: "Muted paths: Client microphone capture is ignored. Server output to the rig is silent" when PTT is disengaged.
**Fix:** 
- In `App.tsx`, update the `captureNode.port.onmessage` handler to check `pttRef.current`. If PTT is not engaged, drop the audio frames to save bandwidth.
- In `server.ts`, update the `audio-outbound` socket listener to check `lastStatus.ptt`. If PTT is not engaged, drop the incoming audio frames to ensure the rig's soundcard receives silence.

## 2. Playback Jitter Buffer
**Issue:** The `PlaybackProcessor` in `audio-processor.js` uses a simple ring buffer that immediately plays audio as soon as it arrives. Over WebSockets, network jitter is inevitable. If a packet is slightly delayed, the buffer will underflow, padding with zeros and causing audible pops/clicks.
**Fix:** Implement a basic jitter buffer in `PlaybackProcessor`. It should buffer a small amount of audio (e.g., 40-60ms, which is 2-3 frames) before starting playback, and pause playback if the buffer runs completely dry until it fills up again.

## 3. Dynamic Local Output Device Switching
**Issue:** In `App.tsx`, the `setSinkId` method is only called inside `handleStartAudio`. If the user changes their "Local Client Audio (Your System)" output device while the audio is already playing, the change will not take effect until they manually stop and restart the audio stream.
**Fix:** Add a `useEffect` hook in `App.tsx` that listens for changes to `localAudioSettings.outputDevice`. If `audioContextRef.current` exists and `setSinkId` is supported, it should dynamically update the sink ID without requiring a stream restart.

## 4. Audio Engine Initialization Race Condition
**Issue:** In `server.ts`, `initAudioEngine()` is an asynchronous function. If a client connects before it finishes, the server emits `audio-engine-state` with `isReady: false`. When `initAudioEngine()` eventually completes, it updates the internal state but fails to broadcast the updated state to already-connected clients. This leaves the client UI permanently stuck in the "LOADING..." state, disabling all audio controls.
**Fix:** In `server.ts`, update `initAudioEngine()` to call `io.emit("audio-engine-state", { isReady: isAudioEngineReady, error: audioEngineError })` immediately after it finishes loading (whether successful or failed).
