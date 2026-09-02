/**
 * Unit tests for apps/web/src/utils/toolRunMerge.js — the minimal-chat
 * buildAllItems post-pass that merges consecutive tool-only turns of the same
 * agent into one bubble. Same style as avatar-animation-post-pass.test.js:
 * plain React.createElement arrays, no DOM. The module imports only `react`
 * and toolDisplayPolicy.js, so no loader shims are needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {
  mergeToolRuns, isToolOnlyAssistantContent, runIdentityOf, hasThinkingBlock,
} from '../src/utils/toolRunMerge.js';

let seq = 0;
const tu = (name = 'Bash') => ({ type: 'tool_use', id: `tu-${++seq}`, name, input: {} });
const think = (text = 'hmm') => ({ type: 'thinking', thinking: text });
const text = (t) => ({ type: 'text', text: t });

const el = (key, props) => React.createElement('ChatMessage', { key, ...props });
const asst = (key, content, extra = {}) => el(key, { role: 'assistant', content, timestamp: `T${key}`, displayTs: `G${key}`, ...extra });
const sub = (key, content, label = 'SubAgent:Explore', extra = {}) => el(key, { role: 'sub-agent-chat', content, label, timestamp: `T${key}`, ...extra });
const sys = (key) => el(key, { role: 'system', text: 'reminder', timestamp: `T${key}` });
const user = (key, role = 'user') => el(key, { role, text: 'hi', timestamp: `T${key}` });
const divider = (key) => React.createElement('div', { key });

const roles = (items) => items.map((i) => (i.props.runMembers ? `RUN(${i.props.runMembers.length})` : (i.props.role || 'div')));

describe('isToolOnlyAssistantContent', () => {
  it('accepts tool_use / thinking / blank text', () => {
    assert.equal(isToolOnlyAssistantContent([tu()]), true);
    assert.equal(isToolOnlyAssistantContent([think(), tu('Read')]), true);
    assert.equal(isToolOnlyAssistantContent([text('  \n'), tu()]), true);
    assert.equal(isToolOnlyAssistantContent([think()]), true);
  });
  it('rejects real text, full-display tools, unknown blocks, empty', () => {
    assert.equal(isToolOnlyAssistantContent([text('done'), tu()]), false);
    assert.equal(isToolOnlyAssistantContent([tu('Edit')]), false);
    assert.equal(isToolOnlyAssistantContent([tu('AskUserQuestion')]), false);
    assert.equal(isToolOnlyAssistantContent([{ type: 'server_tool_use', id: 'x', name: 'web_search' }]), false);
    assert.equal(isToolOnlyAssistantContent([text('   ')]), false);
    assert.equal(isToolOnlyAssistantContent([]), false);
    assert.equal(isToolOnlyAssistantContent('string'), false);
  });
});

describe('runIdentityOf / hasThinkingBlock', () => {
  it('maps roles to stream identities', () => {
    assert.equal(runIdentityOf({ role: 'assistant' }), 'assistant');
    assert.equal(runIdentityOf({ role: 'assistant', label: 'worker' }), 'tm:worker');
    assert.equal(runIdentityOf({ role: 'sub-agent-chat', label: 'SubAgent:Plan' }), 'sub:SubAgent:Plan');
    assert.equal(runIdentityOf({ role: 'sub-agent-chat' }), 'sub:SubAgent');
    assert.equal(runIdentityOf({ role: 'user' }), null);
    assert.equal(runIdentityOf(null), null);
  });
  it('detects thinking blocks', () => {
    assert.equal(hasThinkingBlock([think(), tu()]), true);
    assert.equal(hasThinkingBlock([{ type: 'redacted_thinking' }]), true);
    assert.equal(hasThinkingBlock([tu()]), false);
    assert.equal(hasThinkingBlock(null), false);
  });
});

describe('mergeToolRuns — basic merge', () => {
  it('merges three consecutive tool-only turns into one element at the last position', () => {
    const a = asst('a', [think(), tu()]);
    const b = asst('b', [tu()]);
    const c = asst('c', [tu('Read')]);
    const items = [user('u0'), a, b, c, user('u1')];
    const { items: out, indexMap } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['user', 'RUN(3)', 'user']);
    const run = out[1];
    assert.equal(run.key, 'run-a');
    assert.equal(run.type, 'ChatMessage');
    assert.equal(run.props.role, 'assistant');
    // Inherits the LAST member's timestamps (bubble sits at the last call).
    assert.equal(run.props.timestamp, 'Tc');
    assert.equal(run.props.displayTs, 'Gc');
    assert.equal(run.props.content, c.props.content);
    const m = run.props.runMembers;
    assert.deepEqual(m.map((x) => x.key), ['a', 'b', 'c']);
    assert.deepEqual(m.map((x) => x.props.runMember), [true, true, true]);
    assert.deepEqual(indexMap, [0, 1, 1, 1, 2, 3]);
  });


  it('does not merge a single tool-only turn (element passes through by reference)', () => {
    const a = asst('a', [tu()]);
    const items = [user('u0'), a, user('u1')];
    const { items: out, indexMap } = mergeToolRuns(items, new Map());
    assert.equal(out.length, 3);
    assert.equal(out[1], a);
    assert.deepEqual(indexMap, [0, 1, 2, 3]);
  });

  it('returns the same array when nothing merges', () => {
    const items = [user('u0'), asst('a', [text('hello')])];
    const res = mergeToolRuns(items, new Map());
    assert.equal(res.items, items);
  });
});

describe('mergeToolRuns — breaks', () => {
  it('a text turn breaks the run and stays its own bubble', () => {
    const items = [asst('a', [tu()]), asst('b', [tu()]), asst('t', [text('Here is what I found')]), asst('c', [tu()]), asst('d', [tu()])];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(2)', 'assistant', 'RUN(2)']);
    assert.equal(out[1].key, 't');
  });

  it('full-display tools break the run', () => {
    for (const name of ['Edit', 'Write', 'ExitPlanMode', 'AskUserQuestion', 'Agent', 'TaskCreate', 'SendMessage', 'Workflow', 'EnterPlanMode']) {
      const items = [asst('a', [tu()]), asst('b', [tu()]), asst('x', [tu(name)]), asst('c', [tu()]), asst('d', [tu()])];
      const { items: out } = mergeToolRuns(items, new Map());
      assert.deepEqual(roles(out), ['RUN(2)', 'assistant', 'RUN(2)'], name);
    }
  });

  it('streaming cursor / pending interaction owners / IM agent rows never merge', () => {
    const items = [
      asst('a', [tu()]), asst('b', [tu()], { showTrailingCursor: true }),
      asst('c', [tu()]), asst('d', [tu()], { lastPendingAskId: 'x' }),
      asst('e', [tu()]), asst('f', [tu()], { lastPendingPlanId: 'y' }),
      asst('g', [tu()]), asst('h', [tu()], { imAgent: { name: 'bot' } }),
    ];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.equal(out.length, 8);
    assert.ok(out.every((i) => !i.props.runMembers));
  });

  it('main-stream content rows break the main run', () => {
    for (const role of ['user', 'plan-prompt', 'skill-loaded', 'task-notification', 'teammate-message', 'teammate-status']) {
      const items = [asst('a', [tu()]), asst('b', [tu()]), user('u', role), asst('c', [tu()]), asst('d', [tu()])];
      const { items: out } = mergeToolRuns(items, new Map());
      assert.deepEqual(roles(out), ['RUN(2)', role, 'RUN(2)'], role);
    }
  });

  it('items without props.role (Divider / banner) break every run', () => {
    const items = [asst('a', [tu()]), sub('s1', [tu()]), divider('div'), asst('b', [tu()]), sub('s2', [tu()])];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.equal(out.length, 5);
    assert.ok(out.every((i) => !i.props.runMembers));
  });
});

describe('mergeToolRuns — system rows', () => {
  it('absorbs appended system prompts inside an open main run', () => {
    const items = [asst('a', [tu()]), sys('s1'), asst('b', [tu()]), sys('s2'), asst('c', [tu()])];
    const { items: out, indexMap } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(5)']);
    const m = out[0].props.runMembers;
    assert.deepEqual(m.map((x) => x.props.role), ['assistant', 'system', 'assistant', 'system', 'assistant']);
    assert.ok(m.every((x) => x.props.runMember === true));
    assert.equal(out[0].props.role, 'assistant'); // base is the last NON-system member
    assert.deepEqual(indexMap, [0, 0, 0, 0, 0, 1]);
  });

  it('a system row after the last tool turn is absorbed and the base stays the assistant member', () => {
    const items = [asst('a', [tu()]), asst('b', [tu()]), sys('s1'), user('u')];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(3)', 'user']);
    assert.equal(out[0].props.role, 'assistant');
    assert.equal(out[0].props.timestamp, 'Tb');
  });

  it('system rows outside a run pass through untouched and do not break sub runs', () => {
    const s0 = sys('s0');
    const items = [s0, user('u'), sub('x1', [tu()]), sys('s1'), sub('x2', [tu()])];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['system', 'user', 'system', 'RUN(2)']);
    assert.equal(out[0], s0);
  });

  it('a lone assistant turn + one system row does merge (two members)', () => {
    const items = [asst('a', [tu()]), sys('s1'), user('u')];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(2)', 'user']);
  });
});

describe('mergeToolRuns — per-agent streams', () => {
  it('interleaved sub-agent rows do not break the main run and vice versa', () => {
    const items = [asst('a', [tu()]), sub('s1', [tu()]), asst('b', [tu()]), sub('s2', [tu()]), asst('c', [tu()]), sub('s3', [tu()])];
    const { items: out, indexMap } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(3)', 'RUN(3)']);
    assert.equal(out[0].props.role, 'assistant');
    assert.equal(out[1].props.role, 'sub-agent-chat');
    assert.deepEqual(indexMap, [0, 1, 0, 1, 0, 1, 2]);
  });

  it('different sub-agent labels form separate runs; teammate label rows too', () => {
    const items = [
      sub('e1', [tu()], 'SubAgent:Explore'), sub('p1', [tu()], 'SubAgent:Plan'),
      sub('e2', [tu()], 'SubAgent:Explore'), sub('p2', [tu()], 'SubAgent:Plan'),
      asst('t1', [tu()], { label: 'worker-1', isTeammate: true }), asst('t2', [tu()], { label: 'worker-1', isTeammate: true }),
    ];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(2)', 'RUN(2)', 'RUN(2)']);
    assert.equal(out[0].props.label, 'SubAgent:Explore');
    assert.equal(out[1].props.label, 'SubAgent:Plan');
    assert.equal(out[2].props.label, 'worker-1');
    assert.equal(out[2].props.isTeammate, true);
  });

  it('a user prompt breaks every open stream, main and sub alike', () => {
    // Turn-boundary rows close sub streams too: otherwise same-label rows
    // from two different spawns would merge across the user turn, and the
    // earlier spawn's cards would inherit the later spawn's position,
    // timestamp and requestIndex.
    const items = [sub('s1', [tu()]), sub('s2', [tu()]), asst('a', [tu()]), asst('b', [tu()]), user('u'), sub('s3', [tu()]), sub('s4', [tu()]), asst('c', [tu()]), asst('d', [tu()])];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(2)', 'RUN(2)', 'user', 'RUN(2)', 'RUN(2)']);
    assert.equal(out[0].props.role, 'sub-agent-chat');
    assert.equal(out[1].props.role, 'assistant');
    assert.equal(out[3].props.role, 'sub-agent-chat');
    assert.equal(out[4].props.role, 'assistant');
  });
});

describe('mergeToolRuns — memo cache', () => {
  it('reuses the merged element when member references are unchanged', () => {
    const cache = new Map();
    const items = [asst('a', [tu()]), asst('b', [tu()])];
    const r1 = mergeToolRuns(items, cache);
    const r2 = mergeToolRuns(items, cache);
    assert.equal(r1.items[0], r2.items[0]);
    assert.equal(cache.size, 1);
  });

  it('rebuilds when a member changes or the run grows, and evicts stale keys', () => {
    const cache = new Map();
    const a = asst('a', [tu()]);
    const r1 = mergeToolRuns([a, asst('b', [tu()])], cache);
    const r2 = mergeToolRuns([a, asst('b', [tu()]), asst('c', [tu()])], cache);
    assert.notEqual(r1.items[0], r2.items[0]);
    assert.equal(r2.items[0].key, 'run-a');
    assert.equal(r2.items[0].props.runMembers.length, 3);
    // Run dissolves → stale key evicted.
    const r3 = mergeToolRuns([a, asst('t', [text('x')])], cache);
    assert.equal(r3.items.length, 2);
    assert.equal(cache.size, 0);
  });
});

describe('mergeToolRuns — edge cases', () => {
  it('redacted_thinking-only turns merge', () => {
    const items = [asst('a', [tu()]), asst('b', [{ type: 'redacted_thinking' }]), asst('c', [tu()])];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(3)']);
  });

  it('an unknown ChatMessage role closes every open stream', () => {
    const items = [asst('a', [tu()]), sub('s1', [tu()]), el('z', { role: 'something-new' }), asst('b', [tu()]), sub('s2', [tu()])];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.equal(out.length, 5);
    assert.ok(out.every((i) => !i.props.runMembers));
  });

  it('label-less sub-agent rows share the sub:SubAgent stream', () => {
    const items = [sub('x1', [tu()], null), sub('x2', [tu()], null)];
    const { items: out } = mergeToolRuns(items, new Map());
    assert.deepEqual(roles(out), ['RUN(2)']);
    assert.equal(out[0].props.label, null);
  });

  it('indexMap end anchor points one past the merged array', () => {
    const items = [asst('a', [tu()]), asst('b', [tu()]), user('u'), asst('c', [tu()]), asst('d', [tu()])];
    const { items: out, indexMap } = mergeToolRuns(items, new Map());
    assert.equal(out.length, 3);
    assert.equal(indexMap[items.length], 3);
    assert.deepEqual(indexMap, [0, 0, 1, 2, 2, 3]);
  });
});
