/**
 * branch-lib-sdk-manager.test.js
 *
 * 分支补强：server/lib/sdk-manager.js。姊妹文件 sdk-manager-query.test.js 已覆盖
 * 绝大多数路径，但显式放过了三处 _waitForApproval 超时分支（plan / ask / perm
 * 三条 "Timeout waiting..." deny）。原因是真实 5min/24h 定时器到点才触达，且
 * mock.timers 与其它定时器互相干扰有挂死风险。
 *
 * 本文件用收窄的做法消除该风险：
 *   - 只 mock.timers.enable({ apis: ['setTimeout'] })；
 *   - fake query 只 yield system/init 后立刻触发 canUseTool（无其它定时器在跑），
 *     canUseTool 内 _waitForApproval 注册的 setTimeout 是唯一未决定时器；
 *   - 先轮询确认 broadcast 已发（证明 setTimeout 已注册），再 mock.timers.tick
 *     到点 → 定时器 fire → resolve(null) → canUseTool 走 Timeout deny 分支。
 *   - 每个用例 finally 里 mock.timers.reset()，绝不跨用例泄漏 fake timer。
 *
 * 另覆盖：result/assistant 消息的 session_id 落地臂、cancelApproval 命中真实
 * pending 的各臂、sentinel reason 回落、interruptTurn 对缺 interrupt/close 的
 * query 的守卫、switch default 分支。
 *
 * 架构注记（SDK 链路修复后）：sdk-manager 不再合成展示 entry / streaming status,
 * 显示与落盘走 wire 通路（proxy → fetch hook → SSE），本文件不再有 onEntry/
 * onStreamingStatus 相关分支。
 *
 * 硬性约定：node:test + assert/strict；私有 mkdtemp 作 CCV_LOG_DIR/CLAUDE_CONFIG_DIR
 * （在目标模块 import 前设好）；动态 import 目标；不碰源码 / package.json / 其它测试；
 * mock 仅本文件作用域并在 after/finally 还原；无裸控制字节；无 query-busting import。
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── env 先设 → 模块动态 import ──
let tmpDir;
let sdk;
let realQuery;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-sdkmgr-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
  try {
    const real = await import('@anthropic-ai/claude-agent-sdk');
    realQuery = real.query;
  } catch { realQuery = undefined; }
});

after(() => {
  // 还原真实 query，避免污染同进程内其它 sdk-manager 测试文件
  if (sdk) {
    sdk.__setQueryForTests(realQuery);
    sdk.stopSession();
  }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  // 每个用例后硬清理会话状态（pending/queue/busy），互不污染
  if (sdk) sdk.stopSession();
});

// 收集回调
function makeDeps(extra = {}) {
  const broadcasts = [];
  const turnEnds = [];
  const deps = {
    broadcastWs: (m) => broadcasts.push(m),
    onTurnEnd: (x) => turnEnds.push(x),
    ...extra,
  };
  return { deps, broadcasts, turnEnds };
}

function sysInit(sessionId = 'sess-b', model = 'm', tools = []) {
  return { type: 'system', subtype: 'init', session_id: sessionId, model, tools };
}
function resultMsg(extra = {}) {
  return { type: 'result', subtype: 'success', ...extra };
}

// 让若干 microtask 跑完
async function tick(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// 轮询直到 cond() 为真——这里用于在 fake timer 下确认「真实副作用（broadcast）已发」，
// broadcast 是同步推送，几个 microtask 即可，不依赖真实 wall-clock。
async function waitMicro(cond, max = 60) {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    await Promise.resolve();
  }
  return cond();
}

// 通用：fake query 只 yield system/init，然后触发一次 canUseTool 并 await 其结果，
// 结果写入 ctrl.result；canUseTool 内 _waitForApproval 的 setTimeout 是唯一未决定时器。
function makeCanUseToolQuery(toolName, input, ctrl) {
  return function fakeQuery({ options }) {
    let closed = false;
    return {
      async *[Symbol.asyncIterator]() {
        yield sysInit();
        await Promise.resolve();
        ctrl.promise = options.canUseTool(toolName, input, ctrl.cutOpts || {});
        ctrl.captured = true;
        ctrl.result = await ctrl.promise;
        if (closed) return;
        yield resultMsg();
      },
      interrupt() { return Promise.resolve(); },
      close() { closed = true; },
    };
  };
}

const FIVE_MIN = 5 * 60 * 1000;
const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;

// 驱动一次「canUseTool → 注册超时 setTimeout → fake-tick 到点 → Timeout deny」。
// 返回 ctrl.result 供断言。
async function driveTimeout({ toolName, input, ctrl, broadcastType, timeoutMs }) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    sdk.__setQueryForTests(makeCanUseToolQuery(toolName, input, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', ctrl.deps);
    const sendP = sdk.sendUserMessage('go');
    // 等 fake query 触发 canUseTool 且 broadcast 发出（证明 _waitForApproval 的
    // setTimeout 已注册），broadcast 是同步推送 → microtask 内即可见。
    const ok = await waitMicro(
      () => ctrl.broadcasts.some((b) => b.type === broadcastType),
      80,
    );
    assert.ok(ok, `should broadcast ${broadcastType} before tick`);
    // 到点 → 唯一的 setTimeout fire → _waitForApproval resolve(null)
    mock.timers.tick(timeoutMs + 10);
    await sendP;
    await tick(6);
  } finally {
    mock.timers.reset();
  }
  return ctrl.result;
}

describe('sdk-manager 分支补强 — _waitForApproval 三处超时 deny', () => {
  it('perm（Bash）超时 → deny "Timeout waiting for user approval"', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-to' }, deps, broadcasts };
    const res = await driveTimeout({
      toolName: 'Bash',
      input: { command: 'ls' },
      ctrl,
      broadcastType: 'perm-hook-pending',
      timeoutMs: FIVE_MIN,
    });
    assert.equal(res.behavior, 'deny');
    assert.match(res.message, /Timeout waiting for user approval/);
  });

  it('plan（ExitPlanMode）超时 → deny "Timeout waiting for plan approval"', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-to' }, deps, broadcasts };
    const res = await driveTimeout({
      toolName: 'ExitPlanMode',
      input: { plan: 'do x' },
      ctrl,
      broadcastType: 'sdk-plan-pending',
      timeoutMs: FIVE_MIN,
    });
    assert.equal(res.behavior, 'deny');
    assert.match(res.message, /Timeout waiting for plan approval/);
  });

  it('ask（AskUserQuestion）超时 → deny "Timeout waiting for user answer"（24h 定时器）', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-to' }, deps, broadcasts };
    const res = await driveTimeout({
      toolName: 'AskUserQuestion',
      input: { questions: [{ q: 'pick?' }] },
      ctrl,
      broadcastType: 'sdk-ask-pending',
      timeoutMs: TWENTY_FOUR_H,
    });
    assert.equal(res.behavior, 'deny');
    assert.match(res.message, /Timeout waiting for user answer/);
  });
});

describe('sdk-manager 分支补强 — _waitForApproval 超时后 _pendingApprovals 已清', () => {
  it('perm 超时 fire 后，对同一 id 再 resolveApproval/cancelApproval 都返 false（timer 回调已 delete）', async () => {
    // 覆盖 _waitForApproval timer 回调里的 _pendingApprovals.delete(id)：
    // 超时 fire 后 map 应已无此 id，故后续 resolve/cancel 命中失败。
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-gone' }, deps, broadcasts };
    const res = await driveTimeout({
      toolName: 'Bash',
      input: { command: 'ls' },
      ctrl,
      broadcastType: 'perm-hook-pending',
      timeoutMs: FIVE_MIN,
    });
    assert.equal(res.behavior, 'deny');
    assert.equal(sdk.resolveApproval('perm-gone', { decision: 'allow' }), false);
    assert.equal(sdk.cancelApproval('perm-gone', 'x'), false);
  });
});

// makeFakeQuery：把一串预置 msg 做成 fake query（不触发 canUseTool 的简单流）。
function makeFakeQuery(msgs) {
  return function fakeQuery() {
    let closed = false;
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of msgs) {
          if (closed) return;
          await Promise.resolve();
          if (closed) return;
          yield m;
        }
      },
      interrupt() { return Promise.resolve(); },
      close() { closed = true; },
    };
  };
}

function assistantMsg(content, extra = {}) {
  return { type: 'assistant', message: { role: 'assistant', content }, ...extra };
}

describe('sdk-manager 分支补强 — result 带 session_id', () => {
  it('result 消息带 session_id → 落地 sessionId（覆盖 if(msg.session_id) 的 true 臂）', async () => {
    const { deps, turnEnds } = makeDeps();
    const msgs = [
      sysInit('sess-init'),
      assistantMsg([{ type: 'text', text: 'x' }]),
      resultMsg({ session_id: 'sess-from-result' }),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(6);
    // result handler 里 if(msg.session_id) 把 sessionId 覆盖为 result 带来的值
    assert.equal(sdk.getSessionId(), 'sess-from-result');
    assert.equal(turnEnds.length, 1);
    assert.equal(turnEnds[0].sessionId, 'sess-from-result');
  });
});

describe('sdk-manager 分支补强 — assistant/user 带 session_id', () => {
  it('assistant 消息带 session_id → 落地 sessionId', async () => {
    const { deps } = makeDeps();
    const msgs = [
      sysInit('sess-init2'),
      assistantMsg([{ type: 'text', text: 'x' }], { session_id: 'sess-from-assistant' }),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(6);
    assert.equal(sdk.getSessionId(), 'sess-from-assistant');
  });

  it('user 消息带 session_id → 落地 sessionId', async () => {
    const { deps } = makeDeps();
    const msgs = [
      sysInit('sess-init3'),
      { type: 'user', session_id: 'sess-from-user', message: { role: 'user', content: [] } },
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(6);
    assert.equal(sdk.getSessionId(), 'sess-from-user');
  });
});

describe('sdk-manager 分支补强 — cancelApproval 命中真实 pending', () => {
  it('真实 ask pending → cancelApproval(string reason) 返 true 并走 deny', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-live' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'x' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    // pending.kind==='ask' → kind 校验通过 → resolve sentinel
    assert.equal(sdk.cancelApproval('ask-live', 'stopped by user'), true);
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /stopped by user/);
  });

  it('真实 ask pending → cancelApproval(非字符串 reason) → 回落 User aborted', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-live2' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'x' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    // reason 传对象（非 string）→ 三元走 'User aborted' 回落
    assert.equal(sdk.cancelApproval('ask-live2', { not: 'a string' }), true);
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /User aborted/);
  });

  it('真实 perm pending → cancelApproval 撞 perm id 返 false（kind!==ask 不处理）', async () => {
    // ask-cancel 协议只对 ask 生效；撞 perm/plan id 时返 false 不处理。
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-live' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));
    // kind==='perm' → return false（不取消）
    assert.equal(sdk.cancelApproval('perm-live', 'try cancel'), false);
    // 用正常审批结束这一轮（否则 pending 悬挂）
    assert.equal(sdk.resolveApproval('perm-live', { decision: 'allow' }), true);
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
  });
});

describe('sdk-manager 分支补强 — plan/perm sentinel reason 回落 + perm 原始值 decision', () => {
  it('plan sentinel 空 reason → deny 回落 User aborted', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-noreason' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'p' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    sdk.resolveApproval('plan-noreason', { __cancelled__: true, reason: '' });
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /User aborted/);
  });

  it('plan approve=false 无 feedback → deny 回落 User rejected the plan', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-nofb' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'p' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    sdk.resolveApproval('plan-nofb', { approve: false }); // 无 feedback
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /User rejected the plan/);
  });

  it('perm sentinel 空 reason → deny 回落 User aborted', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-noreason' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    sdk.resolveApproval('perm-noreason', { __cancelled__: true, reason: '' });
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /User aborted/);
  });

  it('perm resolveApproval 传原始字符串 "deny" → decision 走原始值臂 → deny', async () => {
    // result 非 object（原始字符串）→ `typeof result==='object' ? result.decision : result` 走 result 臂
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-raw' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    sdk.resolveApproval('perm-raw', 'deny'); // 原始字符串
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /User denied via cc-viewer/);
  });

  it('perm resolveApproval 传原始字符串 "allow" → decision=allow', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-raw2' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    sdk.resolveApproval('perm-raw2', 'allow'); // 原始字符串 → allowSession=false
    await sendP;
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.equal(ctrl.result.updatedPermissions, undefined);
  });
});

describe('sdk-manager 分支补强 — interruptTurn 对缺 interrupt/close 的 query', () => {
  it('_activeQuery 无 interrupt/close 方法 → 可选链/typeof 守卫走 false 臂，不抛', async () => {
    // 构造一个【没有 interrupt、close 不是函数】的 query iterable，park 在 await gate，
    // 让 interruptTurn 在 _activeQuery 存在但方法缺失时安全跳过。
    const { deps } = makeDeps();
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    function fq() {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-noclose');
          await gate; // park：保持 _activeQuery 非 null
          yield resultMsg();
        },
        // 故意不提供 interrupt（→ _activeQuery.interrupt?.() 可选链 false 臂）
        close: 'not-a-function', // close 不是函数（→ typeof ...close==='function' false 臂）
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(8);
    // 此刻 _activeQuery 存在但 interrupt 缺失、close 非函数
    let cancelled;
    assert.doesNotThrow(() => { cancelled = sdk.interruptTurn(); });
    assert.ok(Array.isArray(cancelled));
    // gate 仍卡着 → 释放让生成器收尾，避免悬挂
    releaseGate();
    await sendP;
    await tick(4);
  });
});

describe('sdk-manager 分支补强 — switch default 分支', () => {
  it('未知 msg.type 命中 default: break（不抛、不改 sessionId、不触发 turnEnd 之外的副作用）', async () => {
    const { deps, turnEnds } = makeDeps();
    function fq() {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-default');
          // 未知类型 → switch default 分支
          yield { type: 'totally_unknown_type', foo: 'bar' };
          yield { type: 'another_unknown' };
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
    await tick(6);

    // session/turnEnd 仍由 init/result 正常处理；未知类型不影响
    assert.equal(sdk.getSessionId(), 'sess-default');
    assert.equal(turnEnds.length, 1);
  });
});
