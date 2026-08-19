/**
 * 等待 res 写缓冲排空（drain），或被 close/error/超时中断。
 *
 * 之前内联在 /events 处理里的写法对 drain/close/error 三事件都用 res.once() 注册，
 * 但只有触发的那个会自动摘除；另外两个会一直挂在 res 上。一次请求里如果发生
 * N 次 backpressure，就会累积出 ~N 个 stale close + ~N 个 stale error 监听器，
 * 叠加 res 上常驻的 removeFromClients 监听器后，超过 Node 默认 maxListeners=10
 * 触发 MaxListenersExceededWarning。
 *
 * 这里把模式收敛到一个 helper：done() 在第一个事件（或 timeout）触发时主动
 * 把另外两个监听器从 res 上摘掉，保证一轮 backpressure 等待最多净增 0 个监听器。
 *
 * 语义保留：超时 / drain / close / error 任一发生即 resolve，调用方继续下一轮写入。
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} timeoutMs - 单次等待的兜底超时；超时即放弃等待
 * @returns {Promise<void>}
 */
export function awaitDrainOrClose(res, timeoutMs) {
  return new Promise((resolve) => {
    let t;
    const done = () => {
      clearTimeout(t);
      res.off('drain', done);
      res.off('close', done);
      res.off('error', done);
      resolve();
    };
    t = setTimeout(done, timeoutMs);
    res.once('drain', done);
    res.once('close', done);
    res.once('error', done);
  });
}
