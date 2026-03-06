// LLM Request Interceptor
// 拦截并记录所有Claude API请求
import './proxy-env.js';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { LOG_DIR } from './findcc.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 缓存从请求 headers 中提取的 API Key 或 Authorization header
export let _cachedApiKey = null;
export let _cachedAuthHeader = null;
// 缓存从请求 body 中提取的模型名，供翻译接口使用
export let _cachedModel = null;
// 缓存 haiku 模型名（从实际请求中捕获），翻译接口优先使用
export let _cachedHaikuModel = null;

// 获取项目工作目录（优先使用 SDK 传入的，否则使用 process.cwd()）
function getProjectCwd() {
  if (process.env.CC_VIEWER_PROJECT_CWD) {
    return process.env.CC_VIEWER_PROJECT_CWD;
  }
  try { return process.cwd(); } catch { return homedir(); }
}

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
  const cwd = getProjectCwd();
  const projectName = basename(cwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  const dir = join(LOG_DIR, projectName);
  try { mkdirSync(dir, { recursive: true }); } catch { }
  return { filePath: join(dir, `${projectName}_${ts}.jsonl`), dir, projectName };
}

// 查找同项目最近的日志文件
function findRecentLog(dir, projectName) {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith(projectName + '_') && f.endsWith('.jsonl'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return join(dir, files[0]);
  } catch { }
  return null;
}

// 清理残留的临时文件（rename 为正式文件名，保留数据）
function cleanupTempFiles(dir, projectName) {
  try {
    const tempFiles = readdirSync(dir)
      .filter(f => f.startsWith(projectName + '_') && f.endsWith('_temp.jsonl'));
    for (const f of tempFiles) {
      try {
        const tempPath = join(dir, f);
        const newPath = tempPath.replace('_temp.jsonl', '.jsonl');
        if (existsSync(newPath)) {
          // 正式文件已存在，追加临时文件内容后删除
          const tempContent = readFileSync(tempPath, 'utf-8');
          if (tempContent.trim()) {
            appendFileSync(newPath, tempContent);
          }
          unlinkSync(tempPath);
        } else {
          renameSync(tempPath, newPath);
        }
      } catch { }
    }
  } catch { }
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

// 初始化日志文件路径（异步，支持用户交互）
// 工作区模式下延迟到选择工作区后再初始化
let _newLogFile, _logDir, _projectName;
if (process.env.CCV_WORKSPACE_MODE === '1') {
  _newLogFile = '';
  _logDir = '';
  _projectName = '';
} else {
  ({ filePath: _newLogFile, dir: _logDir, projectName: _projectName } = generateNewLogFilePath());
  // 启动时清理残留临时文件
  cleanupTempFiles(_logDir, _projectName);
}
let LOG_FILE = _newLogFile;

const _initPromise = (async () => {
  if (!_logDir || !_projectName) return; // 工作区模式下跳过
  try {
    const recentLog = findRecentLog(_logDir, _projectName);
    if (recentLog) {
      // Check if file is modified within 1 hour
      const stats = statSync(recentLog);
      const now = new Date();
      const diff = now - stats.mtime;
      const oneHour = 60 * 60 * 1000;

      if (diff < oneHour) {
        // 设置临时文件，不阻塞
        const tempFile = _newLogFile.replace('.jsonl', '_temp.jsonl');
        LOG_FILE = tempFile;
        _resumeState = {
          recentFile: recentLog,
          recentFileName: basename(recentLog),
          tempFile,
        };
      }
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

  // 检查是否有最近的日志文件可以复用
  const recentLog = findRecentLog(dir, projectName);
  if (recentLog) {
    try {
      const stats = statSync(recentLog);
      const diff = Date.now() - stats.mtime.getTime();
      const oneHour = 60 * 60 * 1000;
      if (diff < oneHour) {
        _projectName = projectName;
        _logDir = dir;
        LOG_FILE = recentLog;
        return { filePath: recentLog, dir, projectName, resumed: true };
      }
    } catch {}
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

const MAX_LOG_SIZE = 300 * 1024 * 1024; // 300MB

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent/i;

/**
 * 提取请求体中的 system prompt 文本
 */
function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

/**
 * 判断请求是否为 MainAgent（拦截器侧标记用）
 * 与 contentFilter.js 保持一致的检测逻辑
 */
function isMainAgentRequest(body) {
  if (!body?.system || !Array.isArray(body?.tools)) return false;

  const sysText = getSystemText(body);

  // 必须包含 MainAgent 身份标识
  if (!sysText.includes('You are Claude Code')) return false;

  // 排除 SubAgent
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;

  // 新架构检测（v2.1.69+）：延迟工具加载机制
  const isSystemArray = Array.isArray(body.system);
  const hasToolSearch = body.tools.some(t => t.name === 'ToolSearch');

  if (isSystemArray && hasToolSearch) {
    // 检查第一条消息是否包含 <available-deferred-tools>
    const messages = body.messages || [];
    const firstMsgContent = messages.length > 0 ?
      (typeof messages[0].content === 'string' ? messages[0].content :
       Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '') : '';
    if (firstMsgContent.includes('<available-deferred-tools>')) {
      return true;
    }
  }

  // 旧架构检测：工具数量 > 10 且包含核心工具
  if (body.tools.length > 10) {
    const hasEdit = body.tools.some(t => t.name === 'Edit');
    const hasBash = body.tools.some(t => t.name === 'Bash');
    const hasTaskOrAgent = body.tools.some(t => t.name === 'Task' || t.name === 'Agent');
    if (hasEdit && hasBash && hasTaskOrAgent) {
      return true;
    }
  }

  return false;
}

function isPreflightEntry(entry) {
  if (entry.mainAgent || entry.isHeartbeat || entry.isCountTokens) return false;
  const body = entry.body || {};
  if (Array.isArray(body.tools) && body.tools.length > 0) return false;
  const msgs = body.messages || [];
  if (msgs.length !== 1 || msgs[0].role !== 'user') return false;
  const sysText = typeof body.system === 'string' ? body.system :
    Array.isArray(body.system) ? body.system.map(s => s?.text || '').join('') : '';
  return sysText.includes('Claude Code');
}

function migrateConversationContext(oldFile, newFile) {
  try {
    const content = readFileSync(oldFile, 'utf-8');
    if (!content.trim()) return;

    const parts = content.split('\n---\n').filter(p => p.trim());
    if (parts.length === 0) return;

    // 从后向前扫描，找到最近一条 messages.length === 1 的 mainAgent 条目
    let originIndex = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!parts[i].includes('"mainAgent": true')) continue;
      try {
        const entry = JSON.parse(parts[i]);
        if (entry.mainAgent) {
          const msgs = entry.body?.messages;
          if (Array.isArray(msgs) && msgs.length === 1) {
            originIndex = i;
            break;
          }
        }
      } catch { }
    }

    if (originIndex < 0) return; // 找不到起点，不迁移

    // 检查前一条是否为 Preflight
    let migrationStart = originIndex;
    if (originIndex > 0) {
      try {
        const prev = JSON.parse(parts[originIndex - 1]);
        if (isPreflightEntry(prev)) {
          migrationStart = originIndex - 1;
        }
      } catch { }
    }

    // 迁移条目写入新文件
    const migratedParts = parts.slice(migrationStart);
    writeFileSync(newFile, migratedParts.join('\n---\n') + '\n---\n');

    // 旧文件只保留迁移前的条目
    const remainingParts = parts.slice(0, migrationStart);
    if (remainingParts.length > 0) {
      writeFileSync(oldFile, remainingParts.join('\n---\n') + '\n---\n');
    } else {
      writeFileSync(oldFile, '');
    }
  } catch { }
}

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

// 通过请求路径识别 Anthropic API 端点（兼容 CCR 等代理场景）
function isAnthropicApiPath(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname;
    return /^\/v1\/messages(\/count_tokens|\/batches(\/.*)?)?$/.test(pathname)
      || /^\/api\/eval\/sdk-/.test(pathname);
  } catch {
    return /\/v1\/messages/.test(urlStr);
  }
}

// 组装流式消息为完整的 message 对象
function assembleStreamMessage(events) {
  let message = null;
  const contentBlocks = [];
  let currentBlockIndex = -1;

  for (const event of events) {
    if (typeof event !== 'object' || !event.type) continue;

    switch (event.type) {
      case 'message_start':
        // 初始化消息对象
        message = { ...event.message };
        message.content = [];
        break;

      case 'content_block_start':
        // 开始新的内容块
        currentBlockIndex = event.index;
        contentBlocks[currentBlockIndex] = { ...event.content_block };
        if (contentBlocks[currentBlockIndex].type === 'text') {
          contentBlocks[currentBlockIndex].text = '';
        } else if (contentBlocks[currentBlockIndex].type === 'thinking') {
          contentBlocks[currentBlockIndex].thinking = '';
        }
        break;

      case 'content_block_delta':
        // 累积内容块的增量数据
        if (event.index >= 0 && contentBlocks[event.index] && event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            contentBlocks[event.index].text += event.delta.text;
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            if (typeof contentBlocks[event.index]._inputJson !== 'string') {
              contentBlocks[event.index]._inputJson = '';
            }
            contentBlocks[event.index]._inputJson += event.delta.partial_json;
          } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            contentBlocks[event.index].thinking += event.delta.thinking;
          } else if (event.delta.type === 'signature_delta' && event.delta.signature) {
            contentBlocks[event.index].signature = event.delta.signature;
          }
        }
        break;

      case 'content_block_stop':
        // 内容块结束
        if (event.index >= 0 && contentBlocks[event.index]) {
          // 如果是 tool_use 且有累积的 input JSON，尝试解析
          if (contentBlocks[event.index].type === 'tool_use' && typeof contentBlocks[event.index]._inputJson === 'string') {
            try {
              contentBlocks[event.index].input = JSON.parse(contentBlocks[event.index]._inputJson);
            } catch {
              contentBlocks[event.index].input = contentBlocks[event.index]._inputJson;
            }
            delete contentBlocks[event.index]._inputJson;
          }
        }
        break;

      case 'message_delta':
        // 更新消息的增量数据（如 stop_reason, usage）
        if (message && event.delta) {
          if (event.delta.stop_reason) {
            message.stop_reason = event.delta.stop_reason;
          }
          if (event.delta.stop_sequence !== undefined) {
            message.stop_sequence = event.delta.stop_sequence;
          }
        }
        if (message && event.usage) {
          message.usage = { ...message.usage, ...event.usage };
        }
        break;

      case 'message_stop':
        // 消息结束
        break;
    }
  }

  // 将内容块添加到消息中
  if (message) {
    message.content = contentBlocks.filter(block => block !== undefined);
  }

  return message;
}

// 保存 viewer 模块引用
let viewerModule = null;

export function setupInterceptor() {
  // 避免重复拦截
  if (globalThis._ccViewerInterceptorInstalled) {
    return;
  }
  globalThis._ccViewerInterceptorInstalled = true;

  // 启动 viewer 服务（优先根目录 server.js，fallback 到 lib/server.js）
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

  // 注册退出处理器
  const cleanupViewer = () => {
    if (viewerModule && typeof viewerModule.stopViewer === 'function') {
      try {
        viewerModule.stopViewer();
      } catch (err) {
        // Silently fail
      }
    }
  };

  process.on('SIGINT', () => {
    cleanupViewer();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanupViewer();
    process.exit(0);
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
          mainAgent: isMainAgentRequest(body)
        };
      }
    } catch { }

    // 用户新指令边界：检查日志文件大小，超过 300MB 则切换新文件
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
        appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
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
                      appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
                    } catch (err) {
                      requestEntry.response.body = streamedContent.slice(0, 1000);
                      delete requestEntry.inProgress;
                      delete requestEntry.requestId;
                      appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
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
          appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
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

          appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
        } catch (err) {
          delete requestEntry.inProgress;
          delete requestEntry.requestId;
          appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
        }
      }
    }

    return response;
  };
}

// 自动执行拦截器设置
setupInterceptor();

// 等待日志文件初始化完成后启动 Web Viewer 服务
// 如果是 ccv --c 通过 proxy 模式启动的，外层已有 server，跳过
if (!process.env.CCV_PROXY_MODE) {
  _initPromise.then(() => import('./server.js')).catch((err) => {
    console.error('[CC-Viewer] Failed to start viewer server:', err);
  });
}
