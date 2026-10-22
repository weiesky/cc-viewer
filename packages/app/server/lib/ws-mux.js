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
 * Pure logic: no `ws` module dependency (the WebSocketServer class is injected) and no
 * routes/ dependency (serveStream is injected by server.js), so this stays L1 and
 * unit-testable with fakes — same house style as lib/ws-backpressure.js.
 */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { reportSwallowed as defaultReport } from '../lib/error-report.js';
import { createBackpressureGate } from './ws-backpressure.js';

const STREAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HEARTBEAT_SEND_MS = 25_000;   // app-level ping cadence (chisel: proxies kill idle conns)
const HEARTBEAT_REAP_MS = 60_000;   // no inbound frame for this long → terminate the socket
const MAX_STREAMS_PER_SOCKET = 8;
// Per-socket queue is a pure MEMORY SAFETY NET (the primary slow-consumer eviction is the
// per-stream 30s backpressure rule inherited from _safeSseWrite). Sized above any legitimate
// cold-load burst so it only trips on a genuinely wedged socket, never on a fast-producer
// burst. Postmortem (2026-10-15): cc-viewer's own ~11MB v3 cold load exceeded the old 8MB
// cap — the CAP RAISE is the load-bearing fix; the perMessageDeflate disable below is
// prophylactic (it removes bufferedAmount inflation so the gate stops false-tripping, but
// even with deflate on the 32MB cap absorbs the burst: measured peak 10.6MB).
// 32MB covers ~40k-row sessions while still bounding a truly dead client's damage.
export const QUEUE_MAX_BYTES = 32 * 1024 * 1024;
const HIGH_WATER = 1024 * 1024;     // mirrors terminal's hysteresis band
const LOW_WATER = 256 * 1024;

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
  setTimeout: setT = setTimeout,
  clearTimeout: clearT = clearTimeout,
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
      queue: [],                   // FIFO of encoded frames held while behind
      queuedBytes: 0,
      _behind: false,
      gate: null,
      pingTimer: null,
      flushTimer: null,
      report: reportSwallowed,
      send: null, behind: null, closeStream: null,
    };
    sockets.add(st);

    // Drain the queue as a BOUNDED trickle, not a single-tick flood: after each frame, re-check
    // bufferedAmount and stop the moment it climbs back over highWater (a slow consumer's socket
    // buffer would otherwise spike to many times the high-water mark in one resume tick). The
    // trickle self-reschedules (the gate's poll stops once it fires onResume, so we can't rely on
    // it to drive the next trickle); teardown clears the timer.
    const flushQueue = () => {
      if (st.flushTimer) { clearT(st.flushTimer); st.flushTimer = null; }
      while (st.queue.length && !st.closed && st.ws.readyState === 1) {
        if ((st.ws.bufferedAmount || 0) > HIGH_WATER) {
          st._behind = true;
          st.flushTimer = setT(flushQueue, 100);
          st.flushTimer.unref?.();
          return;
        }
        const text = st.queue[0];
        try { st.ws.send(text); } catch (err) {
          reportSwallowed('ws.mux.send', err);
          closeSocket(st, 1011, 'send-failed');
          return;
        }
        st.queue.shift();
        st.queuedBytes -= text.length;
      }
    };
    const fireAllDrain = () => {
      for (const rec of st.streams.values()) rec.sink.emit('drain');
    };
    st.gate = createBackpressureGate({
      getBufferedAmount: () => st.ws.bufferedAmount || 0,
      onResume: () => { st._behind = false; flushQueue(); fireAllDrain(); },
      onBehind: () => { st._behind = true; },
      onTimeout: () => {
        reportSwallowed('ws.mux.backpressure', new Error('timeout'));
        closeSocket(st, 1011, 'backpressure-timeout');
      },
      highWater: HIGH_WATER,
      lowWater: LOW_WATER,
      timeoutMs: 30000,
    });
    st.behind = () => st._behind || st.queuedBytes > 0;

    // Send-or-enqueue. NEVER drops: while behind, frames accumulate in the bounded queue
    // (order preserved). A wedged client dies by the 30s gate timeout / queue cap, then the
    // client reconnects and resumes via its since/cc cursor. The gate's offer() return is
    // ONLY a signal (its native contract is "skip this send" — the terminal path compensates
    // with data-resync; mux must NOT skip, so we ignore the return for the send decision).
    st.send = (msg) => {
      if (st.closed || st.ws.readyState !== 1) return false;
      const text = encodeFrame(msg);
      st.gate.offer();                       // signal only; result deliberately unused
      if (st._behind) {
        if (st.queuedBytes + text.length > QUEUE_MAX_BYTES) {
          closeSocket(st, 1011, 'queue-overflow');
          return false;
        }
        st.queue.push(text);
        st.queuedBytes += text.length;
        return false;
      }
      try { st.ws.send(text); } catch (err) {
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

    st.pingTimer = setI(() => {
      if (st.closed) return;
      if (now() - st.lastInboundAt > HEARTBEAT_REAP_MS) {
        closeSocket(st, 1001, 'heartbeat-reap');
        return;
      }
      st.send({ type: 'ping', ts: now() });
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
    if (msg.type === 'ping') { st.send({ type: 'pong', ts: now() }); return; }
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
    // ack precedes every frame of this stream (history frames included).
    st.send({ type: 'open-ack', streamId: v.streamId, epoch, seq: 0 });
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
    try { st.gate.dispose(); } catch { /* best-effort */ }
    if (st.pingTimer) { clearI(st.pingTimer); st.pingTimer = null; }
    if (st.flushTimer) { clearT(st.flushTimer); st.flushTimer = null; }
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
