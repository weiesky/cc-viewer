/**
 * Gap top-up for src/utils/voicePackPlayer.js
 *
 * test/voice-pack-player.test.js covers playEvent / previewEvent / unlockAudio happy
 * paths, but its MockAudio.play() ALWAYS returns a Promise, so these stay uncovered:
 *   - L131-138: setTurnEndCooldownMs (valid set + out-of-range warn/keep)  — never called
 *   - L191-192: previewEvent's `return Promise.resolve()` when play() is non-thenable
 *   - L195-199: stopPreview                                                — never called
 *   - L215-217: unlockAudio's synchronous branch when play() returns a non-promise
 *
 * We install our own browser env whose Audio.play() can return a NON-promise (toggle),
 * import the real module after the env is in place (apiUrl reads window.location at load),
 * and exercise the missing branches. setTurnEndCooldownMs mutates a module constant that
 * _resetForTests() does NOT reset, so after() restores it to the 10_000ms default to keep
 * the sibling test (which relies on the turnEnd cooldown) deterministic when both run in
 * the same process.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Audio mock: play() returns a Promise OR a non-promise, per toggle ────────────
class MockAudio {
  static instances = [];
  static playReturnsPromise = true; // false → play() returns undefined (sync-success path)
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
  pause() { this.pauseCount += 1; }
  play() {
    if (MockAudio.playReturnsPromise) return Promise.resolve();
    return undefined; // some browsers' HTMLMediaElement.play() historically returned void
  }
}

class MockAudioContext {
  static count = 0;
  constructor() { MockAudioContext.count += 1; this.currentTime = 0; }
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

let player;
let warnLogs;
let origWarn;
before(async () => {
  installBrowserEnv();
  player = await import('../src/utils/voicePackPlayer.js');
  origWarn = console.warn;
  warnLogs = [];
  console.warn = (...args) => { warnLogs.push(args); };
});

after(() => {
  // Restore the turnEnd cooldown to its module default so a co-running sibling test
  // (which depends on the 10_000ms cooldown) isn't affected by our mutations.
  player.setTurnEndCooldownMs(10_000);
  console.warn = origWarn;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Audio;
});

beforeEach(() => {
  MockAudio.instances = [];
  MockAudio.playReturnsPromise = true;
  MockAudioContext.count = 0;
  warnLogs.length = 0;
  player._resetForTests();
});

// ── setTurnEndCooldownMs (L131-138) ──────────────────────────────────────────────
describe('setTurnEndCooldownMs', () => {
  it('accepts an in-range value and applies it to the turnEnd cooldown', () => {
    player.setTurnEndCooldownMs(500);
    // Fire turnEnd once (passes cooldown), then again immediately → suppressed by new 500ms cooldown.
    assert.equal(player.playEvent('turnEnd', prefsAllOn()), true);
    assert.equal(player.playEvent('turnEnd', prefsAllOn()), false);
    assert.equal(warnLogs.length, 0, 'a valid value should not warn');
  });

  it('coerces numeric strings (Number("100") === 100 is in-range)', () => {
    player.setTurnEndCooldownMs('100');
    assert.equal(warnLogs.length, 0);
  });

  it('rejects a value below 100 and warns, keeping the previous cooldown', () => {
    player.setTurnEndCooldownMs(1000); // establish a known good value first
    warnLogs.length = 0;
    player.setTurnEndCooldownMs(50); // < 100 → rejected
    assert.equal(warnLogs.length, 1);
    assert.match(String(warnLogs[0][0]), /out of \[100,60000\]/);
    // Previous 1000ms cooldown is still in force: immediate turnEnd re-fire is suppressed.
    assert.equal(player.playEvent('turnEnd', prefsAllOn()), true);
    assert.equal(player.playEvent('turnEnd', prefsAllOn()), false);
  });

  it('rejects a value above 60000 and warns', () => {
    player.setTurnEndCooldownMs(60_001);
    assert.equal(warnLogs.length, 1);
    assert.match(String(warnLogs[0][0]), /out of \[100,60000\]/);
  });

  it('rejects non-finite input (NaN / Infinity) and warns', () => {
    player.setTurnEndCooldownMs('not-a-number');
    player.setTurnEndCooldownMs(Infinity);
    assert.equal(warnLogs.length, 2);
  });
});

// ── previewEvent non-thenable play() (L191-192) ──────────────────────────────────
describe('previewEvent — play() returns a non-promise', () => {
  it('returns a resolved Promise (not undefined) when play() is non-thenable', async () => {
    MockAudio.playReturnsPromise = false;
    const ret = player.previewEvent('planApproval', prefsAllOn());
    assert.ok(ret && typeof ret.then === 'function', 'must always return a thenable');
    await ret; // resolves without throwing
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.match(a.src, /\/api\/voice-pack\/audio\/default\/planApproval$/);
  });

  it('still returns a thenable when window is absent (SSR guard)', async () => {
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

// ── stopPreview (L195-199) ───────────────────────────────────────────────────────
describe('stopPreview', () => {
  it('pauses and rewinds the preview audio after a preview has played', () => {
    player.previewEvent('askQuestion', prefsAllOn()); // creates previewAudio
    const preview = MockAudio.instances[MockAudio.instances.length - 1];
    preview.currentTime = 5;
    player.stopPreview();
    assert.equal(preview.pauseCount >= 1, true);
    assert.equal(preview.currentTime, 0);
  });

  it('is a no-op when no preview audio exists yet (does not throw)', () => {
    // fresh module state → previewAudio is null
    assert.doesNotThrow(() => player.stopPreview());
  });
});

// ── unlockAudio sync-success branch (L215-217) ──────────────────────────────────
describe('unlockAudio — play() returns a non-promise', () => {
  it('marks unlocked and resolves true via the synchronous branch', async () => {
    MockAudio.playReturnsPromise = false;
    const r = await player.unlockAudio();
    assert.equal(r, true);
    const a = MockAudio.instances[0];
    assert.match(a.src, /^data:audio\/wav;base64,/);
    assert.equal(a.volume, 0);
    // Cached: a second call short-circuits to true with no new Audio element.
    const before = MockAudio.instances.length;
    const r2 = await player.unlockAudio();
    assert.equal(r2, true);
    assert.equal(MockAudio.instances.length, before);
  });

  it('returns false when window is absent (SSR guard)', async () => {
    const saved = globalThis.window;
    delete globalThis.window;
    try {
      const r = await player.unlockAudio();
      assert.equal(r, false);
    } finally {
      globalThis.window = saved;
    }
  });
});
