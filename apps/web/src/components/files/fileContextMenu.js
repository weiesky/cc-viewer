// Shared definition of the file-explorer right-click menus.
// Both the sidebar TreeNode (FileExplorer.jsx) and the in-app remote file
// browser (FileBrowserModal.jsx) build their menus from this module, so
// per-file-type customizations added here stay in sync on both surfaces.
// Pure module (no React/antd) so node:test can import it directly.
// The .js extension is required for node ESM resolution (bundlers resolve
// '../../i18n' either way, node does not).
import { t } from '../../i18n.js';

// Scope 'node': full per-entry menu on files/directories (rename/delete included).
// Scope 'container': directory actions only, no rename/delete — used by the
// sidebar header and the modal grid blank area (same item set on both).
export function buildFileContextMenuItems({ isDir, isRemote, scope = 'node' }) {
  if (scope === 'container') {
    return [
      { key: 'reveal', label: t('ui.contextMenu.revealInExplorer') },
      { key: 'openTerminal', label: t('ui.contextMenu.openTerminal') },
      { key: 'newFile', label: t('ui.contextMenu.newFile') },
      { key: 'newDir', label: t('ui.contextMenu.newDir') },
      { type: 'divider' },
      { key: 'copyPath', label: t('ui.contextMenu.copyPath') },
      { key: 'copyRelPath', label: t('ui.contextMenu.copyRelativePath') },
    ];
  }
  if (isDir) {
    return [
      { key: 'reveal', label: t('ui.contextMenu.revealInExplorer') },
      { key: 'openTerminal', label: t('ui.contextMenu.openTerminal') },
      { key: 'newFile', label: t('ui.contextMenu.newFile') },
      { key: 'newDir', label: t('ui.contextMenu.newDir') },
      { type: 'divider' },
      { key: 'copyPath', label: t('ui.contextMenu.copyPath') },
      { key: 'copyRelPath', label: t('ui.contextMenu.copyRelativePath') },
      { type: 'divider' },
      { key: 'rename', label: t('ui.contextMenu.rename') },
      { key: 'delete', label: t('ui.contextMenu.delete'), danger: true },
    ];
  }
  return [
    { key: 'reveal', label: t('ui.contextMenu.revealInExplorer') },
    { key: 'copyPath', label: t('ui.contextMenu.copyPath') },
    { key: 'copyRelPath', label: t('ui.contextMenu.copyRelativePath') },
    { key: 'attachToChat', label: t('ui.contextMenu.attachToChat') },
    { key: 'insertPathToChat', label: t('ui.contextMenu.insertPathToChat') },
    ...(isRemote ? [{ key: 'download', label: t('ui.contextMenu.downloadToLocal') }] : []),
    { type: 'divider' },
    { key: 'rename', label: t('ui.contextMenu.rename') },
    { key: 'delete', label: t('ui.contextMenu.delete'), danger: true },
  ];
}
