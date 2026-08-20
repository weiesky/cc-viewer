/**
 * Unit tests for src/utils/refreshCachedItemProp.js
 *
 * 验证 _sessionItemCache 命中路径下，含指定 tool_use 的旧 React Element 在 map 引用变化时被
 * cloneElement 刷新指定 prop；其他 element 原样保留；引用全等时零分配。合并自原
 * refreshPlanApprovalCache / refreshAskAnswerCache 两个孪生模块的测试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { refreshCachedItemProp } from '../src/utils/refreshCachedItemProp.js';

function mkAsst(toolName, propName, toolId, map) {
  return React.createElement('ChatMessage', {
    role: 'assistant',
    content: [{ type: 'tool_use', name: toolName, id: toolId }],
    [propName]: map,
  });
}
function mkAsstWithBash(toolId) {
  return React.createElement('ChatMessage', {
    role: 'assistant',
    content: [{ type: 'tool_use', name: 'Bash', id: toolId }],
  });
}
function mkUser(text) {
  return React.createElement('ChatMessage', { role: 'user', content: [{ type: 'text', text }] });
}
function mkSubAgent(toolName) {
  return React.createElement('ChatMessage', {
    role: 'sub-agent-chat',
    content: [{ type: 'tool_use', name: toolName, id: 'tu_sub' }],
  });
}

// 两种参数化场景：ExitPlanMode→planApprovalMap / AskUserQuestion→askAnswerMap
const CASES = [
  { label: 'ExitPlanMode / planApprovalMap', toolName: 'ExitPlanMode', propName: 'planApprovalMap' },
  { label: 'AskUserQuestion / askAnswerMap', toolName: 'AskUserQuestion', propName: 'askAnswerMap' },
];

for (const { label, toolName, propName } of CASES) {
  describe(`refreshCachedItemProp — ${label}`, () => {
    it('returns same items reference when prevMap === nextMap (zero-alloc fast path)', () => {
      const map = { tu_a: { status: 'pending' } };
      const items = [mkAsst(toolName, propName, 'tu_a', map), mkUser('hi')];
      const out = refreshCachedItemProp(items, map, map, toolName, propName);
      assert.strictEqual(out, items, 'identical reference returned (no allocation)');
    });

    it('returns same items reference when no element holds the target tool_use', () => {
      const prev = { tu_a: { status: 'pending' } };
      const next = { tu_a: { status: 'approved' } };
      const items = [mkUser('hi'), mkAsstWithBash('tu_b'), mkSubAgent(toolName)];
      const out = refreshCachedItemProp(items, prev, next, toolName, propName);
      assert.strictEqual(out, items, 'no owner → original array reused');
    });

    it('clones only the owner assistant element when map ref changes', () => {
      const prev = {};
      const next = { tu_a: { status: 'approved' } };
      const userEl = mkUser('q?');
      const asstEl = mkAsst(toolName, propName, 'tu_a', prev);
      const bashEl = mkAsstWithBash('tu_b');
      const items = [userEl, asstEl, bashEl];
      const out = refreshCachedItemProp(items, prev, next, toolName, propName);

      assert.notStrictEqual(out, items, 'new array allocated');
      assert.strictEqual(out[0], userEl, 'user element preserved by reference');
      assert.notStrictEqual(out[1], asstEl, 'owner cloned');
      assert.strictEqual(out[1].props[propName], next, 'cloned element gets next map');
      assert.strictEqual(out[1].props.role, 'assistant', 'role preserved');
      assert.strictEqual(out[1].props.content, asstEl.props.content, 'content prop preserved');
      assert.strictEqual(out[2], bashEl, 'non-owner assistant preserved by reference');
    });

    it('does not patch sub-agent or user ChatMessage even if they nominally hold the block', () => {
      const prev = {};
      const next = { tu_sub: { status: 'approved' } };
      const items = [mkSubAgent(toolName), mkUser('x')];
      const out = refreshCachedItemProp(items, prev, next, toolName, propName);
      assert.strictEqual(out, items, 'only role==="assistant" qualifies for patch');
    });

    it('patches multiple owners in one pass', () => {
      const prev = {};
      const next = { tu_a: { status: 'approved' }, tu_c: { status: 'rejected' } };
      const a = mkAsst(toolName, propName, 'tu_a', prev);
      const b = mkUser('mid');
      const c = mkAsst(toolName, propName, 'tu_c', prev);
      const out = refreshCachedItemProp([a, b, c], prev, next, toolName, propName);

      assert.notStrictEqual(out[0], a, 'first owner cloned');
      assert.strictEqual(out[1], b, 'middle user preserved');
      assert.notStrictEqual(out[2], c, 'second owner cloned');
      assert.strictEqual(out[0].props[propName], next);
      assert.strictEqual(out[2].props[propName], next);
    });

    it('handles empty items array', () => {
      const out = refreshCachedItemProp([], {}, { tu: {} }, toolName, propName);
      assert.deepStrictEqual(out, []);
    });

    it('skips elements without props or content', () => {
      const prev = {};
      const next = { tu_a: { status: 'approved' } };
      const weirdEl = { type: 'div' };
      const asstEl = mkAsst(toolName, propName, 'tu_a', prev);
      const out = refreshCachedItemProp([weirdEl, asstEl], prev, next, toolName, propName);
      assert.strictEqual(out[0], weirdEl, 'malformed element returned as-is');
      assert.notStrictEqual(out[1], asstEl, 'real owner card cloned');
    });
  });
}
