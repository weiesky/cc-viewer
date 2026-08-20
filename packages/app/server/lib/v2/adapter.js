// Wire Format v2 — v2→v1 adapter read layer (docs/refactor/WIRE_FORMAT_V2.md §11).
//
// Synthesizes a v1-shape raw-entry stream from a v2 session directory so the
// existing log-stream consumers (SSE cold load, tail read, paging, download)
// work unchanged. The synthesis is MECHANICAL replay (same semantics as
// replay.js): conversation events are applied exactly as the write side derived
// them; no reverse-anchor/merge inference happens here — the client applies its
// own sessionMerge to the synthesized stream exactly like it does to v1 logs.
//
// Envelope equivalence to v1 (per request, main conversation):
//   snapshot event        → checkpoint (_isCheckpoint:true, full state)
//   ctl replace-tail      → checkpoint + _inPlaceReplaceDetected (paired signal)
//   append event          → delta (_isCheckpoint:false, the appended slice)
//   no event (wire unchanged) → empty delta (v1 wrote those too)
// Entries are yielded in journal seq order (initiation order), so the client's
// completion-order guard never fires: _staleReorder/_reconstructBroken are
// structurally impossible on this stream (spec §11 "绝不输出").
//
// SINGLE SYNTHESIS PATH (S6b): SessionSynthesizer below is the one and only
// implementation of the per-event envelope synthesis. The cold generators feed
// it eagerly (all lines up front, defer disabled); the live feed
// (server/lib/v2/live-feed.js) feeds it incrementally from file cursors, so
// cold reads and live emission are byte-identical by construction.
//
// Teammate re-join (spec §10): reading a leader session merges in every sibling
// session whose meta.leader.parentSessionId points at it, ordered by ts with
// (sessionId, seq) tie-break — field-equivalent to v1's "teammate writes the
// leader's file".

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { reportSwallowed } from '@ccv/core/error-report';
import { isMainAgentRequest } from '../interceptor-core.js';
import { readSession } from './replay.js';
import { iterateJsonlLines } from './jsonl-read.js';
import { isDiscardableSession } from './session-select.js';
import { LIVE_SESSION_MTIME_MS } from '../log-file-utils.js';
import { blobPath, isSupportedWireFormat } from './layout.js';
import { SingleFlight } from './singleflight.js';
import { listV2Sessions } from './session-list.js';

// Same stamping rules as the v1 interceptor (KEEP IN SYNC: server/interceptor.js
// requestEntry construction) — recomputed from the journal's url, not from kind,
// so edge cases (a countTokens body that also looks main-agent) fold the same way.
const HEARTBEAT_URL_RE = /\/api\/eval\/sdk-/;
const COUNT_TOKENS_URL_RE = /\/messages\/count_tokens/;

/** A v2 read source is a session DIRECTORY containing a journal.jsonl. */
export function isV2SessionDir(p) {
  if (typeof p !== 'string' || p === '') return false;
  try {
    if (!statSync(p).isDirectory()) return false;
  } catch {
    return false;
  }
  return existsSync(join(p, 'journal.jsonl'));
}

/** responses.jsonl folded by seq (first line wins, mirroring §14 done-folding).
 *  Values stay RAW strings — parsed one at a time at yield to keep peak memory
 *  at "one response", not "all responses" (plan F16). */
function readResponsesRaw(sessionDir) {
  const bySeq = new Map();
  const p = join(sessionDir, 'responses.jsonl');
  try {
    // streamed line-by-line (issue #129): responses.jsonl is the most likely
    // file to outgrow Node's string cap (full response bodies, one per request)
    for (const t of iterateJsonlLines(p)) {
      const m = t.match(/"seq":\s*(\d+)/);
      if (!m) continue;
      const seq = Number(m[1]);
      if (!bySeq.has(seq)) bySeq.set(seq, t);
    }
  } catch (err) {
    reportSwallowed('v2-read.responses-read-failed', err);
  }
  return bySeq;
}

/** Parsed-blob cache, one per synthesizer: refs repeat across most requests
 *  (that is the whole point of the CAS), so each distinct blob is read+parsed
 *  once. Objects are shared by reference — safe, entries are stringified
 *  immediately and never mutated. */
function makeBlobLoader(paths, sessionId) {
  const cache = new Map();
  return (ref) => {
    if (!ref) return undefined;
    if (cache.has(ref)) return cache.get(ref);
    let value;
    try {
      value = JSON.parse(readFileSync(blobPath(paths, ref), 'utf-8'));
    } catch (err) {
      // Orphan journal reference (spec §14): tolerate, surface, keep reading.
      reportSwallowed('v2-read.blob-missing', new Error(`${sessionId}/${ref}: ${err.message}`));
      value = undefined;
    }
    cache.set(ref, value);
    return value;
  };
}

/** Whether an applied event set makes its request a v1 CHECKPOINT (vs a delta):
 *  an applied snapshot or a ctl replace-tail is present; an append-only or
 *  wire-unchanged (empty) event set is a delta. Single predicate shared by the
 *  descriptor Pass A and the full envelope branch in _emit so they cannot drift
 *  (KEEP the envelope's `_isCheckpoint` assignment routed through this). */
function appliedIsCheckpoint(applied) {
  return applied.some((e) => e.t === 'snapshot' || (e.t === 'ctl' && e.op === 'replace-tail'));
}

/**
 * Incremental per-event synthesis engine — the single synthesis path shared by
 * the cold generators and the live feed.
 *
 * Feeding contract (mirrors the writer's per-file append order, which is
 * seq-ascending for journal req lines and file order for conversation event
 * lines):
 *   ingestJournalLine(parsedLine)   — 'meta' | 'req' | 'done' phases
 *   ingestConvLine(convKey, event)  — conversation event lines, file order
 *   ingestResponseLine(rawLine)     — responses.jsonl lines (raw strings)
 * Synthesized items accumulate internally; callers collect them via drain().
 *
 * Item shape (full synthesis): { ts, sessionId, seq, phase:
 *               'placeholder'|'completed', entry, isMain, stateRef }
 * `entry` is the v1-shape object (stringify on receipt: a live placeholder's
 * entry object is MUTATED in place into its completed form when the done
 * arrives, exactly so both stringify byte-identical to a cold read).
 * `stateRef` is the conversation state array as of this seq (immutably
 * replaced by the replay, so the reference stays valid) — used by the window
 * mode to synthesize a baseline checkpoint at an arbitrary start seq.
 * Descriptor mode (S10a Pass A, opts.descriptorOnly) instead emits the light
 * shape { ts, sessionId, seq, url, isMain, isMainDelta } — no entry/stateRef.
 *
 * Live-mode ordering hazards handled here (S6b review):
 * - A journal req line can land before its own conversation event line
 *   (write-order window, spec §14). Cold reads retry for free on the next full
 *   read; an incremental cursor has already consumed the journal line, so the
 *   request is parked per-conversation and retried when the event arrives.
 *   deferMs=0 (cold) degrades to the historical skip-immediately behavior.
 * - A done line can land before its responses.jsonl line (cross-path queue
 *   groups). Every completion writes a responses line, so the done is parked
 *   until the line arrives, with a deadline fallback to a null response.
 * - Orphan safety: journal req lines are strictly seq-ascending within one
 *   journal file, so at the time req N is processed every req ≤ N that will
 *   ever exist is known — the crash-orphan check is exact even incrementally.
 */
export class SessionSynthesizer {
  /**
   * @param {string} sessionDir - absolute session directory
   * @param {object} [opts]
   * @param {object|null} [opts.teammateOf] - meta.leader of this session when
   *   it is being re-joined into (or read as) a teammate stream
   * @param {number} [opts.deferMs] - how long live mode parks a request whose
   *   conversation event (or a done whose response line) has not landed yet.
   *   0 = cold semantics: skip immediately, next full read self-heals.
   * @param {Function} [opts.now] - clock injection (tests)
   * @param {boolean} [opts.descriptorOnly] - S10a window Pass A: emit light
   *   descriptors ({ts,sessionId,seq,url,isMain,isMainDelta}) under the SAME
   *   pump/gate/replay semantics, skipping blob backfill / message assembly /
   *   entry construction. Membership decisions (crash-orphan skips, msgTo
   *   gates) are replay-dependent, so a journal-only scan would diverge.
   * @param {(sessionId:string, seq:number)=>boolean} [opts.materialize]
   *   S10a window Pass B: predicate deciding whether a request is synthesized
   *   at all. Falsy → state still advances (in _pumpConv) but no entry is
   *   built or retained. Baseline promotion happens on the CONSUMER side over
   *   item.stateRef, so the ring keeps the un-promoted raw (onScan parity).
   */
  constructor(sessionDir, opts = {}) {
    this.sessionDir = sessionDir;
    this.projectDir = dirname(dirname(sessionDir));
    this._deferMs = typeof opts.deferMs === 'number' ? opts.deferMs : 0;
    this._now = opts.now || Date.now;
    this._descriptorOnly = !!opts.descriptorOnly;
    this._materialize = typeof opts.materialize === 'function' ? opts.materialize : null;
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8')); } catch { /* tolerated — journal is self-describing */ }
    this._meta = meta || {};
    // Task C: session IDENTITY = meta.sessionId (the UUID), NOT the dir basename
    // (which is now `<ts>_<uuid>`). This feeds _seqEpoch, k-way tie-break and
    // item dedup — all of which must stay stable across the dir rename and match
    // the wire UUID (teammate parentSessionId). basename is a path token only.
    // Fallback to basename on a torn/missing meta (self-consistent within a load).
    this.sessionId = (meta && meta.sessionId) || basename(sessionDir);
    this._leader = opts.teammateOf || this._meta.leader || null;
    this._loadBlob = makeBlobLoader({ blobsDir: join(sessionDir, 'blobs') }, this.sessionId);
    this.unsupported = false;
    // Liveness gate — KEEP IN SYNC with log-management.js deleteLogFiles
    // (same pid(0)-probe + EPERM + LIVE_SESSION_MTIME_MS mtime triple; the
    // constant is imported here so only the ordering can drift). Cold reads
    // finalize crash orphans as completed deltas ONLY when the session is dead.
    // A live writer may still emit an orphan's done later — its completed twin
    // would then be replayed by the client's seq guard as stale (_staleReorder)
    // and the tail of the chat would vanish (cold-read + live-feed race).
    this._sessionLive = false;
    try {
      const meta = this._meta;
      if (meta && typeof meta.pid === 'number' && meta.pid !== process.pid) {
        try { process.kill(meta.pid, 0); this._sessionLive = true; } catch (err) {
          // EPERM = the pid exists under another user — that IS live.
          if (err && err.code === 'EPERM') this._sessionLive = true;
        }
      }
    } catch { /* unreadable meta — fall through to the mtime guard */ }
    if (!this._sessionLive) {
      try {
        const jStat = statSync(join(sessionDir, 'journal.jsonl'));
        if (this._now() - jStat.mtimeMs < LIVE_SESSION_MTIME_MS) this._sessionLive = true;
      } catch { /* no journal — nothing fresh to protect */ }
    }
    if (meta && meta.wireFormat != null && !isSupportedWireFormat(meta.wireFormat)) {
      this._markUnsupported(meta.wireFormat);
    }
    this._reqs = new Map();      // seq → journal req line
    this._dones = new Map();     // seq → journal done line (first wins, §14)
    this._responses = new Map(); // seq → raw responses.jsonl line (first wins)
    this._convs = new Map();     // convKey → {events, ptr, state, queue, deferSince}
    this._await = new Map();     // seq → item built, waiting for its done
    this._doneWaitingResp = new Map(); // seq → parkedAtMs (done before responses line)
    this._out = [];
  }

  _markUnsupported(v) {
    if (this.unsupported) return;
    // Reader version gate (spec §14): never interpret a session stamped with a
    // version this build doesn't understand — refuse loudly, emit nothing.
    this.unsupported = true;
    reportSwallowed('v2-read.unsupported-wire-format', new Error(`${this.sessionId}: wireFormat=${v}`));
  }

  _conv(key) {
    let c = this._convs.get(key);
    if (!c) {
      c = { events: [], ptr: 0, state: [], queue: [], deferSince: null };
      this._convs.set(key, c);
    }
    return c;
  }

  /** Feed one parsed journal line ('meta' sentinel, 'req', or 'done'). */
  ingestJournalLine(line) {
    if (this.unsupported || !line || typeof line !== 'object') return;
    if (line.ph === 'meta') {
      if (typeof line.wireFormat === 'number' && !isSupportedWireFormat(line.wireFormat)) {
        this._markUnsupported(line.wireFormat);
      }
      return;
    }
    if (line.ph === 'req') {
      if (this._reqs.has(line.seq)) return;
      this._reqs.set(line.seq, line);
      if (line.conv) {
        const c = this._conv(line.conv);
        c.queue.push(line.seq);
        this._pumpConv(line.conv, c);
      } else {
        // Conversation-less request (heartbeat): nothing to gate on.
        this._emit(line, null, []);
      }
      return;
    }
    if (line.ph === 'done') {
      if (this._dones.has(line.seq)) return; // fold duplicate done lines (§14)
      this._dones.set(line.seq, line);
      this._tryComplete(line.seq);
    }
  }

  /** Feed one conversation event line. Events are kept SEQ-SORTED on insert:
   *  file order across epoch files is NOT globally seq-ordered (a restarted
   *  writer historically appended newer seqs into an older epoch file, and the
   *  cold reader has always sorted globally — replay.js). The monotonic pump
   *  pointer requires the sorted invariant or a late-lower-seq event strands
   *  behind it forever (2026-07-15 fix: live missing-conv-event /
   *  state-count-mismatch false alarms). In-order arrival stays O(1). */
  ingestConvLine(convKey, ev) {
    if (this.unsupported || !ev || typeof ev !== 'object') return;
    const c = this._conv(convKey);
    const events = c.events;
    if (events.length === 0 || ev.seq >= events[events.length - 1].seq) {
      events.push(ev);
    } else {
      let i = events.length - 1;
      while (i >= c.ptr && events[i].seq > ev.seq) i--;
      events.splice(i + 1, 0, ev);
    }
    this._pumpConv(convKey, c);
  }

  /** Feed one raw responses.jsonl line. */
  ingestResponseLine(rawLine) {
    if (this.unsupported) return;
    const t = String(rawLine).trim();
    const m = t.match(/"seq":\s*(\d+)/);
    if (!m) return;
    const seq = Number(m[1]);
    if (!this._responses.has(seq)) this._responses.set(seq, t);
    if (this._doneWaitingResp.has(seq)) {
      this._doneWaitingResp.delete(seq);
      this._complete(seq);
    }
  }

  /** Collect synthesized items accumulated since the last drain. */
  drain() {
    if (this._out.length === 0) return [];
    const out = this._out;
    this._out = [];
    return out;
  }

  /** True when a deferred request or done is parked (live watcher uses this to
   *  keep its safety poll armed). */
  hasPending() {
    if (this._doneWaitingResp.size > 0) return true;
    for (const c of this._convs.values()) if (c.deferSince != null) return true;
    return false;
  }

  /** Live mode: force progress past deferrals older than deferMs. */
  sweepDeadlines() {
    const now = this._now();
    for (const [key, c] of this._convs) {
      if (c.deferSince != null && now - c.deferSince >= this._deferMs) {
        this._pumpConv(key, c, { forceHead: true });
      }
    }
    for (const [seq, parkedAt] of [...this._doneWaitingResp]) {
      if (now - parkedAt >= this._deferMs) {
        this._doneWaitingResp.delete(seq);
        this._complete(seq);
      }
    }
  }

  /** Process this conversation's request queue as far as the arrived events
   *  allow. forceHead skips the (expired) head request cold-style. */
  _pumpConv(convKey, c, { forceHead = false } = {}) {
    while (c.queue.length > 0) {
      const seq = c.queue[0];
      const req = this._reqs.get(seq);
      // Apply this conversation's events up to and including this seq.
      const applied = [];
      while (c.ptr < c.events.length && c.events[c.ptr].seq <= seq) {
        const ev = c.events[c.ptr++];
        if (!this._reqs.has(ev.seq)) continue; // crash orphan (spec §14)
        if (ev.t === 'snapshot') {
          c.state = Array.isArray(ev.msgs) ? ev.msgs : [];
        } else if (ev.t === 'append') {
          if (Array.isArray(ev.msgs) && ev.msgs.length > 0) c.state = c.state.concat(ev.msgs);
        } else if (ev.t === 'ctl' && ev.op === 'replace-tail' && ev.msg && c.state.length > 0) {
          c.state = c.state.slice(0, -1).concat([ev.msg]);
        } // ctl compact: marker only — the same request's snapshot carries the state
        if (ev.seq === seq) applied.push(ev);
      }

      // Gate: journal says a conversation event exists but the line is not on
      // disk yet (write-order window, §14 pendingTail) or is lost. Emitting a
      // delta against a state missing that slice would poison the client's
      // reconstruction — park (live) or skip (cold/expired); a skip is safe
      // because the next cold read retries with the line present.
      let gap = null;
      if (req.evt && applied.length === 0) {
        gap = () => reportSwallowed('v2-read.missing-conv-event', new Error(`${this.sessionId}/${req.conv} seq=${seq} evt=${req.evt}`));
      } else if (!req.evt && typeof req.msgTo === 'number' && req.msgTo !== c.state.length) {
        // No-event request whose recorded wire count disagrees with the
        // replayed state — an earlier line of this conv is missing.
        gap = () => reportSwallowed('v2-read.state-count-mismatch', new Error(`${this.sessionId}/${req.conv} seq=${seq} msgTo=${req.msgTo} replayed=${c.state.length}`));
      }
      if (gap) {
        if (this._deferMs > 0 && !forceHead) {
          if (c.deferSince == null) c.deferSince = this._now();
          return; // parked — a later ingest or sweepDeadlines resumes the pump
        }
        gap();
        c.queue.shift();
        c.deferSince = null;
        forceHead = false;
        continue;
      }

      c.deferSince = null;
      c.queue.shift();
      forceHead = false;
      this._emit(req, c, applied);
    }
    // Live-mode memory bound (review P2): applied events are never re-read —
    // drop the consumed prefix so a long session doesn't keep every slice
    // resident. Thresholded so the cold path's per-req pumping doesn't turn
    // this into an O(n²) shift storm. (State arrays are shared immutably;
    // this only trims the event-line objects.)
    if (c.ptr > 64 && c.queue.length === 0) {
      c.events.splice(0, c.ptr);
      c.ptr = 0;
    }
  }

  /** Build the v1-shape entry for one request and emit it (placeholder now /
   *  completed when the done is already known). */
  _emit(req, conv, applied) {
    const seq = req.seq;
    const meta = this._meta;
    const leader = this._leader;
    const isTeammate = !!leader;
    const isMain = req.kind === 'main' && !isTeammate;
    // Single source for the checkpoint/delta decision — consumed by BOTH the
    // descriptor Pass A (below) and the full envelope branch, so the two can
    // never drift (adding a checkpoint-triggering event type updates one place).
    const isCheckpoint = appliedIsCheckpoint(applied);

    // ---- S10a window passes ------------------------------------------------
    // Pass A (descriptor): same gates/replay as full synthesis, no entry build.
    if (this._descriptorOnly) {
      this._out.push({
        ts: req.ts || '',
        sessionId: this.sessionId,
        seq,
        url: req.url,
        isMain,
        isMainDelta: isMain && !!conv && !isCheckpoint,
      });
      return;
    }
    // Pass B (materialize gate): conversation state was already advanced by
    // _pumpConv, so skipping here skips ONLY blob backfill + entry build +
    // retention — exactly the per-request memory cost the window excludes.
    const mat = this._materialize ? this._materialize(this.sessionId, seq) : true;
    if (!mat) return;

    // ---- body (blob backfill is per-request by journal ref — never carried) --
    const tools = this._loadBlob(req.blobs && req.blobs.tools);
    const system = this._loadBlob(req.blobs && req.blobs.sys);
    // req.params carries every residual body field (params-era journals);
    // dedicated fields override it so precedence is deterministic. user_id is
    // ALWAYS meta.userIdRaw — the client does equality-based session-boundary
    // detection on it, and a `-c` adopted folder mixes real user_ids that
    // would otherwise split the timeline mid-session.
    const params = req.params && typeof req.params === 'object' ? req.params : null;
    const body = {
      ...params,
      ...(req.model && { model: req.model }),
      ...(system !== undefined && { system }),
      ...(tools !== undefined && { tools }),
    };
    if (meta.userIdRaw) {
      const extra = body.metadata && typeof body.metadata === 'object' ? body.metadata : null;
      body.metadata = { ...extra, user_id: meta.userIdRaw };
    } else if (body.metadata && typeof body.metadata === 'object' && body.metadata.user_id !== undefined) {
      // noid session (no parseable user_id at write time): a raw params
      // user_id may vary per request, and surfacing it would re-open the
      // spurious client boundary-split this block exists to prevent. Drop
      // ONLY user_id; other metadata keys keep full fidelity.
      const { user_id, ...restMeta } = body.metadata;
      if (Object.keys(restMeta).length > 0) body.metadata = restMeta;
      else delete body.metadata;
    }

    const isTeammateEntry = isTeammate;
    const isMainKind = isMain;
    const entry = {
      timestamp: req.ts,
      project: meta.project || basename(this.projectDir),
      url: req.url,
      method: req.method || 'POST',
      ...(req.headers && { headers: req.headers }),
      body,
      response: null,
      duration: 0,
      isStream: !!req.isStream,
      isHeartbeat: HEARTBEAT_URL_RE.test(req.url || ''),
      isCountTokens: COUNT_TOKENS_URL_RE.test(req.url || ''),
      mainAgent: false, // finalized below once messages are attached
      ...(isTeammateEntry && { teammate: leader.agentName || req.agent?.agentName || true, ...(leader.teamName && { teamName: leader.teamName }) }),
      // Wire agent identity persisted by the writer (see agent-id.js) — the
      // client uses req.agent.agentName as the display name when the heuristic
      // registry has nothing (native teammate, cold load).
      ...(req.agent && { agent: req.agent }),
      ...(req.proxy && { proxyProfile: req.proxy.profile, ...(req.proxy.url && { proxyUrl: req.proxy.url }), ...(req.proxy.role && { proxyRole: req.proxy.role }) }),
    };

    // ---- messages + envelope ------------------------------------------------
    if (conv) {
      if (isMainKind) {
        // v1 delta envelope synthesis. The stream is seq-ordered, so the client
        // seq guard sees a strictly increasing sequence in one epoch.
        entry._seq = seq;
        entry._seqEpoch = `v2:${this.sessionId}`;
        entry._deltaFormat = 1;
        entry._totalMessageCount = conv.state.length;
        entry._conversationId = 'mainAgent';
        const snapshot = applied.find((e) => e.t === 'snapshot');
        const replaceTail = applied.find((e) => e.t === 'ctl' && e.op === 'replace-tail');
        const append = applied.find((e) => e.t === 'append');
        if (snapshot || replaceTail || !append) {
          entry._isCheckpoint = isCheckpoint; // = !!(snapshot||replaceTail); empty-wire delta is false
          if (replaceTail && !snapshot) {
            entry._isCheckpoint = true;
            // Paired signal (KEEP IN SYNC: src/utils/sessionManager.js
            // applyInPlaceLastMsgReplace) — same protocol as the v1 writer.
            entry._inPlaceReplaceDetected = true;
          }
          entry.body.messages = entry._isCheckpoint ? conv.state : [];
        } else {
          entry._isCheckpoint = false;
          entry.body.messages = Array.isArray(append.msgs) ? append.msgs : [];
        }
      } else {
        // sub / misc / teammate streams are full-messages in v1 (no envelope).
        entry.body.messages = conv.state;
      }
    }

    // v1 stamps mainAgent = isMainAgentRequest(body) at request time; kind
    // 'main' was CLASSIFIED by that same predicate, so it maps back to true
    // directly (its delta body would defeat a recompute). Everything else —
    // teammate dual-tag included — recomputes over the backfilled body.
    entry.mainAgent = isMainKind || isMainAgentRequest(entry.body);

    const item = {
      ts: req.ts || '',
      sessionId: this.sessionId,
      seq,
      phase: 'placeholder',
      entry,
      isMain: isMainKind,
      // Journal-truth request identity for the live row builder (live-feed
      // _rowFrom): conv/evt are the V3.S5 assembler inputs the cold fold
      // (meta-rows foldDir) already carries — without them on live rows the
      // client rebuilds entries with EMPTY messages and the chat vanished at
      // stream end until a cold reload (2026-07-16 live-render regression).
      kind: req.kind,
      ...(req.conv && { conv: req.conv }),
      ...(req.evt && { evt: req.evt }),
      stateRef: conv ? conv.state : null,
    };
    this._await.set(seq, item);

    if (this._dones.has(seq)) {
      this._tryComplete(seq);
    } else if (this._deferMs === 0 && !this._sessionLive) {
      // Cold read of a DEAD session: the orphan is definitively terminal. Emit
      // it as a completed delta (no inProgress / requestId — the exact shape
      // _complete produces) so the client batch reconstructor accumulates its
      // message slice: inProgress rows are skipped by the reconstructor, which
      // would otherwise drop the slice and fail every later completed entry's
      // _totalMessageCount integrity check — blanking the whole chat.
      entry.response = { body: null }; // mirrors _complete's no-response branch
      // Push the SAME item reference (phase aside): _complete's dedup splice
      // (this._out.indexOf(item)) depends on the queued object identity — a
      // spread copy would dodge it and the twin completed frame would double.
      item.phase = 'completed';
      this._out.push(item);
    } else {
      // req without done — in-flight or the process died (spec §4). This IS the
      // v1 placeholder, so it wears the same flags. Live reads keep it so the
      // incremental reconstructor can render the in-flight turn as it streams.
      entry.inProgress = true;
      entry.requestId = req.rid || `${seq}`;
      this._out.push(item);
    }
  }

  /** A done is known for this seq — complete now, or park until its responses
   *  line lands (every completion writes one; cross-path flush can reorder). */
  _tryComplete(seq) {
    if (!this._await.has(seq)) return; // req not synthesized yet — _emit retries
    if (this._deferMs > 0 && !this._responses.has(seq) && !this._doneWaitingResp.has(seq)) {
      this._doneWaitingResp.set(seq, this._now());
      return;
    }
    this._doneWaitingResp.delete(seq);
    this._complete(seq);
  }

  _complete(seq) {
    const item = this._await.get(seq);
    const done = this._dones.get(seq);
    if (!item || !done) return;
    this._await.delete(seq);
    // If the placeholder is still queued (req and done landed in the same
    // batch), drop it — its entry object is about to be mutated into the
    // completed form and emitting both would just send the same frame twice.
    const queued = this._out.indexOf(item);
    if (queued !== -1) this._out.splice(queued, 1);
    const entry = item.entry;
    // A live placeholder was already emitted for this entry object; strip its
    // in-flight markers so the completed form stringifies byte-identical to a
    // cold read of the same session.
    delete entry.inProgress;
    delete entry.requestId;
    const respRaw = this._responses.get(seq);
    let resp = null;
    if (respRaw) {
      try { resp = JSON.parse(respRaw); } catch { resp = null; }
    }
    entry.response = {
      ...(typeof done.http === 'number' && { status: done.http }),
      ...(resp && resp.statusText && { statusText: resp.statusText }),
      ...(resp && resp.headers && { headers: resp.headers }),
      body: resp ? resp.body : null,
    };
    if (typeof done.dur === 'number') entry.duration = done.dur;
    // Live-mode memory bound (review P2): completed seqs never need their raw
    // response line or done line again — a duplicate done re-arriving is a
    // no-op above (the awaited item is gone). Cold reads drain immediately,
    // so this is pure win there too.
    this._responses.delete(seq);
    this._dones.delete(seq);
    this._out.push({ ...item, phase: 'completed' });
  }
}

/**
 * Cold generator over ONE session dir: yields items (see SessionSynthesizer)
 * in seq order — the eager feeding of the shared synthesis engine.
 */
function* iterateSessionItems(sessionDir, opts = {}) {
  const projectDir = dirname(dirname(sessionDir));
  const sessionId = basename(sessionDir);
  let session;
  try {
    session = readSession(projectDir, sessionId);
  } catch (err) {
    // One unreadable session must degrade to "not rendered", never crash the
    // whole scan (issue #129: an oversized file crash-looped every startup).
    reportSwallowed('v2-read.session-read-failed', new Error(`${sessionId}: ${err.message}`));
    return;
  }
  if (session.unsupported) {
    reportSwallowed('v2-read.unsupported-wire-format', new Error(`${sessionId}: wireFormat=${session.wireFormat}`));
    return;
  }
  const synth = new SessionSynthesizer(sessionDir, {
    teammateOf: opts.teammateOf,
    deferMs: 0,
    descriptorOnly: opts.descriptorOnly,
    materialize: opts.materialize,
  });
  if (synth.unsupported) return; // meta gate already reported by the constructor
  // Eager seed: all conversation events, responses, and done lines are known
  // before any req is pumped — every gate then resolves exactly like the
  // historical whole-file read.
  for (const [key, events] of session.convEvents) synth._conv(key).events = events;
  synth._responses = readResponsesRaw(sessionDir);
  synth._dones = session.dones;
  const seqs = [...session.reqs.keys()].sort((a, b) => a - b);
  for (const seq of seqs) {
    synth.ingestJournalLine(session.reqs.get(seq));
    yield* synth.drain();
  }
}

/** Sibling sessions whose meta.leader points at this session (spec §10).
 *
 *  Leaderless fallback (S6b review P1): native team mode spawns teammates with
 *  `--agent-name` but possibly WITHOUT `--parent-session-id`, so meta.leader
 *  carries no sid. Those sessions are attributed to the leader session that was
 *  most recently started at (or before) the teammate's own start — the exact
 *  semantics of v1's findRecentLog ("append to the newest leader log"). */
export function findTeammateSessionDirs(sessionDir, leaderUuid) {
  const sessionsRoot = dirname(sessionDir);
  const leaderSid = basename(sessionDir); // dir NAME — for the self-skip + leaderless tie-break
  // Task C: teammates record the leader's UUID in meta.leader.parentSessionId
  // (from the CLI `--parent-session-id`, immutable). Since the leader dir is now
  // `<ts>_<uuid>`, we match against the leader's meta.sessionId (the UUID), NOT
  // basename. Read it ONCE up-front (callers pass it; fall back to a direct
  // read) — a mid-loop capture would miss when readdir visits a teammate before
  // the leader's own dir.
  if (!leaderUuid) {
    try { leaderUuid = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8')).sessionId || leaderSid; }
    catch { leaderUuid = leaderSid; }
  }
  const out = [];
  let names = [];
  try {
    names = readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }
  const orphans = []; // teammate sessions without a recorded leader sid
  const leaderStarts = []; // {sid, startTs} of every non-teammate session
  let ownStartTs = '';
  for (const name of names) {
    const dir = join(sessionsRoot, name);
    try {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
      const l = meta && meta.leader;
      if (name === leaderSid) {
        ownStartTs = (meta && meta.startTs) || '';
        continue;
      }
      if (!l) {
        // Discardable dirs (quota-probe orphans — no main/teammate req) must
        // never act as leader candidates: a probe fires at process startup,
        // so its startTs sits right next to the real leader's and can win the
        // orphan tie-break below, stealing the teammate's traffic from the
        // real leader's folded stream.
        if (isDiscardableSession(dir, meta)) continue;
        leaderStarts.push({ sid: name, startTs: (meta && meta.startTs) || '' });
        continue;
      }
      // The writer records parentSessionId (interceptor.js); tolerate the spec's
      // original sessionId spelling for hand-built or future dirs. Match the
      // leader's UUID (meta.sessionId), not its dir name (task C).
      if (l.parentSessionId === leaderUuid || l.sessionId === leaderUuid) {
        out.push({ dir, leader: l });
      } else if (!l.parentSessionId && !l.sessionId) {
        orphans.push({ dir, leader: l, startTs: (meta && meta.startTs) || '' });
      }
    } catch { /* not a readable session dir — skip */ }
  }
  for (const o of orphans) {
    // Best temporal match: the latest leader started at or before the teammate.
    // Ties break on sid so exactly ONE leader ever claims an orphan — a strict
    // ">" alone let two leaders sharing a startTs both claim it, duplicating
    // the teammate's traffic into both streams (review P2).
    let best = null; // {startTs, sid}
    if (ownStartTs && ownStartTs <= o.startTs) best = { startTs: ownStartTs, sid: leaderSid };
    for (const cand of leaderStarts) {
      if (!cand.startTs || cand.startTs > o.startTs) continue;
      if (best == null
        || cand.startTs > best.startTs
        || (cand.startTs === best.startTs && cand.sid > best.sid)) {
        best = cand;
      }
    }
    if (best && best.sid === leaderSid) out.push({ dir: o.dir, leader: o.leader });
  }
  return out;
}

/**
 * Item-level iteration of one v2 session with teammate re-join — the shared
 * core of the raw-string generators and the window reader below.
 */
export function* iterateV2Items(sessionDir, opts = {}) {
  const streams = [iterateSessionItems(sessionDir, opts)];
  const ownMeta = (() => {
    try { return JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8')); } catch { return null; }
  })();
  // A teammate session read directly renders itself (tagged via its own meta.
  // leader inside iterateSessionItems); only a LEADER pulls in siblings.
  if (!ownMeta || !ownMeta.leader) {
    for (const tm of findTeammateSessionDirs(sessionDir, ownMeta && ownMeta.sessionId)) {
      streams.push(iterateSessionItems(tm.dir, { ...opts, teammateOf: tm.leader }));
    }
  }
  if (streams.length === 1) {
    yield* streams[0];
    return;
  }
  // k-way merge by (ts, sessionId, seq) — ISO timestamps compare lexically;
  // cross-process seqs are not comparable so sessionId breaks ts ties (§10).
  const heads = streams.map((s) => ({ s, cur: s.next() }));
  for (;;) {
    let best = -1;
    for (let i = 0; i < heads.length; i++) {
      if (heads[i].cur.done) continue;
      if (best === -1) { best = i; continue; }
      const a = heads[i].cur.value;
      const b = heads[best].cur.value;
      if (a.ts < b.ts || (a.ts === b.ts && (a.sessionId < b.sessionId || (a.sessionId === b.sessionId && a.seq < b.seq)))) {
        best = i;
      }
    }
    if (best === -1) return;
    yield heads[best].cur.value;
    heads[best].cur = heads[best].s.next();
  }
}

/**
 * Main entry: iterate one v2 session as a v1-shape raw-entry stream, teammate
 * sessions re-joined. Yields raw JSON strings (same contract as
 * log-stream.iterateRawEntries).
 * @param {string} sessionDir - absolute LOG_DIR/<project>/sessions/<sid>
 */
export function* iterateV2RawEntries(sessionDir) {
  for (const item of iterateV2Items(sessionDir)) yield JSON.stringify(item.entry);
}

/** Async wrapper with periodic event-loop yields (the synthesis itself is CPU
 *  work over small v2 files; the yields keep a live proxy responsive while a
 *  big session is being adapted). */
export async function* iterateV2RawEntriesAsync(sessionDir) {
  let n = 0;
  for (const raw of iterateV2RawEntries(sessionDir)) {
    yield raw;
    if (++n % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
}

// Depth of the newest-mainAgent ring folded into window results (S10a). The
// /events kv-cache/context-window scan consumed every raw via onScan before;
// the two-pass window no longer stringifies out-of-window entries, so Pass A
// tracks the newest ≤3 main descriptors and Pass B force-materializes them.
// KEEP IN SYNC: server/routes/events.js MAINAGENT_SCAN_RING.
const MAINAGENT_RING_DEPTH = 3;

/** Window pass key: seqs are unique per session (journal folds duplicates),
 *  so (sessionId, seq) identifies one synthesized item across the k-way merge. */
const itemKey = (sessionId, seq) => `${sessionId}\x00${seq}`;

// S10b: two-level in-flight coalescing (spec §14.1). Level 1 shares the Pass A
// descriptor scan per sessionDir (reconnect storms are all the same dir);
// level 2 shares the full-window Pass B materialization per (dir,limit,before)
// — since-bearing (incremental) callers stream their own cheap Pass B instead.
const _scanFlight = new SingleFlight({ ttlMs: 500 });
const _windowFlight = new SingleFlight({ ttlMs: 500 });
const _windowStats = { scanRuns: 0, materializeRuns: 0 };
export function _v2WindowStatsForTest(reset = false) {
  const snap = { ..._windowStats };
  if (reset) { _windowStats.scanRuns = 0; _windowStats.materializeRuns = 0; }
  return snap;
}

/**
 * S10a Pass A: descriptor scan — runs the SAME synthesis gates as Pass B
 * (a journal-only scan would count crash-orphans the synthesizer skips, P0-1)
 * but builds no entries, loads no blobs, stringifies nothing: memory is
 * O(request count) light records + the replayed conversation event lines.
 * The result is IMMUTABLE and shared across coalesced callers — window
 * selection must not mutate `recs`/`ring`.
 */
export async function scanV2Descriptors(sessionDir) {
  _windowStats.scanRuns++;
  const dedup = new Map(); // key → descriptor (insertion order = output order)
  const ring = []; // newest ≤3 isMain descriptors, pre-dedup iteration order
  let nokey = 0;
  let n = 0;
  for (const d of iterateV2Items(sessionDir, { descriptorOnly: true })) {
    const key = d.ts && d.url ? `${d.ts}|${d.url}` : `__nokey_${nokey++}`;
    dedup.set(key, d);
    // Ring criterion is item.isMain (kind==='main' on a non-teammate session):
    // the old substring filter (`"mainAgent":true` && !`"teammate"`) also
    // admitted sub/misc entries whose backfilled body LOOKED main-agent; the
    // isMain ring drops those — intentional, more-correct behavior (pinned in
    // packages/app/test/v2-window-two-pass.test.js). Teammate-session main entries are
    // excluded by both (they carry the teammate tag / isMain=false).
    if (d.isMain) {
      ring.push(d);
      if (ring.length > MAINAGENT_RING_DEPTH) ring.shift();
    }
    if (++n % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return { recs: [...dedup.values()], ring };
}

/**
 * Window selection over a (possibly shared) descriptor scan — cheap array ops,
 * run per caller. Filter order matches the historical single pass: dedup →
 * `before` → tail-`limit` → `since` (emission filter, applied to membership so
 * excluded entries are never materialized). The baseline candidate is decided
 * on the post-limit window start; `since` may then drop it — exactly like the
 * old emission-time since filter did.
 */
function selectV2Window(scan, opts = {}) {
  const limit = opts.limit || 0;
  const before = opts.before || null;
  const since = opts.since || null;
  let recs = scan.recs;
  if (before) recs = recs.filter((r) => r.ts && r.ts < before);
  const totalCount = recs.length;
  let hasMore = false;
  if (limit > 0 && recs.length > limit) {
    hasMore = true;
    recs = recs.slice(recs.length - limit);
  }
  const oldestTimestamp = recs.length > 0 ? recs[0].ts : '';
  // Baseline: if the first main-conversation record in the window is a delta,
  // Pass B promotes it to a synthesized checkpoint over its replayed state.
  const firstMainIdx = recs.findIndex((r) => r.isMain);
  let baselineKey = null;
  if (firstMainIdx >= 0 && recs[firstMainIdx].isMainDelta) {
    baselineKey = itemKey(recs[firstMainIdx].sessionId, recs[firstMainIdx].seq);
  }
  if (since) recs = recs.filter((r) => !(r.ts && r.ts < since));
  if (baselineKey && !recs.some((r) => itemKey(r.sessionId, r.seq) === baselineKey)) {
    baselineKey = null; // baseline fell below `since` — incremental clients rely on their cached state
  }
  return { members: recs, totalCount, hasMore, oldestTimestamp, baselineKey, ring: scan.ring };
}

/** Level-1 shared Pass A + per-caller selection. `cached` gates the TTL
 *  micro-cache read (F5b: /events live-attach must never consume it). */
export async function computeV2Window(sessionDir, opts = {}) {
  const scan = await _scanFlight.run(`scan:${sessionDir}`, () => scanV2Descriptors(sessionDir), { cached: !!opts.cached });
  return selectV2Window(scan, opts);
}

/**
 * S10a Pass B: re-synthesize the session, materializing ONLY window members
 * (plus the mainAgent ring). Out-of-window requests advance conversation state
 * without building entries/loading blobs/stringifying — peak memory is
 * O(window raws) + one live conversation state + window-member blobs.
 *
 * `onEntry` (streaming mode) receives members in synthesis (seq) order — when
 * duplicate timestamp|url keys exist this can differ from the historical
 * dedup-map order, but clients re-dedup on the same key so the final state is
 * equivalent (algorithm review F6). `collect` mode fills a slot array in
 * Pass A output order instead: byte-identical to the historical single pass.
 */
async function materializeV2Window(sessionDir, win, { collect = false, onEntry = null, promoteKeys = null } = {}) {
  const memberIdx = new Map();
  win.members.forEach((d, i) => memberIdx.set(itemKey(d.sessionId, d.seq), i));
  const ringKeys = new Set(win.ring.map((d) => itemKey(d.sessionId, d.seq)));
  const slots = collect ? new Array(win.members.length) : null;
  const ringRaws = new Map();
  const materialize = (sessionId, seq) => {
    const k = itemKey(sessionId, seq);
    return memberIdx.has(k) || ringKeys.has(k);
  };
  let sentCount = 0;
  let n = 0;
  for (const item of iterateV2Items(sessionDir, { materialize })) {
    const k = itemKey(item.sessionId, item.seq);
    let raw = JSON.stringify(item.entry);
    // The ring keeps the UN-promoted raw — parity with the old onScan hook,
    // which saw every entry before the baseline rebuild.
    if (ringKeys.has(k)) ringRaws.set(k, raw);
    const idx = memberIdx.get(k);
    if (idx !== undefined) {
      // Baseline: promote the window-start main delta to a checkpoint over its
      // replayed state (item.stateRef aliases the live conversation state at
      // this seq — used transiently, never retained). Same construction as the
      // historical end-of-window rebuild, byte-for-byte.
      // `promoteKeys` (V3.S1): per-member force-checkpoint for single-entry
      // reads — a mid-session main delta carries only its appended slice, but
      // the detail view needs the full replayed state for BOTH the target and
      // its prevMain (Body Diff / cacheLoss compare whole messages arrays).
      // The window baseline promotes only win.baselineKey (the window start).
      if (k === win.baselineKey || (promoteKeys && promoteKeys.has(k))) {
        const state = item.stateRef || [];
        const rebuilt = { ...item.entry, body: { ...item.entry.body, messages: state } };
        rebuilt._isCheckpoint = true;
        rebuilt._totalMessageCount = state.length;
        raw = JSON.stringify(rebuilt);
      }
      if (collect) {
        slots[idx] = raw;
      } else if (onEntry) {
        await onEntry(raw);
      }
      sentCount++;
    }
    if (++n % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  const mainAgentRing = win.ring
    .map((d) => ringRaws.get(itemKey(d.sessionId, d.seq)))
    .filter(Boolean);
  return { slots, sentCount, mainAgentRing };
}

/**
 * Windowed read of a v2 session: dedup (timestamp|url, last wins), optional
 * `before` filter, tail-`limit` slice — and a BASELINE GUARANTEE the byte-tail
 * heuristics of v1 files cannot give: when the window starts on a main-
 * conversation delta, that entry is synthesized as a checkpoint carrying the
 * full replayed state at its seq, so a window is always reconstructable
 * regardless of how sparse the session's organic snapshots are.
 *
 * S10a: two-pass. The historical single pass stringified and RETAINED every
 * entry (~10x on-disk expansion resident per load — the 2026-07-15 OOM);
 * now Pass A selects the window over light descriptors and Pass B
 * materializes only its members. Output is byte-identical to the single pass.
 * The onScan option is retired on this path — consumers use `mainAgentRing`
 * from the result instead (P0-2).
 *
 * S10b: level-2 coalescing — a whole window result keyed (dir,limit,before) is
 * shared across concurrent callers and TTL-cached for the read-only historical
 * surfaces. `since` is NOT in the key (it filters emission over the same
 * window), so this array path does not take `since`; the /events incremental
 * path uses streamV2WindowedEntries with its own per-caller Pass B.
 *
 * IMMUTABILITY: the returned object (incl. `entries` and `mainAgentRing`) may
 * be shared by reference across coalesced + TTL-cached callers — treat it as
 * READ-ONLY. An in-place mutation (sort/reverse/push) would corrupt the shared
 * cache for concurrent readers; copy first if you must mutate.
 *
 * @param {string} sessionDir
 * @param {{limit?: number, before?: string|null, cached?: boolean}} [opts]
 * @returns {Promise<{entries: string[], hasMore: boolean, oldestTimestamp: string, totalCount: number, mainAgentRing: string[]}>}
 */
/**
 * V3.S1: on-demand single-entry read — the detail view's data source once the
 * request list is metadata rows. Locates the target (sessionId, seq) in the
 * shared descriptor scan, pairs it with its preceding isMain descriptor
 * (Body Diff / Context tab need the previous mainAgent, raw-seq adjacency),
 * and materializes exactly those members with per-member checkpoint promotion
 * (main deltas come back with the full replayed state, matching what the
 * client holds after reconstruction on the legacy channel).
 *
 * @param {string} sessionDir - leader session dir (teammate rows resolve
 *   through the leader's k-way fold so tags/order match the list)
 * @param {{seq: number, sessionId?: string|null, cached?: boolean}} opts -
 *   sessionId (UUID) disambiguates teammate rows; null = any session's seq
 * @returns {Promise<{entry: string, prevMain: string|null}|null>} raw JSON
 *   strings (never re-parsed here), or null when the seq is unknown / gated
 *   out by synthesis (crash-orphan) — callers answer 404.
 */
export async function readV2SingleEntry(sessionDir, opts = {}) {
  const seq = opts.seq;
  const sessionId = opts.sessionId || null;
  const key = `entry:${sessionDir}|${sessionId || ''}|${seq}`;
  return _windowFlight.run(key, async () => {
    const scan = await _scanFlight.run(`scan:${sessionDir}`, () => scanV2Descriptors(sessionDir), { cached: true });
    const recs = scan.recs;
    const idx = recs.findIndex((d) => d.seq === seq && (!sessionId || d.sessionId === sessionId));
    if (idx === -1) return null;
    const target = recs[idx];
    let prevMain = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (recs[i].isMain) { prevMain = recs[i]; break; }
    }
    const members = prevMain ? [prevMain, target] : [target];
    const win = { members, ring: [], baselineKey: null };
    const promoteKeys = new Set(members.filter((d) => d.isMainDelta).map((d) => itemKey(d.sessionId, d.seq)));
    const { slots } = await materializeV2Window(sessionDir, win, { collect: true, promoteKeys });
    const entry = slots[members.length - 1];
    if (entry === undefined) return null; // synthesis gate dropped it between passes
    return { entry, prevMain: prevMain ? (slots[0] ?? null) : null };
  }, { cached: opts.cached !== false });
}

export async function readV2WindowedEntries(sessionDir, opts = {}) {
  const cached = !!opts.cached;
  const key = `win:${sessionDir}|${opts.limit || 0}|${opts.before || ''}`;
  return _windowFlight.run(key, async () => {
    _windowStats.materializeRuns++;
    const win = await computeV2Window(sessionDir, opts);
    const { slots, mainAgentRing } = await materializeV2Window(sessionDir, win, { collect: true });
    const entries = [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] !== undefined) {
        entries.push(slots[i]);
      } else {
        // Pass B synthesized a different member set than Pass A — both passes
        // run the same gates, so a hole means the session changed between
        // passes (live append) or a synthesis bug. Surface it; entry dropped.
        reportSwallowed('v2-read.window-pass-divergence', new Error(`${basename(sessionDir)}: window slot ${i} not materialized`));
      }
    }
    return {
      entries,
      hasMore: win.hasMore,
      oldestTimestamp: win.oldestTimestamp,
      totalCount: win.totalCount,
      mainAgentRing,
    };
  }, { cached });
}

/**
 * Streaming window read (S10a): same selection semantics as
 * readV2WindowedEntries but entries are delivered one at a time via `onEntry`
 * and never accumulated — the limit=0 full-session and `/events` incremental
 * (`since`) paths stay O(one entry) resident instead of materializing the
 * whole expanded session (the pre-S10a reconnect-storm OOM path).
 *
 * @param {string} sessionDir
 * @param {{limit?: number, before?: string|null, since?: string|null,
 *          onReady?: (info:{totalCount:number, hasMore:boolean, oldestTs:string|null})=>void}} opts
 * @param {(raw: string) => void|Promise<void>} onEntry
 * @returns {Promise<{sentCount: number, totalCount: number, mainAgentRing: string[]}>}
 */
export async function streamV2WindowedEntries(sessionDir, opts, onEntry) {
  const win = await computeV2Window(sessionDir, opts);
  if (opts.onReady) opts.onReady({ totalCount: win.totalCount, hasMore: win.hasMore, oldestTs: win.oldestTimestamp || null });
  // Bounded window (limit>0): collect into slots and emit in Pass A output
  // order — byte-order parity with the historical single pass. Unbounded paths
  // (limit=0: /api/requests, workspaces reload, explicit ?limit=0) stream in
  // synthesis (seq) order without retention. ACCEPTED ORDER CHANGE: when two
  // entries share timestamp|url (e.g. same-ms countTokens bursts), the dedup
  // survivor emits at its later seq position instead of the first-occurrence
  // slot. Safe because the client re-dedups by the same key and main deltas
  // reconstruct via _seq/_seqEpoch (not array index) — final state is
  // order-independent; the default /events cold-load is bounded and unaffected.
  if (opts.limit > 0) {
    const { slots, mainAgentRing } = await materializeV2Window(sessionDir, win, { collect: true });
    let sentCount = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === undefined) {
        // Pass A selected a member Pass B didn't materialize (a live append
        // between passes / a synthesis bug). Same invariant break the array
        // reader reports — surface it here too rather than dropping silently
        // (this streaming path is the /events live source, where it's most
        // likely). The entry is omitted; the client's next `since` read heals.
        reportSwallowed('v2-read.window-pass-divergence', new Error(`${basename(sessionDir)}: window slot ${i} not materialized (stream)`));
        continue;
      }
      await onEntry(slots[i]);
      if (++sentCount % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    return { sentCount, totalCount: win.totalCount, mainAgentRing };
  }
  const { sentCount, mainAgentRing } = await materializeV2Window(sessionDir, win, { onEntry });
  return { sentCount, totalCount: win.totalCount, mainAgentRing };
}

// ─── session listing (spec §12, list entry pulled forward from S6a) ─────────

// listV2Sessions is re-exported from session-list.js (P0-A row cache, 2026-07-31).
// The full per-session summarization logic (incl. the readFirstJsonLine preview
// fallback) moved there; this re-export keeps the public API unchanged for all
// callers (log-management.js, routes/im.js, tests).
export { listV2Sessions };
