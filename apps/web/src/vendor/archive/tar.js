// Adapted from dsh-workspace-explorer src/vendor/archive/tar.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
import { ArchiveError, decodeFileName, latin1, normalizeEntryPath, toBytes } from './util.js';

const BLOCK = 512;
const TYPE_NAMES = { '0': 'file', '\0': 'file', '': 'file', '7': 'file', '1': 'hardlink', '2': 'symlink', '3': 'char', '4': 'block', '5': 'dir', '6': 'fifo', S: 'sparse' };

export function isTar(input) {
  const b = toBytes(input);
  if (b.length >= 263 && ['ustar\0', 'ustar '].includes(latin1(b.subarray(257, 263)))) return true;
  return b.length >= 1024 && isZeroBlock(b.subarray(0, BLOCK)) && isZeroBlock(b.subarray(BLOCK, 2 * BLOCK));
}

function isZeroBlock(block) {
  return block.every(byte => byte === 0);
}

function blockChecksum(block) {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const c = i >= 148 && i < 156 ? 0x20 : block[i];
    unsigned += c;
    signed += c > 127 ? c - 256 : c;
  }
  return { unsigned, signed };
}

function parseNumericField(block, offset, length, { signed = false } = {}) {
  let value;
  if (block[offset] & 0x80) {
    if (signed) {
      let big = 0n;
      for (let i = 0; i < length; i++) big = big * 256n + BigInt(block[i]);
      const signedValue = BigInt.asIntN(length * 8, big);
      value = signedValue >= BigInt(Number.MIN_SAFE_INTEGER) && signedValue <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(signedValue) : null;
    } else {
      value = block[offset] & 0x7f;
      for (let i = 1; i < length; i++) value = value * 256 + block[offset + i];
    }
  } else {
    const source = latin1(block.subarray(offset, offset + length)).replace(/[\0 ]+$/g, '').trim();
    value = source ? parseInt(source, 8) : 0;
  }
  if (value === null && signed) return null;
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw new ArchiveError('Invalid negative or unsafe TAR numeric field.', 'BAD_TAR_SIZE');
  return value;
}

function decodeTarString(bytes) {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  let slice = bytes.subarray(0, end);
  let tail = slice.length;
  while (tail > 0 && slice[tail - 1] === 0x20) tail--;
  return decodeFileName(slice.subarray(0, tail));
}

function parsePaxPayload(data) {
  const out = Object.create(null);
  let p = 0;
  while (p < data.length) {
    if (Object.keys(out).length >= 16) break;
    let space = -1;
    for (let i = p; i < Math.min(p + 20, data.length); i++) {
      if (data[i] === 0x20) { space = i; break; }
    }
    if (space < 0) break;
    const length = Number(latin1(data.subarray(p, space)));
    if (!Number.isSafeInteger(length) || length <= 0 || p + length > data.length) break;
    const end = p + length;
    const body = data.subarray(space + 1, data[end - 1] === 0x0a ? end - 1 : end);
    const text = decodeFileName(body).name;
    const eq = text.indexOf('=');
    if (eq > 0) {
      const key = text.slice(0, eq);
      if (['path', 'linkpath', 'size', 'mtime'].includes(key)) out[key] = text.slice(eq + 1);
    }
    p = end;
  }
  return out;
}

export function parseTar(input, options = {}) {
  const bytes = toBytes(input);
  const maxEntries = options.maxEntries ?? 5000;
  const maxHeaders = Math.floor(bytes.length / BLOCK) + 1;
  const entries = [];
  const notes = [];
  const paxState = { local: Object.create(null) };
  let globalPax = Object.create(null);
  let nextPath = null;
  let nextLink = null;
  let truncated = false;
  let endOfArchive = false;
  let p = 0;
  let headers = 0;

  while (p + BLOCK <= bytes.length) {
    if (++headers > maxHeaders) throw new ArchiveError('TAR parser did not advance.', 'BAD_TAR');
    const block = bytes.subarray(p, p + BLOCK);
    if (isZeroBlock(block)) { endOfArchive = true; break; }
    const storedChecksum = parseNumericField(block, 148, 8);
    const sums = blockChecksum(block);
    if (storedChecksum !== sums.unsigned && storedChecksum !== sums.signed) {
      notes.push({ code: 'TAR_CHECKSUM', params: { offset: p } });
      truncated = true;
      break;
    }
    const typeFlag = String.fromCharCode(block[156] || 0x30);
    const declaredSize = parseNumericField(block, 124, 12);
    const dataOffset = p + BLOCK;
    const next = dataOffset + Math.ceil(declaredSize / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(next) || next <= p) throw new ArchiveError('Invalid TAR entry stride.', 'BAD_TAR_SIZE');

    if (typeFlag === 'x' || typeFlag === 'g' || typeFlag === 'L' || typeFlag === 'K') {
      if (declaredSize > 64 * 1024) throw new ArchiveError('TAR extended header exceeds the 64KB metadata limit.', 'BAD_TAR');
      if (dataOffset + declaredSize > bytes.length) throw new ArchiveError('Truncated TAR extended header.', 'BAD_TAR');
      const payload = bytes.subarray(dataOffset, Math.min(dataOffset + declaredSize, bytes.length));
      if (typeFlag === 'x') paxState.local = parsePaxPayload(payload);
      else if (typeFlag === 'g') {
        // Global size would corrupt subsequent entry strides; only descriptive metadata applies globally.
        const global = parsePaxPayload(payload);
        delete global.size;
        globalPax = Object.assign(globalPax, global);
      } else if (typeFlag === 'L') nextPath = decodeTarString(payload);
      else nextLink = decodeTarString(payload);
      p = next;
      continue;
    }

    if (entries.length >= maxEntries) {
      truncated = true;
      notes.push({ code: 'ENTRY_LIMIT', params: { count: maxEntries } });
      break;
    }
    const pax = Object.assign(Object.create(null), globalPax, paxState.local);
    paxState.local = Object.create(null);
    let effectiveSize = declaredSize;
    if (pax.size !== undefined) {
      effectiveSize = Number(pax.size);
      if (!Number.isSafeInteger(effectiveSize) || effectiveSize < 0) throw new ArchiveError('Invalid PAX entry size.', 'BAD_TAR_SIZE');
    }
    const nextOffset = dataOffset + Math.ceil(effectiveSize / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= p) throw new ArchiveError('Invalid TAR entry stride.', 'BAD_TAR_SIZE');

    let name = nextPath || decodeTarString(block.subarray(0, 100));
    if (!nextPath) {
      const prefix = decodeTarString(block.subarray(345, 500));
      name = { name: prefix.name ? `${prefix.name}/${name.name}` : name.name, encoding: name.encoding };
    }
    nextPath = null;
    if (pax.path) name = { name: pax.path, encoding: 'utf-8' };
    let linkname = nextLink || decodeTarString(block.subarray(157, 257));
    nextLink = null;
    if (pax.linkpath) linkname = { name: pax.linkpath, encoding: 'utf-8' };
    let mtime = parseNumericField(block, 136, 12, { signed: true });
    if (mtime !== null) mtime = mtime * 1000 || null;
    if (pax.mtime !== undefined && Number.isFinite(Number(pax.mtime))) mtime = Math.round(Number(pax.mtime) * 1000);

    const type = TYPE_NAMES[typeFlag] || 'other';
    const normalized = normalizeEntryPath(name.name);
    const dir = type === 'dir' || normalized.trailingSlash;
    const entry = {
      index: entries.length, path: normalized.path, unsafePath: normalized.unsafe, dir,
      size: dir ? 0 : effectiveSize, compressedSize: dir ? 0 : effectiveSize, mtime,
      encrypted: false, method: 'none', type, linkname: linkname.name || null,
      nameEncoding: name.encoding, dataOffset, container: 'tar',
    };
    if (type === 'sparse') entry.notes = [{ code: 'SPARSE_ENTRY' }];
    entries.push(entry);
    if (dataOffset + effectiveSize > bytes.length) {
      notes.push({ code: 'TAR_ENTRY_TRUNCATED', params: { path: entry.path } });
      truncated = true;
      break;
    }
    p = nextOffset;
  }
  if (!endOfArchive && !truncated && p < bytes.length && !isZeroBlock(bytes.subarray(p, Math.min(p + BLOCK, bytes.length)))) {
    notes.push({ code: 'TAR_TAIL_MISSING' });
  }
  return { entries, notes, truncated, endOfArchive };
}

export function readTarEntry(bytes, entry, options = {}) {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (entry.dir) return { bytes: new Uint8Array(0), truncated: false, notes: [] };
  const notes = [...(entry.notes || [])];
  if (entry.type === 'symlink' || entry.type === 'hardlink') notes.push({ code: 'LINK_ENTRY', params: { target: entry.linkname || '' } });
  else if (['char', 'block', 'fifo', 'other'].includes(entry.type)) notes.push({ code: 'DEVICE_ENTRY' });
  if (notes.some(note => ['LINK_ENTRY', 'DEVICE_ENTRY'].includes(note.code))) return { bytes: new Uint8Array(0), truncated: false, notes };
  const start = entry.dataOffset;
  const available = Number.isSafeInteger(start) && start >= 0 ? bytes.length - start : -1;
  const length = Math.max(0, Math.min(entry.size, available, maxBytes));
  const truncated = length < entry.size;
  if (truncated) notes.push({ code: 'ENTRY_TRUNCATED', params: { shown: length, size: entry.size } });
  return { bytes: bytes.subarray(start, start + length), truncated, notes };
}
