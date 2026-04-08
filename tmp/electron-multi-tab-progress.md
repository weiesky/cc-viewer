# Electron 多 Tab 架构 — 工作进展文档

## 一、目标

为 cc-viewer 创建 Electron 桌面版，支持多项目 Tab 并行。每个 Tab 是独立的子进程（fork），拥有独立的 proxy、server、PTY，彻底隔离，不与 Web 版日志串台。

## 二、已完成的工作

### 2.1 基础 Electron 框架（已提交 npm 1.6.117）
- `electron/main.js` — 主进程入口
- `electron-builder.yml` — macOS/Windows/Linux 打包配置
- `package.json` — devDependencies (electron, electron-builder), scripts (electron:dev, electron:build)
- `build/icon.icns` — 从 `public/ccv-logo.png` 生成的 macOS 图标
- `.gitignore` — 添加 `electron-dist`

### 2.2 多 Tab 架构文件（已写好但有 bug）

**新增文件：**
- `lib/ensure-hooks.js` — 从 cli.js 提取的 ensureHooks()，注册 AskUserQuestion + 权限审批 hooks
- `electron/tab-worker.js` — 子进程入口（proxy + server + PTY 启动，IPC 通信）
- `electron/tab-bar.html` — Tab 栏 UI（HTML+CSS+JS，支持 dark/light 主题）
- `electron/tab-preload.js` — Tab 栏 contextBridge IPC
- `electron/workspace-preload.js` — Workspace 选择器 contextBridge IPC

**改动文件：**
- `cli.js` — ensureHooks 改为 `import { ensureHooks } from './lib/ensure-hooks.js'`
- `src/components/WorkspaceList.jsx` — handleLaunch 内加 electronAPI 检查（5行）
- `server.js` — `/api/workspaces/launch` 加 `CCV_ELECTRON_MULTITAB` 检查，阻止管理 server spawn Claude
- `electron/main.js` — 完全重写为 BaseWindow + WebContentsView 多 tab 管理器

### 2.3 其他已完成的改进（已提交）
- Light 主题完整 CSS 变量体系（1.6.113-1.6.116）
- 主题命名：耀石黑 / 雪山白（全 18 语言）
- attach-to-chat 右键菜单
- loading pet gif
- WorkspaceList 双按钮（ccv / ccv --d）+ 自动 -c
- Workspace 主题适配（this.themeConfig 替代硬编码 dark）
- 多项修 light 模式 bug

## 三、当前卡住的核心问题

### 3.1 preload 拦截方案失败
**问题**：workspace-preload.js 通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露的 `window.electronAPI` 在 React 的 `WorkspaceList.jsx` 中读取为 undefined。

**原因分析**：
- preload 文件路径正确（验证过文件存在且路径解析正确）
- `contextIsolation: true` 下 preload 的 `contextBridge` 应该能暴露 API 到主世界
- 但 React 组件 `handleLaunch` 内的 `window.electronAPI?.launchWorkspace` 始终为 undefined
- 也尝试了 `executeJavaScript` 注入方案，同样失败（可能因为 React 闭包捕获了早期的 window 状态）

**当前临时方案**：
- 在 `server.js` 加了 `process.env.CCV_ELECTRON_MULTITAB` 检查，管理 server 的 `/api/workspaces/launch` 不再 spawn Claude
- 但还没有实现从管理 server 的 launch response 触发 main.js fork tab-worker 的机制

### 3.2 Tab 内容不显示
**问题**：Tab 栏能显示 tab（蓝色指示条激活），但内容区不切换到项目 view，一直显示 workspace 选择器。

**原因**：
- 原来 `ready` 消息在 `spawnClaude()` 之后发送，而 spawnClaude 在 Electron fork 的子进程中可能失败（process.execPath 是 Electron 二进制）
- 修复后改为先发 `ready` 再 spawn Claude，但由于 preload 拦截失败，launch 请求打到了管理 server 而不是 tab-worker，所以 tab-worker 从未被 fork

### 3.3 进程 execPath 问题
**问题**：`pty-manager.js` 中 `process.execPath` 在 Electron 环境下是 Electron 二进制，不是 Node.js。
**已修复**：加了 `process.versions.electron` 检查 + `which node` fallback（pty-manager.js:139-148）

## 四、待解决的 TODO

### P0 — 核心阻塞

1. **实现 launch 拦截**：当管理 server 的 WorkspaceList launch 完成后，通知 main.js fork tab-worker。
   - 方案 A：监听管理 server 的 SSE `workspace_started` 事件（通过 EventSource 从 main.js 连接管理 server）
   - 方案 B：直接在 main.js 中 HTTP 请求管理 server 的 `/api/workspaces/launch`（不通过 React），获取 projectName 后 fork worker
   - 方案 C：在 `WorkspaceList.jsx` 的 `onLaunch` callback 中用 `window.postMessage` 通知，main.js 通过 `webContents.on('ipc-message')` 接收
   - **推荐方案 A**：main.js 开一个 EventSource 监听管理 server 的 SSE，检测到 `workspace_started` 事件后提取 path + projectName，fork tab-worker

2. **Tab 内容切换**：确保 `switchTab()` 正确隐藏 workspace view 并显示 tab 的 WebContentsView

3. **多 tab 去重**：同一项目不允许开两个 tab

### P1 — 体验

4. Tab loading 状态（spinner）
5. 关闭 streaming tab 确认框
6. Tab 栏横向滚动 + 名称截断
7. 窗口 title 显示当前项目名

### P2 — 优化

8. 主题跨 tab 同步
9. Resize 防抖
10. Tab 拖拽排序

## 五、架构决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 多实例隔离 | `child_process.fork()` | server.js 有 30+ 模块级全局变量 |
| 视图容器 | `BaseWindow` + `WebContentsView` | BrowserView 已废弃，这是 Electron 35 官方 API |
| Tab 栏 | 独立 WebContentsView (tab-bar.html) | 不改动 React 前端 |
| Tab 切换 | `view.setVisible(true/false)` | 保留 WebSocket、滚动位置、DOM 状态 |
| macOS 标题栏 | `titleBarStyle: 'hiddenInset'` | Tab bar 占据标题栏区域，左侧 70px 留给红黄绿按钮 |
| 窗口拖拽 | tab-bar.html body `-webkit-app-region: drag`，tab/按钮 `no-drag` | 保留拖拽同时支持 tab 点击 |

## 六、关键文件路径

```
electron/
├── main.js              — 主进程（BaseWindow + 多 tab 管理）
├── tab-worker.js        — 子进程入口（proxy + server + PTY）
├── tab-bar.html         — Tab 栏 UI
├── tab-preload.js       — Tab 栏 IPC bridge
├── workspace-preload.js — Workspace IPC bridge（当前未生效）
lib/
├── ensure-hooks.js      — 提取的 hooks 注册模块
server.js                — 加了 CCV_ELECTRON_MULTITAB 检查（1行改动）
cli.js                   — ensureHooks 改为 import（1行改动）
src/components/
├── WorkspaceList.jsx    — 加了 electronAPI 检查（5行，当前未生效）
```

## 七、测试通过的确认

- `npm run test` — 830 测试全通过（ensureHooks 提取不影响）
- `npm run build` — 前端构建通过
- `npx electron-builder --mac` — DMG/ZIP 打包成功
- Web 版 `npm start` / `ccv` — 不受影响

## 八、调研报告位置

- `tmp/multi-tab-architecture.md` — 完整架构方案
- `tmp/theme-color-implementation.md` — 主题色实现指南
- 6 份 Code Review 报告已在会话中（未持久化）
