import { getExt, getFileType } from './fileTypes.js';

const PREVIEW_KINDS = new Set(['archive', 'image', 'audio', 'video', 'font', 'pdf']);
const DOWNLOAD_ONLY_KINDS = new Set(['video', 'font', 'pdf', 'binary']);

export function getPreviewKind(name, type) {
  const category = getFileType(name, type);
  if (category === 'directory') return null;
  if (PREVIEW_KINDS.has(category)) return category;
  const ext = getExt(name);
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (category === 'binary' || category === 'office') return 'binary';
  return 'text';
}

export function isDownloadOnlyPreview(kind) {
  return DOWNLOAD_ONLY_KINDS.has(kind);
}

// Kinds that should bypass the git-diff view on a GitChanges single-click and open
// the file viewer instead (a real preview or the download placeholder). Used by
// ChatView's GitChanges handler; FileContentView dispatches these same kinds itself.
export function opensInFileViewer(kind) {
  return isDownloadOnlyPreview(kind) || kind === 'audio';
}

export function isBinaryContentError(status, body) {
  return status === 415 && body?.reason === 'binary';
}
