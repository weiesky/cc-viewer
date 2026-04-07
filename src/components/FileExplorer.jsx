import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Dropdown, Modal, Input, message } from 'antd';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import OpenFolderIcon from './OpenFolderIcon';
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
      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--color-accent-yellow)" stroke="none">
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

function TreeNode({ item, path, depth, onFileClick, expandedPaths, onToggleExpand, currentFile, onFileRenamed, refreshTrigger, onHtmlPreview, onAttachToChat }) {
  const [children, setChildren] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
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
      // Office 文件用系统默认应用打开
      const officeExts = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf']);
      if (officeExts.has(ext)) {
        fetch(apiUrl('/api/open-file'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: childPath }) })
          .catch(() => {});
        return;
      }
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
      case 'rename':
        startEditing();
        break;
      case 'newFile': {
        const inputId = `ccv-newfile-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newFile'),
          content: <Input id={inputId} autoFocus placeholder="filename.ext" style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newFile'),
          onOk: () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) return Promise.reject();
            return fetch(apiUrl('/api/create-file'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dirPath: childPath, name }),
            }).then(r => {
              if (r.ok && onFileRenamed) onFileRenamed(null, `${childPath}/${name}`);
            });
          },
        });
        break;
      }
      case 'newDir': {
        const inputId = `ccv-newdir-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newDir'),
          content: <Input id={inputId} autoFocus placeholder="folder-name" style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newDir'),
          onOk: () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) return Promise.reject();
            return fetch(apiUrl('/api/create-dir'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dirPath: childPath, name }),
            }).then(r => {
              if (r.ok && onFileRenamed) onFileRenamed(null, `${childPath}/${name}`);
            });
          },
        });
        break;
      }
      case 'delete':
        Modal.confirm({
          title: isDir ? t('ui.contextMenu.deleteDirConfirm', { name: item.name }) : t('ui.contextMenu.deleteConfirm', { name: item.name }),
          okType: 'danger',
          okText: t('ui.contextMenu.delete'),
          onOk: () => fetch(apiUrl('/api/delete-file'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: childPath }),
          }).then(r => {
            if (r.ok && onFileRenamed) onFileRenamed(childPath, null);
          }).catch(() => {}),
        });
        break;
    }
  }, [childPath, item.name, isDir, startEditing, onFileRenamed]);

  const treeItemDiv = (
    <div
      ref={itemRef}
      className={`${styles.treeItem}${isSelected ? ' ' + styles.treeItemSelected : ''}${isGitIgnored ? ' ' + styles.treeItemGitIgnored : ''}`}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
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
        <TreeNode key={child.name} item={child} path={childPath} depth={depth + 1} onFileClick={onFileClick} expandedPaths={expandedPaths} onToggleExpand={onToggleExpand} currentFile={currentFile} onFileRenamed={onFileRenamed} refreshTrigger={refreshTrigger} onHtmlPreview={onHtmlPreview} onAttachToChat={onAttachToChat} />
      ))}
    </>
  );
}

export default function FileExplorer({ style, onClose, onFileClick, expandedPaths, onToggleExpand, currentFile, refreshTrigger, onFileRenamed, onAttachToChat }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [htmlPreviewPath, setHtmlPreviewPath] = useState(null);
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
          content: <Input id={inputId} autoFocus placeholder="filename.ext" style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newFile'),
          onOk: () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) return Promise.reject();
            return fetch(apiUrl('/api/create-file'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dirPath: '', name }),
            }).then(r => {
              if (r.ok && onFileRenamed) onFileRenamed(null, name);
            });
          },
        });
        break;
      }
      case 'newDir': {
        const inputId = `ccv-newdir-root-${Date.now()}`;
        Modal.confirm({
          title: t('ui.contextMenu.newDir'),
          content: <Input id={inputId} autoFocus placeholder="folder-name" style={{ background: 'var(--bg-container)', borderColor: 'var(--border-primary)', color: 'var(--text-secondary)', caretColor: 'var(--text-secondary)' }} onPressEnter={() => { document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')?.click(); }} />,
          okText: t('ui.contextMenu.newDir'),
          onOk: () => {
            const input = document.getElementById(inputId);
            const name = (input?.value || '').trim();
            if (!name) return Promise.reject();
            return fetch(apiUrl('/api/create-dir'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dirPath: '', name }),
            }).then(r => {
              if (r.ok && onFileRenamed) onFileRenamed(null, name);
            });
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

  return (
    <div className={styles.fileExplorer} style={style}>
      <div className={styles.header}>
        <Dropdown menu={{ items: headerMenuItems, onClick: handleHeaderMenuClick }} trigger={['contextMenu']}>
          <span className={styles.headerTitle}>
            <OpenFolderIcon apiEndpoint={apiUrl('/api/open-project-dir')} title={t('ui.openProjectDir')} size={14} />
            {t('ui.fileExplorer')}
          </span>
        </Dropdown>
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
          <TreeNode key={item.name} item={item} path="" depth={0} onFileClick={onFileClick} expandedPaths={expandedPaths} onToggleExpand={onToggleExpand} currentFile={currentFile} onFileRenamed={onFileRenamed} refreshTrigger={refreshTrigger} onHtmlPreview={setHtmlPreviewPath} onAttachToChat={onAttachToChat} />
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
            src={apiUrl(`/api/file-raw?path=${encodeURIComponent(htmlPreviewPath)}`)}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title={htmlPreviewPath}
            sandbox="allow-scripts allow-popups allow-forms"
          />
        </Modal>
      )}
    </div>
  );
}
