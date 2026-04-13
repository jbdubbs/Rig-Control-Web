# RigControl Web

A modern, full-stack web application and native desktop client for controlling amateur radio equipment via Hamlib's `rigctld`. Features a real-time dashboard with frequency, mode, and meter displays, full bidirectional audio over Opus, MJPEG video streaming, and automatic `rigctld` process management.

## Screenshots

### Compact View (Desktop)
![RigControl Web — Compact View](assets/RigControlWeb-Compact.png)

### Phone View (Mobile)
![RigControl Web — Phone View](assets/RigControlWeb-Phone.png)

## Features

- **Real-time Dashboard**: Frequency, mode, and meter displays (S-Meter, SWR, ALC, Power, VDD) polled live from the rig.
- **Bidirectional Audio**: Full transmit and receive audio over the network using the Opus codec. Works for remote SSB, AM, and FM contacts. Powered by native `naudiodon` I/O and `libopus-node`.
  - Jitter buffer for smooth inbound playback.
  - Multi-client support with last-interacted-wins mic policy.
  - Audio device lists refresh automatically when you open the device selector, so newly connected USB devices always appear.
- **Phone View**: Dedicated portrait-optimized layout for operating from a phone or tablet.
- **Compact View**: Condensed desktop layout that fits on smaller screens.
- **Rig Video Feed**: Display a system video capture device (e.g. HDMI capture card or webcam) so you can see your radio's front panel. Example: FT-710 DVI out → USB HDMI capture card.
- **Process Management**: Start, stop, and monitor `rigctld` directly from the web interface. View the live log and kill stale instances.
- **Split VFO Support**: Full control over split operations with visual feedback.
- **Works With All Hamlib-Compatible Software**: Configure your logging app to use "Hamlib NET rigctl" at `127.0.0.1:4532`.
  - WSJT-X, WSJT-X Improved, FLDigi, VarAC, JS8Call, and more.
- **Remote Access**: Access your shack from anywhere over your own VPN by pointing a browser to your rig computer's IP on port 3000.
- **Desktop App**: Native installers for Windows and Linux via Electron. Graceful shutdown ensures audio hardware is released cleanly on exit.

## TODO

- **Remote CW**: CW keying from a phone, tablet, or laptop while away from home.
- **macOS Support**: Currently untested — requires externally installed Hamlib 4.7.0 and FFmpeg in the system PATH.
- **Broader Rig Testing**: Currently well-tested on FT-710, FT-991A, DX10, FT-101D, and FT-101MP. Other Hamlib-supported rigs should work.

## Prerequisites

### Common
- **Operating Systems**:
  - **Windows 10 or higher** (tested on Windows 11 23H2) — no external dependencies.
  - **Linux kernel 6.0 or higher** (tested on Fedora 43) — no external dependencies.
  - **macOS** (TBA — no test hardware available)
    - Requires externally installed Hamlib 4.7.0 and latest FFmpeg, both in the system PATH.

### Compile from Source
- **Node.js**: Version 18 or higher.
- **FFmpeg**: Required for the video feed feature.
  - **Electron Apps**: Bundle `ffmpeg` by placing the binary in `bin/[linux|windows|mac]/`.
  - **Fallback**: If not bundled, the app falls back to the system PATH.
- **Hamlib**: 4.7.0 or higher.
  - **Electron Apps**: Bundle `rigctld` by placing the binary in `bin/[linux|windows|mac]/`.

### Installing Hamlib (if required)
- **Linux**: `sudo apt install libhamlib-utils`
- **macOS**: `brew install hamlib`
- **Windows**: Download and install from the [Hamlib website](https://hamlib.github.io/).

## Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the web server in development mode:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000) in your browser.

> Note: there is no hot-reload for the backend — restart `npm run dev` after any `server.ts` changes.

## Desktop App (Electron)

RigControl Web can be run as a native desktop application. The backend Express server runs silently in the background and the frontend is displayed in a native window. Audio hardware is released cleanly when the app exits.

### Run in Development
```bash
npm run electron:dev
```

### Build for Production

#### Windows (NSIS Installer)
```bash
npm run electron:build -- --win
```

#### Linux (AppImage)
```bash
npm run electron:build -- --linux
```

#### macOS (DMG Installer)
```bash
npm run electron:build -- --mac
```

Built installers are placed in the `build/` directory.

### Launching the Installed App
Once installed, launch "RigControl Web" from your applications menu or desktop shortcut. The application will:
1. Start the background Express server.
2. Open the UI — configure your rig settings and start `rigctld` from the Settings panel.

## Configuration

Open the **Settings** panel (gear icon) to configure:
- **Rig Number**: Hamlib model ID for your radio.
- **Serial Port**: Device path (e.g. `/dev/ttyUSB0` or `COM3`).
- **Baud Rate**: Serial speed for your radio.
- **Network Settings**: Host and port for the `rigctld` server.
- **Video Settings**: Capture device selection and stream quality.
- **Audio Settings**: Backend input/output device (server-side, for the radio), local input/output device (browser-side, for the operator), and enable/disable inbound and outbound audio independently.

## License

MIT
