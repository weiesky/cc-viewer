// Server-side auto-approve countdown for plan/permission approvals.
//
// The auto-approve countdown used to live entirely in the web client: when the
// browser tab was closed, backgrounded (timer throttling), or disconnected, no
// approval ever fired and the pending request degraded to the 5-minute deny
// timeout. This module moves the deadline to the server: the countdown is armed
// from the moment the approval request arrives (wall-clock), and the server
// resolves the pending approval itself at deadline + AUTO_APPROVE_BUFFER_MS.
// The buffer gives a connected client whose own countdown fires at the exact
// deadline a head start, so a watched approval is still answered by the client
// and the server timer is only the fallback.
//
// Cancellation is durable while the approval is pending: a client cancel marks
// the entry (autoCancelled) and clears the server timer, the approval stays
// pending for a manual decision, and the cancelled state is replayed to newly
// connected clients so they never re-arm a countdown.
//
// Semantics of the settings (shared with the client):
//   plan: prefs.approvalModal.planAutoApproveSeconds (default 0 = off)
//   perm: prefs.autoApproveSeconds                  (default 3 when unset)
//   0/off, N>0 = N seconds, -1 = instant (resolve immediately, no buffer).
// AskUserQuestion approvals are never auto-approved.

import { readPrefsRaw } from './prefs-store.js';
import { getCurrentProjectKey, hasFork, resolveScoped } from './project-prefs.js';
import { reportSwallowed } from './error-report.js';

export const AUTO_APPROVE_BUFFER_MS = 1000;
export const DEFAULT_PERM_AUTO_APPROVE_SECONDS = 3;
export const AUTO_APPROVE_INSTANT = -1;
// A hand-edited preferences.json can hold an absurdly large value. Besides being
// pointless, a value above the 5-minute hard approval timeout would advertise an
// autoApproveAt the deny timeout always beats (a lying countdown); and beyond
// 2^31-1 ms Node's setTimeout clamps the delay to 1ms (instant approval). Cap the
// countdown at the approval timeout so the advertised deadline is always reachable.
export const MAX_AUTO_APPROVE_SECONDS = 300;

/**
 * Extract the configured seconds for a kind ('plan' | 'perm') from an effective
 * prefs object. Returns null when disabled (0 / invalid / negative other than -1 /
 * absurdly large).
 */
export function effectiveAutoApproveSeconds(kind, prefs) {
  const raw = kind === 'plan'
    ? prefs?.approvalModal?.planAutoApproveSeconds
    : (prefs?.autoApproveSeconds ?? DEFAULT_PERM_AUTO_APPROVE_SECONDS);
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return null;
  if (seconds === AUTO_APPROVE_INSTANT) return AUTO_APPROVE_INSTANT;
  if (seconds <= 0) return null;
  if (seconds > MAX_AUTO_APPROVE_SECONDS) return null;
  return seconds;
}

/**
 * Read prefs (project-fork aware) and compute the auto-approve deadline for a
 * pending approval. `projectKey` is the session cwd (SDK) or hook-reported cwd
 * (PTY hook); falls back to the server's current project key.
 *
 * Returns:
 *   { enabled:false }                                      — no auto-approve
 *   { enabled:true, instant, seconds, autoApproveAt }      — absolute epoch ms deadline
 */
export function computeAutoApprove(kind, projectKey, { now = Date.now(), readPrefs = readPrefsRaw, file } = {}) {
  let prefs = {};
  try {
    prefs = readPrefs(file) || {};
  } catch (err) {
    reportSwallowed('auto-approve.read-prefs', err);
    return { enabled: false };
  }
  const key = typeof projectKey === 'string' && projectKey ? projectKey : getCurrentProjectKey();
  const effective = hasFork(prefs, key) ? resolveScoped(prefs, prefs.prefsByProject[key]) : prefs;
  const seconds = effectiveAutoApproveSeconds(kind, effective);
  if (seconds === null) return { enabled: false };
  const instant = seconds === AUTO_APPROVE_INSTANT;
  return {
    enabled: true,
    instant,
    seconds,
    autoApproveAt: instant ? now : now + seconds * 1000,
  };
}

/**
 * Delay for the server-side fallback timer: the user-visible deadline plus the
 * request buffer, never negative. Instant fires on the same tick (0).
 */
export function autoApproveFireDelayMs(computed, now = Date.now()) {
  if (!computed?.enabled) return null;
  if (computed.instant) return 0;
  return Math.max(0, computed.autoApproveAt - now) + AUTO_APPROVE_BUFFER_MS;
}

/**
 * Arm the server-side fallback timer. Returns the auto state stored on the
 * pending entry: { autoApproveAt, seconds, cancelled, timer }.
 * `onFire` is invoked once when the deadline (+buffer) passes; callers must
 * re-check the entry is still pending and not cancelled inside onFire.
 * Instant (-1) fires SYNCHRONOUSLY — the caller MUST register the pending entry
 * (and emit the pending frame) before calling this.
 */
export function createAutoApproveState(computed, onFire) {
  const delay = autoApproveFireDelayMs(computed);
  if (delay === null) return null; // disabled — never arm
  const state = {
    autoApproveAt: computed.autoApproveAt,
    seconds: computed.seconds,
    cancelled: false,
    timer: null,
  };
  if (delay === 0) {
    onFire();
    return state;
  }
  state.timer = setTimeout(onFire, delay);
  return state;
}

/**
 * Cancel an armed auto-approve state: clears the timer and marks it cancelled.
 * Accepts either the auto state itself or the whole pending entry ({ auto,
 * autoCancelled }) — the entry form also stamps the durable entry-level flag so
 * replays never re-arm. Returns true only on the first cancellation (so callers
 * broadcast once).
 */
export function cancelAutoApproveState(autoOrEntry) {
  if (!autoOrEntry) return false;
  // Entry form: { auto, autoCancelled }
  if (Object.prototype.hasOwnProperty.call(autoOrEntry, 'autoCancelled')) {
    const entry = autoOrEntry;
    if (entry.autoCancelled) return false;
    entry.autoCancelled = true;
    if (entry.auto) {
      entry.auto.cancelled = true;
      if (entry.auto.timer) {
        clearTimeout(entry.auto.timer);
        entry.auto.timer = null;
      }
    }
    return true;
  }
  const auto = autoOrEntry;
  if (auto.cancelled) return false;
  auto.cancelled = true;
  if (auto.timer) {
    clearTimeout(auto.timer);
    auto.timer = null;
  }
  return true;
}

/** Fields merged into pending/replay frames for the client countdown UI. */
export function replayAutoApproveFields(auto, autoCancelled) {
  return {
    autoApproveAt: autoCancelled ? null : (auto?.autoApproveAt ?? null),
    autoApproveSeconds: auto?.seconds ?? null,
    autoCancelled: autoCancelled === true,
  };
}
