// Shared execution layer for the context-menu keys built in fileContextMenu.js.
// Both the sidebar (FileExplorer.jsx) and the remote file browser modal
// (FileBrowserModal.jsx) create their menu handlers through this factory, so
// behavior stays identical on both surfaces.
//
// renameMode: 'inline' — sidebar tree; renaming happens in the row label (the
//                        surface keeps its own submitRename; the factory only
//                        calls startEditing).
//             'modal'  — FileBrowserModal rows/cells; rename via Modal.confirm
//                        + Input (the modal has no inline-edit infrastructure).
import React from 'react';
import { Modal, Input, message } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { copyTextToClipboard } from '../../utils/terminalClipboard';

// Same Modal.confirm input styling used by the sidebar's new-file/new-dir flows.
const nameInputStyle = {
  background: 'var(--bg-container)',
  borderColor: 'var(--border-primary)',
  color: 'var(--text-secondary)',
  caretColor: 'var(--text-secondary)',
};

// Submit the confirm dialog when Enter is pressed inside the name input.
function confirmOnEnter() {
  document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click();
}

export function createFileMenuHandler({
  path,            // childPath (node scope) or currentPath (container scope; '' = root)
  name,            // item.name (node scope) or '' (container scope)
  isDir,
  renameMode,      // 'inline' | 'modal' (node scope only)
  startEditing,    // inline rename entry point (node scope, renameMode 'inline')
  onFileRenamed,   // (oldPath|null, newPath|null) post-mutation notification
  onAttachToChat,
  onInsertPathToChat,
  onDownload,      // optional; the modal passes its downloadFile helper
}) {
  return ({ key }) => {
    switch (key) {
      case 'reveal':
        // Root container uses the OS call without a path (open-project-dir takes
        // no body and never 400s on ''); any real path uses reveal-file.
        fetch(apiUrl(path ? '/api/reveal-file' : '/api/open-project-dir'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(path ? { body: JSON.stringify({ path }) } : {}),
        }).catch(() => {});
        break;
      case 'openTerminal':
        fetch(apiUrl('/api/open-terminal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        }).catch(() => {});
        break;
      case 'copyPath':
        fetch(apiUrl('/api/resolve-path'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.fullPath) {
              // copyTextToClipboard falls back to a hidden textarea +
              // execCommand('copy') on non-secure origins (LAN HTTP) where
              // navigator.clipboard is undefined — the remote case this menu
              // primarily serves. Success toast only on actual success.
              copyTextToClipboard(data.fullPath)
                .then(ok => { if (ok) message.success(t('ui.copied')); })
                .catch(() => {});
            }
          })
          .catch(() => {});
        break;
      case 'copyRelPath':
        copyTextToClipboard(path || '.')
          .then(ok => { if (ok) message.success(t('ui.copied')); })
          .catch(() => {});
        break;
      case 'attachToChat':
        onAttachToChat?.(path);
        break;
      case 'insertPathToChat':
        onInsertPathToChat?.(path);
        break;
      case 'download': {
        if (onDownload) { onDownload(path, name); break; }
        // Browser-native download via an attachment endpoint. apiUrl carries
        // base path + ?token=.
        const a = document.createElement('a');
        a.href = apiUrl(`/api/download-file?path=${encodeURIComponent(path)}`);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        break;
      }
      case 'rename': {
        if (renameMode === 'inline') { startEditing?.(); break; }
        const inputId = `ccv-rename-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.rename'),
          content: (
            <Input id={inputId} autoFocus defaultValue={name} style={nameInputStyle} onPressEnter={confirmOnEnter} />
          ),
          okText: t('ui.contextMenu.rename'),
          // Failure throws → antd Modal.confirm keeps the dialog open for retry
          // (same pattern as newFile/newDir).
          onOk: async () => {
            const input = document.getElementById(inputId);
            const newName = (input?.value || '').trim();
            if (!newName || newName === name) return;
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/rename-file'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPath: path, newName }),
              });
              const d = await r.json();
              if (r.ok) { if (onFileRenamed) onFileRenamed(path, d.newPath); return; }
              errMsg = d?.error || `HTTP ${r.status}`;
            } catch (err) {
              errMsg = err?.message || 'network error';
            }
            message.error(t('ui.renameFailed', { error: errMsg }));
            throw new Error(errMsg);
          },
        });
        break;
      }
      case 'newFile': {
        const inputId = `ccv-newfile-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newFile'),
          content: (
            <Input id={inputId} autoFocus placeholder={t('ui.contextMenu.newFilePlaceholder')} style={nameInputStyle} onPressEnter={confirmOnEnter} />
          ),
          okText: t('ui.contextMenu.newFile'),
          onOk: async () => {
            const input = document.getElementById(inputId);
            const newName = (input?.value || '').trim();
            if (!newName) throw new Error('Empty filename');
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/create-file'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: path, name: newName }),
              });
              // Use the server's returned path (like rename uses d.newPath):
              // client-side reconstruction diverges if the server normalizes.
              const d = await r.json();
              if (r.ok) { if (onFileRenamed) onFileRenamed(null, d.path); return; }
              errMsg = d?.error || `HTTP ${r.status}`;
            } catch (err) {
              errMsg = err?.message || 'network error';
            }
            message.error(t('ui.contextMenu.createFileFailed', { error: errMsg }));
            throw new Error(errMsg);
          },
        });
        break;
      }
      case 'newDir': {
        const inputId = `ccv-newdir-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newDir'),
          content: (
            <Input id={inputId} autoFocus placeholder={t('ui.contextMenu.newDirPlaceholder')} style={nameInputStyle} onPressEnter={confirmOnEnter} />
          ),
          okText: t('ui.contextMenu.newDir'),
          onOk: async () => {
            const input = document.getElementById(inputId);
            const newName = (input?.value || '').trim();
            if (!newName) throw new Error('Empty dir name');
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/create-dir'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: path, name: newName }),
              });
              // Use the server's returned path (like rename uses d.newPath):
              // client-side reconstruction diverges if the server normalizes.
              const d = await r.json();
              if (r.ok) { if (onFileRenamed) onFileRenamed(null, d.path); return; }
              errMsg = d?.error || `HTTP ${r.status}`;
            } catch (err) {
              errMsg = err?.message || 'network error';
            }
            message.error(t('ui.contextMenu.createDirFailed', { error: errMsg }));
            throw new Error(errMsg);
          },
        });
        break;
      }
      case 'delete':
        Modal.confirm({
          title: isDir ? t('ui.contextMenu.deleteDirConfirm', { name }) : t('ui.contextMenu.deleteConfirm', { name }),
          okType: 'danger',
          okText: t('ui.contextMenu.delete'),
          onOk: async () => {
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/delete-file'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
              });
              if (r.ok) { if (onFileRenamed) onFileRenamed(path, null); return; }
              errMsg = `HTTP ${r.status}`;
              try { const d = await r.json(); if (d?.error) errMsg = d.error; } catch {}
            } catch (err) {
              errMsg = err?.message || 'network error';
            }
            message.error(t('ui.contextMenu.deleteFailed', { error: errMsg }));
            throw new Error(errMsg);
          },
        });
        break;
    }
  };
}
