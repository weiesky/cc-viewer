/**
 * File API business logic — extracted from server.js
 * Provides path validation, file read/write with security checks.
 */
import { resolve, join } from 'node:path';
import { realpathSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';

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
    return real === resolvedRoot || real.startsWith(resolvedRoot + '/');
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
 * Resolve and validate a file path. Used by readFileContent and file-raw handler.
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
  if (!isEditorSession && (reqPath.startsWith('/') || reqPath.includes('..'))) {
    const resolved = resolve(reqPath.startsWith('/') ? reqPath : join(cwd, reqPath));
    if (!isPathContained(resolved, cwd)) {
      throw new FileApiError('INVALID_PATH', 'Invalid path');
    }
    return resolve(resolved);
  }
  return resolve((isEditorSession && reqPath.startsWith('/')) ? reqPath : join(cwd, reqPath));
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
  if (!isEditorSession && (reqPath.startsWith('/') || reqPath.includes('..'))) {
    const resolved = resolve(reqPath);
    if (isPathContained(resolved, cwd)) {
      const root = realpathSync(resolve(cwd));
      const relPath = realpathSync(resolved).slice(root.length + 1);
      const targetFile = realpathSync(resolved);
      return _readAndReturn(targetFile, relPath);
    }
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }

  const targetFile = (isEditorSession && reqPath.startsWith('/')) ? reqPath : join(cwd, reqPath);
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
  if (!isEditorSession && (reqPath.startsWith('/') || reqPath.includes('..'))) {
    throw new FileApiError('INVALID_PATH', 'Invalid path');
  }
  if (typeof content !== 'string') {
    throw new FileApiError('INVALID_CONTENT', 'Content must be a string');
  }
  const targetFile = (isEditorSession && reqPath.startsWith('/')) ? reqPath : join(cwd, reqPath);
  writeFileSync(targetFile, content, 'utf-8');
  const stat = statSync(targetFile);
  return { path: reqPath, size: stat.size };
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
  const segs = dir.split('/');
  const bad = segs.find(s => s === '' || s === '.' || s === '..' || s.includes('\\'));
  if (bad !== undefined) return { ok: false, error: 'Invalid dir parameter' };
  // 大小写不敏感：macOS / Windows 默认 CI 文件系统下 `.Git` 仍指向 `.git`
  if (segs.some(s => s.toLowerCase() === '.git')) {
    return { ok: false, error: 'Writing into .git is not allowed' };
  }
  return { ok: true };
}
