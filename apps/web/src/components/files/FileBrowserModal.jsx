import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { Modal, Dropdown } from 'antd';
import { t } from '../../i18n';
import { apiUrl, withViewParams, withTargetParams } from '../../utils/apiUrl';
import { getFileIcon } from '../../utils/fileIcons';
import { isImageFile } from '../../utils/commandValidator';
import { tryOpenWithSystem, isSystemOpenFile } from '../../utils/fileOpen';
import { reportSwallowed } from '../../utils/errorReport';
import { isMobile } from '../../env';
import { SettingsContext } from '../../contexts/SettingsContext';
import { buildFileContextMenuItems } from './fileContextMenu';
import { createFileMenuHandler } from './fileContextMenuActions';
import { importFiles, isExternalFileDrag, getTopLevelEntries } from './importFiles';
import { moveFile, isInternalMoveDrag, canDropMoveOn } from './fileMove';
import { useInternalMoveTarget } from './fileDropTarget';
import { useFileDropTarget } from '../../hooks/useFileDropTarget';
import HtmlPreviewModal from '../common/HtmlPreviewModal';
import ImageViewer from '../viewers/ImageViewer';
import FileContentView from './FileContentView';
import styles from './FileBrowserModal.module.css';

/**
 * Web-based OS-style file browser modal: left tree + right icon grid.
 * Remote/container fallback for the "open project dir in OS file manager"
 * button — the server host has no GUI, so browsing happens in-page instead.
 * Client-side paths never leave the project root (no dot-dot segment is ever
 * built); the server additionally rejects dot-dot and absolute paths in /api/files.
 */

function targetFilesUrl(target, path) {
  const params = new URLSearchParams({ kind: target.kind });
  if (target.kind === 'claude-md') params.set('id', target.id);
  else {
    params.set('source', target.source);
    params.set('targetPath', target.path);
  }
  if (path) params.set('path', path);
  return `/api/target-files?${params.toString()}`;
}

function parentPathOf(path) {
  if (!path) return '';
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

function ancestorsOf(path) {
  const out = [];
  let p = parentPathOf(path);
  while (p) {
    out.push(p);
    p = parentPathOf(p);
  }
  return out;
}

// Browser-native download via the attachment endpoint (same pattern as the
// sidebar's remote-only "Download to local" item in FileExplorer.jsx).
// apiUrl carries base path + ?token=.
function downloadFile(childPath, name, project, instance) {
  const a = document.createElement('a');
  a.href = apiUrl(withViewParams(`/api/download-file?path=${encodeURIComponent(childPath)}`, { project, instance }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Activate a click handler from the keyboard (Enter/Space), matching the
// repo's icon-button a11y pattern (OpenFolderIcon / desktop TreeNode rows).
function handleActivationKey(handler) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler(e);
    }
  };
}

// Breadcrumb segment as an in-project move target: dropping a dragged entry on
// a crumb moves it into that directory (root crumb '' = project root). The
// full canDropMoveOn guards run at drop time; dragover only gates on the
// internal-move marker (getData is unavailable mid-drag).
function CrumbDropTarget({ label, path, link, onNavigate, onMove, title, readOnly = false }) {
  const { dragOver, ref: crumbRef, onDragOver, onDragLeave, onDrop } = useInternalMoveTarget(path, onMove);
  const interactive = !!link;
  return (
    <span
      ref={crumbRef}
      className={`${styles.crumb} ${interactive ? styles.crumbLink : ''} ${dragOver ? styles.crumbDragOver : ''}`}
      onClick={interactive ? () => onNavigate(path) : undefined}
      onKeyDown={interactive ? handleActivationKey(() => onNavigate(path)) : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={title}
      onDragOver={readOnly ? undefined : onDragOver}
      onDragLeave={readOnly ? undefined : onDragLeave}
      onDrop={readOnly ? undefined : onDrop}
    >
      {label}
    </span>
  );
}

function ModalTreeNode({ item, path, depth, expandedPaths, onToggleExpand, onNavigate, onSelectFile, currentPath, selectedPath, treeCache, cacheEpoch, isRemote, onFileRenamed, onAttachToChat, onInsertPathToChat, onImportFiles, onMove, project, instance, target, readOnly }) {  const childPath = path ? `${path}/${item.name}` : item.name;
  const isDir = item.type === 'directory';
  const expanded = expandedPaths.has(childPath);
  const isGitIgnored = item.gitIgnored || false;
  const cached = treeCache.current.get(childPath);
  const [children, setChildren] = useState(cached || null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // The current-dir highlight hides while any entry is explicitly selected —
  // two highlighted rows would compete visually.
  const isCurrentDir = isDir && currentPath === childPath && !selectedPath;
  const isSelectedFile = !isDir && selectedPath === childPath;

  useEffect(() => {
    if (isDir && expanded && children === null && !loading) {
      setLoading(true);
      setLoadFailed(false);
      const requestPath = target ? targetFilesUrl(target, childPath) : `/api/files?path=${encodeURIComponent(childPath)}`;
      fetch(apiUrl(withViewParams(requestPath, { project, instance })))
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(data => {
          const entries = target ? data.entries : data;
          if (!Array.isArray(entries)) throw new Error('Invalid directory response');
          treeCache.current.set(childPath, entries);
          setChildren(entries);
          setLoading(false);
        })
        // Collapse + re-expand the arrow retries the fetch (children stays null).
        .catch((err) => { reportSwallowed('fileBrowserTreeNode', err); setLoading(false); setLoadFailed(true); });
    }
  }, [expanded, cacheEpoch, target, project, instance]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRowClick = useCallback(() => {
    if (isDir) {
      onNavigate(childPath);
    } else {
      // Reveal the file in the grid: navigate to its parent and select it.
      onSelectFile(childPath);
    }
  }, [isDir, childPath, onNavigate, onSelectFile]);

  const handleArrowClick = useCallback((e) => {
    e.stopPropagation();
    if (isDir) onToggleExpand(childPath);
  }, [isDir, childPath, onToggleExpand]);

  // Right-click menu — identical definition/actions as the sidebar tree, with
  // rename via Modal.confirm (the modal has no inline-edit infrastructure).
  // Enabled in target mode too (product decision); the server enforces the write
  // policy, so the client offers every action and lets the server reject what the
  // location may not mutate.
  // Rendered inside the Modal, so antd's zIndexContext stacks the dropdown
  // above it automatically (1100 + 50 = 1150; do not hardcode overlayStyle).
  const contextMenuItems = useMemo(
    () => buildFileContextMenuItems({ isDir, isRemote, isTarget: !!target }),
    [isDir, isRemote, target]);
  const handleMenuClick = useMemo(
    () => createFileMenuHandler({
      path: childPath, name: item.name, isDir, renameMode: 'modal',
      onFileRenamed, onAttachToChat, onInsertPathToChat, project, instance, target,
      // Target entries carry absPath; download it so a navigation-root-relative
      // childPath is never misresolved against the project view root (matches the
      // grid cell's download wiring).
      onDownload: (p, n) => downloadFile(item.absPath || p, n, project, instance),
    }),
    [childPath, item.name, item.absPath, isDir, onFileRenamed, onAttachToChat, onInsertPathToChat, project, instance, target]);

  // Drop target: external OS files import into THIS directory (a file row
  // means its parent — sidebar parity); in-project entries
  // (text/x-internal-move) move into it. Directory rows also auto-expand after
  // 500ms of hover. stopPropagation inside the hook keeps events from the
  // tree-pane/layout handlers (a drop on a FILE row must not bubble to the
  // tree-pane "move to root" handler).
  const [dragging, setDragging] = useState(false);
  const { dragOver, ref: rowRef, onDragOver: handleDragOverRow, onDragLeave: handleDragLeaveRow, onDrop: handleDropRow } =
    useFileDropTarget(isDir ? childPath : parentPathOf(childPath), onImportFiles, {
      onMove: isDir ? onMove : undefined,
      onHoverExpand: isDir && !expanded ? () => onToggleExpand(childPath) : undefined,
    });

  // Rows are draggable like OS file-manager entries. The dataTransfer contract
  // matches the sidebar's, but while this modal is open its wrap overlays the
  // sidebar (portal), so cross-panel drops only work after closing the modal.
  const handleDragStartRow = useCallback((e) => {
    e.dataTransfer.setData('text/plain', childPath);
    e.dataTransfer.setData('text/x-internal-move', '1');
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }, [childPath]);
  const handleDragEndRow = useCallback(() => setDragging(false), []);

  return (
    <>
      <Dropdown menu={{ items: contextMenuItems, onClick: handleMenuClick }} trigger={['contextMenu']}>
        <div
          ref={rowRef}
          className={`${styles.treeItem} ${isCurrentDir ? styles.treeItemCurrent : ''} ${isSelectedFile ? styles.treeItemSelected : ''} ${isGitIgnored ? styles.treeItemIgnored : ''} ${dragOver ? styles.treeItemDragOver : ''} ${dragging ? styles.treeItemDragging : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={handleRowClick}
          onKeyDown={handleActivationKey(handleRowClick)}
          role="treeitem"
          aria-expanded={isDir ? expanded : undefined}
          tabIndex={0}
          title={item.name}
          draggable={!readOnly}
          onDragStart={readOnly ? undefined : handleDragStartRow}
          onDragEnd={readOnly ? undefined : handleDragEndRow}
          onDragOver={readOnly ? undefined : handleDragOverRow}
          onDragLeave={readOnly ? undefined : handleDragLeaveRow}
          onDrop={readOnly ? undefined : handleDropRow}
        >
        {isDir ? (
          <span
            className={`${styles.arrow} ${expanded ? styles.arrowExpanded : ''}`}
            onClick={handleArrowClick}
            onKeyDown={handleActivationKey(handleArrowClick)}
            role="button"
            tabIndex={0}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </span>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        <span className={styles.treeIcon}>{getFileIcon(item.name, item.type, 14)}</span>
        <span className={styles.treeName}>{item.name}</span>
        {loading && <span className={styles.treeLoading}>...</span>}
        {loadFailed && <span className={styles.treeFailed} title={t('ui.fileBrowserModal.loadFailed')}>!</span>}
        </div>
      </Dropdown>
      {isDir && expanded && children && children.map(child => (
        <ModalTreeNode
          key={child.name}
          item={child}
          path={childPath}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          onNavigate={onNavigate}
          onSelectFile={onSelectFile}
          currentPath={currentPath}
          selectedPath={selectedPath}
          treeCache={treeCache}
          cacheEpoch={cacheEpoch}
          isRemote={isRemote}
          onFileRenamed={onFileRenamed}
          onAttachToChat={onAttachToChat}
          onInsertPathToChat={onInsertPathToChat}
          onImportFiles={onImportFiles}
          onMove={onMove}
          project={project}
          instance={instance}
          target={target}
          readOnly={readOnly}
        />
      ))}
    </>
  );
}

// Grid thumbnails: all image types the app knows (commandValidator IMAGE_EXTS)
// that /api/file-raw also serves inline with an image MIME (files-content.js
// FILE_RAW_MIME). icns is excluded — browsers can't decode it. svg is fine
// inside <img> (scripts don't execute in image context).
const THUMBNAIL_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'ico', 'webp', 'avif']);

function isThumbnailFile(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  return THUMBNAIL_EXTS.has(ext);
}

// One grid cell with its own (memoized) context menu — building the menu and
// handler inside entries.map would recreate O(n) closures on every render.
// The menu items depend on (isDir, isRemote, target); the handler binds the path.
function GridCell({ item, childPath, isSelected, isGitIgnored, isRemote, onSelect, onOpen, menuCtx, onImportFiles, onMove, project, instance, readOnly, target }) {
  const isDir = item.type === 'directory';
  // Image cells render a real thumbnail (lazy-loaded; falls back to the file
  // icon on error, e.g. oversized >10MB or unreadable file).
  const showThumb = !isDir && isThumbnailFile(item.name);
  const [thumbFailed, setThumbFailed] = useState(false);
  // Drop target: external files import into THIS directory; in-project entries
  // move into it. stopPropagation (inside the hook) keeps the grid blank-area
  // handler from also firing (it would import/move into currentPath instead).
  const [dragging, setDragging] = useState(false);
  const { dragOver, ref: cellRef, onDragOver: handleDragOverCell, onDragLeave: handleDragLeaveCell, onDrop: handleDropCell } =
    useFileDropTarget(childPath, onImportFiles, { onMove });

  // Cells are draggable (OS file-manager style in-project move). Same
  // dataTransfer contract as the sidebar tree → drops there work too.
  const handleDragStartCell = useCallback((e) => {
    e.dataTransfer.setData('text/plain', childPath);
    e.dataTransfer.setData('text/x-internal-move', '1');
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }, [childPath]);
  const handleDragEndCell = useCallback(() => setDragging(false), []);
  // Per-cell menu: identical to the sidebar tree's entry menu (shared
  // builder/factory), rename via Modal.confirm. Enabled in target mode; the
  // server enforces the write policy.
  const menuItems = useMemo(() => buildFileContextMenuItems({ isDir, isRemote, isTarget: !!target }), [isDir, isRemote, target]);
  const handleCellMenuClick = useMemo(
    () => createFileMenuHandler({
      path: childPath, name: item.name, isDir, renameMode: 'modal',
      onFileRenamed: menuCtx.onFileRenamed, onAttachToChat: menuCtx.onAttachToChat,
      onInsertPathToChat: menuCtx.onInsertPathToChat,
      // Target entries carry an absPath (the read route resolves it); download
      // that, falling back to the relative childPath for project entries.
      onDownload: (path, name) => downloadFile(item.absPath || path, name, project, instance),
      project, instance, target,
    }),
    [childPath, item.name, item.absPath, isDir, menuCtx, project, instance, target]);

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleCellMenuClick }} trigger={['contextMenu']}>
      <div
        ref={cellRef}
        className={`${styles.cell} ${isSelected ? styles.cellSelected : ''} ${isGitIgnored ? styles.cellIgnored : ''} ${dragOver ? styles.cellDragOver : ''} ${dragging ? styles.cellDragging : ''}`}
        onClick={() => { onSelect(childPath); if (isMobile) onOpen(item); }}
        onDoubleClick={() => onOpen(item)}
        onKeyDown={handleActivationKey(() => onOpen(item))}
        role="button"
        tabIndex={0}
        draggable={!readOnly}
        onDragStart={readOnly ? undefined : handleDragStartCell}
        onDragEnd={readOnly ? undefined : handleDragEndCell}
        onDragOver={isDir && !readOnly ? handleDragOverCell : undefined}
        onDragLeave={isDir && !readOnly ? handleDragLeaveCell : undefined}
        onDrop={isDir && !readOnly ? handleDropCell : undefined}
        // rc-trigger prevents default but does NOT stop propagation:
        // without this the cell's right-click would also open the
        // blank-area container menu. Also select-on-right-click
        // (Finder-style).
        onContextMenu={(e) => { e.stopPropagation(); onSelect(childPath); }}
        title={isGitIgnored ? `${item.name} (${t('ui.fileBrowserModal.gitIgnored')})` : item.name}
      >
        <span className={styles.cellIcon}>
          {showThumb && !thumbFailed ? (
            <img
              className={styles.cellThumb}
              src={apiUrl(withViewParams(`/api/file-raw?path=${encodeURIComponent(item.absPath || childPath)}`, { project, instance }))}
              loading="lazy"
              alt=""
              draggable={false}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            getFileIcon(item.name, item.type, 44)
          )}
        </span>
        <span className={styles.cellName}>{item.name}</span>
      </div>
    </Dropdown>
  );
}

export default function FileBrowserModal({ open = false, onClose, onAttachToChat, onInsertPathToChat, onFileRenamed, refreshTrigger = 0, project, instance, target = null, rootLabel = '', title, zIndex = 1100 }) {
  const isExternal = !!target;
  // readOnly still gates drag-and-drop / upload / move (those stay disabled in the
  // target browser). The right-click context menu and inline preview editing are
  // intentionally ENABLED in target mode (product decision): the server resolves
  // the navigation root from the target identity and enforces the write policy,
  // so the modal no longer treats external targets as fully read-only.
  const readOnly = isExternal;
  const validTarget = !target || (
    (target.kind === 'claude-md' && /^[0-9a-f]{12}$/i.test(target.id || ''))
    || (target.kind === 'skill' && ['user', 'project', 'plugin'].includes(target.source) && typeof target.path === 'string' && target.path)
  );
  const [currentPath, setCurrentPath] = useState('');
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [selectedPath, setSelectedPath] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [htmlPreviewPath, setHtmlPreviewPath] = useState(null);
  const [rootItems, setRootItems] = useState(null);
  const [targetInfo, setTargetInfo] = useState(null);
  const targetPathRef = useRef('');
  const [rootFailed, setRootFailed] = useState(false);
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bump to invalidate every cached directory listing (refresh button + every
  // modal reopen — the remote/container projects this targets change constantly).
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const treeCache = useRef(new Map());
  const dirRequests = useRef(new Map());
  // Guards against out-of-order grid fetches: only the latest request may setState.
  const gridReqSeq = useRef(0);
  const initialTargetRef = useRef(false);
  // Guards against a grid fetch in flight when the modal closes mid-flight.
  const alive = useRef(true);
  // Same remote gate expression as FileExplorer — the shared menu builder must
  // see the same isRemote on both surfaces (the modal only opens remotely, so
  // the download item always shows here).
  const { preferences } = useContext(SettingsContext);
  const isRemote = preferences?._isLocal === false;

  // A view switch must not combine cached entries from the old project with
  // mutations addressed to the new one. Reset the browser before fetching anew.
  const targetKey = target ? `${target.kind}\0${target.id || ''}\0${target.source || ''}\0${target.path || ''}` : '';
  const viewScope = `${targetKey}\0${project || ''}\0${instance || ''}`;
  const targetViewRef = useRef(viewScope);
  const prevViewScope = useRef(viewScope);
  useEffect(() => {
    if (prevViewScope.current === viewScope) return;
    prevViewScope.current = viewScope;
    targetViewRef.current = viewScope;
    initialTargetRef.current = false;
    treeCache.current.clear();
    dirRequests.current.clear();
    setCurrentPath('');
    setExpandedPaths(new Set());
    setSelectedPath(null);
    setPreviewFile(null);
    setHtmlPreviewPath(null);
    setRootItems(null);
    setTargetInfo(null);
    setRootFailed(false);
    setEntries(null);
    setLoadFailed(false);
    setCacheEpoch(e => e + 1);
  }, [viewScope]);

  const fetchDir = useCallback((path) => {
    if (!validTarget) return Promise.reject(new Error('Invalid folder target'));
    const requestScope = viewScope;
    const cached = treeCache.current.get(path);
    if (cached) return Promise.resolve(cached);
    const pending = dirRequests.current.get(path);
    if (pending) return pending;
    const requestPath = target ? targetFilesUrl(target, path) : `/api/files?path=${encodeURIComponent(path)}`;
    const request = fetch(apiUrl(withViewParams(requestPath, { project, instance })))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => {
        if (!target) {
          treeCache.current.set(path, data);
          return data;
        }
        if (!data || !Array.isArray(data.entries) || typeof data.targetPath !== 'string'
          || !['project', 'home', 'config', 'target'].includes(data.rootKind)
          || !Array.isArray(data.ancestors)) {
          throw new Error('Invalid directory response');
        }
        if (target && requestScope !== targetViewRef.current) throw new Error('Stale directory target');
        for (const ancestor of data.ancestors) {
          if (typeof ancestor.path === 'string' && Array.isArray(ancestor.entries)) treeCache.current.set(ancestor.path, ancestor.entries);
        }
        treeCache.current.set(path, data.entries);
        targetPathRef.current = data.targetPath;
        if (!path && data.targetPath && Array.isArray(data.targetEntries)) treeCache.current.set(data.targetPath, data.targetEntries);
        setTargetInfo({ rootKind: data.rootKind });
        return data.entries;
      });
    dirRequests.current.set(path, request);
    request.finally(() => {
      if (dirRequests.current.get(path) === request) dirRequests.current.delete(path);
    }).catch(() => {});
    return request;
  }, [project, instance, targetKey, validTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tree root: load on open; reload after cache invalidation (reopen/refresh).
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    fetchDir('')
      .then(data => {
        if (!alive.current) return;
        setRootItems(data);
        setRootFailed(false);
        if (target && !initialTargetRef.current) {
          initialTargetRef.current = true;
          const targetPath = targetPathRef.current;
          if (targetPath) {
            setCurrentPath(targetPath);
            setExpandedPaths(new Set(ancestorsOf(targetPath)));
          }
        }
      })
      .catch((err) => { reportSwallowed('fileBrowserTreeRoot', err); if (alive.current) { setRootFailed(true); setTargetInfo(null); } });
  }, [open, cacheEpoch, fetchDir]);

  // Grid listing follows currentPath; the sequence number drops stale responses.
  const loadGrid = useCallback((path) => {
    const seq = ++gridReqSeq.current;
    setEntries(null);
    setLoading(true);
    setLoadFailed(false);
    fetchDir(path)
      .then(data => {
        if (alive.current && seq === gridReqSeq.current) { setEntries(data); setLoading(false); }
      })
      .catch((err) => {
        reportSwallowed('fileBrowserGrid', err);
        if (alive.current && seq === gridReqSeq.current) { setEntries(null); setLoadFailed(true); setLoading(false); }
      });
  }, [fetchDir]);

  useEffect(() => {
    if (!open) { alive.current = false; return; }
    alive.current = true;
    loadGrid(currentPath);
  }, [open, currentPath, cacheEpoch, loadGrid]);

  // Every reopen starts from a fresh snapshot of the project (cache + view state).
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      treeCache.current.clear();
      dirRequests.current.clear();
      setCacheEpoch(e => e + 1);
      setPreviewFile(null);
      setHtmlPreviewPath(null);
      setSelectedPath(null);
      setLoadFailed(false);
      // Also back to the project root: currentPath may point at a directory
      // that was renamed/deleted while the modal was closed.
      setCurrentPath('');
    }
    prevOpen.current = open;
  }, [open]);

  const refresh = useCallback(() => {
    treeCache.current.clear();
    dirRequests.current.clear();
    setCacheEpoch(e => e + 1);
  }, []);

  // A move/import dropped on the SIDEBAR while this modal is open never reaches
  // handleAfterMutation — ChatView only bumps fileExplorerRefresh. Follow that
  // signal so the modal doesn't show pre-move state (stale row → 404 preview).
  // Declared AFTER refresh() — the effect deps reference it (TDZ otherwise).
  const prevRefreshTrigger = useRef(refreshTrigger);
  useEffect(() => {
    if (refreshTrigger === prevRefreshTrigger.current) return;
    prevRefreshTrigger.current = refreshTrigger;
    if (open) refresh();
  }, [refreshTrigger, open, refresh]);

  // After a menu mutation (create/rename/delete): refresh the modal AND the
  // sidebar. refresh() clears the cache + remounts the tree (key={cacheEpoch})
  // and refetches root + grid; onFileRenamed flows FileExplorer → ChatView
  // (currentFile remap + fileExplorerRefresh++ → sidebar refetches).
  const handleAfterMutation = useCallback((oldPath, newPath) => {
    if (oldPath) {
      // Exact match (rename/delete the entry itself) AND prefix match
      // (rename/delete an ancestor while browsing inside it — the tree can
      // delete a directory row without the grid ever entering it).
      const remap = (prev, { onGone }) => {
        if (prev === oldPath) return newPath;
        if (newPath && prev && prev.startsWith(oldPath + '/')) return newPath + prev.slice(oldPath.length);
        if (!newPath && prev && prev.startsWith(oldPath + '/')) return onGone;
        return prev;
      };
      setCurrentPath(prev => remap(prev, { onGone: '' }));
      setSelectedPath(prev => remap(prev, { onGone: null }));
      if (target) {
        // Target-mode previews hold the ABSOLUTE path (item.absPath), which never
        // equals the navigation-root-relative oldPath — so prefix remapping can't
        // match. Close the preview on any mutation to avoid saving a stale file
        // back under its old name after a rename/delete.
        setPreviewFile(null);
        setHtmlPreviewPath(null);
      } else {
        setPreviewFile(prev => (prev === oldPath || (prev && prev.startsWith(oldPath + '/')) ? null : prev));
        setHtmlPreviewPath(prev => (prev === oldPath || (prev && prev.startsWith(oldPath + '/')) ? null : prev));
      }
    }
    refresh();
    // The target browser's entry points (AppHeader/Mobile) do not pass an
    // onFileRenamed callback; guard so a navigation-root-relative path is never
    // forwarded to the project sidebar by a future caller wiring one up.
    if (!target) onFileRenamed?.(oldPath, newPath);
  }, [refresh, onFileRenamed, target]);

  const navigate = useCallback((path) => {
    setCurrentPath(path);
    setPreviewFile(null);
    setSelectedPath(null);
    // Reveal the row of the entered directory in the tree (ancestors only).
    if (path) {
      setExpandedPaths(prev => {
        const next = new Set(prev);
        for (const a of ancestorsOf(path)) next.add(a);
        return next;
      });
    }
  }, []);

  const handleToggleExpand = useCallback((path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelectFileFromTree = useCallback((filePath) => {
    navigate(parentPathOf(filePath));
    setSelectedPath(filePath);
  }, [navigate]);

  const goUp = useCallback(() => {
    if (currentPath) navigate(parentPathOf(currentPath));
  }, [currentPath, navigate]);

  const openItem = useCallback((item) => {
    const childPath = currentPath ? `${currentPath}/${item.name}` : item.name;
    if (item.type === 'directory') {
      navigate(childPath);
      return;
    }
    const itemPath = item.absPath || childPath;
    const ext = (item.name || '').split('.').pop().toLowerCase();
    if (ext === 'html' || ext === 'htm') {
      setHtmlPreviewPath(itemPath);
      return;
    }
    if (readOnly) {
      if (isSystemOpenFile(item.name)) downloadFile(itemPath, item.name, project, instance);
      else setPreviewFile(itemPath);
      return;
    }
    // This modal only opens for remote/container access (preferences._isLocal
    // === false), where /api/open-file would exec a GUI app on the headless
    // server host — a guaranteed silent no-op. Download to the client instead.
    if (tryOpenWithSystem(childPath, 'file-explorer', { project, instance })) {
      downloadFile(childPath, item.name, project, instance);
      return;
    }
    setPreviewFile(childPath);
  }, [currentPath, navigate, project, instance, readOnly]);

  const retry = useCallback(() => {
    treeCache.current.delete(currentPath);
    loadGrid(currentPath);
  }, [currentPath, loadGrid]);

  // Breadcrumb: static project-root crumb + one clickable crumb per segment.
  const crumbs = [];
  if (currentPath) {
    const segs = currentPath.split('/');
    for (let i = 0; i < segs.length; i++) {
      crumbs.push({ label: segs[i], path: segs.slice(0, i + 1).join('/') });
    }
  }

  // Right-click menu for the grid blank area — the same 'container' definition
  // the sidebar header uses (one shared builder keeps both in sync). Enabled in
  // target mode; the server enforces the write policy.
  const containerMenuItems = useMemo(
    () => buildFileContextMenuItems({ isDir: true, isRemote, scope: 'container', isTarget: !!target }),
    [isRemote, target]);
  const handleContainerMenuClick = useMemo(
    () => createFileMenuHandler({
      path: currentPath, name: '', isDir: true, project, instance, target,
      onFileRenamed: handleAfterMutation,
    }),
    [currentPath, handleAfterMutation, project, instance, target]);

  // Stable callback bundle for GridCell (one identity per render → memoized
  // cell menus don't rebuild unless these actually change).
  const cellMenuCtx = useMemo(() => ({
    onFileRenamed: handleAfterMutation, onAttachToChat, onInsertPathToChat,
  }), [handleAfterMutation, onAttachToChat, onInsertPathToChat]);

  // Upload pipeline shared with the sidebar FileExplorer (./importFiles);
  // onFileRenamed=handleAfterMutation refreshes the modal AND the sidebar
  // after a successful import.
  const handleImportFiles = useCallback(
    (payload, targetDir) => { if (!readOnly) importFiles(payload, targetDir, { onFileRenamed: handleAfterMutation, project, instance }); },
    [handleAfterMutation, project, instance, readOnly]);

  // In-project move (./fileMove, same endpoint+guards as the sidebar). Success
  // flows through handleAfterMutation(fromPath, newPath): prefix-remap of
  // currentPath/selection/previews + modal/sidebar refresh.
  const handleMove = useCallback(
    (fromPath, toDir) => { if (!readOnly) moveFile(fromPath, toDir, { onFileRenamed: handleAfterMutation, project, instance }); },
    [handleAfterMutation, project, instance, readOnly]);

  // Toolbar upload button → hidden file input (plain File[] payload).
  const fileInputRef = useRef(null);
  const handleUploadPick = useCallback((e) => {
    if (readOnly) return;
    const files = Array.from(e.target.files || []);
    // Reset so re-picking the same file re-fires onChange.
    e.target.value = '';
    if (files.length > 0) handleImportFiles(files, currentPath);
  }, [handleImportFiles, currentPath, readOnly]);

  // Grid blank area: external drops import into the browsed directory
  // (currentPath === '' = project root, same semantics as the sidebar's
  // blank-area import); in-project drops MOVE into it (canDropMoveOn's
  // same-dir guard makes dropping onto the entry's own folder a no-op).
  const [gridDragOver, setGridDragOver] = useState(false);
  const gridRef = useRef(null);
  const handleGridDragOver = useCallback((e) => {
    if (readOnly) return;
    const isExternal = isExternalFileDrag(e);
    const isInternal = isInternalMoveDrag(e);
    if (!isExternal && !isInternal) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
    setGridDragOver(true);
  }, [readOnly]);
  const handleGridDragLeave = useCallback((e) => {
    if (gridRef.current && !gridRef.current.contains(e.relatedTarget)) setGridDragOver(false);
  }, []);
  const handleGridDrop = useCallback((e) => {
    if (readOnly) return;
    const isExternal = isExternalFileDrag(e);
    const isInternal = isInternalMoveDrag(e);
    if (!isExternal && !isInternal) return;
    e.preventDefault();
    setGridDragOver(false);
    if (isInternal) {
      const fromPath = e.dataTransfer.getData('text/plain');
      if (canDropMoveOn(fromPath, currentPath)) handleMove(fromPath, currentPath);
      return;
    }
    // Extract entries synchronously — items go stale after the handler returns.
    const topEntries = getTopLevelEntries(e.dataTransfer.items);
    const flatFiles = Array.from(e.dataTransfer.files);
    if ((topEntries && topEntries.length > 0) || flatFiles.length > 0) {
      handleImportFiles({ topEntries, flatFiles }, currentPath);
    }
  }, [handleImportFiles, handleMove, currentPath, readOnly]);

  // Tree-pane blank area: in-project drop = move to the project root
  // (sidebar parity). Directory-row handlers stopPropagation inside the hook,
  // so only drops on the pane background (and — intentionally — file rows,
  // which no longer consume drops) reach here. The pane highlight is skipped
  // while a row is the actual dragover target (it highlights itself).
  const { dragOver: treePaneDragOver, ref: treePaneRef, onDragOver: handleTreePaneDragOver, onDragLeave: handleTreePaneDragLeave, onDrop: handleTreePaneDrop } =
    useInternalMoveTarget('', handleMove);
  const handleTreePaneDragOverGuarded = useCallback((e) => {
    if (e.target !== treePaneRef.current) return;
    handleTreePaneDragOver(e);
  }, [handleTreePaneDragOver]);

  // Layout catch-all: any external or in-project drag over a non-target region
  // (toolbar, preview) is swallowed here so it never bubbles to FileExplorer's
  // container handler (which would import/move into the project root) or
  // navigate the browser to the dropped file. Node/cell/grid/crumb handlers
  // run first (they stopPropagation).
  const handleLayoutDragOver = useCallback((e) => {
    if (!isExternalFileDrag(e) && !isInternalMoveDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleLayoutDrop = useCallback((e) => {
    if (!isExternalFileDrag(e) && !isInternalMoveDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable
      maskClosable
      width={isMobile ? 'calc(100vw - 8px)' : 'min(1200px, calc(100vw - 80px))'}
      zIndex={zIndex}
      centered
      title={<span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{title || rootLabel || t('ui.fileBrowserModal.title')}</span>}
      styles={{
        header: { background: 'var(--bg-container)', borderBottom: '1px solid var(--border-primary)', padding: '12px 20px' },
        body: { background: 'var(--bg-container)', height: 'calc(100vh - 160px)', overflow: 'hidden', padding: 0 },
        // Same blurred mask as the approval overlay / feature modals, inlined
        // to stay byte-out of the modal-mask consumer allowlist
        // (apps/web/test/modal-mask.test.js) — keep values in sync with
        // apps/web/src/utils/modalMask.js.
        mask: { background: 'rgba(0, 0, 0, 0.45)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' },
        content: { background: 'var(--bg-container)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 0 },
      }}
    >
      <div className={styles.layout} onDragOver={handleLayoutDragOver} onDrop={handleLayoutDrop}>
        {/* key={cacheEpoch}: antd Modal keeps the panel mounted across close,
            so ModalTreeNode's local `children` state would survive a cache clear
            and block refetch (guard requires children === null). Remounting the
            pane on epoch bump re-inits every expanded node from the cleared
            cache → genuinely fresh snapshot on refresh/reopen. */}
        <aside
          className={`${styles.treePane} ${treePaneDragOver ? styles.treePaneDragOver : ''} ${isMobile && target ? styles.treePaneMobile : ''}`}
          key={cacheEpoch}
          ref={treePaneRef}
          onDragOver={readOnly ? undefined : handleTreePaneDragOverGuarded}
          onDragLeave={readOnly ? undefined : handleTreePaneDragLeave}
          onDrop={readOnly ? undefined : handleTreePaneDrop}
        >
          {rootFailed && (
            <div className={styles.statusText} role="button" tabIndex={0}
              onClick={refresh}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refresh(); } }}
            >
              {t('ui.fileBrowserModal.loadFailed')}
            </div>
          )}
          {rootItems && rootItems.map(item => (
            <ModalTreeNode
              key={item.name}
              item={item}
              path=""
              depth={0}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onNavigate={navigate}
              onSelectFile={handleSelectFileFromTree}
              currentPath={currentPath}
              selectedPath={selectedPath}
              treeCache={treeCache}
              cacheEpoch={cacheEpoch}
              isRemote={isRemote}
              onFileRenamed={handleAfterMutation}
              onAttachToChat={onAttachToChat}
              onInsertPathToChat={onInsertPathToChat}
              onImportFiles={handleImportFiles}
              onMove={handleMove}
              project={project}
              instance={instance}
              target={target}
              readOnly={readOnly}
            />
          ))}
        </aside>
        <section className={styles.gridPane}>
          {previewFile ? (
            <div className={styles.previewHost}>
              {isImageFile(previewFile) ? (
                <ImageViewer filePath={previewFile} onClose={() => setPreviewFile(null)} project={project} instance={instance} />
              ) : (
                // Preview is editable in target mode (product decision): the modal
                // passes the target identity so /api/file-content resolves the
                // navigation root (not the project view root) for the write.
                <FileContentView filePath={previewFile} onClose={() => setPreviewFile(null)} project={project} instance={instance} target={target} readOnly={false} displayPath={readOnly ? (currentPath ? `${currentPath}/${previewFile.split('/').pop()}` : previewFile.split('/').pop()) : previewFile} />
              )}
            </div>
          ) : (
            <>
              <div className={styles.toolbar}>
                <button
                  type="button"
                  className={styles.upBtn}
                  onClick={goUp}
                  disabled={!currentPath}
                  title={t('ui.fileBrowserModal.up')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="14 18 8 12 14 6"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.upBtn}
                  onClick={refresh}
                  title={t('ui.fileExplorer.refresh')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                </button>
                <CrumbDropTarget
                  label={target ? (targetInfo?.rootKind === 'home' ? '~' : (project || rootLabel)) : (rootLabel || t('ui.fileBrowserModal.root'))}
                  path=""
                  link={!!currentPath}
                  onNavigate={navigate}
                  onMove={handleMove}
                  readOnly={readOnly}
                />
                {crumbs.map((c, i) => (
                  <React.Fragment key={c.path}>
                    <span className={styles.crumbSep}>/</span>
                    <CrumbDropTarget
                      label={c.label}
                      path={c.path}
                      link={i < crumbs.length - 1}
                      onNavigate={navigate}
                      onMove={handleMove}
                      readOnly={readOnly}
                      title={c.label}
                    />
                  </React.Fragment>
                ))}
                {!readOnly && <>
                <button
                  type="button"
                  className={styles.uploadBtn}
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  title={t('ui.fileBrowserModal.upload')}
                  aria-label={t('ui.fileBrowserModal.upload')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={handleUploadPick}
                />
                </>}
              </div>
              <Dropdown menu={{ items: containerMenuItems, onClick: handleContainerMenuClick }} trigger={['contextMenu']}>
              <div
                ref={gridRef}
                className={`${styles.grid} ${gridDragOver ? styles.gridDragOver : ''}`}
                onDragOver={handleGridDragOver}
                onDragLeave={handleGridDragLeave}
                onDrop={handleGridDrop}
              >
                {loading && <div className={styles.statusText}>{t('ui.loading')}</div>}
                {loadFailed && (
                  <div className={`${styles.statusText} ${styles.statusRetry}`} role="button" tabIndex={0}
                    onClick={retry}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retry(); } }}
                  >
                    {t('ui.fileBrowserModal.loadFailed')}
                  </div>
                )}
                {!loading && !loadFailed && entries && entries.length === 0 && (
                  <div className={styles.statusText}>{t('ui.fileBrowserModal.empty')}</div>
                )}
                {!loading && !loadFailed && entries && entries.map(item => {
                  const childPath = currentPath ? `${currentPath}/${item.name}` : item.name;
                  return (
                    <GridCell
                      key={item.name}
                      item={item}
                      childPath={childPath}
                      isSelected={selectedPath === childPath}
                      isGitIgnored={item.gitIgnored || false}
                      isRemote={isRemote}
                      onSelect={setSelectedPath}
                      onOpen={openItem}
                      menuCtx={cellMenuCtx}
                      onImportFiles={handleImportFiles}
                      onMove={handleMove}
                      project={project}
                      instance={instance}
                      readOnly={readOnly}
                      target={target}
                    />
                  );
                })}
              </div>
              </Dropdown>
            </>
          )}
        </section>
      </div>
      {htmlPreviewPath && (
        // 1120 sits above this modal's 1100; both portal to body, so the
        // nested preview always stacks on top regardless of mount order.
        <HtmlPreviewModal path={htmlPreviewPath} onClose={() => setHtmlPreviewPath(null)} zIndex={zIndex + 20} project={project} instance={instance} />
      )}
    </Modal>
  );
}
