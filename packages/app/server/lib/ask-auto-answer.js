// Server-side auto-answer ("managed answering") countdown for AskUserQuestion.
//
// Mirrors auto-approve.js (plan/permission) but with MINUTE semantics and a
// different value contract, because the feature spec differs in two ways:
//   - 0 minutes means "answer immediately" (unattended flows), not "off";
//   - "off" is the ABSENCE of a value (null/undefined), not 0.
// Do NOT route this through computeAutoApprove: its 300s cap would silently
// disable the 10/20/30-minute tiers, and its Number() coercion would turn the
// persisted "off" (null) into 0 = instant — the most dangerous trap here.
//
// Deadline model is identical to auto-approve.js: armed at ask arrival
// (wall-clock), fires at deadline + ASK_AUTO_ANSWER_BUFFER_MS so a connected
// client's exact-deadline answer can still win the first-write race.
//
// Semantics of the setting (shared with the client):
//   prefs.approvalModal.askAutoAnswerMinutes
//   null/undefined/absent = off (default), 0 = instant, N>0 = N minutes.

import { readPrefsRaw } from './prefs-store.js';
import { getCurrentProjectKey, hasFork, resolveScoped } from './project-prefs.js';
import { reportSwallowed } from './error-report.js';

export { pickAutoAnswers } from '@ccv/core/ask-auto-answer';

export const ASK_AUTO_ANSWER_BUFFER_MS = 1000;
// A hand-edited preferences.json can hold an absurdly large value; beyond
// 2^31-1 ms Node's setTimeout clamps the delay to 1ms (instant answer). Cap below
// the 24h ask timeout so the advertised deadline is always reachable: the ask's own
// 24h timeout is armed first, so the max tier must leave room for the fire buffer.
// 1439 min = 24h - 1min, comfortably under ASK_TIMEOUT_MS.
export const MAX_ASK_AUTO_ANSWER_MINUTES = 1439;

/**
 * Extract the configured minutes from an effective prefs object.
 * Strict typing on purpose: null/undefined/strings/'10'/NaN are all OFF; only a
 * real finite number in [0, MAX] enables hosting. Returns null when disabled.
 */
export function effectiveAskAutoAnswerMinutes(prefs) {
  const raw = prefs?.approvalModal?.askAutoAnswerMinutes;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < 0 || raw > MAX_ASK_AUTO_ANSWER_MINUTES) return null;
  return raw;
}

/**
 * Read prefs (project-fork aware) and compute the auto-answer deadline for a
 * pending AskUserQuestion. `projectKey` is the session cwd (SDK) or
 * hook-reported cwd (PTY hook); falls back to the server's current project key.
 *
 * Returns:
 *   { enabled:false }                                                     — no hosting
 *   { enabled:true, instant, minutes, seconds, autoAnswerAt }             — absolute epoch ms deadline
 */
export function computeAskAutoAnswer(projectKey, { now = Date.now(), readPrefs = readPrefsRaw, file } = {}) {
  let prefs = {};
  try {
    prefs = readPrefs(file) || {};
  } catch (err) {
    reportSwallowed('ask-auto-answer.read-prefs', err);
    return { enabled: false };
  }
  const key = typeof projectKey === 'string' && projectKey ? projectKey : getCurrentProjectKey();
  const effective = hasFork(prefs, key) ? resolveScoped(prefs, prefs.prefsByProject[key]) : prefs;
  const minutes = effectiveAskAutoAnswerMinutes(effective);
  if (minutes === null) return { enabled: false };
  const instant = minutes === 0;
  const seconds = minutes * 60;
  return {
    enabled: true,
    instant,
    minutes,
    seconds,
    autoAnswerAt: instant ? now : now + seconds * 1000,
  };
}

/**
 * Delay for the server-side timer: the user-visible deadline plus the request
 * buffer, never negative. Instant (0 minutes) fires on the same tick (0).
 */
export function askAutoAnswerFireDelayMs(computed, now = Date.now()) {
  if (!computed?.enabled) return null;
  if (computed.instant) return 0;
  return Math.max(0, computed.autoAnswerAt - now) + ASK_AUTO_ANSWER_BUFFER_MS;
}

/**
 * Arm the server-side timer. Returns the auto state stored on the pending
 * entry: { autoAnswerAt, seconds, minutes, cancelled, timer }.
 * `onFire` is invoked once when the deadline (+buffer) passes; callers must
 * re-check the entry is still pending and not cancelled inside onFire.
 * Instant fires SYNCHRONOUSLY — the caller MUST register the pending entry
 * (and emit the pending frame) before calling this.
 */
export function createAskAutoAnswerState(computed, onFire) {
  const delay = askAutoAnswerFireDelayMs(computed);
  if (delay === null) return null; // disabled — never arm
  const state = {
    autoAnswerAt: computed.autoAnswerAt,
    seconds: computed.seconds,
    minutes: computed.minutes,
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
 * Cancel an armed auto-answer state: clears the timer and marks it cancelled.
 * Accepts either the auto state itself or the whole pending entry ({ auto,
 * autoCancelled }) — the entry form also stamps the durable entry-level flag so
 * replays never re-arm. Returns true only on the first cancellation (so callers
 * broadcast once).
 */
export function cancelAskAutoAnswerState(autoOrEntry) {
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
export function replayAskAutoAnswerFields(auto, autoCancelled) {
  return {
    autoAnswerAt: autoCancelled ? null : (auto?.autoAnswerAt ?? null),
    autoAnswerSeconds: auto?.seconds ?? null,
    autoCancelled: autoCancelled === true,
  };
}
