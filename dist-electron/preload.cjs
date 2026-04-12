// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electron", {
  resizeWindow: (width, height) => {
    import_electron.ipcRenderer.send("resize-window", { width, height });
  },
  isElectron: true,
  onOutboundAudio: (callback) => {
    import_electron.ipcRenderer.on("outbound-audio-data", (_event, data) => {
      callback(new Uint8Array(data));
    });
  }
});
