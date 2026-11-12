import React, { useEffect, useState } from 'react';
import { DownloadOutlined, FileOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl, withViewParams } from '../../utils/apiUrl';
import { getExt } from '../../utils/fileTypes';
import { decodeTextBytes } from '../../vendor/archive/util';
import { parseSubtitle, MAX_CUES } from '../../utils/subtitleParser';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './SubtitlePreview.module.css';

// Inline subtitle preview for .srt/.vtt/.ass/.ssa. It fetches RAW bytes from
// /api/file-raw (NOT /api/file-content, which 415s GBK/Latin-1 as binary), then
// decodes BOM/UTF-16/GBK/Latin-1 via the archive util and parses cue times.
// Cue text is rendered as React text nodes only — HTML-like SRT/VTT tags and
// ASS override blocks never execute. The byte input is capped at
// SUBTITLE_MAX_BYTES and the cue list at MAX_CUES; both surface a notice.
const SUBTITLE_MAX_BYTES = 1024 * 1024; // 1 MiB
// Above this cue count the list view is heavy on mobile; default to raw text.
const RAW_VIEW_CUE_THRESHOLD = 1500;

function formatTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const millis = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

export default function SubtitlePreview({ filePath, displayPath, onClose, project, instance }) {
  const [state, setState] = useState({ status: 'loading' });
  const [view, setView] = useState('list');
  const downloadName = filePath.split(/[\\/]/).pop() || 'download';
  const params = { project, instance };
  const rawUrl = apiUrl(withViewParams(`/api/file-raw?path=${encodeURIComponent(filePath)}`, params));
  const downloadUrl = apiUrl(withViewParams(`/api/download-file?path=${encodeURIComponent(filePath)}`, params));

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setState({ status: 'loading' });
    (async () => {
      let res;
      try {
        res = await fetch(rawUrl, { signal: controller.signal });
      } catch (err) {
        if (!controller.signal.aborted && mounted) {
          reportSwallowed('subtitlePreview.fetch', err);
          setState({ status: 'error' });
        }
        return;
      }
      // A 403/404/413 from /api/file-raw carries a JSON body, not subtitle bytes;
      // read the reason before touching the payload so it is never parsed as cues.
      if (!res.ok) {
        const err = await res.json().catch((e) => {
          // Closing the panel aborts the in-flight body read; that AbortError is not
          // a diagnostic, so don't report it.
          if (e.name !== 'AbortError' && !controller.signal.aborted) reportSwallowed('subtitlePreview.errorBody', e);
          return {};
        });
        if (controller.signal.aborted || !mounted) return;
        // t() returns the key verbatim when untranslated; fall back to the server
        // message in that case so a raw i18n key never reaches the UI.
        const reasonKey = `ui.fileLoadError.reason.${err.reason}`;
        const reasonText = err.reason ? t(reasonKey) : '';
        const message = err.reason
          ? (reasonText === reasonKey ? (err.error || t('ui.filePreview.subtitle.error')) : reasonText)
          : (err.error || t('ui.filePreview.subtitle.error'));
        setState({ status: 'error', message });
        return;
      }
      let buf;
      try {
        buf = await res.arrayBuffer();
      } catch (err) {
        if (!controller.signal.aborted && mounted) {
          reportSwallowed('subtitlePreview.arrayBuffer', err);
          setState({ status: 'error' });
        }
        return;
      }
      if (controller.signal.aborted || !mounted) return;
      try {
        const byteTruncated = buf.byteLength > SUBTITLE_MAX_BYTES;
        const { text, encoding } = decodeTextBytes(buf, { maxBytes: SUBTITLE_MAX_BYTES, truncated: byteTruncated });
        const { cues, truncated } = parseSubtitle(text, getExt(filePath));
        if (controller.signal.aborted || !mounted) return;
        setView(cues.length > RAW_VIEW_CUE_THRESHOLD ? 'raw' : 'list');
        setState({ status: 'ready', text, encoding, cues, cueTruncated: truncated, byteTruncated });
      } catch (err) {
        // A decoder/parser throw must not leave an infinite loading spinner.
        if (!controller.signal.aborted && mounted) {
          reportSwallowed('subtitlePreview.decode', err);
          setState({ status: 'error' });
        }
      }
    })();
    return () => { mounted = false; controller.abort(); };
  }, [rawUrl, filePath]);

  return (
    <div className={styles.viewer}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>←</button>
        <span className={styles.filePath} title={displayPath || filePath} dir="ltr">{displayPath || filePath}</span>
        {state.status === 'ready' && (
          <div className={styles.toggle} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'list'}
              className={`${styles.toggleBtn}${view === 'list' ? ` ${styles.toggleActive}` : ''}`}
              onClick={() => setView('list')}
            >{t('ui.filePreview.subtitle.listView')}</button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'raw'}
              className={`${styles.toggleBtn}${view === 'raw' ? ` ${styles.toggleActive}` : ''}`}
              onClick={() => setView('raw')}
            >{t('ui.filePreview.subtitle.rawView')}</button>
          </div>
        )}
        <a className={styles.download} href={downloadUrl} download={downloadName} title={t('ui.filePreview.download')} aria-label={t('ui.filePreview.download')}><DownloadOutlined /></a>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>×</button>
      </header>
      <div className={styles.body}>
        {state.status === 'loading' && <div className={styles.status} role="status">{t('ui.loading')}</div>}
        {state.status === 'error' && (
          <div className={styles.status}>
            <FileOutlined className={styles.fileIcon} aria-hidden="true" />
            <p className={styles.errorText}>
              {state.message || t('ui.filePreview.subtitle.error')}
            </p>
            <a className={styles.downloadButton} href={downloadUrl} download={downloadName}><DownloadOutlined />{t('ui.filePreview.download')}</a>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <div className={styles.meta}>
              <span>{t('ui.filePreview.subtitle.encoding', { encoding: state.encoding })}</span>
              {state.byteTruncated && <span className={styles.notice}>{t('ui.filePreview.subtitle.byteLimit')}</span>}
              {state.cueTruncated && <span className={styles.notice}>{t('ui.filePreview.subtitle.cueLimit', { count: MAX_CUES })}</span>}
            </div>
            {state.cues.length === 0 ? (
              <div className={styles.status}><p className={styles.hint}>{t('ui.filePreview.subtitle.empty')}</p></div>
            ) : view === 'list' ? (
              <ol className={styles.cueList}>
                {state.cues.map((cue) => (
                  <li key={cue.index} className={styles.cue}>
                    <span className={styles.cueTime} dir="ltr">{formatTime(cue.start)} → {formatTime(cue.end)}</span>
                    <span className={styles.cueText} dir="auto">{cue.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <pre className={styles.raw} dir="auto">{state.text}</pre>
            )}
            <p className={styles.hint}>{t('ui.filePreview.subtitle.hint')}</p>
          </>
        )}
      </div>
    </div>
  );
}
