// server/lib/resync-nudge-gate.js 单测：resync 重绘 nudge 冷却门——首次必放行 /
// 冷却期内拒绝 / 过冷却放行 / cooldownMs=0 恒放行（逃生口）/ 紧循环只放首发。
// 全程注入 now，零真实时钟。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createResyncNudgeGate } from '../server/lib/resync-nudge-gate.js';

function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('resync-nudge-gate', () => {
  it('首次 shouldNudge 必放行', () => {
    const clk = makeClock();
    const g = createResyncNudgeGate({ cooldownMs: 3000, now: clk.now });
    assert.equal(g.shouldNudge(), true);
  });

  it('冷却期内第二次拒绝', () => {
    const clk = makeClock();
    const g = createResyncNudgeGate({ cooldownMs: 3000, now: clk.now });
    assert.equal(g.shouldNudge(), true);
    clk.advance(500);
    assert.equal(g.shouldNudge(), false, '500ms < 3000ms 冷却期内');
  });

  it('过冷却期后再次放行，并重新记账', () => {
    const clk = makeClock();
    const g = createResyncNudgeGate({ cooldownMs: 3000, now: clk.now });
    assert.equal(g.shouldNudge(), true);
    clk.advance(3001);
    assert.equal(g.shouldNudge(), true, '过冷却期放行');
    clk.advance(100);
    assert.equal(g.shouldNudge(), false, '放行后重新进入冷却');
  });

  it('被拒绝的调用不重置冷却计时（从上次放行起算，非上次调用）', () => {
    const clk = makeClock();
    const g = createResyncNudgeGate({ cooldownMs: 3000, now: clk.now });
    g.shouldNudge();                 // t=1000 放行
    clk.advance(2000);
    assert.equal(g.shouldNudge(), false);   // t=3000 拒绝（不记账）
    clk.advance(1500);
    assert.equal(g.shouldNudge(), true, 't=4500 距上次放行 3500 > 3000，应放行');
  });

  it('cooldownMs=0 恒放行（逃生口，回旧行为）', () => {
    const clk = makeClock();
    const g = createResyncNudgeGate({ cooldownMs: 0, now: clk.now });
    for (let i = 0; i < 5; i++) assert.equal(g.shouldNudge(), true);
  });

  it('紧循环（亚秒级 behind→resume 振荡）只放行首发', () => {
    const clk = makeClock();
    const g = createResyncNudgeGate({ cooldownMs: 3000, now: clk.now });
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(g.shouldNudge());
      clk.advance(300);              // 300ms 周期的 resync 循环
    }
    assert.deepEqual(results, [true, ...Array(9).fill(false)],
      '紧循环只有首次 nudge，后续全部被冷却压制（不再注入重绘燃料）');
  });

  it('默认参数可用（cooldownMs 缺省 3000、now 缺省 Date.now）', () => {
    const g = createResyncNudgeGate();
    assert.equal(g.shouldNudge(), true);
    assert.equal(g.shouldNudge(), false, '真实时钟下立即二次调用必在冷却期内');
  });
});
