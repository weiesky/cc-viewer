// Per-project store of the RENDERED system-prompt content each claude session was
// launched with — the "snapshot" that lets `-c`/`-r` resumes re-inject byte-identical
// text instead of re-rendering `${...}` template variables (which change between
// launches and bust the whole prompt-prefix KV cache; git.status/recentCommits/dates
// are the usual drifters).
//
// Layout under <LOG_DIR>/<projectKey>/system-prompt-snapshots/:
//   <transcriptUuid>.json  — { v, entries:[{flag, basename, content}], model, createdAt, boundVia }
//                            Only sessions that actually had an injection get records:
//                            empty-entries snapshots are never persisted (a resume target
//                            with no record simply follows the no-record path every time —
//                            same outcome, zero poisoning surface).
//   pending.json           — FIFO queue (cap PENDING_CAP) of launches awaiting binding:
//                            { entries, model, cwd, createdAt, pid, resumeExpected, resolvedUuid, fork }
//
// Binding channels (both consume the queue):
//   - Bind A (wire): v2-writer sees a session's first MAIN request and matches its
//     system text against pending contents — content is the capability, so teammate /
//     subagent requests can never steal a bind. Fresh sessions: wire sid == transcript uuid.
//   - Bind B (hook): the SessionStart hook reports the resumed conversation's transcript
//     uuid; a resume launch's pending is consumed EXACTLY by resolvedUuid (source
//     'resume') or by fork flag (source 'fork'). Non-matching hooks consume nothing —
//     a stolen in-terminal /resume hook or an out-of-order racing hook can neither
//     poison an innocent conversation's record nor cascade-destroy the queue.
//
// Failure philosophy: every public function is total (returns null/false on error,
// never throws) — a lost snapshot only means a later resume falls back to the
// no-record path, never a broken spawn or a dropped log entry.
//
// GC (lazy, spawn-path only): appendPending drops records whose transcript file is
// gone (past a 1h grace window — bind-before-transcript races) or older than 30 days.
// Identical re-binds refresh createdAt, so actively-resumed conversations stay alive.
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { reportSwallowed } from '@ccv/core/error-report';
import { LOG_DIR, getClaudeConfigDir } from '../../findcc.js';
import { renameSyncWithRetry } from './file-api.js';

const STORE_DIR_NAME = 'system-prompt-snapshots';
const PENDING_FILE = 'pending.json';
const PENDING_CAP = 16; // generous headroom for sequential launches; FIFO beyond
// Bind B freshness window: a resume launch's hook lands seconds after spawn; the TTL
// only bounds how long an abandoned pending (crashed launch, hook never fired) stays
// consumable. Bind A ignores age — content matching is self-validating regardless of
// how long the user waited to send the first message.
const RESUME_PENDING_TTL_MS = 15 * 60 * 1000;
const QUEUE_GC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_GC_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A just-bound record can predate claude's transcript flush (fork hooks fire before the
// first message; /compact rename windows). Records younger than this are never
// transcript-gone-collected.
const GC_TRANSCRIPT_GRACE_MS = 60 * 60 * 1000;
const MAX_STORE_FILE_BYTES = 8 * 1024 * 1024;   // corrupt multi-GB files must not stall spawns
const MAX_ENTRY_CONTENT_BYTES = 256 * 1024;     // rendered prompts are KB-scale; bigger = junk
const TRANSCRIPT_HEAD_BYTES = 64 * 1024;        // -c candidate filter reads only the head

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN_FLAGS = new Set(['--system-prompt-file', '--append-system-prompt-file']);
// `-c` candidate filter: teammate and sidechain transcripts share the project's
// transcript dir but are never claude's continue target (mirrors claude's own filter).
const TRANSCRIPT_SKIP_MARKERS = ['"isSidechain":true', '"teamName"'];

// Test seam (repo _setXxxForTests style): the clock. The projects dir is steered via
// CCV_PROJECTS_DIR / CLAUDE_CONFIG_DIR envs (findcc's test barriers apply).
let _now = Date.now;
export function _setSnapshotDepsForTests({ now } = {}) {
  _now = typeof now === 'function' ? now : Date.now;
}

/** projectName derivation — same algorithm as interceptor.js (basename + sanitize). */
export function projectKeyForCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  const key = basename(cwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  // Parity with v2/layout.js sanitizePathComponent: all-dots degenerate names must not
  // become path traversal segments.
  return (!key || /^\.+$/.test(key)) ? '_' : key;
}

/** claude transcript projects root: CCV_PROJECTS_DIR override, else <config>/projects. */
function projectsDir() {
  return process.env.CCV_PROJECTS_DIR || join(getClaudeConfigDir(), 'projects');
}

/** claude transcript dir for a launch cwd: <projects>/<slug>/ (slug = non-alnum → '-'). */
export function transcriptDirForCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  return join(projectsDir(), cwd.replace(/[^A-Za-z0-9]/g, '-'));
}

/** Flatten a request body's system field (string | array of text blocks) for matching. */
export function systemTextOfBody(body) {
  const system = body && body.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(s => (s && s.text) || '').join('');
  return '';
}

// The spawn side learns cwd from the launch, the hook side from claude's payload —
// symlinks (/tmp → /private/tmp on macOS) and trailing separators would silently break
// the byte-equality the queue matching relies on. Best-effort realpath both sides.
function normalizeCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  let out = cwd;
  try { out = realpathSync.native(out); } catch { /* path may not exist yet — keep raw */ }
  return out.length > 1 ? out.replace(/[\\/]+$/, '') : out;
}

function storeDirForKey(projectKey, logDir = LOG_DIR) {
  return projectKey ? join(logDir, projectKey, STORE_DIR_NAME) : '';
}

/**
 * Validate + normalize a raw entries array → [{flag, basename, content}] (drops junk).
 * Beyond shape: flags are whitelisted and basenames must be bare filenames — a corrupted
 * or planted record must never become a path escape (materialize joins it) or an
 * arbitrary claude argv flag (materialize pushes it).
 */
function sanitizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    if (!KNOWN_FLAGS.has(e.flag)) continue;
    if (typeof e.basename !== 'string' || !e.basename) continue;
    if (basename(e.basename) !== e.basename || e.basename.startsWith('.')) continue;
    if (typeof e.content !== 'string') continue; // unavailable entries never reach the store
    if (Buffer.byteLength(e.content, 'utf-8') > MAX_ENTRY_CONTENT_BYTES) continue;
    out.push({ flag: e.flag, basename: e.basename, content: e.content });
  }
  return out;
}

function entriesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.flag === b[i].flag && e.basename === b[i].basename && e.content === b[i].content);
}

function readJsonFileCapped(file) {
  try {
    if (statSync(file).size > MAX_STORE_FILE_BYTES) return null;
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch { return null; }
}

function atomicWriteJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(tmp, JSON.stringify(obj));
    renameSyncWithRetry(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* already absent */ }
    throw err;
  }
}

/**
 * Read a conversation's snapshot by project key. Missing / corrupt / wrong shape → null.
 * @returns {{entries:Array, model:string|null, createdAt:number, boundVia:string}|null}
 */
export function readSnapshotByKey(projectKey, uuid, logDir) {
  try {
    if (!UUID_RE.test(String(uuid || ''))) return null;
    const dir = storeDirForKey(projectKey, logDir);
    if (!dir) return null;
    const obj = readJsonFileCapped(join(dir, `${uuid}.json`));
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.entries)) return null;
    return {
      entries: sanitizeEntries(obj.entries),
      model: typeof obj.model === 'string' ? obj.model : null,
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : 0,
      boundVia: obj.boundVia === 'hook' ? 'hook' : 'wire',
    };
  } catch (err) {
    reportSwallowed('sys-prompt-snap.read', err);
    return null;
  }
}

export function readSnapshot(cwd, uuid) {
  return readSnapshotByKey(projectKeyForCwd(cwd), uuid);
}

/**
 * Persist a conversation's snapshot by project key. Empty-entries records are refused
 * ('empty'): a resume target with no injection history is indistinguishable from an
 * unrecorded one by design — both take the no-record path, and no stored record can
 * later mislabel a session. Default skipIfPresent: an existing record whose entries
 * DIFFER is kept (first bind wins — a later conflicting bind means a resolution
 * mistake, and the warning is the diagnostic); identical content rewrites the file
 * just to refresh createdAt (otherwise gc would age out actively-resumed conversations
 * 30 days after their FIRST bind).
 * @returns {{written:boolean, reason?:'identical'|'exists'|'invalid'|'empty'}}
 */
export function writeSnapshotByKey(projectKey, uuid, rec, { skipIfPresent = true, logDir } = {}) {
  try {
    if (!UUID_RE.test(String(uuid || ''))) return { written: false, reason: 'invalid' };
    const dir = storeDirForKey(projectKey, logDir);
    if (!dir) return { written: false, reason: 'invalid' };
    const entries = sanitizeEntries(rec && rec.entries);
    if (entries.length === 0) return { written: false, reason: 'empty' };
    const next = {
      v: 1,
      entries,
      model: rec && typeof rec.model === 'string' ? rec.model : null,
      createdAt: _now(),
      boundVia: rec && rec.boundVia === 'hook' ? 'hook' : 'wire',
    };
    const prev = readSnapshotByKey(projectKey, uuid, logDir);
    if (prev) {
      if (entriesEqual(prev.entries, next.entries)) {
        // Refresh the clock so active conversations survive age-based gc.
        atomicWriteJson(join(dir, `${uuid}.json`), next);
        return { written: false, reason: 'identical' };
      }
      if (skipIfPresent) {
        console.warn(`[CC Viewer] system-prompt snapshot for ${uuid} already exists with different content — keeping the first bind`);
        return { written: false, reason: 'exists' };
      }
    }
    atomicWriteJson(join(dir, `${uuid}.json`), next);
    // No gc() here: binding fires at session-start time when claude's transcript may
    // not be visible to us yet (bind-before-transcript would self-collect the record
    // we just wrote). Hygiene runs on the spawn path (appendPending) instead, where
    // every stored record refers to a long-settled conversation.
    return { written: true };
  } catch (err) {
    reportSwallowed('sys-prompt-snap.write', err);
    return { written: false, reason: 'invalid' };
  }
}

export function writeSnapshot(cwd, uuid, rec, opts) {
  return writeSnapshotByKey(projectKeyForCwd(cwd), uuid, rec, opts);
}

// ─── pending queue ────────────────────────────────────────────────────────────

function readPendingsByKey(projectKey, logDir) {
  try {
    const dir = storeDirForKey(projectKey, logDir);
    if (!dir) return [];
    const obj = readJsonFileCapped(join(dir, PENDING_FILE));
    const list = obj && Array.isArray(obj.pendings) ? obj.pendings : [];
    return list.filter(p => p && typeof p === 'object' && typeof p.cwd === 'string');
  } catch (err) {
    reportSwallowed('sys-prompt-snap.pending-read', err);
    return [];
  }
}

function writePendingsByKey(projectKey, list, logDir) {
  const dir = storeDirForKey(projectKey, logDir);
  if (!dir) return;
  atomicWriteJson(join(dir, PENDING_FILE), { v: 1, pendings: list });
}

/**
 * Enqueue a launch's effective injection content for later binding.
 * rec: { entries, model, resumeExpected, resolvedUuid, fork } — cwd/createdAt/pid stamped here.
 */
export function appendPending(cwd, rec = {}, logDir) {
  try {
    const projectKey = projectKeyForCwd(cwd);
    if (!projectKey) return false;
    const list = readPendingsByKey(projectKey, logDir);
    const cutoff = _now() - QUEUE_GC_AGE_MS;
    const kept = list.filter(p => (typeof p.createdAt === 'number' ? p.createdAt : 0) >= cutoff);
    kept.push({
      entries: sanitizeEntries(rec.entries),
      model: typeof rec.model === 'string' ? rec.model : null,
      cwd: normalizeCwd(cwd),
      createdAt: _now(),
      pid: process.pid,
      resumeExpected: rec.resumeExpected === true,
      resolvedUuid: typeof rec.resolvedUuid === 'string' ? rec.resolvedUuid : null,
      fork: rec.fork === true,
    });
    while (kept.length > PENDING_CAP) kept.shift();
    writePendingsByKey(projectKey, kept, logDir);
    gc(cwd, logDir);
    return true;
  } catch (err) {
    reportSwallowed('sys-prompt-snap.pending-append', err);
    return false;
  }
}

/**
 * Bind A (wire): match a session's first main request's system text against the queue.
 * Non-empty pendings require EVERY entry content to appear in systemText (content is
 * the capability — only the process we injected can present it); among matches the
 * LONGEST total content wins, so a superset launch can never be claimed by a subset
 * pending. When no content match exists, the oldest EMPTY pending is consumed (empty
 * records are interchangeable — a mismatch binds "no injection" to a session that had
 * none). resumeExpected pendings are reserved for Bind B and never consumed here.
 * @returns {object|null} the consumed pending
 */
export function consumePendingForWireByKey(projectKey, systemText, logDir) {
  try {
    if (!projectKey || typeof systemText !== 'string') return null;
    const list = readPendingsByKey(projectKey, logDir);
    if (list.length === 0) return null;
    const eligible = p => p.resumeExpected !== true;
    let hitIdx = -1;
    let hitLen = -1;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!eligible(p) || p.entries.length === 0) continue;
      if (!p.entries.every(e => e.content && systemText.includes(e.content))) continue;
      const total = p.entries.reduce((n, e) => n + e.content.length, 0);
      if (total > hitLen) { hitLen = total; hitIdx = i; }
    }
    if (hitIdx === -1) hitIdx = list.findIndex(p => eligible(p) && p.entries.length === 0);
    if (hitIdx === -1) return null;
    const [hit] = list.splice(hitIdx, 1);
    writePendingsByKey(projectKey, list, logDir);
    return hit;
  } catch (err) {
    reportSwallowed('sys-prompt-snap.wire-consume', err);
    return null;
  }
}

/**
 * Bind B (hook): consume the pending that belongs to THIS hook's conversation.
 *   source 'resume' → exact resolvedUuid match only;
 *   source 'fork'   → the oldest fork pending (fork hooks carry the fork's NEW
 *                     transcript uuid, which the spawn could not have known).
 * Anything else consumes NOTHING: a stolen in-terminal /resume hook or an out-of-order
 * racing hook finds no exact match and leaves the queue intact — no cascade of
 * guard-refusals, no destroyed pendings (strays age out via RESUME_PENDING_TTL_MS).
 * @returns {object|null} { hit } | { mismatch: resolvedUuid } | null
 */
export function consumePendingForResume(cwd, transcriptUuid, source, logDir) {
  try {
    const normCwd = normalizeCwd(cwd);
    if (!normCwd) return null;
    const projectKey = projectKeyForCwd(cwd);
    const list = readPendingsByKey(projectKey, logDir);
    if (list.length === 0) return null;
    const cutoff = _now() - RESUME_PENDING_TTL_MS;
    const kept = list.filter(p => {
      if (p.resumeExpected !== true) return true;
      return (typeof p.createdAt === 'number' ? p.createdAt : 0) >= cutoff; // stale strays drop out
    });
    const changed = kept.length !== list.length;
    let idx = -1;
    if (source === 'fork') {
      idx = kept.findIndex(p => p.resumeExpected === true && p.fork === true && p.cwd === normCwd);
    } else {
      idx = kept.findIndex(p => p.resumeExpected === true && p.fork !== true
        && p.cwd === normCwd && p.resolvedUuid === transcriptUuid);
    }
    if (idx === -1) {
      if (changed) writePendingsByKey(projectKey, kept, logDir);
      // Diagnostic surface for a -c mis-resolution: a RESUME hook arrived but the
      // only resume pendings for this cwd name a DIFFERENT conversation than the
      // one claude actually resumed. Fork hooks never warn (their new uuid differs
      // from resolvedUuid by design); equal-uuid leftovers aren't mismatches either.
      const other = source !== 'fork' && kept.find(p => p.resumeExpected === true && p.fork !== true
        && p.cwd === normCwd && p.resolvedUuid && p.resolvedUuid !== transcriptUuid);
      return other ? { mismatch: other.resolvedUuid } : null;
    }
    const [hit] = kept.splice(idx, 1);
    writePendingsByKey(projectKey, kept, logDir);
    return { hit };
  } catch (err) {
    reportSwallowed('sys-prompt-snap.resume-consume', err);
    return null;
  }
}

/** Bounded head read (transcripts can reach GB scale — never whole-file them here). */
function readHead(file, maxBytes) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString('utf-8', 0, n);
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* best-effort */ }
  }
}

/**
 * Resolve which conversation `claude -c` would continue in cwd: the newest-mtime
 * uuid-named transcript in <projects>/<slug>/, skipping teammate/sidechain transcripts
 * (they share the dir but are never continue targets). Missing dir / no candidates /
 * fs error → null (caller treats as "target unidentifiable" → fresh-launch behavior).
 */
export function resolveContinueTargetUuid(cwd) {
  try {
    const dir = transcriptDirForCwd(cwd);
    if (!dir || !existsSync(dir)) return null;
    let best = null;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const uuid = basename(name, '.jsonl');
      if (!UUID_RE.test(uuid)) continue;
      const file = join(dir, name);
      let stat;
      try { stat = statSync(file); } catch { continue; }
      if (best && stat.mtimeMs <= best.mtimeMs) continue;
      try {
        const head = readHead(file, TRANSCRIPT_HEAD_BYTES);
        if (TRANSCRIPT_SKIP_MARKERS.some(m => head.includes(m))) continue;
      } catch { continue; }
      best = { uuid, mtimeMs: stat.mtimeMs };
    }
    return best ? best.uuid : null;
  } catch (err) {
    reportSwallowed('sys-prompt-snap.resolve-continue', err);
    return null;
  }
}

/**
 * Lazy hygiene, invoked from the spawn path (appendPending): drop snapshot files whose
 * transcript is gone (past the grace window) or older than SNAPSHOT_GC_AGE_MS. Queue
 * aging is handled inside the queue readers/writers themselves.
 */
export function gc(cwd, logDir) {
  try {
    const projectKey = projectKeyForCwd(cwd);
    const dir = storeDirForKey(projectKey, logDir);
    if (!dir || !existsSync(dir)) return 0;
    const tDir = transcriptDirForCwd(cwd);
    const cutoff = _now() - SNAPSHOT_GC_AGE_MS;
    const graceCutoff = _now() - GC_TRANSCRIPT_GRACE_MS;
    let removed = 0;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || name === PENDING_FILE) continue;
      const uuid = basename(name, '.json');
      if (!UUID_RE.test(uuid)) continue;
      const rec = readSnapshotByKey(projectKey, uuid, logDir);
      if (!rec) continue; // corrupt → leave it for a human, don't churn
      const stale = rec.createdAt > 0 && rec.createdAt < cutoff;
      const transcriptGone = rec.createdAt < graceCutoff
        && tDir && !existsSync(join(tDir, `${uuid}.jsonl`));
      if (stale || transcriptGone) {
        try { unlinkSync(join(dir, name)); removed++; } catch { /* best-effort */ }
      }
    }
    return removed;
  } catch (err) {
    reportSwallowed('sys-prompt-snap.gc', err);
    return 0;
  }
}
