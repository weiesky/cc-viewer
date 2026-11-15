import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Dropdown, message } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { getFileIcon } from '../../utils/fileIcons';
import { fetchAllRepos } from '../../utils/gitApi';
import { buildGitTree } from '../../utils/gitTreeBuilder';
import { toWorkspacePath } from '../../utils/gitWorkspacePath';
import { FILE_DRAG_TYPE, FOLDER_DRAG_TYPE } from '../../utils/fileDragDrop';
import { loadGitChangesCollapsedDirs, saveGitChangesCollapsedDirs } from '../../utils/fileExpandedPathsStorage';
import { useSessionStoragePersistedSet } from '../../hooks/useSessionStoragePersistedSet';
import RefreshIcon from '../common/RefreshIcon';
import styles from './GitChanges.module.css';

const STATUS_COLORS = {
  'M': '#e2c08d',
  'A': '#73c991',
  'D': '#f14c4c',
  'R': '#73c991',
  'C': '#73c991',
  'U': '#e2c08d',
  '?': '#73c991',
  '??': '#73c991',
  // Unmerged/conflict porcelain codes — red, same as D, to stand out from regular changes.
  'UU': '#f14c4c',
  'AA': '#f14c4c',
  'DD': '#f14c4c',
  'AU': '#f14c4c',
  'UA': '#f14c4c',
  'DU': '#f14c4c',
  'UD': '#f14c4c',
};

const STATUS_LABELS = {
  '??': 'U',
};

// Same dataTransfer contract as the dragstart payload written by FileExplorer
// (components/files/FileExplorer.jsx); the FILE/FOLDER type constants live in
// utils/fileDragDrop.js.
// NOTE: rows reuse the shared 'text/x-internal-move' marker, so a git row is also a
// valid *move* source for FileExplorer/FileBrowserModal drop targets. That path is
// currently unreachable: the UI cannot start a sidebar-row drag onto those targets
// (the two panels are mutually exclusive, and the modal is read-only / masked).
function writeFileDragPayload(e, path, isDir) {
  if (!path) return;
  e.dataTransfer.setData('text/plain', path);
  e.dataTransfer.setData('text/x-internal-move', '1');
  e.dataTransfer.setData(isDir ? FOLDER_DRAG_TYPE : FILE_DRAG_TYPE, '1');
  e.dataTransfer.effectAllowed = 'copyMove';
}

// Rename/copy rows carry a porcelain pseudo-path ("old -> new") that the server does
// not split (server/routes/git.js). The XY status can be a pair (e.g. 'RM' after a
// staged rename + edit), so reject any status containing R or C.
function isFileRowDraggable(status) {
  return typeof status === 'string' && !status.includes('R') && !status.includes('C');
}

function TreeDir({ name, node, depth, repoPath, onFileClick, onOpenFile, onRestore, onAttachToChat, onInsertPathToChat, selectedFile, selectedRepo, commitHash, selectedCommitHash, collapsedDirs, onToggleDir, parentPath = '' }) {
  const dirNames = Object.keys(node.dirs).sort();
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  // 累计 dirPath：父级 + name；name 空（根节点）时透传 parentPath 不变。
  const dirPath = name ? (parentPath ? `${parentPath}/${name}` : name) : parentPath;
  // 是否可折叠：commit details 路径不传 onToggleDir，整段降级为纯渲染。
  const collapsible = !!(name && onToggleDir);
  const dirKey = collapsible ? `${repoPath}::${dirPath}` : null;
  const isCollapsed = collapsible && !!collapsedDirs?.has(dirKey);
  // useCallback 让每个 TreeDir 实例的 click/keydown handler 跨 re-render 稳定引用
  // （deps [onToggleDir, dirKey] 都是稳定值：onToggleDir 由父组件 useCallback([]) 包过；
  // dirKey 是同一字符串字面量）。递归大目录树 toggle 不再每次重建 N 对闭包。
  const handleClick = useCallback(() => {
    if (onToggleDir && dirKey) onToggleDir(dirKey);
  }, [onToggleDir, dirKey]);
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onToggleDir && dirKey) onToggleDir(dirKey);
    }
  }, [onToggleDir, dirKey]);
  // Both the working tree and unpushed-commit file lists are drag sources. Directory
  // rows are always draggable; file rows skip renames/copies whose path is a pseudo-path.
  const [draggingDir, setDraggingDir] = useState(false);
  const [draggingFilePath, setDraggingFilePath] = useState(null);
  const handleDragEnd = useCallback(() => {
    setDraggingDir(false);
    setDraggingFilePath(null);
  }, []);
  const handleDirDragStart = useCallback((e) => {
    // A cross-directory rename pseudo-path ("a -> dir/b") is split by buildGitTree into
    // a fake directory node; it has no valid path, so do not start a drag for it.
    if (dirPath.includes(' -> ')) { e.preventDefault(); return; }
    writeFileDragPayload(e, toWorkspacePath(repoPath, dirPath), true);
    setDraggingDir(true);
  }, [repoPath, dirPath]);
  // One shared handler keeps the drag logic in a single place; each row binds its own
  // fullPath via a lightweight inline closure at the call site.
  const handleFileDragStart = useCallback((e, fullPath) => {
    writeFileDragPayload(e, toWorkspacePath(repoPath, fullPath), false);
    setDraggingFilePath(fullPath);
  }, [repoPath]);
  return (
    <>
      {name && (
        <div
          className={`${styles.dirItem} ${collapsible ? styles.dirItemClickable : ''} ${draggingDir ? styles.dirItemDragging : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          onClick={collapsible ? handleClick : undefined}
          onKeyDown={collapsible ? handleKeyDown : undefined}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? !isCollapsed : undefined}
          draggable
          onDragStart={handleDirDragStart}
          onDragEnd={handleDragEnd}
        >
          <span className={styles.dirArrow}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isCollapsed ? '' : styles.rotated90}>
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </span>
          <span className={styles.icon}>{getFileIcon('', 'directory')}</span>
          <span className={styles.dirName}>{name}</span>
        </div>
      )}
      {!isCollapsed && dirNames.map(dir => (
        <TreeDir key={dir} name={dir} node={node.dirs[dir]} depth={name ? depth + 1 : depth} repoPath={repoPath} onFileClick={onFileClick} onOpenFile={onOpenFile} onRestore={onRestore} onAttachToChat={onAttachToChat} onInsertPathToChat={onInsertPathToChat} selectedFile={selectedFile} selectedRepo={selectedRepo} commitHash={commitHash} selectedCommitHash={selectedCommitHash} collapsedDirs={collapsedDirs} onToggleDir={onToggleDir} parentPath={dirPath} />
      ))}
      {!isCollapsed && files.map(file => {
        const isSelected = selectedFile === file.fullPath && selectedRepo === repoPath
          && (commitHash || null) === (selectedCommitHash || null);
        const fileRowDraggable = isFileRowDraggable(file.status);
        return (
        <Dropdown key={`${commitHash || 'wt'}::${file.fullPath}`} menu={{ items: [
          { key: 'reveal', label: t('ui.contextMenu.revealInExplorer') },
          { key: 'copyPath', label: t('ui.contextMenu.copyPath') },
          { key: 'copyRelPath', label: t('ui.contextMenu.copyRelativePath') },
          // Keyboard / no-drag affordance mirroring FileExplorer's file menu.
          { key: 'attachToChat', label: t('ui.contextMenu.attachToChat') },
          { key: 'insertPathToChat', label: t('ui.contextMenu.insertPathToChat') },
        ], onClick: ({ key }) => {
          const resolvedPath = toWorkspacePath(repoPath, file.fullPath);
          if (key === 'reveal') {
            fetch(apiUrl('/api/reveal-file'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: resolvedPath }) }).catch(() => {});
          } else if (key === 'copyPath') {
            fetch(apiUrl('/api/resolve-path'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: resolvedPath }) })
              .then(r => r.json()).then(data => { if (data.fullPath) navigator.clipboard.writeText(data.fullPath).then(() => message.success(t('ui.copied'))).catch(() => {}); }).catch(() => {});
          } else if (key === 'copyRelPath') {
            navigator.clipboard.writeText(resolvedPath).then(() => message.success(t('ui.copied'))).catch(() => {});
          } else if (key === 'attachToChat') {
            onAttachToChat && onAttachToChat(resolvedPath);
          } else if (key === 'insertPathToChat') {
            onInsertPathToChat && onInsertPathToChat(resolvedPath);
          }
        }}} trigger={['contextMenu']}>
          <div
            className={`${styles.changeItem} ${isSelected ? styles.changeItemSelected : ''} ${draggingFilePath === file.fullPath ? styles.changeItemDragging : ''}`}
            style={{ paddingLeft: 8 + (name ? depth + 1 : depth) * 16 }}
            onClick={() => onFileClick && onFileClick(repoPath, file.fullPath, commitHash || null)}
            draggable={fileRowDraggable}
            onDragStart={fileRowDraggable ? (e) => handleFileDragStart(e, file.fullPath) : undefined}
            onDragEnd={fileRowDraggable ? handleDragEnd : undefined}
          >
            <span className={styles.icon}>{getFileIcon(file.name)}</span>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.actions}>
              <span title={t('ui.gitChanges.openFile')} onClick={e => { e.stopPropagation(); onOpenFile && onOpenFile(repoPath, file.fullPath); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </span>
              {!commitHash && (
                <span title={t('ui.gitChanges.restoreFile')} onClick={e => { e.stopPropagation(); onRestore && onRestore(repoPath, file.fullPath, file.name); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                </span>
              )}
            </span>
            <span className={styles.status} style={{ color: STATUS_COLORS[file.status] || '#888' }}>
              {STATUS_LABELS[file.status] || file.status}
            </span>
          </div>
        </Dropdown>
        );
      })}
    </>
  );
}

// Shared +n/-n line-stat badge pair; renders nothing when both counters are zero.
// Used by the panel total, the repo header, and each unpushed-commit row.
function StatBadges({ insertions, deletions }) {
  if (!(insertions > 0 || deletions > 0)) return null;
  return (
    <>
      <span className={`${styles.statBadge} ${styles.statInsert}`}>+{insertions}</span>
      <span className={`${styles.statBadge} ${styles.statDelete}`}>-{deletions}</span>
    </>
  );
}

function CommitRow({ commit, repoPath, expanded, onToggle, onFileClick, onOpenFile, onAttachToChat, onInsertPathToChat, selectedFile, selectedRepo, selectedCommitHash, depth = 0 }) {
  // Memoize tree build to avoid recomputing on every parent re-render
  // (e.g. when another commit is expanded or a file is selected elsewhere).
  const fileTree = useMemo(() => buildGitTree(commit.files), [commit.files]);
  const dateLabel = useMemo(() => {
    if (!commit.date) return '';
    try {
      const d = new Date(commit.date);
      if (Number.isNaN(d.getTime())) return '';
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }, [commit.date]);
  // Dragging the commit row itself passes the commit id (hash) to the drop target.
  const [draggingCommit, setDraggingCommit] = useState(false);
  const handleCommitDragStart = useCallback((e) => {
    writeFileDragPayload(e, commit.hash, false);
    setDraggingCommit(true);
  }, [commit.hash]);
  const handleCommitDragEnd = useCallback(() => setDraggingCommit(false), []);
  return (
    <>
      <div
        className={`${styles.commitItem} ${draggingCommit ? styles.changeItemDragging : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={onToggle}
        title={commit.subject}
        draggable
        onDragStart={handleCommitDragStart}
        onDragEnd={handleCommitDragEnd}
      >
        <span className={`${styles.commitArrow} ${expanded ? styles.commitArrowExpanded : ''}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18"/>
          </svg>
        </span>
        <span className={styles.commitHash}>{commit.shortHash}</span>
        <span className={styles.commitSubject}>{commit.subject}</span>
        {dateLabel && <span className={styles.commitMeta}>{dateLabel}</span>}
        <StatBadges insertions={commit.insertions} deletions={commit.deletions} />
        {!(commit.insertions > 0 || commit.deletions > 0) && commit.files.length > 0 && (
          // Zero line stats (binary-only, pure rename, mode-only) still touched files —
          // fall back to the file count so the row is not indistinguishable from a no-op.
          <span className={styles.statBadge}>{commit.files.length}</span>
        )}
      </div>
      {expanded && commit.files.length > 0 && (
        <TreeDir
          name=""
          node={fileTree}
          depth={depth + 1}
          repoPath={repoPath}
          onFileClick={onFileClick}
          onOpenFile={onOpenFile}
          onRestore={null}
          onAttachToChat={onAttachToChat}
          onInsertPathToChat={onInsertPathToChat}
          selectedFile={selectedFile}
          selectedRepo={selectedRepo}
          commitHash={commit.hash}
          selectedCommitHash={selectedCommitHash}
        />
      )}
    </>
  );
}

export default function GitChanges({ style, onClose, onFileClick, onOpenFile, onAttachToChat, onInsertPathToChat, refreshTrigger, onManualRefresh, projectName, project, instance }) {
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [selectedCommitHash, setSelectedCommitHash] = useState(null);
  const [collapsedRepos, setCollapsedRepos] = useState(new Set());
  // Per-repo state: which "unpushed" section is collapsed, which commits are expanded.
  // Keys: repoPath. Values: bool / Set<hash>.
  const [collapsedUnpushed, setCollapsedUnpushed] = useState({});
  const [expandedCommits, setExpandedCommits] = useState({});
  // 工作树目录折叠状态，key 形态 `${repoPath}::${dirPath}`，按 viewed 项目走 sessionStorage
  //（multi-project 2026-10：project = viewedProject || projectName，否则并行视图共用绑定项目的折叠态）。
  // 默认空集 = 全展开（语义跟 FileExplorer 的"展开集合"反向，由 helper 名 collapsedDirs 明示）。
  // commit details 路径下 TreeDir 不接 onToggleDir → 整段降级为纯渲染，不持久化（commit-scoped 状态短命，没必要）。
  // 持久化 + project 异步到达守卫 + firstMountRef 跳首跑全套走共用 hook。
  const [collapsedDirs, setCollapsedDirs] = useSessionStoragePersistedSet({
    projectName: project || projectName,
    load: loadGitChangesCollapsedDirs,
    save: saveGitChangesCollapsedDirs,
  });
  const mounted = useRef(true);

  // dir row 点击切换；key 由 TreeDir 算好（`${repoPath}::${dirPath}`），父级只管 Set 增删。
  const onToggleDir = useCallback((dirKey) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirKey)) next.delete(dirKey);
      else next.add(dirKey);
      return next;
    });
  }, []);

  const refreshAllRepos = useCallback(() => {
    fetchAllRepos(project, instance)
      .then(results => { if (mounted.current) setRepos(results); })
      .catch(() => {});
  }, [project, instance]);

  const handleRestore = useCallback((repoPath, filePath, fileName) => {
    Modal.confirm({
      title: t('ui.gitChanges.restoreConfirm', { name: fileName }),
      okType: 'danger',
      okText: t('ui.gitChanges.restoreFile'),
      // 失败要 throw —— antd Modal.confirm 只在 onOk 解析为成功时才关弹窗，
      // 否则 4xx/5xx 会沉默关闭让人误以为撤销成功。toast + throw 双路把错误显式化。
      onOk: async () => {
        let errMsg;
        try {
          const r = await fetch(apiUrl('/api/git-restore'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, repo: repoPath }),
          });
          if (r.ok) { refreshAllRepos(); return; }
          errMsg = `HTTP ${r.status}`;
          try { const data = await r.json(); if (data?.error) errMsg = data.error; } catch {}
        } catch (err) {
          errMsg = err?.message || 'network error';
        }
        message.error(t('ui.gitChanges.restoreFailed', { error: errMsg }));
        throw new Error(errMsg);
      },
    });
  }, [refreshAllRepos]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    fetchAllRepos(project, instance)
      .then(results => {
        if (mounted.current) {
          setRepos(results);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted.current) {
          setError('Failed to load git status');
          setLoading(false);
        }
      });
    return () => { mounted.current = false; };
  }, [project, instance]);

  // 工具触发的增量刷新
  useEffect(() => {
    if (refreshTrigger > 0) refreshAllRepos();
  }, [refreshTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prune per-repo state (`expandedCommits`, `collapsedUnpushed`) for repos that
  // no longer exist — long sessions that switch between many repos otherwise leak.
  // 同时校验 selectedCommitHash：commit 被推送后会从 commits[] 消失，残留的 selected hash
  // 会让后续 hover/click 无法对位（无害，但会导致旧 commit 高亮飘忽）。
  useEffect(() => {
    if (!repos) return;
    const validPaths = new Set(repos.map(r => r.path));
    const pruneObj = (obj) => {
      const next = {};
      let changed = false;
      for (const [k, v] of Object.entries(obj)) {
        if (validPaths.has(k)) next[k] = v;
        else changed = true;
      }
      return changed ? next : obj;
    };
    setExpandedCommits(prev => pruneObj(prev));
    setCollapsedUnpushed(prev => pruneObj(prev));

    if (selectedCommitHash && selectedRepo) {
      const repo = repos.find(r => r.path === selectedRepo);
      const stillExists = repo?.commits?.some(c => c.hash === selectedCommitHash);
      if (!stillExists) {
        setSelectedCommitHash(null);
        // 同时清掉 selectedFile，避免错位高亮残留
        setSelectedFile(null);
      }
    }
  }, [repos, selectedCommitHash, selectedRepo]);

  const isSingleRepo = !repos || repos.length <= 1;

  // Aggregate insertions/deletions across all repos
  const totalInsertions = repos ? repos.reduce((sum, r) => sum + (r.insertions || 0), 0) : 0;
  const totalDeletions = repos ? repos.reduce((sum, r) => sum + (r.deletions || 0), 0) : 0;

  return (
    <div className={styles.gitChanges} style={style}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>
          {t('ui.gitChanges')}
          {/* 手动刷新：用户终端里执行 git checkout/stash/rebase 等不被 tool_result 感知的
              git 操作时兜底；复用既有 gitChangesRefresh++ 链路触发 fetchAllRepos。RefreshIcon
              内部封装 300ms cooldown，防狂点并发请求。 */}
          {onManualRefresh && (
            <RefreshIcon onClick={onManualRefresh} title={t('ui.gitChanges.refresh')} />
          )}
          <StatBadges insertions={totalInsertions} deletions={totalDeletions} />
        </span>
        <button className={styles.collapseBtn} onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="11 17 6 12 11 7"/>
            <polyline points="18 17 13 12 18 7"/>
          </svg>
        </button>
      </div>
      <div className={styles.changesContainer}>
        {loading && <div className={styles.loading}>{t('ui.loading')}</div>}
        {error && <div className={styles.error}>{error}</div>}
        {!loading && !error && (!repos || repos.length === 0) && (
          <div className={styles.empty}>{t('ui.gitChanges.noChanges')}</div>
        )}
        {!loading && !error && repos && repos.map(repo => {
          const collapsed = collapsedRepos.has(repo.path);
          const baseDepth = isSingleRepo ? 0 : 1;
          const handleClickFile = (rp, fp, ch) => {
            setSelectedFile(fp); setSelectedRepo(rp); setSelectedCommitHash(ch || null);
            onFileClick && onFileClick(rp, fp, ch || null);
          };
          const showUnpushed = repo.commits && repo.commits.length > 0;
          const unpushedCollapsed = !!collapsedUnpushed[repo.path];
          const expandedSet = expandedCommits[repo.path] || new Set();
          const toggleCommit = (hash) => setExpandedCommits(prev => {
            const cur = prev[repo.path] ? new Set(prev[repo.path]) : new Set();
            cur.has(hash) ? cur.delete(hash) : cur.add(hash);
            return { ...prev, [repo.path]: cur };
          });
          const unpushedNode = showUnpushed && !unpushedCollapsed && (
            <>
              {repo.commits.map(c => (
                <CommitRow
                  key={c.hash}
                  commit={c}
                  repoPath={repo.path}
                  expanded={expandedSet.has(c.hash)}
                  onToggle={() => toggleCommit(c.hash)}
                  onFileClick={handleClickFile}
                  onOpenFile={onOpenFile}
                  onAttachToChat={onAttachToChat}
                  onInsertPathToChat={onInsertPathToChat}
                  selectedFile={selectedFile}
                  selectedRepo={selectedRepo}
                  selectedCommitHash={selectedCommitHash}
                  depth={baseDepth + 1}
                />
              ))}
            </>
          );
          const unpushedSeparator = showUnpushed && (
            <div className={styles.unpushedSeparator} aria-hidden="true" />
          );
          const unpushedHeader = showUnpushed && (
            <div
              className={styles.unpushedHeader}
              style={{ paddingLeft: 8 + baseDepth * 16 }}
              onClick={() => setCollapsedUnpushed(prev => ({ ...prev, [repo.path]: !prev[repo.path] }))}
              title={repo.upstream ? `${repo.upstream}..HEAD` : t('ui.gitChanges.noUpstreamTip')}
            >
              <span className={`${styles.commitArrow} ${unpushedCollapsed ? '' : styles.commitArrowExpanded}`}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18"/>
                </svg>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="12" y1="19" x2="12" y2="5"/>
                <polyline points="5 12 12 5 19 12"/>
              </svg>
              <span className={styles.unpushedTitle}>{t('ui.gitChanges.unpushedCommits')}</span>
              {repo.truncated && (
                <span className={styles.commitMeta} title={`total ${repo.totalCount}`}>
                  {t('ui.gitChanges.unpushedTruncated', { count: repo.commits.length })}
                </span>
              )}
              <span className={styles.repoBadge}>
                {repo.truncated ? `${repo.commits.length}/${repo.totalCount}` : repo.commits.length}
              </span>
            </div>
          );
          const workingTreeTree = (
            <TreeDir
              name=""
              node={buildGitTree(repo.changes)}
              depth={baseDepth}
              repoPath={repo.path}
              onFileClick={handleClickFile}
              onOpenFile={onOpenFile}
              onRestore={handleRestore}
              onAttachToChat={onAttachToChat}
              onInsertPathToChat={onInsertPathToChat}
              selectedFile={selectedFile}
              selectedRepo={selectedRepo}
              commitHash={null}
              selectedCommitHash={selectedCommitHash}
              collapsedDirs={collapsedDirs}
              onToggleDir={onToggleDir}
            />
          );
          return isSingleRepo ? (
            <React.Fragment key={repo.path}>
              {workingTreeTree}
              {unpushedSeparator}
              {unpushedHeader}
              {unpushedNode}
            </React.Fragment>
          ) : (
            <React.Fragment key={repo.path}>
              <div
                className={styles.repoHeader}
                onClick={() => setCollapsedRepos(prev => {
                  const next = new Set(prev);
                  collapsed ? next.delete(repo.path) : next.add(repo.path);
                  return next;
                })}
              >
                <span className={`${styles.repoArrow} ${collapsed ? '' : styles.repoArrowExpanded}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 6 15 12 9 18"/>
                  </svg>
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                  <path d="M18 9a9 9 0 0 1-9 9"/>
                </svg>
                <span className={styles.repoName}>{repo.name}</span>
                <StatBadges insertions={repo.insertions} deletions={repo.deletions} />
                <span className={styles.repoBadge}>{repo.changes.length}</span>
              </div>
              {!collapsed && (
                <>
                  {workingTreeTree}
                  {unpushedSeparator}
                  {unpushedHeader}
                  {unpushedNode}
                </>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
