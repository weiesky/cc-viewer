/**
 * contextCompaction.js — pure logic module for "context compaction settings".
 *
 * Does not depend on React / Vite assets; only imports pure functions from @ccv/core, so
 * node:test can assert directly. Covers three areas:
 *   1) config normalization / payload serialization (top-level `contextCompaction` array in preferences.json)
 *   2) /compact command assembly
 *   3) usage reading normalization (SDK snapshot / PTY context_window / request fallback) + trigger state machine
 *
 * The trigger state machine only holds "in-memory state" (one per ChatView instance, not persisted);
 * the caller (ChatView) drives applyCheckpoint at real turn-end boundaries and calls the matching
 * mark* functions on confirm/ignore/failure/external compaction.
 */
import { sumUsageContextTokens } from '@ccv/core/context-rules';

export const COMPACTION_DEFAULTS = Object.freeze({
  percentDefault: 80,
  minPercent: 1,
  maxPercent: 100,
  // Token thresholds are entered and stored in K units (multiplied by 1000 when evaluated).
  minTokensK: 1,
  maxTokensK: 10000,
  // Hysteresis: in percent mode, snooze/cooldown is released only when the reading drops below (threshold - 5 percentage points);
  // in tokens mode, only when it drops below 95% of the threshold.
  hysteresisPercentPoints: 5,
  hysteresisTokenRatio: 0.95,
  // Require N consecutive "fresh above-threshold readings" before showing the confirm bar (tolerates a single anomalous fluctuation).
  consecutiveRequired: 2,
  // Number of turns to cool down after a successful injection.
  cooldownTurns: 2,
  // This many consecutive injection failures trips the circuit breaker (reset on view switch/config change).
  failureLimit: 3,
  ackTimeoutMs: 10 * 1000,
  // Longest listen window after turn end while waiting for a "fresh reading" (event-driven; give up on this turn on timeout).
  freshnessWaitMs: 8000,
  // Poll interval for the next new reading while readings are unavailable/stale.
  readingPollMs: 600,
  maxItems: 20,
  maxTitleLen: 80,
  maxScriptLen: 8000,
  // Growth thresholds for re-reminding after an (x) deferral: re-remind when either is satisfied first (first-to-arrive re-remind, user already confirmed).
  deferGrowthTokens: 50000,   // context grew by 50K tokens
  deferGrowthPercent: 5,      // or window share grew by 5 percentage points
});

const MODES = new Set(['percent', 'tokens']);

// Built-in rule id allowlist: only builtinIds listed here survive normalization/payload; everything else is stripped.
// 'default' = the default compaction rule (non-deletable; title/script/threshold/enabled/timing are user-editable).
export const BUILTIN_COMPACTION_IDS = Object.freeze(['default']);
const BUILTIN_ID_SET = new Set(BUILTIN_COMPACTION_IDS);

// Built-in default compaction rule (non-deletable, but fully editable). normalizeCompactionConfig merges by builtinId after normalization —
// whenever 'default' is missing from the list, it is inserted at the front (so brand-new users and users who deleted it
// both get it), guaranteeing "context compaction" works out of the box and the 960K forced compaction always has a usable script.
export const DEFAULT_COMPACTION_ITEM = Object.freeze({
  builtinId: 'default',
  // title is intentionally left empty: the display layer uses t('ui.contextCompaction.builtinDefaultTitle') for i18n on built-in items,
  // so Chinese text is not persisted to preferences.json (otherwise non-Chinese-locale users would see a Chinese rule name).
  title: '',
  script: 'Hand off the current work:\n' +
    '- Keep the latest 20 original user prompts in full at the top; index any earlier prompts.\n' +
    '- Preserve key findings and reports.\n' +
    '- Omit unimportant intermediate queries.\n' +
    '- For lengthy content, include a summary and a local file reference to the full text.\n' +
    '- Prioritize the active task. If unfinished, clearly state its progress and next steps.',
  threshold: Object.freeze({ mode: 'percent', value: 75 }),
  enabled: true,
  executionTiming: 'user',
});

// 960K streaming forced compaction (hard-coded, not configurable): when tokens reach this value, interrupt the current session immediately and inject the default script.
export const FORCE_COMPACT_THRESHOLD_TOKENS = 960 * 1000;
// Interval (ms) for evaluating forced compaction during streaming.
export const FORCE_COMPACT_CHECK_INTERVAL_MS = 2000;
// Forced compaction cooldown: after one interrupt+inject, no second forced trigger for this many milliseconds (prevents chained triggers while an interrupt is in progress).
export const FORCE_COMPACT_COOLDOWN_MS = 60 * 1000;

// Execution timing (one per command): user = user chooses (show a bubble and wait for a click);
// s30/m3 = 30s/3min countdown (the bubble shows a countdown and auto-executes at zero); auto = inject directly at zero without a bubble.
// Unknown values always fall back to user (most conservative), never to auto.
export const EXECUTION_TIMINGS = Object.freeze(['user', 's30', 'm3', 'auto']);
const TIMING_SET = new Set(EXECUTION_TIMINGS);
// Countdown-mode durations (ms); user/auto have no countdown.
export const TIMING_COUNTDOWN_MS = Object.freeze({ s30: 30 * 1000, m3: 3 * 60 * 1000 });

function _clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Normalize a single config item; returns null when it is beyond repair (empty script, unless a built-in) so the caller discards it. */
function _normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Built-in rules (builtinId allowlist): NOT read-only — the user may edit title/script/threshold/
  // enabled/timing; only deletion is forbidden. Normalize like any rule and KEEP the builtinId
  // marker so the UI can lock the delete path. If the script was cleared, fall back to the built-in
  // script so the 960K forced compaction always has a usable script (never fires empty).
  const isBuiltin = BUILTIN_ID_SET.has(raw.builtinId);
  let script = typeof raw.script === 'string' ? raw.script.trim() : '';
  if (!script) {
    if (!isBuiltin) return null;
    script = DEFAULT_COMPACTION_ITEM.script;
  }
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, COMPACTION_DEFAULTS.maxTitleLen) : '';
  const th = raw.threshold && typeof raw.threshold === 'object' ? raw.threshold : {};
  const mode = MODES.has(th.mode) ? th.mode : 'percent';
  const value = mode === 'tokens'
    ? _clampInt(th.value, COMPACTION_DEFAULTS.minTokensK, COMPACTION_DEFAULTS.maxTokensK, COMPACTION_DEFAULTS.percentDefault)
    : _clampInt(th.value, COMPACTION_DEFAULTS.minPercent, COMPACTION_DEFAULTS.maxPercent, COMPACTION_DEFAULTS.percentDefault);
  return {
    ...(isBuiltin ? { builtinId: raw.builtinId } : {}),
    title,
    script: script.slice(0, COMPACTION_DEFAULTS.maxScriptLen),
    threshold: { mode, value },
    enabled: raw.enabled !== false,
    // Execution timing: unknown values fall back to user (most conservative).
    executionTiming: TIMING_SET.has(raw.executionTiming) ? raw.executionTiming : 'user',
  };
}

/**
 * Normalize the whole config (never trust disk content). Returns a clean array; keeps at most maxItems entries.
 *
 * Built-in rule merge (DEFAULT_COMPACTION_ITEM, builtinId:'default'):
 *   after normalization, if 'default' is missing from the list, unconditionally insert one at the front — whether
 *   disk holds undefined/[]/ or already has custom rules. This way brand-new users get it out of the box and users
 *   who deleted everything regain it on the next hydration, and the 960K forced compaction always has a usable
 *   script. Duplicate builtinIds are deduped to one; built-ins take priority over maxItems truncation.
 */
export function normalizeCompactionConfig(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  let hasDefault = false;
  for (const item of list) {
    const n = _normalizeItem(item);
    if (!n) continue;
    if (n.builtinId === 'default') {
      if (hasDefault) continue; // dedupe by builtinId, keep only the first
      hasDefault = true;
    }
    out.push(n);
  }
  if (!hasDefault) out.unshift(_normalizeItem(DEFAULT_COMPACTION_ITEM));
  // Built-ins are kept preferentially: when truncating, keep built-ins first, then customs in order, up to maxItems entries.
  const builtins = out.filter((i) => i.builtinId != null);
  const customs = out.filter((i) => i.builtinId == null);
  return [...builtins, ...customs].slice(0, COMPACTION_DEFAULTS.maxItems);
}

/** Normalize item by item (for external reuse on a single draft when needed). */
export function normalizeCompactionItem(raw) {
  return _normalizeItem(raw);
}

/**
 * Serialize into the payload for onUpdatePreferences. Writes business fields only, without frontend-temporary ids.
 * The array is replaced wholesale (server-side applyPrefsPatch does a shallow merge; top-level arrays are overwritten entirely).
 */
export function buildContextCompactionPayload(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    contextCompaction: list.map((i) => {
      const isBuiltin = BUILTIN_ID_SET.has(i?.builtinId);
      let script = typeof i.script === 'string' ? i.script.trim().slice(0, COMPACTION_DEFAULTS.maxScriptLen) : '';
      // Built-in rules persist the user's edits (not a locked canonical form), but a cleared script
      // falls back to the built-in one so the 960K forced compaction never fires empty.
      if (!script && isBuiltin) script = DEFAULT_COMPACTION_ITEM.script;
      const o = {
        ...(isBuiltin ? { builtinId: i.builtinId } : {}),
        title: typeof i.title === 'string' ? i.title.trim().slice(0, COMPACTION_DEFAULTS.maxTitleLen) : '',
        script,
        threshold: {
          mode: MODES.has(i?.threshold?.mode) ? i.threshold.mode : 'percent',
          value: MODES.has(i?.threshold?.mode) && i.threshold.mode === 'tokens'
            ? _clampInt(i.threshold.value, COMPACTION_DEFAULTS.minTokensK, COMPACTION_DEFAULTS.maxTokensK, COMPACTION_DEFAULTS.percentDefault)
            : _clampInt(i?.threshold?.value, COMPACTION_DEFAULTS.minPercent, COMPACTION_DEFAULTS.maxPercent, COMPACTION_DEFAULTS.percentDefault),
        },
        enabled: i.enabled !== false,
        executionTiming: TIMING_SET.has(i?.executionTiming) ? i.executionTiming : 'user',
      };
      return o;
    }).filter((o) => o.script),
  };
}

/**
 * Assemble the /compact command. Any leading `/compact` tokens already present in the script are stripped first, avoiding `/compact /compact`.
 * Returns a single command starting with `/compact` (newlines inside the script are preserved and injected as a whole via bracketed-paste).
 */
export function buildCompactCommand(script) {
  let s = typeof script === 'string' ? script.trim() : '';
  // Strip leading `/compact` (repeatable, optional whitespace).
  s = s.replace(/^(\s*\/compact\b)+/, '').replace(/^\s+/, '');
  return s ? `/compact ${s}` : '/compact';
}

/**
 * Usage reading normalization. Takes the first available source by priority; never mixes sources:
 *   1) sdkUsage  — SDK get_context_usage snapshot (usage object, with totalTokens/maxTokens)
 *   2) contextWindow — PTY context_window SSE (payload of buildContextWindowEvent)
 *   3) requests — reverse-scan the latest mainAgent request carrying usage (the caller must pre-filter)
 *
 * `ts` comes from the wrapper layer (sdkUsage's host frame may put ts on the outer level; the caller may pass sdkTs explicitly).
 * Returns { ok:true, tokens, maxTokens, percent, source, ts } or { ok:false }.
 * Over-limit (tokens > maxTokens) is a legal state: percent clamps to 100, not discarded. Only max≤0 or raw≤0 is judged unavailable.
 */
export function normalizeUsageReading({ sdkUsage, sdkTs, contextWindow, mainAgentUsage } = {}) {
  // 1) SDK snapshot
  if (sdkUsage && typeof sdkUsage === 'object') {
    const max = _positive(sdkUsage.maxTokens) ?? _positive(sdkUsage.rawMaxTokens);
    if (max) {
      let raw = _finite(sdkUsage.totalTokens);
      if (raw == null && _finite(sdkUsage.percentage) != null) {
        raw = (_normalizePct(sdkUsage.percentage) / 100) * max;
      }
      // raw>0 makes it usable; when raw≤0/missing, fall through to the PTY/request sources instead of declaring unavailable.
      if (raw != null && raw > 0) return _finish(raw, max, 'sdk', _finite(sdkTs) ?? _finite(sdkUsage.ts));
    }
  }
  // 2) PTY context_window
  if (contextWindow && typeof contextWindow === 'object') {
    const max = _positive(contextWindow.context_window_size);
    if (max) {
      let raw = (_finite(contextWindow.total_input_tokens) || 0) + (_finite(contextWindow.total_output_tokens) || 0);
      if (raw <= 0 && _finite(contextWindow.used_percentage) != null) {
        raw = (_normalizePct(contextWindow.used_percentage) / 100) * max;
      }
      if (raw > 0) return _finish(raw, max, 'pty', contextWindow.ts);
    }
  }
  // 3) Request fallback (caller passes the last mainAgent response.body.usage)
  if (mainAgentUsage && typeof mainAgentUsage === 'object') {
    const raw = sumUsageContextTokens(mainAgentUsage);
    // The request fallback has no window of its own; the caller must pair it with contextWindow's size; here a missing maxTokens makes it undecidable.
    const max = _positive(contextWindow && contextWindow.context_window_size);
    if (raw > 0 && max) return _finish(raw, max, 'requests', _finite(mainAgentUsage.ts));
  }
  return { ok: false };
}

function _positive(n) { return (typeof n === 'number' && Number.isFinite(n) && n > 0) ? n : null; }
function _finite(n) { return (typeof n === 'number' && Number.isFinite(n)) ? n : null; }
function _normalizePct(p) {
  // percentage may be 0-1 or 0-100; pin to 0-100 (so 0.8 is not mistaken for 80 and multiplied by 100 again).
  const v = p <= 1 ? p * 100 : p;
  return Math.min(100, Math.max(0, v));
}
function _finish(raw, max, source, ts) {
  if (!(max > 0) || !(raw > 0)) return { ok: false };
  const tokens = raw;
  const percent = Math.min(100, (tokens / max) * 100); // clamp over-limit to 100, don't discard
  // Freshness fingerprint: the same reading (same source+tokens+max) should not be counted twice in a row. ts is only reliable for the SDK source;
  // PTY/request fallback sources have no server ts, so fall back to a content fingerprint (SSE equivalence tests must not add nondeterministic ts, see review).
  const key = `${source}|${Math.round(tokens)}|${Math.round(max)}|${ts != null ? ts : ''}`;
  return { ok: true, tokens, maxTokens: max, percent, source, ts: _finite(ts) ?? null, key };
}

/**
 * Dedicated reading for 960K streaming forced compaction: only looks at sources that "can update mid-stream"; returns the latest tokens or null.
 *
 * Key difference from normalizeUsageReading — it does not look at the sdkUsage snapshot. The SDK snapshot is only pushed at turn end,
 * so mid-stream it is stale and would mask mid-stream updates of the same-source context_window (dual-Explore conclusion). Streaming
 * decisions must use context_window (pushed after every API call completes, same source for SDK/PTY); only fall back to the request
 * fallback when absent. Returns plain tokens (no percent/fingerprint); the caller compares against FORCE_COMPACT_THRESHOLD_TOKENS.
 */
export function forceCompactTokens({ contextWindow, mainAgentUsage } = {}) {
  if (contextWindow && typeof contextWindow === 'object') {
    const max = _positive(contextWindow.context_window_size);
    let raw = (_finite(contextWindow.total_input_tokens) || 0) + (_finite(contextWindow.total_output_tokens) || 0);
    if (raw <= 0 && _finite(contextWindow.used_percentage) != null && max) {
      raw = (_normalizePct(contextWindow.used_percentage) / 100) * max;
    }
    // Content fingerprint: lets the caller tell "a NEW, different reading" apart from the same
    // stale pre-compaction value being re-polled. ts only when the source carries one.
    if (raw > 0) return { tokens: raw, key: `cw|${Math.round(raw)}|${Math.round(max || 0)}|${_finite(contextWindow.ts) ?? ''}` };
  }
  if (mainAgentUsage && typeof mainAgentUsage === 'object') {
    const raw = sumUsageContextTokens(mainAgentUsage);
    if (raw > 0) return { tokens: raw, key: `req|${Math.round(raw)}|${_finite(mainAgentUsage.ts) ?? ''}` };
  }
  return null;
}

/**
 * "Post-compaction latch" decision for 960K forced compaction (pure function). After force triggers, enter the latch to prevent
 * stale pre-compaction high readings from re-interrupting during the next round / a long compaction. Only a "genuine drop" in
 * the reading clears the latch and re-arms:
 *   - the reading falls below the threshold (compaction took effect, or the window/session switched); or
 *   - a new reading appears (key changed) and its tokens are clearly below the trigger baseline (the reading is moving and has fallen back).
 * Returns true = still latched (do not trigger); false = cleared (evaluation may trigger).
 */
export function isForceCompactLatched(latch, reading, thresholdTokens) {
  if (!latch) return false;
  if (!reading) return true; // no reading during latch: stay latched, do not blindly re-trigger
  if (reading.tokens < thresholdTokens) return false; // below threshold → clear
  if (latch.key && reading.key && reading.key !== latch.key && reading.tokens < latch.tokens * 0.98) return false;
  return true;
}

/**
 * Health-bar watermark: converts enabled compaction rules' thresholds into "window share (0-100)" and returns the smallest
 * (the earliest-triggering warning line, most representative). percent mode uses the value directly; tokens mode converts via
 * maxTokens (the tokens threshold is stored in K, ×1000 to restore); without a window cap, tokens rules cannot convert and are skipped.
 * Input should be a normalized config array (normalizeCompactionConfig output). No drawable line → null.
 */
export function compactionWatermarkPercent(items, maxTokens) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const max = (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) ? maxTokens : null;
  let best = null;
  for (const item of items) {
    if (!item || item.enabled === false) continue;
    const th = item.threshold || {};
    let pct = null;
    if (th.mode === 'tokens') {
      if (!max) continue; // tokens mode without a window cap cannot be converted
      pct = ((th.value * 1000) / max) * 100;
    } else if (typeof th.value === 'number' && Number.isFinite(th.value)) {
      pct = th.value;
    }
    if (pct == null) continue;
    pct = Math.min(100, Math.max(0, pct));
    if (best == null || pct < best) best = pct;
  }
  return best;
}

/** The earliest enabled compaction rule's threshold expressed in TOKENS (not percent).
 *  percent mode converts via maxTokens; tokens mode reads the K value directly. Returns null when
 *  nothing qualifies (no enabled rule, or a percent rule with no window cap to convert through). */
export function compactionWatermarkTokens(items, maxTokens) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const max = (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) ? maxTokens : null;
  let best = null;
  for (const item of items) {
    if (!item || item.enabled === false) continue;
    const th = item.threshold || {};
    let tokens = null;
    if (th.mode === 'tokens') {
      if (typeof th.value === 'number' && Number.isFinite(th.value)) tokens = th.value * 1000;
    } else if (typeof th.value === 'number' && Number.isFinite(th.value) && max) {
      tokens = (th.value / 100) * max;
    }
    if (tokens == null) continue;
    if (best == null || tokens < best) best = tokens;
  }
  return best;
}

/** The watermark dashed line only appears once usage is within this many tokens of the compaction
 *  threshold (the "almost there" proximity window), so the bar stays clean far below the line. */
export const WATERMARK_NEAR_TOKENS = 100 * 1000;

/** Should the watermark line be visible? Only when currentTokens is within WATERMARK_NEAR_TOKENS
 *  of (or past) the watermark threshold. Both args are token counts; null/invalid → false. */
export function shouldShowWatermark(watermarkTokens, currentTokens, nearTokens = WATERMARK_NEAR_TOKENS) {
  if (!(typeof watermarkTokens === 'number' && Number.isFinite(watermarkTokens) && watermarkTokens > 0)) return false;
  if (!(typeof currentTokens === 'number' && Number.isFinite(currentTokens) && currentTokens > 0)) return false;
  return currentTokens >= watermarkTokens - nearTokens;
}

/** Whether the reading hits this command's threshold. */
export function isAboveThreshold(item, reading) {
  if (!item || !reading || !reading.ok) return false;
  const th = item.threshold || {};
  if (th.mode === 'tokens') return reading.tokens >= th.value * 1000;
  return reading.percent >= th.value;
}

/** This command's hysteresis line: snooze/cooldown is released only when the reading drops below it. */
export function isBelowHysteresis(item, reading) {
  if (!item || !reading || !reading.ok) return false;
  const th = item.threshold || {};
  if (th.mode === 'tokens') return reading.tokens < th.value * 1000 * COMPACTION_DEFAULTS.hysteresisTokenRatio;
  return reading.percent < Math.max(COMPACTION_DEFAULTS.minPercent, th.value - COMPACTION_DEFAULTS.hysteresisPercentPoints);
}

// Content-addressed hash (runtime-only id, not persisted): the same content gets the same id on every hydration, so a selection/
// drag does not hit a stale index or a Date.now-type id and delete the wrong row (shared by the ChatView and TerminalPanel hosts).
function _contentHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

/** Assign stable runtime ids to normalized items (content-addressed + same-content sequence dedupe). */
export function assignCompactionIds(items, prefix = 'ccm') {
  const seen = new Map();
  return (Array.isArray(items) ? items : []).map((it) => {
    const base = `${it.title}|${it.script}|${it.threshold?.mode}|${it.threshold?.value}|${it.executionTiming || 'user'}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { id: `${prefix}-${base.length}-${n}-${_contentHash(base)}`, ...it };
  });
}

/* ---------------------------------------------------------------------------
 * Trigger state machine (pure data + pure functions; the caller holds state and drives it at event boundaries)
 * ------------------------------------------------------------------------- */

export function createTriggerState() {
  return {
    viewKey: null,          // `${viewProject}|${viewInstance}|${attachedSid}`; change → reset
    configSignature: null,  // JSON of the normalized config; change → reset
    turnSeq: 0,
    // Completed-turn counter: unconditional +1 only at real turn-end boundaries (after armed + viewKey checks),
    // dedicated to per-turn release of deferral/cooldown (reading-independent, so turns are not starved when evaluation is skipped, review P0-4).
    completedTurns: 0,
    counters: new Map(),    // index -> number of consecutive above-threshold readings
    snoozed: new Set(),     // index -> user explicitly "ignored"; re-arms only after dropping below hysteresis (permanent snooze)
    cooldown: new Map(),    // index -> { releaseAtTurn }
    // index -> { reason:'x'|'timeout'|'interrupt', releaseAtTurn, baseline:{tokens,maxTokens} }
    // Deferred reminder after an (x) decline / timeout / new-round interrupt; released when either the turn count (releaseAtTurn) or context growth (+50K/+5pt) arrives first.
    deferral: new Map(),
    justReleasedDeferral: new Set(), // items released per-turn by advanceTurn this turn (applyCheckpoint exempts them from consecutive counting)
    failures: 0,
    circuitOpen: false,
    pendingInject: null,    // { reqId, index, source }
    lastCountedKey: null,   // fingerprint (source|tokens|max|ts) of the reading last counted toward "consecutive count"; the same one is not counted twice (freshness)
    lastAckedReqId: null,   // reqId of the most recent successful ack; early SDK not-delivered rollbacks match against it
    lastAckedIndex: null,   // index of the item for the above reqId; used to revoke cooldown on a late not-delivered rollback
  };
}

/** Reset on view/config change (everything unnecessary across cooldowns is cleared). Returns the same state for chaining. */
export function resetTriggerState(state, { viewKey, configSignature } = {}) {
  state.viewKey = viewKey ?? state.viewKey;
  state.configSignature = configSignature ?? state.configSignature;
  state.turnSeq = 0;
  state.completedTurns = 0;
  state.counters = new Map();
  state.snoozed = new Set();
  state.cooldown = new Map();
  state.deferral = new Map();
  state.justReleasedDeferral = new Set();
  state.failures = 0;
  state.circuitOpen = false;
  state.pendingInject = null;
  state.lastCountedKey = null;
  state.lastAckedReqId = null;
  state.lastAckedIndex = null;
  return state;
}

export function markTurnStart(state) {
  state.turnSeq += 1;
  return state.turnSeq;
}

/**
 * Turn advance at real turn-end boundaries: completedTurns+1, and releases cooldowns/deferrals whose releaseAtTurn has arrived.
 * Must be called unconditionally at the _onCompactionTurnEnd entry (after armed + viewKey checks), reading-independent —
 * otherwise when evaluation is skipped due to stale readings / a bar showing / a non-empty queue, deferrals would never be released per-turn (review P0-4).
 * Returns whether any cooldown/deferral was "released per-turn" this turn (letting the caller decide whether to also try evaluating without a fresh reading).
 */
export function advanceTurn(state) {
  state.completedTurns += 1;
  let released = false;
  // Record deferral items released per-turn this turn so applyCheckpoint skips consecutive counting for them (if still above threshold on the release occasion, show immediately).
  state.justReleasedDeferral = new Set();
  for (const [i, cd] of state.cooldown) {
    if (cd && cd.releaseAtTurn != null && state.completedTurns >= cd.releaseAtTurn) {
      state.cooldown.delete(i); state.counters.set(i, 0); released = true;
    }
  }
  for (const [i, def] of state.deferral) {
    if (def && def.releaseAtTurn != null && state.completedTurns >= def.releaseAtTurn) {
      state.deferral.delete(i); state.counters.set(i, 0); state.justReleasedDeferral.add(i); released = true;
    }
  }
  return released;
}

/**
 * Whether a deferral should be released by "context growth" (pure function, state-independent).
 * First-to-arrive re-remind (user confirmed): tokens growth ≥ 50K or window-share growth ≥ 5pt, released when either arrives first.
 * On window drift (maxTokens change, model/source switch) release directly and rebaseline — percent deltas across windows are meaningless.
 * A significant context drop (below hysteresis) also releases — then the item should no longer remind, and the defer should not linger (review P1).
 */
export function shouldReleaseDeferral(def, item, reading) {
  if (!def || !def.baseline) return false;
  if (!reading || !reading.ok) return false;
  if (isBelowHysteresis(item, reading)) return true; // context dropped, release early
  const base = def.baseline;
  if (base.maxTokens == null || reading.maxTokens == null || base.maxTokens !== reading.maxTokens) return true;
  const dTokens = reading.tokens - base.tokens;
  if (dTokens >= COMPACTION_DEFAULTS.deferGrowthTokens) return true;
  const dPercent = ((reading.tokens - base.tokens) / base.maxTokens) * 100;
  if (dPercent >= COMPACTION_DEFAULTS.deferGrowthPercent) return true;
  return false;
}

/**
 * Evaluate once per "fresh reading" arriving at a real turn-end boundary.
 * items is the normalized array already filtered by enabled; index is keyed by its position in items.
 * Returns { index, item } for the confirm bar to show, or null.
 *
 * Order: cooldown (per-turn/growth release) → deferral (per-turn/growth release) → threshold (N consecutive).
 * This function only handles threshold decisions and reading-driven growth release; per-turn release is already done by advanceTurn (reading-independent).
 */
export function applyCheckpoint(state, items, reading) {
  if (!reading || !reading.ok || state.circuitOpen) return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  let pick = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // 1) Cooldown: released by dropping below hysteresis or by context growth (reading-driven); per-turn release already done by advanceTurn.
    if (state.cooldown.has(i)) {
      if (isBelowHysteresis(item, reading)) { state.cooldown.delete(i); state.counters.set(i, 0); }
      else continue;
    }
    // 2) Deferral (x decline / timeout / interrupt): released by dropping below hysteresis or by context growth (reading-driven); per-turn release already done by advanceTurn.
    const def = state.deferral.get(i);
    if (def) {
      if (shouldReleaseDeferral(def, item, reading)) {
        state.deferral.delete(i); state.counters.set(i, 0);
        // If still above threshold on the release occasion → becomes a candidate immediately (skip consecutive counting, matching "re-remind as soon as growth arrives").
        if (isAboveThreshold(item, reading) && !pick) pick = { index: i, item, released: true };
        continue;
      }
      continue; // still in the deferred period
    }
    // 2b) Deferrals released per-turn by advanceTurn this turn: if still above threshold on the release occasion → candidate immediately (skip consecutive counting).
    const releasedThisTurn = state.justReleasedDeferral && state.justReleasedDeferral.has(i);
    // 3) Permanent snooze (user explicitly "ignored"): re-arm only after dropping below hysteresis (and zero the counter).
    if (state.snoozed.has(i)) {
      if (isBelowHysteresis(item, reading)) { state.snoozed.delete(i); state.counters.set(i, 0); }
      else continue;
    }
    // 4) Threshold: N consecutive above-threshold readings are required to become a candidate (items released per-turn this turn are exempt from consecutive counting).
    if (!isAboveThreshold(item, reading)) { state.counters.set(i, 0); continue; }
    const n = (state.counters.get(i) || 0) + 1;
    state.counters.set(i, n);
    if (!pick && (releasedThisTurn || n >= COMPACTION_DEFAULTS.consecutiveRequired)) {
      pick = { index: i, item, ...(releasedThisTurn ? { released: true } : {}) };
    }
  }
  if (pick) state.counters.set(pick.index, 0); // re-accumulate after showing the bar, preventing repeated popups
  return pick;
}

/** Injection succeeded (local ack success/duplicate, or broadcast from another end): cooldown for cooldownTurns turns + zero the counter + reset failure count. */
export function markInjected(state, index) {
  if (typeof index === 'number') {
    state.cooldown.set(index, { releaseAtTurn: state.completedTurns + COMPACTION_DEFAULTS.cooldownTurns });
    state.counters.set(index, 0);
  }
  state.failures = 0;
  state.pendingInject = null;
}

/** Another end already injected / external compaction: put all items into cooldown and clear all deferrals and snoozes (rebaseline,
 *  so old baselines do not survive a history rewrite; after external compaction the context drops sharply and old snoozes/deferrals are meaningless). */
export function markExternalCompaction(state, items) {
  const n = Array.isArray(items) ? items.length : 0;
  for (let i = 0; i < n; i++) {
    state.cooldown.set(i, { releaseAtTurn: state.completedTurns + COMPACTION_DEFAULTS.cooldownTurns });
    state.counters.set(i, 0);
  }
  state.deferral = new Map();
  state.snoozed = new Set();
  state.pendingInject = null;
}

/** The user explicitly clicks "Ignore": permanent snooze (re-arm only after dropping below hysteresis). Separate from an (x) decline —
 *  (x) means "not this time, remind me later"; Ignore means "stop reminding me". Only explicit ignores come here. */
export function markIgnored(state, index) {
  state.snoozed.add(index);
  state.counters.set(index, 0);
}

/** (x) close (user declined this time) / confirm bar timeout / interrupted by a new round: defer the reminder —
 *  released when context +50K/+5pt arrives first (growth release; during normal conversation growth almost always arrives first), otherwise
 *  released per-turn at the end of the turn after next (releaseAtTurn = +2 turns) as a fallback. Not a permanent snooze: the user only
 *  declined "this time", not "never remind me".
 *  Note: releaseAtTurn is +2 rather than +1 so growth release wins at "the next turn" — with +1, advanceTurn would
 *  release per-turn at the start of the next turn, making the growth branch unreachable (review P1-2). +2 acts as the fallback covering
 *  the case where "the conversation stops advancing (no new turns), so growth never arrives", reminding once per-turn in that case.
 *  reading is the reading at close time (as the growth baseline); without a reading, baseline is null and it degrades to per-turn release only. */
export function markDeferred(state, index, reading, reason = 'x') {
  state.deferral.set(index, {
    reason,
    releaseAtTurn: state.completedTurns + 2,
    baseline: (reading && reading.ok) ? { tokens: reading.tokens, maxTokens: reading.maxTokens } : null,
  });
  state.counters.set(index, 0);
}

/** Injection failed (failure other than busy / ack timeout): cooldown 1 turn + failure count; trips the circuit breaker at the limit. */
export function markInjectFailed(state, index) {
  state.failures += 1;
  state.pendingInject = null;
  if (typeof index === 'number') state.cooldown.set(index, { releaseAtTurn: state.completedTurns + 1 });
  if (state.failures >= COMPACTION_DEFAULTS.failureLimit) state.circuitOpen = true;
  return state.circuitOpen;
}

/** busy is a retryable state: not counted as a failure, no cooldown, just clear pending. */
export function markInjectBusy(state) {
  state.pendingInject = null;
}

/** Optimistic rollback of an early SDK not-delivered: revoke the cooldown applied by the earlier ok, clear ack markers,
 *  letting the rule show the bar again next turn (the injection was not actually delivered). Not counted as a failure (not a compaction execution failure).
 *  clearPending: pass true for an immediate rollback (the ack is exactly the current in-flight one) to clear pending; a late rollback
 *  (when a newer pendingInject may exist) MUST pass false — never clear the current in-flight ownership, otherwise it would wrongly delete
 *  the newly injected pending, treat its subsequent success ack as an ownerless frame, and eventually misjudge an ack timeout as a failure and trip the circuit breaker (review P2). */
export function markInjectRolledBack(state, index, { clearPending = true } = {}) {
  if (clearPending) state.pendingInject = null;
  state.lastAckedReqId = null;
  state.lastAckedIndex = null;
  if (typeof index === 'number') {
    state.cooldown.delete(index);
    state.counters.set(index, 0);
  }
}
