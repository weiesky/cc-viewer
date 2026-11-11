import { getExt, getFileType } from './fileTypes.js';

const PREVIEW_KINDS = new Set(['archive', 'image', 'audio', 'video', 'font', 'pdf']);
const DOWNLOAD_ONLY_KINDS = new Set(['audio', 'video', 'font', 'pdf', 'binary']);

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

export function isBinaryContentError(status, body) {
  return status === 415 && body?.reason === 'binary';
}
