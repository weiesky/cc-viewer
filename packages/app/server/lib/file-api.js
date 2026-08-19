/**
 * File API business logic — extracted from server.js
 * Provides path validation, file read/write with security checks.
 */
import { resolve, join, sep, isAbsolute } from 'node:path';
import { realpathSync, existsSync, statSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

/**
 * Check whether targetPath is contained within the project root directory.
 * Resolves symlinks via realpathSync. Returns false on any error.
 * @param {string} targetPath - absolute path to check
 * @param {string} [root] - project root (defaults to CCV_PROJECT_DIR or cwd)
 * @returns {boolean}
 */
export function isPathContained(targetPath, root) {
  try {
    const resolvedRoot = realpathSync(resolve(root || process.env.CCV_PROJECT_DIR || process.cwd()));
    const real = realpathSync(resolve(targetPath));
    return real === resolvedRoot || real.startsWith(resolvedRoot + sep);
  } catch { return false; }
}

/** Custom error with a code property for HTTP status mapping */
class FileApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Resolve and validate a file path. No production callers (readFileContent does its own inline
 * path validation); kept as a standalone, path-traversal-defending helper covered by
 * test/file-api-gap.test.js — don't delete as "dead code" without removing that test.
 * @param {string} cwd - project working directory
 * @param {string} reqPath - requested path (relative or absolute)
 * @param {boolean} isEditorSession - whether this is an editor session
 * @returns {string} resolved absolute file path
 * @throws {FileApiError} with code 'INVALID_PATH'
 */
export function resolveFilePath(cwd, reqPath, isEditorSession) {
  if (!reqPath) {
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }
  if (!isEditorSession && (isAbsolute(reqPath) || reqPath.includes('..'))) {
    const resolved = resolve(isAbsolute(reqPath) ? reqPath : join(cwd, reqPath));
    if (!isPathContained(resolved, cwd)) {
      throw new FileApiError('INVALID_PATH', 'Invalid path');
    }
    return resolve(resolved);
  }
  return resolve((isEditorSession && isAbsolute(reqPath)) ? reqPath : join(cwd, reqPath));
}

/**
 * Read file content with size limit and security checks.
 * @param {string} cwd - project working directory
 * @param {string} reqPath - requested path
 * @param {boolean} isEditorSession
 * @returns {{ path: string, content: string, size: number }}
 */
export function readFileContent(cwd, reqPath, isEditorSession) {
  if (!reqPath) {
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }

  // For non-editor sessions with absolute / ".." paths that are within project dir,
  // return the relative path from project root
  if (!isEditorSession && (isAbsolute(reqPath) || reqPath.includes('..'))) {
    const resolved = resolve(reqPath);
    if (isPathContained(resolved, cwd)) {
      const root = realpathSync(resolve(cwd));
      const relPath = realpathSync(resolved).slice(root.length + 1);
      const targetFile = realpathSync(resolved);
      return _readAndReturn(targetFile, relPath);
    }
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }

  const targetFile = (isEditorSession && isAbsolute(reqPath)) ? reqPath : join(cwd, reqPath);
  return _readAndReturn(targetFile, reqPath);
}

function _readAndReturn(targetFile, displayPath) {
  if (!existsSync(targetFile)) {
    throw new FileApiError('NOT_FOUND', `File not found: ${targetFile}`);
  }
  const stat = statSync(targetFile);
  if (!stat.isFile()) {
    throw new FileApiError('NOT_FILE', 'Not a file');
  }
  if (stat.size > 5 * 1024 * 1024) {
    throw new FileApiError('TOO_LARGE', 'File too large');
  }
  const content = readFileSync(targetFile, 'utf-8');
  return { path: displayPath, content, size: stat.size };
}

/**
 * Write file content.
 * @param {string} cwd - project working directory
 * @param {string} reqPath - requested path
 * @param {string} content - file content to write
 * @param {boolean} isEditorSession
 * @returns {{ path: string, size: number }}
 */
export function writeFileContent(cwd, reqPath, content, isEditorSession) {
  if (!reqPath) {
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }
  if (!isEditorSession && (isAbsolute(reqPath) || reqPath.includes('..'))) {
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }
  if (typeof content !== 'string') {
    throw new FileApiError('INVALID_CONTENT', 'Content must be a string');
  }
  const targetFile = (isEditorSession && isAbsolute(reqPath)) ? reqPath : join(cwd, reqPath);
  writeFileSync(targetFile, content, 'utf-8');
  const stat = statSync(targetFile);
  return { path: reqPath, size: stat.size };
}

/**
 * renameSync 带 retry —— Windows 上目标文件被 reader（chokidar / watchFile / 编辑器预览）
 * 持有时会抛 EACCES/EPERM/EBUSY。POSIX 不会，但 helper 上行为相同。
 * 只 retry 这 3 个 code，其它错误（ENOENT / EISDIR / EXDEV）直接抛——retry 无意义。
 *
 * @param {string} src
 * @param {string} dst
 * @param {{retries?: number, delayMs?: number}} [opts]
 */
export function renameSyncWithRetry(src, dst, opts = {}) {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 20;
  const RETRYABLE = new Set(['EACCES', 'EPERM', 'EBUSY']);
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (i === retries - 1 || !RETRYABLE.has(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  throw lastErr;
}

/** Map FileApiError codes to HTTP status codes */
export const ERROR_STATUS_MAP = {
  INVALID_PATH: 400,
  NOT_FOUND: 404,
  NOT_FILE: 400,
  TOO_LARGE: 413,
  INVALID_CONTENT: 400,
};

/**
 * Validate the `dir` query parameter used by POST /api/import-file.
 * Pure string-level check performed BEFORE mkdirSync, so malicious values
 * (e.g., symlink-traversal into `/etc`) never create side-effect directories.
 *
 * Accepted: empty string (root) or a forward-slash-separated path where every
 * segment is non-empty, not `.`/`..`, doesn't contain `\`, and none is `.git`.
 *
 * @param {unknown} dir
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function validateImportDir(dir) {
  if (typeof dir !== 'string') return { ok: false, error: 'Invalid dir parameter' };
  if (dir === '') return { ok: true };
  if (dir.startsWith('/') || dir.startsWith('\\') || dir.includes('\0')) {
    return { ok: false, error: 'Invalid dir parameter' };
  }
  // 故意按 '/' 切段：本函数契约要求 POSIX-style 相对路径，所以段内 '\\' 必须被下文 includes 检测拒掉
  // （否则 `src/foo\bar` 在 Win 上会被 join 解释成 `src/foo\bar` 双重含义）。
  const segs = dir.split('/');
  const bad = segs.find(s => s === '' || s === '.' || s === '..' || s.includes('\\'));
  if (bad !== undefined) return { ok: false, error: 'Invalid dir parameter' };
  // 大小写不敏感：macOS / Windows 默认 CI 文件系统下 `.Git` 仍指向 `.git`
  if (segs.some(s => s.toLowerCase() === '.git')) {
    return { ok: false, error: 'Writing into .git is not allowed' };
  }
  return { ok: true };
}
