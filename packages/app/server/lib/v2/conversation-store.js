// Wire Format v2 — conversation event store (docs/refactor/WIRE_FORMAT_V2.md §6).
//
// The write side performs EXACTLY ONE cheap judgement — the prefix-extension
// test (same one v1's delta path does) — and stores wire events faithfully:
//   append   — wire messages prefix-extend the previous state → store the tail;
//   snapshot — anything else (v1 §3.1 plan-mode window, §3.2 K-tail overlap,
//              unexplained shrink, process restart) → store the FULL wire array
//              and let the READ-side materializer resolve it with the shared
//              reverse-anchor module. No merge logic ever runs at write time
//              (plan decision F6: a write-side merge mistake would be permanent).
//   ctl      — replace-tail (v1 §3.3 in-place replace) / compact continuation.
//
// /clear (shared predicate, §3.4) closes the epoch and opens e<N+1>;
// /compact (§3.5) stays in the SAME epoch with a ctl marker.
//
// Every stored line carries the initiating seq + rid (plan risk F8): physical
// append order is completion order, semantic order is seq.

import { readdirSync } from 'node:fs';
import { isPostClearCheckpoint, isCompactContinuation, normalizeMsgForEquality } from '../session-boundary.js';
import { fingerprintMsg } from '../interceptor-core.js';
import { ensureConvDirSync, convEpochPath, convDir } from './layout.js';

/** FNV-1a over a string — cheap full-content discriminator for exact mode. */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export class ConversationStore {
  /**
   * @param {object} paths - sessionPaths() object
   * @param {{appendTo: Function}} queue - AsyncWriteQueue (explicit-path API)
   * @param {{exactFps?: boolean}} [opts] - exact mode: judgement fingerprints
   *   additionally hash the FULL message JSON. The offline converter needs
   *   byte-grade faithfulness (its golden gate replays byte-identical wire);
   *   fingerprintMsg's 80-char first-block snip cannot distinguish wires that
   *   share a long prefix (real data 2026-07-14: sub prompts identical in the
   *   first 80 chars, differing later, judged "unchanged" → replay stuck on
   *   the first wire). The live request path keeps the cheap default.
   */
  constructor(paths, queue, opts = {}) {
    this._paths = paths;
    this._queue = queue;
    this._convs = new Map(); // convKey → { epoch, count, fps, dirEnsured }
    // Exact fps hash the NORMALIZED message (S4 decision 2026-07-14): the
    // client migrates cache_control breakpoints onto old messages (string →
    // block array), which is invisible to fingerprintMsg but flips the full
    // JSON hash — without normalization the converter degrades to a snapshot
    // per request on affected conversations (real-data storm, ~62% of corpus
    // bytes). Storage still records the wire verbatim; only the judgement
    // compares modulo cache_control/form.
    this._fpOf = opts.exactFps
      ? (m) => { const n = normalizeMsgForEquality(m); return `${fingerprintMsg(n)}:${fnv1a(JSON.stringify(n))}`; }
      : fingerprintMsg;
  }

  _state(convKey) {
    let st = this._convs.get(convKey);
    if (!st) {
      // fps: per-message judgement fingerprints of the CURRENT wire state.
      // Tail-only comparison proved insufficient on real data (2026-07-14):
      // interleaved same-sid streams (pre-flag proxy teammates, dual writers)
      // share prefixes/tails while differing in the middle — append/replace
      // judgements must verify the WHOLE prefix or replay produces a
      // franken-mix. Strings are ~90 chars × wire length: negligible memory.
      //
      // epoch is SEEDED from the epoch files already on disk (2026-07-15 fix):
      // a fresh store on an existing conv dir (process restart / `-c`
      // continuation onto the same session) must continue in the LATEST epoch.
      // Starting back at e0 appended newer seqs to an older file, breaking the
      // global "file order == seq order" the live reader relies on (the
      // journal seq already reseeds from disk; the epoch did not).
      st = { epoch: this._seedEpoch(convKey), count: 0, fps: [], dirEnsured: false, everWrote: false };
      this._convs.set(convKey, st);
    }
    return st;
  }

  /** Highest e<N>.jsonl already on disk for this conv (0 when none/unreadable). */
  _seedEpoch(convKey) {
    let max = 0;
    try {
      for (const f of readdirSync(convDir(this._paths, convKey))) {
        const m = f.match(/^e(\d+)\.jsonl$/);
        if (m) { const n = Number(m[1]); if (n > max) max = n; }
      }
    } catch { /* no conv dir yet — brand-new conversation */ }
    return max;
  }

  /** All fps[0..n) pairwise equal between the stored state and the incoming wire. */
  static _prefixEqual(prevFps, fpsIn, n) {
    for (let i = 0; i < n; i++) {
      if (prevFps[i] !== fpsIn[i]) return false;
    }
    return true;
  }

  /**
   * Ingest one request's wire messages for a conversation.
   * @param {string} convKey
   * @param {Array} messages - ORIGINAL wire messages (pre any v1 delta mutation)
   * @param {{seq:number, rid:string}} ids
   * @returns {{evt:'append'|'snapshot'|null, ctl:string|null, epoch:number,
   *            boundary:'clear'|'compact'|'replace-tail'|null,
   *            msgFrom:number, msgTo:number}}
   *   evt/ctl describe what was written (journal req line mirrors this, §4);
   *   msgFrom/msgTo are the [from,to) wire counts for integrity checks.
   */
  ingest(convKey, messages, ids) {
    const st = this._state(convKey);
    const msgs = Array.isArray(messages) ? messages : [];
    const len = msgs.length;
    // Judgement fingerprint = v1's fingerprintMsg, NOT the client-shared
    // messageFingerprint: fingerprintMsg is content-aware for tool_result
    // bodies (40-char snippet) where messageFingerprint keys tool_result on
    // tool_use_id ONLY. A same-id tool_result tail edit must be detected here
    // exactly like v1's Plan C does, or the two dual-write sides legitimately
    // diverge in a way the verify digest (built on messageFingerprint) is
    // structurally blind to (review P2).
    const fpsIn = msgs.map(this._fpOf);
    const prev = st.count;
    const prevFps = st.fps;

    let evt = null;
    let ctl = null;
    let boundary = null;
    const lines = [];

    // /clear has priority over every other judgement (spec §6). The predicate
    // wants the v1 entry shape; at write time this IS a full wire snapshot, so
    // a synthetic _isCheckpoint:true carrier is faithful.
    const isClear = prev > 0 && isPostClearCheckpoint({ _isCheckpoint: true, body: { messages: msgs } }, prev);
    if (isClear) {
      st.epoch += 1;
      st.count = 0;
      st.fps = [];
      boundary = 'clear';
      evt = 'snapshot';
      lines.push({ seq: ids.seq, rid: ids.rid, t: 'snapshot', msgs, reason: 'first' });
    } else if (len === prev && ConversationStore._prefixEqual(prevFps, fpsIn, len)) {
      // Unchanged wire state → no conversation event (journal still records req/done).
      evt = null;
    } else if (len === prev && prev > 0 && ConversationStore._prefixEqual(prevFps, fpsIn, len - 1)
               && prevFps[len - 1] !== '' && fpsIn[len - 1] !== '' && fpsIn[len - 1] !== prevFps[len - 1]) {
      // v1 §3.3 in-place last-message replace (same judgement family as the
      // interceptor's `_sameLenInPlaceReplace`, same fingerprintMsg formula) —
      // gated on FULL prefix equality: an equal-length but different wire array
      // (real data: pre-flag proxy teammates / dual writers interleaved into
      // one stream, §3.7 L104) must NOT be patched tail-only, or the replayed
      // state becomes a franken-mix. Any prefix mismatch falls through to the
      // snapshot branch (write-side never merges — snapshot is truth).
      evt = 'ctl';
      ctl = 'replace-tail';
      boundary = 'replace-tail';
      lines.push({ seq: ids.seq, rid: ids.rid, t: 'ctl', op: 'replace-tail', msg: msgs[len - 1] });
    } else if (len > prev && (prev === 0 || ConversationStore._prefixEqual(prevFps, fpsIn, prev))) {
      if (prev === 0 && st.count === 0 && !st.everWrote) {
        // First event of a FRESH STORE → snapshot(first), so every epoch file
        // is self-contained even when it starts mid-wire (teammate logs,
        // process restart onto an existing session dir). No epoch===0 guard:
        // a store seeded onto an existing epoch (restart continuation) must
        // snapshot too — falling through to `append` would write the full
        // wire as a tail onto the previous process's state (franken-mix).
        evt = 'snapshot';
        lines.push({ seq: ids.seq, rid: ids.rid, t: 'snapshot', msgs, reason: 'first' });
      } else {
        evt = 'append';
        lines.push({ seq: ids.seq, rid: ids.rid, t: 'append', msgs: msgs.slice(prev) });
      }
    } else {
      // Prefix test failed: §3.1 short window / §3.2 overlap / unexplained
      // shrink / restart-onto-existing-state. Store the full wire truth.
      const reason = prev === 0 ? 'first' : (len < prev ? 'shrunk' : 'tail-mismatch');
      evt = 'snapshot';
      lines.push({ seq: ids.seq, rid: ids.rid, t: 'snapshot', msgs, reason });
      if (isCompactContinuation({ body: { messages: msgs } })) {
        ctl = 'compact';
        boundary = 'compact';
        lines.push({ seq: ids.seq, rid: ids.rid, t: 'ctl', op: 'compact' });
      }
    }

    if (lines.length > 0) {
      if (!st.dirEnsured) {
        ensureConvDirSync(this._paths, convKey);
        st.dirEnsured = true;
      }
      const path = convEpochPath(this._paths, convKey, st.epoch);
      for (const line of lines) {
        this._queue.appendTo(path, JSON.stringify(line) + '\n');
      }
      st.everWrote = true;
    }

    // Advance state to this wire truth (eagerly, mirroring v1's eager-update
    // fix for <30ms bursts — the next request must compare against THIS one).
    st.count = len;
    st.fps = fpsIn;

    // [from,to) of the wire messages this event covers (spec §4):
    // snapshot ⇒ [0,len); append ⇒ [prev,len); replace-tail ⇒ [len-1,len);
    // no event ⇒ empty range at len.
    const msgFrom = evt === 'snapshot' ? 0 : (ctl === 'replace-tail' ? Math.max(0, len - 1) : (evt === 'append' ? prev : len));
    return { evt, ctl, epoch: st.epoch, boundary, msgFrom, msgTo: len };
  }

  /** Forget in-memory conversation states (workspace reset / resume hooks). */
  reset() {
    this._convs.clear();
  }
}
