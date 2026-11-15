import React, { useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { subscribe, getSnapshot } from '../../utils/taskStore';
import {
  buildAgentToolUseMap,
  deriveActiveAgents,
  resolveAgentIdentity,
} from '../../utils/activeAgents';
import { fmtDuration, stateGlyph } from '../../utils/workflowFormat';
import styles from './ActiveAgentsBar.module.css';

/**
 * Active subAgent/teammate card — floating at the conversation panel's
 * top-right in `--sdk` mode, rendered as a collapsible card (title + count +
 * one row per active task: status dot, name, current-tool pill, elapsed).
 *
 * Data: the SDK relays task_started/progress/updated/notification as WS
 * `sdk-task` frames → sdkTaskTracker → taskStore. This component derives the
 * active agent set from the taskStore snapshot (taskType ∈ {local_agent,
 * in_process_teammate}, non-terminal status) and auto-hides (returns null) when
 * there is nothing active.
 *
 * Identity: each agent's display name comes from joining the spawn Agent/Task
 * tool_use block (by toolUseId, else prompt prefix) — the task frame alone has
 * no reliable name. The join needs the transcript, so ChatView passes `requests`.
 *
 * Interaction: read-only. The header toggles collapse.
 */
export default function ActiveAgentsBar({ requests, onVisibleChange }) {
  const [snapshot, setSnapshot] = useState(getSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  // 1s clock so each row's elapsed time keeps moving between task frames.
  const [, setTick] = useState(0);
  useEffect(() => subscribe(setSnapshot), []);

  // The tool_use join map depends ONLY on the transcript — NOT on the task
  // snapshot, which is republished on every task_progress frame. Splitting it
  // out stops the whole-transcript rescan from running several times a second
  // while an agent streams progress.
  const toolUseMap = useMemo(() => buildAgentToolUseMap(requests), [requests]);

  // Resolve identities against the transcript. One row per task (no teammate
  // name dedupe): with filtering gone, dedupe would make the doing pill /
  // elapsed report only the first of several concurrent tasks. deriveActiveAgents
  // already carries the live per-task fields (status, lastToolName, createdAt),
  // so no second join is needed.
  const rows = useMemo(() => {
    const active = deriveActiveAgents(snapshot.tasks);
    if (active.length === 0) return [];
    return active.map((agent) => ({ ...resolveAgentIdentity(agent, toolUseMap), status: agent.status, lastToolName: agent.lastToolName, createdAt: agent.createdAt }));
  }, [snapshot, toolUseMap]);

  const visible = rows.length > 0;

  // Notify ChatView only on boolean flips so it can reserve top padding without
  // subscribing to taskStore itself.
  useEffect(() => {
    if (typeof onVisibleChange === 'function') onVisibleChange(visible);
  }, [visible, onVisibleChange]);

  // Tick the clock only while rows are actually shown.
  useEffect(() => {
    if (!visible || collapsed) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [visible, collapsed]);

  // Hooks above this line always run; the early return must stay below them.
  if (!visible) return null;

  const now = Date.now();
  return (
    <div className={`${styles.bar}${collapsed ? ` ${styles.collapsed}` : ''}`}
      role="region" aria-label={t('ui.activeAgents.title')}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        title={collapsed ? t('ui.expand') : t('ui.collapse')}
      >
        <span className={`${styles.liveDot} ${styles.statePulse}`} aria-hidden="true" />
        <span className={styles.title} title={t('ui.activeAgents.title')}>{t('ui.activeAgents.title')}</span>
        <span className={styles.stat}>{t('ui.workflow.agentsShort', { count: rows.length })}</span>
        <span className={styles.chevron} aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className={styles.rows} tabIndex={0}>
          {rows.map((row) => <Row key={row.taskId} row={row} now={now} />)}
        </div>
      )}
    </div>
  );
}

// One active task: status dot | name (+ current-tool pill) | elapsed.
// `queued` (pending) rows show neither a tool pill nor a duration — only the
// waiting state, since no tool has run and the client clock only marks arrival.
function Row({ row, now }) {
  const queued = row.status === 'pending';
  const label = row.title || row.name || t('ui.stats.subAgent');
  const doing = !queued && row.lastToolName ? row.lastToolName : '';
  const dur = !queued && row.createdAt != null
    ? fmtDuration(Math.max(0, now - row.createdAt))
    : '';
  const statusLabel = queued ? t('ui.tasks.status.pending') : t('ui.workflow.status.running');
  const state = queued ? 'queued' : 'running';
  return (
    <div className={styles.row}>
      <span
        className={`${styles.dot} ${queued ? styles.stateQueued : styles.stateRunning}${queued ? '' : ` ${styles.statePulse}`}`}
        role="img"
        aria-label={statusLabel}
      >{stateGlyph(state)}</span>
      <span className={styles.labelCell}>
        <span className={styles.label} title={label}>{label}</span>
        {doing && <span className={styles.doing} title={doing}>{doing}</span>}
      </span>
      <span className={styles.dur}>{dur}</span>
    </div>
  );
}
