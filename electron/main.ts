import { app, BrowserWindow } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';

// Disable hardware acceleration to resolve VA-API errors on Linux
app.disableHardwareAcceleration();

// Additional switches to ensure VA-API and GPU features are disabled
app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecoder');
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-rasterization');
app.commandLine.appendSwitch('disable-gpu');

if (!isDev) {
  process.env.NODE_ENV = 'production';
}
console.log(`Electron starting. isDev: ${isDev}, NODE_ENV: ${process.env.NODE_ENV}`);

import { startServer } from '../server.ts';

async function createWindow() {
  // Start the backend server with the correct app path for static files
  const appPath = isDev ? process.cwd() : app.getAppPath();
  const userDataPath = isDev ? process.cwd() : app.getPath('userData');
  await startServer(appPath, userDataPath);

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: "RigControl Web",
    autoHideMenuBar: true,
  });

  // Clear cache and storage to ensure the latest version is loaded
  await win.webContents.session.clearCache();
  await win.webContents.session.clearStorageData();
  console.log("Electron cache and storage cleared.");

  // Handle media permissions for video devices
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'media') return true;
    return false;
  });

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
    // win.webContents.openDevTools();
  } else {
    win.loadURL(`http://localhost:3000`);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
