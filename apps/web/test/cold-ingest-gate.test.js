/**
 * 冷启动摄取管线 live 闸门契约测试。
 *
 * AppBase 是 React class（依赖 antd / CSS modules），无法在 node:test 直接 import；
 * 按 test/sse-heartbeat.test.js 先例，镜像 AppBase.jsx 闸门核心行为做契约测试。
 * 镜像锚点（改动闸门语义时必须同步本文件）：
 *   - handleEventMessage 闸门段：_ingestRunning 时 live 条目入 _liveGateBuffer，不排 rAF flush
 *   - _commitColdIngest：token 校验 → 原子提交 → 回调里关闸 + 缓冲按到达序泄洪 + 单次 flush 调度
 *   - _abortColdIngest：token 自增 + 闸门复位（drain=true 时缓冲送回 _pendingEntries）
 *   - _failColdIngest：token 守卫（失配即 no-op）→ 委托 abort({drain:true}) → 关 loading + 重建索引
 *   - 管线入口 try/catch：抛错 → fail(myToken)（core.aborted 的 early return 属正常 supersede，不复位）
 *   - _teardownTransientLiveState 末段：token 自增 + 闸门复位（缓冲直接丢弃）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 源码锚点断言（drag-drop-zones.test.js 同款范式）：镜像测试无法 import React class，
// 用源码文本契约防止未来重构悄悄漂移（锚点失效 = 必须回来同步镜像）。
const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');

/** 镜像 AppBase 闸门状态机（setState 同步化；rAF 调度计数化） */
function mkGateHost() {
  return {
    _ingestRunning: false,
    _ingestToken: 0,
    _liveGateBuffer: [],
    _pendingEntries: [],
    _flushRafId: null,
    flushScheduleCount: 0,
    rebuildIndexCalls: 0,
    _ingestProgressCount: 0,
    _unmounted: false,
    state: {},

    _scheduleFlush() {
      if (!this._flushRafId) { this._flushRafId = 1; this.flushScheduleCount++; }
    },
    runFlush() { this._flushRafId = null; const b = this._pendingEntries; this._pendingEntries = []; return b; },

    // 镜像 AppBase.handleEventMessage
    handleEventMessage(entry) {
      if (this._ingestRunning) { this._liveGateBuffer.push(entry); return; }
      this._pendingEntries.push(entry);
      this._scheduleFlush();
    },

    // 镜像管线启动（_runSseColdIngest/_runLocalLogIngest 头部）
    startPipeline() {
      const myToken = ++this._ingestToken;
      this._ingestRunning = true;
      return myToken;
    },

    // 镜像 _commitColdIngest（setState + 回调同步执行）
    commit(myToken, newState) {
      if (this._ingestToken !== myToken || this._unmounted) return false;
      Object.assign(this.state, newState);
      if (this._ingestToken !== myToken) return false;
      this._ingestRunning = false;
      const buffered = this._liveGateBuffer;
      this._liveGateBuffer = [];
      if (buffered.length > 0) {
        this._pendingEntries.push(...buffered);
        this._scheduleFlush();
      }
      return true;
    },

    // 镜像 _abortColdIngest
    abort({ drain = false } = {}) {
      this._ingestToken++;
      this._ingestRunning = false;
      const buffered = this._liveGateBuffer;
      this._liveGateBuffer = [];
      if (drain && buffered.length > 0) {
        this._pendingEntries.push(...buffered);
        this._scheduleFlush();
      }
    },

    // 镜像 _teardownTransientLiveState 闸门段（_pendingEntries 同时清空）
    teardown() {
      this._pendingEntries = [];
      this._flushRafId = null;
      this._ingestToken++;
      this._ingestRunning = false;
      this._liveGateBuffer = [];
    },

    // 镜像 _failColdIngest：token 守卫 → 委托 abort({drain:true}) → 复位进度计数
    // + 关 loading → 重建索引（_repairIndexAfterFailedIngest，此处计数化；
    // 真实代码另保 _v2ColdSeed，镜像无 seed 概念，由锚点断言钉住，见文末）。
    fail(myToken) {
      if (this._ingestToken !== myToken || this._unmounted) return;
      this.abort({ drain: true });
      this._ingestProgressCount = 0;
      Object.assign(this.state, { fileLoading: false, fileLoadingCount: 0, fileLoadingBytes: null });
      this.rebuildIndexCalls++;
    },

    // 镜像管线入口的 try/catch 结构（_runSseColdIngest/_runLocalLogIngest）：
    // stepFn 抛错 → fail(myToken)；正常 early return（abort 语义）不复位。
    runPipeline(stepFn) {
      const myToken = this.startPipeline();
      try { stepFn(); } catch { this.fail(myToken); }
      return myToken;
    },
  };
}

describe('cold-ingest live gate (镜像 AppBase 闸门契约)', () => {
  it('源码锚点：失败路径关键不变量在 AppBase.jsx 中存在（防镜像漂移）', () => {
    assert.ok(APPBASE_SRC.includes('_failColdIngest(myToken)'), '_failColdIngest 存在');
    assert.ok(
      APPBASE_SRC.includes('if (this._ingestToken !== myToken || this._unmounted) return;\n    // Reuse the abort body'),
      '_failColdIngest 的 token 守卫在 abort 委托之前');
    assert.ok(APPBASE_SRC.includes('this._abortColdIngest({ drain: true });\n    this._ingestProgressCount = 0;'),
      'fail 路径复位进度计数');
    assert.ok(APPBASE_SRC.includes('const seed = this._v2ColdSeed;'), 'repair 保存 _v2ColdSeed');
    assert.ok(APPBASE_SRC.includes('this._v2ColdSeed = seed;'), 'repair 恢复 _v2ColdSeed');
    assert.ok(APPBASE_SRC.includes("reportSwallowed('sse.cold-ingest-repair', e)"), 'repair 包 try/catch');
    assert.ok(APPBASE_SRC.includes('if (!entry) return;'), '_processOneEntry 的 null 守卫');
    assert.ok(APPBASE_SRC.includes("reportSwallowed('sse.cold-ingest', err"), '管线入口 catch 上报');
    // v3 冷装配失败兜底（!assembled 分支）：闩死冻结的第二条路径。
    assert.ok(APPBASE_SRC.includes('let assembled = false;'), 'v3 装配 assembled 标志存在');
    assert.ok(APPBASE_SRC.includes("reportSwallowed('v3.cold-assemble-run', err)"), 'v3 装配外层 catch 上报');
    assert.ok(
      APPBASE_SRC.includes('if (!assembled) {'),
      'v3 装配失败分支存在');
    const failBranch = APPBASE_SRC.split('if (!assembled) {')[1] || '';
    const drainIdx = failBranch.indexOf('_abortColdIngest({ drain: true })');
    const pendingIdx = failBranch.indexOf('_v3DrainPendingLive()');
    assert.ok(drainIdx !== -1 && pendingIdx !== -1 && drainIdx < pendingIdx,
      '失败分支先开闸泄洪 _liveGateBuffer，再 drain _v3PendingLive（顺序敏感）');
    assert.ok(failBranch.includes('fileLoading: false'), '失败分支解除 loading 遮罩');
  });

  it('管线在途：live 条目入缓冲，不排 flush；非在途直通', () => {
    const h = mkGateHost();
    h.handleEventMessage({ id: 'a' });               // 非在途 → 直通
    assert.equal(h._pendingEntries.length, 1);
    assert.equal(h.flushScheduleCount, 1);
    h.runFlush();

    h.startPipeline();
    h.handleEventMessage({ id: 'b' });
    h.handleEventMessage({ id: 'c' });
    assert.deepEqual(h._liveGateBuffer.map(e => e.id), ['b', 'c'], '在途条目入闸门缓冲');
    assert.equal(h._pendingEntries.length, 0, '不进 pending');
    assert.equal(h.flushScheduleCount, 1, '不排新 flush');
  });

  it('提交后：缓冲按到达序泄洪到 pending + 单次 flush 调度', () => {
    const h = mkGateHost();
    const token = h.startPipeline();
    h.handleEventMessage({ id: 'x1' });
    h.handleEventMessage({ id: 'x2' });
    h.handleEventMessage({ id: 'x3' });
    const ok = h.commit(token, { requests: ['baseline'] });
    assert.equal(ok, true);
    assert.equal(h._ingestRunning, false, '闸门关闭');
    assert.deepEqual(h._liveGateBuffer, [], '缓冲清空');
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['x1', 'x2', 'x3'], '到达序泄洪');
    assert.equal(h.flushScheduleCount, 1, '恰一次 flush 调度');
    assert.deepEqual(h.state.requests, ['baseline'], '基线先提交，泄洪在提交之后');
  });

  it('supersede：旧管线 commit 不生效、不动闸门；新管线正常提交', () => {
    const h = mkGateHost();
    const t1 = h.startPipeline();
    h.handleEventMessage({ id: 'during-1' });
    const t2 = h.startPipeline();                    // 新管线启动 = bump token + 重开闸
    h.handleEventMessage({ id: 'during-2' });
    assert.equal(h.commit(t1, { requests: ['stale'] }), false, '旧 token 提交被拒');
    assert.equal(h.state.requests, undefined, '陈旧基线没有落地');
    assert.equal(h._ingestRunning, true, '旧管线不得碰闸门');
    assert.equal(h.commit(t2, { requests: ['fresh'] }), true);
    assert.deepEqual(h.state.requests, ['fresh']);
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['during-1', 'during-2'], '两轮缓冲都随新管线泄洪');
  });

  it('abort（不 drain）：token 失配 + 闸门复位 + 缓冲丢弃；后续 live 直通', () => {
    const h = mkGateHost();
    const token = h.startPipeline();
    h.handleEventMessage({ id: 'buffered' });
    h.abort();
    assert.equal(h._ingestRunning, false);
    assert.deepEqual(h._liveGateBuffer, []);
    assert.equal(h._pendingEntries.length, 0, '不 drain 则丢弃');
    assert.equal(h.commit(token, { requests: ['stale'] }), false, 'abort 后旧管线提交被拒');
    h.handleEventMessage({ id: 'next' });
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['next'], '闸门已开，live 直通');
  });

  it('abort（drain=true，full_reload 路径）：缓冲送回 pending 走正常 flush', () => {
    const h = mkGateHost();
    h.startPipeline();
    h.handleEventMessage({ id: 'd1' });
    h.handleEventMessage({ id: 'd2' });
    h.abort({ drain: true });
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['d1', 'd2']);
    assert.equal(h.flushScheduleCount, 1);
  });

  it('teardown：闸门复位 + pending/缓冲全清 + 旧管线提交被拒', () => {
    const h = mkGateHost();
    const token = h.startPipeline();
    h.handleEventMessage({ id: 't1' });
    h.teardown();
    assert.equal(h._ingestRunning, false);
    assert.deepEqual(h._liveGateBuffer, []);
    assert.deepEqual(h._pendingEntries, []);
    assert.equal(h.commit(token, { requests: ['stale'] }), false);
  });

  it('unmounted：commit 直接被拒，不碰任何状态', () => {
    const h = mkGateHost();
    const token = h.startPipeline();
    h._unmounted = true;
    assert.equal(h.commit(token, { requests: ['x'] }), false);
    assert.equal(h.state.requests, undefined);
  });

  it('管线抛错：闸门复位 + 缓冲按到达序泄洪 + 索引重建一次；后续 live 直通', () => {
    const h = mkGateHost();
    h.state.fileLoading = true;
    h._ingestProgressCount = 42;
    h.runPipeline(() => {
      h.handleEventMessage({ id: 'g' });
      throw new Error('boom');
    });
    assert.equal(h._ingestRunning, false, '闸门必须复位');
    assert.deepEqual(h._liveGateBuffer, [], '缓冲清空');
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['g'], '缓冲按到达序泄洪');
    assert.equal(h.flushScheduleCount, 1, '恰一次 flush 调度');
    assert.equal(h.rebuildIndexCalls, 1, '索引按已提交基线重建一次');
    assert.equal(h._ingestProgressCount, 0, '进度计数复位');
    assert.equal(h.state.fileLoading, false, 'loading 遮罩解除');
    assert.equal(h.state.requests, undefined, '失败管线不落地基线');
    h.handleEventMessage({ id: 'after' });
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['g', 'after'], '后续 live 直通，不再冻结');
  });

  it('陈旧管线抛错不得误伤新管线（token 守卫 no-op）', () => {
    const h = mkGateHost();
    const t1 = h.startPipeline();
    h.handleEventMessage({ id: 'during-1' });
    const t2 = h.startPipeline();                    // 新管线启动 = bump token + 重开闸
    h.handleEventMessage({ id: 'during-2' });
    h.fail(t1);                                      // 旧管线的迟到 rejection
    assert.equal(h._ingestRunning, true, '新管线闸门仍在');
    assert.deepEqual(h._liveGateBuffer.map(e => e.id), ['during-1', 'during-2'], '两轮缓冲都不动');
    assert.equal(h._pendingEntries.length, 0, '不得把缓冲泄到未提交基线');
    assert.equal(h.rebuildIndexCalls, 0, '不得重建索引');
    assert.equal(h.flushScheduleCount, 0, '不得调度 flush');
    assert.equal(h.commit(t2, { requests: ['fresh'] }), true, '新管线仍可正常提交');
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['during-1', 'during-2'], '提交后统一泄洪');
  });

  it('失败后新管线可正常启动并提交（fail 的 token 自增不阻塞后续管线）', () => {
    const h = mkGateHost();
    h.runPipeline(() => { throw new Error('boom'); });
    const t2 = h.startPipeline();
    h.handleEventMessage({ id: 'live-2' });
    assert.equal(h.commit(t2, { requests: ['fresh'] }), true);
    assert.deepEqual(h.state.requests, ['fresh']);
    assert.deepEqual(h._pendingEntries.map(e => e.id), ['live-2']);
  });

  it('管线正常 early return（abort 语义）：不触发 fail 复位', () => {
    const h = mkGateHost();
    const t = h.runPipeline(() => { /* core.aborted → return，无抛错 */ });
    assert.equal(h._ingestRunning, true, 'abort 语义下闸门归 supersede 方处置，入口不复位');
    assert.equal(h.rebuildIndexCalls, 0);
    assert.equal(h._ingestToken, t, 'token 未被 fail 顶掉');
  });
});
