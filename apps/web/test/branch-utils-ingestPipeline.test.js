/**
 * ingestPipeline.js 分支补强 — 把 runChunkedPass / yieldToMain 的剩余分支跑满。
 *
 * 已有 test/ingest-pipeline.test.js 覆盖了顺序/让步次数/abort/onProgress/total=0 等;
 * 本文件专补两处:
 *   1. yieldToMain 模块加载期三元的【scheduler.yield 存在】真分支
 *      —— Node 下 globalThis.scheduler 默认 undefined,只走 setTimeout 回退;
 *         在【动态 import 之前】注入 globalThis.scheduler={yield} 即可命中真分支。
 *   2. runChunkedPass 的默认参数分支:不传 yieldFn / batchSize,
 *      让 `yieldFn = yieldToMain` 与 `batchSize = INGEST_BATCH_SIZE` 默认值被实际取用并调用。
 *
 * 规则:静态 import 注册 vite shims;目标模块用【动态 import】(且必须在 scheduler 注入之后)。
 */
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// —— 在【任何】对目标模块的 import 之前注入 scheduler,命中 yieldToMain 的 scheduler 真分支 ——
const _hadScheduler = Object.prototype.hasOwnProperty.call(globalThis, 'scheduler');
const _prevScheduler = globalThis.scheduler;
let schedulerYieldCalls = 0;
globalThis.scheduler = {
  yield: () => { schedulerYieldCalls++; return Promise.resolve(); },
};

let mod;
before(async () => {
  // 动态 import:此刻 globalThis.scheduler 已就位,模块顶层三元取 scheduler.yield 真分支。
  mod = await import('../src/utils/ingestPipeline.js');
});

after(() => {
  // 还原被 patch 的全局,避免污染同进程内其它(本文件)断言之外的状态。
  if (_hadScheduler) globalThis.scheduler = _prevScheduler;
  else delete globalThis.scheduler;
});

describe('ingestPipeline 分支补强', () => {
  it('yieldToMain 在 scheduler.yield 存在时走 scheduler 分支(非 setTimeout 回退)', async () => {
    const { yieldToMain } = mod;
    const before = schedulerYieldCalls;
    const p = yieldToMain();
    assert.ok(p && typeof p.then === 'function', '返回 thenable');
    await p;
    assert.equal(
      schedulerYieldCalls,
      before + 1,
      'yieldToMain 应调用注入的 scheduler.yield 而非 setTimeout',
    );
  });

  it('runChunkedPass 不传 yieldFn/batchSize:取默认 yieldToMain + INGEST_BATCH_SIZE 并真实让步', async () => {
    const { runChunkedPass, INGEST_BATCH_SIZE } = mod;
    // total 超过默认 batchSize,确保进入让步分支,从而真正调用默认 yieldFn(=yieldToMain=scheduler.yield)。
    const total = INGEST_BATCH_SIZE + 5;
    const seen = [];
    const before = schedulerYieldCalls;
    const r = await runChunkedPass(total, (i) => seen.push(i));
    assert.equal(r.aborted, false);
    assert.equal(seen.length, total, '全部 step 执行');
    for (let i = 0; i < total; i++) assert.equal(seen[i], i, `index ${i} 按序`);
    // 默认 batchSize=INGEST_BATCH_SIZE 时让步次数 = ceil(total/K)-1 = 1,
    // 默认 yieldFn 即 yieldToMain,故 scheduler.yield 被多调用一次。
    assert.equal(
      schedulerYieldCalls,
      before + 1,
      '默认 yieldFn 应回退到 yieldToMain 并调用 scheduler.yield 恰一次',
    );
  });

  it('runChunkedPass 默认参数 + total 不足一个 batch:零让步、不触发默认 yieldFn', async () => {
    const { runChunkedPass } = mod;
    const before = schedulerYieldCalls;
    const seen = [];
    const r = await runChunkedPass(3, (i) => seen.push(i));
    assert.equal(r.aborted, false);
    assert.deepEqual(seen, [0, 1, 2]);
    assert.equal(schedulerYieldCalls, before, '不足一批不让步,默认 yieldFn 不被调用');
  });
});
