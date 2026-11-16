/**
 * Tests for the "copy selection as markdown" feature: htmlToMarkdown conversion,
 * selectionInSingleAssistantMarkdown gate, and ChatView source wiring.
 *
 * The htmlToMarkdown tests use Turndown under node — turndown's browser field resolves
 * to a build that uses @mixmark-io/domino as a DOM parser fallback, so no jsdom needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { htmlToMarkdown } from '../src/utils/markdownCopy.js';
import { selectionInSingleAssistantMarkdown } from '../src/components/chat/selectionQuote.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('htmlToMarkdown conversion', () => {
  it('converts ATX headings', () => {
    assert.equal(htmlToMarkdown('<h1>Title</h1>'), '# Title');
    assert.equal(htmlToMarkdown('<h2>Sub</h2>'), '## Sub');
    assert.equal(htmlToMarkdown('<h3>Deep</h3>'), '### Deep');
  });

  it('converts bold and italic', () => {
    assert.equal(htmlToMarkdown('<p><strong>bold</strong></p>'), '**bold**');
    assert.equal(htmlToMarkdown('<p><em>em</em></p>'), '*em*');
  });

  it('converts inline code with backticks', () => {
    assert.equal(htmlToMarkdown('<p><code>const x = 1</code></p>'), '`const x = 1`');
  });

  it('converts fenced code blocks with language', () => {
    const html = '<pre><code class="language-js">console.log(1)\n</code></pre>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('```'), 'should use fenced style');
    assert.ok(md.includes('js'), 'should preserve language');
    assert.ok(md.includes('console.log(1)'), 'should preserve code');
  });

  it('converts GFM tables', () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('|'), 'should use pipe syntax');
    assert.ok(md.includes('A'), 'should keep header');
    assert.ok(md.includes('1'), 'should keep cell');
  });

  it('converts strikethrough (GFM)', () => {
    const html = '<p><del>gone</del></p>';
    const md = htmlToMarkdown(html);
    // turndown-plugin-gfm emits single-tilde ~x~ by default; both ~x~ and ~~x~~ are GFM-valid.
    assert.ok(/^~+gone~+$/.test(md), 'should use GFM strikethrough marker (~ or ~~)');
  });

  it('converts unordered lists with - marker', () => {
    const html = '<ul><li>one</li><li>two</li></ul>';
    const md = htmlToMarkdown(html);
    // Turndown emits "-   item" (marker + 3 spaces) by default; the marker is what matters.
    assert.ok(/-\s+one/.test(md), 'should use - marker for first item');
    assert.ok(/-\s+two/.test(md), 'should use - marker for second item');
  });

  it('converts ordered lists', () => {
    const html = '<ol><li>first</li><li>second</li></ol>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('1.'), 'should use ordered syntax');
  });

  it('maps <br> to GFM hard break (round-trips under marked breaks:true)', () => {
    const html = '<p>line1<br>line2</p>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('line1'), 'should keep first line');
    assert.ok(md.includes('line2'), 'should keep second line');
    assert.ok(md.includes('  \n'), 'should use GFM hard break (two spaces + \\n)');
  });

  it('restores data-md-file links as markdown links', () => {
    const html = '<p><a data-md-file="/path/to/file.md">see file</a></p>';
    const md = htmlToMarkdown(html);
    // Paths are wrapped in <...> (CommonMark angle-bracket destination) so spaces
    // and parens in real paths produce valid markdown.
    assert.equal(md, '[see file](</path/to/file.md>)');
  });

  it('preserves title attribute in data-md-file links', () => {
    const html = '<p><a data-md-file="/x.md" title="A file">link</a></p>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('[link](</x.md>'), 'should include path in angle brackets');
    assert.ok(md.includes('"A file"'), 'should include title');
  });

  it('escapes double quotes in link titles', () => {
    const html = '<p><a data-md-file="/x.md" title=\'say "hi"\'>link</a></p>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('\\"'), 'should escape quotes');
  });

  it('handles paths with spaces and parens safely', () => {
    const html = '<p><a data-md-file="/my dir/file(1).md">see</a></p>';
    const md = htmlToMarkdown(html);
    assert.equal(md, '[see](</my dir/file(1).md>)');
  });

  it('strips control characters from data-md-file (markdown injection guard)', () => {
    // A crafted path containing \n and HTML would otherwise land verbatim in the
    // copied markdown, executing when the user pastes into a renderer that allows
    // raw HTML. Control chars and < > must be stripped.
    const html = '<p><a data-md-file="/tmp/x\n<img src=x onerror=alert(1)>">the docs</a></p>';
    const md = htmlToMarkdown(html);
    assert.ok(!md.includes('<img'), 'should strip angle brackets');
    assert.ok(!md.includes('\n<'), 'should strip newline');
    assert.ok(md.includes('the docs'), 'should keep link text');
  });

  it('keeps external links unchanged', () => {
    const html = '<p><a href="https://example.com" target="_blank">ext</a></p>';
    const md = htmlToMarkdown(html);
    assert.equal(md, '[ext](https://example.com)');
  });

  it('handles <a> without href or data-md-file gracefully', () => {
    const html = '<p><a>anchor</a></p>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('anchor'), 'should keep text content');
  });

  it('returns empty string for empty input', () => {
    assert.equal(htmlToMarkdown(''), '');
    assert.equal(htmlToMarkdown(null), '');
    assert.equal(htmlToMarkdown(undefined), '');
  });

  it('converts blockquote', () => {
    const html = '<blockquote><p>quoted</p></blockquote>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('>'), 'should use > marker');
    assert.ok(md.includes('quoted'), 'should keep text');
  });
});

describe('selectionInSingleAssistantMarkdown', () => {
  // Fake DOM tree builder: each node is an object with closest() that walks a parent chain.
  function fakeEl(matches) {
    const el = { nodeType: 1, _matches: new Set(matches), parent: null };
    el.closest = (sel) => {
      let cur = el;
      while (cur) {
        if (cur._matches && cur._matches.has(sel)) return cur;
        cur = cur.parent;
      }
      return null;
    };
    return el;
  }
  function link(parent, child) {
    child.parent = parent;
    return child;
  }
  function fakeSelection(startEl, endEl, opts = {}) {
    return {
      isCollapsed: opts.collapsed ?? false,
      rangeCount: opts.rangeCount ?? 1,
      getRangeAt: () => ({ startContainer: startEl, endContainer: endEl }),
    };
  }

  it('accepts same-bubble, same .chat-md selection', () => {
    const bubble = fakeEl(['[data-ccv-role="assistant"]']);
    const md = fakeEl(['.chat-md']);
    link(bubble, md);
    const start = link(md, fakeEl([]));
    const end = link(md, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end)), true);
  });

  it('rejects selection in user bubble', () => {
    const userBubble = fakeEl(['[data-ccv-role="user"]']);
    const md = fakeEl(['.chat-md']);
    link(userBubble, md);
    const start = link(md, fakeEl([]));
    const end = link(md, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end)), false);
  });

  it('rejects selection spanning two bubbles', () => {
    const bubble1 = fakeEl(['[data-ccv-role="assistant"]']);
    const bubble2 = fakeEl(['[data-ccv-role="assistant"]']);
    const md1 = link(bubble1, fakeEl(['.chat-md']));
    const md2 = link(bubble2, fakeEl(['.chat-md']));
    const start = link(md1, fakeEl([]));
    const end = link(md2, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end)), false);
  });

  it('rejects selection spanning two .chat-md roots in same bubble', () => {
    const bubble = fakeEl(['[data-ccv-role="assistant"]']);
    const md1 = link(bubble, fakeEl(['.chat-md']));
    const md2 = link(bubble, fakeEl(['.chat-md']));
    const start = link(md1, fakeEl([]));
    const end = link(md2, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end)), false);
  });

  it('rejects selection crossing .chat-md ↔ [data-ccv-quotable]', () => {
    const bubble = fakeEl(['[data-ccv-role="assistant"]']);
    const md = link(bubble, fakeEl(['.chat-md']));
    const quotable = link(bubble, fakeEl(['[data-ccv-quotable]']));
    const start = link(md, fakeEl([]));
    const end = link(quotable, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end)), false);
  });

  it('rejects [data-ccv-quotable] selection without .chat-md', () => {
    const bubble = fakeEl(['[data-ccv-role="assistant"]']);
    const quotable = link(bubble, fakeEl(['[data-ccv-quotable]']));
    const start = link(quotable, fakeEl([]));
    const end = link(quotable, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end)), false);
  });

  it('rejects collapsed selection', () => {
    const bubble = fakeEl(['[data-ccv-role="assistant"]']);
    const md = link(bubble, fakeEl(['.chat-md']));
    const el = link(md, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(el, el, { collapsed: true })), false);
  });

  it('rejects multi-range selection', () => {
    const bubble = fakeEl(['[data-ccv-role="assistant"]']);
    const md = link(bubble, fakeEl(['.chat-md']));
    const start = link(md, fakeEl([]));
    const end = link(md, fakeEl([]));
    assert.equal(selectionInSingleAssistantMarkdown(fakeSelection(start, end, { rangeCount: 2 })), false);
  });

  it('rejects null/undefined selection', () => {
    assert.equal(selectionInSingleAssistantMarkdown(null), false);
    assert.equal(selectionInSingleAssistantMarkdown(undefined), false);
  });

  it('rejects selection without closest (text nodes at root)', () => {
    const textNode = { nodeType: 3, parentElement: null };
    const sel = {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({ startContainer: textNode, endContainer: textNode }),
    };
    assert.equal(selectionInSingleAssistantMarkdown(sel), false);
  });
});

describe('ChatView copy wiring', () => {
  it('imports selectionInSingleAssistantMarkdown and htmlToMarkdown', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    assert.ok(src.includes('selectionInSingleAssistantMarkdown'), 'ChatView should import the markdown gate');
    assert.ok(src.includes('htmlToMarkdown'), 'ChatView should import htmlToMarkdown');
    assert.ok(src.includes('from \'../../utils/markdownCopy\''), 'htmlToMarkdown should come from utils/markdownCopy');
  });

  it('defines handleMessageListCopy class field', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    assert.ok(/handleMessageListCopy\s*=\s*\(/.test(src), 'ChatView should define handleMessageListCopy');
  });

  it('attaches onCopy to message list wrapper', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    assert.ok(src.includes('onCopy={this.handleMessageListCopy}'), 'message list wrapper should have onCopy prop');
  });

  it('calls reportSwallowed on turndown failure', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    assert.ok(src.includes("reportSwallowed('chat.copy-markdown'"), 'copy handler should report swallowed errors');
  });

  it('writes both text/plain and text/html to clipboardData', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    const copyBlock = src.slice(src.indexOf('handleMessageListCopy'));
    assert.ok(copyBlock.includes("setData('text/plain'"), 'should write text/plain (markdown)');
    assert.ok(copyBlock.includes("setData('text/html'"), 'should write text/html (rendered)');
  });

  it('uses e.preventDefault() to override native copy', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    const copyBlock = src.slice(src.indexOf('handleMessageListCopy'), src.indexOf('handleMessageListCopy') + 2000);
    assert.ok(copyBlock.includes('e.preventDefault()'), 'should preventDefault to override native copy');
  });
});

describe('markdownCopy.js source contract', () => {
  it('configures Turndown with ATX headings and fenced code', () => {
    const src = readFileSync(join(SRC, 'utils', 'markdownCopy.js'), 'utf-8');
    assert.ok(src.includes("headingStyle: 'atx'"), 'should use ATX headings');
    assert.ok(src.includes("codeBlockStyle: 'fenced'"), 'should use fenced code');
    assert.ok(src.includes("bulletListMarker: '-'"), 'should use - for lists');
  });

  it('uses turndown-plugin-gfm for tables and strikethrough', () => {
    const src = readFileSync(join(SRC, 'utils', 'markdownCopy.js'), 'utf-8');
    assert.ok(src.includes("from 'turndown-plugin-gfm'"), 'should import gfm plugin');
    assert.ok(src.includes('service.use(gfm)'), 'should register gfm plugin');
  });

  it('defines custom ccvMdFileLink rule for data-md-file links', () => {
    const src = readFileSync(join(SRC, 'utils', 'markdownCopy.js'), 'utf-8');
    assert.ok(src.includes("addRule('ccvMdFileLink'"), 'should define ccvMdFileLink rule');
    assert.ok(src.includes("data-md-file"), 'rule should match data-md-file attribute');
  });
});
