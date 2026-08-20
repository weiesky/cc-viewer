import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomTemplate, buildLocalUltraplan, ULTRAPLAN_VARIANTS } from '../src/utils/ultraplanTemplates.js';
import { t } from '../src/i18n.js';

describe('ultraplanTemplates: buildCustomTemplate', () => {
  it('returns empty string for empty body', () => {
    assert.equal(buildCustomTemplate(''), '');
  });

  it('returns empty string for whitespace-only body', () => {
    assert.equal(buildCustomTemplate('   \n\t  '), '');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(buildCustomTemplate(null), '');
    assert.equal(buildCustomTemplate(undefined), '');
  });

  it('wraps body in <system-reminder> with [SCOPED INSTRUCTION] preamble', () => {
    const out = buildCustomTemplate('You are a reviewer.');
    assert.ok(out.startsWith('<system-reminder>'), `missing opening tag: ${out.slice(0, 40)}`);
    assert.ok(out.endsWith('</system-reminder>'), `missing closing tag: ${out.slice(-40)}`);
    assert.ok(out.includes('[SCOPED INSTRUCTION]'), 'missing preamble');
    assert.ok(out.includes('You are a reviewer.'), 'body content missing');
  });

  it('trims surrounding whitespace from body', () => {
    const out = buildCustomTemplate('  hello  \n');
    assert.ok(out.includes('hello'));
    assert.ok(!out.includes('  hello  '));
  });

  it('is idempotent: body already wrapped in <system-reminder> is returned as-is (no double wrap)', () => {
    const pre = '<system-reminder>\n[SCOPED INSTRUCTION] x\n\nmy body\n</system-reminder>';
    const out = buildCustomTemplate(pre);
    assert.equal(out, pre);
    // exactly one wrapper, not two
    assert.equal(out.match(/<system-reminder>/g).length, 1);
    assert.equal(out.match(/<\/system-reminder>/g).length, 1);
  });

  it('still wraps a bare body that merely mentions the literal tag in prose', () => {
    const out = buildCustomTemplate('Do not write a <system-reminder> tag yourself.');
    assert.ok(out.startsWith('<system-reminder>'), 'should auto-wrap (startsWith guard, not includes)');
    assert.ok(out.includes('[SCOPED INSTRUCTION]'), 'scope preamble must be injected');
  });

  // 护栏:预填壳(i18n)与 buildCustomTemplate 的外壳前导段是两份独立字符串字面量,
  // 必须逐字节一致——否则编辑壳内正文发送时会静默双包或发出过期前导段,且无测试报错。
  it('i18n prefill skeleton stays byte-identical to the wrapper preamble (no silent divergence/double-wrap)', () => {
    const prefill = t('ui.ultraplan.customContentTemplate'); // 仅 en,t() 回落 en
    assert.ok(prefill.startsWith('<system-reminder>'), 'prefill must be a wrapper shell');

    // [SCOPED INSTRUCTION] 前导行须与 buildCustomTemplate 产出的逐字节相同
    assert.equal(prefill.split('\n')[1], buildCustomTemplate('X').split('\n')[1]);

    // 用户在预填壳内补正文后发送:幂等,只剩一层外壳、一处 [SCOPED INSTRUCTION]
    const edited = prefill.replace('\n\n</system-reminder>', '\n\nYou are an auditor.\n</system-reminder>');
    const out = buildCustomTemplate(edited);
    assert.equal(out, edited, 'pre-wrapped body must be returned as-is');
    assert.equal(out.match(/<system-reminder>/g).length, 1);
    assert.equal(out.match(/\[SCOPED INSTRUCTION\]/g).length, 1);
  });
});

describe('ultraplanTemplates: buildLocalUltraplan', () => {
  it('uses codeExpert template by default', () => {
    const out = buildLocalUltraplan('build feature X');
    assert.ok(out.includes(ULTRAPLAN_VARIANTS.codeExpert));
    assert.ok(out.endsWith('build feature X'));
  });

  it('uses researchExpert template when variant is researchExpert', () => {
    const out = buildLocalUltraplan('research Y', 'researchExpert');
    assert.ok(out.includes(ULTRAPLAN_VARIANTS.researchExpert));
  });

  it('falls back to codeExpert for unknown variant (non-custom)', () => {
    const out = buildLocalUltraplan('task', 'unknownVariant');
    assert.ok(out.includes(ULTRAPLAN_VARIANTS.codeExpert));
  });

  it('returns empty string for variant=custom with empty content', () => {
    assert.equal(buildLocalUltraplan('task', 'custom', undefined, ''), '');
    assert.equal(buildLocalUltraplan('task', 'custom', undefined, '   '), '');
    assert.equal(buildLocalUltraplan('task', 'custom', undefined, undefined), '');
  });

  it('assembles custom variant with wrapped template + user prompt', () => {
    const out = buildLocalUltraplan('ship it', 'custom', undefined, 'You are an auditor.');
    assert.ok(out.includes('<system-reminder>'), 'wrapper missing');
    assert.ok(out.includes('You are an auditor.'), 'custom body missing');
    assert.ok(out.includes('[SCOPED INSTRUCTION]'), 'preamble missing');
    assert.ok(out.endsWith('ship it'), 'user prompt should be appended last');
  });

  it('supports optional seedPlan prefix', () => {
    const out = buildLocalUltraplan('task', 'codeExpert', 'DRAFT PLAN');
    assert.ok(out.startsWith('Here is a draft plan to refine:'));
    assert.ok(out.includes('DRAFT PLAN'));
    assert.ok(out.includes(ULTRAPLAN_VARIANTS.codeExpert));
  });

  it('assembles custom variant with seedPlan', () => {
    const out = buildLocalUltraplan('task', 'custom', 'DRAFT', 'auditor role');
    assert.ok(out.startsWith('Here is a draft plan to refine:'));
    assert.ok(out.includes('DRAFT'));
    assert.ok(out.includes('auditor role'));
    assert.ok(out.endsWith('task'));
  });
});
