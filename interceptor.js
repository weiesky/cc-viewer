// LLM Request Interceptor
// 拦截并记录所有Claude API请求
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  const dir = join(homedir(), '.claude', 'cc-viewer');
  try { mkdirSync(dir, { recursive: true }); } catch {}
  return { filePath: join(dir, `${projectName}_${ts}.jsonl`), dir, projectName };
}

// 查找同项目最近的日志文件，检查最后一条响应是否在1小时内
function findRecentLog(dir, projectName) {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith(projectName + '_') && f.endsWith('.jsonl'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    const latestFile = join(dir, files[0]);
    const content = readFileSync(latestFile, 'utf-8');
    const entries = content.split('\n---\n').filter(s => s.trim());
    // 从后往前找最后一条有 response 的记录
    for (let i = entries.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(entries[i]);
        if (entry.response) {
          const ts = new Date(entry.timestamp).getTime();
          if (Date.now() - ts < 3600000) {
            return latestFile;
          }
          return null;
        }
      } catch {}
    }
  } catch {}
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
      } catch {}
    }
  } catch {}
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
const { filePath: _newLogFile, dir: _logDir, projectName: _projectName } = generateNewLogFilePath();
let LOG_FILE = _newLogFile;

// 启动时清理残留临时文件
cleanupTempFiles(_logDir, _projectName);

const _initPromise = (async () => {
  try {
    const recentLog = findRecentLog(_logDir, _projectName);
    if (recentLog) {
      // 设置临时文件，不阻塞
      const tempFile = _newLogFile.replace('.jsonl', '_temp.jsonl');
      LOG_FILE = tempFile;
      _resumeState = {
        recentFile: recentLog,
        recentFileName: basename(recentLog),
        tempFile,
      };
    }
  } catch {}
})();

export { LOG_FILE, _initPromise, _resumeState, _choicePromise, resolveResumeChoice };

const MAX_LOG_SIZE = 200 * 1024 * 1024; // 200MB

function checkAndRotateLogFile() {
  try {
    if (!existsSync(LOG_FILE)) return;
    const size = statSync(LOG_FILE).size;
    if (size >= MAX_LOG_SIZE) {
      const { filePath } = generateNewLogFilePath();
      LOG_FILE = filePath;
    }
  } catch {}
}

// 从环境变量 ANTHROPIC_BASE_URL 提取域名用于请求匹配
function getBaseUrlHost() {
  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    if (baseUrl) {
      return new URL(baseUrl).hostname;
    }
  } catch {}
  return null;
}
const CUSTOM_API_HOST = getBaseUrlHost();

// 不再需要折叠函数，保存完整 JSON 供前端渲染

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

  globalThis.fetch = async function(url, options) {
    const startTime = Date.now();
    let requestEntry = null;

    try {
      const urlStr = typeof url === 'string' ? url : url?.url || String(url);
      if ((urlStr.includes('anthropic') || urlStr.includes('claude') || (CUSTOM_API_HOST && urlStr.includes(CUSTOM_API_HOST))) && !urlStr.includes('/messages/count_tokens')) {
        const timestamp = new Date().toISOString();
        let body = null;
        if (options?.body) {
          try {
            body = JSON.parse(options.body);
          } catch {
            body = String(options.body).slice(0, 500);
          }
        }

        // 转换 headers 为普通对象
        let headers = {};
        if (options?.headers) {
          if (options.headers instanceof Headers) {
            headers = Object.fromEntries(options.headers.entries());
          } else if (typeof options.headers === 'object') {
            headers = { ...options.headers };
          }
        }

        requestEntry = {
          timestamp,
          project: (() => { try { return basename(process.cwd()); } catch { return 'unknown'; } })(),
          url: urlStr,
          method: options?.method || 'GET',
          headers,
          body: body,
          response: null,
          duration: 0,
          isStream: body?.stream === true,
          isHeartbeat: /\/api\/eval\/sdk-/.test(urlStr),
          mainAgent: (() => {
            if (!body?.system || !Array.isArray(body?.tools) || body.tools.length <= 10) return false;
            if (!['Task', 'Edit', 'Bash'].every(n => body.tools.some(t => t.name === n))) return false;
            const sysText = typeof body.system === 'string' ? body.system :
              Array.isArray(body.system) ? body.system.map(s => s?.text || '').join('') : '';
            // 正向：必须包含 MainAgent 身份标识
            if (!sysText.includes('You are Claude Code')) return false;
            // 排除 SubAgent（general-purpose 等也携带完整工具集）
            if (/command execution specialist|file search specialist|planning specialist|general-purpose agent/i.test(sysText)) return false;
            return true;
          })()
        };
      }
    } catch {}

    // 用户新指令边界：检查日志文件大小，超过 200MB 则切换新文件
    if (requestEntry?.mainAgent) {
      checkAndRotateLogFile();
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
                          const dataLine = lines.find(l => l.startsWith('data: '));
                          if (dataLine) {
                            try {
                              return JSON.parse(dataLine.substring(6));
                            } catch {
                              return dataLine.substring(6);
                            }
                          }
                          return null;
                        })
                        .filter(Boolean);

                      // 组装完整的 message 对象
                      const assembledMessage = assembleStreamMessage(events);

                      // 直接使用组装后的 message 对象作为 response.body
                      requestEntry.response.body = assembledMessage;
                      appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
                    } catch (err) {
                      requestEntry.response.body = streamedContent.slice(0, 1000);
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

          appendFileSync(LOG_FILE, JSON.stringify(requestEntry, null, 2) + '\n---\n');
        } catch (err) {
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
_initPromise.then(() => import('cc-viewer/server.js')).catch(() => {});
