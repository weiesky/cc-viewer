/**
 * CC Viewer Electron — Multi-Tab Architecture
 *
 * BaseWindow with:
 * - tabBarView (36px, tab-bar.html)
 * - workspaceView (project selector, shown when no tabs / adding new)
 * - per-tab WebContentsView (each loads its own server port)
 *
 * Each tab = fork('tab-worker.js') → isolated proxy + server + PTY
 */
import { app, BaseWindow, WebContentsView, Menu, ipcMain, dialog, Notification } from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, basename, delimiter } from 'path';
import { fork, execSync } from 'child_process';
import { realpathSync, existsSync, readFileSync, watch, mkdirSync, createWriteStream, readdirSync, statSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
// Windows 下 import(绝对路径) 会被 Node 把 'c:' 当 URL scheme 拒绝 (ERR_UNSUPPORTED_ESM_URL_SCHEME)。
// pathToFileURL(p).href 在 POSIX 产出 file:///abs/.. 在 Windows 产出 file:///C:/.. —— 两平台 ESM 等价。
const { t } = await import(pathToFileURL(join(rootDir, 'i18n.js')).href);
const { getClaudeConfigDir, LOG_DIR } = await import(pathToFileURL(join(rootDir, 'findcc.js')).href);

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
      console.error('[Electron] Injected proxy from shell profile:', process.env.HTTP_PROXY || process.env.HTTPS_PROXY);
    }
  } catch (err) {
    console.error('[Electron] Failed to resolve shell env:', err.message);
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
let _nodePath = process.execPath;
if (process.versions.electron && !app.isPackaged) {
  try {
    _nodePath = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8' }).trim();
    if (process.platform === 'win32') _nodePath = _nodePath.split('\n')[0].trim();
  } catch { _nodePath = process.platform === 'win32' ? 'node' : '/usr/local/bin/node'; }
}

const { resolveNpmClaudePath, resolveNativePath } = await import(pathToFileURL(join(rootDir, 'findcc.js')).href);
let claudePath = resolveNpmClaudePath();
let isNpmVersion = !!claudePath;
if (!claudePath) claudePath = resolveNativePath();

// Fallback: directly check known npm global locations
if (!claudePath) {
  const knownPaths = [
    join(home, '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    join(home, '.npm-global', 'lib', 'node_modules', '@ali', 'claude-code', 'cli.js'),
  ];
  for (const p of knownPaths) {
    if (existsSync(p)) {
      claudePath = p;
      isNpmVersion = true;
      break;
    }
  }
}

if (!claudePath) {
  process.env.CCV_CLAUDE_MISSING = '1';
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
  const { startProxy } = await import(pathToFileURL(join(rootDir, 'proxy.js')).href);
  const proxyPort = await startProxy();
  process.env.CCV_PROXY_PORT = String(proxyPort);
  mgmtServerMod = await import(pathToFileURL(join(rootDir, 'server.js')).href);
  await mgmtServerMod.startViewer();
  mgmtPort = mgmtServerMod.getPort();
  if (claudePath) {
    mgmtServerMod.setWorkspaceClaudeArgs([]);
    mgmtServerMod.setWorkspaceClaudePath(claudePath, isNpmVersion);
  }
  mgmtServerMod.setLaunchCallback((path, extraArgs) => createTab(path, extraArgs));
}

// --- Tab state ---
const TAB_BAR_HEIGHT = 60;
// debug worker 日志保留窗口（CCV_DEBUG_WORKER_LOGS=1 时使用）
const LOG_RETENTION_MS = 7 * 24 * 3600 * 1000;
const tabs = new Map(); // tabId -> { child, port, token, projectName, realPath, view, status }
let nextTabId = 1;
let activeTabId = null;

// --- Window ---
let mainWindow = null;
let tabBarView = null;
let workspaceView = null;

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
  console.warn('[main] failed to load notifyOnlyWhenHidden from preferences.json:', e?.message || e);
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
  aggregateApproval();
}

function recordPendingRemove(tabId, kind, id) {
  const tabState = pendingByTab.get(tabId);
  if (!tabState) { aggregateApproval(); return; }
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
  aggregateApproval();
}

function clearPendingForTab(tabId) {
  if (pendingByTab.delete(tabId)) {
    // Also clear any notifiedKeys belonging to this tab
    for (const k of [...notifiedKeys]) {
      if (k.startsWith(`${tabId}|`)) notifiedKeys.delete(k);
    }
    aggregateApproval();
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

// --- Tab management ---
function createTab(projectPath, extraArgs = []) {
  console.log('[main] createTab:', projectPath, extraArgs);
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

  // worker stdio：默认 inherit（行为与原版一致，零 IO 开销）；
  // CCV_DEBUG_WORKER_LOGS=1 时切到 pipe + 写文件（便于排查打包后从 Finder 启动的问题）
  // — Finder 启动 .app 时 inherit 等于丢弃 worker 输出，开关打开后日志落到
  //   ${CCV_LOG_DIR || ~/.claude/cc-viewer}/electron-debug-{ts}-tab{N}.log，自动清理 7 天前旧文件
  const _debugWorkerLogs = process.env.CCV_DEBUG_WORKER_LOGS === '1';
  let _logStream = null;
  if (_debugWorkerLogs) {
    const _logDir = process.env.CCV_LOG_DIR || join(home, '.claude', 'cc-viewer');
    try { mkdirSync(_logDir, { recursive: true }); } catch (err) { console.error('[Electron] mkdir log dir failed:', err.message); }
    try {
      const cutoff = Date.now() - LOG_RETENTION_MS;
      for (const f of readdirSync(_logDir)) {
        if (!f.startsWith('electron-debug-') || !f.endsWith('.log')) continue;
        const fp = join(_logDir, f);
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      }
    } catch (err) { console.error('[Electron] cleanup old debug logs failed:', err.message); }
    const _logPath = join(_logDir, `electron-debug-${Date.now()}-tab${tabId}.log`);
    _logStream = createWriteStream(_logPath, { flags: 'a' });
    console.error(`[Electron] tab ${tabId} debug log → ${_logPath}`);
  }

  const child = fork(join(__dirname, 'tab-worker.js'), [], {
    execPath: _nodePath,
    cwd: realPath,
    env: childEnv,
    stdio: _debugWorkerLogs
      ? ['ignore', 'pipe', 'pipe', 'ipc']
      : ['inherit', 'inherit', 'inherit', 'ipc'],
    silent: _debugWorkerLogs,
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
      tabs.get(tabId).status = 'error';
      broadcastTabs();
    }
  }, 30000);

  child.on('message', (msg) => {
    console.log(`[main] child msg for tab ${tabId}:`, msg.type, msg.port || '', msg.projectName || '', msg.message || '');
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

  child.on('exit', () => {
    clearTimeout(timeout);
    const tab = tabs.get(tabId);
    if (tab && tab.status === 'loading') {
      tab.status = 'error';
      broadcastTabs();
    }
    clearPendingForTab(tabId);
  });

  // Send launch command
  child.send({
    type: 'launch',
    path: realPath,
    extraArgs,
    claudePath,
    isNpmVersion,
  });
}

function switchTab(tabId) {
  const target = tabs.get(tabId);
  if (!target) return;

  // If target tab is still loading (no view yet), just mark it active but keep workspace visible
  if (!target.view) {
    activeTabId = tabId;
    broadcastTabs();
    updateWindowTitle();
    return;
  }

  // Remove workspace view and all other tab views from content, show only the target tab
  if (workspaceView && !workspaceView.webContents.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(workspaceView); } catch {}
  }
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

function showWorkspaceSelector() {
  if (!workspaceView || workspaceView.webContents.isDestroyed()) {
    workspaceView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'workspace-preload.js'),
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    const token = mgmtServerMod.getAccessToken();
    workspaceView.webContents.loadURL(`http://127.0.0.1:${mgmtPort}${token ? `?token=${token}` : ''}`);
  }
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
  broadcastTabs();
  updateWindowTitle();
}

function hideWorkspaceSelector() {
  if (workspaceView && !workspaceView.webContents.isDestroyed()) {
    try { mainWindow.contentView.removeChildView(workspaceView); } catch {}
  }
}

// --- IPC handlers ---
ipcMain.on('tab-switch', (_, tabId) => switchTab(tabId));
ipcMain.on('tab-close', (_, tabId) => closeTab(tabId));
ipcMain.on('tab-new', () => showWorkspaceSelector());
ipcMain.on('workspace-launch', (_, data) => {
  console.log('[main] workspace-launch IPC:', data);
  createTab(data.path, data.extraArgs);
});
ipcMain.on('approval-jump', (_, tabId) => {
  if (tabId != null && tabs.has(tabId)) switchTab(tabId);
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
}

// --- App menu ---
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
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
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => showWorkspaceSelector() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => { if (activeTabId) closeTab(activeTabId); } },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { role: 'close' },
        { type: 'separator' },
        // Tab switching shortcuts: Cmd+1-9
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          click: () => {
            const ids = [...tabs.keys()];
            if (ids[i]) switchTab(ids[i]);
          },
        })),
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: () => cycleTab(-1) },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: () => cycleTab(1) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    if (!existsSync(prefsPath)) return;
    const readTheme = () => {
      try {
        const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'));
        warnedCorrupt = false;
        return prefs.themeColor === 'light' ? 'light' : 'dark';
      } catch (err) {
        // prefs 写入瞬间被读到可能拿到不完整 JSON；仅首次 warn，避免连续事件刷屏
        if (!warnedCorrupt) {
          warnedCorrupt = true;
          console.warn('[watchTheme] preferences.json read/parse failed, falling back to dark:', err.message);
        }
        return 'dark';
      }
    };
    let currentTheme = readTheme();
    if (tabBarView?.webContents) tabBarView.webContents.send('theme-changed', currentTheme);
    // writeFileSync 在写入过程中可能触发多次 change 事件（特别是 macOS 下原子替换路径）；
    // 用 readTheme + diff 自己做幂等，重复事件无副作用。
    watch(prefsPath, () => {
      const newTheme = readTheme();
      if (newTheme !== currentTheme) {
        currentTheme = newTheme;
        if (tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
          tabBarView.webContents.send('theme-changed', currentTheme);
        }
      }
    });
  } catch (err) {
    console.warn('[watchTheme] init failed:', err.message);
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
    // Start management server
    await startMgmtServer();

    buildMenu();

    // Create window
    mainWindow = new BaseWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: 'CC Viewer',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 22 },
    });

    // Tab bar
    tabBarView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'tab-preload.js'),
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    tabBarView.webContents.loadFile(join(__dirname, 'tab-bar.html'));
    mainWindow.contentView.addChildView(tabBarView);

    // 全屏状态广播：进入全屏后 macOS 红黄绿按钮隐藏，tab-bar 需移除占位
    const sendFullscreenState = () => {
      if (!tabBarView?.webContents || tabBarView.webContents.isDestroyed()) return;
      try { tabBarView.webContents.send('fullscreen-changed', !!mainWindow?.isFullScreen?.()); } catch {}
    };
    tabBarView.webContents.on('did-finish-load', sendFullscreenState);
    mainWindow.on('enter-full-screen', sendFullscreenState);
    mainWindow.on('leave-full-screen', sendFullscreenState);

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

process.on('SIGINT', () => { cleanupAll().then(() => app.exit(0)); });
process.on('SIGTERM', () => { cleanupAll().then(() => app.exit(0)); });
