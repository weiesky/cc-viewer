import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, statSync, readdirSync, renameSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { homedir, userInfo, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { LOG_FILE, _initPromise, _resumeState, resolveResumeChoice, _projectName, _logDir, _cachedApiKey, _cachedAuthHeader, _cachedHaikuModel } from './interceptor.js';
import { LOG_DIR } from './findcc.js';
import { t, detectLanguage } from './i18n.js';
import { checkAndUpdate } from './updater.js';

const PREFS_FILE = join(LOG_DIR, 'preferences.json');


// macOS user profile (avatar + display name), cached once
let _userProfile = null;
function getUserProfile() {
  if (_userProfile) return _userProfile;
  const info = userInfo();
  const name = info.username || 'User';
  let displayName = name;
  let avatarBase64 = null;

  if (platform() === 'darwin') {
    try {
      const rn = execSync(`dscl . -read /Users/${name} RealName`, { encoding: 'utf-8', timeout: 3000 });
      const match = rn.match(/RealName:\n?\s*(.+)/);
      if (match && match[1].trim()) displayName = match[1].trim();
    } catch { }

    try {
      const buf = execSync(`dscl . -read /Users/${name} JPEGPhoto | tail -1 | xxd -r -p`, { timeout: 5000, maxBuffer: 1024 * 1024 });
      if (buf && buf.length > 100) {
        avatarBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
      }
    } catch { }
  }

  _userProfile = { name: displayName, avatar: avatarBase64 };
  return _userProfile;
}

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
// Stats Worker 实例
let statsWorker = null;

function startStatsWorker() {
  try {
    statsWorker = new Worker(new URL('./stats-worker.js', import.meta.url));
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

function readLogFile() {
  if (!existsSync(LOG_FILE)) {
    return [];
  }

  try {
    const content = readFileSync(LOG_FILE, 'utf-8');
    const entries = content.split('\n---\n').filter(line => line.trim());
    const parsed = entries.map(entry => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    }).filter(Boolean);
    // 去重：同一 timestamp+url 的条目，后出现的（带 response）覆盖先出现的（在途）
    const map = new Map();
    for (const entry of parsed) {
      const key = `${entry.timestamp}|${entry.url}`;
      map.set(key, entry);
    }
    return Array.from(map.values());
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
        // 通知 stats worker 更新统计
        notifyStatsWorker(logFile);
      }

      // 检测日志文件是否已轮转到新文件
      if (LOG_FILE !== logFile && !watchedFiles.has(LOG_FILE)) {
        // 轮转发生，发送 full_reload 让客户端重新加载新文件
        const newEntries = readLogFile();
        clients.forEach(client => {
          try {
            client.write(`event: full_reload\ndata: ${JSON.stringify(newEntries)}\n\n`);
          } catch { }
        });
        watchLogFile(LOG_FILE);
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

  // User preferences API
  if (url === '/api/preferences' && method === 'GET') {
    let prefs = {};
    try { if (existsSync(PREFS_FILE)) prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8')); } catch { }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(prefs));
    return;
  }

  if (url === '/api/preferences' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        let prefs = {};
        try { if (existsSync(PREFS_FILE)) prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8')); } catch { }
        Object.assign(prefs, incoming);
        writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prefs));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
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

  // 用户选择继续/新开日志
  if (url === '/api/resume-choice' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { choice } = JSON.parse(body);
        if (choice !== 'continue' && choice !== 'new') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid choice' }));
          return;
        }
        const result = resolveResumeChoice(choice);
        if (!result) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Already resolved' }));
          return;
        }
        // 重新 watch 最终的日志文件
        watchLogFile(result.logFile);
        // 广播 resume_resolved + full_reload
        const resolvedData = JSON.stringify({ logFile: result.logFile });
        clients.forEach(client => {
          try {
            client.write(`event: resume_resolved\ndata: ${resolvedData}\n\n`);
          } catch { }
        });
        // 发送 full_reload 让客户端重新加载数据
        const entries = readLogFile();
        clients.forEach(client => {
          try {
            client.write(`event: full_reload\ndata: ${JSON.stringify(entries)}\n\n`);
          } catch { }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, logFile: result.logFile }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // 翻译 API
  if (url === '/api/translate' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { text, from = 'en', to } = JSON.parse(body);
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "text" field' }));
          return;
        }

        // 确定目标语言
        let targetLang = to;
        if (!targetLang) {
          try {
            if (existsSync(PREFS_FILE)) {
              const prefs = JSON.parse(readFileSync(PREFS_FILE, 'utf-8'));
              if (prefs.lang) targetLang = prefs.lang;
            }
          } catch { }
          if (!targetLang) targetLang = detectLanguage();
        }

        // 源语言与目标语言相同，直接返回
        if (targetLang === from) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text, from, to: targetLang }));
          return;
        }

        // 获取 API Key（仅 x-api-key 认证，不复用 session token 避免上下文污染）
        // 优先级: 环境变量 > 拦截缓存 > 从 authHeader 中提取 sk- 开头的 key
        let apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || _cachedApiKey;
        if (!apiKey && _cachedAuthHeader) {
          // Bearer sk-xxx 格式：提取实际的 API key
          const m = _cachedAuthHeader.match(/^Bearer\s+(sk-\S+)$/i);
          if (m) apiKey = m[1];
        }
        if (!apiKey) {
          res.writeHead(501, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No API key available. Set ANTHROPIC_API_KEY or use x-api-key authentication.' }));
          return;
        }

        const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
        const inputText = Array.isArray(text) ? text.join('\n---SPLIT---\n') : text;

        const reqHeaders = {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': apiKey,
          'x-cc-viewer-internal': '1',
        };

        const apiRes = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify({
            model: _cachedHaikuModel || 'claude-haiku-4-5-20251001',
            max_tokens: 32000,
            tools: [],
            system: [{
              type: "text",
              text: `You are a translator. Translate the following text from ${from} to ${targetLang}. Output only the translated text, nothing else.`
            }],
            messages: [{ role: 'user', content: inputText }],
            stream: false,
            temperature: 1,
          }),
        });

        if (!apiRes.ok) {
          const errBody = await apiRes.text();
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Translation API failed', status: apiRes.status, detail: errBody }));
          return;
        }

        const apiData = await apiRes.json();
        let translated = apiData.content?.[0]?.text || '';

        // 如果输入是数组，拆分回数组
        if (Array.isArray(text)) {
          translated = translated.split(/\n?---SPLIT---\n?/);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: translated, from, to: targetLang }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error', message: err.message }));
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

    // 如果有待决的 resume 选择，发送 resume_prompt 事件
    if (_resumeState) {
      res.write(`event: resume_prompt\ndata: ${JSON.stringify({ recentFileName: _resumeState.recentFileName })}\n\n`);
    }

    const entries = readLogFile();
    // 初始化时发送 full_reload 事件（而非逐条发送），让前端可以批量处理时间戳
    res.write(`event: full_reload\ndata: ${JSON.stringify(entries)}\n\n`);

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

  // 当前监控的项目名称
  if (url === '/api/project-name' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ projectName: _projectName || '' }));
    return;
  }

  // 当前版本号
  if (url === '/api/version-info' && method === 'GET') {
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: pkg.version }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read version' }));
    }
    return;
  }

  // 项目统计数据
  if (url === '/api/project-stats' && method === 'GET') {
    try {
      if (!_projectName) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No project name' }));
        return;
      }
      const statsFile = join(LOG_DIR, _projectName, `${_projectName}.json`);
      if (!existsSync(statsFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stats file not found' }));
        return;
      }
      const stats = readFileSync(statsFile, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(stats);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 所有项目统计数据
  if (url === '/api/all-project-stats' && method === 'GET') {
    try {
      const allStats = {};
      if (existsSync(LOG_DIR)) {
        const entries = readdirSync(LOG_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const project = entry.name;
          const statsFile = join(LOG_DIR, project, `${project}.json`);
          if (existsSync(statsFile)) {
            try {
              allStats[project] = JSON.parse(readFileSync(statsFile, 'utf-8'));
            } catch { }
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(allStats));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // macOS 用户头像和显示名
  if (url === '/api/user-profile' && method === 'GET') {
    const profile = getUserProfile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profile));
    return;
  }

  // 列出本地日志文件（按项目分组，遍历项目子目录）
  if (url === '/api/local-logs' && method === 'GET') {
    try {
      const grouped = {};
      if (existsSync(LOG_DIR)) {
        const entries = readdirSync(LOG_DIR, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const project = entry.name;
          const projectDir = join(LOG_DIR, project);
          const files = readdirSync(projectDir)
            .filter(f => f.endsWith('.jsonl'))
            .sort()
            .reverse();
          // 从项目统计缓存中读取 per-file 数据，避免逐文件扫描
          let statsFiles = null;
          try {
            const statsFile = join(projectDir, `${project}.json`);
            if (existsSync(statsFile)) {
              statsFiles = JSON.parse(readFileSync(statsFile, 'utf-8')).files;
            }
          } catch { }
          for (const f of files) {
            const match = f.match(/^(.+?)_(\d{8}_\d{6})\.jsonl$/);
            if (!match) continue;
            const ts = match[2];
            const filePath = join(projectDir, f);
            const size = statSync(filePath).size;
            const turns = statsFiles?.[f]?.summary?.sessionCount || 0;
            if (!grouped[project]) grouped[project] = [];
            grouped[project].push({ file: `${project}/${f}`, timestamp: ts, size, turns });
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...grouped, _currentProject: _projectName || '' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 读取指定本地日志文件（支持 project/file 路径）
  if (url.startsWith('/api/local-log?') && method === 'GET') {
    const params = new URLSearchParams(url.split('?')[1]);
    const file = params.get('file');
    if (!file || file.includes('..')) {
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

  // 合并日志文件
  if (url === '/api/merge-logs' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { files } = JSON.parse(body);
        if (!Array.isArray(files) || files.length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'At least 2 files required' }));
          return;
        }
        // 校验所有文件属于同一 project
        const projects = new Set(files.map(f => f.split('/')[0]));
        if (projects.size !== 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'All files must belong to the same project' }));
          return;
        }
        // 校验文件存在且无路径穿越
        for (const f of files) {
          if (f.includes('..')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid file path' }));
            return;
          }
          if (!existsSync(join(LOG_DIR, f))) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `File not found: ${f}` }));
            return;
          }
        }
        // files 已按时间正序传入，合并内容写入第一个文件
        const targetFile = files[0];
        const targetPath = join(LOG_DIR, targetFile);
        const contents = files.map(f => readFileSync(join(LOG_DIR, f), 'utf-8').trimEnd());
        writeFileSync(targetPath, contents.join('\n---\n') + '\n');
        // 删除其余文件
        for (let i = 1; i < files.length; i++) {
          unlinkSync(join(LOG_DIR, files[i]));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, merged: targetFile }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /api/concept?lang=zh&doc=Tool-Bash
  if (method === 'GET' && url.startsWith('/api/concept')) {
    const conceptParams = new URL(url, 'http://localhost').searchParams;
    const lang = conceptParams.get('lang') || 'zh';
    const doc = conceptParams.get('doc') || '';
    // 安全校验：只允许字母、数字、连字符
    if (!/^[a-zA-Z0-9-]+$/.test(doc) || !/^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(lang)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid parameters' }));
      return;
    }
    let mdPath = join(__dirname, 'concepts', lang, `${doc}.md`);
    if (!existsSync(mdPath) && lang !== 'zh') {
      mdPath = join(__dirname, 'concepts', 'zh', `${doc}.md`);
    }
    if (existsSync(mdPath)) {
      const content = readFileSync(mdPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(content);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
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
        console.error(t('server.portsBusy', { start: START_PORT, end: MAX_PORT }));
        resolve(null);
        return;
      }

      const currentServer = createServer(handleRequest);

      currentServer.listen(port, HOST, () => {
        server = currentServer;
        actualPort = port;
        const url = `http://${HOST}:${port}`;
        console.error(t('server.started', { host: HOST, port }));
        // v2.0.69 之前的版本会清空控制台，自动打开浏览器确保用户能看到界面
        try {
          const ccPkgPath = join(__dirname, '..', '@anthropic-ai', 'claude-code', 'package.json');
          const ccVer = JSON.parse(readFileSync(ccPkgPath, 'utf-8')).version;
          const [maj, min, pat] = ccVer.split('.').map(Number);
          if (maj < 2 || (maj === 2 && min === 0 && pat < 69)) {
            const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
            execSync(`${cmd} ${url}`, { stdio: 'ignore', timeout: 5000 });
          }
        } catch { }
        startWatching();
        startStatsWorker();
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
  // 如果用户未做选择，将临时文件转为正式文件
  if (_resumeState && _resumeState.tempFile) {
    try {
      const { tempFile } = _resumeState;
      if (existsSync(tempFile)) {
        const newPath = tempFile.replace('_temp.jsonl', '.jsonl');
        renameSync(tempFile, newPath);
      }
    } catch { }
  }
  for (const logFile of watchedFiles.keys()) {
    unwatchFile(logFile);
  }
  watchedFiles.clear();
  clients.forEach(client => client.end());
  clients = [];
  if (server) {
    server.close();
  }
  if (statsWorker) {
    statsWorker.terminate();
    statsWorker = null;
  }
}

// Auto-start the viewer after log file init completes
_initPromise.then(() => {
  startViewer().then((srv) => {
    if (!srv) return;
    // 延迟 3 秒异步检查更新
    setTimeout(() => {
      checkAndUpdate().then(result => {
        if (result.status === 'updated') {
          clients.forEach(client => {
            try { client.write(`event: update_completed\ndata: ${JSON.stringify({ version: result.remoteVersion })}\n\n`); } catch { }
          });
        } else if (result.status === 'major_available') {
          clients.forEach(client => {
            try { client.write(`event: update_major_available\ndata: ${JSON.stringify({ version: result.remoteVersion })}\n\n`); } catch { }
          });
        }
      }).catch(() => { });
    }, 3000);
  }).catch(err => {
    console.error('Failed to start CC Viewer:', err);
  });
});

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
process.on('exit', handleExit);
process.on('SIGINT', () => { handleExit(); process.exit(); });
process.on('SIGTERM', () => { handleExit(); process.exit(); });
