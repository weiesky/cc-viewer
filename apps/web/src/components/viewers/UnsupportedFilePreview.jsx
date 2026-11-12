import React from 'react';
import { DownloadOutlined, FileOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl, withViewParams } from '../../utils/apiUrl';
import { formatSize } from '../../utils/formatters';
import styles from './UnsupportedFilePreview.module.css';

const DESCRIPTION_KINDS = new Set(['video', 'font', 'pdf', 'binary']);

export default function UnsupportedFilePreview({ filePath, displayPath, kind, contentDetected = false, fileSize, onClose, project, instance }) {
  const downloadName = filePath.split(/[\\/]/).pop() || 'download';
  const downloadUrl = apiUrl(withViewParams(`/api/download-file?path=${encodeURIComponent(filePath)}`, { project, instance }));
  const descriptionKey = contentDetected ? 'ui.filePreview.contentBinary' : `ui.filePreview.kind.${DESCRIPTION_KINDS.has(kind) ? kind : 'unknown'}`;
  return (
    <div className={styles.viewer}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>←</button>
        <span className={styles.filePath} title={displayPath || filePath} dir="ltr">{displayPath || filePath}</span>
        <a className={styles.download} href={downloadUrl} download={downloadName} title={t('ui.filePreview.download')} aria-label={t('ui.filePreview.download')}><DownloadOutlined /></a>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>×</button>
      </header>
      <div className={styles.state} role="status">
        <FileOutlined className={styles.fileIcon} aria-hidden="true" />
        <h2>{t('ui.filePreview.title')}</h2>
        <p>{t(descriptionKey)}</p>
        {Number.isFinite(fileSize) && <span className={styles.size}>{formatSize(fileSize)}</span>}
        <a className={styles.downloadButton} href={downloadUrl} download={downloadName}><DownloadOutlined />{t('ui.filePreview.download')}</a>
      </div>
    </div>
  );
}
