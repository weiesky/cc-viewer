/**
 * Unit tests for src/utils/requestExpand.js
 * Covers the expand policy for the request-payload JSON view, in particular
 * the first-turn MainAgent system[2] expansion (SDK-mode base prompt).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestExpandNode } from '../src/utils/requestExpand.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeSystem() {
  return [
    { type: 'text', text: 'You are Claude Code' },
    { type: 'text', text: 'tool descriptions' },
    { type: 'text', text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.', nested: { a: 1 } },
  ];
}

function makeFirstTurnBody() {
  return {
    system: makeSystem(),
    tools: [{ name: 'Bash' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  };
}

function makeMultiMessageBody() {
  return {
    system: makeSystem(),
    tools: [{ name: 'Bash' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildRequestExpandNode', () => {
  it('expands all system segments on first-turn MainAgent', () => {
    const data = makeFirstTurnBody();
    const fn = buildRequestExpandNode({ data, type: 'request', reqType: 'MainAgent', filterExpandSet: null });
    assert.ok(typeof fn === 'function');
    // system array itself and every segment must be expanded
    assert.equal(fn(1, data, 'system'), true);
    assert.equal(fn(2, data.system, 'system'), true);
    assert.equal(fn(2, data.system[0], 'system'), true);
    assert.equal(fn(2, data.system[1], 'system'), true);
    assert.equal(fn(2, data.system[2], 'system'), true);
    // deep descendant under a segment is also expanded
    assert.equal(fn(3, data.system[2].nested, 'system'), true);
    // messages last content still expanded (existing behavior)
    const lastContent = data.messages[0].content[data.messages[0].content.length - 1];
    assert.equal(fn(2, lastContent, 'messages'), true);
  });

  it('does NOT expand system for multi-message MainAgent', () => {
    const data = makeMultiMessageBody();
    const fn = buildRequestExpandNode({ data, type: 'request', reqType: 'MainAgent', filterExpandSet: null });
    // multi-message MainAgent falls through to filterExpandSet/default → undefined
    assert.equal(fn, undefined);
  });

  it('returns undefined for non-MainAgent / non-Preflight types', () => {
    const data = makeFirstTurnBody();
    const fn = buildRequestExpandNode({ data, type: 'request', reqType: 'SubAgent', filterExpandSet: null });
    assert.equal(fn, undefined);
  });

  it('does NOT deep-expand system when system is not an array (guard)', () => {
    const data = makeFirstTurnBody();
    data.system = 'plain string system prompt';
    const fn = buildRequestExpandNode({ data, type: 'request', reqType: 'MainAgent', filterExpandSet: null });
    assert.ok(typeof fn === 'function');
    // Root-level nodes still expand (level < 2), but no deep refs under a string system.
    assert.equal(fn(1, data, 'system'), true);
    assert.equal(fn(2, data.system, 'system'), false);
  });

  it('keeps Preflight system[2] expansion unchanged', () => {
    const data = makeFirstTurnBody();
    const fn = buildRequestExpandNode({ data, type: 'request', reqType: 'Preflight', filterExpandSet: null });
    assert.ok(typeof fn === 'function');
    assert.equal(fn(1, data, 'system'), true);
    assert.equal(fn(2, data.system[2], 'system'), true);
  });

  it('returns undefined for non-request type', () => {
    const data = makeFirstTurnBody();
    const fn = buildRequestExpandNode({ data, type: 'response', reqType: 'MainAgent', filterExpandSet: null });
    assert.equal(fn, undefined);
  });

  it('ORs filterExpandSet into the MainAgent branch', () => {
    const data = makeFirstTurnBody();
    const extra = data.messages[0];
    const filterExpandSet = new Set([extra]);
    const fn = buildRequestExpandNode({ data, type: 'request', reqType: 'MainAgent', filterExpandSet });
    assert.ok(typeof fn === 'function');
    assert.equal(fn(1, extra, 'messages'), true);
  });
});
