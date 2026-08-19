// wire-v2 S6a: extract an uploaded v2-session zip into a temp dir so the read
// adapter can synthesize (and stream) it for ephemeral viewing.
//
// A v2 session is a FOLDER (meta.json + journal.jsonl + conversations/ + blobs/
// + responses.jsonl). The download side (`/api/download-log?...&format=raw`)
// zips that folder wrapped under `<dirName>/`; this module is the inverse.
//
// Security posture builds on server/routes/skills.js's zip import: INVALID_ZIP
// guard, symlink rejection (S_IFLNK mask), an entry-count ceiling, and a
// zip-slip resolve-within-target guard. It goes one step further than skills.js
// on decompression bombs: instead of adm-zip's uncapped `getData()` (which
// inflates a whole member into heap BEFORE any size check — a lying header can
// OOM the process), deflate members are inflated through Node's zlib with
// `maxOutputLength: maxPerFile`, so the allocation is bounded up front and an
// over-cap member throws ZIP_BOMB before it can balloon.
//   The extraction is placed under `<destParent>/<SESSIONS_DIR_NAME>/<sid>/` on
// purpose: the adapter re-derives its journal path as
// `dirname(dirname(sessionDir))/sessions/basename(sessionDir)` (adapter.js /
// replay.js), so a bare dir would silently synthesize zero entries — hence the
// shared SESSIONS_DIR_NAME constant rather than a divergent literal.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import { sanitizePathComponent, SESSIONS_DIR_NAME } from './v2/layout.js';

export const MAX_PER_FILE = 100 * 1024 * 1024;          // 100MB per member
export const MAX_TOTAL_UNCOMPRESSED = 400 * 1024 * 1024; // 400MB expanded
export const MAX_ENTRY_COUNT = 100_000;                  // v2 sessions have many blob files; bomb guard

function err(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Read one member's bytes with a bounded allocation. Deflate members are
 * inflated through zlib with `maxOutputLength: cap` so a spoofed-small header
 * can't force an unbounded heap spike (adm-zip's getData() has no such cap);
 * an over-cap member throws ZIP_BOMB, a corrupt stream throws INVALID_ZIP
 * (400, not a 500). Stored members return their raw payload; any other method
 * falls back to adm-zip and is length-checked afterward.
 */
export function boundedGetData(e, cap) {
  const method = e.header?.method;
  if (method === 8) { // deflate
    try {
      return zlib.inflateRawSync(e.getCompressedData(), { maxOutputLength: cap });
    } catch (er) {
      if (er?.code === 'ERR_BUFFER_TOO_LARGE') throw err('File actual size too large', 400, 'ZIP_BOMB');
      throw err('Invalid zip archive', 400, 'INVALID_ZIP');
    }
  }
  const data = method === 0 ? e.getCompressedData() : e.getData();
  if (data.length > cap) throw err('File actual size too large', 400, 'ZIP_BOMB');
  return data;
}

/**
 * Extract an uploaded v2-session zip buffer into `<destParent>/sessions/<sid>/`.
 * Validates the archive and that it actually contains a v2 session (a
 * `journal.jsonl`). Throws `{ status, code }` errors for the caller to map to
 * HTTP. Returns the absolute path of the nested session dir, ready to hand to
 * `streamRawEntriesAsync`.
 *
 * @param {Buffer} buffer  the raw zip bytes
 * @param {string} destParent  a caller-owned temp dir (e.g. from mkdtempSync)
 * @param {{maxPerFile?:number,maxTotal?:number,maxEntryCount?:number}} [limits]
 *   size/count ceilings; default to the module constants (overridable for tests).
 * @returns {string} absolute session dir path (`<destParent>/sessions/<sid>`)
 */
export function extractV2Zip(buffer, destParent, limits = {}) {
  const maxPerFile = limits.maxPerFile ?? MAX_PER_FILE;
  const maxTotal = limits.maxTotal ?? MAX_TOTAL_UNCOMPRESSED;
  const maxEntryCount = limits.maxEntryCount ?? MAX_ENTRY_COUNT;
  // adm-zip parses lazily — a corrupt-but-constructable buffer throws at
  // getEntries(), not at the constructor, so both must be under the guard
  // (else a bad upload surfaces as a 500 instead of a 400).
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch {
    throw err('Invalid zip archive', 400, 'INVALID_ZIP');
  }
  if (entries.length > maxEntryCount) {
    throw err('Too many entries in archive', 400, 'ZIP_BOMB');
  }

  // Pass 1: symlink reject + size guard against the (attacker-controllable)
  // central-directory sizes.
  let declaredTotal = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const unixMode = (e.attr >>> 16) & 0xffff;
    if ((unixMode & 0o170000) === 0o120000) {
      throw err('Symlinks not allowed in zip', 400, 'INVALID_ZIP');
    }
    const sizeRaw = e.header?.size || 0;
    if (sizeRaw > maxPerFile) throw err('File too large in archive', 400, 'ZIP_BOMB');
    declaredTotal += sizeRaw;
    if (declaredTotal > maxTotal) throw err('Archive expands too large', 400, 'ZIP_BOMB');
  }

  // Locate the session root = the shallowest dir holding `journal.jsonl`
  // (handles both a wrapped `<dir>/journal.jsonl` and a bare-root layout).
  let bestEntry = null;
  let bestDepth = Infinity;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const en = e.entryName.replace(/\\/g, '/');
    if ((en.split('/').pop() || '') === 'journal.jsonl') {
      const depth = en.split('/').length;
      if (depth < bestDepth) { bestDepth = depth; bestEntry = e; }
    }
  }
  if (!bestEntry) throw err('Not a v2 session (no journal.jsonl)', 400, 'NOT_V2');

  const rootEntry = bestEntry.entryName.replace(/\\/g, '/');
  const lastSlash = rootEntry.lastIndexOf('/');
  const rootPrefix = lastSlash >= 0 ? rootEntry.slice(0, lastSlash + 1) : '';
  const sidRaw = rootPrefix ? rootPrefix.replace(/\/$/, '').split('/').pop() : 'uploaded-session';
  const sid = sanitizePathComponent(sidRaw) || 'uploaded-session';

  const sessionDir = join(destParent, SESSIONS_DIR_NAME, sid);
  mkdirSync(sessionDir, { recursive: true });
  const resolvedTarget = resolve(sessionDir) + sep;

  // Pass 2: extract members under the session root with bounded inflation, and
  // enforce the zip-slip containment guard.
  let actualTotal = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const en = e.entryName.replace(/\\/g, '/');
    if (rootPrefix && !en.startsWith(rootPrefix)) continue;
    const rel = rootPrefix ? en.slice(rootPrefix.length) : en;
    // Reject a real `..` path SEGMENT (not a substring — a legit `a..b.json`
    // name must survive); the resolve guard below is the belt-and-suspenders.
    if (!rel || rel.split('/').includes('..')) continue;
    const data = boundedGetData(e, maxPerFile);
    actualTotal += data.length;
    if (actualTotal > maxTotal) throw err('Archive actual size too large', 400, 'ZIP_BOMB');
    const dest = join(sessionDir, rel);
    if (!resolve(dest).startsWith(resolvedTarget)) continue; // zip-slip
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }

  return sessionDir;
}
