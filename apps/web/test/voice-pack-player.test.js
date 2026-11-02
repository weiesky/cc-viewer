/**
 * Unit tests for src/utils/voicePackPlayer.js
 *
 * The player is renderer-only, so we mock window / document / Audio / AudioContext
 * onto globalThis before importing the module. Same pattern as
 * test/fileExpandedPathsStorage.test.js — no jsdom dependency.
 */
import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── Browser environment mocks ────────────────────────────────────────────────

// Audio mock — captures src/volume, fires 'ended' on demand, lets us reject play().
class MockAudio {
  static instances = [];
  static playMode = 'success'; // 'success' | 'reject' | 'pending'

  constructor() {
    this.src = '';
    this.volume = 1;
    this.preload = '';
    this._listeners = {};
    this.playCount = 0;
    this.pauseCount = 0;
    this.currentTime = 0;
    MockAudio.instances.push(this);
  }
  addEventListener(name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
  }
  removeEventListener() { /* noop */ }
  fire(name) {
    for (const fn of this._listeners[name] || []) fn();
  }
  play() {
    this.playCount += 1;
    if (MockAudio.playMode === 'success') return Promise.resolve();
    if (MockAudio.playMode === 'pending') return new Promise(() => { /* never settles */ });
    return Promise.reject(new Error('autoplay-blocked'));
  }
  pause() { this.pauseCount += 1; }
}

// Audio-context mock — captures osc/gain creation so we can assert chime fallback.
class MockAudioContext {
  static count = 0;
  constructor() { MockAudioContext.count += 1; this.currentTime = 0; }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
      connect: () => ({ connect: () => {} }),
      start: () => {},
      stop: () => {},
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

let documentHasFocus = false;

function installBrowserEnv() {
  globalThis.window = {
    AudioContext: MockAudioContext,
    location: { search: '' }, // apiUrl reads this at module load
  };
  globalThis.document = {
    hasFocus: () => documentHasFocus,
  };
  globalThis.Audio = MockAudio;
}

function resetMocks() {
  MockAudio.instances = [];
  MockAudio.playMode = 'success';
  MockAudioContext.count = 0;
  documentHasFocus = false;
}

before(() => { installBrowserEnv(); });

// We import dynamically *after* the env is in place, because apiUrl.js reads
// window.location.search at import time. Static `import` runs before `before()`.
let player;
before(async () => {
  player = await import('../src/utils/voicePackPlayer.js');
});

after(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Audio;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const prefsAllOn = () => ({
  enabled: true,
  volume: 0.5,
  events: {
    planApproval: 'default',
    askQuestion: 'default',
    turnEnd: 'default',
  },
});

beforeEach(() => {
  resetMocks();
  player._resetForTests();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('playEvent — gating', () => {
  it('returns false when prefs is null', () => {
    assert.equal(player.playEvent('planApproval', null), false);
    assert.equal(MockAudio.instances.length, 0);
  });

  it('returns false when enabled !== true', () => {
    assert.equal(player.playEvent('planApproval', { enabled: false, events: { planApproval: 'default' } }), false);
    assert.equal(MockAudio.instances.length, 0);
  });

  it('returns false when the event binding is null (disabled)', () => {
    const prefs = prefsAllOn();
    prefs.events.planApproval = null;
    assert.equal(player.playEvent('planApproval', prefs), false);
    assert.equal(MockAudio.instances.length, 0);
  });

  it('returns false when binding is undefined (no such event key)', () => {
    const prefs = prefsAllOn();
    delete prefs.events.planApproval;
    assert.equal(player.playEvent('planApproval', prefs), false);
  });
});

describe('playEvent — URL building', () => {
  it("default binding hits /api/voice-pack/audio/default/<eventKey>", () => {
    assert.equal(player.playEvent('planApproval', prefsAllOn()), true);
    const a = MockAudio.instances[0];
    assert.match(a.src, /\/api\/voice-pack\/audio\/default\/planApproval$/);
  });

  it('uuid binding hits /api/voice-pack/audio/<id>', () => {
    const prefs = prefsAllOn();
    prefs.events.askQuestion = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';
    assert.equal(player.playEvent('askQuestion', prefs), true);
    const a = MockAudio.instances[0];
    assert.match(a.src, /\/api\/voice-pack\/audio\/a1b2c3d4-e5f6-7890-abcd-ef0123456789$/);
  });

  it("sanguo binding hits /api/voice-pack/audio/sanguo/<eventKey> (P0 — Set check, not equality)", () => {
    // Regression guard for P0-A: pre-fix, urlForBinding only matched
    // binding === 'default'. binding === 'sanguo' fell into the uuid branch →
    // /api/voice-pack/audio/sanguo (no event suffix) → 404 → silent chime.
    const prefs = prefsAllOn();
    prefs.events.planApproval = 'sanguo';
    assert.equal(player.playEvent('planApproval', prefs), true);
    const a = MockAudio.instances[0];
    assert.match(a.src, /\/api\/voice-pack\/audio\/sanguo\/planApproval$/);
  });

  it('clamps volume to 0..1 and applies it to the audio element', () => {
    const prefs = prefsAllOn();
    prefs.volume = 1.7; // out of range high
    player.playEvent('planApproval', prefs);
    assert.equal(MockAudio.instances[MockAudio.instances.length - 1].volume, 1);
    player._resetForTests();
    // Note: _resetForTests resets *module* state (mainAudio = null) but keeps the
    // shared MockAudio.instances array, so a fresh playEvent creates a new instance.
    prefs.volume = -2; // out of range low
    player.playEvent('planApproval', prefs);
    assert.equal(MockAudio.instances[MockAudio.instances.length - 1].volume, 0);
  });
});

describe('playEvent — cooldown', () => {
  it("turnEnd second call within 30s is suppressed", () => {
    const prefs = prefsAllOn();
    assert.equal(player.playEvent('turnEnd', prefs), true);
    const firstCount = MockAudio.instances.length;
    assert.equal(player.playEvent('turnEnd', prefs), false, 'cooldown should suppress immediate re-fire');
    assert.equal(MockAudio.instances.length, firstCount, 'no new audio element should spawn');
  });

  it("planApproval has no default cooldown — back-to-back ids both play", () => {
    const prefs = prefsAllOn();
    assert.equal(player.playEvent('planApproval', prefs, { dedupeKey: 'planApproval:1' }), true);
    // First audio's 'ended' fires → queue drains. Simulate it so the second can play immediately.
    MockAudio.instances[0].fire('ended');
    assert.equal(player.playEvent('planApproval', prefs, { dedupeKey: 'planApproval:2' }), true);
  });
});

describe('playEvent — dedupeKey', () => {
  it('same (eventKey, dedupeKey) is suppressed on second call', () => {
    const prefs = prefsAllOn();
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'ask:123' }), true);
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'ask:123' }), false);
  });

  it('different eventKeys have isolated dedupe state (concurrent kinds both fire)', () => {
    const prefs = prefsAllOn();
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'ask:123' }), true);
    assert.equal(player.playEvent('planApproval', prefs, { dedupeKey: 'plan:123' }), true);
  });
});

describe('playEvent — no focus gate (turnEnd plays regardless of focus)', () => {
  // 反向 invariant：剔除"仅窗口失焦时响"门控后，文档聚焦也必须播 —— 防回滚保护。
  // 用户视角："任务结束就响"，靠 30s cooldown + dedupeKey 防扰民，不靠 focus 门控。
  it('turnEnd plays even when document.hasFocus() === true', () => {
    documentHasFocus = true;
    assert.equal(player.playEvent('turnEnd', prefsAllOn()), true);
    assert.equal(MockAudio.instances.length, 1);
  });

  it('turnEnd still plays when document.hasFocus() === false', () => {
    documentHasFocus = false;
    assert.equal(player.playEvent('turnEnd', prefsAllOn()), true);
  });

  it('legacy `focusGate: true` opt is ignored (no longer suppresses)', () => {
    documentHasFocus = true;
    // 老调用方残留 focusGate: true 不应反复挡播放 —— 参数本身已从 playEvent 移除。
    // 双锁：返回值 true + 真的有 Audio 实例（防未来某次重构走 chime fallback 仍假阳）。
    assert.equal(player.playEvent('turnEnd', prefsAllOn(), { focusGate: true }), true);
    assert.equal(MockAudio.instances.length, 1);
  });
});

describe('playEvent — serial queue', () => {
  it("second event waits for first 'ended' before its src is set on the shared Audio", () => {
    // Hold play() pending so the first event "is still playing".
    MockAudio.playMode = 'pending';
    const prefs = prefsAllOn();
    player.playEvent('askQuestion', prefs, { dedupeKey: 'k1' });
    // While "playing", the queue should accept a second event without creating a new Audio.
    player.playEvent('planApproval', prefs, { dedupeKey: 'k2' });
    assert.equal(MockAudio.instances.length, 1, 'queue must reuse the single shared Audio element');
    const a = MockAudio.instances[0];
    const firstSrc = a.src;
    // First finishes — queue advances → src swaps to the second event.
    MockAudio.playMode = 'success';
    a.fire('ended');
    assert.notEqual(a.src, firstSrc, 'src should swap to the queued event after the first ends');
    assert.match(a.src, /\/planApproval$/);
  });
});

describe('playEvent — autoplay-block fallback', () => {
  it("play() rejection triggers chime fallback and advances the queue", async () => {
    MockAudio.playMode = 'reject';
    const prefs = prefsAllOn();
    assert.equal(player.playEvent('askQuestion', prefs, { dedupeKey: 'k1' }), true);
    // Wait for the play() promise rejection to flush
    await new Promise(r => setTimeout(r, 0));
    assert.ok(MockAudioContext.count >= 1, 'chime fallback should have created a Web Audio context');
  });
});

describe('previewEvent', () => {
  it("creates a SEPARATE Audio element from main queue (preview doesn't block live playback)", () => {
    const prefs = prefsAllOn();
    // Trigger main queue playback.
    player.playEvent('askQuestion', prefs, { dedupeKey: 'live' });
    const before = MockAudio.instances.length;
    player.previewEvent('planApproval', prefs);
    assert.ok(MockAudio.instances.length > before, 'preview must spawn its own Audio instance');
  });

  it('falls back to "default" when prefs has no binding for the event', () => {
    player.previewEvent('planApproval', { volume: 0.5 });
    const a = MockAudio.instances[MockAudio.instances.length - 1];
    assert.match(a.src, /\/api\/voice-pack\/audio\/default\/planApproval$/);
  });
});

describe('unlockAudio', () => {
  it('plays a silent data URL on first call and caches success', async () => {
    const r = await player.unlockAudio();
    assert.equal(r, true);
    const a = MockAudio.instances[0];
    assert.match(a.src, /^data:audio\/wav;base64,/);
  });

  it('second call returns true without creating extra audio', async () => {
    await player.unlockAudio();
    const after = MockAudio.instances.length;
    const r2 = await player.unlockAudio();
    assert.equal(r2, true);
    assert.equal(MockAudio.instances.length, after);
  });
});
