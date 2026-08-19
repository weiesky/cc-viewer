import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Modal } from 'antd';
import { t } from '../../i18n';
import { searchCode, replaceInFiles } from '../../utils/searchApi';
import { buildQueryRegExp, looksCatastrophic, noGlobal, applyMatch, computeMatchTarget } from '../../utils/searchReplace';
import { reportSwallowed } from '../../utils/errorReport';
import styles from './SearchPanel.module.css';

const LS = {
  caseSensitive: 'ccv_search_caseSensitive',
  wholeWord: 'ccv_search_wholeWord',
  regex: 'ccv_search_regex',
  query: 'ccv_search_query',
  include: 'ccv_search_include',
  exclude: 'ccv_search_exclude',
  showReplace: 'ccv_search_showReplace',
  replace: 'ccv_search_replace',
};
const lsBool = (k) => { try { return localStorage.getItem(k) === 'true'; } catch { return false; } };
const lsStr = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

const DEBOUNCE_MS = 300;
const toGlobs = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Search-only line render: wrap each matched range in a <mark>. */
function renderLine(text, submatches, styles) {
  if (!submatches || submatches.length === 0) return text;
  const ranges = [...submatches].sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    const start = Math.max(cursor, r.start);
    if (start > cursor) out.push(text.slice(cursor, start));
    if (r.end > start) {
      out.push(<mark key={i} className={styles.matchHighlight}>{text.slice(start, r.end)}</mark>);
      cursor = r.end;
    }
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/** Replace-preview line render: each match shows struck-through old + inserted new. */
function renderLineReplace(text, submatches, reInfo, regex, replaceText, styles) {
  if (!submatches || submatches.length === 0 || !reInfo) return renderLine(text, submatches, styles);
  const ranges = [...submatches].sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    const start = Math.max(cursor, r.start);
    if (start > cursor) out.push(text.slice(cursor, start));
    if (r.end > start) {
      const old = text.slice(start, r.end);
      const neu = applyMatch(old, reInfo.reNoG, regex, replaceText);
      out.push(
        <span key={i}>
          <del className={styles.replaceDel}>{old}</del>
          <ins className={styles.replaceIns}>{neu}</ins>
        </span>
      );
      cursor = r.end;
    }
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export default function SearchPanel({ style, onClose, onOpenResult, getDirtyPath, onReplaceApplied }) {
  const [query, setQuery] = useState(() => lsStr(LS.query));
  const [caseSensitive, setCaseSensitive] = useState(() => lsBool(LS.caseSensitive));
  const [wholeWord, setWholeWord] = useState(() => lsBool(LS.wholeWord));
  const [regex, setRegex] = useState(() => lsBool(LS.regex));
  const [showDetails, setShowDetails] = useState(() => !!(lsStr(LS.include) || lsStr(LS.exclude)));
  const [include, setInclude] = useState(() => lsStr(LS.include));
  const [exclude, setExclude] = useState(() => lsStr(LS.exclude));
  const [showReplace, setShowReplace] = useState(() => lsBool(LS.showReplace));
  const [replaceText, setReplaceText] = useState(() => lsStr(LS.replace));

  const [results, setResults] = useState([]);
  const [engine, setEngine] = useState('none');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [isReplacing, setIsReplacing] = useState(false);
  const [notice, setNotice] = useState(null);

  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const resultsRef = useRef(null);
  const mountedRef = useRef(true);
  // Reset to true on (re)mount — a bare `useRef(true)` stays false after an HMR/StrictMode
  // remount reuses the ref object, which would wedge every post-replace setState (repo convention).
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const totalMatches = useMemo(() => results.reduce((n, r) => n + r.matches.length, 0), [results]);

  // Shared regex info for preview + single-match targeting (node/JS semantics, not rg offsets).
  const reInfo = useMemo(() => {
    if (!query) return null;
    if (regex && looksCatastrophic(query)) return null;
    try {
      const reG = buildQueryRegExp({ query, regex, wholeWord, caseSensitive });
      return { reG, reNoG: noGlobal(reG) };
    } catch { return null; }
  }, [query, regex, wholeWord, caseSensitive]);

  const queryRef = useRef(query);
  queryRef.current = query;

  const runSearch = useCallback(async (opts) => {
    const q = query;
    if (!opts?.keepNotice) setNotice(null); // a post-replace re-run keeps the replace summary
    if (!q) {
      if (abortRef.current) abortRef.current.abort();
      setResults([]); setEngine('none'); setTruncated(false); setError(null); setLoading(false);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true); setError(null);
    try {
      const data = await searchCode({
        query: q, caseSensitive, wholeWord, regex,
        includeGlobs: toGlobs(include), excludeGlobs: toGlobs(exclude),
        // Force the node engine while the replace panel is open so the previewed match spans come
        // from the SAME engine that performs the write (rg's Rust regex can differ from V8's).
        engine: showReplace ? 'node' : 'auto',
      }, ac.signal);
      if (ac.signal.aborted) return;
      if (data.error) { setError(data.error); setResults([]); setEngine('none'); setTruncated(false); }
      else { setResults(data.results || []); setEngine(data.engine || 'none'); setTruncated(!!data.truncated); setCollapsed(new Set()); }
    } catch (err) {
      if (ac.signal.aborted || err?.name === 'AbortError') return;
      reportSwallowed('search', err);
      setError('error'); setResults([]); setEngine('none'); setTruncated(false);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [query, caseSensitive, wholeWord, regex, include, exclude, showReplace]);

  // Persist all inputs (incl. replace text/panel state) to localStorage.
  useEffect(() => {
    lsSet(LS.query, query); lsSet(LS.caseSensitive, caseSensitive); lsSet(LS.wholeWord, wholeWord);
    lsSet(LS.regex, regex); lsSet(LS.include, include); lsSet(LS.exclude, exclude);
    lsSet(LS.showReplace, showReplace); lsSet(LS.replace, replaceText);
  }, [query, caseSensitive, wholeWord, regex, include, exclude, showReplace, replaceText]);

  // Debounced search. `replaceText` is intentionally NOT a dependency — typing a replacement must
  // not fire a fresh codebase search (or wipe the replace summary). `showReplace` IS, because it
  // flips the search engine (see runSearch).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runSearch, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, caseSensitive, wholeWord, regex, include, exclude, showReplace, runSearch]);

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const onInputKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (debounceRef.current) clearTimeout(debounceRef.current); runSearch(); }
    else if (e.key === 'Escape') { e.preventDefault(); setQuery(''); }
  };

  const toggleCollapse = (file) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(file)) next.delete(file); else next.add(file);
    return next;
  });
  const allCollapsed = results.length > 0 && collapsed.size >= results.length;
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(results.map((r) => r.file)));

  const onResultsKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = resultsRef.current?.querySelectorAll('[data-match-row]');
    if (!rows || !rows.length) return;
    e.preventDefault();
    const arr = [...rows];
    const idx = arr.indexOf(document.activeElement);
    const nextIdx = e.key === 'ArrowDown'
      ? (idx < 0 ? 0 : Math.min(idx + 1, arr.length - 1))
      : (idx < 0 ? 0 : Math.max(idx - 1, 0));
    arr[nextIdx]?.focus();
  };

  const openMatch = (file, m) => onOpenResult?.(file, m.line, m.submatches?.[0] || null);

  // ── Replace ──
  const baseParams = () => ({
    query, caseSensitive, wholeWord, regex,
    includeGlobs: toGlobs(include), excludeGlobs: toGlobs(exclude),
    replacement: replaceText,
  });
  const skipPaths = () => { const d = getDirtyPath?.(); return d ? [d] : []; };

  const buildNotice = (res) => {
    const parts = [t('ui.search.replacedSummary', { count: res.total, files: res.changed.length })];
    if (res.truncated) parts.push(t('ui.search.replaceCapped', { count: res.total }));
    if (res.skipped?.length) {
      const byReason = {};
      for (const s of res.skipped) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
      for (const [reason, count] of Object.entries(byReason)) {
        parts.push(t(`ui.search.skipped_${reason}`, { count }));
      }
    }
    return parts.join(' · ');
  };

  const confirmReplaceAll = (count, files, capped) => new Promise((resolve) => {
    const body = t('ui.search.confirmReplaceBody', { count, files })
      + (capped ? ` ${t('ui.search.replaceCapped', { count })}` : '');
    Modal.confirm({
      title: t('ui.search.confirmReplaceTitle'),
      content: body,
      okText: t('ui.search.confirmOk'),
      cancelText: t('ui.search.confirmCancel'),
      okButtonProps: { danger: true },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });

  const doReplace = async (params, { confirm, onOptimistic } = {}) => {
    if (isReplacing || !query || !reInfo) return;
    const q = query;
    const full = { ...baseParams(), ...params, skipPaths: skipPaths() };

    // Hold the busy lock across the ENTIRE flow (incl. the dry-run + confirm modal) so no second
    // replace can be fired while the modal is open.
    setIsReplacing(true);
    const done = () => { if (mountedRef.current) setIsReplacing(false); };

    if (confirm) {
      let dry;
      try { dry = await replaceInFiles({ ...full, dryRun: true }); }
      catch (e) { reportSwallowed('search-replace', e); if (mountedRef.current) setNotice(t('ui.search.replaceError')); done(); return; }
      if (!mountedRef.current) return;
      if (dry.error) { setError(dry.error); done(); return; }
      if (!dry.total) { setNotice(t('ui.search.nothingToReplace')); done(); return; }
      const ok = await confirmReplaceAll(dry.total, dry.changed.length, dry.truncated);
      if (!ok || !mountedRef.current) { done(); return; }
    }

    try {
      const res = await replaceInFiles(full);
      if (!mountedRef.current) return;
      if (res.error) { setError(res.error); return; }
      onOptimistic?.();
      setNotice(buildNotice(res));
      onReplaceApplied?.(res.changed.map((c) => c.file));
      if (queryRef.current === q) runSearch({ keepNotice: true }); // don't stomp a changed query; keep the summary
    } catch (e) {
      if (e?.name === 'AbortError' || !mountedRef.current) return;
      reportSwallowed('search-replace', e);
      setNotice(t('ui.search.replaceError'));
    } finally {
      done();
    }
  };

  const pruneFile = (file) => setResults((prev) => prev.filter((g) => g.file !== file));
  const pruneMatch = (file, m) => setResults((prev) => prev
    .map((g) => (g.file === file ? { ...g, matches: g.matches.filter((mm) => mm !== m) } : g))
    .filter((g) => g.matches.length));

  const replaceAll = () => doReplace({ scope: 'all' }, { confirm: true });
  const replaceFile = (file, e) => { e?.stopPropagation?.(); doReplace({ scope: 'file', file }, { onOptimistic: () => pruneFile(file) }); };
  const replaceOneMatch = (file, m, e) => {
    e?.stopPropagation?.();
    const sub = m.submatches?.[0];
    if (!sub || !reInfo) return;
    const target = computeMatchTarget(m.text, sub.start, reInfo.reG);
    if (!target) return;
    doReplace({ scope: 'match', file, line: m.line, col: target.col, expectText: target.expectText }, { onOptimistic: () => pruneMatch(file, m) });
  };

  // replaceActive: replace affordances (Replace All + per-file/-match buttons) are available —
  // whenever the panel is open with a valid pattern, INCLUDING an empty replacement (= delete).
  // previewOn: additionally render the inline struck-through preview, only once there's replacement
  // text (avoids marking every row as a deletion before the user types).
  const replaceActive = showReplace && !!reInfo;
  const previewOn = replaceActive && replaceText.length > 0;

  const ToggleBtn = ({ active, onClick, title, children }) => (
    <button type="button" className={active ? `${styles.toggleBtn} ${styles.toggleActive}` : styles.toggleBtn} aria-pressed={active} onClick={onClick} title={title}>{children}</button>
  );
  const stop = (fn) => (e) => { if (e.key && e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault(); e.stopPropagation(); fn(e); };

  return (
    <div className={styles.searchPanel} style={style}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{t('ui.search.title')}</span>
        <button className={styles.headerCloseBtn} onClick={onClose} title={t('ui.search.close') || 'Close'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
          </svg>
        </button>
      </div>

      <div className={styles.controls}>
        <div className={styles.searchBlock}>
          <button
            type="button"
            className={styles.replaceToggle}
            aria-pressed={showReplace}
            aria-label={t('ui.search.toggleReplace')}
            title={t('ui.search.toggleReplace')}
            onClick={() => setShowReplace((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showReplace ? 'none' : 'rotate(-90deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div className={styles.searchFields}>
            <div className={styles.inputRow}>
              <input ref={inputRef} className={styles.searchInput} type="text" value={query} spellCheck={false} placeholder={t('ui.search.placeholder')} onChange={(e) => setQuery(e.target.value)} onKeyDown={onInputKeyDown} />
              <button type="button" className={showDetails ? `${styles.detailsBtn} ${styles.toggleActive}` : styles.detailsBtn} aria-pressed={showDetails} onClick={() => setShowDetails((v) => !v)} title={t('ui.search.toggleDetails')}>…</button>
            </div>
            {showReplace && (
              <div className={styles.inputRow}>
                <input className={styles.searchInput} type="text" value={replaceText} spellCheck={false} placeholder={t('ui.search.replace')} onChange={(e) => setReplaceText(e.target.value)} />
                <button type="button" className={styles.replaceAllBtn} disabled={isReplacing || !replaceActive} onClick={replaceAll} title={t('ui.search.replaceAll')}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 4v6h6" /><path d="M3 10a9 9 0 1 1 2 6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={styles.toggleRow}>
          <ToggleBtn active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} title={t('ui.search.caseSensitive')}>Aa</ToggleBtn>
          <ToggleBtn active={wholeWord} onClick={() => setWholeWord((v) => !v)} title={t('ui.search.wholeWord')}><span className={styles.wholeWordGlyph}>ab</span></ToggleBtn>
          <ToggleBtn active={regex} onClick={() => setRegex((v) => !v)} title={t('ui.search.regex')}>.*</ToggleBtn>
        </div>

        {showDetails && (
          <div className={styles.details}>
            <input className={styles.globInput} type="text" value={include} spellCheck={false} placeholder={t('ui.search.filesToInclude')} onChange={(e) => setInclude(e.target.value)} />
            <input className={styles.globInput} type="text" value={exclude} spellCheck={false} placeholder={t('ui.search.filesToExclude')} onChange={(e) => setExclude(e.target.value)} />
          </div>
        )}
      </div>

      <div className={styles.statusRow}>
        {isReplacing && <span className={styles.statusText}>{t('ui.search.replacing')}</span>}
        {!isReplacing && loading && <span className={styles.statusText}>{t('ui.search.searching')}</span>}
        {!isReplacing && !loading && error === 'invalid_regex' && <span className={styles.statusError}>{t('ui.search.invalidRegex')}</span>}
        {!isReplacing && !loading && error === 'error' && <span className={styles.statusError}>{t('ui.search.error')}</span>}
        {!isReplacing && !loading && !error && query && results.length === 0 && <span className={styles.statusText}>{t('ui.search.noResults')}</span>}
        {!isReplacing && !loading && !error && results.length > 0 && (
          <>
            <span className={styles.statusText} title={engine !== 'none' ? t('ui.search.viaEngine', { engine }) : undefined}>
              {t('ui.search.resultSummary', { count: totalMatches, files: results.length })}
            </span>
            <button className={styles.collapseAllBtn} onClick={toggleAll} title={allCollapsed ? t('ui.search.expandAll') : t('ui.search.collapseAll')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {allCollapsed ? <polyline points="6 9 12 15 18 9" /> : <polyline points="18 15 12 9 6 15" />}
              </svg>
            </button>
          </>
        )}
      </div>
      {notice && <div className={styles.notice}>{notice}</div>}
      {truncated && !loading && <div className={styles.truncated}>{t('ui.search.truncated', { count: totalMatches })}</div>}

      <div className={styles.resultsContainer} ref={resultsRef} onKeyDown={onResultsKeyDown}>
        {results.map((group) => {
          const isCollapsed = collapsed.has(group.file);
          const dir = group.file.includes('/') ? group.file.slice(0, group.file.lastIndexOf('/')) : '';
          const base = group.file.slice(group.file.lastIndexOf('/') + 1);
          return (
            <div key={group.file} className={styles.fileGroup}>
              <div className={styles.fileHeader} role="button" tabIndex={0} onClick={() => toggleCollapse(group.file)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(group.file); } }} title={group.file}>
                <svg className={styles.chevron} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className={styles.fileName}>{base}</span>
                {dir && <span className={styles.fileDir}>{dir}</span>}
                {replaceActive && (
                  <button type="button" className={styles.rowReplaceBtn} disabled={isReplacing} title={t('ui.search.replaceInFile')} onClick={(e) => replaceFile(group.file, e)} onKeyDown={stop(() => replaceFile(group.file))}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4v6h6" /><path d="M3 10a9 9 0 1 1 2 6" /></svg>
                  </button>
                )}
                <span className={styles.matchCount}>{group.matches.length}</span>
              </div>
              {!isCollapsed && group.matches.map((m, i) => (
                <div key={`${m.line}-${i}`} data-match-row className={styles.matchRow} role="button" tabIndex={0} onClick={() => openMatch(group.file, m)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMatch(group.file, m); } }}>
                  <span className={styles.lineNo}>{m.line}</span>
                  <span className={styles.lineText}>{previewOn ? renderLineReplace(m.text, m.submatches, reInfo, regex, replaceText, styles) : renderLine(m.text, m.submatches, styles)}</span>
                  {replaceActive && (
                    <button type="button" className={styles.rowReplaceBtn} disabled={isReplacing} title={t('ui.search.replaceMatch')} onClick={(e) => replaceOneMatch(group.file, m, e)} onKeyDown={stop(() => replaceOneMatch(group.file, m))}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4v6h6" /><path d="M3 10a9 9 0 1 1 2 6" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
