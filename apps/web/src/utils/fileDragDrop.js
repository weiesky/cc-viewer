import { planPasteSend } from './terminalClipboard.js';
import { sanitizeBracketPasteText } from './ptyChunkBuilder.js';

export const FILE_DRAG_TYPE = 'text/x-ccv-file';
const INTERNAL_MOVE_TYPE = 'text/x-internal-move';
const UNSAFE_PATH_CHAR = new RegExp("[\\0-\\x1f\\x7f-\\x9f\\u2028\\u2029]");

function hasDragType(e, type) {
  return Array.from(e?.dataTransfer?.types || []).includes(type);
}

export function isFileDrag(e) {
  return hasDragType(e, INTERNAL_MOVE_TYPE) && hasDragType(e, FILE_DRAG_TYPE);
}

export function isSafeAttachmentPath(path) {
  return typeof path === 'string' && path.length > 0 && !UNSAFE_PATH_CHAR.test(path);
}

export function getDraggedFilePath(e) {
  if (!isFileDrag(e)) return null;
  const path = e.dataTransfer.getData('text/plain');
  if (!path) console.warn('[file-drag-drop] empty text/plain payload');
  return isSafeAttachmentPath(path) ? path : null;
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
