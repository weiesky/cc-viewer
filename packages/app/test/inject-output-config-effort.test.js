/**
 * injectOutputConfigEffort 单测 — proxy profile hot-switch 强制 output_config.effort。
 *
 * 两条路径：
 *   - hasOutputConfig=false → 顶层 `{` 后定向前插，不 parse 巨型 body。
 *   - hasOutputConfig=true  → 整体 parse/stringify 合并进既有 output_config。
 * 值域受限 low/medium/high/xhigh/max；非法值 / 非字符串 → null（调用方跳过注入）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { injectOutputConfigEffort } from '../server/lib/interceptor-core.js';

describe('injectOutputConfigEffort', () => {
  it('无 output_config：前插后为合法 JSON，effort 生效且其余字段保留', () => {
    const body = JSON.stringify({ model: 'm1', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
    const out = injectOutputConfigEffort(body, 'max', false);
    assert.ok(out);
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.output_config, { effort: 'max' });
    assert.equal(parsed.model, 'm1');
    assert.equal(parsed.max_tokens, 100);
    assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }]);
  });

  it('前插位置在最前：output_config 出现在 model 之前', () => {
    const out = injectOutputConfigEffort('{"model":"m1"}', 'high', false);
    assert.equal(out, '{"output_config":{"effort":"high"},"model":"m1"}');
  });

  it('已有 output_config：合并 effort，保留既有子字段', () => {
    const body = JSON.stringify({ model: 'm1', output_config: { format: 'json' } });
    const out = injectOutputConfigEffort(body, 'low', true);
    assert.ok(out);
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.output_config, { format: 'json', effort: 'low' });
  });

  it('已有 output_config 且已含 effort：覆盖为新值', () => {
    const body = JSON.stringify({ model: 'm1', output_config: { effort: 'low' } });
    const out = injectOutputConfigEffort(body, 'max', true);
    assert.equal(JSON.parse(out).output_config.effort, 'max');
  });

  it('空对象 body：不产生尾逗号（合法 JSON）', () => {
    const out = injectOutputConfigEffort('{}', 'medium', false);
    assert.equal(out, '{"output_config":{"effort":"medium"}}');
    assert.doesNotThrow(() => JSON.parse(out));
  });

  it('前置空白的空对象：跳过空白探测到 }，仍不加逗号', () => {
    const out = injectOutputConfigEffort('{  }', 'medium', false);
    assert.doesNotThrow(() => JSON.parse(out));
    assert.equal(JSON.parse(out).output_config.effort, 'medium');
  });

  it('全部合法 effort 值均被接受', () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const out = injectOutputConfigEffort('{"model":"m1"}', e, false);
      assert.ok(out, `${e} 应被接受`);
      assert.equal(JSON.parse(out).output_config.effort, e);
    }
  });

  it('非法 effort 值 → null（调用方跳过注入）', () => {
    assert.equal(injectOutputConfigEffort('{"model":"m1"}', 'ultra', false), null);
    assert.equal(injectOutputConfigEffort('{"model":"m1"}', '', false), null);
    assert.equal(injectOutputConfigEffort('{"model":"m1"}', 'MAX', false), null);
  });

  it('非法入参 → null', () => {
    assert.equal(injectOutputConfigEffort(null, 'max', false), null);
    assert.equal(injectOutputConfigEffort('', 'max', false), null);
    assert.equal(injectOutputConfigEffort(123, 'max', false), null);
    assert.equal(injectOutputConfigEffort('{"model":"m1"}', null, false), null);
  });

  it('合并路径遇非法 JSON → null（回退，不抛错）', () => {
    assert.equal(injectOutputConfigEffort('{not json', 'max', true), null);
  });

  it('顶层数组（前插路径）→ null，不注入嵌套对象', () => {
    // `{` 之前有非空白 `[` → 拒绝，避免把 output_config 塞进数组元素
    assert.equal(injectOutputConfigEffort('[{"a":1}]', 'max', false), null);
  });

  it('巨型 body（5MB messages）走前插：不触碰消息区且长度只增插入片段', () => {
    const bigText = 'x'.repeat(5 * 1024 * 1024);
    const body = JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: bigText }] });
    const out = injectOutputConfigEffort(body, 'max', false);
    assert.ok(out);
    const insert = '"output_config":{"effort":"max"},';
    assert.equal(out.length, body.length + insert.length);
    assert.ok(out.includes(bigText));
    assert.equal(JSON.parse(out).output_config.effort, 'max');
  });
});
