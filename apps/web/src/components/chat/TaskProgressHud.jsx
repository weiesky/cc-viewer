import React, { useState, useEffect } from 'react';
import { t } from '../../i18n';
import { subscribe, getSnapshot } from '../../utils/taskStore';
import styles from './TaskProgressHud.module.css';

/**
 * Claude Code 任务清单 HUD：docked 在 ChatView 输入框上方（消息滚动区之外），
 * 常驻可见、不被对话挤走。数据来自 taskStore（AppBase 的 SSE `task_update`
 * 全量快照持续喂养；服务端由 task-bridge hooks → task-state reducer 维护）。
 *
 * 形态：紧凑横条（✓ done/total + 当前任务），点击展开完整清单。列表保持创建
 * 顺序（服务端 Map 插入序 = TUI 顺序，原地更新不换槽），不做状态重排。
 * 无任务或全部完成时返回 null 自动隐藏（SDK 模式无 hooks、任务工具被 flag
 * 禁用时同理）。会话/工作区切换由 AppBase 的 clearTaskStore 清空点 + 服务端
 * 连接即推快照保证新鲜，组件自身不做 sessionId 比对（snapshot id 是 CC 会话
 * UUID，与 ccv 的 ts 会话 id 属不同身份空间）。
 */
export default function TaskProgressHud() {
  const [snapshot, setSnapshot] = useState(getSnapshot);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => subscribe(setSnapshot), []);

  const tasks = snapshot.tasks;
  const visible = tasks.length > 0 && tasks.some(x => x.status !== 'completed');

  // Reset the expansion when the strip hides (empty / all done) so a later
  // task batch doesn't re-open already expanded.
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  if (!visible) return null;

  const done = tasks.filter(x => x.status === 'completed').length;
  const total = tasks.length;

  // Derive "current" in display order: first in_progress (its activeForm in
  // present tense preferred), else the next pending task.
  const inProgress = tasks.find(x => x.status === 'in_progress');
  const nextPending = tasks.find(x => x.status === 'pending');
  const current = inProgress
    ? (inProgress.activeForm || inProgress.subject || `#${inProgress.taskId}`)
    : (nextPending.subject || `#${nextPending.taskId}`);

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        {/* role="status" lives on the summary line only — the expanded list stays
            out of the live region so rapid status flips don't spam announcements. */}
        <div className={styles.summary} role="status" aria-label={t('ui.tasks.title')}>
          <span className={styles.doneCount}>
            {`✓ ${t('ui.tasks.progress', { done, total })}`}
          </span>
          <span className={styles.current} title={current}>{current}</span>
          {/* Progress dots: one per task, so the collapsed strip alone shows
              how far along we are, which step is running, and how many are
              left. Purely decorative — the role="status" count line above is
              the accessible announcement. */}
          <span className={styles.dots} aria-hidden="true">
            {tasks.map((task) => (
              <TaskStatusDot key={task.taskId} status={task.status} />
            ))}
          </span>
          <button
            type="button"
            className={styles.chevron}
            aria-expanded={expanded}
            aria-controls="task-progress-hud-list"
            aria-label={expanded ? t('ui.collapse') : t('ui.expand')}
            title={expanded ? t('ui.collapse') : t('ui.expand')}
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>
        {expanded && (
          <div className={styles.rows} id="task-progress-hud-list">
            {tasks.map((task) => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Status → variant class, one table shared by the collapsed strip and the
// expanded rows so the two can never drift. Values are the imported CSS-module
// classes (not strings), so a CSS rename can never silently fall through.
const DOT_CLASS = {
  completed: styles.dotDone,
  in_progress: styles.dotRunning,
  pending: styles.dotPending,
};

// One circle per task. SVG (not Unicode ✓/●/○): those sit off-baseline inside
// a drawn circle and their metrics vary by font. A single 16-unit viewBox
// scales with the local font size via the .dot CSS class.
//   completed  → filled grey disc, check punched out in the surface color
//   in_progress → filled primary disc + the existing pulse animation
//   pending    → hollow grey ring
function TaskStatusDot({ status }) {
  const variant = DOT_CLASS[status] || styles.dotPending;
  return (
    <svg
      className={`${styles.dot} ${variant}${status === 'in_progress' ? ` ${styles.statePulse}` : ''}`}
      viewBox="0 0 16 16" width="1em" height="1em"
      aria-hidden="true" focusable="false"
    >
      <circle className={styles.dotRing} cx="8" cy="8" r="6.25" />
      {status === 'completed' && (
        <path className={styles.dotCheck} d="M5.1 8.4L7.1 10.3L10.9 5.9" />
      )}
    </svg>
  );
}

function TaskRow({ task }) {
  const owner = task.owner || task.teammateName || '';
  const statusKey = task.status === 'in_progress' ? 'ui.tasks.status.inProgress'
    : task.status === 'completed' ? 'ui.tasks.status.completed'
      : 'ui.tasks.status.pending';
  return (
    <div className={styles.row}>
      <span className={styles.glyph}><TaskStatusDot status={task.status} /></span>
      <span className={styles.labelCell}>
        <span className={`${styles.label} ${task.status === 'completed' ? styles.labelDone : ''}`} title={task.description || task.subject || ''}>
          {task.subject || `#${task.taskId}`}
        </span>
        {task.status === 'in_progress' && task.activeForm && task.activeForm !== task.subject && (
          <span className={styles.doing} title={task.activeForm}>{task.activeForm}</span>
        )}
      </span>
      {owner && <span className={styles.owner} title={t('ui.tasks.owner')}>{owner}</span>}
      <span className={styles.statusLabel}>{t(statusKey)}</span>
    </div>
  );
}
