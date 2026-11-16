/**
 * Tests for the "add selection to chat" quote-chip feature: 18-locale i18n coverage for
 * ui.chatQuote.*, unit tests for the selection/format helpers in selectionQuote.js, and
 * source-wiring contracts for the quotable-region markers (.chat-md + [data-ccv-quotable]).
 *
 * The localeBlockOf pattern matches new-ui-i18n.test.js / context-i18n.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildQuotePrefix, toElement, isSlashCommandText, truncateQuote, selectionInSingleAssistantQuoteRegion, hasActiveTextSelection, MAX_QUOTE_LEN } from '../src/components/chat/selectionQuote.js';

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
    for (const fn of ['selectionInSingleAssistantQuoteRegion', 'selectionPopupPosition', 'buildQuotePrefix', 'hasActiveTextSelection']) {
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

describe('hasActiveTextSelection', () => {
  const realWindow = globalThis.window;
  function withSelection(sel, fn) {
    globalThis.window = { getSelection: () => sel };
    try { fn(); } finally { globalThis.window = realWindow; }
  }
  it('is false when window/getSelection is unavailable', () => {
    const saved = globalThis.window;
    delete globalThis.window;
    try { assert.equal(hasActiveTextSelection(), false); } finally { globalThis.window = saved; }
  });
  it('is false for a collapsed or empty selection', () => {
    withSelection({ isCollapsed: true, rangeCount: 1, toString: () => '' }, () => {
      assert.equal(hasActiveTextSelection(), false);
    });
    withSelection(null, () => assert.equal(hasActiveTextSelection(), false));
  });
  it('is false for a whitespace-only selection (e.g. dragging over padding)', () => {
    withSelection({ isCollapsed: false, rangeCount: 1, toString: () => '   ' }, () => {
      assert.equal(hasActiveTextSelection(), false);
    });
  });
  it('is false when window.getSelection is missing', () => {
    const saved = globalThis.window;
    globalThis.window = {}; // no getSelection
    try { assert.equal(hasActiveTextSelection(), false); } finally { globalThis.window = saved; }
  });
  it('is true for a non-collapsed selection with text', () => {
    withSelection({ isCollapsed: false, rangeCount: 1, toString: () => 'abc' }, () => {
      assert.equal(hasActiveTextSelection(), true);
    });
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

// Minimal DOM stand-ins for the selection gates (no real document needed). `bubble` is the
// shared assistant-bubble ancestor object (or null for user content); `md` is the `.chat-md`
// root; `quotable` is the `[data-ccv-quotable]` region root. closest() returns the SAME object
// reference, so identity checks hold.
function el({ bubble = null, md = null, quotable = null } = {}) {
  return {
    nodeType: 1,
    closest(sel) {
      if (sel === '[data-ccv-role="assistant"]') return bubble;
      if (sel === '.chat-md') return md;
      if (sel === '[data-ccv-quotable]') return quotable;
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

describe('selectionInSingleAssistantQuoteRegion', () => {
  it('rejects collapsed / empty / multi-range selections', () => {
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(null, null, { collapsed: true })), false);
    assert.equal(selectionInSingleAssistantQuoteRegion(null), false);
    // Multi-range (e.g. Firefox Ctrl+drag): only range[0] is validated, so reject outright.
    const bubble = {}; const md = {};
    assert.equal(selectionInSingleAssistantQuoteRegion({
      isCollapsed: false, rangeCount: 2,
      getRangeAt: () => ({ startContainer: el({ bubble, md }), endContainer: el({ bubble, md }) }),
    }), false);
  });
  it('accepts endpoints inside the SAME assistant bubble and SAME .chat-md', () => {
    const bubble = {}; const md = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, md }), el({ bubble, md }))), true);
  });
  it('rejects when an endpoint is not in an assistant bubble (user message)', () => {
    const md = {};
    const start = el({ bubble: {}, md });
    const end = el({ bubble: null, md }); // user bubble: no assistant ancestor
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(start, end)), false);
  });
  it('rejects selections spanning two different .chat-md roots in the same bubble', () => {
    const bubble = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, md: {} }), el({ bubble, md: {} }))), false);
  });
  it('rejects selections spanning two different assistant bubbles', () => {
    const md = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble: {}, md }), el({ bubble: {}, md }))), false);
  });
  it('normalizes Text-node endpoints via parentElement', () => {
    const bubble = {}; const md = {};
    const parent = el({ bubble, md });
    const textNode = { nodeType: 3, parentElement: parent };
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(textNode, textNode)), true);
  });
  it('accepts endpoints in the same bubble + same quotable region (diff code)', () => {
    const bubble = {}; const quotable = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, quotable }), el({ bubble, quotable }))), true);
  });
  it('still accepts markdown (.chat-md) endpoints in the same bubble (regression)', () => {
    const bubble = {}; const md = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, md }), el({ bubble, md }))), true);
  });
  it('rejects markdown → quotable crossing in the same bubble', () => {
    const bubble = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, md: {} }), el({ bubble, quotable: {} }))), false);
  });
  it('rejects quotable → markdown crossing in the same bubble', () => {
    const bubble = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, quotable: {} }), el({ bubble, md: {} }))), false);
  });
  it('rejects two different quotable roots in the same bubble (two Edit cards)', () => {
    const bubble = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, quotable: {} }), el({ bubble, quotable: {} }))), false);
  });
  it('rejects a quotable region with no assistant-bubble ancestor (portal/non-chat)', () => {
    const quotable = {};
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ quotable }), el({ quotable }))), false);
  });
  it('rejects a header endpoint (in bubble but outside any quotable region), both directions', () => {
    const bubble = {}; const quotable = {};
    const header = el({ bubble }); // file path / summary / toggle
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(header, el({ bubble, quotable }))), false);
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(el({ bubble, quotable }), header)), false);
  });
  it('rejects a gutter-only endpoint (in bubble, no quotable region)', () => {
    const bubble = {}; const quotable = {};
    const gutter = el({ bubble }); // gutter text is also user-select:none in practice
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(gutter, el({ bubble, quotable }))), false);
  });
  it('normalizes Text-node endpoints inside a quotable region', () => {
    const bubble = {}; const quotable = {};
    const parent = el({ bubble, quotable });
    const textNode = { nodeType: 3, parentElement: parent };
    assert.equal(selectionInSingleAssistantQuoteRegion(selOf(textNode, textNode)), true);
  });
});

describe('quotable-region wiring', () => {
  it('DiffView marks exactly one quotable region on the code wrap (not header/gutter)', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'DiffView.jsx'), 'utf-8');
    const lines = src.split('\n');
    // Only the JSX element line counts; comment lines mention the attribute name too.
    const marked = lines.filter(l => l.includes('data-ccv-quotable') && l.trim().startsWith('<'));
    assert.equal(marked.length, 1, 'DiffView 应恰好有一处 data-ccv-quotable 标记（JSX 元素行）');
    assert.ok(marked[0].includes('styles.codeWrap'), '标记应落在 .codeWrap 行');
    assert.ok(lines.filter(l => l.includes('styles.header')).every(l => !l.includes('data-ccv-quotable')), 'header 不应带标记');
    assert.ok(lines.filter(l => l.includes('styles.gutter')).every(l => !l.includes('data-ccv-quotable')), 'gutter 不应带标记');
  });
  it('selectionQuote.js exposes the quotable-region gate', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'selectionQuote.js'), 'utf-8');
    assert.ok(src.includes("const QUOTABLE_SEL = '[data-ccv-quotable]'"), 'selectionQuote.js 应定义 QUOTABLE_SEL');
    assert.ok(src.includes('export function selectionInSingleAssistantQuoteRegion'), '缺少 selectionInSingleAssistantQuoteRegion');
    // The old .chat-md-only alias was removed once the gate was generalized; keep it gone.
    assert.ok(!src.includes('selectionInSingleAssistantMd'), '不应再保留 selectionInSingleAssistantMd 别名');
  });
  it('ChatView uses the quotable-region gate', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatView.jsx'), 'utf-8');
    assert.ok(src.includes('selectionInSingleAssistantQuoteRegion('), 'ChatView 应调用 selectionInSingleAssistantQuoteRegion');
  });
  it('diff gutter stays non-selectable so line numbers / +/- never enter a quote', () => {
    const css = readFileSync(join(SRC, 'components', 'chat', 'DiffView.module.css'), 'utf-8');
    const start = css.indexOf('.gutter {');
    assert.ok(start >= 0, 'DiffView.module.css 缺少 .gutter 规则');
    const block = css.slice(start, css.indexOf('}', start));
    assert.ok(/user-select:\s*none/.test(block), '.gutter 必须 user-select:none，否则行号/+/- 会进入引用文本');
  });
  it('ChatMessage marks the default KV params region quotable (Agent card prompt etc.)', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'ChatMessage.jsx'), 'utf-8');
    assert.ok(src.includes('data-ccv-quotable="tool-kv"'), 'ChatMessage 的 kvContainer 应带 data-ccv-quotable="tool-kv"');
  });
  it('AskQuestionForm marks the question+options region quotable', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'AskQuestionForm.jsx'), 'utf-8');
    assert.ok(src.includes('data-ccv-quotable="ask-question"'), 'AskQuestionForm 的 per-question 容器应带 data-ccv-quotable="ask-question"');
  });
  it('AskQuestionForm guards option-row clicks against an active text selection', () => {
    const src = readFileSync(join(SRC, 'components', 'chat', 'AskQuestionForm.jsx'), 'utf-8');
    assert.ok(src.includes('function guardWhileSelecting('), 'AskQuestionForm 应定义 guardWhileSelecting helper');
    // The guard must actually be ATTACHED: 4 option rows (radio / radio-Other / checkbox /
    // checkbox-Other) each wire their onClick through the helper, and none calls activate() raw.
    const wired = (src.match(/onClick=\{guardWhileSelecting\(activate\)\}/g) || []).length;
    assert.equal(wired, 4, '应为 4 个选项行 onClick 经 guardWhileSelecting 接管');
    assert.ok(!src.includes('onClick={activate}'), '不应再有未加守卫的 onClick={activate}');
  });
  it('ask option rows are text-selectable but the dot glyph is not', () => {
    const css = readFileSync(join(SRC, 'components', 'chat', 'ChatMessage.module.css'), 'utf-8');
    const itemStart = css.indexOf('.askRadioItem {');
    assert.ok(itemStart >= 0, '缺少 .askRadioItem 规则');
    const itemBlock = css.slice(itemStart, css.indexOf('}', itemStart));
    assert.ok(/user-select:\s*text/.test(itemBlock), '.askRadioItem 应允许选中文字');
    const dotStart = css.indexOf('.askRadioDot {');
    assert.ok(dotStart >= 0, '缺少 .askRadioDot 规则');
    const dotBlock = css.slice(dotStart, css.indexOf('}', dotStart));
    assert.ok(/user-select:\s*none/.test(dotBlock), '.askRadioDot 应保持 user-select:none，避免字形进入引用');
  });
});
