// Adapted from dsh-workspace-explorer src/vendor/archive/util.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
// This module intentionally uses only Web-standard byte and text APIs.

export const MAX_ENTRY_DEPTH = 64;
export const MAX_ENTRY_NAME_BYTES = 4096;

export class ArchiveError extends Error {
  constructor(message, code = 'ARCHIVE_ERROR', params = {}) {
    super(message);
    this.name = 'ArchiveError';
    this.code = code;
    this.params = params;
  }
}

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new ArchiveError('Archive data must be a Uint8Array or ArrayBuffer.', 'BAD_INPUT');
}

export function readU16(b, o) {
  return b[o] | (b[o + 1] << 8);
}

export function readU32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

export function readU64(b, o) {
  const value = readU32(b, o) + readU32(b, o + 4) * 0x100000000;
  if (!Number.isSafeInteger(value)) throw new ArchiveError('ZIP64 value exceeds the safe integer range.', 'UNSAFE_SIZE');
  return value;
}

export function concatBytes(chunks, total) {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const decoderCache = new Map();
export function getDecoder(label, fatal = false) {
  const key = `${label}|${fatal}`;
  if (decoderCache.has(key)) return decoderCache.get(key);
  let decoder;
  try {
    decoder = new TextDecoder(label, { fatal });
  } catch {
    decoder = null;
  }
  decoderCache.set(key, decoder);
  return decoder;
}

function tryDecode(label, bytes, fatal) {
  const decoder = getDecoder(label, fatal);
  if (!decoder) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function latin1(bytes) {
  let out = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return out;
}

function decodeLegacyText(bytes) {
  const asGbk = tryDecode('gbk', bytes, true) ?? (truncated ? tryDecode('gbk', bytes, false) : null);
  const hasCjk = asGbk !== null && [...asGbk].some(char => {
    const code = char.codePointAt(0);
    return code >= 0x4e00 && code <= 0x9fff;
  });
  if (hasCjk) return { text: asGbk, encoding: 'gbk' };
  return { text: latin1(bytes), encoding: 'latin1' };
}

export function decodeFileName(bytes, { utf8Flag = false } = {}) {
  const b = toBytes(bytes);
  if (b.length === 0) return { name: '', encoding: 'utf-8' };
  const asUtf8 = tryDecode('utf-8', b, true);
  if (asUtf8 !== null) return { name: asUtf8, encoding: 'utf-8' };
  if (utf8Flag) return { name: tryDecode('utf-8', b, false) ?? latin1(b), encoding: 'utf-8-lossy' };
  const legacy = decodeLegacyText(b);
  return { name: legacy.text, encoding: legacy.encoding };
}

const textEncoder = new TextEncoder();
function cleanDisplaySegment(segment) {
  return segment.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
}

// Entry names are display-only. Do not use this function to resolve filesystem paths.
export function normalizeEntryPath(raw) {
  const input = String(raw ?? '');
  const truncated = input.length > MAX_ENTRY_NAME_BYTES;
  const source = (truncated ? input.slice(0, MAX_ENTRY_NAME_BYTES) : input).replace(/\\/g, '/');
  const trailingSlash = /\/$/.test(input);
  const clean = [];
  let unsafe = truncated;
  let length = 0;
  for (const part of source.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' || /^[a-zA-Z]:$/.test(part) || clean.length >= MAX_ENTRY_DEPTH) unsafe = true;
    if (clean.length >= MAX_ENTRY_DEPTH) break;
    const name = cleanDisplaySegment(part);
    const nameLength = textEncoder.encode(name).length;
    if (length + nameLength > MAX_ENTRY_NAME_BYTES) {
      let shortened = '';
      let used = 0;
      for (const char of name) {
        const charLength = textEncoder.encode(char).length;
        if (length + used + charLength > MAX_ENTRY_NAME_BYTES) break;
        shortened += char;
        used += charLength;
      }
      if (shortened) clean.push(shortened);
      unsafe = true;
      break;
    }
    clean.push(name);
    length += nameLength;
  }
  return { path: clean.join('/'), trailingSlash, unsafe };
}

export function decodeTextBytes(input, { maxBytes = 4 * 1024 * 1024, truncated = false } = {}) {
  let b = toBytes(input);
  if (b.length > maxBytes) b = b.subarray(0, maxBytes);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return { text: tryDecode('utf-8', b.subarray(3), false) ?? '', encoding: 'utf-8' };
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return { text: tryDecode('utf-16le', b.subarray(2), false) ?? '', encoding: 'utf-16le' };
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return { text: tryDecode('utf-16be', b.subarray(2), false) ?? '', encoding: 'utf-16be' };
  }
  if (truncated) {
    let end = b.length;
    while (end > 0 && (b[end] & 0xc0) === 0x80) end--;
    if (end > 0 && end < b.length) {
      const lead = b[end];
      const expected = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc2 ? 2 : 1;
      if (b.length - end < expected) b = b.subarray(0, end);
    }
  }
  const asUtf8 = tryDecode('utf-8', b, true);
  if (asUtf8 !== null) return { text: asUtf8, encoding: 'utf-8' };
  return decodeLegacyText(b);
}

export function isProbablyText(input) {
  const b = toBytes(input);
  const n = Math.min(b.length, 4096);
  if (n === 0) return true;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0 || c < 0x09) return false;
    if ((c > 0x0d && c < 0x20) || c === 0x7f) ctrl++;
  }
  return ctrl / n < 0.02;
}

export function utf8OrLatin1(input) {
  const b = toBytes(input);
  const strict = tryDecode('utf-8', b, true);
  return strict !== null ? strict : latin1(b);
}

const IMAGE_SIGNATURES = [
  { mime: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', sig: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  { mime: 'image/bmp', sig: [0x42, 0x4d, null, null, null, null, 0, 0, 0, 0, null, null, null, null] },
];

export function classifyContent(input) {
  const b = toBytes(input);
  if (b.length === 0) return { kind: 'empty', mime: null };
  if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff))) return { kind: 'text', mime: null };
  for (const item of IMAGE_SIGNATURES) {
    if (item.sig.every((byte, i) => byte === null || b[i] === byte)) return { kind: 'image', mime: item.mime };
  }
  if (b.length >= 12 && latin1(b.subarray(0, 4)) === 'RIFF' && latin1(b.subarray(8, 12)) === 'WEBP') {
    return { kind: 'image', mime: 'image/webp' };
  }
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return { kind: 'binary', mime: 'application/pdf' };
  }
  return isProbablyText(b) ? { kind: 'text', mime: null } : { kind: 'binary', mime: null };
}

let crcTable = null;
function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
}

export function crc32(bytes) {
  if (!crcTable) crcTable = makeCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function compareTreeNodes(a, b) {
  if (a.dir !== b.dir) return a.dir ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
