import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { ApprovalPortalContext } from '../chat/ApprovalPortalContext';
import { playEvent as playVoiceEvent, playChimeFallback } from '../../utils/voicePackPlayer';
import AskQuestionForm from '../chat/AskQuestionForm';
import { shouldRenderAskFallback, ASK_FALLBACK_GRACE_MS } from '../../utils/askFallback';
import styles from './ApprovalModal.module.css';

const KIND_PRIORITY = ['ptyPlan', 'ask'];
// Approval kind → voice-pack eventKey. Lets the voice pack address kinds by
// stable semantic name even if the modal's internal naming evolves.
const KIND_TO_VOICE_EVENT = {
  ptyPlan: 'planApproval',
  ask: 'askQuestion',
};

function _idForKind(kind, payload) {
  if (!payload) return null;
  if (kind === 'ptyPlan') return payload.ptyPlan?.ptyPlan?.id ?? null;
  if (kind === 'ask') return payload.ask?.ask?.id ?? null;
  return null;
}


function _isDismissed(dismissedSet, kind, id) {
  if (!id || !(dismissedSet instanceof Set)) return false;
  return dismissedSet.has(`${kind}:${id}`);
}

const _tr = (key, params, fallback) => {
  try {
    const r = t(key, params);
    return (r && r !== key) ? r : fallback;
  } catch { return fallback; }
};

/**
 * Wrap the entire app with this component. It provides the ApprovalPortalContext
 * to descendants AND renders the modal UI (when applicable) on top via a sibling
 * `<div>` inside its single React fragment.
 *
 * Inline AskQuestionForm and inline PTY planModeBox consume the context to decide
 * whether to portal themselves into the modal slot. State is preserved across the
 * portal switch — Portals do not unmount their child tree, so any in-flight feedback
 * textarea content survives ESC dismiss → reopen.
 *
 * Permission and SDK ExitPlanMode panels deliberately stay inline-only and are NOT
 * routed through this modal.
 */
export default function ApprovalModal({
  enabled,
  soundEnabled,
  voicePackPrefs,
  approvalGlobal,
  dismissedIds,
  onDismiss,
  onJumpTab,
  otherTabs,
  children,
}) {
  const askSlotRef = useRef(null);
  const ptyPlanSlotRef = useRef(null);
  const [activeKind, setActiveKind] = useState(null);
  const [slotsReady, setSlotsReady] = useState(false);
  // Per-kind dedupe: joined keys previously suppressed the second kind when
  // ptyPlan and ask arrived together. Each kind tracks its own last-fired id now.
  const lastFiredIdRef = useRef({ ptyPlan: null, ask: null });

  // All approval kinds currently pending (not gated by `enabled`).
  // Decoupling sound from UI visibility means phone-mode (where Mobile.jsx sets
  // enabled={isPad && modalEnabled} → false) still gets audio cues —
  const allKinds = useMemo(() => {
    if (!approvalGlobal) return [];
    const out = [];
    for (const k of KIND_PRIORITY) {
      const id = _idForKind(k, approvalGlobal);
      if (id != null && !_isDismissed(dismissedIds, k, id)) out.push(k);
    }
    return out;
  }, [approvalGlobal, dismissedIds]);

  // visibleKinds = the subset rendered in the UI (gated by `enabled`).
  const visibleKinds = useMemo(() => (enabled ? allKinds : []), [enabled, allKinds]);

  // Pick the highest-priority visible kind as initial active. If activeKind dropped out
  // (resolved or dismissed), pick the new top.
  useEffect(() => {
    if (visibleKinds.length === 0) {
      if (activeKind !== null) setActiveKind(null);
      return;
    }
    if (!activeKind || !visibleKinds.includes(activeKind)) {
      setActiveKind(visibleKinds[0]);
    }
  }, [visibleKinds, activeKind]);

  // Slot refs — flag readiness once the modal UI is mounted so portals can target stable nodes.
  // Use useLayoutEffect to flip slotsReady SYNCHRONOUSLY before paint — otherwise the inline
  // form would render for one frame inline before the Portal kicks in (visible flicker).
  useLayoutEffect(() => {
    const ready = visibleKinds.length > 0
      && askSlotRef.current
      && ptyPlanSlotRef.current;
    if (ready && !slotsReady) setSlotsReady(true);
    if (!ready && slotsReady) setSlotsReady(false);
  });

  const askId = _idForKind('ask', approvalGlobal);
  const askPendingVisible = visibleKinds.includes('ask');

  const ctxValue = useMemo(() => ({
    askSlot: slotsReady ? askSlotRef.current : null,
    ptyPlanSlot: slotsReady ? ptyPlanSlotRef.current : null,
    activeAskId: askPendingVisible ? askId : null,
    activePtyPlanId: visibleKinds.includes('ptyPlan') ? _idForKind('ptyPlan', approvalGlobal) : null,
  }), [slotsReady, visibleKinds, askPendingVisible, askId, approvalGlobal]);

  // Fallback form support: the modal body is normally filled by the transcript
  // tool_use block portaling into the ask slot. When nothing portals in (stale
  // replayed ask whose block is old history, or a fresh ask before transcript
  // ingest), render an AskQuestionForm directly from the pending-ask broadcast
  // so the user always gets working Submit/Cancel. See src/utils/askFallback.js.
  const [askSlotOccupied, setAskSlotOccupied] = useState(false);
  const [askGraceElapsed, setAskGraceElapsed] = useState(false);

  // Occupancy: observe the ask slot's children. Re-arms per ask id (queue
  // promotion swaps the portal child) and per modal open/close. The sync initial
  // read catches an already-portaled form on reopen so the fallback never flashes.
  useLayoutEffect(() => {
    const node = askSlotRef.current;
    if (!askPendingVisible || !node) {
      setAskSlotOccupied(false);
      return undefined;
    }
    const update = () => setAskSlotOccupied(node.childElementCount > 0);
    update();
    const mo = new MutationObserver(update);
    mo.observe(node, { childList: true });
    return () => { mo.disconnect(); };
  }, [askPendingVisible, askId]);

  // Grace delay: give the real portal one commit cycle (slotsReady flip →
  // consumer re-render → portal mount) plus ingest jitter before falling back.
  useEffect(() => {
    setAskGraceElapsed(false);
    if (!askPendingVisible) return undefined;
    const timer = setTimeout(() => setAskGraceElapsed(true), ASK_FALLBACK_GRACE_MS);
    return () => clearTimeout(timer);
  }, [askPendingVisible, askId]);

  const askFallbackVisible = shouldRenderAskFallback({
    isAskActive: askPendingVisible,
    slotOccupied: askSlotOccupied,
    graceElapsed: askGraceElapsed,
    questions: approvalGlobal?.ask?.ask?.questions,
    submitHandler: approvalGlobal?.ask?.handlers?.submit,
  });

  // ESC = minimise（pending 保留）
  // Cmd/Ctrl+ESC = cancel（仅对 ask 类型生效，等价 terminal Claude Code 的 onAbort）—
  // 等价路径：ChatView.handleAskCancel 走 ask-cancel WS 协议 + SDK 包内置 ensureToolResultPairing 闭合 transcript。
  //
  // preventDefault + stopPropagation 防 ESC 冒泡到下层（textarea / 全局 PTY keydown listener
  // 等）误触发副作用 — 已观察到的复现：modal 内按 ESC 后 inline 卡片提交报 pty-prompt-invalid。
  const handleEsc = useCallback((e) => {
    if (e.key !== 'Escape') return;
    if (!activeKind) return;
    const id = _idForKind(activeKind, approvalGlobal);
    if (id == null) return;
    e.preventDefault();
    e.stopPropagation();
    if ((e.metaKey || e.ctrlKey) && activeKind === 'ask') {
      const cancelFn = approvalGlobal?.ask?.handlers?.cancel;
      if (cancelFn) {
        cancelFn(id, 'User aborted');
        return;
      }
    }
    if (onDismiss) onDismiss(activeKind, id);
  }, [activeKind, approvalGlobal, onDismiss]);

  useEffect(() => {
    if (visibleKinds.length === 0) return undefined;
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [visibleKinds.length, handleEsc]);

  // Sound — drives BOTH the voice-pack and the legacy chime.
  //   • If voicePackPrefs.enabled AND the matching event has a binding → use voice pack
  //     (player module handles autoplay block / 404 / serial queue, see voicePackPlayer.js).
  //   • Else if soundEnabled → fall back to the legacy two-tone Web Audio chime.
  //   • Else: silent.
  //
  // Uses `allKinds` (not `visibleKinds`) so phone mode still beeps even when the
  // modal UI is hidden behind a slide-up sheet(: Mobile.jsx isPad gate).
  useEffect(() => {
    if (allKinds.length === 0) return;
    const vp = voicePackPrefs;
    const useVoicePack = !!(vp && vp.enabled);

    for (const kind of allKinds) {
      const id = _idForKind(kind, approvalGlobal);
      if (id == null) continue;
      // Per-kind dedupe: don't re-fire when the same kind:id is still present
      // through a re-render. Clears in the else-branch when the id changes / disappears.
      if (lastFiredIdRef.current[kind] === id) continue;
      lastFiredIdRef.current[kind] = id;

      let fired = false;
      const eventKey = KIND_TO_VOICE_EVENT[kind];
      if (useVoicePack && eventKey && vp.events && vp.events[eventKey]) {
        try {
          fired = playVoiceEvent(eventKey, vp, { dedupeKey: `${eventKey}:${id}` });
        } catch { fired = false; }
      }
      if (!fired && soundEnabled) {
        // Legacy chime fallback — shared two-tone Web Audio implementation lives
        // in voicePackPlayer.js (it was duplicated here before).
        playChimeFallback();
      }
    }

    // Clean up dedupe entries for kinds that have left the pending set, so the
    // *next* arrival of the same kind (different id) fires again.
    for (const k of KIND_PRIORITY) {
      if (!allKinds.includes(k)) lastFiredIdRef.current[k] = null;
    }
  }, [allKinds, approvalGlobal, soundEnabled, voicePackPrefs]);

  const handleBackdropClick = (e) => {
    if (e.target !== e.currentTarget) return;
    if (!activeKind) return;
    const id = _idForKind(activeKind, approvalGlobal);
    if (id != null && onDismiss) onDismiss(activeKind, id);
  };

  const handleManualDismiss = () => {
    if (!activeKind) return;
    const id = _idForKind(activeKind, approvalGlobal);
    if (id != null && onDismiss) onDismiss(activeKind, id);
  };

  const titleKey = activeKind === 'ptyPlan' ? 'ui.approval.modal.title.ptyPlan'
    : 'ui.approval.modal.title.ask';
  const titleFallback = activeKind === 'ptyPlan' ? 'Plan review'
    : 'Question';

  const isVisible = visibleKinds.length > 0;

  return (
    <ApprovalPortalContext.Provider value={ctxValue}>
      {children}
      {isVisible && (
        <div className={styles.backdrop} onClick={handleBackdropClick} role="dialog" aria-modal="true">
          <div className={styles.modal}>
            <div className={styles.header}>
              <span className={styles.title}>{_tr(titleKey, null, titleFallback)}</span>
              {Array.isArray(otherTabs) && otherTabs.map((ot) => (
                <span
                  key={ot.tabId}
                  className={`${styles.chip} ${styles.chipAction}`}
                  onClick={() => onJumpTab && onJumpTab(ot.tabId)}
                >
                  {_tr('ui.approval.modal.jumpToSession', { project: ot.projectName || '' }, `→ ${ot.projectName || 'session'}`)}
                </span>
              ))}
              <button className={styles.headerDismissBtn} onClick={handleManualDismiss}>
                {_tr('ui.approval.modal.dismiss', null, 'Minimise')}
              </button>
            </div>
            {visibleKinds.length > 1 && (
              <div className={styles.kindTabs}>
                {visibleKinds.map((k) => (
                  <button
                    key={k}
                    className={`${styles.kindTab} ${k === activeKind ? styles.kindTabActive : ''}`}
                    onClick={() => setActiveKind(k)}
                  >
                    {_tr(`ui.approval.modal.title.${k}`, null, k)}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.body}>
              <div ref={ptyPlanSlotRef} className={`${styles.slot}${activeKind !== 'ptyPlan' ? ' ' + styles.slotHidden : ''}`} />
              <div ref={askSlotRef} className={`${styles.slot}${activeKind !== 'ask' ? ' ' + styles.slotHidden : ''}`} />
              {askFallbackVisible && (
                // Invariant: shouldRenderAskFallback already verified a non-empty
                // questions array and a function submit handler — keep it that way
                // before loosening the non-optional accesses below.
                <div className={`${styles.slot}${activeKind !== 'ask' ? ' ' + styles.slotHidden : ''}`}>
                  <AskQuestionForm
                    key={askId}
                    questions={approvalGlobal.ask.ask.questions}
                    onSubmit={(answers) => approvalGlobal.ask.handlers.submit(answers, askId, approvalGlobal.ask.ask.questions)}
                    onCancel={approvalGlobal.ask.handlers.cancel
                      ? () => approvalGlobal.ask.handlers.cancel(askId, 'User aborted')
                      : undefined}
                  />
                </div>
              )}
            </div>
            {activeKind === 'ask' && approvalGlobal?.ask?.handlers?.cancel && (
              <div className={styles.footer}>
                <span className={styles.footerHint}>
                  <span className={styles.footerHintLabel}>
                    {_tr('ui.approval.modal.hintPrefix', null, 'Hint:')}
                  </span>
                  {' '}
                  {_tr('ui.approval.modal.cancelHint', null, '⌘/Ctrl+ESC to cancel')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </ApprovalPortalContext.Provider>
  );
}
