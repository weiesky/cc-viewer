/**
 * WebSocket-mux transport for the dialogue channel (WS-mux migration, phase A).
 *
 * Sits UNDER the per-scope channel manager (utils/sseChannels.js) as the transport
 * behind its `openEventSource(url)` seam. `open(url)` returns an EventSource-shaped
 * FACADE whose backend is a logical stream on ONE shared `/ws/mux` socket; when the
 * mux cannot serve, the facade transparently swaps to a native EventSource on the
 * SAME url (the url already encodes scope + since/cc cursor, so the fallback loses
 * nothing). SSE is the fallback, WS is preferred — there is no feature flag: this is
 * pure capability probing (fail → fall back), not an opt-in switch.
 *
 * Fallback taxonomy (Socket.IO semantics — a transient blip must NOT permanently
 * downgrade the page):
 *   - CAPABILITY (permanent, in-memory only): no WebSocket ctor / constructor throws /
 *     socket fails before the first ack (upgrade refused, e.g. an older server with no
 *     /ws/mux route). → reopen every mux facade as a native EventSource; new opens go
 *     straight to SSE. Page-lifetime only, never persisted, so a reload re-probes.
 *   - TRANSIENT (reconnect, never a permanent downgrade): a healthy socket dropped, or
 *     the socket watchdog (no server-initiated frame for SOCKET_IDLE_MS) fired. → retry
 *     the socket a few times with backoff; when the budget runs out, hand the channel
 *     back to the manager (facade CLOSED + onerror) so its own 45s heartbeat path builds
 *     a FRESH since/cc cursor url — which may pick WS again.
 *   - PER-STREAM: the server returned an `error` frame for one stream (4503 scope
 *     unavailable / 4429 stream-limit). → reopen ONLY that stream as a native EventSource.
 *
 * The facade's EventSource contract is exactly the surface the channel manager and
 * AppBase read (enumerated, do not regress):
 *   - readyState uses the EVENTSOURCE numbering (CONNECTING=0, OPEN=1, CLOSED=2) — AppBase's
 *     warm gate is `es.readyState !== 2`; CLOSED must be 2, and it must be 2 after close().
 *   - OPEN is only reported once the stream's open-ack arrives (a connected socket with an
 *     un-recovered stream is NOT open — else the warm gate treats a dead channel as warm).
 *   - close() is idempotent, closes ONLY this stream (sends a close frame), cancels its timers.
 *   - addEventListener registers against the CURRENT backend and is re-attached on a swap;
 *     named frames never fire onmessage (AppBase parses onmessage payloads as entries).
 *   - the server's app-level ping is fanned out per-stream as a synthetic 'ping' named frame,
 *     feeding the manager's 45s watchdog via _touchChannel (the SSE 30s `event: ping` does
 *     the same on the SSE backend).
 *
 * Framework-free with injectable WebSocket/EventSource factories + timers for node:test.
 */
import { getBasePath, appendToken } from './apiUrl.js';
import { reportSwallowed as defaultReport } from './errorReport.js';

export const MUX_PATH = '/ws/mux';

const PROBE_KEY = 'ccv.muxProbe';        // sessionStorage caches only 'ok' (rememberUpgrade: direct-WS only after a prior success; a failure re-probes)
const ACK_MS_PROBE = 2500;               // ack deadline before a cached success
const ACK_MS_CACHED = 4000;              // ack deadline after a cached success
const SOCKET_IDLE_MS = 45000;            // no server-initiated frame for this long → transient reconnect
const WATCHDOG_TICK_MS = 5000;
const RECONNECT_BUDGET = 3;              // transient socket retries before handing back to the manager
const DIAL_TIMEOUT_MS = 10000;           // connection-level deadline: a hung upgrade (blackholed
                                         // handshake) must not wedge every facade until the
                                         // browser's own WS timeout fires
const reconnectBackoff = (n) => Math.min(500 * Math.pow(2, n - 1), 4000); // 0.5s,1s,2s (cap 4s)

// EventSource readyState numbering (NOT the WebSocket one — CLOSED here is 2, not 3).
const ES_CONNECTING = 0;
const ES_OPEN = 1;
const ES_CLOSED = 2;

let _streamCounter = 0;
function mintStreamId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  _streamCounter += 1;
  return `s${_streamCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeSessionStorage() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;   // Safari private mode etc.
  }
}

/** Absolute ws:// URL for the mux endpoint, with the LAN token appended (tokenInterceptor
 *  returns absolute ws:// URLs unchanged, so the token must be added here — the same house
 *  pattern as TerminalWsContext). Returns null when the URL cannot be built (test shims
 *  without location.host/protocol). */
export function muxSocketUrl() {
  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    if (!host) return null;
    const base = getBasePath().replace(/\/$/, '');
    return appendToken(`${proto}//${host}${base}${MUX_PATH}`);
  } catch (err) {
    defaultReport('ws.mux.url', err);
    return null;
  }
}

export function createMuxTransport({
  openEventSource = (url) => new globalThis.EventSource(url),
  WebSocketCtor = () => globalThis.WebSocket,
  reportSwallowed = defaultReport,
  setTimeout: setT = setTimeout,
  clearTimeout: clearT = clearTimeout,
  now = Date.now,
  sessionStore = safeSessionStorage(),
  socketUrl = muxSocketUrl,
  onRuntimeFallback,               // (facade) => void — bump reconnectsSinceCommit etc. so a
                                   // later warm switch takes the warm-stale (fresh-cursor) path
} = {}) {
  /** @type {Set<object>} live facades */
  const facades = new Set();
  let sock = null;                 // { ws, state, retry, lastInboundAt, watchdogTimer, streams: Map<streamId, facade> }
  let dead = null;                 // null | 'capability'  (permanent, in-memory only)
  // Facades that opened while the socket was mid-transient-reconnect: they ride the SAME
  // pending reconnect instead of spawning a second socket (or worse, wrongly downgrading).
  const pendingMigrate = new Set();
  // Page-level "the mux HAS served this page" flag: set the first time any socket reaches OPEN
  // (or when a prior session cached a successful probe). While true, NO failure is ever classed
  // as a capability failure — the capability is proven, so every failure is transient. This is
  // what stops a >6s server restart (handback → manager rebuild → dial refused before open) from
  // permanently pinning the page to SSE, which is exactly the multi-connection pressure the mux
  // exists to remove.
  let everProven = false;

  function _probeOk() {
    try { sessionStore?.setItem(PROBE_KEY, 'ok'); } catch { /* benign */ }
  }
  function _probeCached() {
    try { return sessionStore?.getItem(PROBE_KEY) === 'ok'; } catch { return false; }
  }
  function _probeClear() {
    try { sessionStore?.removeItem(PROBE_KEY); } catch { /* benign */ }
  }

  // [ws.mux.diag] Diagnostics for the queue-overflow postmortem (2026-10-15), GATED behind
  // localStorage.ccv_ws_mux_diag==='1' (termDiag.js precedent) — the per-frame probe would
  // otherwise flood the console during exactly the cold-load burst under diagnosis.
  // Evaluated once at transport creation; flip the flag + reload to toggle.
  const _diagEnabled = (() => { try { return localStorage.getItem('ccv_ws_mux_diag') === '1'; } catch { return false; } })();
  function _diag(...args) { if (_diagEnabled) console.log('[ws.mux.diag]', ...args); }
  function _diagWarn(...args) { if (_diagEnabled) console.warn('[ws.mux.diag]', ...args); }

  // ── facade ──────────────────────────────────────────────────────────────────
  function createFacade(url) {
    const fac = {
      url,
      _readyState: ES_CONNECTING,   // authoritative on the mux backend; on the es backend the
      // readyState is delegated to the underlying native EventSource so consumers (and tests
      // that poke the real socket) observe the true connection state through the facade.
      get readyState() { return fac._backend === 'es' && fac._es ? fac._es.readyState : fac._readyState; },
      set readyState(v) { fac._readyState = v; },
      onmessage: null,
      onopen: null,
      onerror: null,
      _listeners: new Map(),        // name -> [fn]  (re-attached across backend swaps)
      _backend: null,               // 'mux' | 'es'
      _streamId: null,
      _es: null,                    // native EventSource when on the es backend
      _esProxies: new Map(),        // fn -> wrapped listener on the current es backend
      _ackTimer: null,
      _closed: false,               // idempotence guard for close() — independent of readyState
                                    // (which on the es backend delegates to the live EventSource
                                    // and would otherwise make close() early-return after a fatal
                                    // ES error, leaking the facade from the live set forever).
      _cursor: { epoch: null, lastSeq: 0 },
      close() {
        if (fac._closed) return;
        fac._closed = true;
        fac.readyState = ES_CLOSED;
        _clearAck(fac);
        if (fac._backend === 'mux') _sendClose(fac);
        _detachFromSocket(fac);
        if (fac._es) { try { fac._es.close(); } catch { /* benign */ } fac._es = null; }
        facades.delete(fac);
      },
      addEventListener(name, fn) {
        const l = fac._listeners.get(name) || [];
        l.push(fn);
        fac._listeners.set(name, l);
        // Attach to the live ES only on the FIRST registration of this name: _dispatch fans a
        // frame out to every fn in _listeners, so a second fn for the same name must NOT add
        // another native listener (that would double-dispatch on backends whose addEventListener
        // doesn't dedupe by reference).
        if (fac._backend === 'es' && fac._es && !fac._esProxies.has(name)) {
          fac._es.addEventListener(name, _esProxy(fac, name));
        }
      },
      removeEventListener(name, fn) {
        const l = fac._listeners.get(name);
        if (l) {
          const i = l.indexOf(fn);
          if (i !== -1) l.splice(i, 1);
        }
      },
    };
    return fac;
  }

  function _fire(fac, name, event) {
    const l = fac._listeners.get(name);
    if (l) for (const fn of [...l]) { try { fn(event); } catch (err) { reportSwallowed('ws.mux.listener', err); } }
  }

  function _dispatch(fac, name, data) {
    if (fac.readyState === ES_CLOSED) return;
    if (name === null || name === 'message') {
      const ev = { data };
      // A bare data: frame goes to onmessage ONLY (never to addEventListener('message') —
      // AppBase's onmessage parses entries; a named frame must never reach it).
      try { fac.onmessage?.(ev); } catch (err) { reportSwallowed('ws.mux.message', err); }
      return;
    }
    _fire(fac, name, { data });
  }

  function _clearAck(fac) { if (fac._ackTimer) { clearT(fac._ackTimer); fac._ackTimer = null; } }

  // ── public open ──────────────────────────────────────────────────────────────
  function open(url) {
    _diag('open', { url, dead, sockState: sock ? sock.state : null, facades: facades.size });
    const fac = createFacade(url);
    facades.add(fac);
    if (dead === 'capability') { _diag('open→es(capability-dead)', { url }); _openNative(fac); return fac; }
    // A socket mid-transient-reconnect is still the mux path: queue the facade onto the
    // pending reconnect rather than spawning a second socket or wrongly downgrading to SSE.
    if (sock && sock.state === 'reconnecting') {
      _diag('open→pendingMigrate', { url });
      fac._backend = 'mux';
      fac._streamId = mintStreamId();
      fac.readyState = ES_CONNECTING;
      pendingMigrate.add(fac);
      return fac;
    }
    if (!_ensureSocket()) { _diag('open→es(ensure-socket-failed)', { url }); _openNative(fac); return fac; }
    _attachMux(fac);
    _diag('open→mux', { url, streamId: fac._streamId, sockState: sock.state });
    return fac;
  }

  function _attachMux(fac) {
    fac._backend = 'mux';
    fac._streamId = mintStreamId();
    fac.readyState = ES_CONNECTING;
    sock.streams.set(fac._streamId, fac);
    if (sock.state === 'open') {
      _sendOpen(fac);
      _armAck(fac);
    }
    // If the socket is still 'connecting', the open frame is flushed on socket open (below).
  }

  function _armAck(fac) {
    _clearAck(fac);
    const ms = _probeCached() ? ACK_MS_CACHED : ACK_MS_PROBE;
    fac._ackTimer = setT(() => {
      fac._ackTimer = null;
      // ack timeout is a PER-STREAM signal (a cold-load burst can delay an ack) — fall back
      // only this stream, never the whole page.
      _fallbackStream(fac, 'ack-timeout');
    }, ms);
  }

  // ── mux backend ──────────────────────────────────────────────────────────────
  function _ensureSocket(retryCount = 0) {
    if (sock && (sock.state === 'connecting' || sock.state === 'open')) return true;
    const url = socketUrl();
    if (!url) return false;
    let Ctor;
    try {
      Ctor = WebSocketCtor();
      if (typeof Ctor !== 'function') return _capabilityFallback('no-ctor'), false;
    } catch { return _capabilityFallback('no-ctor'), false; }
    let ws;
    try {
      ws = new Ctor(url);
    } catch (err) {
      _capabilityFallback('ctor-throw', err);
      return false;
    }
    // Capture THIS socket in the closures: `sock` is reassigned on reconnect, so the old
    // socket's late callbacks must not touch the new socket's state. The `sock !== s` guard
    // makes every stale callback a no-op.
    //   everOpened:       this socket reached OPEN at least once (distinguishes a runtime drop
    //                     from a first-dial failure).
    //   retry:            position in the current transient-reconnect chain (carried across dials).
    //   intentionalClose: we closed it (watchdog / closeAll) — its onclose must NOT be read as
    //                     a capability signal.
    const s = { ws, state: 'connecting', retry: retryCount, everOpened: false, intentionalClose: false, lastInboundAt: now(), watchdogTimer: null, streams: new Map(), deadlineTimer: null };
    sock = s;
    // Connection-level deadline (P1: a blackholed upgrade — TCP connects but the WS handshake
    // never completes — must not hang every facade until the browser's own timeout). A timeout
    // is a capability signal ONLY on a first-ever dial of a page that has NEVER proven the mux
    // works; otherwise (reconnect dial, or a page that has seen the mux serve) it's transient.
    s.deadlineTimer = setT(() => {
      if (sock !== s || s.state === 'open') return;
      _diagWarn('dial-timeout', { retry: s.retry, everOpened: s.everOpened, everProven });
      if (s.retry === 0 && !s.everOpened && !everProven) _capabilityFallback('dial-timeout');
      else { try { ws.close(); } catch { /* benign */ } }
    }, DIAL_TIMEOUT_MS);
    ws.onopen = () => {
      if (sock !== s) return;
      _diag('socket.onopen', { retry: s.retry, everProven, extensions: ws.extensions || null });
      if (s.deadlineTimer) { clearT(s.deadlineTimer); s.deadlineTimer = null; }
      s.state = 'open';
      s.everOpened = true;
      everProven = true;   // page-level: the mux has demonstrably served this page
      s.lastInboundAt = now();
      // Flush every facade registered on this socket (attached while connecting / migrated).
      for (const f of s.streams.values()) { _sendOpen(f); _armAck(f); }
      _armWatchdog();
    };
    ws.onmessage = (ev) => {
      if (sock !== s) return;
      s.lastInboundAt = now();
      // [ws.mux.diag] The flag check is inlined here so the per-frame slice/allocation
      // only happens when the gate is open — the cold-load burst is thousands of frames.
      if (_diagEnabled) _diag('socket.onmessage', { bytes: (typeof ev.data === 'string' ? ev.data.length : 0), head: (typeof ev.data === 'string' ? ev.data.slice(0, 60) : '<binary>') });
      _onSocketMessage(ev);
    };
    ws.onerror = (ev) => {
      if (sock !== s) return;
      _diagWarn('socket.onerror', { everOpened: s.everOpened, retry: s.retry, everProven, type: ev?.type });
      // A failure before THIS page's first successful open AND while the mux has never been
      // proven is the capability signal (upgrade refused / no /ws/mux route). Any failure once
      // the mux has proven itself (or mid-reconnect-chain) is one transient attempt.
      if (!s.everOpened && s.retry === 0 && !everProven) _capabilityFallback('handshake-error');
      else _onTransientDrop();
    };
    ws.onclose = (ev) => {
      if (sock !== s || dead === 'capability') return;
      _diagWarn('socket.onclose', { code: ev?.code, reason: ev?.reason || '', state: s.state, everOpened: s.everOpened, retry: s.retry, everProven });
      // Intentional close (watchdog/closeAll) or an already-handled drop → not a capability read.
      if (s.state === 'reconnecting') return;   // MUTANT: intentionalClose guard removed
      if (!s.everOpened && s.retry === 0 && !everProven) { _capabilityFallback('handshake-close'); return; }
      _onTransientDrop();
    };
    return true;
  }

  function _sendOpen(fac) {
    const qs = fac.url.includes('?') ? fac.url.slice(fac.url.indexOf('?') + 1) : '';
    _send({ type: 'open', streamId: fac._streamId, qs });
  }
  function _sendClose(fac) {
    if (sock && sock.state === 'open' && fac._streamId) _send({ type: 'close', streamId: fac._streamId });
  }
  function _send(msg) {
    if (!sock || sock.ws.readyState !== 1) return;
    try { sock.ws.send(JSON.stringify(msg)); } catch (err) { reportSwallowed('ws.mux.send', err); }
  }

  function _onSocketMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (err) { reportSwallowed('ws.decode', err); return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'ping') {
      _diag('ping', { facades: facades.size, muxOpen: [...facades].filter((f) => f._backend === 'mux' && f.readyState !== ES_CLOSED).length });
      _send({ type: 'pong', ts: now() });
      // Fan the server keepalive out per-stream as a synthetic 'ping' named frame so the
      // manager's 45s watchdog is fed for every idle mux channel (mirrors SSE event: ping).
      for (const f of facades) if (f._backend === 'mux' && f.readyState !== ES_CLOSED) _fire(f, 'ping', { data: '{}' });
      return;
    }
    if (msg.type === 'open-ack') {
      const fac = sock.streams.get(msg.streamId);
      if (!fac) { _diagWarn('open-ack.orphan', { streamId: msg.streamId, streams: [...sock.streams.keys()] }); return; }
      _clearAck(fac);
      _diag('open-ack', { streamId: msg.streamId, epoch: msg.epoch });
      // Reset the per-stream dedup cursor on ack. Dedup is keyed on the per-stream seq alone:
      // streamId is re-minted on every (re)connect so a replayed frame from a prior incarnation
      // can never collide; epoch is recorded for diagnostics only (a future cross-socket replay
      // would key on (epoch, streamId)).
      fac._cursor.epoch = msg.epoch;
      fac._cursor.lastSeq = 0;
      fac.readyState = ES_OPEN;
      _probeOk();
      try { fac.onopen?.(); } catch (err) { reportSwallowed('ws.mux.onopen', err); }
      return;
    }
    if (msg.type === 'frame') {
      const fac = sock.streams.get(msg.streamId);
      if (!fac) { _diagWarn('frame.orphan', { streamId: msg.streamId, name: msg.name, seq: msg.seq, streams: [...sock.streams.keys()].length }); return; }
      if (fac.readyState === ES_CLOSED) { _diagWarn('frame.closed-facade', { streamId: msg.streamId, name: msg.name, seq: msg.seq }); return; }
      // Cursor non-regression guard (defensive; TCP is ordered): drop a replayed frame.
      if (typeof msg.seq === 'number' && msg.seq <= fac._cursor.lastSeq && fac._cursor.lastSeq !== 0) { _diagWarn('frame.dup', { streamId: msg.streamId, name: msg.name, seq: msg.seq, lastSeq: fac._cursor.lastSeq }); return; }
      if (typeof msg.seq === 'number') fac._cursor.lastSeq = msg.seq;
      _dispatch(fac, msg.name, msg.data);
      return;
    }
    if (msg.type === 'error') {
      const fac = msg.streamId ? sock.streams.get(msg.streamId) : null;
      reportSwallowed('ws.error-frame', new Error(`mux error ${msg.code}`), { code: msg.code });
      // Per-stream errors (4503 scope / 4429 limit) fall back ONLY that stream.
      if (fac) _fallbackStream(fac, `error-${msg.code}`);
      return;
    }
    if (msg.type === 'close') {
      // Server-initiated stream close (e.g. a 30s backpressure eviction): like an SSE res.end(),
      // reopen ONLY this stream so the channel does not freeze silently. Reopen via a native
      // EventSource on the same url (the cursor makes the resume gap-free).
      const fac = msg.streamId ? sock.streams.get(msg.streamId) : null;
      if (fac) _fallbackStream(fac, 'server-close');
      return;
    }
  }

  // ── fallback state machine ───────────────────────────────────────────────────
  /** CAPABILITY fallback: the mux cannot serve at all. Reopen every mux facade as a native
   *  EventSource and route all future opens straight to SSE. In-memory only — a reload re-probes. */
  function _capabilityFallback(reason, err) {
    if (dead === 'capability') return;
    dead = 'capability';
    _probeClear();
    _diagWarn('capability-fallback', { reason, err: err ? String(err && err.message || err) : null });
    reportSwallowed('ws.mux.fallback', err || new Error(`capability:${reason}`));
    const s = sock;
    sock = null;
    if (s) {
      s.intentionalClose = true;
      if (s.watchdogTimer) clearT(s.watchdogTimer);
      if (s.deadlineTimer) clearT(s.deadlineTimer);
      try { s.ws.close(); } catch { /* already gone */ }
    }
    // Any facade queued on a pending reconnect also falls back now.
    for (const fac of [...pendingMigrate]) { pendingMigrate.delete(fac); if (fac.readyState !== ES_CLOSED) _openNative(fac); }
    for (const fac of [...facades]) {
      if (fac._backend === 'mux' && fac.readyState !== ES_CLOSED) _openNative(fac);
    }
  }

  /** PER-STREAM fallback: only this stream reopens as a native EventSource. */
  function _fallbackStream(fac, reason) {
    if (fac._backend !== 'mux' || fac.readyState === ES_CLOSED) return;
    _diagWarn('fallback-stream', { reason, streamId: fac._streamId, url: fac.url });
    reportSwallowed('ws.mux.fallback', new Error(`stream:${reason}`));
    // Release the server-side stream before detaching (else it leaks a slot in
    // MAX_STREAMS_PER_SOCKET and keeps being broadcast to a streamId nobody reads, while a
    // duplicate SSE serve starts for the same scope). closeStream on the server is idempotent.
    if (sock && sock.ws.readyState === 1 && fac._streamId) _send({ type: 'close', streamId: fac._streamId });
    _detachFromSocket(fac);
    _openNative(fac);
  }

  /** TRANSIENT drop: a healthy socket died. Retry WS a few times; on exhaustion hand every
   *  mux facade back to the manager (CLOSED + onerror) so its heartbeat builds a fresh cursor. */
  function _onTransientDrop() {
    const s = sock;
    if (!s || s.state === 'reconnecting') return;   // already handling this drop
    _diagWarn('transient-drop', { retry: s.retry, everOpened: s.everOpened, streams: s.streams.size, idleFor: now() - s.lastInboundAt });
    if (s.watchdogTimer) { clearT(s.watchdogTimer); s.watchdogTimer = null; }
    if (s.deadlineTimer) { clearT(s.deadlineTimer); s.deadlineTimer = null; }
    s.retry += 1;
    // Snapshot the facades to migrate BEFORE detaching the socket, and clear their ack timers
    // so a stale ack deadline can't fire mid-reconnect and push a stream to SSE prematurely.
    const toMigrate = [...s.streams.values()].filter((f) => f._backend === 'mux' && f.readyState !== ES_CLOSED);
    for (const f of toMigrate) _clearAck(f);
    if (s.retry > RECONNECT_BUDGET) {
      // Hand back to the manager: report CLOSED + onerror per facade so its heartbeat/reconnect
      // path generates a FRESH since/cc cursor url (which may pick WS again). Not a downgrade.
      // onRuntimeFallback lets the app rebuild the channel immediately rather than wait 45s.
      sock = null;
      for (const fac of toMigrate) {
        fac._streamId = null;
        facades.delete(fac);          // don't leak a CLOSED facade in the live set
        if (fac.readyState !== ES_CLOSED) {
          fac.readyState = ES_CLOSED;
          try { onRuntimeFallback?.(fac); } catch (err) { reportSwallowed('ws.mux.fallback-cb', err); }
          try { fac.onerror?.({ type: 'error' }); } catch (err) { reportSwallowed('ws.mux.onerror', err); }
        }
      }
      return;
    }
    s.state = 'reconnecting';
    for (const f of toMigrate) f.readyState = ES_CONNECTING;
    const retrySoFar = s.retry;
    // Recreate the socket after backoff; on open, re-open every migrated facade on the SAME url
    // (parity with a native EventSource auto-reconnect; resume is via the since/cc in that url).
    setT(() => {
      // Ownership guard: if a NEWER socket already exists (a facade opened during the backoff
      // window and _ensureSocket built one), don't orphan it — migrate onto the current socket
      // instead of clobbering sock back to null.
      const facs = toMigrate.filter((f) => f._backend === 'mux' && f.readyState !== ES_CLOSED);
      for (const f of pendingMigrate) if (f._backend === 'mux' && f.readyState !== ES_CLOSED) facs.push(f);
      pendingMigrate.clear();
      if (sock && sock !== s && (sock.state === 'open' || sock.state === 'connecting')) {
        // A live socket already materialized during the window: attach the migrated facades to it.
        for (const f of facs) {
          f._streamId = mintStreamId();
          sock.streams.set(f._streamId, f);
          if (sock.state === 'open') { _sendOpen(f); _armAck(f); }
        }
        return;
      }
      if (sock === s || !sock) sock = null;
      if (!facs.length) return;
      if (!_ensureSocket(retrySoFar)) {
        // _ensureSocket failed: either it already ran a capability fallback (facades reopened as
        // ES there), or socketUrl() returned null (no usable ws URL — e.g. a test shim without
        // location.host). In the latter case dead is still null and nothing reopened the facades,
        // so fall each back to a native EventSource here rather than leaving them stuck CONNECTING.
        if (dead !== 'capability') {
          for (const f of facs) if (f._backend === 'mux' && f.readyState !== ES_CLOSED) _openNative(f);
        }
        return;
      }
      // Register the facades on the NEW socket; ws.onopen flushes an open frame per facade.
      for (const f of facs) {
        f._streamId = mintStreamId();
        sock.streams.set(f._streamId, f);
      }
    }, reconnectBackoff(s.retry));
  }

  function _detachFromSocket(fac) {
    if (sock && fac._streamId) sock.streams.delete(fac._streamId);
    pendingMigrate.delete(fac);
    // Also remove from any stale socket snapshot held during a reconnect window.
    fac._streamId = null;
  }

  function _openNative(fac) {
    _clearAck(fac);
    _diag('open-native', { url: fac.url, backend: fac._backend, streamId: fac._streamId });
    fac._backend = 'es';
    const es = openEventSource(fac.url);   // SAME url → same scope/since/cc semantics
    fac._es = es;
    fac.readyState = ES_CONNECTING;
    es.onopen = () => {
      if (fac.readyState === ES_CLOSED) return;
      fac.readyState = ES_OPEN;
      try { fac.onopen?.(); } catch (err) { reportSwallowed('ws.mux.onopen', err); }
    };
    es.onmessage = (e) => _dispatch(fac, 'message', e.data);
    es.onerror = (e) => {
      if (fac.readyState === ES_CLOSED) return;
      fac.readyState = es.readyState === 2 ? ES_CLOSED : ES_CONNECTING;
      try { fac.onerror?.(e); } catch (err) { reportSwallowed('ws.mux.onerror', err); }
    };
    for (const name of fac._listeners.keys()) es.addEventListener(name, _esProxy(fac, name));
  }

  function _esProxy(fac, name) {
    let p = fac._esProxies.get(name);
    if (!p) { p = (e) => _dispatch(fac, name, e.data); fac._esProxies.set(name, p); }
    return p;
  }

  // ── socket watchdog (TRANSIENT only — never a capability downgrade) ──────────
  function _armWatchdog() {
    if (!sock || sock.state !== 'open') return;
    if (sock.watchdogTimer) clearT(sock.watchdogTimer);
    sock.watchdogTimer = setT(_watchdogTick, WATCHDOG_TICK_MS);
  }
  function _watchdogTick() {
    if (!sock || sock.state !== 'open' || dead === 'capability') return;
    if (now() - sock.lastInboundAt > SOCKET_IDLE_MS) {
      // Server-initiated frames (incl. the 25s ping) have stopped: the data path may be wedged
      // even though TCP looks alive. Treat as a transient drop → reconnect, never a downgrade.
      // Mark the close as intentional BEFORE closing. The browser delivers onclose
      // ASYNCHRONOUSLY; by then state is already 'reconnecting' (the synchronous _onTransientDrop
      // below ran first), so the onclose 'reconnecting' guard is the primary protection against
      // misreading it as a capability failure. This flag is belt-and-suspenders defense for the
      // residual ordering where onclose lands while state is still 'open'.
      const s = sock;
      s.intentionalClose = true;
      _diagWarn('watchdog.idle-timeout', { idleFor: now() - s.lastInboundAt, streams: s.streams.size });
      try { s.ws.close(); } catch { /* benign */ }
      _onTransientDrop();
      return;
    }
    _armWatchdog();
  }

  function closeAll() {
    for (const fac of [...facades]) fac.close();
    for (const fac of [...pendingMigrate]) { pendingMigrate.delete(fac); fac.close(); }
    if (sock) {
      sock.intentionalClose = true;
      if (sock.watchdogTimer) clearT(sock.watchdogTimer);
      if (sock.deadlineTimer) clearT(sock.deadlineTimer);
      try { sock.ws.close(1000, 'client-close'); } catch { /* benign */ }
      sock = null;
    }
  }

  return { open, closeAll, _facades: facades, _getDead: () => dead, _getSock: () => sock };
}
