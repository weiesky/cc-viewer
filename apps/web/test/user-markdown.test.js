/**
 * Unit tests for user-message markdown segmentation + output contract.
 *
 * Covers the pure segmentation layer behind ChatMessage.renderUserTextWithImages:
 *  ✓ segmentUserTextWithImages alternation (text/image), verbatim text slices,
 *    whitespace-only text segment filtering, all four ref forms through the wrapper
 *  ✓ marked output contract for user text (plain single line → single <p>,
 *    multi-line → <br>, markdown syntax → real structure)
 *  ✗ DOMPurify sanitization — requires a DOM (same known gap as
 *    markdown-render.test.js); bare-angle-bracket behavior is snapshot at the
 *    marked level only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

import { segmentUserTextWithImages } from '../src/utils/userImageRefs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');

// Same breaks:true option as src/utils/markdown.js (renderMarkdown). Sanitization
// happens after parse in src; here we only assert the pre-sanitize structure.
function parse(text) {
  return marked.parse(text, { breaks: true });
}

describe('segmentUserTextWithImages', () => {
  it('returns a single text segment for empty / non-string input', () => {
    assert.deepEqual(segmentUserTextWithImages(''), [{ type: 'text', text: '' }]);
    assert.deepEqual(segmentUserTextWithImages(null), [{ type: 'text', text: '' }]);
  });

  it('returns a single text segment (whole text) when there are no image refs', () => {
    const text = '普通多行\n用户消息,没有图片';
    assert.deepEqual(segmentUserTextWithImages(text), [{ type: 'text', text }]);
  });

  it('splits text around a bare upload path ref, keeping order', () => {
    const segs = segmentUserTextWithImages('看图 /tmp/cc-viewer-uploads/a.png 谢谢');
    assert.deepEqual(segs.map((s) => s.type), ['text', 'image', 'text']);
    assert.equal(segs[0].text, '看图 ');
    assert.equal(segs[1].path, '/tmp/cc-viewer-uploads/a.png');
    assert.equal(segs[2].text, ' 谢谢');
  });

  it('passes the text slice through verbatim (image separation is done by sibling components, not markdown)', () => {
    // text 段与 image 段由各自独立的 React 组件渲染,marked 看不到图片;
    // 段尾追加 '\n' 会被段落终结符吞掉——分段器原样切片,不做任何修补。
    const segs = segmentUserTextWithImages('截图在这"/tmp/cc-viewer-uploads/b.png"');
    assert.equal(segs[0].type, 'text');
    assert.equal(segs[0].text, '截图在这');
    assert.equal(segs[1].type, 'image');
    assert.equal(segs[1].path, '/tmp/cc-viewer-uploads/b.png');
    assert.equal(segs[1].raw, '"/tmp/cc-viewer-uploads/b.png"'); // raw 含引号,供 fallback 文案
  });

  it('handles the [Image: source: …] placeholder form', () => {
    const segs = segmentUserTextWithImages('[Image: source: /tmp/cc-viewer-uploads/d.png] 这是什么');
    assert.deepEqual(segs.map((s) => s.type), ['image', 'text']);
    assert.equal(segs[0].path, '/tmp/cc-viewer-uploads/d.png');
    assert.equal(segs[1].text, ' 这是什么');
  });

  it('alternates multiple images and drops whitespace-only text segments', () => {
    const segs = segmentUserTextWithImages(
      '"/tmp/cc-viewer-uploads/1.png" "/tmp/cc-viewer-uploads/2.png" 对比'
    );
    assert.deepEqual(segs.map((s) => s.type), ['image', 'image', 'text']);
    assert.equal(segs[2].text, ' 对比');
  });

  it('keeps markdown syntax intact inside text segments (image ref not treated as link)', () => {
    const text = '看下 **这张** /tmp/cc-viewer-uploads/e.png';
    const segs = segmentUserTextWithImages(text);
    assert.equal(segs.length, 2);
    assert.ok(segs[0].text.includes('**这张**'), 'markdown 原文保留给渲染层');
    assert.equal(segs[1].type, 'image');
  });

  it('returns a bare image segment when the ref is at the very start of text', () => {
    assert.deepEqual(segmentUserTextWithImages('/tmp/cc-viewer-uploads/a.png'), [
      { type: 'image', path: '/tmp/cc-viewer-uploads/a.png', raw: '/tmp/cc-viewer-uploads/a.png' },
    ]);
  });

  it('returns a single image segment when the whole message is just an image', () => {
    const segs = segmentUserTextWithImages('"/tmp/cc-viewer-uploads/only.png"');
    assert.deepEqual(segs, [
      { type: 'image', path: '/tmp/cc-viewer-uploads/only.png', raw: '"/tmp/cc-viewer-uploads/only.png"' },
    ]);
  });

  it('segments every ref form through the wrapper ([Image #N], single-quoted, /private realpath)', () => {
    for (const raw of [
      '[Image #2: source: /tmp/cc-viewer-uploads/f.png]',
      "'/tmp/cc-viewer-uploads/f.png'",
      '/private/tmp/cc-viewer-uploads/f.png',
    ]) {
      const segs = segmentUserTextWithImages(`前 ${raw} 后`);
      assert.deepEqual(segs.map((s) => s.type), ['text', 'image', 'text'], raw);
      assert.equal(segs[0].text, '前 ');
      assert.ok(segs[1].path.endsWith('/tmp/cc-viewer-uploads/f.png'), raw);
      assert.equal(segs[2].text, ' 后');
    }
  });

  it('passes CRLF through verbatim in the text slice', () => {
    const segs = segmentUserTextWithImages('line1\r\n/tmp/cc-viewer-uploads/g.png');
    assert.equal(segs[0].text, 'line1\r\n');
    assert.equal(segs[1].type, 'image');
  });

  it('pins the known wart: markdown image syntax ![alt](path) splits into visible fragments', () => {
    // findUserImageRefs 的裸路径分支在 ) 处截断(既有行为,user-image-refs.test.js 已锚定),
    // markdown 渲染后 ![alt]( 与 ) 会以纯文本残片留在图片两侧。此处锚定现状,
    // 防止无意识变化;若未来修复(markdown 感知分段),此用例应随之更新。
    const segs = segmentUserTextWithImages('看 ![alt](/tmp/cc-viewer-uploads/e.png) 完');
    assert.deepEqual(segs.map((s) => s.type), ['text', 'image', 'text']);
    assert.equal(segs[0].text, '看 ![alt](');
    assert.equal(segs[1].path, '/tmp/cc-viewer-uploads/e.png');
    assert.equal(segs[2].text, ') 完');
  });
});

describe('user text markdown output contract (pre-sanitize)', () => {
  it('renders plain single-line text as a single <p> (no structural surprise)', () => {
    assert.equal(parse('hello world').trim(), '<p>hello world</p>');
  });

  it('renders embedded newlines as <br> (intentional: previously collapsed to a space)', () => {
    assert.equal(parse('第一行\n第二行').trim(), '<p>第一行<br>第二行</p>');
  });

  it('renders markdown syntax (headings, lists, fences) as real structure', () => {
    assert.match(parse('# 标题'), /<h1[^>]*>标题<\/h1>/);
    assert.match(parse('- a\n- b'), /<ul>\s*<li>a<\/li>\s*<li>b<\/li>\s*<\/ul>/);
    assert.match(parse('```js\nconst x = 1;\n```'), /<pre><code class="language-js">/);
  });

  it('snapshots bare angle-bracket handling at the marked level', () => {
    // marked treats <file> as inline HTML and passes it through; DOMPurify (not
    // exercised here) then drops the unknown tag — same behavior as assistant
    // messages, an accepted tradeoff of markdown rendering.
    assert.equal(parse('check <file> please').trim(), '<p>check <file> please</p>');
  });
});

// Render-level source-contract tests (style follows minimal-chat-wiring.test.js):
// the JSX cannot run under node:test, so pin the wiring that would silently
// regress the feature — a dropped className={styles.userMd} or a reverted import
// would re-darken user text while every runtime test above still passes.
describe('user markdown — ChatMessage wiring contract', () => {
  const chatMessage = src('components', 'chat', 'ChatMessage.jsx');
  const chatMessageCss = src('components', 'chat', 'ChatMessage.module.css');

  it('imports segmentUserTextWithImages from userImageRefs', () => {
    assert.ok(chatMessage.includes("import { segmentUserTextWithImages } from '../../utils/userImageRefs';"));
  });

  it('renders text segments as MarkdownBlock with the userMd hook class', () => {
    // 放宽为正则匹配:单行 includes 在 JSX 重排/换行时会脆断,这里只锚定
    // 「MarkdownBlock + styles.userMd」这一回归关键组合(无图快路径与 map 路径各一处)。
    assert.match(chatMessage, /<MarkdownBlock text=\{segments\[0\]\.text\} className=\{styles\.userMd\} \/>/);
    const mapPath = chatMessage.match(/<MarkdownBlock key=\{`md-\$\{i\}`\}[^/]*className=\{styles\.userMd\}/);
    assert.ok(mapPath, 'map path MarkdownBlock carries styles.userMd');
  });

  it('keeps image segments as React ChatImage (not inlined into markdown HTML)', () => {
    assert.match(chatMessage, /<ChatImage\s+key=\{`img-\$\{i\}`\}/);
    assert.ok(chatMessage.includes('apiUrl(`/api/file-raw?path=${encodeURIComponent(seg.path)}`)'));
  });

  it('defines the light-on-dark overrides scoped under .bubbleUser (userMd hook via selectors)', () => {
    assert.ok(!/^\.userMd \{\}/m.test(chatMessageCss), 'no standalone empty .userMd rule — selectors alone export the class');
    assert.ok(chatMessageCss.includes('.bubbleUser .userMd :global(code)'));
    assert.ok(chatMessageCss.includes('.bubbleUser .userMd :global(pre)'));
    assert.ok(chatMessageCss.includes('.bubbleUser .userMd :global(code)[data-md-file-verified]:hover'));
    assert.ok(!/!important/.test(chatMessageCss.match(/\.userMd[\s\S]*?(?=\n\/\*|$)/)?.[0] || ''), 'no !important in userMd rules');
  });

  it('hides the MarkdownBlock hover action bar inside right-aligned user bubbles', () => {
    assert.ok(chatMessageCss.includes('.bubbleUser :global([class*="mdBlockWrapper"] > [class*="actionBar"]) { display: none; }'));
  });
});
