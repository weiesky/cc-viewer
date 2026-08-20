/**
 * Unit tests for src/utils/avatarAnimationPostPass.js — the buildAllItems
 * post-pass that clones stale teammate rows to animateAvatar:false. Follows
 * the refresh-cached-item-prop.test.js pattern: plain React.createElement
 * arrays, no DOM. The module transitively imports teammateAvatars.js
 * (?raw imports), so the _shims loader + dynamic import are required.
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';

let applyAvatarAnimationTargets, isTeammateAvatarItem;

before(async () => {
  const m = await import('../src/utils/avatarAnimationPostPass.js');
  applyAvatarAnimationTargets = m.applyAvatarAnimationTargets;
  isTeammateAvatarItem = m.isTeammateAvatarItem;
});

const T0 = Date.parse('2026-07-04T12:00:00.000Z');
const iso = (deltaMs) => new Date(T0 + deltaMs).toISOString();

const mkTeammate = (ts, role = 'sub-agent-chat') => React.createElement('ChatMessage', {
  role, isTeammate: true, label: 'researcher-1', timestamp: ts,
});
const mkTeammateMsg = (ts) => React.createElement('ChatMessage', {
  role: 'teammate-message', label: 'worker-1', timestamp: ts, text: 'report',
});
const mkAssistant = (ts) => React.createElement('ChatMessage', {
  role: 'assistant', content: [], timestamp: ts,
});
const mkDivider = () => React.createElement('div', { className: 'divider' });

describe('isTeammateAvatarItem', () => {
  it('matches all three ChatMessage teammate-avatar branches', () => {
    assert.equal(isTeammateAvatarItem({ role: 'sub-agent-chat', isTeammate: true }), true);
    assert.equal(isTeammateAvatarItem({ role: 'sub-agent', isTeammate: true }), true);
    assert.equal(isTeammateAvatarItem({ role: 'teammate-message' }), true);
  });

  it('rejects non-teammate rows', () => {
    assert.equal(isTeammateAvatarItem({ role: 'sub-agent-chat', isTeammate: false }), false);
    assert.equal(isTeammateAvatarItem({ role: 'sub-agent' }), false);
    assert.equal(isTeammateAvatarItem({ role: 'assistant' }), false);
    assert.equal(isTeammateAvatarItem(undefined), false);
  });
});

describe('applyAvatarAnimationTargets', () => {
  it('clones only stale teammate rows; recent and newest keep their references', () => {
    const stale = mkTeammate(iso(-300_000));
    const recent = mkTeammate(iso(-30_000));
    const newest = mkTeammateMsg(iso(0));
    const asst = mkAssistant(iso(-10_000));
    const items = [stale, asst, recent, newest];
    const out = applyAvatarAnimationTargets(items);
    assert.equal(out, items);
    assert.notEqual(out[0], stale);
    assert.equal(out[0].props.animateAvatar, false);
    assert.equal(out[1], asst);
    assert.equal(out[2], recent);
    assert.equal(out[2].props.animateAvatar, undefined);
    assert.equal(out[3], newest);
  });

  it('the newest teammate row always animates, even far outside the window', () => {
    const old1 = mkTeammate(iso(-7_200_000));
    const old2 = mkTeammateMsg(iso(-3_600_000));
    const asstNewest = mkAssistant(iso(0));
    const out = applyAvatarAnimationTargets([old1, old2, asstNewest]);
    assert.equal(out[0].props.animateAvatar, false);
    assert.equal(out[1], old2, 'newest teammate row must keep its original reference');
  });

  it('folds lastResponseTs into the latest-timestamp computation', () => {
    const tm = mkTeammate(iso(-90_000));
    // Without LR the teammate is both newest overall and newest teammate -> animates.
    assert.equal(applyAvatarAnimationTargets([mkTeammate(iso(-90_000))])[0].props.animateAvatar, undefined);
    // With an LR at T0 the same row is 90s stale... but it is still the newest
    // TEAMMATE row, so the flourish keeps it animated.
    assert.equal(applyAvatarAnimationTargets([tm], iso(0))[0], tm);
    // Two teammates + LR: the older one is now judged against the LR timestamp.
    const older = mkTeammate(iso(-90_000));
    const newer = mkTeammateMsg(iso(-70_000));
    const out = applyAvatarAnimationTargets([older, newer], iso(0));
    assert.equal(out[0].props.animateAvatar, false, 'older row is stale vs the LR timestamp');
    assert.equal(out[1], newer, 'newest teammate still animates');
  });

  it('covers the dormant sub-agent branch defensively', () => {
    const subAgent = mkTeammate(iso(-300_000), 'sub-agent');
    const newest = mkTeammateMsg(iso(0));
    const out = applyAvatarAnimationTargets([subAgent, newest]);
    assert.equal(out[0].props.animateAvatar, false);
  });

  it('is a no-op for lists without teammate rows, non-element items, or empty lists', () => {
    const asst = mkAssistant(iso(0));
    const div = mkDivider();
    const items = [asst, div];
    assert.equal(applyAvatarAnimationTargets(items), items);
    assert.equal(items[0], asst);
    assert.equal(items[1], div);
    assert.deepEqual(applyAvatarAnimationTargets([]), []);
  });

  it('defaults to animate when timestamps are missing or unparseable', () => {
    const noTs = mkTeammate(undefined);
    const junk = mkTeammate('not-a-date');
    const out = applyAvatarAnimationTargets([noTs, junk]);
    assert.equal(out[0], noTs);
    assert.equal(out[1], junk);
  });
});
