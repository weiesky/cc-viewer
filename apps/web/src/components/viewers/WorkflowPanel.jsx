import React, { useState, useEffect, useMemo } from 'react';
import { Segmented } from 'antd';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { getModelShort, getModelMaxTokens } from '../../utils/helpers';
import { subscribe, getLatest } from '../../utils/workflowStore';
import { TERMINAL_STATES, STATUS_KEYS, fmtDuration, fmtTokens, stateGlyph } from '../../utils/workflowFormat';
import WorkflowTimeline from './WorkflowTimeline';
import styles from './WorkflowPanel.module.css';

function stateClass(state) {
  if (state === 'done' || state === 'completed') return styles.stateDone;
  if (state === 'failed' || state === 'error') return styles.stateFailed;
  if (state === 'queued') return styles.stateQueued;
  return styles.stateRunning;
}

function AgentRow({ agent }) {
  const model = getModelShort(agent.model);
  const is1M = agent.model && getModelMaxTokens(agent.model) >= 1000000;
  const running = !TERMINAL_STATES.has(agent.state);
  const dur = fmtDuration(agent.durationMs);
  // 运行中显示「在干嘛」：最近一次工具名（hover 看摘要）
  const doing = running && agent.lastToolName ? agent.lastToolName : '';
  return (
    <div className={styles.agentRow}>
      <span className={`${styles.stateDot} ${stateClass(agent.state)} ${running ? styles.statePulse : ''}`} title={agent.state}>
        {stateGlyph(agent.state)}
      </span>
      <span className={styles.labelCell}>
        <span className={styles.agentLabel} title={agent.label}>{agent.label || agent.agentType || agent.agentId}</span>
        {doing && <span className={styles.agentDoing} title={agent.lastToolSummary || doing}>{doing}</span>}
      </span>
      <span className={styles.agentModel} title={model ? `${model}${is1M ? ' · 1M' : ''}` : ''}>
        {model ? `${model}${is1M ? ' · 1M' : ''}` : ''}
      </span>
      <span className={styles.metaTok}>{fmtTokens(agent.tokens)}</span>
      <span className={styles.metaTool}>{agent.toolCalls}</span>
      <span className={styles.metaDur}>{dur || ''}</span>
    </div>
  );
}

function AgentHead({ title }) {
  return (
    <div className={`${styles.agentRow} ${styles.agentHead}`}>
      <span className={styles.stateDot} />
      <span className={styles.labelCell}>{title}</span>
      <span className={styles.agentModel}>{t('ui.workflow.colModel')}</span>
      <span className={styles.metaTok}>{t('ui.workflow.colTokens')}</span>
      <span className={styles.metaTool}>{t('ui.workflow.tools')}</span>
      <span className={styles.metaDur}>{t('ui.workflow.colDur')}</span>
    </div>
  );
}

function WorkflowBody({ data, view, now }) {
  if (view === 'timeline') return <WorkflowTimeline data={data} now={now} />;
  return <WorkflowList data={data} />;
}

function WorkflowList({ data }) {
  const activePhaseIndex = useMemo(() => {
    const running = (data.agents || []).filter(a => !TERMINAL_STATES.has(a.state) && typeof a.phaseIndex === 'number');
    if (running.length) return Math.max(...running.map(a => a.phaseIndex));
    return null;
  }, [data]);

  const phases = data.phases || [];
  const agents = data.agents || [];

  // 运行中（live）有 phases 但 agent 的 phaseIndex 恒 null（无权威 agent→phase 映射）→ 不分组，
  // 走扁平 agent 列表（phases 列仍显示）；完成态权威快照 agent 带 numeric phaseIndex → 分组。
  const grouped = phases.length > 0 && agents.some(a => typeof a.phaseIndex === 'number');

  // 按 phaseIndex 分组；无 phase 的 agent 归到 0 组（少见）。
  const byPhase = useMemo(() => {
    const m = new Map();
    for (const a of agents) {
      const k = typeof a.phaseIndex === 'number' ? a.phaseIndex : 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    return m;
  }, [agents]);

  // 分组态下 phaseIndex 不落在任一 phase 的剩余 agent（含归到 0 组者）——尾部无标题兜底渲染，
  // 避免 phases.map 只遍历 1..N 时把它们丢弃。
  const orphanAgents = useMemo(() => {
    if (!grouped) return [];
    const known = new Set(phases.map(p => p.index));
    return agents.filter(a => !(typeof a.phaseIndex === 'number' && known.has(a.phaseIndex)));
  }, [grouped, phases, agents]);

  return (
    <div className={styles.body}>
      {phases.length > 0 && (
        <div className={styles.phasesCol}>
          <div className={styles.colTitle}>{t('ui.workflow.phases')}</div>
          {phases.map(p => (
            <div
              key={p.index}
              className={`${styles.phaseItem} ${p.index === activePhaseIndex ? styles.phaseActive : ''}`}
              title={p.detail}
            >
              <span className={styles.phaseIdx}>{p.index}</span>
              <span className={styles.phaseTitle}>{p.title}</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.agentsCol}>
        <AgentHead title={t('ui.workflow.agents', { count: agents.length })} />
        {grouped
          ? (<>
              {phases.map(p => {
                const list = byPhase.get(p.index) || [];
                if (!list.length) return null;
                const groupTitle = p.detail ? `${p.title}: ${p.detail}` : p.title;
                return (
                  <div key={p.index} className={styles.phaseGroup}>
                    <div className={styles.phaseGroupTitle} title={groupTitle}>{groupTitle}</div>
                    {list.map((a, i) => <AgentRow key={a.agentId || i} agent={a} />)}
                  </div>
                );
              })}
              {orphanAgents.map((a, i) => <AgentRow key={a.agentId || `orphan-${i}`} agent={a} />)}
            </>)
          : agents.map((a, i) => <AgentRow key={a.agentId || i} agent={a} />)}
      </div>
    </div>
  );
}

export default function WorkflowPanel({ workflow, resultText, defaultCollapsed, collapsible = true }) {
  const runId = workflow?.runId || null;
  const taskId = workflow?.taskId || null;
  const session = workflow?.sessionId || null;
  const project = workflow?.project || null;
  const key = runId || taskId;

  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  const [data, setData] = useState(() => getLatest(key));
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list');  // 'list' | 'timeline'
  const [now, setNow] = useState(() => Date.now());

  // 时间轴模式下、运行中时每秒走一帧，让进行中横条延伸
  useEffect(() => {
    if (view !== 'timeline' || !data?.live) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view, data?.live]);

  // REST 首拉
  useEffect(() => {
    if (!session || (!runId && !taskId)) return;
    let alive = true;
    setLoading(true);
    setError(false);
    const params = new URLSearchParams();
    params.set('session', session);
    if (runId) params.set('runId', runId);
    else if (taskId) params.set('taskId', taskId);
    if (project) params.set('project', project);
    fetch(apiUrl(`/api/workflow-journal?${params.toString()}`))
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j && j.ok && j.data) {
          // 若 SSE 已先送达权威完成快照（live!==true），别用可能滞后的 REST（含运行中）覆盖回退。
          // 用 `prev.live !== true` 判权威，不依赖完成快照是否显式带 live:false。
          setData(prev => (prev && prev.live !== true && j.data.live) ? prev : j.data);
        } else setError(true);
      })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [session, runId, taskId, project]);

  // SSE 实时跟随
  useEffect(() => {
    if (!key) return undefined;
    return subscribe(key, (next) => setData(next));
  }, [key]);

  // 没拿到结构化 id（旧条目）→ 回退纯文本，保持原行为
  if (!session || (!runId && !taskId)) {
    return <pre className={styles.fallback}>{resultText}</pre>;
  }

  const title = data?.workflowName || t('ui.workflow.title');
  const statusLabel = data?.status ? (STATUS_KEYS[data.status] ? t(STATUS_KEYS[data.status]) : data.status) : '';

  return (
    <div className={styles.panel}>
      <div
        className={styles.header}
        onClick={collapsible ? () => setCollapsed(c => !c) : undefined}
        style={collapsible ? undefined : { cursor: 'default' }}
      >
        <div className={styles.headerMain}>
          <span className={styles.wfName}>{title}</span>
          {data?.summary && <span className={styles.wfSummary}>{data.summary}</span>}
        </div>
        <div className={styles.headerMeta}>
          {data?.live && <span className={`${styles.liveDot} ${styles.statePulse}`} title={statusLabel} />}
          {data && (
            <span className={styles.headerStat}>
              {t('ui.workflow.agentsShort', { count: data.agentCount || 0 })}
              {data.totalTokens ? ` · ${fmtTokens(data.totalTokens)} ${t('ui.workflow.tok')}` : ''}
              {statusLabel ? ` · ${statusLabel}` : ''}
            </span>
          )}
          {data && !collapsed && (
            <span className={styles.viewToggle} onClick={(e) => e.stopPropagation()}>
              <Segmented
                size="small"
                value={view}
                onChange={(val) => { if (val === 'timeline') setNow(Date.now()); setView(val); }}
                options={[
                  { label: t('ui.workflow.viewList'), value: 'list' },
                  { label: t('ui.workflow.viewTimeline'), value: 'timeline' },
                ]}
              />
            </span>
          )}
          {collapsible && (
            <span className={styles.toggle}>{collapsed ? t('ui.expand') : t('ui.collapse')}</span>
          )}
        </div>
      </div>
      {!collapsed && (
        <>
          {error && !data && <div className={styles.notice}>{t('ui.workflow.loadFailed')}</div>}
          {loading && !data && <div className={styles.notice}>{t('ui.workflow.loading')}</div>}
          {data && <WorkflowBody data={data} view={view} now={now} />}
        </>
      )}
    </div>
  );
}
