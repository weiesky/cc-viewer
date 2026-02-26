
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
      // [Debug] Log incoming request
      // console.error(`[CC-Viewer Proxy] Received request: ${req.method} ${req.url}`);

      // Handle CORS preflight if needed (though claude cli probably doesn't send OPTIONS)

      const originalBaseUrl = getOriginalBaseUrl();
      const targetUrl = new URL(req.url, originalBaseUrl);

      // Use the patched fetch (which logs to cc-viewer)
      try {
        // Convert incoming headers
        const headers = { ...req.headers };
        delete headers.host; // Let fetch set the host

        // [Fix] Handle compressed body
        // If content-encoding is set (e.g. gzip), and we read the raw stream into a buffer,
        // we are passing the compressed buffer as body.
        // fetch will automatically add content-length, but might not handle content-encoding correctly if we just pass the buffer?
        // Actually, fetch should handle it fine if we pass the headers.

        // However, if we are reading the body here to pass it to fetch, we are buffering it.
        // For large uploads this might be bad, but for text prompts it's fine.

        // We need to read the body if any
        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const body = Buffer.concat(buffers);

        // [Debug] Log body size
        // console.error(`[CC-Viewer Proxy] Request body size: ${body.length}`);

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

        // [Crucial Fix]
        // If originalBaseUrl is also a proxy or special endpoint, make sure we construct the full URL correctly.
        // originalBaseUrl might end with /v1 or not.
        // req.url from proxy server is usually just the path (e.g. /v1/messages) if client is configured with base_url=http://localhost:port
        // So new URL(req.url, originalBaseUrl) should work.

        // However, if originalBaseUrl already contains a path (e.g. /api/anthropic), and req.url is /v1/messages,
        // new URL(req.url, originalBaseUrl) might treat req.url as absolute path if it starts with /, replacing the path in originalBaseUrl?
        // Let's test: new URL('/v1/messages', 'https://example.com/api').toString() -> 'https://example.com/v1/messages' (path replaced!)

        // This is why we get 404! The user's base URL is https://antchat.alipay.com/api/anthropic
        // But our proxy constructs: https://antchat.alipay.com/v1/messages
        // It lost the /api/anthropic part!

        // We need to append req.url to the pathname of originalBaseUrl, carefully avoiding double slashes.

        const originalUrlObj = new URL(originalBaseUrl);
        // Ensure original pathname doesn't end with slash if we append
        let basePath = originalUrlObj.pathname;
        if (basePath.endsWith('/')) basePath = basePath.slice(0, -1);

        // req.url starts with / usually
        const reqPath = req.url.startsWith('/') ? req.url : '/' + req.url;

        // Check if we should join them
        // If req.url is /v1/messages, and base is /api/anthropic, we want /api/anthropic/v1/messages
        originalUrlObj.pathname = basePath + reqPath;
        // Search params are already in req.url? Yes, req.url includes query string in Node http server.
        // Wait, new URL(req.url, base) parses query string correctly.
        // But if we manually concat pathname, we need to handle query string separately.

        // Let's do it simpler: use string concatenation for the full URL
        // But we need to handle the origin correctly.

        // Better approach:
        // 1. Remove trailing slash from originalBaseUrl
        const cleanBase = originalBaseUrl.endsWith('/') ? originalBaseUrl.slice(0, -1) : originalBaseUrl;
        // 2. Remove leading slash from req.url
        const cleanReq = req.url.startsWith('/') ? req.url.slice(1) : req.url;
        // 3. Join
        const fullUrl = `${cleanBase}/${cleanReq}`;

        // [Debug] Proxying to
        // console.error(`[CC-Viewer Proxy] Forwarding to: ${fullUrl}`);

        const response = await fetch(fullUrl, fetchOptions);

        // [Crucial Fix]
        // Handle decompression manually if needed.
        // Node's fetch automatically decompresses if 'compress: true' is default?
        // Actually, fetch handles gzip/deflate by default.
        // But if we pipe the response body to the client response (res), we need to be careful.
        // The issue is likely that we are trying to read the body as text/json for logging, 
        // but it might be compressed or binary.

        // Let's modify how we handle the response body.
        // We need to:
        // 1. Pipe the response to the client (res) so Claude Code gets the data.
        // 2. Clone the response to read it for logging? fetch response.clone() might not work with streaming body easily.

        // Better approach: intercept the stream.
        // Or simply: don't log the response body for now to avoid breaking the stream.
        // User just wants to see the request in the viewer.
        // If we want to log response, we need to handle it carefully.

        // Let's check where ZlibError comes from. It likely comes from `response.text()` or `response.json()` 
        // if the content-encoding header is set but fetch didn't decompress it automatically?
        // Or maybe we are double decompressing?

        // Wait, if we use `response.body.pipe(res)`, that's fine.
        // But do we read the body elsewhere?

        // Let's look at how we log the response.
        // We are not logging response body in this proxy.js currently.
        // Wait, line 105: `response.body.pipe(res);`

        // If the error happens, it might be because `fetch` failed to decompress?
        // Or maybe `response.body` is already decompressed stream, but we are piping it to `res` which expects raw?
        // No, `res` (http.ServerResponse) expects raw data.

        // If `fetch` decompresses automatically, then `response.body` yields decompressed chunks.
        // But `res` writes those chunks to the client.
        // The client (Claude Code) expects compressed data if it sent `Accept-Encoding: gzip`.
        // If we send decompressed data but keep `Content-Encoding: gzip` header, client will try to decompress again -> ZlibError!

        // FIX: Remove content-encoding header from response headers before piping to client.
        // This tells the client "the data I'm sending you is NOT compressed" (because fetch already decompressed it).

        const responseHeaders = {};
        for (const [key, value] of response.headers.entries()) {
          // Skip Content-Encoding and Transfer-Encoding to let Node/Client handle it
          if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-length') {
            responseHeaders[key] = value;
          }
        }

        res.writeHead(response.status, responseHeaders);

        // Also log that we are piping
        // console.error(`[CC-Viewer Proxy] Response status: ${response.status}`);

        if (response.body) {
          // We need to convert Web Stream (response.body) to Node Stream for piping to res
          // Node 18+ fetch returns a Web ReadableStream.
          // We can use Readable.fromWeb(response.body)
          const { Readable } = await import('node:stream');
          // @ts-ignore
          const nodeStream = Readable.fromWeb(response.body);
          nodeStream.pipe(res);

          // Optional: Log response body for debugging (careful with streams)
          // For now, let's just ensure reliability.
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
