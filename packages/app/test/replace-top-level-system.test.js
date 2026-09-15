/**
 * replaceTopLevelSystem 单测 — system 文本随模型热切换的 wire 层定向替换。
 *
 * 正确性核心：
 * - 顶层 "system" 候选必须唯一（嵌套同名成员，如工具 input_schema 里的 "system"
 *   属性 → null 回退 parse/stringify）；
 * - 值结束位置用字符串/转义感知扫描定位，值后必须是 `,` 或 `}`；
 * - 无顶层 system 成员时仅 opts.allowPrepend===true 才前插（utility 端点绝不发明 system）；
 * - 数组形态（真实 wire 100% 是数组：billing-header / cache_control blocks）原样保留其余字节。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { replaceTopLevelSystem } from '../server/lib/interceptor-core.js';

const NEW_SYS = JSON.stringify([{ type: 'text', text: 'NEW SYSTEM' }]);

describe('replaceTopLevelSystem', () => {
  it('字符串形态 system 被替换，其余字节原样保留', () => {
    const body = JSON.stringify({ model: 'm1', system: 'OLD', messages: [{ role: 'user', content: 'hi' }] });
    const out = replaceTopLevelSystem(body, NEW_SYS);
    assert.ok(out);
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.system, [{ type: 'text', text: 'NEW SYSTEM' }]);
    assert.equal(parsed.model, 'm1');
    assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }]);
  });

  it('数组形态（含 cache_control 的 blocks）整体替换，messages 原样', () => {
    const body = JSON.stringify({
      system: [
        { type: 'text', text: 'x-anthropic-billing-header: cc_version=1' },
        { type: 'text', text: 'You are Claude Code', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    });
    const out = replaceTopLevelSystem(body, NEW_SYS);
    assert.ok(out);
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.system, [{ type: 'text', text: 'NEW SYSTEM' }]);
    assert.equal(parsed.messages.length, 1);
  });

  it('冒号后单空格形态同样命中', () => {
    const out = replaceTopLevelSystem('{"system" : "OLD","a":1}', '"NEW"');
    assert.equal(out, '{"system" : "NEW","a":1}');
  });

  it('system 数组内文本含 ] } \\" 转义 → 扫描不截断', () => {
    const tricky = 'text with ] and } and \\"quoted\\" and \\\\ backslash';
    const body = JSON.stringify({ system: [{ type: 'text', text: tricky }], a: 1 });
    const out = replaceTopLevelSystem(body, '"NEW"');
    assert.ok(out);
    const parsed = JSON.parse(out);
    assert.equal(parsed.system, 'NEW');
    assert.equal(parsed.a, 1);
  });

  it('工具 input_schema 里嵌套 "system" 属性 → 深度感知：嵌套非候选，只替换顶层', () => {
    // review 第二轮 P1-4：旧实现把嵌套的 schema.properties.system 误当候选（前一字符是 {），
    // 候选 ≥2 → null 回退（连顶层都替换不了）。深度感知扫描后嵌套同名成员不再是候选，
    // 顶层唯一 system → 正常替换，schema 不受影响。
    const body = JSON.stringify({
      system: 'OLD',
      tools: [{ name: 't', input_schema: { properties: { system: { type: 'string' } } } }],
    });
    const out = replaceTopLevelSystem(body, NEW_SYS);
    assert.ok(out, '顶层唯一 system → 正常替换（嵌套 schema 不再误判为候选）');
    const parsed = JSON.parse(out);
    assert.equal(JSON.stringify(parsed.system), NEW_SYS, '顶层 system 被替换');
    assert.deepEqual(parsed.tools[0].input_schema.properties.system, { type: 'string' }, 'schema 内嵌套 system 不受影响');
  });

  it('顶层无 system + 工具 schema 含嵌套 system → allowPrepend 前插到顶层而非 schema（P1-4）', () => {
    // review 第二轮 P1-4：旧前插分支只校验成员边界（前一字符是 { 或 ,），schema 的
    // properties.system 同样满足 → persona 被注到工具 schema 而顶层 system 仍未设置。
    // 深度感知后前插只落到顶层对象。
    const body = JSON.stringify({
      model: 'm',
      tools: [{ name: 'Bash', input_schema: { type: 'object', properties: { system: { type: 'string' } } } }],
      messages: [],
    });
    const out = replaceTopLevelSystem(body, '"PERSONA"', { allowPrepend: true });
    assert.ok(out, '前插成功');
    const parsed = JSON.parse(out);
    assert.equal(parsed.system, 'PERSONA', '顶层 system 被前插');
    assert.deepEqual(parsed.tools[0].input_schema.properties.system, { type: 'string' }, 'schema 内嵌套 system 未被污染');
  });

  it('消息文本里出现 "system":"..." 字样（字符串值内必被转义）→ 不干扰', () => {
    const body = JSON.stringify({
      system: 'OLD',
      messages: [{ role: 'user', content: '解释 {"system":"x"} 这段 JSON' }],
    });
    const out = replaceTopLevelSystem(body, '"NEW"');
    assert.ok(out, '字符串值内的引号是 \\" 转义形态，不构成候选');
    const parsed = JSON.parse(out);
    assert.equal(parsed.system, 'NEW');
    assert.ok(parsed.messages[0].content.includes('"system":"x"'));
  });

  it('system 是最后一个成员（值后直接 }} ）→ 正常替换', () => {
    const body = '{"a":1,"system":"OLD"}';
    const out = replaceTopLevelSystem(body, '"NEW"');
    assert.equal(out, '{"a":1,"system":"NEW"}');
  });

  it('无 system 成员且未允许 prepend → null', () => {
    assert.equal(replaceTopLevelSystem('{"model":"m1"}', NEW_SYS), null);
  });

  it('无 system 成员且 allowPrepend → 前插为首个成员', () => {
    const out = replaceTopLevelSystem('{"model":"m1"}', NEW_SYS, { allowPrepend: true });
    assert.ok(out.startsWith(`{"system":${NEW_SYS},"model"`));
    assert.deepEqual(JSON.parse(out).model, 'm1');
  });

  it('空对象 prepend 不产生尾逗号', () => {
    const out = replaceTopLevelSystem('{}', NEW_SYS, { allowPrepend: true });
    assert.equal(out, `{"system":${NEW_SYS}}`);
  });

  it('顶层非对象 → null', () => {
    assert.equal(replaceTopLevelSystem('[{"system":"x"}]', NEW_SYS), null);
  });

  it('newSystemJson 非法 JSON → null（防御）', () => {
    assert.equal(replaceTopLevelSystem('{"system":"OLD"}', 'not json'), null);
  });

  it('入参非字符串 → null', () => {
    assert.equal(replaceTopLevelSystem(null, NEW_SYS), null);
    assert.equal(replaceTopLevelSystem('{"system":"OLD"}', null), null);
    assert.equal(replaceTopLevelSystem('{"system":"OLD"}', ''), null);
  });

  it('字面量形态 system（防御：null 值）→ 正常替换', () => {
    const body = '{"system":null,"a":1}';
    const out = replaceTopLevelSystem(body, '"NEW"');
    assert.equal(out, '{"system":"NEW","a":1}');
  });
});
