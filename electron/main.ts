import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import isDev from 'electron-is-dev';

app.setName('RigControl Web');

if (!isDev) {
  process.env.NODE_ENV = 'production';
}
console.log(`Electron starting. isDev: ${isDev}, NODE_ENV: ${process.env.NODE_ENV}`);

import { startServer, setElectronWindow, shutdown } from '../server.ts';

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

function installDesktopIntegration(): void {
  const appImagePath = process.env.APPIMAGE;
  const appDir = process.env.APPDIR;

  if (!appImagePath || !appDir) {
    console.error('Error: --install can only be used when running as an AppImage.');
    process.exit(1);
  }

  const home = os.homedir();
  const hicolorDir = path.join(home, '.local', 'share', 'icons', 'hicolor');
  const iconDir = path.join(hicolorDir, '512x512', 'apps');
  const desktopDir = path.join(home, '.local', 'share', 'applications');
  const iconDest = path.join(iconDir, 'rigcontrol-web.png');
  const desktopDest = path.join(desktopDir, 'rigcontrol-web.desktop');

  fs.mkdirSync(iconDir, { recursive: true });
  fs.mkdirSync(desktopDir, { recursive: true });

  const iconSrc = path.join(appDir, 'resources', 'app.asar', 'assets', 'icons', 'rcw_512x512.png');
  fs.writeFileSync(iconDest, fs.readFileSync(iconSrc));

  const desktop = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RigControl Web',
    'Comment=Amateur radio rig control via Hamlib rigctld',
    `Exec=${appImagePath} %U`,
    'Icon=rigcontrol-web',
    'StartupWMClass=RigControl Web',
    'Categories=HamRadio;Utility;',
    'Terminal=false',
  ].join('\n') + '\n';

  fs.writeFileSync(desktopDest, desktop);

  try { execSync(`update-desktop-database "${desktopDir}"`); } catch {}
  try { execSync(`gtk-update-icon-cache -f -t "${hicolorDir}"`); } catch {}

  console.log('RigControl Web has been integrated into your desktop.');
  console.log(`  Icon:    ${iconDest}`);
  console.log(`  Desktop: ${desktopDest}`);
  console.log('You can now launch it from your application menu.');
}

function uninstallDesktopIntegration(): void {
  const home = os.homedir();
  const hicolorDir = path.join(home, '.local', 'share', 'icons', 'hicolor');
  const iconDest = path.join(hicolorDir, '512x512', 'apps', 'rigcontrol-web.png');
  const desktopDest = path.join(home, '.local', 'share', 'applications', 'rigcontrol-web.desktop');

  let removed = false;

  if (fs.existsSync(iconDest)) { fs.rmSync(iconDest); removed = true; }
  if (fs.existsSync(desktopDest)) { fs.rmSync(desktopDest); removed = true; }

  if (!removed) {
    console.log('RigControl Web does not appear to be integrated (nothing to remove).');
    return;
  }

  try { execSync(`update-desktop-database "${path.dirname(desktopDest)}"`); } catch {}
  try { execSync(`gtk-update-icon-cache -f -t "${hicolorDir}"`); } catch {}

  console.log('RigControl Web desktop integration has been removed.');
}

async function createWindow() {
  // Start the backend server with the correct app path for static files
  const appPath = isDev ? process.cwd() : app.getAppPath();
  const userDataPath = isDev ? process.cwd() : app.getPath('userData');
  await startServer(appPath, userDataPath);

  const savedState = loadWindowState();
  
  // Smallest compact view window size: 768x600
  const defaultWidth = 768;
  const defaultHeight = 600;

  const iconPath = isDev
    ? path.join(process.cwd(), 'assets/icons/rcw_512x512.png')
    : path.join(app.getAppPath(), 'assets/icons/rcw_512x512.png');

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
    icon: iconPath,
  });

  // Pass the window reference to the server for device enumeration
  setElectronWindow(win);

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

  // Trust the locally-generated self-signed certificate for localhost only
  win.webContents.session.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === 'localhost') {
      callback(0); // 0 = trust
    } else {
      callback(-3); // -3 = use default Chromium verification
    }
  });

  if (isDev) {
    win.loadURL('https://localhost:3000');
    // win.webContents.openDevTools();
  } else {
    win.loadURL('https://localhost:3000');
  }
}

if (process.argv.includes('--install')) {
  installDesktopIntegration();
  process.exit(0);
} else if (process.argv.includes('--uninstall')) {
  uninstallDesktopIntegration();
  process.exit(0);
} else {
  app.whenReady().then(createWindow);
}

let isShuttingDown = false;
app.on('will-quit', (event) => {
  if (isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;
  shutdown().then(() => app.quit()).catch(() => app.quit());
});

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
