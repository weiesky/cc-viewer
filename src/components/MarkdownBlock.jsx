import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Tooltip, message } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { renderMarkdown } from '../utils/markdown';
import { isMobile } from '../env';
import { t } from '../i18n';
import styles from './MarkdownBlock.module.css';

function MarkdownBlock({ text, className, style }) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const html = useMemo(() => text ? renderMarkdown(text) : '', [text]);

  if (!text) return null;

  const handleCopy = useCallback((e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text)
      .then(() => message.success(t('ui.copySuccess')))
      .catch(() => {});
  }, [text]);

  const handleSaveAs = useCallback(async (e) => {
    e.stopPropagation();
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

  const handleMouseEnter = useCallback(() => {
    clearTimeout(timerRef.current);
    setHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timerRef.current = setTimeout(() => setHovered(false), 150);
  }, []);

  return (
    <div
      className={styles.mdBlockWrapper}
      onMouseEnter={isMobile ? undefined : handleMouseEnter}
      onMouseLeave={isMobile ? undefined : handleMouseLeave}
    >
      <div
        className={`chat-md ${className || ''}`}
        style={style}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {!isMobile && hovered && (
        <div className={styles.actionBar}>
          <Tooltip title={t('ui.copy')} mouseEnterDelay={0.3}>
            <span className={styles.actionBtn} onClick={handleCopy}>
              <CopyOutlined />
            </span>
          </Tooltip>
          <Tooltip title={t('ui.saveAs')} mouseEnterDelay={0.3}>
            <span className={styles.actionBtn} onClick={handleSaveAs}>
              <DownloadOutlined />
            </span>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export default React.memo(MarkdownBlock);
