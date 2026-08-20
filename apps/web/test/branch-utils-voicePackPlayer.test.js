/**
 * Branch top-up for src/utils/voicePackPlayer.js
 *
 * voice-pack-player.test.js + voice-pack-player-gap.test.js cover the happy/cooldown/
 * dedupe paths and the non-thenable play() arms for previewEvent / unlockAudio. The
 * remaining uncovered branches (single-run report → branch 82.86%, lines 106-108) are:
 *
 *   - startPlay sync catch (L105-108): audio.play() throws synchronously → chime + drain.
 *   - startPlay non-thenable play() (L97 false arm): play() returns undefined.
 *   - playChimeFallback `if (!Ctx) return` (L66): no AudioContext at all.
 *   - playChimeFallback webkit fallback (L65 right arm): window.webkitAudioContext only.
 *   - playChimeFallback `if (!_webAudioCtx)` false arm (L67): reuse the cached ctx.
 *   - playChimeFallback catch (L81): a throw mid-construction is swallowed.
 *   - playEvent `prefs.events &&` false arm (L147): prefs has no `events` object.
 *   - playEvent volume non-number default 0.3 (L166).
 *   - previewEvent `(prefs?.events && ...)` / `prefs?.volume` optional-chaining arms (L185/187).
 *
 * This file installs its own browser env (Audio.play() and AudioContext are toggleable
 * so we can force each arm), imports the real module dynamically AFTER the env is set
 * (apiUrl.js reads window.location at module load), and restores all globals/console
 * in after(). _resetForTests() resets module state between cases.
 */
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Audio mock: play() behaviour is toggleable per-test ──────────────────────────
//   'promise'      → returns a resolved Promise (default)
//   'reject'       → returns a rejected Promise (async autoplay block)
//   'nonpromise'   → returns undefined (legacy void play())
//   'throw'        → play() throws synchronously (drives the L105-108 catch)
class MockAudio {
  static instances = [];
  static playMode = 'promise';
  constructor() {
    this.src = '';
    this.volume = 1;
    this.preload = '';
    this.currentTime = 0;
    this.pauseCount = 0;
    this._listeners = {};
    MockAudio.instances.push(this);
  }
  addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); }
  removeEventListener() {}
  fire(name) { for (const fn of this._listeners[name] || []) fn(); }
  pause() { this.pauseCount += 1; }
  play() {
    switch (MockAudio.playMode) {
      case 'reject': return Promise.reject(new Error('autoplay-blocked'));
      case 'nonpromise': return undefined;
      case 'throw': throw new Error('sync play boom');
      default: return Promise.resolve();
    }
  }
}

// AudioContext mock — `failMode` lets us throw mid-construction to hit the chime catch.
class MockAudioContext {
  static count = 0;
  static failMode = false;
  constructor() {
    MockAudioContext.count += 1;
    this.currentTime = 0;
    if (MockAudioContext.failMode) throw new Error('ctx boom');
  }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect: () => ({ connect: () => {} }),
      start() {}, stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect: (next) => next,
    };
  }
  get destination() { return {}; }
}

function installBrowserEnv() {
  globalThis.window = { AudioContext: MockAudioContext, location: { search: '' } };
  globalThis.document = { hasFocus: () => false };
  globalThis.Audio = MockAudio;
}

const prefsAllOn = () => ({
  enabled: true,
  volume: 0.5,
  events: { planApproval: 'default', askQuestion: 'default', turnEnd: 'default' },
});

function waitUntil(pred, { timeout = 1000, interval = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = pred(); } catch { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start > timeout) return reject(new Error('waitUntil timeout'));
      setTimeout(tick, interval);
    };
    tick();
  });
}

let player;
before(async () => {
  installBrowserEnv();
  player = await import('../src/utils/voicePackPlayer.js');
});

after(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Audio;
});

beforeEach(() => {
  MockAudio.instances = [];
  MockAudio.playMode = 'promise';
  MockAudioContext.count = 0;
  MockAudioContext.failMode = false;
  player._resetForTests();
});

// ── startPlay sync catch (L105-108) ──────────────────────────────────────────────
describe('startPlay — synchronous play() throw', () => {
  it('throw from play() triggers chime fallback and drains the queue', () => {
    MockAudio.playMode = 'throw';
    // playEvent → startPlay → audio.play() throws synchronously → catch → chime + advance.
    assert.equal(player.playEvent('askQuestion', prefsAllOn(), { dedupeKey: 'sync-throw' }), true);
    assert.ok(MockAudioContext.count >= 1, 'sync catch should have fired the chime fallback');
  });

  it('sync throw drains so a later event can still play', () => {
    MockAudio.playMode = 'throw';
    // First event throws synchronously → advanceQueue sets playing=false again.
    player.playEvent('askQuestion', prefsAllOn(), { dedupeKey: 'a' });
    // Now play() works; second event should go straight to startPlay (not be queued forever).
    MockAudio.playMode = 'promise';
    assert.equal(player.playEvent('planApproval', prefsAllOn(), { dedupeKey: 'b' }), true);
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.match(a.src, /\/planApproval$/);
  });
});

// ── startPlay non-thenable play() (L97 false arm) ────────────────────────────────
describe('startPlay — play() returns a non-promise', () => {
  it('does not throw and still sets src/volume when play() is void', () => {
    MockAudio.playMode = 'nonpromise';
    assert.equal(player.playEvent('askQuestion', prefsAllOn(), { dedupeKey: 'void' }), true);
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.match(a.src, /\/api\/voice-pack\/audio\/default\/askQuestion$/);
    assert.equal(a.volume, 0.5);
    // No chime: this is the success-but-void path, not an error.
    assert.equal(MockAudioContext.count, 0);
  });
});

// ── startPlay async reject (L98 catch) — confirms chime fires on rejection ────────
describe('startPlay — async play() rejection', () => {
  it('rejection fires chime and advances the queue', async () => {
    MockAudio.playMode = 'reject';
    assert.equal(player.playEvent('askQuestion', prefsAllOn(), { dedupeKey: 'rej' }), true);
    await waitUntil(() => MockAudioContext.count >= 1);
    assert.ok(MockAudioContext.count >= 1);
  });
});

// ── playChimeFallback — AudioContext resolution branches ─────────────────────────
describe('playChimeFallback — context resolution', () => {
  it('returns silently when neither AudioContext nor webkitAudioContext exists (L66)', () => {
    const savedAC = globalThis.window.AudioContext;
    globalThis.window.AudioContext = undefined;
    globalThis.window.webkitAudioContext = undefined;
    try {
      // No Ctx → early return, no throw, no instances.
      assert.doesNotThrow(() => player.playChimeFallback());
    } finally {
      globalThis.window.AudioContext = savedAC;
      delete globalThis.window.webkitAudioContext;
    }
  });

  it('falls back to window.webkitAudioContext when AudioContext is absent (L65 right arm)', () => {
    const savedAC = globalThis.window.AudioContext;
    globalThis.window.AudioContext = undefined;
    globalThis.window.webkitAudioContext = MockAudioContext;
    MockAudioContext.count = 0;
    try {
      player.playChimeFallback();
      assert.equal(MockAudioContext.count, 1, 'webkit ctor must be used as fallback');
    } finally {
      globalThis.window.AudioContext = savedAC;
      delete globalThis.window.webkitAudioContext;
    }
  });

  it('reuses the cached _webAudioCtx on the second call (L67 false arm)', () => {
    player.playChimeFallback();
    assert.equal(MockAudioContext.count, 1, 'first call creates the context');
    player.playChimeFallback();
    assert.equal(MockAudioContext.count, 1, 'second call must reuse the cached context, not create a new one');
  });

  it('swallows a throw during context/oscillator construction (L81 catch)', () => {
    MockAudioContext.failMode = true; // ctor throws
    assert.doesNotThrow(() => player.playChimeFallback(), 'chime errors must be swallowed');
  });
});

// ── playEvent — prefs.events falsy (L147 left arm of &&) ──────────────────────────
describe('playEvent — prefs without an events map', () => {
  it('returns false when prefs.events is absent (binding resolves undefined)', () => {
    // enabled:true but no `events` → `prefs.events && prefs.events[eventKey]` short-circuits
    // to undefined → the null/undefined gate returns false.
    assert.equal(player.playEvent('planApproval', { enabled: true }), false);
    assert.equal(MockAudio.instances.length, 0);
  });
});

// ── urlForBinding — empty-string binding hits the `!binding` true arm (L41) ──────
describe('playEvent — empty-string binding', () => {
  it("treats '' binding as 'default' (falls into the bundled-pack route)", () => {
    // playEvent only short-circuits on null/undefined, so '' reaches urlForBinding,
    // where `(!binding) ? 'default' : binding` resolves packId='default'.
    const prefs = prefsAllOn();
    prefs.events.askQuestion = '';
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'empty' }), true);
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.match(a.src, /\/api\/voice-pack\/audio\/default\/askQuestion$/);
  });
});

// ── playEvent — volume default when not a number (L166 ternary false arm) ─────────
describe('playEvent — non-numeric volume', () => {
  it('uses the 0.3 default when prefs.volume is not a number', () => {
    const prefs = prefsAllOn();
    prefs.volume = 'loud'; // not a number → default 0.3
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'novol' }), true);
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.equal(a.volume, 0.3);
  });

  it('uses the 0.3 default when prefs.volume is missing', () => {
    const prefs = { enabled: true, events: { askQuestion: 'default' } };
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'novol2' }), true);
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.equal(a.volume, 0.3);
  });
});

// ── previewEvent — optional-chaining / default arms (L185, L187) ──────────────────
describe('previewEvent — optional-chaining defaults', () => {
  it('falls back to "default" binding and 0.3 volume when prefs is undefined', () => {
    // prefs?.events → undefined; prefs?.volume → undefined → 0.3 default.
    const ret = player.previewEvent('planApproval', undefined);
    assert.ok(ret && typeof ret.then === 'function');
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.match(a.src, /\/api\/voice-pack\/audio\/default\/planApproval$/);
    assert.equal(a.volume, 0.3);
  });

  it('honours an explicit numeric volume', () => {
    player.previewEvent('askQuestion', { volume: 0.9, events: { askQuestion: 'default' } });
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.equal(a.volume, 0.9);
  });

  it('preview play() rejection triggers chime fallback', async () => {
    MockAudio.playMode = 'reject';
    const ret = player.previewEvent('planApproval', prefsAllOn());
    await ret; // the .catch arm resolves after firing the chime
    assert.ok(MockAudioContext.count >= 1, 'preview rejection should chime');
  });
});

// ── previewEvent — SSR guard (window absent) ─────────────────────────────────────
describe('previewEvent — SSR guard', () => {
  it('resolves without touching Audio when window is undefined', async () => {
    const saved = globalThis.window;
    delete globalThis.window;
    try {
      const ret = player.previewEvent('planApproval', prefsAllOn());
      assert.ok(ret && typeof ret.then === 'function');
      await ret;
    } finally {
      globalThis.window = saved;
    }
  });
});

// ── playEvent — SSR guard (window absent, L145) ──────────────────────────────────
describe('playEvent — SSR guard', () => {
  it('returns false when window is undefined', () => {
    const saved = globalThis.window;
    delete globalThis.window;
    try {
      assert.equal(player.playEvent('turnEnd', prefsAllOn()), false);
    } finally {
      globalThis.window = saved;
    }
  });
});

// ── advanceQueue — empty queue (the `if (next)` false arm) ────────────────────────
describe('advanceQueue — empty queue on ended', () => {
  it("firing 'ended' with nothing queued just flips playing=false (no new audio)", () => {
    // Single event, no queue behind it. play() pending so it "stays playing".
    MockAudio.playMode = 'nonpromise'; // non-thenable: playing stays true, no async settle
    assert.equal(player.playEvent('askQuestion', prefsAllOn(), { dedupeKey: 'solo' }), true);
    const a = MockAudio.instances[0];
    const countBefore = MockAudio.instances.length;
    a.fire('ended'); // advanceQueue: queue empty → next undefined → no startPlay
    assert.equal(MockAudio.instances.length, countBefore, 'no new audio on empty-queue advance');
    // A fresh event after the drain plays on the same element (playing reset to false).
    MockAudio.playMode = 'promise';
    assert.equal(player.playEvent('planApproval', prefsAllOn(), { dedupeKey: 'after' }), true);
  });
});

// ── getMainAudio error listener → chime + drain ──────────────────────────────────
describe('getMainAudio — error event drains the queue', () => {
  it("the audio 'error' listener fires the chime and advances", () => {
    MockAudio.playMode = 'nonpromise';
    assert.equal(player.playEvent('askQuestion', prefsAllOn(), { dedupeKey: 'err' }), true);
    const a = MockAudio.instances[0];
    MockAudioContext.count = 0;
    a.fire('error'); // → playChimeFallback() + advanceQueue()
    assert.ok(MockAudioContext.count >= 1, 'error listener must chime');
  });
});
