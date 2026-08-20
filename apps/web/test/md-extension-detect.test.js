/**
 * 覆盖目标：src/utils/mdExtensionDetect.js —— detectMdExtensions(markdown)
 *
 * 该模块无外部 import（regex 全部内联），可直接静态 import，无需 shim loader。
 * 检测 markdown 是否含 MDXEditor 默认不支持的扩展语法：
 *   hasMermaid / hasKatex（块级 $$、math/latex/tex/katex fence、行内 $...$）
 *   hasDirective（行首 :::name）/ anyExtension（任一为真）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectMdExtensions } from '../src/utils/mdExtensionDetect.js';

const NONE = {
  hasMermaid: false,
  hasKatex: false,
  hasDirective: false,
  anyExtension: false,
};

describe('detectMdExtensions — 非字符串 / 空输入', () => {
  it('非字符串入参返回全 false', () => {
    assert.deepEqual(detectMdExtensions(123), NONE);
    assert.deepEqual(detectMdExtensions(null), NONE);
    assert.deepEqual(detectMdExtensions(undefined), NONE);
    assert.deepEqual(detectMdExtensions({}), NONE);
    assert.deepEqual(detectMdExtensions(['a']), NONE);
  });

  it('空字符串返回全 false', () => {
    assert.deepEqual(detectMdExtensions(''), NONE);
  });

  it('纯标准 markdown 文本返回全 false', () => {
    assert.deepEqual(detectMdExtensions('# Title\n\nplain paragraph with text.'), NONE);
  });
});

describe('detectMdExtensions — Mermaid', () => {
  it('```mermaid 围栏命中 hasMermaid', () => {
    const r = detectMdExtensions('```mermaid\ngraph TD\nA-->B\n```');
    assert.equal(r.hasMermaid, true);
    assert.equal(r.anyExtension, true);
  });

  it('mermaid 围栏前可有缩进空白/Tab', () => {
    assert.equal(detectMdExtensions('   ```mermaid\nx\n```').hasMermaid, true);
    assert.equal(detectMdExtensions('\t```mermaid\nx\n```').hasMermaid, true);
  });

  it('``` 后大小写的 mermaid 区分大小写（RE 无 i 标志）—— 大写不命中', () => {
    // RE_MERMAID_FENCE 无 i 标志，"Mermaid" 不命中
    assert.equal(detectMdExtensions('```Mermaid\nx\n```').hasMermaid, false);
  });

  it('文中提到 mermaid 但非行首围栏 → 不命中', () => {
    assert.equal(detectMdExtensions('we use mermaid for diagrams').hasMermaid, false);
  });
});

describe('detectMdExtensions — KaTeX / 数学', () => {
  it('块级 $$...$$ 命中 hasKatex', () => {
    const r = detectMdExtensions('formula: $$E=mc^2$$ end');
    assert.equal(r.hasKatex, true);
    assert.equal(r.anyExtension, true);
  });

  it('跨行块级 $$ ... $$ 也命中', () => {
    assert.equal(detectMdExtensions('$$\n\\int x\\,dx\n$$').hasKatex, true);
  });

  it('math / latex / tex / katex 围栏（大小写不敏感）命中', () => {
    assert.equal(detectMdExtensions('```math\nx+y\n```').hasKatex, true);
    assert.equal(detectMdExtensions('```LaTeX\nx\n```').hasKatex, true);
    assert.equal(detectMdExtensions('```TEX\nx\n```').hasKatex, true);
    assert.equal(detectMdExtensions('```katex\nx\n```').hasKatex, true);
  });

  it('合法行内数学 $a+b$ 命中（含数学字符）', () => {
    const r = detectMdExtensions('the value $a+b$ here');
    assert.equal(r.hasKatex, true);
    assert.equal(r.anyExtension, true);
  });

  it('代码围栏内的 $...$ 被剥除，不误判（stripFences 生效）', () => {
    assert.equal(detectMdExtensions('```\nlet a=$x+y$\n```').hasKatex, false);
  });

  it('纯货币 $12.5$（开 $ 后接数字）被排除，不命中', () => {
    assert.equal(detectMdExtensions('costs $12.5$ ok').hasKatex, false);
  });

  it('闭合 $ 后紧跟数字（如 $a$5）被排除，不命中', () => {
    assert.equal(detectMdExtensions('$a$5 tail').hasKatex, false);
  });

  it('行内匹配命中但内容无数学字符（纯标点）→ 二次校验失败，不命中', () => {
    // 命中 RE_INLINE_MATH 但 group1 不含 [a-zA-Z 运算符 括号]，故 hasKatex 保持 false
    assert.equal(detectMdExtensions('a $.,;: ...,;:.$ b').hasKatex, false);
  });
});

describe('detectMdExtensions — Directive', () => {
  it('行首 :::name 命中 hasDirective', () => {
    const r = detectMdExtensions(':::note\ncontent\n:::');
    assert.equal(r.hasDirective, true);
    assert.equal(r.anyExtension, true);
  });

  it('带连字符的指令名（:::my-block）命中', () => {
    assert.equal(detectMdExtensions(':::my-block\nx').hasDirective, true);
  });

  it('指令前可有缩进', () => {
    assert.equal(detectMdExtensions('  :::warning\nx').hasDirective, true);
  });

  it('行中间出现的 ::: 不命中（必须行首 + 字母开头）', () => {
    assert.equal(detectMdExtensions('text ::: note').hasDirective, false);
    // ::: 后非字母也不命中
    assert.equal(detectMdExtensions(':::123\nx').hasDirective, false);
  });
});

describe('detectMdExtensions — anyExtension 聚合与组合', () => {
  it('mermaid + 数学 + 指令同时存在时三者皆 true', () => {
    const md = '```mermaid\ng\n```\n\n$$x$$\n\n:::note\nhi\n:::';
    const r = detectMdExtensions(md);
    assert.equal(r.hasMermaid, true);
    assert.equal(r.hasKatex, true);
    assert.equal(r.hasDirective, true);
    assert.equal(r.anyExtension, true);
  });

  it('只命中指令时 anyExtension 为 true，其余子项 false', () => {
    const r = detectMdExtensions(':::tip\nx\n:::');
    assert.deepEqual(r, {
      hasMermaid: false,
      hasKatex: false,
      hasDirective: true,
      anyExtension: true,
    });
  });

  it('已由块级 $$ 命中 hasKatex 时，不再走行内检测分支（提前置位）', () => {
    // 同时含 $$...$$ 与货币 $5$；结果 hasKatex=true 由块级提供，
    // anyExtension 为 true。验证组合结果。
    const r = detectMdExtensions('$$a$$ and $5 dollars$');
    assert.equal(r.hasKatex, true);
    assert.equal(r.anyExtension, true);
  });
});

describe('detectMdExtensions — pin 现状：混合货币行内被当作数学', () => {
  it('"$5 and 3$" 被判为 hasKatex=true（注释意图想排除，但组合时仍命中）', () => {
    // 现状行为：开 $ 前是空格不被 lookbehind 排除，group1="5 and 3" 含字母 → 命中。
    // 这与源码注释「排除 $5、3$」的初衷不完全一致，按现状 pin，详见 notes。
    const r = detectMdExtensions('the price $5 and 3$ today');
    assert.equal(r.hasKatex, true);
  });
});
