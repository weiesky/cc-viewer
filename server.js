import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, statSync, readdirSync, renameSync, unlinkSync, openSync, readSync, closeSync, realpathSync, mkdirSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { homedir, platform, networkInterfaces } from 'node:os';
import { execFile, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { isPathContained, readFileContent, writeFileContent, resolveFilePath, ERROR_STATUS_MAP } from './lib/file-api.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// execFile with stdin input support (for git check-ignore --stdin)
function execWithStdin(cmd, args, input, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      // git check-ignore exits 1 when no files are ignored — treat as success
      resolve(stdout);
    });
    if (options?.timeout) {
      setTimeout(() => { try { child.kill(); } catch {} reject(new Error('timeout')); }, options.timeout);
    }
    child.stdin.write(input);
    child.stdin.end();
  });
}
import { LOG_FILE, _initPromise, _resumeState, resolveResumeChoice, _projectName, _logDir, _cachedApiKey, _cachedAuthHeader, _cachedHaikuModel, initForWorkspace, resetWorkspace, streamingState, resetStreamingState, _loadProxyProfile, PROFILE_PATH, _defaultConfig } from './interceptor.js';
import { LOG_DIR } from './findcc.js';
import { t, detectLanguage } from './i18n.js';
import { checkAndUpdate } from './lib/updater.js';
import { loadPlugins, runWaterfallHook, runParallelHook, getPluginsInfo, PLUGINS_DIR } from './lib/plugin-loader.js';
import { uploadPlugins, installPluginFromUrl } from './lib/plugin-manager.js';
import { getUserProfile } from './lib/user-profile.js';
import { getGitDiffs } from './lib/git-diff.js';
import { CONTEXT_WINDOW_FILE, readModelContextSize, buildContextWindowEvent, getContextSizeForModel } from './lib/context-watcher.js';
import { watchLogFile, startWatching, getWatchedFiles, sendEventToClients } from './lib/log-watcher.js';
import { isMainAgentEntry, extractCachedContent } from './lib/kv-cache-analyzer.js';
import { listLocalLogs, deleteLogFiles, mergeLogFiles } from './lib/log-management.js';
import { countLogEntries, streamRawEntriesAsync, readPagedEntries } from './lib/log-stream.js';


const PREFS_FILE = join(LOG_DIR, 'preferences.json');

// 启动时一次性读取 ~/.claude/settings.json（不 watch）
let claudeSettings = {};
try {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    claudeSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  }
} catch { }
const isCliMode = process.env.CCV_CLI_MODE === '1';
const isWorkspaceMode = process.env.CCV_WORKSPACE_MODE === '1';
const _defaultProxyProfiles = { active: 'max', profiles: [{ id: 'max', name: 'Default' }] };
const _maskApiKey = (k) => k && typeof k === 'string' && k.length > 4 ? '****' + k.slice(-4) : k ? '****' : '';
const _maskProfiles = (data) => {
  if (!data?.profiles) return data;
  return { ...data, profiles: data.profiles.map(p => p.apiKey ? { ...p, apiKey: _maskApiKey(p.apiKey) } : p) };
};
const _isMasked = (k) => typeof k === 'string' && /^\*{4}.{0,4}$/.test(k);

// 获取 Claude 进程 PID（CLI 模式下从 pty-manager 获取）
let _getPtyPidFn = null;
function getClaudePid() {
  if (!isCliMode) return process.pid;
  if (_getPtyPidFn) return _getPtyPidFn();
  // lazy load 尚未完成，尝试同步获取（pty-manager 可能已被其他路径加载）
  return null;
}
if (isCliMode) {
  import('./pty-manager.js').then(m => {
    _getPtyPidFn = m.getPtyPid;
  }).catch(err => {
    console.error('[CC Viewer] Failed to load pty-manager for PID tracking:', err.message);
  });
}

// 统一的文件/目录忽略规则（仅隐藏系统和版本控制目录）
const IGNORED_PATTERNS = new Set([
  '.git', '.svn', '.hg', '.DS_Store',
  '.idea', '.vscode'
]);

// 工作区模式：保存 Claude 额外参数，供 launch API 使用
let _workspaceClaudeArgs = [];
let _workspaceClaudePath = null;
let _workspaceIsNpmVersion = false;
let _workspaceLaunched = false; // 工作区是否已经启动了会话

// Ask hook bridge state (for PreToolUse AskUserQuestion hook)
// At most one pending request at a time (Claude Code is single-threaded)
let pendingAskHook = null; // { questions, res, timer, createdAt }

// Editor session state (for $EDITOR intercept)
const editorSessions = new Map(); // sessionId → { filePath, done, createdAt }
// Periodically clean up abandoned editor sessions (older than 1 hour)
const _editorCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of editorSessions) {
    if (now - (session.createdAt || 0) > 3600000) editorSessions.delete(id);
  }
}, 60000);
_editorCleanupTimer.unref(); // Don't keep process alive for cleanup
let terminalWss = null; // WebSocketServer reference for broadcasting
export function setWorkspaceClaudeArgs(args) {
  _workspaceClaudeArgs = args;
}
export function setWorkspaceClaudePath(path, isNpm) {
  _workspaceClaudePath = path;
  _workspaceIsNpmVersion = isNpm;
}

// Global POST body size limit (10MB) to prevent OOM from malicious/buggy clients
const MAX_POST_BODY = 10 * 1024 * 1024;



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const START_PORT = 7008;
const MAX_PORT = 7099;
const HOST = '0.0.0.0';

// 局域网访问 token（本地 127.0.0.1 免验证）
const ACCESS_TOKEN = randomBytes(16).toString('hex');

let clients = [];
let server;
let actualPort = 0;
let serverProtocol = 'http';
// Stats Worker 实例
let statsWorker = null;

function startStatsWorker() {
  try {
    statsWorker = new Worker(new URL('./lib/stats-worker.js', import.meta.url));
    statsWorker.on('error', (err) => {
      console.error('[CC Viewer] Stats worker error:', err.message);
      statsWorker = null;
    });
    statsWorker.on('exit', (code) => {
      if (code !== 0) {
        console.error('[CC Viewer] Stats worker exited with code', code);
      }
      statsWorker = null;
    });
    // 初始化：全量扫描当前项目
    if (_projectName && _logDir) {
      statsWorker.postMessage({ type: 'init', logDir: LOG_DIR, projectName: _projectName });
    }
  } catch (err) {
    console.error('[CC Viewer] Failed to start stats worker:', err.message);
  }
}

function notifyStatsWorker(logFile) {
  if (statsWorker && _projectName) {
    statsWorker.postMessage({ type: 'update', logDir: LOG_DIR, projectName: _projectName, logFile });
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Helper to build log-watcher options object
function _logWatcherOpts(logFile) {
  return {
    logFile: logFile || LOG_FILE,
    clients,
    getClaudePid,
    runParallelHook,
    notifyStatsWorker,
    getLogFile: () => LOG_FILE,
  };
}

function getLocalIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function getAllLocalIps() {
  const ips = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `${serverProtocol}://${req.headers.host}`);
  const url = parsedUrl.pathname;
  const method = req.method;

  // WebSocket 路径不处理，交给 upgrade 事件
  if (url === '/ws/terminal') {
    return;
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 局域网访问 token 验证（本地 127.0.0.1 / ::1 免验证，静态资源免验证）
  const remoteIp = req.socket.remoteAddress;
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  const isStaticAsset = url.startsWith('/assets/') || url === '/favicon.ico';
  if (!isLocal && !isStaticAsset) {
    const urlToken = parsedUrl.searchParams.get('token');
    if (urlToken !== ACCESS_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid token' }));
      return;
    }
  }

  // User preferences API
  // File upload API — save to /tmp/cc-viewer-uploads/
  if (url === '/api/upload' && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing boundary' }));
      return;
    }
    const MAX_UPLOAD = 50 * 1024 * 1024; // 50MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_UPLOAD) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 50MB)' }));
      return;
    }
    const boundary = boundaryMatch[1];
    const chunks = [];
    let totalSize = 0;
    let aborted = false;
    req.on('data', chunk => {
      totalSize += chunk.length;
      if (totalSize > MAX_UPLOAD) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large (max 50MB)' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const buf = Buffer.concat(chunks);
        // Find the first part's headers and body
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) throw new Error('Malformed multipart');
        const headerStr = buf.slice(0, headerEnd).toString();
        const nameMatch = headerStr.match(/filename="([^"]+)"/);
        if (!nameMatch) throw new Error('No filename');
        const originalName = nameMatch[1].replace(/[/\\]/g, '_'); // sanitize
        const bodyStart = headerEnd + 4;
        // Find the closing boundary
        const closingBoundary = Buffer.from('\r\n--' + boundary);
        const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
        const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);
        const uploadDir = '/tmp/cc-viewer-uploads';
        mkdirSync(uploadDir, { recursive: true });
        // Unique filename: prepend timestamp to avoid silent overwrite
        const ts = Date.now();
        const dotIdx = originalName.lastIndexOf('.');
        const uniqueName = dotIdx > 0
          ? `${originalName.slice(0, dotIdx)}-${ts}${originalName.slice(dotIdx)}`
          : `${originalName}-${ts}`;
        const savePath = join(uploadDir, uniqueName);
        writeFileSync(savePath, fileData);
        // 持久化副本到 ~/.claude/cc-viewer/${project}/images/，避免 /tmp 清理后丢失
        let persistPath = null;
        try {
          const pName = _projectName || 'default';
          const persistDir = join(homedir(), '.claude', 'cc-viewer', pName, 'images');
          mkdirSync(persistDir, { recursive: true });
          persistPath = join(persistDir, uniqueName);
          writeFileSync(persistPath, fileData);
        } catch { }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: savePath, persistPath }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url === '/api/preferences' && method === 'GET') {
    let prefs = {};
    try { if (existsSync(PREFS_FILE)) prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8')); } catch { }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(prefs));
    return;
  }

  if (url === '/api/preferences' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        let prefs = {};
        try { if (existsSync(PREFS_FILE)) prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8')); } catch { }
        Object.assign(prefs, incoming);
        writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prefs));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 注册新的日志文件进行 watch（供新进程复用旧服务时调用）
  if (url === '/api/register-log' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const { logFile } = JSON.parse(body);
        if (logFile && typeof logFile === 'string' && logFile.startsWith(LOG_DIR) && existsSync(logFile)) {
          watchLogFile(_logWatcherOpts(logFile));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid log file path' }));
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // 用户选择继续/新开日志
  if (url === '/api/resume-choice' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const { choice } = JSON.parse(body);
        if (choice !== 'continue' && choice !== 'new') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid choice' }));
          return;
        }
        const result = resolveResumeChoice(choice);
        if (!result) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Already resolved' }));
          return;
        }
        // 重新 watch 最终的日志文件
        watchLogFile(_logWatcherOpts(result.logFile));
        // 广播 resume_resolved + full_reload
        const resolvedData = JSON.stringify({ logFile: result.logFile });
        clients.forEach(client => {
          try {
            client.write(`event: resume_resolved\ndata: ${resolvedData}\n\n`);
          } catch { }
        });
        // 流式分段广播 full_reload，避免全量加载 OOM
        const reloadTotal = countLogEntries(LOG_FILE);
        clients.forEach(client => {
          try { client.write(`event: load_start\ndata: ${JSON.stringify({ total: reloadTotal, incremental: false })}\n\n`); } catch { }
        });
        await streamRawEntriesAsync(LOG_FILE, (raw) => {
          clients.forEach(client => {
            try { client.write('event: load_chunk\ndata: ['); client.write(raw.replace(/\n/g, '')); client.write(']\n\n'); } catch { }
          });
        });
        clients.forEach(client => {
          try { client.write(`event: load_end\ndata: {}\n\n`); } catch { }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, logFile: result.logFile }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // === Workspace API ===

  // 目录浏览器
  if (url.startsWith('/api/browse-dir') && method === 'GET') {
    try {
      const dirPath = parsedUrl.searchParams.get('path') || homedir();
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid directory' }));
        return;
      }
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const dirs = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        const fullPath = join(dirPath, entry.name);
        let hasGit = false;
        try { hasGit = existsSync(join(fullPath, '.git')); } catch {}
        dirs.push({ name: entry.name, path: fullPath, hasGit });
      }
      dirs.sort((a, b) => {
        if (a.hasGit !== b.hasGit) return a.hasGit ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const parent = join(dirPath, '..');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ current: dirPath, parent: parent !== dirPath ? parent : null, dirs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/api/workspaces' && method === 'GET') {
    import('./workspace-registry.js').then(({ getWorkspaces }) => {
      const workspaces = getWorkspaces();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workspaces, workspaceMode: isWorkspaceMode && !_workspaceLaunched }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (url === '/api/workspaces/launch' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const { path: wsPath } = JSON.parse(body);
        if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid directory path' }));
          return;
        }

        const { registerWorkspace } = await import('./workspace-registry.js');
        registerWorkspace(wsPath);

        // 初始化 interceptor 的日志文件
        const result = initForWorkspace(wsPath);
        process.env.CCV_PROJECT_DIR = wsPath;

        // 启动日志监听
        watchLogFile(_logWatcherOpts(LOG_FILE));

        // 启动 stats worker（如果尚未启动）
        if (!statsWorker) startStatsWorker();
        startStreamingStatusTimer();

        // 启动 PTY
        const proxyPort = process.env.CCV_PROXY_PORT;
        if (proxyPort) {
          const { spawnClaude } = await import('./pty-manager.js');
          await spawnClaude(parseInt(proxyPort), wsPath, _workspaceClaudeArgs, _workspaceClaudePath, _workspaceIsNpmVersion, actualPort);
        }

        _workspaceLaunched = true;

        // 通知所有 SSE 客户端
        clients.forEach(client => {
          try {
            client.write(`event: workspace_started\ndata: ${JSON.stringify({ projectName: result.projectName, path: wsPath })}\n\n`);
          } catch {}
        });

        // 流式分段广播以刷新会话区域，避免全量加载 OOM
        const wsReloadTotal = countLogEntries(LOG_FILE);
        clients.forEach(client => {
          try { client.write(`event: load_start\ndata: ${JSON.stringify({ total: wsReloadTotal, incremental: false })}\n\n`); } catch {}
        });
        await streamRawEntriesAsync(LOG_FILE, (raw) => {
          clients.forEach(client => {
            try { client.write('event: load_chunk\ndata: ['); client.write(raw.replace(/\n/g, '')); client.write(']\n\n'); } catch {}
          });
        });
        clients.forEach(client => {
          try { client.write(`event: load_end\ndata: {}\n\n`); } catch {}
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, projectName: result.projectName }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url === '/api/workspaces/add' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const { path: wsPath } = JSON.parse(body);
        if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid directory path' }));
          return;
        }
        const { registerWorkspace } = await import('./workspace-registry.js');
        const entry = registerWorkspace(wsPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workspace: entry }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.startsWith('/api/workspaces/') && method === 'DELETE') {
    const id = url.split('/').pop();
    import('./workspace-registry.js').then(({ removeWorkspace }) => {
      const removed = removeWorkspace(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: removed }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (url === '/api/workspaces/stop' && method === 'POST') {
    import('./pty-manager.js').then(({ killPty }) => {
      killPty();

      // 停止日志监听
      for (const logFile of getWatchedFiles().keys()) {
        unwatchFile(logFile);
      }
      getWatchedFiles().clear();

      // 重置 interceptor 状态
      resetWorkspace();
      _workspaceLaunched = false;

      // 通知所有 SSE 客户端
      clients.forEach(client => {
        try {
          client.write(`event: workspace_stopped\ndata: {}\n\n`);
        } catch {}
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // SSE endpoint
  if (url === '/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // 注意：不要在此处 clients.push(res)！
    // 必须等 load_end + kv_cache + context_window 全部发送完毕后再加入广播列表，
    // 否则 streamRawEntriesAsync 的 setImmediate yield 间隙会让 watcher 的
    // sendToClients 向该客户端推送 live entry，而 load_end 的 setState 会覆盖这些
    // 已处理的 live entry，导致 对话条目"显示→消失→重现"闪烁。

    // SSE 心跳保活：每 30s 发送 ping 事件，防止连接被 OS/代理/浏览器静默断开
    const pingTimer = setInterval(() => {
      try { res.write('event: ping\ndata: {}\n\n'); } catch {}
    }, 30000);

    // 如果有待决的 resume 选择，发送 resume_prompt 事件
    if (_resumeState) {
      res.write(`event: resume_prompt\ndata: ${JSON.stringify({ recentFileName: _resumeState.recentFileName })}\n\n`);
    }

    // 增量加载参数：移动端带 since/cc/project 请求增量数据
    const sinceParam = parsedUrl.searchParams.get('since');
    const ccParam = parseInt(parsedUrl.searchParams.get('cc'), 10) || 0;
    const projectParam = parsedUrl.searchParams.get('project');
    const projectMatch = !projectParam || projectParam === (_projectName || '');
    const useIncremental = !!(sinceParam && ccParam > 0 && projectMatch && !isNaN(new Date(sinceParam).getTime()));

    // 分页参数：移动端首次加载传 limit=200，与 since 互斥
    const limitParam = parseInt(parsedUrl.searchParams.get('limit'), 10) || 0;
    const useLimit = !useIncremental && limitParam > 0;

    // KV-Cache / context_window 追踪（扫描全量条目，不受 since 过滤影响）
    let latestKvCache = null;
    let latestContextWindow = null;
    let pushedContextWindow = false;

    await streamRawEntriesAsync(LOG_FILE, (raw) => {
      // 直接发送原始 JSON 字符串，不做 parse/reconstruct/stringify
      // SSE data 字段不允许裸换行，去除 pretty-printed JSON 的换行
      res.write('event: load_chunk\ndata: [');
      res.write(raw.includes('\n') ? raw.replace(/\n/g, '') : raw);
      res.write(']\n\n');
    }, {
      since: useIncremental ? sinceParam : undefined,
      limit: useLimit ? limitParam : undefined,
      onScan: (raw) => {
        // 轻量追踪最新 MainAgent 的 KV-Cache 和 context_window（仅 regex 检测）
        if (raw.includes('"mainAgent":true') || raw.includes('"mainAgent": true')) {
          try {
            const entry = JSON.parse(raw);
            if (isMainAgentEntry(entry)) {
              const cached = extractCachedContent(entry);
              if (cached) latestKvCache = cached;
              const usage = entry.response?.body?.usage;
              if (usage) {
                const contextSize = getContextSizeForModel(entry.body?.model);
                const cw = buildContextWindowEvent(usage, contextSize);
                if (cw) latestContextWindow = cw;
              }
            }
          } catch { }
        }
      },
      onReady: ({ totalCount, hasMore, oldestTs }) => {
        // Pass 1 完成、Pass 2 开始前：发送 load_start
        // 增量模式下不显示 loading 遮罩，非增量模式显示进度
        const loadStartData = { total: totalCount, incremental: !!useIncremental };
        // 分页模式下附加 hasMore/oldestTs（增量模式由客户端从缓存自行判断）
        if (useLimit) {
          loadStartData.hasMore = !!hasMore;
          loadStartData.oldestTs = oldestTs || '';
        }
        res.write(`event: load_start\ndata: ${JSON.stringify(loadStartData)}\n\n`);
      },
    });

    res.write(`event: load_end\ndata: {}\n\n`);

    // 发送最新 MainAgent 的 KV-Cache 和 context_window
    if (latestKvCache) {
      res.write(`event: kv_cache_content\ndata: ${JSON.stringify(latestKvCache)}\n\n`);
    }
    if (latestContextWindow) {
      res.write(`event: context_window\ndata: ${JSON.stringify(latestContextWindow)}\n\n`);
      pushedContextWindow = true;
    }
    // Fallback: no MainAgent in log (e.g. fresh session after -c), read context-window.json
    if (!pushedContextWindow) {
      try {
        const cwRaw = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
        const cwFile = JSON.parse(cwRaw);
        if (cwFile?.context_window) {
          // Recalculate with correct context size from model.id
          const { contextSize } = readModelContextSize();
          const cw = cwFile.context_window;
          const inputTokens = cw.total_input_tokens || 0;
          const outputTokens = cw.total_output_tokens || 0;
          const totalTokens = inputTokens + outputTokens;
          const usedPct = contextSize > 0 ? Math.round((totalTokens / contextSize) * 100) : 0;
          const data = { ...cw, context_window_size: contextSize, used_percentage: usedPct, remaining_percentage: 100 - usedPct };
          res.write(`event: context_window\ndata: ${JSON.stringify(data)}\n\n`);
        }
      } catch { }
    }

    // 历史数据 + KV-Cache + context_window 全部发送完毕后，才将客户端加入广播列表。
    // 这样 watcher 的 sendToClients 不会在 load 阶段向该客户端推送 live entry。
    clients.push(res);

    req.on('close', () => {
      clearInterval(pingTimer);
      const idx = clients.indexOf(res);
      if (idx !== -1) clients.splice(idx, 1);
    });
    return;
  }

  // API endpoint
  if (url === '/api/requests' && method === 'GET') {
    // 异步流式 JSON 数组输出，不做 reconstruct，发原始条目
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('[');
    let first = true;
    await streamRawEntriesAsync(LOG_FILE, (raw) => {
      if (!first) res.write(',');
      res.write(raw);
      first = false;
    });
    res.write(']');
    res.end();
    return;
  }

  // 分页历史条目端点：移动端"加载更多"按需拉取
  if (url === '/api/entries/page' && method === 'GET') {
    const before = parsedUrl.searchParams.get('before');
    const limitVal = Math.min(parseInt(parsedUrl.searchParams.get('limit'), 10) || 100, 500);
    if (!before || isNaN(new Date(before).getTime())) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing or invalid "before" parameter' }));
      return;
    }
    try {
      const result = readPagedEntries(LOG_FILE, { before, limit: limitVal });
      // entries 是原始 JSON 字符串数组，parse 后返回给客户端
      const entries = result.entries.map(raw => {
        try { return JSON.parse(raw); } catch { return null; }
      }).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        entries,
        hasMore: result.hasMore,
        oldestTimestamp: result.oldestTimestamp,
        count: entries.length,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 当前监控的项目名称
  if (url === '/api/project-name' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectName: _projectName || '' }));
    return;
  }

  // 返回项目目录绝对路径（前端用于将绝对路径转为相对路径）
  if (url === '/api/project-dir' && method === 'GET') {
    const dir = process.env.CCV_PROJECT_DIR || process.cwd();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ dir }));
    return;
  }

  // 当前版本号
  if (url === '/api/version-info' && method === 'GET') {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: pkg.version }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read version' }));
    }
    return;
  }

  // 项目统计数据
  if (url === '/api/project-stats' && method === 'GET') {
    try {
      if (!_projectName) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No project name' }));
        return;
      }
      const statsFile = join(LOG_DIR, _projectName, `${_projectName}.json`);
      if (!existsSync(statsFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stats file not found' }));
        return;
      }
      const stats = readFileSync(statsFile, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(stats);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 所有项目统计数据
  if (url === '/api/all-project-stats' && method === 'GET') {
    try {
      const allStats = {};
      if (existsSync(LOG_DIR)) {
        const entries = readdirSync(LOG_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const project = entry.name;
          const statsFile = join(LOG_DIR, project, `${project}.json`);
          if (existsSync(statsFile)) {
            try {
              allStats[project] = JSON.parse(readFileSync(statsFile, 'utf-8'));
            } catch { }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(allStats));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 刷新统计：强制重新扫描所有项目日志，等待完成后再响应
  if (url === '/api/refresh-stats' && method === 'POST') {
    try {
      if (!statsWorker) startStatsWorker();
      if (statsWorker) {
        const timeout = setTimeout(() => {
          statsWorker?.removeListener('message', onDone);
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stats refresh timed out' }));
        }, 30000);
        const onDone = (m) => {
          if (m.type === 'scan-all-done') {
            clearTimeout(timeout);
            statsWorker?.removeListener('message', onDone);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          }
        };
        statsWorker.on('message', onDone);
        statsWorker.postMessage({ type: 'scan-all', logDir: LOG_DIR });
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stats worker not available' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Claude settings.json（启动时读取，不 watch）
  if (url === '/api/claude-settings' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const fileEnv = claudeSettings.env || {};
    // 与 Claude Code 保持一致：settings.json env 优先，fallback 到 process.env
    const env = { ...fileEnv };
    if (!env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS && process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
      env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;
    }
    res.end(JSON.stringify({ env, model: claudeSettings.model || null, showThinkingSummaries: claudeSettings.showThinkingSummaries || false }));
    return;
  }

  if (url === '/api/claude-settings' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const settingsPath = join(homedir(), '.claude', 'settings.json');
        let settings = {};
        try { if (existsSync(settingsPath)) settings = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch { }
        Object.assign(settings, incoming);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        Object.assign(claudeSettings, incoming);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Proxy profile 热切换
  if (url === '/api/proxy-profiles' && method === 'GET') {
    try {
      const data = existsSync(PROFILE_PATH) ? JSON.parse(readFileSync(PROFILE_PATH, 'utf-8')) : _defaultProxyProfiles;
      const masked = _maskProfiles(data);
      if (_defaultConfig) masked.defaultConfig = { ..._defaultConfig, apiKey: _defaultConfig.apiKey ? _maskApiKey(_defaultConfig.apiKey) : null };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(masked));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_defaultProxyProfiles));
    }
    return;
  }

  if (url === '/api/proxy-profiles' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.profiles)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid profile data: profiles must be an array' }));
          return;
        }
        // 确保 max profile 始终存在
        if (!incoming.profiles.some(p => p.id === 'max')) {
          incoming.profiles = [{ id: 'max', name: 'Default' }, ...(incoming.profiles || [])];
        }
        // 如果 apiKey 是 mask 值（未修改），从磁盘读取原始值保留
        let existing = {};
        try { if (existsSync(PROFILE_PATH)) existing = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8')); } catch { }
        const existingMap = {};
        if (existing.profiles) existing.profiles.forEach(p => { if (p.apiKey) existingMap[p.id] = p.apiKey; });
        for (const p of incoming.profiles) {
          if (p.apiKey && _isMasked(p.apiKey) && existingMap[p.id]) {
            p.apiKey = existingMap[p.id];
          }
        }
        const dir = dirname(PROFILE_PATH);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(PROFILE_PATH, JSON.stringify(incoming, null, 2), { mode: 0o600 });
        _loadProxyProfile();
        // SSE 广播给所有 viewer 客户端（mask apiKey）
        const activeProfile = incoming.profiles?.find(p => p.id === incoming.active) || null;
        const maskedProfile = activeProfile?.apiKey ? { ...activeProfile, apiKey: _maskApiKey(activeProfile.apiKey) } : activeProfile;
        sendEventToClients(clients, 'proxy_profile', { active: incoming.active, profile: maskedProfile });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // macOS 用户头像和显示名
  if (url === '/api/user-profile' && method === 'GET') {
    const profile = await getUserProfile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profile));
    return;
  }

  // 文件浏览器 API（CLI 模式下项目目录浏览）
  if (url === '/api/files' && method === 'GET') {
    const reqPath = parsedUrl.searchParams.get('path') || '.';
    // 安全校验：拒绝绝对路径和 .. 路径穿越
    if (reqPath.startsWith('/') || reqPath.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    const targetDir = join(cwd, reqPath);
    try {
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const items = entries
        .filter(e => !IGNORED_PATTERNS.has(e.name))
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      // 使用 git check-ignore 批量检测被 .gitignore 忽略的文件
      let gitIgnoredSet = new Set();
      try {
        const names = items.map(i => {
          const rel = reqPath === '.' ? i.name : `${reqPath}/${i.name}`;
          return i.type === 'directory' ? `${rel}/` : rel;
        });
        if (names.length > 0) {
          const result = await execWithStdin('git', ['check-ignore', '--stdin'], names.join('\n'), {
            cwd,
            timeout: 3000,
          });
          result.split('\n').filter(Boolean).forEach(line => {
            const name = line.endsWith('/') ? line.slice(0, -1) : line;
            const baseName = name.includes('/') ? name.split('/').pop() : name;
            gitIgnoredSet.add(baseName);
          });
        }
      } catch { /* git 未安装或非 git 仓库，忽略 */ }
      const result = items.map(i => gitIgnoredSet.has(i.name) ? { ...i, gitIgnored: true } : i);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Directory not found' }));
    }
    return;
  }

  // 文件重命名 API
  if (url === '/api/rename-file' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
        return;
      }
      try {
        const { oldPath, newName } = parsed;
        if (!oldPath || !newName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing oldPath or newName' }));
          return;
        }
        // 安全校验
        if (oldPath.startsWith('/') || oldPath.includes('..') || newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const oldFullPath = join(cwd, oldPath);
        const parentDir = dirname(oldFullPath);
        const newFullPath = join(parentDir, newName);
        // 检查源文件存在
        if (!existsSync(oldFullPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }
        // 检查目标是否已存在
        if (existsSync(newFullPath)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Target already exists' }));
          return;
        }
        renameSync(oldFullPath, newFullPath);
        const newRelPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newName : newName;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, newPath: newRelPath }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // === Editor session API (for $EDITOR intercept) ===

  if (url === '/api/open-log-dir' && method === 'POST') {
    const dir = LOG_FILE ? dirname(LOG_FILE) : LOG_DIR;
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(cmd, [dir], () => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dir }));
    return;
  }

  if (url === '/api/open-profile-dir' && method === 'POST') {
    const dir = dirname(PROFILE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(cmd, [dir], () => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dir }));
    return;
  }

  if (url === '/api/open-project-dir' && method === 'POST') {
    const dir = process.env.CCV_PROJECT_DIR || process.cwd();
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(cmd, [dir], () => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dir }));
    return;
  }

  if (url === '/api/editor-open' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const { sessionId, filePath } = JSON.parse(body);
        if (!sessionId || !filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing sessionId or filePath' }));
          return;
        }
        editorSessions.set(sessionId, { filePath, done: false, createdAt: Date.now() });
        // Broadcast to all terminal WebSocket clients
        if (terminalWss) {
          const msg = JSON.stringify({ type: 'editor-open', sessionId, filePath });
          terminalWss.clients.forEach(client => {
            if (client.readyState === 1) {
              try { client.send(msg); } catch {}
            }
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  if (url.startsWith('/api/editor-status') && method === 'GET') {
    const id = parsedUrl.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing id' }));
      return;
    }
    const session = editorSessions.get(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ done: session ? session.done : true }));
    return;
  }

  if (url === '/api/editor-done' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const { sessionId } = JSON.parse(body);
        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing sessionId' }));
          return;
        }
        const session = editorSessions.get(sessionId);
        if (session) {
          session.done = true;
        }
        // Clean up after a short delay to allow the polling to pick it up
        setTimeout(() => editorSessions.delete(sessionId), 5000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // Ask hook bridge: long-poll endpoint for PreToolUse AskUserQuestion hook
  if (url === '/api/ask-hook' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1000000) { // 1MB limit (questions may contain large previews)
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
    });
    req.on('end', () => {
      try {
        const { questions } = JSON.parse(body);
        if (!Array.isArray(questions) || questions.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing questions' }));
          return;
        }

        // Cancel any previous pending hook request
        if (pendingAskHook) {
          try {
            if (!pendingAskHook.res.headersSent) {
              pendingAskHook.res.writeHead(409, { 'Content-Type': 'application/json' });
              pendingAskHook.res.end(JSON.stringify({ error: 'Superseded' }));
            }
          } catch {}
          clearTimeout(pendingAskHook.timer);
        }

        const HOOK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        const timer = setTimeout(() => {
          if (pendingAskHook && pendingAskHook.res === res) {
            pendingAskHook = null;
            try {
              if (!res.headersSent) {
                res.writeHead(408, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Timeout' }));
              }
            } catch {}
            // Broadcast timeout to clients
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'ask-hook-timeout' });
              terminalWss.clients.forEach((c) => {
                if (c.readyState === 1) try { c.send(tmsg); } catch {}
              });
            }
          }
        }, HOOK_TIMEOUT);

        pendingAskHook = { questions, res, timer, createdAt: Date.now() };

        // Broadcast to all terminal WS clients
        if (terminalWss) {
          const pmsg = JSON.stringify({ type: 'ask-hook-pending', questions });
          terminalWss.clients.forEach((client) => {
            if (client.readyState === 1) {
              try { client.send(pmsg); } catch {}
            }
          });
        }

        // Handle ask-bridge.js disconnection (use res instead of req — Node.js v24+ fires req 'close' immediately after body is read)
        res.on('close', () => {
          if (pendingAskHook && pendingAskHook.res === res) {
            clearTimeout(pendingAskHook.timer);
            pendingAskHook = null;
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'ask-hook-timeout' });
              terminalWss.clients.forEach((c) => {
                if (c.readyState === 1) try { c.send(tmsg); } catch {}
              });
            }
          }
        });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // 读取文件内容 API
  if (url === '/api/file-content' && method === 'GET') {
    const reqPath = parsedUrl.searchParams.get('path');
    const isEditorSession = parsedUrl.searchParams.get('editorSession') === 'true';
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    try {
      const result = readFileContent(cwd, reqPath, isEditorSession);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const status = ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? `Cannot read file: ${err.message}` : err.message;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // 返回文件原始二进制内容（用于图片预览等）
  if (url === '/api/file-raw' && (method === 'GET' || method === 'HEAD')) {
    const reqPath = parsedUrl.searchParams.get('path');
    const isEditorSession = parsedUrl.searchParams.get('editorSession') === 'true';
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    try {
      // 上传图片路径（/tmp/cc-viewer-uploads/ 或持久化目录）直接使用，跳过项目目录安全检查
      const uploadPrefix = '/tmp/cc-viewer-uploads/';
      const pName = _projectName || 'default';
      const persistPrefix = join(homedir(), '.claude', 'cc-viewer', pName, 'images') + '/';
      let targetFile;
      if (reqPath && reqPath.startsWith(uploadPrefix)) {
        targetFile = resolve(reqPath);
        // 路径穿越防护：resolve 后必须仍在 upload 目录内
        if (!targetFile.startsWith(uploadPrefix)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal denied' }));
          return;
        }
        // /tmp 原文件不存在时，回退到持久化副本
        if (!existsSync(targetFile)) {
          const fileName = targetFile.split('/').pop();
          const persistFile = join(persistPrefix, fileName);
          if (existsSync(persistFile)) targetFile = persistFile;
        }
      } else if (reqPath && reqPath.startsWith(persistPrefix)) {
        targetFile = resolve(reqPath);
        // 路径穿越防护：resolve 后必须仍在持久化目录内
        if (!targetFile.startsWith(persistPrefix)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal denied' }));
          return;
        }
      } else {
        targetFile = resolveFilePath(cwd, reqPath, isEditorSession);
      }
      if (!existsSync(targetFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `File not found: ${targetFile}` }));
        return;
      }
      const stat = statSync(targetFile);
      if (!stat.isFile()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not a file' }));
        return;
      }
      if (stat.size > 10 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large' }));
        return;
      }
      const extMime = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.webp': 'image/webp',
      };
      const ext = (targetFile.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const mime = extMime[ext] || 'application/octet-stream';
      const data = method === 'HEAD' ? null : readFileSync(targetFile);
      const size = method === 'HEAD' ? stat.size : data.length;
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': size });
      res.end(data);
    } catch (err) {
      const status = ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? `Cannot read file: ${err.message}` : err.message;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // 保存文件内容 API
  if (url === '/api/file-content' && method === 'POST') {
    const MAX_BODY = 5 * 1024 * 1024; // 5MB，与 GET 路由限制对齐
    let body = '';
    let overflow = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      try {
        const { path: reqPath, content, editorSession } = JSON.parse(body);
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const result = writeFileContent(cwd, reqPath, content, editorSession);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, size: result.size }));
      } catch (err) {
        const status = ERROR_STATUS_MAP[err.code] || 500;
        const message = status === 500 ? `Cannot save file: ${err.message}` : err.message;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
    });
    return;
  }

  // CLI 模式检测
  if (url === '/api/cli-mode' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cliMode: isCliMode, workspaceMode: isWorkspaceMode && !_workspaceLaunched }));
    return;
  }

  // Git 状态
  if (url === '/api/git-status' && method === 'GET') {
    try {
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const { stdout: output } = await execFileAsync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 5000 });
      const lines = output.split('\n').filter(line => line.trim());
      const changes = lines.map(line => {
        const status = line.substring(0, 2).trim();
        const file = line.substring(3).trim();
        return { status, file };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ changes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, changes: [] }));
    }
    return;
  }

  // Git diff 数据获取
  if (url.startsWith('/api/git-diff') && method === 'GET') {
    try {
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const filesParam = parsedUrl.searchParams.get('files');

      if (!filesParam) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing files parameter' }));
        return;
      }

      const files = filesParam.split(',').map(f => f.trim()).filter(Boolean);
      const diffs = await getGitDiffs(cwd, files);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ diffs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, diffs: [] }));
    }
    return;
  }

  // 插件管理 API
  if (url === '/api/plugins' && method === 'GET') {
    const plugins = getPluginsInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plugins, pluginsDir: PLUGINS_DIR }));
    return;
  }

  if (url === '/api/plugins' && method === 'DELETE') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }
    const filePath = join(PLUGINS_DIR, file);
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      unlinkSync(filePath);
      await loadPlugins();
      const plugins = getPluginsInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/api/plugins/reload' && method === 'POST') {
    try {
      await loadPlugins();
      const plugins = getPluginsInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/api/plugins/upload' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const { files: fileList } = JSON.parse(body);
        uploadPlugins(PLUGINS_DIR, fileList);
        await loadPlugins();
        const plugins = getPluginsInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
      } catch (err) {
        const status = err.statusCode || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url === '/api/plugins/install-from-url' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const { url: fileUrl } = JSON.parse(body);
        const extractScript = join(__dirname, 'lib', 'extract-plugin-name.mjs');
        await installPluginFromUrl(PLUGINS_DIR, fileUrl, extractScript);
        await loadPlugins();
        const plugins = getPluginsInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
      } catch (err) {
        const status = err.statusCode || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 返回局域网访问地址
  if (url === '/api/local-url' && method === 'GET') {
    const localIp = getLocalIp();
    const defaultUrl = `${serverProtocol}://${localIp}:${actualPort}?token=${ACCESS_TOKEN}`;
    const hookResult = await runWaterfallHook('localUrl', { url: defaultUrl, ip: localIp, port: actualPort, token: ACCESS_TOKEN });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: hookResult.url }));
    return;
  }

  // 列出本地日志文件（按项目分组，遍历项目子目录）
  if (url === '/api/local-logs' && method === 'GET') {
    try {
      const result = listLocalLogs(LOG_DIR, _projectName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 下载指定本地日志文件（原始 JSONL 格式）
  if (url === '/api/download-log' && method === 'GET') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }
    if (!file.endsWith('.jsonl')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file type' }));
      return;
    }
    const filePath = join(LOG_DIR, file);
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const realPath = realpathSync(filePath);
      const realLogDir = realpathSync(LOG_DIR);
      if (!realPath.startsWith(realLogDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
      }
      const fileName = file.split('/').pop();
      const format = parsedUrl.searchParams.get('format');
      // Delta storage: format=raw 下载原始文件；默认下载重建后的全量格式
      if (format === 'raw') {
        const stat = statSync(realPath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
          'Content-Length': stat.size,
        });
        const stream = createReadStream(realPath);
        stream.pipe(res);
      } else {
        // 流式下载原始条目（不重建，保持 delta 格式），避免 OOM
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
          'Transfer-Encoding': 'chunked',
        });
        await streamRawEntriesAsync(realPath, (raw) => {
          res.write(raw);
          res.write('\n---\n');
        });
        res.end();
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 读取指定本地日志文件（支持 project/file 路径）
  if (url === '/api/local-log' && method === 'GET') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }

    // 验证文件类型：只允许 .jsonl 文件
    if (!file.endsWith('.jsonl')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file type. Only .jsonl files are allowed.' }));
      return;
    }

    try {
      // 独立 SSE 流：直接向请求方返回 event-stream，不走 /events 广播
      const { validateLogPath } = await import('./lib/log-management.js');
      validateLogPath(LOG_DIR, file);
      const filePath = join(LOG_DIR, file);
      const total = countLogEntries(filePath);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      res.write(`event: load_start\ndata: ${JSON.stringify({ total, incremental: false })}\n\n`);
      await streamRawEntriesAsync(filePath, (raw) => {
        res.write('event: load_chunk\ndata: [');
        res.write(raw.includes('\n') ? raw.replace(/\n/g, '') : raw);
        res.write(']\n\n');
      });
      res.write(`event: load_end\ndata: {}\n\n`);
      res.end();
    } catch (err) {
      // 如果 headers 未发送，返回 JSON 错误；否则关闭连接
      if (!res.headersSent) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'ACCESS_DENIED' ? 403 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
    return;
  }

  // 删除日志文件
  if (url === '/api/delete-logs' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const { files } = JSON.parse(body);
        if (!Array.isArray(files) || files.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No files specified' }));
          return;
        }
        const results = deleteLogFiles(LOG_DIR, files);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // 合并日志文件
  if (url === '/api/merge-logs' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const { files } = JSON.parse(body);
        const merged = mergeLogFiles(LOG_DIR, files);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, merged }));
      } catch (err) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'INVALID_INPUT' ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /api/concept?lang=zh&doc=Tool-Bash
  if (method === 'GET' && url === '/api/concept') {
    const lang = parsedUrl.searchParams.get('lang') || 'zh';
    const doc = parsedUrl.searchParams.get('doc') || '';
    // 安全校验：只允许字母、数字、连字符
    if (!/^[a-zA-Z0-9-]+$/.test(doc) || !/^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(lang)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid parameters' }));
      return;
    }
    let mdPath = join(__dirname, 'concepts', lang, `${doc}.md`);
    if (!existsSync(mdPath) && lang !== 'zh') {
      mdPath = join(__dirname, 'concepts', 'zh', `${doc}.md`);
    }
    if (existsSync(mdPath)) {
      const content = readFileSync(mdPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
    return;
  }

  // CCV 进程列表
  if (url === '/api/ccv-processes' && method === 'GET') {
    if (platform() === 'win32') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes: [] }));
      return;
    }
    try {
      const { stdout } = await execAsync('lsof -iTCP:7008-7099 -sTCP:LISTEN -P -n', { timeout: 5000 }).catch(() => ({ stdout: '' }));
      const lines = stdout.trim().split('\n').filter(Boolean);
      // Parse lsof output: skip header, filter node processes, dedupe by PID:port
      const seen = new Map(); // pid -> port
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/);
        const cmd = parts[0];
        if (cmd !== 'node') continue;
        const pid = parseInt(parts[1], 10);
        if (!pid) continue;
        // lsof 输出: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (STATE)
        // 端口在 NAME 列（倒数第二列），如 *:7008，最后一列是 (LISTEN)
        const nameField = parts[parts.length - 2] || '';
        const portMatch = nameField.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = portMatch[1];
        if (!seen.has(pid)) seen.set(pid, port);
      }
      // 获取所有候选进程的 PPID，过滤掉 PPID 也在 CCV 进程集合中的子进程（即 ccv -c/-d 启动的 claude 子进程）
      const ccvPids = new Set(seen.keys());
      const filteredPids = [];
      for (const [pid] of seen) {
        try {
          const { stdout: ppidOut } = await execAsync(`ps -o ppid= -p ${pid}`, { timeout: 2000 }).catch(() => ({ stdout: '' }));
          const ppid = parseInt(ppidOut.trim(), 10);
          if (ppid && ccvPids.has(ppid)) continue; // 是某个 CCV 进程的子进程，跳过
        } catch {}
        filteredPids.push(pid);
      }
      const processes = [];
      for (const pid of filteredPids) {
        const port = seen.get(pid);
        let startTime = '';
        let command = '';
        try {
          const { stdout: psOut } = await execAsync(`ps -p ${pid} -o lstart=,command=`, { timeout: 3000 }).catch(() => ({ stdout: '' }));
          const psLine = psOut.trim();
          // lstart format: "Day Mon DD HH:MM:SS YYYY rest..."
          const lsMatch = psLine.match(/^\w+\s+(\w+)\s+(\d+)\s+([\d:]+)\s+(\d{4})\s+(.*)/);
          if (lsMatch) {
            const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
            const mon = String(months[lsMatch[1]] || 1).padStart(2, '0');
            const day = String(lsMatch[2]).padStart(2, '0');
            const time = lsMatch[3];
            const year = lsMatch[4];
            startTime = `${year}年${mon}月${day}日 ${time}`;
            const rawCmd = lsMatch[5];
            // Extract path after lib/ (e.g. node_modules/cc-viewer/cli.js -d → cc-viewer/cli.js -d)
            const libMatch = rawCmd.match(/lib\/(.+)/);
            command = libMatch ? libMatch[1] : rawCmd;
          }
        } catch {}
        const isCurrent = pid === process.pid;
        processes.push({ port, pid, command, startTime, isCurrent });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // CCV 进程关闭
  if (url === '/api/ccv-processes/kill' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      try {
        const { pid } = JSON.parse(body);
        if (!Number.isInteger(pid) || pid <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid PID' }));
          return;
        }
        if (pid === process.pid) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot kill current process' }));
          return;
        }
        // 安全检查：确认是监听 CCV 端口范围 (7008-7099) 的 node 进程
        const { stdout: lsofOut } = await execAsync(`lsof -iTCP:7008-7099 -sTCP:LISTEN -P -n -p ${pid}`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
        const lsofLines = lsofOut.trim().split('\n').filter(Boolean).slice(1);
        const isNodeOnCcvPort = lsofLines.some(line => line.trim().split(/\s+/)[0] === 'node');
        if (!isNodeOnCcvPort) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not a CCV process' }));
          return;
        }
        process.kill(pid, 'SIGTERM');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 静态文件服务
  if (method === 'GET') {
    let filePath = url === '/' ? '/index.html' : url;
    // 去掉 query string
    filePath = filePath.split('?')[0];

    const fullPath = join(__dirname, 'dist', filePath);

    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const content = readFileSync(fullPath);
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
        return;
      }
    } catch (err) {
      // fall through to SPA fallback
    }

    // SPA fallback: 非 API/非静态文件请求返回 index.html
    try {
      const indexPath = join(__dirname, 'dist', 'index.html');
      const html = readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  // 非 GET 请求的 API 404
  if (url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

export async function startViewer() {
  // 加载插件（需要在创建服务器之前，以便通过 hook 获取 HTTPS 证书）
  await loadPlugins();

  // 通过插件 hook 获取 HTTPS 证书选项
  let httpsOptions = null;
  try {
    const httpsResult = await runWaterfallHook('httpsOptions', {});
    httpsOptions = (httpsResult.pfx || httpsResult.cert) ? httpsResult : null;
  } catch (err) {
    console.error('[CC Viewer] httpsOptions hook error:', err.message);
  }

  const useHttps = !!httpsOptions;
  const protocol = useHttps ? 'https' : 'http';
  serverProtocol = protocol;
  if (useHttps) console.error('[CC Viewer] HTTPS mode enabled via plugin hook');

  return new Promise((resolve, reject) => {
    function tryListen(port) {
      if (port > MAX_PORT) {
        console.error(t('server.portsBusy', { start: START_PORT, end: MAX_PORT }));
        resolve(null);
        return;
      }

      // 先检测 127.0.0.1:port 是否已被占用（避免 0.0.0.0 和 127.0.0.1 绑定不冲突的问题）
      const probe = createConnection({ host: '127.0.0.1', port });
      probe.on('connect', () => {
        probe.destroy();
        tryListen(port + 1); // 端口已被占用，尝试下一个
      });
      probe.on('error', () => {
        probe.destroy();
        // 端口空闲，绑定
        let currentServer;
        if (useHttps) {
          try {
            currentServer = createHttpsServer(httpsOptions, handleRequest);
          } catch (err) {
            console.error('[CC Viewer] HTTPS server creation failed, falling back to HTTP:', err.message);
            currentServer = createServer(handleRequest);
            serverProtocol = 'http';
          }
        } else {
          currentServer = createServer(handleRequest);
        }

        currentServer.listen(port, HOST, () => {
          server = currentServer;
          actualPort = port;
          const url = `${serverProtocol}://127.0.0.1:${port}`;
          console.error(t('server.started'));
          console.error(t('server.startedLocal', { protocol: serverProtocol, port }));
          const _ips = getAllLocalIps();
          for (const _ip of _ips) {
            console.error(t('server.startedNetwork', { protocol: serverProtocol, ip: _ip, port, token: ACCESS_TOKEN }));
          }
          // v2.0.69 之前的版本会清空控制台，自动打开浏览器确保用户能看到界面
          try {
            const ccPkgPath = join(__dirname, '..', '@anthropic-ai', 'claude-code', 'package.json');
            const ccVer = JSON.parse(readFileSync(ccPkgPath, 'utf-8')).version;
            const [maj, min, pat] = ccVer.split('.').map(Number);
            if (maj < 2 || (maj === 2 && min === 0 && pat < 69)) {
              const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
              execAsync(`${cmd} ${url}`, { timeout: 5000 }).catch(() => {});
            }
          } catch { }
          // 工作区模式下延迟到选择工作区后再启动监听
          if (!isWorkspaceMode) {
            readModelContextSize(); // Cache model→size mapping at startup
            startWatching(_logWatcherOpts(LOG_FILE));
            startStatsWorker();
            startStreamingStatusTimer();
          }
          // CLI 模式下启动 WebSocket 服务
          if (isCliMode) {
            setupTerminalWebSocket(currentServer);
          }
          // 通知插件服务器已启动
          runParallelHook('serverStarted', { port, host: HOST, url, ip: getLocalIp(), token: ACCESS_TOKEN, protocol: serverProtocol })
            .catch(err => console.error('[CC Viewer] Plugin serverStarted hook error:', err.message));
          resolve(server);
        });

        currentServer.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            tryListen(port + 1);
          } else {
            reject(err);
          }
        });
      });
    }

    tryListen(START_PORT);
  });
}

async function setupTerminalWebSocket(httpServer) {
  try {
    const { WebSocketServer } = await import('ws');
    const { writeToPty, writeToPtySequential, resizePty, onPtyData, onPtyExit, getPtyState, getOutputBuffer, getCurrentWorkspace, spawnShell } = await import('./pty-manager.js');
    const wss = new WebSocketServer({ noServer: true });
    terminalWss = wss;

    // 多客户端共享 PTY 的尺寸冲突解决：
    // 移动端优先——只要有移动端在线，PTY 始终使用移动端尺寸，
    // PC 端的 resize 仅存储不生效，避免宽屏尺寸导致移动端乱码。
    // PC 端显示窄输出但完全可读，移动端永远不会乱码。
    let activeWs = null;              // 当前活跃的 WebSocket 连接
    const clientSizes = new Map();    // ws → { cols, rows }
    const mobileClients = new Set();  // 移动端连接集合

    // 找到一个在线的移动端并返回其尺寸
    const getMobileSize = () => {
      for (const mws of mobileClients) {
        if (mws.readyState === 1) {
          const size = clientSizes.get(mws);
          if (size) return size;
        }
      }
      return null;
    };

    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, `${serverProtocol}://${req.headers.host}`).pathname;
      if (pathname === '/ws/terminal') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on('connection', (ws) => {
      // 发送当前 PTY 状态
      const state = getPtyState();
      ws.send(JSON.stringify({ type: 'state', ...state }));

      // 发送历史输出缓冲
      const buffer = getOutputBuffer();
      if (buffer) {
        ws.send(JSON.stringify({ type: 'data', data: buffer }));
      }

      // PTY 输出 → WebSocket
      const removeDataListener = onPtyData((data) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });

      // PTY 退出 → WebSocket
      const removeExitListener = onPtyExit((exitCode) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'exit', exitCode }));
        }
      });

      // WebSocket → PTY
      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'input') {
            // PTY 已退出时，自动 spawn 交互式 shell
            const state = getPtyState();
            if (!state.running) {
              try {
                await spawnShell();
              } catch {}
            }
            // 发送 input 的客户端成为活跃客户端
            if (activeWs !== ws) {
              activeWs = ws;
              // 切换活跃客户端时，如果有移动端在线则保持移动端尺寸，
              // 否则切换到新活跃客户端的尺寸
              const mSize = getMobileSize();
              if (mSize) {
                resizePty(mSize.cols, mSize.rows);
              } else {
                const size = clientSizes.get(ws);
                if (size) {
                  resizePty(size.cols, size.rows);
                }
              }
            }
            // 拦截连续 Ctrl+C：2秒内连按2次则阻止并提醒，避免误退出 CLI
            if (msg.data === '\x03') {
              const now = Date.now();
              if (!ws._ctrlCLastTime) ws._ctrlCLastTime = 0;
              if (now - ws._ctrlCLastTime < 2000) {
                ws._ctrlCLastTime = 0;
                try { ws.send(JSON.stringify({ type: 'toast', message: t('ui.terminal.ctrlCBlocked') })); } catch {}
                // 不发送第二次 Ctrl+C 到 PTY
              } else {
                ws._ctrlCLastTime = now;
                writeToPty(msg.data);
              }
            } else {
              writeToPty(msg.data);
            }
          } else if (msg.type === 'input-sequential') {
            // Programmatic sequential input: send chunks one by one, waiting for PTY ACK
            const state = getPtyState();
            if (!state.running) {
              try { await spawnShell(); } catch {}
            }
            const chunks = msg.chunks;
            if (Array.isArray(chunks) && chunks.length > 0) {
              writeToPtySequential(chunks, (ok) => {
                try {
                  ws.send(JSON.stringify({ type: 'input-sequential-done', ok }));
                } catch {}
              }, { settleMs: msg.settleMs || 150 });
            }
          } else if (msg.type === 'ask-hook-answer') {
            // Client answered AskUserQuestion via hook bridge
            if (pendingAskHook) {
              const { res: hookRes, timer } = pendingAskHook;
              clearTimeout(timer);
              pendingAskHook = null;
              try {
                if (!hookRes.headersSent) {
                  hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                  hookRes.end(JSON.stringify({ answers: msg.answers }));
                }
              } catch {}
            }
          } else if (msg.type === 'resize') {
            // 存储该客户端的尺寸
            clientSizes.set(ws, { cols: msg.cols, rows: msg.rows });
            if (msg.mobile) mobileClients.add(ws);
            // 移动端 resize 始终生效；PC 端仅在无移动端时生效
            if (msg.mobile) {
              resizePty(msg.cols, msg.rows);
            } else if (mobileClients.size === 0 && (activeWs === ws || activeWs === null)) {
              activeWs = ws;
              resizePty(msg.cols, msg.rows);
            }
          }
        } catch {}
      });

      ws.on('close', () => {
        removeDataListener();
        removeExitListener();
        clientSizes.delete(ws);
        mobileClients.delete(ws);
        if (activeWs === ws) {
          // 活跃客户端断开，将控制权交给剩余的某个客户端
          activeWs = null;
          // 优先使用移动端尺寸，无移动端则用剩余客户端尺寸
          const mSize = getMobileSize();
          if (mSize) {
            resizePty(mSize.cols, mSize.rows);
          } else {
            for (const [remainWs, size] of clientSizes) {
              if (remainWs.readyState === 1) {
                activeWs = remainWs;
                resizePty(size.cols, size.rows);
                break;
              }
            }
          }
        }
      });
    });
  } catch (err) {
    console.error('[CC Viewer] Failed to setup terminal WebSocket:', err.message);
  }
}

export function getPort() {
  return actualPort;
}

export function getProtocol() {
  return serverProtocol;
}

export { getAllLocalIps };

export function getAccessToken() {
  return ACCESS_TOKEN;
}

// 流式状态 SSE 推送定时器：检测 streamingState 变化并广播给所有客户端
let _streamingStatusTimer = null;
let _lastStreamingActive = false;
function startStreamingStatusTimer() {
  if (_streamingStatusTimer) return;
  _streamingStatusTimer = setInterval(() => {
    const changed = streamingState.active !== _lastStreamingActive;
    if (changed || streamingState.active) {
      const data = streamingState.active
        ? { ...streamingState, elapsed: Date.now() - streamingState.startTime }
        : { active: false };
      if (clients.length > 0 && sendEventToClients) sendEventToClients(clients, 'streaming_status', data);
      _lastStreamingActive = streamingState.active;
    }
  }, 500);
  _streamingStatusTimer.unref();
}

let _stoppingPromise = null;
export function stopViewer() {
  if (_stoppingPromise) return _stoppingPromise;
  _stoppingPromise = _doStop();
  return _stoppingPromise;
}
async function _doStop() {
  try { await Promise.race([runParallelHook('serverStopping'), new Promise(r => setTimeout(r, 3000))]); } catch { }
  // 如果用户未做选择，将临时文件转为正式文件
  if (_resumeState && _resumeState.tempFile) {
    try {
      const { tempFile } = _resumeState;
      if (existsSync(tempFile)) {
        // 只有非空 temp 文件才 rename 为正式文件，空文件直接删除
        const sz = statSync(tempFile).size;
        if (sz > 0) {
          const newPath = tempFile.replace('_temp.jsonl', '.jsonl');
          renameSync(tempFile, newPath);
        } else {
          unlinkSync(tempFile);
        }
      }
    } catch { }
  }
  for (const logFile of getWatchedFiles().keys()) {
    unwatchFile(logFile);
  }
  unwatchFile(CONTEXT_WINDOW_FILE);
  getWatchedFiles().clear();
  clients.forEach(client => client.end());
  clients = [];
  if (server) {
    server.close();
  }
  if (statsWorker) {
    statsWorker.terminate();
    statsWorker = null;
  }
  if (_streamingStatusTimer) {
    clearInterval(_streamingStatusTimer);
    _streamingStatusTimer = null;
  }
  resetStreamingState();
}

// Auto-start the viewer after log file init completes
// 工作区模式下由 cli.js 直接 import server.js 触发启动，跳过 _initPromise 自动启动
if (!isWorkspaceMode) {
  _initPromise.then(() => {
    startViewer().then((srv) => {
      if (!srv) return;
      // 延迟 3 秒异步检查更新
      setTimeout(() => {
        checkAndUpdate().then(result => {
          if (result.status === 'updated') {
            clients.forEach(client => {
              try { client.write(`event: update_completed\ndata: ${JSON.stringify({ version: result.remoteVersion })}\n\n`); } catch { }
            });
          } else if (result.status === 'major_available') {
            clients.forEach(client => {
              try { client.write(`event: update_major_available\ndata: ${JSON.stringify({ version: result.remoteVersion })}\n\n`); } catch { }
            });
          }
        }).catch(() => { });
      }, 3000);
    }).catch(err => {
      console.error('Failed to start CC Viewer:', err);
    });
  });
}

// 进程退出时，将未决的临时文件转为正式文件
function handleExit() {
  if (_resumeState && _resumeState.tempFile) {
    try {
      if (existsSync(_resumeState.tempFile)) {
        const newPath = _resumeState.tempFile.replace('_temp.jsonl', '.jsonl');
        renameSync(_resumeState.tempFile, newPath);
      }
    } catch { }
  }
}
process.on('exit', handleExit);
process.on('SIGINT', () => { stopViewer().finally(() => process.exit()); });
process.on('SIGTERM', () => { stopViewer().finally(() => process.exit()); });
