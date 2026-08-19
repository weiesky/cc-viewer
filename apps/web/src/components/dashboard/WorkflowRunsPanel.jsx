import React, { useMemo } from 'react';
import { Popover, Modal, Tooltip } from 'antd';
import { extractWorkflowRuns } from '../../utils/workflowRuns.js';
import { getLatest } from '../../utils/workflowStore.js';
import { stateGlyph, fmtTokens, STATUS_KEYS } from '../../utils/workflowFormat.js';
import WorkflowPanel from '../viewers/WorkflowPanel.jsx';
import { t } from '../../i18n';
import styles from './WorkflowRunsPanel.module.css';

/**
 * UltraCode / Workflow 左侧工具栏专区。镜像 Agent Team 的 TeamButton / TeamModal:
 * - WorkflowButton:navSidebar 图标按钮 → hover 弹 popover 列出本会话所有 workflow run。
 * - WorkflowRunsModal:点击某 run → 大 Modal 内复用 WorkflowPanel 渲染完整过程(阶段/agent/甘特)。
 * 列表数据来自当前会话 requests(extractWorkflowRuns,与对话内联面板同源,历史日志模式同样可用)。
 */

function runKey(run) {
  return run.runId || run.taskId;
}

function shortRunId(run) {
  if (run.runId) return run.runId;
  if (run.taskId) return run.taskId;
  return '';
}

function WorkflowButton({ requests, onOpenRun, navBtnClass }) {
  const runs = useMemo(() => extractWorkflowRuns(requests), [requests]);
  if (runs.length === 0) return null;

  const content = (
    <div className={styles.wfPopover}>
      <div className={styles.wfPopoverTitle}>{t('ui.workflow.runs')} ({runs.length})</div>
      {runs.map((run, i) => {
        const key = runKey(run);
        // 已到达的 live 快照(若有)点亮状态/名称/token;无则用文本解析的 summary 兜底。
        const snap = key ? getLatest(key) : null;
        // 有 live 快照按其状态着字形；无快照=历史(已结束)run，默认完成字形，避免误显「运行中」(●)。
        const glyph = snap?.status ? stateGlyph(snap.status) : '✓';
        const name = snap?.workflowName || run.summary || shortRunId(run);
        const time = run.timestamp
          ? new Date(run.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const statusTitle = snap?.status
          ? (STATUS_KEYS[snap.status] ? t(STATUS_KEYS[snap.status]) : snap.status)
          : '';
        return (
          <div key={key || i} className={styles.wfPopoverItem} onClick={() => onOpenRun(run)}>
            <Tooltip title={statusTitle}>
              <span className={styles.wfPopoverStatus}>{glyph}</span>
            </Tooltip>
            <span className={styles.wfPopoverName} title={name}>{name}</span>
            {snap?.agentCount != null && (
              <span className={styles.wfPopoverMeta}>{snap.agentCount}a</span>
            )}
            {snap?.totalTokens ? (
              <span className={styles.wfPopoverMeta}>{fmtTokens(snap.totalTokens)} {t('ui.workflow.tok')}</span>
            ) : null}
            <span className={styles.wfPopoverTime}>{time}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <Popover
      content={<div className={styles.wfPopoverScroll}>{content}</div>}
      trigger="hover"
      placement="right"
      arrow={{ pointAtCenter: true }}
      autoAdjustOverflow={false}
      align={{ overflow: { adjustX: true, shiftY: true } }}
      overlayInnerStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', padding: 0 }}>
      <button className={navBtnClass || ''} title={t('ui.workflow.runs')} aria-label={t('ui.workflow.runs')}>
        {/* 流程/节点(DAG)图标，明显区别于 Team 的「多人」图标 */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="6" height="6" rx="1.2"/>
          <rect x="15" y="4.5" width="6" height="6" rx="1.2"/>
          <rect x="9" y="15" width="6" height="6" rx="1.2"/>
          <path d="M9 6h6"/>
          <path d="M6 9v3a2 2 0 0 0 2 2h4"/>
          <path d="M18 10.5V13a2 2 0 0 1-2 2h-1"/>
        </svg>
      </button>
    </Popover>
  );
}

function WorkflowRunsModal({ run, onClose }) {
  if (!run) return null;
  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      zIndex={1100}
      width="calc(100vw - 80px)"
      title={<span className={styles.wfModalTitle}>{t('ui.workflow.modalTitle')}</span>}
      destroyOnClose>
      <div className={styles.wfModalBody}>
        <WorkflowPanel workflow={run} resultText={run.resultText} defaultCollapsed={false} collapsible={false} />
      </div>
    </Modal>
  );
}

export { WorkflowButton, WorkflowRunsModal };
