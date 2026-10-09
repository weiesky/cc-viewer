/**
 * reboundAffectsView — view-domain gate for the bound-project rebind broadcast.
 *
 * The server fans `workspace_started(rebound:true, reboundFrom)` out to EVERY
 * SSE client, so each client must decide locally whether the rebind touches its
 * own view. Getting this wrong in either direction is user-visible:
 *  - too narrow → the affected tab keeps a stale scope stamp: blank pane and no
 *    live feed (the bug the reconnect was added for);
 *  - too wide → an unrelated tab is force-detached, its transcript cleared and
 *    its in-flight stream reset.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reboundAffectsView } from '../src/utils/reboundScope.js';

describe('reboundAffectsView', () => {
  it('matches a bound tab whose scope name is the closed project', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: 'projA', projectName: 'projA', viewedProject: null,
    }), true);
  });

  it('matches a parallel tab viewing the closed project', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: 'projA', projectName: 'projB', viewedProject: 'projA',
    }), true);
  });

  it('matches an attach to the closed project (viewedProject carries the scope)', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: 'projA', projectName: 'projA', viewedProject: 'projA',
    }), true);
  });

  it('spares a bound tab of an unrelated project', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: 'projA', projectName: 'projB', viewedProject: null,
    }), false);
  });

  it('spares a tab viewing a third project (its scope is untouched server-side)', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: 'projA', projectName: 'projB', viewedProject: 'projC',
    }), false);
  });

  it('ignores non-rebound broadcasts (normal launch/switch resets every client)', () => {
    assert.equal(reboundAffectsView({
      rebound: undefined, reboundFrom: 'projA', projectName: 'projA', viewedProject: null,
    }), false);
    assert.equal(reboundAffectsView({
      rebound: false, reboundFrom: 'projA', projectName: 'projA', viewedProject: null,
    }), false);
  });

  it('treats a missing reboundFrom as affecting everyone (older server, pre-gate behavior)', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: undefined, projectName: 'projB', viewedProject: 'projC',
    }), true);
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: '', projectName: 'projB', viewedProject: 'projC',
    }), true);
  });

  it('never matches an empty scope against an empty reboundFrom-less payload', () => {
    assert.equal(reboundAffectsView({
      rebound: true, reboundFrom: null, projectName: '', viewedProject: null,
    }), true, 'absent reboundFrom still resets (older server)');
  });
});
