const { contextBridge, ipcRenderer, webFrame } = require('electron');

// 整体显示缩放:Electron 用真·原生缩放(webFrame.setZoomFactor)而非 CSS zoom,
// 避免 Chromium 128 标准化 CSS zoom 的「局部 vs 可视」坐标空间分裂(终端 fit / 拖拽分隔条
// / 100vh 等一连串错位)。浏览器端无此 API,改由用户用浏览器原生快捷键缩放(renderer 据
// window.tabBridge.setZoomFactor 是否存在区分平台)。
//
// 首屏抢占:页面脚本执行前同步从 localStorage 读上次档位并应用,避免 100% 渲染后再跳变
// (等价于旧 index.html inline boot script,只是换成原生缩放)。
try {
  const n = Number(localStorage.getItem('ccv_displayScale'));
  if (Number.isFinite(n) && n >= 50 && n <= 200 && n !== 100) {
    webFrame.setZoomFactor(n / 100);
  }
} catch {}

// Bridge for chat content WebContentsView (each tab's main UI).
// Exposed under window.tabBridge so the renderer can react to global approval signals
// emitted by the Electron main process aggregating pending state across tabs.
//
// Subscription APIs (onApprovalBroadcast / onTabIdInit) return a dispose function so the
// renderer can unsubscribe on unmount; otherwise webContents reload accumulates listeners.
contextBridge.exposeInMainWorld('tabBridge', {
  onApprovalBroadcast: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('approval-broadcast', handler);
    return () => ipcRenderer.removeListener('approval-broadcast', handler);
  },
  jumpToTab: (tabId) => ipcRenderer.send('approval-jump', tabId),
  onTabIdInit: (cb) => {
    const handler = (_, tabId) => cb(tabId);
    ipcRenderer.on('tab-id-init', handler);
    return () => ipcRenderer.removeListener('tab-id-init', handler);
  },
  notifyPtyPlanPending: (payload) => ipcRenderer.send('pty-plan-pending', payload),
  notifyPtyPlanResolved: (payload) => ipcRenderer.send('pty-plan-resolved', payload),
  // ask resolved 兜底：WS 断连 / ChatView unmount 时 server 不一定推 ask-hook-resolved，
  // renderer 显式通知 main 清 pendingByTab[tabId].ask，避免 badge 残留 + 跨 tab chip 误显。
  // payload.reason 可选 'answered'(默认) / 'cancel' — main 进程当前不区分（同清 badge），
  // 留下接口便于以后统计 / 不同通知行为区分。
  notifyAskResolved: (payload) => ipcRenderer.send('ask-resolved', payload),
  // 把审批偏好推给 main 进程(仅 notifyOnlyWhenHidden 影响 main 的 OS Notification 决策)。
  // hydrate 时和用户每次切换都调一次;非 electron 环境下 window.tabBridge 不存在,renderer 已用可选链兜底。
  setApprovalPref: (prefs) => ipcRenderer.send('set-approval-pref', prefs),
  // 整体显示缩放(原生)。f ∈ [0.5, 2.0](见 displayScaleHelper 预设 50–200)。renderer 用本方法
  // 是否存在(window.tabBridge.setZoomFactor)判定「Electron 桌面 → 显示下拉」vs「浏览器 → (?) 提示」。
  setZoomFactor: (f) => { try { webFrame.setZoomFactor(f); } catch {} },
  // Header 控件迁移到 tab bar：active tab 把 header 模型推上去；接收 tab bar 的点击动作。
  setHeaderModel: (model) => ipcRenderer.send('set-header-model', model),
  // win32 HTML 菜单栏:React 下拉叶子点击 → main dispatchMenuCommand(new-tab/undo/reload/...)。
  menuCommand: (id) => ipcRenderer.send('menu-command', id),
  // 下拉开/关状态回报 → main 转给 tab bar(打开期间 hover 相邻顶级菜单即切换)。
  menuBarState: (open) => ipcRenderer.send('menu-bar-state', !!open),
  onHeaderAction: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('header-action', handler);
    return () => ipcRenderer.removeListener('header-action', handler);
  },
  // iPad/设备模式：右上角开关切换 → main 广播 device-mode-changed；React 据此切 viewMode(pad⇄pc)，不依赖窗口宽度。
  requestDeviceMode: () => ipcRenderer.send('request-device-mode'),
  onDeviceModeChange: (cb) => {
    const handler = (_, on) => cb(on);
    ipcRenderer.on('device-mode-changed', handler);
    return () => ipcRenderer.removeListener('device-mode-changed', handler);
  },
});
