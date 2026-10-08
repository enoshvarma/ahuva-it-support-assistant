const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dwgDesktop', {
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, name, data) => cb(name, data)),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', name, bytes),
});
