// Read-oriented file-access routes (moved verbatim from server.js handleRequest).
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, realpathSync, createReadStream, readdirSync } from 'node:fs';
import { join, basename, dirname, resolve, sep } from 'node:path';
import { isReadAllowed, isWriteAllowed, reasonToStatus } from '../lib/file-access-policy.js';
import { ERROR_STATUS_MAP, isPathContained } from '../lib/file-api.js';
import { viewRootOrReply, resolveViewRoot } from '../lib/view-root.js';
import { findSdkSessionByInstance } from '../lib/sdk-session-index.js';
import { projectKeyForCwd } from '../lib/system-prompt-snapshots.js';
import { loadWorkspaces } from '../workspace-registry.js';
import { listLivePtys } from '../pty-manager.js';
import { reportSwallowed } from '../lib/error-report.js';
import { discoverClaudeMdCandidates, readCandidateById } from '../lib/claude-md-discovery.js';
import { getClaudeConfigDir } from '../../findcc.js';
import { _projectName } from '../interceptor.js';
import { isAdminReq } from '../lib/is-admin.js';
import { isSameOriginBrowserRequest } from '../lib/same-origin.js';
import {
  targetError, errnoToStatus, realDirectory, checkedDirectory, insidePath,
  targetRelPath, resolveTargetRoot,
} from '../lib/target-scope.js';

// Multi-project file operations use the same viewed root for reads and writes.
// Every file-browser mutation enforces realpath containment in that root;
// explicit editor sessions retain their existing allowlisted external paths.
// their tests (and the dispatcher's sync-call convention) assert on res
// immediately after the call — the override must not async-ify them.
// Both reads and writes resolve the viewed project. Absolute editor paths are
// still governed by the allowlist; browser writes stay within the selected root.
function _viewRootOrReply(req, res, parsedUrl, bodyProject, bodyInstance) {
  return viewRootOrReply(req, res, parsedUrl, {
    boundCwd: process.env.CCV_PROJECT_DIR || process.cwd(),
    loadWorkspaces,
    listLivePtys,
    bodyProject,
    bodyInstance,
  });
}

// file-raw 扩展名 → MIME 映射。图片走 <img> 预览;html 走 iframe 预览(带下方 CSP sandbox);
// 其余为 HTML 预览的同目录子资源(c8/nyc/lcov-genhtml 等静态报告):CSP sandbox 使文档
// 处于 opaque origin,对一切子资源都是跨源——跨源样式表受浏览器严格 MIME 校验,
// octet-stream 的 CSS 会被直接拒用(报告渲染成裸 HTML)。js 虽为 classic script 不受
// MIME 门禁,配正确类型属卫生项 + 为未来 nosniff 铺路。
// 注意:值不带 charset 后缀——fileRaw 内 CSP 判等依赖 mime === 'text/html'。
const FILE_RAW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.html': 'text/html', '.htm': 'text/html',
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
  const cwd = _viewRootOrReply(req, res, parsedUrl);
  if (!cwd) return;
  fileContentGetWithRoot(req, res, parsedUrl, reqPath, cwd);
}

function fileContentGetWithRoot(req, res, parsedUrl, reqPath, cwd) {
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
  projectMemoryEntry(req, res, parsedUrl, respondJson);
}

// The SDK context snapshot prices MEMORY.md itself, not every linked detail file.
// Supplement only the index's existing single-segment .md links with a transparent
// content-length estimate; never allocate the SDK total across unrelated files.
export function estimateLinkedMemoryTokens(content, dir) {
  const estimates = {};
  const MAX_BYTES = 512 * 1024;
  const MAX_LINKS = 100;
  if (typeof content !== 'string' || typeof dir !== 'string') return estimates;
  const links = new Set();
  for (const match of content.matchAll(/\]\(\s*([^)\s]+\.md)(?:[?#][^)\s]*)?(?:\s+"[^"]*")?\s*\)/gi)) {
    let name;
    try { name = decodeURIComponent(match[1].split('#')[0].split('?')[0]); } catch { continue; }
    if (!name || name.includes('/') || name.includes('\\') || name.includes('\0') || name.startsWith('.')) continue;
    links.add(name);
    if (links.size >= MAX_LINKS) break;
  }
  let realDir;
  try { realDir = realpathSync(dir); } catch { return estimates; }
  const prefix = realDir.endsWith(sep) ? realDir : realDir + sep;
  for (const name of links) {
    try {
      const realFile = realpathSync(join(realDir, name));
      const stat = statSync(realFile);
      if (!realFile.startsWith(prefix) || !stat.isFile() || stat.size > MAX_BYTES) continue;
      if (!isReadAllowed(realFile).ok) continue;
      estimates[name] = { tokens: Math.ceil(stat.size / 4), source: 'file-content-estimate' };
    } catch { /* Missing/unreadable links remain without an estimate. */ }
  }
  return estimates;
}

// The entry wraps BOTH the view-root resolution and the read in the endpoint's
// single error surface (the searchParams-throw defense test asserts a 500 from
// THIS catch, regardless of which stage throws).
function projectMemoryEntry(req, res, parsedUrl, respondJson) {
  try {
    const cwd = _viewRootOrReply(req, res, parsedUrl);
    if (!cwd) return;
    projectMemoryWithRoot(req, res, parsedUrl, respondJson, cwd);
  } catch (err) {
    // 与 /api/file-content 一致：已知 errno（ENOENT/EACCES 等）走 ERROR_STATUS_MAP 映射；
    // 500 时不回显 err.message —— 可能含 ~/.claude/projects/<encoded>/memory/ 路径片段。
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? 'Internal error' : err.message;
    respondJson(status, { error: message });
  }
}

function projectMemoryWithRoot(req, res, parsedUrl, respondJson, cwd) {
  try {
    const cwdClean = cwd.replace(/[/\\]+$/, '');
    const encoded = cwdClean.replace(/[^a-zA-Z0-9-]/g, '-');
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
      // Only SDK mode consumes these estimates. PTY keeps the original cheap index read.
      const memoryTokenEstimates = process.env.CCV_SDK_MODE === '1' ? estimateLinkedMemoryTokens(content, dir) : undefined;
      return respondJson(200, { exists: true, dir, indexPath, content, memoryTokenEstimates });
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
    return respondJson(200, { name: fileParam, path: realFile, content, tokens: Math.ceil(Buffer.byteLength(content, 'utf8') / 4), tokenSource: 'file-content-estimate' });
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
  // The entry wraps BOTH the view-root resolution and the read in the
  // endpoint's single error surface (the searchParams-throw defense test
  // asserts a 500 from THIS catch, regardless of which stage throws).
  try {
    const cwd = _viewRootOrReply(req, res, parsedUrl);
    if (!cwd) return;
    claudeMdWithRoot(req, res, parsedUrl, respondJson, cwd);
  } catch (err) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? 'Internal error' : err.message;
    respondJson(status, { error: message });
  }
}

function claudeMdWithRoot(req, res, parsedUrl, respondJson, cwd) {
  try {
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
  let scopedProject = '';
  let scopedInstance = '';
  if (url.startsWith('/api/file-raw/view/')) {
    const parts = url.slice('/api/file-raw/view/'.length).split('/');
    let project = '';
    let instance = '';
    try {
      project = decodeURIComponent(parts[0] || '');
      instance = decodeURIComponent(parts[1] || '');
      reqPath = decodeURIComponent(parts.slice(2).join('/'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    scopedProject = project;
    scopedInstance = instance;
  } else if (url.startsWith('/api/file-raw/')) {
    const tail = parsedUrl.pathname.slice('/api/file-raw/'.length);
    try { reqPath = decodeURIComponent(tail); } catch { reqPath = tail; }
  } else {
    reqPath = parsedUrl.searchParams.get('path');
  }
  let resolvedView = null;
  if (scopedProject) {
    resolvedView = resolveViewRoot({
      projectParam: scopedProject,
      instanceParam: scopedInstance,
      boundCwd: process.env.CCV_PROJECT_DIR || process.cwd(),
      loadWorkspaces,
      listLivePtys,
    });
    // The path already pins its project. A stale/mismatched instance must not
    // silently redirect it to the bound project or a different workspace.
    const instanceRecord = scopedInstance ? findSdkSessionByInstance(scopedInstance) : null;
    const instanceMatches = !scopedInstance || (instanceRecord
      && (instanceRecord.projectName === scopedProject
        || projectKeyForCwd(instanceRecord.cwd) === scopedProject));
    if (!resolvedView.ok || (scopedInstance && !instanceMatches)) {
      res.writeHead(resolvedView.ok ? 400 : resolvedView.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: resolvedView.ok ? 'Project scope mismatch' : resolvedView.error }));
      return;
    }
  }
  const cwd = resolvedView?.root || _viewRootOrReply(req, res, parsedUrl);
  if (!cwd) return;
  fileRawWithRoot(req, res, parsedUrl, reqPath, cwd, method);
}

function fileRawWithRoot(req, res, parsedUrl, reqPath, cwd, method) {
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

// Browser download endpoint: unlike fileRaw (inline preview, 10MB cap), this streams
// the file with Content-Disposition: attachment so the browser saves it to disk.
// No size cap — a download is precisely the path for files too large to preview.
function fileDownload(req, res, parsedUrl) {
  const reqPath = parsedUrl.searchParams.get('path');
  const cwd = _viewRootOrReply(req, res, parsedUrl);
  if (!cwd) return;
  fileDownloadWithRoot(req, res, parsedUrl, reqPath, cwd);
}

function fileDownloadWithRoot(req, res, parsedUrl, reqPath, cwd) {
  try {
    if (!reqPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
    // Same path contract as fileContentGet: relative paths with .. are rejected outright
    const isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(reqPath);
    if (!isAbs && reqPath.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid path' }));
      return;
    }
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
    const targetFile = policy.real;
    const stat = statSync(targetFile);
    if (!stat.isFile()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not a file' }));
      return;
    }
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      // RFC 5987 encoding keeps non-ASCII filenames intact (same style as download-log)
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(basename(targetFile))}`,
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    const stream = createReadStream(targetFile);
    // Headers are already sent by the time any read error can fire, so we can only
    // abort the response mid-download (client sees a truncated file) — report it.
    stream.on('error', (err) => { reportSwallowed('fileDownload.stream', err); res.end(); });
    stream.pipe(res);
  } catch (err) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    const message = status === 500 ? `Cannot read file: ${err.message}` : err.message;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function fileContentPost(req, res, parsedUrl, isLocal) {
  // The shared read root keeps its raw cwd for projectMemory's store-key
  // encoding. Normalize only this mutation's containment comparisons.
  let writeRoot;
  const isInsideWriteRoot = (path) => isPathContained(path, writeRoot);
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
      const cwd = _viewRootOrReply(req, res, parsedUrl);
      if (!cwd) return;
      // Target mode (the CLAUDE.md / skill browser modal) edits files that live in
      // the target's NAVIGATION ROOT, which is frequently OUTSIDE the viewed project
      // (~/.claude, $HOME). When the request carries a target identity
      // (kind + id / source + targetPath, same as /api/target-files), resolve the
      // write root to that navigation root instead of the project view root, so
      // isInsideWriteRoot no longer 403s the file the user is explicitly editing.
      // The target root is re-derived server-side (never trusted from the client),
      // and the isWriteAllowed policy below still runs unchanged.
      // SECURITY / INTENTIONAL DESIGN (do NOT tighten in review without product
      // sign-off): in target mode the write policy is the WHOLE navigation root,
      // and writes go through isWriteAllowed (NOT isReadAllowed) — so the LOG_DIR
      // tree, ~/.claude credentials/settings, ~/.ssh, and the config-backup tree
      // stay unwritable even though the wider surface is editable. This path is
      // gated to admin + same-origin browser requests, the same bar as
      // /api/target-files, because it can reach the user's home tree. A relative
      // path in target mode is anchored at the navigation root, not the project.
      const targetKind = parsedUrl.searchParams.get('kind');
      let targetNavRoot = null;
      if (targetKind) {
        if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        const scope = resolveTargetRoot(parsedUrl, cwd);
        writeRoot = scope.rootReal;
        targetNavRoot = scope.rootReal;
      } else {
        try { writeRoot = realpathSync(cwd); } catch { writeRoot = cwd; }
      }
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
      // In target mode a relative path is anchored at the navigation root; in
      // project mode at the project view root (unchanged legacy behavior).
      const absPath = isAbs ? reqPath : resolve(targetNavRoot || cwd, reqPath);
      // 写路径同样走 policy(收敛 editorSession 后门):允许覆盖现有文件;
      // 新文件场景递归向上找最近存在的祖先目录,只要它在 allowlist 内即放行。
      // (旧实现只查 immediate parent,父目录也不存在时误拒嵌套新建。)
      // Target mode uses the WRITE policy (isWriteAllowed) so the LOG_DIR tree,
      // ~/.claude credentials and other sensitive targets stay unwritable even
      // though the navigation root is editable; project mode keeps isReadAllowed.
      const policyFn = targetNavRoot ? isWriteAllowed : isReadAllowed;
      let targetReal;
      const policy = policyFn(absPath);
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
        // Check containment before creating any missing parent directories.
        // Explicit $EDITOR sessions retain their allowlisted external paths.
        // editorSession is client-claimed — require admin to honor it, otherwise
        // any caller could use it as a write-root bypass (see /api/target-files).
        if (editorSession && !isAdminReq(req, isLocal)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden', reason: 'editor-session-requires-admin' }));
          return;
        }
        if (!editorSession && !isInsideWriteRoot(ancestorPolicy.real)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden', reason: 'outside-view-root' }));
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

      if (editorSession && !isAdminReq(req, isLocal)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden', reason: 'editor-session-requires-admin' }));
        return;
      }
      // Target mode: containment in the navigation root must hold whether the file
      // exists OR is being created — otherwise a crafted relative path could write
      // outside the navigation root (isWriteAllowed only bounds by the allowlist).
      // Project mode keeps the legacy existing-file-only check.
      if (!editorSession && targetNavRoot && !isInsideWriteRoot(targetReal)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden', reason: 'outside-view-root' }));
        return;
      }
      if (!editorSession && !targetNavRoot && existsSync(targetReal) && !isInsideWriteRoot(targetReal)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden', reason: 'outside-view-root' }));
        return;
      }
      writeFileSync(targetReal, content, 'utf-8');
      const stat = statSync(targetReal);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, size: stat.size }));
    } catch (err) {
      // targetError carries `.status` (400/403/404); fs errnos carry `.code`.
      // Honor both so an invalid/stale target identity is not reported as 500.
      const status = err.status || ERROR_STATUS_MAP[err.code] || 500;
      const message = status === 500 ? `Cannot save file: ${err.message}` : err.message;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });
}

function listTargetDirectory(rootReal, segments, deps, requireReadable = true) {
  const dirReal = requireReadable
    ? checkedDirectory(segments.length ? join(rootReal, ...segments) : rootReal, 'Directory')
    : realDirectory(segments.length ? join(rootReal, ...segments) : rootReal, 'Directory');
  if (!isPathContained(dirReal, rootReal)) throw targetError(403, 'Path outside target');
  const ignored = deps?.IGNORED_PATTERNS || new Set();
  const entries = [];
  let dirents;
  try {
    dirents = readdirSync(dirReal, { withFileTypes: true });
  } catch (err) {
    // EACCES → 403 (permission), ENOENT/ENOTDIR → 404 (race with rename/delete),
    // anything else falls back to 404 so we don't leak internal state via 500.
    throw targetError(errnoToStatus(err), 'Directory not readable');
  }
  // Hard cap on returned entries: this is a synchronous loop with realpath +
  // stat + isReadAllowed per entry, and the endpoint fans out via `ancestors`,
  // so an unbounded listing of a huge dir (e.g. ~/.claude/projects/<hash>/)
  // would block the event loop and return a giant JSON payload. 5000 is well
  // past any realistic skill/CLAUDE.md folder.
  const MAX_ENTRIES = 5000;
  for (const entry of dirents) {
    if (entries.length >= MAX_ENTRIES) break;
    if (ignored.has(entry.name)) continue;
    const fullPath = join(dirReal, entry.name);
    let real;
    try { real = realpathSync(fullPath); } catch (err) { reportSwallowed('targetFiles.entry.realpath', err); continue; }
    if (!insidePath(real, rootReal)) continue;
    const policy = isReadAllowed(real);
    if (!policy.ok) continue;
    let st;
    try { st = statSync(policy.real); } catch (err) { reportSwallowed('targetFiles.entry.stat', err); continue; }
    if (!st.isDirectory() && !st.isFile()) continue;
    entries.push({ name: entry.name, type: st.isDirectory() ? 'directory' : 'file', absPath: policy.real });
  }
  entries.sort((a, b) => a.type !== b.type
    ? (a.type === 'directory' ? -1 : 1)
    : a.name.localeCompare(b.name));
  return entries;
}

function targetFiles(req, res, parsedUrl, isLocal, deps) {
  try {
    // /api/target-files exposes directory listings under the user's home and
    // ~/.claude (which contains transcripts, prompt history, env snapshots).
    // Combined with the global `Access-Control-Allow-Origin: *` and loopback's
    // no-auth path, a bare GET would let any web page enumerate the user's
    // ~/.claude tree. Require admin AND a same-origin browser request.
    if (!isAdminReq(req, isLocal) || !isSameOriginBrowserRequest(req, parsedUrl)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    const cwd = _viewRootOrReply(req, res, parsedUrl);
    if (!cwd) return;
    const scope = resolveTargetRoot(parsedUrl, cwd);
    const rawPath = parsedUrl.searchParams.get('path');
    const requestedSegments = targetRelPath(rawPath);
    const segments = requestedSegments === null ? scope.targetPath.split('/').filter(Boolean) : requestedSegments;
    const entries = listTargetDirectory(scope.rootReal, segments, deps, segments.length > 0 || scope.rootKind !== 'home');
    const rootEntries = requestedSegments === null && segments.length > 0
      ? listTargetDirectory(scope.rootReal, [], deps, scope.rootKind === 'project')
      : entries;
    const targetEntries = requestedSegments === null
      ? entries.filter(entry => insidePath(entry.absPath, join(scope.rootReal, ...segments)))
      : entries;
    const targetSegments = scope.targetPath ? scope.targetPath.split('/') : [];
    const ancestors = [];
    // Ancestors are the chain from the navigation root down to the directory
    // being listed. When the caller passed no `path` that's the chain leading
    // to the target itself; when they passed `path`, the chain is the requested
    // segments. We deliberately DO NOT use path.relative(targetPath, rawPath)
    // here — that helper happily produces "../.." for sibling branches, which
    // would pollute the cache with pseudo-paths and re-list directories the
    // user never navigated into.
    const chainSegments = requestedSegments === null ? targetSegments : segments;
    // Request-scoped memo: targetFiles lists the same directory multiple times
    // (entries + ancestors chain often share prefixes), so we cache by dir key
    // to avoid duplicate readdirSync storms on large directories.
    const listMemo = new Map();
    const listOnce = (segs, requireReadable) => {
      const key = segs.join('/') + (requireReadable ? '|r' : '|n');
      if (!listMemo.has(key)) listMemo.set(key, listTargetDirectory(scope.rootReal, segs, deps, requireReadable));
      return listMemo.get(key);
    };
    const ancestorCount = Math.max(0, chainSegments.length - (requestedSegments === null ? 0 : 1));
    for (let i = 0; i <= ancestorCount; i++) {
      const path = chainSegments.slice(0, i).join('/');
      ancestors.push({ path, entries: listOnce(path ? path.split('/') : [], false) });
    }
    const { rootReal, ...response } = scope;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...response, targetPath: segments.join('/'), entries: rootEntries, targetEntries, ancestors }));
  } catch (err) {
    const status = err.status || ERROR_STATUS_MAP[err.code] || 500;
    if (status === 500) console.error('[api/target-files]', err);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: status === 500 ? 'Internal error' : err.message }));
  }
}

export const filesContentRoutes = [
  { method: 'GET', match: 'exact', path: '/api/plan-file', handler: planFile },
  { method: 'GET', match: 'exact', path: '/api/file-content', handler: fileContentGet },
  { method: 'GET', match: 'exact', path: '/api/project-memory', handler: projectMemory },
  { method: 'GET', match: 'exact', path: '/api/claude-md', handler: claudeMd },
  { predicate: (url, method) => (url === '/api/file-raw' || url.startsWith('/api/file-raw/')) && (method === 'GET' || method === 'HEAD'), handler: fileRaw },
  { predicate: (url, method) => url === '/api/download-file' && (method === 'GET' || method === 'HEAD'), handler: fileDownload },
  { method: 'POST', match: 'exact', path: '/api/file-content', handler: fileContentPost },
  { method: 'GET', match: 'exact', path: '/api/target-files', handler: targetFiles },
];
