/**
 * Unit tests for the Markdown render pipeline (parse + cache + escape fallback).
 *
 * Mirrors src/utils/markdown.js:11-29 — keep in sync.
 *
 * Scope of this file:
 *  ✓ marked output contract (headings, lists, code, tables, links, HTML inline)
 *  ✓ cache behavior (hit, FIFO eviction, empty-string skip)
 *  ✓ escapeHtml fallback contract
 *  ✗ DOMPurify sanitization — requires a DOM, validated in the browser.
 *    See test/manual-markdown.html for the human-driven sanitizer checks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';

// ─── Inlined dependencies (mirror of src/utils/helpers.js + markdown.js) ─────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

  it('renders links', () => {
    resetCache();
    const html = renderMarkdown('[click](https://example.com)');
    assert.match(html, /<a href="https:\/\/example\.com">click<\/a>/);
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
