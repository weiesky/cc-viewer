/**
 * Source-contract tests for the "search merged into FileExplorer" change
 * (2026-11-11). The standalone 🔍 rail panel was removed; search now opens
 * embedded below the file tree via a magnifier toggle in the FileExplorer
 * header. These tests pin the wiring so a future edit can't silently
 * re-introduce the standalone panel or drop the state resets:
 *   - ChatView no longer imports/renders a standalone SearchPanel and the
 *     sidebar resizer no longer keys off searchOpen,
 *   - the rail has no ui.search button anymore,
 *   - FileExplorer owns the embedded SearchPanel (import + conditional render
 *     on searchOpen) and the header toggle button,
 *   - closing the explorer also resets searchOpen (no stale resurrection when
 *     the panel is re-opened via jump-to-file paths),
 *   - SearchPanel supports the embedded mode (hidden header + embedded class).
 *
 * ChatView/FileExplorer are assert-by-source (same pattern as
 * git-changes-open-persist / ultraplan-panel-embedded tests).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const chatViewSrc = readFileSync(join(here, '../src/components/chat/ChatView.jsx'), 'utf8');
const fileExplorerSrc = readFileSync(join(here, '../src/components/files/FileExplorer.jsx'), 'utf8');
const searchPanelSrc = readFileSync(join(here, '../src/components/search/SearchPanel.jsx'), 'utf8');
const i18nSrc = readFileSync(join(here, '../src/i18n.js'), 'utf8');

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];

// Same block-slicing convention as new-ui-i18n.test.js: end on '\n  }' so a
// translation value containing '}' can't truncate the block early.
function localeBlockOf(key) {
  const start = i18nSrc.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = i18nSrc.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return i18nSrc.slice(start, end);
}

describe('search merged into FileExplorer', () => {
  it('ChatView no longer imports or renders a standalone SearchPanel', () => {
    assert.equal(chatViewSrc.includes("import SearchPanel from '../search/SearchPanel'"), false, 'standalone SearchPanel import must be gone');
    assert.equal(chatViewSrc.includes('<SearchPanel'), false, 'no standalone <SearchPanel> render may remain');
  });

  it('sidebar resizer is gated only on fileExplorerOpen/gitChangesOpen (not searchOpen)', () => {
    const m = chatViewSrc.match(/\{\(this\.state\.fileExplorerOpen \|\| this\.state\.gitChangesOpen\)\s*&&\s*\(\s*<div className=\{styles\.vResizer\}/);
    assert.ok(m, 'vResizer condition must exclude searchOpen');
  });

  it('rail has no ui.search button (entry removed)', () => {
    assert.equal(chatViewSrc.includes("t('ui.search')"), false, 'no rail button may reference ui.search anymore');
  });

  it('FileExplorer renders SearchPanel embedded, gated on searchOpen, inside a drop-guard wrapper', () => {
    assert.ok(fileExplorerSrc.includes("import SearchPanel from '../search/SearchPanel'"), 'FileExplorer must import SearchPanel');
    assert.match(fileExplorerSrc, /\{searchOpen && onToggleSearch && \(/);
    assert.match(fileExplorerSrc, /<SearchPanel\s+embedded/);
    // The embedded area must not inherit the explorer's container drop zone
    // (dropping a tree/OS file over search results would move/import it to root).
    // The reject must BOTH preventDefault (else the browser navigates the tab
    // to the dropped file) and stopPropagation — bare stopPropagation is the
    // bug this guards against regressing to.
    assert.match(fileExplorerSrc, /onDragOver=\{\(e\) => \{[\s\S]{0,400}?e\.preventDefault\(\);[\s\S]{0,400}?e\.stopPropagation\(\);[\s\S]{0,400}?dropEffect = 'none';?\s*\}\}/);
    assert.match(fileExplorerSrc, /onDrop=\{\(e\) => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\}/);
  });

  it('tree/search split is user-resizable via a horizontal sash (pointer events, clamped ratio)', () => {
    assert.ok(fileExplorerSrc.includes('searchSash'), 'sash element must exist');
    assert.match(fileExplorerSrc, /onPointerDown=\{handleSearchSashDown\}/, 'pointer events cover mouse/touch/pen');
    assert.match(fileExplorerSrc, /setPointerCapture/, 'capture keeps the drag alive off-window');
    assert.match(fileExplorerSrc, /Math\.min\(0\.8, Math\.max\(0\.35, ratio\)\)/, 'ratio clamped to 35-80% (floor keeps results visible)');
    assert.match(fileExplorerSrc, /document\.body\.style\.cursor = 'row-resize'/);
    // Unmount mid-drag must restore listeners/cursor.
    assert.match(fileExplorerSrc, /useEffect\(\(\) => \(\) => \{[\s\S]{0,200}?searchDragRef\.current\.up\(\)/);
    // Dragged mode applies an explicit class (never a [style] attribute switch)
    // plus the inline height that actually resizes the panel.
    assert.match(fileExplorerSrc, /styles\.embeddedSearchWrap\}\$\{searchRatio != null \? ' ' \+ styles\.dragged : ''\}/);
    assert.match(fileExplorerSrc, /style=\{searchRatio != null \? \{ height: /);
    assert.match(fileExplorerSrc, /className=\{styles\.embeddedSearchPanel\}/, 'dragged-mode sizing class passed into SearchPanel');
  });

  it('ChatView wires the full search prop chain into FileExplorer', () => {
    assert.match(chatViewSrc, /searchOpen=\{this\.state\.searchOpen\}/);
    assert.match(chatViewSrc, /onToggleSearch=\{\(\) => this\._setSearchOpen\(!this\.state\.searchOpen\)\}/);
    assert.match(chatViewSrc, /searchGetDirtyPath=\{this\.getOpenFileDirtyPath\}/);
    assert.match(chatViewSrc, /onSearchReplaceApplied=\{\(files\) =>/);
    assert.match(chatViewSrc, /onOpenSearchResult=\{\(path, line, range\) =>/);
    // Result click reveals the file in the tree (ancestors expanded + persisted).
    const handler = chatViewSrc.slice(chatViewSrc.indexOf('onOpenSearchResult='));
    assert.match(handler, /new Set\(prev\.fileExplorerExpandedPaths\)/);
    assert.match(handler, /saveExpandedPaths\(viewProject, this\.state\.fileExplorerExpandedPaths\)/);
  });

  it('FileExplorer header toggle is guarded by onToggleSearch and wired to aria-pressed', () => {
    assert.match(fileExplorerSrc, /\{onToggleSearch && \(\s*<button[\s\S]{0,400}?aria-pressed=\{!!searchOpen\}/);
    assert.ok(fileExplorerSrc.includes("title={t('ui.search')}"), 'toggle reuses the ui.search tooltip');
  });

  it('closing the explorer resets searchOpen (no stale reopen)', () => {
    assert.match(chatViewSrc, /onClose=\{\(\) => \{ this\._setSearchOpen\(false\); this\._setFileExplorerOpen\(false\); \}\}/);
  });

  it('searchOpen persists across refresh via _setSearchOpen + ccv_searchOpen', () => {
    // The toggle/close paths all route through _setSearchOpen (no bare setState),
    // which writes ccv_searchOpen before updating state.
    assert.match(chatViewSrc, /_setSearchOpen\(open\) \{\s*try \{ localStorage\.setItem\('ccv_searchOpen', String\(open\)\); \}/);
    assert.match(chatViewSrc, /localStorage\.getItem\('ccv_searchOpen'\) === 'true'/);
    // The only direct setState({ searchOpen }) left is the one inside _setSearchOpen
    // itself; every call site routes through the helper.
    const directWrites = chatViewSrc.match(/setState\(\{ searchOpen:/g) || [];
    assert.strictEqual(directWrites.length, 1, 'only _setSearchOpen writes searchOpen directly');
  });

  it('SearchPanel embedded mode hides its own header and applies the embedded class', () => {
    assert.ok(searchPanelSrc.includes('embedded'), 'SearchPanel must accept the embedded prop');
    assert.match(searchPanelSrc, /\{!embedded && \(\s*<div className=\{styles\.header\}>/);
    assert.match(searchPanelSrc, /styles\.searchPanel\}\$\{embedded \? ' ' \+ styles\.embedded : ''\}/);
  });

  it('ui.fileExplorer.resizeSearch exists with all 18 locales (sash aria-label)', () => {
    const block = localeBlockOf('ui.fileExplorer.resizeSearch');
    for (const locale of LOCALES) {
      assert.ok(block.includes(`"${locale}":`), `ui.fileExplorer.resizeSearch missing locale ${locale}`);
    }
  });

  it('the new/changed ui.search glob keys exist with all 18 locales', () => {
    for (const key of ['ui.search.filesToInclude', 'ui.search.filesToExclude', 'ui.search.filesGlobHint']) {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `${key} missing locale ${locale}`);
      }
    }
  });
});
