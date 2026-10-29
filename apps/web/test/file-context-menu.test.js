/**
 * 共享右键菜单定义（fileContextMenu.js）的直接单元测试。
 *
 * 这是"侧栏 TreeNode 与远程文件浏览弹窗菜单保持一致"的核心保障：
 * 两个界面的菜单都由同一个 buildFileContextMenuItems 生成，按文件类型定制时
 * 改这里即双端同步。纯 .js 模块，node:test 直接 import（.jsx 无法被 node 解析，
 * 动作工厂 fileContextMenuActions.jsx 的接线由 file-browser-modal.test.js 的
 * 源码契约断言钉住）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFileContextMenuItems } from '../src/components/files/fileContextMenu.js';
import { t } from '../src/i18n.js';

// 菜单序列：divider 记为 'divider'，其余取 key。
function seq(items) {
  return items.map(i => (i.type === 'divider' ? 'divider' : i.key));
}

describe('buildFileContextMenuItems — node scope (per-entry menus)', () => {
  it('directory menu matches the sidebar tree dir menu exactly', () => {
    const items = buildFileContextMenuItems({ isDir: true, isRemote: false });
    assert.deepEqual(seq(items), [
      'reveal', 'openTerminal', 'newFile', 'newDir', 'divider',
      'copyPath', 'copyRelPath', 'divider', 'rename', 'delete',
    ]);
    assert.equal(items.at(-1).danger, true, 'delete must stay a danger item');
  });

  it('directory menu is identical regardless of isRemote (no download on dirs)', () => {
    assert.deepEqual(
      seq(buildFileContextMenuItems({ isDir: true, isRemote: true })),
      seq(buildFileContextMenuItems({ isDir: true, isRemote: false })),
    );
  });

  it('file menu matches the sidebar tree file menu exactly (local)', () => {
    const items = buildFileContextMenuItems({ isDir: false, isRemote: false });
    assert.deepEqual(seq(items), [
      'reveal', 'copyPath', 'copyRelPath', 'attachToChat', 'insertPathToChat',
      'divider', 'rename', 'delete',
    ]);
    assert.equal(items.at(-1).danger, true);
  });

  it('file menu inserts download before the divider when remote', () => {
    const items = buildFileContextMenuItems({ isDir: false, isRemote: true });
    assert.deepEqual(seq(items), [
      'reveal', 'copyPath', 'copyRelPath', 'attachToChat', 'insertPathToChat',
      'download', 'divider', 'rename', 'delete',
    ]);
  });

  it('labels come from i18n t()', () => {
    const items = buildFileContextMenuItems({ isDir: true });
    assert.equal(items[0].label, t('ui.contextMenu.revealInExplorer'));
    assert.equal(items.at(-1).label, t('ui.contextMenu.delete'));
    const fileItems = buildFileContextMenuItems({ isDir: false, isRemote: true });
    const download = fileItems.find(i => i.key === 'download');
    assert.equal(download.label, t('ui.contextMenu.downloadToLocal'));
  });
});

describe('buildFileContextMenuItems — container scope (header / blank-area parity)', () => {
  it('matches the sidebar header menu exactly, no rename/delete', () => {
    const items = buildFileContextMenuItems({ isDir: true, isRemote: false, scope: 'container' });
    assert.deepEqual(seq(items), [
      'reveal', 'openTerminal', 'newFile', 'newDir', 'divider', 'copyPath', 'copyRelPath',
    ]);
    assert.ok(!seq(items).includes('rename') && !seq(items).includes('delete'));
    assert.ok(!seq(items).includes('download'));
  });

  it('container scope is identical for files and dirs and ignores isRemote', () => {
    assert.deepEqual(
      seq(buildFileContextMenuItems({ isDir: false, isRemote: true, scope: 'container' })),
      seq(buildFileContextMenuItems({ isDir: true, isRemote: false, scope: 'container' })),
    );
  });
});

describe('buildFileContextMenuItems — target mode (CLAUDE.md / skill browser)', () => {
  // Target mode keeps the FULL menu visible (product decision); write items the
  // current location cannot perform are shown but disabled, not hidden.
  it('keeps the full item sequence in target mode except chat-only items', () => {
    const dirItems = buildFileContextMenuItems({ isDir: true, isRemote: false, isTarget: true });
    assert.deepEqual(seq(dirItems), [
      'reveal', 'openTerminal', 'newFile', 'newDir', 'divider',
      'copyPath', 'copyRelPath', 'divider', 'rename', 'delete',
    ]);
    // The target browser modal wires no attach/insert-to-chat callback, so those
    // two chat-only items are omitted for files (everything else preserved).
    const fileItems = buildFileContextMenuItems({ isDir: false, isRemote: false, isTarget: true });
    assert.deepEqual(seq(fileItems), [
      'reveal', 'copyPath', 'copyRelPath',
      'divider', 'rename', 'delete',
    ]);
  });

  it('keeps write items enabled in target mode (server enforces the write policy)', () => {
    // No client-side gating: the server rejects what the location may not mutate,
    // so the menu always offers the write actions (clearer than a dead disabled item).
    const dirItems = buildFileContextMenuItems({ isDir: true, isTarget: true });
    for (const i of dirItems.filter(x => x.key)) assert.ok(!i.disabled, `${i.key} must stay enabled`);
    const container = buildFileContextMenuItems({ isDir: true, scope: 'container', isTarget: true });
    for (const i of container.filter(x => x.key)) assert.ok(!i.disabled, `${i.key} must stay enabled`);
    // Container scope never has rename/delete.
    assert.ok(!seq(container).includes('rename') && !seq(container).includes('delete'));
  });

  it('non-target default keeps every write item enabled (regression guard)', () => {
    const items = buildFileContextMenuItems({ isDir: true });
    for (const i of items.filter(x => x.key)) assert.ok(!i.disabled, `${i.key} must stay enabled by default`);
  });
});
