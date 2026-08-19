// Wire Format v2 — S4 dual-write consistency verifier (plan gate methodology).
//
// Compares one v1 JSONL file against the v2 session dirs of the same project,
// per request, on WIRE TRUTH:
//   ① per-request wire-messages digest: v1 incremental delta reconstruction vs
//     v2 mechanical replay (this is trajectory-grade — every intermediate
//     state is compared, not just the cold final one);
//   ② per-request tools/system content hash: v1 inline value hashed with the
//     BlobStore formula vs the v2 journal's CAS ref (byte-equality by CAS);
//   ③ teammate entries verified the same per-request way (v1's leader file
//     holds them inline; v2 holds them in the teammate's own session dir —
//     matching is by `${ts}|${url}`, so no re-join ordering is needed here);
//   ④ inflight/error accounting: v1 keys that never completed vs v2
//     req-without-done;
//   ⑤ journal msgTo vs replayed length integrity (internal v2 consistency).
//
// v1-only requests are counted, not failed: history from before dual-write was
// enabled (or while it was toggled off) legitimately has no v2 twin.
//
// KNOWN LIMITATION (review): the ① digest is built on the client-shared
// messageFingerprint, which keys tool_result blocks on tool_use_id ONLY — a
// divergence confined to tool_result BODY content between v1 and v2 collides
// to identical digests and is invisible to this gate. The write side now uses
// the content-aware fingerprintMsg for its judgement (conversation-store.js),
// which removes the known producer of that divergence class; the residual risk
// is a v2 bug that corrupts tool_result content while preserving ids.

import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { iterateRawEntriesAsync } from '../log-stream.js';
import { createIncrementalReconstructor } from '../delta-reconstructor.js';
import { listSessionIds, readSession, indexSession, messagesDigest, blobRefOf } from './replay.js';

const MAX_REPORTED_DIFFS = 50;

/**
 * Verify one v1 file against its project's v2 sessions.
 * @param {string} v1File - absolute path to a v1 .jsonl (its dirname is the project dir)
 * @param {object} [opts]
 * @param {string} [opts.projectDir] - override project dir (defaults to dirname(v1File))
 * @param {string} [opts.sessionsDirName] - session-dir name under the project
 *   dir; the offline converter verifies its staging area ('sessions-migrating')
 *   before promoting. Defaults to the live 'sessions'.
 * @param {(p: {entriesScanned: number}) => void} [opts.onProgress] - called
 *   every 1000 scanned v1 entries and once after the scan completes, so a
 *   long-running verify of one big file can surface live progress. Callback
 *   errors are swallowed — progress must never break the verification.
 * @returns {Promise<object>} report (see shape at the bottom)
 */
export async function verifyV1File(v1File, opts = {}) {
  const projectDir = opts.projectDir || dirname(v1File);
  const sessionsDirName = opts.sessionsDirName || 'sessions';
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  // ---- v2 side: index every session of the project --------------------------
  // `${ts}|${url}` is NOT unique in real logs (same-millisecond countTokens
  // bursts, §3.6 rotation twins) — keep ALL records per key and match each v1
  // entry to its best unmatched candidate below (real-data finding 2026-07-14).
  const v2Index = new Map(); // key → rec[]
  const integrity = [];
  const v2Sessions = [];
  const unsupportedSessions = []; // reader version gate (spec §14): a session
  // this build can't read means the gate has a coverage hole — FAIL, don't skip.
  for (const sid of listSessionIds(projectDir, sessionsDirName)) {
    const session = readSession(projectDir, sid, sessionsDirName);
    // Report the session IDENTITY (UUID from meta), not the dir name — the dir
    // is `<ts>_<uuid>` post task C; falls back to the dir name on torn meta.
    v2Sessions.push((session.meta && session.meta.sessionId) || sid);
    if (session.unsupported) {
      unsupportedSessions.push({ sessionId: sid, wireFormat: session.wireFormat });
      continue;
    }
    const { index, integrity: viol } = indexSession(session);
    integrity.push(...viol);
    for (const [key, recs] of index) {
      const arr = v2Index.get(key);
      if (arr) arr.push(...recs); else v2Index.set(key, [...recs]);
    }
  }

  // ---- v1 side: stream, reconstruct incrementally, compare ------------------
  const reconstructor = createIncrementalReconstructor();
  const diffs = [];
  const inflightV1 = new Set();   // keys seen only as inProgress
  const counters = {
    v1Completed: 0, v1Skipped: 0, matched: 0, v1Only: 0, v1DuplicateKey: 0,
    heartbeatsV1: 0, countTokensV1: 0, teammateV1: 0, staleOrBroken: 0,
  };
  // Per-session suspicion tally, keyed by the v2 session dir name (the same
  // value `listSessionIds` / the converter's promote loop iterate). UNCAPPED —
  // unlike `diffs` (bounded by MAX_REPORTED_DIFFS for memory/reporting), this
  // must hold EVERY suspect session so the converter can quarantine the full
  // set; capping it would silently promote corrupt sessions past diff #50.
  const suspectSessions = new Map(); // sessionId → { count, reasons: string[] }
  const MAX_REASONS = 5;
  const flagSession = (sessionId, reason) => {
    if (!sessionId) return;
    let rec = suspectSessions.get(sessionId);
    if (!rec) suspectSessions.set(sessionId, rec = { count: 0, reasons: [] });
    rec.count++;
    if (rec.reasons.length < MAX_REASONS) rec.reasons.push(reason);
  };
  const addDiff = (d) => {
    flagSession(d.sessionId, `${d.type}@seq${d.seq}`);
    if (diffs.length < MAX_REPORTED_DIFFS) diffs.push(d);
  };

  const onScan = (raw) => {
    let entry;
    try { entry = JSON.parse(raw); } catch { return; }
    if (entry.ccvRotationContext) return;
    const key = `${entry.timestamp}|${entry.url}`;
    if (entry.inProgress) { inflightV1.add(key); return; }
    inflightV1.delete(key);

    // Incremental reconstruction restores the full wire messages for delta
    // entries (teammate/sub entries pass through untouched, already full).
    reconstructor.reconstruct(entry);
    if (entry._staleReorder || entry._reconstructBroken) { counters.staleOrBroken++; return; }
    counters.v1Completed++;
    if (entry.isHeartbeat) counters.heartbeatsV1++;
    if (entry.isCountTokens) counters.countTokensV1++;
    if (entry.teammate) counters.teammateV1++;

    const candidates = v2Index.get(key);
    if (!candidates) { counters.v1Only++; return; }
    const v1Digest = entry.body && Array.isArray(entry.body.messages) ? messagesDigest(entry.body.messages) : null;
    const unmatched = candidates.filter(c => !c._matched);
    if (unmatched.length === 0) {
      // Every v2 twin already consumed: this v1 line is a duplicate completed
      // write of the same request (§3.6 rotation race) — count, don't fail.
      counters.v1DuplicateKey++;
      return;
    }
    // Best candidate: digest-equal first (same-key bursts carry different
    // payloads — pairing by content avoids cross-matching twins), else FIFO.
    const v2 = (v1Digest && unmatched.find(c => c.digest === v1Digest)) || unmatched[0];
    counters.matched++;
    v2._matched = true;

    // ① wire-messages digest (skip heartbeats — no conversation on either side)
    if (v2.conv && v1Digest != null) {
      if (v1Digest !== v2.digest) {
        addDiff({ type: 'messages-digest', sessionId: v2.sessionId, key, seq: v2.seq, conv: v2.conv, v1: v1Digest, v2: v2.digest, v1Len: entry.body.messages.length, v2Len: v2.len });
      }
    }
    // ② tools/system CAS equality
    const v1Tools = blobRefOf(entry.body && entry.body.tools);
    const v1Sys = blobRefOf(entry.body && entry.body.system);
    if (v1Tools !== v2.toolsRef) addDiff({ type: 'tools-ref', sessionId: v2.sessionId, key, seq: v2.seq, v1: v1Tools, v2: v2.toolsRef });
    if (v1Sys !== v2.sysRef) addDiff({ type: 'system-ref', sessionId: v2.sessionId, key, seq: v2.seq, v1: v1Sys, v2: v2.sysRef });
    // ③ teammate attribution
    if (!!entry.teammate !== (v2.kind === 'teammate')) {
      addDiff({ type: 'teammate-kind', sessionId: v2.sessionId, key, seq: v2.seq, v1: !!entry.teammate, v2: v2.kind });
    }
    // ④ completion accounting
    if (!v2.done) addDiff({ type: 'missing-done', sessionId: v2.sessionId, key, seq: v2.seq });
  };

  // Single streaming pass (1MB chunks): verify must stay memory-bounded on
  // 300MB soak files — no dedup map, no second pass (review P2).
  let entriesScanned = 0;
  for await (const raw of iterateRawEntriesAsync(v1File)) {
    onScan(raw);
    entriesScanned++;
    if (onProgress && entriesScanned % 1000 === 0) {
      try { onProgress({ entriesScanned }); } catch { /* progress must never break the verify */ }
    }
  }
  if (onProgress) {
    try { onProgress({ entriesScanned }); } catch { /* progress must never break the verify */ }
  }

  // v2 records never matched by any v1 entry in THIS file: only suspicious if
  // their req/done both exist (a live v2-only write) — they may simply belong
  // to another v1 segment (rotation), so count, don't fail.
  let v2Unmatched = 0;
  const v2ReqWithoutDone = [];
  for (const [key, recs] of v2Index) {
    for (const rec of recs) {
      if (!rec._matched) v2Unmatched++;
      if (!rec.done) v2ReqWithoutDone.push(key);
    }
  }

  // Integrity violations and unsupported-wire sessions are collected during the
  // v2-side indexing pass above (before `flagSession` exists), so fold them into
  // the per-session tally here — they condemn a session just as a diff does.
  for (const v of integrity) flagSession(v.sessionId, `integrity@seq${v.seq}`);
  for (const u of unsupportedSessions) flagSession(u.sessionId, `unsupported:${u.wireFormat}`);

  const fileSize = (() => { try { return statSync(v1File).size; } catch { return 0; } })();
  const report = {
    v1File,
    projectDir,
    fileSize,
    v2Sessions,
    counters: { ...counters, v2Requests: v2Index.size, v2Unmatched, v1InflightOnly: inflightV1.size, v2ReqWithoutDone: v2ReqWithoutDone.length },
    diffs,
    integrity,
    unsupportedSessions,
    // Complete (uncapped) set of suspect sessions for the converter to quarantine.
    suspectSessions: [...suspectSessions.entries()].map(([sessionId, r]) => ({ sessionId, count: r.count, reasons: r.reasons })),
    ok: diffs.length === 0 && integrity.length === 0 && unsupportedSessions.length === 0,
  };
  return report;
}

/** Human-readable one-screen rendering for the CLI. */
export function renderReport(report) {
  const c = report.counters;
  const lines = [];
  lines.push(`wire-v2 verify — ${report.v1File}`);
  lines.push(`  project: ${report.projectDir}`);
  lines.push(`  v2 sessions scanned: ${report.v2Sessions.length}, v2 requests indexed: ${c.v2Requests}`);
  lines.push(`  v1 completed: ${c.v1Completed} (heartbeat ${c.heartbeatsV1}, countTokens ${c.countTokensV1}, teammate ${c.teammateV1}, stale/broken skipped ${c.staleOrBroken})`);
  lines.push(`  matched: ${c.matched}   v1-only (no v2 twin — pre-dual-write history): ${c.v1Only}   v1-duplicate-key (rotation twins): ${c.v1DuplicateKey || 0}   v2-unmatched (other segments): ${c.v2Unmatched}`);
  lines.push(`  inflight: v1-only ${c.v1InflightOnly}, v2 req-without-done ${c.v2ReqWithoutDone}`);
  if (report.unsupportedSessions && report.unsupportedSessions.length > 0) {
    lines.push(`  UNSUPPORTED WIRE FORMAT (reader version gate): ${report.unsupportedSessions.length}`);
    for (const u of report.unsupportedSessions.slice(0, 10)) lines.push(`    ${u.sessionId} wireFormat=${u.wireFormat}`);
  }
  if (report.integrity.length > 0) {
    lines.push(`  INTEGRITY VIOLATIONS (journal msgTo vs replay): ${report.integrity.length}`);
    for (const v of report.integrity.slice(0, 10)) lines.push(`    ${v.sessionId} seq=${v.seq} conv=${v.conv} msgTo=${v.msgTo} replayed=${v.replayedLen}`);
  }
  if (report.diffs.length > 0) {
    lines.push(`  DIFFS: ${report.diffs.length}${report.diffs.length >= 50 ? '+ (capped)' : ''}`);
    for (const d of report.diffs.slice(0, 10)) lines.push(`    [${d.type}] seq=${d.seq} ${d.key}\n      v1=${JSON.stringify(d.v1)} v2=${JSON.stringify(d.v2)}`);
  }
  lines.push(report.ok ? '  RESULT: OK — zero diffs' : '  RESULT: FAILED');
  return lines.join('\n');
}
