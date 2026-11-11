import { planPasteSend } from './terminalClipboard.js';
import { sanitizeBracketPasteText } from './ptyChunkBuilder.js';

export const FILE_DRAG_TYPE = 'text/x-ccv-file';
export const FOLDER_DRAG_TYPE = 'text/x-ccv-folder';
const INTERNAL_MOVE_TYPE = 'text/x-internal-move';
const UNSAFE_PATH_CHAR = new RegExp("[\\0-\\x1f\\x7f-\\x9f\\u2028\\u2029]");

function hasDragType(e, type) {
  return Array.from(e?.dataTransfer?.types || []).includes(type);
}

export function isFileDrag(e) {
  return hasDragType(e, INTERNAL_MOVE_TYPE)
    && (hasDragType(e, FILE_DRAG_TYPE) || hasDragType(e, FOLDER_DRAG_TYPE));
}

export function isSafeAttachmentPath(path) {
  return typeof path === 'string' && path.length > 0 && !UNSAFE_PATH_CHAR.test(path);
}

export function getDraggedEntry(e) {
  if (!isFileDrag(e)) return null;
  const path = e.dataTransfer.getData('text/plain');
  if (!path) console.warn('[file-drag-drop] empty text/plain payload');
  return isSafeAttachmentPath(path) ? { path, isDir: hasDragType(e, FOLDER_DRAG_TYPE) } : null;
}

export function getDraggedFilePath(e) {
  return getDraggedEntry(e)?.path || null;
}

export function formatFolderPath(path) {
  if (!isSafeAttachmentPath(path)) return '';
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return normalized.startsWith('/') ? '/' : '';
  const label = parts.length <= 2 ? parts.join('/') : `${parts[0]}/…/${parts[parts.length - 1]}`;
  return normalized.startsWith('/') ? `/${label}` : label;
}

export function quotePathForTerminal(path, shell = '') {
  if (!isSafeAttachmentPath(path)) return '';
  const name = shell.toLowerCase().replace(/\.exe$/, '');
  if (name === 'cmd') return /["%]/.test(path) ? '' : `"${path}"`;
  if (name === 'powershell' || name === 'pwsh') return `'${path.replace(/'/g, "''")}'`;
  // Fish uses backslash escapes inside single quotes, unlike POSIX shells.
  if (name === 'fish') return `'${path.replace(/([\\'])/g, '\\$1')}'`;
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function planFileDropInput(path, { bracketedPasteMode = false, shell = '' } = {}) {
  if (!isSafeAttachmentPath(path)) return null;
  const quoted = quotePathForTerminal(path, shell);
  if (!quoted) return null;
  return planPasteSend(`${quoted} `, {
    active: true,
    bracketedPasteMode,
    sanitize: sanitizeBracketPasteText,
  });
}
