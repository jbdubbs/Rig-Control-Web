import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('resize-window', { width, height });
  },
  // UI scale (issue #123). webFrame is available in the sandboxed preload, so
  // no main-process IPC is needed; the zoom resets per navigation and the
  // renderer re-applies its stored scale on mount.
  setZoomFactor: (factor: number) => {
    if (Number.isFinite(factor) && factor > 0) webFrame.setZoomFactor(factor);
  },
  getZoomFactor: () => webFrame.getZoomFactor(),
  isElectron: true,
  onOutboundAudio: (callback: (data: Uint8Array) => void) => {
    ipcRenderer.on('outbound-audio-data', (_event, data: Buffer) => {
      callback(new Uint8Array(data));
    });
  },
  saveTextFile: (content: string, defaultFilename: string) => {
    return ipcRenderer.invoke('save-text-file', { content, defaultFilename });
  }
});
