/**
 * Unit tests for UltraPlan input detection.
 *
 * 覆盖：
 *   isUltraplanText(text)            —— <system-reminder>[SCOPED INSTRUCTION] marker 识别
 *   classifyUserContent(...).ultraplan —— 消息级 UltraPlan 标志 + 用户正文仍被正常剥离
 *
 * 输入取自真实产出源 src/utils/ultraplanTemplates.js（buildLocalUltraplan / buildCustomTemplate），
 * 避免测试与实现里的 marker 文案漂移。contentFilter 带无扩展名 import（Vite 约定），
 * 必须先注册 _shims loader 再动态 import（与 content-filter-unit.test.js 同款）。
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let CF;
let TPL;
before(async () => {
  CF = await import('../packages/core/src/contentFilter.js');
  TPL = await import('../apps/web/src/utils/ultraplanTemplates.js');
});

describe('isUltraplanText', () => {
  it('true for codeExpert / researchExpert assembled prompts', () => {
    assert.equal(CF.isUltraplanText(TPL.buildLocalUltraplan('do X', 'codeExpert')), true);
    assert.equal(CF.isUltraplanText(TPL.buildLocalUltraplan('do X', 'researchExpert')), true);
  });

  it('true for a custom template body (wrapped with the scoped preamble)', () => {
    assert.equal(CF.isUltraplanText(TPL.buildLocalUltraplan('hi', 'custom', undefined, 'my body')), true);
    assert.equal(CF.isUltraplanText(TPL.buildCustomTemplate('my body')), true);
  });

  it('false for plain prompts, empty, and non-string', () => {
    assert.equal(CF.isUltraplanText('just a normal message'), false);
    assert.equal(CF.isUltraplanText(''), false);
    assert.equal(CF.isUltraplanText(null), false);
    assert.equal(CF.isUltraplanText(undefined), false);
    assert.equal(CF.isUltraplanText(42), false);
  });

  it('false when the phrase appears outside a <system-reminder> (prose mention)', () => {
    assert.equal(CF.isUltraplanText('I was reading about [SCOPED INSTRUCTION] earlier'), false);
  });

  it('true for a seedPlan-prefixed prompt (marker mid-string, not at start)', () => {
    const seeded = TPL.buildLocalUltraplan('do X', 'codeExpert', 'here is a draft plan');
    assert.ok(!seeded.startsWith('<system-reminder>')); // seedPlan text comes first
    assert.equal(CF.isUltraplanText(seeded), true);
  });

  it('false when the phrase trails an unrelated, already-closed <system-reminder>', () => {
    // A benign reminder (e.g. injected context) followed later by prose mentioning the phrase
    // must not match — the marker must live inside the same reminder block.
    const t = '<system-reminder>Today is 2026-07-17</system-reminder>\n\nplease follow [SCOPED INSTRUCTION] style';
    assert.equal(CF.isUltraplanText(t), false);
  });
});

describe('classifyUserContent ultraplan flag', () => {
  it('marks an UltraPlan message and still strips the reminder from the bubble text', () => {
    const assembled = TPL.buildLocalUltraplan('please add a button', 'codeExpert');
    const { ultraplan, textBlocks } = CF.classifyUserContent([{ type: 'text', text: assembled }]);
    assert.equal(ultraplan, true);
    // 用户正文被回收、system-reminder 被剥离
    assert.equal(textBlocks.length, 1);
    assert.equal(textBlocks[0].text, 'please add a button');
    assert.ok(!/SCOPED INSTRUCTION/.test(textBlocks[0].text));
  });

  it('ultraplan=false for an ordinary user message', () => {
    const { ultraplan, textBlocks } = CF.classifyUserContent([{ type: 'text', text: 'hello world' }]);
    assert.equal(ultraplan, false);
    assert.equal(textBlocks[0].text, 'hello world');
  });

  it('ultraplan=true when the marker block is not the first text block (.some scan)', () => {
    const assembled = TPL.buildLocalUltraplan('add a spinner', 'researchExpert');
    const { ultraplan } = CF.classifyUserContent([
      { type: 'text', text: 'some earlier note' },
      { type: 'text', text: assembled },
    ]);
    assert.equal(ultraplan, true);
  });
});
