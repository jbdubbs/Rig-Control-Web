import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
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

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(windowStatePath)) {
      return JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load window state:', e);
  }
  return null;
}

function saveWindowState(state: any) {
  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save window state:', e);
  }
}

async function createWindow() {
  const savedState = loadWindowState();
  
  // Smallest compact view window size: 768x600
  const defaultWidth = 768;
  const defaultHeight = 600;

  const win = new BrowserWindow({
    width: savedState?.width || defaultWidth,
    height: savedState?.height || defaultHeight,
    x: savedState?.x,
    y: savedState?.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev 
        ? path.join(process.cwd(), 'dist-electron/preload.cjs')
        : path.join(app.getAppPath(), 'dist-electron/preload.cjs')
    },
    title: "RigControl Web",
    autoHideMenuBar: true,
  });

  // Start the backend server with the correct app path for static files
  const appPath = isDev ? process.cwd() : app.getAppPath();
  const userDataPath = isDev ? process.cwd() : app.getPath('userData');
  await startServer(appPath, userDataPath, win);

  ipcMain.on('resize-window', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      // Use setContentSize to ensure the content fits exactly
      // We only want to resize if the new size is different
      const [currentWidth, currentHeight] = win.getContentSize();
      if (currentWidth !== width || currentHeight !== height) {
        win.setContentSize(Math.round(width), Math.round(height), true);
        
        // Save the new size
        const [w, h] = win.getSize();
        const [x, y] = win.getPosition();
        saveWindowState({ width: w, height: h, x, y });
      }
    }
  });

  win.on('resize', () => {
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    saveWindowState({ width, height, x, y });
  });

  win.on('move', () => {
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    saveWindowState({ width, height, x, y });
  });

  win.on('close', () => {
    const [width, height] = win.getSize();
    const [x, y] = win.getPosition();
    saveWindowState({ width, height, x, y });
  });

  // Clear cache to ensure the latest version is loaded
  await win.webContents.session.clearCache();
  console.log("Electron cache cleared.");

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
