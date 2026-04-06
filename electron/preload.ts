import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('resize-window', { width, height });
  },
  isElectron: true,
  onOutboundAudio: (callback: (data: Uint8Array) => void) => {
    ipcRenderer.on('outbound-audio-data', (_event, data: Buffer) => {
      callback(new Uint8Array(data));
    });
  }
});
