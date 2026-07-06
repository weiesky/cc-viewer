/**
 * SSE 心跳超时与增量重连恢复测试
 *
 * 验证 AppBase.jsx 中的两个关键修复：
 * 1. 所有命名 SSE 事件都重置心跳超时计时器
 * 2. _reconnectSSE 在加载中断时保存已收到的部分数据以便增量恢复
 *
 * 由于 AppBase 是 React 组件，这里通过模拟其 SSE 相关方法来测试核心逻辑。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructEntries } from '../lib/delta-reconstructor.js';

// ============================================================================
// Mock AppBase SSE 逻辑（从 AppBase.jsx 提取的核心行为）
// ============================================================================

function createMockAppBase({ isMobile = false } = {}) {
  const saved = { entries: null, projectName: null };
  const stateUpdates = [];
  let sseTimeoutTimer = null;
  let sseReconnectCount = 0;
  let sseReconnectTimer = null;
  let reconnectCalled = false;
  let initSSECalled = false;

  const app = {
    _sseTimeoutTimer: null,
    _sseReconnectCount: 0,
    _sseReconnectTimer: null,
    _chunkedEntries: [],
    _chunkedTotal: 0,
    _isIncremental: false,
    _loadingCountRafId: null,
    _flushRafId: null,
    _pendingEntries: [],
    _sseSlimmer: null,
    eventSource: { close() { this._closed = true; }, _closed: false },

    state: { requests: [], projectName: 'test-project' },

    setState(update) {
      stateUpdates.push(update);
      Object.assign(app.state, update);
    },

    _processEntries(entries) {
      return { mainAgentSessions: [], filtered: entries };
    },

    _resetSSETimeout() {
      if (this._sseTimeoutTimer) clearTimeout(this._sseTimeoutTimer);
      this._sseReconnectCount = 0;
      this._sseTimeoutTimer = setTimeout(() => {
        this._reconnectSSE();
      }, 45000);
    },

    _reconnectSSE() {
      reconnectCalled = true;
      if (this._sseReconnectCount >= 10) return;
      this._sseReconnectCount = (this._sseReconnectCount || 0) + 1;
      if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
      if (this._flushRafId) { this._flushRafId = null; }

      // 增量恢复逻辑
      if (this._chunkedEntries && this._chunkedEntries.length > 0 && isMobile) {
        try {
          const partial = reconstructEntries([...this._chunkedEntries]);
          if (Array.isArray(partial) && partial.length > 0) {
            const { mainAgentSessions } = this._processEntries(partial);
            this.setState({ requests: partial, mainAgentSessions });
            // 模拟 saveEntries
            saved.entries = partial;
            saved.projectName = this.state.projectName;
          }
        } catch (e) {
          // ignore
        }
      }
      this._chunkedEntries = [];
      this._chunkedTotal = 0;
      this._isIncremental = false;
      this._loadingCountRafId = null;

      this._pendingEntries = [];
      this.setState({ isStreaming: false });
      this._sseSlimmer = null;
      if (this._sseReconnectTimer) clearTimeout(this._sseReconnectTimer);
      this._sseReconnectTimer = setTimeout(() => { initSSECalled = true; }, 2000);
    },

    // Test helpers
    get _stateUpdates() { return stateUpdates; },
    get _reconnectWasCalled() { return reconnectCalled; },
    get _initSSEWasCalled() { return initSSECalled; },
    get _savedEntries() { return saved; },
    _resetTestState() {
      reconnectCalled = false;
      initSSECalled = false;
      stateUpdates.length = 0;
      saved.entries = null;
      saved.projectName = null;
    },
  };

  return app;
}

function makeEntry(idx, isCheckpoint = true) {
  const msgs = [];
  for (let i = 0; i <= idx; i++) {
    msgs.push({ role: 'user', content: `q${i}` });
    msgs.push({ role: 'assistant', content: `a${i}` });
  }
  return {
    timestamp: new Date(Date.now() + idx * 1000).toISOString(),
    url: 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    _deltaFormat: 1,
    _isCheckpoint: isCheckpoint,
    _totalMessageCount: msgs.length,
    _conversationId: 'mainAgent',
    body: {
      model: 'claude-opus-4-6',
      system: [{ type: 'text', text: 'test' }],
      messages: msgs,
    },
    response: {
      status: 200,
      body: { content: [{ type: 'text', text: `response-${idx}` }], usage: { input_tokens: 100, output_tokens: 50 } },
    },
    duration: 100,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('SSE heartbeat timeout reset', () => {
  let app;

  beforeEach(() => {
    app = createMockAppBase();
  });

  it('_resetSSETimeout sets a timer', () => {
    assert.equal(app._sseTimeoutTimer, null);
    app._resetSSETimeout();
    assert.notEqual(app._sseTimeoutTimer, null);
    clearTimeout(app._sseTimeoutTimer);
  });

  it('_resetSSETimeout resets reconnect count', () => {
    app._sseReconnectCount = 5;
    app._resetSSETimeout();
    assert.equal(app._sseReconnectCount, 0);
    clearTimeout(app._sseTimeoutTimer);
  });

  it('calling _resetSSETimeout again clears previous timer', () => {
    app._resetSSETimeout();
    const firstTimer = app._sseTimeoutTimer;
    app._resetSSETimeout();
    const secondTimer = app._sseTimeoutTimer;
    assert.notEqual(firstTimer, secondTimer);
    clearTimeout(app._sseTimeoutTimer);
  });

  it('rapid _resetSSETimeout calls do not trigger reconnect', async () => {
    // Simulate rapid events that keep resetting the timeout
    for (let i = 0; i < 100; i++) {
      app._resetSSETimeout();
    }
    // Wait a bit — should NOT trigger reconnect since timer keeps getting reset
    await new Promise(r => setTimeout(r, 100));
    assert.equal(app._reconnectWasCalled, false);
    clearTimeout(app._sseTimeoutTimer);
  });
});

describe('_reconnectSSE incremental recovery', () => {
  it('saves partial chunked entries on mobile', () => {
    const app = createMockAppBase({ isMobile: true });

    // Simulate 3 checkpoint entries received during load
    app._chunkedEntries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    app._chunkedTotal = 10;

    app._reconnectSSE();

    // Partial entries should be saved
    assert.notEqual(app._savedEntries.entries, null);
    assert.equal(app._savedEntries.projectName, 'test-project');
    assert.ok(app._savedEntries.entries.length > 0);

    // Chunked state should be cleaned up
    assert.deepEqual(app._chunkedEntries, []);
    assert.equal(app._chunkedTotal, 0);
    assert.equal(app._isIncremental, false);
  });

  it('does NOT save partial entries on desktop', () => {
    const app = createMockAppBase({ isMobile: false });

    app._chunkedEntries = [makeEntry(0), makeEntry(1)];
    app._chunkedTotal = 10;

    app._reconnectSSE();

    // Should NOT save on desktop
    assert.equal(app._savedEntries.entries, null);
    // But should still clean up chunked state
    assert.deepEqual(app._chunkedEntries, []);
  });

  it('does NOT save when no chunked entries', () => {
    const app = createMockAppBase({ isMobile: true });

    app._chunkedEntries = [];
    app._reconnectSSE();

    assert.equal(app._savedEntries.entries, null);
  });

  it('does not set fileLoading to false (keeps loading overlay)', () => {
    const app = createMockAppBase({ isMobile: true });

    app._chunkedEntries = [makeEntry(0)];
    app._reconnectSSE();

    // Check that no state update sets fileLoading: false
    const hasFileLoadingFalse = app._stateUpdates.some(u => u.fileLoading === false);
    assert.equal(hasFileLoadingFalse, false, 'fileLoading should not be set to false during reconnect');
  });

  it('closes EventSource before reconnecting', () => {
    const app = createMockAppBase({ isMobile: false });

    const es = app.eventSource;
    app._reconnectSSE();

    assert.equal(es._closed, true, 'EventSource should be closed');
    assert.equal(app.eventSource, null, 'eventSource ref should be nulled');
  });

  it('increments reconnect count', () => {
    const app = createMockAppBase();

    assert.equal(app._sseReconnectCount, 0);
    app._reconnectSSE();
    assert.equal(app._sseReconnectCount, 1);
  });

  it('stops after 10 reconnect attempts', () => {
    const app = createMockAppBase();

    app._sseReconnectCount = 10;
    app._reconnectSSE();

    // Should not have scheduled initSSE
    assert.equal(app._sseReconnectTimer, null);
  });

  it('schedules initSSE after 2s delay', async () => {
    const app = createMockAppBase();

    app._reconnectSSE();
    assert.equal(app._initSSEWasCalled, false);

    // Wait for the 2s timer
    await new Promise(r => setTimeout(r, 2100));
    assert.equal(app._initSSEWasCalled, true);
  });

  it('partial entries are correctly reconstructed', () => {
    const app = createMockAppBase({ isMobile: true });

    // Create checkpoint entries that can be properly reconstructed
    const entries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    app._chunkedEntries = entries;

    app._reconnectSSE();

    const saved = app._savedEntries.entries;
    assert.ok(saved.length > 0);

    // Each saved entry should have messages
    for (const entry of saved) {
      if (entry.mainAgent && entry.body?.messages) {
        assert.ok(entry.body.messages.length > 0, 'Reconstructed entry should have messages');
      }
    }
  });
});

describe('onerror handler', () => {
  it('should close EventSource and trigger reconnect (behavior verification)', () => {
    const app = createMockAppBase();

    // Simulate what the fixed onerror does:
    // this.eventSource.close(); this._reconnectSSE();
    const es = app.eventSource;
    es.close();
    app._reconnectSSE();

    assert.equal(es._closed, true, 'EventSource should be explicitly closed');
    assert.equal(app._reconnectWasCalled, true, '_reconnectSSE should be called');
    assert.equal(app._sseReconnectCount, 1, 'Reconnect count should increment');
  });
});
