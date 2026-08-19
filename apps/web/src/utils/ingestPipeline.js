// 冷启动摄取分帧管线基础设施 — 把 load_end 的同步 O(n×m) 处理切成批次,批间让出主线程。
// 背景:`ccv -c` 大会话的全量 checkpoint(单条数十 MB、数千 messages)让 reconstruct/slim/
// process 在一个任务里跑数十秒,Windows 上页面全面卡死。分帧不改变任何一步的执行顺序与
// 语义(同一循环插入 await 让步),只把长任务拆成 <16ms 批次。
// 纯函数 + 依赖注入,React-free,node:test 可直测。

export const INGEST_BATCH_SIZE = 250;

/**
 * 让出主线程。优先 scheduler.yield()(Chrome/Edge 129+/Electron:带优先级续行,
 * 不会排在无关任务之后);回退 setTimeout(0)(通用;await 链非嵌套,4ms clamp 不生效)。
 * 不用 requestIdleCallback(交互期可被无限饿死,must-complete 管线会卡住)、
 * 不用 rAF(后台标签页完全暂停 —— Windows 用户加载期 alt-tab 是常态)。
 */
export const yieldToMain = (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function')
  ? () => scheduler.yield()
  : () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * 分帧驱动一个严格有序的 per-index pass:对 i=0..total-1 顺序调用 step(i),
 * 每 batchSize 个让步一次,让步后检查 shouldAbort。
 *
 * 调用序列与同步 for 循环完全一致 —— 仅插入 await,不重排、不切片、不并行,
 * 保证有状态消费者(createEntrySlimmer / mergeMainAgentSessions 链)语义零变化。
 *
 * @param {number} total
 * @param {(i: number) => void} step
 * @param {object} [ctl]
 * @param {() => boolean} [ctl.shouldAbort] - 每次让步后检查;true 则立即终止(不补跑剩余 step)
 * @param {(done: number) => void} [ctl.onProgress] - 每批让步前 + 结束时回报已处理条数(单调递增)
 * @param {() => Promise<void>} [ctl.yieldFn] - 让步原语(测试可注入)
 * @param {number} [ctl.batchSize]
 * @returns {Promise<{aborted: boolean}>}
 */
export async function runChunkedPass(total, step, ctl = {}) {
  const { shouldAbort, onProgress, yieldFn = yieldToMain, batchSize = INGEST_BATCH_SIZE } = ctl;
  for (let i = 0; i < total; i++) {
    step(i);
    if ((i + 1) % batchSize === 0 && i + 1 < total) {
      if (onProgress) onProgress(i + 1);
      await yieldFn();
      if (shouldAbort && shouldAbort()) return { aborted: true };
    }
  }
  if (onProgress && total > 0) onProgress(total);
  return { aborted: false };
}
