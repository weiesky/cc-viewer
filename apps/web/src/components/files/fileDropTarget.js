import { useState, useRef, useCallback } from 'react';
import { isInternalMoveDrag, canDropMoveOn } from './fileMove';

// In-project move target for plain containers (tree-pane blank area) and
// breadcrumb crumbs — the parts of FileBrowserModal that accept moves but not
// external OS-file imports (rows/cells use hooks/useFileDropTarget instead).
// Returns { dragOver, ref, onDragOver, onDragLeave, onDrop }. The full
// canDropMoveOn guards run at drop time; dragover only gates on the
// internal-move marker (dataTransfer.getData is unavailable mid-drag).
export function useInternalMoveTarget(targetDir, onMove) {
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef(null);

  const onDragOver = useCallback((e) => {
    if (!isInternalMoveDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    if (ref.current && !ref.current.contains(e.relatedTarget)) setDragOver(false);
  }, []);

  const onDrop = useCallback((e) => {
    if (!isInternalMoveDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const fromPath = e.dataTransfer.getData('text/plain');
    if (!fromPath) {
      // Safari/Firefox occasionally return empty getData('text/plain') at drop
      // time; warn so this platform bug is diagnosable (sidebar does the same).
      console.warn('[fileDropTarget] internal-move drop with empty fromPath; ignored');
      return;
    }
    if (canDropMoveOn(fromPath, targetDir)) onMove(fromPath, targetDir);
  }, [targetDir, onMove]);

  return { dragOver, ref, onDragOver, onDragLeave, onDrop };
}
