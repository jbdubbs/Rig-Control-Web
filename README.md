# RigControl Web

A modern, full-stack web application and desktop client designed to control amateur radio equipment via Hamlib's `rigctld`. It features a real-time dashboard with frequency, mode, and meter displays, and can automatically manage a local `rigctld` process.

## Features

- **Real-time Dashboard**: Frequency, mode, and meter displays (S-Meter, SWR, ALC, Power, VDD).
- **Process Management**: Automatically start and stop `rigctld` from the web interface.
- **Settings Persistence**: Remembers your radio configuration and auto-start preferences.
- **Log View**: Real-time output from the underlying `rigctld` process for easy debugging.
- **Split VFO Support**: Full control over split operations with visual feedback.
- **Desktop App**: Can be built as a native application for Windows, Linux, and macOS.

## Prerequisites

- **Node.js**: Version 18 or higher.
- **Hamlib**: `rigctld` must be installed on your system and available in the system PATH.
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
Once installed, simply launch "RigControl Web" from your applications menu or desktop shortcut. The application will automatically:
1. Start the background Express server.
2. If "Auto Start Rigctld" was previously enabled, it will launch the `rigctld` process.
3. Open the main control interface in a native window.

## Configuration

Access the **Settings** (gear icon) in the application to configure:
- **Rig Number**: The Hamlib model ID for your radio.
- **Serial Port**: The device path (e.g., `/dev/ttyUSB0` or `COM3`).
- **Baud Rate**: The serial speed for your radio.
- **Network Settings**: The host and port for the `rigctld` server.
- **Auto Start**: Enable this to have the app manage the `rigctld` process for you.

## License

MIT
