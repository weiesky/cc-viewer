const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabAPI', {
  switchTab: (tabId) => ipcRenderer.send('tab-switch', tabId),
  closeTab: (tabId) => ipcRenderer.send('tab-close', tabId),
  newTab: () => ipcRenderer.send('tab-new'),
  onTabsUpdated: (cb) => ipcRenderer.on('tabs-updated', (_, tabs) => cb(tabs)),
  onTabActivated: (cb) => ipcRenderer.on('tab-activated', (_, tabId) => cb(tabId)),
  onThemeChanged: (cb) => ipcRenderer.on('theme-changed', (_, theme) => cb(theme)),
});
