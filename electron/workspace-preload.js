const { contextBridge, ipcRenderer } = require('electron');

console.log('[workspace-preload] loading...');

contextBridge.exposeInMainWorld('electronAPI', {
  launchWorkspace: (path, extraArgs) => {
    console.log('[workspace-preload] launchWorkspace called:', path, extraArgs);
    ipcRenderer.send('workspace-launch', { path, extraArgs });
  },
});
