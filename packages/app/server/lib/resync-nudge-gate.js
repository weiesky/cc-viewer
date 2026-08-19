/**
 * resync 重绘 nudge 冷却门（防 behind→resume 死循环的退避器）。
 *
 * 背景：ws-backpressure onResume 在发 data-resync 快照后会做一次重绘 nudge
 * （POSIX SIGWINCH / Windows resize 抖动），让 claude TUI 全屏重绘以免画面停在
 * 快照静止态。但 nudge 本身让 ConPTY 再吐 1~2 次全屏重绘 = 新洪泛燃料：客户端
 * 仍慢 → bufferedAmount 再越线 → behind → resume → 再 nudge → 死循环，客户端
 * 每轮 terminal.reset + 重放快照，表现为永久冻结。
 *
 * 语义：快照每次 resume 仍无条件发（修复 behind 期间被跳发的数据，不能省）；
 * 只有 nudge 走冷却——紧循环中 PTY 输出仍在流动，"画面停在快照"的风险不存在，
 * 该风险只在 resume 稀疏时成立，而稀疏 resume 必然过冷却期、照常 nudge。
 *
 * 纯逻辑、时钟可注入（now），便于单测。仿 pty-flood-coalescer.js 惯例。
 *
 * @param {object} [opts]
 * @param {number} [opts.cooldownMs=3000] - 两次 nudge 最小间隔；0 = 不冷却（恒放行，逃生口）
 * @param {() => number} [opts.now=Date.now] - 测试注入
 * @returns {{ shouldNudge: () => boolean }}
 */
export function createResyncNudgeGate({ cooldownMs = 3000, now = Date.now } = {}) {
  let lastNudgeAt = -Infinity;   // 首次必放行
  return {
    /** resume 时调用：放行则记账并返回 true，冷却期内返回 false（调用方跳过 nudge）。 */
    shouldNudge() {
      if (cooldownMs <= 0) return true;
      const t = now();
      if (t - lastNudgeAt < cooldownMs) return false;
      lastNudgeAt = t;
      return true;
    },
  };
}
