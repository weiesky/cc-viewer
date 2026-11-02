// Singleton voice-pack playback for ApprovalModal / AppBase / Mobile.
//
// Responsibilities:
//   1. Resolve event → URL based on per-event binding ('default' | <uuid> | null).
//   2. Serialise playback through one shared <Audio> element (no overlap when
//      multiple lifecycle events fire simultaneously —).
//   3. Honor a per-event cooldown so noisy events (turnEnd) don't spam the user.
//   4. Survive autoplay-policy block: play() rejection falls back to Web Audio
//      chime so the user still gets *some* signal even before they've interacted.
//   5. Keep a separate Audio element for Settings preview so previews don't
//      compete with live event playback.
//
// Pure module state — one queue per browsing context. Multi-tab Electron each
// have their own module instance (different webContents = different module);
// that's fine: each tab unlocks its own audio independently per browser policy.

import { apiUrl } from './apiUrl.js';
import { BUNDLED_PACK_IDS } from '@ccv/core/voice-pack-events';

// Mirror BUNDLED_PACK_IDS into a Set for O(1) lookup in the hot URL-building
// path. Frozen array ↔ Set conversion at module load is fine; the source list
// is itself frozen so the Set can't drift.
const BUNDLED_PACK_ID_SET = new Set(BUNDLED_PACK_IDS);

let mainAudio = null;
let previewAudio = null;
const queue = [];
let playing = false;
let unlocked = false;
const lastFireAt = new Map(); // eventKey → ts
const lastDedupeKey = new Map(); // eventKey → caller-supplied dedupe key

function urlForBinding(eventKey, binding) {
  const head = '/api/voice-pack/audio';
  // Bundled packs route as /<packId>/<eventKey>; user uploads as /<uuid>.
  // null / undefined binding falls back to 'default' so the chime-fallback layer
  // still gets a real URL to attempt (404 → chime is handled in startPlay).
  // The Set check (not equality with 'default') is critical — without it,
  // binding='sanguo' would route to /api/voice-pack/audio/sanguo (no event
  // suffix), hit the uuid branch, fail isValidId, and 404 → silent chime.
  const packId = (!binding) ? 'default' : binding;
  const path = BUNDLED_PACK_ID_SET.has(packId)
    ? `${head}/${packId}/${encodeURIComponent(eventKey)}`
    : `${head}/${encodeURIComponent(binding)}`;
  // apiUrl injects the ?token=... LAN auth query when present — same path other API calls use.
  return apiUrl(path);
}

function getMainAudio() {
  if (mainAudio) return mainAudio;
  mainAudio = new Audio();
  mainAudio.preload = 'auto';
  mainAudio.addEventListener('ended', advanceQueue);
  // 'error' also drains so a 404 / decode failure doesn't deadlock the queue.
  mainAudio.addEventListener('error', () => { playChimeFallback(); advanceQueue(); });
  return mainAudio;
}

let _webAudioCtx = null;
// Two-tone chime — exported so ApprovalModal can also use it for the legacy
// `soundEnabled` path. Single Web Audio context lives here (was duplicated
// across player + ApprovalModal until they were deduped here).
export function playChimeFallback() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!_webAudioCtx) _webAudioCtx = new Ctx();
    const ctx = _webAudioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.18);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch { /* ignore */ }
}

function advanceQueue() {
  playing = false;
  const next = queue.shift();
  if (next) startPlay(next);
}

function startPlay({ url, volume }) {
  const audio = getMainAudio();
  playing = true;
  try {
    audio.src = url;
    audio.volume = Math.max(0, Math.min(1, volume));
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay blocked OR audio 404 — fire chime so user is at least notified,
        // and immediately drain so we don't sit on a poisoned queue.
        playChimeFallback();
        advanceQueue();
      });
    }
  } catch {
    playChimeFallback();
    advanceQueue();
  }
}

// Per-event cooldown (review: kept as a module constant, not user-configurable.
// The previous prefs.cooldownMs override was phantom config — neither persisted
// nor exposed in Settings — so it was removed to avoid half-built
// flexibility users couldn't actually use).
// SUNSET-MARKER: ccv-turn-end-debounce
// Frontend caller-side cooldown，作为 server 端 trailing debounce 漏掉时的兜底二保险
// （SSE 重连重发、server 罕见广播失序等）。**与 server `CCV_TURN_END_DEBOUNCE_MS`
// 自动对齐**：AppBase.jsx 监听 SSE `server_config` 事件并调 `setTurnEndCooldownMs` 注入
// server 实际生效的 debounce 值，无需运维手工同步两边常量。
const COOLDOWN_MS = {
  turnEnd: 10_000,
};

/**
 * Update the turnEnd caller-side cooldown at runtime — called by AppBase on
 * receipt of `server_config` SSE event. Keeps frontend in sync with the server's
 * `CCV_TURN_END_DEBOUNCE_MS` env override without redeploy.
 * Mirrors server clamp [100, 60000] so a malformed/tampered server_config payload
 * (n=0 disables cooldown → voice spam) can't kill the二保险.
 */
export function setTurnEndCooldownMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 100 || n > 60_000) {
    try { console.warn(`[voicePack] setTurnEndCooldownMs(${ms}) out of [100,60000]; keeping`, COOLDOWN_MS.turnEnd); } catch {}
    return;
  }
  COOLDOWN_MS.turnEnd = n;
}

// Main entry point.
//   eventKey:  'planApproval' | 'askQuestion' | 'turnEnd'
//   prefs:     prefs.approvalModal.voicePack — { enabled, volume, events: { ... } }
//   opts.dedupeKey:  optional string; second call with same key for same event is ignored
export function playEvent(eventKey, prefs, opts = {}) {
  if (typeof window === 'undefined') return false;
  if (!prefs || prefs.enabled !== true) return false;
  const binding = prefs.events && prefs.events[eventKey];
  if (binding === null || binding === undefined) return false; // event disabled

  // Per-event cooldown (constants only — no prefs override; see COOLDOWN_MS).
  const cooldown = COOLDOWN_MS[eventKey] || 0;
  if (cooldown > 0) {
    const last = lastFireAt.get(eventKey) || 0;
    if (Date.now() - last < cooldown) return false;
  }

  // Caller-side dedupe (e.g. same approval modal kind re-rendering shouldn't
  // refire). Per-event key isolation so concurrent kinds don't suppress each other.
  if (opts.dedupeKey) {
    if (lastDedupeKey.get(eventKey) === opts.dedupeKey) return false;
    lastDedupeKey.set(eventKey, opts.dedupeKey);
  }

  lastFireAt.set(eventKey, Date.now());
  const url = urlForBinding(eventKey, binding);
  const volume = typeof prefs.volume === 'number' ? Math.max(0, Math.min(1, prefs.volume)) : 0.3;

  if (playing) {
    queue.push({ url, volume });
  } else {
    startPlay({ url, volume });
  }
  return true;
}

// Settings preview — independent of the live queue, so previewing while a
// real event is playing doesn't either kill the live audio or wait behind it.
export function previewEvent(eventKey, prefs) {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!previewAudio) previewAudio = new Audio();
  try {
    previewAudio.pause();
    previewAudio.currentTime = 0;
  } catch { /* ignore */ }
  const binding = (prefs?.events && prefs.events[eventKey]) || 'default';
  previewAudio.src = urlForBinding(eventKey, binding);
  previewAudio.volume = typeof prefs?.volume === 'number' ? Math.max(0, Math.min(1, prefs.volume)) : 0.3;
  const p = previewAudio.play();
  if (p && typeof p.catch === 'function') {
    return p.catch(() => { playChimeFallback(); });
  }
  return Promise.resolve();
}

export function stopPreview() {
  if (previewAudio) {
    try { previewAudio.pause(); previewAudio.currentTime = 0; } catch { /* ignore */ }
  }
}

// Call from a click / keypress handler (Settings open is a good spot) to satisfy
// Chrome/Safari/Firefox autoplay policy. Plays a silent 1-sample WAV so the
// audio element is "blessed" for programmatic playback for the rest of the tab's life.
export function unlockAudio() {
  if (unlocked) return Promise.resolve(true);
  if (typeof window === 'undefined') return Promise.resolve(false);
  try {
    const audio = getMainAudio();
    audio.volume = 0;
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      return p.then(() => { unlocked = true; return true; }).catch(() => false);
    }
    unlocked = true;
    return Promise.resolve(true);
  } catch { return Promise.resolve(false); }
}

// Test hook — reset module state between unit tests. **Do not call from app code.**
// Exported as a named function so an "unused exports" linter can see it's referenced
// by apps/web/test/voice-pack-player.test.js (— without this, a future cleanup pass
// could mistake it for dead code).
export function _resetForTests() {
  mainAudio = null;
  previewAudio = null;
  queue.length = 0;
  playing = false;
  unlocked = false;
  lastFireAt.clear();
  lastDedupeKey.clear();
  _webAudioCtx = null;
}
