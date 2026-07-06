import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiUrl } from '../utils/apiUrl';
import { t } from '../i18n';
import { isImageFile } from '../utils/commandValidator';
import FullFileDiffView from './FullFileDiffView';
import ImageLightbox from './ImageLightbox';
import styles from './GitDiffView.module.css';

function getFirstChangedLine(oldStr, newStr) {
  const oldLines = (oldStr || '').split('\n');
  const newLines = (newStr || '').split('\n');
  for (let i = 0; i < newLines.length; i++) {
    if (oldLines[i] !== newLines[i]) return i + 1;
  }
  return 1;
}

export default function GitDiffView({ filePath, onClose, onOpenFile }) {
  const [diffData, setDiffData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const mounted = useRef(true);
  const containerRef = useRef(null);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const el = containerRef.current;
    if (el) {
      el.addEventListener('animationend', () => onClose(), { once: true });
    } else {
      onClose();
    }
  }, [closing, onClose]);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setDiffData(null);
    setError(null);
    setLightboxOpen(false);

    fetch(apiUrl(`/api/git-diff?files=${encodeURIComponent(filePath)}`))
      .then(r => {
        if (!r.ok) {
          return r.json().then(err => {
            throw new Error(err.error || 'Failed to load diff');
          }).catch(() => {
            throw new Error(`HTTP ${r.status}`);
          });
        }
        return r.json();
      })
      .then(data => {
        if (mounted.current) {
          if (data.diffs && data.diffs[0]) {
            setDiffData(data.diffs[0]);
          } else {
            setError('No diff data available');
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted.current) {
          setError(`${t('ui.fileLoadError')}: ${err.message}`);
          setLoading(false);
        }
      });

    return () => { mounted.current = false; };
  }, [filePath]);

  return (
    <div ref={containerRef} className={`${styles.gitDiffView}${closing ? ` ${styles.closing}` : ''}`}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={handleClose} title={t('ui.backToChat')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span
            className={styles.filePath}
            onClick={() => {
              if (onOpenFile && diffData) {
                const line = getFirstChangedLine(diffData.old_content, diffData.new_content);
                onOpenFile(filePath, line);
              }
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && onOpenFile && diffData) {
                const line = getFirstChangedLine(diffData.old_content, diffData.new_content);
                onOpenFile(filePath, line);
              }
            }}
          >{filePath}</span>
          <span className={styles.diffBadge}>DIFF</span>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.closeBtn} onClick={handleClose} title={t('ui.backToChat')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.contentContainer}>
        {loading && <div className={styles.loading}>{t('ui.loading')}</div>}
        {error && <div className={styles.error}>{error}</div>}
        {!loading && !error && diffData && (
          <>
            {diffData.is_large ? (
              <div className={styles.largeFileWarning}>
                <p>{t('ui.largeFileWarning')}</p>
                <p className={styles.fileSize}>
                  {t('ui.fileSize')}: {(diffData.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
            ) : isImageFile(filePath) && !diffData.is_deleted ? (
              <div className={styles.imagePreviewWrap}>
                <img
                  className={styles.imagePreview}
                  src={apiUrl(`/api/file-raw?path=${encodeURIComponent(filePath)}`)}
                  alt={filePath}
                  onClick={() => setLightboxOpen(true)}
                />
                {lightboxOpen && (
                  <ImageLightbox
                    src={apiUrl(`/api/file-raw?path=${encodeURIComponent(filePath)}`)}
                    alt={filePath}
                    onClose={() => setLightboxOpen(false)}
                  />
                )}
              </div>
            ) : diffData.is_binary ? (
              <div className={styles.binaryNotice}>{t('ui.binaryFileNotice')}</div>
            ) : (
              <FullFileDiffView
                file_path={filePath}
                old_string={diffData.old_content}
                new_string={diffData.new_content}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
