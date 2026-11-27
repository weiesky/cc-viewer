/**
 * ContextCompactionBar.jsx — "context compaction" reminder bubble.
 *
 * Rendered by ChatView when the threshold is reached, the current turn has ended, and the
 * session is idle. Two forms:
 *   - bubble (default): absolutely positioned above the input via .composerAnchor, left edge
 *     aligned with the quick-settings star, without covering the input.
 *   - fallback (PTY terminal layout, no star to anchor to): the old horizontal bar, falling
 *     back to the .inputStack document flow.
 *
 * Execution timing (bar.timing): user = wait for the user to click; s30/m3 = countdown inside
 * the bubble, auto-executes when it reaches zero; auto = no bubble (ChatView injects directly).
 * Close action: (x) = decline this time and defer the reminder (re-remind at the next turn end
 * or when context grows another +50K/+5%, whichever comes first).
 *
 * The countdown ticks locally inside this component via deadlineCountdown (avoiding a 1Hz
 * re-render of the whole ChatView); it pauses while not visible (occluded by the quick menu/modal,
 * or the tab is hidden) and resumes when visible again (controlled by the parent's `visible`).
 *
 * props:
 *   bar        — { title, usedLabel, maxLabel, percentLabel, timing, countdownEndsAt, status }
 *   busy       — turnActive || isStreaming; when true, confirmation is disabled (never inject mid-stream)
 *   injecting  — sent, awaiting ack; both buttons disabled + in-progress label
 *   visible    — whether the bubble is visible to the user (false when the menu/modal/tab occludes it); the countdown pauses accordingly
 *   fallback   — when true, use the old horizontal-bar style (PTY terminal layout)
 *   onConfirm / onClose / onExpire / onOpenSettings
 */
import React, { useState, useEffect, useRef } from 'react';
import { t } from '../../i18n';
import styles from './ChatView.module.css';
import { remainingSeconds, formatCountdownClock } from '../../utils/deadlineCountdown';
import { TIMING_COUNTDOWN_MS } from '../../utils/contextCompaction';

export default function ContextCompactionBar({
  bar, busy, injecting, visible = true, fallback = false,
  onConfirm, onClose, onExpire, onOpenSettings,
}) {
  const hasCountdown = !!(bar && bar.countdownEndsAt) && (bar.timing === 's30' || bar.timing === 'm3');
  const totalSec = hasCountdown ? Math.round((TIMING_COUNTDOWN_MS[bar.timing] || 0) / 1000) : 0;
  const [remainSec, setRemainSec] = useState(() => (bar && bar.countdownEndsAt ? remainingSeconds(bar.countdownEndsAt) : 0));
  // The EFFECTIVE deadline lives in a ref so it survives effect re-runs (visible flips). While
  // hidden we freeze by NOT advancing it; on becoming visible we rebuild it as now+remaining.
  const deadlineRef = useRef(bar && bar.countdownEndsAt ? bar.countdownEndsAt : 0);
  // On-screen detection (review P1): the `visible` prop only covers the settings modal, but the
  // bubble can also be hidden by the raw/terminal view (ChatView display:none) or the (+) menu's
  // full-screen overlay — in those cases a countdown would fire with the user unable to see it.
  // An IntersectionObserver on the bubble itself reports TRUE on-screen-ness regardless of which
  // ancestor hid it (display:none → not intersecting), with no prop-drilling through parents.
  const rootRef = useRef(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setOnScreen(e.isIntersecting && e.intersectionRatio > 0);
    }, { threshold: [0] });
    io.observe(el);
    return () => { try { io.disconnect(); } catch { /* best-effort */ } };
  }, [bar]);

  // Countdown (s30/m3). Local tick so the 1Hz re-render is confined to this small component,
  // not the whole ChatView tree. TRUE pause semantics: the effective deadline is FROZEN while
  // hidden — we snapshot the remaining ms on entering hidden and rebuild a fresh deadline
  // (now + frozen) on becoming visible, so closing a modal NEVER retroactively fires (review P1).
  // Also pauses on browser-tab visibility (document.hidden). An expiry that lands while busy is
  // deferred, not dropped — the interval keeps running and fires once idle.
  useEffect(() => {
    if (!hasCountdown || !bar.countdownEndsAt) return undefined;
    // A brand-new countdown (different base) re-seeds the effective deadline; on a mere visible/
    // busy flip the base is unchanged, so we KEEP the ref's current deadline (which the previous
    // cycle's teardown already rebuilt from the frozen remainder) instead of resetting to the
    // original wall-clock deadline. Track the seeded base to tell the two apart.
    if (deadlineRef.base !== bar.countdownEndsAt) {
      deadlineRef.current = bar.countdownEndsAt;
      deadlineRef.base = bar.countdownEndsAt;
    }
    let frozenRemainingMs = null; // non-null while hidden = paused (this effect's own cycle only)
    let iv = null;
    const isHidden = () => !visible || !onScreen || (typeof document !== 'undefined' && document.hidden);
    const stop = () => { if (iv) { clearInterval(iv); iv = null; } };
    const fire = () => {
      stop();
      if (typeof onExpire === 'function') onExpire();
    };
    const tick = () => {
      if (isHidden()) return;
      if (busy) return; // turn in flight: hold, don't fire mid-stream (deferred, not dropped)
      const r = remainingSeconds(deadlineRef.current);
      setRemainSec(r);
      if (r <= 0) fire();
    };
    if (!isHidden()) {
      // (Re)starting visible: if we have a frozen remainder from the previous hidden cycle, the
      // deadline was already rebuilt by that cycle's exit; here just resume ticking it.
      iv = setInterval(tick, 250);
      tick();
    } else {
      // Entering hidden: freeze the remaining ms against the CURRENT effective deadline.
      frozenRemainingMs = Math.max(0, deadlineRef.current - Date.now());
      setRemainSec(Math.ceil(frozenRemainingMs / 1000));
    }
    const onVis = () => {
      if (document.hidden) {
        frozenRemainingMs = Math.max(0, deadlineRef.current - Date.now());
      } else {
        // Becoming visible: rebuild the deadline from the frozen remainder so the pause is real.
        if (frozenRemainingMs != null) { deadlineRef.current = Date.now() + frozenRemainingMs; frozenRemainingMs = null; }
        tick();
      }
    };
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', onVis);
    }
    return () => {
      // On effect teardown driven by `visible` flipping, persist the frozen remainder into the
      // ref-backed deadline so the NEXT effect cycle resumes from the paused value instead of the
      // original wall-clock deadline (the modal-close retroactive-fire bug).
      if (frozenRemainingMs != null && isHidden()) {
        deadlineRef.current = Date.now() + frozenRemainingMs;
      }
      stop();
      if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', onVis);
    };
  }, [hasCountdown, bar && bar.countdownEndsAt, visible, onScreen, busy, onExpire]);

  if (!bar) return null;
  const rootCls = fallback ? styles.compactionBar : styles.compactionBubble;
  return (
    <div className={rootCls} role="status" aria-live="polite" ref={rootRef}>
      {/* SR-only: announce the pending auto-compaction (the visible clock is aria-hidden). */}
      {hasCountdown && (
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {t('ui.contextCompaction.bar.autoIn', { seconds: Math.max(0, Math.round(remainSec / 5) * 5) })}
        </span>
      )}
      <div className={styles.compactionBubbleHead}>
        <span className={styles.compactionBarTitle}>{t('ui.contextCompaction.bar.title')}</span>
        <span className={styles.compactionBubbleHeadRight}>
          {hasCountdown && (
            <span className={styles.compactionBubbleCountdown} aria-hidden="true">
              {formatCountdownClock(remainSec)}
            </span>
          )}
          <button
            type="button"
            className={styles.compactionBubbleClose}
            title={t('ui.contextCompaction.bar.closeTitle')}
            aria-label={t('ui.contextCompaction.bar.closeTitle')}
            disabled={injecting}
            onClick={onClose}
          >×</button>
        </span>
      </div>
      <div className={styles.compactionBubbleBody}>
        <div className={styles.compactionBubbleAsk}>{t('ui.contextCompaction.bar.ask')}</div>
        <div className={styles.compactionBarBody}>
          {t('ui.contextCompaction.bar.body', {
            used: bar.usedLabel, max: bar.maxLabel, percent: bar.percentLabel, title: bar.title,
          })}
        </div>
      </div>
      <div className={styles.compactionBarActions}>
        <button
          type="button"
          className={styles.compactionBarSettings}
          title={t('ui.contextCompaction.bar.settings')}
          aria-label={t('ui.contextCompaction.bar.settings')}
          onClick={onOpenSettings}
        >⚙</button>
        <button
          type="button"
          className={styles.compactionBarConfirm}
          disabled={busy || injecting}
          onClick={onConfirm}
        >{injecting ? t('ui.contextCompaction.bar.injecting') : t('ui.contextCompaction.bar.confirm')}</button>
        {/* Show the busy hint inline next to the button instead of a hover-only
            tooltip — a tooltip would require the user to hover long enough to
            discover why the button is disabled, which is invisible affordance
            on a row that also contains a live countdown. */}
        {busy && (
          <span className={styles.compactionBarBusyHint}>{t('ui.contextCompaction.bar.busy')}</span>
        )}
      </div>
      {hasCountdown && bar.countdownEndsAt && totalSec > 0 && (
        <div
          className={styles.compactionBubbleProgress}
          style={{ width: `${Math.max(0, Math.min(100, (remainSec / totalSec) * 100))}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
