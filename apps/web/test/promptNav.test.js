// Unit tests for src/utils/promptNav.js — the pure data-building behind the User Prompt Nav
// (extracted from ChatView so the bug-prone session-boundary / dedup / no-ts logic is testable).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptNavItems } from '../src/utils/promptNav.js';

// Mimic a rendered item's shape (React element → { props }) and an authoritative session.
const item = (role, text, timestamp) => ({ props: { role, text, timestamp } });
const session = (...tsList) => ({ messages: tsList.map((ts) => ({ _timestamp: ts })) });

describe('buildPromptNavItems', () => {
  it('returns [] for no visible items or when there are no user prompts', () => {
    assert.deepEqual(buildPromptNavItems([], []), []);
    assert.deepEqual(buildPromptNavItems(undefined, []), []);
    assert.deepEqual(buildPromptNavItems([item('assistant', 'hi', 't1')], [session('t1')]), []);
  });

  it('collects user prompts with display/visibleIdx/timestamp/sessionIdx (single session → no separators)', () => {
    const visible = [
      item('assistant', 'a', 't0'),
      item('user', 'first', 't1'),
      item('user', 'second', 't2'),
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2')]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { display: 'first', visibleIdx: 1, timestamp: 't1', sessionIdx: 0 });
    assert.deepEqual(out[1], { display: 'second', visibleIdx: 2, timestamp: 't2', sessionIdx: 0 });
    assert.ok(!out[0].newSession && !out[1].newSession);
  });

  it('marks newSession on the first prompt of a later session (never on the first overall)', () => {
    const visible = [item('user', 'p0', 't1'), item('user', 'p1', 't2'), item('user', 'p2', 't3')];
    const out = buildPromptNavItems(visible, [session('t1'), session('t2', 't3')]);
    assert.equal(out[0].sessionIdx, 0);
    assert.ok(!out[0].newSession);
    assert.equal(out[1].sessionIdx, 1);
    assert.equal(out[1].newSession, true);
    assert.ok(!out[2].newSession); // same session as p1
  });

  it('does not let an unknown-session (no matching ts) prompt break the boundary chain', () => {
    const visible = [item('user', 'p0', 't1'), item('user', 'pmid', 'tX'), item('user', 'p1', 't2')];
    const out = buildPromptNavItems(visible, [session('t1'), session('t2')]);
    assert.equal(out[0].sessionIdx, 0);
    assert.equal(out[1].sessionIdx, null);
    assert.ok(!out[1].newSession);          // null-session prompt is never marked
    assert.equal(out[2].sessionIdx, 1);
    assert.equal(out[2].newSession, true);  // boundary still detected across the null-session prompt
  });

  it('dedups by leading text and skips empty / image-only / whitespace prompts', () => {
    const visible = [
      item('user', 'dup', 't1'),
      item('user', 'dup', 't2'),                         // duplicate text → skipped
      item('user', '[Image #1: source: /tmp/x.png]', 't3'), // image-only → cleaned to '' → skipped
      item('user', '   ', 't4'),                          // whitespace → skipped
      item('user', '', 't5'),                             // empty → skipped
      item('user', 'kept', 't6'),
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2', 't3', 't4', 't5', 't6')]);
    assert.deepEqual(out.map((p) => p.display), ['dup', 'kept']);
  });

  it('truncates long display text to 80 chars + ellipsis', () => {
    const out = buildPromptNavItems([item('user', 'x'.repeat(100), 't1')], [session('t1')]);
    assert.equal(out[0].display, 'x'.repeat(80) + '...');
  });

  it('keeps a prompt but with null timestamp/sessionIdx when the message has no ts', () => {
    const out = buildPromptNavItems([item('user', 'p', null)], [session('t1')]);
    assert.equal(out.length, 1);
    assert.equal(out[0].timestamp, null);
    assert.equal(out[0].sessionIdx, null);
  });

  it('tolerates sessions with missing/!array messages', () => {
    const out = buildPromptNavItems([item('user', 'p', 't1')], [{}, { messages: null }, session('t1')]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sessionIdx, 2); // t1 lives in the 3rd session
  });
});
