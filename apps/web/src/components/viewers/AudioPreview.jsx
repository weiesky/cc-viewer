import React, { useState } from 'react';
import { DownloadOutlined, FileOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl, withViewParams } from '../../utils/apiUrl';
import styles from './AudioPreview.module.css';

// Inline audio preview: streams from /api/audio-stream (single-range 206) so the
// native <audio> element can seek. preload="none" defers the Range probe until the
// user presses play — important in long file lists where many players would each fire
// a request. No autoplay, no Blob (the server streams; Blob would buffer it all).
// On any playback error (unsupported codec, e.g. Ogg/Opus on old Safari, or raw AAC)
// we fall back to the unconditional download link.
export default function AudioPreview({ filePath, displayPath, onClose, project, instance }) {
  const [failed, setFailed] = useState(false);
  const downloadName = filePath.split(/[\\/]/).pop() || 'download';
  const params = { project, instance };
  const streamUrl = apiUrl(withViewParams(`/api/audio-stream?path=${encodeURIComponent(filePath)}`, params));
  const downloadUrl = apiUrl(withViewParams(`/api/download-file?path=${encodeURIComponent(filePath)}`, params));
  return (
    <div className={styles.viewer}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>←</button>
        <span className={styles.filePath} title={displayPath || filePath} dir="ltr">{displayPath || filePath}</span>
        <a className={styles.download} href={downloadUrl} download={downloadName} title={t('ui.filePreview.download')} aria-label={t('ui.filePreview.download')}><DownloadOutlined /></a>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>×</button>
      </header>
      <div className={styles.state}>
        {failed ? (
          <>
            <FileOutlined className={styles.fileIcon} aria-hidden="true" />
            <p className={styles.errorText}>{t('ui.filePreview.audio.error')}</p>
            <a className={styles.downloadButton} href={downloadUrl} download={downloadName}><DownloadOutlined />{t('ui.filePreview.download')}</a>
          </>
        ) : (
          <>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- no caption track for arbitrary local files */}
            <audio
              className={styles.player}
              controls
              preload="none"
              src={streamUrl}
              onError={() => setFailed(true)}
            />
            <p className={styles.hint}>{t('ui.filePreview.audio.hint')}</p>
          </>
        )}
      </div>
    </div>
  );
}
