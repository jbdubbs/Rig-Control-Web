import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import isDev from 'electron-is-dev';

app.setName('RigControl Web');
if (process.platform === 'linux' && typeof (app as any).setDesktopFileName === 'function') {
  (app as any).setDesktopFileName('rigcontrol-web.desktop');
}

if (!isDev) {
  process.env.NODE_ENV = 'production';
}
console.log(`Electron starting. isDev: ${isDev}, NODE_ENV: ${process.env.NODE_ENV}`);

import { startServer, setElectronWindow, shutdown } from '../server.ts';
import { vlogInfra as vlog } from '../server/vlog.ts';

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

// createWindow() can run more than once (macOS 'activate' after all windows
// close, since window-all-closed deliberately doesn't quit there) — these
// track what must only ever happen once.
let serverStarted = false;
let mainWindow: BrowserWindow | null = null;

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

function persistWindowState(win: BrowserWindow): void {
  const [width, height] = win.getSize();
  const [x, y] = win.getPosition();
  saveWindowState({ width, height, x, y });
}

function buildDesktopFile(appImagePath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RigControl Web',
    'Comment=Amateur radio rig control via Hamlib rigctld',
    `Exec="${appImagePath}" --class=rigcontrol-web %U`,
    'Icon=rigcontrol-web',
    'StartupWMClass=rigcontrol-web',
    'StartupNotify=false',
    'Categories=HamRadio;Utility;',
    'Terminal=false',
  ].join('\n') + '\n';
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
  fs.writeFileSync(desktopDest, buildDesktopFile(appImagePath));

  try { execSync(`update-desktop-database "${desktopDir}"`); } catch {}
  try { execSync(`gtk-update-icon-cache -f -t "${hicolorDir}"`); } catch {}

  console.log('RigControl Web has been integrated into your desktop.');
  console.log(`  Icon:    ${iconDest}`);
  console.log(`  Desktop: ${desktopDest}`);
  console.log('You can now launch it from your application menu.');
}

function autoInstallDesktopIntegration(): void {
  if (process.platform !== 'linux') return;
  const appImagePath = process.env.APPIMAGE;
  const appDir = process.env.APPDIR;
  if (!appImagePath || !appDir) return;

  const home = os.homedir();
  const desktopDest = path.join(home, '.local', 'share', 'applications', 'rigcontrol-web.desktop');
  if (fs.existsSync(desktopDest)) return;

  try {
    const hicolorDir = path.join(home, '.local', 'share', 'icons', 'hicolor');
    const iconDir = path.join(hicolorDir, '512x512', 'apps');
    const iconDest = path.join(iconDir, 'rigcontrol-web.png');

    fs.mkdirSync(iconDir, { recursive: true });
    fs.mkdirSync(path.dirname(desktopDest), { recursive: true });

    const iconSrc = path.join(appDir, 'resources', 'app.asar', 'assets', 'icons', 'rcw_512x512.png');
    fs.writeFileSync(iconDest, fs.readFileSync(iconSrc));
    fs.writeFileSync(desktopDest, buildDesktopFile(appImagePath));

    try { execSync(`update-desktop-database "${path.dirname(desktopDest)}"`); } catch {}
    try { execSync(`gtk-update-icon-cache -f -t "${hicolorDir}"`); } catch {}

    console.log('[desktop] Integration installed automatically.');
  } catch (err) {
    console.error('[desktop] Auto-install failed:', err);
  }
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
  // Start the backend server with the correct app path for static files.
  // Only the first call may do this — a later call (macOS 'activate') would
  // try to rebind the already-listening HTTPS port and fail with EADDRINUSE.
  const appPath = isDev ? process.cwd() : app.getAppPath();
  const userDataPath = isDev ? process.cwd() : app.getPath('userData');
  if (!serverStarted) {
    serverStarted = true;
    await startServer(appPath, userDataPath);
  }

  const savedState = loadWindowState();
  
  // Content must be ≥768px for compact layout; 800 covers Windows frame chrome
  const defaultWidth = 800;
  // Default compact layout content is ~826px; 875 covers Windows title bar + frame
  const defaultHeight = 875;

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

  // Open target="_blank" links in the system browser instead of Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Pass the window reference to the server for device enumeration
  setElectronWindow(win);
  mainWindow = win;

  ipcMain.on('resize-window', (event, { width, height }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      // Use setContentSize to ensure the content fits exactly
      // We only want to resize if the new size is different
      const [currentWidth, currentHeight] = win.getContentSize();
      if (currentWidth !== width || currentHeight !== height) {
        win.setContentSize(Math.round(width), Math.round(height), true);

        // Save the new size
        persistWindowState(win);
      }
    }
  });

  win.on('resize', () => persistWindowState(win));

  win.on('move', () => persistWindowState(win));

  win.on('close', () => persistWindowState(win));

  // Clear cache to ensure the latest version is loaded
  await win.webContents.session.clearCache();
  console.log("Electron cache cleared.");

  // Handle media permissions for video devices, and clipboard access for
  // the Diagnostics tab's Copy Log button (navigator.clipboard.writeText).
  const allowedPermissions = ['media', 'clipboard-sanitized-write', 'clipboard-read'];
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowedPermissions.includes(permission);
  });

  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.includes(permission));
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

// Registered once at module scope — ipcMain.handle throws if called twice
// for the same channel, which createWindow() used to do on macOS
// dock-icon relaunch (see createWindow()'s serverStarted guard above).
ipcMain.handle('save-text-file', async (event, { content, defaultFilename }: { content: string; defaultFilename: string }) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  const result = senderWin
    ? await dialog.showSaveDialog(senderWin, {
        defaultPath: defaultFilename,
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      })
    : await dialog.showSaveDialog({
        defaultPath: defaultFilename,
        filters: [{ name: 'Text Files', extensions: ['txt'] }],
      });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    console.error('Failed to save diagnostics log:', e);
    return { ok: false };
  }
});

if (process.argv.includes('--install')) {
  installDesktopIntegration();
  process.exit(0);
} else if (process.argv.includes('--uninstall')) {
  uninstallDesktopIntegration();
  process.exit(0);
} else {
  autoInstallDesktopIntegration();
  app.whenReady().then(createWindow);
}

let isShuttingDown = false;
app.on('will-quit', (event) => {
  if (isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;
  // Hard timeout: if shutdown hangs (e.g. naudiodon WASAPI deadlock on Windows),
  // force-exit after 5 s rather than leaving the process alive.
  const forceExit = setTimeout(() => {
    vlog("[ELECTRON] Force exit fired — shutdown did not complete in 5s");
    process.exit(0);
  }, 5000);
  const done = () => {
    vlog("[ELECTRON] Shutdown complete — calling app.exit(0)");
    clearTimeout(forceExit);
    app.exit(0);
  };
  shutdown().then(done).catch((err) => { console.error("[ELECTRON] Shutdown error:", err); done(); });
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
