/**
 * buildContextItemRawText（Context 标签页「原文」视图文本组装）单测。
 *
 * contextRaw.js → helpers.js 顶部有 .svg(?raw) 静态 import，纯 Node 无法直接
 * 静态 import，先 register vite-loader shim 再动态 import（同 helpers.test.js）。
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let buildContextItemRawText;
before(async () => {
  ({ buildContextItemRawText } = await import('../src/utils/contextRaw.js'));
});

describe('buildContextItemRawText', () => {
  it('空 item 返回空串', () => {
    assert.equal(buildContextItemRawText(null), '');
    assert.equal(buildContextItemRawText(undefined), '');
  });

  it('raw 为空的节点返回空串', () => {
    assert.equal(buildContextItemRawText({ id: 'tool__0', blocks: [] }), '');
  });

  it('tool 节点输出原始 tool 对象的两空格缩进 JSON', () => {
    const tool = { name: 'Bash', description: 'run', input_schema: { type: 'object' } };
    const out = buildContextItemRawText({ id: 'tool__0', raw: tool });
    assert.equal(out, JSON.stringify(tool, null, 2));
  });

  it('system 为字符串时原样输出（不加引号包裹）', () => {
    const out = buildContextItemRawText({ id: 'system__0', raw: 'You are Claude.' });
    assert.equal(out, 'You are Claude.');
  });

  it('system 为数组时输出 JSON', () => {
    const system = [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }];
    const out = buildContextItemRawText({ id: 'system__0', raw: system });
    assert.equal(out, JSON.stringify(system, null, 2));
  });

  it('turn 节点（有 assistant）输出 [user, assistant] 原始消息切片', () => {
    const userMsg = { role: 'user', content: 'hi' };
    const assistantMsg = { role: 'assistant', content: [{ type: 'text', text: 'hello' }] };
    const out = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawAssistant: assistantMsg });
    assert.equal(out, JSON.stringify([userMsg, assistantMsg], null, 2));
  });

  it('turn 节点（无 assistant）只输出 [user]', () => {
    const userMsg = { role: 'user', content: 'hi' };
    const out = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawAssistant: null });
    assert.equal(out, JSON.stringify([userMsg], null, 2));
  });

  it('末轮 response 覆盖后 assistant 部分为完整 response body', () => {
    const userMsg = { role: 'user', content: 'hi' };
    const responseBody = { id: 'msg_1', model: 'claude', content: [{ type: 'text', text: 'ok' }], usage: { output_tokens: 3 } };
    // 模拟 ContextTab turns useMemo 的覆盖结果：rawAssistant = response body
    const out = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawAssistant: responseBody });
    assert.equal(out, JSON.stringify([userMsg, responseBody], null, 2));
  });

  it('turn with rawSystem → [user, ...system, assistant] slice order', () => {
    const userMsg = { role: 'user', content: 'hi' };
    const sysMsg = { role: 'system', content: 'gentle reminder' };
    const assistantMsg = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] };
    const out = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawSystem: [sysMsg], rawAssistant: assistantMsg });
    assert.equal(out, JSON.stringify([userMsg, sysMsg, assistantMsg], null, 2));
  });

  it('last-turn response override keeps folded system messages', () => {
    // Mirrors ContextTab turns useMemo: {...last} preserves rawSystem while
    // rawAssistant is replaced by the full response body.
    const userMsg = { role: 'user', content: 'hi' };
    const sysMsg = { role: 'system', content: 'gentle reminder' };
    const responseBody = { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] };
    const out = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawSystem: [sysMsg], rawAssistant: responseBody });
    assert.equal(out, JSON.stringify([userMsg, sysMsg, responseBody], null, 2));
  });

  it('rawSystem null/absent → output identical to pre-rawSystem shape (old logs)', () => {
    const userMsg = { role: 'user', content: 'hi' };
    const assistantMsg = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] };
    const withNull = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawSystem: null, rawAssistant: assistantMsg });
    const withoutKey = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawAssistant: assistantMsg });
    assert.equal(withNull, withoutKey);
  });

  it('_ 前缀注入键（如 _timestamp）被递归剥除', () => {
    const userMsg = { role: 'user', _timestamp: '2026-06-12T00:00:00Z', content: [{ type: 'text', text: 'hi', _meta: 1 }] };
    const out = buildContextItemRawText({ isTurn: true, rawUser: userMsg, rawAssistant: null });
    assert.ok(!out.includes('_timestamp'));
    assert.ok(!out.includes('_meta'));
    assert.ok(out.includes('"role": "user"'));
    assert.ok(out.includes('"text": "hi"'));
  });
});
