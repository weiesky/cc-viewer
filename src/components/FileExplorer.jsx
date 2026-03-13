import React, { useState, useCallback, useRef, useEffect } from 'react';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import styles from './FileExplorer.module.css';

const EXT_COLORS = {
  js: '#e8d44d', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
  json: '#999', md: '#519aba', css: '#a86fd9', scss: '#cd6799', less: '#a86fd9',
  html: '#e34c26', htm: '#e34c26', xml: '#e34c26',
  py: '#3572a5', go: '#00add8', rs: '#dea584', rb: '#cc342d',
  java: '#b07219', c: '#555', cpp: '#f34b7d', h: '#555',
  sh: '#4eaa25', bash: '#4eaa25', zsh: '#4eaa25',
  yml: '#cb171e', yaml: '#cb171e', toml: '#999',
  svg: '#e34c26', png: '#a86fd9', jpg: '#a86fd9', jpeg: '#a86fd9', gif: '#a86fd9', ico: '#a86fd9', webp: '#a86fd9',
};

function getFileIcon(name, type) {
  if (type === 'directory') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#c09553" stroke="none">
        <path d="M2 6c0-1.1.9-2 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
      </svg>
    );
  }
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const color = EXT_COLORS[ext] || '#888';
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function TreeNode({ item, path, depth, onFileClick, expandedPaths, onToggleExpand, currentFile }) {
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const childPath = path ? `${path}/${item.name}` : item.name;
  const expanded = expandedPaths.has(childPath);
  const isGitIgnored = item.gitIgnored || false;

  const fetchChildren = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/files?path=${encodeURIComponent(childPath)}`));
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setChildren(data);
    } catch {
      setError('Error');
    } finally {
      setLoading(false);
    }
  }, [childPath]);

  // 组件挂载时如果已在展开状态，自动加载子节点（用于恢复展开状态）
  useEffect(() => {
    if (item.type === 'directory' && expanded && children === null && !loading) {
      fetchChildren();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async () => {
    if (item.type !== 'directory') {
      // 点击文件，触发回调
      if (onFileClick) onFileClick(childPath);
      return;
    }
    if (expanded) {
      onToggleExpand(childPath);
      return;
    }
    if (children === null) {
      await fetchChildren();
    }
    onToggleExpand(childPath);
  }, [expanded, children, childPath, item, onFileClick, onToggleExpand, fetchChildren]);

  const isDir = item.type === 'directory';
  const isSelected = !isDir && currentFile && currentFile === childPath;

  return (
    <>
      <div
        className={`${styles.treeItem}${isSelected ? ' ' + styles.treeItemSelected : ''}${isGitIgnored ? ' ' + styles.treeItemGitIgnored : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={toggle}
      >
        <span className={styles.arrow}>
          {isDir ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          ) : ''}
        </span>
        <span className={styles.icon}>{getFileIcon(item.name, item.type)}</span>
        <span className={styles.fileName}>{item.name}</span>
      </div>
      {expanded && loading && (
        <div className={styles.loading} style={{ paddingLeft: 24 + depth * 16 }}>...</div>
      )}
      {expanded && error && (
        <div className={styles.error} style={{ paddingLeft: 24 + depth * 16 }}>{error}</div>
      )}
      {expanded && children && children.map(child => (
        <TreeNode key={child.name} item={child} path={childPath} depth={depth + 1} onFileClick={onFileClick} expandedPaths={expandedPaths} onToggleExpand={onToggleExpand} currentFile={currentFile} />
      ))}
    </>
  );
}

export default function FileExplorer({ onClose, onFileClick, expandedPaths, onToggleExpand, currentFile, refreshTrigger }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  // 重新加载根目录
  const refreshRoot = useCallback(() => {
    if (!mounted.current) return;
    fetch(apiUrl('/api/files?path='))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { if (mounted.current) setItems(data); })
      .catch(() => { if (mounted.current) setError('Failed to load'); });
  }, []);

  useEffect(() => {
    mounted.current = true;

    // 加载根目录
    fetch(apiUrl('/api/files?path='))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { if (mounted.current) setItems(data); })
      .catch(() => { if (mounted.current) setError('Failed to load'); });

    return () => {
      mounted.current = false;
    };
  }, []); // 空依赖数组，只在挂载时执行一次

  // 工具触发的增量刷新
  useEffect(() => {
    if (refreshTrigger > 0) refreshRoot();
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.fileExplorer}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('ui.fileExplorer')}</span>
        <button className={styles.collapseBtn} onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="11 17 6 12 11 7"/>
            <polyline points="18 17 13 12 18 7"/>
          </svg>
        </button>
      </div>
      <div className={styles.treeContainer}>
        {error && <div className={styles.error}>{error}</div>}
        {!items && !error && <div className={styles.loading}>Loading...</div>}
        {items && items.map(item => (
          <TreeNode key={item.name} item={item} path="" depth={0} onFileClick={onFileClick} expandedPaths={expandedPaths} onToggleExpand={onToggleExpand} currentFile={currentFile} />
        ))}
      </div>
    </div>
  );
}
