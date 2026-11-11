// Adapted from dsh-workspace-explorer src/vendor/archive/index.js
// Upstream revision: 19f1fbc83c5cb98c8139dc75bf5d28767813fdca (MIT).
// Read-only browser/Node API; entry names are never resolved as filesystem paths.
import { ArchiveError, classifyContent, compareTreeNodes, decodeTextBytes, formatBytes, isProbablyText, normalizeEntryPath, toBytes, utf8OrLatin1 } from './util.js';
import { detect } from './detect.js';
import { parseZip, readZipEntry } from './zip.js';
import { parseTar, readTarEntry, isTar } from './tar.js';
import { gunzipCached, isGzip, parseGzipHeader, releaseGzipCache } from './gzip.js';
import { isDecompressionSupported } from './inflate.js';

export const DEFAULT_LIMITS = Object.freeze({ maxEntries: 5000, maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
export { ArchiveError, detect, formatBytes, utf8OrLatin1, classifyContent, isProbablyText, decodeTextBytes, isDecompressionSupported };

function resolveLimits(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  for (const key of ['maxEntries', 'maxEntryBytes', 'maxTotalBytes']) {
    if (options[key] != null) limits[key] = options[key];
  }
  return limits;
}

function finalize(format, entries, truncated, notes, limits, det) {
  const cleanNotes = [...notes];
  const declaredTotal = entries.reduce((sum, entry) => sum + (entry.dir ? 0 : entry.size || 0), 0);
  if (declaredTotal > limits.maxTotalBytes) cleanNotes.push({ code: 'TOTAL_SIZE_LIMIT', params: { size: declaredTotal, max: limits.maxTotalBytes } });
  const nonUtf8 = entries.filter(entry => entry.nameEncoding && entry.nameEncoding !== 'utf-8').length;
  if (nonUtf8) cleanNotes.push({ code: 'NAME_ENCODING', params: { count: nonUtf8 } });
  return { format, supported: true, entries, truncated: !!truncated, notes: cleanNotes, totalEntries: entries.length, declaredTotalBytes: declaredTotal, detect: det };
}

export async function listArchive(input, options = {}) {
  const bytes = toBytes(input);
  const limits = resolveLimits(options);
  const det = options.format ? { format: options.format, supported: true, source: 'option', extension: '' } : detect(bytes, options.filename || '');
  if (!det.supported) return { format: det.format, supported: false, entries: [], truncated: false, notes: [{ code: 'UNSUPPORTED_FORMAT', params: { format: det.format || '' } }], detect: det };
  try {
    if (det.format === 'zip') {
      const parsed = parseZip(bytes, { maxEntries: limits.maxEntries });
      return finalize('zip', parsed.entries, parsed.truncated, parsed.notes, limits, det);
    }
    if (det.format === 'tar') {
      const parsed = parseTar(bytes, { maxEntries: limits.maxEntries });
      return finalize('tar', parsed.entries, parsed.truncated, parsed.notes, limits, det);
    }
    if (det.format === 'gzip' || det.format === 'tar.gz') {
      if (!isGzip(bytes)) throw new ArchiveError('Invalid gzip signature.', 'BAD_GZIP');
      const header = parseGzipHeader(bytes);
      const unpacked = await gunzipCached(bytes, { maxBytes: limits.maxTotalBytes });
      const notes = unpacked.truncated ? [{ code: 'GZIP_TRUNCATED', params: { max: limits.maxTotalBytes } }] : [];
      if (isTar(unpacked.bytes)) {
        const parsed = parseTar(unpacked.bytes, { maxEntries: limits.maxEntries });
        return finalize('tar.gz', parsed.entries.map(entry => ({ ...entry, container: 'gzip-tar' })), parsed.truncated || unpacked.truncated, [...notes, ...parsed.notes], limits, det);
      }
      if (det.format === 'tar.gz') notes.push({ code: 'GZIP_NOT_TAR' });
      const derivedName = normalizeEntryPath(header?.originalName || String(options.filename || '').replace(/^.*[\\/]/, '').replace(/\.(tar\.)?gz$/i, '') || 'gzip-content');
      return finalize('gzip', [{ index: 0, path: derivedName.path || 'gzip-content', unsafePath: derivedName.unsafe, dir: false, size: unpacked.bytes.length, compressedSize: bytes.length, mtime: header?.mtime || null, encrypted: false, method: 'gzip', type: 'file', container: 'gzip-raw' }], unpacked.truncated, notes, limits, det);
    }
    throw new ArchiveError('Unsupported archive format.', 'UNSUPPORTED_FORMAT', { format: det.format });
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(`Archive parsing failed: ${err?.message || err}`, 'PARSE_FAILED');
  }
}

export async function readEntry(input, entry, options = {}) {
  const bytes = toBytes(input);
  const limits = resolveLimits(options);
  if (!entry || typeof entry !== 'object') throw new ArchiveError('Invalid archive entry.', 'BAD_ENTRY');
  const cap = Math.min(options.maxEntryBytes ?? limits.maxEntryBytes, limits.maxTotalBytes);
  let result;
  if (entry.dir) return { bytes: new Uint8Array(0), truncated: false, textualHint: 'empty', mime: null, notes: [] };
  if (entry.container === 'zip') result = await readZipEntry(bytes, entry, { maxBytes: cap, verifyCrc: options.verifyCrc });
  else if (entry.container === 'tar') result = readTarEntry(bytes, entry, { maxBytes: cap });
  else if (entry.container === 'gzip-tar' || entry.container === 'gzip-raw') {
    const unpacked = await gunzipCached(bytes, { maxBytes: limits.maxTotalBytes });
    if (entry.container === 'gzip-raw') {
      const length = Math.min(entry.size, unpacked.bytes.length, cap);
      result = { bytes: unpacked.bytes.subarray(0, length), truncated: length < entry.size, notes: [] };
    } else result = readTarEntry(unpacked.bytes, entry, { maxBytes: cap });
  } else throw new ArchiveError('Entry has an unknown container.', 'BAD_ENTRY');
  if (entry.size > cap && !result.truncated) result.truncated = true;
  if (result.truncated && !(result.notes || []).some(note => note.code === 'ENTRY_TRUNCATED')) {
    (result.notes ||= []).push({ code: 'ENTRY_TRUNCATED', params: { shown: result.bytes.length, size: entry.size } });
  }
  const classification = classifyContent(result.bytes);
  return { ...result, textualHint: classification.kind, mime: classification.mime };
}

export async function readEntryText(input, entry, options = {}) {
  const textLimit = options.textMaxBytes ?? 200 * 1024;
  const result = await readEntry(input, entry, { ...options, maxEntryBytes: textLimit });
  if (result.textualHint !== 'text') return { ...result, text: '', encoding: null, looksBinary: true };
  return { ...result, ...decodeTextBytes(result.bytes, { maxBytes: textLimit, truncated: result.truncated }), looksBinary: false };
}

export function resetBudget(input) {
  releaseGzipCache(toBytes(input));
}

export function buildTree(entries) {
  const root = { name: '', path: '', dir: true, children: [], entry: null, truncated: false };
  const map = new Map([['', root]]);
  let nodes = 0;
  for (const entry of entries || []) {
    if (nodes >= 20000) { root.truncated = true; continue; }
    const parts = String(entry.path || '').split('/').filter(Boolean).slice(0, 64);
    let parent = root;
    let base = '';
    for (let i = 0; i < parts.length; i++) {
      const path = base ? `${base}/${parts[i]}` : parts[i];
      const isLeaf = i === parts.length - 1;
      let node = map.get(path);
      if (!node) {
        if (++nodes > 20000) { root.truncated = true; break; }
        node = { name: parts[i], path, dir: !isLeaf || !!entry.dir, children: [], entry: null };
        map.set(path, node);
        parent.children.push(node);
      }
      if (!isLeaf) {
        node.dir = true;
        parent = node;
        base = path;
        continue;
      }
      if (isLeaf && (entry.dir || node.children.length > 0)) node.dir = true;
      if (isLeaf && !node.entry) node.entry = entry;
      parent = node;
      base = path;
    }
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    node.children.sort(compareTreeNodes);
    stack.push(...node.children);
  }
  return root;
}
