/**
 * 预加载桥：渲染端与主进程的安全通信接口
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveDataSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  setFullscreen: (on) => ipcRenderer.invoke('app:fullscreen', on),
  isFullscreen: () => ipcRenderer.invoke('app:isFullscreen'),
  pickLocalVideo: () => ipcRenderer.invoke('dialog:pickVideo'),
  fetchBilibiliInfo: (bvid) => ipcRenderer.invoke('bilibili:fetchInfo', bvid),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  userDataPath: () => ipcRenderer.invoke('app:userDataPath'),
  importLifepivotSleep: () => ipcRenderer.invoke('lifepivot:importSleep'),
  saveSkinPhoto: (buf, ext) => ipcRenderer.invoke('skinphoto:save', buf, ext),
  readSkinPhoto: (name) => ipcRenderer.invoke('skinphoto:read', name),
  deleteSkinPhoto: (name) => ipcRenderer.invoke('skinphoto:delete', name),
  analyzeSkinPhoto: (b64, mime, apiKey, model) => ipcRenderer.invoke('ai:analyzeSkin', b64, mime, apiKey, model),
  isMac: process.platform === 'darwin',
  platform: process.platform,
  onReminderActivate: (cb) => ipcRenderer.on('reminder-activate', (_e, payload) => cb(payload))
});
