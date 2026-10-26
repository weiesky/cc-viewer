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

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest as _resetErrReport } from '@ccv/core/error-report';

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

// Resident-mode fake query factory: the sdk-manager now constructs ONE long-lived
// query per session (streaming input) and pushes one SDKUserMessage per turn into a
// never-ending input queue. The fake mirrors that: it consumes the pushed messages
// via for-await, yields the `initMsgs` once at construction, then runs respond(msg)
// per pushed message (default: one resultMsg).
//
// Exposed controls:
//   calls        — [{ options, pushed }] per construction (pushed = SDKUserMessages consumed)
//   interruptCalls / closeCalls — control-surface counters
//   releaseNextInterrupt() — make the NEXT interrupt() synchronously release the current
//                   turn (yield the pending respond output), simulating the CLI's
//                   "interrupt → turn wraps up with a result" contract
//   autoRelease(ms) — real-timer fallback release (tests that mock setTimeout must NOT
//                   use this — the grace timer shares the mocked API)
//   endWith(err) — end the output stream (err → throw): session-level death
//   released     — count of released (completed) turns
//   endAfter     — >0: end the stream cleanly after that many completed turns
//                  (models a session that exits on its own while the queue is parked)
function makeResidentQuery({ respond, initMsgs, autoRelease = 0, endAfter = 0, getContextUsage, mcpServerStatus, supportedCommands } = {}) {
  const calls = [];
  let current = null;
  function fakeQuery({ prompt, options }) {
    const rec = { options, pushed: [] };
    calls.push(rec);
    const state = {
      ended: false, err: null, released: 0,
      interruptCalls: 0, closeCalls: 0,
      releaseNext: false, releaseCurrent: null, turn: null,
      ctxUsageCalls: 0, ctxUsagePending: null,
      mcpStatusCalls: 0, mcpStatusPending: null,
      supportedCommandsCalls: 0, supportedCommandsPending: null,
    };
    current = state;
    rec.state = state; // cross-generation counters (e.g. supportedCommandsCalls) aggregate via calls[].state
    const api = {
      // Optional control-surface mock. getContextUsage(spec): { resolve, reject, defer } —
      // a value / Error / deferred gate. close() rejects any in-flight request (the real
      // SDK's Query.cleanup rejects pending control responses on teardown). For deferred
      // gates the spec's promise IS returned, so the test-owned `state.ctxUsagePending`
      // stays readable until the test itself settles it (finally-tracking would clear it
      // as soon as the manager's .finally ran, before the test could inspect/release).
      async getContextUsage() {
        state.ctxUsageCalls++;
        const spec = typeof getContextUsage === 'function' ? getContextUsage(state.ctxUsageCalls) : getContextUsage;
        if (spec && spec.defer) {
          state.ctxKeepOnClose = spec.keepOnClose === true;
          return new Promise((res, rej) => {
            state.ctxUsagePending = {
              resolve: (v) => { state.ctxUsagePending = null; res(v); },
              reject: (e) => { state.ctxUsagePending = null; rej(e); },
            };
          });
        }
        if (spec && spec.reject) {
          return Promise.reject(spec.reject instanceof Error ? spec.reject : new Error(String(spec.reject)));
        }
        return Promise.resolve(spec && 'resolve' in spec ? spec.resolve : spec);
      },
      // Optional control-surface mock, getContextUsage parity. mcpServerStatus(spec):
      // { resolve, reject, defer, keepOnClose } — a value / Error / deferred gate. The
      // resolve value is an ARRAY (McpServerStatus[]); an empty array is legitimate.
      async mcpServerStatus() {
        state.mcpStatusCalls++;
        const spec = typeof mcpServerStatus === 'function' ? mcpServerStatus(state.mcpStatusCalls) : mcpServerStatus;
        if (spec && spec.defer) {
          state.mcpKeepOnClose = spec.keepOnClose === true;
          return new Promise((res, rej) => {
            state.mcpStatusPending = {
              resolve: (v) => { state.mcpStatusPending = null; res(v); },
              reject: (e) => { state.mcpStatusPending = null; rej(e); },
            };
          });
        }
        if (spec && spec.reject) {
          return Promise.reject(spec.reject instanceof Error ? spec.reject : new Error(String(spec.reject)));
        }
        return Promise.resolve(spec && 'resolve' in spec ? spec.resolve : spec);
      },
      // Optional control-surface mock, getContextUsage parity. supportedCommands(spec):
      // { resolve, reject, defer, keepOnClose } — the resolve value is a SlashCommand[]
      // (skill surface). Counted so tests can assert the once-per-query-generation dedupe.
      // Attached conditionally below (only when the caller passes supportedCommands) so
      // canUseTool/queue/task fakes that never opt in have no such method and emit no frame.
      async *[Symbol.asyncIterator]() {
        const done = () => { if (state.err) throw state.err; };
        const runRespond = async (msg) => {
          if (!respond) return [resultMsg()];
          // A respond() that REJECTS parks the turn instead (gate pattern) — real CLI
          // turns wait on tool calls; only iterator-level death (endWith) throws.
          // The death race is wired through: endWith while respond is awaiting (its
          // gate, an approval, …) short-circuits the wait so the death is observed.
          try {
            return await Promise.race([
              respond(msg, { options, state, call: rec }),
              new Promise((res) => { state.deathWake = () => res(undefined); }),
            ]);
          } catch { return null; }
        };
        for (const m of initMsgs || []) {
          if (state.ended) { done(); return; }
          await Promise.resolve();
          yield m;
        }
        for await (const msg of prompt) {
          if (state.ended) { done(); return; }
          rec.pushed.push(msg);
          let out = await runRespond(msg);
          if (out == null) {
            if (state.ended) { done(); return; } // death short-circuited the respond wait
            // Parked turn (gate / approval in flight): wait for a release — explicit
            // (releaseCurrent), interrupt-triggered, timer-based, or close/teardown.
            await new Promise((resolve) => {
              state.turn = { resolve };
              state.releaseCurrent = resolve;
              if (state.interruptReleasePending) {
                // The interrupt arrived while respond() was still awaiting — release now.
                state.interruptReleasePending = false;
                state.releaseNext = false;
                resolve();
              } else if (autoRelease > 0) setTimeout(resolve, autoRelease);
            });
            state.turn = null;
            state.releaseCurrent = null;
            // close()/teardown ends the stream WITHOUT completing the turn (the CLI
            // child dies mid-turn: no result). Explicit/interrupt releases re-run
            // respond below (the turn wraps up and yields its result).
            if (state.ended) { done(); return; }
            out = await runRespond(msg);
            if (out == null) continue; // re-park refused: skip this turn's output
          }
          state.released++;
          for (const m of out) {
            if (state.ended) { done(); return; }
            await Promise.resolve();
            yield m;
          }
          // Optional generation exit: the iterator ends after N completed turns even
          // while the push queue is still open (natural session death).
          if (endAfter > 0 && state.released >= endAfter) { done(); return; }
        }
        done();
      },
      interrupt() {
        state.interruptCalls++;
        // Honor a pending releaseNext request: the CLI's interrupt lets the in-flight
        // turn wrap up and emit its (error) result. The turn may still be inside
        // respond() (approval/gate wait) with no parked-release registered yet —
        // remember the request until the turn parks.
        if (state.releaseNext) {
          if (state.releaseCurrent) {
            state.releaseNext = false;
            state.releaseCurrent();
          } else {
            state.interruptReleasePending = true;
          }
        }
        return Promise.resolve();
      },
      close() {
        state.closeCalls++;
        state.ended = true;
        if (state.releaseCurrent) state.releaseCurrent();
        // Real SDK teardown rejects in-flight control requests (Query.cleanup). A deferred
        // spec may opt out (keepOnClose) to model a resolve-late-after-teardown race.
        if (state.ctxUsagePending && !state.ctxKeepOnClose) {
          state.ctxUsagePending.reject(new Error('Query closed before response received'));
        }
        if (state.mcpStatusPending && !state.mcpKeepOnClose) {
          state.mcpStatusPending.reject(new Error('Query closed before response received'));
        }
        if (state.supportedCommandsPending && !state.scKeepOnClose) {
          state.supportedCommandsPending.reject(new Error('Query closed before response received'));
        }
      },
    };
    // Attach supportedCommands only when the caller opted in — otherwise the query has no
    // such control method (older SDK), and sdk-manager's typeof guard skips the fetch.
    if (supportedCommands !== undefined) {
      api.supportedCommands = async () => {
        state.supportedCommandsCalls++;
        const spec = typeof supportedCommands === 'function' ? supportedCommands(state.supportedCommandsCalls) : supportedCommands;
        if (spec && spec.defer) {
          state.scKeepOnClose = spec.keepOnClose === true;
          return new Promise((res, rej) => {
            state.supportedCommandsPending = {
              resolve: (v) => { state.supportedCommandsPending = null; res(v); },
              reject: (e) => { state.supportedCommandsPending = null; rej(e); },
            };
          });
        }
        if (spec && spec.reject) {
          return Promise.reject(spec.reject instanceof Error ? spec.reject : new Error(String(spec.reject)));
        }
        return Promise.resolve(spec && 'resolve' in spec ? spec.resolve : spec);
      };
    }
    return api;
  }
  fakeQuery.calls = calls;
  fakeQuery.current = () => current;
  fakeQuery.releaseNextInterrupt = () => {
    if (!current) return;
    current.releaseNext = true;
    // The turn may already be parked when this is called — release immediately.
    if (current.releaseCurrent) {
      current.releaseNext = false;
      current.releaseCurrent();
    }
  };
  fakeQuery.endWith = (err) => {
    if (!current) return;
    current.err = err || null;
    current.ended = true;
    // Wake any pending wait (parked turn OR an in-flight respond) so the iterator
    // observes the end promptly — a death detected while idle-waiting for input only
    // surfaces at the next turn boundary (matching the real SDK's for-await laziness).
    if (current.releaseCurrent) current.releaseCurrent();
    if (current.deathWake) current.deathWake();
  };
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

// Text a pushed SDKUserMessage carries (assertions should use this, never raw objects)
function pushedText(msg) {
  return msg && msg.message && msg.message.content && msg.message.content[0] && msg.message.content[0].text;
}

// Wait a few microtasks (let synchronous pushes / queue drain finish)
async function tick(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Poll a condition across microtasks — used under mock.timers to confirm a side effect
// (e.g. interrupt() called → grace timer registered) before ticking fake time.
async function waitMicro(cond, max = 60) {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    await Promise.resolve();
  }
  return cond();
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
    const fq = makeResidentQuery({ initMsgs: [sysInit()], respond: () => [assistantMsg([{ type: 'text', text: 'ok' }]), resultMsg()] });
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
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
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
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
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
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hi');
    await tick(4);

    const opt = fq.calls[0].options;
    assert.equal(opt.pathToClaudeCodeExecutable, undefined);
  });

  it('default permissionMode → options 带 canUseTool 且无 allowDangerouslySkipPermissions', async () => {
    const { deps } = makeDeps();
    const fq = makeResidentQuery({ initMsgs: [sysInit()] });
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
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [msgs[0]],
      respond: () => msgs.slice(1),
    }));
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
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
      { type: 'totally_unknown_type', foo: 'bar' },
      resultMsg(),
    ];
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()], respond: () => msgs }));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await assert.doesNotReject(() => sdk.sendUserMessage('go'));
    await tick(5);
    assert.equal(sdk.getSessionId(), 'sess-1');
    assert.equal(turnEnds.length, 1);
  });
});

// Shared file-level driver: a resident fake that, on the first pushed message, calls
// options.canUseTool(...) and exposes its promise to the test side via ctrl; after the
// test advances via resolveApproval/cancelApproval, the fake yields result for that turn.
function makeCanUseToolQuery(toolName, input, ctrl) {
  return makeResidentQuery({
    initMsgs: [sysInit()],
    respond: async (msg, { options }) => {
      void msg;
      if (ctrl.used) return [resultMsg()];
      ctrl.used = true;
      ctrl.promise = options.canUseTool(toolName, input, ctrl.cutOpts || {});
      ctrl.captured = true;
      ctrl.result = await ctrl.promise;
      return [resultMsg()];
    },
  });
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
    const planPending = broadcasts.find((b) => b.type === 'sdk-plan-pending' && b.id === 'plan-1');
    assert.ok(planPending, 'should broadcast the plan approval');
    assert.ok(planPending.instanceKey, 'plan approval must carry its owning instance for view-scoped auto-approval');
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
    // turn-level sdk-session-state frames (running/idle) are expected on every turn;
    // this assertion guards that no APPROVAL/modal frame fires for a plain Read.
    assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
  });

  it('非审批类工具（Agent）→ 直接 allow，不 broadcast', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'agent-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Agent', { description: 'sub' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.deepEqual(ctrl.result.updatedInput, { description: 'sub' });
    assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
  });

  it('非审批类工具（mcp__*）→ 直接 allow，不 broadcast', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'mcp-1' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('mcp__github__create_issue', { title: 'x' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrl.result.behavior, 'allow');
    assert.deepEqual(ctrl.result.updatedInput, { title: 'x' });
    assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
  });

  it('目录外 Read + 自动审批开启 → allow + updatedPermissions.addDirectories', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'read-out' } };
    const prevProjectDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = tmpDir;
    // Enable auto-approve so the session directory grant is added
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify({ autoApproveSeconds: -1 }));
    try {
      sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file_path: '/outside/subdir/file.txt' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(ctrl.result.behavior, 'allow');
      assert.deepEqual(ctrl.result.updatedInput, { file_path: '/outside/subdir/file.txt' });
      assert.deepEqual(ctrl.result.updatedPermissions, [
        { type: 'addDirectories', directories: ['/outside/subdir'], destination: 'session' },
      ]);
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
    } finally {
      if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prevProjectDir;
      try { rmSync(join(tmpDir, 'preferences.json'), { force: true }); } catch {}
    }
  });

  it('目录外 Read + 自动审批关闭 → allow 但无 updatedPermissions', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'read-out-off' } };
    const prevProjectDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = tmpDir;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify({ autoApproveSeconds: 0 }));
    try {
      sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file_path: '/outside/file.txt' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(ctrl.result.behavior, 'allow');
      assert.equal(ctrl.result.updatedPermissions, undefined);
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
    } finally {
      if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prevProjectDir;
      try { rmSync(join(tmpDir, 'preferences.json'), { force: true }); } catch {}
    }
  });

  it('目录外 Grep + 自动审批开启 → allow + updatedPermissions.addDirectories', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'grep-out' } };
    const prevProjectDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = tmpDir;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify({ autoApproveSeconds: -1 }));
    try {
      sdk.__setQueryForTests(makeCanUseToolQuery('Grep', { pattern: 'foo', path: '/outside/subdir' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(ctrl.result.behavior, 'allow');
      assert.deepEqual(ctrl.result.updatedPermissions, [
        { type: 'addDirectories', directories: ['/outside/subdir'], destination: 'session' },
      ]);
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
    } finally {
      if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prevProjectDir;
      try { rmSync(join(tmpDir, 'preferences.json'), { force: true }); } catch {}
    }
  });

  it('目录外 Glob + 自动审批开启 → allow + updatedPermissions.addDirectories', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'glob-out' } };
    const prevProjectDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = tmpDir;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify({ autoApproveSeconds: -1 }));
    try {
      sdk.__setQueryForTests(makeCanUseToolQuery('Glob', { pattern: '**/*.js', path: '/outside/subdir' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(ctrl.result.behavior, 'allow');
      assert.deepEqual(ctrl.result.updatedPermissions, [
        { type: 'addDirectories', directories: ['/outside/subdir'], destination: 'session' },
      ]);
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
    } finally {
      if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prevProjectDir;
      try { rmSync(join(tmpDir, 'preferences.json'), { force: true }); } catch {}
    }
  });

  it('目录外 Read + 自动审批开启 + 过度信任目录 → allow 但无 updatedPermissions', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'read-etc' } };
    const prevProjectDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = tmpDir;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify({ autoApproveSeconds: -1 }));
    try {
      sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file_path: '/etc/passwd' }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(ctrl.result.behavior, 'allow');
      assert.equal(ctrl.result.updatedPermissions, undefined);
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
    } finally {
      if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prevProjectDir;
      try { rmSync(join(tmpDir, 'preferences.json'), { force: true }); } catch {}
    }
  });

  it('目录内 Read → 直接 allow，无 updatedPermissions', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'read-in' } };
    const prevProjectDir = process.env.CCV_PROJECT_DIR;
    process.env.CCV_PROJECT_DIR = tmpDir;
    try {
      sdk.__setQueryForTests(makeCanUseToolQuery('Read', { file_path: join(tmpDir, 'file.txt') }, ctrl));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(ctrl.result.behavior, 'allow');
      assert.equal(ctrl.result.updatedPermissions, undefined);
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), []);
    } finally {
      if (prevProjectDir === undefined) delete process.env.CCV_PROJECT_DIR;
      else process.env.CCV_PROJECT_DIR = prevProjectDir;
    }
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

  it('stopSession 清掉进程级 wiring：再 init 省略 runWaterfallHook 不继承上一个 hook（防跨用例泄漏）', async () => {
    // Regression: initSdkSession 只在「显式传入」时覆盖进程级回调（省略即保留，
    // 保护 cli.js 的进程级接线不被 per-workspace launch init 冲掉）。该守卫的反面
    // 是「上一个注册者的 hook 会泄漏到下一个 init」——stopSession 是硬清边界，必须
    // 彻底断线，否则在同一个 tmpDir 上先注册 deny hook、再跑 sentinel 用例时，perm
    // 分支会先撞到残留的 onPermRequest=deny → 'Plugin denied'，永远到不了 sentinel guard。
    const { deps } = makeDeps();
    const ctrlA = { cutOpts: { toolUseID: 'leak-a' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrlA));
    sdk.initSdkSession(tmpDir, 'proj', {
      ...deps,
      runWaterfallHook: async (name) => (name === 'onPermRequest' ? { decision: 'deny' } : {}),
    });
    await sdk.sendUserMessage('go');
    await tick(4);
    assert.equal(ctrlA.result.behavior, 'deny'); // poisoned generation: hook denies

    sdk.stopSession(); // hard boundary — must drop the wiring

    // Re-init WITHOUT runWaterfallHook on the SAME cwd: the deny hook must NOT survive.
    const ctrlB = { cutOpts: { toolUseID: 'leak-b' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrlB));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const sendP = sdk.sendUserMessage('go');
    await tick(6);
    // No waterfall → reaches the perm broadcast + _waitForApproval; resolve it to allow.
    assert.equal(sdk.resolveApproval('leak-b', { decision: 'allow' }), true, 'no residual hook: normal approval flow reached');
    await sendP;
    await tick(4);
    assert.equal(ctrlB.result.behavior, 'allow', 'stale onPermRequest hook must not survive stopSession');
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
    const fq = makeResidentQuery({ initMsgs: [sysInit()], respond: () => [assistantMsg([{ type: 'text', text: 'ok' }]), resultMsg()] });
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
    assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), [], 'bypass early-allow 不得 broadcast(回合状态帧除外)');
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
      assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state'), [], 'im-deny 硬拒不得 broadcast 弹窗(回合状态帧除外)');
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
  it('常驻 query 只构造一次；两轮消息都推入同一输入流', async () => {
    const { deps } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-resume')],
      respond: () => [assistantMsg([{ type: 'text', text: 'a' }]), resultMsg()],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('first');
    await tick(4);
    assert.equal(sdk.getSessionId(), 'sess-resume');

    await sdk.sendUserMessage('second');
    await tick(4);

    // Resident: a single construction; both turns are pushed into the same input queue
    assert.equal(fq.calls.length, 1);
    assert.deepEqual(fq.calls[0].pushed.map(pushedText), ['first', 'second']);
  });

  it('会话死亡后下一条消息惰性重建，options.resume = 已捕获的 sessionId', async () => {
    const { deps } = makeDeps();
    const errors = [];
    let generation = 0;
    let releaseTurn;
    const gate = new Promise((r) => { releaseTurn = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-die')],
      respond: async () => { if (generation === 0) { await gate; return null; } return [resultMsg()]; },
    });
    sdk.__setQueryForTests((arg) => { generation = fq.calls.length; return fq(arg); });
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, onQueryError: (m) => errors.push(m) });

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    assert.equal(fq.calls.length, 1);

    fq.endWith(new Error('boom')); // session-level death mid-turn
    await p1; // settled by the death path — must not hang
    await tick(4);
    assert.deepEqual(errors, ['boom']);

    await sdk.sendUserMessage('second'); // lazy reconstruction
    await tick(6);
    assert.equal(fq.calls.length, 2);
    assert.equal(fq.calls[1].options.resume, 'sess-die');
  });
});

describe('sdk-manager-query — 队列 drain（忙时第二条入队后被 drain）', () => {
  it('回合进行中收到第二条 → 入队 → 第一回合 result 后 drain 推第二轮', async () => {
    const { deps } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-q')],
      respond: async () => {
        if (idx++ === 0) await firstGate; // hold the first turn so the test can queue
        return [resultMsg()];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5); // let the first turn reach the gate
    const p2 = sdk.sendUserMessage('second'); // _queryBusy=true → queued, resolves immediately
    const r2 = await p2;
    assert.equal(r2, undefined, '入队分支直接 return undefined');

    releaseFirst();
    await p1;
    await tick(6);

    assert.equal(fq.calls.length, 1, '常驻：同一构造');
    assert.deepEqual(fq.calls[0].pushed.map(pushedText), ['first', 'second'], '入队的第二条应被 drain 推入');
  });
});

describe('sdk-manager-query — interruptTurn 真中断 + 排空 pending 审批', () => {
  it('在审批 pending 时 interruptTurn → 返回 [{id,kind}] 且调用 interrupt() 而非 close()', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'int-1' } };
    // interrupt() releases the parked approval turn (CLI contract: interrupt lets the
    // turn wrap up with a synthesized result)
    const fq = makeResidentQuery({
      initMsgs: [sysInit()],
      respond: async (m, { options, state }) => {
        void m;
        if (ctrl.used) return [resultMsg()];
        ctrl.used = true;
        ctrl.promise = options.canUseTool('Bash', { command: 'ls' }, ctrl.cutOpts);
        const approved = ctrl.promise.then((r) => { ctrl.result = r; });
        state.releaseNext = true; // interrupt() → release → approval result → result msg
        await approved;
        return [resultMsg()];
      },
    });
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
    await tick(4);
    assert.equal(fq.current().interruptCalls, 1, 'interruptTurn 应走 interrupt()');
    assert.equal(fq.current().closeCalls, 0, '常驻模式 Stop 不得 close 常驻进程');
    // pending resolved to null → canUseTool goes deny
    assert.equal(ctrl.result.behavior, 'deny');
    // interrupt does not clear sessionId (keeps session continuity)
    assert.equal(sdk.getSessionId(), 'sess-1');
  });

  it('interruptTurn 暂停 drain 但保留队列（Stop 保留语义）', async () => {
    const { deps } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-int')],
      respond: async () => {
        if (idx++ === 0) await firstGate;
        return [resultMsg()];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('queued'); // queued
    // interrupt: parks the queue (suppress drain); release the turn manually
    sdk.interruptTurn();
    releaseFirst();
    await p1;
    await tick(6);

    // Drain suppressed → only the first turn was pushed; the queued message is KEPT parked
    assert.deepEqual(fq.calls[0].pushed.map(pushedText), ['first'], 'queued message must not auto-run after interrupt');
    assert.equal(sdk.getQueueSnapshot().length, 1, 'Stop keeps the queued message parked');
    assert.equal(sdk.getQueueSnapshot()[0].text, 'queued');
  });

  it('被中断回合的 error result 不弹 sdk-error toast（interrupted 标记）', async () => {
    const { deps, broadcasts } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-interr')],
      respond: async () => {
        if (idx++ === 0) await firstGate;
        // CLI synthesizes an error result for an aborted turn
        return [resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['turn aborted'] })];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    sdk.interruptTurn();
    releaseFirst();
    await p1;
    await tick(4);

    assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0, '中断回合的错误 result 不应弹 toast');
  });

  it('失败回合广播 sdk-error 帧且带完整路由信封（cwd/sessionId/instanceKey)，回合仍收尾', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-turn-err')],
      respond: () => [resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['API Error: 502 Proxy Error'] })],
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('boom');
    await tick(5);

    const frames = broadcasts.filter((b) => b.type === 'sdk-error');
    assert.equal(frames.length, 1, 'errored result must broadcast exactly one sdk-error frame');
    assert.equal(frames[0].message, 'API Error: 502 Proxy Error');
    assert.equal(frames[0].cwd, tmpDir, 'frame carries the session cwd for project routing');
    assert.equal(frames[0].sessionId, 'sess-turn-err');
    const expectedKey = sdk.listSdkSessions().find((s) => s.cwd === tmpDir).instanceKey;
    assert.equal(frames[0].instanceKey, expectedKey);
    assert.match(frames[0].instanceKey, /^ccv-[0-9a-f]+$/);
    assert.equal(turnEnds.length, 1, 'failed turn must still settle (onTurnEnd) instead of hanging');
  });

  it('grace 兜底：interrupt 后无 result → 10s 强制 settle；迟到的 result 被墓碑丢弃不错位', async () => {
    const { deps, turnEnds } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-grace')],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (idx++ === 0) await firstGate; // first turn: parked until manual release
        return [resultMsg()];
      },
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);

      const p1 = sdk.sendUserMessage('first');
      await tick(5);
      sdk.interruptTurn();
      await waitMicro(() => fq.current().interruptCalls === 1);
      // No result arrives → grace force-settles the turn
      mock.timers.tick(11 * 1000);
      await p1; // settled via grace — no hang
      await tick(6);
      assert.equal(turnEnds.length, 0, 'grace force-settle 不伪造 turnEnd');

      // The late result for the interrupted turn arrives now (gate released)…
      releaseFirst();
      await tick(6);
      // …and must be tombstoned (no turnEnd, no settling of a future turn)
      assert.equal(turnEnds.length, 0, '迟到 result 被墓碑消费');

      // A fresh turn runs clean on the same resident query
      await sdk.sendUserMessage('second');
      await tick(8);
      assert.deepEqual(calls, ['first', 'second']);
      assert.equal(turnEnds.length, 1, '新回合正常触发 turnEnd');
    } finally {
      mock.timers.reset();
    }
  });
});

describe('sdk-manager-query — stopSession 关 query 并清会话', () => {
  it('stopSession 调用 query.close 并把 sessionId 归 null', async () => {
    const { deps } = makeDeps();
    let releaseGate;
    const gate = new Promise((r) => { releaseGate = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-stop')],
      respond: async () => { await gate; return [resultMsg()]; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p = sdk.sendUserMessage('go');
    await tick(5);
    assert.equal(sdk.getSessionId(), 'sess-stop');

    sdk.stopSession(); // teardown ends the input queue + closes the query
    await p;
    await tick(3);
    assert.equal(fq.current().closeCalls, 1);
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
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [assistantMsg([{ type: 'text', text: 'x' }]), resultMsg()],
    }));
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
    const { deps, turnEnds } = makeDeps();
    const errors = [];
    const metas = [];
    let generation = 0;
    let releaseTurn;
    const gate = new Promise((r) => { releaseTurn = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-fail')],
      respond: async () => { if (generation === 0) { await gate; return null; } return [resultMsg()]; },
    });
    sdk.__setQueryForTests((arg) => { generation = fq.calls.length; return fq(arg); });
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, onQueryError: (m, meta) => { errors.push(m); metas.push(meta); } });

    const sendP = sdk.sendUserMessage('go');
    await tick(5);
    fq.endWith(new Error('boom-query')); // iterator death mid-turn
    await sendP; // settled by the death path — must not hang
    await tick(4);
    assert.deepEqual(errors, ['boom-query']);
    assert.equal(turnEnds.length, 0);
    // Routing envelope comes from the session closure (callers pass no meta).
    assert.equal(metas.length, 1, 'onQueryError receives a routing meta second arg');
    assert.equal(metas[0].cwd, tmpDir);
    assert.equal(metas[0].sessionId, 'sess-fail');
    const expectedKey = sdk.listSdkSessions().find((s) => s.cwd === tmpDir).instanceKey;
    assert.equal(metas[0].instanceKey, expectedKey);
  });

  it('onQueryError 未注册 → 会话死亡不抛(向后兼容);onQueryError 自身抛错被吞', async () => {
    const { deps } = makeDeps();
    const fq = makeResidentQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps); // no onQueryError
    const p1 = sdk.sendUserMessage('go');
    fq.endWith(new Error('x'));
    await assert.doesNotReject(() => p1);
    await tick(4);

    sdk.initSdkSession(tmpDir, 'proj', { ...deps, onQueryError: () => { throw new Error('cb boom'); } });
    const p2 = sdk.sendUserMessage('go2');
    fq.endWith(new Error('y'));
    await assert.doesNotReject(() => p2);
    await tick(4);
  });

  it('query 迭代抛 AbortError → onQueryError 不触发(teardown/interrupt 语义,非错误)', async () => {
    const { deps } = makeDeps();
    const errors = [];
    const fq = makeResidentQuery({ initMsgs: [sysInit('sess-abort')] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', { ...deps, onQueryError: (m) => errors.push(m) });

    const p = sdk.sendUserMessage('go');
    await tick(5);
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    fq.endWith(abortErr);
    await p;
    await tick(4);
    assert.deepEqual(errors, [], 'AbortError death must not surface as an sdk-error');
  });

  it('system/init 带 slash_commands → 广播一次 sdk-init;同 session 重复 init 不重播', async () => {
    const { deps, broadcasts } = makeDeps();
    const init = { ...sysInit('sess-init-1'), slash_commands: ['/compact', '/clear', '/init'] };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [init] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('first');
    await tick(4);
    const initB = broadcasts.filter((b) => b.type === 'sdk-init');
    assert.equal(initB.length, 1);
    assert.deepEqual(initB[0].slashCommands, ['/compact', '/clear', '/init']);
    assert.equal(initB[0].sessionId, 'sess-init-1');

    // Second turn on the same resident query → init is not re-emitted (the CLI sends
    // init once per process, and even a duplicate would be deduped by session id)
    await sdk.sendUserMessage('second');
    await tick(4);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-init').length, 1);
  });

  it('init 无 slash_commands / 空数组 → 不广播 sdk-init', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [{ ...sysInit('sess-noinit'), slash_commands: [] }] }));
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
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit()], respond: () => [compact, resultMsg()] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    const cb = broadcasts.filter((b) => b.type === 'sdk-compact');
    assert.equal(cb.length, 1);
    assert.equal(cb[0].trigger, 'auto');
    assert.equal(cb[0].preTokens, 150000);
    assert.equal(cb[0].postTokens, 40000);
  });

  describe('sdk-skills 通道 (supportedCommands)', () => {
    it('init → 拉取 supportedCommands 并广播一次 sdk-skills,快照可取', async () => {
      const { deps, broadcasts } = makeDeps();
      const commands = [{ name: 'review', description: 'Review a PR', argumentHint: '<pr>', aliases: ['code-review'] }];
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [{ ...sysInit('sess-skills-1'), skills: ['review'] }],
        supportedCommands: { resolve: commands },
      }));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      const sk = broadcasts.filter((b) => b.type === 'sdk-skills');
      assert.equal(sk.length, 1, '广播一次 sdk-skills');
      assert.deepEqual(sk[0].commands, commands, 'commands 透传');
      assert.equal(sk[0].sessionId, 'sess-skills-1');
      assert.deepEqual(sdk.getSkillsSnapshot(), sk[0], '快照即该帧');
    });

    it('supportedCommands reject → 无 sdk-skills 帧、无 sdk-error', async () => {
      const { deps, broadcasts } = makeDeps();
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [sysInit('sess-skills-rej')],
        supportedCommands: { reject: new Error('boom') },
      }));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-skills').length, 0);
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0);
      assert.equal(sdk.getSkillsSnapshot(), null);
    });

    it('init 无 slash_commands 仍拉取技能', async () => {
      const { deps, broadcasts } = makeDeps();
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [{ ...sysInit('sess-skills-noslash'), slash_commands: [], skills: ['loop'] }],
        supportedCommands: { resolve: [{ name: 'loop', description: 'x', argumentHint: '', aliases: [] }] },
      }));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-init').length, 0, '空 slash_commands 不广播 sdk-init');
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-skills').length, 1, '但仍拉取技能');
    });

    it('同一 query 重复 init 只调用一次 supportedCommands', async () => {
      const { deps } = makeDeps();
      // Emit init TWICE from the same resident query so the dedupe guard is actually
      // exercised (a single init would pass even with the guard removed).
      const fq = makeResidentQuery({
        initMsgs: [sysInit('sess-skills-dupe'), sysInit('sess-skills-dupe')],
        supportedCommands: { resolve: [] },
      });
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('one');
      await tick(6);
      assert.equal(fq.current().supportedCommandsCalls, 1, '一次 query 重复 init 只拉一次');
    });

    it('切换 session 后迟到的 resolve 不广播旧命令,快照清空且新代重新拉取', async () => {
      const { deps, broadcasts } = makeDeps();
      let firstResolve;
      const fq = makeResidentQuery({
        initMsgs: [{ ...sysInit('sess-skills-old'), skills: ['old-skill', 'fresh'] }],
        supportedCommands: (n) => (n === 1
          ? { defer: true, keepOnClose: true }   // 第一代挂起,close 不拒,模拟迟到 resolve
          : { resolve: [{ name: 'fresh', description: '', argumentHint: '', aliases: [] }] }),
      });
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      // 先落地一个非空快照，验证切换确实清空它（而非空转）。命令名需在 skills 白名单内才不被过滤。
      firstResolve = fq.current().supportedCommandsPending && fq.current().supportedCommandsPending.resolve;
      assert.ok(firstResolve, '第一代 supportedCommands 挂起中');
      firstResolve([{ name: 'old-skill', description: '', argumentHint: '', aliases: [] }]);
      await tick(6);
      assert.ok(sdk.getSkillsSnapshot(), '切换前已有快照');
      assert.equal(sdk.getSkillsSnapshot().commands[0].name, 'old-skill');
      // 切走 → teardown + 清快照
      sdk.switchToSession('sess-skills-new');
      assert.equal(sdk.getSkillsSnapshot(), null, '切换后快照清空');
      // 切换后新代 query 应重新拉取（teardown 重置 _skillsLoadedQuery）
      await sdk.sendUserMessage('after-switch');
      await tick(6);
      // supportedCommandsCalls is per-generation state — aggregate across query generations
      // (switch rebuilt the resident query, so fq.current() alone only sees the new one).
      const totalCalls = fq.calls.reduce((n, c) => n + (c.state ? c.state.supportedCommandsCalls : 0), 0);
      assert.equal(totalCalls, 2, '新代 query 重新拉取');
    });

    it('supportedCommands 命令面按 init.skills 收敛为纯 skill（过滤 TUI 内置命令）', async () => {
      const { deps, broadcasts } = makeDeps();
      // init.skills 是 skill 白名单（含 plugin:skill / :suffix 形式）；supportedCommands
      // 返回全量命令面（含 /clear /model 等 TUI 内置命令），应只保留白名单内的 skill。
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [{ ...sysInit('sess-skills-filter'), skills: ['review', 'plugin:docx', ':pdf'] }],
        supportedCommands: {
          resolve: [
            { name: 'review', description: 'r', argumentHint: '', aliases: [] },
            { name: 'clear', description: 'c', argumentHint: '', aliases: [] },
            { name: 'model', description: 'm', argumentHint: '', aliases: [] },
            { name: 'docx', description: 'd', argumentHint: '', aliases: [] },
            { name: 'pdf', description: 'p', argumentHint: '', aliases: [] },
          ],
        },
      }));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      const sk = broadcasts.filter((b) => b.type === 'sdk-skills');
      assert.equal(sk.length, 1);
      const names = sk[0].commands.map((c) => c.name).sort();
      assert.deepEqual(names, ['docx', 'pdf', 'review'], 'TUI 内置命令被过滤，仅留 skill');
    });

    it('init 帧无 skills 字段时不过滤（保守放行）', async () => {
      const { deps, broadcasts } = makeDeps();
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [sysInit('sess-skills-nofilter')],
        supportedCommands: { resolve: [{ name: 'anything', description: '', argumentHint: '', aliases: [] }] },
      }));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      const sk = broadcasts.filter((b) => b.type === 'sdk-skills');
      assert.equal(sk.length, 1);
      assert.equal(sk[0].commands.length, 1, '无白名单时全量透传');
    });

    it('sdk-skills 帧携带 cwd + instanceKey 路由信封', async () => {
      const { deps, broadcasts } = makeDeps();
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [{ ...sysInit('sess-skills-env'), skills: ['review'] }],
        supportedCommands: { resolve: [{ name: 'review', description: '', argumentHint: '', aliases: [] }] },
      }));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      const sk = broadcasts.find((b) => b.type === 'sdk-skills');
      assert.ok(sk, '有 sdk-skills 帧');
      assert.equal(sk.cwd, tmpDir, '带 cwd');
      assert.ok('instanceKey' in sk, '带 instanceKey 字段');
      assert.equal(typeof sk.ts, 'number', '带 ts');
      // 快照与帧内容等价（非同一引用比较）
      assert.deepEqual(JSON.parse(JSON.stringify(sdk.getSkillsSnapshot())), JSON.parse(JSON.stringify(sk)));
    });

    it('切换 session 期间迟到的旧代 resolve 不落新快照（stale-generation 守卫）', async () => {
      const { deps, broadcasts } = makeDeps();
      let oldResolve;
      const fq = makeResidentQuery({
        initMsgs: [{ ...sysInit('sess-stale-old'), skills: ['old-skill'] }],
        supportedCommands: { defer: true, keepOnClose: true }, // 挂起，close 不拒，模拟迟到
      });
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('go');
      await tick(6);
      oldResolve = fq.current().supportedCommandsPending && fq.current().supportedCommandsPending.resolve;
      assert.ok(oldResolve, '旧代 supportedCommands 挂起中');
      assert.equal(sdk.getSkillsSnapshot(), null, '尚无快照');
      // 切走：teardown 清快照 + _activeQuery 换代。此后旧代迟到 resolve 应被守卫丢弃。
      sdk.switchToSession('sess-stale-new');
      await tick(6);
      oldResolve([{ name: 'old-skill', description: '', argumentHint: '', aliases: [] }]);
      await tick(6);
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-skills').length, 0, '旧代迟到 resolve 不广播');
      assert.equal(sdk.getSkillsSnapshot(), null, '旧代迟到 resolve 不落快照');
    });
  });
});

describe('sdk-manager-query — SDK task_* 消息无损转发为 sdk-task 广播', () => {
  it('task_started → 广播 sdk-task(subtype/taskId/description, snake→camel)', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const started = {
      type: 'system', subtype: 'task_started', session_id: 'sess-1',
      task_id: 'task-1', tool_use_id: 'tu-1', description: '探索代码库',
      task_type: 'local_workflow', workflow_name: 'spec', prompt: 'do it',
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), started] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    // Whole-frame deepEqual: pins EVERY forwarded field (incl. prompt and the per-session
    // routing cwd + instanceKey the multi-session registry stamps on every frame) and
    // proves the relay leaks nothing else (no uuid, no snake_case keys, no extra envelope
    // noise). instanceKey is the cwd-stable key — read it off the registry rather than
    // hardcoding a hash.
    const expectedKey = sdk.listSdkSessions().find((s) => s.cwd === tmpDir).instanceKey;
    assert.deepEqual(t, [{
      type: 'sdk-task', cwd: tmpDir, instanceKey: expectedKey, subtype: 'task_started', sessionId: 'sess-1', taskId: 'task-1',
      toolUseId: 'tu-1', description: '探索代码库', taskType: 'local_workflow',
      workflowName: 'spec', prompt: 'do it',
    }]);
    // Pure relay: the task message itself does NOT fire onTurnEnd. The single
    // turnEnd here comes from sendUserMessage's own result, not from task_started.
    assert.equal(turnEnds.length, 1, 'task message must not fire onTurnEnd (the result did)');
  });

  it('task_progress → usage snake→camel(totalTokens/toolUses/durationMs) + lastToolName', async () => {
    const { deps, broadcasts } = makeDeps();
    const progress = {
      type: 'system', subtype: 'task_progress', session_id: 'sess-1',
      task_id: 'task-2', description: '运行中',
      usage: { total_tokens: 3400, tool_uses: 12, duration_ms: 8800 },
      last_tool_name: 'Bash',
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), progress] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    assert.equal(t.length, 1);
    assert.equal(t[0].subtype, 'task_progress');
    assert.deepEqual(t[0].usage, { totalTokens: 3400, toolUses: 12, durationMs: 8800 });
    assert.equal(t[0].lastToolName, 'Bash');
  });

  it('task_notification → status/outputFile 透传, usage 缺省时不挂 usage 键', async () => {
    const { deps, broadcasts } = makeDeps();
    const notif = {
      type: 'system', subtype: 'task_notification', session_id: 'sess-1',
      task_id: 'task-3', status: 'failed', output_file: '/tmp/out.txt', summary: '炸了',
      // usage omitted — notification.usage is optional in the SDK, must be tolerated
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), notif] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    assert.equal(t.length, 1);
    assert.equal(t[0].subtype, 'task_notification');
    assert.equal(t[0].status, 'failed');
    assert.equal(t[0].outputFile, '/tmp/out.txt');
    assert.equal(t[0].summary, '炸了');
    assert.ok(!('usage' in t[0]), 'usage 缺省时不应出现 usage 键');
  });

  it('task_updated → patch 原样透传(merge 语义留给客户端), 字段 camelCase', async () => {
    const { deps, broadcasts } = makeDeps();
    const updated = {
      type: 'system', subtype: 'task_updated', session_id: 'sess-1', task_id: 'task-4',
      patch: { status: 'killed', end_time: 1730000000000, total_paused_ms: 120, error: 'killed by user', is_backgrounded: true },
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), updated] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    assert.equal(t.length, 1);
    assert.equal(t[0].subtype, 'task_updated');
    assert.deepEqual(t[0].patch, {
      status: 'killed', endTime: 1730000000000, totalPausedMs: 120, error: 'killed by user', isBackgrounded: true,
    });
  });

  it('skip_transcript:true → 仍广播且带 skipTranscript:true(隐藏决策留给 UI)', async () => {
    const { deps, broadcasts } = makeDeps();
    const ambient = {
      type: 'system', subtype: 'task_started', session_id: 'sess-1',
      task_id: 'task-amb', description: 'housekeeping', skip_transcript: true,
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), ambient] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);

    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    assert.equal(t.length, 1);
    assert.equal(t[0].skipTranscript, true);
  });

  it('多条 task 消息 → 各自一条 sdk-task 广播(全量转发不丢帧)', async () => {
    const { deps, broadcasts } = makeDeps();
    const msgs = [
      sysInit(),
      { type: 'system', subtype: 'task_started', session_id: 'sess-1', task_id: 'a', description: 'x' },
      { type: 'system', subtype: 'task_progress', session_id: 'sess-1', task_id: 'a', description: 'x', usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } },
      { type: 'system', subtype: 'task_notification', session_id: 'sess-1', task_id: 'a', status: 'completed', output_file: '/o', summary: 'done' },
    ];
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: msgs }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(6);

    const subtypes = broadcasts.filter((b) => b.type === 'sdk-task').map((b) => b.subtype);
    assert.deepEqual(subtypes, ['task_started', 'task_progress', 'task_notification']);
  });

  it('无 broadcastWs → task 分支在调用前短路(非靠吞异常), 回合照常结束', async () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    _resetErrReport(); // module-level dedup counters: keep this assertion order-independent
    try {
      const turnEnds = [];
      sdk.__setQueryForTests(makeResidentQuery({
        initMsgs: [sysInit(), { type: 'system', subtype: 'task_started', session_id: 's', task_id: 't', description: 'd' }],
      }));
      sdk.initSdkSession(tmpDir, 'proj', { onTurnEnd: (x) => turnEnds.push(x) }); // no broadcastWs
      await sdk.sendUserMessage('go');
      await tick(4);
      assert.equal(turnEnds.length, 1);
      assert.ok(!warns.some((w) => w.includes('sdk-manager.process-message')),
        'guard must short-circuit BEFORE the call — a swallowed TypeError is not a pass');
    } finally { console.warn = orig; }
  });

  it('task 消息在 respond 期间到达(回合中途) → 按到达顺序广播且不额外结束回合', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const mid = [
      { type: 'system', subtype: 'task_started', session_id: 'sess-1', task_id: 'm1', description: 'bg' },
      { type: 'system', subtype: 'task_progress', session_id: 'sess-1', task_id: 'm1', description: 'bg', usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } },
    ];
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit()],
      respond: () => [...mid, assistantMsg([{ type: 'text', text: 'x' }]), resultMsg()],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(6);
    // Mid-turn frames relayed in arrival order; only the trailing result fires onTurnEnd.
    // (Turn-level sdk-session-state running/idle frames bracket the turn — filter to
    // the sdk-task vocabulary this assertion is about.)
    assert.deepEqual(broadcasts.filter((b) => b.type !== 'sdk-session-state').map((b) => b.type), ['sdk-task', 'sdk-task']);
    assert.equal(turnEnds.length, 1);
  });

  it('task 消息不触碰 _queryBusy：回合在飞时到达 task 消息,第二条消息仍须入队', async () => {
    const { deps } = makeDeps();
    let openGate; const gate = new Promise((r) => { openGate = r; });
    let n = 0;
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit(), { type: 'system', subtype: 'task_started', session_id: 'sess-1', task_id: 't', description: 'd' }],
      respond: async () => { if (n++ === 0) await gate; return [resultMsg()]; },
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const p1 = sdk.sendUserMessage('first');
    await tick(6); // task 消息已处理；'first' 回合仍在飞(respond 停在 gate)
    const p2 = sdk.sendUserMessage('second'); // 不 await：若 _queryBusy 被破坏,此 promise 会挂到 gate 放行
    await tick(6);
    try {
      assert.equal(sdk.getQueueSnapshot().length, 1, 'task msgs must not touch _queryBusy (turn in flight → must enqueue)');
    } finally {
      openGate(); // 断言失败也必须放行 gate,否则挂到 10s timeout(慢红)
      await p1; await p2;
    }
    await tick(8);
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('两轮消息：task 消息不扰动回合 FIFO(两轮=两次 turnEnd+两次 push+单条广播)', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const started = { type: 'system', subtype: 'task_started', session_id: 'sess-1', task_id: 'task-1', description: 'd' };
    const fq = makeResidentQuery({ initMsgs: [sysInit(), started] });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    assert.equal(turnEnds.length, 1);
    await sdk.sendUserMessage('second');
    await tick(5);
    assert.equal(turnEnds.length, 2, '两轮各一次 turnEnd — task 消息不得吞掉/多算回合');
    assert.equal(fq.calls[0].pushed.length, 2);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-task').length, 1);
  });

  it('patch 的 falsy 合法值(end_time:0/total_paused_ms:0/error:""/is_backgrounded:false)不得丢失', async () => {
    const { deps, broadcasts } = makeDeps();
    const updated = {
      type: 'system', subtype: 'task_updated', session_id: 'sess-1', task_id: 't-falsy',
      patch: { end_time: 0, total_paused_ms: 0, error: '', is_backgrounded: false },
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), updated] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    assert.deepEqual(t[0].patch, { endTime: 0, totalPausedMs: 0, error: '', isBackgrounded: false });
  });

  it('patch 全空 → 帧仍广播但不挂 patch 键(省一帧 no-op merge)', async () => {
    const { deps, broadcasts } = makeDeps();
    const updated = {
      type: 'system', subtype: 'task_updated', session_id: 'sess-1', task_id: 't-empty',
      patch: {},
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), updated] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    const t = broadcasts.filter((b) => b.type === 'sdk-task');
    assert.equal(t.length, 1);
    assert.equal(t[0].subtype, 'task_updated');
    assert.ok(!('patch' in t[0]), 'all-empty patch must not be attached (a no-op merge frame)');
  });

  it('skip_transcript:false 也转发为 skipTranscript:false(布尔强转双射)', async () => {
    const { deps, broadcasts } = makeDeps();
    const started = {
      type: 'system', subtype: 'task_started', session_id: 'sess-1',
      task_id: 't-false', description: 'd', skip_transcript: false,
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), started] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-task')[0].skipTranscript, false);
  });

  it('usage 部分缺省 → 缺省键显式补 null(不是 undefined/不丢键)', async () => {
    const { deps, broadcasts } = makeDeps();
    const progress = {
      type: 'system', subtype: 'task_progress', session_id: 'sess-1',
      task_id: 't-part', description: 'd', usage: { tool_uses: 3, duration_ms: 9 },
    };
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit(), progress] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    const u = broadcasts.filter((b) => b.type === 'sdk-task')[0].usage;
    assert.deepEqual(u, { totalTokens: null, toolUses: 3, durationMs: 9 });
    assert.ok('totalTokens' in u, 'null fill, not undefined — undefined would vanish on the JSON wire');
  });

  it('非 task 的 system subtype(hook_started) → 不产生 sdk-task 广播', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({
      initMsgs: [sysInit(), { type: 'system', subtype: 'hook_started', session_id: 'sess-1', hook_name: 'x' }],
    }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('go');
    await tick(5);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-task').length, 0);
  });
});


// ── Queue-state broadcast / send-now / parked-queue semantics ──
// Helpers reused here: makeDeps (broadcasts capture), gate-pattern fake queries, tick().

/** Gate-pattern resident fake: the first turn parks on firstGate until released;
 * later turns run free. Pushed message texts are recorded per construction. */
function makeGatedQuery(calls) {
  let releaseFirst;
  const firstGate = new Promise((r) => { releaseFirst = r; });
  let idx = 0;
  const fq = makeResidentQuery({
    initMsgs: [sysInit('sess-gated')],
    respond: async (msg) => {
      if (calls) calls.push(pushedText(msg));
      if (idx++ === 0) await firstGate;
      return [resultMsg()];
    },
  });
  return { fq, releaseFirst: () => releaseFirst() };
}

describe('sdk-manager-query — queue-state 广播与快照', () => {
  it('忙时入队 → 广播 queue-state（{id,text,ts}），drain 后清空并再广播', async () => {
    const { deps, broadcasts } = makeDeps();
    const { fq, releaseFirst } = makeGatedQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('second');

    const last = broadcasts.filter((b) => b.type === 'queue-state').at(-1);
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    assert.equal(last.project, projectKeyForCwd(tmpDir), 'queue frames carry the canonical project key');
    assert.equal(last.items.length, 1);
    assert.equal(last.items[0].text, 'second');
    assert.ok(last.items[0].id);
    assert.equal(typeof last.items[0].ts, 'number');
    // Every snapshot item carries its actionable state; a queued item is actionable.
    assert.equal(last.items[0].status, 'queued');
    assert.deepEqual(sdk.getQueueSnapshot(), last.items);

    releaseFirst();
    await p1;
    await tick(8);
    // Automatic drain announces the dispatching slot before _startTurn accepts it, then
    // removes the bubble once inputQueue.push commits it.
    const states = broadcasts.filter((b) => b.type === 'queue-state');
    assert.ok(states.some((s) => s.items.length === 1 && s.items[0].text === 'second' && s.items[0].status === 'dispatching'),
      'auto drain must expose the selected item as dispatching before it becomes the turn');
    const drained = states.at(-1);
    assert.equal(drained.items.length, 0);
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('drain 推给常驻流的是文本而非队列对象（.text 回归）', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('second');
    releaseFirst();
    await p1;
    await tick(8);

    assert.deepEqual(calls, ['first', 'second'], 'drain must push the queued TEXT, not the queue item object');
  });

  it('队列满(≥50) → 拒绝入队,只发 queue-rejected 不发 queue-state', async () => {
    const { deps, broadcasts } = makeDeps();
    const { fq, releaseFirst } = makeGatedQuery();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);

    // 填满 50 条。
    for (let i = 0; i < 50; i++) await sdk.sendUserMessage(`m${i}`); // eslint-disable-line no-await-in-loop
    assert.equal(sdk.getQueueSnapshot().length, 50);
    const stateBefore = broadcasts.filter((b) => b.type === 'queue-state').length;

    // 第 51 条应被拒:不入队,只发 reject,不再发 queue-state。
    await sdk.sendUserMessage('overflow');
    assert.equal(sdk.getQueueSnapshot().length, 50, 'overflow item must NOT be enqueued');
    const rej = broadcasts.filter((b) => b.type === 'queue-rejected');
    assert.equal(rej.length, 1);
    assert.equal(rej[0].reason, 'full');
    const { projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js');
    assert.equal(rej[0].project, projectKeyForCwd(tmpDir), 'queue rejection carries the same project identity');
    assert.equal(broadcasts.filter((b) => b.type === 'queue-state').length, stateBefore,
      'rejection must not trigger an extra queue-state broadcast (nothing changed)');

    releaseFirst();
    await p1;
    await tick(8);
  });
});

describe('sdk-manager-query — sdk-context-usage 通道', () => {
  const USAGE = {
    categories: [{ name: 'System prompt', tokens: 1200, color: '#8884d8' }],
    totalTokens: 1200, maxTokens: 200000, rawMaxTokens: 200000,
    percentage: 0.6, gridRows: [], model: 'claude-opus-4-test',
    memoryFiles: [], mcpTools: [], agents: [], isAutoCompactEnabled: true,
    apiUsage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };

  function makeCtxQuery(usageSpec, calls) {
    return makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async (msg) => { if (calls) calls.push(pushedText(msg)); return [resultMsg()]; },
      getContextUsage: usageSpec,
    });
  }

  it('回合 result → 恰一次 sdk-context-usage 广播(trigger:turn-end,usage 透传)', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const fq = makeCtxQuery({ resolve: USAGE });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hello');
    await tick(10);

    const frames = broadcasts.filter((b) => b.type === 'sdk-context-usage');
    assert.equal(frames.length, 1, 'exactly one usage frame per settled turn');
    assert.equal(frames[0].trigger, 'turn-end');
    assert.deepEqual(frames[0].usage, USAGE, 'usage payload is losslessly passed through');
    assert.equal(typeof frames[0].ts, 'number');
    const expectedInstance = sdk.listSdkSessions().find((s) => s.cwd === tmpDir).instanceKey;
    assert.equal(frames[0].instanceKey, expectedInstance, 'snapshot carries the session instanceKey');
    assert.deepEqual(sdk.getContextUsageSnapshot(), frames[0], 'snapshot retained for WS replay');
    assert.equal(turnEnds.length, 1);
  });

  it('getContextUsage reject → 不抛、不广播、无 sdk-error、onTurnEnd 照常', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const fq = makeCtxQuery({ reject: new Error('control boom') });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hello');
    await tick(10);

    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage').length, 0);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0, 'control failure must not toast');
    assert.equal(turnEnds.length, 1, 'turn-end still fires');
    assert.equal(sdk.getContextUsageSnapshot(), null);
  });

  it('getContextUsage 同步 throw → turnEnd 仍触发(刷新调用点在 result 尾部)', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: () => { throw new Error('sync boom'); },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hello');
    await tick(10);

    assert.equal(turnEnds.length, 1, 'turn settlement must not be truncated by a sync throw');
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage').length, 0);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0);
  });

  it('退化 resolve(null/{}) → 跳过广播', async () => {
    for (const spec of [{ resolve: null }, { resolve: {} }, { resolve: undefined }]) {
      const { deps, broadcasts } = makeDeps();
      const fq = makeCtxQuery(spec);
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('hello'); // eslint-disable-line no-await-in-loop
      await tick(10); // eslint-disable-line no-await-in-loop
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage').length, 0,
        `degenerate resolve ${JSON.stringify(spec)} must not broadcast`);
      sdk.stopSession(); // eslint-disable-line no-await-in-loop
    }
  });

  it('老 fake(无 getContextUsage)→ 静默跳过,零影响', async () => {
    const { deps, broadcasts, turnEnds } = makeDeps();
    const { fq, releaseFirst } = makeGatedQuery(); // bare fake, no getContextUsage
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    releaseFirst();
    await p1;
    await tick(8);

    assert.equal(turnEnds.length, 1);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage').length, 0);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0);
  });

  it('同回合 compact+result → compact 帧先出,result 在途合并为一次 coalesced 重跑', async () => {
    const { deps, broadcasts } = makeDeps();
    let ctxCalls = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [
        { type: 'system', subtype: 'compact_boundary', session_id: 'sess-ctx', compact_metadata: { trigger: 'auto', pre_tokens: 5000, post_tokens: 2000 } },
        resultMsg(),
      ],
      getContextUsage: () => { ctxCalls++; return { resolve: USAGE }; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hello');
    await tick(12);

    const frames = broadcasts.filter((b) => b.type === 'sdk-context-usage');
    // compact_boundary arrives first and starts a control request; result lands while it
    // is still in flight, so the gate coalesces it into ONE rerun. The deterministic
    // sequence is [compact, coalesced] — assert it exactly so deleting the compact
    // trigger fails the test.
    assert.equal(ctxCalls, 2, 'compact fires, turn-end coalesces into one rerun');
    assert.deepEqual(frames.map((f) => f.trigger), ['compact', 'coalesced']);
    assert.equal(frames.at(-1).usage && frames.at(-1).usage.totalTokens, USAGE.totalTokens);
  });

  it('in-flight 合并:第一次 park 后跑完第 2 回合仍 ==1,release 后 ==2', async () => {
    const { deps, broadcasts } = makeDeps();
    let releaseCtx;
    const gate = new Promise((r) => { releaseCtx = r; });
    let ctxCalls = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: () => { ctxCalls++; return ctxCalls === 1 ? { defer: true } : { resolve: USAGE }; },
    });
    // Patch the deferred gate onto the first call.
    fq.current && (fq.current.ctxGate = gate);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('t1');
    await tick(8);
    assert.equal(ctxCalls, 1, 'first control request in flight');
    const state = fq.current();
    assert.ok(state.ctxUsagePending, 'first request parked');

    // Second turn completes while the first control request is still parked.
    await sdk.sendUserMessage('t2');
    await tick(8);
    assert.equal(ctxCalls, 1, 'in-flight request coalesces — no parallel second call');

    // Release the parked first request → exactly one queued rerun fires.
    state.ctxUsagePending.resolve(USAGE);
    await tick(4);
    assert.equal(ctxCalls, 2, 'exactly one queued rerun after release');
    await tick(8); // let the rerun's fast control request settle and broadcast
    const frames = broadcasts.filter((b) => b.type === 'sdk-context-usage');
    assert.equal(frames.length, 2, 'two broadcasts (first + rerun)');
    assert.equal(frames.at(-1).trigger, 'coalesced');
  });

  it('stale generation(identity-guard):park→switch→重建→release 旧 deferred 仍不广播', async () => {
    const { deps, broadcasts } = makeDeps();
    let ctxCalls = 0;
    // keepOnClose: model a control request that outlives teardown and resolves LATE —
    // the identity guard (not the close-reject) is what must block the broadcast.
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: () => { ctxCalls++; return { defer: true, keepOnClose: true }; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('t1');
    await tick(8);
    const oldState = fq.current();
    const oldPending = oldState.ctxUsagePending;
    assert.ok(oldPending, 'old generation control parked');

    // Switch session while the control request is in flight.
    const sw = sdk.switchToSession('sess-new');
    assert.equal(sw.ok, true);

    // New turn lazily rebuilds _activeQuery into a NEW object.
    await sdk.sendUserMessage('t2');
    await tick(8);

    // NOW the OLD generation's parked request resolves late — must NOT broadcast.
    oldPending.resolve(USAGE);
    await tick(8);
    const after = broadcasts.filter((b) => b.type === 'sdk-context-usage');
    assert.equal(after.filter((f) => f.usage && f.usage.totalTokens === USAGE.totalTokens && f.trigger === 'turn-end' && f.sessionId === 'sess-ctx').length, 0,
      'stale-generation resolve must not broadcast into the new session');
  });

  it('close→reject 在途 control:teardown 后 reject-late 不广播', async () => {
    const { deps, broadcasts } = makeDeps();
    let ctxCalls = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: () => { ctxCalls++; return { defer: true }; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('t1');
    await tick(8);
    assert.ok(fq.current().ctxUsagePending, 'control parked');

    // stopSession tears down the resident query; close() rejects the in-flight request.
    sdk.stopSession();
    await tick(8);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.usage).length, 0,
      'teardown-rejected control must not broadcast');
  });

  it('switchToSession(有快照)→ 广播 usage:null 清帧 + 快照归 null', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeCtxQuery({ resolve: USAGE });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    await sdk.sendUserMessage('hello');
    await tick(10);
    assert.notEqual(sdk.getContextUsageSnapshot(), null, 'snapshot present before switch');

    const sw = sdk.switchToSession('sess-new');
    assert.equal(sw.ok, true);
    assert.equal(sdk.getContextUsageSnapshot(), null, 'snapshot cleared on switch');
    const clearFrames = broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.usage === null);
    assert.equal(clearFrames.length, 1, 'exactly one clear frame');
    assert.equal(clearFrames[0].trigger, 'session-switched');
  });

  it('10s 超时楔子:挂起的 control 释放门闸,下一回合仍能刷新', async () => {
    // A live-but-unresponsive child must not wedge the in-flight gate forever: after the
    // CTX_USAGE_TIMEOUT_MS race fires, the gate frees and the next turn-end can refresh.
    const { deps, broadcasts } = makeDeps();
    let ctxCalls = 0;
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const fq = makeResidentQuery({
        initMsgs: [sysInit('sess-ctx')],
        respond: async () => [resultMsg()],
        // First call parks forever (keepOnClose so teardown doesn't reject it); the
        // second (post-timeout) resolves fast.
        getContextUsage: () => { ctxCalls++; return ctxCalls === 1 ? { defer: true, keepOnClose: true } : { resolve: USAGE }; },
      });
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);

      await sdk.sendUserMessage('t1');
      await tick(6);
      assert.equal(ctxCalls, 1, 'first control request parked');

      // No response within 10s → the timeout race rejects the wait and frees the gate.
      mock.timers.tick(11 * 1000);
      await tick(6);
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage').length, 0, 'no broadcast from the wedged request');

      // Next turn-end starts a NEW control request (gate was released).
      await sdk.sendUserMessage('t2');
      await tick(10);
      assert.equal(ctxCalls, 2, 'gate released — next turn-end refreshes');
      const frames = broadcasts.filter((b) => b.type === 'sdk-context-usage');
      assert.equal(frames.length, 1);
      assert.equal(frames[0].trigger, 'turn-end');
    } finally {
      mock.timers.reset();
    }
  });

  it('anchored snapshot getter resolves exactly and rejects a mismatched pair', async () => {
    const alphaCwd = join(tmpDir, 'ws-a', 'alpha');
    const betaCwd = join(tmpDir, 'ws-b', 'beta');
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: { resolve: USAGE },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(alphaCwd, 'alpha', makeDeps().deps);
    await sdk.sendUserMessage('alpha-turn');
    await tick(10);
    sdk.initSdkSession(betaCwd, 'beta', makeDeps().deps);
    await sdk.sendUserMessage('beta-turn');
    await tick(10);

    const alpha = sdk.listSdkSessions().find((s) => s.cwd === alphaCwd);
    const beta = sdk.listSdkSessions().find((s) => s.cwd === betaCwd);
    const viaInstance = sdk.getContextUsageSnapshot({ instanceKey: alpha.instanceKey });
    assert.equal(viaInstance.cwd, alphaCwd, 'exact instance replays its own snapshot');
    assert.equal(viaInstance.instanceKey, alpha.instanceKey);
    assert.equal(sdk.getContextUsageSnapshot({ project: 'alpha' }).cwd, alphaCwd, 'project anchor resolves');
    assert.equal(sdk.getContextUsageSnapshot({ project: 'alpha', instanceKey: alpha.instanceKey }).cwd, alphaCwd,
      'matching pair resolves');
    assert.equal(sdk.getContextUsageSnapshot({ project: 'alpha', instanceKey: beta.instanceKey }), null,
      'mismatched pair resolves to null, never to the foreign instance');
    assert.equal(sdk.getActiveSdkCwd(), betaCwd, 'anchored reads never switch active');
  });

  it('typed /clear clears at execution, then the next turn-end repopulates', async () => {
    const { deps, broadcasts } = makeDeps();
    let ctxCalls = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: () => { ctxCalls++; return { resolve: { ...USAGE, totalTokens: ctxCalls } }; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);
    assert.notEqual(sdk.getContextUsageSnapshot(), null, 'warmup turn seeded a snapshot');
    const before = broadcasts.filter((b) => b.type === 'sdk-context-usage').length;

    await sdk.sendUserMessage('/clear');
    await tick(10);

    const clearFrames = broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.trigger === 'context-cleared');
    assert.equal(clearFrames.length, 1, 'typed /clear broadcasts exactly one clear frame');
    assert.equal(clearFrames[0].usage, null);
    assert.ok(fq.calls[0].pushed.map(pushedText).includes('/clear'), '/clear reached the resident query as a turn');
    const afterClear = broadcasts.filter((b) => b.type === 'sdk-context-usage').slice(before);
    assert.equal(afterClear.at(-1).trigger, 'turn-end', 'the /clear turn result refreshes after the clear');
    assert.equal(afterClear.at(-1).usage.totalTokens, 2, 'post-clear snapshot is freshly fetched');
    assert.equal(sdk.getContextUsageSnapshot().usage.totalTokens, 2);
    assert.equal(sdk.getSessionId(), 'sess-ctx', 'unrelated session state is untouched');

    const manual = await sdk.fetchContextUsage();
    assert.equal(manual.ok, true, 'a post-clear manual fetch still works');
    assert.equal(manual.snapshot.trigger, 'request');
    assert.equal(manual.snapshot.usage.totalTokens, 3, 'manual fetch gets a fresh post-clear snapshot');
  });

  it('typed /clear emits a synchronization frame even with no prior snapshot', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeCtxQuery({ resolve: USAGE }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('/clear');
    await tick(10);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.trigger === 'context-cleared' && b.usage === null).length, 1);
  });

  it('non-exact /clear variants do not invalidate the snapshot', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeCtxQuery({ resolve: USAGE });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);

    for (const text of ['/clearly', '/clear now']) {
      await sdk.sendUserMessage(text); // eslint-disable-line no-await-in-loop
      await tick(6); // eslint-disable-line no-await-in-loop
    }
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.trigger === 'context-cleared').length, 0,
      'only a bare /clear is the context-reset command');
    assert.ok(broadcasts.filter((b) => b.type === 'sdk-context-usage').every((b) => b.trigger !== 'context-cleared'));
  });

  it('a /clear queued while busy executes only when the drain actually runs it', async () => {
    const { deps, broadcasts } = makeDeps();
    let releaseSecond;
    const secondGate = new Promise((r) => { releaseSecond = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async (msg) => {
        if (pushedText(msg) === 'second') await secondGate;
        return [resultMsg()];
      },
      getContextUsage: { resolve: USAGE },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);
    assert.notEqual(sdk.getContextUsageSnapshot(), null);

    const p2 = sdk.sendUserMessage('second');
    await tick(6);
    await sdk.sendUserMessage('/clear'); // busy → queued, not executed
    await tick(4);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.trigger === 'context-cleared').length, 0,
      'a merely queued /clear must not clear the running turn');
    assert.deepEqual(sdk.getQueueSnapshot().map((q) => q.text), ['/clear']);

    releaseSecond();
    await p2;
    await tick(12);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.trigger === 'context-cleared').length, 1,
      'the drained /clear turn invalidates usage when it executes');
    assert.ok(fq.calls[0].pushed.map(pushedText).includes('/clear'));
  });

  it('a manual pull that predates /clear cannot retain or broadcast pre-clear usage', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: (call) => call === 1 ? { resolve: USAGE } : { defer: true, keepOnClose: true },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);
    const pending = sdk.fetchContextUsage();
    await tick(4);
    const stalePending = fq.current().ctxUsagePending;
    assert.ok(stalePending, 'manual control request is parked');
    await sdk.sendUserMessage('/clear');
    await tick(10);
    const fresh = sdk.getContextUsageSnapshot();
    stalePending.resolve({ ...USAGE, totalTokens: 999999 });
    const stale = await pending;
    assert.equal(stale.ok, false, 'pre-clear manual fetch is rejected by the clear epoch');
    assert.equal(sdk.getContextUsageSnapshot(), fresh, 'stale pull cannot replace the post-clear snapshot');
    assert.equal(broadcasts.some((b) => b.usage?.totalTokens === 999999), false, 'stale pull never broadcasts');
  });

  it('rejects context reads after the clear frame but before the clear result', async () => {
    const { deps } = makeDeps();
    let clearResult;
    const gate = new Promise((resolve) => { clearResult = resolve; });
    let calls = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async (msg) => {
        if (pushedText(msg) === '/clear') await gate;
        return [resultMsg()];
      },
      getContextUsage: () => { calls++; return { resolve: USAGE }; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);
    const clear = sdk.sendUserMessage('/clear');
    await tick(5);
    const pending = await sdk.fetchContextUsage();
    assert.equal(pending.ok, false, 'the CLI has not applied /clear yet, so no read may return old usage');
    assert.equal(pending.reason, 'session-inactive');
    assert.equal(calls, 1, 'no control read is issued during clear-pending');
    clearResult();
    await clear;
    await tick(10);
    assert.equal(calls, 2, 'the result releases a single fresh turn-end read');
  });

  it('an older manual pull cannot overwrite a newer turn-end snapshot', async () => {
    const { deps, broadcasts } = makeDeps();
    const FRESH = { ...USAGE, totalTokens: 8200 };
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: (call) => call === 2 ? { defer: true, keepOnClose: true } : { resolve: FRESH },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);
    const pending = sdk.fetchContextUsage();
    await tick(4);
    const stalePending = fq.current().ctxUsagePending;
    assert.ok(stalePending, 'older manual pull is parked');
    await sdk.sendUserMessage('new turn');
    await tick(10);
    assert.equal(sdk.getContextUsageSnapshot().usage.totalTokens, FRESH.totalTokens);
    stalePending.resolve(USAGE);
    await tick(10);
    const stale = await pending;
    assert.equal(stale.ok, false, 'older manual result is superseded by the turn-end read');
    assert.equal(sdk.getContextUsageSnapshot().usage.totalTokens, FRESH.totalTokens);
    assert.equal(broadcasts.some((b) => b.usage && b.usage.totalTokens === USAGE.totalTokens), false);
  });

  it('a deferred pre-clear refresh is neither retained nor rebroadcast after /clear', async () => {
    const { deps, broadcasts } = makeDeps();
    const SEED = { ...USAGE, totalTokens: 71 };
    const STALE = { ...USAGE, totalTokens: 72 };
    const FRESH = { ...USAGE, totalTokens: 73 };
    let ctxCalls = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-ctx')],
      respond: async () => [resultMsg()],
      getContextUsage: () => {
        ctxCalls++;
        if (ctxCalls === 1) return { resolve: SEED };
        if (ctxCalls === 2) return { defer: true, keepOnClose: true };
        return { resolve: FRESH };
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('warmup');
    await tick(10);
    assert.equal(sdk.getContextUsageSnapshot().usage.totalTokens, SEED.totalTokens);

    await sdk.sendUserMessage('second'); // turn-end refresh parks as call #2
    await tick(8);
    assert.equal(ctxCalls, 2, 'pre-clear refresh parked');
    const stalePending = fq.current().ctxUsagePending;
    assert.ok(stalePending, 'deferred control request captured');

    await sdk.sendUserMessage('/clear');
    await tick(10); // the /clear turn-end refresh (call #3) lands FRESH
    assert.equal(ctxCalls, 3);
    assert.equal(sdk.getContextUsageSnapshot().usage.totalTokens, FRESH.totalTokens);

    stalePending.resolve(STALE); // old generation resolves late
    await tick(10);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.usage && b.usage.totalTokens === STALE.totalTokens).length, 0,
      'pre-clear refresh must not broadcast after the clear');
    assert.equal(sdk.getContextUsageSnapshot().usage.totalTokens, FRESH.totalTokens,
      'pre-clear refresh must not overwrite the post-clear snapshot');
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-context-usage' && b.trigger === 'context-cleared').length, 1);
  });
});

describe('sdk-manager-query — sdk-mcp-status 通道', () => {
  const SERVERS = [
    { name: 'tavily', status: 'connected', serverInfo: { name: 'tavily', version: '1.2.0' }, tools: [{ name: 'web_search' }] },
    { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
  ];

  function makeMcpQuery(mcpSpec) {
    return makeResidentQuery({
      initMsgs: [sysInit('sess-mcp')],
      respond: async () => [resultMsg()],
      mcpServerStatus: mcpSpec,
    });
  }

  // mcpServerStatus is ON-DEMAND only (HTTP pull / explicit fetch) — no turn-end trigger —
  // so tests drive it via fetchMcpStatus() against a live resident query.
  it('fetchMcpStatus(live query)→ 恰一次 sdk-mcp-status 广播 + servers 无损 + snapshot 留存', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeMcpQuery({ resolve: SERVERS }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hello'); // build the resident query
    await tick(6);

    const r = await sdk.fetchMcpStatus();
    assert.equal(r.ok, true);
    assert.equal(r.snapshot.trigger, 'request');
    assert.equal(typeof r.snapshot.ts, 'number');
    const frames = broadcasts.filter((b) => b.type === 'sdk-mcp-status');
    assert.equal(frames.length, 1, 'exactly one sdk-mcp-status broadcast');
    assert.deepEqual(frames[0].servers, SERVERS, 'servers passed through losslessly');
    assert.deepEqual(sdk.getMcpStatusSnapshot(), frames[0], 'snapshot retained for WS replay');
    sdk.stopSession();
    await tick(3);
  });

  it('空数组 [] → ok:true 且广播 servers:[](数组守卫反转,空≠失败)', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeMcpQuery({ resolve: [] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hello');
    await tick(6);

    const r = await sdk.fetchMcpStatus();
    assert.equal(r.ok, true, 'an empty array is a legitimate "no MCP servers" result');
    const frames = broadcasts.filter((b) => b.type === 'sdk-mcp-status');
    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].servers, []);
    sdk.stopSession();
    await tick(3);
  });

  it('退化 resolve(非数组 null/{}/undefined/字符串/数字)→ ok:false,不广播、无 sdk-error', async () => {
    for (const spec of [{ resolve: null }, { resolve: {} }, { resolve: undefined }, { resolve: 'x' }, { resolve: 42 }]) {
      const { deps, broadcasts } = makeDeps();
      sdk.__setQueryForTests(makeMcpQuery(spec));
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('hello'); // eslint-disable-line no-await-in-loop
      await tick(6); // eslint-disable-line no-await-in-loop
      const r = await sdk.fetchMcpStatus(); // eslint-disable-line no-await-in-loop
      assert.equal(r.ok, false, `non-array resolve ${JSON.stringify(spec)} must fail`);
      assert.equal(r.reason, 'control-failed');
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status').length, 0, 'no broadcast on degenerate resolve');
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0, 'control failure must not toast');
      sdk.stopSession(); // eslint-disable-line no-await-in-loop
      await tick(3); // eslint-disable-line no-await-in-loop
    }
  });

  it('mcpServerStatus reject → {ok:false, control-failed},不广播、无 sdk-error', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeMcpQuery({ reject: new Error('control boom') }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hello');
    await tick(6);

    const r = await sdk.fetchMcpStatus();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'control-failed');
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status').length, 0);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-error').length, 0);
    assert.equal(sdk.getMcpStatusSnapshot(), null);
    sdk.stopSession();
    await tick(3);
  });

  it('mcpServerStatus 同步 throw → 不抛,ok:false,不广播', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-mcp')],
      respond: async () => [resultMsg()],
      mcpServerStatus: () => { throw new Error('sync boom'); },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hello');
    await tick(6);

    const r = await sdk.fetchMcpStatus();
    assert.equal(r.ok, false);
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status').length, 0);
    sdk.stopSession();
    await tick(3);
  });

  it('无常驻 query → {ok:false, session-inactive}', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeMcpQuery({ resolve: SERVERS }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    sdk.stopSession(); // tear down → _activeQuery null
    await tick(3);
    const r = await sdk.fetchMcpStatus();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'session-inactive');
  });

  it('老 fake(无 mcpServerStatus)→ typeof 守卫 session-inactive,零影响', async () => {
    const { deps, broadcasts } = makeDeps();
    const { fq, releaseFirst } = makeGatedQuery(); // base fake
    // makeResidentQuery always defines mcpServerStatus now; strip it per-construction to
    // model a legacy query whose control surface predates the method (typeof guard fires).
    const origFq = fq;
    const legacyFq = (args) => { const api = origFq(args); delete api.mcpServerStatus; return api; };
    legacyFq.calls = origFq.calls; legacyFq.current = origFq.current;
    legacyFq.releaseNextInterrupt = origFq.releaseNextInterrupt; legacyFq.endWith = origFq.endWith;
    sdk.__setQueryForTests(legacyFq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    releaseFirst();
    await p1;
    await tick(6);

    const r = await sdk.fetchMcpStatus();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'session-inactive');
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status').length, 0);
    sdk.stopSession();
    await tick(3);
  });

  it('stale generation(identity-guard):park→switch→重建→release 旧 deferred 仍不广播', async () => {
    const { deps, broadcasts } = makeDeps();
    // keepOnClose: model a control request that outlives teardown and resolves LATE —
    // the identity guard (not the close-reject) is what must block the broadcast.
    const fq = makeMcpQuery(() => ({ defer: true, keepOnClose: true }));
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('t1');
    await tick(6);

    const p = sdk.fetchMcpStatus(); // parks on the deferred gate
    await tick(4);
    const oldState = fq.current();
    const oldPending = oldState.mcpStatusPending;
    assert.ok(oldPending, 'old generation control parked');

    // Switch session while the control request is in flight (teardown nulls _activeQuery).
    const sw = sdk.switchToSession('sess-new');
    assert.equal(sw.ok, true);
    await sdk.sendUserMessage('t2'); // lazily rebuilds _activeQuery into a NEW object
    await tick(6);

    // NOW the OLD generation's parked request resolves late — must NOT broadcast.
    oldPending.resolve(SERVERS);
    const r = await p;
    await tick(4);
    assert.equal(r.ok, false, 'stale-generation resolve reports session-inactive');
    assert.equal(r.reason, 'session-inactive');
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status' && Array.isArray(b.servers) && b.sessionId === 'sess-mcp').length, 0,
      'stale-generation resolve must not broadcast into the new session');
    sdk.stopSession();
    await tick(3);
  });

  it('close→reject 在途 control:teardown 后 reject-late 不广播', async () => {
    const { deps, broadcasts } = makeDeps();
    const fq = makeMcpQuery(() => ({ defer: true }));
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('t1');
    await tick(6);

    const p = sdk.fetchMcpStatus();
    await tick(4);
    assert.ok(fq.current().mcpStatusPending, 'control parked');

    // stopSession tears down the resident query; close() rejects the in-flight request.
    sdk.stopSession();
    const r = await p;
    await tick(4);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'control-failed');
    assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status' && Array.isArray(b.servers)).length, 0,
      'teardown-rejected control must not broadcast');
  });

  it('switchToSession(有快照)→ 广播 servers:null 清帧 + 快照归 null', async () => {
    const { deps, broadcasts } = makeDeps();
    sdk.__setQueryForTests(makeMcpQuery({ resolve: SERVERS }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    await sdk.sendUserMessage('hello');
    await tick(6);
    await sdk.fetchMcpStatus();
    await tick(3);
    assert.notEqual(sdk.getMcpStatusSnapshot(), null, 'snapshot present before switch');

    const sw = sdk.switchToSession('sess-new');
    assert.equal(sw.ok, true);
    assert.equal(sdk.getMcpStatusSnapshot(), null, 'snapshot cleared on switch');
    const clearFrames = broadcasts.filter((b) => b.type === 'sdk-mcp-status' && b.servers === null);
    assert.equal(clearFrames.length, 1, 'exactly one clear frame');
    assert.equal(clearFrames[0].trigger, 'session-switched');
    sdk.stopSession();
    await tick(3);
  });

  it('10s 超时楔子:挂起的 control 超时后报 control-failed,不楔死', async () => {
    // A live-but-unresponsive child must not hang fetchMcpStatus forever: after the
    // CTX_USAGE_TIMEOUT_MS race fires, the collect returns control-failed.
    const { deps, broadcasts } = makeDeps();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const fq = makeMcpQuery(() => ({ defer: true, keepOnClose: true })); // parks forever
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);
      await sdk.sendUserMessage('t1');
      await tick(6);

      const p = sdk.fetchMcpStatus();
      await tick(4);
      assert.ok(fq.current().mcpStatusPending, 'control parked');

      // No response within 10s → the timeout race rejects the wait.
      mock.timers.tick(11 * 1000);
      const r = await p;
      await tick(4);
      assert.equal(r.ok, false, 'wedged control times out to control-failed');
      assert.equal(r.reason, 'control-failed');
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-mcp-status' && Array.isArray(b.servers)).length, 0, 'no broadcast from the wedged request');
    } finally {
      mock.timers.reset();
    }
    sdk.stopSession();
    await tick(3);
  });
});

describe('sdk-manager-query — sendQueuedNow', () => {
  it('忙时 send-now：打断当前回合，目标消息成为下一个执行项，其余随后 drain', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    fq.releaseNextInterrupt(); // interrupt() releases the gated first turn (CLI contract)
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('second');
    await sdk.sendUserMessage('third');
    const snap = sdk.getQueueSnapshot();
    assert.equal(snap.length, 2);

    const cancelled = sdk.sendQueuedNow(snap[1].id); // prioritize 'third'
    assert.ok(Array.isArray(cancelled));
    releaseFirst(); // no-op if interrupt() already released; harmless either way
    await p1;
    await tick(12);

    assert.deepEqual(calls, ['first', 'third', 'second'], 'prioritized item runs next; the rest drain after it');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('busy send-now exposes a single dispatching slot; repeat send-now/remove are rejected', async () => {
    const { deps, broadcasts } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('second');
    await sdk.sendUserMessage('third');
    const target = sdk.getQueueSnapshot().find((i) => i.text === 'third');

    const cancelled = sdk.sendQueuedNow(target.id);
    assert.ok(Array.isArray(cancelled));
    // The selected item leaves the actionable FIFO immediately and stays visible first,
    // disabled, until the interrupt unwind lets _startTurn accept it.
    assert.deepEqual(sdk.getQueueSnapshot().map((i) => [i.text, i.status]), [
      ['third', 'dispatching'],
      ['second', 'queued'],
    ]);
    assert.equal(fq.current().interruptCalls, 1);

    const framesBefore = broadcasts.filter((b) => b.type === 'queue-state').length;
    assert.deepEqual(sdk.sendQueuedNow(target.id), [], 'repeat send-now must be rejected');
    assert.equal(sdk.removeQueued(target.id), false, 'dispatching item must not be removable');
    const secondId = sdk.getQueueSnapshot().find((i) => i.text === 'second').id;
    assert.deepEqual(sdk.sendQueuedNow(secondId), [], 'the single slot rejects a competing selection too');
    assert.equal(fq.current().interruptCalls, 1, 'repeat/competing send-now must not fire a second interrupt');
    const states = broadcasts.filter((b) => b.type === 'queue-state');
    assert.ok(states.length > framesBefore, 'rejected actions re-broadcast the snapshot for convergence');
    assert.deepEqual(sdk.getQueueSnapshot().map((i) => [i.text, i.status]), [
      ['third', 'dispatching'],
      ['second', 'queued'],
    ]);

    releaseFirst();
    await p1;
    await tick(12);

    assert.deepEqual(calls, ['first', 'third', 'second'], 'the locked item still runs first, then the rest drain');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('idle send-now moves the picked item into the dispatching slot before starting it', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('a');
    await sdk.sendUserMessage('b');
    sdk.interruptTurn(); // parks [a, b]
    releaseFirst();
    await p1;
    await tick(8);
    assert.equal(sdk.getQueueSnapshot().length, 2);

    const bId = sdk.getQueueSnapshot().find((i) => i.text === 'b').id;
    sdk.sendQueuedNow(bId);
    // Same lifecycle as auto drain: dispatching is published before the turn starts.
    assert.deepEqual(sdk.getQueueSnapshot().map((i) => [i.text, i.status]), [
      ['b', 'dispatching'],
      ['a', 'queued'],
    ]);
    await tick(24);

    assert.deepEqual(calls, ['first', 'b', 'a'], 'idle send-now executes the picked item, then the parked rest');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('pre-push construction failure restores the dispatching item to the queue', async () => {
    const { deps, broadcasts } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    // endAfter: the generation exits on its own once the interrupted turn finishes, so
    // the parked queue survives with NO resident query — the next start must reconstruct.
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-pre-push')],
      endAfter: 1,
      respond: async (msg) => {
        calls.push(pushedText(msg));
        await firstGate;
        return [resultMsg()];
      },
    });
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('parked');
    sdk.interruptTurn(); // park the queue (suppress drain), then let the turn settle
    releaseFirst();
    await p1;
    await tick(8);
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot().length > 0), 'parked item survives the dying generation');
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot().every((item) => item.status === 'queued')), 'death leaves an actionable queue before manual send-now');
    const id = sdk.getQueueSnapshot()[0].id;

    // The generation ended; make the lazy reconstruction fail before inputQueue.push.
    let failures = 0;
    sdk.__setQueryForTests(() => { failures += 1; throw new Error('construction boom'); });

    assert.deepEqual(sdk.sendQueuedNow(id), []);
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot()[0]?.status === 'queued'));

    const snap = sdk.getQueueSnapshot();
    assert.equal(snap.length, 1, 'a pre-push failure must not lose the message');
    assert.equal(snap[0].id, id);
    assert.equal(snap[0].status, 'queued', 'restored item becomes actionable again');
    assert.equal(failures, 2, 'exactly one bounded automatic retry, then park');
    const states = broadcasts.filter((b) => b.type === 'queue-state');
    assert.ok(states.some((s) => s.items.some((i) => i.id === id && i.status === 'dispatching')),
      'the item is announced as dispatching before the failed start');
    assert.deepEqual(snap, states.at(-1).items, 'the last broadcast converges on the restored snapshot');

    // A later retry with a working construction accepts it and clears the slot for good.
    sdk.__setQueryForTests(fq);
    sdk.sendQueuedNow(id);
    await tick(20);
    assert.deepEqual(calls, ['first', 'parked']);
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('a transient pre-push failure automatically retries once and delivers', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-retry-success')],
      endAfter: 1,
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (calls.length === 1) await firstGate;
        return [resultMsg()];
      },
    });
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const first = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('parked');
    sdk.interruptTurn();
    releaseFirst();
    await first;
    await tick(8);
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot().length > 0), 'parked item survives the dying generation');
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot().every((item) => item.status === 'queued')), 'death leaves an actionable queue before manual send-now');
    const id = sdk.getQueueSnapshot()[0].id;
    let constructions = 0;
    sdk.__setQueryForTests((args) => {
      constructions += 1;
      if (constructions === 1) throw new Error('transient construction');
      return fq(args);
    });
    sdk.sendQueuedNow(id);
    assert.ok(await waitMicro(() => constructions === 2 && sdk.getQueueSnapshot().length === 0));
    assert.equal(constructions, 2, 'the restored head is retried once');
    assert.ok(await waitMicro(() => calls.includes('parked')), 'the accepted retry reaches the SDK input queue');
    assert.deepEqual(calls, ['first', 'parked']);
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('clearQueued during query construction prevents the late inputQueue push', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-clear-await')],
      endAfter: 1,
      respond: async (msg) => {
        calls.push(pushedText(msg));
        await firstGate;
        return [resultMsg()];
      },
    });
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('do not deliver after clear');
    sdk.interruptTurn();
    releaseFirst();
    await p1;
    await tick(8);
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot().length > 0), 'parked item survives the dying generation');
    assert.ok(await waitMicro(() => sdk.getQueueSnapshot().every((item) => item.status === 'queued')), 'death leaves an actionable queue before manual send-now');
    const id = sdk.getQueueSnapshot()[0].id;

    let releaseConstruction;
    let constructionStarted;
    const constructing = new Promise((resolve) => { constructionStarted = resolve; });
    sdk.__setQueryForTests((args) => new Promise((resolve) => {
      constructionStarted();
      releaseConstruction = () => resolve(fq(args));
    }));
    sdk.sendQueuedNow(id);
    await constructing;
    assert.equal(sdk.getQueueSnapshot()[0].status, 'dispatching');
    sdk.clearQueued();
    assert.deepEqual(sdk.getQueueSnapshot(), []);

    releaseConstruction();
    await tick(12);
    assert.deepEqual(calls, ['first'], 'the dispatch identity is checked after the construction await');
    assert.deepEqual(sdk.getQueueSnapshot(), [], 'a cancelled dispatch cannot be restored');
  });

  it('clearQueued invalidates a dispatch whose query construction has not committed yet', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);
    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('do not deliver after clear');
    const id = sdk.getQueueSnapshot()[0].id;

    sdk.sendQueuedNow(id);
    assert.equal(sdk.getQueueSnapshot()[0].status, 'dispatching');
    sdk.clearQueued();
    assert.deepEqual(sdk.getQueueSnapshot(), []);
    releaseFirst();
    await p1;
    await tick(12);
    assert.deepEqual(calls, ['first'], 'clearing the scope prevents the interrupted-turn drain from delivering the queued prompt');
    assert.deepEqual(sdk.getQueueSnapshot(), [], 'a stale dispatch completion cannot restore a cleared item');
  });

  it('a pushed send-now item is not requeued when its own turn reports an error result', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-sn-fail')],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (idx++ === 0) await firstGate;
        if (pushedText(msg) === 'x') {
          return [resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['boom'] })];
        }
        return [resultMsg()];
      },
    });
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('x');
    const xId = sdk.getQueueSnapshot()[0].id;
    sdk.sendQueuedNow(xId);
    releaseFirst();
    await p1;
    await tick(12);

    assert.deepEqual(calls, ['first', 'x'], 'the error turn itself still ran');
    assert.equal(sdk.getQueueSnapshot().length, 0, 'a pushed message is never requeued on later turn failure');
  });

  it('Stop during the send-now unwind requeues the dispatching item and parks the backlog', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('second');
    await sdk.sendUserMessage('third');
    const target = sdk.getQueueSnapshot().find((i) => i.text === 'third');
    sdk.sendQueuedNow(target.id);
    assert.equal(fq.current().interruptCalls, 1);

    // The aborted turn has not produced its result yet; Stop now parks everything.
    sdk.interruptTurn();
    assert.equal(fq.current().interruptCalls, 1, 'Stop must not duplicate the send-now interrupt');
    assert.deepEqual(sdk.getQueueSnapshot().map((i) => [i.text, i.status]), [
      ['third', 'queued'],
      ['second', 'queued'],
    ], 'Stop returns the selected item to the actionable queue');

    releaseFirst();
    await p1;
    await tick(12);
    assert.deepEqual(calls, ['first'], 'parked backlog does not run after Stop');
    assert.equal(sdk.getQueueSnapshot().length, 2);
  });

  it('未知 id → 返回 []，仅重放权威快照且不打断（守卫必须先于 interrupt）', async () => {
    const { deps, broadcasts } = makeDeps();
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-guard')],
      respond: async () => { await firstGate; return [resultMsg()]; },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    const before = broadcasts.length;
    assert.deepEqual(sdk.sendQueuedNow('q_unknown'), []);
    await tick(3);
    assert.equal(broadcasts.length, before + 1, 'unknown id replays the authoritative snapshot once');
    assert.equal(fq.current().interruptCalls, 0, 'unknown id must not interrupt the running turn');
    releaseFirst();
    await p1;
    await tick(4);
  });

  it('空闲（Stop 后 parked）→ 立即执行该消息，随后 drain 其余 parked 项', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    // 常驻模型下 Stop=interrupt()（CLI abort 后回合收尾出 result）；fake 侧用
    // releaseFirst() 显式让被中断的回合收尾（语义等价，无需等 10s grace）。
    fq.releaseNextInterrupt();
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('a');
    await sdk.sendUserMessage('b');
    sdk.interruptTurn(); // parks [a, b]; interrupt() releases the gated first turn
    releaseFirst();      // belt-and-braces (no-op if interrupt already released)
    await p1;
    await tick(8);
    assert.equal(sdk.getQueueSnapshot().length, 2);
    assert.deepEqual(calls, ['first']);

    const bId = sdk.getQueueSnapshot()[1].id;
    sdk.sendQueuedNow(bId); // idle → run 'b' immediately, then the parked rest drains
    await tick(12);

    assert.deepEqual(calls, ['first', 'b', 'a'], 'send-now executes the picked item, then the parked rest drains');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('P0 回归：Stop 后 unwind 窗口内（回合 result 未到）send-now 不丢消息', async () => {
    const { deps } = makeDeps();
    const calls = [];
    const { fq, releaseFirst } = makeGatedQuery(calls);
    // NOTE: no releaseNextInterrupt — the aborted turn stays parked on firstGate until
    // the test releases it, keeping _queryBusy true through the send-now call.
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('x');
    sdk.interruptTurn(); // suppress=true; the aborted turn is STILL parked on firstGate
    const snap = sdk.getQueueSnapshot();
    assert.equal(snap.length, 1);
    sdk.sendQueuedNow(snap[0].id); // busy branch (unwind pending) — must lift the Stop-park
    releaseFirst();
    await p1;
    await tick(12);

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
    await tick(5);
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
    await tick(8);
    assert.deepEqual(calls, ['first'], 'drain suppressed after Stop — parked item never ran');
  });

  it('drain 途中回合级错误（result is_error）→ 后续消息仍被 drain', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-err')],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (idx++ === 0) await firstGate;
        if (idx === 2) return [resultMsg({ subtype: 'error_during_execution', is_error: true, errors: ['boom'] })];
        return [resultMsg()];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('bad');
    await sdk.sendUserMessage('good');
    releaseFirst();
    await p1;
    await tick(12);

    assert.deepEqual(calls, ['first', 'bad', 'good'], 'an errored turn must not wedge the queue');
    assert.equal(sdk.getQueueSnapshot().length, 0);
  });

  it('会话级死亡（迭代器抛错）→ 在途回合 settle，队列自动 drain 进惰性重建的新会话', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    // Generation 1 parks every turn on the gate (so endWith is observed mid-turn);
    // generation 2 (after reconstruction) must run free.
    let generation = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-park')],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (generation === 0) await firstGate;
        return [resultMsg()];
      },
    });
    // Wrap once: track the generation by construction count at call time.
    sdk.__setQueryForTests((arg) => { generation = fq.calls.length; return fq(arg); });
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    await sdk.sendUserMessage('queued');

    // Kill the session mid-turn: the in-flight turn settles via the death path; the
    // queued message drains into a lazily-reconstructed resident query.
    fq.endWith(new Error('session died'));
    releaseFirst();
    await p1;
    await tick(14);
    assert.equal(fq.calls.length, 2, 'death → lazy reconstruction for the queued message');
    assert.equal(fq.calls[1].options.resume, 'sess-park');
    assert.equal(sdk.getQueueSnapshot().length, 0, 'queue drained into the new session');
    assert.deepEqual(calls, ['first', 'queued']);
  });
});

// ── Review-driven regression coverage: watchdog settle / tombstone misfire / signal
// ── abort / death & switch dismiss broadcasts ──
describe('sdk-manager-query — review 回归（watchdog / 墓碑 / signal / dismiss）', () => {
  it('watchdog fire：队首 turn 的 promise 必须 settle + 挂墓碑；审批 pending 时豁免', async () => {
    const { deps } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-wd')],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (idx++ === 0) await firstGate; // silent turn — never yields on its own
        return [resultMsg()];
      },
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);

      const p1 = sdk.sendUserMessage('first');
      await tick(5);
      // watchdog (25min) fires before any result — force-settle path
      mock.timers.tick(26 * 60 * 1000);
      await p1; // MUST settle (regression: shift-then-settleAll used to leak it)
      await tick(4);

      // The turn's owed result arrives late → tombstoned (no turnEnd, no mis-settle)
      releaseFirst();
      await tick(6);

      // Next turn runs clean on the same resident query
      await sdk.sendUserMessage('second');
      await tick(8);
      assert.deepEqual(calls, ['first', 'second']);
    } finally {
      mock.timers.reset();
    }
  });

  it('审批 pending 时 watchdog 不 force-settle（重挂等待审批超时）', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'wd-ask' } };
    sdk.__setQueryForTests(makeCanUseToolQuery('AskUserQuestion', { questions: [{ q: 'hold?' }] }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const sendP = sdk.sendUserMessage('go');
      sendP.catch(() => {});
      await waitMicro(() => broadcasts.some((b) => b.type === 'sdk-ask-pending'));
      // Cross the watchdog window while the approval is pending: no force-settle —
      // the queued message must NOT be pushed into the approval-parked turn.
      await sdk.sendUserMessage('queued');
      mock.timers.tick(26 * 60 * 1000);
      await tick(6);
      assert.equal(sdk.getQueueSnapshot().length, 1, '审批 pending 证明会话存活，watchdog 仅重挂');
      // Resolve the ask → turn completes → queued message drains
      sdk.resolveApproval('wd-ask', [{ answer: 'A' }]);
      await tick(10);
      assert.equal(sdk.getQueueSnapshot().length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it('墓碑误吞守护：grace settle 后迟到 result 吞掉墓碑，再下一个 result 正常 settle 新回合', async () => {
    const { deps, turnEnds } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [sysInit('sess-tomb')],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (idx++ === 0) await firstGate;
        return [resultMsg()];
      },
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      sdk.__setQueryForTests(fq);
      sdk.initSdkSession(tmpDir, 'proj', deps);

      const p1 = sdk.sendUserMessage('first');
      await tick(5);
      sdk.interruptTurn();
      await waitMicro(() => fq.current().interruptCalls === 1);
      mock.timers.tick(11 * 1000); // grace force-settle + tombstone
      await tick(20);

      // Start turn 2 BEFORE the late result arrives
      const p2 = sdk.sendUserMessage('second');
      await tick(3);
      // The interrupted turn's result finally arrives → consumes the tombstone
      releaseFirst();
      await tick(6);
      // Turn 2's own result must still settle turn 2 (regression: the tombstone
      // branch used to skip busy=false, wedging the pipeline)
      await p2;
      await tick(6);
      assert.deepEqual(calls, ['first', 'second']);
      assert.equal(turnEnds.length, 1, '只有 turn 2 的 result 触发 turnEnd（墓碑吞掉的那次不算）');
    } finally {
      mock.timers.reset();
    }
  });

  it('signal abort（CLI 取消在途审批）→ deny + dismiss 广播 reason=aborted', async () => {
    const { deps, broadcasts } = makeDeps();
    const ac = new AbortController();
    const ctrl = { cutOpts: { toolUseID: 'sig-1', signal: ac.signal } };
    sdk.__setQueryForTests(makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl));
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    sendP.catch(() => {});
    await waitMicro(() => broadcasts.some((b) => b.type === 'perm-hook-pending'));
    ac.abort(); // CLI-side cancel of the in-flight control request
    await tick(6);

    assert.equal(ctrl.result.behavior, 'deny');
    const dismiss = broadcasts.filter((b) => b.type === 'perm-hook-timeout' && b.id === 'sig-1');
    assert.equal(dismiss.length, 1);
    assert.equal(dismiss[0].reason, 'aborted');
    // Late resolve is a no-op (first-wins)
    assert.equal(sdk.resolveApproval('sig-1', { decision: 'allow' }), false);
  });

  it('会话死亡时 pending 审批收到 dismiss（reason=session-ended）且 canUseTool 走 deny', async () => {
    const { deps, broadcasts } = makeDeps();
    const ctrl = { cutOpts: { toolUseID: 'die-perm' } };
    const fq = makeCanUseToolQuery('Bash', { command: 'ls' }, ctrl);
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const sendP = sdk.sendUserMessage('go');
    sendP.catch(() => {});
    await waitMicro(() => broadcasts.some((b) => b.type === 'perm-hook-pending'));
    fq.endWith(new Error('child died')); // session death while the modal is open
    await tick(6);

    assert.equal(ctrl.result.behavior, 'deny');
    const dismiss = broadcasts.filter((b) => b.type === 'perm-hook-timeout' && b.id === 'die-perm');
    assert.equal(dismiss.length, 1);
    assert.equal(dismiss[0].reason, 'session-ended');
    await sendP;
  });

  it('switchToSession：busy→busy；空闲切换后清队列广播 + init 快照重置 + dismiss 残留审批', async () => {
    const { deps, broadcasts } = makeDeps();
    const calls = [];
    let releaseFirst;
    const firstGate = new Promise((r) => { releaseFirst = r; });
    let idx = 0;
    const fq = makeResidentQuery({
      initMsgs: [{ ...sysInit('sess-sw'), slash_commands: ['/compact'] }],
      respond: async (msg) => {
        calls.push(pushedText(msg));
        if (idx++ === 0) await firstGate;
        return [resultMsg()];
      },
    });
    sdk.__setQueryForTests(fq);
    sdk.initSdkSession(tmpDir, 'proj', deps);

    const p1 = sdk.sendUserMessage('first');
    await tick(5);
    assert.ok(broadcasts.some((b) => b.type === 'sdk-init'), 'init 已广播');

    // Busy → 409-equivalent
    assert.deepEqual(sdk.switchToSession('a9883ab8-0ab7-459a-bcfd-4c8950a14384'), { ok: false, reason: 'busy' });
    void p1; // settled by the interrupt release below (or teardown) — never awaited mid-park

    // Queue a message while the first turn is still parked, then interrupt (Stop):
    // the queue parks and the turn settles via the interrupt release.
    await sdk.sendUserMessage('parked-msg');
    await tick(2);
    assert.equal(sdk.getQueueSnapshot().length, 1, 'queued while busy');
    fq.releaseNextInterrupt(); // interrupt() releases the parked turn (CLI contract)
    sdk.interruptTurn();
    // Wait until the interrupted turn has actually settled: its promise resolves.
    await p1;
    await tick(4);
    assert.equal(sdk.getQueueSnapshot().length, 1, 'Stop parks the queued message');
    // The interrupt path arms the 10s grace timer (unref'd); it fires harmlessly on an
    // empty turn list, but tick it off under mock timers so the file's tail doesn't
    // wait on real time in strict harnesses.
    const target = 'b9883ab8-0ab7-459a-bcfd-4c8950a14384';
    const r = sdk.switchToSession(target);
    assert.equal(r.ok, true);
    assert.equal(sdk.getSessionId(), target);
    assert.equal(sdk.getQueueSnapshot().length, 0, '切换清空队列');
    assert.equal(sdk.getSdkInitSnapshot(), null, '旧会话 init 快照被清（重连不重放旧命令面）');
    const qs = broadcasts.filter((b) => b.type === 'queue-state').at(-1);
    assert.equal(qs.items.length, 0, '清空后有 queue-state 广播');

    // Next message reconstructs with resume=target; the new session's init re-announces
    await sdk.sendUserMessage('after');
    await tick(6);
    assert.equal(fq.calls.length, 2);
    assert.equal(fq.calls[1].options.resume, target);
    const initB = broadcasts.filter((b) => b.type === 'sdk-init');
    assert.equal(initB.length, 2, '新会话的 sdk-init 重新广播');
  });

  it('switchToSession 守卫：bad-id / unavailable', async () => {
    const { deps } = makeDeps();
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit('sess-guard2')] }));
    sdk.initSdkSession(tmpDir, 'proj', deps);
    assert.deepEqual(sdk.switchToSession(''), { ok: false, reason: 'bad-id' });
    assert.deepEqual(sdk.switchToSession(null), { ok: false, reason: 'bad-id' });
    sdk.__setQueryForTests(null);
    assert.deepEqual(sdk.switchToSession('a9883ab8-0ab7-459a-bcfd-4c8950a14384'), { ok: false, reason: 'unavailable' });
    sdk.__setQueryForTests(makeResidentQuery({ initMsgs: [sysInit('sess-guard2')] }));
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
