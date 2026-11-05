// Wire Format v2 — on-disk layout contract (docs/refactor/WIRE_FORMAT_V2.md §2/§3).
//
// Single owner of every v2 path: nothing outside this module joins path segments
// into a session directory. All directory creation is SYNCHRONOUS on purpose —
// an async mkdir would lose the race against AsyncWriteQueue's microtask drain
// and the swallowed ENOENT would silently drop v2 lines (plan risk F2).

import { mkdirSync, writeFileSync, renameSync, existsSync, openSync, writeSync, fsyncSync, closeSync, readdirSync, statSync } from 'node:fs';
import { readdir as readdirAsync, stat as statAsync } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { reportSwallowed } from '../../lib/error-report.js';

// The wire-format version this build writes AND the only one it reads.
// Stamped into meta.json and the journal sentinel at session creation; the
// read side refuses sessions carrying any OTHER version (spec §14 reader
// version gate) — a future wireFormat:3 dir must never be silently misread
// as v2. A missing version (torn creation) is treated as the current one.
export const WIRE_FORMAT_VERSION = 2;

export function isSupportedWireFormat(v) {
  return v == null || v === WIRE_FORMAT_VERSION;
}

// Path-component whitelist (spec §2): anything outside [a-zA-Z0-9._-] is replaced
// with '_'; empty / dot-only results are rejected to '_'. Guards convKey /
// sessionId derived from wire content against path injection (plan risk F14).
export function sanitizePathComponent(name) {
  const cleaned = String(name == null ? '' : name).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (cleaned === '' || /^\.+$/.test(cleaned)) return '_';
  return cleaned;
}

/**
 * Normalize a session's owning cwd for cross-dir same-basename comparison
 * (2026-10-07). Lexical ONLY — `resolve` collapses `.`/`..` and duplicate
 * separators without touching the filesystem, then a trailing-separator strip
 * evens `/a/x` vs `/a/x/`. (On POSIX `resolve` already drops trailing slashes,
 * so the strip is redundant there; it still guards Windows `\` and the root
 * case.) Deliberately NOT realpath: the write side stamps the raw spawn cwd and
 * the read side reads the live PTY record's raw cwd, and both are the SAME raw
 * string — realpath would introduce a symlink-mismatch (/tmp → /private/tmp)
 * where the two raw sides already agree byte-for-byte. Applied identically on
 * the write (meta.cwd stamp), read-candidate, and read-target sides so the
 * comparison stays symmetric across a respawn. Absolute cwds pass through
 * deterministically; a relative cwd would resolve against process.cwd() (never
 * occurs for a spawn cwd, which is always absolute).
 * @param {string} cwd
 * @returns {string} '' for empty/non-string input.
 */
export function normalizeSessionCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  const out = resolve(cwd);
  return out.length > 1 ? out.replace(/[\\/]+$/, '') : out;
}

/** Session creation time (ISO) → a 14-digit LOCAL-time stamp `yyyymmddhhmmss`
 *  for the session dir-name prefix (task C). Deliberately NO internal separator
 *  (unlike log-management's `compactLocalTs`, which emits `YYYYMMDD_HHMMSS`) so
 *  the dir name `<14digits>_<sessionId>` splits unambiguously on the first `_`.
 *  Returns '' on an unparseable ts. */
export function compactLocalTs14(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// The `<project>/<SESSIONS_DIR_NAME>/<dirName>/` nesting is load-bearing: the
// read adapter re-derives the project root as `dirname(dirname(sessionDir))`
// (adapter.js/replay.js), so anything that materializes a session dir off the
// hot path (e.g. the zip-upload extractor) MUST reuse this constant to stay in
// sync — a divergent literal would silently synthesize zero entries.
export const SESSIONS_DIR_NAME = 'sessions';

/** All absolute paths of one session directory, derived once and passed around.
 *  The 3rd arg is the DIR-NAME (path segment) — for live sessions that is now
 *  `<ts>_<uuid>` (task C), for the converter a staged name, for legacy the bare
 *  UUID. It is NOT the identity (the UUID lives in meta.sessionId).
 *  `sessionsDirName` lets the offline converter target a sibling staging root
 *  (`sessions-migrating`) with the exact same layout; live writers keep the
 *  default and never pass it. */
export function sessionPaths(logDir, project, dirName, sessionsDirName = SESSIONS_DIR_NAME) {
  const dir = join(logDir, sanitizePathComponent(project), sanitizePathComponent(sessionsDirName), sanitizePathComponent(dirName));
  return {
    dir,
    metaPath: join(dir, 'meta.json'),
    journalPath: join(dir, 'journal.jsonl'),
    responsesPath: join(dir, 'responses.jsonl'),
    // Optional display cache: deduped user prompts, one {seq, texts} line per
    // emitting request. Append-only, never read by replay/verify (spec §15).
    promptsPath: join(dir, 'prompts.jsonl'),
    conversationsDir: join(dir, 'conversations'),
    blobsDir: join(dir, 'blobs'),
  };
}

/** Recursive byte size of a directory tree (the session-dir display size). */
export function dirSizeSync(dir) {
  let total = 0;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return total; }
  for (const e of entries) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSizeSync(p);
      else if (e.isFile()) total += statSync(p).size;
    } catch { /* raced deletion — skip */ }
  }
  return total;
}

/**
 * Async sibling of dirSizeSync (2026-10-08): same semantics (recursive byte size,
 * raced-deletion tolerant), but never blocks the event loop. Used by read-only,
 * latency-sensitive paths (the /api/workspaces list) where freezing the whole
 * Node process for ~2.4s while we walk 80k files is unacceptable — SSE streams
 * and PTY output starve. The sync variant stays for offline converter / writer
 * paths where blocking is fine (spawn-time, not request-time).
 */
export async function dirSizeAsync(dir) {
  let total = 0;
  let entries;
  try { entries = await readdirAsync(dir, { withFileTypes: true }); } catch { return total; }
  // Sequential per directory (avoid fd exhaustion on wide trees); parallel across
  // sibling directories would still serialize on disk I/O in practice.
  for (const e of entries) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) total += await dirSizeAsync(p);
      else if (e.isFile()) total += (await statAsync(p)).size;
    } catch { /* raced deletion — skip */ }
  }
  return total;
}

export function convEpochPath(paths, convKey, epoch) {
  return join(paths.conversationsDir, sanitizePathComponent(convKey), `e${epoch}.jsonl`);
}

export function convDir(paths, convKey) {
  return join(paths.conversationsDir, sanitizePathComponent(convKey));
}

export function blobPath(paths, ref) {
  // ref is produced by blob-store ('sha256-<hex16>') but sanitize anyway — the
  // reader side may feed refs parsed back from journal lines.
  return join(paths.blobsDir, `${sanitizePathComponent(ref)}.json`);
}

/**
 * Atomic small-file write: tmp → fsync → rename. Used for meta.json and blobs —
 * the two file kinds whose partial content must never be observable (spec §3/§7).
 * fsync is deliberate: blobs are the durability barrier of the write-order
 * protocol (blob → conversation → journal), see spec §1.3.
 */
export function writeFileAtomicSync(finalPath, data) {
  const tmp = `${finalPath}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, finalPath);
}

/**
 * Create the session directory skeleton + meta.json + the journal self-describing
 * first line, idempotently. Must be called (synchronously) before any enqueue
 * targeting this session. Returns the paths object.
 *
 * meta: { wireFormat:2, sessionId, project, pid, startTs, userIdRaw,
 *         userIdEncoding, leader?, im?, cwd? } — spec §3. Existing meta is never
 * rewritten here (later additive updates go through updateMetaSync). `cwd` is
 * the session's owning full working directory (same-name isolation, 2026-10-07);
 * absent for legacy/external producers.
 */
export function ensureSessionDirSync(logDir, project, sessionId, meta = {}, sessionsDirName = SESSIONS_DIR_NAME, dirName = sessionId) {
  // Path uses dirName (`<ts>_<uuid>` for live, task C); IDENTITY (meta.sessionId
  // + journal sentinel) stays the bare `sessionId` (UUID). Legacy callers omit
  // dirName → it defaults to sessionId → old behavior (dir == UUID).
  const paths = sessionPaths(logDir, project, dirName, sessionsDirName);
  mkdirSync(paths.conversationsDir, { recursive: true });
  mkdirSync(paths.blobsDir, { recursive: true });
  if (!existsSync(paths.metaPath)) {
    // `...meta` first: identity fields below must win even if a caller ever
    // passes overlapping keys (defensive — current callers pass none of them).
    const record = {
      ...meta,
      wireFormat: WIRE_FORMAT_VERSION,
      sessionId,
      project,
      startTs: meta.startTs || new Date().toISOString(),
    };
    writeFileAtomicSync(paths.metaPath, JSON.stringify(record, null, 2) + '\n');
  }
  if (!existsSync(paths.journalPath)) {
    // Journal sentinel first frame — must exist atomically at creation (same
    // hazard as the v1 rotation sentinel: a watcher may read the file the
    // instant it appears). 'wx' create-exclusive keeps a concurrent creator
    // from double-writing the sentinel.
    const sentinel = JSON.stringify({ ph: 'meta', wireFormat: WIRE_FORMAT_VERSION, sessionId }) + '\n';
    try {
      writeFileSync(paths.journalPath, sentinel, { flag: 'wx' });
    } catch (err) {
      if (err && err.code !== 'EEXIST') throw err;
    }
  }
  return paths;
}

/** Ensure a conversation subdirectory exists (before first enqueue to it). */
export function ensureConvDirSync(paths, convKey) {
  const dir = convDir(paths, convKey);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Sharding path ownership ────────────────────────────────────────────────
// A session dir keeps ALL of its history under ONE folder — copy/move/download/
// delete of the session dir carries every shard:
//   <project>/sessions/<dirName>/           — active shard (live files at the root)
//   <project>/sessions/<dirName>/parts/<N>/ — frozen shard N (N = 1,2,… oldest→newest)
// sessions/ enumerators only ever look ONE level down, so the nested parts/
// subtree is invisible to them. These helpers are the ONLY join sites for
// parts/ paths (single-owner discipline, same as every other v2 path here).

/** The parts/ subdir INSIDE one session dir that holds its frozen shards. */
export function shardPartsDir(sessionDir) {
  return join(sessionDir, 'parts');
}

/** Frozen shard dir for shard N of a session. */
export function shardPartDir(sessionDir, n) {
  return join(sessionDir, 'parts', String(n));
}

/**
 * Enumerate frozen shards of one session, oldest first. Each entry
 * { partIndex, dir }. Reads the session's own parts/ subdir.
 * @param {string} sessionDir - absolute path of the ACTIVE session dir
 * @returns {Array<{ partIndex: number, dir: string }>}
 */
export function listShards(sessionDir) {
  const root = shardPartsDir(sessionDir);
  const out = [];
  let names = [];
  try {
    names = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if (err && err.code !== 'ENOENT') reportSwallowed('v2-shard.list', err);
    return out; // no parts/ dir → no frozen shards
  }
  for (const e of names) {
    if (!e.isDirectory()) continue;
    const n = Number(e.name);
    if (!Number.isInteger(n) || n < 1) continue;
    out.push({ partIndex: n, dir: join(root, e.name) });
  }
  out.sort((a, b) => a.partIndex - b.partIndex);
  return out;
}

/**
 * Resolve a session-dir-or-shard-dir to the readSession coordinates of its
 * SHARD root. A frozen shard lives INSIDE the session dir at
 * <project>/sessions/<base>/parts/<N>/ — one level deeper than a normal
 * session dir — so the naive projectDir derivation would point readSession at
 * a nonexistent path. Returns null for a normal (non-shard) session dir.
 * @returns {{ base: string, projectDir: string, sessionsDirName: string, sessionId: string } | null}
 */
export function shardReadRoot(sessionDir) {
  if (basename(dirname(sessionDir)) !== 'parts') return null;
  const base = basename(dirname(dirname(sessionDir)));        // <dirName>
  return {
    base,
    projectDir: dirname(dirname(dirname(dirname(sessionDir)))), // <project>
    sessionsDirName: join('sessions', base, 'parts'),          // sessions/<base>/parts
    sessionId: basename(sessionDir),                           // <N>
  };
}

