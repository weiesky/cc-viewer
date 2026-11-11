/**
 * ask-auto-answer.test.js — server-side AskUserQuestion auto-answer (hosting) pure logic.
 *
 * node:test + assert/strict; private mkdtemp as CCV_LOG_DIR (set before the target
 * module is imported); dynamic import of the target; mock.timers scoped per test
 * and restored in finally.
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let hosting;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ask-auto-answer-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  hosting = await import('../server/lib/ask-auto-answer.js');
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe('effectiveAskAutoAnswerMinutes', () => {
  it('reads approvalModal.askAutoAnswerMinutes; absent = off', () => {
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({}), null);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: {} }), null);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: 10 } }), 10);
  });

  it('0 = instant (NOT off); null = off', () => {
    // The Number(null) === 0 trap: a literal copy of auto-approve.js's Number()
    // coercion would turn the persisted "off" into instant answering.
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: 0 } }), 0);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: null } }), null);
  });

  it('strict typing: strings / NaN / negative are off', () => {
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: '10' } }), null);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: '' } }), null);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: NaN } }), null);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: -1 } }), null);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: true } }), null);
  });

  it('values above MAX_ASK_AUTO_ANSWER_MINUTES(1439) are off (setTimeout clamp guard)', () => {
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: 1439 } }), 1439);
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: 1440 } }), null, 'cap sits below the 24h ask timeout so the deadline stays reachable');
    assert.equal(hosting.effectiveAskAutoAnswerMinutes({ approvalModal: { askAutoAnswerMinutes: 1e9 } }), null);
  });
});

describe('computeAskAutoAnswer', () => {
  const readPrefs = (prefs) => () => prefs;

  it('off → {enabled:false}', () => {
    const r = hosting.computeAskAutoAnswer('/p', { now: 1000, readPrefs: readPrefs({}) });
    assert.deepEqual(r, { enabled: false });
  });

  it('N minutes tier: seconds = N*60, autoAnswerAt = now + N*60000', () => {
    const r = hosting.computeAskAutoAnswer('/p', {
      now: 1000,
      readPrefs: readPrefs({ approvalModal: { askAutoAnswerMinutes: 10 } }),
    });
    assert.deepEqual(r, { enabled: true, instant: false, minutes: 10, seconds: 600, autoAnswerAt: 601000 });
  });

  it('0 minutes tier: instant, autoAnswerAt = now, seconds = 0', () => {
    const r = hosting.computeAskAutoAnswer('/p', {
      now: 1000,
      readPrefs: readPrefs({ approvalModal: { askAutoAnswerMinutes: 0 } }),
    });
    assert.deepEqual(r, { enabled: true, instant: true, minutes: 0, seconds: 0, autoAnswerAt: 1000 });
  });

  it('project fork overrides global; project without fork reads global', () => {
    const prefs = {
      approvalModal: { askAutoAnswerMinutes: null },
      prefsByProject: { '/p': { approvalModal: { askAutoAnswerMinutes: 20 } } },
    };
    const r = hosting.computeAskAutoAnswer('/p', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r.enabled, true);
    assert.equal(r.minutes, 20);
    const r2 = hosting.computeAskAutoAnswer('/other', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r2.enabled, false);
  });

  it('fork missing the key falls back to the global value', () => {
    const prefs = {
      approvalModal: { askAutoAnswerMinutes: 30 },
      prefsByProject: { '/p': { someOther: true } },
    };
    const r = hosting.computeAskAutoAnswer('/p', { now: 0, readPrefs: readPrefs(prefs) });
    assert.equal(r.minutes, 30);
  });

  it('readPrefs throwing → enabled:false without raising', () => {
    const r = hosting.computeAskAutoAnswer('/p', {
      now: 0,
      readPrefs: () => { throw new Error('boom'); },
    });
    assert.deepEqual(r, { enabled: false });
  });
});

describe('askAutoAnswerFireDelayMs', () => {
  it('N minutes tier = remaining + 1000ms buffer', () => {
    const c = { enabled: true, instant: false, minutes: 10, seconds: 600, autoAnswerAt: 601000 };
    assert.equal(hosting.askAutoAnswerFireDelayMs(c, 1000), 601000);
  });

  it('past deadline never goes negative', () => {
    const c = { enabled: true, instant: false, minutes: 10, seconds: 600, autoAnswerAt: 500 };
    assert.equal(hosting.askAutoAnswerFireDelayMs(c, 1000), 1000);
  });

  it('instant = 0; disabled = null', () => {
    assert.equal(hosting.askAutoAnswerFireDelayMs({ enabled: true, instant: true, autoAnswerAt: 1 }, 1000), 0);
    assert.equal(hosting.askAutoAnswerFireDelayMs({ enabled: false }, 1000), null);
  });
});

describe('createAskAutoAnswerState / cancelAskAutoAnswerState', () => {
  it('timer fires at deadline; cancelled never fires; second cancel is a no-op', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = 0;
      const state = hosting.createAskAutoAnswerState(
        { enabled: true, instant: false, minutes: 10, seconds: 600, autoAnswerAt: 600000 },
        () => { fired += 1; },
      );
      assert.equal(state.autoAnswerAt, 600000);
      assert.equal(state.seconds, 600);
      assert.equal(state.minutes, 10);
      assert.ok(state.timer);
      mock.timers.tick(601000);
      assert.equal(fired, 1);

      let fired2 = 0;
      const state2 = hosting.createAskAutoAnswerState(
        { enabled: true, instant: false, minutes: 10, seconds: 600, autoAnswerAt: 600000 },
        () => { fired2 += 1; },
      );
      assert.equal(hosting.cancelAskAutoAnswerState(state2), true);
      assert.equal(hosting.cancelAskAutoAnswerState(state2), false); // idempotent
      mock.timers.tick(601000);
      assert.equal(fired2, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('instant fires synchronously without a timer', () => {
    let fired = 0;
    const state = hosting.createAskAutoAnswerState(
      { enabled: true, instant: true, minutes: 0, seconds: 0, autoAnswerAt: 0 },
      () => { fired += 1; },
    );
    assert.equal(fired, 1);
    assert.equal(state.timer, null);
  });

  it('disabled input → returns null (never armed)', () => {
    let fired = 0;
    const state = hosting.createAskAutoAnswerState({ enabled: false }, () => { fired += 1; });
    assert.equal(state, null);
    assert.equal(fired, 0);
  });
});

describe('cancelAskAutoAnswerState (entry form)', () => {
  it('stamps entry.autoCancelled + auto.cancelled, clears the timer, idempotent', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let fired = 0;
      const autoState = hosting.createAskAutoAnswerState(
        { enabled: true, instant: false, minutes: 10, seconds: 600, autoAnswerAt: 600000 },
        () => { fired += 1; },
      );
      const entry = { auto: autoState, autoCancelled: false };
      assert.equal(hosting.cancelAskAutoAnswerState(entry), true);
      assert.equal(entry.autoCancelled, true);
      assert.equal(entry.auto.cancelled, true);
      assert.equal(entry.auto.timer, null);
      assert.equal(hosting.cancelAskAutoAnswerState(entry), false); // idempotent
      mock.timers.tick(601000);
      assert.equal(fired, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('entry form without an armed auto still stamps the durable flag', () => {
    const entry = { auto: null, autoCancelled: false };
    assert.equal(hosting.cancelAskAutoAnswerState(entry), true);
    assert.equal(entry.autoCancelled, true);
  });
});

describe('replayAskAutoAnswerFields', () => {
  it('cancelled → autoAnswerAt null and autoCancelled=true', () => {
    const f = hosting.replayAskAutoAnswerFields({ autoAnswerAt: 123, seconds: 600 }, true);
    assert.deepEqual(f, { autoAnswerAt: null, autoAnswerSeconds: 600, autoCancelled: true });
  });

  it('not cancelled: passes the deadline through; no auto state → nulls', () => {
    assert.deepEqual(
      hosting.replayAskAutoAnswerFields({ autoAnswerAt: 123, seconds: 600 }, false),
      { autoAnswerAt: 123, autoAnswerSeconds: 600, autoCancelled: false },
    );
    assert.deepEqual(
      hosting.replayAskAutoAnswerFields(null, false),
      { autoAnswerAt: null, autoAnswerSeconds: null, autoCancelled: false },
    );
  });
});

describe('pickAutoAnswers re-export', () => {
  it('re-exports the core picker', () => {
    assert.equal(typeof hosting.pickAutoAnswers, 'function');
    const answers = hosting.pickAutoAnswers([
      { question: 'Q?', options: [{ label: 'A (Recommended)' }, { label: 'B' }] },
    ]);
    assert.deepEqual(answers, { 'Q?': 'A (Recommended)' });
  });
});
