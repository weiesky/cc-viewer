import React from 'react';
import { t } from '../../i18n';
import MarkdownBlock from '../viewers/MarkdownBlock';
import styles from './ChatMessage.module.css';

/**
 * Fallback ExitPlanMode approval form for the global ApprovalModal.
 *
 * The plan modal body is normally filled by the transcript planModeBox portaling into the
 * modal's ptyPlan slot (see ChatMessage._renderTool_ExitPlanMode + ApprovalPortalContext).
 * When no card portals in — a fresh sdk-plan-pending frame arriving before transcript ingest,
 * a replayed plan whose tool_use block scrolled out of the render window, or an SDK frame
 * whose id never matches a transcript block (synthetic toolUseID fallback) — the modal would
 * otherwise show an empty body with no approve/reject surface (the exact hole askFallback.js
 * covers for the ask kind). This form renders the same Approve / Approve-with-edits / Reject
 * interaction directly from the authoritative pending-plan payload.
 *
 * Props mirror the ChatMessage plan-card callbacks so both surfaces resolve identically:
 *   - input: the ExitPlanMode tool input ({ plan?, planFilePath?, allowedPrompts? }).
 *   - onApprove() / onReject() / onFeedbackSubmit(text): resolution handlers.
 *   - planAutoApproveCountdown / onCancelPlanAutoApprove: optional countdown strip.
 */
export default class PlanApprovalForm extends React.Component {
  constructor(props) {
    super(props);
    this.state = { feedbackInput: false, feedbackText: '', submitting: false };
  }

  _approve = () => {
    if (this.state.submitting) return;
    this.setState({ submitting: true });
    this.props.onApprove?.();
  };

  _reject = () => {
    if (this.state.submitting) return;
    this.setState({ submitting: true });
    this.props.onReject?.();
  };

  _submitFeedback = () => {
    const text = this.state.feedbackText.trim();
    if (!text || this.state.submitting) return;
    this.setState({ submitting: true });
    this.props.onFeedbackSubmit?.(text);
  };

  render() {
    const { input, planAutoApproveCountdown, onCancelPlanAutoApprove } = this.props;
    const planText = (typeof input?.plan === 'string' && input.plan.trim()) ? input.plan
      : (input?.planFilePath ? `(plan @ ${input.planFilePath})` : '');
    const allowedPrompts = Array.isArray(input?.allowedPrompts) ? input.allowedPrompts : [];
    const { feedbackInput, feedbackText, submitting } = this.state;

    return (
      <div className={`${styles.planModeBox} ${styles.planStatusPending}`}>
        <div className={styles.planModeHeader}>
          <span className={styles.planModeLabel}>{t('ui.exitPlanMode')}</span>
        </div>
        {planText ? (
          <div className={styles.planContentPreview}>
            <MarkdownBlock text={planText} />
          </div>
        ) : null}
        {allowedPrompts.length > 0 && (
          <div className={styles.planModePermissions}>
            <div className={styles.planModePermLabel}>{t('ui.allowedPrompts')}</div>
            {allowedPrompts.map((p, pi) => (
              <div key={pi} className={styles.askOptionItem}>• {p.prompt || p.tool}</div>
            ))}
          </div>
        )}
        {!feedbackInput && (
          <div className={styles.planApprovalActions}>
            {submitting ? (
              <button className={styles.planOptionBtn} disabled>{t('ui.askSubmitting')}</button>
            ) : (
              <>
                <button className={styles.planApproveBtn} onClick={this._approve}>{t('ui.planApprove')}</button>
                <button
                  className={styles.planOptionBtn}
                  onClick={() => this.setState({ feedbackInput: true, feedbackText: '' })}
                >
                  {t('ui.planApproveWithEdits')}
                </button>
                <button className={styles.planRejectBtn} onClick={this._reject}>{t('ui.planReject')}</button>
              </>
            )}
          </div>
        )}
        {!feedbackInput && !submitting && planAutoApproveCountdown != null && (
          <div className={styles.planAutoApproveHint}>
            <span>{t('ui.planAutoApprove.countdown', { count: planAutoApproveCountdown })}</span>
            {onCancelPlanAutoApprove && (
              <button type="button" className={styles.planAutoApproveCancel} onClick={onCancelPlanAutoApprove}>
                {t('ui.planAutoApprove.cancel')}
              </button>
            )}
          </div>
        )}
        {feedbackInput && (
          <div className={styles.planFeedbackInputWrap}>
            <textarea
              className={styles.planFeedbackTextarea}
              placeholder={t('ui.planFeedbackPlaceholder')}
              value={feedbackText}
              onChange={e => this.setState({ feedbackText: e.target.value })}
              onKeyDown={e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  this._submitFeedback();
                }
              }}
              autoFocus
              rows={3}
            />
            <div className={styles.planFeedbackBtnRow}>
              <button
                className={styles.planFeedbackCancelBtn}
                onClick={() => this.setState({ feedbackInput: false, feedbackText: '' })}
              >
                {t('ui.cancel')}
              </button>
              <button
                className={styles.planFeedbackSendBtn}
                disabled={!feedbackText.trim()}
                onClick={this._submitFeedback}
              >
                {t('ui.planFeedbackSubmit')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
}
