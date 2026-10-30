/**
 * Per-workspace SSE channel manager (2026-10).
 *
 * Replaces AppBase's single re-scoped EventSource with one persistent
 * EventSource per scope ('bound' | 'project:<p>' | 'project:<p>\x00<inst>' |
 * 'sid:<uuid>'). A channel owns its connection, generation token, heartbeat
 * watchdog and reconnect budget; the VIEW only chooses which channel's state
 * is rendered. Switching to a warm channel is then a state swap — no teardown,
 * no cold load, and no cross-workspace state entangling on one connection.
 *
 * Capped (default 3: the rendered channel + the bound channel + the most-recent
 * parallel view) because the server is HTTP/1.1 and a browser caps ~6
 * connections per origin per profile (shared across tabs). The LRU never
 * evicts the rendered or the bound channel; an evicted channel is snapshotted
 * by the caller (viewStateCache) via onEvict so a later return still hits the
 * incremental resume path.
 *
 * Framework-free with injectable EventSource factory + timers so the whole
 * lifecycle is node-testable (house precedent: utils/viewStateCache.js).
 */

export const BOUND_CHANNEL_KEY = 'bound';

/** Canonical channel key for a view scope. */
export function scopeKeyFor({ sid, project, instance } = {}) {
  if (sid) return `sid:${sid}`;
  if (project) return instance ? `project:${project}\x00${instance}` : `project:${project}`;
  return BOUND_CHANNEL_KEY;
}

/** Inverse of scopeKeyFor (for logs / scope display). */
export function scopeOfKey(key) {
  if (typeof key !== 'string' || !key || key === BOUND_CHANNEL_KEY) return { sid: null, project: null, instance: null };
  if (key.startsWith('sid:')) return { sid: key.slice(4), project: null, instance: null };
  if (key.startsWith('project:')) {
    const rest = key.slice(8);
    const at = rest.indexOf('\x00');
    return at === -1
      ? { sid: null, project: rest, instance: null }
      : { sid: null, project: rest.slice(0, at), instance: rest.slice(at + 1) || null };
  }
  return { sid: null, project: null, instance: null };
}

export function createChannelManager({
  openEventSource,              // (url) => EventSource-like; default globalThis.EventSource
  handlers = {},                // { onCreate(key, scope) -> vm, onFrame(channel, name, event), onOpen(channel), onError(channel), onHeartbeatTimeout(channel) }
  maxChannels = 3,
  heartbeatMs = 45000,
  reconnectBudget = 10,
  // Fixed cadence kept alive AFTER the reconnect budget is spent, so a long
  // outage still heals without hammering the server (see reconnect()).
  slowRetryMs = 30000,
  backoff = (n, index) => Math.min(2000 * Math.pow(2, n - 1), 32000) + index * 250,
  onEvict = () => {},
  // One-shot notice per exhaustion cycle (re-armed by es.onopen).
  onReconnectExhausted = () => {},
  setTimeout: _setTimeout,
  clearTimeout: _clearTimeout,
} = {}) {
  const setT = typeof _setTimeout === 'function' ? _setTimeout : setTimeout;
  const clearT = typeof _clearTimeout === 'function' ? _clearTimeout : clearTimeout;
  const openES = typeof openEventSource === 'function'
    ? openEventSource
    : (url) => new globalThis.EventSource(url);

  /** @type {Map<string, object>} insertion order doubles as LRU order */
  const channels = new Map();
  let renderedKey = null;

  function _newChannel(key, url, scope = null) {
    // Prefer the caller-supplied scope over reverse-parsing the key: a `sid:`
    // key carries no project/instance, so scopeOfKey would null them out and
    // every scope read (stream-progress gate, reconnect URL, workflow filter)
    // would then fall back to the BOUND project — wrong for a parallel-view sid
    // attach. The key stays the identity; the scope is what the producer sees.
    const resolvedScope = scope || scopeOfKey(key);
    const ch = {
      key,
      scope: resolvedScope,
      es: null,
      url: url || null,
      gen: 0,
      reconnectCount: 0,
      heartbeatTimer: null,
      reconnectTimer: null,
      slowRetryTimer: null,
      exhaustedNotified: false,
      lastFrameAt: 0,
      closed: false,
      vm: typeof handlers.onCreate === 'function' ? handlers.onCreate(key, resolvedScope) : {},
    };
    if (url) _connect(ch, url);
    return ch;
  }

  function _connect(ch, url) {
    // A fresh connect supersedes ANY pending retry (post-exhaustion slow retry or a
    // budget backoff): otherwise the stale timer would open a second socket.
    if (ch.slowRetryTimer) { clearT(ch.slowRetryTimer); ch.slowRetryTimer = null; }
    if (ch.reconnectTimer) { clearT(ch.reconnectTimer); ch.reconnectTimer = null; }
    _closeSocket(ch);
    ch.gen += 1;
    ch.url = url;
    ch.closed = false;
    const gen = ch.gen;
    const es = openES(url);
    ch.es = es;
    const stale = () => gen !== ch.gen || ch.closed;
    es.onmessage = (event) => {
      if (stale()) return;
      _touch(ch);
      handlers.onFrame?.(ch, 'message', event);
    };
    // Named SSE events: the manager dispatches every addEventListener the app
    // registers through a single onFrame(name) — AppBase keeps its per-event
    // handlers, now channel-aware.
    if (typeof handlers.onBind === 'function') handlers.onBind(ch, es, stale);
    es.onopen = () => {
      if (stale()) return;
      // A live socket restores the full budget and supersedes the slow retry.
      ch.reconnectCount = 0;
      ch.exhaustedNotified = false;
      if (ch.slowRetryTimer) { clearT(ch.slowRetryTimer); ch.slowRetryTimer = null; }
      _touch(ch);
      handlers.onOpen?.(ch);
    };
    es.onerror = () => {
      if (stale()) return;
      handlers.onError?.(ch);
    };
    _armHeartbeat(ch);
  }

  function _closeSocket(ch) {
    if (ch.es) {
      try { ch.es.close?.(); } catch {}
      ch.es = null;
    }
  }

  function _armHeartbeat(ch) {
    if (ch.heartbeatTimer) clearT(ch.heartbeatTimer);
    ch.heartbeatTimer = setT(() => {
      ch.heartbeatTimer = null;
      if (ch.closed) return;
      handlers.onHeartbeatTimeout?.(ch);
    }, heartbeatMs);
  }

  function _touch(ch) {
    ch.lastFrameAt = Date.now();
    _armHeartbeat(ch);
  }

  /** Get (never creates). */
  function get(key) { return channels.get(key) || null; }
  function keys() { return [...channels.keys()]; }
  function genOf(key) { const ch = channels.get(key); return ch ? ch.gen : -1; }
  function setRendered(key) { if (channels.has(key)) renderedKey = key; }
  function getRendered() { return renderedKey ? channels.get(renderedKey) || null : null; }

  /**
   * Get-or-create a channel, starting its connection when new. Evicts the
   * least-recently-used channel that is neither the rendered nor the bound one
   * when over cap.
   *
   * `rendered: true` marks the key as the render target BEFORE the over-cap
   * eviction pass. Without it, creating a channel while a DIFFERENT key is
   * still marked rendered leaves both the old rendered channel and the bound
   * channel protected, so the eviction pass picks the freshly created channel
   * itself — closing it under the caller's feet. With the flag, the demoted
   * previous rendered channel is the victim (the intended LRU semantics).
   */
  function ensure(key, { url, cold = false, rendered = false, scope = null } = {}) {
    if (rendered) renderedKey = key;
    let ch = channels.get(key);
    if (ch) {
      // refresh recency
      channels.delete(key);
      channels.set(key, ch);
      if (url && cold) _connect(ch, url);
      return ch;
    }
    ch = _newChannel(key, url, scope);
    channels.set(key, ch);
    _evictIfNeeded();
    return ch;
  }

  function _evictIfNeeded() {
    while (channels.size > maxChannels) {
      let victimKey = null;
      for (const k of channels.keys()) {
        if (k === renderedKey) continue;
        if (k === BOUND_CHANNEL_KEY) continue;
        victimKey = k;
        break;
      }
      if (victimKey === null) break; // only rendered/bound left — never evict
      const victim = channels.get(victimKey);
      close(victimKey);
      onEvict(victim);
    }
  }

  /** Reconnect a channel (heartbeat timeout / explicit). Budget-limited; once
   *  the budget is spent, keep probing on a fixed slow cadence instead of
   *  giving up forever, and notify the caller once per exhaustion cycle. */
  function reconnect(key, { url } = {}) {
    const ch = channels.get(key);
    if (!ch) return false;
    if (ch.reconnectCount >= reconnectBudget) {
      // Honor the caller's freshest URL (the incremental ?since= cursor) — reconnecting
      // on the URL from several backoffs ago would re-replay an oversized/cold range.
      if (url) ch.url = url;
      if (!ch.exhaustedNotified) {
        ch.exhaustedNotified = true;
        onReconnectExhausted(ch);
      }
      if (!ch.slowRetryTimer) {
        // Call _connect DIRECTLY: reconnect() would only re-check (and keep
        // failing) the spent budget.
        ch.slowRetryTimer = setT(() => {
          ch.slowRetryTimer = null;
          if (!ch.closed) _connect(ch, ch.url);
        }, slowRetryMs);
      }
      return false; // caller contract preserved — waited out, not connected now
    }
    ch.reconnectCount += 1;
    ch.vm.reconnectsSinceCommit = (ch.vm.reconnectsSinceCommit || 0) + 1;
    if (ch.reconnectTimer) clearT(ch.reconnectTimer);
    const delay = backoff(ch.reconnectCount, channels.size);
    ch.reconnectTimer = setT(() => {
      ch.reconnectTimer = null;
      if (ch.closed) return;
      _connect(ch, url || ch.url);
    }, delay);
    return true;
  }

  /**
   * Mark a channel alive without a `data:` frame (the manager only sees
   * onmessage): a named SSE event arrived on its socket — refresh lastFrameAt
   * and re-arm the heartbeat watchdog. Returns false when the channel is gone.
   */
  function touch(key) {
    const ch = channels.get(key);
    if (!ch) return false;
    _touch(ch);
    return true;
  }

  /** Close one channel: socket + timers; the caller snapshots via onEvict. */
  function close(key) {
    const ch = channels.get(key);
    if (!ch) return false;
    ch.closed = true;
    _closeSocket(ch);
    if (ch.heartbeatTimer) { clearT(ch.heartbeatTimer); ch.heartbeatTimer = null; }
    if (ch.reconnectTimer) { clearT(ch.reconnectTimer); ch.reconnectTimer = null; }
    if (ch.slowRetryTimer) { clearT(ch.slowRetryTimer); ch.slowRetryTimer = null; }
    channels.delete(key);
    if (renderedKey === key) renderedKey = null;
    return true;
  }

  function closeAll() {
    for (const key of [...channels.keys()]) close(key);
  }

  return {
    ensure, get, keys, genOf, setRendered, getRendered,
    reconnect, close, closeAll, touch,
    _channels: channels, // introspection for tests
    get renderedKey() { return renderedKey; },
  };
}
