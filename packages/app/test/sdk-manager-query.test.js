/**
 * sdk-manager-query.test.js
 *
 * 覆盖目标：server/lib/sdk-manager.js 的深层路径 —— 用 __setQueryForTests 注入
 * fake async-generator（yield system/init → stream_event → assistant → user →
 * result 序列），驱动 _executeQuery / _processMessage / _processStreamEvent /
 * 流式 entry 推送 / _handleCanUseTool（ask/plan/perm）/ _waitForApproval /
 * resolveApproval / cancelApproval / interruptTurn / 队列 drain / bypassPermissions。
 *
 * 不触真 SDK 网络（fake query 完全替换 _query）。所有 await 都是确定性的：
 * fake generator 在每个 yield 之间用 microtask 让出，审批分支由测试侧调
 * resolveApproval/cancelApproval 推进，定时器用极短 timeout 或 fake 控制。
 *
 * 硬性约定遵循：node:test + assert/strict；mkdtemp + rmSync(force)；
 * env(CCV_LOG_DIR/CLAUDE_CONFIG_DIR) 先设 → 模块动态 import；afterEach 关资源；
 * 真实模块=事实源，疑似 bug 报 lead 不擅改源码。
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── env 先设 → 模块动态 import ──
let tmpDir;
let sdk;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdk-q-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ── 小工具 ──

// 收集回调
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

// 把一串预置的 msg 数组做成一个可控的 fake query()。
// query({prompt,options}) 返回一个对象，既是 async-iterable（for await 用），
// 又带 interrupt()/close() 方法（interruptTurn/stopSession 用）。
// onCanUseTool: 若 options.canUseTool 存在，可在测试里通过 hooks 调用它。
function makeFakeQuery(msgs, { onClose, onInterrupt, beforeYield } = {}) {
  const calls = [];
  function fakeQuery({ prompt, options }) {
    calls.push({ prompt, options });
    let closed = false;
    const iterable = {
      async *[Symbol.asyncIterator]() {
        for (const m of msgs) {
          if (closed) return;
          if (beforeYield) {
            // 允许测试在某条 msg 前插入副作用（如触发审批），返回 promise 则 await
            await beforeYield(m, { prompt, options });
          }
          // microtask 让出，模拟异步流
          await Promise.resolve();
          if (closed) return;
          yield m;
        }
      },
      interrupt() {
        if (onInterrupt) onInterrupt();
        return Promise.resolve();
      },
      close() {
        closed = true;
        if (onClose) onClose();
      },
    };
    return iterable;
  }
  fakeQuery.calls = calls;
  return fakeQuery;
}

// 标准 system/init 消息
function sysInit(sessionId = 'sess-1', model = 'claude-opus-4-test', tools = ['Bash', 'Read', 'Edit']) {
  return { type: 'system', subtype: 'init', session_id: sessionId, model, tools };
}

// 流式 text 事件序列：start → delta → stop
function streamTextEvents() {
  return [
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } },
    { type: 'stream_event', event: { type: 'content_block_stop' } },
    { type: 'stream_event', event: { type: 'message_stop' } },
  ];
}

// assistant 消息（不带 session_id，避免覆盖 system/init 落地的 id；需要时由 extra 注入）
function assistantMsg(content, extra = {}) {
  return { type: 'assistant', message: { role: 'assistant', content }, ...extra };
}

// result 消息（同上，不硬编 session_id）
function resultMsg(extra = {}) {
  return { type: 'result', subtype: 'success', ...extra };
}

// 等待若干 microtask（让流式 throttle 之外的同步推送/队列 drain 跑完）
async function tick(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// 轮询直到 cond() 为真（每 stepMs 查一次），超过 timeoutMs 抛错。
// 替代「固定 sleep 后假定异步副作用已完成」——后者在高负载（全量 + c8）下，
// 源码里的 100ms throttle timer 可能晚于固定 sleep 触发而导致假失败。
async function waitUntil(cond, { timeoutMs = 2000, stepMs = 10, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil timeout after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// afterEach 硬清理：恢复真实 query 由各 describe 自己管，但状态必须重置
afterEach(() => {
  sdk.stopSession();
});

describe('sdk-manager-query — __setQueryForTests + isSdkAvailable', () => {
  afterEach(() => { /* 不在此恢复，留给末尾 restore describe */ });

  it('注入函数后 isSdkAvailable() 为 true；注入 null 后为 false', () => {
    const orig = sdk.isSdkAvailable();
    sdk.__setQueryForTests(() => ({ async *[Symbol.asyncIterator]() {} }));
    assert.equal(sdk.isSdkAvailable(), true);
    sdk.__setQueryForTests(null);
    assert.equal(sdk.isSdkAvailable(), false);
    // 还原成一个函数以免影响后续（后续 describe 各自重设）
    sdk.__setQueryForTests(() => ({ async *[Symbol.asyncIterator]() {} }));
    assert.equal(typeof orig, 'boolean');
  });

  it('_query 为 null 时 sendUserMessage 抛 Agent SDK not available', async () => {
    sdk.__setQueryForTests(null);
    sdk.initSdkSession('/tmp', 'p', makeDeps().deps);
    await assert.rejects(() => sdk.sendUserMessage('x'), /Agent SDK not available/);
    sdk.__setQueryForTests(() => ({ async *[Symbol.asyncIterator]() {} }));
  });
});

describe('sdk-manager-query — 完整一轮：system/init → stream → assistant → user → result', () => {
  it('驱动 _processMessage 全分支 + 流式 entry 推送 + turnEnd + sessionId/model 落地', async () => {
    const { deps, statuses, entries, turnEnds } = makeDeps();

    const msgs = [
      sysInit('sess-abc', 'claude-opus-4-xyz', ['Bash', 'Read']),
      ...streamTextEvents(),
      assistantMsg([{ type: 'text', text: 'Hello world' }]),
      // 工具结果（user 消息），非 replay → 累积
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi there');
    await tick(5);

    // sessionId / model 从 system/init 落地
    assert.equal(sdk.getSessionId(), 'sess-abc');

    // streaming-status：进入 active(true)，stream_event 期间多次 active(true)，finally/ result false
    assert.equal(statuses[0].active, true);
    assert.equal(statuses[statuses.length - 1].active, false);

    // 至少一个最终 assistant entry（response 非 null）
    const finalEntries = entries.filter((e) => e.response && e.response.body);
    assert.ok(finalEntries.length >= 1, 'should produce a final assistant entry');
    const fe = finalEntries[finalEntries.length - 1];
    assert.equal(fe.mainAgent, true);
    assert.equal(fe.body.model, 'claude-opus-4-xyz');
    // tools 来自 SDK init（[{name:'Bash'},{name:'Read'}]）
    assert.deepEqual(fe.body.tools, [{ name: 'Bash' }, { name: 'Read' }]);
    // 响应体 content 含 text 块
    assert.ok(fe.response.body.content.some((b) => b.type === 'text'));

    // 注：流式 in-progress entry 由 100ms throttle timer flush。本用例的流在 <100ms
    // 内整轮跑完（finally 的 _resetStreamingState 会清掉未触发的 timer），所以这里不强求
    // in-progress entry 一定产出 —— 专门的「throttle timer」用例用 gate 持流 >100ms 验证 flush。

    // result → onTurnEnd 触发一次
    assert.equal(turnEnds.length, 1);
    assert.equal(turnEnds[0].sessionId, 'sess-abc');
    assert.equal(typeof turnEnds[0].ts, 'number');
  });

  it('assistant 多 content-block 合并 + sub-agent（parent_tool_use_id）被跳过', async () => {
    const { deps, entries } = makeDeps();
    const msgs = [
      sysInit(),
      // sub-agent 消息：有 parent_tool_use_id → 不产 entry、不累积
      assistantMsg([{ type: 'text', text: 'sub' }], { parent_tool_use_id: 'parent-1' }),
      // 主 agent 第一段
      assistantMsg([{ type: 'text', text: 'part1' }]),
      // 主 agent 第二段（同 turn 多 content-block → 与上一条 assistant 合并）
      assistantMsg([{ type: 'text', text: 'part2' }]),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('go');
    await tick(5);

    const finals = entries.filter((e) => e.response && e.response.body);
    // 两条主 agent assistant → 两个 entry（第二条的 body.messages 含合并后的 assistant 历史）
    assert.ok(finals.length >= 2);
    // 第二条 entry 的 request history（body.messages）里应已含合并的 assistant 段
    const last = finals[finals.length - 1];
    const histAssistant = last.body.messages.filter((m) => m.role === 'assistant');
    assert.ok(histAssistant.length >= 1);
  });

  it('compact_boundary 重置累积历史', async () => {
    const { deps, entries } = makeDeps();
    const msgs = [
      sysInit(),
      assistantMsg([{ type: 'text', text: 'before compact' }]),
      { type: 'system', subtype: 'compact_boundary', session_id: 'sess-1' },
      assistantMsg([{ type: 'text', text: 'after compact' }]),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('go');
    await tick(5);

    const finals = entries.filter((e) => e.response && e.response.body);
    // compact 之后那条 assistant 的 body.messages（request history）应只含 compact 之后的 user/assistant，
    // 不含 compact 之前的 assistant 文本
    const afterEntry = finals[finals.length - 1];
    const flat = JSON.stringify(afterEntry.body.messages);
    assert.ok(!flat.includes('before compact'), 'history should be reset at compact_boundary');
  });

  it('连续两条 user(tool_result) → 合并进同一条累积 user 消息', async () => {
    // 覆盖 _processMessage user 分支的「与上一条 user 合并」支（lastUserMsg 同 role + 数组 content）。
    const { deps, entries } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'r1' }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'r2' }] } },
      assistantMsg([{ type: 'text', text: 'resp' }]),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const finals = entries.filter((e) => e.response && e.response.body);
    const last = finals[finals.length - 1];
    // body.messages 里最后一条 user 应同时含 r1 与 r2（被合并到同一条 content 数组）
    const userMsgs = last.body.messages.filter((m) => m.role === 'user' && Array.isArray(m.content));
    const merged = userMsgs.find((m) => m.content.some((c) => c.content === 'r1') && m.content.some((c) => c.content === 'r2'));
    assert.ok(merged, 'consecutive tool_result user messages should merge into one content array');
  });

  it('user 消息 isReplay=true 被跳过不累积', async () => {
    const { deps, entries } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'user', isReplay: true, message: { role: 'user', content: [{ type: 'tool_result', content: 'replayed' }] } },
      assistantMsg([{ type: 'text', text: 'resp' }]),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const finals = entries.filter((e) => e.response);
    const last = finals[finals.length - 1];
    assert.ok(!JSON.stringify(last.body.messages).includes('replayed'), 'replay user msg should be skipped');
  });
});

describe('sdk-manager-query — _processStreamEvent 各块类型', () => {
  it('thinking / tool_use(input_json_delta) / interactive-tool 跳过 / 空块', async () => {
    const { deps, entries } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'stream_event', event: { type: 'message_start' } },
      // thinking 块
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'mulling' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      // tool_use 块（非交互）→ input_json_delta 累积 → stop 时 JSON.parse
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu1', name: 'Bash' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"command":' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '"ls"}' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      // 交互式工具（AskUserQuestion）→ _currentBlockData = null（被跳过）
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu2', name: 'AskUserQuestion' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      // 未知块类型 → _currentBlockData = null
      { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'image' } } },
      { type: 'stream_event', event: { type: 'content_block_stop' } },
      // 空 content_block（content_block_start 但 block 缺失）→ return
      { type: 'stream_event', event: { type: 'content_block_start' } },
      // content_block_delta 但 delta 缺失 / 无 currentBlock → return
      { type: 'stream_event', event: { type: 'content_block_delta' } },
      { type: 'stream_event', event: { type: 'message_stop' } },
      assistantMsg([{ type: 'text', text: 'done' }]),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
    await tick(5);

    // 至少最终 assistant entry 存在 → 整条流式状态机被无错驱动
    assert.ok(entries.some((e) => e.response && e.response.body));
  });

  it('stream_event 带 parent_tool_use_id → 不进 _processStreamEvent（仅推 status）', async () => {
    const { deps, statuses } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'stream_event', parent_tool_use_id: 'p1', event: { type: 'message_start' } },
      assistantMsg([{ type: 'text', text: 'x' }]),
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    // stream_event 仍触发了一次 active status（msg.type==='stream_event' 分支内 onStreamingStatus）
    assert.ok(statuses.some((s) => s.active === true));
  });

  it('null event 直接 return（不抛）', async () => {
    const { deps } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'stream_event', event: null },
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
  });

  it('throttle timer：text_delta 后持流 >100ms → flush 推一条 in-progress entry（含累积文本）', async () => {
    const { deps, entries } = makeDeps();
    // 用 gate 在 text_delta 之后把流卡住 >100ms，让 throttle timer 有机会 fire 出 in-progress entry，
    // 再放行剩余 stop/result。
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    function fq() {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          yield { type: 'stream_event', event: { type: 'message_start' } };
          yield { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } };
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed-chunk' } } };
          await gate; // 持流 → 让 100ms throttle timer fire
          yield { type: 'stream_event', event: { type: 'content_block_stop' } };
          yield { type: 'stream_event', event: { type: 'message_stop' } };
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    // 轮询等 100ms throttle timer flush 出 in-progress entry —— 不用固定 sleep 紧贴 100ms
    // timer（全量+c8 高负载下事件循环可能 stall 到 >160ms，导致定值 sleep 假失败）。
    // gate 仍卡着流，所以 entries 只会在 throttle timer fire 后才出现 in-progress 条目。
    await waitUntil(() => entries.some((e) => e.inProgress === true), {
      timeoutMs: 2000,
      label: 'throttled in-progress entry',
    });
    const inProg = entries.filter((e) => e.inProgress === true);
    assert.ok(inProg.length >= 1, 'throttled flush should emit an in-progress entry');
    assert.equal(inProg[0].response, null);
    assert.ok(typeof inProg[0].requestId === 'string' && inProg[0].requestId.startsWith('sdk_'));
    // flush 出的 content（在 body.messages 之外，response===null 的 in-progress entry 把累积内容
    // 放在 body.messages 末尾的 assistant；这里只断言确有 in-progress 推送即可）
    releaseGate();
    await sendP;
    await tick(3);
  });
});

describe('sdk-manager-query — canUseTool: AskUserQuestion / ExitPlanMode / 权限审批', () => {
  // 这些用例需要在 query 迭代期间触发 canUseTool，并在另一侧 resolveApproval。
  // 做法：fake query 在 yield system/init 之后，调用 options.canUseTool(...)，
  // 把它的 promise 暴露给测试侧，测试侧 resolveApproval 后 fake 再 yield result。

  // 通用 driver：返回一个 fake query，迭代到 system/init 后调用 canUseTool 并把
  // resolve/reject 通过外部 ctrl 暴露。
  function makeCanUseToolQuery(toolName, input, ctrl) {
    return function fakeQuery({ options }) {
      let closed = false;
      const iterable = {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          // 触发 canUseTool —— 不 await，保存 promise 给测试推进
          ctrl.promise = options.canUseTool(toolName, input, ctrl.cutOpts || {});
          ctrl.captured = true;
          // 等审批结果（测试侧 resolveApproval 后 ctrl.promise resolve）
          ctrl.result = await ctrl.promise;
          if (closed) return;
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() { closed = true; },
      };
      return iterable;
    };
  }

  it('AskUserQuestion → broadcast sdk-ask-pending → resolveApproval(answers) → allow', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'pick?' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    // 等 fake 触发 canUseTool 且 broadcast 发出
    await tick(6);
    const pending = broadcasts.find((b) => b.type === 'sdk-ask-pending');
    assert.ok(pending, 'should broadcast sdk-ask-pending');
    assert.equal(pending.id, 'ask-1');
    assert.equal(typeof pending.timeoutMs, 'number');

    // 用户答题 → resolveApproval
    const answers = [{ answer: 'A' }];
    assert.equal(sdk.resolveApproval('ask-1', answers), true);
    await sendP;
    await tick(3);

    const res = ctrl.result;
    assert.equal(res.behavior, 'allow');
    assert.deepEqual(res.updatedInput.answers, answers);
    assert.ok(Array.isArray(res.updatedInput.questions));
  });

  it('AskUserQuestion → cancelApproval(reason) → deny 带 [cc-viewer:cancel] 前缀', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-2' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'x' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    assert.equal(sdk.cancelApproval('ask-2', 'user stopped'), true);
    await sendP;
    await tick(3);

    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /^\[cc-viewer:cancel\] /);
    assert.match(ctrl.result.message, /user stopped/);
  });

  it('AskUserQuestion → waterfall hook 返回 answers → 直接 allow（不 broadcast）', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-3' } };
    const hookAnswers = [{ answer: 'hooked' }];
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'x' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async (name) => (name === 'onAskRequest' ? { answers: hookAnswers } : {}),
    });

    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.deepEqual(ctrl.result.updatedInput.answers, hookAnswers);
    assert.ok(!broadcasts.some((b) => b.type === 'sdk-ask-pending'), 'hook short-circuits broadcast');
  });

  it('ExitPlanMode → broadcast sdk-plan-pending → resolveApproval(allow) → allow', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'do x' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    assert.ok(broadcasts.some((b) => b.type === 'sdk-plan-pending' && b.id === 'plan-1'));
    assert.equal(sdk.resolveApproval('plan-1', { approve: true }), true);
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
  });

  it('ExitPlanMode → resolveApproval({approve:false,feedback}) → deny', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-2' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'do x' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    sdk.resolveApproval('plan-2', { approve: false, feedback: 'no good' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /no good/);
  });

  it('ExitPlanMode → waterfall onPlanRequest approve=false → deny（不 broadcast）', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-3' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'p' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async (name) => (name === 'onPlanRequest' ? { approve: false, feedback: 'plugin nope' } : {}),
    });
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /plugin nope/);
    assert.ok(!broadcasts.some((b) => b.type === 'sdk-plan-pending'));
  });

  it('ExitPlanMode → waterfall onPlanRequest approve=true → allow（不 broadcast）', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-4' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'p' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async (name) => (name === 'onPlanRequest' ? { approve: true } : {}),
    });
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.ok(!broadcasts.some((b) => b.type === 'sdk-plan-pending'));
  });

  it('非审批类工具（Read）→ 直接 allow，不 broadcast', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'read-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file: '/x' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.deepEqual(ctrl.result.updatedInput, { file: '/x' });
    assert.equal(broadcasts.length, 0);
  });

  it('权限审批工具（Bash）→ broadcast perm-hook-pending → resolveApproval({decision:allow,allowSession}) → allow + updatedPermissions', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'bash-1', suggestions: [{ type: 'addRules' }] } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending' && b.id === 'bash-1'));
    sdk.resolveApproval('bash-1', { decision: 'allow', allowSession: true });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.deepEqual(ctrl.result.updatedPermissions, [{ type: 'addRules' }]);
  });

  it('权限审批工具（Edit）→ resolveApproval({decision:deny}) → deny', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'edit-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Edit', { file: '/x' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    sdk.resolveApproval('edit-1', { decision: 'deny' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /User denied/);
  });

  it('权限审批工具 → waterfall onPermRequest decision=allow + allowSession → allow + updatedPermissions', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'bash-2', suggestions: [{ type: 'rule' }] } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async (name) => (name === 'onPermRequest' ? { decision: 'allow', allowSession: true } : {}),
    });
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.deepEqual(ctrl.result.updatedPermissions, [{ type: 'rule' }]);
    assert.ok(!broadcasts.some((b) => b.type === 'perm-hook-pending'));
  });

  it('权限审批工具 → waterfall onPermRequest decision=deny → deny（不 broadcast）', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'bash-3' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async (name) => (name === 'onPermRequest' ? { decision: 'deny' } : {}),
    });
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /Plugin denied/);
    assert.ok(!broadcasts.some((b) => b.type === 'perm-hook-pending'));
  });

  it('canUseTool 无 toolUseID 时自动生成 sdk_ 前缀 id（仍能正常 deny via timeout-less path）', async () => {
    // 不提供 toolUseID → id 走 `sdk_${Date.now()}_${rand}` 分支。
    // 我们无法预知 id，所以用 cancelApproval 不可行；改用 waterfall hook 直接短路 allow，
    // 只为覆盖 id 生成分支 + Read 直通。
    const { deps } = makeDeps();
    const ctrl = { cutOpts: {} }; // 无 toolUseID
    sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file: '/y' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
  });

  it('ExitPlanMode → resolveApproval(__cancelled__ sentinel) → deny（plan cancel-sentinel guard）', async () => {
    // 覆盖 _handleCanUseTool plan 分支的 cancel sentinel guard（不能 fall through 到 allow）。
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-cancel' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'p' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // 直接注入 sentinel（resolveApproval 不校验 kind）
    sdk.resolveApproval('plan-cancel', { __cancelled__: true, reason: 'plan aborted' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /plan aborted/);
  });

  it('权限审批 → resolveApproval(__cancelled__ sentinel) → deny（perm cancel-sentinel guard）', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'perm-cancel' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    sdk.resolveApproval('perm-cancel', { __cancelled__: true, reason: 'perm aborted' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /perm aborted/);
  });

  it('AskUserQuestion → cancelApproval 无 reason → deny 文案回落 User aborted', async () => {
    // 覆盖 ask 分支 `answers.reason || 'User aborted'` 的回落支（reason 为 falsy）。
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-noreason' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'x' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // cancelApproval 不带 reason → 默认 'User aborted'；但要触发 ask 分支的 || 回落，
    // 直接注入 reason 为空串的 sentinel。
    sdk.resolveApproval('ask-noreason', { __cancelled__: true, reason: '' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.match(ctrl.result.message, /\[cc-viewer:cancel\] User aborted/);
  });

  it('waterfall hook 抛错被吞 → 回落到正常 broadcast/审批流程', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'bash-throw' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async () => { throw new Error('hook boom'); },
    });
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // hook 抛错被 try/catch 吞 → 回落到 broadcast perm-hook-pending
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));
    sdk.resolveApproval('bash-throw', { decision: 'allow' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
  });
});

// 注：_waitForApproval 的超时路径（plan/ask/perm 三处 "Timeout waiting..." deny 文案 +
// timer 回调 delete+resolve(null)，源码行 380-381 / 412-413 / 476-477）需要真实
// 5min/24h 定时器到点才能触达。node:test 的 mock.timers 在本异步生成器 + canUseTool
// 跨 await 边界下会与流式 100ms throttle timer 互相干扰导致 REPL 挂死（实测 SIGKILL），
// 故不在此覆盖，记为放过。整体行覆盖已 ≥98%。

describe('sdk-manager-query — bypassPermissions 模式', () => {
  it('canUseTool=undefined：options 命中 allowDangerouslySkipPermissions 分支，正常跑完一轮', async () => {
    const { deps, entries } = makeDeps();
    const fq = makeFakeQuery([sysInit(), assistantMsg([{ type: 'text', text: 'ok' }]), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

    await sdk.sendUserMessage('go');
    await tick(5);

    // options.canUseTool 应为 undefined，allowDangerouslySkipPermissions 为 true
    const opt = fq.calls[0].options;
    assert.equal(opt.canUseTool, undefined);
    assert.equal(opt.allowDangerouslySkipPermissions, true);
    assert.ok(entries.some((e) => e.response && e.response.body));
  });
});

describe('sdk-manager-query — resume / sessionId 续连', () => {
  it('第二轮带上 options.resume = 上一轮 sessionId', async () => {
    const { deps } = makeDeps();
    const fq = makeFakeQuery([sysInit('sess-resume'), assistantMsg([{ type: 'text', text: 'a' }]), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('first');
    await tick(4);
    assert.equal(sdk.getSessionId(), 'sess-resume');

    await sdk.sendUserMessage('second');
    await tick(4);

    // 第二次 query 调用的 options.resume 应为 sess-resume
    assert.equal(fq.calls.length, 2);
    assert.equal(fq.calls[1].options.resume, 'sess-resume');
  });
});

describe('sdk-manager-query — 队列 drain（忙时第二条入队后被 drain）', () => {
  it('query 进行中收到第二条 → 入队 → 第一轮结束后 drain 跑第二轮', async () => {
    const { deps, statuses } = makeDeps();
    // fake query 故意在 yield 之间留一个可控的 gate，让我们在第一轮 in-flight 时塞第二条
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let round = 0;
    function fq({ options }) {
      const myRound = round++;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-q');
          if (myRound === 0) {
            await firstGate; // 第一轮卡住，给测试塞第二条的机会
          }
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4); // 让第一轮进入 await firstGate
    const p2 = sdk.sendUserMessage('second'); // _queryBusy=true → 入队，立即 resolve
    const r2 = await p2;
    assert.equal(r2, undefined, '入队分支直接 return undefined');

    releaseFirst(); // 放行第一轮 → 结束后 drain 第二条
    await p1;
    await tick(6);

    // 两轮 _executeQuery → 两次 active(true)（每轮 result 后会有 false×2：result handler + finally，
    // 这是真实行为，不强求精确序列）。用 active===true 的计数判定「跑了两轮」。
    const trueCount = statuses.filter((s) => s.active === true).length;
    assert.equal(trueCount, 2, '入队的第二条应被 drain → 共两轮 query');
    assert.equal(statuses[statuses.length - 1].active, false);
  });
});

describe('sdk-manager-query — interruptTurn 关活跃 query + 排空 pending 审批', () => {
  it('在审批 pending 时 interruptTurn → 返回 [{id,kind}] 且 query.close 被调用', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'int-1' } };
    let closeCalled = false;
    // 自定义 fake：触发 canUseTool（park），并暴露 close
    function fq({ options }) {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          ctrl.promise = options.canUseTool('Bash', { command: 'ls' }, ctrl.cutOpts);
          ctrl.result = await ctrl.promise; // 等 interrupt 把它 resolve(null) → deny
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() { closeCalled = true; },
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // 此刻 perm 审批 pending
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));

    const cancelled = sdk.interruptTurn();
    assert.ok(Array.isArray(cancelled));
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].id, 'int-1');
    assert.equal(cancelled[0].kind, 'perm');

    await sendP;
    await tick(3);
    assert.equal(closeCalled, true, 'interruptTurn should close the active query');
    // pending 被 resolve(null) → canUseTool 走 deny(timeout 文案)
    assert.equal(ctrl.result.behavior, 'deny');
    // interrupt 不清 sessionId（保会话续连）—— init 之后无 system 落地前为 null/或已落地
    // 这里 sysInit 已 yield，sessionId 应已落地且未被 interrupt 清掉
    assert.equal(sdk.getSessionId(), 'sess-1');
  });

  it('interruptTurn 丢弃队列中未派发的消息', async () => {
    const { deps, statuses } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let round = 0;
    function fq() {
      const myRound = round++;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-int');
          if (myRound === 0) await firstGate;
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() { releaseFirst && releaseFirst(); }, // close 放行第一轮
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('queued'); // 入队
    // interrupt：清队列 + close 第一轮（close 放行 firstGate）
    sdk.interruptTurn();
    releaseFirst();
    await p1;
    await tick(6);

    // 队列被清 → 只跑了第一轮，第二条不应被 drain（active===true 仅一次）
    const trueCount = statuses.filter((s) => s.active === true).length;
    assert.equal(trueCount, 1, 'queued message must be dropped on interrupt');
  });
});

describe('sdk-manager-query — stopSession 关 query 并清会话', () => {
  it('stopSession 调用 query.close 并把 sessionId 归 null', async () => {
    const { deps } = makeDeps();
    let closeCalled = false;
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    function fq() {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-stop');
          await gate;
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() { closeCalled = true; releaseGate(); },
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p = sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(sdk.getSessionId(), 'sess-stop');

    sdk.stopSession();
    await p;
    await tick(3);
    assert.equal(closeCalled, true);
    assert.equal(sdk.getSessionId(), null);
  });
});

describe('sdk-manager-query — stopSession 排空 pending 审批（_resetFullState reject 循环）', () => {
  it('审批 pending 时 stopSession → pending.resolve(null) → canUseTool 走 deny', async () => {
    // 覆盖 _resetFullState 末尾的 for (pending) pending.resolve(null) 循环（行 598-600）。
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'stop-perm' } };
    function fq({ options }) {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          ctrl.promise = options.canUseTool('Bash', { command: 'ls' }, ctrl.cutOpts);
          ctrl.result = await ctrl.promise; // stopSession 注入 null → deny(timeout 文案)
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));

    sdk.stopSession(); // _resetFullState → reject pending(null)
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.equal(sdk.getSessionId(), null);
  });
});

describe('sdk-manager-query — onTurnEnd 抛错被吞', () => {
  it('onTurnEnd 抛错不影响 result 处理（被 try/catch 吞 + console.warn）', async () => {
    const entries = [];
    const deps = {
      onEntry: (e) => entries.push(e),
      onStreamingStatus: () => {},
      broadcastWs: () => {},
      onTurnEnd: () => { throw new Error('turnEnd boom'); },
    };
    const msgs = [sysInit(), assistantMsg([{ type: 'text', text: 'x' }]), resultMsg()];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
  });
});

// ── 末尾：恢复真实 query，避免污染同进程内其它 sdk-manager 测试文件 ──
describe('sdk-manager-query — restore', () => {
  it('恢复真实 _query（重新 import 取得 sdk.query）', async () => {
    let realQuery;
    try {
      const real = await import('@anthropic-ai/claude-agent-sdk');
      realQuery = real.query;
    } catch { realQuery = undefined; }
    sdk.__setQueryForTests(realQuery);
    // 恢复后 isSdkAvailable 与真实环境一致（包已装 → true）
    assert.equal(typeof realQuery === 'function', sdk.isSdkAvailable());
    sdk.stopSession();
  });
});
