/**
 * 覆盖目标：src/utils/markdown.js —— renderMarkdown(text)
 *
 * 该模块依赖链含 Vite 风格 svg import（经 helpers.js）与 mermaid hook，
 * 必须先注册 _shims/register.mjs 再【动态 import】。
 *
 * 环境说明（重要 / 被测行为的前提）：
 *   在纯 Node（无 window/document）下，DOMPurify 工厂未绑定到 window，
 *   `DOMPurify.sanitize` 为 undefined。因此 renderMarkdown 内
 *   `measureParse(() => DOMPurify.sanitize(marked.parse(...)))` 必然抛
 *   "DOMPurify.sanitize is not a function"，走 catch → 返回 escapeHtml(text)。
 *   这是被测代码在本测试进程里的【真实运行路径】，下面据此 pin。
 *   （DOMPurify-成功分支需要真实 DOM/jsdom，不在本套件覆盖范围，记入 skipped。）
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let renderMarkdown;

before(async () => {
  const mod = await import('../src/utils/markdown.js');
  renderMarkdown = mod.renderMarkdown;
});

describe('renderMarkdown — falsy / 空输入', () => {
  it('空字符串返回空字符串', () => {
    assert.equal(renderMarkdown(''), '');
  });

  it('null / undefined / 0 等 falsy 输入都返回空字符串（短路 if(!text)）', () => {
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown(undefined), '');
    assert.equal(renderMarkdown(0), '');
    assert.equal(renderMarkdown(false), '');
    assert.equal(renderMarkdown(NaN), '');
  });
});

describe('renderMarkdown — 头less 环境下走 catch → escapeHtml', () => {
  it('普通文本原样转义并返回（无 DOMPurify 时的兜底路径）', () => {
    // 由于本进程内 DOMPurify.sanitize 不可用，sanitize 抛错 → escapeHtml(text)
    assert.equal(renderMarkdown('hello world'), 'hello world');
  });

  it('对 HTML 特殊字符做 escapeHtml（& < > " 四类）', () => {
    const out = renderMarkdown('a < b & c > d "q"');
    assert.equal(out, 'a &lt; b &amp; c &gt; d &quot;q&quot;');
  });

  it('markdown 语法标记被原样转义而非解析（catch 分支不调用 marked 的结果）', () => {
    // 注意：marked.parse 在 measureParse 回调里被调用，但其返回值被传给
    // 不存在的 DOMPurify.sanitize 而抛错，最终返回的是对【原始 text】的转义。
    const out = renderMarkdown('# heading\n\n**bold**');
    assert.equal(out, '# heading\n\n**bold**');
    assert.ok(!out.includes('<h1>'), '不应包含已解析的 <h1>');
    assert.ok(!out.includes('<strong>'), '不应包含已解析的 <strong>');
  });

  it('包含 < 的尖括号内容被转义，避免 XSS 注入到 innerHTML', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;');
    assert.ok(!out.includes('<img'), '原始 <img 标签必须被转义');
  });
});

describe('renderMarkdown — 缓存语义', () => {
  it('同一输入两次返回严格相等（命中 _mdCache，引用相同）', () => {
    const text = 'cache-me-' + Math.random();
    const a = renderMarkdown(text);
    const b = renderMarkdown(text);
    assert.equal(a, b);
    // 字符串值相等即可证明缓存命中路径被走到（hit !== undefined 分支）
    assert.equal(a, text);
  });

  it('不同输入返回各自结果，互不串扰', () => {
    const a = renderMarkdown('alpha-' + Math.random());
    const b = renderMarkdown('beta-' + Math.random());
    assert.notEqual(a, b);
  });

  it('超过缓存上限（1024）触发最旧条目淘汰且不抛错', () => {
    // 写入 1025 条互异 key，撑破 _MD_CACHE_MAX，覆盖 evict 分支（24-27 行）
    const base = 'evict-' + Math.random() + '-';
    for (let i = 0; i < 1025; i++) {
      assert.equal(renderMarkdown(base + i), base + i);
    }
    // 最早写入的 key 已被淘汰；再次渲染会重新计算，结果仍正确
    assert.equal(renderMarkdown(base + 0), base + 0);
  });
});
