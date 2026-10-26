/**
 * chat-queue.js — Server-side busy queue for chat-composer messages (PTY / terminal-hidden mode).
 *
 * When Claude is mid-run and the user presses Enter in the web chat composer, the message is
 * held here instead of being typed into the TUI immediately. The server broadcasts the queue
 * (`queue-state`) so every client can render floating bubbles above the composer, and drains
 * the queue into the PTY (bracketed paste + Enter) once the turn really ends.
 *
 * Queue status is server-authoritative: snapshot items are `queued` until the dispatcher takes
 * one, then `dispatching` until the paste write completes. A single dispatch slot owns the
 * item currently being interrupted/awaited/written, so a dispatching bubble stays visible and
 * cannot be removed or re-sent by a second click; if dispatch fails it returns to its original
 * FIFO position. Snapshot items also carry their sanitized anchor (project/sessionId/
 * instanceKey) so views can filter per scope; every item-triggered broadcast repeats that
 * scope on the message and passes the public item as the optional second `broadcastWs` arg
 * (the server-side callback is upgraded separately).
 *
 * Per-bubble actions:
 * - "Send now" (queue-send-now) interrupts the running turn (focus-in + ESC, same bytes as the
 *   web Stop button) and injects that message as soon as the TUI is observably idle.
 * - "Remove" (queue-remove) drops it — except while it is dispatching.
 * Stop keeps the queue parked (product decision): `suppressNextDrain()` blocks the automatic
 * turn-end drain until a NEW turn starts (streaming rising edge) or a message is sent now.
 *
 * Design notes:
 * - This module NEVER imports pty-manager / server.js. All PTY access + state probes are
 *   injected via initChatQueue(deps), so unit tests run without node-pty (im-bridge-core
 *   convention).
 * - Injection is single-flight (`_injecting`) and mutually exclusive with the IM bridge's
 *   own injection slot via the injected `hasExternalInjection` probe (im-bridge-core's
 *   anyActiveInjection).
 * - Known limitation: keystrokes typed directly into a VISIBLE terminal are not serialized
 *   against an in-flight inject (same accepted risk class as the IM bridge today).
 */

import { reportSwallowed } from '../lib/error-report.js';
import { bracketPasteSubmit, sanitizeInbound } from './im/im-bridge-core.js';

const MAX_ITEMS = 50;             // im-bridge-core MAX_QUEUE parity
const STOP_ESC_DELAY_MS = 50;     // focus-in → ESC gap, mirrors ChatView's STOP_FOCUS_IN_ESC_DELAY_MS
const INJECT_POLL_MS = 100;       // idle poll cadence before injecting
const INJECT_POLL_MAX_MS = 2000;  // give up polling after this; NEVER inject unconditionally
const RESCUE_AFTER_MS = 3000;     // stale-busy rescue: frontend guessed busy while the turn already ended

// Anchor fields exposed on snapshots / broadcasts. strictAnchor (scheduled tasks) is an
// internal write-path flag and must never leak into client-visible state.
const SCOPE_KEYS = ['project', 'sessionId', 'instanceKey'];

// Injected deps (see initChatQueue). Null until wired; every public entry no-ops safely then.
let _deps = null;
let _items = [];            // [{ id, text, ts, anchor }] queued FIFO (dispatching item is NOT here)
let _dispatch = null;       // { item, index } single dispatch slot: at most one item is dispatching
let _injecting = false;     // single-flight guard around one bracket-paste inject sequence
let _rescueTimer = null;    // stale-busy rescue timer
let _pollTimer = null;      // active idle-poll interval (single slot — see _pollUntilSafe)
let _escTimer = null;       // sendNow's focus-in → ESC gap timer
let _suppressDrain = false; // Stop pressed → park the queue until a new turn starts
let _gen = 0;               // generation counter: clear()/stop() invalidate in-flight injects

/**
 * @param {object} deps
 * @param {function} deps.writeToPty — (data:string) => void
 * @param {function} deps.writeToPtySequential — (chunks:string[], onComplete:(ok:boolean)=>void, opts?) => void
 * @param {function} [deps.writeToPtySequentialFor] — anchor-routed variant (strict scheduled tasks)
 * @param {function} deps.getPtyKind — () => 'claude' | 'shell' | null
 * @param {function} deps.isStreaming — () => boolean (per-API-call streaming flag; flickers between tool calls)
 * @param {function} deps.hasPendingApproval — () => boolean (web-visible ask/perm modal open)
 * @param {function} [deps.hasExternalInjection] — () => boolean (IM bridge injection slot busy)
 * @param {function} [deps.hasLivePtyFor] — (anchor) => boolean|undefined; false only when
 *   the exact target is provably dead. Unknown/unavailable means a transient write failure.
 * @param {function} deps.broadcastWs — (msg:object, item?:object) => void
 *   `item` is the sanitized snapshot item that triggered the change (routing hint for the
 *   per-view broadcast upgrade); the message itself carries `scope` when one is known.
 */
export function initChatQueue(deps) {
  _deps = deps;
}

function _normalizeScope(anchor) {
  const scope = {};
  if (!anchor || typeof anchor !== 'object') return scope;
  for (const key of SCOPE_KEYS) {
    if (typeof anchor[key] === 'string' && anchor[key]) scope[key] = anchor[key];
  }
  return scope;
}

function _hasScope(scope) {
  return SCOPE_KEYS.some((key) => !!scope[key]);
}

/** Public (sanitized) scope of an item; null when the item carries no usable anchor. */
function _scopeOf(item) {
  const scope = _normalizeScope(item && item.anchor);
  return _hasScope(scope) ? scope : null;
}

/** A scope filter matches when every supplied field matches (instanceKey narrows project). */
function _matchesScope(itemAnchor, filter) {
  const scopeFilter = filter || {};
  const itemScope = _normalizeScope(itemAnchor);
  if (scopeFilter.project && itemScope.project !== scopeFilter.project) return false;
  if (scopeFilter.sessionId && itemScope.sessionId !== scopeFilter.sessionId) return false;
  if (!scopeFilter.instanceKey || !itemScope.instanceKey) return true;
  return itemScope.instanceKey === scopeFilter.instanceKey;
}

/** Snapshot shape: public fields + derived status + sanitized anchor, never internal flags. */
function _publicItem(item, status) {
  return {
    id: item.id,
    text: item.text,
    ts: item.ts,
    status,
    anchor: _scopeOf(item),
  };
}

/**
 * Server-authoritative queue snapshot. `anchor` optionally filters to one view scope (all
 * supplied fields must match; unscoped items never match a scoped filter). Default call keeps
 * the historical "whole queue" behavior. The dispatching item stays in FIFO position with
 * status 'dispatching'; the rest are 'queued'.
 */
export function getSnapshot(anchor) {
  const filter = _normalizeScope(anchor);
  const scoped = _hasScope(filter);
  const include = (item) => !scoped || _matchesScope(item.anchor, filter);
  const snapshot = _items.filter(include).map((item) => _publicItem(item, 'queued'));
  if (!_dispatch || !include(_dispatch.item)) return snapshot;
  const before = _items.slice(0, _dispatch.index).filter(include).length;
  snapshot.splice(Math.max(0, Math.min(before, snapshot.length)), 0, _publicItem(_dispatch.item, 'dispatching'));
  return snapshot;
}

/**
 * Broadcast a queue-state frame. `triggerItem` supplies the item scope for per-view routing:
 * the scope is repeated on the message and the public item is passed as broadcastWs's optional
 * second argument. A trigger without an id (synthetic `{ anchor }`) contributes only the scope.
 */
function _broadcast(triggerItem, triggerStatus) {
  if (!_deps || !_deps.broadcastWs) return;
  const msg = { type: 'queue-state', items: getSnapshot() };
  const scope = _scopeOf(triggerItem);
  if (scope) msg.scope = scope;
  try {
    if (triggerItem && triggerItem.id) {
      _deps.broadcastWs(msg, _publicItem(triggerItem, triggerStatus || 'queued'));
    } else {
      _deps.broadcastWs(msg);
    }
  } catch (err) { reportSwallowed('chat-queue.broadcast', err); }
}

/** Negative ack (enqueue full / strict target gone), scoped to the affected item/anchor. */
function _broadcastRejected(reason, item, anchor) {
  if (!_deps || !_deps.broadcastWs) return;
  const scope = _normalizeScope(anchor || (item && item.anchor));
  const msg = { type: 'queue-rejected', reason };
  if (item && item.id) msg.id = item.id;
  if (_hasScope(scope)) msg.scope = scope;
  try {
    if (item && item.id) {
      _deps.broadcastWs(msg, _publicItem(item, 'queued'));
    } else {
      _deps.broadcastWs(msg);
    }
  } catch (err) { reportSwallowed('chat-queue.reject-broadcast', err); }
}

function _makeItem(text, anchor) {
  return {
    id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    text,
    ts: Date.now(),
    anchor: anchor || null,   // { project, sessionId, instanceKey[, strictAnchor] } (2026-10-05)
  };
}

function _clearRescueTimer() {
  if (_rescueTimer) { clearTimeout(_rescueTimer); _rescueTimer = null; }
}

function _clearPollTimer() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function _clearEscTimer() {
  if (_escTimer) { clearTimeout(_escTimer); _escTimer = null; }
}

/**
 * True only when injecting is observably safe: claude TUI (not a bare shell), no API call in
 * flight, no web-visible approval modal, no external (IM) injection holding the PTY.
 * NOTE: a TUI-native fallback question (ask-bridge terminal fallback) is invisible to
 * hasPendingApproval — which is why poll timeouts must NEVER fall through to an inject.
 * NOTE 2: `isStreaming` (streamingState.active) flickers false between tool calls mid-turn;
 * injecting into that gap is harmless (the TUI natively queues the paste) but it means an
 * "immediate" inject can land inside the current turn's chain — accepted risk class.
 * KNOWN LIMITATION (multi-project, 2026-10-05): the busy gate is global/bound-scoped —
 * `isStreaming` reads the bound project's streamingState and `getPtyKind` follows the
 * global active PTY, and `_items` is a single FIFO across projects. A message queued on
 * project A can be head-of-line blocked by (or misjudge the busyness of) project B.
 * Injection itself IS anchor-routed (item.anchor), so a queued message still lands on
 * the project it was written in; only the timing/busy heuristic is not per-project.
 * Per-project streaming state + queue isolation is a follow-up.
 */
function _safeToInject() {
  if (!_deps) return false;
  if (_injecting) return false;
  // A throwing probe means the wiring regressed — fail safe (no inject) but never silently:
  // an untagged swallow here would wedge the whole queue with no diagnostic.
  try { if (_deps.getPtyKind && _deps.getPtyKind() !== 'claude') return false; }
  catch (err) { reportSwallowed('chat-queue.probe', err); return false; }
  try { if (_deps.isStreaming && _deps.isStreaming()) return false; }
  catch (err) { reportSwallowed('chat-queue.probe', err); return false; }
  try { if (_deps.hasPendingApproval && _deps.hasPendingApproval()) return false; }
  catch (err) { reportSwallowed('chat-queue.probe', err); return false; }
  try { if (_deps.hasExternalInjection && _deps.hasExternalInjection()) return false; }
  catch (err) { reportSwallowed('chat-queue.probe', err); return false; }
  return true;
}

/**
 * Take an item out of the queued FIFO into the single dispatch slot and broadcast it as
 * 'dispatching' BEFORE any timer/write starts. `index` is its original FIFO position so a
 * failed dispatch can be restored there (never silently promoted to the head).
 */
function _startDispatch(item, index) {
  _dispatch = { item, index };
  _broadcast(item, 'dispatching');
}

/** Put the dispatching item back at its original FIFO position (poll timeout / write failure). */
function _restoreDispatch() {
  if (!_dispatch) return false;
  const { item, index } = _dispatch;
  _dispatch = null;
  const at = Math.max(0, Math.min(index, _items.length));
  _items.splice(at, 0, item);
  _broadcast(item, 'queued');
  return true;
}

function _targetGone(item) {
  if (item.anchor && item.anchor.strictAnchor) return true;
  if (!item.anchor || typeof _deps?.hasLivePtyFor !== 'function') return false;
  try { return _deps.hasLivePtyFor(item.anchor) === false; }
  catch (err) { reportSwallowed('chat-queue.liveness-probe', err); return false; }
}

/** Resolve a failed dispatch without resurrecting a superseded item or poisoning FIFO. */
function _failDispatch(item, gen, tag) {
  if (gen !== _gen || !_dispatch || _dispatch.item.id !== item.id) return;
  if (!_targetGone(item)) { _restoreDispatch(); return; }
  _dispatch = null;
  _broadcast(item, 'dispatching');
  reportSwallowed('chat-queue.target-gone', new Error('queued prompt target is no longer live'));
  _broadcastRejected('target-gone', item, item.anchor);
  if (tag === 'chat-queue.inject' && gen === _gen && !_suppressDrain && !_dispatch && !_injecting && !_pollTimer && !_escTimer) {
    _injectHead();
  }
}

/**
 * Write the dispatching item as bracket paste, then resolve the slot:
 * - success: remove it (dispatch slot cleared, snapshot rebroadcast),
 * - confirmed dead target: drop it and negatively ack instead of blocking other scopes,
 * - any other failure/throw: restore it to its original FIFO position.
 * A generation bump (clear/stop) invalidates the completion before any of the above.
 */
function _writeDispatch(item, gen, tag) {
  // Route the inject by the enqueueing client's anchor when one was captured,
  // so a message queued while viewing project A never lands in project B's PTY.
  // strictAnchor (scheduled tasks) additionally forbids the drain path's
  // project/active fallback: a dead explicit instance fails the write instead of
  // landing in the wrong conversation (review P0-2).
  const strict = !!(item.anchor && Object.keys(item.anchor).length > 0);
  const write = _deps.writeToPtySequentialFor && item.anchor
    ? (chunks, done, opts) => _deps.writeToPtySequentialFor(chunks, done, { ...(opts || {}), strict }, item.anchor)
    : _deps.writeToPtySequential;
  _injecting = true;
  try {
    write(bracketPasteSubmit(item.text), (ok) => {
      _injecting = false;
      if (gen !== _gen) return; // clear()/stop() mid-flight: never re-park into a fresh queue
      if (!_dispatch || _dispatch.item.id !== item.id) return;
      if (ok) {
        _dispatch = null;
        _broadcast(item, 'dispatching');
        return;
      }
      _failDispatch(item, gen, tag);
    }, { settleMs: 250 });
  } catch (err) {
    _injecting = false;
    _failDispatch(item, gen, tag);
    reportSwallowed(tag, err);
  }
}

/**
 * Inject the head item. Caller must have verified _safeToInject() first (except the internal
 * re-checks here, which keep this self-guarding for direct calls). The item moves into the
 * dispatch slot (and is broadcast as 'dispatching') before the PTY write starts; a failed
 * write restores it at the head.
 */
function _injectHead() {
  if (!_deps || _dispatch) return false;
  if (!_safeToInject()) return false;
  if (_items.length === 0) return false;
  const item = _items.shift();
  const gen = _gen;
  _startDispatch(item, 0);
  _writeDispatch(item, gen, 'chat-queue.inject');
  return true;
}

/**
 * Poll (≤ INJECT_POLL_MAX_MS) until _safeToInject(), then run fn. On timeout: do NOT inject —
 * invoke onTimeout instead (caller decides: keep queued / restore item). A timed-out blind
 * write could land in a TUI-native question prompt and be submitted as its answer.
 * Tick-counted (not Date-based) so mock.timers without Date mocking can drive it in tests.
 */
function _pollUntilSafe(fn, onTimeout) {
  _clearPollTimer();
  const maxTicks = Math.ceil(INJECT_POLL_MAX_MS / INJECT_POLL_MS);
  let ticks = 0;
  _pollTimer = setInterval(() => {
    ticks += 1;
    if (ticks > maxTicks) {
      _clearPollTimer();
      if (onTimeout) onTimeout();
      return;
    }
    if (!_safeToInject()) return;
    _clearPollTimer();
    fn();
  }, INJECT_POLL_MS);
  if (typeof _pollTimer.unref === 'function') _pollTimer.unref();
}

/**
 * Enqueue a chat-composer message (Claude believed busy). Sanitizes control bytes (a crafted
 * `\x1b[201~` would otherwise break the paste frame), broadcasts, and arms a rescue timer for
 * the stale-busy case (frontend's isStreaming lags the real turn end by up to its debounce).
 */
export function enqueue(text, anchor) {
  if (!_deps) return null;
  const clean = sanitizeInbound(text == null ? '' : String(text)).trim();
  if (!clean) return null;
  // The dispatch slot is still an outstanding message: count it against the cap.
  if (_items.length + (_dispatch ? 1 : 0) >= MAX_ITEMS) {
    // Negative ack: the frontend cleared the composer optimistically — never fail silently.
    console.warn('[chat-queue] queue full, rejecting message');
    _broadcastRejected('full', null, anchor);
    return null;
  }
  const item = _makeItem(clean, anchor);
  _items.push(item);
  _clearRescueTimer();
  _broadcast(item, 'queued');
  let streaming = false;
  try { streaming = !!(_deps.isStreaming && _deps.isStreaming()); } catch { streaming = false; }
  if (!streaming) {
    // Frontend guessed busy but the server sees no API call in flight: the turn may have ended
    // just before enqueue and its turn-end hook already ran. Rescue after a short settle —
    // falling back to the idle poll (not a single shot) so a transient busy/approval state
    // retries within the poll budget instead of stranding the item.
    _rescueTimer = setTimeout(() => {
      _rescueTimer = null;
      // Parked, or a drain/send-now poll/dispatch already owns the next inject.
      if (_suppressDrain || _pollTimer || _dispatch) return;
      if (_safeToInject()) { _injectHead(); return; }
      _pollUntilSafe(() => { if (!_suppressDrain && !_dispatch) _injectHead(); }, () => { /* keep queued */ });
    }, RESCUE_AFTER_MS);
    if (typeof _rescueTimer.unref === 'function') _rescueTimer.unref();
  }
  return item;
}

/**
 * Remove one queued item by id. Returns true when found.
 * A dispatching item is owned by the dispatch slot: the removal is rejected and the current
 * snapshot is rebroadcast so a client that optimistically hid the bubble restores it.
 */
export function remove(id, anchor) {
  if (_dispatch && _dispatch.item.id === id) {
    _broadcast(_dispatch.item, 'dispatching');
    return false;
  }
  const idx = _items.findIndex((it) => it.id === id);
  if (idx < 0) return false;
  const item = _items[idx];
  if (!_matchesScope(item.anchor, _normalizeScope(anchor))) {
    _broadcast(item, 'queued');
    return false;
  }
  _items.splice(idx, 1);
  // Keep the dispatch slot's remembered FIFO position meaningful after a removal ahead of it.
  if (_dispatch && idx < _dispatch.index) _dispatch.index -= 1;
  _broadcast(item, 'queued');
  return true;
}

/**
 * Drop queued items (session/workspace switch). With no anchor this keeps the historical
 * full-clear behavior; with an anchor only items whose sanitized scope matches every supplied
 * field are dropped. Also cancels pending timers and invalidates any in-flight inject whose
 * dispatch slot was dropped (gen bump) so an old-session message can never land in a fresh PTY.
 * Cannot cancel bytes already written to the PTY (best-effort, ~330ms window).
 */
export function clear(anchor) {
  const filter = _normalizeScope(anchor);
  if (!_hasScope(filter)) {
    // Full clear (legacy callers and stop/start paths).
    _gen++;
    _clearRescueTimer();
    _clearPollTimer();
    _clearEscTimer();
    const hadState = !!_dispatch || _items.length > 0;
    _dispatch = null;
    _items = [];
    if (hadState) _broadcast();
    return;
  }

  // Scoped clear: keep other views' queued items AND their in-flight dispatch untouched.
  let removedQueued = false;
  const dispatchIndex = _dispatch ? _dispatch.index : 0;
  let removedBeforeDispatch = 0;
  const kept = [];
  _items.forEach((item, idx) => {
    if (_matchesScope(item.anchor, filter)) {
      removedQueued = true;
      if (_dispatch && idx < dispatchIndex) removedBeforeDispatch += 1;
    } else {
      kept.push(item);
    }
  });
  _items = kept;
  if (_dispatch) _dispatch.index = Math.max(0, dispatchIndex - removedBeforeDispatch);

  const droppedItem = _dispatch && _matchesScope(_dispatch.item.anchor, filter) ? _dispatch.item : null;
  if (droppedItem) {
    // This dispatch belonged to the cleared scope: invalidate its completion so a late
    // failure cannot requeue it after the switch.
    _gen++;
    _clearPollTimer();
    _clearEscTimer();
    _dispatch = null;
  }
  if (_items.length === 0 && !_dispatch) _clearRescueTimer();
  if (removedQueued || droppedItem) {
    // A dropped dispatch carries its own scope; a pure queued-item clear is scoped by the
    // filter itself (synthetic trigger, no item second argument).
    _broadcast(droppedItem || { anchor: filter }, droppedItem ? 'dispatching' : undefined);
  }
}

/**
 * Send-now: interrupt the running turn and inject this item immediately.
 * The item moves into the dispatch slot BEFORE the focus/ESC timer or any write, so it stays
 * visible as 'dispatching' throughout the interrupt/poll/write phases and cannot be acted on
 * twice. On poll timeout / write failure / throw it returns to its original FIFO position.
 *
 * Guard order matters (review P0): refuse BEFORE touching the queue when an inject or another
 * dispatch is in flight, so a double-action can never strand a removed-but-unsent message.
 * Rejections that target a known item rebroadcast the snapshot (clients replay dispatching).
 */
export function sendNow(id, anchor) {
  if (!_deps) return false;

  const filter = _normalizeScope(anchor);
  // Double click on the item already dispatching: reject + replay its dispatching snapshot.
  if (_dispatch && _dispatch.item.id === id) {
    _broadcast(_dispatch.item, 'dispatching');
    return false;
  }
  const queuedIdx = _items.findIndex((it) => it.id === id);
  if (queuedIdx >= 0 && !_matchesScope(_items[queuedIdx].anchor, filter)) {
    _broadcast(_items[queuedIdx], 'queued');
    return false;
  }
  // `_dispatch` covers any send-now/drain dispatch in flight (including its ESC-delay window);
  // `_injecting` covers an in-flight paste; `_pollTimer` also covers a resume/drain poll.
  if (_dispatch || _injecting || _pollTimer) {
    // Rejected operation on a known item: replay so a client-side optimistic action reverts.
    if (queuedIdx >= 0) _broadcast(_dispatch ? _dispatch.item : _items[queuedIdx], _dispatch ? 'dispatching' : 'queued');
    return false;
  }
  try {
    if (_deps.hasExternalInjection && _deps.hasExternalInjection()) {
      if (queuedIdx >= 0) _broadcast(_items[queuedIdx], 'queued');
      return false;
    }
  } catch { return false; }
  if (queuedIdx < 0) return false;
  const [item] = _items.splice(queuedIdx, 1);
  _clearRescueTimer();

  const gen = _gen; // a clear()/stop() mid-flight invalidates the completion handlers below
  _startDispatch(item, queuedIdx);

  const inject = () => {
    if (gen !== _gen) return;
    if (!_dispatch || _dispatch.item.id !== item.id) return;
    _writeDispatch(item, gen, 'chat-queue.send-now.inject');
  };
  const restore = () => {
    // Never blind-inject (see _pollUntilSafe). Park the item back at its original FIFO slot.
    if (gen !== _gen) return;
    if (!_dispatch || _dispatch.item.id !== item.id) return;
    _restoreDispatch();
  };

  let streaming = false;
  try { streaming = !!(_deps.isStreaming && _deps.isStreaming()); } catch { streaming = false; }
  if (streaming) {
    // Interrupt the item's own session, not whichever PTY is globally active.
    const writeFocus = (data, tag) => {
      try {
        if (item.anchor && typeof _deps.writeToPtyFor !== 'function') return false;
        const sent = item.anchor
          ? _deps.writeToPtyFor(data, { ...item.anchor, strict: true }) !== false
          : _deps.writeToPty(data) !== false;
        if (sent === false) {
          _failDispatch(item, gen, tag);
          return false;
        }
        return true;
      } catch (err) {
        _failDispatch(item, gen, tag);
        reportSwallowed(tag, err);
        return false;
      }
    };
    if (writeFocus('\x1b[I', 'chat-queue.send-now.focus') === false) return true;
    _escTimer = setTimeout(() => {
      _escTimer = null;
      if (gen !== _gen || !_dispatch || _dispatch.item.id !== item.id) return;
      if (writeFocus('\x1b', 'chat-queue.send-now.esc') === false) return;
      _pollUntilSafe(inject, restore);
    }, STOP_ESC_DELAY_MS);
    if (typeof _escTimer.unref === 'function') _escTimer.unref();
  } else if (_safeToInject()) {
    // Idle / parked queue (e.g. after Stop): no interrupt needed — inject right away.
    inject();
  } else {
    _pollUntilSafe(inject, restore);
  }
  return true;
}

/**
 * Turn-end hook (Stop-hook POST arrival + debounced emit; idempotent). Drains the head item
 * once the TUI is observably idle. Suppressed after a user Stop until a new turn starts.
 */
export function onTurnEnd() {
  if (!_deps || _items.length === 0 || _injecting) return;
  // A dispatch (send-now or drain) or another pending poll already owns the next inject; let
  // it finish rather than clear a timer out from under it (clearing would strand the item).
  if (_dispatch || _pollTimer) return;
  _clearRescueTimer();
  if (_suppressDrain) return;
  if (_safeToInject()) { _injectHead(); return; }
  _pollUntilSafe(() => { if (!_suppressDrain && !_dispatch) _injectHead(); }, () => { /* keep queued; next turn-end retries */ });
}

/** Park the queue: the next turn-end(s) must not auto-drain (user pressed Stop). */
export function suppressNextDrain() {
  _suppressDrain = true;
  _clearRescueTimer();
}

/** A new turn started (streaming rising edge): re-arm automatic draining. */
export function onStreamingActivated() {
  _suppressDrain = false;
}

/** Server shutdown: drop timers AND queue state — parked items belong to the dying session
 *  and must not drain into the fresh PTY after a stop/start cycle. */
export function stop() {
  _clearRescueTimer();
  _clearPollTimer();
  _clearEscTimer();
  _injecting = false;
  _dispatch = null;
  _items = [];
  _suppressDrain = false;
  _gen++;
}

const RESUME_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True /resume (2026-10-06): inject `/resume <uuid>` into a target project's running claude
 * PTY so the process switches INTO that session in place (Claude Code's native SessionStart
 * hook then re-binds the v2 writer via beginResumeSwitch). This is the in-process switch —
 * NOT a respawn — and must only happen when the TUI is observably idle.
 *
 * Promise-returning so the route can map the outcome to HTTP. Resolves:
 *   { ok:true }                 — the paste was written
 *   { ok:false, reason:'busy' } — TUI streaming / approval open / another inject, poll, or
 *                                 dispatch in flight / timed out waiting for idle (never blind-injects)
 *   { ok:false, reason:'bad-uuid' }     — sessionUuid is not a UUID shape
 *   { ok:false, reason:'no-deps' }      — initChatQueue never ran (SDK mode / not wired)
 *   { ok:false, reason:'write-failed' } — the PTY write failed or threw
 *
 * Shares the single `_injecting`/`_pollTimer`/`_dispatch` slots with the drain/sendNow paths,
 * so it refuses up-front when any is owned (mirrors sendNow's guard) instead of clobbering a
 * pending dispatch and stranding a queued message. The completion handler resets `_injecting`
 * unconditionally (both callback and catch) so a mid-inject clear()/stop() generation bump can
 * never wedge the queue.
 */
export function injectResumeCommand(sessionUuid, anchor) {
  return new Promise((resolve) => {
    if (!_deps) { resolve({ ok: false, reason: 'no-deps' }); return; }
    const uuid = sanitizeInbound(String(sessionUuid == null ? '' : sessionUuid)).trim();
    if (!RESUME_UUID_RE.test(uuid)) { resolve({ ok: false, reason: 'bad-uuid' }); return; }
    // Refuse BEFORE touching _pollUntilSafe: a dispatch (even in its ESC-delay window) or a
    // drain's poll owns the single timer slots — barging in would strand a queued message.
    if (_dispatch || _injecting || _pollTimer) { resolve({ ok: false, reason: 'busy' }); return; }
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const inject = () => {
      _injecting = true;
      try {
        _deps.writeToPtySequentialFor(bracketPasteSubmit(`/resume ${uuid}`), (ok) => {
          _injecting = false;
          done(ok ? { ok: true } : { ok: false, reason: 'write-failed' });
        }, { settleMs: 250 }, anchor || {});
      } catch (err) {
        _injecting = false;
        reportSwallowed('chat-queue.resume.inject', err);
        done({ ok: false, reason: 'write-failed' });
      }
    };
    if (_safeToInject()) { inject(); return; }
    _pollUntilSafe(inject, () => done({ ok: false, reason: 'busy' }));
  });
}

export function __resetForTests() {
  stop();
  _deps = null;
}
