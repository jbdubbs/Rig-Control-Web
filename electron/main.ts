import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      preload: isDev 
        ? path.join(process.cwd(), 'dist-electron/preload.cjs')
        : path.join(__dirname, 'preload.cjs')
    },
    title: "RigControl Web",
    autoHideMenuBar: true,
  });

  ipcMain.on('resize-window', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      // Use setContentSize to ensure the content fits exactly
      // We only want to resize if the new size is different
      const [currentWidth, currentHeight] = win.getContentSize();
      if (currentWidth !== width || currentHeight !== height) {
        win.setContentSize(Math.round(width), Math.round(height), true);
      }
    }
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
