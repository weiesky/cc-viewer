import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { Empty, Popover, Modal, Tooltip } from 'antd';
import ChatMessage from './ChatMessage';
import { getModelInfo } from '../utils/helpers';
import { getTeammateAvatar } from '../utils/teammateAvatars';
import { renderMarkdown } from '../utils/markdown';
import defaultModelAvatarUrl from '../img/default-model-avatar.svg';
import { extractTeamSessions } from '../utils/teamSessionParser';
import { buildTeamModalData } from '../utils/teamModalBuilder';
import { t } from '../i18n';
import styles from './TeamSessionPanel.module.css';

/* ── helper: nav button styles (shared from parent) ── */
function TeamButton({ requests, onOpenSession, navBtnClass }) {
  const sessionsRef = useRef({ requests: null, result: [] });
  if (sessionsRef.current.requests !== requests) {
    sessionsRef.current = { requests, result: extractTeamSessions(requests) };
  }
  const teamSessions = sessionsRef.current.result;
  if (teamSessions.length === 0) return null;

  const content = (
    <div className={styles.teamPopover}>
      <div className={styles.teamPopoverTitle}>{t('ui.teamSessions')} ({teamSessions.length})</div>
      {teamSessions.map((team, i) => {
        const time = team.startTime ? new Date(team.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const status = team.endTime ? (team._inferredEnd ? '⏱' : '✓') : '●';
        const statusColor = team.endTime ? (team._inferredEnd ? 'var(--text-tertiary)' : 'var(--color-success)') : 'var(--color-warning-light)';
        return (
          <div key={i} className={styles.teamPopoverItem} onClick={() => onOpenSession(team)}>
            <span className={styles.teamPopoverStatus} style={{ color: statusColor }}>{status}</span>
            <span className={styles.teamPopoverName}>{team.name}</span>
            <span className={styles.teamPopoverMeta}>{team.teammateCount}p · {team.taskCount}t</span>
            <span className={styles.teamPopoverTime}>{time}</span>
          </div>
        );
      })}
    </div>
  );
  const hasActiveTeam = teamSessions.some(s => !s.endTime || s._inferredEnd);
  return (
    <Popover content={content} trigger="hover" placement="rightTop" overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', padding: 0 }}>
      <button className={`${navBtnClass || ''} ${styles.teamBtnRelative}`} title={t('ui.teamSessions')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        {hasActiveTeam && <span className={styles.teamActiveSpinner} />}
      </button>
    </Popover>
  );
}

/* ── Gantt chart sub-component ── */
function TeamGantt({ teamAgents, teamTotalStart, teamTotalEnd, leadSegments, ganttWrapRef, ganttIndicatorRef, ganttHeight, onGanttHeightChange }) {
  const [ganttOpen, setGanttOpen] = useState(true);
  if (!teamAgents || teamAgents.length === 0) return null;

  const totalMs = teamTotalEnd - teamTotalStart || 1;
  const pct = (ms) => ((ms - teamTotalStart) / totalMs * 100).toFixed(2);
  const widthPct = (start, end) => (((end - start) / totalMs) * 100).toFixed(2);

  const ticks = [];
  for (let i = 0; i <= 4; i++) {
    const ms = teamTotalStart + (totalMs * i / 4);
    const d = new Date(ms);
    ticks.push({ pct: (i * 25), label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  }

  return (
    <div>
      <div className={styles.teamGanttToggle} onClick={() => setGanttOpen(prev => !prev)}>
        {ganttOpen ? '▼' : '▶'} Timeline
        {ganttOpen && (
          <span
            className={styles.ganttExportBtn}
            title={t('ui.exportTimelinePng') || 'Export as PNG'}
            onClick={(e) => {
              e.stopPropagation();
              const wrap = ganttWrapRef.current;
              if (!wrap) return;
              const prevMaxH = wrap.style.maxHeight;
              const prevH = wrap.style.height;
              const prevOverflow = wrap.style.overflow;
              wrap.style.maxHeight = 'none';
              wrap.style.height = 'auto';
              wrap.style.overflow = 'visible';
              import('html2canvas').then(({ default: html2canvas }) => {
                html2canvas(wrap, { backgroundColor: '#0a0a0a', scale: 2, useCORS: true }).then(canvas => {
                  wrap.style.maxHeight = prevMaxH;
                  wrap.style.height = prevH;
                  wrap.style.overflow = prevOverflow;
                  const link = document.createElement('a');
                  link.download = `team-timeline-${Date.now()}.png`;
                  link.href = canvas.toDataURL('image/png');
                  link.click();
                }).catch(() => {
                  wrap.style.maxHeight = prevMaxH;
                  wrap.style.height = prevH;
                  wrap.style.overflow = prevOverflow;
                });
              }).catch(() => {
                wrap.style.maxHeight = prevMaxH;
                wrap.style.height = prevH;
                wrap.style.overflow = prevOverflow;
              });
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </span>
        )}
      </div>
      {ganttOpen && (<>
        <div ref={ganttWrapRef} className={styles.teamGanttWrap} style={ganttHeight ? { maxHeight: 'none', height: ganttHeight } : undefined}>
          {/* team-lead row */}
          <div className={styles.teamGanttRow}>
            <div className={`${styles.teamGanttLabel} ${styles.ganttLabelLead}`}>team-lead</div>
            <div className={styles.teamGanttTrack}>
              {leadSegments && leadSegments.map((seg, i) => {
                const bgColor = seg.label === 'thinking' ? 'var(--color-code-purple)' : seg.label === 'report-received' ? 'var(--color-success)' : 'var(--color-primary)';
                const op = seg.label === 'idle' ? 0.25 : seg.label === 'text' ? 0.5 : seg.label === 'thinking' ? 0.4 : seg.label === 'report-received' ? 0.6 : 0.7;
                return <div key={`b${i}`} className={styles.teamGanttBar} title={seg.label} style={{
                  left: pct(seg.start) + '%', width: widthPct(seg.start, seg.end) + '%',
                  background: bgColor, opacity: op,
                }} />;
              })}
              {leadSegments && leadSegments.filter(s => s.label !== 'idle').map((seg, i) => {
                const tips = { create: 'Team Created', tasks: 'Tasks Created', spawn: 'Agents Spawned', msg: 'SendMessage', cleanup: 'Team Cleanup', text: 'Status Update', thinking: 'Thinking...', 'report-received': 'Report Received' };
                const dColor = seg.label === 'thinking' ? 'var(--color-code-purple)' : seg.label === 'report-received' ? 'var(--color-success)' : 'var(--color-primary)';
                return <Tooltip key={`d${i}`} title={tips[seg.label] || seg.label}><span className={styles.teamGanttDiamond} style={{ left: pct(seg.start) + '%', color: dColor }}>◆</span></Tooltip>;
              })}
            </div>
          </div>
          {/* agent rows */}
          {teamAgents.map((ag, i) => (
            <div key={i} className={styles.teamGanttRow}>
              <div className={`${styles.teamGanttLabel} ${styles.ganttLabelAgent}`}>{ag.name}</div>
              <div className={styles.teamGanttTrack}>
                {ag.segments.map((seg, si) => {
                  const isTool = seg.label.startsWith('tool:');
                  const op = seg.label === 'spawn' ? 0.2 : seg.label === 'claim' ? 0.7 : seg.label === 'done' ? 0.4 : seg.label === 'shutdown' ? 0.1 : seg.label === 'report' ? 0.9 : isTool ? 0.5 : 0.5;
                  return <div key={`b${si}`} className={styles.teamGanttBar} title={seg.label} style={{
                    left: pct(seg.start) + '%',
                    width: widthPct(seg.start, seg.end) + '%',
                    background: 'var(--text-tertiary)', opacity: op,
                  }} />;
                })}
                {ag.events.filter(ev => !ev.label.startsWith('tool:')).map((ev, ei) => {
                  const tips = { spawn: 'Agent Spawned', claim: 'Task Claimed', done: 'Task Completed', shutdown: 'Shutdown Request', 'msg-in': 'Message Received', report: 'Report Submitted' };
                  const tip = tips[ev.label] || ev.label;
                  return <Tooltip key={`d${ei}`} title={`${ag.name}: ${tip}`}><span className={`${styles.teamGanttDiamond} ${styles.ganttLabelAgent}`} style={{ left: pct(ev.ts) + '%' }}>◆</span></Tooltip>;
                })}
              </div>
            </div>
          ))}
          {/* time axis */}
          <div className={`${styles.teamGanttRow} ${styles.ganttTimeAxisRow}`}>
            <div className={styles.teamGanttLabel} />
            <div className={`${styles.teamGanttTrack} ${styles.ganttTimeAxisTrack}`}>
              {ticks.map((tk, i) => (
                <span key={i} className={styles.ganttTickLabel} style={{ left: tk.pct + '%' }}>{tk.label}</span>
              ))}
            </div>
          </div>
          {/* TaskUpdate arrows */}
          {(() => {
            const rowH = 25;
            const leadY = rowH / 2;
            const arrows = [];
            teamAgents.forEach((ag, ai) => {
              const agentY = (ai + 1) * rowH + rowH / 2;
              if (ag.doneTime) {
                const doneMs = new Date(ag.doneTime).getTime();
                arrows.push({ key: `${ai}-done`, xPct: pct(doneMs), fromY: agentY, toY: leadY, color: 'var(--color-warning-light)' });
              }
              ag.events.filter(ev => ev.label === 'report').forEach((ev, ei) => {
                arrows.push({ key: `${ai}-rpt-${ei}`, xPct: pct(ev.ts), fromY: agentY, toY: leadY, color: 'var(--color-success)' });
              });
            });
            if (arrows.length === 0) return null;
            const totalH = (teamAgents.length + 2) * rowH;
            return (
              <svg className={styles.teamGanttArrows} style={{ height: totalH }}>
                <defs>
                  <marker id="gantt-arrow-yellow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,1 L7,4 L0,7 Z" fill="var(--color-warning-light)" />
                  </marker>
                  <marker id="gantt-arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,1 L7,4 L0,7 Z" fill="var(--color-success)" />
                  </marker>
                </defs>
                {arrows.map(a => (
                  <line key={a.key}
                    x1={a.xPct + '%'} y1={a.fromY}
                    x2={a.xPct + '%'} y2={a.toY + 5}
                    stroke={a.color} strokeWidth="1.5" strokeDasharray="4,3" opacity="0.7"
                    markerEnd={a.color === 'var(--color-success)' ? 'url(#gantt-arrow-green)' : 'url(#gantt-arrow-yellow)'}
                  />
                ))}
              </svg>
            );
          })()}
          {/* scroll position indicator */}
          <div ref={ganttIndicatorRef} className={`${styles.teamGanttIndicator} ${styles.ganttIndicatorInitial}`} />
        </div>
        <div
          className={styles.teamGanttResizer}
          onMouseDown={(e) => {
            e.preventDefault();
            const wrap = ganttWrapRef.current;
            if (!wrap) return;
            const startY = e.clientY;
            const startH = wrap.getBoundingClientRect().height;
            const onMove = (ev) => {
              const h = Math.max(60, startH + ev.clientY - startY);
              onGanttHeightChange(h);
            };
            const onUp = () => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          }}
        />
      </>)}
    </div>
  );
}

/* ── Main modal component ── */
function TeamModal({ session, requests, mainAgentSessions, collapseToolResults, expandThinking, userProfile, onViewRequest, onClose }) {
  const modalBodyRef = useRef(null);
  const ganttIndicatorRef = useRef(null);
  const ganttWrapRef = useRef(null);
  const ganttTrackElRef = useRef(null);
  const scrollRafRef = useRef(null);
  const [activeAgentCard, setActiveAgentCard] = useState(null);
  const [ganttHeight, setGanttHeight] = useState(null);

  useEffect(() => {
    return () => { if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current); };
  }, []);

  // memoize modal data
  const dataCacheRef = useRef({ team: null, requests: null, mainAgentSessions: null, result: null });
  const modalData = useMemo(() => {
    if (!session) return null;
    const c = dataCacheRef.current;
    if (c.team === session && c.requests === requests && c.mainAgentSessions === mainAgentSessions) return c.result;
    const result = buildTeamModalData(session, requests, mainAgentSessions);
    dataCacheRef.current = { team: session, requests, mainAgentSessions, result };
    return result;
  }, [session, requests, mainAgentSessions]);

  const teamTotalStart = modalData ? modalData.teamTotalStart : 0;
  const teamTotalEnd = modalData ? modalData.teamTotalEnd : 0;

  const onScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = modalBodyRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      let closestTs = null;
      for (const child of container.children) {
        const ts = child.getAttribute('data-timestamp');
        if (!ts) continue;
        const rect = child.getBoundingClientRect();
        if (rect.bottom > containerTop) { closestTs = ts; break; }
      }
      if (!closestTs) return;
      const tsMs = new Date(closestTs).getTime();
      const total = teamTotalEnd - teamTotalStart || 1;
      const pctVal = Math.max(0, Math.min(100, (tsMs - teamTotalStart) / total * 100));
      const el = ganttIndicatorRef.current;
      if (!el) return;
      if (!ganttTrackElRef.current || !ganttTrackElRef.current.isConnected) {
        ganttTrackElRef.current = el.parentElement?.querySelector('[class*="teamGanttTrack"]');
      }
      const wrap = el.parentElement;
      const track = ganttTrackElRef.current;
      if (track) {
        const wrapRect = wrap.getBoundingClientRect();
        const trackRect = track.getBoundingClientRect();
        const trackLeft = trackRect.left - wrapRect.left;
        const trackWidth = trackRect.width;
        el.style.left = (trackLeft + trackWidth * pctVal / 100) + 'px';
        el.style.height = wrap.scrollHeight + 'px';
      }
    });
  }, [teamTotalStart, teamTotalEnd]);

  if (!session) return null;

  const { entries, teamAgents, leadSegments, modelInfo } = modalData;

  return (
    <Modal
      open
      onCancel={() => { ganttTrackElRef.current = null; onClose(); }}
      footer={null}
      closable
      maskClosable
      zIndex={1100}
      width="calc(100vw - 80px)"
      title={<span className={styles.teamModalTitle}>Team: {session.name}</span>}
      styles={{
        header: { background: 'var(--bg-container)', borderBottom: '1px solid var(--border-primary)', padding: '12px 20px' },
        body: { background: 'var(--bg-base)', height: 'calc(100vh - 160px)', overflow: 'hidden', padding: 0 },
        mask: { background: 'rgba(0,0,0,0.7)' },
        content: { background: 'var(--bg-container)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 0 },
      }}
      centered
    >
      <div className={styles.teamModalLayout}>
        {/* Left: Agent Cards */}
        <div className={styles.teamAgentCards}>
          <div className={`${styles.teamAgentCard} ${styles.teamLeadCard}`}>
            <div className={styles.teamAgentCardHeader}>
              {modelInfo?.svg
                ? <div className={styles.teamAgentAvatar} style={{ background: modelInfo.color || 'var(--bg-model-avatar)' }} dangerouslySetInnerHTML={{ __html: modelInfo.svg }} />
                : <img src={defaultModelAvatarUrl} className={styles.teamAgentAvatar} alt="lead" />
              }
              <div className={styles.teamAgentName}>team-lead</div>
            </div>
            <div className={styles.teamAgentType}>orchestrator</div>
            <div className={styles.teamAgentStatus} style={{ color: session.endTime ? (session._inferredEnd ? 'var(--text-tertiary)' : 'var(--color-success)') : 'var(--color-warning-light)' }}>
              {session.endTime ? (session._inferredEnd ? '⏱ ended' : '✓ done') : '● active'}
            </div>
          </div>
          {teamAgents.map((ag, i) => {
            const isDone = !!ag.doneTime;
            const durSec = Math.round(ag.duration / 1000);
            const durStr = durSec >= 60 ? `${Math.floor(durSec/60)}m${durSec%60}s` : `${durSec}s`;
            const agentMessages = entries.filter(e => e.type === 'sub-agent' && e.label && e.label.includes(ag.name));
            const popContent = (
              <div className={styles.teamAgentPopover}>
                {ag.teammateMessages && ag.teammateMessages.length > 0 && (
                  <div className={styles.teamAgentPopTeammateMsg}>
                    {ag.teammateMessages.map((tm, ti) => (
                      <div key={ti}>
                        {tm.summary && <div className={styles.teamAgentPopTmSummary}>{tm.summary}</div>}
                        <div className={`${styles.teamAgentPopTmContent} chat-md`} dangerouslySetInnerHTML={{ __html: renderMarkdown(tm.content.length > 3000 ? tm.content.slice(0, 3000) + '\n\n...' : tm.content) }} />
                      </div>
                    ))}
                  </div>
                )}
                {ag.taskSubject && <div className={styles.teamAgentPopTask}>{ag.taskSubject}</div>}
                {agentMessages.length > 0 ? agentMessages.map((msg, mi) => {
                  const texts = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
                  if (!texts.trim()) return null;
                  return <div key={mi} className={`${styles.teamAgentPopMsg} chat-md`} dangerouslySetInnerHTML={{ __html: renderMarkdown(texts.length > 2000 ? texts.slice(0, 2000) + '\n\n...' : texts) }} />;
                }) : <div className={styles.agentNoMessages}>No messages</div>}
              </div>
            );
            return (
              <Popover key={i} content={popContent} trigger="click" placement="right" autoAdjustOverflow
                overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', padding: 0, maxWidth: 800, maxHeight: '70vh', overflowY: 'auto' }}
                onOpenChange={(open) => setActiveAgentCard(open ? i : null)}
              >
                <div className={`${styles.teamAgentCard} ${styles.teamAgentCardClickable} ${activeAgentCard === i ? styles.teamAgentCardActive : ''}`}>
                  <div className={styles.teamAgentCardHeader}>
                    {(() => { const _a = getTeammateAvatar(ag.name); return <div className={styles.teamAgentAvatar} style={{ background: _a.color }} dangerouslySetInnerHTML={{ __html: _a.svg }} />; })()}
                    <div className={styles.teamAgentName}>{ag.name}</div>
                  </div>
                  <div className={styles.teamAgentType}>{ag.type}</div>
                  <div className={styles.teamAgentStatus} style={{ color: isDone ? 'var(--color-success)' : 'var(--color-warning-light)' }}>
                    {isDone ? '✓ done' : '● working'} <span className={styles.agentStatusDurSuffix}>· {durStr}</span>
                  </div>
                </div>
              </Popover>
            );
          })}
        </div>
        {/* Right: Content */}
        <div className={styles.teamModalContent}>
          <TeamGantt
            teamAgents={teamAgents}
            teamTotalStart={teamTotalStart}
            teamTotalEnd={teamTotalEnd}
            leadSegments={leadSegments}
            ganttWrapRef={ganttWrapRef}
            ganttIndicatorRef={ganttIndicatorRef}
            ganttHeight={ganttHeight}
            onGanttHeightChange={setGanttHeight}
          />
          <div className={styles.teamModalBody} ref={modalBodyRef} onScroll={onScroll}>
            {entries.map((entry, i) => (
              <div key={`tw-${i}`} data-timestamp={entry.timestamp}>
                {entry.type === 'user' && <ChatMessage role="user" text={entry.text} timestamp={entry.timestamp} userProfile={userProfile} modelInfo={modelInfo} requestIndex={entry.requestIndex} onViewRequest={onViewRequest} />}
                {entry.type === 'assistant' && <ChatMessage role="assistant" content={entry.content} timestamp={entry.timestamp} modelInfo={entry.modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} askAnswerMap={{}} requestIndex={entry.requestIndex} onViewRequest={onViewRequest} />}
                {entry.type === 'sub-agent' && <ChatMessage role="sub-agent-chat" content={entry.content} toolResultMap={entry.toolResultMap} label={entry.label} isTeammate={entry.isTeammate} timestamp={entry.timestamp} collapseToolResults={collapseToolResults} expandThinking={expandThinking} requestIndex={entry.requestIndex} onViewRequest={onViewRequest} />}
                {entry.type === 'context' && <ChatMessage role="assistant" content={[{ type: 'text', text: entry.text }]} timestamp={entry.timestamp} modelInfo={modelInfo} collapseToolResults={collapseToolResults} expandThinking={expandThinking} toolResultMap={{}} askAnswerMap={{}} />}
                {entry.type === 'teammate-report' && (
                  <div className={styles.teammateReportEntry}>
                    <div className={styles.teammateReportHeader}>
                      {(() => { const _a = getTeammateAvatar(entry.agentName); return <div className={styles.teamAgentAvatar} style={{ background: _a.color }} dangerouslySetInnerHTML={{ __html: _a.svg }} />; })()}
                      <span className={styles.teammateReportName}>{entry.agentName}</span>
                      <span className={styles.teammateReportSummary}>{entry.summary}</span>
                    </div>
                    <div className={`${styles.teammateReportBody} chat-md`} dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.content) }} />
                  </div>
                )}
              </div>
            ))}
            {entries.length === 0 && <Empty description="No entries" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { TeamButton, TeamModal };
