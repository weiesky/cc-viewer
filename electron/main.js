/**
 * CC Viewer Electron — Multi-Tab Architecture
 *
 * BaseWindow with:
 * - tabBarView (50px, tab-bar.html)
 * - workspaceView (project selector, shown when no tabs / adding new)
 * - per-tab WebContentsView (each loads its own server port)
 *
 * Each tab = fork('tab-worker.js') → isolated proxy + server + PTY
 */
import { app, BaseWindow, WebContentsView, Menu, ipcMain, dialog, Notification, screen, clipboard } from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, basename, delimiter } from 'path';
import { fork, execSync } from 'child_process';
import { realpathSync, existsSync, readFileSync, writeFileSync, watch, mkdirSync, createWriteStream, readdirSync, statSync, unlinkSync } from 'fs';
import { initDiag, appendDiag, attachDiagListeners, diagFlush } from './diag.js';
import { buildMenuModel, serializeMenuModel } from './menu-model.js';
import { loadState, saveState, validateState } from './window-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// ─── 主进程防阻塞：console.* 守卫 ───────────────────────────
// Windows 上写控制台是同步内核调用：从终端启动 + 用户在黑窗口里点选文字（QuickEdit
// 选择模式）时，所有写 stdout/stderr 的进程被内核级无限期阻塞——主进程一旦中招即
// "整窗永久冻结、hover 仍有高亮、永不恢复"（按 Esc 才解锁）。打包版 GUI 没有可见
// 控制台，stdout 输出毫无价值 → 打包版一律静默；关键事件本就走 appendDiag 异步落盘。
// dev（npx electron .）保留 console 输出不变。
const _isDev = !app.isPackaged;
const devLog = (...a) => { if (_isDev) console.log(...a); };
const devWarn = (...a) => { if (_isDev) console.warn(...a); };
const devError = (...a) => { if (_isDev) console.error(...a); };
// Windows 下 import(绝对路径) 会被 Node 把 'c:' 当 URL scheme 拒绝 (ERR_UNSUPPORTED_ESM_URL_SCHEME)。
// pathToFileURL(p).href 在 POSIX 产出 file:///abs/.. 在 Windows 产出 file:///C:/.. —— 两平台 ESM 等价。
const { t, setLang } = await import(pathToFileURL(join(rootDir, 'server', 'i18n.js')).href);
const { getClaudeConfigDir, LOG_DIR } = await import(pathToFileURL(join(rootDir, 'findcc.js')).href);

// 白屏诊断日志（实现在 electron/diag.js）。
initDiag(LOG_DIR);
// 主进程兜底：仅 log 不 exit，先观察分布再决定是否升级为终止。
process.on('uncaughtException', (e) => appendDiag('main:uncaughtException', e));
process.on('unhandledRejection', (r) => appendDiag('main:unhandledRejection', r));

// --- Resolve shell environment (Finder-launched Electron has minimal env) ---
// When launched from Finder/dock, process.env lacks shell profile vars (HTTP_PROXY, PATH, LANG, etc.)
// Spawn a login shell to capture the full environment, then inject missing/enriched vars.
const _shellVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NO_PROXY', 'ALL_PROXY', 'all_proxy', 'LANG'];
const _hasShellEnv = _shellVars.some(k => process.env[k]);
if (!_hasShellEnv && process.platform !== 'win32') {
  try {
    const _shell = process.env.SHELL || '/bin/zsh';
    // Use -i (interactive) to ensure .zshrc is loaded, not just .zprofile
    const _envOutput = execSync(`${_shell} -l -i -c 'env' 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
    });
    let _shellPath = null;
    for (const line of _envOutput.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const val = line.slice(eq + 1);
      if (key === 'PATH') {
        _shellPath = val; // Save for merging below
      } else if (_shellVars.includes(key) && !process.env[key]) {
        process.env[key] = val;
      }
    }
    // Merge shell PATH into process PATH (prepend shell paths for priority)
    // 分隔符用 path.delimiter: POSIX 下 ':' (等价于原硬编码), Windows 下 ';'
    if (_shellPath) {
      const existing = new Set((process.env.PATH || '').split(delimiter));
      const merged = _shellPath.split(delimiter).filter(p => !existing.has(p));
      if (merged.length) {
        process.env.PATH = _shellPath + delimiter + process.env.PATH;
      }
    }
    if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
      devError('[Electron] Injected proxy from shell profile:', process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
    }
  } catch (err) {
    devError('[Electron] Failed to resolve shell env:', err.message);
  }
}

// --- Ensure PATH includes common node/npm binary locations ---
// 分隔符用 path.delimiter (POSIX ':', Windows ';'). POSIX 硬编码路径在 Windows 下会被拼入 PATH 但无效，无副作用。
const home = app.getPath('home');
const pathDirs = (process.env.PATH || '').split(delimiter);
const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', join(home, '.npm-global', 'bin'), join(home, '.nvm', 'versions', 'node')];
for (const p of extraPaths) {
  if (!pathDirs.includes(p)) pathDirs.push(p);
}
process.env.PATH = pathDirs.join(delimiter);

// --- Resolve real Node.js path (Electron's process.execPath is the Electron binary) ---
// Tab workers are forked with an explicit execPath. Historically that was whatever
// `where node` / `which node` printed, falling back to the bare string 'node' —
// but a packaged GUI app does not inherit the user's shell PATH, so on Windows the
// lookup often finds nothing and fork() died with "spawn node ENOENT", leaving every
// tab stuck at loading → 30s ready-timeout (issue #129).
//
// Electron's own binary is always present and can run a plain Node script when
// ELECTRON_RUN_AS_NODE=1, so it is the correct last-resort execPath: no external
// Node install required at all. node-pty's prebuilds are N-API (ABI-stable across
// Node and Electron), so the worker loads them either way.
function resolveNodeExecPath() {
  if (!process.versions.electron) return process.execPath;
  const isWin = process.platform === 'win32';
  try {
    const out = execSync(isWin ? 'where node' : 'which node', { encoding: 'utf-8', windowsHide: true });
    const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    // Windows `where` lists every PATH match; only a real .exe is spawnable.
    const hit = isWin ? lines.find(l => l.toLowerCase().endsWith('.exe')) : lines[0];
    if (hit && existsSync(hit)) return hit;
  } catch { /* node not on PATH — fall through to the Electron binary */ }
  return null;
}

const _resolvedNode = resolveNodeExecPath();
// null → run the worker under Electron's bundled Node (ELECTRON_RUN_AS_NODE).
const _nodePath = _resolvedNode || process.execPath;
const _forkUnderElectron = !_resolvedNode && !!process.versions.electron;
if (_forkUnderElectron) devError('[Electron] No external Node found on PATH; running tab workers under the Electron binary (ELECTRON_RUN_AS_NODE)');

const { resolvePreferredClaudeSelection } = await import(pathToFileURL(join(rootDir, 'findcc.js')).href);
const claudeSelection = resolvePreferredClaudeSelection();
let claudePath = claudeSelection?.path || null;
let isNpmVersion = claudeSelection?.isNpmVersion || false;

if (claudeSelection?.error === 'configured-invalid') {
  process.env.CCV_CLAUDE_CONFIG_ERROR = claudeSelection.configuredPath;
  devError('[Electron] Configured Claude executable is not launchable:', claudeSelection.configuredPath);
}

if (!claudePath) {
  process.env.CCV_CLAUDE_MISSING = '1';
} else {
  process.env.CCV_CLAUDE_EXECUTABLE = claudePath;
}

// --- Management server for workspace selector ---
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_ELECTRON_MULTITAB = '1'; // Tell server not to spawn Claude on launch

let mgmtServerMod = null;
let mgmtPort = null;

/**
 * 终止 child process —— Windows 上 SIGTERM 是 noop（要等满 escalateMs 才走 SIGKILL，tab close 卡）；
 * 直接 kill() 让 Node 走 TerminateProcess 立即结束。POSIX 保留 SIGTERM → escalateMs → SIGKILL 升级。
 * 返回 Promise 在子进程退出或超时后 resolve。
 */
function killChildEscalating(child, escalateMs = 3000) {
  if (process.platform === 'win32') {
    try { child.kill(); } catch {}
    return Promise.resolve();
  }
  try { child.kill('SIGTERM'); } catch {}
  return new Promise(resolve => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, escalateMs);
    child.on('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function startMgmtServer() {
  try {
    const { startProxy } = await import(pathToFileURL(join(rootDir, 'server', 'proxy.js')).href);
    const proxyPort = await startProxy();
    process.env.CCV_PROXY_PORT = String(proxyPort);
    mgmtServerMod = await import(pathToFileURL(join(rootDir, 'server', 'server.js')).href);
    await mgmtServerMod.startViewer();
    mgmtPort = mgmtServerMod.getPort();
    if (!mgmtPort) {
      // 端口段 [7048, 7099) 全占 / startViewer 早返回 null —— 后续 loadURL 会拼出
      // `http://127.0.0.1:null` 直接白屏。日志里把 mgmtPort 显式记下来定位用。
      appendDiag('main:startMgmtServer', { error: 'getPort() returned null', portRangeHint: '7048-7099' });
      throw new Error('mgmt server port unavailable');
    }
    if (claudePath) {
      mgmtServerMod.setWorkspaceClaudeArgs([]);
      mgmtServerMod.setWorkspaceClaudePath(claudePath, isNpmVersion);
    }
    mgmtServerMod.setLaunchCallback((path, extraArgs) => createTab(path, extraArgs));
  } catch (err) {
    // mgmt server 起不来后续所有 loadURL 会拼出 `http://127.0.0.1:null` 白屏。
    // 先落 diag 日志，再弹 errorBox 告知用户，最后 exit(1) 让用户能立刻定位到日志而非
    // 面对白屏发呆。dialog 是阻塞的，用户点确认后才会 app.exit。
    appendDiag('main:startMgmtServer', { err, mgmtPort, claudePath, isNpmVersion, proxyPort: process.env.CCV_PROXY_PORT });
    try {
      dialog.showErrorBox(
        'CC Viewer 启动失败',
        `管理服务无法启动：${err && err.message ? err.message : String(err)}\n\n` +
        `详细日志：~/.claude/cc-viewer/electron-diag.log`,
      );
    } catch { /* dialog 在 ready 前调用会抛，忽略后直接退出 */ }
    app.exit(1);
  }
}

// --- Tab state ---
const TAB_BAR_HEIGHT = 50;
// debug worker 日志保留窗口（CCV_DEBUG_WORKER_LOGS=1 时使用）
const LOG_RETENTION_MS = 7 * 24 * 3600 * 1000;
const tabs = new Map(); // tabId -> { child, port, token, projectName, realPath, view, status }
let nextTabId = 1;
let activeTabId = null;

// --- Window ---
let mainWindow = null;
let tabBarView = null;
let workspaceView = null;

// --- iPad/device mode (window resize) ---
// 状态由 main 进程持有，跨 tab 切换不丢失。deviceMode = 当前处于 iPad 模式；
// savedBounds = 进入 iPad 模式前记下的窗口尺寸，退出时还原。
// iPad 模式只是把窗口收窄到 DEVICE_WIDTH，并把最小宽度放宽到 DEVICE_WIDTH，
// 因此用户仍可手动把窗口再拉大。
const DEVICE_WIDTH = 500;       // iPad 预览默认宽度
const DEVICE_MIN_WIDTH = 460;   // iPad 模式下允许手动缩到的最小宽度
const PC_MIN_WIDTH = 800;   // 原始 minWidth（见 BaseWindow 创建处）
const WIN_MIN_HEIGHT = 600;
let deviceMode = false;
let savedBounds = null;

// --- Workspace selector popup mode ---
// 工作区选择器有两种呈现：整页（零 tab 的初始化界面）/ 浮层（已有 tab 时点「+」，叠在当前
// tab 之上居中弹出，当前界面变暗保留在后面）。workspacePopupOpen = 当前处于浮层模式。
let workspacePopupOpen = false;

// --- Pending-approval aggregation across tabs ---
// pendingByTab: tabId -> { permission?: Map<id,payload>, plan?: Map<id,payload>, ask?: Map<id,payload>, projectName }
const pendingByTab = new Map();
// notifiedKeys: dedupe Notification + flashFrame triggers across WS reconnects.
// Key form: `${tabId}|${kind}|${id}` — cleared when the same tuple goes through pending-remove.
const notifiedKeys = new Set();
let _isFlashing = false;
// 用户偏好：仅窗口失焦时弹通知。默认 true 保留历史行为(失焦才通知)；
// 关掉后窗口聚焦时也通知。renderer 通过 set-approval-pref IPC 推过来,首次 mount 也会推一次同步初值。
// 启动时同步从 preferences.json 读初值,消除"默认 true → renderer hydrate 后才生效"的 race window。
// 读失败/字段缺失则保留 true(向后兼容旧 preferences.json)。
let _notifyOnlyWhenHidden = true;
try {
  const _prefsPath = join(LOG_DIR, 'preferences.json');
  if (existsSync(_prefsPath)) {
    const _prefs = JSON.parse(readFileSync(_prefsPath, 'utf-8'));
    if (_prefs?.approvalModal && typeof _prefs.approvalModal.notifyOnlyWhenHidden === 'boolean') {
      _notifyOnlyWhenHidden = _prefs.approvalModal.notifyOnlyWhenHidden;
    }
  }
} catch (e) {
  devWarn('[main] failed to load notifyOnlyWhenHidden from preferences.json:', e?.message || e);
}

// --- 启动期主题/语言(窗口创建前必须确定) ---
// backgroundColor(防启动白屏闪烁)与 win32 titleBarOverlay 配色要在 new BaseWindow 时给出;
// 菜单语言要在 buildMenu 前 setLang。preferences.json 由 server 进程写,这里只读。
// winBg = 内容区底色(src/global.css --bg-base),barBg/sym = tab bar 底色/前景(tab-bar.html --bg/--text)。
// ⚠ 这些值与上述 CSS 变量是两处维护:改任一侧配色必须同步另一侧,否则 win32 窗控区/启动首帧会露出色差。
const THEME_COLORS = {
  dark: { winBg: '#0a0a0a', barBg: '#1a1a1a', sym: '#aaa' },
  light: { winBg: '#FAFAFA', barBg: '#f0f0f0', sym: '#666' },
};
let _startupTheme = 'dark';
try {
  const _prefsPath = join(LOG_DIR, 'preferences.json');
  if (existsSync(_prefsPath)) {
    const _prefs = JSON.parse(readFileSync(_prefsPath, 'utf-8'));
    if (_prefs?.themeColor === 'light') _startupTheme = 'light';
    // setLang 自带 locale 校验,非法值回落 en;缺失时保留 i18n.js 模块加载期的 detectLanguage() 结果。
    if (_prefs?.lang) setLang(_prefs.lang);
  }
} catch (e) {
  devWarn('[main] failed to load theme/lang from preferences.json:', e?.message || e);
}

// --- 窗口几何持久化(electron/window-state.js,纯逻辑;这里只做去抖与事件接线) ---
// 存 LOG_DIR/window-state.json —— 不写 preferences.json(server 进程拥有写权,同写会竞争覆盖)。
const WINDOW_STATE_FILE = join(LOG_DIR, 'window-state.json');
let _winStateTimer = null;
function saveWinStateNow() {
  // deviceMode 下窗口被人为收窄到 DEVICE_WIDTH,写入会污染下次恢复值 → 跳过。
  if (!mainWindow || mainWindow.isDestroyed() || deviceMode) return;
  try {
    const b = typeof mainWindow.getNormalBounds === 'function' ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    saveState(writeFileSync, WINDOW_STATE_FILE, {
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: mainWindow.isMaximized(),
    });
  } catch { /* best-effort */ }
}
function scheduleWinStateSave() {
  clearTimeout(_winStateTimer);
  // 400ms 去抖:一次拖拽/缩放含连续多个 move/resize 事件,合并为一次磁盘写;cleanupAll 另有同步兜底。
  _winStateTimer = setTimeout(saveWinStateNow, 400);
}

function _kindCount(tabState) {
  if (!tabState) return 0;
  // Sum sizes of every Map field; 'projectName' (string) is skipped automatically.
  let n = 0;
  for (const k of Object.keys(tabState)) {
    if (tabState[k] instanceof Map) n += tabState[k].size;
  }
  return n;
}

function _totalPendingCount() {
  let total = 0;
  for (const tabState of pendingByTab.values()) total += _kindCount(tabState);
  return total;
}

function broadcastApproval() {
  // Send aggregated state to every tab content view so they can render chips and route jumps.
  const others = [];
  for (const [tabId, st] of pendingByTab) {
    const count = _kindCount(st);
    if (count > 0) others.push({ tabId, projectName: st.projectName || '', count });
  }
  for (const [tabId, t] of tabs) {
    if (!t.view || t.view.webContents.isDestroyed()) continue;
    const ownState = pendingByTab.get(tabId);
    const ownPending = ownState ? {
      ptyPlan: ownState.ptyPlan ? [...ownState.ptyPlan.entries()].map(([id, p]) => ({ id, ...p })) : [],
      ask: ownState.ask ? [...ownState.ask.entries()].map(([id, p]) => ({ id, ...p })) : [],
    } : { ptyPlan: [], ask: [] };
    const otherTabs = others.filter(o => o.tabId !== tabId);
    try { t.view.webContents.send('approval-broadcast', { ownTabId: tabId, ownPending, others: otherTabs }); } catch {}
  }
}

// 审批级联去抖：每条 pending-add/remove 都全量跑 setBadgeCount(任务栏 COM 同步调用) +
// flashFrame + 对 N 个 tab + tab 栏的 N+3 次 IPC 广播。审批风暴（队列式 ask/plan）下
// 主进程被级联放大持续占满；100ms 合并窗口内多次状态变更只跑一次——badge/广播读的是
// 当前最终状态，本就幂等，延迟 ≤100ms 无感知。
let _aggregateTimer = null;
function scheduleAggregateApproval() {
  if (_aggregateTimer) return;
  _aggregateTimer = setTimeout(() => {
    _aggregateTimer = null;
    aggregateApproval();
  }, 100);
}

function aggregateApproval() {
  const total = _totalPendingCount();
  // Dock badge / Windows taskbar overlay
  try { app.setBadgeCount(total); } catch {}
  // flashFrame transitions: 0→≥1 start; ≥1→0 stop. Window focus also stops (handled in mainWindow.on('focus'))
  if (total > 0 && !_isFlashing) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
      try { mainWindow.flashFrame(true); _isFlashing = true; } catch {}
    }
  } else if (total === 0 && _isFlashing) {
    if (mainWindow && !mainWindow.isDestroyed()) try { mainWindow.flashFrame(false); } catch {}
    _isFlashing = false;
  }
  broadcastApproval();
  // tab-bar 上的小圆环依赖 tab 列表里的 pending 字段，pending 状态变了要让 tab-bar 重渲染。
  broadcastTabs();
}

function maybeNotify(tabId, kind, id, payload) {
  const key = `${tabId}|${kind}|${id}`;
  if (notifiedKeys.has(key)) return; // dedupe across reconnects
  notifiedKeys.add(key);
  // 受 _notifyOnlyWhenHidden(用户偏好)控制:开启时窗口聚焦则不通知;关掉后聚焦也通知。
  if (_notifyOnlyWhenHidden && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;
  const projectName = payload?.projectName || pendingByTab.get(tabId)?.projectName || 'CC Viewer';
  // i18n with safe fallback: t() returns the key itself when missing — detect that and substitute defaults.
  const _tr = (key, params, fallback) => {
    try {
      const r = t(key, params);
      return (r && r !== key) ? r : fallback;
    } catch { return fallback; }
  };
  let title = '';
  let body = '';
  if (kind === 'ask') {
    title = _tr('electron.approval.notify.title.ask', null, 'Question');
    body = _tr('electron.approval.notify.body.ask', { project: projectName }, `Question in ${projectName}`);
  } else if (kind === 'ptyPlan') {
    title = _tr('electron.approval.notify.title.ptyPlan', null, 'Plan review');
    body = _tr('electron.approval.notify.body.ptyPlan', { project: projectName }, `Plan in ${projectName}`);
  }
  // Defensive: unknown kind (e.g. stale message after rollback) → drop silently rather than show empty notification.
  if (!title) return;
  if (!Notification.isSupported || !Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, silent: false });
    n.on('click', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (process.platform === 'darwin' && app.dock) try { app.dock.show(); } catch {}
          if (typeof app.show === 'function') try { app.show(); } catch {}
          mainWindow.show();
          mainWindow.focus();
        }
      } catch {}
      try { switchTab(tabId); } catch {}
    });
    n.show();
  } catch {}
}

function recordPendingAdd(tabId, kind, id, payload) {
  if (!pendingByTab.has(tabId)) pendingByTab.set(tabId, { projectName: payload?.projectName || '' });
  const tabState = pendingByTab.get(tabId);
  if (payload?.projectName) tabState.projectName = payload.projectName;
  if (!tabState[kind]) tabState[kind] = new Map();
  if (tabState[kind].has(id)) {
    // 占位 id `__ask__` 在 PTY hook 复用 — 比对 payload 决定是 WS 重连重发（dedupe）
    // 还是新一轮 ask（替换 + 清 notifiedKey 让重新弹通知）。其它 id 直接 dedupe。
    if (id === '__ask__') {
      const prev = tabState[kind].get(id);
      const sameContent = JSON.stringify(prev?.questions || null) === JSON.stringify(payload?.questions || null);
      if (sameContent) return;
      notifiedKeys.delete(`${tabId}|${kind}|${id}`);
    } else {
      return;
    }
  }
  tabState[kind].set(id, payload || {});
  maybeNotify(tabId, kind, id, payload);
  scheduleAggregateApproval();
}

function recordPendingRemove(tabId, kind, id) {
  const tabState = pendingByTab.get(tabId);
  if (!tabState) { scheduleAggregateApproval(); return; }
  const sub = tabState[kind];
  if (sub) sub.delete(id);
  notifiedKeys.delete(`${tabId}|${kind}|${id}`);
  // Cleanup empty submaps to keep state lean — generic so new kinds (ptyPlan, etc.) are handled
  // without per-kind branching. 'projectName' is a string, not a Map, so it's correctly skipped.
  for (const k of Object.keys(tabState)) {
    if (tabState[k] instanceof Map && tabState[k].size === 0) delete tabState[k];
  }
  if (_kindCount(tabState) === 0) {
    pendingByTab.delete(tabId);
  }
  scheduleAggregateApproval();
}

function clearPendingForTab(tabId) {
  if (pendingByTab.delete(tabId)) {
    // Also clear any notifiedKeys belonging to this tab
    for (const k of [...notifiedKeys]) {
      if (k.startsWith(`${tabId}|`)) notifiedKeys.delete(k);
    }
    scheduleAggregateApproval();
  }
}

function getTabList() {
  return [...tabs.entries()].map(([id, t]) => ({
    id, name: t.projectName || basename(t.realPath || ''), status: t.status,
    // tab-bar 用来在 tab 左侧空槽里渲染"待审批提醒小圆环"。聚合了
    // ptyPlan / ask / permission 等所有待审批 kind，>0 表示这个 tab 里有东西需要用户决策。
    pending: _kindCount(pendingByTab.get(id)),
  }));
}

function broadcastTabs() {
  if (tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('tabs-updated', getTabList());
    tabBarView.webContents.send('tab-activated', activeTabId);
    // 同步当前活动 tab 的 header 模型（迁移到 tab bar 的那批控件）；无活动 tab → null 清空。
    const hm = activeTabId != null ? (tabs.get(activeTabId)?.headerModel ?? null) : null;
    tabBarView.webContents.send('header-model', hm, activeTabId);
  }
}

function updateWindowTitle() {
  if (!mainWindow) return;
  const tab = tabs.get(activeTabId);
  mainWindow.setTitle(tab ? `${tab.projectName} - CC Viewer` : 'CC Viewer');
}

// --- Layout ---
let resizeTimer;
function updateLayout() {
  if (!mainWindow) return;
  const bounds = mainWindow.getContentBounds();
  const w = bounds.width;
  const h = bounds.height;

  if (tabBarView) tabBarView.setBounds({ x: 0, y: 0, width: w, height: TAB_BAR_HEIGHT });
  if (workspaceView) workspaceView.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width: w, height: h - TAB_BAR_HEIGHT });
  for (const tab of tabs.values()) {
    if (tab.view) tab.view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width: w, height: h - TAB_BAR_HEIGHT });
  }
}

// 把主窗口在 PC / iPad 模式间切换。进入时记下当前尺寸并收窄到 DEVICE_WIDTH（高度、位置不变），
// 退出时还原到记下的尺寸。窗口最小宽度随模式调整：进入前先放宽到 DEVICE_MIN_WIDTH(460)，否则 setBounds 会被
// 原 minWidth(800) 钳制；退出后再恢复到 800。programmatic setBounds 会触发 'resize' → updateLayout，
// 但 updateLayout 只重排子视图、不动窗口，无回环，这里再同步调一次确保即时生效。
function setDeviceMode(on) {
  if (!mainWindow) return;
  if (on === deviceMode) { broadcastDeviceMode(); return; }
  if (mainWindow.isFullScreen && mainWindow.isFullScreen()) { broadcastDeviceMode(); return; } // 全屏下无法 resize：回弹按钮态，不改 deviceMode
  if (on) {
    if (mainWindow.isMaximized && mainWindow.isMaximized()) mainWindow.unmaximize();
    // getNormalBounds() 返回「非最大化」几何，避免从最大化进入时把全屏尺寸误记为 savedBounds。
    const b = (typeof mainWindow.getNormalBounds === 'function' ? mainWindow.getNormalBounds() : mainWindow.getBounds());
    savedBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
    mainWindow.setMinimumSize(DEVICE_MIN_WIDTH, WIN_MIN_HEIGHT); // 先放宽 min 到 460，否则被原 minWidth 钳制
    mainWindow.setBounds({ x: b.x, y: b.y, width: DEVICE_WIDTH, height: b.height });
    deviceMode = true;
  } else {
    const cur = mainWindow.getBounds();
    const tgt = savedBounds || { width: 1400, height: cur.height };
    mainWindow.setBounds({ x: cur.x, y: cur.y, width: tgt.width, height: tgt.height });
    mainWindow.setMinimumSize(PC_MIN_WIDTH, WIN_MIN_HEIGHT); // 放大后再恢复 min
    savedBounds = null;
    deviceMode = false;
  }
  updateLayout();
  broadcastDeviceMode();
}

// 把当前 deviceMode 推给 tab bar（按钮所在的窗口级 chrome），让图标与窗口状态一致。
function broadcastDeviceMode() {
  const wc = tabBarView && tabBarView.webContents;
  if (wc && !wc.isDestroyed()) wc.send('device-mode-changed', deviceMode);
  sendDeviceModeToTab(activeTabId); // 仅活动 tab：React 据 device mode 状态切 viewMode(pad⇄pc)，不依赖宽度
}

// 把当前 deviceMode 推给指定 tab 的 content（React 据此对齐 viewMode）。只推活动/被切到的 tab：
// 不全量广播——会话在 tab-worker 后端不受前端 reload 影响，但避免后台 tab 无谓 reload 丢前端草稿。
function sendDeviceModeToTab(tabId) {
  const tab = tabId != null ? tabs.get(tabId) : null;
  const twc = tab && tab.view && tab.view.webContents;
  if (twc && !twc.isDestroyed()) twc.send('device-mode-changed', deviceMode);
}

// --- Tab management ---
function createTab(projectPath, extraArgs = []) {
  devLog('[main] createTab:', projectPath, extraArgs);
  let realPath;
  try { realPath = realpathSync(projectPath); } catch { realPath = projectPath; }

  // Deduplicate: if already open, switch to it
  for (const [id, tab] of tabs) {
    if (tab.realPath === realPath) {
      switchTab(id);
      return;
    }
  }

  const tabId = nextTabId++;
  const projectName = basename(realPath);

  // Register immediately (loading state) 并立刻置为 active —— tab-bar 里的关闭按钮
  // 由 `.tab.active .tab-close { opacity: 1 }` 控制，loading 期间若 activeTabId 还指向
  // 旧 tab / null，新 tab 上的 × 会全程不可见，用户无法在加载阶段取消。
  tabs.set(tabId, { child: null, port: null, token: null, projectName, realPath, view: null, status: 'loading' });
  activeTabId = tabId;
  broadcastTabs();
  hideWorkspaceSelector();

  // Fork child process with CLEAN env — remove all ccv/proxy env vars from parent
  // This prevents inheriting Web version's ANTHROPIC_BASE_URL or proxy ports
  const childEnv = { ...process.env };
  delete childEnv.CCV_WORKSPACE_MODE;
  delete childEnv.CCV_PROXY_PORT;
  delete childEnv.CCV_PROXY_MODE;
  delete childEnv.CCV_ELECTRON_MULTITAB;
  delete childEnv.ANTHROPIC_BASE_URL;
  childEnv.CCV_PROJECT_DIR = realPath;
  // Worker runs under the Electron binary (no external Node on PATH): this env var
  // makes it behave as a plain Node process — no Chromium, no window, no app bootstrap.
  if (_forkUnderElectron) childEnv.ELECTRON_RUN_AS_NODE = '1';
  else delete childEnv.ELECTRON_RUN_AS_NODE;

  // worker stdio：默认 inherit（行为与原版一致，零 IO 开销）；
  // CCV_DEBUG_WORKER_LOGS=1 时切到 pipe + 写文件（便于排查打包后从 Finder 启动的问题）
  // — Finder 启动 .app 时 inherit 等于丢弃 worker 输出，开关打开后日志落到
  //   ${CCV_LOG_DIR || ~/.claude/cc-viewer}/electron-debug-{ts}-tab{N}.log，自动清理 7 天前旧文件
  const _debugWorkerLogs = process.env.CCV_DEBUG_WORKER_LOGS === '1';
  let _logStream = null;
  if (_debugWorkerLogs) {
    const _logDir = process.env.CCV_LOG_DIR || join(home, '.claude', 'cc-viewer');
    try { mkdirSync(_logDir, { recursive: true }); } catch (err) { devError('[Electron] mkdir log dir failed:', err.message); }
    try {
      const cutoff = Date.now() - LOG_RETENTION_MS;
      for (const f of readdirSync(_logDir)) {
        if (!f.startsWith('electron-debug-') || !f.endsWith('.log')) continue;
        const fp = join(_logDir, f);
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      }
    } catch (err) { devError('[Electron] cleanup old debug logs failed:', err.message); }
    const _logPath = join(_logDir, `electron-debug-${Date.now()}-tab${tabId}.log`);
    _logStream = createWriteStream(_logPath, { flags: 'a' });
    devError(`[Electron] tab ${tabId} debug log → ${_logPath}`);
  }

  // stdio 策略：debug 模式 pipe 到文件日志；dev 模式 inherit 方便终端观察；
  // 打包版一律 ignore——worker 若继承控制台句柄，从终端启动 + QuickEdit 点选黑窗口时
  // 写 stdout 的 worker 会被内核级无限期阻塞（单 tab 永久卡死面），且打包版输出本就无处可看。
  const child = fork(join(__dirname, 'tab-worker.js'), [], {
    execPath: _nodePath,
    cwd: realPath,
    env: childEnv,
    stdio: _debugWorkerLogs
      ? ['ignore', 'pipe', 'pipe', 'ipc']
      : (_isDev ? ['inherit', 'inherit', 'inherit', 'ipc'] : ['ignore', 'ignore', 'ignore', 'ipc']),
    silent: _debugWorkerLogs,
    // Windows：execPath 是真实 node.exe（console-subsystem），GUI 父进程不带 windowsHide
    // 启动它会分配一个可见控制台窗口（用户报告的"多出来的 Node.js 窗口"）。POSIX 上为 no-op。
    windowsHide: true,
  });
  if (_logStream) {
    child.stdout?.pipe(_logStream, { end: false });
    child.stderr?.pipe(_logStream, { end: false });
    child.on('exit', () => { try { _logStream.end(); } catch {} });
  }

  tabs.get(tabId).child = child;

  // Timeout
  const timeout = setTimeout(() => {
    if (tabs.get(tabId)?.status === 'loading') {
      appendDiag('tab:ready-timeout', { tabId, project: tabs.get(tabId)?.projectName, ms: 30000 });
      tabs.get(tabId).status = 'error';
      broadcastTabs();
    }
  }, 30000);

  // fork 失败（execPath 不存在 / 权限）—— 之前完全无人接，主进程直接 crash。
  // 失败后 tab 必须立刻进 error 态：否则会挂在 loading 直到 30s ready-timeout，
  // 用户只看到一个永远转圈的空 tab（issue #129 的表象）。
  child.on('error', (err) => {
    appendDiag('tab:child-error', { tabId, project: tabs.get(tabId)?.projectName, err });
    clearTimeout(timeout);
    const tab = tabs.get(tabId);
    if (tab && tab.status === 'loading') {
      tab.status = 'error';
      broadcastTabs();
    }
  });

  child.on('message', (msg) => {
    devLog(`[main] child msg for tab ${tabId}:`, msg.type, msg.port || '', msg.projectName || '', msg.message || '');
    if (msg.type === 'ready') {
      clearTimeout(timeout);
      const tab = tabs.get(tabId);
      if (!tab) return;
      tab.port = msg.port;
      tab.token = msg.token;
      tab.projectName = msg.projectName || projectName;
      tab.status = 'ready';

      // Create WebContentsView (don't add to content yet — switchTab will manage it)
      const view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: join(__dirname, 'tab-content-preload.js'),
          autoplayPolicy: 'no-user-gesture-required',
        },
      });
      const url = `http://127.0.0.1:${msg.port}${msg.token ? `?token=${msg.token}` : ''}`;
      attachDiagListeners(view.webContents, 'tab', { tabId, port: msg.port, project: tab.projectName });
      attachContextMenu(view.webContents);
      view.webContents.loadURL(url);
      tab.view = view;

      // Push tabId so the renderer can self-identify in approval-broadcast routing.
      view.webContents.once('did-finish-load', () => {
        try { view.webContents.send('tab-id-init', tabId); } catch {}
        // Also send any current aggregated approval state so a reload doesn't lose context.
        broadcastApproval();
      });

      switchTab(tabId);
      broadcastTabs();
    }
    if (msg.type === 'pty-exit') {
      const tab = tabs.get(tabId);
      if (tab) { tab.status = 'exited'; broadcastTabs(); }
      clearPendingForTab(tabId);
    }
    if (msg.type === 'error') {
      clearTimeout(timeout);
      const tab = tabs.get(tabId);
      if (tab) { tab.status = 'error'; broadcastTabs(); }
    }
    // Pending state changes bubbled up by tab-worker's server.js (see _notifyParentPending).
    if (msg.type === 'pending-add' && msg.kind && msg.id != null) {
      recordPendingAdd(tabId, msg.kind, String(msg.id), msg.payload);
    } else if (msg.type === 'pending-remove' && msg.kind && msg.id != null) {
      recordPendingRemove(tabId, msg.kind, String(msg.id));
    }
  });

  child.on('exit', (code, signal) => {
    clearTimeout(timeout);
    const tab = tabs.get(tabId);
    // 非正常退出（segfault / OOM / spawnClaude 失败）记 diag；正常 shutdown 安静。
    if (code !== 0 && code !== null) {
      appendDiag('tab:child-exit', { tabId, project: tab?.projectName, code, signal, status: tab?.status });
    } else if (signal && signal !== 'SIGTERM') {
      appendDiag('tab:child-exit', { tabId, project: tab?.projectName, code, signal, status: tab?.status });
    }
    if (tab && tab.status === 'loading') {
      tab.status = 'error';
      broadcastTabs();
    }
    clearPendingForTab(tabId);
  });

  // Send launch command. When fork() already failed synchronously (bad execPath),
  // the IPC channel is dead and send() throws EPIPE — the error handler above has
  // the real cause, so don't let the follow-on write mask it or reach the top level.
  try {
    child.send({
      type: 'launch',
      path: realPath,
      extraArgs,
      claudePath,
      isNpmVersion,
    });
  } catch (err) {
    appendDiag('tab:child-send-failed', { tabId, project: projectName, err });
  }
}

function switchTab(tabId) {
  const target = tabs.get(tabId);
  if (!target) return;

  // If target tab is still loading (no view yet), just mark it active but keep workspace visible.
  // 但浮层模式必须先收起：否则切到加载中的 tab 会让浮层悬空（视图仍叠着、workspacePopupOpen 仍为 true、activeTabId 已变）。
  if (!target.view) {
    if (workspacePopupOpen) hideWorkspaceSelector();
    activeTabId = tabId;
    broadcastTabs();
    updateWindowTitle();
    return;
  }

  // Remove workspace view and all other tab views from content, show only the target tab
  if (workspaceView && !workspaceView.webContents.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(workspaceView); } catch {}
  }
  if (workspacePopupOpen) { workspacePopupOpen = false; sendWorkspaceMode('full'); } // 切 tab 时浮层让位 + 复位 React 浮层态
  for (const [id, tab] of tabs) {
    if (tab.view) {
      if (id === tabId) {
        // Ensure target is attached and visible
        try { mainWindow.contentView.removeChildView(tab.view); } catch {}
        mainWindow.contentView.addChildView(tab.view);
        tab.view.setVisible(true);
      } else {
        try { mainWindow.contentView.removeChildView(tab.view); } catch {}
      }
    }
  }
  updateLayout();
  activeTabId = tabId;
  broadcastTabs();
  sendDeviceModeToTab(tabId); // 切到的 tab 同步 device mode → 对齐 viewMode（仅不匹配时 reload）
  updateWindowTitle();
}

async function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Confirmation dialog
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Close', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Close Tab',
    message: `Close "${tab.projectName}"?`,
    detail: 'The Claude session will be terminated.',
  });
  if (response !== 0) return;

  // Kill child process
  if (tab.child) {
    if (tab.child.connected) {
      try { tab.child.send({ type: 'shutdown' }); } catch {}
      const forceTimer = setTimeout(() => {
        try { tab.child.kill('SIGKILL'); } catch {}
      }, 5000);
      tab.child.on('exit', () => clearTimeout(forceTimer));
    } else {
      // IPC channel closed, kill with platform-aware escalation
      killChildEscalating(tab.child, 3000);
    }
  }

  // Remove view
  if (tab.view) {
    mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
  }

  tabs.delete(tabId);
  clearPendingForTab(tabId);

  // Switch to another tab or show workspace
  if (tabs.size > 0) {
    const nextId = tabs.keys().next().value;
    switchTab(nextId);
  } else {
    activeTabId = null;
    showWorkspaceSelector();
  }
  broadcastTabs();
  updateWindowTitle();
}

// 懒创建并复用 workspaceView。背景设透明（'#00000000'），让浮层模式下 React 画的半透明遮罩
// 能透出后面的 tab；整页模式下 React 自身画不透明背景，透明视图无副作用。
function ensureWorkspaceView() {
  if (!workspaceView || workspaceView.webContents.isDestroyed()) {
    workspaceView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'workspace-preload.js'),
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    try { workspaceView.setBackgroundColor('#00000000'); } catch {}
    const token = mgmtServerMod.getAccessToken();
    attachDiagListeners(workspaceView.webContents, 'workspace');
    attachContextMenu(workspaceView.webContents);
    // 加载完成后重推当前模式：首次开浮层时 sendWorkspaceMode('popup') 早于 loadURL 完成会丢，靠这里兜底（不再只依赖 React mount 端 request）。
    workspaceView.webContents.on('did-finish-load', () => sendWorkspaceMode(workspacePopupOpen ? 'popup' : 'full'));
    // 渲染进程崩溃：复位浮层标志并丢弃视图，下次开 picker 由 ensureWorkspaceView 重建，避免「崩溃后首次点 + 只清状态不打开」的双击 papercut。
    workspaceView.webContents.on('render-process-gone', () => { workspacePopupOpen = false; workspaceView = null; });
    workspaceView.webContents.loadURL(`http://127.0.0.1:${mgmtPort}${token ? `?token=${token}` : ''}`);
  }
  return workspaceView;
}

// 把当前工作区选择器模式推给 workspaceView 的 React 端（'full' 整页 / 'popup' 浮层）。
function sendWorkspaceMode(mode) {
  const wc = workspaceView && workspaceView.webContents;
  if (wc && !wc.isDestroyed()) wc.send('workspace-mode', mode);
}

// 「+」/Cmd+T 入口：有 tab → 浮层；无 tab → 整页（理论上无 tab 时 tab bar 不显示「+」，这里兜底）。
function openProjectPicker() {
  if (tabs.size > 0) showWorkspacePopup();
  else showWorkspaceSelector();
}

function showWorkspaceSelector() {
  ensureWorkspaceView();
  // Remove all tab views, then add workspace view on top
  for (const tab of tabs.values()) {
    if (tab.view) {
      try { mainWindow.contentView.removeChildView(tab.view); } catch {}
    }
  }
  try { mainWindow.contentView.removeChildView(workspaceView); } catch {}
  mainWindow.contentView.addChildView(workspaceView);
  workspaceView.setVisible(true);
  updateLayout();
  activeTabId = null;
  workspacePopupOpen = false;
  broadcastTabs();
  sendWorkspaceMode('full');
  updateWindowTitle();
}

// 浮层模式：保留当前活动 tab 视图不移除，把 workspaceView 叠在其上置顶（透明背景），
// activeTabId 不变 → tab bar 仍高亮当前 tab、保留「+」与 header 控件。
function showWorkspacePopup() {
  if (tabs.size === 0) { showWorkspaceSelector(); return; } // 无 tab 兜底回整页，避免浮层后无内容
  ensureWorkspaceView();
  try { mainWindow.contentView.removeChildView(workspaceView); } catch {}
  mainWindow.contentView.addChildView(workspaceView);
  workspaceView.setVisible(true);
  updateLayout();
  workspacePopupOpen = true;
  sendWorkspaceMode('popup');
  broadcastTabs();
}

function hideWorkspaceSelector() {
  if (workspaceView && !workspaceView.webContents.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(workspaceView); } catch {}
  }
  workspacePopupOpen = false;
  sendWorkspaceMode('full'); // 收起即把 React 浮层态 / ccv-ws-popup body class 复位，避免隐藏视图上的悬挂状态
}

// --- IPC handlers ---
ipcMain.on('tab-switch', (_, tabId) => switchTab(tabId));
ipcMain.on('tab-close', (_, tabId) => closeTab(tabId));
// 「+」点击：浮层已开 → 再点收起（toggle）；否则按是否有 tab 弹浮层/整页。
ipcMain.on('tab-new', () => {
  if (workspacePopupOpen) { hideWorkspaceSelector(); broadcastTabs(); }
  else openProjectPicker();
});
// 浮层内的关闭按钮 / 点遮罩 / Esc → 收起浮层，露出原 tab。
ipcMain.on('workspace-popup-close', () => {
  if (workspacePopupOpen) { hideWorkspaceSelector(); broadcastTabs(); }
});
// React 端挂载即拉取当前模式，消除首帧竞态（镜像 device-mode 的 request/response）。
ipcMain.on('request-workspace-mode', (event) => {
  if (event.sender && !event.sender.isDestroyed()) {
    event.sender.send('workspace-mode', workspacePopupOpen ? 'popup' : 'full');
  }
});
ipcMain.on('workspace-launch', (_, data) => {
  devLog('[main] workspace-launch IPC:', data);
  createTab(data.path, data.extraArgs);
});
ipcMain.on('approval-jump', (_, tabId) => {
  if (tabId != null && tabs.has(tabId)) switchTab(tabId);
});
// iPad 模式：renderer 发无状态 toggle，main 翻转权威状态并应用；新挂载的 header 用 request 同步初值。
ipcMain.on('toggle-device-mode', () => setDeviceMode(!deviceMode));
ipcMain.on('request-device-mode', (event) => {
  if (event.sender && !event.sender.isDestroyed()) event.sender.send('device-mode-changed', deviceMode);
});
// tab bar 挂载即拉取当前活动 tab 已缓存的 header 模型，消除 did-finish-load 与首次 push 的竞态。
ipcMain.on('request-header-model', (event) => {
  if (!event.sender || event.sender.isDestroyed()) return;
  const hm = activeTabId != null ? (tabs.get(activeTabId)?.headerModel ?? null) : null;
  event.sender.send('header-model', hm, activeTabId);
});
// Header 控件迁移：活动 tab 的 React header 把「迁移到 tab bar 的控件」模型推上来，main 缓存到该 tab，
// 若它是活动 tab 则转发给 tab bar 渲染。tab bar 的点击回传 header-action → 转发给当前活动 tab 执行。
ipcMain.on('set-header-model', (event, model) => {
  const id = _resolveSenderTabId(event.sender);
  if (id == null) return;
  const tab = tabs.get(id);
  if (!tab) return;
  tab.headerModel = model;
  if (id === activeTabId && tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('header-model', model, id);
  }
});
ipcMain.on('header-action', (_event, payload) => {
  // 优先投递给「按钮所属 tab」（tab bar 随模型回传 tabId）；切 tab 竞态下不会误投到新活动 tab。
  // 无 tabId（兜底/旧路径）时退回当前活动 tab。
  const targetId = (payload && payload.tabId != null && tabs.has(payload.tabId)) ? payload.tabId : activeTabId;
  const tab = targetId != null ? tabs.get(targetId) : null;
  const wc = tab && tab.view && tab.view.webContents;
  // win32 HTML 菜单栏:点 File/Edit/View/Window 时附上已翻译的菜单模型,
  // React 端(AppHeader)据此渲染跟随皮肤的下拉,前端零 i18n key。展开拷贝、不原地改入参。
  const fwd = (payload && payload.type === 'menuBarOpen')
    ? { ...payload, menus: serializeMenuModel(t, process.platform) }
    : payload;
  if (wc && !wc.isDestroyed()) wc.send('header-action', fwd);
});
// win32 HTML 菜单下拉的叶子点击(React 端经 tab-content-preload 发来)。
// sender 校验对标 set-approval-pref:挡掉 tab 销毁后的延迟事件触发 close-window 等全局命令。
ipcMain.on('menu-command', (event, id) => {
  if (!event.sender || event.sender.isDestroyed()) return;
  dispatchMenuCommand(id);
});
// React 下拉开/关状态 → tab bar(打开期间 hover 相邻顶级菜单按钮即切换,原生菜单栏惯例)。
ipcMain.on('menu-bar-state', (event, open) => {
  if (!event.sender || event.sender.isDestroyed()) return;
  if (tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
    tabBarView.webContents.send('menu-bar-state', !!open);
  }
});

// Resolve sender's tabId by reverse-scanning the tabs Map. O(n) but n is small (<10).
// Used for PTY plan IPC where the sender (chat WebContentsView) is the authority on which tab
// owns the message. Falls back to client-supplied tabId if reverse lookup fails (e.g. early init).
function _resolveSenderTabId(sender) {
  if (!sender) return null;
  for (const [id, t] of tabs) {
    if (t.view && t.view.webContents === sender) return id;
  }
  return null;
}

ipcMain.on('pty-plan-pending', (event, msg) => {
  if (!msg || msg.id == null) return;
  const tabId = _resolveSenderTabId(event.sender) ?? (msg.tabId ?? null);
  if (tabId == null) return;
  recordPendingAdd(tabId, 'ptyPlan', String(msg.id), msg.payload || {});
});

ipcMain.on('pty-plan-resolved', (event, msg) => {
  if (!msg || msg.id == null) return;
  const tabId = _resolveSenderTabId(event.sender) ?? (msg.tabId ?? null);
  if (tabId == null) return;
  recordPendingRemove(tabId, 'ptyPlan', String(msg.id));
});

// 渲染端兜底：WS 断连 / ChatView unmount 时 server 不一定推 ask-hook-resolved，
// renderer 通过该 IPC 让 main 同步清 pendingByTab[tabId].ask。
// 与 server.js 的 ask-hook-resolved/sdk-ask-resolved 路径并行；recordPendingRemove 对不存在的 id 是 no-op，重复调用安全。
ipcMain.on('ask-resolved', (event, msg) => {
  if (!msg || msg.id == null) return;
  const tabId = _resolveSenderTabId(event.sender) ?? (msg.tabId ?? null);
  if (tabId == null) return;
  recordPendingRemove(tabId, 'ask', String(msg.id));
});

// Renderer 同步用户偏好(目前仅 notifyOnlyWhenHidden 影响 main 进程的通知行为;
// 其他字段如 modalEnabled / soundEnabled 仅在 renderer 内消费,这里 forward-compatible 接收但不使用)。
// 任何 tab 改了都会推同一份(prefs 全局共享单一 preferences.json),最后一次 win;无 tab 隔离需求。
ipcMain.on('set-approval-pref', (event, prefs) => {
  // 防御加固:contextIsolation 已经隔离了 renderer/main world,这里再校验 sender 还在/未销毁,
  // 避免 webview tab 销毁后的延迟事件继续修改全局偏好。
  if (!event.sender || event.sender.isDestroyed()) return;
  if (!prefs || typeof prefs !== 'object') return;
  if (typeof prefs.notifyOnlyWhenHidden === 'boolean') {
    _notifyOnlyWhenHidden = prefs.notifyOnlyWhenHidden;
  }
});

// --- Cleanup ---
let isQuitting = false;
async function cleanupAll() {
  if (isQuitting) return;
  isQuitting = true;

  // 退出兜底:窗口还活着就把最终几何同步落盘(去抖 timer 可能还没到点)。
  if (_winStateTimer) { clearTimeout(_winStateTimer); _winStateTimer = null; }
  saveWinStateNow();

  const promises = [];
  for (const [id, tab] of tabs) {
    if (tab.child && tab.child.connected) {
      try { tab.child.send({ type: 'shutdown' }); } catch {}
      promises.push(new Promise(resolve => {
        const timer = setTimeout(() => { try { tab.child.kill('SIGKILL'); } catch {} resolve(); }, 5000);
        tab.child.on('exit', () => { clearTimeout(timer); resolve(); });
      }));
    } else if (tab.child) {
      // Child process exists but IPC channel is closed, kill with platform-aware escalation
      promises.push(killChildEscalating(tab.child, 3000));
    }
  }
  await Promise.all(promises);
  if (mgmtServerMod) await mgmtServerMod.stopViewer().catch(() => {});
  // 退出收尾：清掉去抖 timer（防悬挂回调对已 destroy 的 view 做无谓广播），
  // 并等 diag 异步队列落盘——否则退出前最后几条诊断（child-exit 等）会丢。
  if (_aggregateTimer) { clearTimeout(_aggregateTimer); _aggregateTimer = null; }
  await diagFlush().catch(() => {});
}

// --- App menu ---
// 菜单结构的单一数据源在 electron/menu-model.js(原生菜单与 win32 HTML 菜单栏共用)。
// 文案经 server/i18n.js t() 翻译;preferences.json 的 lang 变化时 watchTheme 会重建。
// 缩放(Cmd/Ctrl +/-/0)仍由 renderer 的「显示大小」接管,模型里不含 zoom 条目,
// 否则两处各调 setZoomFactor 会叠加导致双重缩放。
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    ...buildMenuModel().map((menu) => ({
      label: t(menu.labelKey),
      submenu: [
        ...menu.items.map((it) => {
          if (it.type === 'separator') return { type: 'separator' };
          // edit 类条目走 role:作用于「当前聚焦」webContents(workspace 选择器里也要能粘贴);
          // darwinRole:macOS 保留原生语义(zoom ≠ maximize,不改变 mac 既有行为)。
          if (it.role) return { role: it.role, label: t(it.labelKey), accelerator: it.accel };
          if (it.darwinRole && isMac) return { role: it.darwinRole, label: t(it.labelKey) };
          return { label: t(it.labelKey), accelerator: it.accel, click: () => dispatchMenuCommand(it.id) };
        }),
        // Tab switching shortcuts: Cmd+1-9(仅挂在 Window 菜单,隐藏条目只为注册 accelerator)
        ...(menu.id === 'window' ? Array.from({ length: 9 }, (_, i) => ({
          label: `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          click: () => {
            const ids = [...tabs.keys()];
            if (ids[i]) switchTab(ids[i]);
          },
        })) : []),
      ],
    })),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 菜单命令统一派发:原生菜单 click 与 win32 HTML 菜单(React 下拉经 menu-command IPC)共用。
// 编辑/视图类命令显式指向「活动 tab 的内容视图」—— 点 HTML 菜单时焦点在 tab-bar view,
// 若走 role 派发会作用到 tab-bar 自己(reload 会把 tab 栏刷掉)。
// 零 tab(workspace 选择器)时 tab 类命令为 no-op —— 有意行为:选择器不需要 reload/编辑命令,
// 与改前 role 派发(刷聚焦视图)的差异已接受。
function dispatchMenuCommand(id) {
  const wc = activeTabId != null ? tabs.get(activeTabId)?.view?.webContents : null;
  const tabWc = (wc && !wc.isDestroyed()) ? wc : null;
  switch (id) {
    case 'new-tab': openProjectPicker(); break;
    case 'close-tab': if (activeTabId != null) closeTab(activeTabId); break;
    case 'undo': case 'redo': case 'cut': case 'copy': case 'paste': case 'selectAll':
      if (tabWc) tabWc[id]();
      break;
    case 'reload': if (tabWc) tabWc.reload(); break;
    case 'force-reload': if (tabWc) tabWc.reloadIgnoringCache(); break;
    case 'toggle-devtools': if (tabWc) tabWc.toggleDevTools(); break;
    case 'toggle-fullscreen': if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); break;
    case 'minimize': if (mainWindow) mainWindow.minimize(); break;
    case 'maximize':
      if (mainWindow) { if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); }
      break;
    case 'close-window': if (mainWindow) mainWindow.close(); break;
    case 'prev-tab': cycleTab(-1); break;
    case 'next-tab': cycleTab(1); break;
  }
}

// 已翻译的菜单模型 + tab-bar 文案,经 IPC 发给 tab-bar(win32 渲染 HTML 菜单栏)。
// lang 变化时 watchTheme 会重发。
function menuModelPayload() {
  return {
    menus: serializeMenuModel(t, process.platform),
    uiStrings: {
      newTab: t('electron.tabbar.newTab'),
      toIpad: t('electron.tabbar.toIpad'),
      toPc: t('electron.tabbar.toPc'),
      menu: t('electron.tabbar.menu'),
    },
  };
}

function broadcastMenuModel() {
  if (tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
    try { tabBarView.webContents.send('menu-model', menuModelPayload()); } catch {}
  }
}

// --- 右键菜单 ---
// Electron 默认没有任何右键菜单(浏览器版才有 Chrome 的)。给内容视图补一份原生编辑菜单,
// 文案走 server/i18n.js。页面里自带 React 右键菜单的区域(文件树等)会 preventDefault,
// 此时 context-menu 事件不触发,不会出现双重菜单。原生 popup 样式跟随 OS,无法跟随应用皮肤(已接受)。
function attachContextMenu(wc) {
  wc.on('context-menu', (_e, params) => {
    const items = [];
    const ef = params.editFlags || {};
    if (params.isEditable) {
      items.push(
        { label: t('electron.menu.undo'), role: 'undo', enabled: !!ef.canUndo },
        { label: t('electron.menu.redo'), role: 'redo', enabled: !!ef.canRedo },
        { type: 'separator' },
        { label: t('electron.menu.cut'), role: 'cut', enabled: !!ef.canCut },
        { label: t('electron.menu.copy'), role: 'copy', enabled: !!ef.canCopy },
        { label: t('electron.menu.paste'), role: 'paste', enabled: !!ef.canPaste },
        { label: t('electron.menu.selectAll'), role: 'selectAll', enabled: !!ef.canSelectAll },
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      items.push({ label: t('electron.menu.copy'), role: 'copy' });
    }
    if (params.linkURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: t('electron.menu.copyLink'), click: () => clipboard.writeText(params.linkURL) });
    }
    if (!items.length) return;
    try { Menu.buildFromTemplate(items).popup({ window: mainWindow }); } catch {}
  });
}

function cycleTab(direction) {
  const ids = [...tabs.keys()];
  if (ids.length === 0) return;
  const idx = ids.indexOf(activeTabId);
  const next = (idx + direction + ids.length) % ids.length;
  switchTab(ids[next]);
}

// --- Theme watching ---
// 之前用 watchFile(interval:2000) 轮询 prefs，多 tab 切主题 → 其它 tab 的 tab-bar 最多滞后 2s。
// fs.watch 走 kqueue/inotify 事件驱动，~0ms 滞后，且不再周期性 stat 浪费资源。
// 生命周期：watcher 跟随 main process 进程结束自动清理，不显式 close —— 单一全局实例，
// watchTheme() 不会重入（在 createWindow → ready 路径里只调用一次）。
function watchTheme() {
  let warnedCorrupt = false;
  try {
    const prefsPath = join(getClaudeConfigDir(), 'cc-viewer', 'preferences.json');
    if (!existsSync(prefsPath)) {
      // 首装尚无 preferences.json:直接 return 会让 watcher 永不启动(主题/语言热切换失效到重启)。
      // 改为 watch 所在目录,等文件出现后再切到文件级 watch。
      const dir = dirname(prefsPath);
      if (!existsSync(dir)) return; // 目录都没有(异常环境),放弃热切换,不影响主流程
      const dirWatcher = watch(dir, () => {
        if (existsSync(prefsPath)) {
          try { dirWatcher.close(); } catch {}
          watchTheme();
        }
      });
      return;
    }
    // 读取 theme + lang:写入瞬间可能拿到不完整 JSON,沿用「读失败回落上次已知值」策略。
    const readPrefs = () => {
      try {
        const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'));
        warnedCorrupt = false;
        return {
          theme: prefs.themeColor === 'light' ? 'light' : 'dark',
          lang: typeof prefs.lang === 'string' ? prefs.lang : null,
        };
      } catch (err) {
        // prefs 写入瞬间被读到可能拿到不完整 JSON；仅首次 warn，避免连续事件刷屏
        if (!warnedCorrupt) {
          warnedCorrupt = true;
          devWarn('[watchTheme] preferences.json read/parse failed, falling back:', err.message);
        }
        return null;
      }
    };
    const applyOverlayTheme = (theme) => {
      // win32:原生 最小化/最大化/关闭 按钮区域跟随皮肤换色;backgroundColor 同步防止 resize 露底色。
      if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
      const c = THEME_COLORS[theme] || THEME_COLORS.dark;
      try {
        if (typeof mainWindow.setTitleBarOverlay === 'function') {
          mainWindow.setTitleBarOverlay({ color: c.barBg, symbolColor: c.sym, height: TAB_BAR_HEIGHT });
        }
        if (typeof mainWindow.setBackgroundColor === 'function') mainWindow.setBackgroundColor(c.winBg);
      } catch (err) {
        devWarn('[watchTheme] setTitleBarOverlay failed:', err.message);
      }
    };
    let current = readPrefs() || { theme: 'dark', lang: null };
    if (tabBarView?.webContents) tabBarView.webContents.send('theme-changed', current.theme);
    applyOverlayTheme(current.theme);
    // writeFileSync 在写入过程中可能触发多次 change 事件（特别是 macOS 下原子替换路径）；
    // 用 readPrefs + diff 自己做幂等，重复事件无副作用。
    watch(prefsPath, () => {
      const next = readPrefs();
      if (!next) return;
      if (next.theme !== current.theme) {
        current = { ...current, theme: next.theme };
        if (tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
          tabBarView.webContents.send('theme-changed', current.theme);
        }
        applyOverlayTheme(current.theme);
      }
      // UI 切语言 → server 已 setLang 并写入 prefs;主进程跟随:重建原生菜单 + 重发 HTML 菜单模型。
      if (next.lang && next.lang !== current.lang) {
        current = { ...current, lang: next.lang };
        setLang(next.lang);
        buildMenu();
        broadcastMenuModel();
      }
    });
  } catch (err) {
    devWarn('[watchTheme] init failed:', err.message);
  }
}

// --- Single instance lock ---
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('before-quit', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      // 有打开的 tab 时，弹确认框
      if (tabs.size > 0 && mainWindow && !mainWindow.isDestroyed()) {
        const names = [...tabs.values()].map(tb => tb.projectName).join(', ');
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: [t('electron.quit.buttonQuit'), t('electron.quit.buttonCancel')],
          defaultId: 1,
          cancelId: 1,
          title: t('electron.quit.title'),
          message: t('electron.quit.message', { count: tabs.size }),
          detail: `${names}\n\n${t('electron.quit.detail')}`,
        });
        if (response !== 0) return; // 用户取消
      }
      await cleanupAll();
      app.exit(0);
    }
  });

  app.whenReady().then(async () => {
    // Windows 任务栏分组/通知身份:须与 electron-builder.yml 的 appId 一致,否则任务栏按钮分裂。
    if (process.platform === 'win32') app.setAppUserModelId('com.ccviewer.app');

    // Start management server
    await startMgmtServer();

    buildMenu();

    // 恢复上次窗口几何(显示器布局可能已变,validateState 越界则回落默认居中)。
    let savedWinState = null;
    try {
      savedWinState = validateState(
        loadState(readFileSync, WINDOW_STATE_FILE),
        screen.getAllDisplays().map((d) => d.workArea),
      );
    } catch (err) {
      devWarn('[main] restore window state failed:', err?.message || err);
    }

    // Create window
    // - backgroundColor:首帧用主题底色绘制,消除暗色皮肤下启动白屏闪烁;
    // - win32:隐藏原生标题栏,titleBarOverlay 只保留原生 最小化/最大化/关闭(保住 Win11
    //   Snap Layouts 与双击最大化),配色跟随皮肤,高度对齐 50px tab bar —— tab bar 即标题栏;
    // - macOS/Linux:维持原 hiddenInset 行为不变。
    const _themeColors = THEME_COLORS[_startupTheme];
    mainWindow = new BaseWindow({
      width: savedWinState?.width ?? 1400,
      height: savedWinState?.height ?? 900,
      ...(savedWinState ? { x: savedWinState.x, y: savedWinState.y } : {}),
      minWidth: 800,
      minHeight: 600,
      title: 'CC Viewer',
      backgroundColor: _themeColors.winBg,
      ...(process.platform === 'win32' ? {
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: _themeColors.barBg, symbolColor: _themeColors.sym, height: TAB_BAR_HEIGHT },
      } : {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 17 },
      }),
    });
    if (savedWinState?.maximized) mainWindow.maximize();
    // 原生菜单栏只隐藏不注销:accelerator 仍生效(setMenu(null) 会连快捷键一起杀掉;
    // autoHideMenuBar 则按 Alt 会唤回原生英文菜单,与 HTML 菜单栏打架)。
    if (process.platform === 'win32') {
      try { mainWindow.setMenuBarVisibility(false); } catch {}
    }

    // Tab bar
    tabBarView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'tab-preload.js'),
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    attachDiagListeners(tabBarView.webContents, 'tabBar');
    tabBarView.webContents.loadFile(join(__dirname, 'tab-bar.html'));
    mainWindow.contentView.addChildView(tabBarView);

    // 全屏状态广播：进入全屏后 macOS 红黄绿按钮隐藏，tab-bar 需移除占位
    const sendFullscreenState = () => {
      if (!tabBarView?.webContents || tabBarView.webContents.isDestroyed()) return;
      try { tabBarView.webContents.send('fullscreen-changed', !!mainWindow?.isFullScreen?.()); } catch {}
    };
    tabBarView.webContents.on('did-finish-load', sendFullscreenState);
    // 菜单模型(已翻译)推给 tab bar:win32 渲染 HTML 菜单栏 + 各平台 tooltip 文案。
    tabBarView.webContents.on('did-finish-load', broadcastMenuModel);
    mainWindow.on('enter-full-screen', sendFullscreenState);
    mainWindow.on('leave-full-screen', sendFullscreenState);
    // 设备模式下经历 OS 全屏往返：离开全屏后系统还原「进全屏前」的窄窗，但若期间宽度被改，
    // 据权威 deviceMode 重新收窄，保证 deviceMode=true ⇔ 窗口=DEVICE_WIDTH 不漂移。
    mainWindow.on('leave-full-screen', () => {
      if (deviceMode && mainWindow && !mainWindow.isFullScreen()) {
        const b = mainWindow.getBounds();
        if (b.width !== DEVICE_WIDTH) mainWindow.setBounds({ x: b.x, y: b.y, width: DEVICE_WIDTH, height: b.height });
        mainWindow.setMinimumSize(DEVICE_MIN_WIDTH, WIN_MIN_HEIGHT);
        updateLayout();
      }
    });

    // When the user brings the window back to focus, stop the taskbar/dock flash and clear notifications already opened on screen.
    mainWindow.on('focus', () => {
      if (_isFlashing) {
        try { mainWindow.flashFrame(false); } catch {}
        _isFlashing = false;
      }
    });

    // Show workspace selector
    showWorkspaceSelector();
    updateLayout();

    // Watch theme
    watchTheme();

    // Resize handler
    mainWindow.on('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateLayout, 16);
    });

    // 窗口几何持久化:resize/move/最大化切换 都去抖落盘(退出路径常走 app.exit,
    // 不能只依赖 close 时机;cleanupAll 里另有一次兜底同步保存)。
    mainWindow.on('resize', scheduleWinStateSave);
    mainWindow.on('move', scheduleWinStateSave);
    mainWindow.on('maximize', scheduleWinStateSave);
    mainWindow.on('unmaximize', scheduleWinStateSave);

    mainWindow.on('close', async (e) => {
      if (isQuitting) return; // before-quit 已处理
      if (tabs.size > 0 && mainWindow && !mainWindow.isDestroyed()) {
        e.preventDefault();
        const names = [...tabs.values()].map(tb => tb.projectName).join(', ');
        const { response } = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: [t('electron.quit.buttonQuit'), t('electron.quit.buttonCancel')],
          defaultId: 1,
          cancelId: 1,
          title: t('electron.quit.title'),
          message: t('electron.quit.message', { count: tabs.size }),
          detail: `${names}\n\n${t('electron.quit.detail')}`,
        });
        if (response !== 0) return;
        await cleanupAll();
        app.exit(0);
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('window-all-closed', async () => {
    await cleanupAll();
    app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow) {
      // Re-create window — but mgmt server is already running
      app.whenReady().then(() => {
        // Simplified: just quit if window was closed
      });
    }
  });
}

// .finally 而非 .then：cleanupAll reject 时 .then 链断裂会让 app.exit 永不执行（进程吊死）。
process.on('SIGINT', () => { cleanupAll().finally(() => app.exit(0)); });
process.on('SIGTERM', () => { cleanupAll().finally(() => app.exit(0)); });
