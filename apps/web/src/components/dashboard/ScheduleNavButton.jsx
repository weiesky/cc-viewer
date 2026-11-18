import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Popover } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { reportSwallowed } from '../../utils/errorReport';
import { subscribeScheduledTasks } from '../../utils/scheduledTaskEvents';
import { pendingTasks, taskPreview, serverClockOffset } from '../../utils/scheduleNav';
import { remainingSeconds, formatCountdownClock } from '../../utils/deadlineCountdown';
import { deriveTaskUiStatus, formatNextRun } from '../../utils/scheduleDescription';
import { ScheduleIcon } from '../common/quickMenuIcons';
import styles from './ScheduleNavButton.module.css';

/**
 * Scheduled-task entry in the left nav rail. Mirrors WorkflowButton/TeamButton:
 * a single icon button that renders nothing when there are no pending tasks, and
 * shows a hover Popover listing every pending task with a live countdown.
 * Clicking a row asks the parent (ChatView) to open ScheduleTaskModal focused on
 * that task.
 *
 * Data comes from GET /api/scheduled-tasks and is refreshed by the shared
 * scheduled_tasks SSE pub/sub (subscribeScheduledTasks) — no extra plumbing.
 */
async function _fetchJson(path) {
  const r = await fetch(apiUrl(path));
  const data = await r.json().catch((err) => { reportSwallowed('schedule-nav.parse', err); return {}; });
  return { ok: r.ok, data };
}

// Cooldown between overdue-triggered reloads so a task the scheduler can't claim
// (no live session) doesn't hammer the API from every open tab.
const OVERDUE_RELOAD_COOLDOWN_MS = 15000;

export default function ScheduleNavButton({ project, instance, onOpenTask, navBtnClass }) {
  const [tasks, setTasks] = useState([]);
  const [tz, setTz] = useState(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [open, setOpen] = useState(false);
  // Wall-clock tick that drives every row's countdown — a single interval for the
  // whole popover instead of one per row, and only while the popover is open.
  const [, setTick] = useState(0);
  // Timestamp of the last overdue-triggered reload. A time-based cooldown (not a
  // boolean) so an overdue-but-unclaimed task reloads at most once per 15 s instead
  // of once per round-trip.
  const lastOverdueReloadRef = useRef(0);
  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  const loadTasks = useCallback(async () => {
    const loadProject = project;
    try {
      const params = new URLSearchParams();
      if (loadProject) params.set('project', loadProject);
      if (instance) params.set('instance', instance);
      const qs = params.toString();
      const q = qs ? `?${qs}` : '';
      const { ok, data } = await _fetchJson(`/api/scheduled-tasks${q}`);
      // Ignore a response for a project the user has already navigated away from.
      if (loadProject !== projectRef.current) return;
      if (!ok) return;
      if (data.timezone) setTz(data.timezone);
      setClockOffset(serverClockOffset(data.serverTime));
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch (err) {
      reportSwallowed('schedule-nav.load', err);
    }
  }, [project, instance]);

  // Initial load + SSE-driven refresh. Task creates/updates/deletes and run outcomes
  // all broadcast through the shared scheduled_tasks channel.
  useEffect(() => {
    loadTasks();
    const unsub = subscribeScheduledTasks(project, () => { loadTasks(); });
    return unsub;
  }, [loadTasks, project]);

  const pending = useMemo(() => pendingTasks(tasks), [tasks]);

  // Overdue detection as a pure derivation, so the reload is an effect (not a
  // render-phase side effect) and the cooldown ref prevents a reload storm.
  const hasOverdue = useMemo(
    () => pending.some((task) => remainingSeconds(task.nextRunAt - clockOffset) <= 0),
    [pending, clockOffset],
  );
  useEffect(() => {
    if (!hasOverdue) return;
    const now = Date.now();
    if (now - lastOverdueReloadRef.current < OVERDUE_RELOAD_COOLDOWN_MS) return;
    lastOverdueReloadRef.current = now;
    loadTasks();
  }, [hasOverdue, loadTasks]);

  // Close the popover when the last pending task disappears (task claimed/deleted),
  // so the tick interval stops and the popover doesn't reappear already-open later.
  useEffect(() => {
    if (pending.length === 0 && open) setOpen(false);
  }, [pending.length, open]);

  // Single 1s tick, armed only while the popover is open and has rows. Each row
  // derives its remaining time from the wall clock on every tick, so backgrounded
  // tabs catch up automatically on the next visible tick.
  useEffect(() => {
    if (!open || pending.length === 0) return undefined;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [open, pending.length]);

  // All hooks above this line — the early return must stay below every hook call.
  if (pending.length === 0) return null;

  // Countdown for one row. nextRunAt is server-wall-clock; subtract the offset so a
  // skewed client clock does not shift the countdown.
  const countdownFor = (nextRunAt) => {
    const remaining = remainingSeconds(nextRunAt - clockOffset);
    return formatCountdownClock(remaining);
  };

  const content = (
    <div className={styles.stPopover}>
      <div className={styles.stPopoverTitle}>{t('ui.schedule.title')} ({pending.length})</div>
      {pending.map((task) => {
        const st = deriveTaskUiStatus(task);
        const name = taskPreview(task);
        return (
          <button
            key={task.id}
            type="button"
            className={styles.stPopoverItem}
            title={formatNextRun(task.nextRunAt, tz)}
            onClick={() => { setOpen(false); onOpenTask?.(task.id); }}
          >
            <span className={`${styles.stStatusDot} ${styles[`stStatus_${st}`]}`} title={t(`ui.schedule.status.${st}`)} />
            <span className={styles.stTaskName}>{name}</span>
            <span className={styles.stCountdown}>{countdownFor(task.nextRunAt)}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <Popover
      content={<div className={styles.stPopoverScroll}>{content}</div>}
      trigger={['hover', 'click']}
      open={open}
      onOpenChange={setOpen}
      destroyOnHidden
      placement="right"
      arrow={{ pointAtCenter: true }}
      autoAdjustOverflow={false}
      align={{ overflow: { adjustX: true, shiftY: true } }}
      overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', padding: 0 }}
    >
      <button
        className={`${navBtnClass || ''} ${styles.stNavBtn}`}
        title={t('ui.schedule.title')}
        aria-label={t('ui.schedule.title')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ScheduleIcon />
      </button>
    </Popover>
  );
}
