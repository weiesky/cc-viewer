import { message } from 'antd';
import { apiUrl } from '../../utils/apiUrl';

// In-project drag-move helpers shared by the sidebar FileExplorer and the
// remote FileBrowserModal. The dataTransfer contract mirrors the sidebar's
// TreeNode: 'text/x-internal-move' marker + 'text/plain' = project-relative
// fromPath, dropEffect 'move'.

export function isInternalMoveDrag(e) {
  return e.dataTransfer.types.includes('text/x-internal-move');
}

// Guards mirrored from the sidebar TreeNode drop (FileExplorer.jsx): no
// self-drop, no dropping a directory into its own subtree, and no same-dir
// no-op moves. Pure — reused by drop handlers (full check) and available to
// dragover (which cannot read getData, so it can only gate on type + isDir).
export function canDropMoveOn(fromPath, targetDir) {
  if (!fromPath) return false;
  if (fromPath === targetDir) return false;
  if (targetDir.startsWith(fromPath + '/')) return false;
  const fromDir = fromPath.includes('/') ? fromPath.substring(0, fromPath.lastIndexOf('/')) : '';
  if (fromDir === targetDir) return false;
  return true;
}

// POST /api/move-file; on success the caller's onFileRenamed(fromPath, newPath)
// refreshes both the modal and the sidebar (handleAfterMutation / ChatView).
export async function moveFile(fromPath, toDir, { onFileRenamed } = {}) {
  try {
    const res = await fetch(apiUrl('/api/move-file'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromPath, toDir }),
    });
    const data = await res.json();
    if (!res.ok) {
      message.error(data.error || 'Move failed');
      return;
    }
    if (onFileRenamed) onFileRenamed(fromPath, data.newPath);
  } catch (err) {
    message.error(err.message || 'Move failed');
  }
}
