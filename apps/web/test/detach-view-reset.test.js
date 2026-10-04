/**
 * 对话区项目归属错乱修复（2026-10）—— handleDetachView 全量重置 +
 * _runSseColdIngest 非增量空提交清零。
 *
 * 背景：点「绑定项目 tab」（如 ccbot）时路由走 handleDetachView 而非
 * handleActivateChip。旧实现只清 attachedSid/viewedProject/pinnedSessionTs，
 * 不清 requests/mainAgentSessions/v2Rows，且不置遮罩——并行项目（finqa）的
 * committed 对话残留在 state 里，直到绑定项目冷加载提交；冷加载为空时
 * （empty 分支只清 fileLoading）残留永久存在。
 *
 * AppBase 是 React class 无法直接 import；按 house 先例用
 * 「镜像状态机 + 源码锚点断言」做契约测试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APPBASE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/AppBase.jsx'), 'utf8');

/** 镜像 handleDetachView 修复后的关键动作（setState 同步化）。 */
function mkDetachHost() {
  return {
    state: {
      attachedSid: null,
      viewedProject: 'finqa-remote-cc',
      pinnedSessionTs: 'pin-finqa',
      projectName: 'ccbot',
      requests: [{ timestamp: 't1', url: '/v1/messages' }],
      mainAgentSessions: [{ messages: [] }],
      v2Rows: [{ timestamp: 't1', sessionId: 's', seq: 1 }],
      v2RowsMeta: { totalCount: 1, hasMore: false, oldestTs: '' },
      selectedIndex: 0,
      resumeSwitch: null,
    },
    _pendingEntries: [{ timestamp: 't2' }],
    _flushRafId: 1,
    _hydratePinSeq: 0,
    calls: [],
    setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); },
    _resetForViewSwitch() { this.calls.push('reset'); },
    initSSE() { this.calls.push('initSSE'); },
    _maintainPinState() { this.calls.push('maintainPin'); },
    // 镜像修复后的 handleDetachView
    handleDetachView() {
      if (!this.state.attachedSid && !this.state.viewedProject) return;
      this._pendingEntries = [];
      if (this._flushRafId) { this._flushRafId = null; }
      this.setState({ resumeSwitch: { uuid: this.state.projectName || 'bound' } });
      this.setState({
        attachedSid: null, viewedProject: null, pinnedSessionTs: null,
        requests: [], mainAgentSessions: [], v2Rows: [],
        v2RowsMeta: { totalCount: 0, hasMore: false, oldestTs: '' },
        selectedIndex: null,
      });
      this._hydratePinSeq++;
      this._resetForViewSwitch();
      this.initSSE();
      this._maintainPinState(null);
    },
  };
}

describe('handleDetachView 全量重置（对话区错乱修复）', () => {
  it('清 entries + 置遮罩 + 丢未冲刷缓冲 + 走完整重连链', () => {
    const h = mkDetachHost();
    h.handleDetachView();
    assert.deepEqual(h.state.requests, [], 'requests 清空');
    assert.deepEqual(h.state.mainAgentSessions, [], 'mainAgentSessions 清空');
    assert.deepEqual(h.state.v2Rows, [], 'v2Rows 清空');
    assert.deepEqual(h.state.v2RowsMeta, { totalCount: 0, hasMore: false, oldestTs: '' });
    assert.equal(h.state.selectedIndex, null);
    assert.equal(h.state.viewedProject, null);
    assert.deepEqual(h.state.resumeSwitch, { uuid: 'ccbot' }, '遮罩以绑定项目为 key');
    assert.deepEqual(h._pendingEntries, [], '未冲刷 live 缓冲丢弃（防切后冲刷进绑定视图）');
    assert.equal(h._flushRafId, null, 'rAF 取消');
    assert.deepEqual(h.calls, ['reset', 'initSSE', 'maintainPin']);
  });

  it('无附着无并行视图时 no-op（原语义保留）', () => {
    const h = mkDetachHost();
    h.state.viewedProject = null;
    const before = { ...h.state };
    h.handleDetachView();
    assert.deepEqual(h.state.requests, before.requests, '未触发重置');
    assert.deepEqual(h.calls, []);
  });
});

describe('AppBase.jsx 源码锚点（防未来重构漂移）', () => {
  it('handleDetachView 清全部对话 state 并置 resumeSwitch 遮罩', () => {
    assert.ok(/handleDetachView = \(\) => \{[\s\S]{0,1200}?resumeSwitch: \{ uuid: this\.state\.projectName \|\| 'bound' \}/.test(APPBASE_SRC),
      'handleDetachView 缺 resumeSwitch 遮罩');
    assert.ok(/handleDetachView = \(\) => \{[\s\S]{0,1600}?requests: \[\],/.test(APPBASE_SRC), 'handleDetachView 缺 requests 清空');
    assert.ok(/handleDetachView = \(\) => \{[\s\S]{0,1600}?mainAgentSessions: \[\],/.test(APPBASE_SRC), 'handleDetachView 缺 mainAgentSessions 清空');
    assert.ok(/handleDetachView = \(\) => \{[\s\S]{0,1600}?v2Rows: \[\],/.test(APPBASE_SRC), 'handleDetachView 缺 v2Rows 清空');
  });

  it('handleDetachView 丢弃 _pendingEntries 并取消 _flushRafId', () => {
    const re = /handleDetachView = \(\) => \{[\s\S]{0,400}?this\._pendingEntries = \[\];[\s\S]{0,120}?this\._flushRafId = null;/;
    assert.ok(re.test(APPBASE_SRC), 'handleDetachView 丢缓冲/取消 rAF');
  });

  it('_runSseColdIngest empty 分支在非增量时清零 entries、增量时不清', () => {
    // 锚到 _runSseColdIngest 的 empty 分支（:1056 起），窗口覆盖中间注释块。
    assert.ok(/if \(core\.empty\) \{[\s\S]{0,800}?if \(!isIncremental\) \{/.test(APPBASE_SRC), 'empty 分支缺 isIncremental 守卫');
    assert.ok(/if \(!isIncremental\) \{[\s\S]{0,300}?st\.requests = \[\];/.test(APPBASE_SRC), 'empty 分支非增量缺 requests 清零');
    assert.ok(/if \(!isIncremental\) \{[\s\S]{0,300}?st\.mainAgentSessions = \[\];/.test(APPBASE_SRC), 'empty 分支非增量缺 mainAgentSessions 清零');
  });
});
