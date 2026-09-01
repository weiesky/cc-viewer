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

function TaskRow({ task }) {
  const glyph = task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '●' : '○';
  const glyphClass = task.status === 'completed'
    ? styles.stateDone
    : task.status === 'in_progress'
      ? `${styles.stateRunning} ${styles.statePulse}`
      : styles.statePending;
  const owner = task.owner || task.teammateName || '';
  const statusKey = task.status === 'in_progress' ? 'ui.tasks.status.inProgress'
    : task.status === 'completed' ? 'ui.tasks.status.completed'
      : 'ui.tasks.status.pending';
  return (
    <div className={styles.row}>
      <span className={`${styles.glyph} ${glyphClass}`} aria-hidden="true">{glyph}</span>
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
