/**
 * Web 文件浏览器弹窗（FileBrowserModal）的源码契约测试。
 *
 * apps/web/test 无 React 渲染环境（node:test, 无 jsdom），与
 * quick-settings-i18n.test.js 同款：直接读源码断言关键接线不回退。
 * 覆盖：
 * 1. 6 个新增 i18n key 的 18 语言完整性；
 * 2. FileExplorer 的远程降级触发接线（_isLocal === false → onClick 打开弹窗）；
 * 3. OpenFolderIcon 的 onClick 覆盖契约（先于 fetch 调用）；
 * 4. FileBrowserModal 的关键 import / 分支 / z-index / 路径编码契约；
 * 5. fileIcons 的 size 默认参数。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const LOCALES = ['zh', 'en', 'zh-TW', 'ko', 'ja', 'de', 'es', 'fr', 'it', 'da', 'pl', 'ru', 'ar', 'no', 'pt-BR', 'th', 'tr', 'uk'];
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const I18N_SRC = readFileSync(join(SRC, 'i18n.js'), 'utf-8');
const FILE_EXPLORER = readFileSync(join(SRC, 'components', 'files', 'FileExplorer.jsx'), 'utf-8');
const OPEN_FOLDER_ICON = readFileSync(join(SRC, 'components', 'common', 'OpenFolderIcon.jsx'), 'utf-8');
const FILE_BROWSER_MODAL = readFileSync(join(SRC, 'components', 'files', 'FileBrowserModal.jsx'), 'utf-8');
const FILE_ICONS = readFileSync(join(SRC, 'utils', 'fileIcons.jsx'), 'utf-8');

// 与 quick-settings-i18n.test.js 的 localeBlockOf 同款。
function localeBlockOf(key) {
  const start = I18N_SRC.indexOf(`"${key}": {`);
  assert.ok(start >= 0, `key ${key} not found in src/i18n.js`);
  const end = I18N_SRC.indexOf('\n  }', start);
  assert.ok(end > start, `unterminated block for ${key}`);
  return I18N_SRC.slice(start, end);
}

const I18N_KEYS = [
  'ui.fileBrowserModal.title',
  'ui.fileBrowserModal.up',
  'ui.fileBrowserModal.root',
  'ui.fileBrowserModal.empty',
  'ui.fileBrowserModal.loadFailed',
  'ui.fileBrowserModal.gitIgnored',
];

describe('file browser modal i18n — all 18 locales', () => {
  for (const key of I18N_KEYS) {
    it(`${key} translated in every locale`, () => {
      const block = localeBlockOf(key);
      for (const locale of LOCALES) {
        assert.ok(block.includes(`"${locale}":`), `missing ${locale} translation for ${key}`);
      }
    });
  }

  it('every ui.fileBrowserModal.* key is used by the component (and vice versa)', () => {
    const used = new Set([...FILE_BROWSER_MODAL.matchAll(/t\('(ui\.fileBrowserModal\.[^']+)'\)/g)].map(m => m[1]));
    assert.deepEqual([...used].sort(), [...I18N_KEYS].sort(),
      't() keys in FileBrowserModal.jsx must match the defined i18n keys exactly');
  });
});

describe('FileExplorer remote fallback trigger wiring', () => {
  it('computes isRemote from preferences._isLocal', () => {
    assert.ok(FILE_EXPLORER.includes('preferences?._isLocal === false'),
      'FileExplorer must derive isRemote from preferences._isLocal');
  });
  it('orange folder icon gets a remote-conditional onClick', () => {
    assert.ok(FILE_EXPLORER.includes('onClick={isRemote ?'),
      'OpenFolderIcon at the header must receive onClick={isRemote ? ... : undefined}');
    assert.ok(FILE_EXPLORER.includes('setFileBrowserOpen(true)'),
      'remote onClick must open the FileBrowserModal');
  });
  it('renders FileBrowserModal and shared HtmlPreviewModal', () => {
    assert.ok(FILE_EXPLORER.includes('import FileBrowserModal'), 'FileBrowserModal import missing');
    assert.ok(FILE_EXPLORER.includes('<FileBrowserModal'), 'FileBrowserModal not rendered');
    assert.ok(FILE_EXPLORER.includes('<HtmlPreviewModal'), 'html preview must use the shared HtmlPreviewModal');
  });
});

describe('OpenFolderIcon onClick override contract', () => {
  it('destructures onClick and calls it before the fetch fallback', () => {
    assert.ok(OPEN_FOLDER_ICON.includes('onClick'), 'onClick prop missing');
    const callIdx = OPEN_FOLDER_ICON.indexOf('if (onClick) { onClick(e); return; }');
    const fetchIdx = OPEN_FOLDER_ICON.indexOf('fetch(apiEndpoint');
    assert.ok(callIdx >= 0, 'onClick guard missing');
    assert.ok(fetchIdx > callIdx, 'onClick must run before the fetch fallback');
  });
});

describe('FileBrowserModal wiring contract', () => {
  it('reuses shared utilities and viewers', () => {
    for (const token of [
      "from '../../utils/fileIcons'",
      "from '../../utils/commandValidator'",
      "from '../../utils/fileOpen'",
      "from '../common/HtmlPreviewModal'",
      "from '../viewers/ImageViewer'",
      "from './FileContentView'",
      "from 'antd'",
    ]) {
      assert.ok(FILE_BROWSER_MODAL.includes(token), `missing import ${token}`);
    }
  });
  it('uses the blurred mask values inline (same look as the approval overlay, without joining the allowlist)', () => {
    assert.ok(!FILE_BROWSER_MODAL.includes('BLUR_' + 'MASK_STYLE'),
      'blurred-mask consumer set is guarded by modal-mask.test.js — keep the values inline');
    assert.ok(FILE_BROWSER_MODAL.includes("backdropFilter: 'blur(2px)'"),
      'mask must include the 2px backdrop blur');
  });
  it('fetches directory listings through apiUrl + encodeURIComponent', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('apiUrl(`/api/files?path=${encodeURIComponent('),
      'directory fetch must go through apiUrl + encodeURIComponent');
    assert.ok(!FILE_BROWSER_MODAL.includes("'..'") && !FILE_BROWSER_MODAL.includes('".."'),
      'no raw .. path construction allowed');
  });
  it('html branch and tryOpenWithSystem run before setPreviewFile', () => {
    const htmlIdx = FILE_BROWSER_MODAL.indexOf('setHtmlPreviewPath(childPath)');
    const sysIdx = FILE_BROWSER_MODAL.indexOf("tryOpenWithSystem(childPath, 'file-explorer')");
    const prevIdx = FILE_BROWSER_MODAL.indexOf('setPreviewFile(childPath)');
    assert.ok(htmlIdx >= 0 && sysIdx >= 0 && prevIdx >= 0, 'openItem branches missing');
    assert.ok(htmlIdx < sysIdx && sysIdx < prevIdx, 'openItem branch order must be html → system → in-modal preview');
  });
  it('z-index layering: browser modal 1100, nested html preview 1120', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('zIndex={1100}'), 'browser modal must stay at zIndex 1100');
    assert.ok(FILE_BROWSER_MODAL.includes('zIndex={1120}'), 'nested HtmlPreviewModal must be at zIndex 1120');
  });
  it('double-click opens, single-click only selects', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('onDoubleClick={() => onOpen(item)}'),
      'grid cells must open on double-click');
    assert.ok(FILE_BROWSER_MODAL.includes('onClick={() => onSelect(childPath)}'),
      'grid cells must only select on single-click');
  });
  it('office/pdf double-click downloads instead of no-op system open on the remote host', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('downloadFile(childPath, item.name)'),
      'system-open branch must fall back to a browser download (remote host has no GUI)');
    assert.ok(FILE_BROWSER_MODAL.includes('`/api/download-file?path=${encodeURIComponent(childPath)}`'),
      'download must go through the attachment endpoint');
  });
  it('stale fetch responses cannot overwrite a newer navigation', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('gridReqSeq'),
      'grid loads must be sequence-guarded against out-of-order responses');
    assert.ok(FILE_BROWSER_MODAL.includes('seq === gridReqSeq.current'),
      'only the latest request may setState');
  });
  it('closing the modal mid-flight blocks setState (alive ref)', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('alive.current = false'),
      'close path must clear the alive ref');
    assert.ok(FILE_BROWSER_MODAL.includes('alive.current && seq === gridReqSeq.current'),
      'grid setState must be guarded by alive.current');
  });
  it('tree pane remounts on cache invalidation (stale expanded nodes)', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('key={cacheEpoch}'),
      'tree pane must be keyed by cacheEpoch so expanded nodes refetch on refresh/reopen');
  });
  it('swallowed fetches report via reportSwallowed', () => {
    const reports = [...FILE_BROWSER_MODAL.matchAll(/reportSwallowed\('([^']+)'/g)].map(m => m[1]);
    assert.deepEqual(reports.sort(),
      ['fileBrowserGrid', 'fileBrowserTreeNode', 'fileBrowserTreeRoot'],
      'tree-node, tree-root and grid fetches must all call reportSwallowed');
  });
  it('cache is invalidated on reopen and via a refresh control', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('treeCache.current.clear()'),
      'cache clear missing');
    assert.ok(FILE_BROWSER_MODAL.includes('setCacheEpoch'),
      'cache epoch bump missing (refresh + reopen)');
    assert.ok(FILE_BROWSER_MODAL.includes("t('ui.fileExplorer.refresh')"),
      'toolbar must expose a refresh button reusing ui.fileExplorer.refresh');
  });
});

describe('shared context menu wiring (sidebar tree ≡ modal)', () => {
  it('both surfaces import the shared definition and action modules', () => {
    for (const [label, src] of [['FileExplorer', FILE_EXPLORER], ['FileBrowserModal', FILE_BROWSER_MODAL]]) {
      assert.ok(src.includes("from './fileContextMenu.js'") || src.includes("from './fileContextMenu'"),
        `${label} must import the shared menu definition`);
      assert.ok(src.includes("from './fileContextMenuActions'"),
        `${label} must import the shared menu action factory`);
    }
  });
  it('both surfaces call the builder with identical per-entry args', () => {
    // The hard requirement "两边始终保持一致": a divergent call site (dropping
    // isRemote, appending a modal-only item) must fail the suite.
    assert.ok(FILE_EXPLORER.includes('buildFileContextMenuItems({ isDir, isRemote })'),
      'sidebar TreeNode must call the builder with { isDir, isRemote }');
    assert.ok(FILE_BROWSER_MODAL.includes('buildFileContextMenuItems({ isDir, isRemote })'),
      'modal must call the builder with the identical { isDir, isRemote }');
  });
  it('modal derives isRemote with the same expression as the sidebar', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('preferences?._isLocal === false'),
      'modal must derive isRemote from preferences._isLocal (same as FileExplorer)');
  });
  it('rename wiring: inline in the sidebar tree, Modal.confirm in the modal', () => {
    assert.ok(FILE_EXPLORER.includes("renameMode: 'inline'"),
      'sidebar TreeNode must keep inline rename');
    assert.ok(FILE_BROWSER_MODAL.includes("renameMode: 'modal'"),
      'modal must use renameMode modal (no inline-edit infrastructure)');
  });
  it('modal renders context-menu Dropdowns on rows, cells and the blank area', () => {
    const triggers = FILE_BROWSER_MODAL.split("trigger={['contextMenu']}").length - 1;
    assert.ok(triggers >= 3, `expected ≥3 contextMenu Dropdowns (rows/cells/blank area), got ${triggers}`);
    assert.ok(FILE_BROWSER_MODAL.includes('e.stopPropagation();'),
      'grid cells must stopPropagation on contextmenu or the blank-area menu also opens');
  });
  it('FileExplorer threads the chat callbacks and refresh into the modal', () => {
    for (const token of ['onAttachToChat={onAttachToChat}', 'onInsertPathToChat={onInsertPathToChat}', 'onFileRenamed={onFileRenamed}']) {
      assert.ok(FILE_EXPLORER.includes(token), `FileBrowserModal render must receive ${token}`);
    }
    assert.ok(FILE_BROWSER_MODAL.includes('handleAfterMutation'),
      'modal must refresh itself + the sidebar after mutations');
  });
  it('handleAfterMutation prefix-clamps currentPath and clears dead previews', () => {
    // Deleting/renaming an ANCESTOR of the browsed directory must not strand
    // the modal on a dead path (tree rows can delete dirs the grid is inside).
    assert.ok(FILE_BROWSER_MODAL.includes("prev.startsWith(oldPath + '/')"),
      'handleAfterMutation must prefix-clamp descendant paths');
    assert.ok(FILE_BROWSER_MODAL.includes('setHtmlPreviewPath(prev =>'),
      'htmlPreviewPath must be remapped/cleared on mutation');
    assert.ok(FILE_BROWSER_MODAL.includes("setCurrentPath('')"),
      'reopen must reset currentPath to the project root');
  });
  it('clipboard copies go through copyTextToClipboard (LAN HTTP fallback)', () => {
    const ACTIONS = readFileSync(join(SRC, 'components', 'files', 'fileContextMenuActions.jsx'), 'utf-8');
    assert.ok(ACTIONS.includes('copyTextToClipboard'),
      'copy actions must use copyTextToClipboard (execCommand fallback on non-secure origins)');
    assert.ok(!ACTIONS.includes('navigator.clipboard.writeText'),
      'no bare navigator.clipboard.writeText (undefined on LAN HTTP)');
  });
  it('container scope drives the modal blank-area menu (same as sidebar header)', () => {
    assert.ok(FILE_BROWSER_MODAL.includes("scope: 'container'"),
      'grid blank area must use the shared container menu');
    assert.ok(FILE_EXPLORER.includes("scope: 'container'"),
      'sidebar header must use the shared container menu');
  });
  it('sidebar tree blank area below the list opens the header (container) menu', () => {
    assert.ok(FILE_EXPLORER.includes('treeBlankArea'),
      'FileExplorer must render a blank filler below the tree rows');
    assert.ok(FILE_EXPLORER.includes('menu={{ items: headerMenuItems, onClick: handleHeaderMenuClick }}'),
      'blank area must reuse the header menu wiring');
    const CSS = readFileSync(join(SRC, 'components', 'files', 'FileExplorer.module.css'), 'utf-8');
    assert.ok(/\.treeContainer\s*\{[^}]*display:\s*flex/.test(CSS),
      'treeContainer must be a flex column so the blank filler absorbs leftover height');
    assert.ok(/\.treeBlankArea\s*\{[^}]*flex:\s*1/.test(CSS),
      'treeBlankArea must flex: 1 to fill the leftover space');
  });
  it('grid cells use the memoized GridCell component', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('function GridCell('),
      'grid cells must be a memoized component (no per-render menu closures in the map)');
    assert.ok(FILE_BROWSER_MODAL.includes('menuCtx={cellMenuCtx}'),
      'GridCell must receive the stable cellMenuCtx bundle');
  });
  it('image cells render lazy thumbnails via /api/file-raw with icon fallback', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('THUMBNAIL_EXTS'),
      'thumbnail extension set missing');
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'ico', 'webp', 'avif']) {
      assert.ok(FILE_BROWSER_MODAL.includes(`'${ext}'`), `thumbnail set must include ${ext}`);
    }
    assert.ok(!/icns/.test(FILE_BROWSER_MODAL.match(/THUMBNAIL_EXTS = new Set\(\[[^\]]*\]\)/)?.[0] || ''),
      'icns must NOT be in the thumbnail set (browsers cannot decode it)');
    assert.ok(FILE_BROWSER_MODAL.includes('loading="lazy"'),
      'thumbnails must lazy-load (large directories)');
    assert.ok(FILE_BROWSER_MODAL.includes('onError={() => setThumbFailed(true)}'),
      'failed thumbnails must fall back to the file icon');
  });
});

describe('fileIcons size param', () => {
  it('getFileIcon has size = 14 default', () => {
    assert.ok(FILE_ICONS.includes('getFileIcon(name, type, size = 14)'),
      'getFileIcon must accept an optional size defaulting to 14');
  });
});
