import { getPreviewKind } from './previewKind.js';

export const ARCHIVE_RAW_MAX_BYTES = 32 * 1024 * 1024;
export const ARCHIVE_TEXT_MAX_BYTES = 200 * 1024;
export const ARCHIVE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const ARCHIVE_MAX_TEXT_LINES = 8000;
export const ARCHIVE_MAX_ROWS = 2000;

export function getArchivePreviewKind(filePath) {
  if (getPreviewKind(filePath) !== 'archive') return null;
  const name = String(filePath || '').split(/[\\/]/).pop().toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) return { supported: true, format: 'tar.gz' };
  if (name.endsWith('.zip')) return { supported: true, format: 'zip' };
  if (name.endsWith('.tar')) return { supported: true, format: 'tar' };
  if (name.endsWith('.gz')) return { supported: true, format: 'gzip' };
  if (name.endsWith('.txz')) return { supported: false, format: 'xz' };
  if (name.endsWith('.tbz') || name.endsWith('.tbz2')) return { supported: false, format: 'bz2' };
  for (const ext of ['7z', 'rar', 'xz', 'bz2']) {
    if (name.endsWith(`.${ext}`)) return { supported: false, format: ext };
  }
  return { supported: false, format: 'unknown' };
}

export function archiveNoteText(note, translate, formatSize) {
  const params = { ...(note.params || {}) };
  for (const key of ['size', 'max', 'shown']) {
    if (Number.isFinite(params[key])) params[key] = formatSize(params[key]);
  }
  return translate(`ui.archive.note.${note.code}`, params);
}

export function isArchiveEntrySelected(entry, selected) {
  return !!entry && entry === selected;
}

export function archiveEntryStatus(result) {
  if (result.textualHint === 'image' && !result.truncated && result.crcOk !== false) return 'image';
  if (result.notes?.some(note => note.code === 'LINK_ENTRY')) return 'link';
  if (result.notes?.some(note => note.code === 'DEVICE_ENTRY')) return 'device';
  if (['text', 'empty', 'binary'].includes(result.textualHint)) return result.textualHint;
  return 'binary';
}

export function shouldShowArchiveNotices(result, visible, treeTruncated = false) {
  return result.notes.length > 0 || result.truncated || visible.truncated || treeTruncated;
}

export function archiveErrorText(error, translate) {
  if (!error?.code) return translate('ui.archive.loadFailed');
  const known = ['ENCRYPTED', 'UNSUPPORTED_METHOD', 'NO_DECOMPRESSION'];
  const key = known.includes(error.code) ? error.code : 'CORRUPT';
  const params = { format: error.params?.format || error.params?.method || '' };
  return translate(`ui.archive.error.${key}`, params);
}

export function flattenArchiveTree(root, expanded, maxRows = ARCHIVE_MAX_ROWS) {
  const rows = [];
  const stack = root.children.slice().reverse().map(node => ({ node, depth: 0 }));
  while (stack.length && rows.length < maxRows) {
    const { node, depth } = stack.pop();
    rows.push({ node, depth });
    if (node.dir && expanded.has(node.path)) {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1 });
    }
  }
  return { rows, truncated: stack.length > 0 };
}
