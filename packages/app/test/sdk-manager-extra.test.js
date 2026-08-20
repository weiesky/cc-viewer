/**
 * sdk-manager-extra.test.js
 *
 * 覆盖目标：server/lib/sdk-manager.js 的会话生命周期与守卫/状态机分支。
 *
 * 环境事实（本测试依赖之）：@anthropic-ai/claude-agent-sdk 包已安装，所以
 * isSdkAvailable() === true。注意：SDK 的平台原生二进制（如
 * @anthropic-ai/claude-agent-sdk-<platform>/claude）在本环境实际是【存在】的，
 * 真实 _query 迭代时会去 spawn 它，但该 spawn 在毫秒级失败、SDK 抛出非
 * AbortError —— 这是一个【环境状态】，不应作为测试确定性的依据。
 *
 * 因此 sendUserMessage 相关用例改用 __setQueryForTests 注入一个【立即抛非
 * AbortError 的 fake query】（与 sdk-manager-query.test.js 同源做法），把
 * 「query 一迭代就失败被吞」从隐性环境事实变成测试可控的注入，确定性、零网络、
 * 零长定时器地驱动 sendUserMessage → _executeQuery 的完整外壳：
 *   - 进入前 buildStreamingStatus(true) 回调
 *   - 注入的 fake query 立即失败被吞
 *   - finally 里 _resetStreamingState + buildStreamingStatus(false) 回调
 *   - 并发时的 _queryBusy 队列守卫与队列 drain 循环
 * 用例结束后在 after() 里把 _query 还原为真实 SDK query，避免污染同进程其它断言。
 *
 * 真正需要 SDK 真实会话才能到达的深层路径（_processMessage 的 message→entry
 * 转换、_processStreamEvent 流式累积、_handleCanUseTool 的 ask/plan/perm 审批
 * 与 _waitForApproval 定时器）由姊妹文件 sdk-manager-query.test.js 用更完整的
 * fake query 覆盖。本文件聚焦【可达的守卫/状态机/参数分支】并对外部可观测行为
 * 做精确断言。
 */

import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSdkAvailable,
  initSdkSession,
  sendUserMessage,
  resolveApproval,
  cancelApproval,
  stopSession,
  interruptTurn,
  getSessionId,
  __setQueryForTests,
} from '../server/lib/sdk-manager.js';

// fake query：被迭代时立即抛非 AbortError，sdk-manager 在 _executeQuery 里 try/catch
// 吞掉并照常执行 finally —— 取代「真实 query 必然立即 spawn 失败」这一环境依赖。
function makeFailingQuery() {
  return function fakeQuery() {
    return {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        throw new Error('fake query immediate failure (non-AbortError)');
      },
      interrupt() { return Promise.resolve(); },
      close() {},
    };
  };
}

// 收集回调的小工厂：返回 deps 对象 + 各回调记录数组
function makeDeps(extra = {}) {
  const statuses = [];
  const entries = [];
  const broadcasts = [];
  const turnEnds = [];
  const deps = {
    onEntry: (e) => entries.push(e),
    onStreamingStatus: (s) => statuses.push(s),
    broadcastWs: (m) => broadcasts.push(m),
    onTurnEnd: (x) => turnEnds.push(x),
    ...extra,
  };
  return { deps, statuses, entries, broadcasts, turnEnds };
}

describe('sdk-manager — environment preconditions', () => {
  it('SDK 包已安装 → isSdkAvailable() 为 true（本套件其余断言据此成立）', () => {
    // 若哪天环境里 SDK 不存在，这条会先红，提示后续 sendUserMessage 测试不适用。
    assert.equal(isSdkAvailable(), true);
  });
});

describe('sdk-manager — initSdkSession', () => {
  it('不抛错并把会话状态重置（getSessionId 归 null）', () => {
    const { deps } = makeDeps();
    assert.doesNotThrow(() => initSdkSession('/tmp/cwd', 'my-proj', deps));
    assert.equal(getSessionId(), null);
  });

  it('permissionMode 缺省时不抛（内部默认 default）', () => {
    assert.doesNotThrow(() =>
      initSdkSession('/tmp/cwd', 'p', {
        onEntry: () => {},
        onStreamingStatus: () => {},
        broadcastWs: () => {},
      }),
    );
  });

  it('重新 init 会清掉上一轮的会话连续性', () => {
    initSdkSession('/a', 'p1', makeDeps().deps);
    initSdkSession('/b', 'p2', makeDeps().deps);
    assert.equal(getSessionId(), null);
  });
});

// 文件级注入：所有调用 sendUserMessage 的用例（含 interruptTurn / stopSession 段落）
// 都走「立即失败」的 fake query，把确定性从环境事实（真实二进制 spawn 必失败）改成可控注入。
// after() 还原真实 query，避免污染同进程其它 sdk-manager 测试文件。
let _realQuery;
before(async () => {
  try {
    const real = await import('@anthropic-ai/claude-agent-sdk');
    _realQuery = real.query;
  } catch { _realQuery = undefined; }
  __setQueryForTests(makeFailingQuery());
});
after(() => {
  __setQueryForTests(_realQuery);
  stopSession();
});

describe('sdk-manager — sendUserMessage 驱动 _executeQuery 外壳', () => {
  beforeEach(() => {
    // 每个用例独立：先做一次硬清理，避免上一个用例残留 _queryBusy/queue。
    stopSession();
  });

  it('default 模式：注入的 fake query 立即失败被吞 → resolve（不抛）+ 两次 streaming-status', async () => {
    const { deps, statuses, entries, turnEnds } = makeDeps();
    initSdkSession('/tmp/no-such-cwd', 'proj', deps);

    await assert.doesNotReject(() => sendUserMessage('hello'));

    // _executeQuery 进入时 buildStreamingStatus(true)，finally 里 buildStreamingStatus(false)
    assert.deepEqual(
      statuses.map((s) => s.active),
      [true, false],
    );
    // 第一条是 active 形态：含 model(null) + startTime + 计数器归零
    const first = statuses[0];
    assert.equal(first.active, true);
    assert.equal(first.model, null);
    assert.equal(typeof first.startTime, 'number');
    assert.equal(first.bytesReceived, 0);
    assert.equal(first.chunksReceived, 0);
    // 第二条只有 active:false
    assert.deepEqual(statuses[1], { active: false });

    // query 在产生任何 assistant/result 消息前就失败 → 没有 entry，没有 turnEnd
    assert.equal(entries.length, 0);
    assert.equal(turnEnds.length, 0);
    // 会话 id 仍为 null（没有 system 消息写入）
    assert.equal(getSessionId(), null);
  });

  it('bypassPermissions 模式：同样走 _executeQuery 并产出 active/inactive 状态对', async () => {
    // 该模式命中 canUseTool=undefined + allowDangerouslySkipPermissions 的 options 分支
    const { deps, statuses } = makeDeps();
    initSdkSession('/tmp/no-such-cwd', 'proj', {
      ...deps,
      permissionMode: 'bypassPermissions',
    });

    await assert.doesNotReject(() => sendUserMessage('go'));
    assert.deepEqual(
      statuses.map((s) => s.active),
      [true, false],
    );
  });

  it('onStreamingStatus 为空时不抛（回调可选）', async () => {
    initSdkSession('/tmp/no-such-cwd', 'proj', {
      onEntry: () => {},
      onStreamingStatus: null,
      broadcastWs: () => {},
    });
    await assert.doesNotReject(() => sendUserMessage('x'));
  });

  it('并发 sendUserMessage：第二条命中 _queryBusy 守卫被入队，随后 drain 执行', async () => {
    // 第一次调用置 _queryBusy=true 并跑 _executeQuery（立即失败）；
    // 在它的 await 让出期间第二次调用应直接入队并 resolve（return undefined），
    // 不会自己再开一个并行 query。drain 循环随后跑掉第二条。
    // 外部可观测：streaming-status 恰好两组 active/inactive 对 = 两次 _executeQuery。
    const { deps, statuses } = makeDeps();
    initSdkSession('/tmp/no-such-cwd', 'proj', deps);

    const p1 = sendUserMessage('first');
    const p2 = sendUserMessage('second');
    const r2 = await p2; // 入队分支直接 return undefined
    await p1;

    assert.equal(r2, undefined);
    assert.deepEqual(
      statuses.map((s) => s.active),
      [true, false, true, false],
    );
  });

  it('连续两次（await 之间）：第二条不再被入队，独立成对触发状态', async () => {
    const { deps, statuses } = makeDeps();
    initSdkSession('/tmp/no-such-cwd', 'proj', deps);

    await sendUserMessage('a');
    await sendUserMessage('b');

    assert.deepEqual(
      statuses.map((s) => s.active),
      [true, false, true, false],
    );
  });
});

describe('sdk-manager — resolveApproval（无 pending 时的守卫）', () => {
  beforeEach(() => stopSession());

  it('未知 id 返回 false', () => {
    assert.equal(resolveApproval('nope', 'allow'), false);
  });

  it('空字符串 id 返回 false', () => {
    assert.equal(resolveApproval('', { decision: 'allow' }), false);
  });

  it('value 任意结构都不抛，仅看 id 是否命中', () => {
    assert.equal(resolveApproval('ghost', { answers: [{ a: 1 }] }), false);
    assert.equal(resolveApproval('ghost', null), false);
  });
});

describe('sdk-manager — cancelApproval（无 pending 时的守卫）', () => {
  beforeEach(() => stopSession());

  it('未知 id 返回 false', () => {
    assert.equal(cancelApproval('nope', 'User aborted'), false);
  });

  it('空字符串 id 返回 false', () => {
    assert.equal(cancelApproval('', 'reason'), false);
  });

  it('reason 缺省/null/undefined 都容错不抛', () => {
    assert.doesNotThrow(() => cancelApproval('ghost'));
    assert.doesNotThrow(() => cancelApproval('ghost', null));
    assert.doesNotThrow(() => cancelApproval('ghost', undefined));
    // 均因 id 未命中而返回 false
    assert.equal(cancelApproval('ghost'), false);
  });
});

describe('sdk-manager — interruptTurn', () => {
  beforeEach(() => stopSession());

  it('无 active query / 无 pending 时返回空数组且不抛', () => {
    const r = interruptTurn();
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 0);
  });

  it('不动 _sessionId（保会话续连语义）—— 无会话时仍为 null', () => {
    interruptTurn();
    assert.equal(getSessionId(), null);
  });

  it('在一次失败的 sendUserMessage 之后调用仍返回空数组', async () => {
    initSdkSession('/tmp/no-such-cwd', 'proj', makeDeps().deps);
    await sendUserMessage('hi');
    const r = interruptTurn();
    assert.deepEqual(r, []);
  });

  it('返回值始终是数组（多次调用幂等）', () => {
    assert.deepEqual(interruptTurn(), []);
    assert.deepEqual(interruptTurn(), []);
  });
});

describe('sdk-manager — stopSession', () => {
  beforeEach(() => stopSession());

  it('无 active 会话时不抛', () => {
    assert.doesNotThrow(() => stopSession());
  });

  it('调用后 getSessionId 为 null（_resetFullState 清空）', () => {
    stopSession();
    assert.equal(getSessionId(), null);
  });

  it('init 之后 stop：会话 id 仍归 null，且后续 interrupt/resolve 守卫照常', async () => {
    initSdkSession('/tmp/no-such-cwd', 'proj', makeDeps().deps);
    await sendUserMessage('hi');
    stopSession();
    assert.equal(getSessionId(), null);
    assert.equal(resolveApproval('x', 'allow'), false);
    assert.deepEqual(interruptTurn(), []);
  });
});

describe('sdk-manager — getSessionId', () => {
  beforeEach(() => stopSession());

  it('无会话时返回 null', () => {
    assert.equal(getSessionId(), null);
  });

  it('init 不会凭空产生 session id', () => {
    initSdkSession('/tmp/cwd', 'p', makeDeps().deps);
    assert.equal(getSessionId(), null);
  });
});
