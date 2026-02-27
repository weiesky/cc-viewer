
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setupInterceptor } from './interceptor.js';

// Setup interceptor to patch fetch
setupInterceptor();

function getOriginalBaseUrl() {
  // 1. Check settings.json (Priority 1)
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.env && settings.env.ANTHROPIC_BASE_URL) {
        return settings.env.ANTHROPIC_BASE_URL;
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. Check env var (Priority 2)
  if (process.env.ANTHROPIC_BASE_URL) {
    return process.env.ANTHROPIC_BASE_URL;
  }

  // 3. Default
  return 'https://api.anthropic.com';
}

export function startProxy() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const originalBaseUrl = getOriginalBaseUrl();
      const targetUrl = new URL(req.url, originalBaseUrl);

      // Use the patched fetch (which logs to cc-viewer)
      try {
        // Convert incoming headers
        const headers = { ...req.headers };
        delete headers.host; // Let fetch set the host

        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const body = Buffer.concat(buffers);

        const fetchOptions = {
          method: req.method,
          headers: headers,
        };

        // 标记此请求为 CC-Viewer 代理转发的 Claude API 请求
        // 拦截器识别到此 Header 会强制记录，忽略 URL 匹配规则
        fetchOptions.headers['x-cc-viewer-trace'] = 'true';

        if (body.length > 0) {
          fetchOptions.body = body;
        }

        // 拼接完整 URL，保留 originalBaseUrl 中的路径前缀
        const cleanBase = originalBaseUrl.endsWith('/') ? originalBaseUrl.slice(0, -1) : originalBaseUrl;
        const cleanReq = req.url.startsWith('/') ? req.url.slice(1) : req.url;
        const fullUrl = `${cleanBase}/${cleanReq}`;

        const response = await fetch(fullUrl, fetchOptions);

        // fetch 自动解压，需移除编码相关 header 避免客户端重复解压
        const responseHeaders = {};
        for (const [key, value] of response.headers.entries()) {
          // Skip Content-Encoding and Transfer-Encoding to let Node/Client handle it
          if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length') {
            responseHeaders[key] = value;
          }
        }

        res.writeHead(response.status, responseHeaders);

        if (response.body) {
          const { Readable } = await import('node:stream');
          // @ts-ignore
          const nodeStream = Readable.fromWeb(response.body);
          nodeStream.pipe(res);
        } else {
          res.end();
        }
      } catch (err) {
        console.error('[CC-Viewer Proxy] Error:', err);
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
