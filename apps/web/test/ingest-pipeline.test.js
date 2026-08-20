/**
 * runChunkedPass 单测 — 冷启动摄取分帧管线的核心驱动。
 *
 * 关键不变量：
 *   1. 调用序列与同步 for 循环完全一致（顺序、每条恰一次、不重排不切片）
 *   2. 让步次数 = ceil(N/K)-1（末批不让步）
 *   3. abort 在让步后立即生效，剩余 step 不补跑
 *   4. onProgress 单调递增且终值 = N
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runChunkedPass, yieldToMain, INGEST_BATCH_SIZE } from '../src/utils/ingestPipeline.js';

/** 注入式计数 yield（不真让步，保持测试同步可控） */
function mkYield() {
  const counter = { n: 0 };
  return { counter, fn: () => { counter.n++; return Promise.resolve(); } };
}

describe('runChunkedPass', () => {
  it('顺序与完整性：N=1003/K=250 每个 index 恰好按序处理一次', async () => {
    const N = 1003;
    const seen = [];
    const { fn } = mkYield();
    const r = await runChunkedPass(N, (i) => seen.push(i), { yieldFn: fn, batchSize: 250 });
    assert.equal(r.aborted, false);
    assert.equal(seen.length, N);
    for (let i = 0; i < N; i++) assert.equal(seen[i], i, `index ${i} 必须按序`);
  });

  it('让步次数 = ceil(N/K)-1（N=1003/K=250 → 4 次；末批不让步）', async () => {
    const { counter, fn } = mkYield();
    await runChunkedPass(1003, () => {}, { yieldFn: fn, batchSize: 250 });
    assert.equal(counter.n, 4);
  });

  it('N 恰为 batchSize 整数倍时末批也不让步（N=500/K=250 → 1 次）', async () => {
    const { counter, fn } = mkYield();
    await runChunkedPass(500, () => {}, { yieldFn: fn, batchSize: 250 });
    assert.equal(counter.n, 1);
  });

  it('N <= batchSize：零让步、零 abort 检查，等价同步循环', async () => {
    const { counter, fn } = mkYield();
    let aborts = 0;
    const r = await runChunkedPass(100, () => {}, {
      yieldFn: fn, batchSize: 250,
      shouldAbort: () => { aborts++; return false; },
    });
    assert.equal(r.aborted, false);
    assert.equal(counter.n, 0);
    assert.equal(aborts, 0, '无让步则不检查 abort');
  });

  it('onProgress 单调递增且终值 = N', async () => {
    const progress = [];
    const { fn } = mkYield();
    await runChunkedPass(1003, () => {}, {
      yieldFn: fn, batchSize: 250,
      onProgress: (n) => progress.push(n),
    });
    assert.deepEqual(progress, [250, 500, 750, 1000, 1003]);
  });

  it('中途 abort：让步后立即终止，剩余 step 不补跑', async () => {
    const seen = [];
    let yields = 0;
    const r = await runChunkedPass(1000, (i) => seen.push(i), {
      batchSize: 250,
      yieldFn: () => { yields++; return Promise.resolve(); },
      shouldAbort: () => yields >= 2, // 第 2 次让步后（已处理 500 条）翻转
    });
    assert.equal(r.aborted, true);
    assert.equal(seen.length, 500, 'abort 时恰好处理完第 2 批');
  });

  it('total=0：不调用 step / onProgress，正常返回', async () => {
    let steps = 0; const progress = [];
    const r = await runChunkedPass(0, () => steps++, { onProgress: (n) => progress.push(n) });
    assert.equal(r.aborted, false);
    assert.equal(steps, 0);
    assert.deepEqual(progress, []);
  });

  it('supersede 场景：第二轮 pass 启动后第一轮 abort，互不污染', async () => {
    // 模拟 AppBase token 语义：shouldAbort 闭包读共享 token
    let token = 1;
    const myToken1 = token;
    const seen1 = [], seen2 = [];
    const slowYield = () => new Promise(r => setTimeout(r, 0));
    const run1 = runChunkedPass(1000, (i) => seen1.push(i), {
      batchSize: 100, yieldFn: slowYield,
      shouldAbort: () => token !== myToken1,
    });
    // 第一轮跑起来后立即启动第二轮（bump token）
    token = 2;
    const myToken2 = token;
    const run2 = runChunkedPass(300, (i) => seen2.push(i), {
      batchSize: 100, yieldFn: slowYield,
      shouldAbort: () => token !== myToken2,
    });
    const [r1, r2] = await Promise.all([run1, run2]);
    assert.equal(r1.aborted, true, '第一轮被 supersede');
    assert.ok(seen1.length < 1000, '第一轮未跑完');
    assert.equal(r2.aborted, false, '第二轮完整跑完');
    assert.equal(seen2.length, 300);
  });

  it('yieldToMain 可用且返回 Promise；INGEST_BATCH_SIZE 为正整数', async () => {
    const p = yieldToMain();
    assert.ok(p && typeof p.then === 'function');
    await p;
    assert.ok(Number.isInteger(INGEST_BATCH_SIZE) && INGEST_BATCH_SIZE > 0);
  });
});
