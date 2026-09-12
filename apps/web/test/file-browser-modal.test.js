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
const GLOBAL_CSS = readFileSync(join(SRC, 'global.css'), 'utf-8');

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
  'ui.fileBrowserModal.upload',
];

// Slice one handler/component body out of a source file so substring checks
// can't be satisfied by a DIFFERENT handler's copy of the same string.
function bodyOf(src, anchor, end = '\n  }, [') {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, `anchor not found: ${anchor}`);
  const j = src.indexOf(end, i);
  assert.ok(j > i, `unterminated block after: ${anchor}`);
  return src.slice(i, j);
}

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
  it('computes isRemote from preferences._isLocal (used by context-menu items)', () => {
    assert.ok(FILE_EXPLORER.includes('preferences?._isLocal === false'),
      'FileExplorer must derive isRemote from preferences._isLocal');
  });
  it('orange folder icon opens the in-app browser for BOTH local and remote (no isRemote branch)', () => {
    assert.ok(FILE_EXPLORER.includes('onClick={() => setFileBrowserOpen(true)}'),
      'OpenFolderIcon at the header must open the FileBrowserModal unconditionally');
    assert.ok(!FILE_EXPLORER.includes('onClick={isRemote ?'),
      'the folder icon onClick must no longer branch on isRemote');
    assert.ok(FILE_EXPLORER.includes('setFileBrowserOpen(true)'),
      'onClick must open the FileBrowserModal');
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

describe('fileIcons type-glyph system', () => {
  it('directory branch returns the solid folder BEFORE any name parsing', () => {
    const dirIdx = FILE_ICONS.indexOf("if (type === 'directory')");
    const catIdx = FILE_ICONS.indexOf('getFileType(name, type)');
    assert.ok(dirIdx >= 0, 'directory guard missing');
    assert.ok(catIdx > dirIdx, 'directory branch must precede category classification (GitChanges empty-name call)');
  });
  it('classifies via fileTypes.getFileType and colors via getExt', () => {
    assert.ok(FILE_ICONS.includes("import { getFileType, getExt } from './fileTypes'"),
      'fileIcons must source classification from fileTypes');
    assert.ok(FILE_ICONS.includes('getFileType(name, type)'), 'classification call missing');
    assert.ok(FILE_ICONS.includes('getExt(name)'), 'ext extraction call missing');
  });
  it('shared base document shape uses strokeWidth 2 + round caps (house style)', () => {
    assert.ok(FILE_ICONS.includes('strokeWidth="2"'), 'base shape must use strokeWidth 2 (upgraded from 1.5)');
    assert.ok(FILE_ICONS.includes('strokeLinecap="round"'), 'round linecap missing');
    assert.ok(FILE_ICONS.includes('strokeLinejoin="round"'), 'round linejoin missing');
  });
  it('defines glyphs for the major non-code categories', () => {
    // Match the exact `key: (c) =>` glyph-factory shape so a renamed/removed
    // entry (e.g. `archive_REMOVED:`) cannot still satisfy a loose substring.
    for (const key of ['code', 'markup', 'data', 'document', 'image', 'video', 'audio', 'archive', 'pdf', 'font', 'binary']) {
      assert.ok(FILE_ICONS.includes(`${key}: (c) =>`), `GLYPH missing ${key}`);
    }
    // office takes (c, ext) for its sub-type badge, assert its exact shape too.
    assert.ok(FILE_ICONS.includes('office: (c, ext) =>'), 'GLYPH missing office');
  });
  it('badge glyphs knock out against the surface color', () => {
    assert.ok(FILE_ICONS.includes('var(--bg-container)'),
      'pdf/office badge interiors must knock out to the surface color, not a hardcoded color');
  });
  it('mobile copies are unified onto the shared module (no drifted EXT_COLORS)', () => {
    const MOBILE_EXPLORER = readFileSync(join(SRC, 'components', 'mobile', 'MobileFileExplorer.jsx'), 'utf-8');
    const MOBILE_GIT = readFileSync(join(SRC, 'components', 'mobile', 'MobileGitDiff.jsx'), 'utf-8');
    for (const [label, src] of [['MobileFileExplorer', MOBILE_EXPLORER], ['MobileGitDiff', MOBILE_GIT]]) {
      assert.ok(src.includes("from '../../utils/fileIcons'"), `${label} must import the shared fileIcons`);
      assert.ok(!src.includes('const EXT_COLORS'), `${label} must not keep a local EXT_COLORS copy`);
      assert.ok(!src.includes('#c09553'), `${label} must not keep the hardcoded folder color`);
    }
  });
});

describe('fileIcons theme-adaptive colors', () => {
  // Extract the three color-table blocks and assert none carry a hardcoded hex
  // — every value must be a var(--file-icon-*) reference so the SAME JSX token
  // resolves per-theme in global.css (no runtime theme check; see teammateAvatars).
  function tableBlock(name) {
    const m = FILE_ICONS.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`));
    return m ? m[1] : null;
  }
  it('EXT_COLORS / CATEGORY_COLORS / OFFICE_COLORS hold no hardcoded hex, only var(--file-icon-*)', () => {
    for (const name of ['EXT_COLORS', 'CATEGORY_COLORS', 'OFFICE_COLORS']) {
      const block = tableBlock(name);
      assert.ok(block, `${name} table not found`);
      assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(block), `${name} must not contain hardcoded hex colors`);
      assert.ok(block.includes('var(--file-icon-'), `${name} must reference var(--file-icon-*)`);
    }
  });
  it('fallback color is a var, not a hardcoded hex', () => {
    assert.ok(!FILE_ICONS.includes("|| '#888888'"), 'hardcoded #888888 fallback must be replaced');
    assert.ok(FILE_ICONS.includes("|| 'var(--file-icon-fallback)'"), 'fallback must be var(--file-icon-fallback)');
  });
  it('core --file-icon-* variables are defined in BOTH the dark and light blocks of global.css', () => {
    const dark = GLOBAL_CSS.match(/:root, \[data-theme="dark"\] \{([\s\S]*?)\n\}/);
    const light = GLOBAL_CSS.match(/\[data-theme="light"\] \{([\s\S]*?)\n\}/);
    assert.ok(dark && light, 'could not isolate dark/light theme blocks');
    for (const v of ['--file-icon-js', '--file-icon-pdf', '--file-icon-office-word',
      '--file-icon-office-excel', '--file-icon-office-ppt', '--file-icon-fallback',
      '--file-icon-archive', '--file-icon-video']) {
      assert.ok(dark[1].includes(`${v}:`), `dark block missing ${v}`);
      assert.ok(light[1].includes(`${v}:`), `light block missing ${v}`);
    }
  });
  it('dark and light values differ for contrast-critical colors (office/js)', () => {
    function valOf(block, v) {
      const m = block.match(new RegExp(`${v.replace('-', '\\-')}\\s*:\\s*([^;]+);`));
      return m ? m[1].trim() : null;
    }
    const dark = GLOBAL_CSS.match(/:root, \[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1];
    const light = GLOBAL_CSS.match(/\[data-theme="light"\] \{([\s\S]*?)\n\}/)[1];
    for (const v of ['--file-icon-office-word', '--file-icon-office-excel', '--file-icon-js']) {
      const d = valOf(dark, v), l = valOf(light, v);
      assert.ok(d && l, `${v} must have both values`);
      assert.notEqual(d, l, `${v} must differ between dark and light for contrast`);
    }
  });
});

describe('modal upload wiring (button + zoned drag-drop)', () => {
  const IMPORT_MODULE = readFileSync(join(SRC, 'components', 'files', 'importFiles.js'), 'utf-8');

  it('both surfaces share the ./importFiles pipeline', () => {
    for (const [label, src] of [['FileExplorer', FILE_EXPLORER], ['FileBrowserModal', FILE_BROWSER_MODAL]]) {
      assert.ok(src.includes("from './importFiles'"), `${label} must import the shared importFiles module`);
    }
    assert.ok(IMPORT_MODULE.includes('export async function importFiles'),
      'importFiles.js must export the upload pipeline');
    assert.ok(IMPORT_MODULE.includes('/api/import-file?dir=${encodeURIComponent('),
      'uploads must go to /api/import-file with an encoded dir param');
  });

  it('modal toolbar has an upload button feeding a hidden multi-file input', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('type="file"'), 'hidden file input missing');
    assert.ok(FILE_BROWSER_MODAL.includes('multiple\n') || FILE_BROWSER_MODAL.includes('multiple '),
      'file input must allow multiple selection');
    assert.ok(FILE_BROWSER_MODAL.includes('onChange={handleUploadPick}'),
      'file input must be wired to handleUploadPick');
    assert.ok(FILE_BROWSER_MODAL.includes("t('ui.fileBrowserModal.upload')"),
      'upload button must use the ui.fileBrowserModal.upload label');
    assert.ok(FILE_BROWSER_MODAL.includes("e.target.value = '';"),
      'input value must reset so re-picking the same file re-fires onChange');
    assert.ok(FILE_BROWSER_MODAL.includes('handleImportFiles(files, currentPath)'),
      'toolbar pick must import into currentPath');
  });

  it('drop targets stopPropagation and extract entries synchronously', () => {
    // Per-handler block assertions (a file-wide occurrence count would let one
    // handler's stopPropagation go missing unnoticed → double-import / bubble).
    const hook = readFileSync(join(SRC, 'hooks', 'useFileDropTarget.js'), 'utf-8');
    const hookDrop = bodyOf(hook, 'const onDrop = useCallback((e) => {');
    assert.ok(hookDrop.includes('e.stopPropagation();'),
      'useFileDropTarget onDrop must stopPropagation (grid blank-area handler would double-fire)');
    assert.ok(hookDrop.includes('getTopLevelEntries(e.dataTransfer.items)'),
      'entries must be extracted synchronously in the drop handler (items go stale async)');
    const gridDropBlock = bodyOf(FILE_BROWSER_MODAL, 'const handleGridDrop = useCallback((e) => {');
    assert.ok(gridDropBlock.includes('getTopLevelEntries(e.dataTransfer.items)'),
      'grid blank drop must extract entries synchronously');
    assert.ok(gridDropBlock.includes('handleImportFiles({ topEntries, flatFiles }, currentPath)'),
      'grid blank area must import into currentPath ("" = project root)');
    assert.ok(FILE_BROWSER_MODAL.includes('onDrop={handleGridDrop}'),
      'grid blank area must wire its own drop handler');
  });

  it('directory rows/cells import into their own path via the shared hook', () => {
    // Directory rows target themselves; file rows target their parent (a drop on
    // a file row must NOT bubble to the tree-pane "move to root" handler).
    assert.ok(FILE_BROWSER_MODAL.includes('useFileDropTarget(isDir ? childPath : parentPathOf(childPath), onImportFiles, {'),
      'ModalTreeNode must resolve its drop target via the shared hook (file rows → parent dir)');
    assert.ok(FILE_BROWSER_MODAL.includes('useFileDropTarget(childPath, onImportFiles, { onMove });'),
      'GridCell must resolve its drop target via the shared hook with onMove');
  });

  it('rows and cells are draggable in-project move sources with the sidebar contract', () => {
    const drags = FILE_BROWSER_MODAL.split('dataTransfer.setData(\'text/x-internal-move\', \'1\')').length - 1;
    assert.equal(drags, 2, 'row and cell onDragStart must both set the text/x-internal-move marker');
    const plains = FILE_BROWSER_MODAL.split("dataTransfer.setData('text/plain', childPath)").length - 1;
    assert.equal(plains, 2, 'row and cell onDragStart must both carry the fromPath as text/plain');
    // Standalone `draggable` lines (the thumbnail's draggable={false} doesn't match).
    const draggableCount = (FILE_BROWSER_MODAL.match(/^\s*draggable$/gm) || []).length;
    assert.equal(draggableCount, 2, 'row and cell elements must both be draggable');
    for (const attr of ['onDragStart={handleDragStartRow}', 'onDragStart={handleDragStartCell}',
      'onDrop={handleDropRow}', 'onDrop={isDir ? handleDropCell : undefined}']) {
      assert.ok(FILE_BROWSER_MODAL.includes(attr), `missing JSX wiring: ${attr}`);
    }
    assert.ok(FILE_BROWSER_MODAL.includes("effectAllowed = 'move'"),
      'in-project drags must advertise move semantics');
  });

  it('the hook internal branch guards then calls onMove', () => {
    const hook = readFileSync(join(SRC, 'hooks', 'useFileDropTarget.js'), 'utf-8');
    const hookDrop = bodyOf(hook, 'const onDrop = useCallback((e) => {');
    assert.ok(hookDrop.includes('if (isInternal) {'), 'internal-move branch missing from the hook drop handler');
    assert.ok(hookDrop.includes('if (canDropMoveOn(fromPath, targetDir)) onMove(fromPath, targetDir);'),
      'internal drop must run canDropMoveOn before onMove');
    const hookOver = bodyOf(hook, 'const onDragOver = useCallback((e) => {');
    assert.ok(hookOver.includes("dropEffect = isExternal ? 'copy' : 'move'"),
      'dragover must advertise copy for external / move for internal');
    assert.ok(hookOver.includes('onHoverExpand && !expandTimer.current'),
      'hover auto-expand must apply to both payload families (sidebar parity)');
  });

  it('in-project move flows through fileMove + handleAfterMutation on both surfaces', () => {
    for (const [label, src] of [['FileExplorer', FILE_EXPLORER], ['FileBrowserModal', FILE_BROWSER_MODAL]]) {
      assert.ok(src.includes("from './fileMove'"), `${label} must import the shared fileMove module`);
    }
    assert.ok(FILE_EXPLORER.includes('moveFile(fromPath, childPath, { onFileRenamed })'),
      'sidebar TreeNode must move via the shared moveFile');
    assert.ok(FILE_EXPLORER.includes("moveFile(fromPath, '', { onFileRenamed })"),
      'sidebar blank area must move to root via the shared moveFile');
    assert.ok(FILE_BROWSER_MODAL.includes('moveFile(fromPath, toDir, { onFileRenamed: handleAfterMutation })'),
      'modal handleMove must refresh modal + sidebar via handleAfterMutation');
    // Exact count: root tree map + root crumb + segment crumbs + GridCell.
    assert.equal(FILE_BROWSER_MODAL.split('onMove={handleMove}').length - 1, 4,
      'onMove must be threaded to the root map, both crumbs and grid cells');
    assert.ok(FILE_BROWSER_MODAL.includes('onMove={onMove}'),
      'ModalTreeNode recursion must thread onMove');
  });

  it('in-project drops are accepted on grid blank, tree blank and breadcrumbs', () => {
    const gridDropBlock = bodyOf(FILE_BROWSER_MODAL, 'const handleGridDrop = useCallback((e) => {');
    assert.ok(gridDropBlock.includes('if (canDropMoveOn(fromPath, currentPath)) handleMove(fromPath, currentPath);'),
      'grid blank internal drop must guard then move into currentPath');
    assert.ok(FILE_BROWSER_MODAL.includes("useInternalMoveTarget('', handleMove)"),
      'tree-pane blank area must move entries to the project root via the shared hook');
    assert.ok(FILE_BROWSER_MODAL.includes('onDrop={handleTreePaneDrop}'),
      'tree pane must wire its blank-area drop handler');
    const crumb = bodyOf(FILE_BROWSER_MODAL, 'function CrumbDropTarget(', '\n}\n');
    assert.ok(crumb.includes('useInternalMoveTarget(path, onMove)'),
      'breadcrumb segments must be move targets via the shared hook');
    assert.ok(crumb.includes('onDrop={onDrop}'), 'crumb must wire the drop handler');
  });

  it('layout catch-all swallows internal-move drags over non-target regions too', () => {
    for (const anchor of ['const handleLayoutDragOver = useCallback((e) => {', 'const handleLayoutDrop = useCallback((e) => {']) {
      assert.ok(bodyOf(FILE_BROWSER_MODAL, anchor).includes('isInternalMoveDrag(e)'),
        `${anchor} must also swallow internal-move drags (else they bubble to FileExplorer = move to root)`);
    }
  });

  it('the modal follows the sidebar refresh signal (cross-surface moves)', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('refreshTrigger = 0'),
      'FileBrowserModal must accept a refreshTrigger prop');
    assert.ok(FILE_BROWSER_MODAL.includes('prevRefreshTrigger.current = refreshTrigger'),
      'modal must refresh when the sidebar-driven counter changes');
    assert.ok(FILE_EXPLORER.includes('refreshTrigger={refreshTrigger}'),
      'FileExplorer must pass its refreshTrigger into the modal');
  });

  it('the refreshTrigger effect is declared after refresh() (minifier TDZ regression)', () => {
    // `const refresh` is in the TDZ at the point of an earlier useEffect whose
    // deps reference it; the minified bundle throws "Cannot access 'refresh'
    // before initialization" on mount (reported by user). Order is load-bearing.
    const effectIdx = FILE_BROWSER_MODAL.indexOf('prevRefreshTrigger.current = refreshTrigger');
    const refreshIdx = FILE_BROWSER_MODAL.indexOf('const refresh = useCallback(() => {');
    assert.ok(effectIdx >= 0 && refreshIdx >= 0, 'expected both the effect and refresh()');
    assert.ok(refreshIdx < effectIdx,
      'const refresh must be declared BEFORE the refreshTrigger effect that uses it');
  });

  it('onImportFiles is threaded into ModalTreeNode, GridCell and the root map', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('onImportFiles={onImportFiles}'),
      'ModalTreeNode recursion must thread onImportFiles');
    assert.ok(FILE_BROWSER_MODAL.includes('onImportFiles={handleImportFiles}'),
      'root map / GridCell must receive handleImportFiles');
  });

  it('layout catch-all swallows external drags over non-target regions', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('onDragOver={handleLayoutDragOver} onDrop={handleLayoutDrop}'),
      'the modal layout must have a drag catch-all (no bubble to FileExplorer, no navigation)');
  });

  it('uploads refresh the modal and the sidebar via handleAfterMutation', () => {
    assert.ok(FILE_BROWSER_MODAL.includes('importFiles(payload, targetDir, { onFileRenamed: handleAfterMutation })'),
      'handleImportFiles must inject handleAfterMutation as onFileRenamed');
  });

  it('sidebar container handlers ignore drags over antd portals', () => {
    const guardCount = FILE_EXPLORER.split('isOverModalPortal(e)').length - 1;
    assert.ok(guardCount >= 2,
      `both handleContainerDragOver and handleContainerDrop must guard with isOverModalPortal, got ${guardCount}`);
    assert.ok(FILE_EXPLORER.includes("from '../../utils/dragGuards'"),
      'FileExplorer must import isOverModalPortal');
  });

  it('sidebar external-drag highlight class is wired (was dead CSS)', () => {
    assert.ok(FILE_EXPLORER.includes("externalDragOver ? ' ' + styles.fileExplorerDragOver : ''"),
      'externalDragOver must apply styles.fileExplorerDragOver to the container');
  });

  it('no !important anywhere in the touched CSS modules', () => {
    for (const file of ['FileBrowserModal.module.css', 'FileExplorer.module.css']) {
      const css = readFileSync(join(SRC, 'components', 'files', file), 'utf-8');
      assert.ok(!css.includes('!important'), `${file} must not use !important`);
    }
  });
});
