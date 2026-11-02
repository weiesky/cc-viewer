/**
 * turn-active-gating.test.js — spinner 熄灭把关（turnActive gate）契约测试。
 *
 * 修复背景:isStreaming 的熄灭过去由「streaming_status{active:false} + 2s 防抖」
 * 驱动,粒度是单个 API 请求 —— 本地工具执行发生在两次 API 调用间隙,spinner
 * 在任务仍在跑时熄灭。修复 = 熄灭由回合级 turnActive 信号把关
 * (turn_active SSE / sdk-session-state WS / turn_end 兜底),防抖只负责灭灯时机
 * 平滑,不再决定「回合是否结束」。
 *
 * AppBase 是 React class 无法 node:test 直接 import;按 sse-connection-gen.test.js
 * 先例做「镜像状态机 + 源码锚点断言」契约测试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');

/** Mirror of AppBase's gated streaming-off state machine:
 *  streaming_status{active:false} → 2s debounce → clear isStreaming ONLY when
 *  turnActive is false; a turn-level clear drops both flags at once. The staleness
 *  escape measures silence from the last ACTIVE tick and SELF-RESCHEDULES while
 *  turnActive holds (no further streaming_status frame may ever arrive). */
function mkStreamingHost() {
  return {
    state: { isStreaming: false, turnActive: false },
    _streamingOffTimer: null,
    _turnStaleTimer: null,
    _turnActiveSince: null,
    _lastStreamActiveTs: null,
    TURN_ACTIVE_STALE_MS: 30 * 1000,
    _now: 0, // fake clock (ms)

    // mirrors _applyTurnActive
    applyTurnActive(active) {
      if (active) {
        if (this.state.turnActive) return;
        this._turnActiveSince = this._now;
        this._turnStaleTimer = 'armed'; // schedules checkTurnActiveStale at +30s
        this.state = { ...this.state, turnActive: true };
        return;
      }
      if (!this.state.turnActive) return;
      this._turnActiveSince = null;
      this._turnStaleTimer = null;
      this.clearOffTimer();
      this.state = { ...this.state, turnActive: false, isStreaming: false };
    },

    clearOffTimer() { this._streamingOffTimer = null; },

    // mirrors the streaming_status handler (2s debounce fires instantly here)
    onStreamingStatus(active) {
      if (active) {
        this.clearOffTimer();
        this._lastStreamActiveTs = this._now;
        this.state = { ...this.state, isStreaming: true };
      } else {
        this.clearOffTimer();
        this._streamingOffTimer = 'pending';
        this.fireOffTimer();
      }
    },

    fireOffTimer() {
      if (!this._streamingOffTimer) return;
      this._streamingOffTimer = null;
      if (this.state.turnActive) {
        this.checkTurnActiveStale(); // gated path defers to the staleness check
        return;
      }
      this.state = { ...this.state, isStreaming: false };
    },

    // mirrors _checkTurnActiveStale (self-rescheduling)
    checkTurnActiveStale() {
      if (!this.state.turnActive) return;
      const silentFor = this._now - (this._lastStreamActiveTs || 0);
      if (this._turnActiveSince != null && silentFor > this.TURN_ACTIVE_STALE_MS) {
        this.applyTurnActive(false);
        return;
      }
      this._turnStaleTimer = 'armed'; // re-arm
    },

    // fake clock advance: fires whichever timers would have elapsed
    advance(ms) {
      this._now += ms;
      if (this._turnStaleTimer) { this._turnStaleTimer = null; this.checkTurnActiveStale(); }
    },
  };
}

describe('turnActive 把关的 streaming 状态机(镜像)', () => {
  it('工具间隙(API 空闲 + turnActive=true)spinner 不灭', () => {
    const h = mkStreamingHost();
    h.applyTurnActive(true);          // UserPromptSubmit
    h.onStreamingStatus(true);        // API call 1 starts
    h.onStreamingStatus(false);       // API call 1 ends — local tool now executing
    assert.equal(h.state.isStreaming, true, 'turnActive 把关:间隙不灭灯');
  });

  it('回合结束(turnActive 下降沿)spinner 即灭,不等防抖', () => {
    const h = mkStreamingHost();
    h.applyTurnActive(true);
    h.onStreamingStatus(true);
    h.onStreamingStatus(false);
    h.applyTurnActive(false);         // Stop POST / sdk idle
    assert.equal(h.state.isStreaming, false);
    assert.equal(h.state.turnActive, false);
  });

  it('无 hook(hook 被删)时精确退化为旧行为:2s 防抖灭灯', () => {
    const h = mkStreamingHost();
    h.onStreamingStatus(true);
    h.onStreamingStatus(false);       // turnActive 从未亮起 → 把关失效
    assert.equal(h.state.isStreaming, false);
  });

  it('hook-only 回合丢 Stop POST:自调度陈旧兜底灭灯(不再依赖后续 tick)', () => {
    const h = mkStreamingHost();
    // 真实序列:回合起跑有 API 流量(亮灯)→ 之后长静默(Stop POST 丢失,
    // streaming_status inactive 不重发)→ 无任何后续 tick。兜底必须自己到期。
    h.applyTurnActive(true);          // UserPromptSubmit
    h.onStreamingStatus(true);        // API call runs
    h.advance(1000);
    h.onStreamingStatus(false);       // API ends; debounce gated → spinner survives
    assert.equal(h.state.isStreaming, true, '回合中文具间隙不灭灯');
    h.advance(29 * 1000);             // 30s 界未满 → 自调度再武装
    assert.equal(h.state.isStreaming, true);
    h.advance(2 * 1000);              // 越陈旧界 → 兜底灭灯(不更差)
    assert.equal(h.state.isStreaming, false);
    assert.equal(h.state.turnActive, false);
  });
});

describe('AppBase.jsx 源码锚点(防重构漂移)', () => {
  it('防抖回调内有 turnActive 把关(turnActive 为 true 不清 isStreaming)', () => {
    // Per-workspace channels (2026-10): turn state is read from the frame's OWN
    // channel vm (a tap channel's debounce must never inspect the rendered view).
    assert.ok(
      /vm\.streamingOffTimer = setTimeout\(\(\) => \{[\s\S]{0,200}?vm\.react\.turnActive/.test(APPBASE_SRC),
      'streaming off 防抖回调必须先查该 channel 的 turnActive');
  });

  it('turnActive 下降沿同时清 isStreaming(回合结束即灭灯)', () => {
    assert.ok(
      /_applyTurnActive = \(active, channel = null\)[\s\S]{0,1100}?turnActive: false, isStreaming: false/.test(APPBASE_SRC),
      '_applyTurnActive(false) 必须同时清 isStreaming');
  });

  it('turn_active SSE 监听已接线且带 stale 守卫', () => {
    // The binder registers every name in the frame-handler table on the socket
    // with the per-channel stale() guard, then dispatches per-name.
    assert.ok(
      /'turn_active': '_onTurnActive',/.test(APPBASE_SRC),
      '缺少 turn_active 帧处理器注册');
    assert.ok(
      /_bindChannelEvents\(channel, es, stale\) \{[\s\S]{0,300}?es\.addEventListener\(name, \(event\) => \{[\s\S]{0,120}?if \(stale\(\)\) return;/.test(APPBASE_SRC),
      '缺少带 stale 守卫的命名帧绑定');
  });

  it('SDK 模式经 onSdkSessionState 上提(白名单活跃态 + 按 viewed workspace 过滤)', () => {
    assert.ok(
      /handleSdkSessionState = \(state, meta\)/.test(APPBASE_SRC),
      'handleSdkSessionState 必须接收 meta(cwd)以过滤背景工作区帧');
    // Only the two KNOWN active states light the spinner (whitelist, not `!== 'idle'`),
    // and the cwd filter compares the frame's workspace basename to the viewed project.
    assert.ok(
      /_applyTurnActive\(state === 'running' \|\| state === 'requires_action'\)/.test(APPBASE_SRC),
      '必须白名单 running/requires_action(未知态不得点亮)');
    assert.ok(
      /frameProj && frameProj !== viewed\) return/.test(APPBASE_SRC),
      '缺少按 viewed workspace 的 cwd 过滤早退分支');
  });

  it('PTY Esc 中断嗅探存在(Request interrupted 标记)', () => {
    assert.ok(
      /\[Request interrupted/i.test(APPBASE_SRC) && /entry\?\.request\?\.body\?\.messages \|\| entry\?\.body\?\.messages/.test(APPBASE_SRC),
      '缺少终端 Esc 中断的 entry 嗅探,或字段路径未同时覆盖 v1/v2 entry');
  });

  it('工作区/视图切换复位 turnActive', () => {
    // workspace_started / workspace_stopped / handleReturnToWorkspaces 三处并列复位
    const hits = APPBASE_SRC.match(/turnActive: false/g) || [];
    assert.ok(hits.length >= 4, `复位点不足(含 state 初值/teardown/两个 workspace 分支),实际 ${hits.length}`);
  });
});
