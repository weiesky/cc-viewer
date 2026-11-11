// Adapted from dsh-workspace-explorer src/vendor/archive/zip.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
import { ArchiveError, crc32, decodeFileName, normalizeEntryPath, readU16, readU32, readU64, toBytes } from './util.js';
import { inflateBytes } from './inflate.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const METHOD_NAMES = { 0: 'stored', 1: 'shrink', 6: 'implode', 8: 'deflate', 9: 'deflate64', 12: 'bzip2', 14: 'lzma', 93: 'zstd', 95: 'xz', 98: 'ppmd' };

export function zipMethodName(id) {
  return METHOD_NAMES[id] || `method-${id}`;
}

export function findEocd(bytes) {
  const len = bytes.length;
  if (len < 22) return null;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (readU32(bytes, i) === SIG_EOCD && i + 22 + readU16(bytes, i + 20) === len) return { offset: i, strict: true };
  }
  for (let i = len - 22; i >= min; i--) {
    if (readU32(bytes, i) === SIG_EOCD) return { offset: i, strict: false };
  }
  return null;
}

function readZip64Eocd(bytes, eocdOffset) {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || readU32(bytes, locatorOffset) !== SIG_ZIP64_LOCATOR) return null;
  const recordOffset = readU64(bytes, locatorOffset + 8);
  if (recordOffset + 56 > bytes.length || readU32(bytes, recordOffset) !== SIG_ZIP64_EOCD) return null;
  return {
    totalEntries: readU64(bytes, recordOffset + 32),
    cdSize: readU64(bytes, recordOffset + 40),
    cdOffset: readU64(bytes, recordOffset + 48),
  };
}

export function parseExtraFields(extra) {
  const map = new Map();
  let p = 0;
  while (p + 4 <= extra.length) {
    const size = readU16(extra, p + 2);
    const start = p + 4;
    if (start + size > extra.length) break;
    map.set(readU16(extra, p), extra.subarray(start, start + size));
    p = start + size;
  }
  return map;
}

function dosDateTimeToMs(date16, time16) {
  const date = new Date(1980 + ((date16 >> 9) & 0x7f), (((date16 >> 5) & 0x0f) || 1) - 1,
    (date16 & 0x1f) || 1, (time16 >> 11) & 0x1f, (time16 >> 5) & 0x3f, (time16 & 0x1f) * 2);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function parseCentralEntry(bytes, p, index) {
  const versionMadeBy = readU16(bytes, p + 4);
  const flags = readU16(bytes, p + 8);
  const methodId = readU16(bytes, p + 10);
  const crc = readU32(bytes, p + 16);
  let compressedSize = readU32(bytes, p + 20);
  let size = readU32(bytes, p + 24);
  const nameLen = readU16(bytes, p + 28);
  const extraLen = readU16(bytes, p + 30);
  let diskStart = readU16(bytes, p + 34);
  const externalAttrs = readU32(bytes, p + 38);
  let localHeaderOffset = readU32(bytes, p + 42);
  const extras = parseExtraFields(bytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen));
  const z64 = extras.get(0x0001);
  let zip64 = false;
  if (z64) {
    let q = 0;
    if (size === 0xffffffff && q + 8 <= z64.length) { size = readU64(z64, q); q += 8; zip64 = true; }
    if (compressedSize === 0xffffffff && q + 8 <= z64.length) { compressedSize = readU64(z64, q); q += 8; zip64 = true; }
    if (localHeaderOffset === 0xffffffff && q + 8 <= z64.length) { localHeaderOffset = readU64(z64, q); q += 8; zip64 = true; }
    if (diskStart === 0xffff && q + 4 <= z64.length) { diskStart = readU32(z64, q); zip64 = true; }
  }
  const decoded = decodeFileName(bytes.subarray(p + 46, p + 46 + nameLen), { utf8Flag: (flags & 0x0800) !== 0 });
  const normalized = normalizeEntryPath(decoded.name);
  const unixMode = versionMadeBy >> 8 === 3 || versionMadeBy >> 8 === 19 ? externalAttrs >>> 16 : 0;
  const dir = normalized.trailingSlash || (externalAttrs & 0x10) !== 0 || (unixMode & 0xf000) === 0x4000;
  let mtime = dosDateTimeToMs(readU16(bytes, p + 14), readU16(bytes, p + 12));
  const ut = extras.get(0x5455);
  if (ut && ut.length >= 5 && (ut[0] & 1) !== 0 && readU32(ut, 1) > 0) mtime = readU32(ut, 1) * 1000;
  return {
    index, path: normalized.path, unsafePath: normalized.unsafe, dir, size, compressedSize,
    crc32: crc, mtime, encrypted: (flags & 0x0041) !== 0, method: zipMethodName(methodId),
    methodId, nameEncoding: decoded.encoding, localHeaderOffset, diskStart, zip64, container: 'zip',
  };
}

export function parseZip(input, options = {}) {
  const bytes = toBytes(input);
  const maxEntries = options.maxEntries ?? 5000;
  const notes = [];
  const eocd = findEocd(bytes);
  if (!eocd) throw new ArchiveError('ZIP end-of-central-directory record not found.', 'BAD_ZIP');
  let totalEntries = readU16(bytes, eocd.offset + 10);
  let cdSize = readU32(bytes, eocd.offset + 12);
  let cdOffset = readU32(bytes, eocd.offset + 16);
  let zip64 = false;
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const z = readZip64Eocd(bytes, eocd.offset);
    if (z) ({ totalEntries, cdSize, cdOffset } = z);
    else notes.push({ code: 'ZIP64_MISSING' });
    zip64 = !!z;
  }
  if (readU16(bytes, eocd.offset + 4) !== 0 || readU16(bytes, eocd.offset + 6) !== 0) {
    throw new ArchiveError('Multi-disk ZIP archives are not supported.', 'UNSUPPORTED_FORMAT');
  }
  if (cdOffset > bytes.length) throw new ArchiveError('ZIP central directory is out of bounds.', 'BAD_ZIP');
  if (cdOffset + cdSize > bytes.length) notes.push({ code: 'CENTRAL_DIR_TRUNCATED' });
  const entries = [];
  let truncated = false;
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (entries.length >= maxEntries) {
      truncated = true;
      notes.push({ code: 'ENTRY_LIMIT', params: { count: maxEntries } });
      break;
    }
    if (p + 46 > bytes.length) {
      if (i === 0) throw new ArchiveError('Incomplete ZIP central directory.', 'BAD_ZIP');
      notes.push({ code: 'CENTRAL_DIR_EARLY_END', params: { index: i + 1 } });
      truncated = true;
      break;
    }
    if (readU32(bytes, p) !== SIG_CD) {
      if (i === 0) throw new ArchiveError('Invalid ZIP central directory signature.', 'BAD_ZIP');
      notes.push({ code: 'CENTRAL_DIR_BAD_ENTRY', params: { index: i + 1 } });
      truncated = true;
      break;
    }
    const entryLength = 46 + readU16(bytes, p + 28) + readU16(bytes, p + 30) + readU16(bytes, p + 32);
    if (p + entryLength > bytes.length || p + entryLength > cdOffset + cdSize) {
      if (i === 0) throw new ArchiveError('ZIP central directory entry exceeds its declared bounds.', 'BAD_ZIP');
      notes.push({ code: 'CENTRAL_DIR_EARLY_END', params: { index: i + 1 } });
      truncated = true;
      break;
    }
    const entry = parseCentralEntry(bytes, p, i);
    if (entry.diskStart !== 0) throw new ArchiveError('Multi-disk ZIP entries are not supported.', 'UNSUPPORTED_FORMAT');
    entries.push(entry);
    p += 46 + readU16(bytes, p + 28) + readU16(bytes, p + 30) + readU16(bytes, p + 32);
  }
  if (entries.some(e => e.zip64)) zip64 = true;
  return { entries, notes, truncated, zip64, totalEntries };
}

function localDataOffset(bytes, entry) {
  const off = entry.localHeaderOffset;
  if (!Number.isSafeInteger(off) || off < 0 || off + 30 > bytes.length || readU32(bytes, off) !== SIG_LOCAL) {
    throw new ArchiveError('Invalid ZIP local header.', 'BAD_LOCAL_HEADER', { path: entry.path });
  }
  const dataOffset = off + 30 + readU16(bytes, off + 26) + readU16(bytes, off + 28);
  if (dataOffset > bytes.length) throw new ArchiveError('ZIP entry data is out of bounds.', 'BAD_LOCAL_HEADER', { path: entry.path });
  return dataOffset;
}

export async function readZipEntry(bytes, entry, options = {}) {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (entry.encrypted) throw new ArchiveError('Encrypted ZIP entry.', 'ENCRYPTED', { path: entry.path });
  if (entry.dir) return { bytes: new Uint8Array(0), truncated: false, crcOk: null, notes: [] };
  if (entry.methodId !== 0 && entry.methodId !== 8) {
    throw new ArchiveError(`Unsupported ZIP method: ${entry.method}.`, 'UNSUPPORTED_METHOD', { method: entry.method });
  }
  const dataOffset = localDataOffset(bytes, entry);
  const rawEnd = dataOffset + entry.compressedSize;
  if (!Number.isSafeInteger(rawEnd) || rawEnd > bytes.length) {
    throw new ArchiveError('ZIP entry data exceeds the archive.', 'BAD_ENTRY_DATA', { path: entry.path });
  }
  const raw = bytes.subarray(dataOffset, rawEnd);
  let result;
  const notes = [];
  if (entry.methodId === 0) {
    let data = raw;
    if (entry.size >= 0 && raw.length > entry.size) data = raw.subarray(0, entry.size);
    const truncated = data.length > maxBytes;
    if (truncated) data = data.subarray(0, maxBytes);
    result = { bytes: data, truncated: truncated || data.length < entry.size, crcOk: null };
  } else {
    result = await inflateBytes(raw, 'deflate-raw', { maxBytes });
    if (!result.truncated && result.bytes.length !== entry.size) notes.push({ code: 'SIZE_MISMATCH' });
  }
  if (options.verifyCrc !== false && !result.truncated && entry.size > 0) {
    result.crcOk = crc32(result.bytes) === entry.crc32;
    if (!result.crcOk) notes.push({ code: 'CRC_MISMATCH' });
  }
  result.notes = notes;
  return result;
}
