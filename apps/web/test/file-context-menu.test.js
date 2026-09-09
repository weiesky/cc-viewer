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
