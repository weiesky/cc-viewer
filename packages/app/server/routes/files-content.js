// Read-oriented file-access routes (moved verbatim from server.js handleRequest).
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { join, basename, dirname, resolve, sep } from 'node:path';
import { isReadAllowed, reasonToStatus } from '../lib/file-access-policy.js';
import { ERROR_STATUS_MAP } from '../lib/file-api.js';
import { discoverClaudeMdCandidates, readCandidateById } from '../lib/claude-md-discovery.js';
import { getClaudeConfigDir } from '../../findcc.js';
import { _projectName } from '../interceptor.js';

// file-raw 扩展名 → MIME 映射。图片走 <img> 预览;html 走 iframe 预览(带下方 CSP sandbox);
// 其余为 HTML 预览的同目录子资源(c8/nyc/lcov-genhtml 等静态报告):CSP sandbox 使文档
// 处于 opaque origin,对一切子资源都是跨源——跨源样式表受浏览器严格 MIME 校验,
// octet-stream 的 CSS 会被直接拒用(报告渲染成裸 HTML)。js 虽为 classic script 不受
// MIME 门禁,配正确类型属卫生项 + 为未来 nosniff 铺路。
// 注意:值不带 charset 后缀——fileRaw 内 CSP 判等依赖 mime === 'text/html'。
const FILE_RAW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function planFile(req, res, parsedUrl) {
  try {
    const raw = parsedUrl.searchParams.get('path') || '';
    if (!raw) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing path' }));
      return;
    }
    if (raw.indexOf('\x00') !== -1) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid path (null byte)' }));
      return;
    }
    if (!raw.toLowerCase().endsWith('.md')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid extension' }));
      return;
    }
    const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(raw);
    if (!isAbs) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'absolute path required' }));
      return;
    }

    // 委托 policy:realpath + allowlist + denylist + 项目内豁免一气呵成
    const policy = isReadAllowed(raw);
    if (!policy.ok) {
      // 兼容旧测试断言:plan-file 历史用 'forbidden' / 'not found' 大类,reason 携带细节
      const status = policy.reason === 'realpath-failed' ? 404 : 403;
      const errLabel = policy.reason === 'realpath-failed' ? 'not found' : 'forbidden';
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: errLabel, reason: policy.reason }));
      return;
    }

    // 用 policy 返回的 real 读,避免 TOCTOU
    const real = policy.real;
    const st = statSync(real);
    if (!st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not a file' }));
      return;
    }
    if (st.size > 2 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'too large' }));
      return;
    }
    const content = readFileSync(real, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, content }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

function fileContentGet(req, res, parsedUrl) {
  const reqPath = parsedUrl.searchParams.get('path');
  const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
  try {
    if (!reqPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    // 相对路径含 .. → 直接拒(历史契约;绕过项目目录的明确攻击)
    const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
    if (!isAbs && reqPath.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    // 相对路径在项目目录拼接;绝对路径直接送 policy
    const absPath = isAbs ? reqPath : resolve(cwd, reqPath);
    const policy = isReadAllowed(absPath);
    if (!policy.ok) {
      const status = reasonToStatus(policy.reason);
      const errLabel = status === 404 ? 'File not found'
        : status === 400 ? 'Invalid path'
        : 'Forbidden';
      const body = { error: errLabel, reason: policy.reason };
      if (policy.allowedRoots) body.allowedRoots = policy.allowedRoots;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    // 用 policy 返回的 real 读,杜绝 TOCTOU
    const real = policy.real;
    const st = statSync(real);
    if (!st.isFile()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not a file' }));
      return;
    }
    if (st.size > 5 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large' }));
      return;
    }
    const content = readFileSync(real, 'utf-8');
    // path 字段回返原始入参,前端用它做路径展示与后续 POST 引用
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: reqPath, content, size: st.size }));
  } catch (err) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? `Cannot read file: ${err.message}` : err.message;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function projectMemory(req, res, parsedUrl) {
  // 本端点内 helper:8 处响应去重(端点局部,不跨文件)
  const respondJson = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const cwdRaw = process.env.CCV_PROJECT_DIR || process.cwd();
    const cwd = cwdRaw.replace(/[/\\]+$/, '');
    const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    const dir = join(getClaudeConfigDir(), 'projects', encoded, 'memory');
    const fileParam = parsedUrl.searchParams.get('file');
    const MAX_BYTES = 512 * 1024;

    // 入口文件
    if (!fileParam) {
      const indexPath = join(dir, 'MEMORY.md');
      if (!existsSync(indexPath)) return respondJson(200, { exists: false, dir, indexPath });
      const policy = isReadAllowed(indexPath);
      if (!policy.ok) return respondJson(reasonToStatus(policy.reason), { error: 'Forbidden', reason: policy.reason });
      const st = statSync(policy.real);
      if (!st.isFile()) return respondJson(400, { error: 'Not a file' });
      if (st.size > MAX_BYTES) return respondJson(413, { error: 'File too large' });
      const content = readFileSync(policy.real, 'utf-8');
      return respondJson(200, { exists: true, dir, indexPath, content });
    }

    // 明细文件: 仅接受单段 basename + .md 后缀
    // 再次校验 realpath 严格在 memoryDir 内 —— policy 的 ~/.claude/ allowlist 范围比这里宽。
    if (fileParam.includes('/') || fileParam.includes('\\') || fileParam.includes('\0') || fileParam === '..' || fileParam.startsWith('.')) {
      return respondJson(400, { error: 'Invalid file name' });
    }
    if (!/\.md$/i.test(fileParam)) return respondJson(400, { error: 'Only .md files allowed' });
    const detailPath = join(dir, fileParam);
    if (!existsSync(detailPath)) return respondJson(404, { error: 'File not found' });
    // realpath 收紧: 必须严格落在 realpath(dir) 内 —— 防 symlink 跳出 memoryDir
    let realDir, realFile;
    try {
      realDir = realpathSync(dir);
      realFile = realpathSync(detailPath);
    } catch {
      return respondJson(404, { error: 'File not found' });
    }
    const realDirWithSep = realDir.endsWith(sep) ? realDir : realDir + sep;
    if (realFile !== realDir && !realFile.startsWith(realDirWithSep)) {
      return respondJson(403, { error: 'Path traversal not allowed' });
    }
    const policy = isReadAllowed(realFile);
    if (!policy.ok) return respondJson(reasonToStatus(policy.reason), { error: 'Forbidden', reason: policy.reason });
    const st = statSync(realFile);
    if (!st.isFile()) return respondJson(400, { error: 'Not a file' });
    if (st.size > MAX_BYTES) return respondJson(413, { error: 'File too large' });
    const content = readFileSync(realFile, 'utf-8');
    return respondJson(200, { name: fileParam, path: realFile, content });
  } catch (err) {
    // 与 /api/file-content 一致：已知 errno（ENOENT/EACCES 等）走 ERROR_STATUS_MAP 映射；
    // 500 时不回显 err.message —— 可能含 ~/.claude/projects/<encoded>/memory/ 路径片段。
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? 'Internal error' : err.message;
    respondJson(status, { error: message });
  }
}

function claudeMd(req, res, parsedUrl) {
  const respondJson = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
    const claudeConfigDir = getClaudeConfigDir();
    // 注入 isReadAllowed 做发现阶段预过滤: 不在 allowlist 内的祖先候选不进列表 ——
    // 否则 UI 会渲染出点击必 403 的"看得见点不开"chip。
    const candidates = discoverClaudeMdCandidates({
      cwd,
      claudeConfigDir,
      isReadAllowedFn: isReadAllowed,
    });
    const idParam = parsedUrl.searchParams.get('id');
    const MAX_BYTES = 512 * 1024;

    if (!idParam) {
      // 列表: 不暴露 realPath / mtimeMs, 仅返回 {id, scope, tail}。mtimeMs 前端未使用,
      // 去掉以收敛信息泄露面 (perf-sec review P2-C)。
      return respondJson(200, {
        entries: candidates.map(c => ({
          id: c.id,
          scope: c.scope,
          tail: c.tail,
        })),
      });
    }

    const r = readCandidateById(candidates, idParam, {
      maxBytes: MAX_BYTES,
      isReadAllowedFn: isReadAllowed,
    });
    if (!r.ok) {
      // policy 失败时让 reasonToStatus 统一映射，与 /api/project-memory 一致
      const status = r.reason ? reasonToStatus(r.reason) : r.status;
      return respondJson(status, { error: r.error, reason: r.reason });
    }
    return respondJson(200, {
      id: idParam,
      scope: r.scope,
      tail: r.tail,
      content: r.content,
    });
  } catch (err) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? 'Internal error' : err.message;
    respondJson(status, { error: message });
  }
}

function fileRaw(req, res, parsedUrl) {
  const url = parsedUrl.pathname;
  const method = req.method;
  let reqPath;
  if (url.startsWith('/api/file-raw/')) {
    const tail = parsedUrl.pathname.slice('/api/file-raw/'.length);
    try { reqPath = decodeURIComponent(tail); } catch { reqPath = tail; }
  } else {
    reqPath = parsedUrl.searchParams.get('path');
  }
  const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
  try {
    if (!reqPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
    const absPath = isAbs ? reqPath : resolve(cwd, reqPath);

    // /tmp 原文件不存在时回退到持久化副本(保留原 fallback 语义,但用 policy 守卫)
    let policy = isReadAllowed(absPath);
    if (!policy.ok && policy.reason === 'realpath-failed' && isAbs) {
      const pName = _projectName || 'default';
      const persistPrefix = join(getClaudeConfigDir(), 'cc-viewer', pName, 'images');
      const fileName = basename(absPath);
      if (fileName) {
        const persistFile = join(persistPrefix, fileName);
        const fallbackPolicy = isReadAllowed(persistFile);
        if (fallbackPolicy.ok) policy = fallbackPolicy;
      }
    }
    if (!policy.ok) {
      const status = reasonToStatus(policy.reason);
      const errLabel = status === 404 ? 'File not found'
        : status === 400 ? 'Invalid path'
        : 'Forbidden';
      const body = { error: errLabel, reason: policy.reason };
      if (policy.allowedRoots) body.allowedRoots = policy.allowedRoots;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    const targetFile = policy.real;
    const stat = statSync(targetFile);
    if (!stat.isFile()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not a file' }));
      return;
    }
    if (stat.size > 10 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large' }));
      return;
    }
    const ext = (targetFile.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const mime = FILE_RAW_MIME[ext] || 'application/octet-stream';
    const data = method === 'HEAD' ? null : readFileSync(targetFile);
    const size = method === 'HEAD' ? stat.size : data.length;
    const headers = { 'Content-Type': mime, 'Content-Length': size };
    // 防止用户项目中的恶意 HTML 在同源下执行脚本（XSS 防护）：CSP sandbox 强制 unique origin，
    // 即便绕过 iframe 直接访问也拿不到 cc-viewer 同源的 storage/cookie。
    // CSP 与 iframe sandbox 同时存在时取交集（更严格者胜），iframe 端 sandbox 也只配 `allow-scripts`
    // 跟这里保持一致，c8 / nyc 覆盖率报告需要的 sortable table / prettify / block-navigation 都
    // 不依赖 popup / form，因此 allow-popups / allow-forms 都不放（防 `window.open` 弹外站 +
    // `<form action>` 提交任意 URL）。再叠加 `connect-src 'none'` + `form-action 'none'` 兜底
    // 阻断脚本外发流量（fetch / XHR / WebSocket / form 提交）—— 用户项目里的静态报告页都不需要
    // 网络通信，能跑就够；外联即可疑。
    if (mime === 'text/html') headers['Content-Security-Policy'] = "sandbox allow-scripts; connect-src 'none'; form-action 'none'";
    res.writeHead(200, headers);
    res.end(data);
  } catch (err) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? `Cannot read file: ${err.message}` : err.message;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function fileContentPost(req, res) {
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
      const { path: reqPath, content } = JSON.parse(body);
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      if (!reqPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      if (typeof content !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Content must be a string' }));
        return;
      }
      const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
      const absPath = isAbs ? reqPath : resolve(cwd, reqPath);

      // 写路径同样走 policy(收敛 editorSession 后门):允许覆盖现有文件;
      // 新文件场景递归向上找最近存在的祖先目录,只要它在 allowlist 内即放行。
      // (旧实现只查 immediate parent,父目录也不存在时误拒嵌套新建。)
      let targetReal;
      const policy = isReadAllowed(absPath);
      if (policy.ok) {
        targetReal = policy.real;
      } else if (policy.reason === 'realpath-failed') {
        // 递归向上找最近存在的祖先;若 allowlist 命中即允许新建,从该祖先 real 重建目标路径。
        let cursor = resolve(absPath, '..');
        let ancestorPolicy = null;
        let descent = [basename(absPath)];
        for (let depth = 0; depth < 32; depth++) {
          const ap = isReadAllowed(cursor);
          if (ap.ok) { ancestorPolicy = ap; break; }
          if (ap.reason !== 'realpath-failed') {
            // sensitive-prefix / outside-allowlist 等明确拒绝 → 直接 403
            ancestorPolicy = ap;
            break;
          }
          // 当前祖先也不存在,继续上溯
          const parent = resolve(cursor, '..');
          if (parent === cursor) break; // 抵达根,停止
          descent.unshift(basename(cursor));
          cursor = parent;
        }
        if (!ancestorPolicy || !ancestorPolicy.ok) {
          const reason = (ancestorPolicy && ancestorPolicy.reason) || 'outside-allowlist';
          const status = reasonToStatus(reason);
          const body = { error: 'Forbidden', reason };
          if (ancestorPolicy && ancestorPolicy.allowedRoots) body.allowedRoots = ancestorPolicy.allowedRoots;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }
        // 在祖先 real 路径下重建目标。Denylist 已在祖先 prefix 层生效,
        // 这里相信 allowlist 祖先的合法性(项目目录 / ~/.claude/cc-viewer 等)。
        targetReal = join(ancestorPolicy.real, ...descent);
        // 父目录可能不存在,递归 mkdir
        try { mkdirSync(dirname(targetReal), { recursive: true }); } catch {}
      } else {
        const status = reasonToStatus(policy.reason);
        const body = { error: 'Forbidden', reason: policy.reason };
        if (policy.allowedRoots) body.allowedRoots = policy.allowedRoots;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }

      writeFileSync(targetReal, content, 'utf-8');
      const stat = statSync(targetReal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, size: stat.size }));
    } catch (err) {
      const status = ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? `Cannot save file: ${err.message}` : err.message;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });
}

export const filesContentRoutes = [
  { method: 'GET', match: 'exact', path: '/api/plan-file', handler: planFile },
  { method: 'GET', match: 'exact', path: '/api/file-content', handler: fileContentGet },
  { method: 'GET', match: 'exact', path: '/api/project-memory', handler: projectMemory },
  { method: 'GET', match: 'exact', path: '/api/claude-md', handler: claudeMd },
  { predicate: (url, method) => (url === '/api/file-raw' || url.startsWith('/api/file-raw/')) && (method === 'GET' || method === 'HEAD'), handler: fileRaw },
  { method: 'POST', match: 'exact', path: '/api/file-content', handler: fileContentPost },
];
