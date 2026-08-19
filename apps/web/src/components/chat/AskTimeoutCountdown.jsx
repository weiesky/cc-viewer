import React, { useState, useEffect, useRef } from 'react';
import { t } from '../../i18n';
import styles from './ChatMessage.module.css';

// 12h 阈值：超过此值视作"实质无超时"。
// 用户视角不应该看到 "23:59:58" 这种数字（反而比 60min 更焦虑）；
// server 端 HOOK_TIMEOUT=24h 时直接 return null 不渲染倒计时。
const NO_TIMEOUT_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/**
 * AskUserQuestion 倒计时显示 — 独立小组件，自己持有 setInterval，
 * 不让 AskQuestionForm 每秒整体 re-render。
 *
 * 校准模式（不是 setTimeout 递归累加）：
 *   每次 tick 都基于 wall-clock `Date.now() - startedAt` 实时计算剩余时间。
 *   setInterval drift / background tab throttle / 浏览器 sleep 醒来都不影响显示值 —
 *   tick 推迟会让下次显示直接跳到正确剩余时间，不累积偏差。
 *   visibility 'visible' 时也额外 force 重算一次给即时反馈。
 *
 * 内存回收三道闸：
 *   1. useEffect cleanup 在 unmount 时 clearInterval + removeEventListener
 *   2. remaining ≤ 0 时主动 clearInterval（防超时后空跑）
 *   3. startedAt/timeoutMs prop 变化时 effect 重新订阅（旧 interval 被 cleanup 回收）
 *
 * 注：之前的 voice-pack 超时预警（timeoutWarning5min / 60s）在 24h 实质无超时后失去意义，
 * 已从 EVENT_KEYS 移除；本组件不再 import voicePackPlayer / SettingsContext。
 */
export default function AskTimeoutCountdown({ startedAt, timeoutMs }) {
  // 防御：startedAt / timeoutMs 缺失或非法时不渲染（老 server 不发这俩字段）
  const validStartedAt = typeof startedAt === 'number' && startedAt > 0 ? startedAt : null;
  const validTimeoutMs = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : null;
  const isInfiniteTimeout = validTimeoutMs != null && validTimeoutMs >= NO_TIMEOUT_THRESHOLD_MS;

  const compute = () => {
    if (!validStartedAt || !validTimeoutMs) return null;
    return Math.max(0, validTimeoutMs - (Date.now() - validStartedAt));
  };

  const [remaining, setRemaining] = useState(compute);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!validStartedAt || !validTimeoutMs) return undefined;
    // 无超时模式不起 interval（再大的剩余时间也无意义）
    if (isInfiniteTimeout) return undefined;
    // 初始计算一次（prop 变化时同步刷新）
    setRemaining(compute());

    // 已到 0 不起 interval
    const initial = Math.max(0, validTimeoutMs - (Date.now() - validStartedAt));
    if (initial <= 0) return undefined;

    const tick = () => {
      // 每次都基于 wall-clock 重算，drift 不累积
      const r = Math.max(0, validTimeoutMs - (Date.now() - validStartedAt));
      setRemaining(r);
      // 到 0 主动清，防空跑（cleanup 在 unmount 时再清一次，幂等）
      if (r <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    timerRef.current = setInterval(tick, 1000);
    // tab 切回时立刻 force 一次重算，不必等下次 interval tick
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tick();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [validStartedAt, validTimeoutMs, isInfiniteTimeout]);

  // 无超时模式：彻底不渲染（v3 后用户视角等于"没倒计时" = 没显示更直接，少一条视觉噪音）
  if (isInfiniteTimeout) return null;
  if (remaining == null) return null;
  if (remaining <= 0) return null; // 超时后由 ws ask-hook-timeout 路径接管，倒计时不再显示

  const totalSec = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  // <1h 段也补 0（MM:SS）防容器宽度从 H:MM:SS 7 字符突跳到 M:SS 4 字符的视觉抖动
  const timeStr = hours > 0
    ? `${hours}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  // a11y：role="timer" 让屏阅识别；剩余 ≤60s 时 aria-live='polite' 主动播报"快超时"
  // 给盲用户，>60s 则 'off' 不每秒打扰。视觉上 ≤60s 也切 warning 类提示用户。
  const isWarning = remaining <= 60 * 1000;
  const className = isWarning
    ? `${styles.askCountdown} ${styles.askCountdownWarning}`
    : styles.askCountdown;

  return (
    <div
      className={className}
      role="timer"
      aria-live={isWarning ? 'polite' : 'off'}
    >
      {t('ui.askCountdown', { time: timeStr })}
    </div>
  );
}
