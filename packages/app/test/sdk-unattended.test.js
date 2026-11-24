/**
 * sdk-unattended.test.js — runImSdkMode 的无人值守审批（SDK 路径）。
 *
 * 覆盖 `unattended: true` 会话的 canUseTool 行为（sdk-manager.js 的 2b 分支）：
 *   - AskUserQuestion / ExitPlanMode 立即 deny（不广播 pending、不挂起等待）；
 *   - npm publish 立即 deny（不挂 5 分钟审批）；
 *   - 普通工具（如 Bash ls）auto-allow；
 *   - CCV_IM_DENY=1 时硬 deny 仍最先执行（先于 unattended 的 auto-allow）；
 *   - result 消息把权威 resultText 透传给 onTurnEnd（IM worker 无 transcript 的出站兜底）。
 *
 * 约定同 sdk-manager-auto-approve.test.js：node:test + assert/strict；私有 mkdtemp 作
 * CCV_LOG_DIR/CLAUDE_CONFIG_DIR（import 前设好）；__setQueryForTests 注入假 query；每个用例后
 * stopSession 硬清理。
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let sdk;
let realQuery;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdkunattended-'));
  process.env.CCV_LOG_DIR = tmpDir;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;
  sdk = await import('../server/lib/sdk-manager.js');
  try {
    const real = await import('@anthropic-ai/claude-agent-sdk');
    realQuery = real.query;
  } catch { realQuery = undefined; }
});

after(() => {
  if (sdk) {
    sdk.__setQueryForTests(realQuery);
    sdk.stopSession();
  }
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  if (sdk) sdk.stopSession();
  delete process.env.CCV_IM_DENY;
});

function sysInit(sessionId = 'sess-u') {
  return { type: 'system', subtype: 'init', session_id: sessionId, model: 'm', tools: [] };
}

async function waitMicro(cond, max = 200) {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    await Promise.resolve();
  }
  return false;
}

// 注入一条用户消息后立即触发一次 canUseTool，把结果留在 ctrl.result，然后结束回合。
function makeToolQuery(toolName, input, ctrl) {
  return function fakeQuery({ prompt, options }) {
    let closed = false;
    return {
      async *[Symbol.asyncIterator]() {
        yield sysInit();
        await Promise.resolve();
        for await (const msg of prompt) {
          void msg;
          if (closed) return;
          ctrl.canUseToolSeen = true;
          ctrl.result = await options.canUseTool(toolName, input, { toolUseID: 'u-1' });
          yield { type: 'result', subtype: 'success', result: 'DONE', session_id: 'sess-u' };
          return;
        }
      },
      interrupt() { return Promise.resolve(); },
      close() { closed = true; },
    };
  };
}

async function driveTool({ toolName, input, unattended = true, permissionMode = 'bypassPermissions', imDeny = true }) {
  // unattended 分支收窄为「_unattended && CCV_IM_DENY=1」（真实 IM worker 语义），故默认带上。
  if (imDeny) process.env.CCV_IM_DENY = '1'; else delete process.env.CCV_IM_DENY;
  const broadcasts = [];
  const ctrl = {};
  sdk.__setQueryForTests(makeToolQuery(toolName, input, ctrl));
  sdk.initSdkSession(join(tmpDir, 'ws'), 'proj', {
    broadcastWs: (m) => broadcasts.push(m),
    permissionMode,
    unattended,
  });
  const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws') });
  sendP.catch(() => {});
  const ok = await waitMicro(() => ctrl.result !== undefined);
  assert.ok(ok, `canUseTool should resolve for ${toolName}`);
  delete process.env.CCV_IM_DENY;
  return { ctrl, broadcasts };
}

describe('sdk unattended — interactive tools deny immediately (no hang)', () => {
  it('AskUserQuestion → 立即 deny，不广播 sdk-ask-pending', async () => {
    const { ctrl, broadcasts } = await driveTool({ toolName: 'AskUserQuestion', input: { questions: [] } });
    assert.equal(ctrl.result?.behavior, 'deny');
    assert.match(ctrl.result?.message || '', /[Uu]nattended/);
    assert.equal(broadcasts.some((b) => b.type === 'sdk-ask-pending'), false, 'must not park an ask modal');
  });

  it('ExitPlanMode → 立即 deny，不广播 sdk-plan-pending', async () => {
    const { ctrl, broadcasts } = await driveTool({ toolName: 'ExitPlanMode', input: { plan: 'x' } });
    assert.equal(ctrl.result?.behavior, 'deny');
    assert.equal(broadcasts.some((b) => b.type === 'sdk-plan-pending'), false, 'must not park a plan modal');
  });

  it('npm publish → 立即 deny，不挂 5 分钟审批', async () => {
    const { ctrl, broadcasts } = await driveTool({ toolName: 'Bash', input: { command: 'npm publish' } });
    assert.equal(ctrl.result?.behavior, 'deny');
    assert.equal(broadcasts.some((b) => b.type === 'perm-hook-pending'), false, 'must not park a perm modal');
  });

  it('普通工具（Bash ls）→ auto-allow', async () => {
    const { ctrl } = await driveTool({ toolName: 'Bash', input: { command: 'ls -la' } });
    assert.equal(ctrl.result?.behavior, 'allow');
  });

  it('CCV_IM_DENY=1 时硬 deny 仍最先执行（先于 unattended auto-allow）', async () => {
    process.env.CCV_IM_DENY = '1';
    const { ctrl } = await driveTool({ toolName: 'Bash', input: { command: 'sudo rm -rf /' } });
    assert.equal(ctrl.result?.behavior, 'deny');
    assert.match(ctrl.result?.message || '', /IM guard/i, 'IM hard deny must win over unattended auto-allow');
  });

  it('unattended 关闭（普通 SDK 会话）行为不变：bypass 下普通工具仍 allow', async () => {
    const { ctrl } = await driveTool({ toolName: 'Bash', input: { command: 'ls' }, unattended: false });
    assert.equal(ctrl.result?.behavior, 'allow');
  });
});

describe('sdk _onTurnEnd — resultText passthrough', () => {
  it('result 消息的 result 文本经 onTurnEnd 透出（IM 出站兜底）', async () => {
    const turnEnds = [];
    sdk.__setQueryForTests(function fakeQuery({ prompt }) {
      let closed = false;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          for await (const msg of prompt) {
            void msg;
            if (closed) return;
            yield { type: 'result', subtype: 'success', result: 'FINAL ANSWER', session_id: 'sess-u' };
            return;
          }
        },
        interrupt() { return Promise.resolve(); },
        close() { closed = true; },
      };
    });
    sdk.initSdkSession(join(tmpDir, 'ws2'), 'proj', {
      broadcastWs: () => {},
      permissionMode: 'bypassPermissions',
      unattended: true,
      onTurnEnd: (p) => turnEnds.push(p),
    });
    const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws2') });
    sendP.catch(() => {});
    const ok = await waitMicro(() => turnEnds.length > 0);
    assert.ok(ok, 'onTurnEnd should fire after the result message');
    assert.equal(turnEnds[0].resultText, 'FINAL ANSWER', 'resultText must carry the SDK result text');
  });

  it('错误/无 result 的回合 resultText 为 null（调用方据此清空，不重发上一轮旧文本）', async () => {
    const turnEnds = [];
    sdk.__setQueryForTests(function fakeQuery({ prompt }) {
      let closed = false;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          for await (const msg of prompt) {
            void msg;
            if (closed) return;
            yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'sess-u' };
            return;
          }
        },
        interrupt() { return Promise.resolve(); },
        close() { closed = true; },
      };
    });
    sdk.initSdkSession(join(tmpDir, 'ws3'), 'proj', {
      broadcastWs: () => {},
      permissionMode: 'bypassPermissions',
      unattended: true,
      onTurnEnd: (p) => turnEnds.push(p),
    });
    const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws3') });
    sendP.catch(() => {});
    const ok = await waitMicro(() => turnEnds.length > 0);
    assert.ok(ok, 'onTurnEnd should fire even for an error result');
    assert.equal(turnEnds[0].resultText, null, 'error result must carry resultText=null so the caller clears the fallback');
  });
});

describe('sdk IM worker — in-process PreToolUse hook (P1-1 enforcement parity)', () => {
  // SDK 子进程剥离了 CCV_IM_DENY/CCVIEWER_PORT，settings-bridge 在子进程休眠；canUseTool 是唯一
  // 父进程拦截层。本组验证 sdk-manager 还挂了 in-process PreToolUse hook（引擎层、模式无关），
  // 使 IM 硬 deny 在 bypass 下也权威生效，恢复与 PTY 同级的执行层。
  function captureOptionsQuery(ctrl) {
    return function fakeQuery({ prompt, options }) {
      ctrl.options = options;
      let closed = false;
      return {
        async *[Symbol.asyncIterator]() {
          yield sysInit();
          await Promise.resolve();
          for await (const m of prompt) { void m; if (closed) return; return; }
        },
        interrupt() { return Promise.resolve(); },
        close() { closed = true; },
      };
    };
  }

  it('CCV_IM_DENY=1 时 options.hooks.PreToolUse 存在且对危险命令返回 deny', async () => {
    process.env.CCV_IM_DENY = '1';
    const ctrl = {};
    sdk.__setQueryForTests(captureOptionsQuery(ctrl));
    sdk.initSdkSession(join(tmpDir, 'ws4'), 'proj', {
      broadcastWs: () => {}, permissionMode: 'bypassPermissions', unattended: true,
    });
    const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws4') });
    sendP.catch(() => {});
    const ok = await waitMicro(() => !!ctrl.options);
    assert.ok(ok, 'query should be constructed');
    const matcher = ctrl.options.hooks?.PreToolUse?.[0];
    assert.ok(matcher && Array.isArray(matcher.hooks) && matcher.hooks.length > 0, 'PreToolUse hook must be mounted');
    const out = await matcher.hooks[0]({ tool_name: 'Bash', tool_input: { command: 'sudo rm -rf /' } }, 'id-1', { signal: undefined });
    assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny', 'IM hook must deny a dangerous command at the engine layer');
  });

  it('unattended 时 hook 对交互工具（AskUserQuestion/ExitPlanMode）返回 deny（不挂起）', async () => {
    process.env.CCV_IM_DENY = '1';
    const ctrl = {};
    sdk.__setQueryForTests(captureOptionsQuery(ctrl));
    sdk.initSdkSession(join(tmpDir, 'ws-i'), 'proj', {
      broadcastWs: () => {}, permissionMode: 'bypassPermissions', unattended: true,
    });
    const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws-i') });
    sendP.catch(() => {});
    const ok = await waitMicro(() => !!ctrl.options);
    assert.ok(ok);
    const hook = ctrl.options.hooks.PreToolUse[0].hooks[0];
    const ask = await hook({ tool_name: 'AskUserQuestion', tool_input: { questions: [] } }, 'id-2', { signal: undefined });
    assert.equal(ask?.hookSpecificOutput?.permissionDecision, 'deny', 'AskUserQuestion must be denied at the hook (canUseTool is shadowed under bypass)');
    const plan = await hook({ tool_name: 'ExitPlanMode', tool_input: { plan: 'x' } }, 'id-3', { signal: undefined });
    assert.equal(plan?.hookSpecificOutput?.permissionDecision, 'deny', 'ExitPlanMode must be denied at the hook');
  });

  it('hook 对 publish 返回 deny、对正常命令不误拦（假阴性防护）', async () => {
    process.env.CCV_IM_DENY = '1';
    const ctrl = {};
    sdk.__setQueryForTests(captureOptionsQuery(ctrl));
    sdk.initSdkSession(join(tmpDir, 'ws-p'), 'proj', {
      broadcastWs: () => {}, permissionMode: 'bypassPermissions', unattended: true,
    });
    const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws-p') });
    sendP.catch(() => {});
    const ok = await waitMicro(() => !!ctrl.options);
    assert.ok(ok);
    const hook = ctrl.options.hooks.PreToolUse[0].hooks[0];
    const pub = await hook({ tool_name: 'Bash', tool_input: { command: 'npm publish' } }, 'id-4', { signal: undefined });
    assert.equal(pub?.hookSpecificOutput?.permissionDecision, 'deny', 'npm publish must be denied at the hook');
    const benign = await hook({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }, 'id-5', { signal: undefined });
    assert.notEqual(benign?.hookSpecificOutput?.permissionDecision, 'deny', 'a benign command must NOT be denied (guard against deny-everything)');
    const benignAsk = await hook({ tool_name: 'Read', tool_input: { file_path: '/tmp/normal.txt' } }, 'id-6', { signal: undefined });
    assert.notEqual(benignAsk?.hookSpecificOutput?.permissionDecision, 'deny', 'a normal Read must NOT be denied');
  });

  it('CCV_IM_DENY 未设置时不挂 PreToolUse hook（普通 SDK 会话零变化）', async () => {
    delete process.env.CCV_IM_DENY;
    const ctrl = {};
    sdk.__setQueryForTests(captureOptionsQuery(ctrl));
    sdk.initSdkSession(join(tmpDir, 'ws5'), 'proj', { broadcastWs: () => {}, permissionMode: 'default' });
    const sendP = sdk.sendUserMessage('go', { cwd: join(tmpDir, 'ws5') });
    sendP.catch(() => {});
    const ok = await waitMicro(() => !!ctrl.options);
    assert.ok(ok);
    assert.equal(ctrl.options.hooks?.PreToolUse, undefined, 'no PreToolUse hook when CCV_IM_DENY is unset');
  });
});
