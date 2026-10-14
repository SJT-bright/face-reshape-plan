'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('habitPopup', {
  ready: () => ipcRenderer.invoke('habit:popup-ready'),
  action: (id, action) => ipcRenderer.invoke('habit:popup-action', id, action),
  onReminder: callback => { const listener = (_event, item) => callback(item); ipcRenderer.on('habit:popup', listener); return () => ipcRenderer.removeListener('habit:popup', listener); }
});
