/**
 * Unit tests for @ccv/core/approval-modal-prefs (packages/core/src/) — `mergeApprovalModalPrefs` +
 * `mergeVoicePackInto`.
 *
 * Hot-path coverage: `/api/preferences` POST runs `mergeApprovalModalPrefs` on
 * every settings save. A regression here silently corrupts user prefs.
 *
 * Migrated from test/voice-pack-manager.test.js when the merge function moved
 * to its own module (round-2 architect P1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeApprovalModalPrefs, mergeVoicePackInto } from '../src/approval-modal-prefs.js';
import { EVENT_KEYS } from '../src/voice-pack-events.js';

describe('mergeVoicePackInto', () => {
  it('filters incoming events through EVENT_KEYS whitelist (defense-in-depth)', () => {
    const base = { events: { askQuestion: 'default' } };
    const r = mergeVoicePackInto(base, { events: { askQuestion: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', __proto__: { polluted: true }, constructor: 'evil', notARealEvent: 'x' } });
    // Only EVENT_KEYS land in events as own props (use ownKeys to skip the prototype chain).
    for (const k of Object.keys(r.events)) {
      assert.ok(EVENT_KEYS.includes(k), `${k} should not have been allowed through`);
    }
    assert.equal(r.events.askQuestion, 'a1b2c3d4-e5f6-7890-abcd-ef0123456789');
  });

  it('preserves untouched event bindings when partial update arrives', () => {
    const base = { enabled: true, events: { askQuestion: 'default', planApproval: 'default', turnEnd: null } };
    const r = mergeVoicePackInto(base, { events: { askQuestion: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' } });
    assert.equal(r.events.planApproval, 'default');
    assert.equal(r.events.turnEnd, null);
    assert.equal(r.events.askQuestion, 'a1b2c3d4-e5f6-7890-abcd-ef0123456789');
  });

  it('merges top-level fields shallowly (enabled / volume)', () => {
    const base = { enabled: true, volume: 0.5, events: { askQuestion: 'default' } };
    const r = mergeVoicePackInto(base, { volume: 0.7 });
    assert.equal(r.enabled, true);
    assert.equal(r.volume, 0.7);
    assert.equal(r.events.askQuestion, 'default');
  });

  it('returns base (with events whitelist applied) when incoming is null/undefined/non-object', () => {
    const base = { enabled: true, events: { askQuestion: 'default', stray: 'x' } };
    for (const inc of [null, undefined, 42, 'string']) {
      const r = mergeVoicePackInto(base, inc);
      assert.equal(r.enabled, true);
      assert.equal(r.events.askQuestion, 'default');
      assert.equal('stray' in r.events, false, 'stray key should be filtered out even when incoming is absent');
    }
  });

  it('treats null base as empty object', () => {
    const r = mergeVoicePackInto(null, { enabled: true, events: { askQuestion: 'default' } });
    assert.equal(r.enabled, true);
    assert.equal(r.events.askQuestion, 'default');
  });

  it('does not mutate the inputs', () => {
    const base = { enabled: true, events: { askQuestion: 'default' } };
    const inc = { events: { askQuestion: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' } };
    const baseCopy = JSON.parse(JSON.stringify(base));
    const incCopy = JSON.parse(JSON.stringify(inc));
    mergeVoicePackInto(base, inc);
    assert.deepEqual(base, baseCopy);
    assert.deepEqual(inc, incCopy);
  });

  it("passes 'sanguo' bundled-pack value through verbatim (no value-domain filtering at merge)", () => {
    // Merge layer is key-shape-only; value validation is reconcile's job.
    // This test pins that contract so a future "let's add value whitelist
    // here too" refactor either updates the test or recognises it duplicates
    // reconcile work.
    const base = { enabled: true, events: { askQuestion: 'default', planApproval: 'default', turnEnd: null } };
    const r = mergeVoicePackInto(base, { events: { askQuestion: 'sanguo', planApproval: 'sanguo' } });
    assert.equal(r.events.askQuestion, 'sanguo', 'sanguo must merge verbatim — reconcile validates downstream');
    assert.equal(r.events.planApproval, 'sanguo');
    assert.equal(r.events.turnEnd, null, 'unrelated keys preserved');
  });
});

describe('mergeApprovalModalPrefs', () => {
  it('shallow-merges top-level approvalModal fields', () => {
    const base = { modalEnabled: true, soundEnabled: false, notifyOnlyWhenHidden: true };
    const r = mergeApprovalModalPrefs(base, { soundEnabled: true });
    assert.equal(r.modalEnabled, true);
    assert.equal(r.soundEnabled, true);
    assert.equal(r.notifyOnlyWhenHidden, true);
  });

  it('persists the planAutoApproveSeconds top-level number (write / override / preserve)', () => {
    // write into a base that lacks it
    let r = mergeApprovalModalPrefs({ modalEnabled: true }, { planAutoApproveSeconds: 5 });
    assert.equal(r.planAutoApproveSeconds, 5);
    // override an existing value (incl. the -1 "instant" sentinel)
    r = mergeApprovalModalPrefs({ planAutoApproveSeconds: 5 }, { planAutoApproveSeconds: -1 });
    assert.equal(r.planAutoApproveSeconds, -1);
    // a patch that omits planAutoApproveSeconds must preserve it
    r = mergeApprovalModalPrefs({ planAutoApproveSeconds: 3, modalEnabled: true }, { soundEnabled: true });
    assert.equal(r.planAutoApproveSeconds, 3);
    assert.equal(r.soundEnabled, true);
  });

  it('voicePack partial update preserves untouched voicePack fields', () => {
    const base = {
      modalEnabled: true,
      voicePack: { enabled: true, volume: 0.5, events: { askQuestion: 'default', planApproval: 'default' } },
    };
    const r = mergeApprovalModalPrefs(base, { voicePack: { events: { askQuestion: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' } } });
    assert.equal(r.voicePack.enabled, true);
    assert.equal(r.voicePack.volume, 0.5);
    assert.equal(r.voicePack.events.planApproval, 'default');
    assert.equal(r.voicePack.events.askQuestion, 'a1b2c3d4-e5f6-7890-abcd-ef0123456789');
  });

  it('voicePack.enabled flip does not blow away events map', () => {
    const base = { voicePack: { enabled: true, events: { askQuestion: 'default', turnEnd: 'default' } } };
    const r = mergeApprovalModalPrefs(base, { voicePack: { enabled: false } });
    assert.equal(r.voicePack.enabled, false);
    assert.equal(r.voicePack.events.askQuestion, 'default');
    assert.equal(r.voicePack.events.turnEnd, 'default');
  });

  it('top-level approvalModal patch does not touch voicePack', () => {
    const base = {
      modalEnabled: true,
      voicePack: { enabled: true, volume: 0.5, events: { askQuestion: 'default' } },
    };
    const r = mergeApprovalModalPrefs(base, { soundEnabled: true });
    assert.equal(r.soundEnabled, true);
    assert.deepEqual(r.voicePack, base.voicePack);
  });

  it('reconcile callback runs over the merged voicePack', () => {
    const reconcile = (vp) => ({ ...vp, events: { ...vp.events, askQuestion: 'reconciled' } });
    const base = { voicePack: { events: { askQuestion: 'default' } } };
    const r = mergeApprovalModalPrefs(base, { voicePack: { events: { planApproval: 'default' } } }, { reconcile });
    assert.equal(r.voicePack.events.askQuestion, 'reconciled', 'reconcile callback applied');
    assert.equal(r.voicePack.events.planApproval, 'default');
  });

  it("malicious __proto__ / constructor in events are dropped at the whitelist (defense-in-depth)", () => {
    const base = { voicePack: { events: {} } };
    const r = mergeApprovalModalPrefs(base, {
      voicePack: { events: { askQuestion: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789', constructor: 'evil', hasOwnProperty: 'x' } },
    });
    assert.equal(r.voicePack.events.askQuestion, 'a1b2c3d4-e5f6-7890-abcd-ef0123456789');
    // Use hasOwn (or hasOwnProperty.call) — the `in` operator walks the prototype
    // chain and would always find these on Object.prototype.
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    assert.equal(has(r.voicePack.events, 'constructor'), false);
    assert.equal(has(r.voicePack.events, 'hasOwnProperty'), false);
  });

  it('empty / null / undefined incoming returns base unchanged', () => {
    const base = { modalEnabled: true, voicePack: { enabled: false } };
    assert.equal(mergeApprovalModalPrefs(base, null), base);
    assert.equal(mergeApprovalModalPrefs(base, undefined), base);
    const r = mergeApprovalModalPrefs(base, {});
    assert.deepEqual(r, base);
  });

  it('null base treated as empty — incoming becomes the result', () => {
    const r = mergeApprovalModalPrefs(null, { modalEnabled: false, voicePack: { enabled: true } });
    assert.equal(r.modalEnabled, false);
    assert.equal(r.voicePack.enabled, true);
  });

  it('incoming voicePack with malformed events ignores non-object events field', () => {
    const base = { voicePack: { events: { askQuestion: 'default' } } };
    const r = mergeApprovalModalPrefs(base, { voicePack: { events: 'not-an-object' } });
    assert.equal(r.voicePack.events.askQuestion, 'default');
  });
});
