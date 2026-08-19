// Wire Format v2 — session-dir readers + MECHANICAL wire replay.
//
// Replay here is deliberately interpretation-free: conversation events are
// applied exactly as the write side derived them from wire state
// (snapshot → replace state; append → concat; ctl replace-tail → swap last;
// ctl compact → no-op, the surrounding snapshot already carries the state).
// This reproduces the EXACT wire messages of every request — byte-equal to
// what v1's delta reconstruction yields for the same request — without any
// reverse-anchor/session semantics (those belong to the S5 materializer,
// which presents conversations; verify only needs wire truth).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { messageFingerprint, normalizeMsgForEquality } from '../session-boundary.js';
import { isSupportedWireFormat } from './layout.js';
import { iterateJsonlLines } from './jsonl-read.js';

/** Parse a JSONL file tolerating a truncated tail line (spec §14). Streams
 *  line-by-line (issue #129): a file past Node's ~512MiB string cap must not
 *  throw ERR_STRING_TOO_LONG out of the whole read path. */
export function readJsonlTolerant(path) {
  const out = [];
  for (const t of iterateJsonlLines(path)) {
    try { out.push(JSON.parse(t)); } catch { /* truncated tail — drop */ }
  }
  return out;
}

/** List session ids under LOG_DIR/<project>/sessions/ (or a staging sibling
 *  when the offline converter passes `sessionsDirName`). */
export function listSessionIds(projectDir, sessionsDirName = 'sessions') {
  const root = join(projectDir, sessionsDirName);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
}

/**
 * Read one session dir into a folded structure:
 * { sessionId, meta, wireFormat, reqs: Map<seq, reqLine>,
 *   dones: Map<seq, doneLine>, convEvents: Map<convKey, event[] (sorted by seq)> }
 *
 * Reader version gate (spec §14): the version is taken from meta.json and the
 * journal sentinel (`ph:'meta'` first line). A session stamped with a version
 * this build doesn't understand returns `unsupported: true` with EMPTY folds —
 * callers must refuse it loudly instead of interpreting bytes they can't parse.
 * A missing version (torn creation) is treated as the current one.
 */
export function readSession(projectDir, sessionId, sessionsDirName = 'sessions') {
  const dir = join(projectDir, sessionsDirName, sessionId);
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')); } catch { }
  let wireFormat = meta && typeof meta.wireFormat === 'number' ? meta.wireFormat : null;
  const unsupportedOf = (v) => ({
    sessionId, dir, meta, wireFormat: v, unsupported: true,
    reqs: new Map(), dones: new Map(), convEvents: new Map(),
  });
  if (!isSupportedWireFormat(wireFormat)) return unsupportedOf(wireFormat);
  const reqs = new Map();
  const dones = new Map();
  for (const line of readJsonlTolerant(join(dir, 'journal.jsonl'))) {
    if (line.ph === 'req') reqs.set(line.seq, line);
    else if (line.ph === 'done' && !dones.has(line.seq)) dones.set(line.seq, line);
    else if (line.ph === 'meta' && typeof line.wireFormat === 'number') {
      // Journal sentinel wins over meta.json (per-file self-description).
      wireFormat = line.wireFormat;
      if (!isSupportedWireFormat(wireFormat)) return unsupportedOf(wireFormat);
    }
  }
  const convEvents = new Map();
  const convRoot = join(dir, 'conversations');
  if (existsSync(convRoot)) {
    for (const entry of readdirSync(convRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const events = [];
      for (const f of readdirSync(join(convRoot, entry.name))) {
        if (!/^e\d+\.jsonl$/.test(f)) continue;
        events.push(...readJsonlTolerant(join(convRoot, entry.name, f)));
      }
      events.sort((a, b) => a.seq - b.seq);
      convEvents.set(entry.name, events);
    }
  }
  return { sessionId, dir, meta, wireFormat, reqs, dones, convEvents };
}

/** Digest of a messages array: sha256 over the per-message fingerprint list.
 *  Shared formula between the v1 and v2 sides of verify. Messages are
 *  normalized first (S4 decision 2026-07-14): the client's cache_control
 *  breakpoint migration rewrites OLD messages (string → block array with
 *  cache_control) — v1 delta cannot express that mutation, so without
 *  normalization every real active day fails the soak gate on false
 *  positives (plan S4 table, 2026-07-13 row). */
export function messagesDigest(messages) {
  const h = createHash('sha256');
  for (const m of messages) h.update(messageFingerprint(normalizeMsgForEquality(m)) + '\n');
  return h.digest('hex').slice(0, 16);
}

/** Same content-hash formula as BlobStore.put — lets verify compare v1 inline
 *  tools/system against v2 blob refs WITHOUT reading blob files.
 *  KEEP IN SYNC: server/lib/v2/blob-store.js `put` is the writing twin of this
 *  formula; any change to hash/slice/serialization must land in both. */
export function blobRefOf(value) {
  if (value === undefined || value === null) return null;
  return 'sha256-' + createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

/**
 * Mechanically replay one conversation's events, yielding the wire state
 * digest after each event: Map<seq, {digest, len}>. Also returns integrity
 * violations against the journal's msgTo counts (checked by the caller,
 * which owns the journal).
 */
export function replayConversation(events) {
  let state = [];
  const bySeq = new Map();
  for (const ev of events) {
    if (ev.t === 'snapshot') {
      state = Array.isArray(ev.msgs) ? ev.msgs : [];
    } else if (ev.t === 'append') {
      if (Array.isArray(ev.msgs) && ev.msgs.length > 0) state = state.concat(ev.msgs);
    } else if (ev.t === 'ctl') {
      if (ev.op === 'replace-tail' && ev.msg && state.length > 0) {
        state = state.slice(0, -1).concat([ev.msg]);
      }
      // 'compact' is a marker for the materializer; wire state came via the
      // snapshot event of the same request.
    }
    bySeq.set(ev.seq, { digest: messagesDigest(state), len: state.length });
  }
  return bySeq;
}

/**
 * Build the per-request wire index of one session:
 * Map<`${ts}|${url}`, Array<{seq, kind, conv, epoch, digest, len, toolsRef,
 *                            sysRef, done, status, msgTo}>>
 * — an ARRAY per key: `${ts}|${url}` is not unique in real logs (same-ms
 * countTokens bursts), and collapsing twins loses their done lines/digests
 * (real-data finding 2026-07-14). Also returns integrity violations
 * (journal msgTo vs replayed length).
 */
export function indexSession(session) {
  const replayed = new Map(); // convKey → Map<seq, {digest, len}>
  for (const [convKey, events] of session.convEvents) replayed.set(convKey, replayConversation(events));

  const index = new Map();
  const integrity = [];
  // Walk reqs in seq order; for reqs without a conv event (unchanged wire),
  // carry the conv's latest replayed state at or before that seq.
  const lastStateOf = new Map(); // convKey → {digest, len}
  const seqs = [...session.reqs.keys()].sort((a, b) => a - b);
  for (const seq of seqs) {
    const req = session.reqs.get(seq);
    const done = session.dones.get(seq) || null;
    let digest = null;
    let len = null;
    if (req.conv) {
      const conv = replayed.get(req.conv);
      const hit = conv && conv.get(seq);
      if (hit) {
        lastStateOf.set(req.conv, hit);
        digest = hit.digest; len = hit.len;
      } else {
        const carried = lastStateOf.get(req.conv);
        if (carried) { digest = carried.digest; len = carried.len; }
      }
      if (typeof req.msgTo === 'number' && len != null && req.msgTo !== len) {
        integrity.push({ sessionId: session.sessionId, seq, conv: req.conv, msgTo: req.msgTo, replayedLen: len });
      }
    }
    const key = `${req.ts}|${req.url}`;
    const rec = {
      sessionId: session.sessionId,
      seq,
      kind: req.kind,
      conv: req.conv || null,
      epoch: req.epoch,
      digest,
      len,
      toolsRef: (req.blobs && req.blobs.tools) || null,
      sysRef: (req.blobs && req.blobs.sys) || null,
      done: !!done,
      status: done ? done.status : null,
    };
    const arr = index.get(key);
    if (arr) arr.push(rec); else index.set(key, [rec]);
  }
  return { index, integrity };
}
