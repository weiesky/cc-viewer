import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Tooltip } from 'antd';
import { CopyOutlined, DownloadOutlined, CameraOutlined, SaveOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../../utils/markdown';
import { renderIncremental } from '../../utils/markdownIncremental';
import { recordMountSample, DEV_PROFILER_ENABLED } from '../../utils/markdownProfiler';
import { isMobile, isPad } from '../../env';
import { t } from '../../i18n';
import { useMarkdownExport } from '../../hooks/useMarkdownExport';
import styles from './MarkdownBlock.module.css';

// markdown ≤ 此字符数视为「简短」，隐藏 hover 的「另存为」操作栏 —— 短内容无下载价值，可直接选中复制。
const SHORT_MD_CHAR_THRESHOLD = 200;

function MarkdownBlock({ text, className, style, trailingCursor }) {
  const [hovered, setHovered] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);
  const mountStartRef = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;

  const { handleCopy, handleSaveAs, handleSaveAsImage, handleSaveToProject } = useMarkdownExport({
    getText: useCallback(() => textRef.current, []),
    getSnapshotTarget: useCallback(() => wrapRef.current?.closest('[class*="bubble"]') || wrapRef.current, []),
    onDone: useCallback(() => setSaveMenuOpen(false), []),
  });

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const html = useMemo(
    () => text ? (trailingCursor ? renderIncremental(text) : renderMarkdown(text)) : '',
    [text, trailingCursor]
  );

  // Dev-only mount profiling: start AFTER useMemo so `md-parse` time (measured
  // separately inside renderMarkdown) is not double-counted in `md-mount`.
  // Ref-based — a discarded render under React concurrent mode simply gets
  // overwritten by the next render's timestamp, no pending-Map leak.
  if (DEV_PROFILER_ENABLED) mountStartRef.current = performance.now();
  useEffect(() => {
    if (DEV_PROFILER_ENABLED && mountStartRef.current > 0) {
      recordMountSample(performance.now() - mountStartRef.current);
      mountStartRef.current = 0;
    }
  });

  if (!text) return null;

  const handleMouseEnter = useCallback(() => {
    clearTimeout(timerRef.current);
    setHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timerRef.current = setTimeout(() => { setHovered(false); setSaveMenuOpen(false); }, 150);
  }, []);

  return (
    <div
      ref={wrapRef}
      className={styles.mdBlockWrapper}
      onMouseEnter={(isMobile && !isPad) ? undefined : handleMouseEnter}
      onMouseLeave={(isMobile && !isPad) ? undefined : handleMouseLeave}
    >
      <div
        className={`chat-md ${className || ''} ${trailingCursor ? styles.streamingTail : ''}`}
        style={style}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {(!isMobile || isPad) && hovered && text.length > SHORT_MD_CHAR_THRESHOLD && (
        <div className={styles.actionBar} data-html2canvas-ignore>
          <div className={`${styles.hoverPad} ${styles.hoverPadTop}`} aria-hidden="true" />
          <div className={styles.saveAsWrap}
            onMouseEnter={() => setSaveMenuOpen(true)}
            onMouseLeave={() => setSaveMenuOpen(false)}
          >
            <Tooltip title={saveMenuOpen ? '' : t('ui.saveAs')} mouseEnterDelay={0.3}>
              <span className={styles.actionBtn}>
                <DownloadOutlined />
              </span>
            </Tooltip>
            {saveMenuOpen && (
              <div className={styles.saveMenu}>
                <button className={styles.saveMenuItem} onClick={handleSaveAs}>
                  <DownloadOutlined />
                  <span>{t('ui.saveAsMd')}</span>
                </button>
                <button className={styles.saveMenuItem} onClick={handleCopy}>
                  <CopyOutlined />
                  <span>{t('ui.copyTextContent')}</span>
                </button>
                <button className={styles.saveMenuItem} onClick={handleSaveAsImage}>
                  <CameraOutlined />
                  <span>{t('ui.saveAsImage')}</span>
                </button>
                <button className={styles.saveMenuItem} onClick={handleSaveToProject}>
                  <SaveOutlined />
                  <span>{t('ui.saveToProject')}</span>
                </button>
              </div>
            )}
          </div>
          <div className={`${styles.hoverPad} ${styles.hoverPadBottom}`} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export default React.memo(MarkdownBlock);
