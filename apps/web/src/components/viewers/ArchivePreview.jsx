import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownloadOutlined, FileOutlined, FolderOpenOutlined, FolderOutlined, LockOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl, withViewParams } from '../../utils/apiUrl';
import { archiveErrorText, archiveEntryStatus, archiveNoteText, ARCHIVE_IMAGE_MAX_BYTES, ARCHIVE_MAX_ROWS, ARCHIVE_MAX_TEXT_LINES, ARCHIVE_RAW_MAX_BYTES, ARCHIVE_TEXT_MAX_BYTES, flattenArchiveTree, getArchivePreviewKind, isArchiveEntrySelected, shouldShowArchiveNotices } from '../../utils/archivePreview';
import { buildTree, formatBytes, isDecompressionSupported, listArchive, readEntry, readEntryText, resetBudget } from '../../vendor/archive/index';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './ArchivePreview.module.css';

function initialExpanded(tree) {
  const expanded = new Set();
  const stack = [...tree.children];
  while (stack.length) {
    const node = stack.pop();
    if (node.dir && (node.path.split('/').length <= 2 || node.children.length === 1)) {
      if (expanded.size >= 100) break;
      expanded.add(node.path);
      stack.push(...node.children);
    }
  }
  return expanded;
}

function EntryDetail({ detail, entry }) {
  if (!entry) return <div className={styles.placeholder}>{t('ui.archive.selectEntry')}</div>;
  return (
    <section className={styles.detail} aria-label={entry.path}>
      <div className={styles.detailHeader}>
        <span className={styles.entryPath} title={entry.path} dir="ltr">{entry.path}</span>
        <span>{formatBytes(entry.size)}</span>
        {entry.method && <span>{entry.method}</span>}
        {entry.mtime && <time>{new Date(entry.mtime).toLocaleString()}</time>}
      </div>
      <div className={styles.detailBody}>
        {entry.dir || !detail ? <div className={styles.placeholder}>{t('ui.archive.selectEntry')}</div>
          : detail.status === 'loading' ? <div className={styles.status} role="status">{t('ui.loading')}</div>
          : detail.status === 'error' ? <div className={styles.error} role="alert">{detail.message}</div>
            : detail.status === 'image' ? (
              <>
                <EntryNotices notes={detail.notes} />
                <img className={styles.image} src={detail.url} alt={entry.path} onError={detail.onError} />
              </>
            ) : detail.status === 'text' ? (
              <>
                <div className={styles.encoding}>{t('ui.archive.encoding', { encoding: detail.encoding })}</div>
                <EntryNotices notes={detail.notes} />
                {detail.lineTruncated && <div className={styles.notice}>{t('ui.archive.lineLimit', { count: ARCHIVE_MAX_TEXT_LINES })}</div>}
                <pre className={styles.text} dir="auto">{detail.text}</pre>
              </>
            ) : (
              <>
                <EntryNotices notes={detail.notes} />
                <div className={styles.placeholder}>{t(`ui.archive.entry.${['empty', 'binary', 'link', 'device'].includes(detail.status) ? detail.status : 'binary'}`, { size: formatBytes(entry.size) })}</div>
              </>
            )}
      </div>
    </section>
  );
}

function EntryNotices({ notes = [] }) {
  return notes.map((note, index) => <div className={styles.notice} key={`${note.code}-${index}`}>{archiveNoteText(note, t, formatBytes)}</div>);
}

export default function ArchivePreview({ filePath, displayPath, onClose, project, instance }) {
  const kind = getArchivePreviewKind(filePath);
  const [state, setState] = useState({ status: kind.supported ? 'loading' : 'unsupported' });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [rowLimit, setRowLimit] = useState(ARCHIVE_MAX_ROWS);
  const [retry, setRetry] = useState(0);
  const bytesRef = useRef(null);
  const requestRef = useRef(0);
  const imageRef = useRef(null);
  const downloadUrl = apiUrl(withViewParams(`/api/download-file?path=${encodeURIComponent(filePath)}`, { project, instance }));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    bytesRef.current = null;
    setSelected(null);
    setDetail(null);
    setRowLimit(ARCHIVE_MAX_ROWS);
    if (!kind.supported) { setState({ status: 'unsupported', format: kind.format }); return () => controller.abort(); }
    if ((kind.format === 'gzip' || kind.format === 'tar.gz') && !isDecompressionSupported('gzip')) {
      setState({ status: 'error', message: t('ui.archive.error.NO_DECOMPRESSION'), permanent: true });
      return () => controller.abort();
    }
    setState({ status: 'loading' });
    fetch(apiUrl(withViewParams(`/api/archive-raw?path=${encodeURIComponent(filePath)}`, { project, instance })), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(error => { reportSwallowed('archivePreview.errorBody', error); return {}; });
          const reasonKey = `ui.fileLoadError.reason.${body.reason}`;
          const reasonMessage = body.reason ? t(reasonKey) : '';
          const message = body.reason ? (reasonMessage === reasonKey ? body.error : reasonMessage)
            : response.status === 413 ? t('ui.archive.tooLarge', { max: formatBytes(body.maxBytes || ARCHIVE_RAW_MAX_BYTES) })
              : body.error || `HTTP ${response.status}`;
          throw Object.assign(new Error(message), { displayed: true, status: response.status });
        }
        const buffer = await response.arrayBuffer();
        if (!active) return null;
        if (buffer.byteLength > ARCHIVE_RAW_MAX_BYTES) throw Object.assign(new Error(t('ui.archive.tooLarge', { max: formatBytes(ARCHIVE_RAW_MAX_BYTES) })), { displayed: true, status: 413 });
        const data = new Uint8Array(buffer);
        bytesRef.current = data;
        return listArchive(data, { filename: filePath });
      })
      .then(result => {
        if (!active || !result) return;
        if (!result.supported) { setState({ status: 'unsupported', format: result.format || kind.format }); return; }
        const tree = buildTree(result.entries);
        setExpanded(initialExpanded(tree));
        setState({ status: 'ready', result, tree, fileSize: bytesRef.current?.byteLength || 0 });
      })
      .catch(error => {
        if (active && error.name !== 'AbortError') {
          if (bytesRef.current) resetBudget(bytesRef.current);
          bytesRef.current = null;
          setState({ status: 'error', message: error.displayed ? error.message : archiveErrorText(error, t), permanent: error.status >= 400 && error.status < 500 });
        }
      });
    return () => {
      active = false;
      controller.abort();
      requestRef.current++;
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
      imageRef.current = null;
      if (bytesRef.current) resetBudget(bytesRef.current);
      bytesRef.current = null;
    };
  }, [filePath, project, instance, retry]);

  useEffect(() => {
    if (!selected || !bytesRef.current || selected.dir) { setDetail(null); return undefined; }
    const data = bytesRef.current;
    const seq = ++requestRef.current;
    let active = true;
    setDetail({ status: 'loading' });
    if (selected.encrypted) {
      setDetail({ status: 'error', message: t('ui.archive.error.ENCRYPTED') });
      return undefined;
    }
    const imageCandidate = /\.(png|jpe?g|gif|bmp|webp)$/i.test(selected.path);
    const task = imageCandidate
      ? readEntry(data, selected, { maxEntryBytes: ARCHIVE_IMAGE_MAX_BYTES })
      : readEntryText(data, selected, { textMaxBytes: ARCHIVE_TEXT_MAX_BYTES });
    task.then(result => {
      if (!active || seq !== requestRef.current) return;
      const status = archiveEntryStatus(result);
      if (status === 'image') {
        const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
        if (imageRef.current) URL.revokeObjectURL(imageRef.current);
        imageRef.current = url;
        setDetail({ status, url, notes: result.notes, onError: () => setDetail({ status: 'binary', notes: result.notes }) });
      } else if (status === 'text') {
        const lines = result.text.split('\n');
        const lineTruncated = lines.length > ARCHIVE_MAX_TEXT_LINES;
        setDetail({ status, text: lines.slice(0, ARCHIVE_MAX_TEXT_LINES).join('\n'), encoding: result.encoding, lineTruncated, notes: result.notes });
      } else {
        setDetail({ status, notes: result.notes });
      }
    }).catch(error => {
      if (active && seq === requestRef.current) setDetail({ status: 'error', message: archiveErrorText(error, t) });
    });
    return () => {
      active = false;
      if (imageRef.current) { URL.revokeObjectURL(imageRef.current); imageRef.current = null; }
    };
  }, [selected]);

  useEffect(() => () => {
    if (imageRef.current) URL.revokeObjectURL(imageRef.current);
  }, []);

  const activate = useCallback(node => {
    if (!node.dir) {
      setSelected(node.entry || null);
      return;
    }
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
      return next;
    });
  }, []);

  const visible = useMemo(() => state.tree ? flattenArchiveTree(state.tree, expanded, rowLimit) : { rows: [] }, [state.tree, expanded, rowLimit]);
  const result = state.result;
  return (
    <div className={styles.viewer}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>←</button>
        <span className={styles.filePath} title={displayPath || filePath} dir="ltr">{displayPath || filePath}</span>
        <a className={styles.download} href={downloadUrl} title={t('ui.archive.download')} aria-label={t('ui.archive.download')}><DownloadOutlined /></a>
        <button type="button" className={styles.iconButton} onClick={onClose} title={t('ui.backToChat')} aria-label={t('ui.backToChat')}>×</button>
      </header>
      {state.status === 'unsupported' ? (
        <div className={styles.state} role="status"><h2>{t('ui.archive.unsupportedTitle')}</h2><p>{t(`ui.archive.unsupported.${['7z', 'rar', 'xz', 'bz2'].includes(state.format || kind.format) ? state.format || kind.format : 'unknown'}`)}</p><a className={styles.downloadButton} href={downloadUrl}><DownloadOutlined />{t('ui.archive.download')}</a></div>
      ) : state.status === 'error' ? (
        <div className={styles.state} role="alert"><p className={styles.error}>{state.message}</p>{!state.permanent && <button type="button" className={styles.downloadButton} onClick={() => setRetry(value => value + 1)}>{t('ui.archive.retry')}</button>}<a className={styles.downloadButton} href={downloadUrl}><DownloadOutlined />{t('ui.archive.download')}</a></div>
      ) : state.status === 'loading' ? <div className={styles.state} role="status">{t('ui.loading')}</div> : (
        <>
          <div className={styles.summary}>
            <span className={styles.badge}>{result.format}</span>
            <span>{t('ui.archive.entries', { count: result.entries.length })}</span>
            <span>{formatBytes(result.declaredTotalBytes)}</span>
            <span>{formatBytes(state.fileSize)}</span>
          </div>
          {shouldShowArchiveNotices(result, visible, state.tree.truncated) && <div className={styles.notices}><EntryNotices notes={result.notes} />{visible.truncated && <div className={styles.notice}>{t('ui.archive.rowLimit', { count: visible.rows.length })}</div>}{state.tree.truncated && <div className={styles.notice}>{t('ui.archive.treeLimit', { count: result.entries.length })}</div>}</div>}
          <div className={styles.body}>
            <div className={styles.tree} role="group" aria-label={t('ui.archive.entries', { count: result.entries.length })}>
              {visible.truncated && <button type="button" className={styles.showMore} onClick={() => setRowLimit(limit => limit + ARCHIVE_MAX_ROWS)}>{t('ui.archive.showMore', { count: ARCHIVE_MAX_ROWS })}</button>}
              {visible.rows.length === 0 ? <div className={styles.placeholder}>{t('ui.archive.empty')}</div> : visible.rows.map(({ node, depth }) => (
                <div key={node.path} className={`${styles.row} ${isArchiveEntrySelected(node.entry, selected) ? styles.selected : ''}`} role="button" tabIndex={0} aria-expanded={node.dir ? expanded.has(node.path) : undefined} aria-pressed={isArchiveEntrySelected(node.entry, selected)} aria-label={node.path} style={{ paddingInlineStart: `${depth * 16 + 8}px` }} onClick={() => activate(node)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(node); } }}>
                  <span className={styles.chevron}>{node.dir ? (expanded.has(node.path) ? '▾' : '▸') : ''}</span>
                  {node.dir ? (expanded.has(node.path) ? <FolderOpenOutlined /> : <FolderOutlined />) : <FileOutlined />}
                  <span className={styles.name} title={node.name} dir="ltr">{node.name}</span>
                  {node.entry?.encrypted && <LockOutlined title={t('ui.archive.error.ENCRYPTED')} />}
                  {!node.dir && <span className={styles.size}>{formatBytes(node.entry?.size || 0)}</span>}
                </div>
              ))}
              {visible.truncated && <button type="button" className={styles.showMore} onClick={() => setRowLimit(limit => limit + ARCHIVE_MAX_ROWS)}>{t('ui.archive.showMore', { count: ARCHIVE_MAX_ROWS })}</button>}
            </div>
            <EntryDetail key={`${selected?.container || 'none'}:${selected?.index ?? 'none'}:${selected?.path || ''}`} detail={detail} entry={selected} />
          </div>
        </>
      )}
    </div>
  );
}
