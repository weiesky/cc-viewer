// LLM Request Interceptor
// 拦截并记录所有Claude API请求

// 非交互命令（如 claude -v, claude --help）不需要启动 ccv
const _ccvSkipArgs = ['--version', '-v', '--v', '--help', '-h', 'doctor', 'install', 'update', 'upgrade', 'auth', 'setup-token', 'agents', 'plugin', 'plugins', 'mcp'];
const _ccvSkip = _ccvSkipArgs.includes(process.argv[2]);

import './lib/proxy-env.js';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync, existsSync, watchFile } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { LOG_DIR } from './findcc.js';
import { assembleStreamMessage, createStreamAssembler, cleanupTempFiles, findRecentLog, isAnthropicApiPath, isMainAgentRequest, rotateLogFile } from './lib/interceptor-core.js';



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Live-streaming 用的端口：由 server.js 在 listen 成功后通过 setLivePort 注入。
// 不用 process.env.CCVIEWER_PORT 是为了避免主进程 env 污染被 child_process.spawn
// 继承到 Bash 工具子进程 / MCP server / Electron tab-worker 等无关进程。
let _livePort = null;
export function setLivePort(port) { _livePort = port ? String(port) : null; }

// 流式请求的实时状态（供 server.js SSE 推送）
export const streamingState = { active: false, requestId: null, startTime: null, model: null, bytesReceived: 0, chunksReceived: 0 };
export function resetStreamingState() {
  streamingState.active = false;
  streamingState.requestId = null;
  streamingState.startTime = null;
  streamingState.model = null;
  streamingState.bytesReceived = 0;
  streamingState.chunksReceived = 0;
}

// 缓存从请求 headers 中提取的 API Key 或 Authorization header
export let _cachedApiKey = null;
export let _cachedAuthHeader = null;
// 缓存从请求 body 中提取的模型名，供翻译接口使用
export let _cachedModel = null;
// 缓存 haiku 模型名（从实际请求中捕获），翻译接口优先使用
export let _cachedHaikuModel = null;

// Proxy profile hot-switch support
// 数据模型：
//   profile.json (全局共享): 仅存 profiles 列表，watchFile 跨 ccv 进程同步 CRUD。
//     兼容老数据：若文件里仍有 active 字段，读为"全局回退默认"；但本模块不再写它。
//   <projectDir>/active-profile.json (每 workspace 独占): 仅存 { activeId }；
//     切换 active 只影响当前 ccv 进程的 workspace，不污染其他实例。
// profile.json 存放在 LOG_DIR 下，受 --log-dir / CCV_LOG_DIR 影响
const PROFILE_PATH = join(LOG_DIR, 'profile.json');
let _activeProfile = null; // { id, name, baseURL?, apiKey?, models?, activeModel? }

// 启动时捕获的原始配置（首次 API 请求时记录，不可变）
let _defaultConfig = null; // { origin, authType, model }

function _getActiveProfileFilePath() {
  // _projectName/_logDir 声明在 ~line 218；本函数只会在这些变量初始化后被调用
  // （_loadProxyProfile 的初始调用被挪到 line ~237 之后；watchFile 回调、HTTP handler 也都在之后）
  if (!_projectName || !_logDir) return null;
  return join(_logDir, 'active-profile.json');
}

function _readWorkspaceActiveId() {
  const p = _getActiveProfileFilePath();
  if (!p) return null;
  try {
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      return typeof data?.activeId === 'string' ? data.activeId : null;
    }
  } catch { }
  return null;
}

function _writeWorkspaceActiveId(activeId) {
  const p = _getActiveProfileFilePath();
  if (!p) {
    // 诊断用：能把"为什么 workspace 路径不可用"暴露到启动 ccv 的终端
    console.error('[ccv proxy-profile] skip workspace write: ' +
      `_projectName="${_projectName}" _logDir="${_logDir}" (both required)`);
    return false;
  }
  try {
    mkdirSync(dirname(p), { recursive: true });
    const payload = { activeId: (activeId && typeof activeId === 'string') ? activeId : 'max' };
    writeFileSync(p, JSON.stringify(payload, null, 2), { mode: 0o600 });
    return true;
  } catch (err) {
    console.error('[ccv proxy-profile] workspace write failed:', p, err && err.message);
    return false;
  }
}

function _loadProxyProfile() {
  try {
    const data = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    // active 解析优先级：workspace override > profile.json.active (兼容老数据 / 全局回退) > null
    const wsActive = _readWorkspaceActiveId();
    const activeId = wsActive || data.active;
    const active = data.profiles?.find(p => p.id === activeId);
    _activeProfile = (active && active.id !== 'max') ? active : null;
  } catch (err) {
    _activeProfile = null;
    if (process.env.CCV_DEBUG_HOTSWITCH) {
      console.error('[ccv hotswitch] _loadProxyProfile failed:', err && err.message);
    }
  }
}

// 为 server.js::POST /api/proxy-profiles 使用，切换当前 workspace 的 active。
// 同时写两个位置，彼此互为兜底：
//   (1) <logDir>/active-profile.json    —— 每 workspace 独占，读取优先级最高
//   (2) profile.json.active             —— 全局默认，watchFile 跨实例同步；用作
//       UI 在 workspace 文件读失败 / 不存在时的回落，避免"切换后立刻回切"的幽灵 revert
// 回落一致性：其他 ccv 实例如果自己 workspace 文件已存在，_loadProxyProfile 会优先用自己
// 的，不受这里改动影响；只有"从未切过"的实例会跟随最新全局默认（符合直觉）。
// 返回 { workspace: bool, profile: bool } 指示两条路径的落盘结果。
function setActiveProfileForWorkspace(activeId) {
  const normalizedId = (activeId && typeof activeId === 'string') ? activeId : 'max';
  const result = { workspace: false, profile: false };

  // (1) workspace override
  result.workspace = _writeWorkspaceActiveId(normalizedId);

  // (2) profile.json.active —— 幂等更新，老数据兼容 + UI GET 回落兜底
  try {
    const data = existsSync(PROFILE_PATH)
      ? JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'))
      : { profiles: [{ id: 'max', name: 'Default' }] };
    if (data.active !== normalizedId) {
      data.active = normalizedId;
      mkdirSync(dirname(PROFILE_PATH), { recursive: true });
      writeFileSync(PROFILE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
    }
    result.profile = true;
  } catch { /* 双失败场景下 result 全 false，由调用方自行兜底 */ }

  _loadProxyProfile(); // 立刻刷新本进程 _activeProfile
  return result;
}

function getActiveProfileId() {
  // UI 需要知道当前 workspace 的 active（优先 workspace 文件，回退 profile.json.active）
  const ws = _readWorkspaceActiveId();
  if (ws) return ws;
  try {
    const data = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    return data.active || 'max';
  } catch { return 'max'; }
}

// _loadProxyProfile 的初始调用 + watchFile 挂载挪到 _projectName/_logDir 初始化之后
// （见 "初始化日志文件路径" 段后的 _kickoffProxyProfileWatcher 调用），避免 TDZ。

// 纯函数：把 headers 里任意大小写的 authorization / x-api-key 替换为 profile 的 apiKey；
// 两者都不存在时强制植入 x-api-key（第三方代理最常见的鉴权形式）。
// 返回 { headers, matchedAuthKey, matchedXApiKey }，诊断日志据此判断是否真正写入。
function _replaceProxyAuthHeaders(headers, apiKey) {
  const newHeaders = { ...headers };
  let matchedAuthKey = null, matchedXApiKey = null;
  for (const k of Object.keys(newHeaders)) {
    const lk = k.toLowerCase();
    if (lk === 'authorization') matchedAuthKey = k;
    else if (lk === 'x-api-key') matchedXApiKey = k;
  }
  if (matchedAuthKey) newHeaders[matchedAuthKey] = `Bearer ${apiKey}`;
  if (matchedXApiKey) newHeaders[matchedXApiKey] = apiKey;
  if (!matchedAuthKey && !matchedXApiKey) newHeaders['x-api-key'] = apiKey;
  return { headers: newHeaders, matchedAuthKey, matchedXApiKey };
}

export { _activeProfile, _defaultConfig, _loadProxyProfile, PROFILE_PATH, setActiveProfileForWorkspace, getActiveProfileId };

// 生成新的日志文件路径
function generateNewLogFilePath() {
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');
  let cwd;
  try { cwd = process.cwd(); } catch { cwd = homedir(); }
  const projectName = basename(cwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch { }
  return { filePath: join(dir, `${projectName}_${ts}.jsonl`), dir, projectName };
}

// Resume 状态（供 server.js 使用）
let _resumeState = null;
let _resolveChoice = null;
const _choicePromise = new Promise(resolve => { _resolveChoice = resolve; });

function resolveResumeChoice(choice) {
  if (!_resumeState) return;
  const { recentFile, tempFile } = _resumeState;
  try {
    if (choice === 'continue') {
      // 将临时文件内容追加到旧日志
      if (existsSync(tempFile)) {
        const tempContent = readFileSync(tempFile, 'utf-8');
        if (tempContent.trim()) {
          appendFileSync(recentFile, tempContent);
        }
        unlinkSync(tempFile);
      }
      LOG_FILE = recentFile;
    } else {
      // new: 将临时文件 rename 为正式新日志文件名（空文件直接删除）
      const newPath = tempFile.replace('_temp.jsonl', '.jsonl');
      if (existsSync(tempFile)) {
        const sz = statSync(tempFile).size;
        if (sz > 0) {
          renameSync(tempFile, newPath);
        } else {
          try { unlinkSync(tempFile); } catch { }
        }
      }
      LOG_FILE = newPath;
    }
  } catch (err) {
    console.error('[CC Viewer] resolveResumeChoice error:', err);
  }
  const result = { logFile: LOG_FILE };
  _resumeState = null;
  _resolveChoice(result);
  return result;
}

// Delta storage: 增量存储开关和状态（默认开启，设置 CCV_DISABLE_DELTA=1 关闭）
// 注意：delta 计算依赖 mainAgent 请求串行（Claude CLI 保证），不做并发互斥
const _deltaStorageEnabled = process.env.CCV_DISABLE_DELTA !== '1';
let _lastMessagesCount = 0;     // 上一次 mainAgent 写入的完整 messages 数量
let _mainAgentDeltaCount = 0;   // mainAgent 请求计数器（用于触发定期 checkpoint）
const CHECKPOINT_INTERVAL = 10; // 每 N 条 mainAgent 请求写一个 checkpoint

/** Delta storage: completed 写入成功后更新状态 */
function _commitDeltaState(originalLength) {
  if (_deltaStorageEnabled && originalLength > 0) {
    _lastMessagesCount = originalLength;
  }
}

// Teammate 子进程检测：--parent-session-id（旧模式）或 --agent-name（原生 team 模式）
const _isTeammate = process.argv.includes('--parent-session-id') || process.argv.includes('--agent-name');
// 提取 teammate 元数据（--agent-name worker-1 --team-name fix-ts-errors）
let _teammateName = null;
let _teamName = null;
{
  const args = process.argv;
  const nameIdx = args.indexOf('--agent-name');
  if (nameIdx !== -1 && nameIdx + 1 < args.length) _teammateName = args[nameIdx + 1];
  const teamIdx = args.indexOf('--team-name');
  if (teamIdx !== -1 && teamIdx + 1 < args.length) _teamName = args[teamIdx + 1];
}

// 初始化日志文件路径（异步，支持用户交互）
// 工作区模式下延迟到选择工作区后再初始化
let _newLogFile, _logDir, _projectName;
if (process.env.CCV_WORKSPACE_MODE === '1') {
  _newLogFile = '';
  _logDir = '';
  _projectName = '';
} else if (_isTeammate) {
  // Teammate 子进程：只需 projectName 和 logDir 来查找 leader 日志，不生成新文件路径
  let cwd;
  try { cwd = process.cwd(); } catch { cwd = homedir(); }
  _projectName = basename(cwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  _logDir = join(LOG_DIR, _projectName);
  const _leaderLog = findRecentLog(_logDir, _projectName);
  _newLogFile = _leaderLog || ''; // 没有 leader 日志时不写入
} else {
  ({ filePath: _newLogFile, dir: _logDir, projectName: _projectName } = generateNewLogFilePath());
  // 启动时清理残留临时文件
  cleanupTempFiles(_logDir, _projectName);
}
let LOG_FILE = _newLogFile;

// 现在 _projectName/_logDir 已初始化，可以安全加载 proxy profile（含 workspace override）
// 并挂载 watchFile 同步列表变化。
_loadProxyProfile();
try { watchFile(PROFILE_PATH, { interval: 1500 }, _loadProxyProfile); } catch { }

const _initPromise = (async () => {
  if (!_logDir || !_projectName) return; // 工作区模式下跳过
  if (_isTeammate) return; // Teammate 已在上方同步初始化，跳过 async resume 流程
  try {
    const recentLog = findRecentLog(_logDir, _projectName);
    if (recentLog) {
      // Leader / 普通进程：走 resume 交互流程
      const tempFile = _newLogFile.replace('.jsonl', '_temp.jsonl');
      LOG_FILE = tempFile;
      _resumeState = {
        recentFile: recentLog,
        recentFileName: basename(recentLog),
        tempFile,
      };
    }
  } catch { }
})();

export { LOG_FILE, _initPromise, _resumeState, _choicePromise, resolveResumeChoice, _projectName, _logDir };

// 工作区模式：动态初始化指定路径的日志文件
// 如果有 1 小时内的最近日志，自动复用（与单目录模式行为一致）
export function initForWorkspace(projectPath, { forceNew = false } = {}) {
  const projectName = basename(projectPath).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch {}

  cleanupTempFiles(dir, projectName);

  // 检查是否有最近的日志文件可以复用（始终复用最新日志）
  // forceNew: Electron multi-tab 模式下强制创建新文件，避免与已有 ccv 实例共享日志
  const recentLog = !forceNew && findRecentLog(dir, projectName);
  if (recentLog) {
    _projectName = projectName;
    _logDir = dir;
    LOG_FILE = recentLog;
    // workspace 切换后，重读该 workspace 的 active-profile.json（可能和上一个 workspace 不同）
    _loadProxyProfile();
    return { filePath: recentLog, dir, projectName, resumed: true };
  }

  // 没有最近日志，创建新文件
  const now = new Date();
  const ts = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')
    + '_'
    + String(now.getHours()).padStart(2, '0')
    + String(now.getMinutes()).padStart(2, '0')
    + String(now.getSeconds()).padStart(2, '0');

  const filePath = join(dir, `${projectName}_${ts}.jsonl`);

  _projectName = projectName;
  _logDir = dir;
  LOG_FILE = filePath;
  _loadProxyProfile(); // 同上

  return { filePath, dir, projectName, resumed: false };
}

// 工作区模式：重置日志状态（返回工作区列表时调用）
export function resetWorkspace() {
  _projectName = '';
  _logDir = '';
  LOG_FILE = '';
  _loadProxyProfile(); // workspace 上下文消失，回落到 profile.json.active
}

const MAX_LOG_SIZE = 300 * 1024 * 1024; // 300MB

function checkAndRotateLogFile() {
  // Teammate 不做日志轮转，由 leader 负责
  if (_isTeammate) return;
  try {
    if (!existsSync(LOG_FILE) || statSync(LOG_FILE).size < MAX_LOG_SIZE) return;
  } catch { return; }
  const { filePath } = generateNewLogFilePath();
  const result = rotateLogFile(LOG_FILE, filePath, MAX_LOG_SIZE);
  if (result.rotated) {
    LOG_FILE = result.newFile;
    // 重置 delta 状态，强制下一条 mainAgent 请求写完整 checkpoint
    if (_deltaStorageEnabled) {
      _lastMessagesCount = 0;
      _mainAgentDeltaCount = 0;
    }
  }
}

// 从环境变量 ANTHROPIC_BASE_URL 提取域名用于请求匹配
function getBaseUrlHost() {
  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    if (baseUrl) {
      return new URL(baseUrl).hostname;
    }
  } catch { }
  return null;
}
const CUSTOM_API_HOST = getBaseUrlHost();

// 保存 viewer 模块引用
let viewerModule = null;

/**
 * Fire-and-forget POST a streaming chunk to cc-viewer server.
 * Non-blocking: returns immediately, errors silently ignored.
 * Only active when _livePort has been set (via setLivePort, by server.js).
 * @param {function(boolean)} [onDone] - optional callback: true=success, false=413 (payload too large)
 */
export function sendStreamChunk(entry, chunkSeq, onDone) {
  const port = _livePort;
  if (!port) return;
  try {
    const payload = JSON.stringify({ ...entry, _chunkSeq: chunkSeq });
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(port),
      path: '/api/stream-chunk',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-cc-viewer-internal': '1',
      },
      timeout: 500,
    }, (res) => {
      // 413 = payload too large → notify caller to stop sending further chunks
      if (onDone) onDone(res.statusCode !== 413);
      res.resume(); // drain
    });
    req.on('error', () => { if (onDone) onDone(true); });  // network error: keep trying
    req.on('timeout', () => { try { req.destroy(); } catch {} if (onDone) onDone(true); });
    req.write(payload);
    req.end();
  } catch { if (onDone) onDone(true); }
}

export function setupInterceptor() {
  // 避免重复拦截
  if (globalThis._ccViewerInterceptorInstalled) {
    return;
  }
  globalThis._ccViewerInterceptorInstalled = true;

  // 启动 viewer 服务（优先根目录 server.js，fallback 到 lib/server.js）
  // Teammate 子进程跳过，避免端口冲突（leader 已启动 viewer）
  if (!_isTeammate) {
    // Windows 下 import(绝对路径) 会被拒 (ERR_UNSUPPORTED_ESM_URL_SCHEME)；统一走 pathToFileURL。
    const rootServerPath = join(__dirname, 'server.js');
    const libServerPath = join(__dirname, 'lib', 'server.js');
    import(pathToFileURL(rootServerPath).href).then(module => {
      viewerModule = module;
    }).catch(() => {
      import(pathToFileURL(libServerPath).href).then(module => {
        viewerModule = module;
      }).catch(() => {
        // Silently fail if viewer service cannot start
      });
    });
  }

  // 注册退出处理器
  const cleanupViewer = async () => {
    if (viewerModule && typeof viewerModule.stopViewer === 'function') {
      try {
        await viewerModule.stopViewer();
      } catch (err) {
        // Silently fail
      }
    }
  };

  process.on('SIGINT', () => {
    cleanupViewer().finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    cleanupViewer().finally(() => process.exit(0));
  });

  process.on('beforeExit', () => {
    cleanupViewer();
  });

  const _originalFetch = globalThis.fetch;

  globalThis.fetch = async function (url, options) {
    // cc-viewer 内部请求（翻译等）直接透传，不拦截
    const internalHeader = options?.headers?.['x-cc-viewer-internal']
      || (options?.headers instanceof Headers && options.headers.get('x-cc-viewer-internal'));
    if (internalHeader) {
      return _originalFetch.apply(this, arguments);
    }

    const startTime = Date.now();
    let requestEntry = null;

    try {
      const urlStr = typeof url === 'string' ? url : url?.url || String(url);
      // 检查 headers 中是否包含 x-cc-viewer-trace 标记
      const headers = options?.headers || {};
      const isProxyTrace = headers['x-cc-viewer-trace'] === 'true' || headers['x-cc-viewer-trace'] === true;

      // 如果是 proxy 转发的，或者符合 URL 规则
      if (isProxyTrace || urlStr.includes('anthropic') || urlStr.includes('claude') || (CUSTOM_API_HOST && urlStr.includes(CUSTOM_API_HOST)) || isAnthropicApiPath(urlStr)) {
        // 如果是 proxy 转发的，需要清理掉标记 header 避免发给上游
        if (isProxyTrace && options?.headers) {
          delete options.headers['x-cc-viewer-trace'];
        }

        const timestamp = new Date().toISOString();
        let body = null;
        if (options?.body) {
          try {
            body = JSON.parse(options.body);
          } catch {
            body = String(options.body).slice(0, 500);
          }
        }

        // 转换 headers 为普通对象（支持 Request 对象、options.headers、Headers 实例）
        let headers = {};
        const rawHeaders = options?.headers || (url instanceof Request ? url.headers : null);
        if (rawHeaders) {
          if (rawHeaders instanceof Headers) {
            headers = Object.fromEntries(rawHeaders.entries());
          } else if (typeof rawHeaders === 'object') {
            headers = { ...rawHeaders };
          }
        }

        // 缓存 API Key / Authorization 供翻译接口使用（缓存原始值）
        if (headers['x-api-key'] && !_cachedApiKey) {
          _cachedApiKey = headers['x-api-key'];
        }
        if (headers['authorization'] && !_cachedAuthHeader) {
          _cachedAuthHeader = headers['authorization'];
        }

        // 首次 API 请求时捕获原始配置（仅一次，用于 Default profile 展示和自动匹配）
        if (!_defaultConfig) {
          try {
            const _u = new URL(urlStr);
            _defaultConfig = {
              origin: _u.origin,
              authType: headers['authorization'] ? 'OAuth' : headers['x-api-key'] ? 'API Key' : 'Unknown',
              apiKey: headers['x-api-key'] || null,
              model: body?.model || null,
            };
          } catch { }
        }

        // 缓存请求中的模型名（仅 mainAgent 请求，避免 SubAgent 覆盖）
        // 注意：写入移到 requestEntry 构建之后

        // 脱敏敏感 headers，避免写入日志泄漏凭证
        const safeHeaders = { ...headers };
        if (safeHeaders['x-api-key']) {
          const k = safeHeaders['x-api-key'];
          safeHeaders['x-api-key'] = k.length > 12 ? k.slice(0, 8) + '****' + k.slice(-4) : '****';
        }
        if (safeHeaders['authorization']) {
          const v = safeHeaders['authorization'];
          const spaceIdx = v.indexOf(' ');
          if (spaceIdx > 0) {
            const scheme = v.slice(0, spaceIdx);
            const token = v.slice(spaceIdx + 1);
            safeHeaders['authorization'] = scheme + ' ' + (token.length > 12 ? token.slice(0, 8) + '****' + token.slice(-4) : '****');
          } else {
            safeHeaders['authorization'] = '****';
          }
        }

        requestEntry = {
          timestamp,
          project: (() => { try { return basename(process.cwd()); } catch { return 'unknown'; } })(),
          url: urlStr,
          method: options?.method || 'GET',
          headers: safeHeaders,
          body: body,
          response: null,
          duration: 0,
          isStream: body?.stream === true,
          isHeartbeat: /\/api\/eval\/sdk-/.test(urlStr),
          isCountTokens: /\/messages\/count_tokens/.test(urlStr),
          mainAgent: isMainAgentRequest(body),
          ...(_isTeammate && { teammate: _teammateName, teamName: _teamName })
        };
      }
    } catch { }

    // 用户新指令边界：检查日志文件大小，超过 250MB 则切换新文件
    if (requestEntry?.mainAgent) {
      checkAndRotateLogFile();
      // 仅 mainAgent 请求时缓存模型名，避免 SubAgent 覆盖
      if (requestEntry.body?.model && typeof requestEntry.body.model === 'string') {
        _cachedModel = requestEntry.body.model;
        // 捕获 haiku 模型名供翻译接口使用
        if (/haiku/i.test(requestEntry.body.model)) {
          _cachedHaikuModel = requestEntry.body.model;
        }
      }
    }

    // Delta storage：仅 mainAgent 且开关启用时，将 body.messages 转为增量格式
    let _deltaOriginalMessagesLength = 0; // 缓存本次请求的原始 messages 长度，用于 completed 后更新状态
    if (_deltaStorageEnabled && requestEntry?.mainAgent && Array.isArray(requestEntry.body?.messages)) {
      const messages = requestEntry.body.messages;
      _deltaOriginalMessagesLength = messages.length;
      _mainAgentDeltaCount++;

      // 判断是否需要写 checkpoint
      const needsCheckpoint =
        _lastMessagesCount === 0 ||                           // 进程重启 / 首次请求
        messages.length < _lastMessagesCount ||               // messages 缩短（/clear、context 压缩）
        (_mainAgentDeltaCount % CHECKPOINT_INTERVAL === 0);   // 定期 checkpoint

      if (needsCheckpoint) {
        // checkpoint：保持完整 messages，标记 _isCheckpoint
        requestEntry._deltaFormat = 1;
        requestEntry._totalMessageCount = messages.length;
        requestEntry._conversationId = 'mainAgent';
        requestEntry._isCheckpoint = true;
      } else {
        // delta：只保留新增的 messages
        const delta = messages.slice(_lastMessagesCount);
        requestEntry._deltaFormat = 1;
        requestEntry._totalMessageCount = messages.length;
        requestEntry._conversationId = 'mainAgent';
        requestEntry._isCheckpoint = false;
        requestEntry.body.messages = delta;
      }
    }

    // 生成唯一请求 ID，用于关联在途请求和完成请求
    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    if (requestEntry) {
      requestEntry.requestId = requestId;
      requestEntry.inProgress = true;  // 标记为在途请求
    }

    // 在发起请求前先写入一条未完成的条目，让前端可以检测在途请求
    // 例外：live-streaming 场景下，placeholder 由 sendStreamChunk 通过 HTTP 即时投递，
    // 跳过磁盘预写可避免 log-watcher 500ms 后用空 placeholder 覆盖已显示的流式内容
    if (requestEntry) {
      const willLiveStream = !!_livePort && requestEntry.mainAgent && !_isTeammate;
      if (!willLiveStream) {
        try {
          appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
        } catch { }
      }
    }

    // 流式请求状态追踪（仅对 Claude API 流式请求）
    if (requestEntry?.isStream) {
      streamingState.active = true;
      streamingState.requestId = requestId;
      streamingState.startTime = Date.now();
      streamingState.model = requestEntry.body?.model || '';
      streamingState.bytesReceived = 0;
      streamingState.chunksReceived = 0;
    }

    // Proxy profile request rewriting
    let _fetchUrl = url;
    let _fetchOpts = options;
    if (_activeProfile && _activeProfile.baseURL && requestEntry) {
      try {
        // 1. URL 重写: 用 baseURL 替换 origin，智能处理路径重叠
        //    baseURL="https://proxy.com/v1" + pathname="/v1/messages" → "https://proxy.com/v1/messages"（去重 /v1）
        //    baseURL="https://proxy.com"    + pathname="/v1/messages" → "https://proxy.com/v1/messages"（无重叠）
        if (typeof _fetchUrl === 'string') {
          const _origUrl = new URL(_fetchUrl);
          const _baseUrl = new URL(_activeProfile.baseURL);
          const _basePath = _baseUrl.pathname.replace(/\/+$/, '');
          const _origPath = _origUrl.pathname;
          // 如果原始路径以 baseURL 的路径开头（如都有 /v1/），去掉重叠部分
          // 使用 _basePath + '/' 避免 /api 误匹配 /api-v2
          const _finalPath = (!_basePath || _origPath === _basePath || _origPath.startsWith(_basePath + '/')) ? _origPath : _basePath + _origPath;
          _fetchUrl = _baseUrl.origin + _finalPath + _origUrl.search;
        }
        // 2. Auth 替换 —— 兼容 lowercase / TitleCase，且 x-api-key / Authorization 同时替换以覆盖两种鉴权形式
        if (_activeProfile.apiKey && _fetchOpts?.headers) {
          const h = _fetchOpts.headers;
          if (typeof h === 'object' && !(h instanceof Headers)) {
            const { headers: newHeaders, matchedAuthKey, matchedXApiKey } =
              _replaceProxyAuthHeaders(h, _activeProfile.apiKey);
            _fetchOpts = { ..._fetchOpts, headers: newHeaders };

            // 诊断日志：让 stderr 能看到替换是否真的发生
            // 只输出"是否命中/是否写入"布尔，绝不输出任何 apiKey 明文或片段
            // （日志聚合/审计规则会把尾 N 字符一并标记为敏感泄漏）
            if (process.env.CCV_DEBUG_HOTSWITCH) {
              console.error('[ccv hotswitch]', {
                profile: _activeProfile.name,
                url: _fetchUrl,
                matchedAuth: matchedAuthKey || '(none)',
                matchedXApiKey: matchedXApiKey || '(none)',
                authSet: !!(matchedAuthKey && newHeaders[matchedAuthKey]),
                xApiKeySet: !!(newHeaders[matchedXApiKey] || newHeaders['x-api-key']),
              });
            }
          }
        }
        // 3. Model 替换
        if (_activeProfile.activeModel && _fetchOpts?.body) {
          try {
            const _b = JSON.parse(_fetchOpts.body);
            if (_b.model) {
              _b.model = _activeProfile.activeModel;
              _fetchOpts = { ..._fetchOpts, body: JSON.stringify(_b) };
            }
          } catch { }
        }
        // 记录 proxy 信息到日志条目
        requestEntry.proxyProfile = _activeProfile.name;
        requestEntry.proxyUrl = _fetchUrl;
      } catch { }
    }

    let response;
    try {
      response = await _originalFetch.call(this, _fetchUrl, _fetchOpts);
    } catch (err) {
      if (requestEntry?.isStream) resetStreamingState();
      throw err;
    }

    if (requestEntry) {
      const duration = Date.now() - startTime;
      requestEntry.duration = duration;

      // 对于流式响应，拦截并捕获内容
      if (requestEntry.isStream) {
        try {
          requestEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: { events: [] }
          };

          const originalBody = response.body;
          const reader = originalBody.getReader();
          const decoder = new TextDecoder();
          let streamedContent = '';

          // 实时流式：仅对 mainAgent 且 server live-port 已注入时启用
          let liveStreamEnabled = !!_livePort && requestEntry.mainAgent && !_isTeammate;
          const liveAssembler = liveStreamEnabled ? createStreamAssembler() : null;
          let livePendingBuffer = '';
          let liveChunkSeq = 0;
          let liveLastFlushMs = 0;
          let liveLastFlushBytes = 0;
          let liveFlushInFlight = false;
          let liveHasPendingSnapshot = false;
          let liveFlushTimer = null;

          // 非阻塞 flush：合并待发快照（latest-wins），单 in-flight。
          // payload 只包含 server 实际消费的 4 字段（timestamp/url/content/model）+ _chunkSeq，
          // 避免克隆完整 requestEntry（含 headers/messages/tools，每次 O(N) 序列化导致 O(N²) 累计）。
          const liveFlush = () => {
            if (!liveStreamEnabled || !liveAssembler || !liveAssembler.hasMessage()) return;
            if (liveFlushInFlight) {
              liveHasPendingSnapshot = true;
              return;
            }
            liveFlushInFlight = true;
            liveHasPendingSnapshot = false;
            const snap = liveAssembler.snapshot();
            const chunkEntry = {
              timestamp: requestEntry.timestamp,
              url: requestEntry.url,
              response: { body: snap },
              body: { model: requestEntry.body?.model },
            };
            sendStreamChunk(chunkEntry, ++liveChunkSeq, (ok) => {
              // 413 → 禁用当次流式，后续全由最终 appendFileSync 交付
              if (!ok) liveStreamEnabled = false;
            });
            // 短延迟后清标志，允许下一次发送；若中途有新快照等待，立即再发
            if (liveFlushTimer) clearTimeout(liveFlushTimer);
            liveFlushTimer = setTimeout(() => {
              liveFlushTimer = null;
              liveFlushInFlight = false;
              if (liveHasPendingSnapshot && liveStreamEnabled) liveFlush();
            }, 50);
          };

          // 首次：立即 POST 当前 inProgress 骨架（无 body），保证前端先看到占位条目。
          // 传 onDone 回调熔断：若 skeleton 就触发 413（极少见但可能，例如 requestEntry 本身异常大），
          // 立即禁用当次 live-stream，后续仅走最终 entry 落盘路径。
          if (liveStreamEnabled) {
            sendStreamChunk({
              timestamp: requestEntry.timestamp,
              url: requestEntry.url,
              response: { body: null },
              body: { model: requestEntry.body?.model },
            }, 0, (ok) => { if (!ok) liveStreamEnabled = false; });
          }

          const stream = new ReadableStream({
            async start(controller) {
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    // flush decoder 残留字节
                    streamedContent += decoder.decode();
                    // 流结束，组装完整的消息对象
                    try {
                      const events = streamedContent.split('\n\n')
                        .filter(block => block.trim())
                        .map(block => {
                          // SSE 块可能包含多行: event: xxx\ndata: {...}
                          const lines = block.split('\n');
                          const dataLine = lines.find(l => l.startsWith('data:'));
                          if (dataLine) {
                            // 处理 "data:" 或 "data: " 两种格式
                            const jsonStr = dataLine.startsWith('data: ')
                              ? dataLine.substring(6)
                              : dataLine.substring(5);
                            try {
                              return JSON.parse(jsonStr);
                            } catch {
                              return jsonStr;
                            }
                          }
                          return null;
                        })
                        .filter(Boolean);

                      // 组装完整的 message 对象（GLM 使用标准格式，但 data: 后无空格）
                      const assembledMessage = assembleStreamMessage(events);

                      // 直接使用组装后的 message 对象作为 response.body
                      // 如果组装失败（例如非标准 SSE），则使用原始流内容
                      requestEntry.response.body = assembledMessage || streamedContent;


                      // 移除在途请求标记，保持原始报文
                      delete requestEntry.inProgress;
                      delete requestEntry.requestId;
                      appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
                      _commitDeltaState(_deltaOriginalMessagesLength);
                      // Release memory: clear large objects after disk write
                      streamedContent = '';
                      requestEntry.response = null;
                      resetStreamingState();
                    } catch (err) {
                      requestEntry.response.body = streamedContent.slice(0, 1000);
                      delete requestEntry.inProgress;
                      delete requestEntry.requestId;
                      appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
                      _commitDeltaState(_deltaOriginalMessagesLength);
                      streamedContent = '';
                      requestEntry.response = null;
                      resetStreamingState();
                    }
                    controller.close();
                    break;
                  }
                  streamingState.bytesReceived += value.byteLength;
                  streamingState.chunksReceived++;
                  const chunk = decoder.decode(value, { stream: true });
                  streamedContent += chunk;
                  controller.enqueue(value);

                  // 实时流式：增量解析完整的 SSE events 并触发节流 flush
                  if (liveAssembler && liveStreamEnabled) {
                    livePendingBuffer += chunk;
                    let sawBlockStop = false;
                    let idx;
                    while ((idx = livePendingBuffer.indexOf('\n\n')) !== -1) {
                      const eventBlock = livePendingBuffer.slice(0, idx);
                      livePendingBuffer = livePendingBuffer.slice(idx + 2);
                      if (!eventBlock.trim()) continue;
                      const lines = eventBlock.split('\n');
                      const dataLine = lines.find(l => l.startsWith('data:'));
                      if (!dataLine) continue;
                      const jsonStr = dataLine.startsWith('data: ')
                        ? dataLine.substring(6)
                        : dataLine.substring(5);
                      try {
                        const ev = JSON.parse(jsonStr);
                        liveAssembler.feed(ev);
                        if (ev.type === 'content_block_stop') sawBlockStop = true;
                      } catch {}
                    }
                    const now = Date.now();
                    const overdue = (now - liveLastFlushMs) >= 100;
                    const bigChunk = (streamedContent.length - liveLastFlushBytes) > 16384;
                    if (sawBlockStop || overdue || bigChunk) {
                      liveLastFlushMs = now;
                      liveLastFlushBytes = streamedContent.length;
                      liveFlush();
                    }
                  }
                }
              } catch (err) {
                resetStreamingState();
                controller.error(err);
              }
            }
          });

          // 返回带有代理流的新响应
          return new Response(stream, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (err) {
          requestEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: '[Streaming Response - Capture failed]'
          };
          delete requestEntry.inProgress;
          delete requestEntry.requestId;
          appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
          _commitDeltaState(_deltaOriginalMessagesLength);
          resetStreamingState();
        }
      } else {
        // 对于非流式响应，可以安全读取body
        try {
          const clonedResponse = response.clone();
          const responseText = await clonedResponse.text();
          let responseData = null;

          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText.slice(0, 1000);
          }

          requestEntry.response = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseData
          };


          delete requestEntry.inProgress;
          delete requestEntry.requestId;

          appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
          _commitDeltaState(_deltaOriginalMessagesLength);
        } catch (err) {
          delete requestEntry.inProgress;
          delete requestEntry.requestId;
          appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
          _commitDeltaState(_deltaOriginalMessagesLength);
        }
      }
    }

    return response;
  };
}

// 自动执行拦截器设置
// proxy 模式下（ccv CLI 或 ccv run），外层 proxy.js 已显式调用 setupInterceptor()，
// 这里跳过自动执行，避免 Claude 进程中重复拦截 fetch
// Teammate 子进程即使继承了 CCV_PROXY_MODE 也需要启用拦截（它是独立 claude 进程，不走 proxy）
if (!_ccvSkip && (!process.env.CCV_PROXY_MODE || _isTeammate)) setupInterceptor();

// 等待日志文件初始化完成后启动 Web Viewer 服务
// 如果是 ccv --c 通过 proxy 模式启动的，外层已有 server，跳过
// Teammate 子进程也跳过，避免端口冲突（leader 已启动 viewer）
if (!_ccvSkip && !process.env.CCV_PROXY_MODE && !_isTeammate) {
  _initPromise.then(() => import('./server.js')).catch((err) => {
    console.error('[CC-Viewer] Failed to start viewer server:', err);
  });
}
