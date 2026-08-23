/**
 * sdk-manager-query.test.js
 *
 * Covers the deep paths of server/lib/sdk-manager.js — uses __setQueryForTests to inject a
 * fake async-generator, driving _executeQuery / _processMessage / options construction
 * (env/settings/resume/permissionMode passthrough) / _handleCanUseTool (ask/plan/perm) /
 * _waitForApproval / resolveApproval / cancelApproval / interruptTurn / queue drain /
 * bypassPermissions.
 *
 * Architecture premise (after the SDK-path fix): sdk-manager no longer synthesizes display
 * entries / streaming status — the SDK subprocess's API traffic is captured by the fetch
 * hook via the CCV loopback proxy, sharing the same wire path with PTY mode for display /
 * persistence / streaming typewriter. So this file has no onEntry/onStreamingStatus
 * assertions; _processMessage only tracks sessionId and maps result → onTurnEnd.
 *
 * No real SDK network (fake query fully replaces _query). All awaits are deterministic:
 * the fake generator yields to a microtask between each yield, approval branches are
 * advanced by the test side via resolveApproval/cancelApproval, and timers use very short
 * timeouts or fakes.
 *
 * Hard conventions followed: node:test + assert/strict; mkdtemp + rmSync(force); env
 * (CCV_LOG_DIR/CLAUDE_CONFIG_DIR) set first → dynamic module import; afterEach closes
 * resources; the real module is the source of truth — report suspected bugs to lead, do
 * not silently alter source.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── env set first → dynamic module import ──
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

// ── helpers ──

// Collect callbacks
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

// Turn a preset msg array into a controllable fake query().
// query({prompt,options}) returns an object that is both async-iterable (for `for await`)
// and has interrupt()/close() methods (used by interruptTurn/stopSession).
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
            // Allow the test to inject a side effect before a given msg (e.g. trigger an
            // approval); if it returns a promise, await it
            await beforeYield(m, { prompt, options });
          }
          // yield to a microtask to simulate an async stream
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

// Standard system/init message
function sysInit(sessionId = 'sess-1', model = 'claude-opus-4-test', tools = ['Bash', 'Read', 'Edit']) {
  return { type: 'system', subtype: 'init', session_id: sessionId, model, tools };
}

// Assistant message (no session_id, to avoid overwriting the id set by system/init; inject
// it via extra when needed)
function assistantMsg(content, extra = {}) {
  return { type: 'assistant', message: { role: 'assistant', content }, ...extra };
}

// Result message (likewise, no hard-coded session_id)
function resultMsg(extra = {}) {
  return { type: 'result', subtype: 'success', ...extra };
}

// Wait a few microtasks (let synchronous pushes / queue drain finish)
async function tick(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Hard afterEach cleanup: restoring the real query is each describe's own job, but state
// must be reset
afterEach(() => {
  sdk.stopSession();
});

describe('sdk-manager-query — __setQueryForTests + isSdkAvailable', () => {
  afterEach(() => { /* not restored here; left to the restore describe at the end */ });

  it('注入函数后 isSdkAvailable() 为 true；注入 null 后为 false', () => {
    const orig = sdk.isSdkAvailable();
    sdk.__setQueryForTests(() => ({ async *[Symbol.asyncIterator]() {} }));
    assert.equal(sdk.isSdkAvailable(), true);
    sdk.__setQueryForTests(null);
    assert.equal(sdk.isSdkAvailable(), false);
    // Restore to a function so as not to affect later cases (each later describe re-sets)
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

describe('sdk-manager-query — options 构造（env/settings/resume 透传）', () => {
  it('initSdkSession 传入 env/settings → 原样进入 query options', async () => {
    const { deps } = makeDeps();
    const childEnv = { ...process.env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210', DISABLE_AUTOUPDATER: '1' };
    const settings = { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:43210' } };
    const fq = makeFakeQuery([sysInit(), assistantMsg([{ type: 'text', text: 'ok' }]), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, env: childEnv, settings });

    await sdk.sendUserMessage('hi');
    await tick(4);

    const opt = fq.calls[0].options;
    assert.equal(opt.env, childEnv, 'env 应原样透传（含 ANTHROPIC_BASE_URL 指向 CCV 代理）');
    assert.equal(opt.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:43210');
    assert.deepEqual(opt.settings, settings);
    assert.equal(opt.cwd, tmpDir);
  });

  it('未传 env/settings → options 不含这两个键（SDK 侧回落 process.env 默认）', async () => {
    const { deps } = makeDeps();
    const fq = makeFakeQuery([sysInit(), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(4);

    const opt = fq.calls[0].options;
    assert.equal(opt.env, undefined);
    assert.equal(opt.settings, undefined);
  });

  it('claudeExecutable 传入 → options.pathToClaudeCodeExecutable 生效(与 PTY 同优先级解析)', async () => {
    const { deps } = makeDeps();
    const fq = makeFakeQuery([sysInit(), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, claudeExecutable: '/opt/antcc/bin/claude' });

    await sdk.sendUserMessage('hi');
    await tick(4);

    const opt = fq.calls[0].options;
    assert.equal(opt.pathToClaudeCodeExecutable, '/opt/antcc/bin/claude',
      'SDK 必须显式指定 claude 可执行文件,否则从 PATH 解析,在 agent-security headless guard 机器上会被 SIGKILL');
  });

  it('未传 claudeExecutable → options 不含 pathToClaudeCodeExecutable 键', async () => {
    const { deps } = makeDeps();
    const fq = makeFakeQuery([sysInit(), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(4);

    const opt = fq.calls[0].options;
    assert.equal(opt.pathToClaudeCodeExecutable, undefined);
  });

  it('default permissionMode → options 带 canUseTool 且无 allowDangerouslySkipPermissions', async () => {
    const { deps } = makeDeps();
    const fq = makeFakeQuery([sysInit(), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(4);

    const opt = fq.calls[0].options;
    assert.equal(typeof opt.canUseTool, 'function');
    assert.equal(opt.allowDangerouslySkipPermissions, undefined);
    assert.equal(opt.permissionMode, 'default');
  });
});

describe('sdk-manager-query — 完整一轮：init → assistant → user → result', () => {
  it('sessionId 从 system/init 落地 + result 触发一次 onTurnEnd', async () => {
    const { deps, turnEnds } = makeDeps();

    const msgs = [
      sysInit('sess-abc', 'claude-opus-4-xyz', ['Bash', 'Read']),
      assistantMsg([{ type: 'text', text: 'Hello world' }]),
      // tool result (user message)
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi there');
    await tick(5);

    // sessionId set from system/init
    assert.equal(sdk.getSessionId(), 'sess-abc');

    // result → triggers onTurnEnd once
    assert.equal(turnEnds.length, 1);
    assert.equal(turnEnds[0].sessionId, 'sess-abc');
    assert.equal(typeof turnEnds[0].ts, 'number');
  });

  it('stream_event / 未知类型消息被安全忽略（不抛、不影响 session/turnEnd）', async () => {
    const { deps, turnEnds } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
      { type: 'totally_unknown_type', foo: 'bar' },
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
    await tick(5);
    assert.equal(sdk.getSessionId(), 'sess-1');
    assert.equal(turnEnds.length, 1);
  });
});

// Shared file-level driver: returns a fake query that calls options.canUseTool(...) after
// iterating to system/init and exposes the promise to the test side via an external ctrl;
// after the test side advances via resolveApproval/cancelApproval, the fake yields result.
function makeCanUseToolQuery(toolName, input, ctrl) {
  return function fakeQuery({ options }) {
    let closed = false;
    const iterable = {
      async *[Symbol.asyncIterator]() {
        yield sysInit();
        await Promise.resolve();
        // Trigger canUseTool — do not await; save the promise for the test to advance
        ctrl.promise = options.canUseTool(toolName, input, ctrl.cutOpts || {});
        ctrl.captured = true;
        // Wait for the approval result (ctrl.promise resolves after the test side calls
        // resolveApproval)
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

describe('sdk-manager-query — canUseTool: AskUserQuestion / ExitPlanMode / 权限审批', () => {
  // These cases need to trigger canUseTool during query iteration and resolve it from the
  // other side. Approach: after yielding system/init, the fake query calls
  // options.canUseTool(...), exposes its promise to the test side, and only after the test
  // side calls resolveApproval does the fake yield result.

  it('AskUserQuestion → broadcast sdk-ask-pending → resolveApproval(answers) → allow', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'pick?' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    // Wait for the fake to trigger canUseTool and the broadcast to fire
    await tick(6);
    const pending = broadcasts.find((b) => b.type === 'sdk-ask-pending');
    assert.ok(pending, 'should broadcast sdk-ask-pending');
    assert.equal(pending.id, 'ask-1');
    assert.equal(typeof pending.timeoutMs, 'number');

    // User answers → resolveApproval
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

  it('canUseTool 无 toolUseID 时自动生成 sdk_ 前缀 id（仍能正常 allow 直通）', async () => {
    // No toolUseID provided → id goes through the `sdk_${Date.now()}_${rand}` branch.
    const { deps } = makeDeps();
    const ctrl = { cutOpts: {} }; // no toolUseID
    sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file: '/y' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
  });

  it('ExitPlanMode → resolveApproval(__cancelled__ sentinel) → deny（plan cancel-sentinel guard）', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'plan-cancel' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('ExitPlanMode', { plan: 'p' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // Inject the sentinel directly (resolveApproval does not validate kind)
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
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'ask-noreason' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'x' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // Trigger the ask branch's `reason || 'User aborted'` fallback: inject a sentinel with
    // an empty reason string
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
    // Hook throw is swallowed by try/catch → falls back to broadcasting perm-hook-pending
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));
    sdk.resolveApproval('bash-throw', { decision: 'allow' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
  });
});

// Note: the _waitForApproval timeout paths (the three "Timeout waiting..." deny messages
// for plan/ask/perm) are covered by branch-lib-sdk-manager.test.js using narrowed
// mock.timers.

describe('sdk-manager-query — bypassPermissions 模式', () => {
  it('canUseTool 常挂(npm 硬闸需要)+ allowDangerouslySkipPermissions=true，正常跑完一轮', async () => {
    const { deps, turnEnds } = makeDeps();
    const fq = makeFakeQuery([sysInit(), assistantMsg([{ type: 'text', text: 'ok' }]), resultMsg()]);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

    await sdk.sendUserMessage('go');
    await tick(5);

    // canUseTool is mounted in all modes (bypass is no exception — the npm publish hard
    // gate relies on it); allowDangerouslySkipPermissions is still only set in bypass.
    const opt = fq.calls[0].options;
    assert.equal(typeof opt.canUseTool, 'function');
    assert.equal(opt.allowDangerouslySkipPermissions, true);
    assert.equal(turnEnds.length, 1);
  });
});

describe('sdk-manager-query — 审批政策链(im-deny → npm 硬闸 → bypass early-allow)', () => {
  it('bypass + 非 publish 工具 → 直接 allow,无 broadcast 无 waterfall', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'bypass-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'rm -rf build/' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    await sendP;
    assert.deepEqual(ctrl.result, { behavior: 'allow', updatedInput: { command: 'rm -rf build/' } });
    assert.equal(broadcasts.length, 0, 'bypass early-allow 不得 broadcast');
  });

  it('bypass + npm publish → 强制走 perm 审批(broadcast perm-hook-pending + 5min 等待),allow 后放行', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'pub-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'npm publish --provenance' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // publish must still raise an approval even in bypass (SDK equivalent of the
    // perm-bridge bypass exemption)
    const pending = broadcasts.find((b) => b.type === 'perm-hook-pending');
    assert.ok(pending, 'bypass 下 npm publish 必须 broadcast perm-hook-pending');
    assert.equal(pending.id, 'pub-1');
    assert.equal(pending.toolName, 'Bash');
    // ctrl.promise is still pending (on the 5-min _waitForApproval) → resolves to allow
    sdk.resolveApproval('pub-1', { decision: 'allow' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
  });

  it('bypass + npm publish → 用户 deny → canUseTool 返回 deny', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'pub-2' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'npm publish' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));
    sdk.resolveApproval('pub-2', { decision: 'deny' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
  });

  it('非 bypass + npm publish → 走常规 perm 分支(Bash ∈ APPROVAL_TOOLS,行为不变)', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'pub-3' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'npm publish' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));
    sdk.resolveApproval('pub-3', 'allow');
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
  });

  it('CCV_IM_DENY=1 + 命中规则(rm -rf ~)→ 硬 deny;非 bypass 也生效;无 broadcast', async () => {
    process.env.CCV_IM_DENY = '1';
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'im-1' } };
      sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file_path: '~/.ssh/id_rsa' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);

      const sendP = sdk.sendUserMessage('go');
      await tick(6);
      await sendP;
      assert.equal(ctrl.result.behavior, 'deny');
      assert.ok(String(ctrl.result.message).startsWith('cc-viewer IM guard:'), 'deny 消息带 IM guard 前缀');
      assert.equal(broadcasts.length, 0, 'im-deny 硬拒不得 broadcast 弹窗');
    } finally {
      delete process.env.CCV_IM_DENY;
    }
  });

  it('CCV_IM_DENY=1 + bypass + npm publish → IM guard 赢过弹窗(硬 deny,非 perm 审批)', async () => {
    // Ordering aligns with perm-bridge.js: im-deny is evaluated before the publish
    // exemption — an IM worker's publish gets a hard deny rather than an approval dialog.
    process.env.CCV_IM_DENY = '1';
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'im-pub' } };
      sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'npm publish' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

      const sendP = sdk.sendUserMessage('go');
      await tick(6);
      await sendP;
      assert.equal(ctrl.result.behavior, 'deny');
      assert.ok(String(ctrl.result.message).startsWith('cc-viewer IM guard:'));
      assert.equal(broadcasts.filter((b) => b.type === 'perm-hook-pending').length, 0);
    } finally {
      delete process.env.CCV_IM_DENY;
    }
  });

  it('bypass + AskUserQuestion → 不被 early-allow 短路,仍走 ask 分支', async () => {
    // bypass early-allow never short-circuits interactive tools (review point): the
    // AskUserQuestion forwarded by the CLI under bypass must keep the user channel.
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'bypass-ask' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'pick?' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, permissionMode: 'bypassPermissions' });

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    const pending = broadcasts.find((b) => b.type === 'sdk-ask-pending');
    assert.ok(pending, 'bypass 下 AskUserQuestion 仍 broadcast sdk-ask-pending');
    sdk.resolveApproval('bypass-ask', { 'pick?': 'A' });
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'allow');
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

    // The second query call's options.resume should be sess-resume
    assert.equal(fq.calls.length, 2);
    assert.equal(fq.calls[1].options.resume, 'sess-resume');
  });
});

describe('sdk-manager-query — 队列 drain（忙时第二条入队后被 drain）', () => {
  it('query 进行中收到第二条 → 入队 → 第一轮结束后 drain 跑第二轮', async () => {
    const { deps } = makeDeps();
    // The fake query deliberately leaves a controllable gate between yields so we can push
    // a second message while the first round is in flight
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let round = 0;
    function fq({ options }) {
      void options;
      const myRound = round++;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-q');
          if (myRound === 0) {
            await firstGate; // hold the first round so the test can push a second message
          }
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    fq.calls = 0;
    const origFq = fq;
    let callCount = 0;
    fq = function countingFq(arg) { callCount++; return origFq(arg); };
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4); // let the first round reach await firstGate
    const p2 = sdk.sendUserMessage('second'); // _queryBusy=true → queued, resolves immediately
    const r2 = await p2;
    assert.equal(r2, undefined, '入队分支直接 return undefined');

    releaseFirst(); // release the first round → drains the second after it finishes
    await p1;
    await tick(6);

    assert.equal(callCount, 2, '入队的第二条应被 drain → 共启动两次 query');
  });
});

describe('sdk-manager-query — interruptTurn 关活跃 query + 排空 pending 审批', () => {
  it('在审批 pending 时 interruptTurn → 返回 [{id,kind}] 且 query.close 被调用', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'int-1' } };
    let closeCalled = false;
    // Custom fake: triggers canUseTool (parked) and exposes close
    function fq({ options }) {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          ctrl.promise = options.canUseTool('Bash', { command: 'ls' }, ctrl.cutOpts);
          ctrl.result = await ctrl.promise; // interrupt resolves it to null → deny
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
    // At this point the perm approval is pending
    assert.ok(broadcasts.some((b) => b.type === 'perm-hook-pending'));

    const cancelled = sdk.interruptTurn();
    assert.ok(Array.isArray(cancelled));
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].id, 'int-1');
    assert.equal(cancelled[0].kind, 'perm');

    await sendP;
    await tick(3);
    assert.equal(closeCalled, true, 'interruptTurn should close the active query');
    // pending resolved to null → canUseTool goes deny (timeout wording)
    assert.equal(ctrl.result.behavior, 'deny');
    // interrupt does not clear sessionId (keeps session continuity) — after init the
    // sessionId is set and not cleared by interrupt
    assert.equal(sdk.getSessionId(), 'sess-1');
  });

  it('interruptTurn 暂停 drain 但保留队列（Stop 保留语义）', async () => {
    const { deps } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let round = 0;
    let callCount = 0;
    function fq() {
      callCount++;
      const myRound = round++;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-int');
          if (myRound === 0) await firstGate;
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() { releaseFirst && releaseFirst(); }, // close releases the first round
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('queued'); // queued
    // interrupt: parks the queue (suppress drain) + closes the first round (close releases firstGate)
    sdk.interruptTurn();
    releaseFirst();
    await p1;
    await tick(6);

    // Drain suppressed → only the first round ran; the queued message is KEPT parked
    assert.equal(callCount, 1, 'queued message must not auto-run after interrupt');
    assert.equal(sdk.getQueueSnapshot().length, 1, 'Stop keeps the queued message parked');
    assert.equal(sdk.getQueueSnapshot()[0].text, 'queued');
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
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'stop-perm' } };
    function fq({ options }) {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          ctrl.promise = options.canUseTool('Bash', { command: 'ls' }, ctrl.cutOpts);
          ctrl.result = await ctrl.promise; // stopSession injects null → deny (timeout wording)
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

    sdk.stopSession(); // _resetFullState → reject pending with null
    await sendP;
    await tick(3);
    assert.equal(ctrl.result.behavior, 'deny');
    assert.equal(sdk.getSessionId(), null);
  });
});

describe('sdk-manager-query — onTurnEnd 抛错被吞', () => {
  it('onTurnEnd 抛错不影响 result 处理（被 try/catch 吞 + console.warn）', async () => {
    const deps = {
      broadcastWs: () => {},
      onTurnEnd: () => { throw new Error('turnEnd boom'); },
    };
    const msgs = [sysInit(), assistantMsg([{ type: 'text', text: 'x' }]), resultMsg()];
    sdk.__setQueryForTests(makeFakeQuery(msgs));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
  });
});

// ── WS reconnect replay (getPendingApprovals) / onQueryError / init+compact broadcasts ──
describe('sdk-manager-query — getPendingApprovals / onQueryError / init-compact 广播', () => {
  it('perm pending 期间 getPendingApprovals 返回带 replay payload 与剩余时间的快照', async () => {
    const { deps } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'snap-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'npm publish' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    const snap = sdk.getPendingApprovals();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].id, 'snap-1');
    assert.equal(snap[0].kind, 'perm');
    assert.equal(snap[0].replay.type, 'perm-hook-pending');
    assert.equal(snap[0].replay.toolName, 'Bash');
    assert.deepEqual(snap[0].replay.input, { command: 'npm publish' });
    assert.ok(snap[0].remainingMs > 0 && snap[0].remainingMs <= 5 * 60 * 1000);

    sdk.resolveApproval('snap-1', { decision: 'allow' });
    await sendP;
    await tick(3);
    assert.deepEqual(sdk.getPendingApprovals(), []);
  });

  it('query 迭代抛非 AbortError → onQueryError 收到 message;onTurnEnd 不触发', async () => {
    const { deps } = makeDeps();
    const errors = [];
    let calls = 0;
    function failingQuery() {
      calls++;
      return {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() { throw new Error('boom-query'); },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(failingQuery);
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, onQueryError: (m) => errors.push(m) });

    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(calls, 1);
    assert.deepEqual(errors, ['boom-query']);
  });

  it('onQueryError 未注册 → query 失败不抛(向后兼容);onQueryError 自身抛错被吞', async () => {
    const { deps } = makeDeps();
    function failingQuery() {
      return {
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() { throw new Error('x'); },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(failingQuery);
    sdk.initSdkSession(tmpDir, 'proj', deps); // no onQueryError
    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
    await tick(4);

    sdk.initSdkSession(tmpDir, 'proj', { ...deps, onQueryError: () => { throw new Error('cb boom'); } });
    await assert.doesNotReject(() => sdk.sendUserMessage('go2'));
    await tick(4);
  });

  it('system/init 带 slash_commands → 广播一次 sdk-init;同 session 重复 init 不重播', async () => {
    const { deps, broadcasts } = makeDeps();
    const init = { ...sysInit('sess-init-1'), slash_commands: ['/compact', '/clear', '/init'] };
    sdk.__setQueryForTests(makeFakeQuery([init, resultMsg()]));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('first');
    await tick(4);
    const initB = broadcasts.filter((b) => b.type === 'sdk-init');
    assert.equal(initB.length, 1);
    assert.deepEqual(initB[0].slashCommands, ['/compact', '/clear', '/init']);
    assert.equal(initB[0].sessionId, 'sess-init-1');

    // Second round with the same session init → not replayed
    sdk.__setQueryForTests(makeFakeQuery([init, resultMsg()]));
    await sdk.sendUserMessage('second');
    await tick(4);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-init').length, 1);
  });

  it('init 无 slash_commands / 空数组 → 不广播 sdk-init', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeFakeQuery([{ ...sysInit('sess-noinit'), slash_commands: [] }, resultMsg()]));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-init').length, 0);
  });

  it('compact_boundary → 广播 sdk-compact(trigger/preTokens/postTokens)', async () => {
    const { deps, broadcasts } = makeDeps();
    const compact = {
      type: 'system', subtype: 'compact_boundary', session_id: 'sess-1',
      compact_metadata: { trigger: 'auto', pre_tokens: 150000, post_tokens: 40000 },
    };
    sdk.__setQueryForTests(makeFakeQuery([sysInit(), compact, resultMsg()]));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    const cb = broadcasts.filter((b) => b.type === 'sdk-compact');
    assert.equal(cb.length, 1);
    assert.equal(cb[0].trigger, 'auto');
    assert.equal(cb[0].preTokens, 150000);
    assert.equal(cb[0].postTokens, 40000);
  });
});


// ── Queue-state broadcast / send-now / parked-queue semantics ──
// Helpers reused here: makeDeps (broadcasts capture), gate-pattern fake queries, tick().

/** Gate-pattern fake query: round 0 parks on firstGate until released; later rounds run free. */
function makeGatedQuery(calls) {
  let round = 0;
  let releaseFirst;
  const firstGate = new Promise((r) => { releaseFirst = r; });
  function fq({ prompt }) {
    if (calls) calls.push(prompt);
    const myRound = round++;
    return {
      async *[Symbol.asyncIterator]() {
        yield sysInit('sess-gated');
        if (myRound === 0) await firstGate;
        yield resultMsg();
      },
      interrupt() { return Promise.resolve(); },
      close() { releaseFirst(); },
    };
  }
  return { fq, releaseFirst: () => releaseFirst() };
}

describe('sdk-manager-query — queue-state 广播与快照', () => {
  it('忙时入队 → 广播 queue-state（{id,text,ts}），drain 后清空并再广播', async () => {
    const { deps, broadcasts } = makeDeps();
    const { fq, releaseFirst } = makeGatedQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('second');

    const last = broadcasts.filter((b) => b.type === 'queue-state').at(-1);
    assert.equal(last.items.length, 1);
    assert.equal(last.items[0].text, 'second');
    assert.ok(last.items[0].id);
    assert.equal(typeof last.items[0].ts, 'number');
    assert.deepEqual(sdk.getQueueSnapshot(), last.items);

    releaseFirst();
    await p1;
    await tick(6);
    const drained = broadcasts.filter((b) => b.type === 'queue-state').at(-1);
    assert.equal(drained.items.length, 0);
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('drain 传给 query 的是文本而非队列对象（.text 回归）', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('second');
    releaseFirst();
    await p1;
    await tick(6);

    assert.equal(calls.length, 2);
    assert.equal(calls[1], 'second', 'drain must pass the queued TEXT, not the queue item object');
  });
});

describe('sdk-manager-query — sendQueuedNow', () => {
  it('忙时 send-now：打断当前回合，目标消息成为下一个执行项，其余随后 drain', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('second');
    await sdk.sendUserMessage('third');
    const snap = sdk.getQueueSnapshot();
    assert.equal(snap.length, 2);

    const cancelled = sdk.sendQueuedNow(snap[1].id); // prioritize 'third'
    assert.ok(Array.isArray(cancelled));
    releaseFirst(); // no-op if close() already released; harmless either way
    await p1;
    await tick(10);

    assert.deepEqual(calls, ['first', 'third', 'second'], 'prioritized item runs next; the rest drain after it');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('未知 id → 返回 [] 且不广播不打断（守卫必须先于 interrupt）', async () => {
    const { deps, broadcasts } = makeDeps();
    let closeCalled = false;
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    function fq() {
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-guard');
          await firstGate; // park the turn so an erroneous interrupt would be observable
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() { closeCalled = true; },
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    const before = broadcasts.length;
    assert.deepEqual(sdk.sendQueuedNow('q_unknown'), []);
    await tick(3);
    assert.equal(broadcasts.length, before, 'unknown id must not broadcast');
    assert.equal(closeCalled, false, 'unknown id must not interrupt the running turn');
    releaseFirst();
    await p1;
    await tick(4);
  });

  it('空闲（Stop 后 parked）→ 立即执行该消息，随后 drain 其余 parked 项', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq } = makeGatedQuery(calls);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('a');
    await sdk.sendUserMessage('b');
    sdk.interruptTurn(); // parks [a, b]; close() releases round 0
    await p1;
    await tick(6);
    assert.equal(sdk.getQueueSnapshot().length, 2);
    assert.equal(calls.length, 1);

    const bId = sdk.getQueueSnapshot()[1].id;
    sdk.sendQueuedNow(bId); // idle → run 'b' immediately
    await tick(10);

    assert.deepEqual(calls, ['first', 'b', 'a'], 'send-now executes the picked item, then the parked rest drains');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('P0 回归：Stop 后 unwind 窗口内（_queryBusy 仍 true）send-now 不丢消息', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let round = 0;
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    function fq({ prompt }) {
      calls.push(prompt);
      const myRound = round++;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-p0');
          if (myRound === 0) await firstGate;
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {}, // does NOT release the gate — the unwind stays in flight until releaseFirst()
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('x');
    sdk.interruptTurn(); // suppress=true; the aborted generator is STILL parked on firstGate
    const snap = sdk.getQueueSnapshot();
    assert.equal(snap.length, 1);
    sdk.sendQueuedNow(snap[0].id); // busy branch (unwind pending) — must lift the Stop-park
    releaseFirst();
    await p1;
    await tick(10);

    assert.deepEqual(calls, ['first', 'x'], 'send-now in the unwind window must still execute the message');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });
});

describe('sdk-manager-query — removeQueued / interruptTurn 广播', () => {
  it('removeQueued 删除并广播；interruptTurn 保留队列并广播当前快照', async () => {
    const { deps, broadcasts } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('a');
    await sdk.sendUserMessage('b');

    const snap = sdk.getQueueSnapshot();
    assert.equal(sdk.removeQueued(snap[0].id), true);
    assert.deepEqual(sdk.getQueueSnapshot().map((i) => i.text), ['b']);
    assert.equal(sdk.removeQueued('q_nope'), false);

    sdk.interruptTurn();
    const qs = broadcasts.filter((m) => m.type === 'queue-state').at(-1);
    assert.equal(qs.items.length, 1);
    assert.equal(qs.items[0].text, 'b');

    releaseFirst();
    await p1;
    await tick(6);
    assert.equal(calls.length, 1, 'drain suppressed after Stop — parked item never ran');
  });

  it('drain 途中某条 query 抛错 → 后续消息仍被 drain', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let round = 0;
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    function fq({ prompt }) {
      calls.push(prompt);
      const myRound = round++;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit('sess-err');
          if (myRound === 0) await firstGate;
          if (myRound === 1) throw new Error('boom');
          yield resultMsg();
        },
        interrupt() { return Promise.resolve(); },
        close() {},
      };
    }
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(4);
    await sdk.sendUserMessage('bad');
    await sdk.sendUserMessage('good');
    releaseFirst();
    await p1;
    await tick(10);

    assert.deepEqual(calls, ['first', 'bad', 'good'], 'an errored drained turn must not wedge the queue');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });
});


// ── At the end: restore the real query to avoid polluting other sdk-manager test files
// ── in the same process ──
describe('sdk-manager-query — restore', () => {
  it('恢复真实 _query（重新 import 取得 sdk.query）', async () => {
    let realQuery;
    try {
      const real = await import('@anthropic-ai/claude-agent-sdk');
      realQuery = real.query;
    } catch { realQuery = undefined; }
    sdk.__setQueryForTests(realQuery);
    // After restore, isSdkAvailable matches the real environment (package installed → true)
    assert.equal(typeof realQuery === 'function', sdk.isSdkAvailable());
    sdk.stopSession();
  });
});
