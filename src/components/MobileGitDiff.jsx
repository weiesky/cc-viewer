import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n';
import { apiUrl } from '../utils/apiUrl';
import { isImageFile } from '../utils/commandValidator';
import FullFileDiffView from './FullFileDiffView';
import ImageLightbox from './ImageLightbox';
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

function buildTree(changes) {
  const root = { dirs: {}, files: [] };
  for (const change of changes) {
    const parts = change.file.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs[parts[i]]) node.dirs[parts[i]] = { dirs: {}, files: [] };
      node = node.dirs[parts[i]];
    }
    node.files.push({ name: parts[parts.length - 1], status: change.status, fullPath: change.file });
  }
  return root;
}

function TreeDir({ name, node, depth, selectedFile, onFileClick }) {
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
        <TreeDir key={dir} name={dir} node={node.dirs[dir]} depth={name ? depth + 1 : depth} selectedFile={selectedFile} onFileClick={onFileClick} />
      ))}
      {files.map(file => (
        <div
          key={file.fullPath}
          className={`${styles.changeItem} ${selectedFile === file.fullPath ? styles.changeItemActive : ''}`}
          style={{ paddingLeft: 8 + (name ? depth + 1 : depth) * 16 }}
          onClick={() => onFileClick && onFileClick(file.fullPath)}
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

export default function MobileGitDiff({ visible }) {
  const [changes, setChanges] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
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
    fetch(apiUrl('/api/git-status'))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (mounted.current) {
          setChanges(data.changes || []);
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
    if (!selectedFile) {
      setDiffData(null);
      setDiffError(null);
      return;
    }
    setDiffLoading(true);
    setDiffData(null);
    setDiffError(null);

    fetch(apiUrl(`/api/git-diff?files=${encodeURIComponent(selectedFile)}`))
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
  }, [selectedFile]);

  return (
    <div className={styles.container}>
      {/* 上半部分：文件列表，固定 300px */}
      <div className={styles.fileListSection}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>{t('ui.gitChanges')}</span>
          <span className={styles.fileCount}>
            {changes ? changes.length : 0}
          </span>
        </div>
        <div className={styles.changesContainer}>
          {loading && <div className={styles.statusText}>Loading...</div>}
          {error && <div className={styles.errorText}>{error}</div>}
          {!loading && !error && changes && changes.length === 0 && (
            <div className={styles.emptyText}>No changes</div>
          )}
          {!loading && !error && changes && changes.length > 0 && (
            <TreeDir name="" node={buildTree(changes)} depth={0} selectedFile={selectedFile} onFileClick={setSelectedFile} />
          )}
        </div>
      </div>

      {/* 下半部分：Diff 内容，自适应剩余高度 */}
      <div className={styles.diffSection}>
        {selectedFile ? (
          <>
            <div className={styles.diffHeader}>
              <span className={styles.diffFilePath}>{selectedFile}</span>
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
                        src={apiUrl(`/api/file-raw?path=${encodeURIComponent(selectedFile)}`)}
                        alt={selectedFile}
                        onClick={() => setLightboxOpen(true)}
                      />
                      {lightboxOpen && (
                        <ImageLightbox
                          src={apiUrl(`/api/file-raw?path=${encodeURIComponent(selectedFile)}`)}
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
