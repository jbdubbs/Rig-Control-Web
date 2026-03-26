import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  resizeWindow: (width: number, height: number) => {
    ipcRenderer.send('resize-window', { width, height });
  },
  isElectron: true
});
