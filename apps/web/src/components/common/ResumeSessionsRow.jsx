import React from 'react';
import { t } from '../../i18n';
import chrome from './sharedChrome.module.css';
import styles from './ResumeSessionsRow.module.css';
import { HistoryIcon } from './quickMenuIcons';
import { ResumeSessionsList } from '../chat/ResumeSessionsPopover';

/**
 * Session-history row for the star quick-settings menu (2026-10-06 migration): a
 * quickMenuGroup row + cascade flyout whose content is the shared ResumeSessionsList.
 * Lives in BOTH menu hosts (TerminalPanel toolbar and ChatInputBar) via the
 * QuickAutoApproveRows `middle` slot, between the permission and plan rows.
 *
 * - Follows the VIEWED project: `project` is the viewed project (viewedProject ||
 *   projectName) threaded down from AppBase, and ResumeSessionsList re-fetches when it
 *   changes.
 * - Clicking a session fires `onResumeSession(row)` → AppBase.handleResumeSession, which
 *   runs the Modal.confirm two-step and then the TRUE /resume switch (in-process inject).
 * - Renders null when there is no `onResumeSession` (local-log mode), mirroring the old
 *   HeaderResumeDropdown guard so a dead control never appears.
 *
 * expanded/onToggle/onHoverEnter/onHoverLeave wire into the host's single-expanded-key
 * model and hover-intent, exactly like the perm/plan/AgentTeam rows.
 */
function ResumeSessionsRow({ expanded, onToggle, onHoverEnter, onHoverLeave, project, attachedUuid, isStreaming, onResumeSession }) {
  if (!onResumeSession) return null;
  return (
    <div
      className={`${chrome.quickMenuGroup} ${expanded ? chrome.quickMenuGroupOpen : ''}`}
      onMouseEnter={() => onHoverEnter('history')}
      onMouseLeave={() => onHoverLeave('history')}
    >
      <button className={chrome.quickMenuRow} onClick={() => onToggle(expanded ? null : 'history')}>
        <span className={chrome.quickMenuRowIcon}><HistoryIcon /></span>
        <span className={chrome.quickMenuLabel}>{t('ui.resume.history')}</span>
        <span className={chrome.quickMenuCaret}>▸</span>
      </button>
      <div className={chrome.quickMenuSubWrap}>
        <div className={`${chrome.quickMenuSub} ${styles.historySub}`}>
          <ResumeSessionsList
            active={expanded}
            project={project}
            attachedUuid={attachedUuid}
            isStreaming={isStreaming}
            onResumeSession={onResumeSession}
          />
        </div>
      </div>
    </div>
  );
}

export default ResumeSessionsRow;
