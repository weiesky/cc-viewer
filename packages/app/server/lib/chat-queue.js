/**
 * chat-queue.js — Server-side busy queue for chat-composer messages (PTY / terminal-hidden mode).
 *
 * When Claude is mid-run and the user presses Enter in the web chat composer, the message is
 * held here instead of being typed into the TUI immediately. The server broadcasts the queue
 * (`queue-state`) so every client can render floating bubbles above the composer, and drains
 * the queue into the PTY (bracketed paste + Enter) once the turn really ends.
 *
 * Per-bubble actions:
 * - "Send now" (queue-send-now) interrupts the running turn (focus-in + ESC, same bytes as the
 *   web Stop button) and injects that message as soon as the TUI is observably idle.
 * - "Remove" (queue-remove) drops it.
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

import { reportSwallowed } from '@ccv/core/error-report';
import { bracketPasteSubmit, sanitizeInbound } from './im/im-bridge-core.js';

const MAX_ITEMS = 50;             // im-bridge-core MAX_QUEUE parity
const STOP_ESC_DELAY_MS = 50;     // focus-in → ESC gap, mirrors ChatView's STOP_FOCUS_IN_ESC_DELAY_MS
const INJECT_POLL_MS = 100;       // idle poll cadence before injecting
const INJECT_POLL_MAX_MS = 2000;  // give up polling after this; NEVER inject unconditionally
const RESCUE_AFTER_MS = 3000;     // stale-busy rescue: frontend guessed busy while the turn already ended

// Injected deps (see initChatQueue). Null until wired; every public entry no-ops safely then.
let _deps = null;
let _items = [];            // [{ id, text, ts }] FIFO
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
 * @param {function} deps.getPtyKind — () => 'claude' | 'shell' | null
 * @param {function} deps.isStreaming — () => boolean (per-API-call streaming flag; flickers between tool calls)
 * @param {function} deps.hasPendingApproval — () => boolean (web-visible ask/perm modal open)
 * @param {function} [deps.hasExternalInjection] — () => boolean (IM bridge injection slot busy)
 * @param {function} deps.broadcastWs — (msg:object) => void
 */
export function initChatQueue(deps) {
  _deps = deps;
}

export function getSnapshot() {
  return _items.map(({ id, text, ts }) => ({ id, text, ts }));
}

function _broadcast() {
  if (!_deps || !_deps.broadcastWs) return;
  try { _deps.broadcastWs({ type: 'queue-state', items: getSnapshot() }); }
  catch (err) { reportSwallowed('chat-queue.broadcast', err); }
}

function _makeItem(text) {
  return {
    id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    text,
    ts: Date.now(),
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
 * Inject the head item. Caller must have verified _safeToInject() first (except the internal
 * re-checks here, which keep this self-guarding for direct calls).
 * Broadcasts on shift (so the bubble disappears the moment the message starts typing into the
 * TUI) and again if the write fails and the item returns to the head.
 */
function _injectHead() {
  if (!_safeToInject()) return false;
  const item = _items.shift();
  if (!item) return false;
  _broadcast();
  _injecting = true;
  const gen = _gen; // invalidate on clear()/stop(): a stale completion must not re-park
  try {
    _deps.writeToPtySequential(bracketPasteSubmit(item.text), (ok) => {
      _injecting = false;
      if (gen !== _gen) return;
      if (!ok) {
        // Dead PTY / write failure — never lose the message silently; put it back.
        _items.unshift(item);
        _broadcast();
      }
    }, { settleMs: 250 });
  } catch (err) {
    _injecting = false;
    if (gen === _gen) {
      _items.unshift(item);
      _broadcast();
    }
    reportSwallowed('chat-queue.inject', err);
  }
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
export function enqueue(text) {
  if (!_deps) return null;
  const clean = sanitizeInbound(text == null ? '' : String(text)).trim();
  if (!clean) return null;
  if (_items.length >= MAX_ITEMS) {
    // Negative ack: the frontend cleared the composer optimistically — never fail silently.
    console.warn('[chat-queue] queue full, rejecting message');
    try { _deps.broadcastWs({ type: 'queue-rejected', reason: 'full' }); }
    catch (err) { reportSwallowed('chat-queue.reject-broadcast', err); }
    return null;
  }
  const item = _makeItem(clean);
  _items.push(item);
  _clearRescueTimer();
  _broadcast();
  let streaming = false;
  try { streaming = !!(_deps.isStreaming && _deps.isStreaming()); } catch { streaming = false; }
  if (!streaming) {
    // Frontend guessed busy but the server sees no API call in flight: the turn may have ended
    // just before enqueue and its turn-end hook already ran. Rescue after a short settle —
    // falling back to the idle poll (not a single shot) so a transient busy/approval state
    // retries within the poll budget instead of stranding the item.
    _rescueTimer = setTimeout(() => {
      _rescueTimer = null;
      if (_suppressDrain || _pollTimer) return; // parked, or a drain/send-now poll already owns it
      if (_safeToInject()) { _injectHead(); return; }
      _pollUntilSafe(() => { if (!_suppressDrain) _injectHead(); }, () => { /* keep queued */ });
    }, RESCUE_AFTER_MS);
    if (typeof _rescueTimer.unref === 'function') _rescueTimer.unref();
  }
  return item;
}

/** Remove one queued item by id. Returns true when found. */
export function remove(id) {
  const idx = _items.findIndex((it) => it.id === id);
  if (idx < 0) return false;
  _items.splice(idx, 1);
  _broadcast();
  return true;
}

/** Drop all queued items (session switch). Also cancels pending timers and invalidates any
 *  in-flight inject (gen bump) so an old-session message can never land in a fresh PTY.
 *  Cannot cancel bytes already written to the PTY (best-effort, ~330ms window). */
export function clear() {
  _gen++;
  _clearRescueTimer();
  _clearPollTimer();
  _clearEscTimer();
  if (_items.length === 0) return;
  _items = [];
  _broadcast();
}

/**
 * Send-now: interrupt the running turn and inject this item immediately.
 * Guard order matters (review P0): refuse BEFORE touching the queue when an inject is in
 * flight, so a double-action can never strand a removed-but-unsent message.
 */
export function sendNow(id) {
  if (!_deps) return false;
  // Guard order matters (review P0): refuse BEFORE touching the queue. `_injecting` covers an
  // in-flight paste; `_pollTimer` covers a prior send-now still in its ESC/idle-poll phase —
  // a second poll would clobber the first one's timer and strand its already-removed item.
  if (_injecting || _pollTimer) return false;
  try { if (_deps.hasExternalInjection && _deps.hasExternalInjection()) return false; } catch { return false; }
  const idx = _items.findIndex((it) => it.id === id);
  if (idx < 0) return false;
  const [item] = _items.splice(idx, 1);
  _clearRescueTimer();
  _broadcast();

  const gen = _gen; // a clear()/stop() mid-flight invalidates the completion handler below
  const inject = () => {
    _injecting = true;
    try {
      _deps.writeToPtySequential(bracketPasteSubmit(item.text), (ok) => {
        _injecting = false;
        if (gen !== _gen) return;
        if (!ok) { _items.unshift(item); _broadcast(); }
      }, { settleMs: 250 });
    } catch (err) {
      _injecting = false;
      if (gen === _gen) {
        _items.unshift(item);
        _broadcast();
      }
      reportSwallowed('chat-queue.send-now.inject', err);
    }
  };
  const restore = () => {
    // Never blind-inject (see _pollUntilSafe). Park the item back at the head.
    if (gen !== _gen) return;
    if (!_items.some((it) => it.id === item.id)) {
      _items.unshift(item);
      _broadcast();
    }
  };

  let streaming = false;
  try { streaming = !!(_deps.isStreaming && _deps.isStreaming()); } catch { streaming = false; }
  if (streaming) {
    // Interrupt first: focus-in (a hidden xterm is unfocused; Ink ignores ESC then) then ESC —
    // byte-identical to the web Stop button (ChatView handleInputStop). The gap timer is
    // tracked so stop()/clear() can cancel it before it lands in a fresh PTY.
    try { _deps.writeToPty('\x1b[I'); } catch (err) { reportSwallowed('chat-queue.send-now.focus', err); }
    _escTimer = setTimeout(() => {
      _escTimer = null;
      try { _deps.writeToPty('\x1b'); } catch (err) { reportSwallowed('chat-queue.send-now.esc', err); }
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
  // A send-now poll is already pending — it owns the next inject; let it finish rather than
  // clear its timer out from under it (clearing would strand the removed item).
  if (_pollTimer) return;
  _clearRescueTimer();
  if (_suppressDrain) return;
  if (_safeToInject()) { _injectHead(); return; }
  _pollUntilSafe(() => { if (!_suppressDrain) _injectHead(); }, () => { /* keep queued; next turn-end retries */ });
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
  _items = [];
  _suppressDrain = false;
  _gen++;
}

export function __resetForTests() {
  stop();
  _deps = null;
}
