// Adapted from dsh-workspace-explorer src/vendor/archive/gzip.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
import { ArchiveError, decodeFileName, readU32, toBytes } from './util.js';
import { inflateBytes } from './inflate.js';

const FHCRC = 0x02;
const FEXTRA = 0x04;
const FNAME = 0x08;
const FCOMMENT = 0x10;

export function isGzip(input) {
  const b = toBytes(input);
  return b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export function parseGzipHeader(input) {
  const b = toBytes(input);
  if (!isGzip(b)) return null;
  if (b.length < 10) throw new ArchiveError('Incomplete gzip header.', 'BAD_GZIP');
  if (b[2] !== 8) throw new ArchiveError('Unsupported gzip compression method.', 'BAD_GZIP', { method: b[2] });
  const flags = b[3];
  const mtimeSec = readU32(b, 4);
  let p = 10;
  if (flags & FEXTRA) {
    if (p + 2 > b.length) throw new ArchiveError('Incomplete gzip extra field.', 'BAD_GZIP');
    p += 2 + (b[p] | (b[p + 1] << 8));
  }
  let originalName = null;
  if (flags & FNAME) {
    const end = p < b.length ? b.indexOf(0, p) : -1;
    if (end < 0) throw new ArchiveError('Incomplete gzip filename.', 'BAD_GZIP');
    originalName = decodeFileName(b.subarray(p, end)).name;
    p = end + 1;
  }
  let comment = null;
  if (flags & FCOMMENT) {
    const end = p < b.length ? b.indexOf(0, p) : -1;
    if (end < 0) throw new ArchiveError('Incomplete gzip comment.', 'BAD_GZIP');
    comment = decodeFileName(b.subarray(p, end)).name;
    p = end + 1;
  }
  if (flags & FHCRC) p += 2;
  if (p > b.length) throw new ArchiveError('Gzip header exceeds input.', 'BAD_GZIP');
  return { mtime: mtimeSec > 0 ? mtimeSec * 1000 : null, originalName, comment, flags, os: b[9], headerSize: p };
}

export async function gunzip(input, options = {}) {
  const bytes = toBytes(input);
  if (!isGzip(bytes)) throw new ArchiveError('Invalid gzip signature.', 'BAD_GZIP');
  parseGzipHeader(bytes);
  return inflateBytes(bytes, 'gzip', { maxBytes: options.maxBytes ?? 64 * 1024 * 1024 });
}

const gzipCache = new WeakMap();
export async function gunzipCached(input, options = {}) {
  const bytes = toBytes(input);
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  let slot = gzipCache.get(bytes);
  if (!slot) {
    slot = new Map();
    gzipCache.set(bytes, slot);
  }
  if (slot.has(maxBytes)) return slot.get(maxBytes);
  const task = gunzip(bytes, { maxBytes }).catch(err => {
    slot.delete(maxBytes);
    throw err;
  });
  slot.set(maxBytes, task);
  return task;
}

export function releaseGzipCache(input) {
  gzipCache.delete(toBytes(input));
}
