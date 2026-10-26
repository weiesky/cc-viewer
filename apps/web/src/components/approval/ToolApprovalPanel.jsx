import React, { useMemo, useRef, useEffect, useCallback, useState, useLayoutEffect } from 'react';
import { t } from '../../i18n';
import { AUTO_APPROVE_INSTANT } from '../../utils/helpers';
import styles from './ToolApprovalPanel.module.css';

const DEFAULT_AUTO_SECONDS = 3;

function ToolApprovalPanel({ toolName, toolInput, requestId, onAllow, onAllowSession, onDeny, visible, global: isGlobal, autoApproveSeconds = 0, onAutoApproveChange, source, queueDepth = 0, planAutoApproveSeconds = 0, planAutoApproveCountdown = null, onCancelPlanAutoApprove = null }) {
  const panelRef = useRef(null);
  const allowRef = useRef(null);
  const prevFocusRef = useRef(null);
  const focusInitializedRef = useRef(false);
  const previousCountdownRef = useRef(null);
  const planCountdownCancelledRef = useRef(false);
  const [exiting, setExiting] = useState(false);
  const show = visible || exiting;
  const [countdown, setCountdown] = useState(-1); // -1 = 未启动, 0 = 归零, >0 = 倒计时中
  const countdownRef = useRef(null);
  const deniedRef = useRef(false); // 标记是否被拒绝（防止归零时误触发 onAllow）

  const restorePanelFocus = useCallback(() => {
    prevFocusRef.current?.focus?.();
    prevFocusRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!focusInitializedRef.current) {
      focusInitializedRef.current = true;
      if (visible && autoApproveSeconds === 0 && !planAutoApproveSeconds && allowRef.current) {
        prevFocusRef.current = document.activeElement;
        allowRef.current.focus();
      }
    }
  }, [visible, show, autoApproveSeconds, planAutoApproveSeconds]);
  useEffect(() => {
    if (visible) {
      setExiting(false);
      deniedRef.current = false;
    } else if (show) {
      setExiting(true);
      const timer = setTimeout(() => { setExiting(false); }, 200);
      return () => clearTimeout(timer);
    }
  }, [visible]);
  useLayoutEffect(() => () => {
    restorePanelFocus();
    prevFocusRef.current = null;
  }, [restorePanelFocus]);

  // Preserve manual-panel keyboard behavior when the countdown finishes but the
  // plan remains pending (for example after the user cancels auto-approval).
  useEffect(() => {
    if (planAutoApproveCountdown != null) planCountdownCancelledRef.current = false;
    previousCountdownRef.current = planAutoApproveCountdown;
  }, [planAutoApproveCountdown, visible]);

  // 自动审批倒计时
  useEffect(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    if (visible && autoApproveSeconds === AUTO_APPROVE_INSTANT && requestId) {
      // 免审批（兜底路径）：仅用于「面板已挂载后用户切到免审批」——正常的新请求已在 ChatView
      // 源头被 autoAllow 直放、不会走到这里。归零触发立即批准（复用下方 countdown===0 → onAllow
      // 路径，不新增调用点）。
      deniedRef.current = false;
      setCountdown(0);
    } else if (visible && autoApproveSeconds > 0 && requestId) {
      deniedRef.current = false;
      setCountdown(autoApproveSeconds);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCountdown(-1);
    }
    return () => { if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; } };
  }, [visible, autoApproveSeconds, requestId]);

  // 倒计时归零 → 自动批准（仅当从 >0 递减到 0 时触发，排除初始状态和拒绝状态）
  useEffect(() => {
    if (countdown === 0 && !deniedRef.current && visible && requestId) {
      onAllow(requestId);
    }
  }, [countdown, visible, requestId, onAllow]);

  const handleDeny = useCallback((id) => {
    deniedRef.current = true;
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(-1);
    onDeny(id);
  }, [onDeny]);

  // 简化按钮：点击切换开启/关闭
  const handleAutoApproveToggle = useCallback(() => {
    if (onAutoApproveChange) {
      const enabling = autoApproveSeconds === 0;
      onAutoApproveChange(enabling ? DEFAULT_AUTO_SECONDS : 0);
      if (enabling && requestId && onAllow) {
        onAllow(requestId);
      }
    }
  }, [onAutoApproveChange, autoApproveSeconds, requestId, onAllow]);

  const handlePlanAutoApproveCancel = useCallback(() => {
    planCountdownCancelledRef.current = true;
    onCancelPlanAutoApprove?.();
    prevFocusRef.current?.focus?.();
  }, [onCancelPlanAutoApprove]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      // During plan auto-approval, Escape means "keep the plan for manual review",
      // not "reject the plan". A subsequent Escape uses the normal deny behavior.
      if (planAutoApproveCountdown != null && !planCountdownCancelledRef.current && onCancelPlanAutoApprove) {
        e.preventDefault();
        handlePlanAutoApproveCancel();
      } else {
        handleDeny(requestId);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const buttons = panelRef.current?.querySelectorAll('button');
      if (!buttons?.length) return;
      const arr = Array.from(buttons);
      const idx = arr.indexOf(document.activeElement);
      const next = e.shiftKey
        ? (idx <= 0 ? arr.length - 1 : idx - 1)
        : (idx >= arr.length - 1 ? 0 : idx + 1);
      arr[next].focus();
    }
  }, [handleDeny, requestId, planAutoApproveCountdown, onCancelPlanAutoApprove, handlePlanAutoApproveCancel]);

  const displayText = useMemo(() => {
    if (!toolInput) return '';
    switch (toolName) {
      case 'Bash':
        return toolInput.command || toolInput.description || '';
      case 'Edit':
        return toolInput.file_path || toolInput.description || '';
      case 'Write':
        return toolInput.file_path || toolInput.description || '';
      case 'NotebookEdit':
        return toolInput.notebook_path || toolInput.description || '';
      case 'ExitPlanMode': {
        // ExitPlanMode V2: input.plan 是 normalizeToolInput 注入的完整 markdown plan
        // 优先展示 plan 正文（multi-agent-room 等场景下 plan 仅来自 input，避免 default 分支把 27k JSON 截到 500 字）
        const txt = (typeof toolInput.plan === 'string' && toolInput.plan.trim()) ? toolInput.plan : '';
        return txt || (toolInput.planFilePath ? `(plan @ ${toolInput.planFilePath})` : (toolInput.description || ''));
      }
      default:
        if (toolInput.description) return toolInput.description;
        return JSON.stringify(toolInput, null, 2).slice(0, 500);
    }
  }, [toolName, toolInput]);

  const detailText = useMemo(() => {
    if (!toolInput) return null;
    if (toolName === 'Bash' && toolInput.description) return toolInput.description;
    if (toolName === 'Edit' && toolInput.old_string != null) {
      const old = String(toolInput.old_string).slice(0, 80);
      const nw = String(toolInput.new_string).slice(0, 80);
      return `${old}  →  ${nw}`;
    }
    return null;
  }, [toolName, toolInput]);

  if (!show) return null;

  const allowLabel = countdown > 0
    ? t('ui.permission.allowCountdown', { seconds: countdown })
    : t('ui.permission.allow');

  const autoApproveBtnLabel = autoApproveSeconds !== 0
    ? t('ui.permission.autoApprove.disable')
    : t('ui.permission.autoApprove.enable', { seconds: DEFAULT_AUTO_SECONDS });

  return (
    <div ref={panelRef} className={`${isGlobal ? styles.panelGlobal : styles.panel}${exiting ? ` ${styles.exiting}` : ''}`} onKeyDown={handleKeyDown}>
      <svg className={`${styles.borderSvg} ${styles.borderSvgInset}`} preserveAspectRatio="none">
        <rect x="0" y="0" width="100%" height="100%" rx="12" ry="12"
          fill="none" stroke="var(--color-approval-border)" strokeWidth="1" strokeDasharray="6 4"
          className={styles.borderRect} />
      </svg>
      <div className={styles.header}>
        <span className={styles.toolName}>{toolName}</span>
        {source === 'pty' && <span className={styles.subAgentBadge}>{t('ui.subAgentApproval')}</span>}
        {queueDepth > 0 && <span className={styles.subAgentBadge}>{t('ui.permission.queued', { n: queueDepth })}</span>}
        <span className={styles.label}>{t('ui.permission.approvalRequired')}</span>
      </div>
      <div className={styles.body}>
        <pre className={styles.command}>{displayText}</pre>
        {detailText && <div className={styles.detail}>{detailText}</div>}
      </div>
      <div className={styles.actions}>
        {onAutoApproveChange && (
          <button
            className={`${styles.autoApproveBtn}${autoApproveSeconds !== 0 ? ` ${styles.autoApproveActive}` : ''}`}
            onClick={handleAutoApproveToggle}
          >
            {autoApproveBtnLabel}
          </button>
        )}
        <button className={styles.denyBtn} onClick={() => handleDeny(requestId)}>
          {t('ui.permission.deny')}
        </button>
        {onAllowSession && (
          <button className={styles.allowSessionBtn} onClick={() => onAllowSession(requestId)}>
            {t('ui.permission.allowSession')}
          </button>
        )}
        <button ref={allowRef} className={styles.allowBtn} onClick={() => onAllow(requestId)}>
          {allowLabel}
        </button>
      </div>
      {planAutoApproveCountdown != null && (
        <div className={styles.planAutoApproveHint}>
          <span>{t('ui.planAutoApprove.countdown', { count: planAutoApproveCountdown })}</span>
          {onCancelPlanAutoApprove && (
            <button type="button" className={styles.planAutoApproveCancel} onClick={handlePlanAutoApproveCancel}>
              {t('ui.planAutoApprove.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolApprovalPanel;
