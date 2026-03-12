import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, statSync, readdirSync, renameSync, unlinkSync, openSync, readSync, closeSync, realpathSync, mkdirSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { homedir, userInfo, platform, networkInterfaces } from 'node:os';
import { execFile, exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// execFile with stdin input support (for git check-ignore --stdin)
function execWithStdin(cmd, args, input, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      // git check-ignore exits 1 when no files are ignored — treat as success
      resolve(stdout);
    });
    if (options?.timeout) {
      setTimeout(() => { try { child.kill(); } catch {} reject(new Error('timeout')); }, options.timeout);
    }
    child.stdin.write(input);
    child.stdin.end();
  });
}
import { LOG_FILE, _initPromise, _resumeState, resolveResumeChoice, _projectName, _logDir, _cachedApiKey, _cachedAuthHeader, _cachedHaikuModel, initForWorkspace, resetWorkspace } from './interceptor.js';
import { LOG_DIR } from './findcc.js';
import { t, detectLanguage } from './i18n.js';
import { checkAndUpdate } from './lib/updater.js';
import { loadPlugins, runWaterfallHook, runParallelHook, getPluginsInfo, PLUGINS_DIR } from './lib/plugin-loader.js';

const PREFS_FILE = join(LOG_DIR, 'preferences.json');
const isCliMode = process.env.CCV_CLI_MODE === '1';
const isWorkspaceMode = process.env.CCV_WORKSPACE_MODE === '1';

// 统一的文件/目录忽略规则（仅隐藏系统和版本控制目录）
const IGNORED_PATTERNS = new Set([
  '.git', '.svn', '.hg', '.DS_Store',
  '.idea', '.vscode'
]);

// 工作区模式：保存 Claude 额外参数，供 launch API 使用
let _workspaceClaudeArgs = [];
let _workspaceClaudePath = null;
let _workspaceIsNpmVersion = false;
let _workspaceLaunched = false; // 工作区是否已经启动了会话

// Editor session state (for $EDITOR intercept)
const editorSessions = new Map(); // sessionId → { filePath, done }
let terminalWss = null; // WebSocketServer reference for broadcasting
export function setWorkspaceClaudeArgs(args) {
  _workspaceClaudeArgs = args;
}
export function setWorkspaceClaudePath(path, isNpm) {
  _workspaceClaudePath = path;
  _workspaceIsNpmVersion = isNpm;
}


// macOS user profile (avatar + display name), cached once
let _userProfile = null;
let _userProfilePromise = null;
async function getUserProfile() {
  if (_userProfile) return _userProfile;
  if (_userProfilePromise) return _userProfilePromise;
  _userProfilePromise = _getUserProfileImpl();
  _userProfile = await _userProfilePromise;
  _userProfilePromise = null;
  return _userProfile;
}
async function _getUserProfileImpl() {
  const info = userInfo();
  const name = info.username || 'User';
  let displayName = name;
  let avatarBase64 = null;

  if (platform() === 'darwin') {
    try {
      const { stdout: rn } = await execFileAsync('dscl', ['.', '-read', `/Users/${name}`, 'RealName'], { encoding: 'utf-8', timeout: 3000 });
      const match = rn.match(/RealName:\n?\s*(.+)/);
      if (match && match[1].trim()) displayName = match[1].trim();
    } catch { }

    try {
      const { stdout } = await execAsync(`dscl . -read /Users/${name} JPEGPhoto | tail -1 | xxd -r -p`, { timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'buffer' });
      if (stdout && stdout.length > 100) {
        avatarBase64 = `data:image/jpeg;base64,${stdout.toString('base64')}`;
      }
    } catch { }
  }

  return { name: displayName, avatar: avatarBase64 };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const START_PORT = 7008;
const MAX_PORT = 7099;
const HOST = '0.0.0.0';

// 局域网访问 token（本地 127.0.0.1 免验证）
const ACCESS_TOKEN = randomBytes(16).toString('hex');

let clients = [];
let server;
let actualPort = 0;
let serverProtocol = 'http';
// 跟踪所有被 watch 的日志文件
const watchedFiles = new Map();
// Stats Worker 实例
let statsWorker = null;

function startStatsWorker() {
  try {
    statsWorker = new Worker(new URL('./lib/stats-worker.js', import.meta.url));
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
            runParallelHook('onNewEntry', parsed).catch(() => {});
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

function getLocalIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const url = parsedUrl.pathname;
  const method = req.method;

  // WebSocket 路径不处理，交给 upgrade 事件
  if (url === '/ws/terminal') {
    return;
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 局域网访问 token 验证（本地 127.0.0.1 / ::1 免验证，静态资源免验证）
  const remoteIp = req.socket.remoteAddress;
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  const isStaticAsset = url.startsWith('/assets/') || url === '/favicon.ico';
  if (!isLocal && !isStaticAsset) {
    const urlToken = parsedUrl.searchParams.get('token');
    if (urlToken !== ACCESS_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid token' }));
      return;
    }
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

  // === Workspace API ===

  // 目录浏览器
  if (url.startsWith('/api/browse-dir') && method === 'GET') {
    try {
      const dirPath = parsedUrl.searchParams.get('path') || homedir();
      if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid directory' }));
        return;
      }
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const dirs = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.') continue;
        const fullPath = join(dirPath, entry.name);
        let hasGit = false;
        try { hasGit = existsSync(join(fullPath, '.git')); } catch {}
        dirs.push({ name: entry.name, path: fullPath, hasGit });
      }
      dirs.sort((a, b) => {
        if (a.hasGit !== b.hasGit) return a.hasGit ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const parent = join(dirPath, '..');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ current: dirPath, parent: parent !== dirPath ? parent : null, dirs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/api/workspaces' && method === 'GET') {
    import('./workspace-registry.js').then(({ getWorkspaces }) => {
      const workspaces = getWorkspaces();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workspaces, workspaceMode: isWorkspaceMode && !_workspaceLaunched }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (url === '/api/workspaces/launch' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { path: wsPath } = JSON.parse(body);
        if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid directory path' }));
          return;
        }

        const { registerWorkspace } = await import('./workspace-registry.js');
        registerWorkspace(wsPath);

        // 初始化 interceptor 的日志文件
        const result = initForWorkspace(wsPath);
        process.env.CCV_PROJECT_DIR = wsPath;

        // 启动日志监听
        watchLogFile(LOG_FILE);

        // 启动 stats worker（如果尚未启动）
        if (!statsWorker) startStatsWorker();

        // 启动 PTY
        const proxyPort = process.env.CCV_PROXY_PORT;
        if (proxyPort) {
          const { spawnClaude } = await import('./pty-manager.js');
          await spawnClaude(parseInt(proxyPort), wsPath, _workspaceClaudeArgs, _workspaceClaudePath, _workspaceIsNpmVersion, actualPort);
        }

        _workspaceLaunched = true;

        // 通知所有 SSE 客户端
        clients.forEach(client => {
          try {
            client.write(`event: workspace_started\ndata: ${JSON.stringify({ projectName: result.projectName, path: wsPath })}\n\n`);
          } catch {}
        });

        // 发送 full_reload 以刷新会话区域
        const entries = readLogFile();
        clients.forEach(client => {
          try {
            client.write(`event: full_reload\ndata: ${JSON.stringify(entries)}\n\n`);
          } catch {}
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, projectName: result.projectName }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url === '/api/workspaces/add' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { path: wsPath } = JSON.parse(body);
        if (!wsPath || !existsSync(wsPath) || !statSync(wsPath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid directory path' }));
          return;
        }
        const { registerWorkspace } = await import('./workspace-registry.js');
        const entry = registerWorkspace(wsPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workspace: entry }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (url.startsWith('/api/workspaces/') && method === 'DELETE') {
    const id = url.split('/').pop();
    import('./workspace-registry.js').then(({ removeWorkspace }) => {
      const removed = removeWorkspace(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: removed }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  if (url === '/api/workspaces/stop' && method === 'POST') {
    import('./pty-manager.js').then(({ killPty }) => {
      killPty();

      // 停止日志监听
      for (const logFile of watchedFiles.keys()) {
        unwatchFile(logFile);
      }
      watchedFiles.clear();

      // 重置 interceptor 状态
      resetWorkspace();
      _workspaceLaunched = false;

      // 通知所有 SSE 客户端
      clients.forEach(client => {
        try {
          client.write(`event: workspace_stopped\ndata: {}\n\n`);
        } catch {}
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
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
    // 增量加载：客户端传 since（最后条目时间戳）和 cc（缓存条目数）
    const since = parsedUrl.searchParams.get('since');
    const cc = parseInt(parsedUrl.searchParams.get('cc') || '0', 10);
    let entriesToSend = entries;
    let incremental = false;
    if (since && cc > 0) {
      const sinceMs = new Date(since).getTime();
      if (!isNaN(sinceMs)) {
        const delta = entries.filter(e => e.timestamp && new Date(e.timestamp).getTime() > sinceMs);
        if (cc + delta.length === entries.length) {
          entriesToSend = delta;
          incremental = true;
        }
      }
    }
    // 分段发送：先告知总数，再分块传输，让前端能显示真实加载进度
    const CHUNK_SIZE = 50;
    if (entriesToSend.length > CHUNK_SIZE) {
      res.write(`event: load_start\ndata: ${JSON.stringify({ total: entriesToSend.length, incremental })}\n\n`);
      for (let i = 0; i < entriesToSend.length; i += CHUNK_SIZE) {
        const chunk = entriesToSend.slice(i, i + CHUNK_SIZE);
        res.write(`event: load_chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write(`event: load_end\ndata: {}\n\n`);
    } else if (incremental) {
      // 增量模式：即使条目少也走 load_start/load_end 流程（可能 0 条新数据）
      res.write(`event: load_start\ndata: ${JSON.stringify({ total: entriesToSend.length, incremental: true })}\n\n`);
      if (entriesToSend.length > 0) {
        res.write(`event: load_chunk\ndata: ${JSON.stringify(entriesToSend)}\n\n`);
      }
      res.write(`event: load_end\ndata: {}\n\n`);
    } else {
      res.write(`event: full_reload\ndata: ${JSON.stringify(entriesToSend)}\n\n`);
    }

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
    const profile = await getUserProfile();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(profile));
    return;
  }

  // 文件浏览器 API（CLI 模式下项目目录浏览）
  if (url === '/api/files' && method === 'GET') {
    const reqPath = parsedUrl.searchParams.get('path') || '.';
    // 安全校验：拒绝绝对路径和 .. 路径穿越
    if (reqPath.startsWith('/') || reqPath.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    const targetDir = join(cwd, reqPath);
    try {
      const entries = readdirSync(targetDir, { withFileTypes: true });
      const items = entries
        .filter(e => !IGNORED_PATTERNS.has(e.name))
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      // 使用 git check-ignore 批量检测被 .gitignore 忽略的文件
      let gitIgnoredSet = new Set();
      try {
        const names = items.map(i => {
          const rel = reqPath === '.' ? i.name : `${reqPath}/${i.name}`;
          return i.type === 'directory' ? `${rel}/` : rel;
        });
        if (names.length > 0) {
          const result = await execWithStdin('git', ['check-ignore', '--stdin'], names.join('\n'), {
            cwd,
            timeout: 3000,
          });
          result.split('\n').filter(Boolean).forEach(line => {
            const name = line.endsWith('/') ? line.slice(0, -1) : line;
            const baseName = name.includes('/') ? name.split('/').pop() : name;
            gitIgnoredSet.add(baseName);
          });
        }
      } catch { /* git 未安装或非 git 仓库，忽略 */ }
      const result = items.map(i => gitIgnoredSet.has(i.name) ? { ...i, gitIgnored: true } : i);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Directory not found' }));
    }
    return;
  }

  // === Editor session API (for $EDITOR intercept) ===

  if (url === '/api/editor-open' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sessionId, filePath } = JSON.parse(body);
        if (!sessionId || !filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing sessionId or filePath' }));
          return;
        }
        editorSessions.set(sessionId, { filePath, done: false });
        // Broadcast to all terminal WebSocket clients
        if (terminalWss) {
          const msg = JSON.stringify({ type: 'editor-open', sessionId, filePath });
          terminalWss.clients.forEach(client => {
            if (client.readyState === 1) {
              try { client.send(msg); } catch {}
            }
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  if (url.startsWith('/api/editor-status') && method === 'GET') {
    const id = parsedUrl.searchParams.get('id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing id' }));
      return;
    }
    const session = editorSessions.get(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ done: session ? session.done : true }));
    return;
  }

  if (url === '/api/editor-done' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sessionId } = JSON.parse(body);
        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing sessionId' }));
          return;
        }
        const session = editorSessions.get(sessionId);
        if (session) {
          session.done = true;
        }
        // Clean up after a short delay to allow the polling to pick it up
        setTimeout(() => editorSessions.delete(sessionId), 5000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  // 读取文件内容 API
  if (url === '/api/file-content' && method === 'GET') {
    const reqPath = parsedUrl.searchParams.get('path');
    const isEditorSession = parsedUrl.searchParams.get('editorSession') === 'true';
    if (!reqPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    // Allow absolute paths only for editor sessions
    if (!isEditorSession && (reqPath.startsWith('/') || reqPath.includes('..'))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    const targetFile = isEditorSession && reqPath.startsWith('/') ? reqPath : join(process.env.CCV_PROJECT_DIR || process.cwd(), reqPath);
    try {
      if (!existsSync(targetFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `File not found: ${targetFile}` }));
        return;
      }
      const stat = statSync(targetFile);
      if (!stat.isFile()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not a file' }));
        return;
      }
      // 限制文件大小 5MB
      if (stat.size > 5 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large' }));
        return;
      }
      const content = readFileSync(targetFile, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: reqPath, content, size: stat.size }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Cannot read file: ${err.message}` }));
    }
    return;
  }

  // 保存文件内容 API
  if (url === '/api/file-content' && method === 'POST') {
    const MAX_BODY = 5 * 1024 * 1024; // 5MB，与 GET 路由限制对齐
    let body = '';
    let overflow = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { overflow = true; req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      try {
        const { path: reqPath, content, editorSession } = JSON.parse(body);
        if (!reqPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        // Allow absolute paths only for editor sessions
        if (!editorSession && (reqPath.startsWith('/') || reqPath.includes('..'))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid path' }));
          return;
        }
        if (typeof content !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Content must be a string' }));
          return;
        }
        const targetFile = editorSession && reqPath.startsWith('/') ? reqPath : join(process.env.CCV_PROJECT_DIR || process.cwd(), reqPath);
        writeFileSync(targetFile, content, 'utf-8');
        const stat = statSync(targetFile);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, size: stat.size }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Cannot save file: ${err.message}` }));
      }
    });
    return;
  }

  // CLI 模式检测
  if (url === '/api/cli-mode' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cliMode: isCliMode, workspaceMode: isWorkspaceMode && !_workspaceLaunched }));
    return;
  }

  // Git 状态
  if (url === '/api/git-status' && method === 'GET') {
    try {
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const { stdout: output } = await execFileAsync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8', timeout: 5000 });
      const lines = output.split('\n').filter(line => line.trim());
      const changes = lines.map(line => {
        const status = line.substring(0, 2).trim();
        const file = line.substring(3).trim();
        return { status, file };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ changes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, changes: [] }));
    }
    return;
  }

  // Git diff 数据获取
  if (url.startsWith('/api/git-diff') && method === 'GET') {
    try {
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const filesParam = parsedUrl.searchParams.get('files');

      if (!filesParam) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing files parameter' }));
        return;
      }

      const files = filesParam.split(',').map(f => f.trim()).filter(Boolean);
      const diffs = [];

      for (const file of files) {
        // 安全检查：防止路径穿越
        if (file.includes('..') || file.startsWith('/')) continue;

        try {
          const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain', '--', file], { cwd, encoding: 'utf-8', timeout: 3000 });
          if (!statusOutput.trim()) continue;

          const status = statusOutput.substring(0, 2).trim();
          const is_new = status === 'A' || status === '??';
          const is_deleted = status === 'D';

          // 检查是否为二进制文件（已删除文件跳过）
          let is_binary = false;
          if (!is_deleted) {
            try {
              const { stdout: diffCheck } = await execFileAsync('git', ['diff', '--numstat', 'HEAD', '--', file], { cwd, encoding: 'utf-8', timeout: 3000 });
              if (diffCheck.includes('-\t-\t')) {
                is_binary = true;
              }
            } catch {}
          }

          let old_content = '';
          let new_content = '';

          if (!is_binary) {
            // 获取旧内容（HEAD 版本）
            if (!is_new) {
              try {
                const { stdout } = await execFileAsync('git', ['show', `HEAD:${file}`], { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 5 * 1024 * 1024 });
                old_content = stdout;
              } catch {
                old_content = '';
              }
            }

            // 获取新内容（工作区版本）
            if (!is_deleted) {
              try {
                const filePath = join(cwd, file);
                if (existsSync(filePath)) {
                  const stat = statSync(filePath);
                  if (stat.size > 5 * 1024 * 1024) {
                    // 文件过大
                    diffs.push({ file, status, is_large: true, size: stat.size });
                    continue;
                  }
                  new_content = readFileSync(filePath, 'utf-8');
                }
              } catch {
                new_content = '';
              }
            }
          }

          diffs.push({
            file,
            status,
            old_content,
            new_content,
            is_binary,
            is_new,
            is_deleted
          });
        } catch (err) {
          // 跳过无法处理的文件
          continue;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ diffs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, diffs: [] }));
    }
    return;
  }

  // 插件管理 API
  if (url === '/api/plugins' && method === 'GET') {
    const plugins = getPluginsInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ plugins, pluginsDir: PLUGINS_DIR }));
    return;
  }

  if (url === '/api/plugins' && method === 'DELETE') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }
    const filePath = join(PLUGINS_DIR, file);
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      unlinkSync(filePath);
      await loadPlugins();
      const plugins = getPluginsInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/api/plugins/reload' && method === 'POST') {
    try {
      await loadPlugins();
      const plugins = getPluginsInfo();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url === '/api/plugins/upload' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { files: fileList } = JSON.parse(body);
        if (!Array.isArray(fileList) || fileList.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No files provided' }));
          return;
        }
        // 确保插件目录存在
        if (!existsSync(PLUGINS_DIR)) {
          mkdirSync(PLUGINS_DIR, { recursive: true });
        }
        for (const { name, content } of fileList) {
          if (!name || typeof content !== 'string') continue;
          const filename = name.replace(/.*[/\\]/, '');
          if (!filename.endsWith('.js') && !filename.endsWith('.mjs')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Only .js or .mjs files are allowed' }));
            return;
          }
          if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid file name' }));
            return;
          }
          writeFileSync(join(PLUGINS_DIR, filename), content, 'utf-8');
        }
        await loadPlugins();
        const plugins = getPluginsInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, plugins, pluginsDir: PLUGINS_DIR }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 返回局域网访问地址
  if (url === '/api/local-url' && method === 'GET') {
    const localIp = getLocalIp();
    const defaultUrl = `${serverProtocol}://${localIp}:${actualPort}?token=${ACCESS_TOKEN}`;
    const hookResult = await runWaterfallHook('localUrl', { url: defaultUrl, ip: localIp, port: actualPort, token: ACCESS_TOKEN });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ url: hookResult.url }));
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

  // 下载指定本地日志文件（原始 JSONL 格式）
  if (url === '/api/download-log' && method === 'GET') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }
    if (!file.endsWith('.jsonl')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file type' }));
      return;
    }
    const filePath = join(LOG_DIR, file);
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const realPath = realpathSync(filePath);
      const realLogDir = realpathSync(LOG_DIR);
      if (!realPath.startsWith(realLogDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
      }
      const fileName = file.split('/').pop();
      const stat = statSync(realPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': stat.size,
      });
      const stream = createReadStream(realPath);
      stream.pipe(res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 读取指定本地日志文件（支持 project/file 路径）
  if (url === '/api/local-log' && method === 'GET') {
    const file = parsedUrl.searchParams.get('file');
    if (!file || file.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file name' }));
      return;
    }

    // 验证文件类型：只允许 .jsonl 文件
    if (!file.endsWith('.jsonl')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid file type. Only .jsonl files are allowed.' }));
      return;
    }

    const filePath = join(LOG_DIR, file);
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }

      // 验证文件确实在 LOG_DIR 内（防止路径穿越）
      const realPath = realpathSync(filePath);
      const realLogDir = realpathSync(LOG_DIR);
      if (!realPath.startsWith(realLogDir)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
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

  // 删除日志文件
  if (url === '/api/delete-logs' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { files } = JSON.parse(body);
        if (!Array.isArray(files) || files.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No files specified' }));
          return;
        }
        const results = [];
        for (const file of files) {
          if (!file || file.includes('..') || !file.endsWith('.jsonl')) {
            results.push({ file, error: 'Invalid file name' });
            continue;
          }
          const filePath = join(LOG_DIR, file);
          try {
            if (!existsSync(filePath)) {
              results.push({ file, error: 'Not found' });
              continue;
            }
            const realPath = realpathSync(filePath);
            const realLogDir = realpathSync(LOG_DIR);
            if (!realPath.startsWith(realLogDir)) {
              results.push({ file, error: 'Access denied' });
              continue;
            }
            unlinkSync(realPath);
            results.push({ file, ok: true });
          } catch (err) {
            results.push({ file, error: err.message });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
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
        // files 已按时间正序传入，校验合并后总大小不超过 300MB
        const MAX_MERGE_SIZE = 300 * 1024 * 1024;
        let totalSize = 0;
        for (const f of files) {
          totalSize += statSync(join(LOG_DIR, f)).size;
        }
        if (totalSize > MAX_MERGE_SIZE) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Merged size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds 300MB limit` }));
          return;
        }
        // 合并内容写入第一个文件
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
  if (method === 'GET' && url === '/api/concept') {
    const lang = parsedUrl.searchParams.get('lang') || 'zh';
    const doc = parsedUrl.searchParams.get('doc') || '';
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

  // CCV 进程列表
  if (url === '/api/ccv-processes' && method === 'GET') {
    if (platform() === 'win32') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes: [] }));
      return;
    }
    try {
      const { stdout } = await execAsync('lsof -iTCP:7008-7099 -sTCP:LISTEN -P -n', { timeout: 5000 }).catch(() => ({ stdout: '' }));
      const lines = stdout.trim().split('\n').filter(Boolean);
      // Parse lsof output: skip header, filter node processes, dedupe by PID:port
      const seen = new Map(); // pid -> port
      for (const line of lines.slice(1)) {
        const parts = line.trim().split(/\s+/);
        const cmd = parts[0];
        if (cmd !== 'node') continue;
        const pid = parseInt(parts[1], 10);
        if (!pid) continue;
        // lsof 输出: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME (STATE)
        // 端口在 NAME 列（倒数第二列），如 *:7008，最后一列是 (LISTEN)
        const nameField = parts[parts.length - 2] || '';
        const portMatch = nameField.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = portMatch[1];
        if (!seen.has(pid)) seen.set(pid, port);
      }
      // 获取所有候选进程的 PPID，过滤掉 PPID 也在 CCV 进程集合中的子进程（即 ccv -c/-d 启动的 claude 子进程）
      const ccvPids = new Set(seen.keys());
      const filteredPids = [];
      for (const [pid] of seen) {
        try {
          const { stdout: ppidOut } = await execAsync(`ps -o ppid= -p ${pid}`, { timeout: 2000 }).catch(() => ({ stdout: '' }));
          const ppid = parseInt(ppidOut.trim(), 10);
          if (ppid && ccvPids.has(ppid)) continue; // 是某个 CCV 进程的子进程，跳过
        } catch {}
        filteredPids.push(pid);
      }
      const processes = [];
      for (const pid of filteredPids) {
        const port = seen.get(pid);
        let startTime = '';
        let command = '';
        try {
          const { stdout: psOut } = await execAsync(`ps -p ${pid} -o lstart=,command=`, { timeout: 3000 }).catch(() => ({ stdout: '' }));
          const psLine = psOut.trim();
          // lstart format: "Day Mon DD HH:MM:SS YYYY rest..."
          const lsMatch = psLine.match(/^\w+\s+(\w+)\s+(\d+)\s+([\d:]+)\s+(\d{4})\s+(.*)/);
          if (lsMatch) {
            const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
            const mon = String(months[lsMatch[1]] || 1).padStart(2, '0');
            const day = String(lsMatch[2]).padStart(2, '0');
            const time = lsMatch[3];
            const year = lsMatch[4];
            startTime = `${year}年${mon}月${day}日 ${time}`;
            const rawCmd = lsMatch[5];
            // Extract path after lib/ (e.g. node_modules/cc-viewer/cli.js -d → cc-viewer/cli.js -d)
            const libMatch = rawCmd.match(/lib\/(.+)/);
            command = libMatch ? libMatch[1] : rawCmd;
          }
        } catch {}
        const isCurrent = pid === process.pid;
        processes.push({ port, pid, command, startTime, isCurrent });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // CCV 进程关闭
  if (url === '/api/ccv-processes/kill' && method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { pid } = JSON.parse(body);
        if (!Number.isInteger(pid) || pid <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid PID' }));
          return;
        }
        if (pid === process.pid) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot kill current process' }));
          return;
        }
        // 安全检查：确认是监听 CCV 端口范围 (7008-7099) 的 node 进程
        const { stdout: lsofOut } = await execAsync(`lsof -iTCP:7008-7099 -sTCP:LISTEN -P -n -p ${pid}`, { timeout: 5000 }).catch(() => ({ stdout: '' }));
        const lsofLines = lsofOut.trim().split('\n').filter(Boolean).slice(1);
        const isNodeOnCcvPort = lsofLines.some(line => line.trim().split(/\s+/)[0] === 'node');
        if (!isNodeOnCcvPort) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not a CCV process' }));
          return;
        }
        process.kill(pid, 'SIGTERM');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
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

  // 非 GET 请求的 API 404
  if (url.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

export async function startViewer() {
  // 加载插件（需要在创建服务器之前，以便通过 hook 获取 HTTPS 证书）
  await loadPlugins();

  // 通过插件 hook 获取 HTTPS 证书选项
  let httpsOptions = null;
  try {
    const httpsResult = await runWaterfallHook('httpsOptions', {});
    httpsOptions = (httpsResult.pfx || httpsResult.cert) ? httpsResult : null;
  } catch (err) {
    console.error('[CC Viewer] httpsOptions hook error:', err.message);
  }

  const useHttps = !!httpsOptions;
  const protocol = useHttps ? 'https' : 'http';
  serverProtocol = protocol;
  if (useHttps) console.error('[CC Viewer] HTTPS mode enabled via plugin hook');

  return new Promise((resolve, reject) => {
    function tryListen(port) {
      if (port > MAX_PORT) {
        console.error(t('server.portsBusy', { start: START_PORT, end: MAX_PORT }));
        resolve(null);
        return;
      }

      // 先检测 127.0.0.1:port 是否已被占用（避免 0.0.0.0 和 127.0.0.1 绑定不冲突的问题）
      const probe = createConnection({ host: '127.0.0.1', port });
      probe.on('connect', () => {
        probe.destroy();
        tryListen(port + 1); // 端口已被占用，尝试下一个
      });
      probe.on('error', () => {
        probe.destroy();
        // 端口空闲，绑定
        let currentServer;
        if (useHttps) {
          try {
            currentServer = createHttpsServer(httpsOptions, handleRequest);
          } catch (err) {
            console.error('[CC Viewer] HTTPS server creation failed, falling back to HTTP:', err.message);
            currentServer = createServer(handleRequest);
            serverProtocol = 'http';
          }
        } else {
          currentServer = createServer(handleRequest);
        }

        currentServer.listen(port, HOST, () => {
          server = currentServer;
          actualPort = port;
          const url = `${serverProtocol}://127.0.0.1:${port}`;
          console.error(t('server.started', { host: '127.0.0.1', port, protocol: serverProtocol }));
          // v2.0.69 之前的版本会清空控制台，自动打开浏览器确保用户能看到界面
          try {
            const ccPkgPath = join(__dirname, '..', '@anthropic-ai', 'claude-code', 'package.json');
            const ccVer = JSON.parse(readFileSync(ccPkgPath, 'utf-8')).version;
            const [maj, min, pat] = ccVer.split('.').map(Number);
            if (maj < 2 || (maj === 2 && min === 0 && pat < 69)) {
              const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
              execAsync(`${cmd} ${url}`, { timeout: 5000 }).catch(() => {});
            }
          } catch { }
          // 工作区模式下延迟到选择工作区后再启动监听
          if (!isWorkspaceMode) {
            startWatching();
            startStatsWorker();
          }
          // CLI 模式下启动 WebSocket 服务
          if (isCliMode) {
            setupTerminalWebSocket(currentServer);
          }
          // 通知插件服务器已启动
          runParallelHook('serverStarted', { port, host: HOST, url, ip: getLocalIp(), token: ACCESS_TOKEN, protocol: serverProtocol })
            .catch(err => console.error('[CC Viewer] Plugin serverStarted hook error:', err.message));
          resolve(server);
        });

        currentServer.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            tryListen(port + 1);
          } else {
            reject(err);
          }
        });
      });
    }

    tryListen(START_PORT);
  });
}

async function setupTerminalWebSocket(httpServer) {
  try {
    const { WebSocketServer } = await import('ws');
    const { writeToPty, resizePty, onPtyData, onPtyExit, getPtyState, getOutputBuffer, getCurrentWorkspace, spawnShell } = await import('./pty-manager.js');
    // const { default: chokidar } = await import('chokidar');

    const wss = new WebSocketServer({ noServer: true });
    terminalWss = wss;

    // 多客户端共享 PTY 的尺寸冲突解决：
    // 移动端优先——只要有移动端在线，PTY 始终使用移动端尺寸，
    // PC 端的 resize 仅存储不生效，避免宽屏尺寸导致移动端乱码。
    // PC 端显示窄输出但完全可读，移动端永远不会乱码。
    let activeWs = null;              // 当前活跃的 WebSocket 连接
    const clientSizes = new Map();    // ws → { cols, rows }
    const mobileClients = new Set();  // 移动端连接集合

    // 找到一个在线的移动端并返回其尺寸
    const getMobileSize = () => {
      for (const mws of mobileClients) {
        if (mws.readyState === 1) {
          const size = clientSizes.get(mws);
          if (size) return size;
        }
      }
      return null;
    };

    // 文件监控器：监控工作区目录变更（暂时禁用）
    // 以下代码已被注释掉，如需启用请取消注释
    // let fileWatcher = null;
    // let fileWatchDebounceTimer = null;
    // let currentWatchPath = null;
    //
    // 忽略规则：从统一的 IGNORED_PATTERNS 生成，并忽略所有隐藏目录
    // const ignoredPaths = [
    //   ...Array.from(IGNORED_PATTERNS).map(p => '**/' + p + '/**'),
    //   '**/.*/**',  // 忽略所有隐藏目录（.git, .Trash, .docker 等）
    // ];
    //
    // 启动文件监控
    // const startFileWatcher = (watchPath) => {
    //   if (fileWatcher) {
    //     fileWatcher.close();
    //   }
    //   currentWatchPath = watchPath;
    //
    //   try {
    //     fileWatcher = chokidar.watch(watchPath, {
    //       ignored: ignoredPaths,
    //       persistent: true,
    //       ignoreInitial: true, // 忽略初始扫描，只监控变更
    //       awaitWriteFinish: {
    //         stabilityThreshold: 100,
    //         pollInterval: 50
    //       }
    //     });
    //
    //     监听 chokidar 错误事件，避免崩溃
    //     fileWatcher.on('error', (error) => {
    //       console.error('[CC Viewer] File watcher error:', error.message);
    //       不要让错误导致进程崩溃，只记录日志
    //     });
    //
    //     使用防抖避免频繁触发
    //     fileWatcher.on('all', (eventType, path) => {
    //       if (fileWatchDebounceTimer) {
    //         clearTimeout(fileWatchDebounceTimer);
    //       }
    //
    //       fileWatchDebounceTimer = setTimeout(() => {
    //         console.log('[CC Viewer] File change detected: ' + eventType + ' - ' + path);
    //
    //         广播文件变更事件给所有连接的客户端
    //         const changeEvent = {
    //           type: 'file-change',
    //           eventType,
    //           path,
    //           watchPath: currentWatchPath
    //         };
    //
    //         const clientCount = wss.clients.size;
    //         console.log('[CC Viewer] Broadcasting file-change to ' + clientCount + ' client(s)');
    //
    //         wss.clients.forEach((client) => {
    //           if (client.readyState === 1) { // WebSocket.OPEN
    //             try {
    //               client.send(JSON.stringify(changeEvent));
    //             } catch (err) {
    //               console.error('[CC Viewer] Failed to send file-change event:', err.message);
    //             }
    //           }
    //         });
    //       }, 200); // 200ms 防抖延迟
    //     });
    //
    //     console.log('[CC Viewer] File watcher started for: ' + watchPath);
    //   } catch (err) {
    //     console.error('[CC Viewer] Failed to start file watcher:', err.message);
    //   }
    // };
    //
    // 停止文件监控
    // const stopFileWatcher = () => {
    //   if (fileWatchDebounceTimer) {
    //     clearTimeout(fileWatchDebounceTimer);
    //     fileWatchDebounceTimer = null;
    //   }
    //   if (fileWatcher) {
    //     fileWatcher.close();
    //     fileWatcher = null;
    //   }
    //   currentWatchPath = null;
    // };
    //
    // 监听 PTY 退出事件，停止文件监控（只在监控器运行时停止）
    // onPtyExit(() => {
    //   if (fileWatcher && !fileWatcher.closed) {
    //     stopFileWatcher();
    //     console.log('[CC Viewer] File watcher stopped (PTY exited)');
    //   }
    // });
    //
    // 初始化时检查是否有活跃的工作区
    // const workspace = getCurrentWorkspace();
    // if (workspace.running && workspace.cwd) {
    //   startFileWatcher(workspace.cwd);
    // }
    //
    // 定期检查工作区状态，确保监控器在 PTY 启动后自动开始工作
    // const workspaceCheckInterval = setInterval(() => {
    //   const currentWorkspace = getCurrentWorkspace();
    //   const isRunning = currentWorkspace.running && currentWorkspace.cwd;
    //
    //   调试日志
    //   if (process.env.CCV_DEBUG) {
    //     console.log('[CC Viewer] Workspace check:', {
    //       running: currentWorkspace.running,
    //       cwd: currentWorkspace.cwd,
    //       fileWatcher: fileWatcher ? (fileWatcher.closed ? 'closed' : 'active') : 'none',
    //       currentWatchPath
    //     });
    //   }
    //
    //   如果 PTY 正在运行但监控器未启动，则启动监控器
    //   if (isRunning && (!fileWatcher || fileWatcher.closed)) {
    //     if (currentWatchPath !== currentWorkspace.cwd) {
    //       console.log('[CC Viewer] Starting file watcher for: ' + currentWorkspace.cwd);
    //       startFileWatcher(currentWorkspace.cwd);
    //     }
    //   }
    // }, 1000); // 每秒检查一次
    //
    // 清理定时器
    // const originalClose = wss.close;
    // wss.close = function() {
    //   clearInterval(workspaceCheckInterval);
    //   stopFileWatcher();
    //   return originalClose.call(this);
    // };


    httpServer.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (pathname === '/ws/terminal') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on('connection', (ws) => {
      // 发送当前 PTY 状态
      const state = getPtyState();
      ws.send(JSON.stringify({ type: 'state', ...state }));

      // 发送历史输出缓冲
      const buffer = getOutputBuffer();
      if (buffer) {
        ws.send(JSON.stringify({ type: 'data', data: buffer }));
      }

      // PTY 输出 → WebSocket
      const removeDataListener = onPtyData((data) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'data', data }));
        }
      });

      // PTY 退出 → WebSocket
      const removeExitListener = onPtyExit((exitCode) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'exit', exitCode }));
        }
      });

      // WebSocket → PTY
      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'input') {
            // PTY 已退出时，自动 spawn 交互式 shell
            const state = getPtyState();
            if (!state.running) {
              try {
                await spawnShell();
              } catch {}
            }
            // 发送 input 的客户端成为活跃客户端
            if (activeWs !== ws) {
              activeWs = ws;
              // 切换活跃客户端时，如果有移动端在线则保持移动端尺寸，
              // 否则切换到新活跃客户端的尺寸
              const mSize = getMobileSize();
              if (mSize) {
                resizePty(mSize.cols, mSize.rows);
              } else {
                const size = clientSizes.get(ws);
                if (size) {
                  resizePty(size.cols, size.rows);
                }
              }
            }
            writeToPty(msg.data);
          } else if (msg.type === 'resize') {
            // 存储该客户端的尺寸
            clientSizes.set(ws, { cols: msg.cols, rows: msg.rows });
            if (msg.mobile) mobileClients.add(ws);
            // 移动端 resize 始终生效；PC 端仅在无移动端时生效
            if (msg.mobile) {
              resizePty(msg.cols, msg.rows);
            } else if (mobileClients.size === 0 && (activeWs === ws || activeWs === null)) {
              activeWs = ws;
              resizePty(msg.cols, msg.rows);
            }
          }
        } catch {}
      });

      ws.on('close', () => {
        removeDataListener();
        removeExitListener();
        clientSizes.delete(ws);
        mobileClients.delete(ws);
        if (activeWs === ws) {
          // 活跃客户端断开，将控制权交给剩余的某个客户端
          activeWs = null;
          // 优先使用移动端尺寸，无移动端则用剩余客户端尺寸
          const mSize = getMobileSize();
          if (mSize) {
            resizePty(mSize.cols, mSize.rows);
          } else {
            for (const [remainWs, size] of clientSizes) {
              if (remainWs.readyState === 1) {
                activeWs = remainWs;
                resizePty(size.cols, size.rows);
                break;
              }
            }
          }
        }
      });
    });
  } catch (err) {
    console.error('[CC Viewer] Failed to setup terminal WebSocket:', err.message);
  }
}

export function getPort() {
  return actualPort;
}

export function getProtocol() {
  return serverProtocol;
}

let _stoppingPromise = null;
export function stopViewer() {
  if (_stoppingPromise) return _stoppingPromise;
  _stoppingPromise = _doStop();
  return _stoppingPromise;
}
async function _doStop() {
  try { await Promise.race([runParallelHook('serverStopping'), new Promise(r => setTimeout(r, 3000))]); } catch { }
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
// 工作区模式下由 cli.js 直接 import server.js 触发启动，跳过 _initPromise 自动启动
if (!isWorkspaceMode) {
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
}

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
process.on('SIGINT', () => { stopViewer().finally(() => process.exit()); });
process.on('SIGTERM', () => { stopViewer().finally(() => process.exit()); });
