import React, { useCallback, useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { mapResumeRow } from '../../utils/resumeSessions';
import styles from './ResumeSessionsPopover.module.css';

/**
 * Shared session-list body for the /resume feature (2026-10): a lazy-fetched
 * (AbortController) list of the CURRENT project's 5 most-recent sessions, one row
 * per session (status dot | summary | last activity). Reused by the desktop
 * Header dropdown and the mobile Modal. `active` gates the fetch (true while the
 * container is open). The row→view-model mapping is the pure, unit-tested
 * `mapResumeRow`. `attachedUuid` is the session the main view is attached to — it
 * wins the "current" blue dot over the server's `currentSessionUuid` (while
 * attached, the attached session is what the user is looking at). `isStreaming`
 * is the ground-truth "current session is mid-stream" flag, used to force the
 * current row's running pulse even when its journal mtime has aged out.
 */
export function ResumeSessionsList({ active, onResumeSession, attachedUuid, isStreaming }) {
  const [rows, setRows] = useState(null); // null = not fetched yet / inactive
  const [currentSessionUuid, setCurrentSessionUuid] = useState(null);

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetch(apiUrl('/api/resume-sessions?limit=5'), { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(data => {
        setRows(Array.isArray(data?.items) ? data.items : []);
        setCurrentSessionUuid(typeof data?.currentSessionUuid === 'string' ? data.currentSessionUuid : null);
      })
      .catch(err => {
        if (err && err.name === 'AbortError') return; // closed before resolve — benign
        reportSwallowed('resumeSessions.fetch', err);
        setRows([]);
        setCurrentSessionUuid(null);
      });
    return () => ctrl.abort();
  }, [active]);

  const handlePick = useCallback((raw) => {
    // Current-live session: highlight only, no view switch. Judge on the RAW row
    // (it carries sessionUuid); the mapped view-model is display-only.
    if (raw && currentSessionUuid && typeof raw.sessionUuid === 'string'
        && raw.sessionUuid.toLowerCase() === String(currentSessionUuid).toLowerCase()) return;
    // Pass the RAW row through — AppBase.handleResumeSession needs sessionUuid,
    // which the mapped view-model does not carry.
    if (onResumeSession) onResumeSession(raw);
  }, [onResumeSession, currentSessionUuid]);

  const renderRow = (raw) => {
    const row = mapResumeRow(raw, currentSessionUuid, { attachedUuid, isStreaming });
    return (
      <div key={row.key} className={`${styles.resumeItem}${row.isCurrentLive ? ` ${styles.resumeItemCurrent}` : ''}`} onClick={() => handlePick(raw)}>
        <Tooltip title={t(row.tooltipKey)}>
          <span className={styles.resumeStatusCell}>
            <ResumeStatusDot kind={row.statusKind} running={row.running} />
          </span>
        </Tooltip>
        <span className={styles.resumeSummary}>{row.summary}</span>
        {/* The TIME column always shows the relative last-activity time. The
            "running" state is expressed ONLY by the status dot's pulse (and its
            tooltip), never by hijacking this column. */}
        <span className={styles.resumeTime}>{row.timeLabel}</span>
      </div>
    );
  };

  return (
    <div className={styles.resumePopover}>
      <div className={styles.resumeTitle}>{t('ui.resume.recentSessions')}</div>
      {rows === null ? (
        <div className={styles.resumeEmpty}>{t('ui.resume.loading')}</div>
      ) : rows.length === 0 ? (
        <div className={styles.resumeEmpty}>{t('ui.resume.empty')}</div>
      ) : (
        rows.map(renderRow)
      )}
    </div>
  );
}

// One status glyph per row, mirroring TaskProgressHud's TaskStatusDot (SVG, not
// Unicode): a single 16-unit viewBox scales with the local font size.
//   current  → filled primary disc
//   inactive → hollow grey ring
// `running` (mtime heuristic, or isStreaming for the current row) layers a pulse
// animation on top of either — same statePulse pattern as the task list's
// in_progress dot.
function ResumeStatusDot({ kind, running }) {
  const variant = kind === 'current' ? styles.dotCurrent : styles.dotInactive;
  return (
    <svg
      className={`${styles.dot} ${variant}${running ? ` ${styles.statePulse}` : ''}`}
      viewBox="0 0 16 16" width="1em" height="1em"
      aria-hidden="true" focusable="false"
    >
      <circle className={styles.dotRing} cx="8" cy="8" r="6.25" />
    </svg>
  );
}
