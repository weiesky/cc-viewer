import React, { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { Modal, Dropdown } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { getFileIcon } from '../../utils/fileIcons';
import { isImageFile } from '../../utils/commandValidator';
import { tryOpenWithSystem } from '../../utils/fileOpen';
import { reportSwallowed } from '../../utils/errorReport';
import { SettingsContext } from '../../contexts/SettingsContext';
import { buildFileContextMenuItems } from './fileContextMenu';
import { createFileMenuHandler } from './fileContextMenuActions';
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
function downloadFile(childPath, name) {
  const a = document.createElement('a');
  a.href = apiUrl(`/api/download-file?path=${encodeURIComponent(childPath)}`);
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

function ModalTreeNode({ item, path, depth, expandedPaths, onToggleExpand, onNavigate, onSelectFile, currentPath, selectedPath, treeCache, cacheEpoch, isRemote, onFileRenamed, onAttachToChat, onInsertPathToChat }) {  const childPath = path ? `${path}/${item.name}` : item.name;
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
      fetch(apiUrl(`/api/files?path=${encodeURIComponent(childPath)}`))
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(data => { treeCache.current.set(childPath, data); setChildren(data); setLoading(false); })
        // Collapse + re-expand the arrow retries the fetch (children stays null).
        .catch((err) => { reportSwallowed('fileBrowserTreeNode', err); setLoading(false); setLoadFailed(true); });
    }
  }, [expanded, cacheEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Rendered inside the Modal, so antd's zIndexContext stacks the dropdown
  // above it automatically (1100 + 50 = 1150; do not hardcode overlayStyle).
  const contextMenuItems = useMemo(
    () => buildFileContextMenuItems({ isDir, isRemote }),
    [isDir, isRemote]);
  const handleMenuClick = useMemo(
    () => createFileMenuHandler({
      path: childPath, name: item.name, isDir, renameMode: 'modal',
      onFileRenamed, onAttachToChat, onInsertPathToChat,
    }),
    [childPath, item.name, isDir, onFileRenamed, onAttachToChat, onInsertPathToChat]);

  return (
    <>
      <Dropdown menu={{ items: contextMenuItems, onClick: handleMenuClick }} trigger={['contextMenu']}>
        <div
          className={`${styles.treeItem} ${isCurrentDir ? styles.treeItemCurrent : ''} ${isSelectedFile ? styles.treeItemSelected : ''} ${isGitIgnored ? styles.treeItemIgnored : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={handleRowClick}
          onKeyDown={handleActivationKey(handleRowClick)}
          role="treeitem"
          aria-expanded={isDir ? expanded : undefined}
          tabIndex={0}
          title={item.name}
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
// The menu items depend only on (isDir, isRemote); the handler binds the path.
function GridCell({ item, childPath, isSelected, isGitIgnored, isRemote, onSelect, onOpen, menuCtx }) {
  const isDir = item.type === 'directory';
  // Image cells render a real thumbnail (lazy-loaded; falls back to the file
  // icon on error, e.g. oversized >10MB or unreadable file).
  const showThumb = !isDir && isThumbnailFile(item.name);
  const [thumbFailed, setThumbFailed] = useState(false);
  // Per-cell menu: identical to the sidebar tree's entry menu (shared
  // builder/factory), rename via Modal.confirm.
  const menuItems = useMemo(() => buildFileContextMenuItems({ isDir, isRemote }), [isDir, isRemote]);
  const handleCellMenuClick = useMemo(
    () => createFileMenuHandler({
      path: childPath, name: item.name, isDir, renameMode: 'modal',
      onFileRenamed: menuCtx.onFileRenamed, onAttachToChat: menuCtx.onAttachToChat,
      onInsertPathToChat: menuCtx.onInsertPathToChat, onDownload: downloadFile,
    }),
    [childPath, item.name, isDir, menuCtx]);

  return (
    <Dropdown menu={{ items: menuItems, onClick: handleCellMenuClick }} trigger={['contextMenu']}>
      <div
        className={`${styles.cell} ${isSelected ? styles.cellSelected : ''} ${isGitIgnored ? styles.cellIgnored : ''}`}
        onClick={() => onSelect(childPath)}
        onDoubleClick={() => onOpen(item)}
        onKeyDown={handleActivationKey(() => onOpen(item))}
        role="button"
        tabIndex={0}
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
              src={apiUrl(`/api/file-raw?path=${encodeURIComponent(childPath)}`)}
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

export default function FileBrowserModal({ open = false, onClose, onAttachToChat, onInsertPathToChat, onFileRenamed }) {
  const [currentPath, setCurrentPath] = useState('');
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [selectedPath, setSelectedPath] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [htmlPreviewPath, setHtmlPreviewPath] = useState(null);
  const [rootItems, setRootItems] = useState(null);
  const [rootFailed, setRootFailed] = useState(false);
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bump to invalidate every cached directory listing (refresh button + every
  // modal reopen — the remote/container projects this targets change constantly).
  const [cacheEpoch, setCacheEpoch] = useState(0);
  const treeCache = useRef(new Map());
  // Guards against out-of-order grid fetches: only the latest request may setState.
  const gridReqSeq = useRef(0);
  // Guards against a grid fetch in flight when the modal closes mid-flight.
  const alive = useRef(true);
  // Same remote gate expression as FileExplorer — the shared menu builder must
  // see the same isRemote on both surfaces (the modal only opens remotely, so
  // the download item always shows here).
  const { preferences } = useContext(SettingsContext);
  const isRemote = preferences?._isLocal === false;

  const fetchDir = useCallback((path) => {
    const cached = treeCache.current.get(path);
    if (cached) return Promise.resolve(cached);
    return fetch(apiUrl(`/api/files?path=${encodeURIComponent(path)}`))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { treeCache.current.set(path, data); return data; });
  }, []);

  // Tree root: load on open; reload after cache invalidation (reopen/refresh).
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    fetchDir('')
      .then(data => { if (alive.current) { setRootItems(data); setRootFailed(false); } })
      .catch((err) => { reportSwallowed('fileBrowserTreeRoot', err); if (alive.current) setRootFailed(true); });
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
    setCacheEpoch(e => e + 1);
  }, []);

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
      setPreviewFile(prev => (prev === oldPath || (prev && prev.startsWith(oldPath + '/')) ? null : prev));
      setHtmlPreviewPath(prev => (prev === oldPath || (prev && prev.startsWith(oldPath + '/')) ? null : prev));
    }
    refresh();
    onFileRenamed?.(oldPath, newPath);
  }, [refresh, onFileRenamed]);

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
    const ext = (item.name || '').split('.').pop().toLowerCase();
    if (ext === 'html' || ext === 'htm') {
      setHtmlPreviewPath(childPath);
      return;
    }
    // This modal only opens for remote/container access (preferences._isLocal
    // === false), where /api/open-file would exec a GUI app on the headless
    // server host — a guaranteed silent no-op. Download to the client instead.
    if (tryOpenWithSystem(childPath, 'file-explorer')) {
      downloadFile(childPath, item.name);
      return;
    }
    setPreviewFile(childPath);
  }, [currentPath, navigate]);

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
  // the sidebar header uses (one shared builder keeps both in sync).
  const containerMenuItems = useMemo(
    () => buildFileContextMenuItems({ isDir: true, isRemote, scope: 'container' }),
    [isRemote]);
  const handleContainerMenuClick = useMemo(
    () => createFileMenuHandler({
      path: currentPath, name: '', isDir: true,
      onFileRenamed: handleAfterMutation,
    }),
    [currentPath, handleAfterMutation]);

  // Stable callback bundle for GridCell (one identity per render → memoized
  // cell menus don't rebuild unless these actually change).
  const cellMenuCtx = useMemo(() => ({
    onFileRenamed: handleAfterMutation, onAttachToChat, onInsertPathToChat,
  }), [handleAfterMutation, onAttachToChat, onInsertPathToChat]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable
      maskClosable
      width="min(1200px, calc(100vw - 80px))"
      zIndex={1100}
      centered
      title={<span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{t('ui.fileBrowserModal.title')}</span>}
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
      <div className={styles.layout}>
        {/* key={cacheEpoch}: antd Modal keeps the panel mounted across close,
            so ModalTreeNode's local `children` state would survive a cache clear
            and block refetch (guard requires children === null). Remounting the
            pane on epoch bump re-inits every expanded node from the cleared
            cache → genuinely fresh snapshot on refresh/reopen. */}
        <aside className={styles.treePane} key={cacheEpoch}>
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
            />
          ))}
        </aside>
        <section className={styles.gridPane}>
          {previewFile ? (
            <div className={styles.previewHost}>
              {isImageFile(previewFile) ? (
                <ImageViewer filePath={previewFile} onClose={() => setPreviewFile(null)} />
              ) : (
                <FileContentView filePath={previewFile} onClose={() => setPreviewFile(null)} />
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
                <span
                  className={`${styles.crumb} ${currentPath ? styles.crumbLink : ''}`}
                  onClick={currentPath ? () => navigate('') : undefined}
                  onKeyDown={currentPath ? handleActivationKey(() => navigate('')) : undefined}
                  role={currentPath ? 'button' : undefined}
                  tabIndex={currentPath ? 0 : undefined}
                >
                  {t('ui.fileBrowserModal.root')}
                </span>
                {crumbs.map((c, i) => (
                  <React.Fragment key={c.path}>
                    <span className={styles.crumbSep}>/</span>
                    <span
                      className={`${styles.crumb} ${i < crumbs.length - 1 ? styles.crumbLink : ''}`}
                      onClick={i < crumbs.length - 1 ? () => navigate(c.path) : undefined}
                      onKeyDown={i < crumbs.length - 1 ? handleActivationKey(() => navigate(c.path)) : undefined}
                      role={i < crumbs.length - 1 ? 'button' : undefined}
                      tabIndex={i < crumbs.length - 1 ? 0 : undefined}
                      title={c.label}
                    >
                      {c.label}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <Dropdown menu={{ items: containerMenuItems, onClick: handleContainerMenuClick }} trigger={['contextMenu']}>
              <div className={styles.grid}>
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
        <HtmlPreviewModal path={htmlPreviewPath} onClose={() => setHtmlPreviewPath(null)} zIndex={1120} />
      )}
    </Modal>
  );
}
