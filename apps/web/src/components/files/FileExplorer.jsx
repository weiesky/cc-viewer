import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Dropdown, Modal, Input, message } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { getFileIcon } from '../../utils/fileIcons';
import OpenFolderIcon from '../common/OpenFolderIcon';
import RefreshIcon from '../common/RefreshIcon';
import styles from './FileExplorer.module.css';

function isExternalFileDrag(e) {
  return e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/x-internal-move');
}

// Drop 同步阶段抽取顶层 FileSystemEntry；必须在 drop handler 同步周期内调用，否则 items 失效
function getTopLevelEntries(items) {
  if (!items || !items.length) return null;
  const first = items[0];
  if (typeof first.webkitGetAsEntry !== 'function') return null;
  const entries = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== 'file') continue;
    const entry = items[i].webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  return entries.length ? entries : null;
}

// 批量读 DirectoryReader 直到返回空数组（Chrome 每次最多 100 项，必须循环）
function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const acc = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) resolve(acc);
          else { acc.push(...batch); readBatch(); }
        },
        reject
      );
    };
    readBatch();
  });
}

const SKIP_ENTRY_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.localized']);

// 递归展开 entry 树为 {file, relPath} 列表；depth cap 32 防 symlink 循环
async function expandEntries(entries, depth) {
  if (depth > 32) return [];
  const results = [];
  for (const entry of entries) {
    if (!entry || SKIP_ENTRY_NAMES.has(entry.name)) continue;
    if (entry.isFile) {
      try {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const rel = entry.fullPath ? (entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath) : file.name;
        results.push({ file, relPath: rel });
      } catch (e) {
        console.warn('[FileExplorer] skip unreadable file', entry.name, e && e.message);
      }
    } else if (entry.isDirectory) {
      try {
        const reader = entry.createReader();
        const children = await readAllEntries(reader);
        const sub = await expandEntries(children, depth + 1);
        results.push(...sub);
      } catch (e) {
        console.warn('[FileExplorer] skip unreadable dir', entry.name, e && e.message);
      }
    }
  }
  return results;
}

function TreeNode({ item, path, depth, onFileClick, expandedPaths, onToggleExpand, currentFile, onFileRenamed, refreshTrigger, onHtmlPreview, onAttachToChat, onInsertPathToChat, onImportFiles }) {
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const submittingRef = useRef(false);
  const itemRef = useRef(null);

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

  // expanded 变为 true 时自动加载子节点（恢复展开状态 & 从对话点击路径时级联展开）
  useEffect(() => {
    if (item.type === 'directory' && expanded && children === null && !loading) {
      fetchChildren();
    }
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // refreshTrigger 变化时，已展开的目录重新加载子节点
  useEffect(() => {
    if (refreshTrigger > 0 && item.type === 'directory' && expanded && children !== null) {
      fetchChildren();
    }
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(async () => {
    if (item.type !== 'directory') {
      const ext = (childPath || '').split('.').pop().toLowerCase();
      // .html/.htm 文件在弹窗 iframe 中预览
      if (ext === 'html' || ext === 'htm') {
        if (onHtmlPreview) onHtmlPreview(childPath);
        return;
      }
      // 点击文件，触发回调（Office 文件由上层 onFileClick 回调统一拦截）
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
  }, [expanded, children, childPath, item, onFileClick, onToggleExpand, fetchChildren, onHtmlPreview]);

  const isDir = item.type === 'directory';
  const isSelected = currentFile && currentFile === childPath;

  // 选中文件时自动滚动到可见区域
  useEffect(() => {
    if (isSelected && itemRef.current) {
      requestAnimationFrame(() => {
        itemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      });
    }
  }, [isSelected]);

  // 进入编辑模式
  const startEditing = useCallback(() => {
    setEditName(item.name);
    setEditing(true);
    submittingRef.current = false;
  }, [item.name]);

  // 编辑模式下自动 focus 并选中文件名（不含扩展名）
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      const dotIdx = item.name.lastIndexOf('.');
      if (dotIdx > 0 && item.type !== 'directory') {
        inputRef.current.setSelectionRange(0, dotIdx);
      } else {
        inputRef.current.select();
      }
    }
  }, [editing, item.name, item.type]);

  // 提交重命名
  const submitRename = useCallback(async () => {
    if (submittingRef.current) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === item.name) {
      setEditing(false);
      return;
    }
    submittingRef.current = true;
    try {
      const res = await fetch(apiUrl('/api/rename-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: childPath, newName: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(t('ui.renameFailed', { error: data.error || res.statusText }));
        setEditing(false);
        return;
      }
      setEditing(false);
      if (onFileRenamed) onFileRenamed(childPath, data.newPath);
    } catch (err) {
      alert(t('ui.renameFailed', { error: err.message }));
      setEditing(false);
    }
  }, [editName, item.name, childPath, onFileRenamed]);

  // 取消编辑
  const cancelEditing = useCallback(() => {
    setEditing(false);
  }, []);

  // 双击进入编辑模式
  const handleDoubleClick = useCallback((e) => {
    e.stopPropagation();
    if (isSelected) {
      startEditing();
    }
  }, [isSelected, startEditing]);

  // 键盘事件：Enter 进入编辑模式 / F2 进入编辑模式
  const handleKeyDown = useCallback((e) => {
    if (editing) return;
    if ((e.key === 'Enter' || e.key === 'F2') && isSelected) {
      e.preventDefault();
      e.stopPropagation();
      startEditing();
    }
  }, [editing, isSelected, startEditing]);

  // 输入框键盘事件
  const handleInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
    e.stopPropagation();
  }, [submitRename, cancelEditing]);

  const handleClick = useCallback((e) => {
    if (editing) {
      e.stopPropagation();
      return;
    }
    toggle();
  }, [editing, toggle]);

  // 拖拽事件处理
  const handleDragStart = useCallback((e) => {
    if (editing) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', childPath);
    e.dataTransfer.setData('text/x-internal-move', '1');
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }, [childPath, editing]);

  const handleDragEnd = useCallback(() => {
    setDragging(false);
  }, []);

  const autoExpandTimer = useRef(null);
  const handleDragOver = useCallback((e) => {
    const isExternal = isExternalFileDrag(e);
    const isInternal = e.dataTransfer.types.includes('text/x-internal-move');
    // 内部移动只接受目录；外部导入接受任意节点（文件节点→导入到父目录）
    if (isInternal && !isDir) return;
    if (!isExternal && !isInternal) return;
    e.preventDefault();
    // 节点接受 drop 后阻止冒泡：否则容器级 onDragOver 会同帧 setExternalDragOver(true)
    // / 覆写 dropEffect，导致视觉闪烁与"拖到空白处=移到根"的语义被错误触发。
    e.stopPropagation();
    e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
    setDragOver(true);
    // hover 在折叠目录上 500ms → 自动展开（外部导入和内部移动都支持）
    if (isDir && !expanded && !autoExpandTimer.current) {
      autoExpandTimer.current = setTimeout(() => {
        onToggleExpand(childPath);
        autoExpandTimer.current = null;
      }, 500);
    }
  }, [isDir, expanded, childPath, onToggleExpand]);

  const handleDragLeave = useCallback((e) => {
    // 只在真正离开此节点时才移除高亮（忽略子元素事件冒泡）
    if (itemRef.current && !itemRef.current.contains(e.relatedTarget)) {
      setDragOver(false);
      if (autoExpandTimer.current) { clearTimeout(autoExpandTimer.current); autoExpandTimer.current = null; }
    }
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    // 任何已 preventDefault 的 drop 都视为"被节点消费"——同时 stopPropagation 防止冒泡
    // 到容器级 handleContainerDrop 再次触发"移到根"。包含所有 internal early-return 路径。
    e.stopPropagation();
    setDragOver(false);
    // External file drop — 目录节点导入到该目录，文件节点导入到其父目录
    if (isExternalFileDrag(e) && (e.dataTransfer.files.length > 0 || (e.dataTransfer.items && e.dataTransfer.items.length > 0))) {
      // 同步阶段一次性抽取 entry（异步后 items 会失效）
      const topEntries = getTopLevelEntries(e.dataTransfer.items);
      const flatFiles = Array.from(e.dataTransfer.files);
      const targetDir = isDir ? childPath : (childPath.includes('/') ? childPath.substring(0, childPath.lastIndexOf('/')) : '');
      if (onImportFiles) onImportFiles({ topEntries, flatFiles }, targetDir);
      return;
    }
    // Internal move
    const fromPath = e.dataTransfer.getData('text/plain');
    if (!fromPath || !isDir) return;
    // 不能拖到自身
    if (fromPath === childPath) return;
    // 不能拖到自身子目录
    if (childPath.startsWith(fromPath + '/')) return;
    // 不能拖到当前所在的同目录（无意义移动）
    const fromDir = fromPath.includes('/') ? fromPath.substring(0, fromPath.lastIndexOf('/')) : '';
    if (fromDir === childPath) return;
    try {
      const res = await fetch(apiUrl('/api/move-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPath, toDir: childPath }),
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
  }, [childPath, isDir, onFileRenamed, onImportFiles]);

  // 右键菜单项
  const contextMenuItems = useMemo(() => {
    if (isDir) return [
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
    return [
      { key: 'reveal', label: t('ui.contextMenu.revealInExplorer') },
      { key: 'copyPath', label: t('ui.contextMenu.copyPath') },
      { key: 'copyRelPath', label: t('ui.contextMenu.copyRelativePath') },
      { key: 'attachToChat', label: t('ui.contextMenu.attachToChat') },
      { key: 'insertPathToChat', label: t('ui.contextMenu.insertPathToChat') },
      { type: 'divider' },
      { key: 'rename', label: t('ui.contextMenu.rename') },
      { key: 'delete', label: t('ui.contextMenu.delete'), danger: true },
    ];
  }, [isDir]);

  const handleMenuClick = useCallback(({ key }) => {
    switch (key) {
      case 'reveal':
        fetch(apiUrl('/api/reveal-file'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: childPath }),
        }).catch(() => {});
        break;
      case 'openTerminal':
        fetch(apiUrl('/api/open-terminal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: childPath }),
        }).catch(() => {});
        break;
      case 'copyPath':
        fetch(apiUrl('/api/resolve-path'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: childPath }),
        })
          .then(r => r.json())
          .then(data => {
            if (data.fullPath) {
              navigator.clipboard.writeText(data.fullPath).then(() => message.success(t('ui.copied'))).catch(() => {});
            }
          })
          .catch(() => {});
        break;
      case 'copyRelPath':
        navigator.clipboard.writeText(childPath).then(() => message.success(t('ui.copied'))).catch(() => {});
        break;
      case 'attachToChat':
        onAttachToChat?.(childPath);
        break;
      case 'insertPathToChat':
        onInsertPathToChat?.(childPath);
        break;
      case 'rename':
        startEditing();
        break;
      case 'newFile': {
        const inputId = `ccv-newfile-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newFile'),
          content: <Input id={inputId} autoFocus placeholder={t('ui.contextMenu.newFilePlaceholder')} style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newFile'),
          // 失败 throw → antd Modal.confirm 保住弹窗供重试；message.error 显式提示，避免静默关闭误以为成功（同 #84 模式）。
          onOk: async () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) throw new Error('Empty filename');
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/create-file'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: childPath, name }),
              });
              if (r.ok) { if (onFileRenamed) onFileRenamed(null, `${childPath}/${name}`); return; }
              errMsg = `HTTP ${r.status}`;
              try { const d = await r.json(); if (d?.error) errMsg = d.error; } catch {}
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
          content: <Input id={inputId} autoFocus placeholder={t('ui.contextMenu.newDirPlaceholder')} style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newDir'),
          onOk: async () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) throw new Error('Empty dir name');
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/create-dir'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: childPath, name }),
              });
              if (r.ok) { if (onFileRenamed) onFileRenamed(null, `${childPath}/${name}`); return; }
              errMsg = `HTTP ${r.status}`;
              try { const d = await r.json(); if (d?.error) errMsg = d.error; } catch {}
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
          title: isDir ? t('ui.contextMenu.deleteDirConfirm', { name: item.name }) : t('ui.contextMenu.deleteConfirm', { name: item.name }),
          okType: 'danger',
          okText: t('ui.contextMenu.delete'),
          onOk: async () => {
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/delete-file'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: childPath }),
              });
              if (r.ok) { if (onFileRenamed) onFileRenamed(childPath, null); return; }
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
  }, [childPath, item.name, isDir, startEditing, onFileRenamed, onAttachToChat, onInsertPathToChat]);

  const treeItemDiv = (
    <div
      ref={itemRef}
      className={`${styles.treeItem}${isSelected ? ' ' + styles.treeItemSelected : ''}${isGitIgnored ? ' ' + styles.treeItemGitIgnored : ''}${dragging ? ' ' + styles.treeItemDragging : ''}${dragOver ? ' ' + styles.treeItemDragOver : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      draggable={!editing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className={styles.arrow}>
        {isDir ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.arrowIcon} style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        ) : ''}
      </span>
      <span className={styles.icon}>{getFileIcon(item.name, item.type)}</span>
      {editing ? (
        <input
          ref={inputRef}
          className={styles.fileNameInput}
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={submitRename}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className={styles.fileName}>{item.name}</span>
      )}
    </div>
  );

  return (
    <>
      <Dropdown menu={{ items: contextMenuItems, onClick: handleMenuClick }} trigger={['contextMenu']}>
        {treeItemDiv}
      </Dropdown>
      {expanded && loading && (
        <div className={styles.loading} style={{ paddingLeft: 24 + depth * 16 }}>...</div>
      )}
      {expanded && error && (
        <div className={styles.error} style={{ paddingLeft: 24 + depth * 16 }}>{error}</div>
      )}
      {expanded && children && children.map(child => (
        <TreeNode key={child.name} item={child} path={childPath} depth={depth + 1} onFileClick={onFileClick} expandedPaths={expandedPaths} onToggleExpand={onToggleExpand} currentFile={currentFile} onFileRenamed={onFileRenamed} refreshTrigger={refreshTrigger} onHtmlPreview={onHtmlPreview} onAttachToChat={onAttachToChat} onInsertPathToChat={onInsertPathToChat} onImportFiles={onImportFiles} />
      ))}
    </>
  );
}

export default function FileExplorer({ style, onClose, onFileClick, expandedPaths, onToggleExpand, currentFile, refreshTrigger, onManualRefresh, onFileRenamed, onAttachToChat, onInsertPathToChat }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [htmlPreviewPath, setHtmlPreviewPath] = useState(null);
  const [externalDragOver, setExternalDragOver] = useState(false);
  // 内部拖动（树内文件拖到容器空白处 = 移到项目根目录）的容器高亮状态。
  // 与 externalDragOver 同帧只可能有一个为 true（容器 dragOver handler 用 isInternal 二选一）。
  const [internalContainerDragOver, setInternalContainerDragOver] = useState(false);
  const mounted = useRef(true);
  const containerRef = useRef(null);

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

  const headerMenuItems = useMemo(() => [
    { key: 'reveal', label: t('ui.contextMenu.revealInExplorer') },
    { key: 'openTerminal', label: t('ui.contextMenu.openTerminal') },
    { key: 'newFile', label: t('ui.contextMenu.newFile') },
    { key: 'newDir', label: t('ui.contextMenu.newDir') },
    { type: 'divider' },
    { key: 'copyPath', label: t('ui.contextMenu.copyPath') },
    { key: 'copyRelPath', label: t('ui.contextMenu.copyRelativePath') },
  ], []);

  const handleHeaderMenuClick = useCallback(({ key }) => {
    switch (key) {
      case 'reveal':
        fetch(apiUrl('/api/open-project-dir'), { method: 'POST' }).catch(() => {});
        break;
      case 'openTerminal':
        fetch(apiUrl('/api/open-terminal'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '' }),
        }).catch(() => {});
        break;
      case 'newFile': {
        const inputId = `ccv-newfile-root-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newFile'),
          content: <Input id={inputId} autoFocus placeholder={t('ui.contextMenu.newFilePlaceholder')} style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newFile'),
          // 失败 throw → antd Modal.confirm 保住弹窗供重试（同 #84 模式）。
          onOk: async () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) throw new Error('Empty filename');
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/create-file'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: '', name }),
              });
              if (r.ok) { if (onFileRenamed) onFileRenamed(null, name); return; }
              errMsg = `HTTP ${r.status}`;
              try { const d = await r.json(); if (d?.error) errMsg = d.error; } catch {}
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
        const inputId = `ccv-newdir-root-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newDir'),
          content: <Input id={inputId} autoFocus placeholder={t('ui.contextMenu.newDirPlaceholder')} style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newDir'),
          onOk: async () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) throw new Error('Empty dir name');
            let errMsg;
            try {
              const r = await fetch(apiUrl('/api/create-dir'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirPath: '', name }),
              });
              if (r.ok) { if (onFileRenamed) onFileRenamed(null, name); return; }
              errMsg = `HTTP ${r.status}`;
              try { const d = await r.json(); if (d?.error) errMsg = d.error; } catch {}
            } catch (err) {
              errMsg = err?.message || 'network error';
            }
            message.error(t('ui.contextMenu.createDirFailed', { error: errMsg }));
            throw new Error(errMsg);
          },
        });
        break;
      }
      case 'copyPath':
        fetch(apiUrl('/api/resolve-path'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '' }),
        }).then(r => r.json()).then(data => {
          if (data.fullPath) navigator.clipboard.writeText(data.fullPath).then(() => message.success(t('ui.copied'))).catch(() => {});
        }).catch(() => {});
        break;
      case 'copyRelPath':
        navigator.clipboard.writeText('.').then(() => message.success(t('ui.copied'))).catch(() => {});
        break;
    }
  }, [onFileRenamed]);

  // Import external files (支持批量文件夹拖入，保留目录结构)
  // 入参 payload：{ topEntries, flatFiles }（drop 事件同步抽取）或 File[]（降级兼容）
  const importFiles = useCallback(async (payload, targetDir) => {
    // 1. 统一为 {file, relPath}[]
    let entries = [];
    const topEntries = payload && payload.topEntries;
    const flatFiles = payload && payload.flatFiles;
    const isEntryShape = Array.isArray(topEntries) || Array.isArray(flatFiles);
    if (isEntryShape && topEntries && topEntries.length > 0) {
      // 有 FileSystemEntry：扫描阶段可能耗时，给个 loading
      const hideScan = message.loading(t('ui.importScanning'), 0);
      let scanFailed = false;
      try {
        entries = await expandEntries(topEntries, 0);
      } catch (e) {
        console.warn('[FileExplorer] expandEntries failed, falling back to flat files', e);
        scanFailed = true;
      } finally {
        hideScan();
      }
      // 扫描失败或扫描结果为空时，降级到浏览器展平的 flatFiles（至少顶层文件能导入）
      if ((scanFailed || entries.length === 0) && flatFiles && flatFiles.length > 0) {
        entries = flatFiles.map(f => ({ file: f, relPath: f.name }));
      }
    } else if (isEntryShape && flatFiles && flatFiles.length > 0) {
      // 浏览器不支持 webkitGetAsEntry → 降级为平铺
      entries = flatFiles.map(f => ({ file: f, relPath: f.name }));
    } else if (Array.isArray(payload)) {
      // 纯 File[] 入参（兼容保留）
      entries = payload.map(f => ({ file: f, relPath: f.name }));
    }
    if (entries.length === 0) {
      // 拖入了但没有可导入文件（空文件夹 / 全是被过滤的系统文件）
      if ((topEntries && topEntries.length > 0) || (flatFiles && flatFiles.length > 0)) {
        message.info(t('ui.importNoFiles'));
      }
      return;
    }

    // 2. 大批量预警
    if (entries.length > 1000) {
      const proceed = await new Promise(resolve => {
        Modal.confirm({
          title: t('ui.importConfirmLarge', { count: entries.length }),
          okText: t('ui.ok'),
          cancelText: t('ui.cancel'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!proceed) return;
    }

    // 3. 并发上传（限制 3），展示持久 loading（总量已知）
    const total = entries.length;
    let successCount = 0;
    const failures = [];
    let firstOkRelPath = null;
    const hideLoading = message.loading(t('ui.importingProgress', { total }), 0);

    let idx = 0;
    const worker = async () => {
      while (idx < entries.length) {
        const myIdx = idx++;
        const { file, relPath } = entries[myIdx];
        const lastSlash = relPath.lastIndexOf('/');
        const subDir = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
        const finalDir = [targetDir, subDir].filter(Boolean).join('/');
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await fetch(apiUrl(`/api/import-file?dir=${encodeURIComponent(finalDir)}`), { method: 'POST', body: form });
          const data = await res.json();
          if (!res.ok) {
            failures.push({ name: relPath, error: data.error || 'Import failed' });
          } else {
            successCount++;
            if (!firstOkRelPath) firstOkRelPath = data.relPath || relPath;
          }
        } catch (err) {
          failures.push({ name: relPath, error: err.message || 'Import failed' });
        }
      }
    };
    const parallel = Math.min(3, entries.length);
    await Promise.all(Array.from({ length: parallel }, () => worker()));
    hideLoading();

    // 4. 汇总消息
    if (failures.length === 0) {
      if (successCount === 1) {
        message.success(t('ui.fileImported', { name: firstOkRelPath }));
      } else {
        message.success(t('ui.filesImported', { count: successCount }));
      }
    } else {
      const preview = failures.slice(0, 3).map(f => f.name).join(', ');
      const more = failures.length > 3 ? ` (+${failures.length - 3})` : '';
      if (successCount > 0) {
        message.warning(t('ui.importPartialFailed', { ok: successCount, failed: failures.length, names: preview + more }));
      } else {
        message.error(t('ui.importAllFailed', { failed: failures.length, names: preview + more }));
      }
    }

    if (successCount > 0 && onFileRenamed) {
      onFileRenamed(null, firstOkRelPath);
    }
  }, [onFileRenamed]);

  // Container-level drag events for external files
  // dragover 定时器模式：持续收到 dragover 时保持高亮，300ms 无 dragover 则认为拖拽结束
  const dragTimerRef = useRef(null);

  const resetDragState = useCallback(() => {
    if (dragTimerRef.current) { clearTimeout(dragTimerRef.current); dragTimerRef.current = null; }
    setExternalDragOver(false);
    setInternalContainerDragOver(false);
  }, []);

  // 全局 drop/dragend 兜底：确保任何情况下状态都能重置
  useEffect(() => {
    const handler = () => resetDragState();
    document.addEventListener('drop', handler);
    document.addEventListener('dragend', handler);
    return () => {
      document.removeEventListener('drop', handler);
      document.removeEventListener('dragend', handler);
    };
  }, [resetDragState]);

  const handleContainerDragOver = useCallback((e) => {
    const isInternal = e.dataTransfer.types.includes('text/x-internal-move');
    const isExternal = isExternalFileDrag(e);
    if (!isInternal && !isExternal) return;
    e.preventDefault();
    if (isInternal) {
      e.dataTransfer.dropEffect = 'move';
      if (!internalContainerDragOver) setInternalContainerDragOver(true);
    } else {
      e.dataTransfer.dropEffect = 'copy';
      if (!externalDragOver) setExternalDragOver(true);
    }
    // 每次 dragover 重置定时器，300ms 内无新 dragover 则清除状态
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
    dragTimerRef.current = setTimeout(() => {
      setExternalDragOver(false);
      setInternalContainerDragOver(false);
      dragTimerRef.current = null;
    }, 300);
  }, [externalDragOver, internalContainerDragOver]);

  const handleContainerDrop = useCallback(async (e) => {
    resetDragState();
    // 1) External file drop：保留既有 import 行为（拖外部文件到容器空白处 = 导入到根）
    if (isExternalFileDrag(e)) {
      e.preventDefault();
      e.stopPropagation();
      // 同步阶段一次性抽取 entry（异步后 items 会失效）
      const topEntries = getTopLevelEntries(e.dataTransfer.items);
      const flatFiles = Array.from(e.dataTransfer.files);
      if ((topEntries && topEntries.length > 0) || flatFiles.length > 0) {
        importFiles({ topEntries, flatFiles }, '');
      }
      return;
    }
    // 2) Internal move：拖树内文件到容器空白处 = 移到项目根目录。
    //    TreeNode 内 drop 已 stopPropagation，所以只有"目标 = 空白处"才会走到这里。
    if (!e.dataTransfer.types.includes('text/x-internal-move')) return;
    e.preventDefault();
    const fromPath = e.dataTransfer.getData('text/plain');
    if (!fromPath) {
      // Safari / Firefox 个别版本在 drop 阶段 getData('text/plain') 偶发返空，
      // 用户感知是"拖到空白处啥也没发生"；落一条 warn 便于排查这种平台 bug。
      console.warn('[FileExplorer] internal-move drop with empty fromPath; ignored');
      return;
    }
    const fromDir = fromPath.includes('/') ? fromPath.substring(0, fromPath.lastIndexOf('/')) : '';
    if (fromDir === '') return; // 已在根，no-op（拖回原位无效果，符合直觉）
    try {
      const res = await fetch(apiUrl('/api/move-file'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPath, toDir: '' }),
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
  }, [importFiles, resetDragState, onFileRenamed]);

  return (
    <div ref={containerRef} className={`${styles.fileExplorer}${internalContainerDragOver ? ' ' + styles.internalDragOverContainer : ''}`} style={style} data-file-explorer onDragOver={handleContainerDragOver} onDrop={handleContainerDrop}>
      <div className={styles.header}>
        <Dropdown menu={{ items: headerMenuItems, onClick: handleHeaderMenuClick }} trigger={['contextMenu']}>
          <span className={styles.headerTitle}>
            <OpenFolderIcon apiEndpoint={apiUrl('/api/open-project-dir')} title={t('ui.openProjectDir')} size={14} />
            {t('ui.fileExplorer')}
            {/* 手动刷新：外部 mv/cp/系统级文件变化等 tool_result 感知不到的场景下用户兜底；
                复用既有 refreshTrigger++ 链路（ChatView state.fileExplorerRefresh），TreeNode
                的 useEffect 监听到变化 → 已展开目录全部重拉一次。RefreshIcon 内部封装 300ms
                cooldown 防狂点 + 360° 单次旋转反馈。 */}
            {onManualRefresh && (
              <RefreshIcon onClick={onManualRefresh} title={t('ui.fileExplorer.refresh')} />
            )}
          </span>
        </Dropdown>
        <button className={styles.headerCloseBtn} onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="11 17 6 12 11 7"/>
            <polyline points="18 17 13 12 18 7"/>
          </svg>
        </button>
      </div>
      <div className={styles.treeContainer}>
        {error && <div className={styles.error}>{error}</div>}
        {!items && !error && <div className={styles.loading}>{t('ui.loading')}</div>}
        {items && items.map(item => (
          <TreeNode key={item.name} item={item} path="" depth={0} onFileClick={onFileClick} expandedPaths={expandedPaths} onToggleExpand={onToggleExpand} currentFile={currentFile} onFileRenamed={onFileRenamed} refreshTrigger={refreshTrigger} onHtmlPreview={setHtmlPreviewPath} onAttachToChat={onAttachToChat} onInsertPathToChat={onInsertPathToChat} onImportFiles={importFiles} />
        ))}
      </div>
      {htmlPreviewPath && (
        <Modal
          open
          onCancel={() => setHtmlPreviewPath(null)}
          footer={null}
          closable
          maskClosable
          zIndex={1100}
          width="calc(100vw - 80px)"
          title={<span style={{ color: 'var(--text-primary)', fontSize: 14 }}>{htmlPreviewPath.split('/').pop() || 'Preview'}</span>}
          styles={{
            header: { background: 'var(--bg-container)', borderBottom: '1px solid var(--border-primary)', padding: '12px 20px' },
            body: { background: '#fff', height: 'calc(100vh - 160px)', overflow: 'hidden', padding: 0 },
            mask: { background: 'rgba(0,0,0,0.7)' },
            content: { background: 'var(--bg-container)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 0 },
          }}
          centered
        >
          <iframe
            // 用 path-style URL 而非 ?path=...：HTML 里相对 `<script src="sorter.js">` 浏览器
            // 才能按"同目录"解析到 `/api/file-raw/<dir>/sorter.js`，c8 / nyc 类报告才完整。
            // path segment 各自 encode 保留分隔斜杠。
            src={apiUrl('/api/file-raw/' + htmlPreviewPath.split('/').map(encodeURIComponent).join('/'))}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title={htmlPreviewPath}
            // 只放 allow-scripts 跟 server CSP 同步（取交集后才生效）。popup / form 都不放：
            // c8 / nyc 报告纯静态交互（sortable / 折叠 / 行内 location.hash 跳转）不依赖这两个。
            sandbox="allow-scripts"
          />
        </Modal>
      )}
    </div>
  );
}
