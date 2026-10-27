// Wall-clock deadline countdown helper for approval auto-approve timers.
//
// The approval countdowns used to be naive `setInterval(() => n - 1)` loops, which
// silently stall in background/occluded tabs (browsers throttle/clamp timers) and
// never catch up — the server's 5-minute deny timeout then converts the delay into
// a denial. This helper computes the remaining time from the absolute deadline on
// every tick (AskTimeoutCountdown's calibration pattern) and additionally recomputes
// on visibilitychange, so a backgrounded tab shows and fires on the true deadline.

/** Remaining whole seconds until deadlineMs (clamped at 0). */
export function remainingSeconds(deadlineMs, nowMs = Date.now()) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * Start a deadline-driven countdown.
 *  - onTick(remainingSeconds) is called immediately and then ~every second with the
 *    true wall-clock remaining (never a naive decrement).
 *  - onExpire() fires exactly once when the deadline passes, then the timer stops.
 *  - visibilitychange→visible forces an immediate recompute.
 * Returns stop() which clears the interval and removes the listener (idempotent).
 */
export function startDeadlineCountdown({ deadlineMs, onTick, onExpire, documentRef = globalThis.document }) {
  let interval = null;
  let expired = false;

  const compute = () => remainingSeconds(deadlineMs);

  const fire = () => {
    if (expired) return;
    expired = true;
    stop();
    onExpire?.();
  };

  const tick = () => {
    const r = compute();
    if (r <= 0) { fire(); return; }
    onTick?.(r);
  };

  const onVisibility = () => {
    if (documentRef && documentRef.visibilityState === 'visible') tick();
  };

  // Immediate first read — an already-past deadline expires synchronously.
  const initial = compute();
  if (initial <= 0) {
    expired = true;
    onExpire?.();
    return () => {};
  }
  onTick?.(initial);

  interval = setInterval(tick, 1000);
  if (documentRef && typeof documentRef.addEventListener === 'function') {
    documentRef.addEventListener('visibilitychange', onVisibility);
  }

  function stop() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (documentRef && typeof documentRef.removeEventListener === 'function') {
      documentRef.removeEventListener('visibilitychange', onVisibility);
    }
  }

  return stop;
}
