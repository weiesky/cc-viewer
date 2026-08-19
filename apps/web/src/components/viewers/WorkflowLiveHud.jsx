import React, { useState, useEffect, useMemo } from 'react';
import { t } from '../../i18n';
import { getModelShort, getModelMaxTokens } from '../../utils/helpers';
import { subscribeActive, getActiveWorkflows } from '../../utils/workflowStore';
import { TERMINAL_STATES, STATUS_KEYS, fmtTokens, fmtDuration, stateGlyph } from '../../utils/workflowFormat';
import WorkflowTimeline from './WorkflowTimeline';
import styles from './WorkflowLiveHud.module.css';

function stateClass(state) {
  if (state === 'done' || state === 'completed') return styles.stateDone;
  if (state === 'failed' || state === 'error') return styles.stateFailed;
  if (state === 'queued') return styles.stateQueued;
  return styles.stateRunning;
}

function Row({ agent }) {
  const running = !TERMINAL_STATES.has(agent.state);
  const model = getModelShort(agent.model);
  const is1M = agent.model && getModelMaxTokens(agent.model) >= 1000000;
  const dur = fmtDuration(agent.durationMs);
  const doing = running && agent.lastToolName ? agent.lastToolName : '';
  return (
    <div className={styles.row}>
      <span className={`${styles.dot} ${stateClass(agent.state)} ${running ? styles.statePulse : ''}`}>{stateGlyph(agent.state)}</span>
      <span className={styles.labelCell}>
        <span className={styles.label} title={agent.label}>{agent.label || agent.agentType || agent.agentId}</span>
        {doing && <span className={styles.doing} title={agent.lastToolSummary || doing}>{doing}</span>}
      </span>
      <span className={styles.model} title={model ? `${model}${is1M ? ' · 1M' : ''}` : ''}>{model ? `${model}${is1M ? ' · 1M' : ''}` : ''}</span>
      <span className={styles.tok}>{fmtTokens(agent.tokens)}</span>
      <span className={styles.tool}>{agent.toolCalls}</span>
      <span className={styles.dur}>{dur || ''}</span>
    </div>
  );
}

// 列标题行：与数据行同列宽，整列对齐成表格（镜像 WorkflowPanel 的 AgentHead）
function HudHead({ count }) {
  return (
    <div className={`${styles.row} ${styles.head}`}>
      <span className={styles.dot} />
      <span className={styles.labelCell}>{t('ui.workflow.agents', { count })}</span>
      <span className={styles.model}>{t('ui.workflow.colModel')}</span>
      <span className={styles.tok}>{t('ui.workflow.colTokens')}</span>
      <span className={styles.tool}>{t('ui.workflow.tools')}</span>
      <span className={styles.dur}>{t('ui.workflow.colDur')}</span>
    </div>
  );
}

/**
 * 运行中工作流的实时条，docked 在 ChatView 输入框上方（消息滚动区之外），常驻可见、
 * 不被对话挤走。数据来自 workflowStore 活跃集合（AppBase 的 SSE 持续喂养）。
 * 完成后该 run 退出活跃集合 → 条自动消失；内联聊天卡片继续作历史记录。
 */
export default function WorkflowLiveHud() {
  const [active, setActive] = useState(getActiveWorkflows);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState('list');  // 'list' | 'timeline'
  const [dismissed, setDismissed] = useState({});
  const [, setTick] = useState(0);

  useEffect(() => subscribeActive(setActive), []);

  const visible = useMemo(
    () => active.filter(d => d && d.runId && !dismissed[d.runId]),
    [active, dismissed]
  );
  const data = visible.length ? visible[visible.length - 1] : null;

  // 运行中每秒走一帧，让「已用时」即使无新事件也继续走动
  useEffect(() => {
    if (!data) return undefined;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [data]);

  if (!data) return null;

  const agents = data.agents || [];
  const phases = data.phases || [];
  const total = data.agentCount || agents.length;
  const done = agents.filter(a => TERMINAL_STATES.has(a.state)).length;
  const statusLabel = data.status
    ? (STATUS_KEYS[data.status] ? t(STATUS_KEYS[data.status]) : data.status)
    : '';
  const elapsed = data.startTime ? fmtDuration(Date.now() - data.startTime) : '';

  // 运行中的排前面（倒序最近完成的紧随其后），全部展示、可滚动；折叠用顶部按钮
  const running = agents.filter(a => !TERMINAL_STATES.has(a.state));
  const rows = running.length ? running.concat(agents.filter(a => TERMINAL_STATES.has(a.state)).reverse()) : agents;

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <div className={styles.header} onClick={() => setCollapsed(c => !c)}>
        <span className={`${styles.liveDot} ${styles.statePulse}`} />
        <span className={styles.title} title={data.workflowName}>{data.workflowName || t('ui.workflow.title')}</span>
        <span className={styles.stat}>
          {t('ui.workflow.agentsProgress', { done, total })}
          {` · ${fmtTokens(data.totalTokens)} ${t('ui.workflow.tok')}`}
          {` · ${data.totalToolCalls || 0} ${t('ui.workflow.tools')}`}
          {elapsed ? ` · ${elapsed}` : ''}
          {statusLabel ? ` · ${statusLabel}` : ''}
          {visible.length > 1 ? ` · +${visible.length - 1}` : ''}
        </span>
        <span className={styles.actions}>
          {!collapsed && (
            <span className={styles.viewToggle} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === 'list' ? styles.viewBtnActive : ''}`}
                onClick={() => setView('list')}
              >{t('ui.workflow.viewList')}</button>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === 'timeline' ? styles.viewBtnActive : ''}`}
                onClick={() => setView('timeline')}
              >{t('ui.workflow.viewTimeline')}</button>
            </span>
          )}
          <button type="button" className={styles.iconBtn} onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c); }} title={collapsed ? t('ui.expand') : t('ui.collapse')}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button type="button" className={styles.iconBtn} onClick={(e) => { e.stopPropagation(); setDismissed(d => ({ ...d, [data.runId]: true })); }} title={t('ui.workflow.hudClose')}>
            ✕
          </button>
        </span>
      </div>
      {!collapsed && phases.length > 0 && (
        <div className={styles.phases}>
          <span className={styles.phasesLabel}>{t('ui.workflow.phases')}</span>
          {phases.map(p => (
            <span key={p.index} className={styles.phaseChip} title={p.detail || p.title || ''}>
              <span className={styles.phaseChipIdx}>{p.index}</span>
              <span className={styles.phaseChipTitle}>{p.title}</span>
            </span>
          ))}
        </div>
      )}
      {!collapsed && view === 'timeline' && (
        <div className={styles.rows}>
          <WorkflowTimeline data={data} now={Date.now()} compact />
        </div>
      )}
      {!collapsed && view === 'list' && (
        <div className={styles.rows}>
          <HudHead count={total} />
          {rows.map((a, i) => <Row key={a.agentId || i} agent={a} />)}
        </div>
      )}
    </div>
  );
}
