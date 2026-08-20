/**
 * 冷启动摄取管线 live 闸门契约测试。
 *
 * AppBase 是 React class（依赖 antd / CSS modules），无法在 node:test 直接 import；
 * 按 test/sse-heartbeat.test.js 先例，镜像 AppBase.jsx 闸门核心行为做契约测试。
 * 镜像锚点（改动闸门语义时必须同步本文件）：
 *   - handleEventMessage 闸门段：_ingestRunning 时 live 条目入 _liveGateBuffer，不排 rAF flush
 *   - _commitColdIngest：token 校验 → 原子提交 → 回调里关闸 + 缓冲按到达序泄洪 + 单次 flush 调度
 *   - _abortColdIngest：token 自增 + 闸门复位（drain=true 时缓冲送回 _pendingEntries）
 *   - _teardownTransientLiveState 末段：token 自增 + 闸门复位（缓冲直接丢弃）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** 镜像 AppBase 闸门状态机（setState 同步化；rAF 调度计数化） */
function mkGateHost() {
  return {
    _ingestRunning: false,
    _ingestToken: 0,
    _liveGateBuffer: [],
    _pendingEntries: [],
    _flushRafId: null,
    flushScheduleCount: 0,
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
  };
}

describe('cold-ingest live gate (镜像 AppBase 闸门契约)', () => {
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
});
