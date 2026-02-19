import { createServer } from 'node:http';
import { readFileSync, existsSync, watchFile, unwatchFile, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import { homedir } from 'node:os';
import { LOG_FILE } from './interceptor.js';
import { t } from './i18n.js';

const LOG_DIR = join(homedir(), '.claude', 'cc-viewer');
const SHOW_ALL_FILE = '/tmp/cc-viewer-show-all';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const START_PORT = 7008;
const MAX_PORT = 7099;
const HOST = '127.0.0.1';

let clients = [];
let server;
let actualPort = START_PORT;
// 跟踪所有被 watch 的日志文件
const watchedFiles = new Map();

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

function readLogFile() {
  if (!existsSync(LOG_FILE)) {
    return [];
  }

  try {
    const content = readFileSync(LOG_FILE, 'utf-8');
    const entries = content.split('\n---\n').filter(line => line.trim());
    return entries.map(entry => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    console.error('Error reading log file:', err);
    return [];
  }
}

function sendToClients(entry) {
  clients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch (err) {
      // Client disconnected
    }
  });
}

function watchLogFile(logFile) {
  if (watchedFiles.has(logFile)) return;
  let lastSize = 0;
  watchedFiles.set(logFile, true);
  watchFile(logFile, { interval: 500 }, () => {
    try {
      const content = readFileSync(logFile, 'utf-8');
      const newContent = content.slice(lastSize);
      lastSize = content.length;

      if (newContent.trim()) {
        const entries = newContent.split('\n---\n').filter(line => line.trim());
        entries.forEach(entry => {
          try {
            const parsed = JSON.parse(entry);
            sendToClients(parsed);
          } catch (err) {
            // Skip invalid entries
          }
        });
      }
    } catch (err) {
      // File not yet created, will retry on next poll
    }
  });
}

function startWatching() {
  watchLogFile(LOG_FILE);
}

function handleRequest(req, res) {
  const { url, method } = req;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 注册新的日志文件进行 watch（供新进程复用旧服务时调用）
  if (url === '/api/register-log' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { logFile } = JSON.parse(body);
        if (logFile && typeof logFile === 'string' && logFile.startsWith(LOG_DIR) && existsSync(logFile)) {
          watchLogFile(logFile);
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

  // SSE endpoint
  if (url === '/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    clients.push(res);

    const entries = readLogFile();
    entries.forEach(entry => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    req.on('close', () => {
      clients = clients.filter(client => client !== res);
    });
    return;
  }

  // API endpoint
  if (url === '/api/requests' && method === 'GET') {
    const entries = readLogFile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries));
    return;
  }

  // 查询是否显示全部请求（包括心跳）
  if (url === '/api/show-all' && method === 'GET') {
    const showAll = existsSync(SHOW_ALL_FILE);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ showAll }));
    return;
  }

  // 列出本地日志文件（按项目分组）
  if (url === '/api/local-logs' && method === 'GET') {
    try {
      const files = existsSync(LOG_DIR)
        ? readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse()
        : [];
      // 按项目名分组: {projectName: [{file, timestamp, size}]}
      const grouped = {};
      for (const f of files) {
        const match = f.match(/^(.+?)_(\d{8}_\d{6})\.jsonl$/);
        if (!match) continue;
        const project = match[1];
        const ts = match[2]; // 20260217_224218
        const filePath = join(LOG_DIR, f);
        const size = statSync(filePath).size;
        if (!grouped[project]) grouped[project] = [];
        grouped[project].push({ file: f, timestamp: ts, size });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(grouped));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 读取指定本地日志文件
  if (url.startsWith('/api/local-log?') && method === 'GET') {
    const params = new URLSearchParams(url.split('?')[1]);
    const file = params.get('file');
    if (!file || file.includes('..') || file.includes('/')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }
    const filePath = join(LOG_DIR, file);
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const content = readFileSync(filePath, 'utf-8');
      const entries = content.split('\n---\n').filter(line => line.trim()).map(entry => {
        try { return JSON.parse(entry); } catch { return null; }
      }).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 下载当前日志文件
  if (url === '/api/download-log' && method === 'GET') {
    try {
      if (!existsSync(LOG_FILE)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Log file not found' }));
        return;
      }
      const content = readFileSync(LOG_FILE);
      const fileName = basename(LOG_FILE);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': content.length,
      });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 静态文件服务
  if (method === 'GET') {
    let filePath = url === '/' ? '/index.html' : url;
    // 去掉 query string
    filePath = filePath.split('?')[0];

    const fullPath = join(__dirname, 'dist', filePath);

    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const content = readFileSync(fullPath);
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
        return;
      }
    } catch (err) {
      // fall through to SPA fallback
    }

    // SPA fallback: 非 API/非静态文件请求返回 index.html
    try {
      const indexPath = join(__dirname, 'dist', 'index.html');
      const html = readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

export async function startViewer() {
  return new Promise((resolve, reject) => {
    function tryListen(port) {
      if (port > MAX_PORT) {
        console.log(t('server.portsBusy', { start: START_PORT, end: MAX_PORT }));
        resolve(null);
        return;
      }

      const currentServer = createServer(handleRequest);

      currentServer.listen(port, HOST, () => {
        server = currentServer;
        actualPort = port;
        console.log(t('server.started', { host: HOST, port }));
        startWatching();
        resolve(server);
      });

      currentServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });
    }

    tryListen(START_PORT);
  });
}

export function stopViewer() {
  for (const logFile of watchedFiles.keys()) {
    unwatchFile(logFile);
  }
  watchedFiles.clear();
  clients.forEach(client => client.end());
  clients = [];
  if (server) {
    server.close();
  }
}

// Auto-start the viewer when imported
startViewer().catch(err => {
  console.error('Failed to start CC Viewer:', err);
});
