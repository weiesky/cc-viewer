import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Typography, message, Modal, Tag } from 'antd';
import { FolderOpenOutlined, FolderOutlined, BranchesOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import Loading from '../common/Loading';
import styles from './WorkspaceList.module.css';

const { Text } = Typography;

// A single directory tree node (recursive). dir = { name, path (absolute), hasGit }
function DirTreeNode({ dir, depth, currentPath, childrenMap, expandedPaths, loadingPaths, onToggleExpand, onSelect }) {
  const absPath = dir.path;
  const expanded = expandedPaths.has(absPath);
  const children = childrenMap.get(absPath);
  const loading = loadingPaths.has(absPath);
  const isCurrent = currentPath === absPath;

  return (
    <>
      <div
        className={`${styles.dirTreeItem}${isCurrent ? ' ' + styles.dirTreeItemCurrent : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onToggleExpand(absPath)}
      >
        <span className={`${styles.dirTreeArrow}${expanded ? ' ' + styles.dirTreeArrowExpanded : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </span>
        <div className={styles.dirItemInner}>
          <FolderOutlined style={{ color: dir.hasGit ? 'var(--color-primary)' : 'var(--text-muted)', fontSize: 16, flexShrink: 0 }} />
          <Text className={styles.dirItemName}>{dir.name}</Text>
          {dir.hasGit && (
            <Tag color="blue" className={styles.dirGitTag}>
              <BranchesOutlined style={{ marginRight: 2 }} />git
            </Tag>
          )}
          {loading && <Loading size="small" style={{ marginLeft: 4 }} />}
        </div>
        <Button
          type="primary"
          size="small"
          onClick={(e) => { e.stopPropagation(); onSelect(absPath); }}
        >
          {t('ui.workspaces.launch')}
        </Button>
      </div>
      {expanded && children && children.length === 0 && (
        <div className={styles.dirTreeEmpty} style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
          {t('ui.workspaces.emptyDir')}
        </div>
      )}
      {expanded && children && children.map(child => (
        <DirTreeNode
          key={child.path}
          dir={child}
          depth={depth + 1}
          currentPath={currentPath}
          childrenMap={childrenMap}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

// "Select Project Directory" tree-based directory browser
export default function DirBrowser({ open, onClose, onSelect }) {
  const [currentPath, setCurrentPath] = useState('');
  const [rootDirs, setRootDirs] = useState([]);
  const [childrenMap, setChildrenMap] = useState(() => new Map());
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [loadingPaths, setLoadingPaths] = useState(() => new Set());
  const [pathInput, setPathInput] = useState('');
  const [initialLoading, setInitialLoading] = useState(false);
  const homeRef = useRef('');
  // Sync-truth mirrors of childrenMap / expandedPaths. locateTo awaits per-level
  // fetches, so reading the useState snapshots captured in its closure would be
  // stale; the refs always hold the latest committed value.
  const childrenMapRef = useRef(new Map());
  const expandedPathsRef = useRef(new Set());

  const fetchDirs = useCallback((absPath) => {
    const url = absPath ? `/api/browse-dir?path=${encodeURIComponent(absPath)}` : '/api/browse-dir';
    return fetch(apiUrl(url)).then(res => res.json());
  }, []);

  // Open: load the home directory as the tree root.
  useEffect(() => {
    if (!open) return;
    setInitialLoading(true);
    fetchDirs('').then(data => {
      if (data.error) {
        message.error(data.error);
      } else {
        const home = data.current;
        const homeDirs = data.dirs || [];
        homeRef.current = home;
        setCurrentPath(home);
        setPathInput(home);
        setRootDirs(homeDirs);
        childrenMapRef.current = new Map([[home, homeDirs]]);
        expandedPathsRef.current = new Set();
        setChildrenMap(childrenMapRef.current);
        setExpandedPaths(expandedPathsRef.current);
        setLoadingPaths(new Set());
      }
      setInitialLoading(false);
    }).catch(() => {
      message.error('Failed to browse directory');
      setInitialLoading(false);
    });
  }, [open, fetchDirs]);

  // Fetch one directory's children and commit them to the cache (ref + state).
  const loadChildren = useCallback(async (absPath) => {
    const data = await fetchDirs(absPath);
    if (data.error) {
      message.error(data.error);
      return false;
    }
    childrenMapRef.current.set(absPath, data.dirs || []);
    setChildrenMap(new Map(childrenMapRef.current));
    return true;
  }, [fetchDirs]);

  const addLoading = useCallback((absPath) => {
    setLoadingPaths(prev => new Set(prev).add(absPath));
  }, []);

  const removeLoading = useCallback((absPath) => {
    setLoadingPaths(prev => { const next = new Set(prev); next.delete(absPath); return next; });
  }, []);

  // Toggle a directory expanded/collapsed; lazily load its children on expand.
  const handleToggleExpand = useCallback(async (absPath) => {
    setCurrentPath(absPath);
    setPathInput(absPath);
    if (expandedPathsRef.current.has(absPath)) {
      expandedPathsRef.current.delete(absPath);
      setExpandedPaths(new Set(expandedPathsRef.current));
      return;
    }
    expandedPathsRef.current.add(absPath);
    setExpandedPaths(new Set(expandedPathsRef.current));
    if (childrenMapRef.current.has(absPath)) return;
    addLoading(absPath);
    try {
      await loadChildren(absPath);
    } catch {
      message.error('Failed to browse directory');
    } finally {
      removeLoading(absPath);
    }
  }, [loadChildren, addLoading, removeLoading]);

  // Lazily ensure a directory's children are cached. Returns whether they are.
  const ensureChildren = useCallback(async (absPath) => {
    if (childrenMapRef.current.has(absPath)) return true;
    try {
      return await loadChildren(absPath);
    } catch {
      message.error('Failed to browse directory');
      return false;
    }
  }, [loadChildren]);

  // "Go to" / breadcrumb: expand an absolute path level by level to locate it in the tree.
  const locateTo = useCallback(async (targetPath) => {
    const p = (targetPath || '').trim();
    if (!p) return;
    const home = homeRef.current;
    const underHome = home && (p === home || p.startsWith(home + '/'));
    const base = underHome ? home : '/';

    // Fast path: the target is already expanded in the tree — just focus it.
    if (expandedPathsRef.current.has(p) || p === base) {
      if (base === home) setRootDirs(childrenMapRef.current.get(home) || []);
      else setRootDirs(childrenMapRef.current.get('/') || []);
      setCurrentPath(p);
      setPathInput(p);
      return;
    }

    const rel = underHome ? (p === home ? '' : p.slice(home.length + 1)) : p.replace(/^\/+/, '');
    const segments = rel.split('/').filter(Boolean);

    // Make sure the base (home or /) children are loaded and the base is expanded.
    addLoading(base);
    const baseOk = await ensureChildren(base);
    removeLoading(base);
    if (!baseOk) return;

    const newExpanded = new Set(expandedPathsRef.current);
    newExpanded.add(base);
    let acc = base === '/' ? '' : base;
    // The top-level rows mirror the base's children (home's, or /'s after leaving home).
    setRootDirs(childrenMapRef.current.get(base) || []);

    for (let i = 0; i < segments.length; i++) {
      acc = (acc === '' ? '' : acc) + '/' + segments[i];
      const cur = acc;
      addLoading(cur);
      const ok = await ensureChildren(cur); // eslint-disable-line no-await-in-loop
      removeLoading(cur);
      if (!ok) {
        // Stop at the last successfully loaded level.
        expandedPathsRef.current = newExpanded;
        setExpandedPaths(new Set(newExpanded));
        setCurrentPath(acc);
        setPathInput(acc);
        return;
      }
      newExpanded.add(cur);
      setCurrentPath(cur);
    }
    expandedPathsRef.current = newExpanded;
    setExpandedPaths(new Set(newExpanded));
    setPathInput(p);
  }, [ensureChildren, addLoading, removeLoading]);

  const handleGoTo = useCallback(() => {
    locateTo(pathInput);
  }, [locateTo, pathInput]);

  // Split the current path into clickable breadcrumbs; the home dir shows as "~".
  const buildCrumbs = () => {
    const cur = currentPath;
    if (!cur) return [];
    const home = homeRef.current;
    const underHome = home && (cur === home || cur.startsWith(home + '/'));
    const leadLabel = underHome ? '~' : '/';
    const leadPath = underHome ? home : '/';
    const restStr = underHome
      ? (cur === home ? '' : cur.slice(home.length + 1))
      : cur;
    const rest = restStr.split('/').filter(Boolean);
    const tokens = [{ type: 'crumb', label: leadLabel, path: leadPath }];
    let acc = leadPath;
    rest.forEach((name, i) => {
      acc = (acc === '/' ? '' : acc) + '/' + name;
      if (!(i === 0 && leadLabel === '/')) tokens.push({ type: 'sep' });
      tokens.push({ type: 'crumb', label: name, path: acc });
    });
    return tokens;
  };

  return (
    <Modal
      title={t('ui.workspaces.selectDir')}
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      styles={{ body: { padding: '12px 0' } }}
    >
      {/* Current path (clickable breadcrumbs) */}
      <div className={styles.dirPathHeader}>
        <div className={styles.dirCurrentPath}>
          {buildCrumbs().map((tk, i) =>
            tk.type === 'sep' ? (
              <span key={i} className={styles.dirCrumbSep}>/</span>
            ) : (
              <span
                key={i}
                className={styles.dirCrumb}
                title={tk.path}
                onClick={() => locateTo(tk.path)}
              >
                {tk.label}
              </span>
            )
          )}
        </div>
      </div>

      {/* Directory tree */}
      <div className={styles.dirList}>
        {initialLoading ? (
          <div className={styles.dirListCenter}><Loading /></div>
        ) : rootDirs.length === 0 ? (
          <div className={styles.dirListCenter}>
            <Text type="secondary">{t('ui.workspaces.emptyDir')}</Text>
          </div>
        ) : (
          rootDirs.map(dir => (
            <DirTreeNode
              key={dir.path}
              dir={dir}
              depth={0}
              currentPath={currentPath}
              childrenMap={childrenMap}
              expandedPaths={expandedPaths}
              loadingPaths={loadingPaths}
              onToggleExpand={handleToggleExpand}
              onSelect={onSelect}
            />
          ))
        )}
      </div>

      {/* Footer: also allow launching the current directory directly */}
      <div className={styles.dirFooter}>
        <Button
          type="primary"
          ghost
          block
          icon={<FolderOpenOutlined />}
          onClick={() => onSelect(currentPath)}
        >
          {t('ui.workspaces.launchCurrent')} — {currentPath.split('/').pop() || currentPath}
        </Button>
        <div className={styles.dirPathInputRow}>
          <Input
            size="small"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onPressEnter={handleGoTo}
            placeholder={t('ui.workspaces.pathPlaceholder')}
            className={styles.dirPathInput}
          />
          <Button size="small" onClick={handleGoTo}>{t('ui.workspaces.goTo')}</Button>
        </div>
      </div>
    </Modal>
  );
}
