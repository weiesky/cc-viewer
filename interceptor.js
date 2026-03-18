// LLM Request Interceptor
// 拦截并记录所有Claude API请求

// 非交互命令（如 claude -v, claude --help）不需要启动 ccv
const _ccvSkipArgs = ['--version', '-v', '--v', '--help', '-h', 'doctor', 'install', 'update', 'upgrade', 'auth', 'setup-token', 'agents', 'plugin', 'plugins', 'mcp'];
const _ccvSkip = _ccvSkipArgs.includes(process.argv[2]);

import './lib/proxy-env.js';
import { appendFileSync, mkdirSync, readFileSync, statSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { LOG_DIR } from './findcc.js';
import { assembleStreamMessage, cleanupTempFiles, findRecentLog, isAnthropicApiPath, isMainAgentRequest, migrateConversationContext } from './lib/interceptor-core.js';



const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 缓存从请求 headers 中提取的 API Key 或 Authorization header
export let _cachedApiKey = null;
export let _cachedAuthHeader = null;
// 缓存从请求 body 中提取的模型名，供翻译接口使用
export let _cachedModel = null;
// 缓存 haiku 模型名（从实际请求中捕获），翻译接口优先使用
export let _cachedHaikuModel = null;

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
      // new: 将临时文件 rename 为正式新日志文件名
      const newPath = tempFile.replace('_temp.jsonl', '.jsonl');
      if (existsSync(tempFile)) {
        renameSync(tempFile, newPath);
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

// Teammate 子进程检测：teammate 通过 --parent-session-id 启动（提前到日志路径初始化之前）
const _isTeammate = process.argv.includes('--parent-session-id');
// 提取 teammate 元数据（--agent-name worker-1 --team-name fix-ts-errors）
let _teammateName = null;
let _teamName = null;
if (_isTeammate) {
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
export function initForWorkspace(projectPath) {
  const projectName = basename(projectPath).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch {}

  cleanupTempFiles(dir, projectName);

  // 检查是否有最近的日志文件可以复用（始终复用最新日志）
  const recentLog = findRecentLog(dir, projectName);
  if (recentLog) {
    _projectName = projectName;
    _logDir = dir;
    LOG_FILE = recentLog;
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

  return { filePath, dir, projectName, resumed: false };
}

// 工作区模式：重置日志状态（返回工作区列表时调用）
export function resetWorkspace() {
  _projectName = '';
  _logDir = '';
  LOG_FILE = '';
}

const MAX_LOG_SIZE = 150 * 1024 * 1024; // 150MB

function checkAndRotateLogFile() {
  try {
    if (!existsSync(LOG_FILE)) return;
    const size = statSync(LOG_FILE).size;
    if (size >= MAX_LOG_SIZE) {
      const oldFile = LOG_FILE;
      const { filePath } = generateNewLogFilePath();
      LOG_FILE = filePath;
      migrateConversationContext(oldFile, filePath);
    }
  } catch { }
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

export function setupInterceptor() {
  // 避免重复拦截
  if (globalThis._ccViewerInterceptorInstalled) {
    return;
  }
  globalThis._ccViewerInterceptorInstalled = true;

  // 启动 viewer 服务（优先根目录 server.js，fallback 到 lib/server.js）
  // Teammate 子进程跳过，避免端口冲突（leader 已启动 viewer）
  if (!_isTeammate) {
    const rootServerPath = join(__dirname, 'server.js');
    const libServerPath = join(__dirname, 'lib', 'server.js');
    import(rootServerPath).then(module => {
      viewerModule = module;
    }).catch(() => {
      import(libServerPath).then(module => {
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

    // 用户新指令边界：检查日志文件大小，超过 200MB 则切换新文件
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

    // 生成唯一请求 ID，用于关联在途请求和完成请求
    const requestId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    if (requestEntry) {
      requestEntry.requestId = requestId;
      requestEntry.inProgress = true;  // 标记为在途请求
    }

    // 在发起请求前先写入一条未完成的条目，让前端可以检测在途请求
    if (requestEntry) {
      try {
        appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
      } catch { }
    }

    const response = await _originalFetch.apply(this, arguments);

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
                      // Release memory: clear large objects after disk write
                      streamedContent = '';
                      requestEntry.response = null;
                    } catch (err) {
                      requestEntry.response.body = streamedContent.slice(0, 1000);
                      delete requestEntry.inProgress;
                      delete requestEntry.requestId;
                      appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
                      streamedContent = '';
                      requestEntry.response = null;
                    }
                    controller.close();
                    break;
                  }
                  const chunk = decoder.decode(value, { stream: true });
                  streamedContent += chunk;
                  controller.enqueue(value);
                }
              } catch (err) {
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
        } catch (err) {
          delete requestEntry.inProgress;
          delete requestEntry.requestId;
          appendFileSync(LOG_FILE, JSON.stringify(requestEntry) + '\n---\n');
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
