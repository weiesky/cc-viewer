import React, { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { isImageFile } from '../../utils/commandValidator';
import { getFileIcon } from '../../utils/fileIcons';
import { loadExpandedPaths, saveExpandedPaths } from '../../utils/fileExpandedPathsStorage';
import { useSessionStoragePersistedSet } from '../../hooks/useSessionStoragePersistedSet';
import FileContentView from '../files/FileContentView';
import ImageViewer from '../viewers/ImageViewer';
import styles from './MobileFileExplorer.module.css';

function MobileTreeNode({ item, path, depth, expandedPaths, onToggleExpand, currentFile, onFileClick }) {
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const childPath = path ? `${path}/${item.name}` : item.name;
  const expanded = expandedPaths.has(childPath);
  const isDir = item.type === 'directory';
  const isSelected = !isDir && currentFile === childPath;
  const isGitIgnored = item.gitIgnored || false;

  useEffect(() => {
    if (isDir && expanded && children === null && !loading) {
      setLoading(true);
      fetch(apiUrl(`/api/files?path=${encodeURIComponent(childPath)}`))
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => { setChildren(data); setLoading(false); })
        .catch(() => { setLoading(false); });
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggleExpand(childPath);
    } else {
      onFileClick(childPath);
    }
  }, [isDir, childPath, onToggleExpand, onFileClick]);

  return (
    <>
      <div
        className={`${styles.treeItem} ${isSelected ? styles.treeItemActive : ''} ${isGitIgnored ? styles.treeItemIgnored : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={handleClick}
      >
        {isDir ? (
          <span className={`${styles.arrow} ${expanded ? styles.arrowExpanded : ''}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </span>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}
        <span className={styles.icon}>
          {isDir ? getFileIcon(item.name, 'directory') : getFileIcon(item.name)}
        </span>
        <span className={styles.fileName}>{item.name}</span>
        {loading && <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>...</span>}
      </div>
      {isDir && expanded && children && children.map(child => (
        <MobileTreeNode
          key={child.name}
          item={child}
          path={childPath}
          depth={depth + 1}
          expandedPaths={expandedPaths}
          onToggleExpand={onToggleExpand}
          currentFile={currentFile}
          onFileClick={onFileClick}
        />
      ))}
    </>
  );
}

export default function MobileFileExplorer({ visible, onClose, targetFile, projectName }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // 持久化 + projectName 守卫 + firstMountRef + prevProjectNameRef 全套走共用 hook。
  const [expandedPaths, setExpandedPaths] = useSessionStoragePersistedSet({
    projectName,
    load: loadExpandedPaths,
    save: saveExpandedPaths,
  });
  const [currentFile, setCurrentFile] = useState(null);
  const mounted = useRef(true);
  const lastTargetRef = useRef(null);

  // 加载根目录
  useEffect(() => {
    mounted.current = true;
    if (!visible) {
      // 关闭抽屉时清掉 currentFile / lastTargetRef，但保留 expandedPaths（sessionStorage 已持久化，
      // 下次打开仍能恢复用户上一轮浏览到的目录结构）。
      setCurrentFile(null);
      lastTargetRef.current = null;
      return;
    }
    setLoading(true);
    setError(null);
    fetch(apiUrl('/api/files?path='))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (mounted.current) { setItems(data); setLoading(false); }
      })
      .catch(() => {
        if (mounted.current) { setError(t('ui.fileLoadError')); setLoading(false); }
      });
    return () => { mounted.current = false; };
  }, [visible]);

  // 从对话中点击文件路径 → 自动展开祖先目录并选中文件
  useEffect(() => {
    if (!targetFile || !visible) return;
    // 避免重复处理同一个文件路径
    if (lastTargetRef.current === targetFile.file) return;
    lastTargetRef.current = targetFile.file;
    setCurrentFile(targetFile.file);
    if (targetFile.ancestors && targetFile.ancestors.length > 0) {
      setExpandedPaths(prev => {
        const next = new Set(prev);
        targetFile.ancestors.forEach(p => next.add(p));
        return next;
      });
    }
  }, [targetFile, visible]);

  const handleToggleExpand = useCallback((path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleFileClick = useCallback((path) => {
    setCurrentFile(path);
  }, []);

  const handleFileClose = useCallback(() => {
    setCurrentFile(null);
  }, []);

  const itemCount = items ? items.length : 0;

  return (
    <div className={styles.container}>
      {/* 上半部分：文件列表 */}
      <div className={styles.fileListSection}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerTitle}>{t('ui.projectFolder')}</span>
            <span className={styles.fileCount}>{itemCount}</span>
          </div>
          {onClose && (
            <button className={styles.closeBtn} onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className={styles.treeContainer}>
          {loading && <div className={styles.statusText}>{t('ui.loading')}</div>}
          {error && <div className={styles.errorText}>{t('ui.fileLoadError')}</div>}
          {!loading && !error && (!items || items.length === 0) && (
            <div className={styles.emptyText}>{t('ui.mobileFileExplorerHint')}</div>
          )}
          {!loading && !error && items && items.map(item => (
            <MobileTreeNode
              key={item.name}
              item={item}
              path=""
              depth={0}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              currentFile={currentFile}
              onFileClick={handleFileClick}
            />
          ))}
        </div>
      </div>

      {/* 下半部分：复用 PC 端文件详情组件 */}
      <div className={styles.contentSection}>
        {currentFile ? (
          isImageFile(currentFile) ? (
            <ImageViewer filePath={currentFile} onClose={handleFileClose} />
          ) : (
            <FileContentView filePath={currentFile} onClose={handleFileClose} />
          )
        ) : (
          <div className={styles.contentPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 6c0-1.1.9-2 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
            </svg>
            <span>{t('ui.mobileFileExplorerHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
