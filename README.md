# RigControl Web

A modern, full-stack web application and desktop client designed to control amateur radio equipment via Hamlib's `rigctld`. It features a real-time dashboard with frequency, mode, and meter displays, and can automatically manage a local `rigctld` process.

## Features

- **Real-time Dashboard**: Frequency, mode, and meter displays (S-Meter, SWR, ALC, Power, VDD).
- **Process Management**: Automatically start and stop `rigctld` from the web interface.
- **Split VFO Support**: Full control over split operations with visual feedback.
- **Desktop App**: Can be built as a native application for Windows, Linux, and macOS.
- **Rig Video Feed**: Displays a system video capture device, like an HDMI capture card or a webcam, so you can see your radio's front screen.  Example: FT-710 DVI out > USB to HDMI capture card.
- **Mobile Rig Control**: Through your own VPN and installing the app or pointing your VPN'd browser to your rig computer IP on port 3000.
- **Works With All Hamlib Supported Apps**: Tell your app that your rig is a "Hamlib NET rigctl" with a local address of 127.0.0.1:4532.
  - WSJTX, WSJTX Improved, FLDigi, VarAC, JS8Call, etc...

## TODO
- **Audio In/Out**: Full audio in/out support for compatible rigs.  You can work remote SSB contacts!
- **Remote CW**: CW from your phone, tablet, or laptop while away from home.
- **Testing of All Popular Rigs**: Very limited testing, currently FT-710, 991A, DX10, 101D, 101MP should work fine.

## Prerequisites

### Common
- **Operating Systems**:
  - **Windows 10 or higher** (tested on Windows 11 23H2)
    - No external dependencies.
  - **Linux 6.0 kernel or higher** (tested on Fedora 43)
    - No external dependencies.
  - **MacOS TBA** (I don't have a Mac for testing...)
    - Requires externally installed Hamlib 4.7.0 and latest ffmpeg, both in the system PATH.

### Compile from Source
- **Node.js**: Version 18 or higher.
- **FFmpeg**: Required for the video feed feature.
  - **Electron Apps**: You can bundle `ffmpeg` by placing the binary in the `bin/[linux|windows|mac]/` folder.
  - **Fallback**: If not bundled, the app will fall back to the system PATH.
- **Hamlib**: 4.7.0 or higher.
  - **Electron Apps**: You can bundle `rigctld (Hamlib)` by placing the binary in the `bin/[linux|windows|mac]/` folder.

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

## Desktop App (Electron)

RigControl Web can be run as a native desktop application. In this mode, the backend server runs silently in the background, and the frontend is displayed in a native window.

### Run in Development
To launch the Electron app in development mode:
```bash
npm run electron:dev
```

### Build for Production
You can create installers for your specific platform using the following commands:

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

The built installers will be located in the `build/` directory.

### Launching the Installed App
Once installed, simply launch "RigControl Web" from your applications menu or desktop shortcut. The application will:
1. Start the background Express server.
2. Launch the `rigctld` process from the settings menu after entering all required settings.

## Configuration

Access the **Settings** (gear icon) in the application to configure:
- **Rig Number**: The Hamlib model ID for your radio.
- **Serial Port**: The device path (e.g., `/dev/ttyUSB0` or `COM3`).
- **Baud Rate**: The serial speed for your radio.
- **Network Settings**: The host and port for the `rigctld` server.

## License

MIT
