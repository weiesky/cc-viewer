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
//
// Target mode (CLAUDE.md / skill browser modal, isTarget): the menu keeps the
// same actions as the project browser, EXCEPT the chat-only items — the modal
// wires no attach/insert-to-chat callback, so showing them would be dead items.
// Write operations are always offered; the server enforces the write policy
// (isWriteAllowed) and rejects what the location may not mutate, so no client-side
// gating is needed here.
export function buildFileContextMenuItems({
  isDir,
  isRemote,
  scope = 'node',
  isTarget = false,
}) {
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
    // attach/insert-to-chat only make sense where a chat can receive the file —
    // the CLAUDE.md/skill browser modal (isTarget) wires no such callback, so
    // showing them would be dead menu items. Omitted there.
    ...(isTarget ? [] : [
      { key: 'attachToChat', label: t('ui.contextMenu.attachToChat') },
      { key: 'insertPathToChat', label: t('ui.contextMenu.insertPathToChat') },
    ]),
    ...(isRemote ? [{ key: 'download', label: t('ui.contextMenu.downloadToLocal') }] : []),
    { type: 'divider' },
    { key: 'rename', label: t('ui.contextMenu.rename') },
    { key: 'delete', label: t('ui.contextMenu.delete'), danger: true },
  ];
}
