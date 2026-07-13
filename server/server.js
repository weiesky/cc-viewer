import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, unwatchFile, statSync, renameSync, unlinkSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { platform, networkInterfaces, tmpdir } from 'node:os';
import { execFile, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import { isPathContained } from './lib/file-api.js';
import { setEntry as askStoreSetEntry, deleteEntry as askStoreDeleteEntry, pruneStale as askStorePruneStale, markAnswered as askStoreMarkAnswered, markCancelled as askStoreMarkCancelled, loadAskStore as askStoreLoad } from './lib/ask-store.js';
import { ASK_TIMEOUT_MS, ASK_WAITER_REAP_INTERVAL_MS, ASK_WAITER_LIVENESS_MS } from './lib/ask-constants.js';
import { reapDeadAskWaiters, sweepOrphanedDiskAsks } from './lib/ask-reaper.js';
import { sdkApprovalCloseType } from './lib/sdk-adapter.js';
import { DIST_DIR, NODE_MODULES } from './_paths.js';
import { createDispatcher } from './routes/_dispatch.js';
import { projectMetaRoutes } from './routes/project-meta.js';
import { miscRoutes } from './routes/misc.js';
import { preferencesRoutes } from './routes/preferences.js';
import { projectPrefsRoutes } from './routes/project-prefs.js';
import { sessionPinRoutes } from './routes/session-pin.js';
import { gitRoutes } from './routes/git.js';
import { pluginsRoutes } from './routes/plugins.js';
import { logsRoutes } from './routes/logs.js';
import { voicePackRoutes } from './routes/voice-pack.js';
import { skillsRoutes } from './routes/skills.js';
import { ultraAgentsRoutes } from './routes/ultra-agents.js';
import { filesContentRoutes } from './routes/files-content.js';
import { workflowJournalRoutes } from './routes/workflow-journal.js';
import { filesFsRoutes } from './routes/files-fs.js';
import { searchRoutes } from './routes/search.js';
import { workspacesRoutes } from './routes/workspaces.js';
import { expertRoutes } from './routes/expert.js';
import { eventsRoutes } from './routes/events.js';
import { askPermRoutes } from './routes/ask-perm.js';
import { teamRoutes } from './routes/team.js';
import { authRoutes } from './routes/auth.js';
import { dingtalkRoutes } from './routes/dingtalk.js';
import { imRoutes } from './routes/im.js';
import * as imCore from './lib/im-bridge-core.js';
import * as imProcMgr from './lib/im-process-manager.js';
import './lib/adapters/dingtalk-adapter.js'; // side-effect: registers the DingTalk adapter
import './lib/adapters/feishu-adapter.js';   // side-effect: registers the Feishu adapter
import './lib/adapters/wecom-adapter.js';    // side-effect: registers the WeCom adapter
import './lib/adapters/discord-adapter.js';  // side-effect: registers the Discord adapter
import { loadConfig } from './lib/im-config.js';

// Windows：git.exe / cmd.exe 等 console-subsystem 子进程从无控制台的 worker node.exe 启动时
// 会各弹一个可见控制台窗口（diff/status 轮询路径高频闪现）。在 promisify 包装层统一默认
// windowsHide（POSIX 上为 no-op，调用方传入可覆盖）。deps.execFileAsync 注入下游路由同样受益。
const _execFileAsyncRaw = promisify(execFile);
const execFileAsync = (cmd, args, opts) => _execFileAsyncRaw(cmd, args, { windowsHide: true, ...opts });
const _execAsyncRaw = promisify(exec);
const execAsync = (cmd, opts) => _execAsyncRaw(cmd, { windowsHide: true, ...opts });

// execFile with stdin input support (for git check-ignore --stdin)
function execWithStdin(cmd, args, input, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
import { LOG_FILE, _initPromise, _resumeState, _projectName, _logDir, streamingState, resetStreamingState, PROFILE_PATH, RETRY_CONFIG_PATH, _retryConfigState, setLivePort, getImLiveText, resetImLiveText } from './interceptor.js';
import { recordInstance, listInstances } from './lib/instance-registry.js';
import { LOG_DIR, setLogDir, getClaudeConfigDir, isBrowserOpenSuppressed } from '../findcc.js';
import { loadRetryConfig } from './lib/proxy-retry.js';

// 代理重试配置：由 interceptor._retryConfigState 提供（live binding，watchFile 热刷新）。
// mode 默认 off（向后兼容，不重试）。env 是启动默认/兜底，retry-config.json 覆盖 env。
// 启动日志读一次首屏值；运行时 proxy.js 每请求读 interceptor._retryConfigState 取最新。
const _startupRetryConfig = _retryConfigState || loadRetryConfig();
if (_startupRetryConfig.mode !== 'off' && process.env.CCV_DEBUG) {
  console.error(`[CC Viewer] Proxy retry: mode=${_startupRetryConfig.mode}, maxRetries=${_startupRetryConfig.maxRetries}, interval=${_startupRetryConfig.retryIntervalMs}ms`);
}
import { t, getLang, setLang } from './i18n.js';
import { loadAuthConfig, loadAuthState, saveAuthConfig, clearProjectOverride, generatePassword, decideAuth, parseCookies, renderLoginPage, localeFromAcceptLanguage } from './lib/auth.js';
import { checkAndUpdate } from './lib/updater.js';
import { loadPlugins, runWaterfallHook, runParallelHook } from './lib/plugin-loader.js';
import { CONTEXT_WINDOW_FILE, readModelContextSize } from './lib/context-watcher.js';
import { watchLogFile, startWatching, unwatchAll, sendEventToClients, sendToClients } from './lib/log-watcher.js';
import { createImLogWatcher } from './lib/im-log-watcher.js';
import { unwatchAllWorkflows } from './lib/workflow-watcher.js';
import { cleanupExtractCache } from './lib/jsonl-archive.js';
import { backupConfigs } from './lib/config-backup.js';
import { normalizeBasePath, validateBasePath, stripBasePath } from './lib/base-path.js';
import { createHardenedCleanup } from './lib/term-signals.js';
import { createBackpressureGate } from './lib/ws-backpressure.js';
import { createFloodCoalescer, envIntAllowZero } from './lib/pty-flood-coalescer.js';
import { createResyncNudgeGate } from './lib/resync-nudge-gate.js';


// 动态获取 getPrefsFile()（LOG_DIR 可能在运行时被 setLogDir 修改）
function getPrefsFile() { return join(LOG_DIR, 'preferences.json'); }

// 启动时一次性读取 ~/.claude/settings.json（不 watch）
let claudeSettings = {};
// SSR theme 注入自检状态：模板缺 data-theme 时仅首次 warn（避免高 QPS 刷屏）
let _ssrThemeAttrWarned = false;
let _indexHtmlCache = null; // { html: string, mtime: number }
try {
  const settingsPath = join(getClaudeConfigDir(), 'settings.json');
  if (existsSync(settingsPath)) {
    claudeSettings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  }
} catch { }
const isCliMode = process.env.CCV_CLI_MODE === '1';
const isSdkMode = process.env.CCV_SDK_MODE === '1';
const isWorkspaceMode = process.env.CCV_WORKSPACE_MODE === '1';
// Instance id from `ccv --pid <name>` (sanitized in cli.js). null = default mode (no
// per-instance isolation): the session-pin file falls back to the project-shared key.
const INSTANCE_ID = process.env.CCV_INSTANCE_ID || null;
// Remember this id under the project so the CLI banner can list past ids next run (memory
// aid only). Fire-and-forget; no-ops when there's no active project (e.g. workspace mode).
if (INSTANCE_ID && _logDir) recordInstance(_logDir, INSTANCE_ID).catch(() => {});
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
// 1000 远超任何合理并发场景；保留 LRU 仅作为防恶意/bug 撑爆内存的兜底，
// 不再用于"正常使用时的容量上限"——用户的 ask 不应该因为 50 个 cap 被强行 evict。
const ASK_HOOK_MAP_MAX = 1000;
// 单一来源的"无超时"实质上限——延伸至 24h 兼顾防 entry 泄漏；
// 任何引用此值的地方（HOOK_TIMEOUT / REPLAY_HOOK_TIMEOUT / 广播 timeoutMs）都从这里取。
// 实际常量定义在 server/lib/ask-constants.js（hook 路径 + SDK 路径同源）。
const ASK_HOOK_TIMEOUT_MS = ASK_TIMEOUT_MS;

// 内存 Map 是权威源；ask-store 是镜像（best-effort）。崩溃时只丢"未落盘窗口"内的最新一次变更。
// 任何 pendingAskHooks.set(...) 后必须调 _persistAskEntry；.delete(...) 后必须调 _persistAskDelete。
function _persistAskEntry(id, entry) {
  if (!entry || !Array.isArray(entry.questions)) return;
  setImmediate(() => {
    askStoreSetEntry(id, { questions: entry.questions, createdAt: entry.createdAt }).catch(() => {});
  });
}
function _persistAskDelete(id) {
  setImmediate(() => {
    askStoreDeleteEntry(id).catch(() => {});
  });
}

// Phase 3: short-poll listener registry. Hangs GET /api/ask-hook/:id/result responses
// until either an answer/cancel arrives or wait ms elapses (then 204).
const shortPollListeners = new Map(); // id -> Set<{ res, tid, finished }>

// Waiter-liveness tracking for short-poll asks (see server/lib/ask-reaper.js).
// Memory-only BY DESIGN: persisting it would bump the ask-store SCHEMA_VERSION;
// the reaper's boot-time orphan sweep covers restarts instead.
const askWaiterLastPoll = new Map(); // id -> ms of last POST create / GET result poll

function _notifyShortPollAnswer(id, answers) {
  const set = shortPollListeners.get(id);
  if (!set) return;
  for (const listener of set) {
    if (listener.finished) continue;
    listener.finished = true;
    clearTimeout(listener.tid);
    try {
      if (!listener.res.headersSent) {
        listener.res.writeHead(200, { 'Content-Type': 'application/json' });
        listener.res.end(JSON.stringify({ answers }));
      }
    } catch {}
  }
  shortPollListeners.delete(id);
}

function _notifyShortPollCancel(id, reason) {
  const set = shortPollListeners.get(id);
  if (!set) return;
  for (const listener of set) {
    if (listener.finished) continue;
    listener.finished = true;
    clearTimeout(listener.tid);
    try {
      if (!listener.res.headersSent) {
        listener.res.writeHead(200, { 'Content-Type': 'application/json' });
        listener.res.end(JSON.stringify({ cancelled: true, reason: reason || '' }));
      }
    } catch {}
  }
  shortPollListeners.delete(id);
}

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
    case 'ask-hook-cancelled':
      // 注：ask-cancel handler 统一发 ask-hook-cancelled（不论 SDK / Hook 路径）。
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
// 调高至 30s：大会话首屏/重连重放时，渲染器（尤其 Windows 浏览器，大 DOM layout 更重）
// 可能短暂忙到来不及排空 socket。过早剔除会触发「断开→EventSource 自动重连→再次重放」
// 风暴，把瞬时卡顿放大成持续卡死。30s 仍能剔除真正死掉的连接。
const SSE_BACKPRESSURE_TIMEOUT_MS = 30000;



const START_PORT = parseInt(process.env.CCV_START_PORT) || 7008;
// 主交互式 ccv 默认收到 7049，把 7050-7099 让给独立 IM worker 进程（worker 经 env 覆盖为 7050-7099）。
// env 可覆盖（向后兼容逃生口）。
const MAX_PORT = parseInt(process.env.CCV_MAX_PORT) || 7049;
// IM worker 绑 127.0.0.1（仅 loopback），避免把 N 个 skip-permissions 端点暴露到局域网（见 plan §安全 1）。
// 主进程默认仍绑 0.0.0.0 以支持手机/局域网访问。
const HOST = process.env.CCV_HOST || '0.0.0.0';

// 局域网访问 token（本地 127.0.0.1 免验证）
const ACCESS_TOKEN = randomBytes(16).toString('hex');
// Internal token used ONLY for bridge → server calls (env-leaked to the spawned
// claude process via pty-manager). Separate from ACCESS_TOKEN so the LAN URL
// token can't double as a bridge auth bypass for same-host CSRF (round-3 P1).
const INTERNAL_TOKEN = randomBytes(16).toString('hex');

// 密码登录配置（与 token 并存的第二种远程访问方式）。持久化为 preferences.json：全局 `auth`
// 键 + 可选 `authByProject[<projectDir>]` 覆盖（密码 base64 轻混淆 + 文件 0600）。
// AUTH_PROJECT = 本 server 服务的项目（CLI 模式取 CCV_PROJECT_DIR）；非 CLI/日志模式为 null
// → 只认全局。鉴权用 effective = 项目覆盖(若存在) else 全局。
// 同时在 --usePassword(CCV_USE_PASSWORD) 时取项目：该 flag 是「项目启动」专用，必须写「本项目」密码。
// 不能只靠 isCliMode —— 它在模块顶层只求值一次，而 server.js 可能经 interceptor 在 cli.js 设置
// CCV_CLI_MODE 之前就被加载(isCliMode=false)，导致 --usePassword 误写全局。
const AUTH_PROJECT = (isCliMode || process.env.CCV_USE_PASSWORD === '1')
  ? (process.env.CCV_PROJECT_DIR || process.cwd())
  : null;
let authConfig = loadAuthConfig(AUTH_PROJECT);
// CLI --usePassword 交接（cli.js 在 import 本模块前写入 env）：写入本项目作用域（无项目则全局）。
// 优先级 显式值(CCV_PASSWORD) > 该作用域已持久化密码 > 随机生成。
if (process.env.CCV_USE_PASSWORD === '1') {
  const explicit = process.env.CCV_PASSWORD;
  let password = authConfig.password;
  if (typeof explicit === 'string' && explicit.length > 0) password = explicit;
  else if (!password) password = generatePassword();
  const scope = AUTH_PROJECT ? 'project' : 'global';
  saveAuthConfig({ enabled: true, password }, { scope, projectDir: AUTH_PROJECT });
  authConfig = loadAuthConfig(AUTH_PROJECT);
}
// 钩子已消费完毕：清掉这两个 env，避免明文密码随 {...process.env} 泄漏进 spawn 出的 Claude 子进程
// （与刻意不把 ACCESS_TOKEN 放进 env 的策略一致）。此后无人再读它们（仅上面这段读取）。
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;

let clients = [];
// 内存级缓存：30s 启动检查若发现「有新版」(major_available / deferred_busy / brew_managed)，
// 在此存下 {version, source}，供 events 路由向新连接(刷新/新标签页)补推 update_major_available，
// 让版本徽标在本进程存续期内跨刷新持续显示。进程重启即归零(不落盘)。
let pendingMajorUpdate = null;
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

// ─── Route dependency bag ──────────────────────────────────────────
// Single dependency object handed to every per-domain route handler (server/routes/*).
// Built once; route bodies were moved out of handleRequest's if-chain verbatim, with
// their closed-over identifiers rewritten to `deps.xxx`. Reassignable module state is
// exposed via GETTERS (read fresh at request time — never captured at import), while
// never-reassigned Maps/arrays are shared by reference. Helpers/constants that live in
// server.js (not importable elsewhere) are funneled through here too.

// IM 日志目录监听器：仅主 web 服务启用（IM worker 无浏览器 SSE 客户端，广播无意义）。
// 惰性 ensure：「对话记录」弹窗请求 /api/im/:platform/logs 时才开始 watch 该平台目录；
// 写入即广播 im_log_update SSE → 前端零滞后重拉（详见 im-log-watcher.js / AppBase im_log_update 监听）。
const _imLogWatcher = process.env.CCV_IM_PLATFORM ? null : createImLogWatcher({
  getLogDir: () => LOG_DIR,
  onChange: (platform) => {
    if (clients.length > 0 && sendEventToClients) {
      sendEventToClients(clients, 'im_log_update', { platform, ts: Date.now() });
    }
  },
});

// 惰性登记 IM 日志目录监听（主服务）；worker 上 _imLogWatcher 为 null → no-op。
function _ensureImWatch(id) {
  try { _imLogWatcher?.ensure(id); }
  catch (e) { console.warn(`[im-log-watcher] ensure(${id}) failed:`, e?.message || e); }
}

const deps = {
  // Reassignable runtime state — must stay getters.
  get protocol() { return serverProtocol; },
  get actualPort() { return actualPort; },
  get terminalWss() { return terminalWss; },
  get writeToPty() { return _writeToPty; },
  get onPtyData() { return _onPtyData; },
  get statsWorker() { return statsWorker; },
  get retryConfig() { return _retryConfigState; },
  get workspaceLaunched() { return _workspaceLaunched; },
  setWorkspaceLaunched(v) { _workspaceLaunched = v; },
  get launchCallback() { return _launchCallback; },
  get workspaceClaudeArgs() { return _workspaceClaudeArgs; },
  get workspaceClaudePath() { return _workspaceClaudePath; },
  get workspaceIsNpmVersion() { return _workspaceIsNpmVersion; },
  startStreamingStatusTimer,
  get claudeSettings() { return claudeSettings; },
  // const defined later in the file (TDZ) — must be a getter, read at request time.
  get turnEndDebounceMs() { return TURN_END_DEBOUNCE_MS; },
  // Shared collections — stable references (never reassigned; clients truncated in place).
  clients,
  pendingAskHooks,
  pendingPermHooks,
  shortPollListeners,
  askWaiterLastPoll,
  notifyShortPollCancel: _notifyShortPollCancel,
  editorSessions,
  gitRestoreLocks,
  liveStreamLastSeq: _liveStreamLastSeq,
  // Helpers defined in server.js.
  execFileAsync,
  execAsync,
  execWithStdin,
  resolveRepoCwd,
  getPrefsFile,
  getLocalIp,
  startStatsWorker,
  persistAskEntry: _persistAskEntry,
  persistAskDelete: _persistAskDelete,
  notifyParentPending: _notifyParentPending,
  logWatcherOpts: _logWatcherOpts,
  scheduleTurnEndBroadcast: _scheduleTurnEndBroadcast,
  ensureImWatch: _ensureImWatch,
  maskProfiles: _maskProfiles,
  maskApiKey: _maskApiKey,
  isMasked: _isMasked,
  // Password-auth config. authConfig = the EFFECTIVE config the gate enforces for this
  // server's project (project override else global). Mutations persist to the chosen
  // scope then recompute the effective in-memory value.
  get authConfig() { return authConfig; },
  get authProject() { return AUTH_PROJECT; },
  // 重新赋值的运行时状态 → 必须 getter，请求时读最新值（详见 let pendingMajorUpdate 注释）
  get pendingMajorUpdate() { return pendingMajorUpdate; },
  getAuthState() { return loadAuthState(AUTH_PROJECT); },
  setAuthConfig(c, scope) {
    saveAuthConfig(c, { scope: scope === 'global' ? 'global' : (AUTH_PROJECT ? 'project' : 'global'), projectDir: AUTH_PROJECT });
    authConfig = loadAuthConfig(AUTH_PROJECT);
    return authConfig;
  },
  clearAuthOverride() {
    clearProjectOverride(AUTH_PROJECT);
    authConfig = loadAuthConfig(AUTH_PROJECT);
    return authConfig;
  },
  // Constants local to server.js.
  // Generic IM bridge admin surface, keyed by platform id.
  // IM adapters now run in detached worker processes (im-process-manager), NOT in this process.
  //  - isWorker: are we an IM worker (CCV_IM_PLATFORM set)? The worker reports its own in-process
  //    adapter status (getBridgeStatus) — that's what the main process's manager probes.
  //  - In the MAIN process, status/lifecycle go through the manager (lock + loopback probe / spawn / kill).
  im: {
    isWorker: !!process.env.CCV_IM_PLATFORM,
    getBridgeStatus: (id) => imCore.getBridgeStatus(id),   // worker-side: real in-process adapter status
    getProcessStatus: (id) => imProcMgr.getImProcessStatus(id), // main-side: detached worker status (async)
    startProcess: (id) => imProcMgr.spawnImProcess(id),
    stopProcess: (id) => imProcMgr.stopImProcess(id),
    restartProcess: async (id) => { await imProcMgr.stopImProcess(id); return imProcMgr.spawnImProcess(id); },
    testConnection: (id, cfg) => imCore.testConnection(id, cfg),
  },
  // DingTalk back-compat alias (legacy /api/dingtalk/* routes). Same manager-backed semantics.
  dingtalk: {
    isWorker: !!process.env.CCV_IM_PLATFORM,
    getBridgeStatus: () => imCore.getBridgeStatus('dingtalk'),
    getProcessStatus: () => imProcMgr.getImProcessStatus('dingtalk'),
    startProcess: () => imProcMgr.spawnImProcess('dingtalk'),
    stopProcess: () => imProcMgr.stopImProcess('dingtalk'),
    restartProcess: async () => { await imProcMgr.stopImProcess('dingtalk'); return imProcMgr.spawnImProcess('dingtalk'); },
    testConnection: (cfg) => imCore.testConnection('dingtalk', cfg),
  },
  ACCESS_TOKEN,
  INTERNAL_TOKEN,
  MAX_POST_BODY,
  ASK_HOOK_TIMEOUT_MS,
  ASK_HOOK_MAP_MAX,
  PERM_HOOK_MAP_MAX,
  WINDOWS_RESERVED_NAMES,
  DEFAULT_EVENTS_LIMIT,
  SSE_BACKPRESSURE_TIMEOUT_MS,
  IGNORED_PATTERNS,
  isCliMode,
  isSdkMode,
  isWorkspaceMode,
  instanceId: INSTANCE_ID,
  defaultProxyProfiles: _defaultProxyProfiles,
};

// ─── Route registry ────────────────────────────────────────────────
// Domain route modules concatenated IN THE SAME ORDER as the original if-chain
// (order is load-bearing: prefix-vs-exact and method-distinguished duplicates).
// dispatch() runs after the request prelude; an unmatched request returns false and
// falls through to static-file serving / 404.
const _routes = [
  ...authRoutes,
  ...projectMetaRoutes,
  ...miscRoutes,
  ...preferencesRoutes,
  ...projectPrefsRoutes,
  ...sessionPinRoutes,
  ...gitRoutes,
  ...pluginsRoutes,
  ...logsRoutes,
  ...voicePackRoutes,
  ...skillsRoutes,
  ...ultraAgentsRoutes,
  ...filesContentRoutes,
  ...workflowJournalRoutes,
  ...filesFsRoutes,
  ...searchRoutes,
  ...workspacesRoutes,
  ...expertRoutes,
  ...eventsRoutes,
  ...askPermRoutes,
  ...teamRoutes,
  ...dingtalkRoutes,
  ...imRoutes,
];
const dispatch = createDispatcher(_routes);

async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `${serverProtocol}://${req.headers.host}`);
  let url = parsedUrl.pathname;

  // CCV_BASE_PATH reverse proxy: strip prefix at TOP so API/WS/static/SPA
  // all work with original unprefixed paths. 剥离后必须写回 parsedUrl.pathname ——
  // dispatch()（routes/_dispatch.js）与多个 handler（files-content/ask-perm/im）直读
  // parsedUrl.pathname 做路由匹配和偏移 slice，不写回则前缀下全部 /api/* 与 SSE /events
  // 命不中、落 SPA fallback（PR #108 遗留 P0）。searchParams 不受 pathname 赋值影响。
  const bp = normalizeBasePath(process.env.CCV_BASE_PATH);
  url = stripBasePath(url, bp);
  parsedUrl.pathname = url;
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

  // 局域网访问验证：decideAuth() 统一决策（本地 127.0.0.1/::1 免验、静态资源免验、
  // ?token=/cookie/密码登录三选一）。详见 server/lib/auth.js。
  // 不变式：login-page/unauthorized/forbidden 必须 return；只有 allow 才继续往下进
  // Host allowlist + 路由。
  const remoteIp = req.socket.remoteAddress;
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  const isStaticAsset = url.startsWith('/assets/') || url === '/favicon.ico';
  const wantsHtml = method === 'GET' && ((req.headers.accept || '').includes('text/html') || url === '/');
  const authDecision = decideAuth({
    isStaticAsset,
    pathname: url,
    isLocal,
    urlToken: parsedUrl.searchParams.get('token'),
    cookieToken: parseCookies(req.headers.cookie).ccv_auth,
    accessToken: ACCESS_TOKEN,
    enabled: authConfig.enabled,
    password: authConfig.password,
    wantsHtml,
  });
  if (authDecision.action === 'login-page') {
    const lang = localeFromAcceptLanguage(req.headers['accept-language']) || getLang();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderLoginPage({ lang }));
    return;
  }
  if (authDecision.action === 'unauthorized') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  if (authDecision.action === 'forbidden') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: invalid token' }));
    return;
  }
  // action === 'allow' → 继续

  // DNS rebinding 防护:即使带了正确 token,Host header 必须落在 allowlist 里。
  // 默认放行 loopback + 本机所有 LAN IPv4(getAllLocalIps()):cc-viewer 核心场景就是手机扫码访问 LAN URL,
  // 要求用户每次手动设 CCV_ALLOWED_HOSTS 不可接受。token 仍是必需(server.js:300-310 ACCESS_TOKEN gate),
  // DNS rebinding 攻击者需精确知道用户 LAN IP 才能利用,门槛降低但不增新攻击面;Vite/Cursor 同行也默认放开 LAN。
  // CCV_ALLOWED_HOSTS 显式设(包括 '*' 关闭防护)时完全沿用用户值,与 1.6.227 行为一致,向后兼容。
  // 静态资源和 OPTIONS 预检不挡。
  if (!isStaticAsset && method !== 'OPTIONS') {
    const allowedHosts = process.env.CCV_ALLOWED_HOSTS
      ? process.env.CCV_ALLOWED_HOSTS.split(',').map(s => s.trim()).filter(Boolean)
      : ['localhost', '127.0.0.1', '::1', '[::1]', ...getAllLocalIps()];
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

  // Per-domain routes (server/routes/*). Unmatched requests fall through to
  // static-file serving and the API/SPA 404 below.
  if (await dispatch(req, res, parsedUrl, isLocal, deps)) return;

  // 静态文件服务
  if (method === 'GET') {
    // basePath 已在 handleRequest 顶部统一剥离，这里不可再剥——否则 /proxy/proxy/x
    // 这类路径会被双重剥离。
    let filePath = url;
    if (filePath === '/') filePath = '/index.html';
    // 去掉 query string
    filePath = filePath.split('?')[0];

    const fullPath = join(DIST_DIR, filePath);

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
        const indexPath = join(DIST_DIR, 'index.html');
        // mtime 缓存：避免每次请求都 readFileSync（Windows Defender 下每次读 5-50ms）
        let st;
        try { st = statSync(indexPath); } catch { return false; }
        if (!_indexHtmlCache || _indexHtmlCache.mtime !== st.mtimeMs) {
          _indexHtmlCache = { html: readFileSync(indexPath, 'utf-8'), mtime: st.mtimeMs };
        }
        let html = _indexHtmlCache.html;
        let themeColor = process.platform === 'win32' ? 'dark' : 'light';
        try {
          if (existsSync(getPrefsFile())) {
            const prefs = JSON.parse(readFileSync(getPrefsFile(), 'utf-8'));
            if (prefs.themeColor === 'dark' || prefs.themeColor === 'light') themeColor = prefs.themeColor;
          }
        } catch {}
        if (!_ssrThemeAttrWarned && !/<html[^>]*data-theme="[^"]*"/.test(html)) {
          _ssrThemeAttrWarned = true;
          console.warn('[serveIndexHtml] dist/index.html 没有 <html data-theme="..."> 属性，SSR theme 注入将不生效。检查 index.html 模板。');
        }
        html = html.replace(/<html([^>]*?)data-theme="[^"]*"/, `<html$1data-theme="${themeColor}"`);
        // 运行时始终注入 <base> 标签（根部署用 '/'，子路径用规范化前缀）：配合 Vite 默认
        // base=''（相对路径产物），让浏览器把所有相对 URL（含任意深度 SPA-fallback 文档里的
        // ./assets）解析到正确根/前缀下，避免深链直访（如 /a/b）时相对当前路径解析 → 白屏。
        // window.__CCV_BASE_PATH__ 仅子路径时注入：运行时 API/WS 的 base 语义保持"未设=无前缀"不变。
        const injectBase = normalizeBasePath(process.env.CCV_BASE_PATH);
        const baseHref = injectBase || '/';
        const escapedBase = baseHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let injectHtml = `<base href="${escapedBase}">`;
        if (injectBase) {
          // JS 双引号字符串转义：\ → \\、" → \"、</ → <\/（防 </script> 提前闭合）
          const jsSafeBase = injectBase.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/<\//g, '<\\/');
          injectHtml += `<script>window.__CCV_BASE_PATH__="${jsSafeBase}"</script>`;
        }
        html = html.replace(/<head[^>]*>/i, m => m + injectHtml);
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
  // 启动新一轮 → 若上一次 stop 仍在飞行，先 await 它再重置，避免与并发 _doStop 共享状态。
  if (_stoppingPromise) {
    try { await _stoppingPromise; } catch { /* stop 内部已 try/catch，最坏继续 */ }
  }
  _isStopping = false;
  _stoppingPromise = null;
  // 加载插件（需要在创建服务器之前，以便通过 hook 获取 HTTPS 证书）
  await loadPlugins();

  // 清理过期解压缓存（fire-and-forget；任何错误吞掉）
  setImmediate(() => { try { cleanupExtractCache(); } catch { /* ignore */ } });

  // 启动期配置备份:preferences/profile/workspaces → LOG_DIR 外的 cc-viewer-config-backups/
  // (滚动留 10 份)。2026-06-06 事故:配置随 LOG_DIR 整树丢失后无处可恢复。fire-and-forget。
  setImmediate(() => { try { backupConfigs(); } catch { /* ignore */ } });

  // 启动时清理磁盘上 ASK_HOOK_TIMEOUT_MS 之前的 ask 条目（兜底防泄漏）。
  // 内存 Map 不 hydrate：旧 res 已死、新 ask-bridge 重连同 toolUseId 会自动复用槽位
  // （server.js 已有"旧 res 已断 → 复用"分支），无需在这里主动重建内存态。
  // 留下来的 disk 镜像供 /api/pending-asks 端点查询，让浏览器重连后仍能看见 pending 列表。
  setImmediate(() => { askStorePruneStale(ASK_HOOK_TIMEOUT_MS).catch(() => {}); });
  // 长跑进程兜底：短轮询路径下 markAnswered 标的终态 entry 若 ask-bridge 已死（GET 不再来 consume），
  // 仅靠启动 prune 永远清不掉。1h 周期触发一次，.unref() 不阻塞进程退出。
  const _pruneAskStoreInterval = setInterval(() => {
    askStorePruneStale(ASK_HOOK_TIMEOUT_MS).catch(() => {});
  }, 60 * 60 * 1000);
  _pruneAskStoreInterval.unref();

  // Waiter-liveness reaper: resolves short-poll asks whose hook process (ask-bridge)
  // died without notifying us (e.g. AskUserQuestion declined at the CLI → SIGTERM).
  // Keys on waiter liveness, never on wall-clock ask age — the "GUI effectively
  // no-timeout" contract is untouched. See server/lib/ask-reaper.js.
  const _reaperDeps = {
    pendingAskHooks,
    shortPollListeners,
    askWaiterLastPoll,
    markCancelled: askStoreMarkCancelled,
    loadAskStore: askStoreLoad,
    notifyShortPollCancel: _notifyShortPollCancel,
    // terminalWss is assigned later in startServer — resolve at call time via closure.
    broadcastCancelled: (id, reason) => {
      if (!terminalWss) return;
      const cmsg = JSON.stringify({ type: 'ask-hook-cancelled', id, reason });
      terminalWss.clients.forEach((c) => {
        if (c.readyState === 1) try { c.send(cmsg); } catch {}
      });
    },
    notifyParentPending: _notifyParentPending,
  };
  const _reaperState = { lastSweepAt: Date.now() };
  _askReaperTimer = setInterval(() => {
    reapDeadAskWaiters(_reaperDeps, _reaperState).catch(() => {});
  }, ASK_WAITER_REAP_INTERVAL_MS);
  _askReaperTimer.unref();
  // One-shot boot sweep for disk-only orphans left by a previous server process.
  // Delayed one liveness window so a bridge that survived our restart can re-poll
  // and prove ownership first; skipped when another cc-viewer instance is running.
  // Also skipped entirely under custom CCV_START_PORT/CCV_MAX_PORT: the lsof scan
  // covers only OUR range, so an instance on a different custom range would be
  // invisible and its live asks could be falsely swept. The memory-owned reaper
  // and the ApprovalModal fallback UI still cover orphans in that setup.
  const _customPortRange = !!(process.env.CCV_START_PORT || process.env.CCV_MAX_PORT);
  const _bootTime = Date.now();
  if (!_customPortRange) {
    _askOrphanSweepTimer = setTimeout(() => {
      sweepOrphanedDiskAsks({
        ..._reaperDeps,
        bootTime: _bootTime,
        ownPid: process.pid,
        portRange: [START_PORT, MAX_PORT],
        // Async on purpose: a wedged lsof would otherwise block the event loop
        // (and every in-flight request) for up to the full timeout.
        lsofImpl: async (cmd) => (await execAsync(cmd, { timeout: 2000, encoding: 'utf-8' })).stdout,
      }).catch(() => {});
    }, ASK_WAITER_LIVENESS_MS);
    _askOrphanSweepTimer.unref();
  }

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
          // 把服务端 i18n 的 currentLang 同步成用户在 UI 配置的语言（preferences.lang）。
          // 否则服务端 t() 恒为默认 'zh'——DingTalk 桥接的系统提示、登录页回落语言都不跟随配置。
          // setLang 自带 locale 校验，非法/缺失值回落 en，读 prefs 失败也安全跳过。
          try {
            if (existsSync(getPrefsFile())) {
              const _prefs = JSON.parse(readFileSync(getPrefsFile(), 'utf-8'));
              if (_prefs.lang) setLang(_prefs.lang);
            }
          } catch { /* 读 prefs 失败就保持默认语言 */ }
          // CCV_BASE_PATH 配置校验：缺前导 '/' 时剥离静默失效（startsWith 永不命中），
          // 启动期告警一次。放在 setLang 之后，告警语言才跟随用户配置。
          {
            const _bpCheck = validateBasePath(process.env.CCV_BASE_PATH);
            if (_bpCheck.warning) console.warn(t(_bpCheck.warning, { value: process.env.CCV_BASE_PATH }));
          }
          // interceptor.js runs in this same process (via proxy.js → setupInterceptor).
          // Inject live-port via module-level setter instead of process.env to avoid
          // polluting env of child_process.spawn descendants (Bash tools / MCP / Electron tabs).
          setLivePort(port, serverProtocol);
          // 自动打开/serverStarted hook 用的 URL 也要带反代前缀（与启动打印一致）
          const url = `${serverProtocol}://127.0.0.1:${port}${normalizeBasePath(process.env.CCV_BASE_PATH)}`;
          if (!isCliMode) {
            console.error(t('server.started'));
            const _bp = normalizeBasePath(process.env.CCV_BASE_PATH);
            console.error(t('server.startedLocal', { protocol: serverProtocol, port, basePath: _bp }));
            const _ips = getAllLocalIps();
            for (const _ip of _ips) {
              console.error(t('server.startedNetwork', { protocol: serverProtocol, ip: _ip, port, basePath: _bp, token: ACCESS_TOKEN }));
            }
            if (authConfig.enabled) {
              if (authConfig.password === '') console.error(t('server.passwordEmptyWarn'));
              else console.error(t('server.passwordActive', { password: authConfig.password }));
            }
          }
          // v2.0.69 之前的版本会清空控制台，自动打开浏览器确保用户能看到界面
          // L7 sandbox: suppressed under tests / CCV_NO_OPEN=1 (see findcc.js).
          try {
            const ccPkgPath = join(NODE_MODULES, '@anthropic-ai', 'claude-code', 'package.json');
            const ccVer = JSON.parse(readFileSync(ccPkgPath, 'utf-8')).version;
            const [maj, min, pat] = ccVer.split('.').map(Number);
            if ((maj < 2 || (maj === 2 && min === 0 && pat < 69)) && !isBrowserOpenSuppressed()) {
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
                _persistAskDelete(id);
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
          // IM adapters no longer run in the main ccv. Each enabled IM runs as an independent,
          // detached worker process (im-process-manager). Two CLI-mode cases:
          //   - WORKER (CCV_IM_PLATFORM set): connect ONLY this one platform to the singleton PTY.
          //   - MAIN ccv: connect NOTHING in-process; reconcile spawns/adopts the enabled IM workers.
          // (Non-CLI workspace/SDK modes do neither — IM only makes sense with the singleton PTY.)
          if (isCliMode && process.env.CCV_IM_PLATFORM) {
            const id = process.env.CCV_IM_PLATFORM;
            const pmb = await import('./pty-manager.js');
            try {
              await imCore.startBridge(id, {
                writeToPty: pmb.writeToPty,
                writeToPtySequential: pmb.writeToPtySequential,
                getPtyState: pmb.getPtyState,
                getPtyKind: pmb.getPtyKind,
                getPtySkipPermissions: pmb.getPtySkipPermissions,
                isStreaming: () => streamingState.active,
                getConfig: () => loadConfig(id),
                // 钉钉 AI 卡片逐字流式的文本源（仅 worker 注入）：对话过程中读主 agent 累计文本，
                // 注入轮次开始时重置。其它平台/主 ccv 无此 dep，core 判空即跳过流式。
                getLiveText: () => getImLiveText(),
                resetLiveText: () => resetImLiveText(),
              });
            } catch (e) {
              console.error(`[CC Viewer] IM worker startBridge(${id}) failed:`, e?.message || e);
            }
          } else if (isCliMode) {
            // 主 ccv：先 stopAll（无在进程实例时为 no-op，防御升级残留）再 reconcile，
            // 杜绝"旧在进程连接 + 新 detached worker"同时连同一机器人导致丢/重消息。
            try { await imCore.stopAll(); } catch { /* no in-process instances */ }
            imProcMgr.reconcileImProcesses().catch((e) => console.error('[CC Viewer] IM reconcile failed:', e?.message || e));
          }
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
    const { writeToPty, writeToPtySequential, resizePty, onPtyData, onPtyExit, getPtyState, getOutputBuffer, getCurrentWorkspace, spawnShell, findSafeSliceStart } = await import('./pty-manager.js');
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
      const wsUrl = new URL(req.url, `${serverProtocol}://${req.headers.host}`);
      // upgrade 不经 handleRequest，basePath 需独立剥离（与 HTTP 段同走统一函数）
      let pathname = stripBasePath(wsUrl.pathname, normalizeBasePath(process.env.CCV_BASE_PATH));
      // 与 HTTP 一致的鉴权（此前 WS upgrade 完全不校验 token，远程终端实为无门禁——本次堵洞）。
      // 在此显式计算 isLocal（与 handleRequest 同款三态判断），WS 视作非 HTML 请求。
      const wsRemoteIp = req.socket.remoteAddress;
      const wsIsLocal = wsRemoteIp === '127.0.0.1' || wsRemoteIp === '::1' || wsRemoteIp === '::ffff:127.0.0.1';
      const wsAuth = decideAuth({
        isStaticAsset: false,
        pathname,
        isLocal: wsIsLocal,
        urlToken: wsUrl.searchParams.get('token'),
        cookieToken: parseCookies(req.headers.cookie).ccv_auth,
        accessToken: ACCESS_TOKEN,
        enabled: authConfig.enabled,
        password: authConfig.password,
        wantsHtml: false,
      });
      if (wsAuth.action !== 'allow') {
        socket.destroy();
        return;
      }
      if (pathname === '/ws/terminal') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else if (pathname === '/ws/terminal-scratch') {
        // 校验 id：缺失或非法 → destroy（避免 Map<id> 被注入空键 / 超长 / 特殊字符）
        const scratchId = wsUrl.searchParams.get('id');
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

    // 反压状态转换日志（observability：线上排"页面卡"时可直接判断是否触发过反压、几次、积压量）。
    // behind/resume 在持续洪泛下以亚秒级周期振荡，5s 节流防刷屏；timeout 是终态必记。
    // resyncTotal/nudgeSkipped 判别 resync 循环：resync 涨 + skipped 同涨 = nudge 冷却在救；
    // resync 涨 + skipped≈0 = resume 间隔超过冷却期的慢振荡，需更激进策略（如洪泛期禁 nudge）。
    const makeBpLogger = (label, ws) => {
      let behindCount = 0;
      let resyncCount = 0;
      let nudgeSkipped = 0;
      let lastLogAt = 0;
      return (event, buffered) => {
        if (event === 'behind') behindCount++;
        if (event === 'resume') resyncCount++;
        if (event === 'nudge-skip') { nudgeSkipped++; return; }   // 只计数，随下一条节流日志带出
        const now = Date.now();
        if (event !== 'timeout' && now - lastLogAt < 5000) return;
        lastLogAt = now;
        console.warn(`[${label}] ws backpressure ${event}: client=${ws._socket?.remoteAddress || '?'} bufferedAmount=${buffered} behindTotal=${behindCount} resyncTotal=${resyncCount} nudgeSkipped=${nudgeSkipped}`);
      };
    };

    // resync nudge 冷却（CCV_RESYNC_NUDGE_COOLDOWN_MS，0 = 不冷却；详见 lib/resync-nudge-gate.js）
    const RESYNC_NUDGE_COOLDOWN_MS = envIntAllowZero('CCV_RESYNC_NUDGE_COOLDOWN_MS', 3000);
    // 客户端 resync-request 的服务端冷却兜底（客户端 write-queue trim 后自带节流，这里防风暴；
    // 复用 nudge 门实现，0 = 不冷却）
    const RESYNC_REQ_COOLDOWN_MS = envIntAllowZero('CCV_RESYNC_REQ_COOLDOWN_MS', 1000);

    // 洪泛限流器状态日志（与 makeBpLogger 同款 5s 节流，独立实例不共享计数）。
    // Windows 实机排"切主题/大流量卡死"时据此确认 ConPTY 洪泛是否触发、几次、量级。
    // 'rate' 事件 = 直通态 ws 消息率告警（msgsPerSec，计数在 send 闭包），判别消息数风暴。
    const makeFloodLogger = (label, ws) => {
      let floodCount = 0;
      let lastLogAt = 0;
      return (event, bytes) => {
        if (event === 'start') floodCount++;
        // 该日志为 Windows 实机排洪泛卡死的观测点，macOS 下纯噪声，静默（限流逻辑本身不受影响）。
        if (process.platform === 'darwin') return;
        const now = Date.now();
        if (now - lastLogAt < 5000) return;
        lastLogAt = now;
        const metric = event === 'rate' ? 'msgsPerSec' : 'winBytes';
        console.warn(`[${label}] pty flood ${event}: client=${ws._socket?.remoteAddress || '?'} ${metric}=${bytes} floodTotal=${floodCount}`);
      };
    };

    // 直通态消息率计数器工厂：1s 整数桶，桶滚动时超过阈值经 floodLog('rate') 告警（5s 节流兜底）。
    const makeMsgRateCounter = (floodLog, warnAbove = 60) => {
      let count = 0;
      let winStart = 0;
      return () => {
        const now = Date.now();
        if (now - winStart >= 1000) {
          if (count > warnAbove) floodLog('rate', count);
          count = 0;
          winStart = now;
        }
        count++;
      };
    };

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

      // 反压闸门：写缓冲堆积时停发 data，恢复后用 outputBuffer 快照 resync 追赶
      // （防 Windows ConPTY 洪泛把慢客户端 / server 内存拖垮，详见 lib/ws-backpressure.js）。
      // 快照自身有界：scratch outputBuffer 50KB 滚动截断（scratch-pty-manager.js MAX_BUFFER），
      // behind 期间继续灌也不会撑爆 resync 响应。
      const _bpLog = makeBpLogger('scratch-ws', ws);
      // floodGate 在 bpGate 之后构造（send 闭包依赖 bpGate），onBehind/onResume 经 let 前向引用 reset：
      // resync 快照是唯一真相源，coalescer 残留 pending 不清会把早于快照的旧字节回灌导致画面回退。
      let floodGate = null;
      // 权威快照对齐：bpGate.onResume / floodGate.onTruncate / 客户端 resync-request 三路共用。
      // 调用前须 floodGate.reset()（快照已含 pending 字节，残留会在快照后回灌重复）。
      const sendScratchResync = () => {
        if (ws.readyState !== 1) return;
        try { ws.send(JSON.stringify({ type: 'data-resync', data: getScratchOutputBuffer(id) })); } catch {}
      };
      const resyncReqGate = createResyncNudgeGate({ cooldownMs: RESYNC_REQ_COOLDOWN_MS });
      const bpGate = createBackpressureGate({
        getBufferedAmount: () => ws.bufferedAmount,
        onBehind: (buffered) => {
          _bpLog('behind', buffered);
          floodGate?.reset();
        },
        onResume: (buffered) => {
          _bpLog('resume', buffered);
          floodGate?.reset();
          sendScratchResync();
        },
        onTimeout: (buffered) => {
          _bpLog('timeout', buffered);
          try { ws.terminate(); } catch {}
        },
      });

      // 洪泛限流器：字节率超阈值时按窗口合并 + last-wins 截断（ConPTY 全屏重绘洪泛防卡死，
      // 与 bpGate 互补——bpGate 管慢网络写缓冲，floodGate 管快 LAN 字节率，详见 lib/pty-flood-coalescer.js）
      const _floodLog = makeFloodLogger('scratch-ws', ws);
      const _countMsg = makeMsgRateCounter(_floodLog);
      floodGate = createFloodCoalescer({
        send: (data) => {
          if (ws.readyState === 1 && bpGate.offer()) {
            // send 抛错 = 该条数据永久丢失（流中间挖洞且无路径补发）→ 立即快照对齐兜底
            try { ws.send(JSON.stringify({ type: 'data', data })); } catch { sendScratchResync(); return; }
            _countMsg();
          }
        },
        findSafeSliceStart,
        onFloodStart: (bytes) => _floodLog('start', bytes),
        onFloodEnd: () => _floodLog('end', 0),
        // 洪泛期丢过中段：增量输出流不会自愈，回落直通后用权威快照对齐一次
        onTruncate: (dropped) => {
          _floodLog('truncate', dropped);
          floodGate.reset();
          sendScratchResync();
        },
      });

      const removeDataListener = onScratchData(id, (data) => {
        floodGate.offer(data);
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
          } else if (msg.type === 'resync-request') {
            // 客户端 write-queue 积压丢弃后请求快照对齐（utils/terminalWriteQueue.js onTrim）
            if (resyncReqGate.shouldNudge()) {
              floodGate.reset();
              sendScratchResync();
            }
          } else if (msg.type === 'kill') {
            // 用户主动关闭 tab：杀 pty（killScratch 内部 ptys.delete 后配额自动释放）；前端会随后 close ws
            killScratch(id);
          }
        } catch {}
      });

      ws.on('close', () => {
        bpGate.dispose();
        floodGate.dispose();
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

      // Replay pending ask-hook 请求：浏览器关 tab 再开（或 ws 重连）时，
      // 让新 ws 立即收到当前 server-side 仍 long-poll 的 ask 列表 + startedAt + 剩余 timeoutMs，
      // 否则前端 askMetaMap 空 → 倒计时不渲染 + lastPendingAskId 派生错。
      // 与上方 HOOK_TIMEOUT 同源（实质无超时）。
      const REPLAY_HOOK_TIMEOUT = ASK_HOOK_TIMEOUT_MS;
      const now = Date.now();
      for (const [id, entry] of pendingAskHooks) {
        const elapsed = now - (entry.createdAt || now);
        const remaining = Math.max(0, REPLAY_HOOK_TIMEOUT - elapsed);
        if (remaining <= 0) continue;
        try {
          ws.send(JSON.stringify({
            type: 'ask-hook-pending',
            id,
            questions: entry.questions,
            startedAt: now,        // 让前端按"还剩 remaining"起算（不是原 createdAt）
            timeoutMs: remaining,  // 剩余可用时间
          }));
        } catch {}
      }

      // 兜底重绘标记：claude TUI 在 alternate-screen 下只在收到 SIGWINCH 时重绘整屏。
      // 若前端首次 resize 与 PTY 当前尺寸恰好相等，pty.resize noop 不发 SIGWINCH → 前端空白。
      // 该 ws 收到第一条 resize 时（见 ws.on('message')），抖动 (rows+1) → (rows) 触发 SIGWINCH。
      // 注：仅 PTY 已运行时才需要兜底；shell 不在 alternate-screen 不需要。
      let _needRedrawBootstrap = state.running === true;
      // 加载期免疫补救：claude -c 大会话有数秒加载期，首发 SIGWINCH 若打在 TUI 渲染器
      // 挂载前会被忽略且兜底是一次性的 → 画面空白持续到用户敲键盘。数据感知延迟重试：
      // 连接以来 PTY 零输出（= 画面必然空白）才补发，有数据流过即作罢；ws close 清理。
      let _ptyDataSeen = false;
      const _redrawRetryTimers = [];
      const _nudgeRedraw = () => {
        try {
          if (process.platform !== 'win32') {
            const pid = getClaudePid();
            if (pid && pid !== process.pid) process.kill(pid, 'SIGWINCH');
          }
        } catch {}
      };
      const _armRedrawRetries = () => {
        for (const delay of [2000, 6000]) {
          const t = setTimeout(() => { if (!_ptyDataSeen) _nudgeRedraw(); }, delay);
          t.unref?.();
          _redrawRetryTimers.push(t);
        }
      };

      // 反压闸门：写缓冲堆积时停发 data，恢复后用 outputBuffer 快照 resync 追赶；
      // resync 后强制 claude TUI 全屏重绘，避免洪泛结束于 TUI 静止态时画面停在快照
      // （防 Windows ConPTY 洪泛拖垮慢客户端 / server 内存，详见 lib/ws-backpressure.js）。
      // 快照自身有界：outputBuffer 200KB 滚动截断（pty-manager.js MAX_BUFFER + findSafeSliceStart
      // ANSI 安全起点），behind 期间 PTY 继续灌也不会撑爆 resync 响应。
      const _bpLog = makeBpLogger('terminal-ws', ws);
      // floodGate 前向引用（构造顺序同 scratch 路径）：onBehind/onResume 必清 coalescer
      // pending——resync 快照是唯一真相源，旧 pending 回灌会导致画面回退。
      let floodGate = null;
      // nudge 冷却门：快照每次 resume 无条件发（修复 behind 期间跳发的数据），但重绘 nudge
      // 走冷却——nudge 让 ConPTY 再吐全屏重绘 = 新洪泛燃料，紧 behind→resume 循环里反复
      // nudge 会自我维持（客户端每轮 reset+重放快照 = 永久冻结表象）。详见 lib/resync-nudge-gate.js。
      const nudgeGate = createResyncNudgeGate({ cooldownMs: RESYNC_NUDGE_COOLDOWN_MS });
      const resyncReqGate = createResyncNudgeGate({ cooldownMs: RESYNC_REQ_COOLDOWN_MS });
      // 权威快照对齐：data-resync 快照无条件发，全屏重绘 nudge 走 nudgeGate 冷却。
      // bpGate.onResume / floodGate.onTruncate / 客户端 resync-request 三路共用；
      // 调用前须 floodGate.reset()（快照已含 pending/微合并缓冲字节，残留会在快照后回灌重复）。
      const sendResync = (buffered = 0) => {
        if (ws.readyState !== 1) return;
        try { ws.send(JSON.stringify({ type: 'data-resync', data: getOutputBuffer() })); } catch {}
        if (!nudgeGate.shouldNudge()) { _bpLog('nudge-skip', buffered); return; }
        try {
          if (process.platform !== 'win32') {
            // POSIX：与下方 _needRedrawBootstrap 同款 SIGWINCH 兜底
            const pid = getClaudePid();
            if (pid && pid !== process.pid) process.kill(pid, 'SIGWINCH');
          } else {
            // Windows 无 SIGWINCH：resize 抖动经 ConPTY 通知重绘（恢复路径偶发，闪烁可接受）。
            // 尺寸仲裁与 resize 消息处理一致：移动端优先，否则活跃客户端（activeWs 为 null 时
            // 本 ws 视为所有者）——恢复的 ws 可能是非权威的慢后台 tab，用它自己的尺寸抖动会把
            // 共享 PTY 永久改成它的尺寸、挤掉活跃/移动端画面；无权威尺寸则跳过抖动。
            const mSize = getMobileSize();
            const size = mSize
              || ((activeWs === ws || activeWs === null) ? clientSizes.get(ws) : clientSizes.get(activeWs));
            if (size) {
              resizePty(size.cols, size.rows + 1);
              resizePty(size.cols, size.rows);
            }
          }
        } catch {}
      };
      const bpGate = createBackpressureGate({
        getBufferedAmount: () => ws.bufferedAmount,
        onBehind: (buffered) => {
          _bpLog('behind', buffered);
          floodGate?.reset();
        },
        onResume: (buffered) => {
          _bpLog('resume', buffered);
          floodGate?.reset();
          sendResync(buffered);
        },
        onTimeout: (buffered) => {
          _bpLog('timeout', buffered);
          try { ws.terminate(); } catch {}
        },
      });

      // 洪泛限流器：字节率超阈值时按窗口合并 + last-wins 截断（ConPTY 全屏重绘洪泛防卡死，
      // 与 bpGate 互补——bpGate 管慢网络写缓冲，floodGate 管快 LAN 字节率，详见 lib/pty-flood-coalescer.js）
      const _floodLog = makeFloodLogger('terminal-ws', ws);
      const _countMsg = makeMsgRateCounter(_floodLog);
      floodGate = createFloodCoalescer({
        send: (data) => {
          if (ws.readyState === 1 && bpGate.offer()) {
            // send 抛错 = 该条数据永久丢失（流中间挖洞且无路径补发）→ 立即快照对齐兜底
            try { ws.send(JSON.stringify({ type: 'data', data })); } catch { sendResync(); return; }
            _countMsg();
          }
        },
        findSafeSliceStart,
        onFloodStart: (bytes) => _floodLog('start', bytes),
        onFloodEnd: () => _floodLog('end', 0),
        // 洪泛期丢过中段：安全切片只保证残片不上屏，被截掉的内容对增量 TUI 流
        // （macOS/Linux forkpty）不会自愈——回落直通后用权威快照对齐一次
        onTruncate: (dropped) => {
          _floodLog('truncate', dropped);
          floodGate.reset();
          sendResync();
        },
      });

      // PTY 输出 → WebSocket(合并 ws 后客户端自行按 msg.type 分发,server 端不再 role 过滤)
      const removeDataListener = onPtyData((data) => {
        _ptyDataSeen = true;
        floodGate.offer(data);
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
            // 元素必须全是字符串：非字符串 chunk 的 pty.write 在 setTimeout 上下文抛
            // ERR_INVALID_ARG_TYPE（脱离本 handler 的 try/catch）→ 进程崩溃。入口先拒绝。
            // 统一回 done（含拒绝路径 ok:false）：带 seq 的客户端在等这条，静默丢弃会让它
            // 挂到自身超时。复用同一发送逻辑，无效输入立即回 ok:false。
            const replyDone = (ok) => {
              try {
                const reply = { type: 'input-sequential-done', ok };
                if (seq !== undefined) reply.seq = seq;
                ws.send(JSON.stringify(reply));
              } catch (e) {
                console.warn('[server] input-sequential-done send failed:', e?.message || e);
              }
            };
            if (Array.isArray(chunks) && chunks.length > 0 && chunks.every(c => typeof c === 'string')) {
              writeToPtySequential(chunks, replyDone, { settleMs: msg.settleMs || 150 });
            } else {
              replyDone(false);
            }
          } else if (msg.type === 'resync-request') {
            // 客户端 write-queue 积压丢弃后请求快照对齐（utils/terminalWriteQueue.js onTrim）
            if (resyncReqGate.shouldNudge()) {
              floodGate.reset();
              sendResync();
            }
          } else if (msg.type === 'ask-hook-answer') {
            // Client answered AskUserQuestion via hook bridge.
            // New protocol: msg.id required to address one of multiple pending asks.
            // 老协议 fallback（取最老）已废弃 — 多 pending 时会"答错对象"造成串答；
            // 缺 id 直接 WARN 并丢弃，让前端在 console 里看到为什么答案没生效。
            let askAnswered = false;
            let alreadyAnswered = false; // first-write-wins 抢答失败信号
            let askId = msg.id;
            let askEntry = null;
            if (askId) {
              askEntry = pendingAskHooks.get(askId);
            } else {
              console.warn('[server] ask-hook-answer missing id — legacy fallback removed to prevent cross-question mis-routing; ignoring');
            }
            if (askEntry) {
              const { res: hookRes, timer } = askEntry;
              clearTimeout(timer);
              pendingAskHooks.delete(askId);
              // Phase 3: short-poll 模式不立即删 disk —— 落 answered 让 GET listener / disk consume 拿
              if (askEntry.shortPoll) {
                let wrote = false;
                try { wrote = await askStoreMarkAnswered(askId, msg.answers); } catch {}
                if (wrote) {
                  _notifyShortPollAnswer(askId, msg.answers);
                  askAnswered = true;
                } else {
                  // race 边角：进入 handler 时内存 entry 还在，但 disk 已被另一进程 / 之前的 cancel 写过终态。
                  // 不广播 answer，让发起方知道被抢答；hookRes 也按 cancelled 返回让 ask-bridge 走 deny 路径。
                  alreadyAnswered = true;
                  try {
                    if (!hookRes.headersSent) {
                      hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                      hookRes.end(JSON.stringify({ cancelled: true, reason: 'Already answered by another client' }));
                    }
                  } catch {}
                }
              } else {
                _persistAskDelete(askId);
                askAnswered = true;
              }
              if (askAnswered) {
                try {
                  if (!hookRes.headersSent) {
                    hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                    hookRes.end(JSON.stringify({ answers: msg.answers }));
                  }
                } catch {}
              }
            } else if (askId) {
              // server 重启 / 内存 entry 已被清，但 ask-bridge 可能仍在短轮询 disk —— 落 answered。
              // first-write-wins：如果 disk 已被其他 client 抢答（markAnswered 返 false），
              // 不唤醒 listener（让 listener 等到 GET hit disk 拿到真实抢答者答案）—— 自然 idempotent。
              // 给当前 ws 发 ack-already-answered 让前端关 modal、不误覆盖灰态。
              let wrote = false;
              try { wrote = await askStoreMarkAnswered(askId, msg.answers); } catch {}
              if (wrote) {
                _notifyShortPollAnswer(askId, msg.answers);
                askAnswered = true;
              } else {
                alreadyAnswered = true;
              }
            }
            // first-write-wins 抢答失败 → 仅 ack 发起方让其关 modal；不广播给其他 client 防覆盖真实 answer。
            if (alreadyAnswered && askId && ws && ws.readyState === 1) {
              try {
                ws.send(JSON.stringify({
                  type: 'ask-hook-already-answered',
                  id: askId,
                  reason: 'Another client answered first (first-write-wins)',
                }));
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
            // entry 不在（LRU evicted / 已答 / 跨 client race / 60min 超时）— 给发起方 ack
            // ask-hook-cancelled 让前端关 modal + _pendingFlushQueue 兜底处理（如有 user
            // message 等 ack 待 flush）。行为对齐 ask-cancel handler handled=false 分支语义。
            // 不广播给其他 client（与 ack-cancel handled=false 一致），防误覆盖真实 answer。
            if (!askAnswered && askId) {
              try {
                if (ws && ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    type: 'ask-hook-cancelled',
                    id: askId,
                    reason: 'Ask entry no longer exists (timeout / evicted / already resolved)',
                  }));
                }
              } catch {}
            }
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
          } else if (msg.type === 'ask-cancel') {
            // 用户主动取消 AskUserQuestion（或 ChatInputBar 提交新 prompt 时打断 pending ask）。
            // 双模式分流：先查 SDK _pendingApprovals → 再查 Hook pendingAskHooks → 都没有也广播 ack
            // (LRU evicted / plugin-already-resolved / WS 重发等场景兜底，让所有 client modal 同步关掉)。
            // cancelId/Reason 校验：与 toolUseId 同套白名单（≤256 字符 + [a-zA-Z0-9_-]）+ reason ≤500
            // 防恶意/buggy client 塞超长 key 撑大 _pendingApprovals 或塞 1MB reason 打爆 broadcast。
            const rawId = msg.id != null ? String(msg.id) : null;
            const cancelId = rawId && rawId.length > 0 && rawId.length <= 256 && /^[a-zA-Z0-9_-]+$/.test(rawId) ? rawId : null;
            if (rawId && !cancelId) {
              console.warn('[server] ask-cancel rejected: invalid id format');
              return;
            }
            const cancelReason = (typeof msg.reason === 'string' ? msg.reason : 'User aborted').slice(0, 500);
            let handled = false;
            // SDK 路径：调 cancelApproval 让 _waitForApproval resolve cancel sentinel
            // (sdk-manager.js canUseTool 检测 sentinel 后返回 { behavior: 'deny', message: cancelReason }
            //  → SDK 包内置 ensureToolResultPairing 兜住 transcript)
            if (cancelId && _sdkCancelApproval) {
              try { handled = _sdkCancelApproval(cancelId, cancelReason) === true; } catch {}
            }
            // Hook 路径：给对应 res 回 200 + { cancelled: true, reason }
            // ask-bridge.js 检测 cancelled 字段后输出 { hookSpecificOutput: { permissionDecision: 'deny', ... } }
            if (!handled && cancelId) {
              const askEntry = pendingAskHooks.get(cancelId);
              if (askEntry) {
                const { res: hookRes, timer } = askEntry;
                if (timer) clearTimeout(timer);
                pendingAskHooks.delete(cancelId);
                // Phase 3: short-poll 同样要让 disk + listener 知道，否则 ask-bridge 永远收不到 cancelled
                if (askEntry.shortPoll) {
                  try { await askStoreMarkCancelled(cancelId, cancelReason); } catch {}
                  _notifyShortPollCancel(cancelId, cancelReason);
                } else {
                  _persistAskDelete(cancelId);
                }
                handled = true;
                try {
                  if (hookRes && !hookRes.headersSent) {
                    hookRes.writeHead(200, { 'Content-Type': 'application/json' });
                    hookRes.end(JSON.stringify({ cancelled: true, reason: cancelReason }));
                  }
                } catch {}
              } else {
                // 内存无 entry，但 disk 可能有 pending（server 重启后 ask-bridge 重 POST 之前，
                // 浏览器从 /api/pending-asks 看到 disk-only ask 并 Cancel 它）。
                // first-wins：disk 已是终态（如另一 client 抢先 answer）时 markCancelled 返 false，
                // 不能唤醒 listener 用 cancel 覆盖真实 answer —— 让 listener 下次 GET consumeIfFinal
                // 拿到真实 disk 终态自然投递。
                const wrote = await askStoreMarkCancelled(cancelId, cancelReason);
                if (wrote) {
                  _notifyShortPollCancel(cancelId, cancelReason);
                  handled = true;
                } else if (ws && ws.readyState === 1) {
                  // 抢答失败 ack：只给发起方关 modal，不广播防覆盖其他 client 真实 answer。
                  try {
                    ws.send(JSON.stringify({
                      type: 'ask-hook-already-answered',
                      id: cancelId,
                      reason: 'Already resolved by another client',
                    }));
                  } catch {}
                }
              }
            }
            // ack 广播分两档：
            //   - handled=true（真的取消了 SDK 或 Hook entry）→ 广播给所有 client + 通知 parent
            //   - handled=false（LRU evicted / plugin 已答 / 重发等）→ 只 ack 给发起方，不广播
            //     原因：那些场景下其他 client 看到的是 answered 而非 cancelled，广播会让前端
            //     localAskAnswers 误覆盖真实 answer 涂成灰态。发起方自身已经乐观写过，此时
            //     server 的 ack 实际只起"sync 错过的 ack"作用。
            if (cancelId) {
              const cmsg = JSON.stringify({ type: 'ask-hook-cancelled', id: cancelId, reason: cancelReason });
              if (handled && terminalWss) {
                terminalWss.clients.forEach((c) => {
                  if (c.readyState === 1) try { c.send(cmsg); } catch {}
                });
                _notifyParentPending({ type: 'ask-hook-cancelled', id: cancelId });
              } else if (!handled && ws && ws.readyState === 1) {
                // 仅 ack 给发起方，让其前端 _waitingCancelAck flush user message
                try { ws.send(cmsg); } catch {}
              }
            }
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
          } else if (msg.type === 'sdk-interrupt') {
            // Stop button in SDK mode — interrupt current turn, keep session alive.
            // _executeQuery's finally emits streaming_status{active:false} to reconcile UI.
            if (isSdkMode && _sdkInterruptTurn) {
              const cancelled = _sdkInterruptTurn() || [];
              // Close any open approval modal on every client (the canUseTool promise was just
              // drained server-side; reuse each kind's existing resolve/cancel broadcast type).
              if (cancelled.length && terminalWss) {
                for (const { id, kind } of cancelled) {
                  if (!id) continue;
                  const type = sdkApprovalCloseType(kind);
                  const m = JSON.stringify({ type, id, reason: 'Turn interrupted' });
                  terminalWss.clients.forEach((c) => {
                    if (c.readyState === 1) { try { c.send(m); } catch {} }
                  });
                }
              }
            } else {
              // sdk-interrupt 收到却没生效：客户端按 props.sdkMode 发了中断，但本端不是 SDK 模式或
              // _sdkInterruptTurn 未由 cli.js 接线（client/server sdkMode 配置漂移）。此时客户端会乐观
              // 切非运行态并等 4s 兜底才翻回，输出仍在流 —— 打日志让这类错配可观测。
              console.warn('[SDK] sdk-interrupt ignored: isSdkMode=%s, handler=%s', isSdkMode, !!_sdkInterruptTurn);
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
              // Windows 无 SIGWINCH；ConPTY 在前面的 resizePty 调用里已经处理过 resize 通知，
              // _nudgeRedraw 仅是 POSIX 上的"等尺寸 noop 不发信号"兜底（内部跳过 win32）。
              _nudgeRedraw();
              // claude -c 加载期免疫 SIGWINCH → 零输出时延迟补发（见上方声明处注释）
              _armRedrawRetries();
            }
          }
        } catch {}
      });

      ws.on('close', () => {
        for (const t of _redrawRetryTimers) clearTimeout(t);
        bpGate.dispose();
        floodGate.dispose();
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

export function getInternalToken() {
  return INTERNAL_TOKEN;
}

// Effective password-auth config for this server's project (enabled + plaintext password).
// Used by cli.js to print the active password at CLI-mode startup (the non-CLI startup log
// can't run in CLI mode). Plaintext is fine: this stays in-process (admin terminal).
export function getAuthConfig() {
  return authConfig;
}

// Instance id (`--pid`) + the project's previously-used ids — printed by cli.js in the
// CLI-mode startup banner so the user can recall which id to reuse with `-c` next time.
export function getInstanceId() {
  return INSTANCE_ID;
}
export function getKnownInstances() {
  try { return listInstances(_logDir); } catch { return []; }
}

// In-process broadcast helper for the `turn_end` SSE event. Two callers:
//   1. /api/turn-end-notify POST handler (PTY/CLI mode via Stop hook bridge)
//   2. cli.js runSdkMode → sdkManager.initSdkSession({ onTurnEnd }) (SDK mode —
//      ensureHooks() isn't called so Stop hook isn't installed; emit the event
//      directly when SDK's 'result' message fires).
// Same SSE payload shape regardless of source so the frontend listener doesn't
// care which path produced it.
//
// SUNSET-MARKER: ccv-turn-end-debounce
// PATCH (2026-05-17): trailing debounce + cancel-on-new-request。
// Claude Code 官方 `Stop` 钩子是 query() 级而非 user-prompt 级（once per turn；
// 任何 user-role 注入都会让 query() 多走几轮 → Stop 多触发 → 响铃多次）。本层
// 是「用户视角任务边界」的近似——**这是补丁，不是终态**。等 Anthropic 出更准确
// 的 hook（如 Stop 输入带 `is_final_turn:true`、SDK `result` 带 `subtype:'final'`、
// 或 `onUserTurnEnd` 回调）就拆掉。拆除时一并 grep 上面 SUNSET-MARKER 标签
// 定位所有相关代码（server / voicePackPlayer / test / history.md）。
//
// **用户原始语义**：「等 10 秒钟。如果这 10 秒钟内没有新的请求发起，那么就认为
// 任务真的已经完成了，开始执行播放」—— 隐含：10s 内**有**新请求 → 不算完成 →
// **不**播放（取消）。
//
// 「新请求」定义：(a) 同 sessionId 又一次 POST → 同桶重排 timer
//                  (b) streamingState 从 inactive 转 active → **cancel 所有 pending**
//                      （Claude 又开始新一轮 query()，前一个不算「真任务结束」）
//
// ASSUMPTION: one streaming session per server process（Electron tab-worker
// 一进程一 server / CLI 单 PTY 天然成立）。未来若一个 server 进程支持 multi-PTY，
// 请把 `_lastCliActive`/`_lastSdkActive` 改成 per-sessionId Map，并把 cancel 改成
// 「只清匹配 key」。
//
// HISTORY: 早期版本在 `_scheduleTurnEndBroadcast` 入口对 `streamingState.active`
// 做一次同步 race-guard（active=true 直接丢弃 POST，无补播）。该 guard 与 Stop hook
// 真实时序冲突：Claude Code 在 query() 结束后还会有 housekeeping/telemetry 子请求
// 让 active 短暂 true，POST 落在该窗口里就会被静默吞。已移除，统一由 rising-edge
// cancel 兜底——POST 总是入桶排 timer，真有新一轮 query() 才在 rising-edge 时 cancel。
const _pendingTurnEndTimers = new Map(); // key: sessionId(string) | null → { timer, sessionId, ts }
// CCV_TURN_END_DEBOUNCE_MS 调整 trailing debounce 窗口。clamp 到 [100, 60_000] 防 footgun
// （0 会立刻 fire 等于禁用 debounce；2^31 内 Node setTimeout 有 clamp 行为）；
// 空串 / 非数 / 范围外都回 default + warn 一次。
const TURN_END_DEBOUNCE_MS = (() => {
  const raw = process.env.CCV_TURN_END_DEBOUNCE_MS;
  // IM worker 需要快速 turn_end 以驱动队列——默认 200ms（够 coalesce 重复 POST，不拖延回复）。
  const imDefault = process.env.CCV_IM_PLATFORM ? 200 : 10_000;
  if (raw === undefined || raw === '' || /^\s*$/.test(raw)) return imDefault;
  const n = Number(raw);
  if (!Number.isFinite(n)) { console.warn(`[turn-end] CCV_TURN_END_DEBOUNCE_MS=${raw} not finite, using ${imDefault}`); return imDefault; }
  if (n < 100 || n > 60_000) { console.warn(`[turn-end] CCV_TURN_END_DEBOUNCE_MS=${n} out of [100,60000], using ${imDefault}`); return imDefault; }
  return n;
})();
let _isStopping = false;
let _lastSdkActive = false;
let _lastCliActive = false;
let _onTurnEndBroadcastForTests = null;

function _normalizeKey(sessionId) {
  return (typeof sessionId === 'string' && sessionId) ? sessionId : null;
}

function _emitTurnEnd(sessionId, ts, transcriptPath = null) {
  const sid = _normalizeKey(sessionId);
  const t = ts || Date.now();
  try {
    if (clients.length > 0 && sendEventToClients) {
      sendEventToClients(clients, 'turn_end', { sessionId: sid, ts: t });
    }
    // Forward the (clean) assistant reply for this turn to whichever IM bridge owns the in-flight
    // turn, if any. Fire-and-forget: a bridge failure must never affect SSE broadcast.
    try { imCore.notifyTurnEnd(sid, t, transcriptPath); } catch { /* best-effort */ }
    if (typeof _onTurnEndBroadcastForTests === 'function') {
      try { _onTurnEndBroadcastForTests({ sessionId: sid, ts: t }); }
      catch (e) { if (process.env.NODE_ENV === 'test') throw e; /* prod 不让测试桩污染 */ }
    }
  } catch (err) {
    console.warn(`[turn-end] broadcast failed sid=${sid}:`, err && err.message);
  }
}

function _scheduleTurnEndBroadcast(sessionId, ts, transcriptPath = null) {
  if (_isStopping) return;
  const sid = _normalizeKey(sessionId);
  const t = ts || Date.now();
  // 注意：这里不再对 streamingState.active 做同步 race-guard。理由见上方 HISTORY 段。
  // POST 一律入桶排 timer；真正「新一轮 query()」走 _observeStreamingTick 的 rising-edge
  // cancel 兜底，不会让无效尾音播出来。
  const existing = _pendingTurnEndTimers.get(sid);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    _pendingTurnEndTimers.delete(sid);
    _emitTurnEnd(sid, t, transcriptPath);
  }, TURN_END_DEBOUNCE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  _pendingTurnEndTimers.set(sid, { timer, ts: t });
}

// 直接丢弃所有 pending —— 用于两条路径：(1) `_doStop` shutdown，(2) rising-edge 新请求
// 进入（按用户原始语义不算「真任务结束」，不播放）。
function _cancelAllPendingTurnEndBroadcasts() {
  if (_pendingTurnEndTimers.size === 0) return;
  for (const { timer } of _pendingTurnEndTimers.values()) clearTimeout(timer);
  _pendingTurnEndTimers.clear();
}

function _onStreamingActivated() {
  // rising-edge：Claude 又开始新一轮 query()，按用户原始语义「10s 内有新请求 → 不算完成 →
  // 不播放」，直接 cancel 所有 pending（**不** flush）。这正是用户键入「请等待 10 秒钟」
  // 的本意：被打断就当没完成。
  _cancelAllPendingTurnEndBroadcasts();
}

// 统一的 streaming-state 观察入口。production polling 和 SDK push 都调它，测试也走它，
// 不再为「测试桩」单独维护 mirror state（杜绝逻辑漂移）。返回是否检测到 rising edge。
// `_isStopping` 时直接返回 false：shutdown 中迟到的 tick 不应再去 flush。
function _observeStreamingTick(activeNow, mode /* 'cli' | 'sdk' */) {
  if (_isStopping) return false;
  const isActive = !!activeNow;
  const wasActive = mode === 'sdk' ? _lastSdkActive : _lastCliActive;
  if (mode === 'sdk') _lastSdkActive = isActive; else _lastCliActive = isActive;
  if (isActive && !wasActive) {
    _onStreamingActivated();
    return true;
  }
  return false;
}

/**
 * Test-only hooks. **External code MUST NOT import this.** 见 SUNSET-MARKER 注释。
 * 运行时通过 `NODE_ENV === 'test'` 守卫：非 test 环境下所有方法都是 frozen no-op，
 * 不让生产 import 误用扰乱 turnEnd 行为。
 * @private
 */
export const __testing = (process.env.NODE_ENV === 'test') ? {
  reset() {
    _cancelAllPendingTurnEndBroadcasts();
    _isStopping = false;
    _lastSdkActive = false;
    _lastCliActive = false;
    _stoppingPromise = null;
    _onTurnEndBroadcastForTests = null;
  },
  onBroadcast(fn) { _onTurnEndBroadcastForTests = fn; },
  getPendingKeys() { return [..._pendingTurnEndTimers.keys()]; },
  setIsStopping(v) { _isStopping = !!v; },
  observeStreamingTick(activeNow, mode = 'cli') { return _observeStreamingTick(activeNow, mode); },
  scheduleTurnEnd(sessionId, ts) { _scheduleTurnEndBroadcast(sessionId, ts); },
  getDebounceMs() { return TURN_END_DEBOUNCE_MS; },
} : Object.freeze({
  reset() {},
  onBroadcast() {},
  getPendingKeys() { return []; },
  setIsStopping() {},
  observeStreamingTick() { return false; },
  scheduleTurnEnd() {},
  getDebounceMs() { return TURN_END_DEBOUNCE_MS; },
});

/**
 * Schedule a debounced turn_end SSE broadcast. **Returns immediately**; actual SSE write
 * happens up to TURN_END_DEBOUNCE_MS later (default 10s; clamped [100,60000]).
 * 详细语义见 SUNSET-MARKER patch-note。
 */
export function broadcastTurnEnd(sessionId = null, ts = Date.now()) {
  _scheduleTurnEndBroadcast(sessionId, ts);
}

// 流式状态 SSE 推送定时器：检测 streamingState 变化并广播给所有客户端。
// rising-edge → turn_end cancel（丢弃 pending，不 flush）由 _observeStreamingTick 统一处理。
let _streamingStatusTimer = null;
// Waiter-liveness reaper timers (armed in startServer, cleared in the stop path).
let _askReaperTimer = null;
let _askOrphanSweepTimer = null;
// 启动后 30s 的更新检查 timer 句柄。必须可清理:
//  - .unref() 防止它把事件循环 keep-alive 30s(测试进程靠 --test-force-exit 兜底是时序侥幸);
//  - _doStop 里 clearTimeout 防止 stop/start 循环(Electron tab / 测试)泄漏多个 pending 检查。
let _updateCheckTimer = null;
function startStreamingStatusTimer() {
  if (_streamingStatusTimer) return;
  _streamingStatusTimer = setInterval(() => {
    // SDK mode uses its own streaming state (pushed directly via setSdkStreamingState)
    if (isSdkMode) return;
    const isActive = streamingState.active;
    const wasActive = _lastCliActive;
    // 统一走 _observeStreamingTick：内部负责 rising-edge cancel（丢弃 pending turn_end，不 flush）+ 更新 _lastCliActive。
    _observeStreamingTick(isActive, 'cli');
    const changed = wasActive !== isActive;
    if (changed || isActive) {
      const data = isActive
        ? { ...streamingState, elapsed: Date.now() - streamingState.startTime }
        : { active: false };
      if (clients.length > 0 && sendEventToClients) sendEventToClients(clients, 'streaming_status', data);
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
  // _isStopping 设 true 后：①新 schedule 全部入口短路（_scheduleTurnEndBroadcast 入口检查）
  // ②迟到的 streaming tick 也短路（_observeStreamingTick 入口检查）
  // → 后续 await 期间 turn-end 状态机彻底冻结，无并发改 Map 的可能。
  _isStopping = true;
  _cancelAllPendingTurnEndBroadcasts();
  // 对称 startViewer：下一次启动后第一次 active 才算 rising edge
  _lastSdkActive = false;
  _lastCliActive = false;
  // Tear down all IM bridge connections so a stop/start cycle (Electron tab switch, tests) never
  // leaks a second WS to the same app. Idempotent + swallows errors.
  // IM teardown + serverStopping hook 共用一个 3s 总预算（保持串行语义）：
  // Windows 上 IM bridge WS teardown 挂住会卡死整条退出链（原本裸 await 是
  // "Ctrl+C 完全无反应"的 B 类成因）；两段若各自 3s race 串行最坏 6s，会越过
  // cleanup watchdog(5s) 截断其后的 temp jsonl rename（用户数据）——合并为单预算
  // 保证 teardown ≤3s，watchdog 前始终留出 rename 余量。超时后控制流顺序继续。
  try {
    await Promise.race([
      (async () => {
        try { await imCore.stopAll(); } catch { }
        await runParallelHook('serverStopping');
      })(),
      new Promise(r => setTimeout(r, 3000)),
    ]);
  } catch { }
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
  unwatchAll();
  unwatchAllWorkflows();
  unwatchFile(CONTEXT_WINDOW_FILE);
  clients.forEach(client => client.end());
  // Truncate in place (not `clients = []`) so the array reference stays stable across
  // stop/start cycles — deps.clients and _logWatcherOpts() hold this same reference.
  clients.length = 0;
  if (server) {
    // 销毁所有活跃连接，防止 keep-alive 阻止进程退出
    server.closeAllConnections();
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
  if (_askReaperTimer) {
    clearInterval(_askReaperTimer);
    _askReaperTimer = null;
  }
  if (_askOrphanSweepTimer) {
    clearTimeout(_askOrphanSweepTimer);
    _askOrphanSweepTimer = null;
  }
  if (_updateCheckTimer) {
    clearTimeout(_updateCheckTimer);
    _updateCheckTimer = null;
  }
  resetStreamingState();
  // 清 interceptor 的 live-port，避免 stop/start 循环（Electron tab 切换 / 测试）间隙内
  // 早期请求向已关闭的端口 POST 丢包。新 startViewer 的 listen 回调会再次 setLivePort
  setLivePort(null);
  try { unwatchFile(PROFILE_PATH); } catch {} // 清理 interceptor 的 StatWatcher
  try { unwatchFile(RETRY_CONFIG_PATH); } catch {} // 清理 retry-config 的 StatWatcher
}

// ─── SDK Mode Exports ──────────────────────────────────────────

/** Push a JSONL entry to all SSE clients (for SDK mode). */
export function pushSdkEntry(entry) {
  if (sendToClients) sendToClients(clients, entry);
}

/**
 * Update streaming status (SDK mode). 调用约定：SDK 每个 chunk 都调一次 `{active:true,...}`，
 * turn 结束才调 `{active:false}`。rising-edge 检测统一走 `_observeStreamingTick`。
 * **SSE 推送只在 transition（edge）或仍 active 时发**，避免每 chunk 都放大 streaming_status 流量
 * （对齐 CLI polling 的 `changed || isActive` 闸门）。
 * `undefined`/`{}`/`null` 都会被当作 active=false。
 */
export function setSdkStreamingState(data) {
  const isActive = !!(data && data.active);
  const wasActive = _lastSdkActive;
  _observeStreamingTick(isActive, 'sdk');
  const changed = wasActive !== isActive;
  if (changed || isActive) {
    if (clients.length > 0 && sendEventToClients) {
      sendEventToClients(clients, 'streaming_status', data);
    }
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
          || msg.type === 'ask-hook-pending' || msg.type === 'ask-hook-resolved' || msg.type === 'ask-hook-timeout'
          || msg.type === 'ask-hook-cancelled')) {
    _notifyParentPending(msg);
  }
}

/** Reference to sdk-manager's resolveApproval (set by cli.js after import). */
let _sdkResolveApproval = null;
export function setSdkResolveApproval(fn) { _sdkResolveApproval = fn; }

/** Reference to sdk-manager's cancelApproval (set by cli.js after import). */
// 与 _sdkResolveApproval 平行——但语义不同：cancelApproval 让 _waitForApproval resolve
// 一个 cancel sentinel，让 canUseTool 走 deny 分支（而非 allow）。
let _sdkCancelApproval = null;
export function setSdkCancelApproval(fn) { _sdkCancelApproval = fn; }

/** Reference to sdk-manager's sendUserMessage (set by cli.js after import). */
let _sdkSendUserMessage = null;
export function setSdkSendUserMessage(fn) { _sdkSendUserMessage = fn; }

/** Reference to sdk-manager's interruptTurn (set by cli.js after import). */
let _sdkInterruptTurn = null;
export function setSdkInterruptTurn(fn) { _sdkInterruptTurn = fn; }

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
      // 句柄必须保存:_doStop 要 clearTimeout(stop/start 循环防泄漏);.unref() 防 keep-alive。
      // 测试侧三重防护:此处 unref + updater.js 的 L5 铁闸 + npm test 脚本 DISABLE_NONESSENTIAL_TRAFFIC。
      _updateCheckTimer = setTimeout(async () => {
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
            // 先缓存：之后新连接的 SSE 客户端会在 events 路由里补推此事件
            pendingMajorUpdate = { version: result.remoteVersion, source: result.status };
            const payload = JSON.stringify(pendingMajorUpdate);
            clients.forEach(client => {
              try { client.write(`event: update_major_available\ndata: ${payload}\n\n`); } catch { }
            });
          } else if (result.status === 'upgrading_in_background') {
            console.error(`[CC Viewer] background upgrade to ${result.remoteVersion} started (active after next launch)`);
          }
        } catch { /* update check 失败静默 */ }
      }, 30_000);
      _updateCheckTimer.unref();
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
// 防御性单次注册：ESM cache 已保证模块顶层只执行一次，但若未来重构把这段
// 移入函数（cleanupViewer 等）或用 dev hot-reload，缺守卫会导致 handler 堆积
// → 进程退出时多次调用 stopViewer。globalThis flag 兼容所有 import 路径。
if (!globalThis._ccvServerSignalsRegistered) {
  globalThis._ccvServerSignalsRegistered = true;
  process.on('exit', handleExit);
  // hardened：watchdog 5s 强退 + 重复触发立退（防 Windows 上 stopViewer 内部
  // await 挂住导致 .finally(exit) 永不执行 = Ctrl+C 完全无反应）。
  const _hardenedStop = createHardenedCleanup({ doCleanup: () => stopViewer() });
  process.on('SIGINT', _hardenedStop);
  process.on('SIGTERM', _hardenedStop);
}
