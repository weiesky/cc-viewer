
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as interceptor from './interceptor.js';
import { setupInterceptor } from './interceptor.js';
import { extractApiErrorMessage, formatProxyRequestError } from './lib/proxy-errors.js';
import { getProxyDispatcher } from './lib/proxy-env.js';
import { getClaudeConfigDir } from '../findcc.js';
import { isAnthropicApiPath } from './lib/interceptor-core.js';
import { executeRequest } from './lib/proxy-retry.js';

// Setup interceptor to patch fetch
setupInterceptor();

// 强制上游返回未压缩响应，取代仅剥 zstd 的旧策略。
// 原因：链路中的网关/代理（典型是本地 MITM 网络代理）可能把上游的压缩 body 原样透传，
// 却把 content-encoding 响应头剥掉。undici 看不到 content-encoding 就不会解压，于是把一坨
// gzip 字节当明文交回；本代理再把它当 SSE 透传给 Claude CLI →
// "API returned an empty or malformed response (HTTP 200)"。
// 让上游直接不压缩，整条链路就没有可被剥离/错配的 content-encoding，从根上消除这类问题。
export function forceIdentityAcceptEncoding(headers) {
  if (!headers) return headers;
  const out = {};
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() !== 'accept-encoding') out[k] = headers[k];
  }
  out['accept-encoding'] = 'identity';
  return out;
}

// 代理会改写请求 body（interceptor 的模型替换 JSON.parse→改 model→JSON.stringify），
// 客户端声明的 content-length 随之失真。透传旧值会触发 undici
// UND_ERR_REQ_CONTENT_LENGTH_MISMATCH → 502 → CLI 静默重试退避（表现为请求卡住）。
// 删除该头，交给 undici 按实际 body 重算（已知长度的 Buffer/string 不会退化为 chunked）。
export function stripContentLengthHeader(headers) {
  if (!headers) return headers;
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'content-length');
  if (!key) return headers;
  const { [key]: _omit, ...rest } = headers;
  return rest;
}

function getBaseUrlFromSettings(settingsPath) {
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.env && settings.env.ANTHROPIC_BASE_URL) {
        return settings.env.ANTHROPIC_BASE_URL;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function getOriginalBaseUrl() {
  // 热切换 profile 最高优先：UI 里用户选中的 baseURL 直接作为上游目标，
  // 让 log/UI 显示的 URL 与实际去向一致，且避免 settings.json 残留的本地
  // 代理 URL（如 127.0.0.1:xxxx）导致 ccv proxy 自环 404。
  // Via namespace import to pick up watchFile 刷新（ES module live binding）。
  const ap = interceptor._activeProfile;
  if (ap && ap.baseURL) return ap.baseURL;

  let cwd;
  try { cwd = process.cwd(); } catch { cwd = null; }

  // Check config files in priority order (highest first)
  const configPaths = [];
  if (cwd) {
    configPaths.push(join(cwd, '.claude', 'settings.local.json'));
    configPaths.push(join(cwd, '.claude', 'settings.json'));
  }
  configPaths.push(join(getClaudeConfigDir(), 'settings.json'));

  for (const configPath of configPaths) {
    const url = getBaseUrlFromSettings(configPath);
    if (url) return url;
  }

  // Check env var
  if (process.env.ANTHROPIC_BASE_URL) {
    return process.env.ANTHROPIC_BASE_URL;
  }

  // Default
  return 'https://api.anthropic.com';
}

export function startProxy() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const originalBaseUrl = getOriginalBaseUrl();

      // Use the patched fetch (which logs to cc-viewer)
      try {
        // Convert incoming headers
        let headers = { ...req.headers };
        delete headers.host; // Let fetch set the host
        headers = forceIdentityAcceptEncoding(headers); // 让上游不压缩，规避网关剥 content-encoding 头导致的 body 错配
        headers = stripContentLengthHeader(headers); // body 会被改写，旧 content-length 必须丢弃

        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const body = Buffer.concat(buffers);

        const fetchOptions = {
          method: req.method,
          headers: headers,
        };

        // 走用户的网络代理：Node 内置全局 fetch 既不读 http_proxy/https_proxy，也看不到
        // userland undici 的 setGlobalDispatcher，必须把代理 dispatcher 显式传进来，否则
        // 上游请求会绕过代理直连 api.anthropic.com（详见 lib/proxy-env.js 注释）。
        const proxyDispatcher = getProxyDispatcher();

        // 拼接完整 URL，保留 originalBaseUrl 中的路径前缀
        const cleanBase = originalBaseUrl.endsWith('/') ? originalBaseUrl.slice(0, -1) : originalBaseUrl;
        const cleanReq = req.url.startsWith('/') ? req.url.slice(1) : req.url;
        const fullUrl = `${cleanBase}/${cleanReq}`;

        // 大模型 API 请求（/v1/messages 等）走重试引擎：serial/race/stagger 重试。
        // 重试引擎内部用 x-cc-viewer-trace 头让 interceptor 记录每次重试尝试到会话日志（网络视图数据源），
        // 模型替换由重试引擎用 resolveProfileModel 纯函数完成（interceptor 对 trace 请求会再跑一次，幂等 no-op）。
        // 非大模型 API 请求走原逻辑（同样用 x-cc-viewer-trace 让 interceptor 记录，但不经重试引擎）。
        if (isAnthropicApiPath(fullUrl)) {
          await handleLlmApiRequest(req, res, fullUrl, fetchOptions, body, proxyDispatcher);
          return;
        }

        // ── 非大模型 API：原逻辑（透传，interceptor 记录）──
        fetchOptions.headers['x-cc-viewer-trace'] = 'true';

        if (body.length > 0) {
          fetchOptions.body = body;
        }
        if (proxyDispatcher) {
          fetchOptions.dispatcher = proxyDispatcher;
        }

        const response = await fetch(fullUrl, fetchOptions);

        // fetch 自动解压，需移除编码相关 header 避免客户端重复解压
        const responseHeaders = {};
        for (const [key, value] of response.headers.entries()) {
          // Skip Content-Encoding and Transfer-Encoding to let Node/Client handle it
          if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length') {
            responseHeaders[key] = value;
          }
        }

        // 如果是错误响应，尝试解析并打印具体的错误信息
        if (!response.ok) {
          try {
            const errorText = await response.text();
            if (process.env.CCV_DEBUG) {
              console.error(`[CC-Viewer Proxy] ${extractApiErrorMessage(response.status, errorText)}`);
            }

            res.writeHead(response.status, responseHeaders);
            res.end(errorText);
            return;
          } catch (err) {
            // 读取 body 失败，回退到流式处理
            if (process.env.CCV_DEBUG) {
              console.error('[CC-Viewer Proxy] Failed to read error body:', err);
            }
          }
        }

        res.writeHead(response.status, responseHeaders);

        if (response.body) {
          const { Readable, pipeline } = await import('node:stream');
          // @ts-ignore
          const nodeStream = Readable.fromWeb(response.body);
          // 持久 error handler 兜底：防止 pipeline 清理后延迟到达的 error 事件导致进程崩溃
          nodeStream.on('error', () => {});
          // pipeline handles stream errors; without this, unhandled 'error' events crash the process.
          pipeline(nodeStream, res, (err) => {
            if (err && process.env.CCV_DEBUG) {
              console.error('[CC-Viewer Proxy] Stream pipeline error:', err.message);
            }
          });
        } else {
          res.end();
        }
      } catch (err) {
        // Log proxy errors only when debugging
        if (process.env.CCV_DEBUG) {
          console.error('[CC-Viewer Proxy] Error:', err);
        }

        res.statusCode = 502;
        res.end('Proxy Error');
      }
    });

    // Start on random port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(address.port);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

// ── 大模型 API 请求处理：重试引擎 ──────────────────────
// mode=off 时退化为单次 fetch（与原透传一致）。
// 重试配置由 interceptor._retryConfigState 提供（live binding，watchFile 热刷新），
// 每请求取最新值，UI 改 retry-config.json 后下一个请求即生效，无需重启。
const _retryConfigGetter = () => interceptor._retryConfigState;

async function handleLlmApiRequest(req, res, fullUrl, fetchOptions, body, proxyDispatcher) {
  const retryConfig = _retryConfigGetter(); // live binding：每请求取最新重试配置
  const profile = interceptor._activeProfile || null;

  // 清理可能的 trace 头（executeRequest 会重新加，避免旧值干扰）；interceptor 会正常记录请求
  // 同时清理 hop-by-hop / 传输编码头：body 已被 buffer 成完整 Buffer，
  // 残留的 transfer-encoding:chunked / content-length 会让 undici 拒绝（invalid transfer-encoding header）
  const retryFetchOptions = {
    method: fetchOptions.method,
    headers: { ...fetchOptions.headers },
  };
  delete retryFetchOptions.headers['x-cc-viewer-trace'];
  delete retryFetchOptions.headers['transfer-encoding'];
  delete retryFetchOptions.headers['Transfer-Encoding'];
  delete retryFetchOptions.headers['connection'];
  delete retryFetchOptions.headers['Connection'];
  delete retryFetchOptions.headers['content-length'];
  delete retryFetchOptions.headers['Content-Length'];
  if (body.length > 0) {
    retryFetchOptions.body = body;
  }

  // 执行带重试的请求
  const result = await executeRequest({
    url: fullUrl,
    fetchOptions: retryFetchOptions,
    retryConfig,
    ctx: { dispatcher: proxyDispatcher, profile },
  });

  const { response, attempts, finalStatus } = result;

  // 注入 X-Forward-Attempts 头（告知客户端本次重试了几次，与 llm-retry-proxy 一致）
  const responseHeaders = {};
  if (response.headers && typeof response.headers.entries === 'function') {
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length') {
        responseHeaders[key] = value;
      }
    }
  }
  responseHeaders['x-forward-attempts'] = String(attempts);

  // 网络异常（finalStatus=0）或竞速全失败：返回 502 + Proxy Error，与原 catch 分支一致
  if (finalStatus === 0) {
    res.writeHead(502, { 'x-forward-attempts': String(attempts) });
    res.end('Proxy Error');
    return;
  }

  // 响应客户端
  res.writeHead(finalStatus, responseHeaders);

  if (response.body) {
    const { Readable, pipeline } = await import('node:stream');
    // @ts-ignore
    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.on('error', () => {});
    pipeline(nodeStream, res, (err) => {
      if (err && process.env.CCV_DEBUG) {
        console.error('[CC-Viewer Proxy] Stream pipeline error:', err.message);
      }
    });
  } else if (response.text) {
    // 竞速失败兜底 response：用 text() 取 body
    const text = await response.text();
    res.end(text);
  } else {
    res.end();
  }
}
