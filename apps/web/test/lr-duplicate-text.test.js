/**
 * Unit tests for the LR-vs-last-assistant duplicate hide (lrDuplicatesLastAssistant).
 *
 * The final turn of a session can be echoed into BOTH session.messages (the last
 * assistant bubble) and session.response.body.content (the Last-Response block),
 * rendering one reply twice. When the two are provably the SAME turn, ChatView
 * hides the whole LR block.
 *
 * Safety boundaries pinned here:
 *  - text is compared as trimmed, `\n\n`-joined visible text (thinking / cards
 *    ignored), AND the ordered tool_use id sequence must match — this is the
 *    same-turn anchor. A DIFFERENT turn whose text merely repeats (a retry, a
 *    short "Done.") carries fresh tool ids and is NOT hidden, because then the
 *    LR is the only rendering of the newest reply.
 *  - an LR with no visible text (pure interaction/tool cards) is never hidden
 *    by this predicate (interaction ownership rules apply instead);
 *  - when no assistant message with visible text exists in messages (the reply
 *    has not been echoed yet) the predicate is false — the LR stays.
 *
 * The separate interaction-ownership gate (lrWillOwnAsk/Plan, hasInteractiveBlock)
 * lives at the ChatView call site, not in this pure function.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastAssistantOf,
  lastAssistantTextOf,
  lrTextOf,
  lrDuplicatesLastAssistant,
} from '../src/components/chat/interactionOwnership.js';

const T = (text) => ({ type: 'text', text });
const THINK = (t) => ({ type: 'thinking', thinking: t });
const TOOL = (id, name = 'Read') => ({ type: 'tool_use', id, name, input: {} });
const ASK = (id) => ({ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [] } });

describe('lrTextOf', () => {
  it('concatenates visible text blocks with a blank line, ignoring thinking/tool_use', () => {
    const resp = [THINK('t'), T('第一段'), TOOL('x'), T('第二段')];
    assert.equal(lrTextOf(resp), '第一段\n\n第二段');
  });

  it('trims surrounding whitespace and drops blank text blocks', () => {
    assert.equal(lrTextOf([T(''), T('   '), T('  body  ')]), 'body');
  });

  it('returns null when the LR carries no visible text (pure interaction/tool cards)', () => {
    assert.equal(lrTextOf([ASK('a1')]), null);
    assert.equal(lrTextOf([TOOL('t1')]), null);
    assert.equal(lrTextOf([THINK('only thinking')]), null);
  });

  it('returns null for non-array content', () => {
    assert.equal(lrTextOf(undefined), null);
    assert.equal(lrTextOf(null), null);
    assert.equal(lrTextOf('a string'), null);
  });

  it('does NOT apply the system-text filter (matches the LR render path)', () => {
    assert.equal(lrTextOf([T('<system-reminder>x</system-reminder>')]), '<system-reminder>x</system-reminder>');
  });
});

describe('lastAssistantOf / lastAssistantTextOf', () => {
  it('reads the LAST assistant message with visible text, skipping trailing user/tool_result', () => {
    const msgs = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [T('answer')] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
    ];
    assert.equal(lastAssistantTextOf(msgs), 'answer');
  });

  it('keeps scanning upward past assistant bubbles with no visible text (pure tool_use turns)', () => {
    const msgs = [
      { role: 'assistant', content: [T('real text')] },
      { role: 'assistant', content: [TOOL('t1')] }, // no visible text → skipped
    ];
    assert.equal(lastAssistantTextOf(msgs), 'real text');
  });

  it('exposes the ordered tool_use id anchors of the matched bubble', () => {
    const msgs = [
      { role: 'assistant', content: [T('txt'), TOOL('toolu_1'), TOOL('toolu_2')] },
    ];
    assert.deepEqual(lastAssistantOf(msgs), { text: 'txt', toolIds: ['toolu_1', 'toolu_2'] });
  });

  it('filters system-text blocks out of array content (matches the message render side)', () => {
    const msgs = [
      { role: 'assistant', content: [T('<system-reminder>hidden</system-reminder>'), T('shown')] },
    ];
    assert.equal(lastAssistantTextOf(msgs), 'shown');
  });

  it('reads string content via extractDisplayText', () => {
    const msgs = [{ role: 'assistant', content: 'plain text reply' }];
    assert.equal(lastAssistantTextOf(msgs), 'plain text reply');
  });

  it('returns null when no assistant message has visible text', () => {
    assert.equal(lastAssistantTextOf([{ role: 'user', content: 'q' }]), null);
    assert.equal(lastAssistantTextOf([]), null);
    assert.equal(lastAssistantTextOf(undefined), null);
  });
});

describe('lrDuplicatesLastAssistant', () => {
  it('is true for a genuine same-turn echo (equal text AND equal tool_use ids)', () => {
    const msgs = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [T('integration-reviewer 独立佐证了 F1/F2'), TOOL('toolu_read_1')] },
    ];
    const resp = [T('integration-reviewer 独立佐证了 F1/F2'), TOOL('toolu_read_1')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), true);
  });

  it('ignores thinking when comparing (text + tool ids still decide)', () => {
    const msgs = [{ role: 'assistant', content: [T('same'), TOOL('t1')] }];
    const resp = [THINK('different thinking'), T('same'), TOOL('t1')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), true);
  });

  it('is FALSE when the same text belongs to a DIFFERENT turn (different tool_use id) — the LR is the only rendering of the newest reply', () => {
    // The P1 regression: a steady-state turn whose text repeats the previous one.
    const msgs = [
      { role: 'assistant', content: [T('All 42 tests pass.'), TOOL('toolu_old')] },
      { role: 'user', content: 'run them again' },
    ];
    const resp = [T('All 42 tests pass.'), TOOL('toolu_new')]; // fresh id → different turn
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), false);
  });

  it('is FALSE when the history bubble has a tool_use the LR does not (id sequence mismatch)', () => {
    const msgs = [{ role: 'assistant', content: [T('X'), TOOL('t1')] }];
    const resp = [T('X')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), false);
  });

  it('falls back to text equality for pure-text turns (empty ids on both sides) — accepted residue', () => {
    const msgs = [{ role: 'assistant', content: [T('Done.')] }];
    const resp = [T('Done.')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), true);
  });

  it('pins block-join order sensitivity: same blocks in a different order differ', () => {
    const msgs = [{ role: 'assistant', content: [T('a'), T('b')] }];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: [T('a'), T('b')] }), true);
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: [T('b'), T('a')] }), false);
  });

  it('returns false when the text bodies differ', () => {
    const msgs = [{ role: 'assistant', content: [T('old reply')] }];
    const resp = [T('new reply')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), false);
  });

  it('returns false when the LR has no visible text (pure interaction card stays visible)', () => {
    const msgs = [{ role: 'assistant', content: [T('something')] }];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: [ASK('a1')] }), false);
  });

  it('returns false when the reply has NOT been echoed into messages yet (protects the only rendering)', () => {
    const msgs = [
      { role: 'user', content: 'q' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
    ];
    const resp = [T('fresh reply not yet in messages')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), false);
  });

  it('matches even when the messages-side bubble has a system-text block stripped', () => {
    const msgs = [
      { role: 'assistant', content: [T('<system-reminder>meta</system-reminder>'), T('body')] },
    ];
    const resp = [T('body')];
    assert.equal(lrDuplicatesLastAssistant({ messages: msgs, respContent: resp }), true);
  });
});
