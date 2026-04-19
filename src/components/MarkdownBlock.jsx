import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Tooltip, message } from 'antd';
import { CopyOutlined, DownloadOutlined, CameraOutlined, SaveOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../utils/markdown';
import { renderIncremental } from '../utils/markdownIncremental';
import { recordMountSample, DEV_PROFILER_ENABLED } from '../utils/markdownProfiler';
import { apiUrl } from '../utils/apiUrl';
import { isMobile, isPad } from '../env';
import { t } from '../i18n';
import styles from './MarkdownBlock.module.css';

function MarkdownBlock({ text, className, style, trailingCursor }) {
  const [hovered, setHovered] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);
  const savingRef = useRef(false);
  const mountStartRef = useRef(0);

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

  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text)
      .then(() => message.success(t('ui.copySuccess')))
      .catch(() => {});
  }, [text]);

  const handleSaveAs = useCallback(async (e) => {
    e.stopPropagation();
    setSaveMenuOpen(false);
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const defaultName = `content-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.md`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [text]);

  const handleSaveAsImage = useCallback((e) => {
    e.stopPropagation();
    setSaveMenuOpen(false);
    if (savingRef.current) return;
    const el = wrapRef.current;
    if (!el) return;
    savingRef.current = true;
    const target = el.closest('[class*="bubble"]') || el;
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    import('html2canvas').then(({ default: html2canvas }) => {
      html2canvas(target, {
        backgroundColor: isDark ? '#0a0a0a' : '#ffffff',
        scale: 2,
        useCORS: true,
      }).then(canvas => {
        canvas.toBlob(blob => {
          if (!blob) { savingRef.current = false; return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `content-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          canvas.width = 0;
          canvas.height = 0;
          savingRef.current = false;
        }, 'image/png');
      }).catch((err) => { console.warn('html2canvas render failed:', err); savingRef.current = false; });
    }).catch((err) => { console.warn('html2canvas load failed:', err); savingRef.current = false; });
  }, []);

  const handleSaveToProject = useCallback(async (e) => {
    e.stopPropagation();
    setSaveMenuOpen(false);
    const defaultName = `content-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.md`;
    const fileName = window.prompt(t('ui.saveToProject.prompt'), defaultName);
    if (!fileName) return;
    try {
      const res = await fetch(apiUrl('/api/file-content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fileName, content: text }),
      });
      if (res.ok) {
        message.success(t('ui.saveToProject.success', { name: fileName }));
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.error || 'Save failed');
      }
    } catch (err) {
      message.error(err.message || 'Save failed');
    }
  }, [text]);

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
      {(!isMobile || isPad) && hovered && (
        <div className={styles.actionBar} data-html2canvas-ignore>
          <Tooltip title={t('ui.copy')} mouseEnterDelay={0.3}>
            <span className={styles.actionBtn} onClick={handleCopy}>
              <CopyOutlined />
            </span>
          </Tooltip>
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
        </div>
      )}
    </div>
  );
}

export default React.memo(MarkdownBlock);
