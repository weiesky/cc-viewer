// Cold-load fallback session selection (task B, 2026-07-15).
//
// On `ccv`/`ccv -c` startup the current session's dir does not exist until its
// first API request resolves a sid, so `getLiveLogSource()` would return '' and
// the [对话] panel loads empty. This picker supplies the session to cold-load:
// the most-recent MAIN (non-teammate) session that actually has a main turn,
// so the panel shows the last real conversation.
//
// CONTENT REQUIREMENT (2026-07-15 refresh-bug fix): a session can be the
// writer's "current" session (its sid resolved) while having NO main turn yet —
// e.g. `-c` startup, or a background sub / count_tokens request sets _currentSid
// before the user sends anything. Cold-loading such an empty session renders a
// blank panel (the symptom: fresh load shows data, a refresh once the empty
// current session exists shows nothing, and it only fills after the user sends
// a request). So selection requires at least one `kind:'main'` request — the
// "activated" session — and both getLiveLogSource and the picker apply it.
//
// Deliberately lightweight — meta.json + a bounded journal HEAD read only. It
// does NOT use listV2Sessions (dirSizeSync recursion + prompts head-reads +
// full turn counting): this runs on every cold `/events` connection.

import { existsSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { listSessionIds } from './replay.js';
import { isSupportedWireFormat } from './layout.js';
import { isForeignLiveOwned } from './session-owner.js';

/**
 * Find the on-disk dir NAME of an existing session for `sessionId` (a UUID), or
 * null. Task C: dir names are `<ts>_<uuid>` (new) or `<uuid>` (legacy/staging),
 * so the identity UUID is recovered by suffix. Used by the writer (restart /
 * `-c` re-attach: must reuse the existing dir, not mint a second one) and by
 * convert's dual-write skip. Match precedence: exact `=== sessionId` (legacy),
 * then `endsWith('_'+sessionId)`; on >1 suffix match prefer meta.sessionId===id,
 * else the newest meta.startTs (partial-migration / live-skip can leave both).
 * @returns {string|null} the dir basename, or null if none exists
 */
export function resolveSessionDirName(projectDir, sessionId, sessionsDirName = 'sessions') {
  if (!projectDir || !sessionId) return null;
  const suffix = '_' + sessionId;
  let bestSuffix = null; // { name, startTs, idMatch }
  for (const name of listSessionIds(projectDir, sessionsDirName)) {
    if (name === sessionId) return name; // exact legacy dir — unambiguous
    if (!name.endsWith(suffix)) continue;
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(projectDir, sessionsDirName, name, 'meta.json'), 'utf-8')); } catch { /* tolerate */ }
    const idMatch = !!(meta && meta.sessionId === sessionId);
    const startTs = (meta && meta.startTs) || '';
    if (bestSuffix === null
      || (idMatch && !bestSuffix.idMatch)
      || (idMatch === bestSuffix.idMatch && startTs > bestSuffix.startTs)) {
      bestSuffix = { name, startTs, idMatch };
    }
  }
  return bestSuffix ? bestSuffix.name : null;
}

const MAIN_REQ_SCAN_BUDGET = 256 * 1024; // a session's first main req sits at the journal head
// The first main turn's `done` can land far past the head: journal lines are
// metadata-only (~0.5–2 KB each; bodies live in conversation/blob stores), but a
// heavy multi-agent first turn interleaves many sub/heartbeat req+done lines
// before the main done. 8 MB ≈ thousands of journal lines — far beyond any
// realistic first turn — and the streaming scanner early-exits on the first hit,
// so a session with a completed turn stops within its first few hundred lines.
const COMPLETED_TURN_SCAN_BUDGET = 8 * 1024 * 1024;
const SCAN_CHUNK = 64 * 1024;

/**
 * Stream journal.jsonl through `onLine(line)` (trimmed, non-empty lines only),
 * reading fixed-size chunks so memory stays bounded regardless of file size.
 * Stops as soon as `onLine` returns truthy (→ true) or `budget` bytes have been
 * read (→ false). The final unterminated line (possibly torn mid-write) is
 * delivered too — predicates JSON.parse and ignore what doesn't parse. Missing
 * file / any read error → false (callers treat that as "not activated").
 * @param {string} dir - absolute session dir
 * @param {number} budget - max bytes to read before giving up
 * @param {(line:string) => boolean} onLine
 * @param {boolean} [ioErrorResult=false] - returned when the journal EXISTS
 *   but reading it throws (transient lock / fd exhaustion). The cold-load
 *   scanners keep the false default ("not activated"); the discard predicate
 *   passes true so an I/O hiccup can never hide a REAL session.
 * @returns {boolean}
 */
function scanJournal(dir, budget, onLine, ioErrorResult = false) {
  const journal = join(dir, 'journal.jsonl');
  if (!existsSync(journal)) return false;
  let fd;
  try {
    fd = openSync(journal, 'r');
    const chunk = Buffer.alloc(Math.min(SCAN_CHUNK, budget));
    const decoder = new StringDecoder('utf-8'); // multi-byte chars may straddle chunks
    let read = 0;
    let carry = ''; // unterminated tail of the previous chunk
    while (read < budget) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, budget - read), read);
      if (n <= 0) break;
      read += n;
      carry += decoder.write(n === chunk.length ? chunk : chunk.subarray(0, n));
      let start = 0;
      for (;;) {
        const nl = carry.indexOf('\n', start);
        if (nl === -1) break;
        const line = carry.slice(start, nl).trim();
        start = nl + 1;
        if (line && onLine(line)) return true;
      }
      if (start > 0) carry = carry.slice(start);
    }
    const last = (carry + decoder.end()).trim();
    return !!(last && onLine(last));
  } catch {
    return ioErrorResult;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
  }
}

/**
 * Does this session dir have at least one `kind:'main'` request on disk? A
 * bounded head scan of journal.jsonl — the opening main request is at the top,
 * so a session that has ANY main turn is detected within the budget. An empty /
 * sub-only / not-yet-activated session returns false.
 * @param {string} dir - absolute session dir
 * @returns {boolean}
 */
export function sessionHasMainTurn(dir) {
  return scanJournal(dir, MAIN_REQ_SCAN_BUDGET, (line) => {
    // Cheap prefilter before JSON.parse: a main req line carries both.
    if (!line.includes('"ph":"req"') || !line.includes('"kind":"main"')) return false;
    try {
      const o = JSON.parse(line);
      return !!(o && o.ph === 'req' && o.kind === 'main');
    } catch { return false; } // torn line — keep scanning
  });
}

/**
 * Does this session dir have at least one COMPLETED main turn — a `kind:'main'`
 * request whose `done` line is also present? A streaming scan correlating
 * main-req seqs with done seqs (either arrival order), bounded by
 * COMPLETED_TURN_SCAN_BUDGET — wide enough that a heavy multi-agent first turn
 * whose done lands megabytes past the head is still found. Stronger than
 * `sessionHasMainTurn`: a session with only an in-flight first main request (req
 * written, response still streaming) returns false, so cold-load keeps showing
 * the previous conversation until the current one has renderable content.
 * @param {string} dir - absolute session dir
 * @returns {boolean}
 */
export function sessionHasCompletedMainTurn(dir) {
  const mainSeqs = new Set(); // seqs of kind:'main' req lines seen so far
  const doneSeqs = new Set(); // seqs of done lines seen so far
  return scanJournal(dir, COMPLETED_TURN_SCAN_BUDGET, (line) => {
    if (line.includes('"ph":"req"') && line.includes('"kind":"main"')) {
      try {
        const o = JSON.parse(line);
        if (o && o.ph === 'req' && o.kind === 'main' && o.seq != null) {
          if (doneSeqs.has(o.seq)) return true;
          mainSeqs.add(o.seq);
        }
      } catch { /* torn line — keep scanning */ }
    } else if (line.includes('"ph":"done"')) {
      try {
        const o = JSON.parse(line);
        if (o && o.ph === 'done' && o.seq != null) {
          if (mainSeqs.has(o.seq)) return true;
          doneSeqs.add(o.seq);
        }
      } catch { /* torn line — keep scanning */ }
    }
    return false;
  });
}

/**
 * Does this session dir have at least one req of kind 'main' OR 'teammate'?
 * The positive half of the discardable-session predicate. Budgeted with the
 * WIDE budget (not MAIN_REQ_SCAN_BUDGET): journal req lines run ~1.1-1.3KB
 * (headers + params), and time-driven heartbeat/countTokens lines can pile up
 * before a real session's first main — a 256KB budget could give up early and
 * misjudge a REAL session as discardable. Sessions that have a main still
 * early-exit at its line; only genuinely main-less journals pay the budget.
 * @param {string} dir - absolute session dir
 * @returns {boolean}
 */
export function sessionHasMainOrTeammateReq(dir) {
  // ioErrorResult=true: a transient read error must KEEP the session (treat
  // as main-bearing) — hiding a real session is the worse failure direction;
  // a missing journal still returns false (discard is correct there).
  return scanJournal(dir, COMPLETED_TURN_SCAN_BUDGET, (line) => {
    if (!line.includes('"ph":"req"')) return false;
    if (!line.includes('"kind":"main"') && !line.includes('"kind":"teammate"')) return false;
    try {
      const o = JSON.parse(line);
      return !!(o && o.ph === 'req' && (o.kind === 'main' || o.kind === 'teammate'));
    } catch { return false; } // torn line — keep scanning
  }, true);
}

/**
 * Discardable-session predicate (2026-07-16): a session dir that must be
 * DISCARDED by every read surface — never listed, counted, followed, or used
 * as a candidate in any logic. These are orphan dirs minted by Claude Code's
 * quota probes (max_tokens:1, one `'quota'` user message, a throwaway
 * session_id per probe — fired at launches and agent-team spawns), plus any
 * torn/empty dir with no renderable identity.
 *
 * discard ⟺ meta.leader ABSENT (not a teammate session)
 *           AND no journal req line of kind 'main' or 'teammate'
 *
 * The 'teammate' kind clause is the safety net for a torn meta.json. Every
 * real session carries a main req at/near the journal head (verified across
 * the full real dataset: 18/18 main-less dirs were single quota probes), so a
 * kept session early-exits its scan cheaply. Read-side only and self-healing:
 * the moment a dir gains its first main req, the predicate flips and every
 * surface picks it up on its next scan/poll.
 *
 * KEEP IN SYNC: session-list.js summarizeSession pre-computes the same verdict
 * inline (hasMainOrTeammate inside its full journal fold — unbounded, vs this
 * predicate's 8MB budget; intentional asymmetry) and then CONFIRMS a discard
 * through this predicate so the error→keep direction is shared.
 * Change the rule here and there together.
 *
 * @param {string} dir - absolute session dir
 * @param {object|null} [meta] - pre-parsed meta.json (avoids a re-read);
 *   omitted → read here; unreadable → treated as leaderless (journal decides)
 * @returns {boolean} true = discard everywhere
 */
export function isDiscardableSession(dir, meta) {
  let m = meta;
  if (m === undefined) {
    try { m = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')); } catch { m = null; }
  }
  if (m && m.leader) return false;
  return !sessionHasMainOrTeammateReq(dir);
}

/**
 * The newest readable, non-teammate session that HAS a main turn, as
 * `{ dir, sessionId }`, or null. "Readable" mirrors listV2Sessions' gates (spec
 * §14): journal.jsonl exists and the wireFormat is supported. Candidates are
 * ordered by meta.startTs (desc) and the first with a main turn wins. Returns
 * the identity UUID (meta.sessionId) alongside the dir so a `-c` continuation
 * can adopt this session's folder while preserving its identity.
 *
 * `excludeDir` skips one absolute session dir entirely: getLiveLogSource passes
 * its current in-flight session here, because this picker's weaker
 * has-a-main-req gate would otherwise re-select exactly the dir the caller's
 * completed-turn gate just rejected (it IS the newest once its first main req
 * is written), nullifying the fallback.
 *
 * `skipForeignLive` (multi-window isolation, 2026-07-17) drops candidates
 * whose `owner.lock` is held by ANOTHER live process — a parallel ccv window's
 * in-flight session. Without it, the cold-load fallback serves the other
 * window's conversation and `-c` adoption writes into its journal. A dead
 * owner's claim expires with its pid (kernel liveness), so crashed windows'
 * sessions stay selectable — never a permanent lock. Both consumers
 * (getLiveLogSource fallback, _resolveAdoption) pass true; default false keeps
 * the raw picker semantics for everything else.
 * @param {string} projectDir - absolute LOG_DIR/<project>
 * @param {{excludeDir?: string, skipForeignLive?: boolean}} [opts]
 * @returns {{dir:string, sessionId:string}|null}
 */
export function latestMainSession(projectDir, { excludeDir = '', skipForeignLive = false } = {}) {
  if (!projectDir) return null;
  const candidates = []; // { dir, sessionId, startTs }
  for (const name of listSessionIds(projectDir)) {
    const dir = join(projectDir, 'sessions', name);
    if (excludeDir && dir === excludeDir) continue;
    if (!existsSync(join(dir, 'journal.jsonl'))) continue;
    // After the cheaper journal-existence reject: skips one owner.lock read
    // per torn/non-session dir on large-history cold loads.
    if (skipForeignLive && isForeignLiveOwned(dir)) continue;
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')); } catch { continue; }
    if (!meta) continue;
    if (meta.wireFormat != null && !isSupportedWireFormat(meta.wireFormat)) continue;
    // Teammate/sub sessions carry a `leader` pointer; only a leader session
    // folds in its siblings when rendered, so a teammate dir loaded directly
    // renders wrong. Keep only main (leader-less) sessions.
    if (meta.leader) continue;
    candidates.push({ dir, sessionId: meta.sessionId || '', startTs: meta.startTs || '' });
  }
  // Newest first, then return the first that actually has a main turn — skipping
  // a not-yet-activated newest session (the refresh-bug fix).
  candidates.sort((a, b) => (a.startTs < b.startTs ? 1 : a.startTs > b.startTs ? -1 : 0));
  for (const c of candidates) {
    if (sessionHasMainTurn(c.dir)) return { dir: c.dir, sessionId: c.sessionId };
  }
  return null;
}

/**
 * Absolute dir of the newest readable, non-teammate session that HAS a main
 * turn, or '' if there is none. Thin wrapper over {@link latestMainSession}.
 * @param {string} projectDir - absolute LOG_DIR/<project>
 * @param {{excludeDir?: string}} [opts] - see {@link latestMainSession}
 * @returns {string} absolute session dir, or ''
 */
export function latestMainSessionDir(projectDir, opts) {
  return latestMainSession(projectDir, opts)?.dir || '';
}
