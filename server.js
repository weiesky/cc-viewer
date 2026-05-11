import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, statSync, lstatSync, readdirSync, renameSync, unlinkSync, rmSync, openSync, readSync, closeSync, realpathSync, mkdirSync, createReadStream, cpSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, basename, sep } from 'node:path';
import { homedir, platform, networkInterfaces, tmpdir } from 'node:os';
import { execFile, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { isPathContained, ERROR_STATUS_MAP, validateImportDir } from './lib/file-api.js';
import { isReadAllowed, reasonToStatus, bumpWorkspacesVersion } from './lib/file-access-policy.js';

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
import { LOG_FILE, _initPromise, _resumeState, resolveResumeChoice, _projectName, _logDir, _cachedApiKey, _cachedAuthHeader, _cachedHaikuModel, initForWorkspace, resetWorkspace, streamingState, resetStreamingState, _loadProxyProfile, PROFILE_PATH, _defaultConfig, setLivePort, setActiveProfileForWorkspace, getActiveProfileId } from './interceptor.js';
import { LOG_DIR, setLogDir, getClaudeConfigDir } from './findcc.js';
import { t, detectLanguage } from './i18n.js';
import { checkAndUpdate } from './lib/updater.js';
import { loadPlugins, runWaterfallHook, runParallelHook, getPluginsInfo, getPluginsDir } from './lib/plugin-loader.js';
import { uploadPlugins, installPluginFromUrl } from './lib/plugin-manager.js';
import { getUserProfile } from './lib/user-profile.js';
import { getGitDiffs, countUntrackedLines, getUnpushedCommits, isValidCommitHash } from './lib/git-diff.js';
import { CONTEXT_WINDOW_FILE, readModelContextSize, buildContextWindowEvent, getContextSizeForModel } from './lib/context-watcher.js';
import { watchLogFile, startWatching, getWatchedFiles, sendEventToClients, sendToClients } from './lib/log-watcher.js';
import { isMainAgentEntry, extractCachedContent } from './lib/kv-cache-analyzer.js';
import { listLocalLogs, deleteLogFiles, mergeLogFiles } from './lib/log-management.js';
import { countLogEntries, streamRawEntriesAsync, readPagedEntries } from './lib/log-stream.js';
import { awaitDrainOrClose } from './lib/sse-backpressure.js';
import { enrichRawIfNeeded } from './lib/enrich-plan-input.js';
import { buildTeamStatusResponse } from './lib/team-runtime.js';
import { discoverClaudeMdCandidates, readCandidateById } from './lib/claude-md-discovery.js';


// 动态获取 getPrefsFile()（LOG_DIR 可能在运行时被 setLogDir 修改）
function getPrefsFile() { return join(LOG_DIR, 'preferences.json'); }

// 启动时一次性读取 ~/.claude/settings.json（不 watch）
let claudeSettings = {};
// SSR theme 注入自检状态：模板缺 data-theme 时仅首次 warn（避免高 QPS 刷屏）
let _ssrThemeAttrWarned = false;
try {
  const settingsPath = join(getClaudeConfigDir(), 'settings.json');
  if (existsSync(settingsPath)) {
    claudeSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  }
} catch { }
const isCliMode = process.env.CCV_CLI_MODE === '1';
const isSdkMode = process.env.CCV_SDK_MODE === '1';
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

// 多 git 仓库支持：解析 repo 参数为安全的 cwd 路径
function resolveRepoCwd(repoParam) {
  const projectDir = process.env.CCV_PROJECT_DIR || process.cwd();
  if (!repoParam || repoParam === '.') return projectDir;
  if (repoParam.includes('/') || repoParam.includes('..') || repoParam.includes('\\')) return null;
  const candidate = join(projectDir, repoParam);
  try {
    if (!existsSync(candidate) || !statSync(candidate).isDirectory()) return null;
    if (!existsSync(join(candidate, '.git'))) return null;
    if (!isPathContained(candidate, projectDir)) return null;
  } catch { return null; }
  return candidate;
}

// 工作区模式：保存 Claude 额外参数，供 launch API 使用
let _workspaceClaudeArgs = [];
let _workspaceClaudePath = null;
let _workspaceIsNpmVersion = false;
let _workspaceLaunched = false; // 工作区是否已经启动了会话

// Ask hook bridge state (for PreToolUse AskUserQuestion hook)
// Map supports concurrent ask requests (sub-agents / teammates) so a stale unanswered
// ask never blocks the next one. Keyed by server-generated id.
const pendingAskHooks = new Map(); // Map<id, { questions, res, timer, createdAt }>
const ASK_HOOK_MAP_MAX = 50;

// Permission hook bridge state (for PreToolUse permission approval)
// Map supports concurrent sub-agent/teammate requests (keyed by request id)
const pendingPermHooks = new Map(); // Map<id, { toolName, input, res, timer, createdAt }>
const PERM_HOOK_MAP_MAX = 50;

// Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）模块级常量——multipart 3 处 upload
// handler 都用此校验，避免内联 regex 复制粘贴漂移。
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

// Per-file mutex for /api/git-restore —— 防多 tab 并发 revert 同文件造成 git status + checkout
// 子命令序列被插队导致不可预测的工作树状态。Promise chain 串行化同 key 请求；finally 路径
// 主清理，setTimeout 兜底防 finally 异常吞 entry 累积内存。
const gitRestoreLocks = new Map(); // Map<absLockKey, Promise<void>>
const GIT_RESTORE_LOCK_CLEANUP_MS = 30000;

// Notify the parent process (Electron main, when forked under tab-worker) about pending state changes.
// No-op outside Electron (process.send is undefined when run as a standalone Node server).
// Only ask-hook-* / sdk-ask-* are translated. Permission and SDK plan stay inline-only and do not
// drive global modal / flashFrame / Notification (per UX direction). PTY plan is parsed in the
// renderer and reported via window.tabBridge directly, not through this server-side hook.
function _notifyParentPending(msg) {
  if (!process.send || !msg || typeof msg !== 'object' || !msg.type) return;
  let event = null;
  switch (msg.type) {
    case 'ask-hook-pending':
    case 'sdk-ask-pending':
      event = { type: 'pending-add', kind: 'ask', id: msg.id != null ? String(msg.id) : '__ask__', payload: { questions: msg.questions, projectName: _projectName || '' } };
      break;
    case 'ask-hook-timeout':
    case 'sdk-ask-timeout':
    case 'ask-hook-resolved':
    case 'sdk-ask-resolved':
      event = { type: 'pending-remove', kind: 'ask', id: msg.id != null ? String(msg.id) : '__ask__' };
      break;
    default:
      return;
  }
  try { process.send(event); } catch {}
}

// Live stream chunk sequence tracking (per request key) — prevents out-of-order broadcasts
const _liveStreamLastSeq = new Map(); // Map<`${timestamp}|${url}`, lastSeq>


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
let _writeToPty = null; // PTY write function reference (set by setupTerminalWebSocket)
let _onPtyData = null;  // PTY data listener registration (set by setupTerminalWebSocket)
export function setWorkspaceClaudeArgs(args) {
  _workspaceClaudeArgs = args;
}
export function setWorkspaceClaudePath(path, isNpm) {
  _workspaceClaudePath = path;
  _workspaceIsNpmVersion = isNpm;
}
let _launchCallback = null;
export function setLaunchCallback(fn) { _launchCallback = fn; }
export function setWorkspaceLaunched(v) { _workspaceLaunched = v; }
export function initPostLaunch() {
  watchLogFile(_logWatcherOpts(LOG_FILE));
  if (!statsWorker) startStatsWorker();
  startStreamingStatusTimer();
}

// Global POST body size limit (10MB) to prevent OOM from malicious/buggy clients
const MAX_POST_BODY = 10 * 1024 * 1024;

// /events 默认重放窗口：bare 请求（无 since、无 limit、无 cc）时使用，
// 防止长会话把数十 MB 历史一次性灌进浏览器导致 renderer OOM。
// 用户显式 ?limit=0 可恢复全量加载（power-user 逃生口）。
const DEFAULT_EVENTS_LIMIT = 1000;
// SSE 单客户端 backpressure 容忍上限：连续未排空 > 此时长则视为 dead 客户端剔除。
const SSE_BACKPRESSURE_TIMEOUT_MS = 5000;



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const START_PORT = parseInt(process.env.CCV_START_PORT) || 7008;
const MAX_PORT = parseInt(process.env.CCV_MAX_PORT) || 7099;
const HOST = '0.0.0.0';

// 局域网访问 token（本地 127.0.0.1 免验证）
const TOKEN_PATH = join(getClaudeConfigDir(), 'cc-viewer', 'access-token.json');

function _ensureTokenDir() {
  const dir = dirname(TOKEN_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function _loadOrCreateToken() {
  _ensureTokenDir();
  if (existsSync(TOKEN_PATH)) {
    try {
      const data = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
      if (data.token && /^[0-9a-f]{32}$/i.test(data.token)) return { token: data.token, persistent: true };
    } catch { /* fallback to generate */ }
  }
  const token = randomBytes(16).toString('hex');
  writeFileSync(TOKEN_PATH, JSON.stringify({ token, createdAt: Date.now() }, null, 2), { mode: 0o600 });
  return { token, persistent: false };
}

const _tokenInit = _loadOrCreateToken();
let ACCESS_TOKEN = _tokenInit.token;
const IS_TOKEN_PERSISTENT = _tokenInit.persistent;

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
  if (url === '/ws/terminal' || url === '/ws/terminal-scratch') {
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

  // DNS rebinding 防护:即使带了正确 token,Host header 必须落在 allowlist 里。
  // 默认放行 loopback + 本机所有 LAN IPv4(getAllLocalIps()):cc-viewer 核心场景就是手机扫码访问 LAN URL,
  // 要求用户每次手动设 CCV_ALLOWED_HOSTS 不可接受。token 仍是必需(server.js:300-310 ACCESS_TOKEN gate),
  // DNS rebinding 攻击者需精确知道用户 LAN IP 才能利用,门槛降低但不增新攻击面;Vite/Cursor 同行也默认放开 LAN。
  // CCV_ALLOWED_HOSTS 显式设(包括 '*' 关闭防护)时完全沿用用户值,与 1.6.227 行为一致,向后兼容。
  // CCV_EXTRA_ALLOWED_HOSTS 用于在默认/CCV_ALLOWED_HOSTS 基础上追加额外 host(如内网穿透外网地址),不影响原有列表。
  // 静态资源和 OPTIONS 预检不挡。
  if (!isStaticAsset && method !== 'OPTIONS') {
    const defaultHosts = ['localhost', '127.0.0.1', '::1', '[::1]', ...getAllLocalIps()];
    const allowedHosts = process.env.CCV_ALLOWED_HOSTS
      ? process.env.CCV_ALLOWED_HOSTS.split(',').map(s => s.trim()).filter(Boolean)
      : [...defaultHosts];
    if (process.env.CCV_EXTRA_ALLOWED_HOSTS && !allowedHosts.includes('*')) {
      const extras = process.env.CCV_EXTRA_ALLOWED_HOSTS.split(',').map(s => s.trim()).filter(Boolean);
      allowedHosts.push(...extras);
    }
    if (!allowedHosts.includes('*')) {
      const hostHeader = (req.headers.host || '').toLowerCase();
      // 端口剥离:RFC 3986 要求 IPv6 Host 必须带 brackets `[::1]:port`,bare `::1` 末尾 `\d` 会被错剥成 `:`。
      // 含 `::` 但无 `]` 闭合的视为 bare IPv6,不剥端口。
      const isBareIPv6 = hostHeader.includes('::') && !hostHeader.includes(']');
      const hostNoPort = isBareIPv6 ? hostHeader : hostHeader.replace(/:\d+$/, '');
      const stripBrackets = hostNoPort.replace(/^\[|\]$/g, '');
      const ok = allowedHosts.some(h => {
        const hl = h.toLowerCase();
        return hl === hostNoPort || hl === stripBrackets || hl === `[${stripBrackets}]`;
      });
      if (!ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'host-not-allowed', host: hostNoPort }));
        return;
      }
    }
  }

  // Plugin hook: intercept HTTP requests (after auth, before routing)
  try {
    const hookResult = await runWaterfallHook('beforeRequest', {
      req, res, url, method, parsedUrl, handled: false,
    });
    if (hookResult.handled) return;
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Plugin error' }));
    }
    return;
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
    const MAX_UPLOAD = 100 * 1024 * 1024; // 100MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_UPLOAD) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
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
        // sanitize: 只过 null byte + 控制字符 + 路径分隔符（真正会破坏 fs 调用的字符）；
        // Windows 非法字符 <>:"|?* 在 Unix 合法（ISO 时间戳 10:30:45.log、name:v1.txt 等常见），
        // 不做跨平台代理过滤，让 writeFileSync 在 Windows 上自行抛错即可。
        const originalName = nameMatch[1].replace(/[\x00-\x1f/\\]/g, '_');
        // Windows 保留设备名守卫（/api/upload-image）——见 WINDOWS_RESERVED_NAMES 注释。
        {
          const base = originalName.split('.')[0].trim().toLowerCase();
          if (WINDOWS_RESERVED_NAMES.test(base)) {
            throw new Error('Reserved filename not allowed');
          }
        }
        const bodyStart = headerEnd + 4;
        // Find the closing boundary
        const closingBoundary = Buffer.from('\r\n--' + boundary);
        const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
        const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);
        // Windows 没有 /tmp，走 os.tmpdir() (%TEMP%)；POSIX 保留 /tmp/cc-viewer-uploads/
        // 以兼容 1.6.245 PR #81 的 macOS allowlist 修复（/private/tmp 双 realpath）。
        const uploadDir = process.platform === 'win32' ? join(tmpdir(), 'cc-viewer-uploads') : '/tmp/cc-viewer-uploads';
        mkdirSync(uploadDir, { recursive: true });
        bumpWorkspacesVersion();
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
          const persistDir = join(getClaudeConfigDir(), 'cc-viewer', pName, 'images');
          mkdirSync(persistDir, { recursive: true });
          persistPath = join(persistDir, uniqueName);
          writeFileSync(persistPath, fileData);
        } catch { }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: savePath, persistPath }));
      } catch (err) {
        console.error('upload error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upload failed' }));
      }
    });
    return;
  }

  // Import file directly into project directory
  if (url.startsWith('/api/import-file') && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing boundary' }));
      return;
    }
    const importUrl = new URL(req.url, `${serverProtocol}://${req.headers.host}`);
    const dir = importUrl.searchParams.get('dir') || '';
    // 在 mkdirSync 之前纯字符串校验，防 symlink 副作用目录被创建在项目外
    const dirCheck = validateImportDir(dir);
    if (!dirCheck.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: dirCheck.error }));
      return;
    }
    const MAX_UPLOAD = 100 * 1024 * 1024; // 100MB
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_UPLOAD) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
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
        res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const targetDir = join(cwd, dir);
        mkdirSync(targetDir, { recursive: true });
        const realDir = realpathSync(targetDir);
        const realCwd = realpathSync(cwd);
        if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        const buf = Buffer.concat(chunks);
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) throw new Error('Malformed multipart');
        const headerStr = buf.slice(0, headerEnd).toString();
        const nameMatch = headerStr.match(/filename="([^"]+)"/);
        if (!nameMatch) throw new Error('No filename');
        // sanitize 与 /api/upload 一致：只过真正有害的字符，保留 Unix 合法 : " < > | ? * 等
        const originalName = nameMatch[1].replace(/[\x00-\x1f/\\]/g, '_');
        // Windows 保留设备名守卫（见 WINDOWS_RESERVED_NAMES 注释）。
        {
          const base = originalName.split('.')[0].trim().toLowerCase();
          if (WINDOWS_RESERVED_NAMES.test(base)) {
            throw new Error('Reserved filename not allowed');
          }
        }
        const bodyStart = headerEnd + 4;
        const closingBoundary = Buffer.from('\r\n--' + boundary);
        const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
        const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);
        // Resolve unique filename via exclusive write (wx)；避免并发 TOCTOU 覆盖
        const dotIdx = originalName.lastIndexOf('.');
        const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
        const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
        let finalName = originalName;
        let savePath = join(realDir, finalName);
        let counter = 1;
        let written = false;
        // 最多重试 10000 次（极端场景保底）；耗尽后必须显式抛错，防止返回虚假成功
        while (counter < 10001) {
          try {
            writeFileSync(savePath, fileData, { flag: 'wx' });
            written = true;
            break;
          } catch (e) {
            if (e && e.code === 'EEXIST') {
              finalName = `${stem}-${counter}${ext}`;
              savePath = join(realDir, finalName);
              counter++;
              continue;
            }
            throw e;
          }
        }
        if (!written) throw new Error('Too many filename conflicts');
        const relPath = dir ? `${dir}/${finalName}` : finalName;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name: finalName, relPath }));
      } catch (err) {
        console.error('import-file error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Import failed' }));
      }
    });
    return;
  }

  // 读取 ~/.claude/plans/*.md 文件内容（用于 ExitPlanMode V2 input.planFilePath 的兜底显示）
  // 自身保留:.md 后缀、绝对路径、null-byte、2MB 体积。
  // 路径前缀 / realpath / 敏感拦截委托 lib/file-access-policy.js(allowlist 已含 ~/.claude/)。
  if (url === '/api/plan-file' && method === 'GET') {
    try {
      const raw = parsedUrl.searchParams.get('path') || '';
      if (!raw) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing path' }));
        return;
      }
      if (raw.indexOf('\x00') !== -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid path (null byte)' }));
        return;
      }
      if (!raw.toLowerCase().endsWith('.md')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid extension' }));
        return;
      }
      const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(raw);
      if (!isAbs) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'absolute path required' }));
        return;
      }

      // 委托 policy:realpath + allowlist + denylist + 项目内豁免一气呵成
      const policy = isReadAllowed(raw);
      if (!policy.ok) {
        // 兼容旧测试断言:plan-file 历史用 'forbidden' / 'not found' 大类,reason 携带细节
        const status = policy.reason === 'realpath-failed' ? 404 : 403;
        const errLabel = policy.reason === 'realpath-failed' ? 'not found' : 'forbidden';
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: errLabel, reason: policy.reason }));
        return;
      }

      // 用 policy 返回的 real 读,避免 TOCTOU
      const real = policy.real;
      const st = statSync(real);
      if (!st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not a file' }));
        return;
      }
      if (st.size > 2 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'too large' }));
        return;
      }
      const content = readFileSync(real, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, content }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
    return;
  }

  if (url === '/api/preferences' && method === 'GET') {
    let prefs = {};
    try { if (existsSync(getPrefsFile())) prefs = JSON.parse(readFileSync(getPrefsFile(), 'utf-8')); } catch { }
    prefs.logDir = LOG_DIR; // 始终返回当前运行时的日志目录
    // home-friendly 展示形态：设了 CLAUDE_CONFIG_DIR 的用户看到真实路径，默认用户看到 "~/.claude"
    // join() 而非字符串拼接，避免 Windows 分隔符不匹配导致比较失败
    const _cDir = getClaudeConfigDir();
    prefs.claudeConfigDir = _cDir === join(homedir(), '.claude') ? '~/.claude' : _cDir;
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
        // 如果修改了日志目录，先切换再保存到新位置（新目录下生成 preferences.json）
        if (incoming.logDir && typeof incoming.logDir === 'string') {
          setLogDir(incoming.logDir);
        }
        let prefs = {};
        try { if (existsSync(getPrefsFile())) prefs = JSON.parse(readFileSync(getPrefsFile(), 'utf-8')); } catch { }
        Object.assign(prefs, incoming);
        // 确保目录存在
        const prefsFile = getPrefsFile();
        const prefsDir = dirname(prefsFile);
        if (!existsSync(prefsDir)) mkdirSync(prefsDir, { recursive: true });
        writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
        // 主题切换时同步到 Claude Code CLI：发 /theme，监听输出验证结果，不对就再发一次
        if (incoming.themeColor && _writeToPty && _onPtyData) {
          const target = incoming.themeColor === 'light' ? 'light' : 'dark';
          let buf = '';
          let retried = false;
          const removeListener = _onPtyData((data) => {
            buf += data;
            if (buf.length > 4096) buf = buf.slice(-2048); // 限制 buf 大小
            // 解析 PTY 输出中的 "Theme set to light" 或 "Theme set to dark"
            const match = buf.match(/Theme set to (light|dark)/);
            if (match) {
              removeListener();
              clearTimeout(timeout);
              if (match[1] !== target && !retried) {
                // 结果与目标不一致，再 toggle 一次
                retried = true;
                try { _writeToPty('/theme\r'); } catch {}
              }
            }
          });
          // 5 秒超时，避免监听器泄漏
          const timeout = setTimeout(() => { removeListener(); }, 5000);
          try { _writeToPty('/theme\r'); } catch {}
        }
        prefs.logDir = LOG_DIR;
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
        const { path: wsPath, extraArgs: launchExtraArgs } = JSON.parse(body);
        if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid directory path' }));
          return;
        }

        const { registerWorkspace } = await import('./workspace-registry.js');
        registerWorkspace(wsPath);

        // Electron multi-tab 模式：管理 server 只触发 callback，不做日志初始化
        // 所有日志相关操作（initForWorkspace、watchLogFile、spawnClaude）由 tab-worker 子进程负责
        if (process.env.CCV_ELECTRON_MULTITAB === '1') {
          if (_launchCallback) {
            _launchCallback(wsPath, Array.isArray(launchExtraArgs) ? launchExtraArgs : []);
          }
          _workspaceLaunched = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, projectName: basename(wsPath) }));
          return;
        }

        // 非 Electron 模式（web / CLI）：完整逻辑
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
          const mergedArgs = [..._workspaceClaudeArgs, ...(Array.isArray(launchExtraArgs) ? launchExtraArgs : [])];
          await spawnClaude(parseInt(proxyPort), wsPath, mergedArgs, _workspaceClaudePath, _workspaceIsNpmVersion, actualPort, serverProtocol);
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
    Promise.all([
      import('./pty-manager.js').then(({ killPty }) => killPty()),
      import('./scratch-pty-manager.js').then(({ killAllScratch }) => killAllScratch()).catch(() => {}),
    ]).then(() => {
      // 接续原有清理流程

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

    // 分页参数：
    // - mobile 首次加载传 ?limit=200
    // - bare desktop 请求（无任何 query 参数）默认套 DEFAULT_EVENTS_LIMIT
    // - 显式 ?limit=0 表示"我要全量"（保留旧行为入口）
    const limitParamRaw = parsedUrl.searchParams.get('limit');
    const limitParamGiven = limitParamRaw !== null;
    const limitParamNum = parseInt(limitParamRaw, 10);
    let effectiveLimit = 0;
    if (!useIncremental) {
      if (limitParamGiven) {
        effectiveLimit = Number.isFinite(limitParamNum) && limitParamNum > 0 ? limitParamNum : 0;
      } else {
        effectiveLimit = DEFAULT_EVENTS_LIMIT;
      }
    }
    const useLimit = effectiveLimit > 0;

    // KV-Cache / context_window 追踪（扫描全量条目，不受 since 过滤影响）
    let latestKvCache = null;
    let latestContextWindow = null;
    let pushedContextWindow = false;

    await streamRawEntriesAsync(LOG_FILE, async (raw) => {
      // 直接发送原始 JSON 字符串，不做 parse/reconstruct/stringify
      // ExitPlanMode V2 空 input 的条目按需补全 plan / planFilePath，其它原样透传
      if (res.destroyed || !res.writable) return;
      const out = enrichRawIfNeeded(raw);
      // SSE data 字段不允许裸换行，去除 pretty-printed JSON 的换行
      // 写入路径整体 try-catch 兜底：连接在 res.write 之间被对端 RST/destroy 时不至于
      // 把 EPIPE 抛穿 async callback；res.on('close'|'error') 已会做 clients 数组清理。
      let drained = true;
      try {
        res.write('event: load_chunk\ndata: [');
        drained = res.write(out.includes('\n') ? out.replace(/\n/g, '') : out);
        res.write(']\n\n');
      } catch {
        return;
      }
      // 写缓冲满则等 drain（或 close/error/超时任一 fulfill），防止浏览器侧 renderer OOM。
      // helper 内部会在 fulfill 时把另外两个监听器从 res 上摘掉，避免 N 次 backpressure
      // 累积出 N 个 stale close/error listener 触发 MaxListenersExceededWarning。
      if (!drained) {
        await awaitDrainOrClose(res, SSE_BACKPRESSURE_TIMEOUT_MS);
      }
    }, {
      since: useIncremental ? sinceParam : undefined,
      limit: useLimit ? effectiveLimit : undefined,
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

    // req.on('close') 在某些异常断连时不一定立即触发；res 端 close/error 兜底保证
    // 不会在 clients 数组里留下幽灵 res，防止 sendToClients 后续写入触发慢泄漏。
    const removeFromClients = () => {
      clearInterval(pingTimer);
      const idx = clients.indexOf(res);
      if (idx !== -1) clients.splice(idx, 1);
    };
    req.on('close', removeFromClients);
    res.on('close', removeFromClients);
    res.on('error', removeFromClients);
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
      res.write(enrichRawIfNeeded(raw));
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
      // ExitPlanMode V2 空 input 的条目用 enrichRawIfNeeded 在 raw 阶段补全
      const entries = result.entries.map(raw => {
        try { return JSON.parse(enrichRawIfNeeded(raw)); } catch { return null; }
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
    res.end(JSON.stringify({ env, model: claudeSettings.model || null, showThinkingSummaries: claudeSettings.showThinkingSummaries || false, claudeAvailable: process.env.CCV_CLAUDE_MISSING !== '1' }));
    return;
  }

  if (url === '/api/claude-settings' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const settingsPath = join(getClaudeConfigDir(), 'settings.json');
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
  // 数据拆分：profiles 列表 → profile.json（全局共享，fs.watchFile 跨进程同步）
  //          active → <workspace>/active-profile.json（每 workspace 独占，不污染其他 ccv 实例）
  if (url === '/api/proxy-profiles' && method === 'GET') {
    try {
      const data = existsSync(PROFILE_PATH) ? JSON.parse(readFileSync(PROFILE_PATH, 'utf-8')) : _defaultProxyProfiles;
      // 用 interceptor.getActiveProfileId() 返回 effective active（workspace > profile.json.active > 'max'）
      const effectiveActive = getActiveProfileId();
      const masked = _maskProfiles({ ...data, active: effectiveActive });
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
        // 只写 profiles 列表到 profile.json；active 不再入文件（避免跨进程串台）
        // 保留老数据里的 active 字段不变，以便老版本 ccv 或手动编辑者的回退能力
        const toWrite = { ...existing, profiles: incoming.profiles };
        const dir = dirname(PROFILE_PATH);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(PROFILE_PATH, JSON.stringify(toWrite, null, 2), { mode: 0o600 });
        // active 走 workspace 级别存储（当前进程独占）
        if (typeof incoming.active === 'string' && incoming.active) {
          setActiveProfileForWorkspace(incoming.active);
        } else {
          _loadProxyProfile(); // 仅列表变化时也刷新一次以反映删除 / 重命名
        }
        // SSE 广播仅给本进程客户端（sendEventToClients 本就是 per-process；另外 active 不跨进程）
        const effectiveActive = getActiveProfileId();
        const activeProfile = incoming.profiles?.find(p => p.id === effectiveActive) || null;
        const maskedProfile = activeProfile?.apiKey ? { ...activeProfile, apiKey: _maskApiKey(activeProfile.apiKey) } : activeProfile;
        sendEventToClients(clients, 'proxy_profile', { active: effectiveActive, profile: maskedProfile });
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

  // Skill 动态装卸 —— 列出所有 skill（含来源）
  if (url === '/api/skills' && method === 'GET') {
    try {
      const { listSkills } = await import('./lib/skills-api.js');
      const skills = listSkills({ projectDir: process.env.CCV_PROJECT_DIR || process.cwd() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, skills }));
    } catch (err) {
      console.error('[api/skills]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    }
    return;
  }

  // Skill 动态装卸 —— 切换单个 skill（在 skills/ 和 skills-skip/ 之间 move）
  if (url === '/api/skills/toggle' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
    req.on('end', async () => {
      try {
        const { source, name, enable } = JSON.parse(body);
        const { moveSkill } = await import('./lib/skills-api.js');
        // 不加进程锁：moveSkill 里 existsSync 前置 + renameSync 原子性已能让并发
        // toggle 落到合理分支（一个成功、另一个拿 SOURCE_MISSING 或 DEST_CONFLICT）；
        // 前端 toggling:Set 也已防同 tab 连点，两者叠加足够安全
        moveSkill({
          source, name, enable: !!enable,
          projectDir: process.env.CCV_PROJECT_DIR || process.cwd(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        const statusMap = {
          INVALID_NAME: 400, INVALID_SOURCE: 400, PATH_ESCAPE: 400, SYMLINK: 400,
          SOURCE_MISSING: 404, DEST_CONFLICT: 409,
        };
        const status = statusMap[err?.code] || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || 'internal_error', code: err?.code || 'unknown' }));
      }
    });
    return;
  }

  // Skill 上传/导入 API —— 接受 .zip 或 SKILL.md（忽略大小写），写入用户级 ~/.claude/skills/{name}/
  // 设计要点：
  //  · 100MB 上限，跟 /api/upload 一致；
  //  · 扩展名白名单只放 zip / md（忽略大小写）；其他类型直接 415；
  //  · zip 内必须含 SKILL.md（任意子目录、忽略大小写），找最浅的那个所在目录作为 skill 根；
  //  · skill 名优先取 SKILL.md frontmatter 的 name，回落到 zip / md 文件名（去扩展名）；
  //  · 名字必须通过 validateSkillName，目标目录已存在则 409 拒绝（前端引导用户改 zip 名）。
  if (url === '/api/skills/import' && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    // boundary 用 [^;]+ 终止避免吞掉后续 Content-Type 参数；长度封顶 200 防止超长串撑爆 buffer 比对。
    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
    if (!boundaryMatch || boundaryMatch[1].length > 200) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid boundary' }));
      return;
    }
    const MAX_UPLOAD = 100 * 1024 * 1024;
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_UPLOAD) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
      return;
    }
    const boundary = boundaryMatch[1].trim().replace(/^["']|["']$/g, '');
    const chunks = [];
    let totalSize = 0;
    let aborted = false;
    req.on('data', chunk => {
      totalSize += chunk.length;
      if (totalSize > MAX_UPLOAD) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (aborted) return;
      try {
        const buf = Buffer.concat(chunks);
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) throw Object.assign(new Error('Malformed multipart'), { status: 400 });
        const headerStr = buf.slice(0, headerEnd).toString();
        const nameMatch = headerStr.match(/filename="([^"]+)"/);
        if (!nameMatch) throw Object.assign(new Error('No filename'), { status: 400 });
        // NFKC 规范化 + 控制字符/路径分隔符过滤 + 零宽和方向覆盖字符过滤（防止 homoglyph / RLO 混淆）
        const originalName = nameMatch[1]
          .normalize('NFKC')
          .replace(/[\x00-\x1f/\\]/g, '_')
          .replace(/[​-‏‪-‮⁠﻿]/g, '');
        // Windows 保留设备名守卫（见 WINDOWS_RESERVED_NAMES 注释）。
        {
          const base = originalName.split('.')[0].trim().toLowerCase();
          if (WINDOWS_RESERVED_NAMES.test(base)) {
            throw Object.assign(new Error('Reserved filename not allowed'), { status: 400 });
          }
        }
        const lower = originalName.toLowerCase();
        const isZip = lower.endsWith('.zip');
        const isMd = lower.endsWith('.md');
        if (!isZip && !isMd) {
          throw Object.assign(new Error('Unsupported file type'), { status: 415, code: 'INVALID_TYPE' });
        }
        const bodyStart = headerEnd + 4;
        const closingBoundary = Buffer.from('\r\n--' + boundary);
        const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
        const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);

        const { validateSkillName } = await import('./lib/skills-api.js');
        const skillsRoot = join(getClaudeConfigDir(), 'skills');
        mkdirSync(skillsRoot, { recursive: true });

        // 简单 frontmatter name 解析：抓 `name: xxx` 单行（与 skills-api.js 的 description 解析风格保持一致，最小实现）
        const parseNameFromMd = (text) => {
          const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
          if (!m) return null;
          const nm = /^name\s*:\s*(.*)$/m.exec(m[1]);
          if (!nm) return null;
          return nm[1].trim().replace(/^["']|["']$/g, '');
        };

        const fallbackBaseName = (filename, stripExt) => {
          let n = filename.replace(/^.*[\\/]/, '');
          if (stripExt) n = n.replace(/\.[^.]+$/, '');
          return n;
        };

        let skillName = null;
        let skillFiles = []; // { relPath, data }

        if (isMd) {
          const text = fileData.toString('utf8');
          skillName = parseNameFromMd(text) || fallbackBaseName(originalName, true);
          skillFiles = [{ relPath: 'SKILL.md', data: fileData }];
        } else {
          // zip：用 adm-zip 解压到内存，校验 SKILL.md 存在（忽略大小写），找最浅的 SKILL.md 所在目录作为 skill 根
          const AdmZip = (await import('adm-zip')).default;
          let zip;
          try {
            zip = new AdmZip(fileData);
          } catch {
            throw Object.assign(new Error('Invalid zip archive'), { status: 400, code: 'INVALID_ZIP' });
          }
          const entries = zip.getEntries();
          // zip bomb 防护：单文件 ≤50MB，总解压 ≤200MB；以及拒绝 symlink entry
          // adm-zip 不直接暴露 isSymbolicLink，需用 attr 高 16 位的 unix mode 判断 0o120000
          const MAX_PER_FILE = 50 * 1024 * 1024;
          const MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024;
          let totalUncompressed = 0;
          for (const e of entries) {
            if (e.isDirectory) continue;
            const unixMode = (e.attr >>> 16) & 0xffff;
            if ((unixMode & 0o170000) === 0o120000) {
              throw Object.assign(new Error('Symlinks not allowed in zip'), { status: 400, code: 'INVALID_ZIP' });
            }
            const sizeRaw = e.header?.size || 0;
            if (sizeRaw > MAX_PER_FILE) {
              throw Object.assign(new Error('File too large in archive'), { status: 400, code: 'ZIP_BOMB' });
            }
            totalUncompressed += sizeRaw;
            if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
              throw Object.assign(new Error('Archive expands too large'), { status: 400, code: 'ZIP_BOMB' });
            }
          }
          // 找所有 SKILL.md（忽略大小写）的 entry，挑最浅的
          let bestSkillEntry = null;
          let bestDepth = Infinity;
          for (const e of entries) {
            if (e.isDirectory) continue;
            const en = e.entryName;
            const base = en.split('/').pop() || '';
            if (base.toLowerCase() === 'skill.md') {
              const depth = en.split('/').length;
              if (depth < bestDepth) { bestDepth = depth; bestSkillEntry = e; }
            }
          }
          if (!bestSkillEntry) {
            throw Object.assign(new Error('SKILL.md not found in zip'), { status: 400, code: 'MISSING_SKILL_MD' });
          }
          // skill 根 = SKILL.md 所在目录（如果在 zip 根则空字符串）
          const lastSlash = bestSkillEntry.entryName.lastIndexOf('/');
          const skillRootPrefix = lastSlash >= 0 ? bestSkillEntry.entryName.slice(0, lastSlash + 1) : '';
          const skillMdText = bestSkillEntry.getData().toString('utf8');
          skillName = parseNameFromMd(skillMdText)
            || (skillRootPrefix ? skillRootPrefix.replace(/\/$/, '').split('/').pop() : null)
            || fallbackBaseName(originalName, true);

          // 收集 skill 根下的所有文件，规范化 relPath（去掉 root prefix）
          // 二次校验：header.size 来自 zip 中央目录是攻击者可控的（可谎报 size=0），
          // 上面 zip bomb 检查已用 header.size 做"廉价初检"快速拒绝；这里 getData() 后用真实 data.length 复核，
          // 防止恶意 zip 在 header 上撒谎绕过总大小限制。任一阶段超额都抛 ZIP_BOMB。
          let actualTotal = 0;
          for (const e of entries) {
            if (e.isDirectory) continue;
            if (skillRootPrefix && !e.entryName.startsWith(skillRootPrefix)) continue;
            const rel = skillRootPrefix ? e.entryName.slice(skillRootPrefix.length) : e.entryName;
            if (!rel || rel.includes('..')) continue;
            const data = e.getData();
            if (data.length > MAX_PER_FILE) {
              throw Object.assign(new Error('File actual size too large'), { status: 400, code: 'ZIP_BOMB' });
            }
            actualTotal += data.length;
            if (actualTotal > MAX_TOTAL_UNCOMPRESSED) {
              throw Object.assign(new Error('Archive actual size too large'), { status: 400, code: 'ZIP_BOMB' });
            }
            // SKILL.md 统一规范化大小写
            const finalRel = rel.split('/').pop().toLowerCase() === 'skill.md'
              ? rel.replace(/[^/]*$/, 'SKILL.md')
              : rel;
            skillFiles.push({ relPath: finalRel, data });
          }
        }

        if (!validateSkillName(skillName)) {
          throw Object.assign(new Error(`Invalid skill name: ${skillName}`), { status: 400, code: 'INVALID_NAME' });
        }
        const targetDir = join(skillsRoot, skillName);
        // 原子创建：不带 recursive 让 mkdir 在已存在时直接抛 EEXIST，消除 existsSync 与 mkdirSync 之间的 TOCTOU 竞争窗口。
        // skillsRoot 已在前面 mkdirSync(skillsRoot, { recursive: true }) 兜底创建，所以这里 join 出的 parent 一定存在。
        try {
          mkdirSync(targetDir);
        } catch (err) {
          if (err.code === 'EEXIST') {
            throw Object.assign(new Error(`Skill already exists: ${skillName}`), { status: 409, code: 'EXISTS' });
          }
          throw err;
        }
        // 二次防御：resolved + sep 后缀比较，防止 prefix 攻击
        // (e.g. dest=/skills/my-skill-evil/x 不能以 /skills/my-skill 单独 startsWith 通过)
        const resolvedTarget = resolve(targetDir) + sep;
        for (const f of skillFiles) {
          const dest = join(targetDir, f.relPath);
          if (!resolve(dest).startsWith(resolvedTarget)) continue;
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, f.data);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name: skillName, path: targetDir }));
      } catch (err) {
        const status = err?.status || 500;
        if (status >= 500) console.error('[api/skills/import]', err);
        // 5xx 不向前端泄漏内部 message（可能含路径），只返回脱敏文本 + code 让前端做 i18n
        const safeError = status >= 500 ? 'server_error' : (err?.message || 'error');
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: safeError, code: err?.code || 'unknown' }));
      }
    });
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

  // 文件移动 API
  if (url === '/api/move-file' && method === 'POST') {
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
        const { fromPath, toDir } = parsed;
        if (!fromPath || !toDir) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing fromPath or toDir' }));
          return;
        }
        // 安全校验
        if (fromPath.startsWith('/') || fromPath.includes('..') || toDir.startsWith('/') || toDir.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const oldFullPath = join(cwd, fromPath);
        const toDirFull = join(cwd, toDir);
        // 检查源文件/目录存在
        if (!existsSync(oldFullPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Source not found' }));
          return;
        }
        // 检查目标目录存在且是目录
        if (!existsSync(toDirFull) || !statSync(toDirFull).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Target directory not found' }));
          return;
        }
        // 不能把目录移到自身或其子目录下
        if (statSync(oldFullPath).isDirectory()) {
          const srcResolved = resolve(oldFullPath);
          const destResolved = resolve(toDirFull);
          if (destResolved === srcResolved || destResolved.startsWith(srcResolved + sep)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot move directory into itself' }));
            return;
          }
        }
        const name = basename(fromPath);
        const newFullPath = join(toDirFull, name);
        // 检查目标位置不存在同名文件
        if (existsSync(newFullPath)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Target already exists' }));
          return;
        }
        try {
          renameSync(oldFullPath, newFullPath);
        } catch (mvErr) {
          if (mvErr.code === 'EXDEV') {
            // 跨文件系统：fallback to copy + delete。先 lstat 拒 symlink ——避免攻击者 swap 让
            // cpSync 跟随复制 + rmSync 跟随删除（同 /api/delete-file 的 TOCTOU）。
            const oldStat = lstatSync(oldFullPath);
            if (oldStat.isSymbolicLink()) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Cannot move symbolic links via this endpoint' }));
              return;
            }
            if (oldStat.isDirectory()) {
              // dereference: false 是 Node 默认，但显式写明意图——避免未来默认变更让递归 copy
              // 跟随内嵌 symlink 复制到 newFullPath 形成 cwd 内"指向 cwd 外"的活链。
              cpSync(oldFullPath, newFullPath, { recursive: true, dereference: false });
              rmSync(oldFullPath, { recursive: true, force: true });
            } else {
              copyFileSync(oldFullPath, newFullPath);
              unlinkSync(oldFullPath);
            }
          } else if (mvErr.code === 'EEXIST') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Target already exists' }));
            return;
          } else {
            throw mvErr;
          }
        }
        // 返回前端 JSON 统一 POSIX 风格，path.join 在 Win 上会产 backslash，需 normalize 回 '/'。
        const newRelPath = join(toDir, name).replace(/\\/g, '/');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, newPath: newRelPath }));
      } catch (err) {
        console.error('move-file error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // 删除文件 API
  if (url === '/api/delete-file' && method === 'POST') {
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
        const { path: filePath } = parsed;
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path' }));
          return;
        }
        if (filePath.startsWith('/') || filePath.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullPath = join(cwd, filePath);
        if (!existsSync(fullPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }
        const realFull = realpathSync(fullPath);
        const realCwd = realpathSync(cwd);
        if (!realFull.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        // 用 lstatSync 不跟随 symlink ——避免 TOCTOU 攻击者把目标换成软链让 rmSync(recursive)
        // 在 POSIX 上跟着删 cwd 外的目录。一切 symlink 目标都拒绝。
        const stat = lstatSync(fullPath);
        if (stat.isSymbolicLink()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot delete symbolic links via this endpoint' }));
          return;
        }
        if (stat.isDirectory()) {
          // protectedDirs 守卫得对 Win backslash 路径 & NTFS case-insensitive 同时设防 ——
          // 否则 `path: "node_modules\\foo"` 或 `".GIT"` 都能绕过 split('/') 直接删整目录。
          const protectedDirs = new Set(['node_modules', '.git', '.svn', '.hg']);
          const normalizedSegs = filePath.split(/[\\/]/).map(s => s.toLowerCase());
          if (normalizedSegs.some(part => protectedDirs.has(part))) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot delete protected directory' }));
            return;
          }
          // Defense-in-depth：lstat 跟 rmSync 间窗内攻击者再次 swap → 再 realpath 确认。
          const realFull2 = realpathSync(fullPath);
          if (!realFull2.startsWith(realCwd + sep)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Path escaped cwd after validation' }));
            return;
          }
          rmSync(fullPath, { recursive: true, force: true });
        } else if (stat.isFile()) {
          unlinkSync(fullPath);
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unsupported path type' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 在系统文件管理器中显示文件
  if (url === '/api/reveal-file' && method === 'POST') {
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
        const { path: filePath } = parsed;
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path' }));
          return;
        }
        if (filePath.startsWith('/') || filePath.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullPath = join(cwd, filePath);
        if (!existsSync(fullPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }
        const realFull = realpathSync(fullPath);
        const realCwd = realpathSync(cwd);
        if (!realFull.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        const plat = process.platform;
        if (plat === 'darwin') {
          execFile('open', ['-R', fullPath], () => {});
        } else if (plat === 'win32') {
          // explorer /select,<path> 必须合到一个 arg；分两个会让含空格/中文路径 escape 失败。
          spawn('explorer.exe', [`/select,${fullPath}`], { shell: false, windowsHide: true });
        } else {
          execFile('xdg-open', [dirname(fullPath)], () => {});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, fullPath }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 用系统默认应用打开文件
  if (url === '/api/open-file' && method === 'POST') {
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
        const { path: filePath } = parsed;
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path' }));
          return;
        }
        if (filePath.startsWith('/') || filePath.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullPath = join(cwd, filePath);
        if (!existsSync(fullPath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File not found' }));
          return;
        }
        const realFull = realpathSync(fullPath);
        const realCwd = realpathSync(cwd);
        if (!realFull.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        const plat = process.platform;
        if (plat === 'darwin') {
          execFile('open', [fullPath], () => {});
        } else if (plat === 'win32') {
          execFile('cmd.exe', ['/c', 'start', '', fullPath], () => {});
        } else {
          execFile('xdg-open', [fullPath], () => {});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 解析相对路径为绝对路径（不触发任何副作用）
  if (url === '/api/resolve-path' && method === 'POST') {
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
        const relPath = parsed.path || '';
        if (relPath.startsWith('/') || relPath.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullPath = relPath ? join(cwd, relPath) : cwd;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, fullPath }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 在指定目录下新建空文件
  if (url === '/api/create-file' && method === 'POST') {
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
        const { dirPath, name } = parsed;
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing name' }));
          return;
        }
        if (name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f]/.test(name)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid file name' }));
          return;
        }
        const relDir = dirPath || '';
        if (relDir.startsWith('/') || relDir.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullDirPath = relDir ? join(cwd, relDir) : cwd;
        if (!existsSync(fullDirPath) || !statSync(fullDirPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Directory not found' }));
          return;
        }
        const realDir = realpathSync(fullDirPath);
        const realCwd = realpathSync(cwd);
        if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        const fullPath = join(fullDirPath, name);
        if (existsSync(fullPath)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File already exists' }));
          return;
        }
        writeFileSync(fullPath, '');
        const relPath = relDir ? `${relDir}/${name}` : name;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: relPath }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 在指定目录下打开系统终端
  if (url === '/api/open-terminal' && method === 'POST') {
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
        const relDir = (parsed.path || '');
        if (relDir.startsWith('/') || relDir.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullDir = relDir ? join(cwd, relDir) : cwd;
        if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Directory not found' }));
          return;
        }
        const realDir = realpathSync(fullDir);
        const realCwd = realpathSync(cwd);
        if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        const plat = process.platform;
        if (plat === 'darwin') {
          spawn('open', ['-a', 'Terminal', fullDir], { stdio: 'ignore', detached: true }).unref();
        } else if (plat === 'win32') {
          spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd: fullDir, stdio: 'ignore', detached: true, windowsHide: true }).unref();
        } else {
          // Linux: try common terminal emulators
          const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
          let launched = false;
          for (const term of terminals) {
            try {
              if (term === 'gnome-terminal') {
                spawn(term, ['--working-directory=' + fullDir], { stdio: 'ignore', detached: true }).unref();
              } else if (term === 'konsole') {
                spawn(term, ['--workdir', fullDir], { stdio: 'ignore', detached: true }).unref();
              } else {
                spawn(term, [], { cwd: fullDir, stdio: 'ignore', detached: true }).unref();
              }
              launched = true;
              break;
            } catch { continue; }
          }
          if (!launched) {
            spawn('xdg-open', [fullDir], { stdio: 'ignore', detached: true }).unref();
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 在指定目录下新建空文件夹
  if (url === '/api/create-dir' && method === 'POST') {
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
        const { dirPath, name } = parsed;
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing name' }));
          return;
        }
        if (name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f]/.test(name)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid folder name' }));
          return;
        }
        const relDir = dirPath || '';
        if (relDir.startsWith('/') || relDir.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        const fullDirPath = relDir ? join(cwd, relDir) : cwd;
        if (!existsSync(fullDirPath) || !statSync(fullDirPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Directory not found' }));
          return;
        }
        const realDir = realpathSync(fullDirPath);
        const realCwd = realpathSync(cwd);
        if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
          return;
        }
        const fullPath = join(fullDirPath, name);
        if (existsSync(fullPath)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Already exists' }));
          return;
        }
        mkdirSync(fullPath);
        const relPath = relDir ? `${relDir}/${name}` : name;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: relPath }));
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
    let bodyTooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1000000) { // 1MB limit (questions may contain large previews)
        bodyTooLarge = true;
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (bodyTooLarge) {
        try { if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Request body too large' })); } } catch {}
        return;
      }
      try {
        const { questions, toolUseId } = JSON.parse(body);
        if (!Array.isArray(questions) || questions.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing questions' }));
          return;
        }
        // 镜像 ask-bridge 的 normalize：覆盖 plugin/SDK 等非 ask-bridge 的 client。
        // 缺失 description 补 ""，前端按 hasOptionDescription 判断走非渲染分支。
        for (const q of questions) {
          if (!q || typeof q !== 'object' || !Array.isArray(q.options)) continue;
          for (const opt of q.options) {
            if (opt && typeof opt === 'object' && opt.description === undefined) {
              opt.description = '';
            }
          }
        }

        // Evict oldest if Map is full (prevent memory leak from pathological concurrency).
        // Mirrors perm-hook eviction; an evicted bridge process gets HTTP 429 and falls back
        // to its own terminal UI rather than leaking long-poll state.
        if (pendingAskHooks.size >= ASK_HOOK_MAP_MAX) {
          const oldestId = pendingAskHooks.keys().next().value;
          const oldest = pendingAskHooks.get(oldestId);
          if (oldest) {
            clearTimeout(oldest.timer);
            try { if (!oldest.res.headersSent) { oldest.res.writeHead(429, { 'Content-Type': 'application/json' }); oldest.res.end(JSON.stringify({ error: 'Too many concurrent requests' })); } } catch {}
            pendingAskHooks.delete(oldestId);
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'ask-hook-timeout', id: oldestId });
              terminalWss.clients.forEach((c) => {
                if (c.readyState === 1) try { c.send(tmsg); } catch {}
              });
            }
            _notifyParentPending({ type: 'ask-hook-timeout', id: oldestId });
          }
        }

        const HOOK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        // toolUseId 路由策略：
        //  - char whitelist + ≤256 长度 防恶意 1MB key 撑大 Map
        //  - 已存在同 id 但旧 res 已断（writableEnded/destroyed）→ 复用槽位（ask-bridge 重试场景）
        //  - 已存在同 id 且旧 res 活 → 返 409 Conflict（真重复）而非走 fallback id 让前端 portal 失效
        //  - 缺 toolUseId 或非法 → fallback 自生成 id
        const wantsToolUseId = toolUseId && typeof toolUseId === 'string'
          && toolUseId.length > 0 && toolUseId.length <= 256
          && /^[a-zA-Z0-9_-]+$/.test(toolUseId);
        let id;
        if (wantsToolUseId) {
          const existing = pendingAskHooks.get(toolUseId);
          if (!existing) {
            id = toolUseId;
          } else if (!existing.res || existing.res.writableEnded || existing.res.destroyed) {
            // 旧 res 已断（包含占位 res:null 残留）— ask-bridge 重试同 toolUseId 合理，复用槽位
            if (existing.timer) clearTimeout(existing.timer);
            pendingAskHooks.delete(toolUseId);
            id = toolUseId;
          } else {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Duplicate toolUseId, previous request still pending' }));
            return;
          }
        } else {
          // Fallback id：当 hook caller 没传 toolUseId（如老 Claude Code PreToolUse hook
          // payload 不含 tool_use_id），生成 ask_${ts}_${rnd} 占位。这个 id 与 jsonl 里
          // tool_use.id（toolu_xxx）不同名，前端 portal 决策必须按 ask_* 前缀通配命中。
          // 协议锚点：src/utils/askPortalMatcher.js — 改此处前缀格式必须同步改 matcher。
          do { id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; } while (pendingAskHooks.has(id));
        }

        // TOCTOU 防御：占位 id 之前先注册 res.on('close')，否则 await runWaterfallHook 期间 client
        // abort 的 close 事件落空 → entry 残 5min。占位 set 提前到 await 之前防两条同 ms 并发
        // POST 的 do-while 都通过 collision check 后 set 互相覆盖（first res 永泄漏到 5min）。
        pendingAskHooks.set(id, { questions, res, timer: null, createdAt: Date.now() });

        // res.on('close') 提前注册：handler 用 entry.timer 守卫（占位期 timer:null → 仅 delete Map）
        res.on('close', () => {
          const entry = pendingAskHooks.get(id);
          if (entry) {
            if (entry.timer) clearTimeout(entry.timer);
            pendingAskHooks.delete(id);
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'ask-hook-timeout', id });
              terminalWss.clients.forEach((c) => {
                if (c.readyState === 1) try { c.send(tmsg); } catch {}
              });
            }
            _notifyParentPending({ type: 'ask-hook-timeout', id });
          }
        });

        // Plugin hook: let plugins answer questions directly
        try {
          const hookResult = await runWaterfallHook('onAskRequest', { id, questions, mode: 'hook' });
          if (hookResult.answers) {
            pendingAskHooks.delete(id); // 释放占位 — plugin 直接答了
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ answers: hookResult.answers }));
            return;
          }
        } catch {}

        const timer = setTimeout(() => {
          const entry = pendingAskHooks.get(id);
          if (entry) {
            pendingAskHooks.delete(id);
            try {
              // null guard：plugin throw + outer body-parse race 极端下占位残留时 fire 防 TypeError
              if (entry.res && !entry.res.headersSent) {
                entry.res.writeHead(408, { 'Content-Type': 'application/json' });
                entry.res.end(JSON.stringify({ error: 'Timeout' }));
              }
            } catch {}
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'ask-hook-timeout', id });
              terminalWss.clients.forEach((c) => {
                if (c.readyState === 1) try { c.send(tmsg); } catch {}
              });
            }
            _notifyParentPending({ type: 'ask-hook-timeout', id });
          }
        }, HOOK_TIMEOUT);

        pendingAskHooks.set(id, { questions, res, timer, createdAt: Date.now() });

        // Broadcast to all terminal WS clients
        if (terminalWss) {
          const pmsg = JSON.stringify({ type: 'ask-hook-pending', id, questions });
          terminalWss.clients.forEach((client) => {
            if (client.readyState === 1) {
              try { client.send(pmsg); } catch {}
            }
          });
        }
        _notifyParentPending({ type: 'ask-hook-pending', id, questions });
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // Permission hook bridge: receive tool permission request from perm-bridge.js, long-poll for user decision
  if (url === '/api/perm-hook' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1000000) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
    });
    req.on('end', async () => {
      try {
        const { toolName, input } = JSON.parse(body);
        if (!toolName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing toolName' }));
          return;
        }

        // Evict oldest if Map is full (prevent memory leak from pathological concurrency)
        if (pendingPermHooks.size >= PERM_HOOK_MAP_MAX) {
          const oldestId = pendingPermHooks.keys().next().value;
          const oldest = pendingPermHooks.get(oldestId);
          if (oldest) {
            clearTimeout(oldest.timer);
            try { if (!oldest.res.headersSent) { oldest.res.writeHead(429, { 'Content-Type': 'application/json' }); oldest.res.end(JSON.stringify({ error: 'Too many concurrent requests' })); } } catch {}
            pendingPermHooks.delete(oldestId);
          }
        }

        const HOOK_TIMEOUT = 5 * 60 * 1000;
        const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Plugin hook: let plugins handle permission requests directly.
        // 与 sdk-manager.js:401-412 对齐：严格白名单 'allow'|'deny'，未知值 fall-through 到常规审批。
        // 早期 truthy-check 会把 plugin 返回的任意字符串原样转发到 perm-bridge（再被 coerce 为 'deny'），
        // 既违反 cb2326e 声明的 fail-safe 语义，又让 SDK 与 bridge 两路径行为不对称。
        try {
          const hookResult = await runWaterfallHook('onPermRequest', { id, toolName, input, mode: 'hook' });
          if (hookResult.decision === 'allow' || hookResult.decision === 'deny') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ decision: hookResult.decision }));
            return;
          }
        } catch {}

        const timer = setTimeout(() => {
          const entry = pendingPermHooks.get(id);
          if (entry) {
            pendingPermHooks.delete(id);
            try {
              if (!entry.res.headersSent) {
                entry.res.writeHead(408, { 'Content-Type': 'application/json' });
                entry.res.end(JSON.stringify({ error: 'Timeout' }));
              }
            } catch {}
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'perm-hook-timeout', id });
              terminalWss.clients.forEach((c) => {
                if (c.readyState === 1) try { c.send(tmsg); } catch {}
              });
            }
          }
        }, HOOK_TIMEOUT);

        pendingPermHooks.set(id, { toolName, input, res, timer, createdAt: Date.now() });

        // Broadcast to all terminal WS clients
        if (terminalWss) {
          const pmsg = JSON.stringify({ type: 'perm-hook-pending', id, toolName, input });
          terminalWss.clients.forEach((client) => {
            if (client.readyState === 1) {
              try { client.send(pmsg); } catch {}
            }
          });
        }

        // Handle perm-bridge.js disconnection
        res.on('close', () => {
          const entry = pendingPermHooks.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            pendingPermHooks.delete(id);
            if (terminalWss) {
              const tmsg = JSON.stringify({ type: 'perm-hook-timeout', id });
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

  // 流式 chunk 接收端点：interceptor 在 SSE 流过程中推送的 partial entry
  // 仅广播，不落盘。前端按 timestamp|url 自动与最终 entry 去重覆盖。
  // 鉴权：server 绑 0.0.0.0 允许同机任意进程访问，必须校验 remote 必须是 loopback
  // 且请求带 x-cc-viewer-internal: 1 header，防止同机其他进程伪造 SSE 内容注入广播。
  if (url === '/api/stream-chunk' && method === 'POST') {
    const remote = req.socket.remoteAddress || '';
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const internalHeader = req.headers['x-cc-viewer-internal'] === '1';
    if (!isLoopback || !internalHeader) {
      try { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Forbidden' })); } catch {}
      return;
    }
    let body = '';
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        aborted = true;
        try { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Payload too large' })); } catch {}
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const entry = JSON.parse(body);
        const key = `${entry.timestamp}|${entry.url}`;
        const seq = typeof entry._chunkSeq === 'number' ? entry._chunkSeq : 0;
        const lastSeq = _liveStreamLastSeq.get(key);
        if (lastSeq !== undefined && seq < lastSeq) {
          // 乱序到达的旧 chunk 丢弃
          try { res.writeHead(204); res.end(); } catch {}
          return;
        }
        _liveStreamLastSeq.set(key, seq);
        // 清理 seq 记录：超过 200 条时 FIFO 驱逐最早的 100 条（Map 保持插入顺序）
        if (_liveStreamLastSeq.size > 200) {
          const keys = Array.from(_liveStreamLastSeq.keys()).slice(0, 100);
          for (const k of keys) _liveStreamLastSeq.delete(k);
        }
        // 用 named event 'stream-progress' 避免混入 data: 流与 dedup 冲突
        // 精简 payload：前端只需要 timestamp/url/content 渲染 Live overlay
        const _streamChunkPayload = {
          timestamp: entry.timestamp,
          url: entry.url,
          content: entry.response?.body?.content || [],
          model: entry.body?.model,
        };
        sendEventToClients(clients, 'stream-progress', _streamChunkPayload);
        runParallelHook('onStreamChunk', _streamChunkPayload);
      } catch {}
      try { res.writeHead(204); res.end(); } catch {}
    });
    return;
  }

  // 读取文件内容 API —— 走 file-access-policy 统一校验
  // 历史 isEditorSession 后门已收敛:绝对路径全部走 policy(allowlist 已含 ~/.claude/、CCV_PROJECT_DIR、
  // 已注册 workspaces、上传/持久化目录),前端无需再传 editorSession=true。
  if (url === '/api/file-content' && method === 'GET') {
    const reqPath = parsedUrl.searchParams.get('path');
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    try {
      if (!reqPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      // 相对路径含 .. → 直接拒(历史契约;绕过项目目录的明确攻击)
      const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
      if (!isAbs && reqPath.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      // 相对路径在项目目录拼接;绝对路径直接送 policy
      const absPath = isAbs ? reqPath : resolve(cwd, reqPath);
      const policy = isReadAllowed(absPath);
      if (!policy.ok) {
        const status = reasonToStatus(policy.reason);
        const errLabel = status === 404 ? 'File not found'
          : status === 400 ? 'Invalid path'
          : 'Forbidden';
        const body = { error: errLabel, reason: policy.reason };
        if (policy.allowedRoots) body.allowedRoots = policy.allowedRoots;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      // 用 policy 返回的 real 读,杜绝 TOCTOU
      const real = policy.real;
      const st = statSync(real);
      if (!st.isFile()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not a file' }));
        return;
      }
      if (st.size > 5 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large' }));
        return;
      }
      const content = readFileSync(real, 'utf-8');
      // path 字段回返原始入参,前端用它做路径展示与后续 POST 引用
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: reqPath, content, size: st.size }));
    } catch (err) {
      const status = ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? `Cannot read file: ${err.message}` : err.message;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // 当前项目「持久记忆」入口/明细 —— 路径编码: cwd 中所有非 [a-zA-Z0-9-] 字符替换为 -
  // 编码方案与 Claude Code 写入 ~/.claude/projects/<encoded>/memory/ 时使用的一致(实地比对验证)。
  // 不带参 → 返回 MEMORY.md 入口; ?file=<basename> → 返回同目录下指定 .md 明细。
  // 安全分层: 1) basename 形态校验(单段 + .md) 2) realpath 必须严格在 memoryDir 之内 3) isReadAllowed 政策(~/.claude/ allowlist)。
  if (url === '/api/project-memory' && method === 'GET') {
    // 本端点内 helper:8 处响应去重(端点局部,不跨文件)
    const respondJson = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const cwdRaw = process.env.CCV_PROJECT_DIR || process.cwd();
      const cwd = cwdRaw.replace(/[/\\]+$/, '');
      const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
      const dir = join(getClaudeConfigDir(), 'projects', encoded, 'memory');
      const fileParam = parsedUrl.searchParams.get('file');
      const MAX_BYTES = 512 * 1024;

      // 入口文件
      if (!fileParam) {
        const indexPath = join(dir, 'MEMORY.md');
        if (!existsSync(indexPath)) return respondJson(200, { exists: false, dir, indexPath });
        const policy = isReadAllowed(indexPath);
        if (!policy.ok) return respondJson(reasonToStatus(policy.reason), { error: 'Forbidden', reason: policy.reason });
        const st = statSync(policy.real);
        if (!st.isFile()) return respondJson(400, { error: 'Not a file' });
        if (st.size > MAX_BYTES) return respondJson(413, { error: 'File too large' });
        const content = readFileSync(policy.real, 'utf-8');
        return respondJson(200, { exists: true, dir, indexPath, content });
      }

      // 明细文件: 仅接受单段 basename + .md 后缀
      // 再次校验 realpath 严格在 memoryDir 内 —— policy 的 ~/.claude/ allowlist 范围比这里宽。
      if (fileParam.includes('/') || fileParam.includes('\\') || fileParam.includes('\0') || fileParam === '..' || fileParam.startsWith('.')) {
        return respondJson(400, { error: 'Invalid file name' });
      }
      if (!/\.md$/i.test(fileParam)) return respondJson(400, { error: 'Only .md files allowed' });
      const detailPath = join(dir, fileParam);
      if (!existsSync(detailPath)) return respondJson(404, { error: 'File not found' });
      // realpath 收紧: 必须严格落在 realpath(dir) 内 —— 防 symlink 跳出 memoryDir
      let realDir, realFile;
      try {
        realDir = realpathSync(dir);
        realFile = realpathSync(detailPath);
      } catch {
        return respondJson(404, { error: 'File not found' });
      }
      const realDirWithSep = realDir.endsWith(sep) ? realDir : realDir + sep;
      if (realFile !== realDir && !realFile.startsWith(realDirWithSep)) {
        return respondJson(403, { error: 'Path traversal not allowed' });
      }
      const policy = isReadAllowed(realFile);
      if (!policy.ok) return respondJson(reasonToStatus(policy.reason), { error: 'Forbidden', reason: policy.reason });
      const st = statSync(realFile);
      if (!st.isFile()) return respondJson(400, { error: 'Not a file' });
      if (st.size > MAX_BYTES) return respondJson(413, { error: 'File too large' });
      const content = readFileSync(realFile, 'utf-8');
      return respondJson(200, { name: fileParam, path: realFile, content });
    } catch (err) {
      // 与 /api/file-content 一致：已知 errno（ENOENT/EACCES 等）走 ERROR_STATUS_MAP 映射；
      // 500 时不回显 err.message —— 可能含 ~/.claude/projects/<encoded>/memory/ 路径片段。
      const status = ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? 'Internal error' : err.message;
      respondJson(status, { error: message });
    }
    return;
  }

  // CLAUDE.md 入口：列出 cwd 父链 + ~/.claude/CLAUDE.md，按 sha1(realpath).slice(0,12) 给稳定 id；
  // 不带参 → 返回候选清单(无 content)；?id=<hex12> → 二次校验 basename + isReadAllowed 后吐内容。
  // 设计要点：客户端永远只传 id，path resolution 由 server 独占；id 由 realpath 派生 → swap 即变 id。
  if (url === '/api/claude-md' && method === 'GET') {
    const respondJson = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const claudeConfigDir = getClaudeConfigDir();
      // 注入 isReadAllowed 做发现阶段预过滤: 不在 allowlist 内的祖先候选不进列表 ——
      // 否则 UI 会渲染出点击必 403 的"看得见点不开"chip。
      const candidates = discoverClaudeMdCandidates({
        cwd,
        claudeConfigDir,
        isReadAllowedFn: isReadAllowed,
      });
      const idParam = parsedUrl.searchParams.get('id');
      const MAX_BYTES = 512 * 1024;

      if (!idParam) {
        // 列表: 不暴露 realPath / mtimeMs, 仅返回 {id, scope, tail}。mtimeMs 前端未使用,
        // 去掉以收敛信息泄露面 (perf-sec review P2-C)。
        return respondJson(200, {
          entries: candidates.map(c => ({
            id: c.id,
            scope: c.scope,
            tail: c.tail,
          })),
        });
      }

      const r = readCandidateById(candidates, idParam, {
        maxBytes: MAX_BYTES,
        isReadAllowedFn: isReadAllowed,
      });
      if (!r.ok) {
        // policy 失败时让 reasonToStatus 统一映射，与 /api/project-memory 一致
        const status = r.reason ? reasonToStatus(r.reason) : r.status;
        return respondJson(status, { error: r.error, reason: r.reason });
      }
      return respondJson(200, {
        id: idParam,
        scope: r.scope,
        tail: r.tail,
        content: r.content,
      });
    } catch (err) {
      const status = ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? 'Internal error' : err.message;
      respondJson(status, { error: message });
    }
    return;
  }

  // 返回文件原始二进制内容（用于图片预览等）—— 走 file-access-policy 统一校验
  // 历史 isEditorSession 后门 + uploadPrefix/persistPrefix 硬编码豁免已收敛:
  // policy 的 allowlist 已含 /tmp/cc-viewer-uploads/、tmpdir()/cc-viewer-uploads/、
  // ~/.claude/cc-viewer/<project>/images/、CCV_PROJECT_DIR、~/.claude/、registered workspaces。
  // 支持两种调用形式：
  //   query-style `/api/file-raw?path=<encoded>` —— 老接口，前端按文件路径单次取（图片预览等）
  //   path-style  `/api/file-raw/<encoded-segments>` —— HTML 预览专用，让 iframe 里 c8/nyc 这类
  //     报告的相对 `<script src="sorter.js">` 能解析到同目录另一个文件（query-style URL 浏览器
  //     无法做相对路径解析）；reqPath 直接从 pathname 取，复用下方 isReadAllowed + mime + CSP 全套
  if ((url === '/api/file-raw' || url.startsWith('/api/file-raw/')) && (method === 'GET' || method === 'HEAD')) {
    let reqPath;
    if (url.startsWith('/api/file-raw/')) {
      const tail = parsedUrl.pathname.slice('/api/file-raw/'.length);
      try { reqPath = decodeURIComponent(tail); } catch { reqPath = tail; }
    } else {
      reqPath = parsedUrl.searchParams.get('path');
    }
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    try {
      if (!reqPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
      const absPath = isAbs ? reqPath : resolve(cwd, reqPath);

      // /tmp 原文件不存在时回退到持久化副本(保留原 fallback 语义,但用 policy 守卫)
      let policy = isReadAllowed(absPath);
      if (!policy.ok && policy.reason === 'realpath-failed' && isAbs) {
        const pName = _projectName || 'default';
        const persistPrefix = join(getClaudeConfigDir(), 'cc-viewer', pName, 'images');
        const fileName = basename(absPath);
        if (fileName) {
          const persistFile = join(persistPrefix, fileName);
          const fallbackPolicy = isReadAllowed(persistFile);
          if (fallbackPolicy.ok) policy = fallbackPolicy;
        }
      }
      if (!policy.ok) {
        const status = reasonToStatus(policy.reason);
        const errLabel = status === 404 ? 'File not found'
          : status === 400 ? 'Invalid path'
          : 'Forbidden';
        const body = { error: errLabel, reason: policy.reason };
        if (policy.allowedRoots) body.allowedRoots = policy.allowedRoots;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      const targetFile = policy.real;
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
        '.webp': 'image/webp', '.html': 'text/html', '.htm': 'text/html',
      };
      const ext = (targetFile.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const mime = extMime[ext] || 'application/octet-stream';
      const data = method === 'HEAD' ? null : readFileSync(targetFile);
      const size = method === 'HEAD' ? stat.size : data.length;
      const headers = { 'Content-Type': mime, 'Content-Length': size };
      // 防止用户项目中的恶意 HTML 在同源下执行脚本（XSS 防护）：CSP sandbox 强制 unique origin，
      // 即便绕过 iframe 直接访问也拿不到 cc-viewer 同源的 storage/cookie。
      // CSP 与 iframe sandbox 同时存在时取交集（更严格者胜），iframe 端 sandbox 也只配 `allow-scripts`
      // 跟这里保持一致，c8 / nyc 覆盖率报告需要的 sortable table / prettify / block-navigation 都
      // 不依赖 popup / form，因此 allow-popups / allow-forms 都不放（防 `window.open` 弹外站 +
      // `<form action>` 提交任意 URL）。再叠加 `connect-src 'none'` + `form-action 'none'` 兜底
      // 阻断脚本外发流量（fetch / XHR / WebSocket / form 提交）—— 用户项目里的静态报告页都不需要
      // 网络通信，能跑就够；外联即可疑。
      if (mime === 'text/html') headers['Content-Security-Policy'] = "sandbox allow-scripts; connect-src 'none'; form-action 'none'";
      res.writeHead(200, headers);
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
        const { path: reqPath, content } = JSON.parse(body);
        const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
        if (!reqPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        if (typeof content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Content must be a string' }));
          return;
        }
        const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
        const absPath = isAbs ? reqPath : resolve(cwd, reqPath);

        // 写路径同样走 policy(收敛 editorSession 后门):允许覆盖现有文件;
        // 新文件场景递归向上找最近存在的祖先目录,只要它在 allowlist 内即放行。
        // (旧实现只查 immediate parent,父目录也不存在时误拒嵌套新建。)
        let targetReal;
        const policy = isReadAllowed(absPath);
        if (policy.ok) {
          targetReal = policy.real;
        } else if (policy.reason === 'realpath-failed') {
          // 递归向上找最近存在的祖先;若 allowlist 命中即允许新建,从该祖先 real 重建目标路径。
          let cursor = resolve(absPath, '..');
          let ancestorPolicy = null;
          let descent = [basename(absPath)];
          for (let depth = 0; depth < 32; depth++) {
            const ap = isReadAllowed(cursor);
            if (ap.ok) { ancestorPolicy = ap; break; }
            if (ap.reason !== 'realpath-failed') {
              // sensitive-prefix / outside-allowlist 等明确拒绝 → 直接 403
              ancestorPolicy = ap;
              break;
            }
            // 当前祖先也不存在,继续上溯
            const parent = resolve(cursor, '..');
            if (parent === cursor) break; // 抵达根,停止
            descent.unshift(basename(cursor));
            cursor = parent;
          }
          if (!ancestorPolicy || !ancestorPolicy.ok) {
            const reason = (ancestorPolicy && ancestorPolicy.reason) || 'outside-allowlist';
            const status = reasonToStatus(reason);
            const body = { error: 'Forbidden', reason };
            if (ancestorPolicy && ancestorPolicy.allowedRoots) body.allowedRoots = ancestorPolicy.allowedRoots;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(body));
            return;
          }
          // 在祖先 real 路径下重建目标。Denylist 已在祖先 prefix 层生效,
          // 这里相信 allowlist 祖先的合法性(项目目录 / ~/.claude/cc-viewer 等)。
          targetReal = join(ancestorPolicy.real, ...descent);
          // 父目录可能不存在,递归 mkdir
          try { mkdirSync(dirname(targetReal), { recursive: true }); } catch {}
        } else {
          const status = reasonToStatus(policy.reason);
          const body = { error: 'Forbidden', reason: policy.reason };
          if (policy.allowedRoots) body.allowedRoots = policy.allowedRoots;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }

        writeFileSync(targetReal, content, 'utf-8');
        const stat = statSync(targetReal);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, size: stat.size }));
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
    res.end(JSON.stringify({ cliMode: isCliMode, sdkMode: isSdkMode, workspaceMode: isWorkspaceMode && !_workspaceLaunched }));
    return;
  }

  // Git 状态
  // 扫描项目根目录及一级子目录的 git 仓库
  if (url === '/api/git-repos' && method === 'GET') {
    try {
      const projectDir = process.env.CCV_PROJECT_DIR || process.cwd();
      const repos = [];
      if (existsSync(join(projectDir, '.git'))) {
        repos.push({ name: basename(projectDir), path: '.', isRoot: true });
      }
      const entries = readdirSync(projectDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        try {
          if (existsSync(join(projectDir, entry.name, '.git'))) {
            repos.push({ name: entry.name, path: entry.name, isRoot: false });
          }
        } catch {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ repos }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, repos: [] }));
    }
    return;
  }

  // 撤销单个文件的 git 变更
  if (url === '/api/git-restore' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
        return;
      }
      try {
        const { path: filePath, repo: repoParam } = parsed;
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing path' }));
          return;
        }
        if (filePath.startsWith('/') || filePath.includes('..')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        const cwd = resolveRepoCwd(repoParam);
        if (!cwd) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid repo parameter' }));
          return;
        }
        const fullPath = join(cwd, filePath);
        if (existsSync(fullPath)) {
          const realFull = realpathSync(fullPath);
          const realCwd = realpathSync(cwd);
          if (!realFull.startsWith(realCwd + sep)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
            return;
          }
        }
        // Per-file mutex 序列化「git status + checkout/clean」子命令对。多 tab 并发同文件
        // revert 时不再有 race 让两个 checkout 交错执行（最终状态不可预测）。
        // resolve() 规整 `./foo.js` / `foo.js` / `.//foo.js` 为同一 lockKey，防形变绕过。
        const lockKey = resolve(join(cwd, filePath));
        const prev = gitRestoreLocks.get(lockKey) || Promise.resolve();
        const current = prev.then(async () => {
          const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain', '--', filePath], { cwd, encoding: 'utf-8', timeout: 5000 });
          const isUntracked = statusOut.trim().startsWith('??');
          if (isUntracked) {
            await execFileAsync('git', ['clean', '-fd', '--', filePath], { cwd, timeout: 10000 });
          } else {
            await execFileAsync('git', ['checkout', '--', filePath], { cwd, timeout: 10000 });
          }
        }).finally(() => {
          if (gitRestoreLocks.get(lockKey) === current) gitRestoreLocks.delete(lockKey);
        });
        gitRestoreLocks.set(lockKey, current);
        // setTimeout 兜底——防 finally 异常吞 entry 累积内存。
        setTimeout(() => {
          if (gitRestoreLocks.get(lockKey) === current) gitRestoreLocks.delete(lockKey);
        }, GIT_RESTORE_LOCK_CLEANUP_MS).unref();
        await current;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url === '/api/git-status' && method === 'GET') {
    try {
      const repoParam = parsedUrl.searchParams.get('repo');
      const cwd = resolveRepoCwd(repoParam);
      if (!cwd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid repo parameter', changes: [] }));
        return;
      }
      // `-uall` 让 git 把新增目录展开成具体文件，而不是收敛为 `?? path/`
      // 否则前端树会把整个新目录当一个「空文件名」叶子渲染，且行数统计为 0。
      // maxBuffer 拉到 10MB——默认 1MB 在 node_modules 未 gitignore 之类的极端
      // 场景下会被截断，导致后续 split 解析错位。
      const { stdout: output } = await execFileAsync('git', ['status', '--porcelain', '-uall'], { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 10 * 1024 * 1024 });
      // Win 上 git stdout 是 CRLF；现状靠下文 .trim() 兜底，加正则更稳防未来 strict 比较破窗。
      const lines = output.split(/\r?\n/).filter(line => line.trim());
      const changes = lines.map(line => {
        const status = line.substring(0, 2).trim();
        let file = line.substring(3).trim();
        // git status --porcelain quotes paths with non-ASCII chars using octal escapes
        if (file.startsWith('"') && file.endsWith('"')) {
          file = file.slice(1, -1)
            .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
            .replace(/\\t/g, '\t').replace(/\\n/g, '\n')
            .replace(/\\\\/g, '\\').replace(/\\"/g, '"');
          file = Buffer.from(file, 'latin1').toString('utf8');
        }
        return { status, file };
      });

      // Collect per-file insertions/deletions via git diff --numstat (tracked) + --cached --numstat (staged).
      // Neither covers untracked files, so add their line counts separately via countUntrackedLines
      // — matching git's numstat semantics (binary and >5MB files contribute 0).
      let insertions = 0, deletions = 0;
      try {
        const [{ stdout: numstat }, { stdout: cachedNumstat }] = await Promise.all([
          execFileAsync('git', ['diff', '--numstat'], { cwd, encoding: 'utf-8', timeout: 5000 }),
          execFileAsync('git', ['diff', '--cached', '--numstat'], { cwd, encoding: 'utf-8', timeout: 5000 }),
        ]);
        for (const raw of [numstat, cachedNumstat]) {
          for (const l of raw.split('\n')) {
            const m = l.match(/^(\d+)\t(\d+)\t/);
            if (m) { insertions += Number(m[1]); deletions += Number(m[2]); }
          }
        }
      } catch { /* non-critical — stats just stay 0 */ }

      // Cap untracked-file processing to keep the event loop responsive if a
      // repo forgets to gitignore a huge directory (e.g. node_modules).
      // 超限时仍继续计数，但不再调 countUntrackedLines——用 insertions_capped
      // 通知前端"此数据被硬上限截断"，避免静默少算给用户造成误判。
      const MAX_UNTRACKED = 5000;
      let untrackedProcessed = 0;
      let untrackedTotal = 0;
      for (const c of changes) {
        if (c.status !== '??') continue;
        untrackedTotal++;
        if (untrackedProcessed >= MAX_UNTRACKED) continue;
        insertions += countUntrackedLines(cwd, c.file);
        untrackedProcessed++;
      }
      const insertions_capped = untrackedTotal > MAX_UNTRACKED;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ changes, insertions, deletions, insertions_capped }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, changes: [] }));
    }
    return;
  }

  // Git diff 数据获取
  if (url.startsWith('/api/git-diff') && method === 'GET') {
    try {
      const repoParam = parsedUrl.searchParams.get('repo');
      const cwd = resolveRepoCwd(repoParam);
      if (!cwd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid repo parameter', diffs: [] }));
        return;
      }
      const filesParam = parsedUrl.searchParams.get('files');

      if (!filesParam) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing files parameter' }));
        return;
      }

      const files = filesParam.split(',').map(f => f.trim()).filter(Boolean);
      const commitParam = parsedUrl.searchParams.get('commit');
      // Reject malformed commit hashes; falsy = working-tree mode
      const commitHash = commitParam && isValidCommitHash(commitParam) ? commitParam : undefined;
      const diffs = await getGitDiffs(cwd, files, commitHash);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ diffs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, diffs: [] }));
    }
    return;
  }

  // Local commits ahead of upstream (origin/<branch>..HEAD).
  // Silent empty result when no upstream / detached HEAD — by design.
  if (url.startsWith('/api/git-log-unpushed') && method === 'GET') {
    try {
      const repoParam = parsedUrl.searchParams.get('repo');
      const cwd = resolveRepoCwd(repoParam);
      if (!cwd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid repo parameter', commits: [], hasUpstream: false }));
        return;
      }
      const result = await getUnpushedCommits(cwd);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, commits: [], hasUpstream: false }));
    }
    return;
  }

  // 插件管理 API
  if (url === '/api/plugins' && method === 'GET') {
    const plugins = getPluginsInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plugins, pluginsDir: getPluginsDir() }));
    return;
  }

  if (url === '/api/plugins' && method === 'DELETE') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }
    const filePath = join(getPluginsDir(), file);
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
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
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
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
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
        uploadPlugins(getPluginsDir(), fileList);
        await loadPlugins();
        const plugins = getPluginsInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
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
        await installPluginFromUrl(getPluginsDir(), fileUrl, extractScript);
        await loadPlugins();
        const plugins = getPluginsInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, plugins, pluginsDir: getPluginsDir() }));
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

  // 返回当前 access token 信息
  if (url === '/api/access-token' && method === 'GET') {
    // 远程访问需要已有合法 token
    if (!isLocal) {
      const urlToken = parsedUrl.searchParams.get('token');
      if (urlToken !== ACCESS_TOKEN) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: invalid token' }));
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: ACCESS_TOKEN, persistent: IS_TOKEN_PERSISTENT }));
    return;
  }

  // 重置 access token（仅限本地访问）
  if (url === '/api/access-token/reset' && method === 'POST') {
    if (!isLocal) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: remote reset not allowed' }));
      return;
    }
    const newToken = resetAccessToken();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: newToken, persistent: true }));
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
      const fileName = basename(file);
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

  // Team 运行时状态检测（fs-only：目录存在性 + inbox mtime）
  if (url === '/api/team-status' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_POST_BODY) req.destroy(); });
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        // 固定文案避免把 JSON.parse 的原始 err.message 回显给客户端
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }
      try {
        const result = await buildTeamStatusResponse(parsed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
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

    // index.html 服务端注入主题：根治"老用户首屏闪屏"。
    // 老用户 preferences.json 里 themeColor='dark' 但浏览器 localStorage 还没缓存过 →
    // 静态 index.html 的 <html data-theme="light"> 会导致 Loading 页先渲成白色，
    // 等 React 拿到 prefs 才切回 dark，肉眼可见一次"白闪"。
    // 这里把当前 prefs 里的 themeColor 直接写进 HTML，inline boot script 仍负责
    // 处理 URL ?theme= 优先级与 localStorage 缓存。
    //
    // 主题来源优先级（首屏 → React 接管后）：
    //   1. URL ?theme=  （inline boot script 读取，最高优先）
    //   2. localStorage ccv_themeColor  （inline boot script 读取，跨刷新缓存）
    //   3. preferences.json 的 themeColor  （此处 SSR 注入到 <html data-theme="...">，老用户兜底）
    //   4. dist/index.html 模板里的硬编码 default ("light")
    // React 接管后 AppBase._applyTheme() 会基于 1/2/3 重新统一 state + DOM + localStorage 三向同步。
    const serveIndexHtml = () => {
      try {
        const indexPath = join(__dirname, 'dist', 'index.html');
        let html = readFileSync(indexPath, 'utf-8');
        let themeColor = 'light';
        try {
          if (existsSync(getPrefsFile())) {
            const prefs = JSON.parse(readFileSync(getPrefsFile(), 'utf-8'));
            if (prefs.themeColor === 'dark' || prefs.themeColor === 'light') themeColor = prefs.themeColor;
          }
        } catch { /* 读 prefs 失败就走默认 light */ }
        // 自检：模板里没有 <html ... data-theme="..."> 时 replace 静默 no-op，SSR 优化失效但不报错。
        // 仅首次 warn 避免高 QPS 刷屏（_ssrThemeAttrWarned 单进程一次性）。
        if (!_ssrThemeAttrWarned && !/<html[^>]*data-theme="[^"]*"/.test(html)) {
          _ssrThemeAttrWarned = true;
          console.warn('[serveIndexHtml] dist/index.html 没有 <html data-theme="..."> 属性，SSR theme 注入将不生效。检查 index.html 模板。');
        }
        html = html.replace(/<html([^>]*?)data-theme="[^"]*"/, `<html$1data-theme="${themeColor}"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(html);
        return true;
      } catch { return false; }
    };

    if (filePath === '/index.html') {
      if (serveIndexHtml()) return;
      // serveIndexHtml 失败时 fall through 到下面的常规静态路径
    }

    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const content = readFileSync(fullPath);
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        // 缓存策略：/assets/ 下文件名带 content-hash，永远不变 → 长缓存 + immutable；
        // 其它（主要 index.html）每次必须回源校验，否则用户升级 server 后浏览器还在用陈旧 index.html，
        // 引用旧 hash chunk 找不到 → SPA fallback 给 text/html → 浏览器 strict MIME 拒绝。
        const cacheControl = filePath.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache';
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
        res.end(content);
        return;
      }
    } catch (err) {
      // fall through
    }

    // /assets/ 下文件找不到 = 陈旧 chunk hash（部署后旧标签页请求被替换的文件名）。
    // 直接 404，不走 SPA fallback —— 否则浏览器拿到 text/html 当 ESM 加载会报 strict MIME 错，
    // 错误堆栈反而误导排查方向。客户端的 lazy().catch() 拿到这个 404 会自动 reload。
    if (filePath.startsWith('/assets/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset not found (likely a stale chunk after upgrade — please refresh)');
      return;
    }

    // SPA fallback: 非 API/非静态文件请求返回 index.html（路由由前端处理）
    if (serveIndexHtml()) return;
    res.writeHead(404);
    res.end('Not Found');
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

        currentServer.listen(port, HOST, async () => {
          server = currentServer;
          actualPort = port;
          // interceptor.js runs in this same process (via proxy.js → setupInterceptor).
          // Inject live-port via module-level setter instead of process.env to avoid
          // polluting env of child_process.spawn descendants (Bash tools / MCP / Electron tabs).
          setLivePort(port, serverProtocol);
          const url = `${serverProtocol}://127.0.0.1:${port}`;
          if (!isCliMode) {
            console.error(t('server.started'));
            console.error(t('server.startedLocal', { protocol: serverProtocol, port }));
            const _ips = getAllLocalIps();
            for (const _ip of _ips) {
              console.error(t('server.startedNetwork', { protocol: serverProtocol, ip: _ip, port, token: ACCESS_TOKEN }));
            }
            console.error(t(IS_TOKEN_PERSISTENT ? 'server.tokenLoaded' : 'server.tokenGenerated', { path: TOKEN_PATH }));
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
          // CLI 模式下启动 WebSocket 服务 (必须 await，否则插件 hook 拿不到 upgrade listeners)
          if (isCliMode) {
            await setupTerminalWebSocket(currentServer);
          }
          // 通知插件服务器已启动
          let ptyApi = null;
          if (isCliMode) {
            const pm = await import('./pty-manager.js');
            ptyApi = {
              writeToPty: pm.writeToPty,
              writeToPtySequential: pm.writeToPtySequential,
              getPtyState: pm.getPtyState,
              getOutputBuffer: pm.getOutputBuffer,
              onPtyData: pm.onPtyData,
            };
          }
          await runParallelHook('serverStarted', {
            port, host: HOST, url, ip: getLocalIp(),
            token: ACCESS_TOKEN, protocol: serverProtocol,
            httpServer: currentServer, pty: ptyApi,
            interactions: {
              getPendingPerms: () => [...pendingPermHooks.entries()].map(([id, e]) => ({ id, toolName: e.toolName, input: e.input, createdAt: e.createdAt })),
              resolvePerm: (id, decision, allowSession) => {
                const entry = pendingPermHooks.get(id);
                if (!entry) return false;
                clearTimeout(entry.timer);
                pendingPermHooks.delete(id);
                try {
                  if (!entry.res.headersSent) {
                    entry.res.writeHead(200, { 'Content-Type': 'application/json' });
                    entry.res.end(JSON.stringify({ decision }));
                  }
                } catch {}
                if (terminalWss) {
                  const rmsg = JSON.stringify({ type: 'perm-hook-resolved', id });
                  terminalWss.clients.forEach((c) => { if (c.readyState === 1) try { c.send(rmsg); } catch {} });
                }
                return true;
              },
              getPendingAsks: () => [...pendingAskHooks.entries()].map(([id, e]) => ({ id, questions: e.questions, createdAt: e.createdAt })),
              resolveAsk: (id, answers) => {
                const entry = pendingAskHooks.get(id);
                if (!entry) return false;
                const { res: hookRes, timer } = entry;
                clearTimeout(timer);
                pendingAskHooks.delete(id);
                try {
                  if (!hookRes.headersSent) {
                    hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                    hookRes.end(JSON.stringify({ answers }));
                  }
                } catch {}
                if (terminalWss) {
                  const rmsg = JSON.stringify({ type: 'ask-hook-resolved', id });
                  terminalWss.clients.forEach((c) => { if (c.readyState === 1) try { c.send(rmsg); } catch {} });
                }
                _notifyParentPending({ type: 'ask-hook-resolved', id });
                return true;
              },
              resolveSdkApproval: (...args) => _sdkResolveApproval?.(...args),
            },
          });
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
    const {
      spawnScratch,
      writeScratch,
      resizeScratch,
      killScratch,
      onScratchData,
      onScratchExit,
      getScratchState,
      getScratchOutputBuffer,
      getScratchShellBasename,
      getScratchPtyCount,
      hasScratchPty,
    } = await import('./scratch-pty-manager.js');
    const SCRATCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
    const MAX_SCRATCH_PTYS = 16;
    _writeToPty = writeToPty;
    _onPtyData = onPtyData;
    const wss = new WebSocketServer({ noServer: true });
    terminalWss = wss;
    const wssScratch = new WebSocketServer({ noServer: true });

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
      } else if (pathname === '/ws/terminal-scratch') {
        // 校验 id：缺失或非法 → destroy（避免 Map<id> 被注入空键 / 超长 / 特殊字符）
        const scratchId = new URL(req.url, `${serverProtocol}://${req.headers.host}`).searchParams.get('id');
        if (!scratchId || !SCRATCH_ID_RE.test(scratchId)) {
          socket.destroy();
          return;
        }
        // 硬上限基于后端 ptys Map 大小（含 running 与已退出未回收），
        // 已有 id 走重连路径不计入新增配额；防止用户关浏览器后老 pty 仍存活、
        // 新会话又能开 16 个导致总量翻番的累积膨胀
        if (!hasScratchPty(scratchId) && getScratchPtyCount() >= MAX_SCRATCH_PTYS) {
          socket.destroy();
          return;
        }
        req.ccvScratchId = scratchId;
        wssScratch.handleUpgrade(req, socket, head, (ws) => {
          wssScratch.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    // scratch 终端 WS：极简版，仅承载 input/resize/data/exit + 显式 kill；不掺杂 hook/SDK/preset
    wssScratch.on('connection', async (ws, req) => {
      const id = req.ccvScratchId;
      // 懒启动 scratch shell（首次连接才 spawn）
      try {
        if (!getScratchState(id).running) {
          await spawnScratch(id);
        }
      } catch (err) {
        try { ws.send(JSON.stringify({ type: 'toast', message: `scratch spawn failed: ${err.message}` })); } catch {}
      }

      const state = getScratchState(id);
      try { ws.send(JSON.stringify({ type: 'state', running: state.running, exitCode: state.exitCode, shellBasename: getScratchShellBasename() })); } catch {}

      const buffer = getScratchOutputBuffer(id);
      if (buffer) {
        try { ws.send(JSON.stringify({ type: 'data', data: buffer })); } catch {}
      }

      const removeDataListener = onScratchData(id, (data) => {
        if (ws.readyState === 1) {
          try { ws.send(JSON.stringify({ type: 'data', data })); } catch {}
        }
      });

      const removeExitListener = onScratchExit(id, (exitCode) => {
        if (ws.readyState === 1) {
          try { ws.send(JSON.stringify({ type: 'exit', exitCode })); } catch {}
        }
      });

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'input') {
            const s = getScratchState(id);
            if (!s.running) {
              try { await spawnScratch(id); } catch {}
            }
            writeScratch(id, msg.data);
          } else if (msg.type === 'resize') {
            resizeScratch(id, msg.cols, msg.rows);
          } else if (msg.type === 'kill') {
            // 用户主动关闭 tab：杀 pty（killScratch 内部 ptys.delete 后配额自动释放）；前端会随后 close ws
            killScratch(id);
          }
        } catch {}
      });

      ws.on('close', () => {
        removeDataListener();
        removeExitListener();
        // pty 本身**不杀**（保留以支持刷新重连），由 kill 消息或 /api/workspaces/stop 触发；
        // 配额由 ptys Map 自身大小决定，不需在此手动维护连接集合
      });
    });

    wss.on('connection', (ws) => {
      // 发送当前 PTY 状态
      const state = getPtyState();
      ws.send(JSON.stringify({ type: 'state', ...state }));

      // 发送历史输出缓冲(合并 ws 后 ChatView/TerminalPanel 共享一条;TerminalPanel 需要 buffer 来恢复 xterm,
      // ChatView 自己 _onTerminalWsMessage 不处理 'data',浪费的 send 体积只在初次连接一次)。
      const buffer = getOutputBuffer();
      if (buffer) {
        ws.send(JSON.stringify({ type: 'data', data: buffer }));
      }

      // 兜底重绘标记：claude TUI 在 alternate-screen 下只在收到 SIGWINCH 时重绘整屏。
      // 若前端首次 resize 与 PTY 当前尺寸恰好相等，pty.resize noop 不发 SIGWINCH → 前端空白。
      // 该 ws 收到第一条 resize 时（见 ws.on('message')），抖动 (rows+1) → (rows) 触发 SIGWINCH。
      // 注：仅 PTY 已运行时才需要兜底；shell 不在 alternate-screen 不需要。
      let _needRedrawBootstrap = state.running === true;

      // PTY 输出 → WebSocket(合并 ws 后客户端自行按 msg.type 分发,server 端不再 role 过滤)
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
            // 把 client 提供的 seq 透传回去 — 合并 ws 后多个发送方共享一条 ws,
            // 只能靠 client 端按 seq 匹配自己发的请求(client 没传时也兼容,旧客户端不带 seq)。
            const seq = msg.seq;
            if (Array.isArray(chunks) && chunks.length > 0) {
              writeToPtySequential(chunks, (ok) => {
                try {
                  const reply = { type: 'input-sequential-done', ok };
                  if (seq !== undefined) reply.seq = seq;
                  ws.send(JSON.stringify(reply));
                } catch (e) {
                  console.warn('[server] input-sequential-done send failed:', e?.message || e);
                }
              }, { settleMs: msg.settleMs || 150 });
            }
          } else if (msg.type === 'ask-hook-answer') {
            // Client answered AskUserQuestion via hook bridge.
            // New protocol: msg.id required to address one of multiple pending asks.
            // Legacy fallback: no id → resolve the oldest pending ask (preserves pre-Map client behavior).
            let askAnswered = false;
            let askId = msg.id;
            let askEntry = null;
            if (askId) {
              askEntry = pendingAskHooks.get(askId);
            } else {
              const firstId = pendingAskHooks.keys().next().value;
              if (firstId) {
                askId = firstId;
                askEntry = pendingAskHooks.get(firstId);
              }
            }
            if (askEntry) {
              const { res: hookRes, timer } = askEntry;
              clearTimeout(timer);
              pendingAskHooks.delete(askId);
              askAnswered = true;
              try {
                if (!hookRes.headersSent) {
                  hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                  hookRes.end(JSON.stringify({ answers: msg.answers }));
                }
              } catch {}
            }
            // Broadcast resolved to other clients so they clear their ask panel
            if (askAnswered && terminalWss) {
              const rmsg = JSON.stringify({ type: 'ask-hook-resolved', id: askId });
              terminalWss.clients.forEach((c) => {
                if (c !== ws && c.readyState === 1) try { c.send(rmsg); } catch {}
              });
            }
            if (askAnswered) _notifyParentPending({ type: 'ask-hook-resolved', id: askId });
          } else if (msg.type === 'perm-hook-answer') {
            // Permission approval — SDK mode (canUseTool) or PTY mode (hook bridge)
            let permAnswered = false;
            if (isSdkMode && _sdkResolveApproval && msg.id) {
              permAnswered = _sdkResolveApproval(msg.id, msg.allowSession ? { decision: msg.decision || 'allow', allowSession: true } : (msg.decision || 'deny'));
            }
            const hookEntry = !permAnswered && msg.id ? pendingPermHooks.get(msg.id) : undefined;
            if (hookEntry) {
              const { res: hookRes, timer } = hookEntry;
              clearTimeout(timer);
              pendingPermHooks.delete(msg.id);
              permAnswered = true;
              try {
                if (!hookRes.headersSent) {
                  hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                  hookRes.end(JSON.stringify({ decision: msg.decision || 'deny' }));
                }
              } catch {}
            }
            // Broadcast resolved only when an answer was actually processed
            if (permAnswered && terminalWss) {
              const rmsg = JSON.stringify({ type: 'perm-hook-resolved', id: msg.id });
              terminalWss.clients.forEach((c) => {
                if (c !== ws && c.readyState === 1) try { c.send(rmsg); } catch {}
              });
            }
          } else if (msg.type === 'sdk-ask-answer') {
            // AskUserQuestion answer in SDK mode — resolve canUseTool Promise
            if (_sdkResolveApproval && msg.id) {
              _sdkResolveApproval(msg.id, msg.answers);
            }
            // Broadcast resolved to other clients
            if (msg.id && terminalWss) {
              const rmsg = JSON.stringify({ type: 'sdk-ask-resolved', id: msg.id });
              terminalWss.clients.forEach((c) => {
                if (c !== ws && c.readyState === 1) try { c.send(rmsg); } catch {}
              });
            }
            if (msg.id) _notifyParentPending({ type: 'sdk-ask-resolved', id: msg.id });
          } else if (msg.type === 'sdk-plan-answer') {
            // Plan approval in SDK mode
            if (_sdkResolveApproval) {
              _sdkResolveApproval(msg.id, { approve: msg.approve !== false, feedback: msg.feedback || '' });
            }
            // Broadcast resolved to other clients
            if (terminalWss) {
              const rmsg = JSON.stringify({ type: 'sdk-plan-resolved', id: msg.id });
              terminalWss.clients.forEach((c) => {
                if (c !== ws && c.readyState === 1) try { c.send(rmsg); } catch {}
              });
            }
          } else if (msg.type === 'sdk-user-message') {
            // User message in SDK mode — relay to sdk-manager
            if (_sdkSendUserMessage && msg.text) {
              _sdkSendUserMessage(msg.text).catch(err => {
                console.error('[SDK] sendUserMessage error:', err.message);
              });
            }
          } else if (msg.type === 'image-remove-notify' || msg.type === 'image-upload-notify') {
            // Security: only allow paths within upload directories, reject traversal
            const p = msg.path;
            // Windows 走 tmpdir()/cc-viewer-uploads/，POSIX 仍是 /tmp/cc-viewer-uploads/（macOS realpath 解为 /private/tmp 两种前缀都放行）。
            const winUploadPrefix = join(tmpdir(), 'cc-viewer-uploads') + sep;
            if (terminalWss && p && !p.includes('..') && (
              p.startsWith('/tmp/cc-viewer-uploads/') || p.startsWith('/private/tmp/cc-viewer-uploads/') || p.startsWith(winUploadPrefix) || (p.includes('/cc-viewer/') && p.includes('/images/'))
            )) {
              const rmsg = msg.type === 'image-upload-notify'
                ? JSON.stringify({ type: 'image-upload-notify', path: p, source: msg.source || 'unknown' })
                : JSON.stringify({ type: 'image-remove-notify', path: p });
              terminalWss.clients.forEach((c) => {
                if (c !== ws && c.readyState === 1) try { c.send(rmsg); } catch {}
              });
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
            // 兜底：本 ws 首次 resize 时直接给 PTY 发 SIGWINCH，让 claude 重绘整屏。
            // 之前用 (cols, rows+1)→(cols, rows) 抖动触发是因为 pty.resize 对相同尺寸 noop；
            // 单次 process.kill(pid, 'SIGWINCH') 等价但更干净——claude 用现有 size 重绘，不需要
            // 让 PTY 短暂处于错误尺寸再回滚（避免 50-100ms 闪烁）
            if (_needRedrawBootstrap) {
              _needRedrawBootstrap = false;
              try {
                // Windows 无 SIGWINCH；ConPTY 在前面的 resizePty 调用里已经处理过 resize 通知，
                // 这里仅是 POSIX 上的"等尺寸 noop 不发信号"兜底，Win 上跳过避免抛异常。
                if (process.platform !== 'win32') {
                  const pid = getClaudePid();
                  if (pid && pid !== process.pid) process.kill(pid, 'SIGWINCH');
                }
              } catch {}
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

export function resetAccessToken() {
  const newToken = randomBytes(16).toString('hex');
  _ensureTokenDir();
  writeFileSync(TOKEN_PATH, JSON.stringify({ token: newToken, createdAt: Date.now() }, null, 2), { mode: 0o600 });
  ACCESS_TOKEN = newToken;
  return newToken;
}

// 流式状态 SSE 推送定时器：检测 streamingState 变化并广播给所有客户端
let _streamingStatusTimer = null;
let _lastStreamingActive = false;
function startStreamingStatusTimer() {
  if (_streamingStatusTimer) return;
  _streamingStatusTimer = setInterval(() => {
    // SDK mode uses its own streaming state (pushed directly via setSdkStreamingState)
    if (isSdkMode) return;
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
    // 销毁所有活跃连接，防止 keep-alive 阻止进程退出
    server.closeAllConnections();
    server.close();
  }
  if (terminalWss) {
    terminalWss.close();
    terminalWss = null;
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
  // 清 interceptor 的 live-port，避免 stop/start 循环（Electron tab 切换 / 测试）间隙内
  // 早期请求向已关闭的端口 POST 丢包。新 startViewer 的 listen 回调会再次 setLivePort
  setLivePort(null);
  try { unwatchFile(PROFILE_PATH); } catch {} // 清理 interceptor 的 StatWatcher
}

// ─── SDK Mode Exports ──────────────────────────────────────────

/** Push a JSONL entry to all SSE clients (for SDK mode). */
export function pushSdkEntry(entry) {
  if (sendToClients) sendToClients(clients, entry);
}

/** Update streaming status (for SDK mode). */
export function setSdkStreamingState(data) {
  if (clients.length > 0 && sendEventToClients) {
    sendEventToClients(clients, 'streaming_status', data);
  }
}

/** Broadcast a message to all terminal WS clients (for SDK canUseTool). */
export function broadcastWsMessage(msg) {
  if (terminalWss) {
    const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
    terminalWss.clients.forEach((c) => {
      if (c.readyState === 1) try { c.send(str); } catch {}
    });
  }
  // 仅对 ask 类型转译给主进程；perm-hook-* / sdk-plan-* 维持 inline-only（红线）。
  // 显式调用 _notifyParentPending 的分支（ask-hook-resolved 等）走 ws.send 不进这里，无重复触发。
  if (msg && typeof msg === 'object' && typeof msg.type === 'string'
      && (msg.type === 'sdk-ask-pending' || msg.type === 'sdk-ask-resolved' || msg.type === 'sdk-ask-timeout'
          || msg.type === 'ask-hook-pending' || msg.type === 'ask-hook-resolved' || msg.type === 'ask-hook-timeout')) {
    _notifyParentPending(msg);
  }
}

/** Reference to sdk-manager's resolveApproval (set by cli.js after import). */
let _sdkResolveApproval = null;
export function setSdkResolveApproval(fn) { _sdkResolveApproval = fn; }

/** Reference to sdk-manager's sendUserMessage (set by cli.js after import). */
let _sdkSendUserMessage = null;
export function setSdkSendUserMessage(fn) { _sdkSendUserMessage = fn; }

// Auto-start the viewer after log file init completes
// 工作区模式下由 cli.js 直接 import server.js 触发启动，跳过 _initPromise 自动启动
if (!isWorkspaceMode) {
  _initPromise.then(() => {
    startViewer().then((srv) => {
      if (!srv) return;
      // 延迟 30 秒异步检查更新。
      // 为什么是 30s 而非 3s：空闲/忙判断的核心是 `clients.length`(SSE 已连) + PTY + SDK。
      // 3s 时大多数 client 还没连上 → busy 恒 false → 升级照打断用户。30s 给"活跃会话"留出进入窗口。
      // 同大版本直接后台 detached npm install（不阻塞事件循环）；跨大版本 / 忙时 → 仅广播 banner，用户下次启动再升。
      setTimeout(async () => {
        let ptyRunning = false;
        try {
          const { getPtyState } = await import('./pty-manager.js');
          ptyRunning = getPtyState().running === true;
        } catch { /* 未加载 pty-manager 或 import 失败 → 当作不 running */ }
        const busy = clients.length > 0 || ptyRunning || _sdkResolveApproval !== null;
        try {
          const result = await checkAndUpdate({ busy, portRange: [START_PORT, MAX_PORT] });
          // major_available / deferred_busy / brew_managed 都是"有新版但这次不升级"——
          // 共用 update_major_available 事件渲染 banner（前端不区分子类，命令在 i18n 文案里给）。
          // brew_managed 走这里至关重要：否则 Electron / GUI 用户看不到升级提示，
          // 仅 stderr 一行 console.error 在桌面模式下不可见。
          if (result.status === 'major_available' || result.status === 'deferred_busy' || result.status === 'brew_managed') {
            const payload = JSON.stringify({ version: result.remoteVersion, source: result.status });
            clients.forEach(client => {
              try { client.write(`event: update_major_available\ndata: ${payload}\n\n`); } catch { }
            });
          } else if (result.status === 'upgrading_in_background') {
            console.error(`[CC Viewer] background upgrade to ${result.remoteVersion} started (active after next launch)`);
          }
        } catch { /* update check 失败静默 */ }
      }, 30_000);
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
