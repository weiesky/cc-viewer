/**
 * 18-locale i18n coverage test for the "add selection to chat" quote-chip feature
 * (ui.chatQuote.*), plus a wiring assertion that the selection helpers and the
 * CSS-module floating-button style exist and stay !important-free.
 *
 * Same localeBlockOf pattern as new-ui-i18n.test.js / context-i18n.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildQuotePrefix, toElement, isSlashCommandText, truncateQuote, selectionInSingleAssistantMd, MAX_QUOTE_LEN } from '../src/components/chat/selectionQuote.js';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const I18N_SRC = readFileSync(join(SRC, 'i18n.js'), 'utf-8');

// '\n  }' rather than the first '}' ends the block, so a translation value containing
// '}' does not truncate early and skip checking the following locales.
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const KEYS = [
  'ui.chatQuote.addToChat',     // floating "add to chat" button over an assistant selection
  'ui.chatQuote.previewTitle',  // quote-chip full-text preview Popover title
  'ui.chatQuote.confirmRemove', // quote chip remove confirm (ConfirmRemoveButton)
  'ui.chatQuote.remove',        // quote chip remove aria-label
];

describe('chat quote i18n coverage', () => {
  for (const key of KEYS) {
    it(`${key} 覆盖全部 18 个 locale`, () => {
      const block = localeBlockOf(key);
      for (const loc of LOCALES) {
        assert.ok(block.includes(`"${loc}":`), `${key} 缺少 locale ${loc}`);
      }
    });
  }
});

describe('chat quote wiring', () => {
  it('selection helpers exist (selectionQuote.js)', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'selectionQuote.js'), 'utf-8');
    for (const fn of ['selectionInSingleAssistantMd', 'selectionPopupPosition', 'buildQuotePrefix']) {
      assert.ok(src.includes(`export function ${fn}`), `selectionQuote.js 缺少 ${fn}`);
    }
    // Scope guard must use the build-stable data attribute, not the hashed CSS-module class.
    assert.ok(src.includes('[data-ccv-role="assistant"]'), 'selectionQuote.js 应使用 data-ccv-role 钩子');
  });

  it('ChatMessage marks bubble role with data-ccv-role', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatMessage.jsx'), 'utf-8');
    assert.ok(src.includes('data-ccv-role'), 'ChatMessage 气泡缺少 data-ccv-role 钩子');
  });

  it('floating-button style exists and stays !important-free', () => {
    const css = readFileSync(join(SRC, 'components', 'chat', 'ChatView.module.css'), 'utf-8');
    assert.ok(css.includes('.selectionQuoteBtn'), 'ChatView.module.css 缺少 .selectionQuoteBtn');
    // Scope to this rule's declaration block (up to its closing brace) so an unrelated
    // !important elsewhere in the file is not attributed to it.
    const start = css.indexOf('.selectionQuoteBtn');
    const block = css.slice(start, css.indexOf('}', start));
    assert.ok(!block.includes('!important'), '.selectionQuoteBtn 不得使用 !important');
  });

  it('quote chip styles exist and stay !important-free', () => {
    const css = readFileSync(join(SRC, 'components', 'chat', 'ChatInputBar.module.css'), 'utf-8');
    assert.ok(css.includes('.quotePreviewChip'), 'ChatInputBar.module.css 缺少 .quotePreviewChip');
    const start = css.indexOf('.quotePreviewChip');
    const block = css.slice(start, css.indexOf('}', start));
    assert.ok(!block.includes('!important'), '.quotePreviewChip 不得使用 !important');
  });
});

describe('buildQuotePrefix', () => {
  it('returns empty string for no quotes', () => {
    assert.equal(buildQuotePrefix([]), '');
    assert.equal(buildQuotePrefix(null), '');
    assert.equal(buildQuotePrefix(undefined), '');
  });

  it('prefixes a single-line quote with > and a trailing blank line', () => {
    assert.equal(buildQuotePrefix([{ text: 'hello' }]), '> hello\n\n');
  });

  it('prefixes every line of a multi-line quote', () => {
    assert.equal(buildQuotePrefix([{ text: 'line1\nline2' }]), '> line1\n> line2\n\n');
  });

  it('joins multiple quotes into one blockquote separated by a > divider', () => {
    assert.equal(buildQuotePrefix([{ text: 'aaa' }, { text: 'bbb' }]), '> aaa\n>\n> bbb\n\n');
  });

  it('trims whitespace-only and empty quotes', () => {
    assert.equal(buildQuotePrefix([{ text: '   ' }, { text: '' }, { text: 'real' }]), '> real\n\n');
  });

  it('trims surrounding whitespace of each quote', () => {
    assert.equal(buildQuotePrefix([{ text: '  padded  ' }]), '> padded\n\n');
  });
});

describe('toElement', () => {
  it('returns null for null/undefined', () => {
    assert.equal(toElement(null), null);
    assert.equal(toElement(undefined), null);
  });

  it('maps a Text node to its parent element', () => {
    const el = { nodeType: 1 };
    const text = { nodeType: 3, parentElement: el };
    assert.equal(toElement(text), el);
  });

  it('passes an Element through unchanged', () => {
    const el = { nodeType: 1 };
    assert.equal(toElement(el), el);
  });

  it('returns null for non-element nodes without closest (e.g. document)', () => {
    assert.equal(toElement({ nodeType: 9 }), null);
  });
});

describe('isSlashCommandText', () => {
  it('detects a slash command at the start', () => {
    assert.equal(isSlashCommandText('/clear'), true);
    assert.equal(isSlashCommandText('  /model fast'), true); // leading whitespace tolerated
  });
  it('is false for ordinary text and empty input', () => {
    assert.equal(isSlashCommandText('hello'), false);
    assert.equal(isSlashCommandText(''), false);
    assert.equal(isSlashCommandText(null), false);
    assert.equal(isSlashCommandText('a / b'), false); // slash not at start
  });
});

describe('truncateQuote', () => {
  it('returns trimmed text unchanged when under the cap', () => {
    assert.equal(truncateQuote('  short text  '), 'short text');
  });
  it('returns empty for blank input', () => {
    assert.equal(truncateQuote('   '), '');
    assert.equal(truncateQuote(null), '');
  });
  it('hard-cuts and appends an ellipsis when over the cap without a newline', () => {
    const out = truncateQuote('x'.repeat(MAX_QUOTE_LEN + 500));
    assert.equal(out.endsWith(' …'), true);
    assert.ok(out.length <= MAX_QUOTE_LEN + 2);
  });
  it('cuts at a late line boundary when one exists', () => {
    const line = 'a'.repeat(MAX_QUOTE_LEN - 100);
    const text = line + '\n' + 'b'.repeat(500); // newline just past the cap
    const out = truncateQuote(text);
    assert.equal(out, line + ' …');
  });
});

// Minimal DOM stand-ins for selectionInSingleAssistantMd (no real document needed). `bubble`
// is the shared assistant-bubble ancestor object (or null for user content); `md` is the
// `.chat-md` root. closest() returns the SAME object reference, so identity checks hold.
function el({ bubble = null, md = null } = {}) {
  return {
    nodeType: 1,
    closest(sel) {
      if (sel === '[data-ccv-role="assistant"]') return bubble;
      if (sel === '.chat-md') return md;
      return null;
    },
  };
}
function selOf(startNode, endNode, { collapsed = false } = {}) {
  return {
    isCollapsed: collapsed,
    rangeCount: collapsed ? 0 : 1,
    getRangeAt: () => ({ startContainer: startNode, endContainer: endNode }),
  };
}

describe('selectionInSingleAssistantMd', () => {
  it('rejects collapsed / empty selections', () => {
    assert.equal(selectionInSingleAssistantMd(selOf(null, null, { collapsed: true })), false);
    assert.equal(selectionInSingleAssistantMd(null), false);
  });
  it('accepts endpoints inside the SAME assistant bubble and SAME .chat-md', () => {
    const bubble = {}; const md = {};
    const start = el({ bubble, md });
    const end = el({ bubble, md });
    assert.equal(selectionInSingleAssistantMd(selOf(start, end)), true);
  });
  it('rejects when an endpoint is not in an assistant bubble (user message)', () => {
    const md = {};
    const start = el({ bubble: {}, md });
    const end = el({ bubble: null, md }); // user bubble: no assistant ancestor
    assert.equal(selectionInSingleAssistantMd(selOf(start, end)), false);
  });
  it('rejects selections spanning two different .chat-md roots in the same bubble', () => {
    const bubble = {};
    const start = el({ bubble, md: {} });
    const end = el({ bubble, md: {} });
    assert.equal(selectionInSingleAssistantMd(selOf(start, end)), false);
  });
  it('rejects selections spanning two different assistant bubbles', () => {
    const md = {};
    const start = el({ bubble: {}, md });
    const end = el({ bubble: {}, md });
    assert.equal(selectionInSingleAssistantMd(selOf(start, end)), false);
  });
  it('normalizes Text-node endpoints via parentElement', () => {
    const bubble = {}; const md = {};
    const parent = el({ bubble, md });
    const textNode = { nodeType: 3, parentElement: parent };
    assert.equal(selectionInSingleAssistantMd(selOf(textNode, textNode)), true);
  });
});
