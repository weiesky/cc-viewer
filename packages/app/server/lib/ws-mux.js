/**
 * WebSocket stream mux for the dialogue channel (`/ws/mux`).
 *
 * Carries N logical /events streams over ONE shared WebSocket, so the browser's
 * HTTP/1.1 ~6-connections-per-origin ceiling (which pins SSE to maxChannels=3)
 * no longer bounds how many workspaces stream live concurrently. The SSE path
 * is kept intact as the automatic fallback: when the mux cannot serve (no
 * route, handshake refused, capability absent) the client reopens the SAME
 * scope URL over a native EventSource with its since/cc cursor — no data loss.
 *
 * Frame protocol (text JSON, graphql-ws style envelope):
 *   c→s  { type:'open', streamId, qs }        qs = the RAW ?query string a native
 *                                             EventSource URL would carry (passthrough;
 *                                             we never re-derive scope field-by-field,
 *                                             so `?limit` absence≠0 and sid/instance
 *                                             regexes stay byte-identical to /events)
 *   c→s  { type:'close', streamId }
 *   c→s  { type:'pong', ts }
 *   s→c  { type:'open-ack', streamId, epoch, seq }   ack precedes every frame of the stream
 *   s→c  { type:'frame', streamId, seq, name, data } name:null ⇔ bare `data:`; data is the
 *                                                    verbatim JSON string (never re-stringified)
 *   s→c  { type:'error', streamId, code, message }   per-stream; terminates only that stream
 *   s→c  { type:'ping', ts }                  25s app-level keepalive (browsers cannot send
 *                                             WS control-frame pings, so liveness is app-level)
 *
 * Reliability: a stream's lifetime == its socket's lifetime (mirrors SSE: one
 * EventSource ⇔ one connection, reconnect = new connection + since/cc). There is
 * NO server-side frame replay across sockets; resume semantics live entirely in
 * the existing since/cc cursor. seq is per-stream monotonic, epoch is per-process;
 * the client dedups on the per-stream seq alone (streamId is re-minted on every reconnect, so a
 * replayed frame from a prior incarnation can never collide); epoch is diagnostic only.
 *
 * The KEY design move is the sink shim: each logical stream masquerades as an SSE
 * `res` inside the shared `clients` array, so the broadcast hot path
 * (log-watcher's send*ToClients / _safeSseWrite / filterClientsByScope) needs ZERO
 * changes. The shim is a real EventEmitter because `awaitWireDrain`/`_safeSseWrite`
 * use on/once/off('drain'|'close'|'error') on it.
 *
 * Backpressure (2026-11 rework): the mux does NOT use lib/ws-backpressure.js's
 * gate (that gate's contract is "skip the send + resync on resume", which the mux
 * inverts into "queue + replay" — see st.send). Instead a self-contained per-socket
 * pump (a single setInterval) is the ONLY queue driver. Invariants:
 *   - a frame is queued only via enterBehind() (queue non-empty ⇒ _behind + pump armed);
 *   - 'drain' fires once the socket has headroom again (the pump dequeued bytes AND
 *     bufferedAmount <= HIGH_WATER, or the queue fully drains to <= LOW_WATER) — never
 *     while peak-congested, or woken producers would reflood the queue past the cap;
 *   - health is measured by the pump DEQUEUING bytes (a frame left the app queue), NOT
 *     by the bufferedAmount level: a full socket buffer is refilled to ~HIGH every tick,
 *     so its level never drops even for a fast-draining client. A queue with no byte
 *     movement for WS_MUX_STALL_MS is closed 1011 (an absolute 2× ceiling covers a
 *     pathological run of event-loop stalls), even while control pings keep flowing.
 * Bulk producers (the /events cold loads, the attach-buffer replay) are credit-based:
 * they `await sink.awaitDrain()` instead of dumping a whole multi-MB burst in one tick.
 * The cap is per-socket and the credit is per-producer, so N concurrent bulk streams on
 * one socket can still aggregate past it — a large single frame is the residual exposure
 * (tracked as follow-up: rowsPayload/conv-line chunking).
 *
 * Pure logic: no `ws` module dependency (the WebSocketServer class is injected) and no
 * routes/ dependency (serveStream is injected by server.js), so this stays L1 and
 * unit-testable with fakes — same house style as lib/ws-backpressure.js.
 */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { reportSwallowed as defaultReport } from '../lib/error-report.js';

const STREAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEARTBEAT_SEND_MS = 25_000;   // app-level ping cadence (chisel: proxies kill idle conns)
const HEARTBEAT_REAP_MS = 60_000;   // no inbound frame for this long → terminate the socket
const MAX_STREAMS_PER_SOCKET = 8;
// Per-socket queue is a pure MEMORY SAFETY NET. With the credit-based producers the
// queue only ever holds the admitted quantum (O(one frame) once a producer waits), so
// 32MB is a generous bound that only trips on a pathological single frame or a bug —
// never on a legitimate cold load, however large. Counted in real UTF-8 bytes
// (Buffer.byteLength), so CJK sessions consume the cap ~3x faster in *characters*
// than ASCII — the byte bound is the honest memory measure. Postmortem lineage
// (2026-10-15): the cap was raised 8MB→32MB when cc-viewer's own ~11MB v3 cold load
// overflowed; perMessageDeflate stays disabled (it inflates bufferedAmount with
// zlib-pending bytes and would re-break the pump's progress detection).
export const QUEUE_MAX_BYTES = 32 * 1024 * 1024;
const HIGH_WATER = 1024 * 1024;     // enter behind / stop flushing above this
const LOW_WATER = 256 * 1024;       // exit behind only below this (hysteresis band)

/** Pump cadence: how often a behind socket tries to flush its queue. */
export const WS_MUX_PUMP_MS = 100;
/** Max bytes dequeued per pump tick (after the guaranteed first frame). */
export const WS_MUX_FLUSH_BUDGET_BYTES = 4 * 1024 * 1024;
/** Kill a socket whose queue makes no byte-progress (bufferedAmount never drops) for this long. */
export const WS_MUX_STALL_MS = 30_000;

/** Per-stream application error codes (WS close-code range, graphql-ws 44xx semantics). */
export const MUX_CODES = {
  BAD_REQUEST: 4400,        // open frame failed validation
  DUPLICATE_STREAM: 4409,   // streamId already live on this socket
  TOO_MANY_STREAMS: 4429,   // socket stream cap reached
  SCOPE_UNAVAILABLE: 4503,  // this scope cannot be served over mux → client falls back (this stream only)
};

export function encodeFrame(obj) {
  return JSON.stringify(obj);
}

/** Parse one inbound text frame. Returns null on anything that is not a {type:string} object. */
export function decodeFrame(raw) {
  try {
    const o = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    return (o && typeof o === 'object' && typeof o.type === 'string') ? o : null;
  } catch {
    return null;
  }
}

/**
 * Parse ONE complete SSE frame body (no trailing blank line) into {name, data}.
 * Implements the SSE field rules rather than assuming a single data line: strip one
 * leading space after the colon, join multiple `data:` lines with '\n', drop unknown
 * field lines. `name` is null for a bare `data:` frame. Returns null when there is no
 * data field at all (a frame this codebase never legitimately emits).
 *
 * NOTE: only the two shapes this codebase emits are exercised in production —
 * `data: <json>` and `event: <name>\ndata: <json>` (JSON.stringify escapes newlines,
 * so data is always single-line). The multi-line tolerance is forward defense; an
 * unexpected non-data/event field line is reported as a protocol-drift signal.
 */
export function parseSseFrame(body, report = defaultReport) {
  const lines = body.split('\n');
  let name = null;
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.startsWith('data: ') ? line.slice(6) : line.slice(5));
    } else if (line.startsWith('event:')) {
      name = line.startsWith('event: ') ? line.slice(7) : line.slice(6);
    } else if (line === '' || line.startsWith(':')) {
      // blank / comment line — ignore
    } else {
      report('ws.mux.parse', new Error('unexpected SSE field line'), { line: line.slice(0, 16) });
    }
  }
  if (dataLines.length === 0) return null;
  return { name, data: dataLines.join('\n') };
}

/**
 * Validate an inbound `open` frame. Returns { ok:true, streamId, qs } or
 * { ok:false, code, message }. qs is passed through verbatim (only shape-checked to be
 * a string without a leading '?'); the scope/since/cc/limit semantics are re-parsed by
 * the SAME paramsFromParsedUrl the SSE route uses, so the two transports never drift.
 */
export function validateOpenParams(msg) {
  const streamId = msg.streamId;
  if (typeof streamId !== 'string' || !STREAM_ID_RE.test(streamId)) {
    return { ok: false, code: MUX_CODES.BAD_REQUEST, message: 'invalid streamId' };
  }
  const qs = msg.qs;
  if (qs !== null && qs !== undefined && (typeof qs !== 'string' || qs.startsWith('?') || qs.length > 4096)) {
    return { ok: false, code: MUX_CODES.BAD_REQUEST, message: 'invalid qs' };
  }
  return { ok: true, streamId, qs: qs || '' };
}

/**
 * The sink shim: one logical stream presented to the broadcast hot path as an SSE `res`.
 * A REAL EventEmitter because _safeSseWrite / awaitWireDrain attach on/once/off('drain'|
 * 'close'|'error') to it; a hand-rolled once() would TypeError inside awaitWireDrain and
 * (with no unhandledRejection backstop in the dispatcher) kill the process.
 */
class MuxSink extends EventEmitter {
  constructor(st, streamId) {
    super();
    this.streamId = streamId;
    this._st = st;
    // The registrable IS the shim itself (it is the object pushed into deps.clients, so the
    // per-stream _ccvView* stamps land on it — never on the shared socket).
    this.registrable = this;
    // SSE-res surface the hot path reads (see log-watcher._safeSseWrite / wire-compress):
    this.destroyed = false;      // flipped only when THIS stream ends (never by socket congestion)
    this.writable = true;
    this._wireEnc = undefined;   // MUST stay falsy: sseWrite/awaitWireDrain branch on it
    this._sseBackpressureSince = 0;
    this._ccvViewProject = undefined;   // stamped by the serve core at push time (per-stream)
    this._ccvViewInstance = undefined;
    this.writableNeedDrain = false;
    this._buf = '';              // cross-call SSE byte reassembly buffer
    this._seq = 0;               // per-stream monotonic frame sequence
    this._drainWaiters = [];
    // EventEmitter throws on an unlistened 'error'; the shim only ever reports transport
    // death via 'close', but keep a noop so a stray emit('error') can never crash the process.
    this.on('error', () => {});
    // The serve core registers its dispose hook here at entry.
    this.once('close', () => { this._disposed?.(); });
  }

  /** serve core entry hook: register the dispose callback (idempotent by the core). */
  onClose(fn) { this._disposed = fn; }

  alive() { return !this.destroyed && !this._st.closed; }
  needsDrain() { return this._st.behind(); }

  /** Mirrors wire-compress.awaitWireDrain: resolve on drain / close / 30s timeout. The SAME
   *  `done` reference is registered and removed (the previous version off()'d a different
   *  identity, leaking one stale listener per backpressure wait → MaxListenersExceededWarning). */
  awaitDrain() {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        this.off('drain', done);
        this.off('close', done);
        resolve();
      };
      const t = setTimeout(done, 30000);
      this.once('drain', done);
      this.once('close', done);
    });
  }

  /**
   * Opaque byte-append (the serve core splits one load_chunk across 3 write() calls).
   * Reassembles complete SSE frames across calls and forwards each as a {type:'frame'}.
   * Returns false to signal per-stream backpressure (frames are QUEUED, never dropped) —
   * the same threshold semantics _safeSseWrite applies to an SSE res. Never throws.
   */
  write(text) {
    if (this.destroyed) return false;
    this._buf += text;
    let start = 0;
    let idx;
    let ok = true;
    while ((idx = this._buf.indexOf('\n\n', start)) !== -1) {
      const body = this._buf.slice(start, idx);
      start = idx + 2;
      const parsed = parseSseFrame(body, this._st.report);
      if (!parsed) continue;
      this._seq += 1;
      if (!this._st.send({ type: 'frame', streamId: this.streamId, seq: this._seq, name: parsed.name, data: parsed.data })) {
        ok = false;
      }
    }
    if (start > 0) this._buf = this._buf.slice(start);
    this.writableNeedDrain = this._st.behind();
    return ok;
  }

  /**
   * End THIS logical stream only — never the socket (one socket carries N streams; a single
   * slow stream's 30s eviction must not take its siblings down, unlike SSE where end() closed
   * exactly one EventSource). Emits 'close' asynchronously to mirror Node res semantics (so a
   * `for (const c of clients) c.end()` loop does not skip siblings mid-iteration).
   */
  end() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.writable = false;
    this.writableNeedDrain = false;
    queueMicrotask(() => {
      this.emit('close');
      this._st.closeStream(this.streamId, 'sink-end');
    });
  }
}

export function createStreamMuxServer({
  WebSocketServer,
  serveStream,
  reportSwallowed = defaultReport,
  epoch = randomBytes(6).toString('hex'),
  setInterval: setI = setInterval,
  clearInterval: clearI = clearInterval,
  now = Date.now,
} = {}) {
  // perMessageDeflate DISABLED (2026-10-15, queue-overflow postmortem): with deflate on,
  // ws.send() enqueues into Node's zlib pending queue and ws.bufferedAmount counts those
  // bytes BEFORE they reach TCP (sender.js adds the UNCOMPRESSED size to _bufferedBytes
  // pre-compress, subtracting only in the zlib callback). During a cold-load burst the gate
  // then sees a phantom backlog, marks the socket behind, and queues frames — pings included —
  // so the queue grows until the cap kills the connection (1011 queue-overflow) and the
  // client's channel watchdog fires into a reconnect→overflow loop.
  //
  // Measured (real ws, ~11MB burst): peak bufferedAmount ~1.05MB in BOTH modes — deflate's
  // contribution is queue DWELL TIME, not peak depth. The cap raise above is what actually
  // prevents the overflow; disabling deflate keeps the gate's behind-detection honest.
  //
  // Trade-off (accepted): the mux path is now UNCOMPRESSED — MuxSink._wireEnc stays falsy,
  // so the SSE brotli encoder never runs here (only the SSE fallback compresses). On
  // localhost/LAN the wire growth is irrelevant; on a slow remote link a cold load is
  // slower than it would be compressed, and an SSE-fallback user can cold-load FASTER than
  // a healthy-mux user. The structural fix (cold-load history over one compressed HTTP
  // fetch, WS reserved for control + live deltas) is tracked as follow-up work.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  const sockets = new Set();
  wss.on('error', (err) => reportSwallowed('ws.mux.server', err));
  wss.on('connection', (ws) => handleConnection(ws));

  function handleConnection(ws) {
    const st = {
      ws,
      streams: new Map(),          // streamId -> { sink, handle, disposed }
      lastInboundAt: now(),
      closed: false,
      queue: [],                   // FIFO of { text, bytes } held while behind
      queuedBytes: 0,
      _behind: false,
      pumpTimer: null,
      lastProgressAt: 0,           // stall-guard clock: reset on byte progress OR a tick-gap stall
      lastByteProgressAt: 0,       // ABSOLUTE clock: reset ONLY when bufferedAmount truly dropped —
                                   //   the stall-guard reset never touches it, so a pathological
                                   //   run of >500ms event-loop stalls cannot postpone the kill forever
      lastBuffered: 0,             // bufferedAmount sampled at the previous pump tick
      lastTickAt: 0,               // last pumpTick wall time (event-loop-stall guard)
      pingTimer: null,
      report: reportSwallowed,
      send: null, behind: null, closeStream: null,
    };
    sockets.add(st);

    // ── Backpressure pump (the ONLY queue driver) ────────────────────────────
    // One self-scheduling setInterval per socket. A frame is queued only via
    // enterBehind() (so queue non-empty ⇒ _behind ∧ pump armed — the invariant the
    // old gate+flushQueue pair violated, leaving a wedged queue with no driver).
    const fireAllDrain = () => {
      // A throwing 'drain' listener must not escape into the pump's timer callback (an
      // uncaught throw there would kill the process). Drain listeners are optional.
      for (const rec of st.streams.values()) {
        try { rec.sink.emit('drain'); } catch (err) { reportSwallowed('ws.mux.drain', err); }
      }
    };
    const armPump = () => {
      if (st.pumpTimer || st.closed) return;
      st.pumpTimer = setI(pumpTick, WS_MUX_PUMP_MS);
      st.pumpTimer.unref?.();
    };
    const disarmPump = () => {
      if (st.pumpTimer) { clearI(st.pumpTimer); st.pumpTimer = null; }
    };
    const enterBehind = (buffered) => {
      if (st._behind) return;          // ONLY on the false→true edge: re-arming on every
      st._behind = true;               // enqueue would keep resetting the progress clock and
      st.lastProgressAt = now();       // let live traffic starve the stall watchdog forever.
      st.lastByteProgressAt = now();
      st.lastBuffered = buffered;
      st.lastTickAt = now();
      armPump();
    };
    const exitBehind = () => {
      // Clear the producer-facing flag so a new write may direct-send, but do NOT disarm:
      // the pump keeps watching bufferedAmount until the socket is fully drained (the
      // queue-empty-but-still-buffered wedge below HIGH needs the stall watchdog too).
      // Only wake waiters once there is real headroom (<= HIGH_WATER): firing drain at peak
      // congestion (queue just emptied but buffered > HIGH) would let every woken producer
      // re-enqueue a frame at the worst moment — the F2 reflood this redesign exists to prevent.
      st._behind = false;
      if ((st.ws.bufferedAmount || 0) <= HIGH_WATER) fireAllDrain();
    };
    function pumpTick() {
      if (st.closed || st.ws.readyState !== 1) return disarmPump();
      // Event-loop-stall guard: a gap > 5 ticks is OUR scheduling stall (a big synchronous
      // cold-load stringify), not the client dying — reset the progress clock rather than
      // count it against a healthy-but-paused consumer.
      if (now() - st.lastTickAt > 5 * WS_MUX_PUMP_MS) { st.lastProgressAt = now(); }
      st.lastTickAt = now();
      let sentBytes = 0;
      while (st.queue.length && !st.closed && st.ws.readyState === 1) {
        if ((st.ws.bufferedAmount || 0) > HIGH_WATER) break;
        if (sentBytes > 0 && sentBytes >= WS_MUX_FLUSH_BUDGET_BYTES) break;  // ≥1 frame, then bounded
        const e = st.queue[0];
        try { st.ws.send(e.text); } catch (err) {
          reportSwallowed('ws.mux.send', err);
          closeSocket(st, 1011, 'send-failed');
          return;
        }
        st.queue.shift();
        st.queuedBytes -= e.bytes;
        sentBytes += e.bytes;
      }
      if (st.closed) return;
      const b = st.ws.bufferedAmount || 0;
      if (st.queue.length === 0 && b <= LOW_WATER) {
        // Fully drained: clear behind (if set), wake waiters, and DISARM — nothing left
        // to watch. This is the only state where the pump stands down. Drain fires
        // unconditionally here: maximal headroom, and a waiter that entered mid-band must
        // not be stranded (the heartbeat timer shares lastBuffered — see ping — so a
        // conditional drain could be lost). A drain with no listeners is a no-op.
        st._behind = false;
        disarmPump();
        fireAllDrain();
        st.lastBuffered = 0;
        return;
      }
      // Queue empty but the socket still holds > LOW_WATER: producers may resume (clear the
      // flag so a new write direct-sends), yet the pump stays armed to watch the wedge.
      if (st._behind && st.queue.length === 0) exitBehind();
      // Progress == the pump actually DEQUEUED bytes this tick (a frame left the app queue
      // into the socket). This — NOT a bufferedAmount level drop — is the sound signal: when
      // the queue stays non-empty the flush refills the socket buffer to ~HIGH every tick, so
      // a level sample taken AFTER our own sends is pinned and never "declines" even for a
      // client draining megabytes per second (it would be false-killed). A wedged client, by
      // contrast, lets the socket buffer sit > HIGH so the flush breaks with sentBytes===0.
      // (Also credit the residual band: queue empty, buffer draining from > LOW to <= LOW.)
      if (sentBytes > 0 || (st.queue.length === 0 && b < st.lastBuffered)) {
        st.lastProgressAt = now();
        st.lastByteProgressAt = now();   // the ONLY clock that marks real byte movement
        // Emit 'drain' once there is real headroom (<= HIGH_WATER), so a woken producer
        // refills into a draining socket instead of reflooding a congested one.
        if (b <= HIGH_WATER) fireAllDrain();
      }
      st.lastBuffered = b;
      // Kill on measured no-progress. Two clocks: the stall-guard clock (lastProgressAt) is
      // reset by event-loop stalls so a slow-but-paused consumer isn't false-killed; the
      // absolute clock (lastByteProgressAt) is NEVER reset by a stall, so a pathological run
      // of stalls (or a frozen client whose buffer never drains) is still killed — by the
      // absolute ceiling 2×STALL_MS even if the guard keeps deferring the primary window.
      const stalledPrimary = now() - st.lastProgressAt >= WS_MUX_STALL_MS;
      const stalledAbsolute = now() - st.lastByteProgressAt >= 2 * WS_MUX_STALL_MS;
      if (stalledPrimary || stalledAbsolute) {
        reportSwallowed('ws.mux.backpressure', new Error('stalled'), { queuedBytes: st.queuedBytes, buffered: b, absolute: stalledAbsolute && !stalledPrimary });
        closeSocket(st, 1011, 'backpressure-timeout');
      }
    }

    st.behind = () => st._behind || st.queuedBytes > 0;

    // Send-or-enqueue. NEVER drops: while behind, frames accumulate in the bounded queue
    // (order preserved). A genuinely wedged client is killed by the stall watchdog (its
    // bufferedAmount stops dropping) or the queue cap, then the client reconnects and
    // resumes via its since/cc cursor. Every enqueue goes through ONE path that both
    // cap-checks and enterBehind()s — an enqueued frame always has the pump armed.
    st.send = (msg) => {
      if (st.closed || st.ws.readyState !== 1) return false;
      const text = encodeFrame(msg);
      const enqueue = () => {
        const bytes = Buffer.byteLength(text, 'utf8');   // real UTF-8 bytes ws.send will write
        if (st.queuedBytes + bytes > QUEUE_MAX_BYTES) {
          closeSocket(st, 1011, 'queue-overflow');
          return false;
        }
        st.queue.push({ text, bytes });
        st.queuedBytes += bytes;
        enterBehind(st.ws.bufferedAmount || 0);
        return false;
      };
      if (st._behind || st.queue.length > 0) return enqueue();   // never direct-send while queued
      if ((st.ws.bufferedAmount || 0) > HIGH_WATER) return enqueue();
      try { st.ws.send(text); } catch (err) {
        reportSwallowed('ws.mux.send', err);
        closeSocket(st, 1011, 'send-failed');
        return false;
      }
      return true;
    };

    // Control-plane bypass: ping/pong/open-ack carry no per-stream seq (the client's
    // dedup cursor only applies to 'frame'), so they may overtake queued bulk data to
    // keep liveness alive during a congested cold load. They do NOT count as queue
    // progress (the stall watchdog only watches bufferedAmount), so they can never mask
    // a wedged data queue. Data 'frame'/'close'/'error' still go through st.send (FIFO).
    st.sendControl = (msg) => {
      if (st.closed || st.ws.readyState !== 1) return false;
      try { st.ws.send(encodeFrame(msg)); } catch (err) {
        reportSwallowed('ws.mux.send', err);
        closeSocket(st, 1011, 'send-failed');
        return false;
      }
      return true;
    };

    st.closeStream = (streamId, reason) => {
      const rec = st.streams.get(streamId);
      if (!rec || rec.disposed) return;
      rec.disposed = true;
      st.streams.delete(streamId);
      // Wake any in-flight sink.awaitDrain() waiters (SSE's awaitWireDrain wakes on res
      // 'close'; a mux stream must too, or a serve coroutine hangs the full 30s timeout).
      // end() is the idempotent public path that emits 'close' + notifies us back (guarded
      // by rec.disposed above, so the re-entry is a no-op).
      try { rec.sink.end(); } catch (err) { reportSwallowed('ws.mux.dispose', err); }
      try { rec.handle?.dispose?.(); } catch (err) { reportSwallowed('ws.mux.dispose', err); }
      // Make a server-initiated stream close VISIBLE to the client (a SSE res.end() makes the
      // browser EventSource error+reconnect; a silent mux close would leave the facade OPEN and
      // the channel frozen until its heartbeat). Only when the socket is up and the close did
      // not originate from the client's own close frame.
      if (reason !== 'client-close' && reason !== 'socket-close' && reason !== 'server-stopping' && !st.closed) {
        st.send({ type: 'close', streamId });
      }
    };

    // Ping-timer liveness sample: kept SEPARATE from the pump's lastBuffered baseline so a
    // 25s heartbeat can never clobber the pump's final-drain 'drain' emission (lost wakeup).
    let lastPingBuffered = 0;
    st.pingTimer = setI(() => {
      if (st.closed) return;
      // Reap only on TRUE silence: inbound silence AND no outbound byte-progress. A slow
      // client (a ping that bypasses the data queue still sits behind up to HIGH_WATER of
      // socket buffer, so its pong can be >60s out on a very slow link) is kept alive as
      // long as the socket keeps draining; only a socket that is neither heard from nor
      // draining is reaped.
      const b = st.ws.bufferedAmount || 0;
      if (b < lastPingBuffered) st.lastProgressAt = now();
      lastPingBuffered = b;
      if (now() - st.lastInboundAt > HEARTBEAT_REAP_MS && now() - st.lastProgressAt > HEARTBEAT_REAP_MS) {
        closeSocket(st, 1001, 'heartbeat-reap');
        return;
      }
      st.sendControl({ type: 'ping', ts: now() });
    }, HEARTBEAT_SEND_MS);
    st.pingTimer.unref?.();

    ws.on('message', (raw) => { st.lastInboundAt = now(); onMessage(st, raw); });
    ws.on('close', () => teardown(st, 'socket-close'));
    ws.on('error', (err) => { reportSwallowed('ws.mux.socket', err); teardown(st, 'socket-error'); });
  }

  function onMessage(st, raw) {
    const msg = decodeFrame(raw);
    if (!msg) {
      st.send({ type: 'error', streamId: null, code: MUX_CODES.BAD_REQUEST, message: 'malformed frame' });
      return;
    }
    if (msg.type === 'pong') return;
    if (msg.type === 'ping') { st.sendControl({ type: 'pong', ts: now() }); return; }
    if (msg.type === 'close') {
      st.closeStream(msg.streamId, 'client-close');   // unknown id: ignore (graphql-ws)
      return;
    }
    if (msg.type === 'open') onOpen(st, msg);
  }

  function onOpen(st, msg) {
    const v = validateOpenParams(msg);
    if (!v.ok) {
      st.send({ type: 'error', streamId: typeof msg.streamId === 'string' ? msg.streamId : null, code: v.code, message: v.message });
      return;
    }
    if (st.streams.has(v.streamId)) {
      st.send({ type: 'error', streamId: v.streamId, code: MUX_CODES.DUPLICATE_STREAM, message: 'duplicate streamId' });
      return;
    }
    if (st.streams.size >= MAX_STREAMS_PER_SOCKET) {
      st.send({ type: 'error', streamId: v.streamId, code: MUX_CODES.TOO_MANY_STREAMS, message: 'too many streams' });
      return;
    }
    const sink = new MuxSink(st, v.streamId);
    const rec = { sink, handle: null, disposed: false };
    st.streams.set(v.streamId, rec);
    sink.on('close', () => st.closeStream(v.streamId, 'sink-close'));
    // ack precedes every frame of this stream (history frames included). Sent via
    // sendControl so it bypasses any queued bulk data — a cold-load backlog must not
    // push the ack past the client's 2.5s/4s ack deadline and force an SSE fallback.
    st.sendControl({ type: 'open-ack', streamId: v.streamId, epoch, seq: 0 });
    let handleP;
    try {
      handleP = serveStream(sink, v.qs);
    } catch (err) {
      reportSwallowed('ws.mux.serve', err);
      st.send({ type: 'error', streamId: v.streamId, code: MUX_CODES.SCOPE_UNAVAILABLE, message: 'serve failed' });
      st.closeStream(v.streamId, 'serve-throw');
      return;
    }
    // serveStream may return a handle synchronously or a Promise of one (the SSE serve core
    // resolves after the history push). Capture a sync (non-thenable) handle IMMEDIATELY so a
    // close arriving in the same tick still disposes it; a Promise handle lands in the microtask.
    if (handleP && typeof handleP.then !== 'function') {
      rec.handle = handleP;
      if (rec.disposed) { try { handleP?.dispose?.(); } catch (err) { reportSwallowed('ws.mux.dispose', err); } }
    } else {
      Promise.resolve(handleP).then((resolved) => {
        rec.handle = resolved;
        if (rec.disposed) {                        // socket/stream died while history was streaming
          try { resolved?.dispose?.(); } catch (err) { reportSwallowed('ws.mux.dispose', err); }
        }
      }).catch((err) => {
        reportSwallowed('ws.mux.serve', err);
        st.send({ type: 'error', streamId: v.streamId, code: MUX_CODES.SCOPE_UNAVAILABLE, message: 'serve failed' });
        st.closeStream(v.streamId, 'serve-failed');
      });
    }
  }

  function closeSocket(st, code, reason) {
    if (st.closed) return;
    for (const streamId of [...st.streams.keys()]) st.closeStream(streamId, 'socket-close');
    try { st.ws.close(code, reason); } catch { /* already gone */ }
    teardown(st, reason);
  }

  function teardown(st, _reason) {
    if (st.closed) return;
    st.closed = true;
    for (const streamId of [...st.streams.keys()]) st.closeStream(streamId, _reason);
    if (st.pingTimer) { clearI(st.pingTimer); st.pingTimer = null; }
    if (st.pumpTimer) { clearI(st.pumpTimer); st.pumpTimer = null; }
    // Reset the backpressure state so a dead sink's needsDrain() goes false and a
    // writeBp loop aborts on alive() instead of waiting out the 30s awaitDrain timeout.
    st._behind = false;
    st.queue.length = 0;
    st.queuedBytes = 0;
    sockets.delete(st);
  }

  return {
    handleUpgrade(req, socket, head) {
      try {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      } catch (err) {
        reportSwallowed('ws.mux.upgrade', err);
        try { socket.destroy(); } catch { /* raced */ }
      }
    },
    /** Terminate every socket (server.close() does NOT reach upgraded sockets) + close wss. */
    close() {
      for (const st of [...sockets]) {
        try { closeSocket(st, 1001, 'server-stopping'); } catch { /* best-effort */ }
        try { st.ws.terminate?.(); } catch { /* already gone */ }
      }
      try { wss.close(); } catch { /* stop/start cycles */ }
    },
    _sockets: sockets,
    _server: wss,
  };
}
