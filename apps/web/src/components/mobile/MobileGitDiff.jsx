import React, { useState, useEffect, useRef, useMemo } from 'react';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { isImageFile } from '../../utils/commandValidator';
import { fetchAllRepos } from '../../utils/gitApi';
import { buildGitTree } from '../../utils/gitTreeBuilder';
import FullFileDiffView from '../git/FullFileDiffView';
import ImageLightbox from '../common/ImageLightbox';
import styles from './MobileGitDiff.module.css';

const STATUS_COLORS = {
  'M': '#e2c08d',
  'A': '#73c991',
  'D': '#f14c4c',
  'R': '#73c991',
  'C': '#73c991',
  'U': '#e2c08d',
  '?': '#73c991',
  '??': '#73c991',
};

const STATUS_LABELS = {
  '??': 'U',
};

const EXT_COLORS = {
  js: '#e8d44d', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
  json: '#999', md: '#519aba', css: '#a86fd9', scss: '#cd6799',
  html: '#e34c26', py: '#3572a5', go: '#00add8', rs: '#dea584',
};

function getFileIcon(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const color = EXT_COLORS[ext] || '#888';
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

function getFolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#c09553" stroke="none">
      <path d="M2 6c0-1.1.9-2 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
    </svg>
  );
}

function TreeDir({ name, node, depth, selectedFile, selectedRepo, repoPath, onFileClick }) {
  const dirNames = Object.keys(node.dirs).sort();
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {name && (
        <div className={styles.dirItem} style={{ paddingLeft: 8 + depth * 16 }}>
          <span className={styles.dirArrow}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.rotated90}>
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </span>
          <span className={styles.icon}>{getFolderIcon()}</span>
          <span className={styles.dirName}>{name}</span>
        </div>
      )}
      {dirNames.map(dir => (
        <TreeDir key={dir} name={dir} node={node.dirs[dir]} depth={name ? depth + 1 : depth} selectedFile={selectedFile} selectedRepo={selectedRepo} repoPath={repoPath} onFileClick={onFileClick} />
      ))}
      {files.map(file => (
        <div
          key={file.fullPath}
          className={`${styles.changeItem} ${selectedFile === file.fullPath && selectedRepo === repoPath ? styles.changeItemActive : ''}`}
          style={{ paddingLeft: 8 + (name ? depth + 1 : depth) * 16 }}
          onClick={() => onFileClick && onFileClick(repoPath, file.fullPath)}
        >
          <span className={styles.icon}>{getFileIcon(file.name)}</span>
          <span className={styles.fileName}>{file.name}</span>
          <span className={styles.status} style={{ color: STATUS_COLORS[file.status] || '#888' }}>
            {STATUS_LABELS[file.status] || file.status}
          </span>
        </div>
      ))}
    </>
  );
}

export default function MobileGitDiff({ visible, onClose }) {
  const [repos, setRepos] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null); // string
  const [selectedRepo, setSelectedRepo] = useState(null); // string
  const [collapsedRepos, setCollapsedRepos] = useState(new Set());
  const [diffData, setDiffData] = useState(null);
  const [diffError, setDiffError] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!visible) return;
    setLoading(true);
    setError(null);
    fetchAllRepos()
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
  }, [visible]);

  useEffect(() => {
    if (!selectedFile || !selectedRepo) {
      setDiffData(null);
      setDiffError(null);
      return;
    }
    setDiffLoading(true);
    setDiffData(null);
    setDiffError(null);

    const repoParam = selectedRepo && selectedRepo !== '.' ? `&repo=${encodeURIComponent(selectedRepo)}` : '';
    fetch(apiUrl(`/api/git-diff?files=${encodeURIComponent(selectedFile)}${repoParam}`))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (mounted.current) {
          if (data.diffs && data.diffs[0]) {
            setDiffData(data.diffs[0]);
          } else {
            setDiffError('No diff data available');
          }
          setDiffLoading(false);
        }
      })
      .catch((err) => {
        if (mounted.current) {
          setDiffError(`${t('ui.fileLoadError')}: ${err.message}`);
          setDiffLoading(false);
        }
      });
  }, [selectedFile, selectedRepo]);

  const totalChanges = useMemo(() => {
    if (!repos) return 0;
    return repos.reduce((sum, r) => sum + r.changes.length, 0);
  }, [repos]);

  const isSingleRepo = !repos || repos.length <= 1;

  const handleFileClick = (repoPath, filePath) => {
    setSelectedFile(filePath);
    setSelectedRepo(repoPath);
  };

  const diffDisplayPath = selectedFile && selectedRepo && selectedRepo !== '.'
    ? `${selectedRepo}/${selectedFile}` : selectedFile;

  return (
    <div className={styles.container}>
      {/* 上半部分：文件列表，固定 300px */}
      <div className={styles.fileListSection}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerTitle}>{t('ui.gitChanges')}</span>
            <span className={styles.fileCount}>{totalChanges}</span>
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
        <div className={styles.changesContainer}>
          {loading && <div className={styles.statusText}>{t('ui.loading')}</div>}
          {error && <div className={styles.errorText}>{error}</div>}
          {!loading && !error && (!repos || repos.length === 0) && (
            <div className={styles.emptyText}>{t('ui.gitChanges.noChanges')}</div>
          )}
          {!loading && !error && repos && repos.map(repo => {
            const collapsed = collapsedRepos.has(repo.path);
            return isSingleRepo ? (
              <TreeDir key={repo.path} name="" node={buildGitTree(repo.changes)} depth={0} selectedFile={selectedFile} selectedRepo={selectedRepo} repoPath={repo.path} onFileClick={handleFileClick} />
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
                  <span className={styles.repoBadge}>{repo.changes.length}</span>
                </div>
                {!collapsed && (
                  <TreeDir name="" node={buildGitTree(repo.changes)} depth={1} selectedFile={selectedFile} selectedRepo={selectedRepo} repoPath={repo.path} onFileClick={handleFileClick} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* 下半部分：Diff 内容，自适应剩余高度 */}
      <div className={styles.diffSection}>
        {selectedFile ? (
          <>
            <div className={styles.diffHeader}>
              <span className={styles.diffFilePath}>{diffDisplayPath}</span>
              <span className={styles.diffBadge}>DIFF</span>
            </div>
            <div className={styles.diffContent}>
              {diffLoading && <div className={styles.statusText}>{t('ui.loading')}</div>}
              {diffError && <div className={styles.errorText}>{diffError}</div>}
              {!diffLoading && !diffError && diffData && (
                <>
                  {diffData.is_large ? (
                    <div className={styles.warningText}>
                      <p>{t('ui.largeFileWarning')}</p>
                      <p className={styles.fileSizeNote}>
                        {t('ui.fileSize')}: {(diffData.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                  ) : isImageFile(selectedFile) && !diffData.is_deleted ? (
                    <div className={styles.imagePreviewWrap}>
                      <img
                        className={styles.imagePreview}
                        src={apiUrl(`/api/file-raw?path=${encodeURIComponent(diffDisplayPath)}`)}
                        alt={selectedFile}
                        onClick={() => setLightboxOpen(true)}
                      />
                      {lightboxOpen && (
                        <ImageLightbox
                          src={apiUrl(`/api/file-raw?path=${encodeURIComponent(diffDisplayPath)}`)}
                          alt={selectedFile}
                          onClose={() => setLightboxOpen(false)}
                        />
                      )}
                    </div>
                  ) : diffData.is_binary ? (
                    <div className={`${styles.statusText} ${styles.statusTextItalic}`}>{t('ui.binaryFileNotice')}</div>
                  ) : (
                    <FullFileDiffView
                      file_path={selectedFile}
                      old_string={diffData.old_content}
                      new_string={diffData.new_content}
                    />
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className={styles.diffPlaceholder}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
              <line x1="6" y1="3" x2="6" y2="15"/>
              <circle cx="18" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
            <span>{t('ui.mobileGitDiffHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
