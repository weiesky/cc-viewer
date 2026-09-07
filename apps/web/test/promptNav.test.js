// Unit tests for src/utils/promptNav.js — the pure data-building behind the User Prompt Nav
// (extracted from ChatView so the bug-prone session-boundary / dedup / no-ts logic is testable).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPromptNavItems } from '../src/utils/promptNav.js';

// Mimic a rendered item's shape (React element → { props }) and an authoritative session.
const item = (role, text, timestamp) => ({ props: { role, text, timestamp } });
// assistant item carries a content block array (tool_use cards live inside the bubble).
// displayTs = producer request ts (_generatedTs); timestamp = carrier (next request's ts).
const asstItem = (blocks, timestamp, displayTs) => ({ props: { role: 'assistant', content: blocks, timestamp, displayTs } });
const tu = (name, input, id) => ({ type: 'tool_use', name, input, id: id || 'tu-' + name });
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
    assert.deepEqual(out[0], { display: 'first', visibleIdx: 1, timestamp: 't1', sessionIdx: 0, kind: 'prompt' });
    assert.deepEqual(out[1], { display: 'second', visibleIdx: 2, timestamp: 't2', sessionIdx: 0, kind: 'prompt' });
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

  it('surfaces an ExitPlanMode tool_use inside an assistant bubble as a plan entry', () => {
    const visible = [
      item('user', 'do the thing', 't1'),
      asstItem([tu('ExitPlanMode', { plan: '# My Plan Title\n\nbody' })], 't2'),
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2')]);
    assert.equal(out.length, 2);
    assert.equal(out[0].kind, 'prompt');
    assert.deepEqual(out[1], { display: 'My Plan Title', visibleIdx: 1, timestamp: 't2', sessionIdx: 0, kind: 'plan' });
  });

  it('surfaces an AskUserQuestion tool_use as an ask entry with the question text', () => {
    const visible = [
      asstItem([tu('AskUserQuestion', { questions: [{ question: 'Which approach?', options: [] }] })], 't1'),
    ];
    const out = buildPromptNavItems(visible, [session('t1')]);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { display: 'Which approach?', visibleIdx: 0, timestamp: 't1', sessionIdx: 0, kind: 'ask' });
  });

  it('interleaves plan/ask entries with user prompts in document (chronological) order', () => {
    const visible = [
      item('user', 'first', 't1'),
      asstItem([tu('ExitPlanMode', { plan: '# Plan A' })], 't2'),
      item('user', 'second', 't3'),
      asstItem([tu('AskUserQuestion', { questions: [{ question: 'Q?' }] })], 't4'),
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2', 't3', 't4')]);
    assert.deepEqual(out.map((p) => p.kind), ['prompt', 'plan', 'prompt', 'ask']);
    assert.deepEqual(out.map((p) => p.visibleIdx), [0, 1, 2, 3]);
  });

  it('maps plan/ask entries to their session and marks newSession across boundaries', () => {
    const visible = [
      item('user', 'p0', 't1'),
      asstItem([tu('ExitPlanMode', { plan: '# Plan' })], 't2'),   // session 1
      asstItem([tu('AskUserQuestion', { questions: [{ question: 'Q' }] })], 't3'), // session 1
    ];
    const out = buildPromptNavItems(visible, [session('t1'), session('t2', 't3')]);
    assert.equal(out[0].sessionIdx, 0);
    assert.equal(out[1].sessionIdx, 1);
    assert.equal(out[1].newSession, true);   // first entry of session 1
    assert.equal(out[2].sessionIdx, 1);
    assert.ok(!out[2].newSession);           // same session as the plan entry
  });

  it('emits one entry per ask/plan block when a bubble holds several', () => {
    const visible = [
      asstItem([
        tu('AskUserQuestion', { questions: [{ question: 'Q1' }] }, 'a'),
        { type: 'text', text: 'some text' },
        tu('AskUserQuestion', { questions: [{ question: 'Q2' }] }, 'b'),
        tu('ExitPlanMode', { plan: '# P' }, 'c'),
      ], 't1'),
    ];
    const out = buildPromptNavItems(visible, [session('t1')]);
    assert.deepEqual(out.map((p) => p.kind), ['ask', 'ask', 'plan']);
    assert.deepEqual(out.map((p) => p.display), ['Q1', 'Q2', 'P']);
    assert.ok(out.every((p) => p.visibleIdx === 0));
  });

  it('ignores assistant items without ask/plan blocks and non-tool_use blocks', () => {
    const visible = [
      asstItem([{ type: 'text', text: 'just text' }], 't1'),
      asstItem([tu('Read', { file_path: '/x' })], 't2'),         // non-full-display tool
      asstItem([tu('EnterPlanMode', {})], 't3'),                 // enter-marker not collected
      asstItem(null, 't4'),                                      // no content array
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2', 't3', 't4')]);
    assert.equal(out.length, 0);
  });

  it('falls back to empty display when plan text / ask questions are absent (streaming hollow)', () => {
    const visible = [
      asstItem([tu('ExitPlanMode', {})], 't1'),
      asstItem([tu('AskUserQuestion', { questions: [] })], 't2'),
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2')]);
    assert.equal(out.length, 2);
    assert.equal(out[0].display, '');
    assert.equal(out[1].display, '');
  });

  // UltraPlan prompts: ChatView has already stripped the system-reminder template from the
  // visible element's text and set props.isUltraplan=true, so the nav reads the prop (text-based
  // isUltraplanText would not match the stripped text) and shows the clean blurb as the title.
  const ultraItem = (blurb, timestamp) => ({ props: { role: 'user', text: blurb, timestamp, isUltraplan: true } });

  it('tags a user prompt with isUltraplan=true as kind:ultraplan, showing the blurb', () => {
    const visible = [ultraItem('Refactor the login flow to OAuth', 't1')];
    const out = buildPromptNavItems(visible, [session('t1')]);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'ultraplan');
    assert.equal(out[0].display, 'Refactor the login flow to OAuth');
  });

  it('truncates a long UltraPlan blurb like any other prompt', () => {
    const out = buildPromptNavItems([ultraItem('x'.repeat(100), 't1')], [session('t1')]);
    assert.equal(out[0].kind, 'ultraplan');
    assert.equal(out[0].display, 'x'.repeat(80) + '...');
  });

  it('interleaves an ultraplan prompt chronologically with prompt/plan/ask entries', () => {
    const visible = [
      item('user', 'plain', 't1'),
      ultraItem('Ultra task', 't2'),
      asstItem([tu('ExitPlanMode', { plan: '# P' })], 't3'),
    ];
    const out = buildPromptNavItems(visible, [session('t1', 't2', 't3')]);
    assert.deepEqual(out.map((p) => p.kind), ['prompt', 'ultraplan', 'plan']);
  });

  it('does not tag a plain prompt whose text merely mentions the marker but isUltraplan is unset', () => {
    // ChatView only sets isUltraplan via its own detection; a hand-typed prompt containing the
    // marker text but no prop stays a normal prompt (nav trusts the prop, not the text).
    const raw = '<system-reminder>\n[SCOPED INSTRUCTION] …\n</system-reminder>\nhello';
    const out = buildPromptNavItems([item('user', raw, 't1')], [session('t1')]);
    assert.equal(out[0].kind, 'prompt');
  });

  // Issue #142: an assistant card at the END of session A has a carrier timestamp that is already
  // session B's first entry ts. Session attribution must use displayTs (producer request ts), not
  // the carrier, so the trailing Plan/Ask stays in session A instead of tipping the divider.
  it('attributes an assistant card to its producer session via displayTs, not the carrier ts', () => {
    const visible = [
      item('user', 'session A prompt', 'a1'),                 // session 0 request a1
      asstItem([tu('ExitPlanMode', { plan: '# P' })], 'b1', 'a1'), // produced by a1, carried by b1 (next session's first entry)
      item('user', 'session B prompt', 'b1'),                 // session 1 request b1
    ];
    const out = buildPromptNavItems(visible, [session('a1'), session('b1')]);
    assert.equal(out.length, 3);
    // The plan card must land in session 0 (with its producer a1), NOT session 1 (carrier b1).
    assert.equal(out[1].kind, 'plan');
    assert.equal(out[1].sessionIdx, 0);
    assert.ok(!out[1].newSession);            // no divider between A's prompt and its own answer
    assert.equal(out[2].sessionIdx, 1);
    assert.equal(out[2].newSession, true);    // divider correctly before session B's prompt
    // Time label uses the producer ts (a1), not the late carrier ts (b1).
    assert.equal(out[1].timestamp, 'a1');
  });

  it('falls back to carrier timestamp when assistant displayTs is absent', () => {
    const visible = [asstItem([tu('AskUserQuestion', { questions: [{ question: 'Q' }] })], 't2')];
    const out = buildPromptNavItems(visible, [session('t1'), session('t2')]);
    assert.equal(out[0].sessionIdx, 1);       // carrier t2 → session 1
    assert.equal(out[0].timestamp, 't2');
  });

  it('guards NAV_TOOL_KIND against prototype member names', () => {
    const visible = [
      asstItem([
        { type: 'tool_use', name: 'constructor', input: {} },
        { type: 'tool_use', name: 'toString', input: {} },
        { type: 'tool_use', name: 'hasOwnProperty', input: {} },
        tu('ExitPlanMode', { plan: '# Real' }),
      ], 't1'),
    ];
    const out = buildPromptNavItems(visible, [session('t1')]);
    assert.deepEqual(out.map((p) => p.kind), ['plan']);   // only the real card, no phantom entries
    assert.equal(out[0].display, 'Real');
  });
});
