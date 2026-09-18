import React, { useState, useEffect } from 'react';
import { Popover, Tooltip } from 'antd';
import { t } from '../../i18n';
import { isMobile, isPad, isIOS } from '../../env';
import { subscribe, getSnapshot } from '../../utils/taskStore';
import styles from './TaskProgressHud.module.css';

// Static overlay style hoisted to module scope (same pattern as
// LiveTagPopover) so renders don't recreate the literal. Passed via
// styles.body — the non-deprecated antd v5 API.
const DETAIL_POPOVER_STYLE = {
  maxWidth: 420,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-hover)',
  borderRadius: 8,
};

// Hover never fires on touch UAs (iPadOS reports a Mac UA, so rc-trigger's
// own hover→click fallback misses it). Mirror the repo convention
// (ChatMessage.jsx): touch phones/pads get a click trigger instead.
const TOUCH_TRIGGER_PROPS = (isMobile && !isPad)
  ? { trigger: 'click', ...(!isIOS && { getPopupContainer: (node) => node.parentElement }) }
  : {};

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
  const currentTask = inProgress || nextPending;
  const current = inProgress
    ? (inProgress.activeForm || inProgress.subject || `#${inProgress.taskId}`)
    : (nextPending.subject || `#${nextPending.taskId}`);
  // The header bubble shows the current task's DETAIL (same as a row's Popover),
  // not the title already visible in the strip. Empty detail → no bubble.
  const currentDetail = currentTask ? (currentTask.description || currentTask.subject || '') : '';

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        {/* role="status" lives on the summary line only — the expanded list stays
            out of the live region so rapid status flips don't spam announcements. */}
        <div className={styles.summary} role="status" aria-label={t('ui.tasks.title')}>
          <span className={styles.doneCount}>
            {`✓ ${t('ui.tasks.progress', { done, total })}`}
          </span>
          {/* Collapsed strip: hovering the current-task text pops the task's
              DETAIL in a Popover (scrollable/selectable, same as a row), to the
              RIGHT of the text so it never covers the expanded list. .current
              shrinks to the text width (flex 0 1 auto, not block) so the anchor
              is the blue text itself and the arrow tracks its end. Empty detail
              → open forced false so no empty bubble shows. */}
          <Popover
            content={<div className={styles.detailContent}>{currentDetail}</div>}
            trigger="hover"
            placement="rightTop"
            styles={{ body: DETAIL_POPOVER_STYLE }}
            open={currentDetail ? undefined : false}
            {...TOUCH_TRIGGER_PROPS}
          >
            <span className={styles.current}>{current}</span>
          </Popover>
          {/* Elastic spacer: pushes the dots + chevron to the right edge so the
              current-task text stays left-aligned while .current itself shrinks
              to the text width (for the Tooltip anchor). Without this, dropping
              .current's flex-grow would collapse the dots/chevron onto the text. */}
          <span className={styles.spacer} aria-hidden="true" />
          {/* Progress dots: one per task, so the collapsed strip alone shows
              how far along we are, which step is running, and how many are
              left. Purely decorative — the role="status" count line above is
              the accessible announcement. */}
          <span className={styles.dots} aria-hidden="true">
            {tasks.map((task) => (
              <TaskStatusDot key={task.taskId} status={task.status} />
            ))}
          </span>
          <Tooltip title={expanded ? t('ui.collapse') : t('ui.expand')}>
            <button
              type="button"
              className={styles.chevron}
              aria-expanded={expanded}
              aria-controls="task-progress-hud-list"
              aria-label={expanded ? t('ui.collapse') : t('ui.expand')}
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? '▾' : '▸'}
            </button>
          </Tooltip>
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
  const detail = task.description || task.subject || '';
  const statusKey = task.status === 'in_progress' ? 'ui.tasks.status.inProgress'
    : task.status === 'completed' ? 'ui.tasks.status.completed'
      : 'ui.tasks.status.pending';
  return (
    <div className={styles.row}>
      <span className={styles.glyph}><TaskStatusDot status={task.status} /></span>
      <span className={styles.labelCell}>
        {/* Long detail lives in an antd Popover (scrollable, selectable) instead
            of a native title tooltip. open forced false when there is no detail
            so an empty bubble never shows. placement="rightTop" puts the bubble to
            the RIGHT of the label with its LEFT arrow pointing at the text, but
            aligned to the row's TOP so it stays clear of the trailing .doing pill
            below (a plain "right" was measured to overlap .doing). */}
        <Popover
          content={<div className={styles.detailContent}>{detail}</div>}
          trigger="hover"
          placement="rightTop"
          styles={{ body: DETAIL_POPOVER_STYLE }}
          open={detail ? undefined : false}
          {...TOUCH_TRIGGER_PROPS}
        >
          <span className={`${styles.label} ${task.status === 'completed' ? styles.labelDone : ''}`}>
            {task.subject || `#${task.taskId}`}
          </span>
        </Popover>
        {task.status === 'in_progress' && task.activeForm && task.activeForm !== task.subject && (
          <Tooltip title={task.activeForm}>
            <span className={styles.doing}>{task.activeForm}</span>
          </Tooltip>
        )}
      </span>
      {owner && (
        <Tooltip title={t('ui.tasks.owner')}>
          <span className={styles.owner}>{owner}</span>
        </Tooltip>
      )}
      <span className={styles.statusLabel}>{t(statusKey)}</span>
    </div>
  );
}
