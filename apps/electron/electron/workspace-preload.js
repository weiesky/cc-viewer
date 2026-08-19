const { contextBridge, ipcRenderer } = require('electron');

console.log('[workspace-preload] loading...');

contextBridge.exposeInMainWorld('electronAPI', {
  launchWorkspace: (path, extraArgs) => {
    console.log('[workspace-preload] launchWorkspace called:', path, extraArgs);
    ipcRenderer.send('workspace-launch', { path, extraArgs });
  },
  // 工作区选择器浮层模式：close 收起浮层；requestWorkspaceMode 挂载即同步当前模式；
  // onWorkspaceMode 监听 main 推来的 'full' | 'popup'。
  closeWorkspacePopup: () => ipcRenderer.send('workspace-popup-close'),
  requestWorkspaceMode: () => ipcRenderer.send('request-workspace-mode'),
  onWorkspaceMode: (cb) => {
    const listener = (_, mode) => cb(mode);
    ipcRenderer.on('workspace-mode', listener);
    return () => ipcRenderer.removeListener('workspace-mode', listener);
  },
});
