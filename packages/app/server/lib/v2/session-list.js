// Wire Format v2 — session-row cache for the log list (P0-A, 2026-07-31).
//
// `GET /api/local-logs` re-scans every session on every call: full journal
// fold, recursive dir walk, 256KB prompts head read, meta read — all sync,
// all blocking the event loop. With 100+ sessions this costs seconds.
//
// The journal is append-only (the single write path is Journal.writeReq/
// writeDone → AsyncWriteQueue.appendTo; creation is a one-time 'wx' sentinel;
// no truncate/rename/unlink anywhere). Content changes land in the journal
// LAST within a request (blobs → conversation → journal line → prompts), so
// (size, mtimeMs) is an exact freshness key for everything up to the journal
// line. prompts.jsonl is appended strictly AFTER the journal line (and is
// backfilled without a journal write on crash-resume), so the freshness key
// spans BOTH files: `journalSize:journalMtimeMs:promptsSize:promptsMtimeMs`.
// A repeated key means identical row inputs; any content change bumps one of
// the two stats.
//
// Cache shape: Map<projectDir, Map<sid, Row>> keyed by the project dir, with
// per-sid rows keyed by the freshness pair above. Insertion-order eviction
// caps the project map at MAX_PROJECTS. Rows are re-copied on return (see
// copyRow) so callers can't mutate the cache.

import { statSync, existsSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { listSessionIds, readJsonlTolerant } from './replay.js';
import { readPromptsHead, collectPromptsFromEvents } from '../user-prompt-extract.js';
import { isDiscardableSession } from './session-select.js';
import { isSupportedWireFormat, dirSizeSync } from './layout.js';
import { reportSwallowed } from '@ccv/core/error-report';

const MAX_PROJECTS = 32;

// ─── internal helpers (verbatim extraction from adapter.js) ──────────────────

/** Bounded head read: parse the FIRST JSONL line of a file without loading the
 *  whole thing (a main conversation's opening snapshot can be multi-MB; the
 *  list only wants a preview). Returns null on any shortfall. */
function readFirstJsonLine(path, budget = 256 * 1024) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(budget);
    const n = readSync(fd, buf, 0, budget, 0);
    const head = buf.toString('utf-8', 0, n);
    const nl = head.indexOf('\n');
    if (nl <= 0) return null; // no complete first line inside the budget
    return JSON.parse(head.slice(0, nl));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
  }
}

// ─── per-session summarization ───────────────────────────────────────────────

/**
 * Compute the summary row for one session dir. This is the exact logic that
 * used to live inline in listV2Sessions (adapter.js). All gates and error
 * directions are preserved verbatim:
 *
 *   - wireFormat gate (meta.json) → skip + reportSwallowed
 *   - wireFormat gate (journal sentinel) → skip + reportSwallowed
 *   - error→keep: journal stat failure skips the row, never caches
 *   - discard short-circuit: !leader && !hasMainOrTeammate && isDiscardableSession()
 *   - no "journal non-empty" guard — torn creation is tolerated as turns:0
 *
 * @returns {object|null} row {sid, dir, startTs, leader, turns, size, preview, discard}
 *   or null if the session should be skipped
 */
function summarizeSession(projectDir, sid) {
  const dir = join(projectDir, 'sessions', sid);
  // Journal existence is the cheapest gate — a session dir without one is
  // either torn at creation or not a session at all.
  if (!existsSync(join(dir, 'journal.jsonl'))) return null;
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')); } catch { /* tolerated — journal is self-describing */ }
  if (meta && meta.wireFormat != null && !isSupportedWireFormat(meta.wireFormat)) {
    // Reader version gate (spec §14): don't list a session this build
    // can't read — a garbage preview/turn-count is worse than absence.
    reportSwallowed('v2-read.unsupported-wire-format', new Error(`${sid}: wireFormat=${meta.wireFormat}`));
    return null;
  }

  // turns = main requests that completed (journal two-phase fold). The
  // journal sentinel is checked in the same pass: per §14 the per-file
  // sentinel WINS over meta.json, and readSession/adapter refuse such a
  // session — listing it would show a phantom row that opens empty.
  const reqKind = new Map();
  let turns = 0;
  let sentinelVersion = null;
  let hasMainOrTeammate = false;
  for (const line of readJsonlTolerant(join(dir, 'journal.jsonl'))) {
    if (line.ph === 'req') {
      reqKind.set(line.seq, line.kind);
      if (line.kind === 'main' || line.kind === 'teammate') hasMainOrTeammate = true;
    }
    else if (line.ph === 'done' && reqKind.get(line.seq) === 'main') {
      turns++;
      reqKind.delete(line.seq); // fold duplicate done lines (§14)
    } else if (line.ph === 'meta' && typeof line.wireFormat === 'number' && !isSupportedWireFormat(line.wireFormat)) {
      sentinelVersion = line.wireFormat;
      break;
    }
  }
  if (sentinelVersion != null) {
    reportSwallowed('v2-read.unsupported-wire-format', new Error(`${sid}: wireFormat=${sentinelVersion} (journal sentinel)`));
    return null;
  }

  // preview = ALL user prompts of the session, from the prompts.jsonl
  // display cache (written by V2Writer / the converter; bounded head read
  // so the list stays O(budget) per session). Sessions predating the
  // cache fall back to the first epoch's first line — routed through the
  // shared extractor so command/caveat chrome never leaks into the row.
  let preview = readPromptsHead(join(dir, 'prompts.jsonl'));
  if (preview.length === 0) {
    const first = readFirstJsonLine(join(dir, 'conversations', 'main', 'e0.jsonl'));
    if (first && Array.isArray(first.msgs)) {
      preview = collectPromptsFromEvents([first]);
    }
  }

  return {
    sid,
    dir,
    startTs: (meta && meta.startTs) || '',
    leader: (meta && meta.leader) || null,
    turns,
    size: dirSizeSync(dir),
    preview,
    // Discardable-session verdict. KEEP IN SYNC: session-select.js
    // isDiscardableSession is the canonical rule; this fold pre-computes
    // it for free over the FULL journal (the canonical scan is 8MB-
    // budgeted — intentional asymmetry, a first main sits at the head).
    // When the fold says discard, the canonical predicate CONFIRMS it:
    // readJsonlTolerant swallows an I/O error (Windows EBUSY/EPERM lock)
    // into zero lines, which must KEEP the session, not hide it — the
    // canonical path carries that error→keep direction (ioErrorResult).
    // Main-bearing sessions never pay the extra read; probe journals are
    // ~3 lines.
    discard: !(meta && meta.leader) && !hasMainOrTeammate && isDiscardableSession(dir, meta),
  };
}

// ─── row cache ───────────────────────────────────────────────────────────────

/** Map<projectDir, Map<sid, {key, row}>> — insertion-order eviction. */
const _cache = new Map();

function _evictProjects() {
  while (_cache.size > MAX_PROJECTS) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
}

/**
 * Summarize every session under LOG_DIR/<project>/ for the log list (spec §12).
 * Deliberately cheap: journal lines only (small) + a bounded head read of the
 * main conversation's first epoch for the preview — conversation bodies are
 * never loaded. Teammate linkage is surfaced via `leader` so the caller can
 * fold those sessions into their leader's view instead of double-listing.
 *
 * Cached: repeat calls with unchanged journals return instantly (~1-3ms for
 * 100 sessions, vs. seconds for a full rescan).
 *
 * @returns {Array<{sid, dir, startTs, leader, turns, size, preview, discard}>}
 */
export function listV2Sessions(projectDir) {
  const sids = listSessionIds(projectDir);
  const sidSet = new Set(sids); // O(1) prune lookups — sids.includes() per cached sid is O(N²)
  let projectCache = _cache.get(projectDir);
  if (!projectCache) {
    projectCache = new Map();
    _cache.set(projectDir, projectCache);
    _evictProjects();
  }
  // Prune deleted/migrated sessions: a sid no longer in the readdir is gone.
  for (const sid of projectCache.keys()) {
    if (!sidSet.has(sid)) projectCache.delete(sid);
  }
  const out = [];
  for (const sid of sids) {
    try {
      const dir = join(projectDir, 'sessions', sid);
      let key;
      try {
        const jst = statSync(join(dir, 'journal.jsonl'));
        // Freshness key spans journal AND prompts.jsonl: the display cache is
        // appended strictly AFTER the journal line (v2-writer.js §5), so a list
        // call landing between the two queue drains — or a crash-resume
        // backfill that appends prompts without any journal write — must not
        // freeze a pre-prompts preview under an unchanged journal key. Absent
        // prompts use a placeholder: their first write always follows a journal
        // append, except exactly that backfill path, which this key detects.
        let pKey = '-:-';
        try {
          const pst = statSync(join(dir, 'prompts.jsonl'));
          pKey = `${pst.size}:${pst.mtimeMs}`;
        } catch { /* prompts.jsonl not written yet */ }
        key = `${jst.size}:${jst.mtimeMs}:${pKey}`;
      } catch {
        continue; // journal unreadable → skip row, never cache
      }
      const cached = projectCache.get(sid);
      if (cached && cached.key === key) {
        out.push(copyRow(cached.row)); // defensive copy — callers must not mutate cache
        continue;
      }
      const row = summarizeSession(projectDir, sid);
      if (row) {
        projectCache.set(sid, { key, row });
        out.push(copyRow(row));
      }
      // row === null → session skipped (wireFormat gate, sentinel, etc.) — don't cache
    } catch { /* one unreadable session must not break the list */ }
  }
  return out;
}

/** Copy a row for delivery: nested `preview` (array) and `leader` (object) are
 *  re-copied so a caller mutating what it received can never poison the cache
 *  entry shared by every viewer of the project. */
function copyRow(row) {
  return {
    ...row,
    ...(row.leader ? { leader: { ...row.leader } } : {}),
    preview: [...row.preview],
  };
}

/**
 * Summarize ONE session for the paginated list (server-side paging, 2026-07-31).
 * Same row + same cache as listV2Sessions: a key hit returns the cached row
 * without re-folding the journal; a miss computes and stores it. The caller
 * (listV2LogsPage) has already decided this sid is on the current page, so only
 * these sessions ever pay the summarize cost.
 *
 * @returns {object|null} row {sid, dir, startTs, leader, turns, size, preview, discard}
 *   or null if the session should be skipped (wireFormat gate, sentinel, no journal)
 */
export function summarizeSessionPage(projectDir, sid) {
  const dir = join(projectDir, 'sessions', sid);
  let key;
  try {
    const jst = statSync(join(dir, 'journal.jsonl'));
    let pKey = '-:-';
    try {
      const pst = statSync(join(dir, 'prompts.jsonl'));
      pKey = `${pst.size}:${pst.mtimeMs}`;
    } catch { /* prompts.jsonl not written yet */ }
    key = `${jst.size}:${jst.mtimeMs}:${pKey}`;
  } catch {
    return null; // journal unreadable → skip, never cache
  }
  let projectCache = _cache.get(projectDir);
  if (!projectCache) {
    projectCache = new Map();
    _cache.set(projectDir, projectCache);
    _evictProjects();
  }
  const cached = projectCache.get(sid);
  if (cached && cached.key === key) return copyRow(cached.row);
  const row = summarizeSession(projectDir, sid);
  if (row) {
    projectCache.set(sid, { key, row });
    return copyRow(row);
  }
  return null; // skipped (wireFormat gate, sentinel, etc.) — don't cache
}

/** Test hook: drop all cached rows. */
export function _resetForTest() {
  _cache.clear();
}
