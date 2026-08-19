// Filesystem mutation + browse + editor + OS-open routes (moved verbatim from server.js handleRequest).
import {
  existsSync, statSync, lstatSync, readdirSync, mkdirSync, writeFileSync,
  realpathSync, renameSync, rmSync, unlinkSync, cpSync, copyFileSync,
} from 'node:fs';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { bumpWorkspacesVersion } from '../lib/file-access-policy.js';
import { validateImportDir } from '../lib/file-api.js';
import { PROFILE_PATH, _projectName, _logDir } from '../interceptor.js';
import { LOG_DIR, getClaudeConfigDir } from '../../findcc.js';

function upload(req, res, parsedUrl, isLocal, deps) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing boundary' }));
    return;
  }
  const MAX_UPLOAD = 100 * 1024 * 1024; // 100MB
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_UPLOAD) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
    return;
  }
  const boundary = boundaryMatch[1];
  const chunks = [];
  let totalSize = 0;
  let aborted = false;
  req.on('data', chunk => {
    totalSize += chunk.length;
    if (totalSize > MAX_UPLOAD) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      const buf = Buffer.concat(chunks);
      // Find the first part's headers and body
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) throw new Error('Malformed multipart');
      const headerStr = buf.slice(0, headerEnd).toString();
      const nameMatch = headerStr.match(/filename="([^"]+)"/);
      if (!nameMatch) throw new Error('No filename');
      // sanitize: 只过 null byte + 控制字符 + 路径分隔符（真正会破坏 fs 调用的字符）；
      // Windows 非法字符 <>:"|?* 在 Unix 合法（ISO 时间戳 10:30:45.log、name:v1.txt 等常见），
      // 不做跨平台代理过滤，让 writeFileSync 在 Windows 上自行抛错即可。
      const originalName = nameMatch[1].replace(/[\x00-\x1f/\\]/g, '_');
      // Windows 保留设备名守卫（/api/upload-image）——见 WINDOWS_RESERVED_NAMES 注释。
      {
        const base = originalName.split('.')[0].trim().toLowerCase();
        if (deps.WINDOWS_RESERVED_NAMES.test(base)) {
          throw new Error('Reserved filename not allowed');
        }
      }
      const bodyStart = headerEnd + 4;
      // Find the closing boundary
      const closingBoundary = Buffer.from('\r\n--' + boundary);
      const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
      const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);
      // Windows 没有 /tmp，走 os.tmpdir() (%TEMP%)；POSIX 保留 /tmp/cc-viewer-uploads/
      // 以兼容 1.6.245 PR #81 的 macOS allowlist 修复（/private/tmp 双 realpath）。
      const uploadDir = process.platform === 'win32' ? join(tmpdir(), 'cc-viewer-uploads') : '/tmp/cc-viewer-uploads';
      mkdirSync(uploadDir, { recursive: true });
      bumpWorkspacesVersion();
      // Unique filename: prepend timestamp to avoid silent overwrite
      const ts = Date.now();
      const dotIdx = originalName.lastIndexOf('.');
      const uniqueName = dotIdx > 0
        ? `${originalName.slice(0, dotIdx)}-${ts}${originalName.slice(dotIdx)}`
        : `${originalName}-${ts}`;
      const savePath = join(uploadDir, uniqueName);
      writeFileSync(savePath, fileData);
      // 持久化副本到 ~/.claude/cc-viewer/${project}/images/，避免 /tmp 清理后丢失
      let persistPath = null;
      try {
        const pName = _projectName || 'default';
        const persistDir = join(getClaudeConfigDir(), 'cc-viewer', pName, 'images');
        mkdirSync(persistDir, { recursive: true });
        persistPath = join(persistDir, uniqueName);
        writeFileSync(persistPath, fileData);
      } catch { }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: savePath, persistPath }));
    } catch (err) {
      console.error('upload error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Upload failed' }));
    }
  });
}

function importFile(req, res, parsedUrl, isLocal, deps) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing boundary' }));
    return;
  }
  const importUrl = new URL(req.url, `${deps.protocol}://${req.headers.host}`);
  const dir = importUrl.searchParams.get('dir') || '';
  // 在 mkdirSync 之前纯字符串校验，防 symlink 副作用目录被创建在项目外
  const dirCheck = validateImportDir(dir);
  if (!dirCheck.ok) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: dirCheck.error }));
    return;
  }
  const MAX_UPLOAD = 100 * 1024 * 1024; // 100MB
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_UPLOAD) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
    return;
  }
  const boundary = boundaryMatch[1];
  const chunks = [];
  let totalSize = 0;
  let aborted = false;
  req.on('data', chunk => {
    totalSize += chunk.length;
    if (totalSize > MAX_UPLOAD) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large (max 100MB)' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const targetDir = join(cwd, dir);
      mkdirSync(targetDir, { recursive: true });
      const realDir = realpathSync(targetDir);
      const realCwd = realpathSync(cwd);
      if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      const buf = Buffer.concat(chunks);
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) throw new Error('Malformed multipart');
      const headerStr = buf.slice(0, headerEnd).toString();
      const nameMatch = headerStr.match(/filename="([^"]+)"/);
      if (!nameMatch) throw new Error('No filename');
      // sanitize 与 /api/upload 一致：只过真正有害的字符，保留 Unix 合法 : " < > | ? * 等
      const originalName = nameMatch[1].replace(/[\x00-\x1f/\\]/g, '_');
      // Windows 保留设备名守卫（见 WINDOWS_RESERVED_NAMES 注释）。
      {
        const base = originalName.split('.')[0].trim().toLowerCase();
        if (deps.WINDOWS_RESERVED_NAMES.test(base)) {
          throw new Error('Reserved filename not allowed');
        }
      }
      const bodyStart = headerEnd + 4;
      const closingBoundary = Buffer.from('\r\n--' + boundary);
      const bodyEnd = buf.indexOf(closingBoundary, bodyStart);
      const fileData = bodyEnd !== -1 ? buf.slice(bodyStart, bodyEnd) : buf.slice(bodyStart);
      // Resolve unique filename via exclusive write (wx)；避免并发 TOCTOU 覆盖
      const dotIdx = originalName.lastIndexOf('.');
      const stem = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
      const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
      let finalName = originalName;
      let savePath = join(realDir, finalName);
      let counter = 1;
      let written = false;
      // 最多重试 10000 次（极端场景保底）；耗尽后必须显式抛错，防止返回虚假成功
      while (counter < 10001) {
        try {
          writeFileSync(savePath, fileData, { flag: 'wx' });
          written = true;
          break;
        } catch (e) {
          if (e && e.code === 'EEXIST') {
            finalName = `${stem}-${counter}${ext}`;
            savePath = join(realDir, finalName);
            counter++;
            continue;
          }
          throw e;
        }
      }
      if (!written) throw new Error('Too many filename conflicts');
      const relPath = dir ? `${dir}/${finalName}` : finalName;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: finalName, relPath }));
    } catch (err) {
      console.error('import-file error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Import failed' }));
    }
  });
}

function browseDir(req, res, parsedUrl) {
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
}

async function files(req, res, parsedUrl, isLocal, deps) {
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
      .filter(e => !deps.IGNORED_PATTERNS.has(e.name))
      .map(e => {
        // Dirent.isDirectory() 不解引用 symlink —— 对指向目录的 symlink 也返回 false。
        // 需要对 symlink 单独 statSync（follow link）才能拿到真实类型，否则前端会把
        // symlink-to-dir 当成文件渲染，不可展开。断链时 fallback 到 file，避免单个
        // 坏链接让整个目录返回 404。
        let type = e.isDirectory() ? 'directory' : 'file';
        if (e.isSymbolicLink()) {
          try { type = statSync(join(targetDir, e.name)).isDirectory() ? 'directory' : 'file'; }
          catch { type = 'file'; }
        }
        return { name: e.name, type };
      })
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
        const result = await deps.execWithStdin('git', ['check-ignore', '--stdin'], names.join('\n'), {
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
}

function renameFile(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { oldPath, newName } = parsed;
      if (!oldPath || !newName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing oldPath or newName' }));
        return;
      }
      // 安全校验
      if (oldPath.startsWith('/') || oldPath.includes('..') || newName.includes('/') || newName.includes('\\') || newName.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const oldFullPath = join(cwd, oldPath);
      const parentDir = dirname(oldFullPath);
      const newFullPath = join(parentDir, newName);
      // 检查源文件存在
      if (!existsSync(oldFullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      // 检查目标是否已存在
      if (existsSync(newFullPath)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Target already exists' }));
        return;
      }
      renameSync(oldFullPath, newFullPath);
      const newRelPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + newName : newName;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, newPath: newRelPath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function moveFile(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { fromPath, toDir } = parsed;
      if (!fromPath || !toDir) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing fromPath or toDir' }));
        return;
      }
      // 安全校验
      if (fromPath.startsWith('/') || fromPath.includes('..') || toDir.startsWith('/') || toDir.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const oldFullPath = join(cwd, fromPath);
      const toDirFull = join(cwd, toDir);
      // 检查源文件/目录存在
      if (!existsSync(oldFullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Source not found' }));
        return;
      }
      // 检查目标目录存在且是目录
      if (!existsSync(toDirFull) || !statSync(toDirFull).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Target directory not found' }));
        return;
      }
      // 不能把目录移到自身或其子目录下
      if (statSync(oldFullPath).isDirectory()) {
        const srcResolved = resolve(oldFullPath);
        const destResolved = resolve(toDirFull);
        if (destResolved === srcResolved || destResolved.startsWith(srcResolved + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot move directory into itself' }));
          return;
        }
      }
      const name = basename(fromPath);
      const newFullPath = join(toDirFull, name);
      // 检查目标位置不存在同名文件
      if (existsSync(newFullPath)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Target already exists' }));
        return;
      }
      try {
        renameSync(oldFullPath, newFullPath);
      } catch (mvErr) {
        if (mvErr.code === 'EXDEV') {
          // 跨文件系统：fallback to copy + delete。先 lstat 拒 symlink ——避免攻击者 swap 让
          // cpSync 跟随复制 + rmSync 跟随删除（同 /api/delete-file 的 TOCTOU）。
          const oldStat = lstatSync(oldFullPath);
          if (oldStat.isSymbolicLink()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot move symbolic links via this endpoint' }));
            return;
          }
          if (oldStat.isDirectory()) {
            // dereference: false 是 Node 默认，但显式写明意图——避免未来默认变更让递归 copy
            // 跟随内嵌 symlink 复制到 newFullPath 形成 cwd 内"指向 cwd 外"的活链。
            cpSync(oldFullPath, newFullPath, { recursive: true, dereference: false });
            rmSync(oldFullPath, { recursive: true, force: true });
          } else {
            copyFileSync(oldFullPath, newFullPath);
            unlinkSync(oldFullPath);
          }
        } else if (mvErr.code === 'EEXIST') {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Target already exists' }));
          return;
        } else {
          throw mvErr;
        }
      }
      // 返回前端 JSON 统一 POSIX 风格，path.join 在 Win 上会产 backslash，需 normalize 回 '/'。
      const newRelPath = join(toDir, name).replace(/\\/g, '/');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, newPath: newRelPath }));
    } catch (err) {
      console.error('move-file error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
}

function deleteFile(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { path: filePath } = parsed;
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path' }));
        return;
      }
      if (filePath.startsWith('/') || filePath.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullPath = join(cwd, filePath);
      if (!existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const realFull = realpathSync(fullPath);
      const realCwd = realpathSync(cwd);
      if (!realFull.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      // 用 lstatSync 不跟随 symlink ——避免 TOCTOU 攻击者把目标换成软链让 rmSync(recursive)
      // 在 POSIX 上跟着删 cwd 外的目录。一切 symlink 目标都拒绝。
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot delete symbolic links via this endpoint' }));
        return;
      }
      if (stat.isDirectory()) {
        // protectedDirs 守卫得对 Win backslash 路径 & NTFS case-insensitive 同时设防 ——
        // 否则 `path: "node_modules\\foo"` 或 `".GIT"` 都能绕过 split('/') 直接删整目录。
        const protectedDirs = new Set(['node_modules', '.git', '.svn', '.hg']);
        const normalizedSegs = filePath.split(/[\\/]/).map(s => s.toLowerCase());
        if (normalizedSegs.some(part => protectedDirs.has(part))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Cannot delete protected directory' }));
          return;
        }
        // Defense-in-depth：lstat 跟 rmSync 间窗内攻击者再次 swap → 再 realpath 确认。
        const realFull2 = realpathSync(fullPath);
        if (!realFull2.startsWith(realCwd + sep)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path escaped cwd after validation' }));
          return;
        }
        rmSync(fullPath, { recursive: true, force: true });
      } else if (stat.isFile()) {
        unlinkSync(fullPath);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unsupported path type' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function revealFile(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { path: filePath } = parsed;
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path' }));
        return;
      }
      if (filePath.startsWith('/') || filePath.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullPath = join(cwd, filePath);
      if (!existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const realFull = realpathSync(fullPath);
      const realCwd = realpathSync(cwd);
      if (!realFull.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      const plat = process.platform;
      if (plat === 'darwin') {
        execFile('open', ['-R', fullPath], () => {});
      } else if (plat === 'win32') {
        // explorer /select 的规范形式是 /select,"<path>"（仅路径部分加引号、整体一个 arg）。
        // 必须 windowsVerbatimArguments 透传：否则 Node 对含空格 arg 整体加引号生成
        // explorer.exe "/select,C:\My Proj\x.txt"，explorer 解析不了 → 功能失效。
        // Windows 文件名不允许 "，且不经 cmd.exe，无元字符注入面。
        const child = spawn('explorer.exe', [`/select,"${fullPath}"`], { windowsVerbatimArguments: true, windowsHide: true });
        child.on('error', () => {}); // 防 async ENOENT 变 uncaughtException 砸进程
      } else {
        execFile('xdg-open', [dirname(fullPath)], () => {});
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, fullPath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function openFile(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { path: filePath } = parsed;
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing path' }));
        return;
      }
      if (filePath.startsWith('/') || filePath.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullPath = join(cwd, filePath);
      if (!existsSync(fullPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      const realFull = realpathSync(fullPath);
      const realCwd = realpathSync(cwd);
      if (!realFull.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      const plat = process.platform;
      if (plat === 'darwin') {
        execFile('open', [fullPath], () => {});
      } else if (plat === 'win32') {
        execFile('cmd.exe', ['/c', 'start', '', fullPath], { windowsHide: true }, () => {});
      } else {
        execFile('xdg-open', [fullPath], () => {});
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function resolvePath(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const relPath = parsed.path || '';
      if (relPath.startsWith('/') || relPath.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullPath = relPath ? join(cwd, relPath) : cwd;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, fullPath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function createFile(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { dirPath, name } = parsed;
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing name' }));
        return;
      }
      if (name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f]/.test(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid file name' }));
        return;
      }
      const relDir = dirPath || '';
      if (relDir.startsWith('/') || relDir.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullDirPath = relDir ? join(cwd, relDir) : cwd;
      if (!existsSync(fullDirPath) || !statSync(fullDirPath).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory not found' }));
        return;
      }
      const realDir = realpathSync(fullDirPath);
      const realCwd = realpathSync(cwd);
      if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      const fullPath = join(fullDirPath, name);
      if (existsSync(fullPath)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File already exists' }));
        return;
      }
      writeFileSync(fullPath, '');
      const relPath = relDir ? `${relDir}/${name}` : name;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: relPath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function openTerminal(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const relDir = (parsed.path || '');
      if (relDir.startsWith('/') || relDir.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullDir = relDir ? join(cwd, relDir) : cwd;
      if (!existsSync(fullDir) || !statSync(fullDir).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory not found' }));
        return;
      }
      const realDir = realpathSync(fullDir);
      const realCwd = realpathSync(cwd);
      if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      const plat = process.platform;
      if (plat === 'darwin') {
        spawn('open', ['-a', 'Terminal', fullDir], { stdio: 'ignore', detached: true }).unref();
      } else if (plat === 'win32') {
        spawn('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd: fullDir, stdio: 'ignore', detached: true, windowsHide: true }).unref();
      } else {
        // Linux: try common terminal emulators
        const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
        let launched = false;
        for (const term of terminals) {
          try {
            if (term === 'gnome-terminal') {
              spawn(term, ['--working-directory=' + fullDir], { stdio: 'ignore', detached: true }).unref();
            } else if (term === 'konsole') {
              spawn(term, ['--workdir', fullDir], { stdio: 'ignore', detached: true }).unref();
            } else {
              spawn(term, [], { cwd: fullDir, stdio: 'ignore', detached: true }).unref();
            }
            launched = true;
            break;
          } catch { continue; }
        }
        if (!launched) {
          spawn('xdg-open', [fullDir], { stdio: 'ignore', detached: true }).unref();
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function createDir(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }
    try {
      const { dirPath, name } = parsed;
      if (!name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing name' }));
        return;
      }
      if (name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f]/.test(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid folder name' }));
        return;
      }
      const relDir = dirPath || '';
      if (relDir.startsWith('/') || relDir.includes('..')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid path' }));
        return;
      }
      const cwd = process.env.CCV_PROJECT_DIR || process.cwd();
      const fullDirPath = relDir ? join(cwd, relDir) : cwd;
      if (!existsSync(fullDirPath) || !statSync(fullDirPath).isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory not found' }));
        return;
      }
      const realDir = realpathSync(fullDirPath);
      const realCwd = realpathSync(cwd);
      if (realDir !== realCwd && !realDir.startsWith(realCwd + sep)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path traversal not allowed' }));
        return;
      }
      const fullPath = join(fullDirPath, name);
      if (existsSync(fullPath)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Already exists' }));
        return;
      }
      mkdirSync(fullPath);
      const relPath = relDir ? `${relDir}/${name}` : name;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: relPath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function openLogDir(req, res) {
  // Project dir works for both formats (legacy v1 files and the v2 sessions/
  // tree are siblings under it); LOG_DIR is the pre-workspace fallback.
  const dir = _logDir || LOG_DIR;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [dir], { windowsHide: true }, () => {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, dir }));
}

function openProfileDir(req, res) {
  const dir = dirname(PROFILE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [dir], { windowsHide: true }, () => {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, dir }));
}

function openProjectDir(req, res) {
  const dir = process.env.CCV_PROJECT_DIR || process.cwd();
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [dir], { windowsHide: true }, () => {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, dir }));
}

function openMemoryDir(req, res) {
  // memory 目录推导与 files-content.js projectMemory(cwd→encoded→memory)保持一致；若一方改动需同步。
  // 仅打开目录、不读文件，故无需 projectMemory 内的 realpath/traversal 校验。
  const cwd = (process.env.CCV_PROJECT_DIR || process.cwd()).replace(/[/\\]+$/, '');
  const encoded = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  const dir = join(getClaudeConfigDir(), 'projects', encoded, 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [dir], { windowsHide: true }, (err) => {
    if (err) console.error('[CC Viewer] openMemoryDir failed:', err.message);
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, dir }));
}

function editorOpen(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const { sessionId, filePath } = JSON.parse(body);
      if (!sessionId || !filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId or filePath' }));
        return;
      }
      deps.editorSessions.set(sessionId, { filePath, done: false, createdAt: Date.now() });
      // Broadcast to all terminal WebSocket clients
      if (deps.terminalWss) {
        const msg = JSON.stringify({ type: 'editor-open', sessionId, filePath });
        deps.terminalWss.clients.forEach(client => {
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
}

function editorStatus(req, res, parsedUrl, isLocal, deps) {
  const id = parsedUrl.searchParams.get('id');
  if (!id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing id' }));
    return;
  }
  const session = deps.editorSessions.get(id);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ done: session ? session.done : true }));
}

function editorDone(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const { sessionId } = JSON.parse(body);
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId' }));
        return;
      }
      const session = deps.editorSessions.get(sessionId);
      if (session) {
        session.done = true;
      }
      // Clean up after a short delay to allow the polling to pick it up
      setTimeout(() => deps.editorSessions.delete(sessionId), 5000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
  });
}

export const filesFsRoutes = [
  { method: 'POST', match: 'exact', path: '/api/upload', handler: upload },
  { method: 'POST', match: 'prefix', path: '/api/import-file', handler: importFile },
  { method: 'GET', match: 'prefix', path: '/api/browse-dir', handler: browseDir },
  { method: 'GET', match: 'exact', path: '/api/files', handler: files },
  { method: 'POST', match: 'exact', path: '/api/rename-file', handler: renameFile },
  { method: 'POST', match: 'exact', path: '/api/move-file', handler: moveFile },
  { method: 'POST', match: 'exact', path: '/api/delete-file', handler: deleteFile },
  { method: 'POST', match: 'exact', path: '/api/reveal-file', handler: revealFile },
  { method: 'POST', match: 'exact', path: '/api/open-file', handler: openFile },
  { method: 'POST', match: 'exact', path: '/api/resolve-path', handler: resolvePath },
  { method: 'POST', match: 'exact', path: '/api/create-file', handler: createFile },
  { method: 'POST', match: 'exact', path: '/api/open-terminal', handler: openTerminal },
  { method: 'POST', match: 'exact', path: '/api/create-dir', handler: createDir },
  { method: 'POST', match: 'exact', path: '/api/open-log-dir', handler: openLogDir },
  { method: 'POST', match: 'exact', path: '/api/open-profile-dir', handler: openProfileDir },
  { method: 'POST', match: 'exact', path: '/api/open-project-dir', handler: openProjectDir },
  { method: 'POST', match: 'exact', path: '/api/open-memory-dir', handler: openMemoryDir },
  { method: 'POST', match: 'exact', path: '/api/editor-open', handler: editorOpen },
  { method: 'GET', match: 'prefix', path: '/api/editor-status', handler: editorStatus },
  { method: 'POST', match: 'exact', path: '/api/editor-done', handler: editorDone },
];
