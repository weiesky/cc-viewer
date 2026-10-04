// Per-project "recent sessions" list for the /resume hover list (2026-10).
//
// Serves the N most-recent sessions of ONE project (the currently-bound one),
// for the header's current-project hover dropdown. Kept as a pure lib function
// (no HTTP, no interceptor state) so it is unit-testable with a temp LOG_DIR and
// an injectable `now` seam — same test posture as listV2LogsPage / deleteLogFiles.
//
// Scope: ONLY ccv's own v2 store is listed (sessions ccv actually proxied).
//
// Cost shape: a CHEAP meta.json pass per session (startTs + leader), plus a
// bounded journal head-scan (sessionHasMainOrTeammateReq) that drops quota-probe
// orphan dirs BEFORE they can occupy a top slot. Candidates are sorted
// newest-first, sliced to the top `limit`, and only THEN run the EXPENSIVE
// summarize (journal fold + dir walk + prompts head) via summarizeSessionPage —
// which shares listV2Sessions' freshness-keyed row cache, so repeat hover-opens
// are ~1-3ms. Fields the cheap pass cannot supply (sessionUuid from
// meta.sessionId, running, pinnedId) are read fresh per call for the surviving
// rows only, never from the cached row.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizePathComponent } from './layout.js';
import { listSessionIds } from './replay.js';
import { summarizeSessionPage } from './session-list.js';
import { sessionHasMainOrTeammateReq } from './session-select.js';
import { readPin } from '../session-pin-store.js';
import { LIVE_SESSION_MTIME_MS } from '../log-file-utils.js';
import { reportSwallowed } from '@ccv/core/error-report';

/**
 * Liveness heuristic for the "running" placeholder column. A session is
 * treated as possibly-live when its journal was appended within
 * LIVE_SESSION_MTIME_MS. Coarse by design (a background-but-idle >5min session
 * reads as not-running) — this is a display hint only. `now` is injectable for tests.
 * @param {string} sessionDir
 * @param {number} now - ms epoch
 * @returns {boolean}
 */
function isRecentlyActive(sessionDir, now) {
  try {
    const st = statSync(join(sessionDir, 'journal.jsonl'));
    return (now - st.mtimeMs) < LIVE_SESSION_MTIME_MS;
  } catch { return false; }
}

/**
 * List the `limit` most-recent v2 sessions of ONE project under `logDir`,
 * newest-first. Row shape:
 *   { source:'ccv', project, file, sessionUuid, startTs, turns, preview, running, pinnedId }
 * - `project`     — the LOG_DIR subdirectory name (already sanitize-safe).
 * - `file`        — v2 addressing token `v2:<project>/<dirName>` (dirName is
 *                   `<ts>_<uuid>` or legacy `<uuid>`), for the existing
 *                   open-log / live-tail paths.
 * - `sessionUuid` — the Claude Code session UUID from meta.sessionId (NOT the
 *                   dir name), the key the client uses to scope a `?sid=` view.
 * - `pinnedId`    — the project's persisted pin value verbatim (readPin), a
 *                   ts-based display id. The SERVER cannot map it to this row
 *                   (the ts stable id is a frontend runtime _timestamp), so the
 *                   row just carries it through; the CLIENT decides `selected`
 *                   by comparing against its own session stable ids.
 * - `running`     — coarse liveness placeholder (see isRecentlyActive).
 *
 * @param {string} logDir - LOG_DIR root (e.g. ~/.claude/cc-viewer).
 * @param {object} [opts]
 * @param {string} opts.project - the single project to list (required).
 * @param {number} [opts.limit=10]
 * @param {number} [opts.now] - ms epoch, injectable for tests.
 * @returns {{ items: Array, total: number }}
 */
export function listResumeSessions(logDir, { project, limit = 10, now = Date.now() } = {}) {
  const out = { items: [], total: 0 };
  if (!project || project !== sanitizePathComponent(project)) return out;

  const projectDir = join(logDir, project);
  if (!logDir || !existsSync(projectDir)) return out;

  // ── ccv's own v2 store (sessions ccv proxied). Cheap meta.json pass per
  // session for startTs + leader ordering/filtering, no journal fold.
  const candidates = [];
  let sessionIds;
  try { sessionIds = listSessionIds(projectDir); } catch (err) {
    reportSwallowed('resume-list.readdir', err, { project });
    return out;
  }
  for (const dirName of sessionIds) {
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(projectDir, 'sessions', dirName, 'meta.json'), 'utf-8')); } catch { /* journal is self-describing */ }
    if (meta && meta.leader) continue; // teammate — folded into its leader's row
    // Cheap discardable-session pre-check (bounded journal head-scan, early
    // exit on the first main/teammate req): drops quota-probe orphan dirs
    // BEFORE they can occupy a top-`limit` slot — without paying the full
    // summarize (journal fold + dir walk) for every candidate. Same source
    // predicate as session-list's isDiscardableSession (leader-absent + no
    // main/teammate req), so a probe is filtered here and the summarize-time
    // `discard` re-check below becomes a no-op for survivors.
    if (!sessionHasMainOrTeammateReq(join(projectDir, 'sessions', dirName))) continue;
    candidates.push({
      project,
      projectDir,
      dirName,
      startTs: (meta && meta.startTs) || '',
      sessionUuid: (meta && meta.sessionId) || null,
    });
  }

  // Order newest-first, then take the top `limit` BEFORE the expensive
  // summarize (journal fold + dir walk + prompts head) — so a large history
  // pays the summarize for at most `limit` rows, not for every session. Rows
  // dropped by the summarize-time filters (teammate fold / quota-probe orphan /
  // unreadable) leave their slot empty rather than being back-filled; such rows
  // are rare and `limit` is small, so the occasional short list is accepted in
  // exchange for the bounded cost.
  candidates.sort((a, b) =>
    b.startTs.localeCompare(a.startTs)
    || String(b.dirName || '').localeCompare(String(a.dirName || '')));
  const top = candidates.slice(0, limit);

  const ccvRows = [];
  for (const c of top) {
    let s = null;
    try { s = summarizeSessionPage(c.projectDir, c.dirName); } catch (err) {
      reportSwallowed('resume-list.summarize', err, { project: c.project, dirName: c.dirName });
      continue;
    }
    if (!s) continue;
    if (s.leader) continue;
    if (s.size === 0) continue;
    if (s.discard) continue; // quota-probe orphans: never listed
    const sessionDir = join(c.projectDir, 'sessions', c.dirName);
    ccvRows.push({
      source: 'ccv',
      project: c.project,
      file: `v2:${c.project}/${s.sid}`,
      sessionUuid: c.sessionUuid,
      startTs: s.startTs,
      turns: s.turns,
      preview: s.preview || [],
      running: isRecentlyActive(sessionDir, now),
      // The pin lives at the PROJECT dir and holds a ts-based display id, not a
      // uuid — pass it through verbatim; the client maps it to a row.
      pinnedId: readPin(c.projectDir),
    });
  }

  // Already newest-first from the candidate sort (the summarize filter only
  // drops rows, never reorders). total = surviving rows shown (≤ limit).
  out.total = ccvRows.length;
  out.items = ccvRows;
  return out;
}
