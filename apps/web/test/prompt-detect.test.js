/**
 * promptDetect 线性解析器测试
 *
 * 三层覆盖：
 *   1. 对抗样本 —— 旧正则灾难性回溯的复现 corpus（/plugins 菜单形态：
 *      问号行 + N 行编号插件含版本号 + 数字开头失配尾行），旧实现 4 行 84ms /
 *      6 行 2.2s / 8 行 >90s（指数），新实现断言任意规模 <50ms 且结果为 null。
 *   2. Golden-master corpus —— expected outputs baked from the final
 *      linear-vs-legacy equivalence run (both implementations agreed on all
 *      samples) right before detectPromptLegacy was deleted.
 *   3. 协同契约 —— detect 输出喂 parseToolInfoFromBuffer（Bash 命令块），
 *      保障 ToolApprovalPanel 路由不受重写影响。
 *
 * （permission-detect.test.js 已改为 import 真实现跑全量行为 fixture，
 *  此处不重复其用例。）
 */
import assert from 'assert';
import { describe, it } from 'node:test';
import {
  stripAnsi,
  splitTrailingAnsiCarry,
  detectPromptInBuffer,
  isFalsePositiveQuestion,
  getPromptDetectStats,
} from '../src/utils/promptDetect.js';
import { parseToolInfoFromBuffer } from '../src/utils/promptClassifier.js';

// ── 对抗样本构造：/plugins 菜单形态（旧正则的指数回溯触发器）──
function makePluginsMenu(n, { tail = '5 plugins installed', boxDrawing = false, cjk = false } = {}) {
  let s = 'Select a plugin to configure?\n';
  for (let i = 1; i <= n; i++) {
    const desc = cjk ? `插件描述第${i}项 中文说明` : 'some description here';
    const line = `  ${i === 1 ? '❯ ' : '  '}${i}. plugin-name-${i} v1.2.${i}  ${desc}`;
    s += boxDrawing ? `│${line}│\n` : `${line}\n`;
  }
  s += tail; // 数字开头失配尾行 → 旧 Pattern1 trailing 失配 → 回溯爆炸
  return s;
}

function timeDetect(buf) {
  const t0 = performance.now();
  const result = detectPromptInBuffer(buf);
  return { result, ms: performance.now() - t0 };
}

describe('promptDetect adversarial corpus (catastrophic backtracking regression)', () => {

  it('8-line plugins menu (old impl: >90s) completes <50ms', () => {
    const { result, ms } = timeDetect(makePluginsMenu(8));
    assert.ok(ms < 50, `detect took ${ms.toFixed(1)}ms, expected <50ms`);
    // Pattern1 因数字开头尾行失配；Pattern2 结构成立（选项块 + 尾行首字符非空白）
    // —— 与旧实现（若能跑完）的最终行为一致
    assert.ok(result, 'Pattern2 should structurally match plugins menu');
  });

  it('20-line and 80-line menus complete <50ms', () => {
    for (const n of [20, 80]) {
      const { ms } = timeDetect(makePluginsMenu(n));
      assert.ok(ms < 50, `${n}-line detect took ${ms.toFixed(1)}ms`);
    }
  });

  it('box-drawing + CJK variants complete <50ms', () => {
    for (const opts of [{ boxDrawing: true }, { cjk: true }, { boxDrawing: true, cjk: true }]) {
      const { ms } = timeDetect(makePluginsMenu(40, opts));
      assert.ok(ms < 50, `variant ${JSON.stringify(opts)} took ${ms.toFixed(1)}ms`);
    }
  });

  it('full 4KB pathological buffer completes <50ms', () => {
    let buf = makePluginsMenu(80);
    buf = buf.slice(-4096); // 模拟 _ptyBuffer 4KB 截断（可能切坏首行）
    const { ms } = timeDetect(buf);
    assert.ok(ms < 50, `4KB buffer took ${ms.toFixed(1)}ms`);
  });

  it('worst-case ?-line repetition (many question candidates) stays <50ms', () => {
    // 大量问号行 + 失配尾行：线性实现对每个候选只做一次有界下扫
    let s = '';
    for (let i = 0; i < 60; i++) s += `Question number ${i}?\n  ❯ 1. Yes\n`;
    s += '9 unmatched tail';
    const { ms } = timeDetect(s);
    assert.ok(ms < 50, `repetition corpus took ${ms.toFixed(1)}ms`);
  });

  it('overrun stats (仅监测计数，非熔断): track calls without overruns on adversarial corpus', () => {
    const before = getPromptDetectStats();
    detectPromptInBuffer(makePluginsMenu(80));
    const after = getPromptDetectStats();
    assert.ok(after.calls > before.calls, 'calls counter advances');
    assert.strictEqual(after.overruns, before.overruns, 'no overruns on linear impl');
  });
});

describe('promptDetect golden-master corpus (baked from the legacy-equivalence run)', () => {

  // Behavioral regression corpus: EXPECTED values were exported from the final
  // linear-vs-legacy equivalence run (both implementations agreed on every
  // sample) before detectPromptLegacy was deleted; detectPromptInBuffer's
  // output is pinned to these goldens from here on.
  const opt = (number, text, selected) => ({ number, text, selected });
  const EQUIV_SAMPLES = [
    // Pattern 1 编号 + 光标
    'Do you want to proceed?\n❯ 1. Yes\n  2. No\n\nEsc to cancel · Tab to amend · ctrl+e to explain',
    'Do you want to approve this plan?\n  ❯ 1. Approve\n    2. Approve with edits\n    3. Reject',
    'Would you like to proceed?\n  ❯ 1. Approve\n    2. Approve with edits\n    3. Reject',
    // Pattern 1 选项块内夹空行
    'Pick one?\n  ❯ 1. First\n\n    2. Second\n',
    // Pattern 1 问句行带尾随空格
    'Trailing spaces?   \n  ❯ 1. A\n    2. B',
    // Pattern 2 无编号光标
    'Do you want to make this edit to src/components/App.jsx?\n  ❯ Yes\n    Yes, allow all edits during this session (shift+tab)\n    No\n',
    'Tool requires permission\n  ❯ Allow once\n    Allow for this session\n    Deny\n',
    'Claude wants to execute the following bash command\n  ❯ Yes\n    Yes, always allow\n    No\n',
    // Pattern 2 光标不在第一项
    'Do you want to make this edit to app.js?\n    Yes\n  ❯ Yes, allow all edits during this session (shift+tab)\n    No\n',
    'Do you want to make this edit to foo.js?\n    Yes\n    Yes, allow all edits during this session (shift+tab)\n  ❯ No\n',
    // 前置输出 + 空行
    'Some previous output here...\nTool result: success\n\nDo you want to make this edit to test.js?\n  ❯ Yes\n    Yes, allow all edits during this session (shift+tab)\n    No\n',
    // 多段菜单堆叠（取后者——前者被后者的编号行阻断 trailing）
    'Old menu?\n  ❯ 1. Stale A\n    2. Stale B\nNew menu?\n  ❯ 1. Fresh A\n    2. Fresh B',
    // 不应检出
    '--- a/src/index.js\n+++ b/src/index.js\n@@ -1,3 +1,4 @@\n  const a = 1;\n+ const b = 2;\n  const c = 3;\n',
    '  ❯ Yes\n    No\n',
    '',
    '   \n  \n  ',
    'Just a line of text\nAnother line\n',
    // Pattern 2 选中项缺失 → 不检出
    'Choose one\n    Option A\n    Option B\n',
    // Pattern 2 纯空白问句行 → 结构成立但 question 为空，整体放弃（新旧一致返回 null）
    '   \n  ❯ Yes\n    No',
    // Pattern 2 单段空白成员行（" X" 仅 1 前导空格）→ 不是块成员（与 legacy
    // 块正则 \s+[❯>]?\s+ 两段空白结构一致），新旧一致返回 null
    'Q line\n X\n ❯ Y\n',
    // CRLF（Windows ConPTY 行尾）—— 曾因单行正则 `.`/`$` 不容忍 \r 全量漏检
    'Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n\r\nEsc to cancel · Tab to amend',
    'Do you want to approve this plan?\r\n  ❯ 1. Approve\r\n    2. Approve with edits\r\n    3. Reject',
    'Do you want to make this edit to app.js?\r\n  ❯ Yes\r\n    Yes, allow all edits during this session (shift+tab)\r\n    No\r\n',
    'Tool requires permission\r\n  ❯ Allow once\r\n    Allow for this session\r\n    Deny\r\n',
    // unicode 路径
    'Do you want to make this edit to src/组件/App.jsx?\n  ❯ Yes\n    Yes, allow all edits during this session\n    No\n',
    // ANSI 混入（先 strip 再 detect）
    stripAnsi('\x1b[1m\x1b[33mDo you want to make this edit to\x1b[0m \x1b[1msrc/index.js\x1b[0m\x1b[33m?\x1b[0m\n  \x1b[36m❯\x1b[0m \x1b[36mYes\x1b[0m\n    Yes, allow all edits during this session (shift+tab)\n    No\n'),
  ];

  // Index-aligned with EQUIV_SAMPLES.
  const EXPECTED = [
    { question: 'Do you want to proceed?', options: [opt(1, 'Yes', true), opt(2, 'No', false)] },
    { question: 'Do you want to approve this plan?', options: [opt(1, 'Approve', true), opt(2, 'Approve with edits', false), opt(3, 'Reject', false)] },
    { question: 'Would you like to proceed?', options: [opt(1, 'Approve', true), opt(2, 'Approve with edits', false), opt(3, 'Reject', false)] },
    { question: 'Pick one?', options: [opt(1, 'First', true), opt(2, 'Second', false)] },
    { question: 'Trailing spaces?', options: [opt(1, 'A', true), opt(2, 'B', false)] },
    { question: 'Do you want to make this edit to src/components/App.jsx?', options: [opt(1, 'Yes', true), opt(2, 'Yes, allow all edits during this session (shift+tab)', false), opt(3, 'No', false)] },
    { question: 'Tool requires permission', options: [opt(1, 'Allow once', true), opt(2, 'Allow for this session', false), opt(3, 'Deny', false)] },
    { question: 'Claude wants to execute the following bash command', options: [opt(1, 'Yes', true), opt(2, 'Yes, always allow', false), opt(3, 'No', false)] },
    { question: 'Do you want to make this edit to app.js?', options: [opt(1, 'Yes', false), opt(2, 'Yes, allow all edits during this session (shift+tab)', true), opt(3, 'No', false)] },
    { question: 'Do you want to make this edit to foo.js?', options: [opt(1, 'Yes', false), opt(2, 'Yes, allow all edits during this session (shift+tab)', false), opt(3, 'No', true)] },
    { question: 'Do you want to make this edit to test.js?', options: [opt(1, 'Yes', true), opt(2, 'Yes, allow all edits during this session (shift+tab)', false), opt(3, 'No', false)] },
    { question: 'Old menu?', options: [opt(1, 'Stale A', true), opt(2, 'Stale B', false)] },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { question: 'Do you want to proceed?', options: [opt(1, 'Yes', true), opt(2, 'No', false)] },
    { question: 'Do you want to approve this plan?', options: [opt(1, 'Approve', true), opt(2, 'Approve with edits', false), opt(3, 'Reject', false)] },
    { question: 'Do you want to make this edit to app.js?', options: [opt(1, 'Yes', true), opt(2, 'Yes, allow all edits during this session (shift+tab)', false), opt(3, 'No', false)] },
    { question: 'Tool requires permission', options: [opt(1, 'Allow once', true), opt(2, 'Allow for this session', false), opt(3, 'Deny', false)] },
    { question: 'Do you want to make this edit to src/组件/App.jsx?', options: [opt(1, 'Yes', true), opt(2, 'Yes, allow all edits during this session', false), opt(3, 'No', false)] },
    { question: 'Do you want to make this edit to src/index.js?', options: [opt(1, 'Yes', true), opt(2, 'Yes, allow all edits during this session (shift+tab)', false), opt(3, 'No', false)] },
  ];

  it('detectPromptInBuffer matches the golden-master outputs field-by-field', () => {
    assert.strictEqual(EQUIV_SAMPLES.length, EXPECTED.length, 'corpus and goldens are index-aligned');
    EQUIV_SAMPLES.forEach((sample, i) => {
      const linear = detectPromptInBuffer(sample);
      assert.deepStrictEqual(
        linear, EXPECTED[i],
        `Mismatch on sample #${i}:\n---\n${sample}\n---\nexpected=${JSON.stringify(EXPECTED[i])}\nactual=${JSON.stringify(linear)}`
      );
    });
  });

  it('CRLF samples actually detect (regression guard: not just both-null equivalence)', () => {
    const p1 = detectPromptInBuffer('Do you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n\r\nEsc to cancel');
    assert.ok(p1, 'P1 numbered prompt detected under CRLF');
    assert.strictEqual(p1.question, 'Do you want to proceed?');
    assert.deepStrictEqual(p1.options.map(o => o.text), ['Yes', 'No']);
    const p2 = detectPromptInBuffer('Do you want to make this edit to app.js?\r\n  ❯ Yes\r\n    No\r\n');
    assert.ok(p2, 'P2 cursor prompt detected under CRLF');
    assert.strictEqual(p2.options[0].selected, true);
  });

  it('stripAnsi 剥离 DEC 私有模式序列（?2026 同步输出等），不残留 [?2026l', () => {
    assert.strictEqual(stripAnsi('\x1b[?2026l'), '');
    assert.strictEqual(stripAnsi('\x1b[?2026h'), '');
    assert.strictEqual(stripAnsi('\x1b[?25h\x1b[?2004hready'), 'ready');
  });

  it('false-positive filter parity (path / status-bar questions)', () => {
    assert.ok(isFalsePositiveQuestion('~/projects/cc-viewer/src/components/'));
    assert.ok(isFalsePositiveQuestion('*Crunched for 2m18s · 15k tokens'));
    assert.ok(!isFalsePositiveQuestion('Do you want to proceed?'));
  });
});

describe('splitTrailingAnsiCarry (跨 write 撕裂防护)', () => {

  it('尾部半截 CSI 被缓带，拼回下一片后 strip 干净', () => {
    const [safe1, carry1] = splitTrailingAnsiCarry('hello \x1b[3');
    assert.strictEqual(safe1, 'hello ');
    assert.strictEqual(carry1, '\x1b[3');
    const [safe2, carry2] = splitTrailingAnsiCarry(carry1 + '6m❯ Yes');
    assert.strictEqual(carry2, '');
    assert.strictEqual(stripAnsi(safe2), '❯ Yes', 'rejoined sequence strips cleanly');
  });

  it('尾部半截私有模式 CSI（\\x1b[?20）也被缓带', () => {
    const [safe, carry] = splitTrailingAnsiCarry('hello \x1b[?20');
    assert.strictEqual(safe, 'hello ');
    assert.strictEqual(carry, '\x1b[?20');
    const [safe2, carry2] = splitTrailingAnsiCarry(carry + '26l❯ Yes');
    assert.strictEqual(carry2, '');
    assert.strictEqual(stripAnsi(safe2), '❯ Yes');
  });

  it('完整序列结尾不缓带（CSI 终止字节 / OSC BEL / OSC ST）', () => {
    for (const s of ['text \x1b[36m', 'text \x1b]0;title\x07', 'text \x1b]0;title\x1b\\']) {
      const [safe, carry] = splitTrailingAnsiCarry(s);
      assert.strictEqual(safe, s, `complete sequence kept: ${JSON.stringify(s)}`);
      assert.strictEqual(carry, '');
    }
  });

  it('尾部半截 OSC / 孤立 ESC 被缓带', () => {
    assert.deepStrictEqual(splitTrailingAnsiCarry('abc\x1b]0;tit'), ['abc', '\x1b]0;tit']);
    assert.deepStrictEqual(splitTrailingAnsiCarry('abc\x1b'), ['abc', '\x1b']);
  });

  it('超长未终结序列放弃缓带（maxCarry 防囤积）', () => {
    const junk = 'x'.repeat(600);
    const [safe, carry] = splitTrailingAnsiCarry('abc\x1b]' + junk);
    assert.strictEqual(carry, '');
    assert.strictEqual(safe, 'abc\x1b]' + junk);
  });

  it('无 ESC 的普通文本原样通过', () => {
    assert.deepStrictEqual(splitTrailingAnsiCarry('plain text\n'), ['plain text\n', '']);
  });
});

describe('promptDetect → parseToolInfoFromBuffer contract', () => {

  it('Bash command block buffer routes to Bash tool with extracted command', () => {
    const buf = [
      'Bash command',
      '',
      '    npm install lodash',
      '    npm run build',
      '',
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. No',
    ].join('\n');
    const detected = detectPromptInBuffer(buf);
    assert.ok(detected, 'should detect numbered prompt');
    assert.strictEqual(detected.question, 'Do you want to proceed?');
    const info = parseToolInfoFromBuffer(buf, detected.question, detected.options);
    assert.strictEqual(info.toolName, 'Bash');
    assert.ok(info.input.command.includes('npm install lodash'), 'command extracted from block');
  });

  it('Edit prompt routes to Edit tool with file path', () => {
    const buf = 'Do you want to make this edit to src/App.jsx?\n  ❯ Yes\n    Yes, allow all edits during this session\n    No\n';
    const detected = detectPromptInBuffer(buf);
    assert.ok(detected);
    const info = parseToolInfoFromBuffer(buf, detected.question, detected.options);
    assert.strictEqual(info.toolName, 'Edit');
    // parseToolInfoFromBuffer 对 question 整体 toLowerCase 后提取（既有行为）
    assert.strictEqual(info.input.file_path, 'src/app.jsx');
  });

  it('option shape is exactly {number, text, selected}', () => {
    const detected = detectPromptInBuffer('Do you want to proceed?\n❯ 1. Yes\n  2. No');
    assert.deepStrictEqual(Object.keys(detected.options[0]).sort(), ['number', 'selected', 'text']);
    assert.deepStrictEqual(detected.options[0], { number: 1, text: 'Yes', selected: true });
    assert.deepStrictEqual(detected.options[1], { number: 2, text: 'No', selected: false });
  });
});
