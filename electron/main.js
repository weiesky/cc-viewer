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
import { app, BaseWindow, WebContentsView, Menu, ipcMain, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { fork, execSync } from 'child_process';
import { realpathSync, existsSync, readFileSync, watchFile, unwatchFile } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

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
    if (_shellPath) {
      const existing = new Set((process.env.PATH || '').split(':'));
      const merged = _shellPath.split(':').filter(p => !existing.has(p));
      if (merged.length) {
        process.env.PATH = _shellPath + ':' + process.env.PATH;
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
const home = app.getPath('home');
const pathDirs = (process.env.PATH || '').split(':');
const extraPaths = ['/usr/local/bin', '/opt/homebrew/bin', join(home, '.npm-global', 'bin'), join(home, '.nvm', 'versions', 'node')];
for (const p of extraPaths) {
  if (!pathDirs.includes(p)) pathDirs.push(p);
}
process.env.PATH = pathDirs.join(':');

// --- Resolve real Node.js path (Electron's process.execPath is the Electron binary) ---
let _nodePath = process.execPath;
if (process.versions.electron) {
  try {
    _nodePath = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8' }).trim();
    if (process.platform === 'win32') _nodePath = _nodePath.split('\n')[0].trim();
  } catch { _nodePath = process.platform === 'win32' ? 'node' : '/usr/local/bin/node'; }
}

const { resolveNpmClaudePath, resolveNativePath } = await import(join(rootDir, 'findcc.js'));
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

// --- Management server for workspace selector ---
process.env.CCV_CLI_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_ELECTRON_MULTITAB = '1'; // Tell server not to spawn Claude on launch

let mgmtServerMod = null;
let mgmtPort = null;

async function startMgmtServer() {
  const { startProxy } = await import(join(rootDir, 'proxy.js'));
  const proxyPort = await startProxy();
  process.env.CCV_PROXY_PORT = String(proxyPort);
  mgmtServerMod = await import(join(rootDir, 'server.js'));
  await mgmtServerMod.startViewer();
  mgmtPort = mgmtServerMod.getPort();
  if (claudePath) {
    mgmtServerMod.setWorkspaceClaudeArgs([]);
    mgmtServerMod.setWorkspaceClaudePath(claudePath, isNpmVersion);
  }
  mgmtServerMod.setLaunchCallback((path, extraArgs) => createTab(path, extraArgs));
}

// --- Tab state ---
const TAB_BAR_HEIGHT = 36;
const tabs = new Map(); // tabId -> { child, port, token, projectName, realPath, view, status }
let nextTabId = 1;
let activeTabId = null;

// --- Window ---
let mainWindow = null;
let tabBarView = null;
let workspaceView = null;

function getTabList() {
  return [...tabs.entries()].map(([id, t]) => ({
    id, name: t.projectName || basename(t.realPath || ''), status: t.status,
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

  // Register immediately (loading state)
  tabs.set(tabId, { child: null, port: null, token: null, projectName, realPath, view: null, status: 'loading' });
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

  const child = fork(join(__dirname, 'tab-worker.js'), [], {
    execPath: _nodePath,
    cwd: realPath,
    env: childEnv,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

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
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      const url = `http://127.0.0.1:${msg.port}${msg.token ? `?token=${msg.token}` : ''}`;
      view.webContents.loadURL(url);
      tab.view = view;

      switchTab(tabId);
      broadcastTabs();
    }
    if (msg.type === 'pty-exit') {
      const tab = tabs.get(tabId);
      if (tab) { tab.status = 'exited'; broadcastTabs(); }
    }
    if (msg.type === 'error') {
      clearTimeout(timeout);
      const tab = tabs.get(tabId);
      if (tab) { tab.status = 'error'; broadcastTabs(); }
    }
  });

  child.on('exit', () => {
    clearTimeout(timeout);
    const tab = tabs.get(tabId);
    if (tab && tab.status === 'loading') {
      tab.status = 'error';
      broadcastTabs();
    }
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
    try { tab.child.send({ type: 'shutdown' }); } catch {}
    const forceTimer = setTimeout(() => {
      try { tab.child.kill('SIGKILL'); } catch {}
    }, 5000);
    tab.child.on('exit', () => clearTimeout(forceTimer));
  }

  // Remove view
  if (tab.view) {
    mainWindow.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
  }

  tabs.delete(tabId);

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

// --- Cleanup ---
let isQuitting = false;
async function cleanupAll() {
  if (isQuitting) return;
  isQuitting = true;

  const promises = [];
  for (const [id, tab] of tabs) {
    if (tab.child) {
      try { tab.child.send({ type: 'shutdown' }); } catch {}
      promises.push(new Promise(resolve => {
        const timer = setTimeout(() => { try { tab.child.kill('SIGKILL'); } catch {} resolve(); }, 5000);
        tab.child.on('exit', () => { clearTimeout(timer); resolve(); });
      }));
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
function watchTheme() {
  try {
    const home = app.getPath('home');
    const prefsPath = join(home, '.claude', 'cc-viewer', 'preferences.json');
    if (!existsSync(prefsPath)) return;
    const readTheme = () => {
      try {
        const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'));
        return prefs.themeColor === 'light' ? 'light' : 'dark';
      } catch { return 'dark'; }
    };
    let currentTheme = readTheme();
    if (tabBarView?.webContents) tabBarView.webContents.send('theme-changed', currentTheme);
    watchFile(prefsPath, { interval: 2000 }, () => {
      const newTheme = readTheme();
      if (newTheme !== currentTheme) {
        currentTheme = newTheme;
        if (tabBarView?.webContents && !tabBarView.webContents.isDestroyed()) {
          tabBarView.webContents.send('theme-changed', currentTheme);
        }
      }
    });
  } catch {}
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
    });

    // Tab bar
    tabBarView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'tab-preload.js'),
      },
    });
    tabBarView.webContents.loadFile(join(__dirname, 'tab-bar.html'));
    mainWindow.contentView.addChildView(tabBarView);

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
