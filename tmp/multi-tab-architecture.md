# Electron 多 Tab 架构实现方案

## 一、架构概览

```
BaseWindow
├── contentView
│   ├── tabBarView (WebContentsView, 36px, 顶部固定)
│   │   └── electron/tab-bar.html
│   ├── workspaceView (WebContentsView, 仅选择项目时可见)
│   │   └── http://127.0.0.1:{mgmtPort} (workspace mode server)
│   ├── tabView-1 (WebContentsView, visible:true)
│   │   └── http://127.0.0.1:{port1}?token={token1}
│   ├── tabView-2 (WebContentsView, visible:false)
│   │   └── http://127.0.0.1:{port2}?token={token2}
│   └── ...

进程树:
Electron main process
├── mgmt-server (内嵌, workspace mode, 只用于项目选择)
├── fork(tab-worker.js, project1) → {proxy1, server1, pty1}
├── fork(tab-worker.js, project2) → {proxy2, server2, pty2}
└── ...
```

## 二、文件清单

### 新增文件 (4个)
1. `electron/tab-worker.js` (~80行) — 子进程入口
2. `electron/tab-bar.html` (~150行) — Tab 栏 UI
3. `electron/tab-preload.js` (~20行) — Tab 栏 IPC bridge
4. `electron/workspace-preload.js` (~15行) — Workspace 选择器 IPC bridge

### 重写文件 (1个)
5. `electron/main.js` (~300行) — 完全重写为多 tab 管理器

### 不改动
- server.js, cli.js, src/*, proxy.js, interceptor.js, pty-manager.js

## 三、核心模块设计

### 1. electron/tab-worker.js (子进程)

每个 tab 对应一个独立的 Node.js 子进程。通过 fork() IPC 通信。

```
启动流程:
1. 接收 { type: 'launch', path, extraArgs } 消息
2. 启动 proxy → 获取 proxyPort
3. 设置 CCV_CLI_MODE=1, CCV_PROJECT_DIR=path
4. import server.js → startViewer()
5. initForWorkspace(path) → 初始化日志
6. spawnClaude(proxyPort, path, args) → 启动 PTY
7. process.send({ type: 'ready', port, token, projectName })

关闭流程:
1. 接收 { type: 'shutdown' } 消息
2. killPty()
3. stopViewer()
4. process.exit(0)

安全网:
- process.on('disconnect') → 父进程挂了，自行清理退出
- pty onExit → process.send({ type: 'pty-exit', code })
```

### 2. electron/main.js (主进程)

核心数据结构:
```js
const tabs = new Map(); // tabId -> { child, port, token, projectName, view }
let activeTabId = null;
let mgmtPort = null; // 管理 server 端口 (workspace selector)
```

核心函数:
- `createTab(projectPath, extraArgs)` — fork worker → 等 ready → 创建 WebContentsView → 更新 tab bar
- `switchTab(tabId)` — setVisible 切换
- `closeTab(tabId)` — send shutdown → 等退出/超时 → 移除 view → 如果无 tab 了显示 workspace
- `showWorkspaceSelector()` — 显示/创建 workspace view
- `hideWorkspaceSelector()` — 隐藏
- `updateLayout()` — resize 时重新计算所有 view bounds

窗口结构:
- BaseWindow (替代 BrowserWindow)
- tabBarView: 固定 36px 高度, y=0
- workspaceView: y=36, 占满剩余空间, 初始可见
- 各 tabView: y=36, 占满剩余空间, 通过 visible 切换

### 3. electron/tab-bar.html (Tab 栏)

纯 HTML+CSS+JS，通过 preload 暴露的 IPC 和主进程通信。

UI 元素:
- Tab 列表 (可滚动, 每个 tab 显示项目名 + 关闭 x)
- "+" 按钮 (新建项目)
- 当前 tab 高亮

IPC API (通过 contextBridge):
- `window.tabAPI.switchTab(tabId)` — 切换
- `window.tabAPI.closeTab(tabId)` — 关闭
- `window.tabAPI.newTab()` — 新建
- `window.tabAPI.onTabsUpdated(callback)` — 主进程通知 tab 变化
- `window.tabAPI.onTabActivated(callback)` — 主进程通知切换

样式:
- 跟随主题 (通过 CSS 变量, data-theme attribute)
- 高度 36px
- Tab 间距 0, 靠左排列
- 当前 tab 底部有蓝色指示条
- hover 显示关闭按钮

### 4. Workspace 选择器集成

复用现有的 WorkspaceList 组件，不是新写一个。方案：

- 主进程启动一个 "管理 server"（workspace mode），仅用于项目选择 UI
- 该 server 在 Electron 主进程内运行（和现在一样），端口自动分配
- 项目选择 view 加载该 server 的 URL
- 用户选择项目后，通过 preload IPC 通知主进程
- 主进程调用 createTab(path) fork 子进程
- workspace view 隐藏，tab view 显示

拦截 workspace launch:
- workspace-preload.js 拦截 `/api/workspaces/launch` 的 fetch
- 替代默认行为：不让管理 server spawn Claude，而是通知主进程去 fork worker

## 四、交互流程

### 首次启动
1. app ready → 创建 BaseWindow
2. 启动管理 server (workspace mode) → 获取 mgmtPort
3. 创建 tabBarView + workspaceView
4. workspaceView 加载 workspace URL → 显示项目列表
5. 用户点击 "ccv" 或 "ccv --d" → preload 拦截 → IPC 通知主进程
6. 主进程: createTab(path, extraArgs)
7. fork tab-worker → 等 ready → 创建 tabView
8. 隐藏 workspaceView, 显示 tabView + tabBar

### 新建 Tab
1. 用户点击 tab bar 的 "+" → IPC 通知主进程
2. 主进程: showWorkspaceSelector()
3. 用户选择项目 → 同上述步骤 5-8

### 切换 Tab
1. 用户点击 tab → IPC 通知主进程 switchTab(id)
2. 主进程: 隐藏当前 tabView, 显示目标 tabView
3. 通知 tabBar 更新高亮

### 关闭 Tab
1. 用户点击 tab 的 x → IPC 通知主进程 closeTab(id)
2. 主进程: child.send({ type: 'shutdown' })
3. 5 秒超时后 force kill
4. 移除 WebContentsView, 从 tabs Map 删除
5. 如果还有其他 tab → 切换到最后一个
6. 如果没有 tab 了 → showWorkspaceSelector()

### 退出 App
1. Cmd+Q / window close
2. 逐个 shutdown 所有 tab workers
3. 停止管理 server
4. app.exit()

## 五、防重复项目

tabs Map 中记录每个 tab 的 projectPath。createTab 时检查是否已存在:
- 如果已存在 → 切换到该 tab，不创建新的
- 提示用户 "该项目已在 Tab X 中打开"

## 六、主题同步

- tabBarView 需要跟随主题变化
- 管理 server 已经通过 this.themeConfig 支持主题
- tab workers 各自独立，主题偏好通过 preferences.json 共享（都读同一个文件）
- tabBar 的主题: 主进程监听偏好变化，通过 IPC 通知 tabBar 切换 data-theme

## 七、风险与降级

1. **内存**: 每个 tab = 1 个 Node.js 子进程 + 1 个 Chromium renderer。约 100-150MB/tab。10 个 tab ≈ 1-1.5GB。
2. **端口耗尽**: 最多 92 个 HTTP 端口 (7008-7099)，实际使用不会超过 10 个 tab。
3. **子进程孤儿**: 通过 `process.on('disconnect')` 自清理。
4. **管理 server 占端口**: 额外占一个端口，但只跑 workspace selector 逻辑，资源极小。
