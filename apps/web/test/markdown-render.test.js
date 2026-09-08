/**
 * Unit tests for the Markdown render pipeline (parse + cache + escape fallback).
 *
 * Mirrors src/utils/markdown.js — keep in sync. The link/codespan renderers
 * are imported directly from src/utils/markdownLinkRenderer.js /
 * markdownCodeSpanRenderer.js (same modules src registers via marked.use), so
 * the decoration contract can never drift.
 *
 * Scope of this file:
 *  ✓ marked output contract (headings, lists, code, tables, links, HTML inline)
 *  ✓ link decoration contract (external → target=_blank, local-file → data-md-file)
 *  ✓ codespan decoration contract (path-looking code → inert data-md-path-candidate)
 *  ✓ cache behavior (hit, FIFO eviction, empty-string skip)
 *  ✓ escapeHtml fallback contract
 *  ✗ DOMPurify sanitization — requires a DOM, validated manually in the browser
 *    (ADD_ATTR ['target'] / rel / data-md-file pass-through; no jsdom in this repo,
 *    so the sanitize branch has no automated coverage — known gap).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { marked, Marked } from 'marked';
import { renderMdLink } from '../src/utils/markdownLinkRenderer.js';
import { renderMdCodespan } from '../src/utils/markdownCodeSpanRenderer.js';

// ─── Inlined dependencies (mirror of src/utils/helpers.js + markdown.js) ─────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Same registration as src/utils/markdown.js module scope. The test-process
// marked instance is separate from src's — this only affects this file.
marked.use({
  renderer: { link: renderMdLink, codespan: renderMdCodespan },
});

const MD_CACHE_MAX = 1024;
const cache = new Map();

// No DOMPurify wrap here — sanitization tested separately in a DOM env.
function renderMarkdown(text) {
  if (!text) return '';
  const hit = cache.get(text);
  if (hit !== undefined) return hit;

  let html;
  try {
    html = marked.parse(text, { breaks: true });
  } catch (e) {
    html = escapeHtml(text);
  }

  if (cache.size >= MD_CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(text, html);
  return html;
}

function resetCache() { cache.clear(); }

// ─── Basic Markdown rendering ────────────────────────────────────────────────

describe('marked output — basic elements', () => {
  it('renders empty input as empty string', () => {
    resetCache();
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
    assert.equal(renderMarkdown(undefined), '');
  });

  it('renders h1/h2/h3 headings', () => {
    resetCache();
    const html = renderMarkdown('# Title\n\n## Sub\n\n### Third');
    assert.match(html, /<h1[^>]*>Title<\/h1>/);
    assert.match(html, /<h2[^>]*>Sub<\/h2>/);
    assert.match(html, /<h3[^>]*>Third<\/h3>/);
  });

  it('renders paragraphs with breaks:true inserting <br> on single \\n', () => {
    resetCache();
    const html = renderMarkdown('line a\nline b');
    assert.match(html, /line a<br>\s*line b|line a<br\s*\/>\s*line b/);
  });

  it('renders unordered lists', () => {
    resetCache();
    const html = renderMarkdown('- a\n- b\n- c');
    assert.match(html, /<ul>/);
    assert.match(html, /<li>a<\/li>/);
    assert.match(html, /<li>c<\/li>/);
  });

  it('renders ordered lists', () => {
    resetCache();
    const html = renderMarkdown('1. first\n2. second');
    assert.match(html, /<ol[^>]*>/);
    assert.match(html, /<li>first<\/li>/);
    assert.match(html, /<li>second<\/li>/);
  });

  it('renders fenced code blocks with language class', () => {
    resetCache();
    const html = renderMarkdown('```js\nconst a = 1;\n```');
    assert.match(html, /<pre><code[^>]*class="[^"]*language-js[^"]*"[^>]*>/);
    assert.match(html, /const a = 1;/);
  });

  it('renders inline code', () => {
    resetCache();
    const html = renderMarkdown('use `foo()` here');
    assert.match(html, /<code>foo\(\)<\/code>/);
  });

  // ── codespan path-candidate decoration (markdownCodeSpanRenderer.js) ──

  it('tags path-looking inline code with an inert data-md-path-candidate', () => {
    resetCache();
    const html = renderMarkdown('open `docs/a.md` now');
    assert.match(html, /<code data-md-path-candidate="docs\/a\.md">docs\/a\.md<\/code>/);
    // inert: no href, no anchor, no verified marker, no title — the async
    // existence probe in ChatView owns all of that.
    assert.doesNotMatch(html, /href=/);
    assert.doesNotMatch(html, /data-md-file-verified/);
    assert.doesNotMatch(html, /<a[ >]/);
  });

  it('carries a parsed line suffix as data-md-file-line', () => {
    resetCache();
    const html = renderMarkdown('see `docs/a.md:10-20` end');
    assert.match(html, /<code data-md-path-candidate="docs\/a\.md" data-md-file-line="10">docs\/a\.md:10-20<\/code>/);
    // no suffix → no line attribute
    assert.doesNotMatch(renderMarkdown('`docs/a.md`'), /data-md-file-line/);
  });

  it('normalizes the candidate path (./, #fragment, percent-decoding)', () => {
    resetCache();
    assert.match(renderMarkdown('`./docs/a.md`'), /data-md-path-candidate="docs\/a\.md"/);
    assert.match(renderMarkdown('`docs/a.md#L2`'), /data-md-path-candidate="docs\/a\.md"/);
    assert.match(renderMarkdown('`docs/a%20b.md`'), /data-md-path-candidate="docs\/a b\.md"/);
  });

  it('leaves non-path inline code on the default renderer, byte-identical', () => {
    resetCache();
    for (const src of ['use `true` here', 'run `npm run build`', '`https://x.com`', '`v1.2.3`', '`../a.md`']) {
      const html = renderMarkdown(src);
      assert.doesNotMatch(html, /data-md-path-candidate/, src);
    }
    // byte-parity with a pristine marked for the non-candidate path
    const pristine = new Marked();
    assert.equal(renderMarkdown('use `true` here'), pristine.parse('use `true` here', { breaks: true }));
  });

  it('escapes quotes in the candidate attribute (injection guard)', () => {
    resetCache();
    const html = renderMarkdown('`a"b.md`');
    assert.match(html, /data-md-path-candidate="a&quot;b\.md"/);
    assert.doesNotMatch(html, /data-md-path-candidate="a"b\.md"/);
  });

  it('escapes code text exactly like marked default (escape parity)', () => {
    resetCache();
    const pristine = new Marked();
    // candidate path whose TEXT contains escapable chars: attr value is
    // escapeAttr'd (& < " escaped), text content is escaped like marked.
    const ours = renderMarkdown('`a<b/c.md`');
    assert.match(ours, /<code data-md-path-candidate="a&lt;b\/c\.md">a&lt;b\/c\.md<\/code>/);
    // non-candidate with ' must match marked's &#39; output byte-for-byte
    assert.equal(renderMarkdown('`a\'b`'), pristine.parse("`a'b`", { breaks: true }));
  });

  it('is deterministic across repeated renders (cache-safety of the renderer)', () => {
    resetCache();
    const a = renderMarkdown('see `docs/x.md` end');
    const b = renderMarkdown('see `docs/x.md` end');
    assert.equal(a, b);
  });

  it('renders GFM-style tables', () => {
    resetCache();
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    assert.match(html, /<table>/);
    assert.match(html, /<th>a<\/th>/);
    assert.match(html, /<td>1<\/td>/);
  });

  it('renders blockquotes', () => {
    resetCache();
    const html = renderMarkdown('> quoted line');
    assert.match(html, /<blockquote>[\s\S]*quoted line[\s\S]*<\/blockquote>/);
  });

  it('renders external links with target=_blank and noopener (attribute-order agnostic)', () => {
    resetCache();
    const html = renderMarkdown('[click](https://example.com)');
    assert.match(html, /<a[^>]*href="https:\/\/example\.com"/);
    assert.match(html, /<a[^>]*target="_blank"/);
    assert.match(html, /<a[^>]*rel="noopener noreferrer"/);
    assert.match(html, />click<\/a>/);
  });

  it('marks local file links with data-md-file, keeping the raw href', () => {
    resetCache();
    const rel = renderMarkdown('[doc](./docs/a.md)');
    assert.match(rel, /<a[^>]*href="\.\/docs\/a\.md"/);
    assert.match(rel, /<a[^>]*data-md-file="docs\/a\.md"/);
    const abs = renderMarkdown('[abs](/Users/foo/x%20y.md)');
    assert.match(abs, /<a[^>]*data-md-file="\/Users\/foo\/x y\.md"/);
    const fileUri = renderMarkdown('[f](file:///Users/foo/z.md)');
    assert.match(fileUri, /<a[^>]*data-md-file="\/Users\/foo\/z\.md"/);
    // file:// links emit no href (DOMPurify would strip the scheme anyway;
    // dropping it removes the ctrl/middle-click file: navigation surface)
    assert.doesNotMatch(fileUri, /href=/);
  });

  it('leaves anchors and other schemes on the default renderer (no target, no data-md-file)', () => {
    resetCache();
    const anchor = renderMarkdown('[a](#sec)');
    assert.match(anchor, /<a href="#sec">a<\/a>/);
    const tel = renderMarkdown('[t](tel:+1234)');
    assert.match(tel, /<a href="tel:\+1234">t<\/a>/);
  });

  it('keeps link title attribute on external links', () => {
    resetCache();
    const html = renderMarkdown('[titled](https://x.com "My Title")');
    assert.match(html, /<a[^>]*title="My Title"/);
    assert.match(html, /<a[^>]*target="_blank"/);
  });

  it('escapes quotes in link titles (attribute-injection guard)', () => {
    resetCache();
    const html = renderMarkdown('[t](https://x.com "a\\"b")');
    assert.doesNotMatch(html, /title="a"b"/);
    assert.match(html, /title="a&quot;b"/);
  });

  it('renders unsafe (javascript:) links via the default renderer — no target, no data-md-file', () => {
    resetCache();
    const html = renderMarkdown('[bad](javascript:alert(1))');
    assert.doesNotMatch(html, /target=/);
    assert.doesNotMatch(html, /data-md-file/);
  });

  it('does not decorate image syntax', () => {
    resetCache();
    const html = renderMarkdown('![alt](./img.png)');
    assert.match(html, /<img[^>]*src="\.\/img\.png"/);
    assert.doesNotMatch(html, /data-md-file/);
  });

  it('renders bold and italic', () => {
    resetCache();
    const html = renderMarkdown('**bold** and *ital*');
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>ital<\/em>/);
  });

  it('renders horizontal rule', () => {
    resetCache();
    const html = renderMarkdown('above\n\n---\n\nbelow');
    assert.match(html, /<hr>/);
  });

  it('preserves inline <b>/<i> HTML (sanitizer responsibility, not marked)', () => {
    resetCache();
    const html = renderMarkdown('<b>bold</b> and <i>ital</i>');
    assert.match(html, /<b>bold<\/b>/);
    assert.match(html, /<i>ital<\/i>/);
  });
});

// ─── Cache behavior ──────────────────────────────────────────────────────────

describe('renderMarkdown — cache', () => {
  it('returns identical output for identical input (cache hit)', () => {
    resetCache();
    const a = renderMarkdown('# cached');
    const b = renderMarkdown('# cached');
    assert.equal(a, b);
    assert.equal(cache.size, 1);
  });

  it('evicts oldest entry when size exceeds MD_CACHE_MAX', () => {
    resetCache();
    for (let i = 0; i < MD_CACHE_MAX; i++) renderMarkdown(`entry ${i}`);
    assert.equal(cache.size, MD_CACHE_MAX);

    renderMarkdown('entry new');
    assert.equal(cache.size, MD_CACHE_MAX);
    assert.equal(cache.has('entry 0'), false);
    assert.equal(cache.has('entry new'), true);
  });

  it('does not cache empty input', () => {
    resetCache();
    renderMarkdown('');
    renderMarkdown(null);
    renderMarkdown(undefined);
    assert.equal(cache.size, 0);
  });
});

// ─── escapeHtml fallback ─────────────────────────────────────────────────────

describe('escapeHtml fallback', () => {
  it('escapes all HTML-special characters', () => {
    assert.equal(escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
    assert.equal(escapeHtml('a&b"c\'d'), 'a&amp;b&quot;c&#39;d');
  });

  it('coerces non-string input to string before escaping', () => {
    assert.equal(escapeHtml(123), '123');
    assert.equal(escapeHtml(null), 'null');
  });
});
