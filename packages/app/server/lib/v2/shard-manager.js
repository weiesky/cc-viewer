// Wire Format v2 — session-dir sharding (prompt-count auto-split).
//
// A single long-lived session can grow without bound (issue: a 653MB session
// dir made startup / cold load replay parse every journal + responses +
// conversation line into memory, stalling the event loop for seconds-to-
// minutes). Sharding caps the LIVE dir by PROMPT COUNT: once the session
// crosses SHARD_PROMPT_THRESHOLD main-conversation user prompts, the writer
// moves the CURRENT content aside into the session's own `parts/`
// subdir and continues writing into a fresh skeleton at the same dir.
//
// Layout contract: parts/ path helpers live in layout.js (the single owner of
// every v2 path) and are re-exported here for rotate-side consumers. A session
// dir keeps ALL of its history under ONE folder — copy/move/download/delete of
// the session dir carries every shard:
//   <project>/sessions/<dirName>/           — active shard (live files at the root)
//   <project>/sessions/<dirName>/parts/<N>/ — frozen shard N (N = 1,2,… oldest→newest)
// sessions/ enumerators only ever look ONE level down (listSessionIds yields
// session dirs; summarizeSession/readSession read the live files at the root),
// so the nested parts/ subtree is invisible to them. A frozen shard is a
// SELF-CONTAINED session dir (journal + responses + conversations + blobs as
// of the cut): the replay engine reconstructs it exactly like a complete
// session — its incremental snapshot replays to the state at the shard
// boundary, so no cross-shard baseline is needed. Journal seqs stay continuous
// across shards (the writer carries _seq over the cut).

import { mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ensureSessionDirSync, writeFileAtomicSync, shardPartsDir, shardPartDir, listShards } from './layout.js';
import { readJsonlTolerant } from './replay.js';
import { BlobStore } from './blob-store.js';
import { ConversationStore } from './conversation-store.js';
import { reportSwallowed } from '../../lib/error-report.js';

// Path ownership lives in layout.js; re-export so existing rotate-side and
// route-side consumers keep a single import site.
export { shardPartsDir, shardPartDir, listShards } from './layout.js';

/** Default prompt-count ceiling per shard: after this many main-conversation
 *  user-prompt turns, the NEXT new user prompt opens a fresh shard — so every
 *  part holds whole user-prompt→loop segments. Tests override via the writer's
 *  `shardPrompts` seam, not env. */
export const SHARD_PROMPT_THRESHOLD = 2000;

/**
 * Read every frozen shard's cut seq, oldest first. Each shard's cut is its
 * journal max seq; the persisted `cut.json` marker (written at the cut) is
 * read FIRST, and only shards written before the marker existed fall back to a
 * full journal scan. The journal is the smallest of the four files, but on a
 * many-shard session the marker turns an O(total-history) scan into
 * O(shard count) small reads.
 * @param {string} sessionDir - absolute path of the ACTIVE session dir
 * @returns {Array<{ partIndex: number, dir: string, cutSeq: number }>}
 */
export function readShardCuts(sessionDir) {
  const cuts = [];
  for (const sh of listShards(sessionDir)) {
    let maxSeq = 0;
    let fromMarker = false;
    try {
      const marker = JSON.parse(readFileSync(join(sh.dir, 'cut.json'), 'utf-8'));
      if (marker && typeof marker.cutSeq === 'number' && marker.cutSeq > 0) { maxSeq = marker.cutSeq; fromMarker = true; }
    } catch { /* no marker (legacy shard) — fall through to the journal scan */ }
    if (!fromMarker) {
      try {
        for (const line of readJsonlTolerant(join(sh.dir, 'journal.jsonl'))) {
          if (typeof line.seq === 'number' && line.seq > maxSeq) maxSeq = line.seq;
        }
      } catch (err) { reportSwallowed('v2-shard.cut-read', err); }
    }
    cuts.push({ partIndex: sh.partIndex, dir: sh.dir, cutSeq: maxSeq });
  }
  return cuts;
}

/**
 * Initial shard cursor for the "load earlier history" button on a cold load:
 * the seq just past the newest frozen shard's cut (i.e. the first seq the
 * ACTIVE dir owns), so the first shardBefore read lands on exactly that shard.
 * Shared by the /events and /api/local-log routes — identical contract.
 * Returns null when the session has no frozen shards (or its cut is unknown).
 */
export function initialShardCursor(sourceDir) {
  if (!sourceDir) return null;
  const cuts = readShardCuts(sourceDir);
  if (cuts.length === 0) return null;
  const newest = cuts[cuts.length - 1];
  if (!newest.cutSeq || newest.cutSeq <= 0) return null;
  // The session UUID lets the follow-latest view (no ?sid in scope) still
  // address the shardBefore read back to THIS session.
  let sid = null;
  try { sid = JSON.parse(readFileSync(join(sourceDir, 'meta.json'), 'utf-8')).sessionId || null; } catch {}
  return { hasMore: true, oldestSeq: newest.cutSeq + 1, partIndex: newest.partIndex + 1, prepend: false, sid };
}

/** Highest shard index already archived for a session (0 when none). A
 *  transient readdir failure must NOT be read as "no shards" — that would pick
 *  N=1 and overwrite an existing frozen shard. Non-ENOENT errors throw so the
 *  rotation aborts instead of clobbering history. */
function _maxShardIndex(sessionDir) {
  let max = 0;
  let entries;
  try {
    entries = readdirSync(shardPartsDir(sessionDir), { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0; // no parts/ yet
    throw err; // EMFILE/EACCES/EIO — abort, never risk overwriting a shard
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const n = Number(e.name);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/** Live files/dirs moved aside at a cut (everything EXCEPT the parts archive). */
const _SHARD_LIVE_ENTRIES = ['journal.jsonl', 'responses.jsonl', 'prompts.jsonl', 'conversations', 'blobs'];

/**
 * Rotate the live session dir: move its live files into `parts/<N>/` and
 * recreate the live skeleton, then rebind the session object. Callers MUST
 * guarantee a quiescent point (no in-flight request bound to this session and
 * the write queue idle) — see V2Writer._maybeRotate.
 *
 * The JOURNAL object is reused (only its _paths pointer flips) so `_seq`
 * continues monotonically across the cut — the reader folds by seq and must
 * never see a restart at 1. meta identity fields (sessionId/startTs/leader/
 * cwd/userIdRaw/userIdEncoding/instance + writer metaExtra) are carried over
 * from the pre-cut meta so the rebuilt live dir keeps the session's identity.
 *
 * @param {object} writer - V2Writer instance
 * @param {object} s - session object {paths, blobs, journal, convs, resolver, project, _identityId, _instanceKey}
 * @returns {boolean} true when a rotation happened
 */
export function rotateSessionDir(writer, s) {
  if (!s || !s.paths || !s.paths.dir) return false;
  const sessionDir = s.paths.dir;
  const n = _maxShardIndex(sessionDir) + 1;
  const partDir = shardPartDir(sessionDir, n);

  // Identity + carry-over fields come from the pre-cut meta (first-write-wins,
  // never changes for the life of the session). Read BEFORE the move.
  const frozenMeta = _readFrozenMeta(sessionDir);

  try {
    // Archive the live files into parts/<N>/. Each is a same-dir rename (atomic,
    // O(1)); the parts/ tree then holds the frozen shard as a self-contained
    // session dir. meta.json is COPIED (not moved) into the shard so the shard
    // keeps the session's identity (sessionId/project/leader/userIdRaw…) — a
    // shard without meta would replay with a wrong/degraded identity
    // (`_seqEpoch` = the part number, no user_id, teammate tag lost).
    // Claim the shard index EXCLUSIVELY: a non-recursive mkdir fails with EEXIST
    // if parts/<N>/ already exists, so a collision never overwrites a frozen
    // shard (the rename below would otherwise silently replace its journal).
    mkdirSync(shardPartsDir(sessionDir), { recursive: true }); // ensure parts/ parent
    mkdirSync(partDir); // EEXIST = collision → throw, abort the cut
    if (frozenMeta) {
      try { writeFileAtomicSync(join(partDir, 'meta.json'), JSON.stringify({ ...frozenMeta, pid: 0, frozen: true }, null, 2) + '\n'); }
      catch (err) { reportSwallowed('v2-shard.rotate-meta', err); }
    }
    // Persist the cut seq so readers (initial cursor, shard selection, restart
    // re-seeding) never re-parse the whole archived journal — one small file.
    // Written BEFORE the moves so a crash mid-archive leaves a shard that reads
    // as "cut at this seq"; the moves below are the source of truth for content.
    try { writeFileAtomicSync(join(partDir, 'cut.json'), JSON.stringify({ cutSeq: s.journal._seq }) + '\n'); }
    catch (err) { reportSwallowed('v2-shard.rotate-cut', err); }
    for (const name of _SHARD_LIVE_ENTRIES) {
      const src = join(sessionDir, name);
      try { renameSync(src, join(partDir, name)); }
      catch (err) {
        // A file that never existed (e.g. prompts.jsonl before its first write)
        // is fine to skip; anything else is reported and the move continues (the
        // shard is still valid — replay tolerates a missing optional file).
        if (err && err.code !== 'ENOENT') reportSwallowed('v2-shard.rotate-move', err, { name });
      }
    }
  } catch (err) {
    reportSwallowed('v2-shard.rotate-rename', err);
    return false;
  }

  try {
    const paths = ensureSessionDirSync(
      writer._logDir,
      s.project,
      (frozenMeta && frozenMeta.sessionId) || s._identityId || basename(sessionDir).replace(/^\d{14}_/, ''),
      {
        // Carry every identity/role field the readers key off. pid is the only
        // field that must be re-stamped to the current (live) process.
        ...(frozenMeta || {}),
        pid: process.pid,
        startTs: (frozenMeta && frozenMeta.startTs) || new Date().toISOString(),
        // The fresh shard starts its prompt count over; persist it so a
        // restart re-seeds from meta (not the archived, PROMPTS-capped
        // prompts.jsonl line count).
        shardPromptsActive: 0,
        ...(s._instanceKey && { instance: s._instanceKey }),
      },
      writer._sessionsDirName,
      basename(sessionDir),
    );
    s.paths = paths;
    // Persist the FROZEN shard's final prompt count into the live meta (the
    // frozen copy keeps its own). This is the restart re-seed source: the
    // archived prompts.jsonl is PROMPTS-capped and would under-count.
    try {
      const liveMeta = { ...(frozenMeta || {}), pid: process.pid, shardPromptsActive: s._partPrompts || 0, ...(s._instanceKey && { instance: s._instanceKey }) };
      writeFileAtomicSync(join(sessionDir, 'meta.json'), JSON.stringify(liveMeta, null, 2) + '\n');
    } catch (err) { reportSwallowed('v2-shard.rotate-livemeta', err); }
    s.blobs = new BlobStore(paths);
    // ConversationStore: REUSE the same object (only its _paths pointer flips to
    // the fresh skeleton). Rebuilding it empty would make the next request write
    // a `snapshot(first)` carrying the FULL pre-cut wire history — defeating the
    // shard's whole point (the active dir would never shrink; disk would grow
    // super-linearly with the shard count). Keeping count/fps/epoch lets the
    // first post-cut request write only its INCREMENT, exactly like a restart
    // continuation. The cut boundary still replays cleanly: the frozen shard's
    // own snapshot is its self-contained baseline, and the fresh shard continues
    // by appending deltas onto the (inherited) wire state.
    s.convs._paths = paths;
    // The reused store's per-conv dirEnsured flag pointed at the OLD (now
    // archived) dirs — reset it so the first post-cut write re-creates the conv
    // dir under the fresh skeleton (its content is carried by count/fps, so the
    // write itself is still an increment, not a snapshot).
    for (const st of s.convs._convs.values()) st.dirEnsured = false;
    // Journal: reuse the SAME object so _seq survives the cut; only its target
    // paths change. The reader folds by seq — a restart at 1 would collide with
    // every frozen-shard line.
    s.journal._paths = paths;
  } catch (err) {
    // The live files are archived under parts/<N>/ but the live skeleton could
    // not be recreated. Report loudly; the next ingest retries this branch.
    reportSwallowed('v2-shard.rotate-rebind', err);
    return false;
  }

  // Best-effort observation event — lets the live feed re-attach without
  // suppressing the fresh shard's history.
  try { writer._onShardRotated && writer._onShardRotated(partDir, s); } catch {}
  return true;
}

/** Read a session dir's meta.json (first-write-wins identity + role fields). */
function _readFrozenMeta(dir) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch { return null; }
}
