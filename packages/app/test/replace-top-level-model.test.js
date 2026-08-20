/**
 * replaceTopLevelModel 单测 — proxy profile activeModel 改写的定向字符串替换。
 *
 * 正确性核心：唯一非歧义匹配才替换；任何不确定 → null（调用方回退 parse/stringify 旧路径）。
 * 关键事实：JSON 字符串值内引号必转义为 \"，裸 `"model":"..."` 字节序列只能出现在真实结构处。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replaceTopLevelModel } from '../server/lib/interceptor-core.js';

describe('replaceTopLevelModel', () => {
  it('紧凑 JSON（CLI 实际形态）：顶层 model 被替换，其余字节原样保留', () => {
    const body = JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 32000, messages: [{ role: 'user', content: 'hi' }] });
    const out = replaceTopLevelModel(body, 'claude-opus-4-8', 'glm-5');
    assert.ok(out);
    const parsed = JSON.parse(out);
    assert.equal(parsed.model, 'glm-5');
    assert.equal(parsed.max_tokens, 32000);
    assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }]);
  });

  it('冒号后单空格形态同样命中', () => {
    const out = replaceTopLevelModel('{"model": "m1","a":1}', 'm1', 'm2');
    assert.equal(out, '{"model": "m2","a":1}');
  });

  it('message 文本里出现 "model":"..." 字样（字符串值内必被转义）→ 不干扰顶层替换', () => {
    const body = JSON.stringify({
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: '帮我解释 {"model":"claude-opus-4-8"} 这段配置' }],
    });
    const out = replaceTopLevelModel(body, 'claude-opus-4-8', 'glm-5');
    assert.ok(out, '字符串值内的引号是 \\" 转义形态，不构成候选');
    const parsed = JSON.parse(out);
    assert.equal(parsed.model, 'glm-5');
    assert.ok(parsed.messages[0].content.includes('"model":"claude-opus-4-8"'), '消息内容原样保留');
  });

  it('嵌套对象存在同值 model 键（真实结构）→ 候选 ≥2 → null 回退', () => {
    const body = JSON.stringify({
      model: 'm1',
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'x', input: { model: 'm1' } }] }],
    });
    assert.equal(replaceTopLevelModel(body, 'm1', 'm2'), null);
  });

  it('嵌套 model 值不同 → 不构成候选，顶层正常替换且嵌套不被误改', () => {
    const body = JSON.stringify({
      model: 'm1',
      messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'x', input: { model: 'other' } }] }],
    });
    const out = replaceTopLevelModel(body, 'm1', 'm2');
    const parsed = JSON.parse(out);
    assert.equal(parsed.model, 'm2');
    assert.equal(parsed.messages[0].content[0].input.model, 'other');
  });

  it('零匹配（model 值对不上）→ null', () => {
    assert.equal(replaceTopLevelModel('{"model":"m1"}', 'm9', 'm2'), null);
  });

  it('model 值含需 JSON 转义的字符 → needle 用 JSON.stringify 形态对齐', () => {
    const weird = 'm"1\\x';
    const body = JSON.stringify({ model: weird, a: 1 });
    const out = replaceTopLevelModel(body, weird, 'm2');
    assert.ok(out);
    assert.equal(JSON.parse(out).model, 'm2');
  });

  it('非法入参（非字符串 / 空值）→ null', () => {
    assert.equal(replaceTopLevelModel(null, 'a', 'b'), null);
    assert.equal(replaceTopLevelModel('{}', '', 'b'), null);
    assert.equal(replaceTopLevelModel('{"model":"a"}', 'a', ''), null);
    assert.equal(replaceTopLevelModel(123, 'a', 'b'), null);
  });

  it('成员边界校验：前缀非 {/, 的伪命中不构成候选', () => {
    // "model":"m1" 出现在数组元素位置（前缀是 [）→ 非对象成员，拒绝
    const body = '["model":"m1"]'; // 非法 JSON 无妨 —— 函数只做字节级判断
    assert.equal(replaceTopLevelModel(body, 'm1', 'm2'), null);
  });

  it('巨型 body（5MB messages）替换正确且不触碰消息区', () => {
    const bigText = 'x'.repeat(5 * 1024 * 1024);
    const body = JSON.stringify({ model: 'claude-opus-4-8', messages: [{ role: 'user', content: bigText }] });
    const out = replaceTopLevelModel(body, 'claude-opus-4-8', 'glm-5');
    assert.ok(out);
    assert.equal(out.length, body.length - 'claude-opus-4-8'.length + 'glm-5'.length);
    assert.ok(out.includes('"model":"glm-5"'));
  });
});
