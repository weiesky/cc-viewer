/**
 * 覆盖目标（补缺口）：src/utils/markdownProfiler.js 的副作用入口
 *   - measureParse(fn)        —— DEV=false 分支（line 95: `if (!DEV) return fn()`）
 *   - recordMountSample(ms)   —— DEV=false 早退分支（line 105）
 *   - DEV_PROFILER_ENABLED    —— 导出值
 *
 * 既有 test/markdown-profiler.test.js 覆盖 percentile / createStats（纯函数），
 * 本文件【只补】上述未覆盖的导出，不重复。
 *
 * 该模块顶层 `DEV = import.meta.env?.DEV === true`：node --test 无 Vite env，
 * import.meta.env 为 undefined，故 DEV 短路为 falsy。所有 DEV-true 路径
 * （window.__mdStats 赋值、measureParse/recordMountSample 的计时与
 * performance.measure 调用）依赖真实 dev 浏览器，不在本套件覆盖（记 skipped）。
 *
 * 直接静态 import：该模块无 svg / 无扩展名 import，依赖链干净。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  measureParse,
  recordMountSample,
  DEV_PROFILER_ENABLED,
} from '../src/utils/markdownProfiler.js';

describe('measureParse — DEV=false 直通分支', () => {
  it('原样返回回调结果（不做计时、不触 performance）', () => {
    const result = measureParse(() => 'PARSED_HTML');
    assert.equal(result, 'PARSED_HTML');
  });

  it('回调被调用恰好一次', () => {
    let calls = 0;
    measureParse(() => { calls += 1; return null; });
    assert.equal(calls, 1);
  });

  it('回调返回对象引用被透传（非拷贝）', () => {
    const obj = { html: '<p>x</p>' };
    const out = measureParse(() => obj);
    assert.equal(out, obj);
  });

  it('回调抛错时 measureParse 向外冒泡（DEV=false 无 try 包裹）', () => {
    assert.throws(
      () => measureParse(() => { throw new Error('boom'); }),
      /boom/,
    );
  });

  it('回调返回 undefined 时也原样返回 undefined', () => {
    assert.equal(measureParse(() => undefined), undefined);
  });
});

describe('recordMountSample — DEV=false 早退分支', () => {
  it('正常数值入参为 no-op，返回 undefined 且不抛错', () => {
    assert.equal(recordMountSample(12.5), undefined);
  });

  it('负数 / NaN / 非有限值入参同样早退返回 undefined', () => {
    assert.equal(recordMountSample(-1), undefined);
    assert.equal(recordMountSample(NaN), undefined);
    assert.equal(recordMountSample(Infinity), undefined);
  });

  it('非数字入参也安全（DEV=false 在 Number.isFinite 之前就 return）', () => {
    assert.equal(recordMountSample('5'), undefined);
    assert.equal(recordMountSample(undefined), undefined);
    assert.equal(recordMountSample(null), undefined);
  });
});

describe('DEV_PROFILER_ENABLED 导出', () => {
  it('在 node --test（无 Vite DEV env）下为 falsy', () => {
    // DEV = (typeof import.meta !== 'undefined') && import.meta.env && ...
    // import.meta.env 为 undefined → 整表达式短路为 undefined（falsy）
    assert.ok(!DEV_PROFILER_ENABLED);
  });
});
