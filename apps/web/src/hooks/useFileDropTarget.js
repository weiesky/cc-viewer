import { useState, useRef, useCallback, useEffect } from 'react';
import { isExternalFileDrag, getTopLevelEntries } from '../components/files/importFiles';
import { isInternalMoveDrag, canDropMoveOn } from '../components/files/fileMove';

// Drop target for rows/cells in the file browser modal, accepting two payload
// families:
//  - external OS files (copy): hover highlights the element, drop imports into
//    `targetDir` via onImportFiles (entries extracted synchronously —
//    dataTransfer.items goes stale after the handler returns);
//  - in-project entries (move): when `opts.onMove` is provided, drags marked
//    'text/x-internal-move' highlight the element (dropEffect 'move') and the
//    drop runs the full canDropMoveOn guards before calling
//    onMove(fromPath, targetDir). dragover cannot read getData (HTML5), so the
//    guards only run at drop time — an illegal target still highlights, then
//    silently no-ops, matching the sidebar's behavior.
// stopPropagation keeps events from reaching the grid blank-area handler or
// the layout catch-all. opts.onHoverExpand (directory targets only) fires
// after 500ms of hover, mirroring the sidebar's auto-expand.
export function useFileDropTarget(targetDir, onImportFiles, { onMove, onHoverExpand } = {}) {
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef(null);
  const expandTimer = useRef(null);

  const clearExpandTimer = useCallback(() => {
    if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null; }
  }, []);

  // Unmount mid-drag must not strand a pending expand.
  useEffect(() => clearExpandTimer, [clearExpandTimer]);

  const onDragOver = useCallback((e) => {
    const isExternal = isExternalFileDrag(e);
    const isInternal = onMove && isInternalMoveDrag(e);
    if (!isExternal && !isInternal) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
    setDragOver(true);
    // 500ms hover auto-expand applies to BOTH payload families (sidebar parity:
    // its TreeNode expands for external imports and internal moves alike).
    if (onHoverExpand && !expandTimer.current) {
      expandTimer.current = setTimeout(() => {
        expandTimer.current = null;
        onHoverExpand();
      }, 500);
    }
  }, [onMove, onHoverExpand]);

  const onDragLeave = useCallback((e) => {
    if (ref.current && !ref.current.contains(e.relatedTarget)) {
      setDragOver(false);
      clearExpandTimer();
    }
  }, [clearExpandTimer]);

  const onDrop = useCallback((e) => {
    const isExternal = isExternalFileDrag(e);
    const isInternal = onMove && isInternalMoveDrag(e);
    if (!isExternal && !isInternal) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    clearExpandTimer();
    if (isInternal) {
      const fromPath = e.dataTransfer.getData('text/plain');
      if (canDropMoveOn(fromPath, targetDir)) onMove(fromPath, targetDir);
      return;
    }
    const topEntries = getTopLevelEntries(e.dataTransfer.items);
    const flatFiles = Array.from(e.dataTransfer.files);
    if ((topEntries && topEntries.length > 0) || flatFiles.length > 0) {
      onImportFiles({ topEntries, flatFiles }, targetDir);
    }
  }, [targetDir, onImportFiles, onMove, clearExpandTimer]);

  return { dragOver, ref, onDragOver, onDragLeave, onDrop };
}
