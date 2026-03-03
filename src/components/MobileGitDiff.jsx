import React, { useState, useEffect, useRef } from 'react';
import { t } from '../i18n';
import FullFileDiffView from './FullFileDiffView';
import styles from './MobileGitDiff.module.css';

const STATUS_COLORS = {
  'M': '#e2c08d',
  'A': '#73c991',
  'D': '#f14c4c',
  'R': '#73c991',
  'C': '#73c991',
  'U': '#e2c08d',
  '?': '#73c991',
};

function getFileIcon(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const EXT_COLORS = {
    js: '#e8d44d', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
    json: '#999', md: '#519aba', css: '#a86fd9', scss: '#cd6799',
    html: '#e34c26', py: '#3572a5', go: '#00add8', rs: '#dea584',
  };
  const color = EXT_COLORS[ext] || '#888';
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

export default function MobileGitDiff() {
  const [changes, setChanges] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [diffError, setDiffError] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    fetch('/api/git-status')
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
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setDiffData(null);
      setDiffError(null);
      return;
    }
    setDiffLoading(true);
    setDiffData(null);
    setDiffError(null);

    fetch(`/api/git-diff?files=${encodeURIComponent(selectedFile)}`)
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
          {!loading && !error && changes && changes.length > 0 && changes.map((change, idx) => (
            <div
              key={idx}
              className={`${styles.changeItem} ${selectedFile === change.file ? styles.changeItemActive : ''}`}
              onClick={() => setSelectedFile(change.file)}
            >
              <span className={styles.status} style={{ color: STATUS_COLORS[change.status] || '#888' }}>
                {change.status}
              </span>
              <span className={styles.icon}>{getFileIcon(change.file)}</span>
              <span className={styles.fileName}>{change.file}</span>
            </div>
          ))}
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
                      <p style={{ color: '#888', fontSize: 12 }}>
                        {t('ui.fileSize')}: {(diffData.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                  ) : diffData.is_binary ? (
                    <div className={styles.statusText} style={{ fontStyle: 'italic' }}>{t('ui.binaryFileNotice')}</div>
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
