/**
 * 流式中切换 viewed 项目 → 对话区串扰修复（2026-10-05）—— 双通道契约测试。
 *
 * 背景（用户复现）：server 绑 sage，sage tab 发"hi"流式中立即点 finqa-remote-cc
 * tab 切 viewedProject，再发问。结果 [终端]正确、[对话]错乱——sage 的 hi 回复
 * 混进 viewing finqa 的对话区；静态切换正常。
 *
 * 根因 A（前端）：_resetForViewSwitch 清了 streamingLatest 但漏清
 *   _pendingEntries/_flushRafId。切换前已入缓冲的 sage 流式 entry，在切换后
 *   下一帧被 _flushPendingEntries 合并进已变为 finqa 的 prev.requests。
 *   对齐 handleDetachView(559-560)/_teardownTransientLiveState(1353-1354)。
 *
 *   （曾考虑在 _flushPendingEntries 的 commit 点按 entry.project 过滤缓冲，
 *   已回退。真正死因是 wire v3：buildEntry(v3Assembler.js) 根本不打 .project，
 *   v3 下该守卫恒 no-op 纯属摆设；且 v3 是主格式。故前端只保留"切换时清缓冲"
 *   这一道，归属由服务端路由兜底。）
 *
 * 跨项目串扰实际由**四道防线**共同闭合，少任何一道都有缝，勿删其一：
 *   1. 切换时清缓冲（本测试改动1）：丢弃已入 _pendingEntries 的旧项目 entry；
 *   2. 服务端按 viewed 路由（改动2）：resolveActivityFeedKey 无 feed 即弃 +
 *      filterClientsByViewProject 只投该项目 viewer；
 *   3. _sseGen 代际守卫：堵"清缓冲后、事件循环里已排队的旧项目 entry 回调"——
 *      旧 EventSource listener 顶部 if(stale())return，过期帧根本到不了
 *      _ingestLiveEntry。没有它，排队 entry 会穿过"已清缓冲"灌进新视图；
 *   4. _ingestToken：_abortColdIngest 自增，陈旧旧项目冷载在 _commitColdIngest
 *      处 return，灌不进新视图。
 *
 * 根因 B（服务端）：_feedForSessionDir 找不到对应项目 feed 时曾 _boundFeed()
 *   兜底，把 sage 的 live 投给 viewing finqa 的客户端。改为"无 feed 即弃"。
 *
 * AppBase/server 是 class/模块单例无法直接 import；按 house 先例（detach-view-
 * reset.test.js / view-router.test.js）用「镜像状态机 + 源码锚点断言」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WEB_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');
const SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../packages/app/server/server.js'), 'utf8');

/** 镜像 _resetForViewSwitch 修复后的关键清场动作。 */
function mkSwitchHost() {
  return {
    state: { streamingLatest: { timestamp: 't9' }, isStreaming: true },
    _pendingEntries: [{ timestamp: 't2', project: 'sage' }],
    _flushRafId: 1,
    _sseReconnectCount: 3,
    _currentSessionId: 'sid-1',
    calls: [],
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); },
    _abortColdIngest() { this.calls.push('abort'); },
    _v3ResetClientState() { this.calls.push('v3reset'); },
    _rebuildRequestIndex() { this.calls.push('reindex'); },
    // 镜像修复后的 _resetForViewSwitch
    _resetForViewSwitch() {
      this._abortColdIngest();
      this._v3ResetClientState();
      this._rebuildRequestIndex([]);
      this._currentSessionId = null;
      this._sseReconnectCount = 0;
      this._pendingStreamingLatest = null;
      this._pendingEntries = [];
      if (this._flushRafId) { this._flushRafId = null; }
      this.setState({ streamingLatest: null, isStreaming: false });
    },
  };
}

describe('_resetForViewSwitch 清场（流式切换串扰修复）', () => {
  it('丢弃 _pendingEntries 并取消 _flushRafId（防切后冲刷进新 viewed 视图）', () => {
    const h = mkSwitchHost();
    h._resetForViewSwitch();
    assert.deepEqual(h._pendingEntries, [], '切换前缓冲的 live entry 丢弃');
    assert.equal(h._flushRafId, null, '已排程的 rAF 取消');
    assert.equal(h.state.streamingLatest, null, 'streamingLatest 清空');
    assert.equal(h.state.isStreaming, false, 'isStreaming 复位');
    assert.deepEqual(h.calls, ['abort', 'v3reset', 'reindex']);
  });
});

describe('AppBase.jsx 源码锚点（防未来重构漂移）', () => {
  it('_resetForViewSwitch 丢弃 _pendingEntries 并取消 _flushRafId', () => {
    const re = /_resetForViewSwitch\(\) \{[\s\S]{0,600}?this\._pendingEntries = \[\];[\s\S]{0,160}?this\._flushRafId = null;/;
    assert.ok(re.test(WEB_SRC), '_resetForViewSwitch 缺 _pendingEntries 清空 / _flushRafId 取消');
  });
});

describe('server.js _feedForSessionDir 路由（无 feed 即弃）', () => {
  // 路由决策已抽为纯函数 resolveActivityFeedKey（lib/v2/view-router.js），行为级
  // 测试在 packages/app/test/view-router.test.js（两 projectSan 各自保 key、无 feed
  // 不兜底 bound、项目根外才 bound 兜底）。此处仅锚 server.js 确实走该纯函数、
  // 且无 feed 时返回 null（不再 _boundFeed() 错投），防"逻辑被改回兜底"的回归。
  it('_feedForSessionDir 经 resolveActivityFeedKey 路由，无 feed 即弃不兜底', () => {
    const m = SERVER_SRC.match(/function _feedForSessionDir\(dir\) \{[\s\S]{0,600}?\n\}/);
    assert.ok(m, '_feedForSessionDir 定义未找到');
    const body = m[0];
    assert.ok(/resolveActivityFeedKey\(dir, LOG_DIR, sep\)/.test(body),
      '_feedForSessionDir 未走 resolveActivityFeedKey 纯函数（路由规则可能漂移）');
    assert.ok(/\|\| null;/.test(body), '缺 "无 feed → null"（仍存在串项目兜底风险）');
    // feedKey 命中分支内不得直接兜底 _boundFeed()。
    assert.ok(!/if \(feedKey\) return [^;]*_boundFeed\(\)/.test(body),
      'feedKey 命中分支仍兜底 _boundFeed()（串扰通道未堵）');
  });

  it('仅当无 owning project（allowBoundFallback）时才 bound 兜底', () => {
    const m = SERVER_SRC.match(/function _feedForSessionDir\(dir\) \{[\s\S]{0,600}?\n\}/);
    assert.ok(m, '_feedForSessionDir 定义未找到');
    assert.ok(/allowBoundFallback \? _boundFeed\(\) : null;/.test(m[0]),
      '缺 "仅项目根外才 bound 兜底" 的守卫');
  });
});
