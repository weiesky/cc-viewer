import React, { useState, useEffect } from 'react';
import { t } from '../../i18n';
import { startDeadlineCountdown, formatCountdownClock, remainingSeconds } from '../../utils/deadlineCountdown';
import styles from './ChatMessage.module.css';

/**
 * 问答题自动托管(AskUserQuestion hosting)倒计时条 — 独立函数组件,自己持有
 * wall-clock deadline countdown(startDeadlineCountdown),不让外层 AskQuestionForm /
 * 缓存的 ChatMessage 元素每秒重渲染(plan 倒计时在 ChatView 里有反例,见
 * ChatView.jsx:3511-3532 的 cloneElement 机制)。
 *
 * deadline 语义:服务端 stamp 的绝对 autoAnswerAt(到点服务端自动作答)。倒计时到 0
 * 不主动做任何事 —— 服务端 timer(deadline + 1s buffer)才是权威,本组件只负责展示。
 *
 * 已过期 deadline 不 arm(startDeadlineCountdown 会对过去的 deadline 同步 onExpire,
 * 会造成 0s 闪显;先例 ChatView.jsx:3487-3493 拒 arm 过去 deadline)。
 */
export default function AskAutoHostCountdown({ autoAnswerAt, autoCancelled, onCancelHosting }) {
  const validDeadline = typeof autoAnswerAt === 'number' && autoAnswerAt > 0 ? autoAnswerAt : null;
  const [remaining, setRemaining] = useState(() => (validDeadline ? remainingSeconds(validDeadline) : 0));

  useEffect(() => {
    if (!validDeadline || autoCancelled) return undefined;
    // Refuse to arm a past deadline — the server timer already fired (or is in its
    // 1s buffer); rendering a 0s flash is worse than rendering nothing.
    if (remainingSeconds(validDeadline) <= 0) return undefined;
    return startDeadlineCountdown({
      deadlineMs: validDeadline,
      onTick: (r) => setRemaining(r),
      onExpire: () => setRemaining(0),
    });
  }, [validDeadline, autoCancelled]);

  if (!validDeadline || autoCancelled) return null;
  if (remainingSeconds(validDeadline) <= 0) return null;

  return (
    // aria-live="off": role="timer" already implies a live region, and a per-second
    // polite announcement would read the full sentence every tick for up to 30 minutes
    // (matches AskTimeoutCountdown, which stays silent except in the final 60s).
    <div className={styles.askAutoHostHint} role="timer" aria-live="off">
      <span>{t('ui.askAutoAnswer.countdown', { time: formatCountdownClock(remaining) })}</span>
      {onCancelHosting && (
        <button type="button" className={styles.askAutoHostCancel} onClick={onCancelHosting}>
          {t('ui.askAutoAnswer.cancelHosting')}
        </button>
      )}
    </div>
  );
}
