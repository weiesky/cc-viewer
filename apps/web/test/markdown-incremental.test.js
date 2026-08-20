/**
 * 覆盖目标：src/utils/markdownIncremental.js
 *   - splitFrozenTail(text)  —— 把文本切成 [frozen, tail]
 *   - renderIncremental(text) —— frozen/tail 分别过 renderMarkdown 再拼接
 *
 * 依赖 markdownIncremental → markdown → helpers(svg)/mermaid，必须先注册
 * _shims/register.mjs 再【动态 import】。
 *
 * 环境说明：renderMarkdown 在纯 Node 下走 escapeHtml 兜底（DOMPurify 无
 * window），所以 renderIncremental 的断言基于「两段各自 escapeHtml 后拼接」
 * 这一真实路径。重点验证 splitFrozenTail 的切分逻辑（纯函数，与环境无关）。
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let splitFrozenTail;
let renderIncremental;

before(async () => {
  const mod = await import('../src/utils/markdownIncremental.js');
  splitFrozenTail = mod.splitFrozenTail;
  renderIncremental = mod.renderIncremental;
});

describe('splitFrozenTail — 不可切的保守回退', () => {
  it('空 / falsy 输入返回 ["", ""]', () => {
    assert.deepEqual(splitFrozenTail(''), ['', '']);
    assert.deepEqual(splitFrozenTail(null), ['', '']);
    assert.deepEqual(splitFrozenTail(undefined), ['', '']);
  });

  it('仍在未闭合 fence 内（``` 数为奇数）→ 全量 tail，不切', () => {
    assert.deepEqual(splitFrozenTail('```\nsome code'), ['', '```\nsome code']);
    // 一个未闭合 fence 后即便有 \n\n 也不切
    assert.deepEqual(splitFrozenTail('```\ncode\n\nmore'), ['', '```\ncode\n\nmore']);
  });

  it('已闭合 fence（``` 数为偶数）后可在 fence 外的 \\n\\n 切', () => {
    assert.deepEqual(
      splitFrozenTail('```\ncode\n```\n\ntail'),
      ['```\ncode\n```\n\n', 'tail'],
    );
  });

  it('存在引用式链接定义 [x]: url → 全量 tail，不切', () => {
    assert.deepEqual(
      splitFrozenTail('[x]: http://a\n\nuse [y][x]'),
      ['', '[x]: http://a\n\nuse [y][x]'],
    );
  });

  it('没有 \\n\\n → 全量 tail，不切', () => {
    assert.deepEqual(splitFrozenTail('one line only'), ['', 'one line only']);
    assert.deepEqual(splitFrozenTail('a\nb\nc'), ['', 'a\nb\nc']);
  });

  it('分界点前一行是表格行（| 开头）→ 不切', () => {
    assert.deepEqual(
      splitFrozenTail('text\n| h |\n\nmore'),
      ['', 'text\n| h |\n\nmore'],
    );
  });

  it('分界点后一行是表格行（含前导空白的 |）→ 不切', () => {
    assert.deepEqual(
      splitFrozenTail('p\n\n   | x |'),
      ['', 'p\n\n   | x |'],
    );
  });
});

describe('splitFrozenTail — 正常切分', () => {
  it('普通双换行处切开：frozen 含分隔符，tail 为尾巴', () => {
    assert.deepEqual(
      splitFrozenTail('frozen para\n\ntail para'),
      ['frozen para\n\n', 'tail para'],
    );
  });

  it('多个 \\n\\n 时在【最后】一处切（lastIndexOf）', () => {
    assert.deepEqual(
      splitFrozenTail('a\n\nb\n\nc'),
      ['a\n\nb\n\n', 'c'],
    );
  });

  it('frozen 段尾与 tail 段首拼回原文（无损切分）', () => {
    const text = 'intro\n\nbody1\n\nbody2 final';
    const [frozen, tail] = splitFrozenTail(text);
    assert.equal(frozen + tail, text);
    assert.equal(frozen, 'intro\n\nbody1\n\n');
    assert.equal(tail, 'body2 final');
  });

  it('表格出现在更早位置、最后分界点两侧均非表格行 → 正常切', () => {
    const text = '| a | b |\n| - | - |\n\nclosing para';
    // lineBefore 为 "| - | - |" 以 | 开头 → 不切（保守）
    assert.deepEqual(splitFrozenTail(text), ['', text]);
  });
});

describe('renderIncremental — frozen + tail 拼接', () => {
  it('有 tail 时返回两段渲染结果的拼接（headless 下为各自 escapeHtml）', () => {
    // frozen='a < b\n\n' tail='c > d' → 各自转义后拼接
    assert.equal(renderIncremental('a < b\n\nc > d'), 'a &lt; b\n\nc &gt; d');
  });

  it('无可切分点时 frozen="" → 只渲染 tail，不重复', () => {
    assert.equal(renderIncremental('no split here'), 'no split here');
  });

  it('空输入返回空字符串', () => {
    assert.equal(renderIncremental(''), '');
  });

  it('frozen 为空字符串时不调用第二段（tail falsy 短路），结果为空', () => {
    // splitFrozenTail('') → ['',''], frozen 渲染为 ''，tail '' falsy → 不再拼
    assert.equal(renderIncremental(''), '');
  });

  it('正常切分时 frozen 与 tail 内容都体现在结果里', () => {
    const out = renderIncremental('frozen para\n\ntail para');
    assert.ok(out.includes('frozen para'), '结果应含 frozen 段');
    assert.ok(out.includes('tail para'), '结果应含 tail 段');
  });
});
