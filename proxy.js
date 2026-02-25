
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setupInterceptor } from './interceptor.js';

// Setup interceptor to patch fetch
setupInterceptor();

function getOriginalBaseUrl() {
  // 1. Check env var (before it was overwritten by parent process if applicable, 
  // but here we assume this process is the parent or has the original env)
  if (process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_BASE_URL.includes('localhost')) {
    return process.env.ANTHROPIC_BASE_URL;
  }

  // 2. Check settings.json
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

  // 3. Default
  return 'https://api.anthropic.com';
}

export function startProxy() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      // Handle CORS preflight if needed (though claude cli probably doesn't send OPTIONS)

      const originalBaseUrl = getOriginalBaseUrl();
      const targetUrl = new URL(req.url, originalBaseUrl);

      // Use the patched fetch (which logs to cc-viewer)
      try {
        // Convert incoming headers
        const headers = { ...req.headers };
        delete headers.host; // Let fetch set the host

        // We need to read the body if any
        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const body = Buffer.concat(buffers);

        const fetchOptions = {
          method: req.method,
          headers: headers,
        };

        if (body.length > 0) {
          fetchOptions.body = body;
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);

        // Pipe response back
        res.writeHead(response.status, response.statusText, Object.fromEntries(response.headers.entries()));

        if (response.body) {
          // Node.js fetch returns a web stream, but we can iterate it
          // OR use response.arrayBuffer() if not streaming?
          // Claude responses are streaming (SSE). We must stream.
          // interceptor.js handles streaming response logging by cloning the stream or tapping into it.
          // Since interceptor.js patches fetch, the response we get here is already wrapped/tapped.
          // We just need to pipe it to res.

          // If response.body is a Node stream (undici), we can pipe.
          // If it's a Web Stream, we iterate.
          // Global fetch in Node 18+ (undici) returns Web Streams usually.

          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
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
