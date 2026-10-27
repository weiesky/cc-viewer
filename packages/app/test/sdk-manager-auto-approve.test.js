/**
 * sdk-manager-auto-approve.test.js — 服务端自动审批倒计时（SDK 路径）。
 *
 * 覆盖：
 *   - plan/perm 到达即按 prefs 武装服务端兜底计时器，到点（N+1s buffer）自动 allow
 *     并广播 resolved（reason='auto-approved'）；
 *   - instant(-1) 同 tick 自动 allow；
 *   - autoCancelApproval 取消后到期不点火、approval 仍 pending、快照带
 *     autoCancelled/autoApproveAt=null、手动 resolve 仍可用、幂等与 kind 守卫；
 *   - stopSession/teardown 清兜底计时器（到期不再点火）；
 *   - ephemeral host 的 pending 也能经模块级 autoCancelApproval 取消。
 *
 * 约定与 branch-lib-sdk-manager.test.js 相同：node:test + assert/strict；私有 mkdtemp
 * 作 CCV_LOG_DIR（import 前设好）；动态 import；mock.timers 只 mock setTimeout 并在
 * finally 还原；每个用例后 stopSession 硬清理。
 */

import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir;
let sdk;
let realQuery;

function writePrefs(prefs) {
  writeFileSync(join(tmpDir, 'preferences.json'), JSON.stringify(prefs));
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ccv-sdkauto-'));
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
  // 每个用例结束后回到「关闭自动审批」的干净基线，互不污染
  try { writePrefs({ autoApproveSeconds: 0, approvalModal: { planAutoApproveSeconds: 0 } }); } catch {}
});

function makeDeps() {
  const broadcasts = [];
  return { deps: { broadcastWs: (m) => broadcasts.push(m) }, broadcasts };
}

function sysInit(sessionId = 'sess-a') {
  return { type: 'system', subtype: 'init', session_id: sessionId, model: 'm', tools: [] };
}

async function tick(n = 8) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function waitMicro(cond, max = 80) {
  for (let i = 0; i < max; i++) {
    if (cond()) return true;
    await Promise.resolve();
  }
  return cond();
}

// 与 branch-lib-sdk-manager.test.js 同款：canUseTool 触发后永不 yield result（回合挂起，
// 由超时/resolve/teardown 收尾），_waitForApproval 的定时器是唯一未决定时器。
function makeCanUseToolQuery(toolName, input, ctrl) {
  return function fakeQuery({ prompt, options }) {
    let closed = false;
    return {
      async *[Symbol.asyncIterator]() {
        yield sysInit();
        await Promise.resolve();
        for await (const msg of prompt) {
          void msg;
          if (closed) return;
          ctrl.promise = options.canUseTool(toolName, input, ctrl.cutOpts || {});
          ctrl.captured = true;
          ctrl.result = await ctrl.promise;
          return;
        }
      },
      interrupt() { return Promise.resolve(); },
      close() { closed = true; },
    };
  };
}

// 驱动一次 pending：broadcast 发出即返回（timer 已注册），结果留在 ctrl.result。
async function drivePending({ toolName, input, ctrl, broadcastType, prefs, sessionCwd }) {
  writePrefs(prefs);
  sdk.__setQueryForTests(makeCanUseToolQuery(toolName, input, ctrl));
  sdk.initSdkSession(sessionCwd || tmpDir, 'proj', ctrl.deps);
  const sendP = sdk.sendUserMessage('go');
  sendP.catch(() => {});
  const ok = await waitMicro(() => ctrl.broadcasts.some((b) => b.type === broadcastType));
  assert.ok(ok, `should broadcast ${broadcastType}`);
}

describe('sdk-manager 服务端自动审批 — plan', () => {
  it('N=2：pending 帧带 autoApproveAt≈now+2000；tick 3100 自动 allow + 广播 auto-approved', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'plan-auto' }, deps, broadcasts };
      await drivePending({
        toolName: 'ExitPlanMode', input: { plan: 'x' }, ctrl,
        broadcastType: 'sdk-plan-pending',
        prefs: { autoApproveSeconds: 0, approvalModal: { planAutoApproveSeconds: 2 } },
      });
      const frame = broadcasts.find((b) => b.type === 'sdk-plan-pending' && b.id === 'plan-auto');
      assert.ok(frame.autoApproveAt > 0, 'frame should carry the absolute deadline');
      assert.equal(frame.autoApproveSeconds, 2);

      // 截止(2000)未到 → 不点火
      mock.timers.tick(1500);
      await tick();
      assert.equal(ctrl.result, undefined);

      // +1s buffer 后到点 → 自动 allow + 一次 auto-approved 广播
      mock.timers.tick(1600);
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'allow');
      const resolved = broadcasts.filter((b) => b.type === 'sdk-plan-resolved' && b.id === 'plan-auto');
      assert.equal(resolved.length, 1);
      assert.equal(resolved[0].reason, 'auto-approved');
    } finally {
      mock.timers.reset();
    }
  });

  it('instant(-1)：无需手动应答即 allow，且广播 auto-approved', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'plan-inst' }, deps, broadcasts };
      await drivePending({
        toolName: 'ExitPlanMode', input: { plan: 'x' }, ctrl,
        broadcastType: 'sdk-plan-pending',
        prefs: { autoApproveSeconds: 0, approvalModal: { planAutoApproveSeconds: -1 } },
      });
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'allow');
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-plan-resolved' && b.id === 'plan-inst').length, 1);
    } finally {
      mock.timers.reset();
    }
  });

  it('关闭档：快照 autoApproveAt=null，手动 resolveApproval 仍可用，到期不自动点火', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'plan-off' }, deps, broadcasts };
      await drivePending({
        toolName: 'ExitPlanMode', input: { plan: 'x' }, ctrl,
        broadcastType: 'sdk-plan-pending',
        prefs: { autoApproveSeconds: 0, approvalModal: { planAutoApproveSeconds: 0 } },
      });
      const snap = sdk.getPendingApprovals().find((p) => p.id === 'plan-off');
      assert.equal(snap.autoApproveAt, null);
      assert.equal(snap.autoCancelled, false);
      mock.timers.tick(60 * 1000);
      await tick();
      assert.equal(ctrl.result, undefined, 'must not auto-fire when disabled');
      assert.equal(sdk.resolveApproval('plan-off', { approve: true, feedback: '' }), true);
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'allow');
      assert.equal(broadcasts.some((b) => b.type === 'sdk-plan-resolved' && b.reason === 'auto-approved'), false);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('sdk-manager 服务端自动审批 — perm', () => {
  it('N=1：到期自动 allow + 广播 perm-hook-resolved(auto-approved)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'perm-auto' }, deps, broadcasts };
      await drivePending({
        toolName: 'Bash', input: { command: 'ls' }, ctrl,
        broadcastType: 'perm-hook-pending',
        prefs: { autoApproveSeconds: 1 },
      });
      const frame = broadcasts.find((b) => b.type === 'perm-hook-pending' && b.id === 'perm-auto');
      assert.ok(frame.autoApproveAt > 0);
      assert.equal(frame.autoApproveSeconds, 1);
      assert.ok(frame.instanceKey, 'perm frame must carry instanceKey (multi-instance replay)');
      mock.timers.tick(2100);
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'allow');
      assert.equal(broadcasts.filter((b) => b.type === 'perm-hook-resolved' && b.id === 'perm-auto' && b.reason === 'auto-approved').length, 1);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('sdk-manager 服务端自动审批 — 安全底线', () => {
  it('npm publish 永不走服务端自动批准（即时档也一样）：无 autoApproveAt，到期只能手动/超时', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'perm-pub' }, deps, broadcasts };
      await drivePending({
        toolName: 'Bash', input: { command: 'npm publish' }, ctrl,
        broadcastType: 'perm-hook-pending',
        prefs: { autoApproveSeconds: -1 }, // 即时档也不得豁免 publish 硬闸
      });
      const frame = broadcasts.find((b) => b.type === 'perm-hook-pending' && b.id === 'perm-pub');
      assert.equal(frame.autoApproveSeconds, 0, 'publish frame must be stamped off');
      assert.ok(!frame.autoApproveAt, 'publish frame must not carry a deadline');
      mock.timers.tick(10_000);
      await tick();
      assert.equal(ctrl.result, undefined, 'publish must never auto-fire');
      // 手动批准仍可用（硬闸只挡自动路径）
      assert.equal(sdk.resolveApproval('perm-pub', { decision: 'allow' }), true);
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'allow');
    } finally {
      mock.timers.reset();
    }
  });

  it('scheduled-task（ephemeral, ctx 非空）不走服务端自动批准', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      writePrefs({ autoApproveSeconds: 1 });
      sdk.setSdkLaunchConfig({
        permissionMode: 'default',
        env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' },
        settings: null, model: null, userArgs: [], claudeExecutable: null,
      });
      let capturedOpts = null;
      sdk.__setQueryForTests(({ options } = {}) => {
        capturedOpts = options;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'system', subtype: 'init', session_id: 'eph-pub' };
            await new Promise(() => {});
          },
          close() {},
        };
      });
      const runP = sdk.spawnEphemeralSession('do it', { cwd: tmpDir, project: 'proj' });
      runP.catch(() => {});
      await waitMicro(() => !!capturedOpts);
      const p = capturedOpts.canUseTool('Bash', { command: 'ls' }, { toolUseID: 'eph-noauto' });
      p.catch(() => {});
      await waitMicro(() => sdk.getPendingApprovals().some((x) => x.id === 'eph-noauto'));
      const snap = sdk.getPendingApprovals().find((x) => x.id === 'eph-noauto');
      assert.equal(snap.autoApproveAt, null, 'scheduled-task must not carry an auto-approve deadline');
      mock.timers.tick(5000);
      await tick();
      assert.equal(sdk.getPendingApprovals().some((x) => x.id === 'eph-noauto'), true, 'must still be pending (no auto fire)');
      // 清场
      sdk.resolveApproval('eph-noauto', { decision: 'allow' });
      await p;
      sdk.stopSession();
      await runP.catch(() => {});
    } finally {
      mock.timers.reset();
    }
  });
});

describe('sdk-manager 服务端自动审批 — autoCancelApproval', () => {
  it('ask（AskUserQuestion）永不自动审批（autoApproveSeconds 设置不影响 ask 分支）', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'ask-never' }, deps, broadcasts };
      await drivePending({
        toolName: 'AskUserQuestion', input: { questions: [{ q: 'pick?' }] }, ctrl,
        broadcastType: 'sdk-ask-pending',
        prefs: { autoApproveSeconds: -1, approvalModal: { planAutoApproveSeconds: -1 } },
      });
      const frame = broadcasts.find((b) => b.type === 'sdk-ask-pending' && b.id === 'ask-never');
      assert.ok(frame.instanceKey, 'ask frame must carry instanceKey (multi-instance replay)');
      const snap = sdk.getPendingApprovals().find((p) => p.id === 'ask-never');
      assert.equal(snap.autoApproveAt, null, 'ask must never carry an auto-approve deadline');
      mock.timers.tick(10_000);
      await tick();
      assert.equal(ctrl.result, undefined, 'ask must not auto-fire even in instant mode');
      assert.equal(sdk.autoCancelApproval('ask-never', 'ask'), false, 'autoCancel is plan/perm only');
    } finally {
      mock.timers.reset();
    }
  });

  it('ephemeral host 的 pending 也能经模块级 autoCancelApproval 取消（union scan）', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      writePrefs({ autoApproveSeconds: 30 });
      // 需要 launch config 过 not_initialized 守卫
      sdk.setSdkLaunchConfig({
        permissionMode: 'default',
        env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' },
        settings: null, model: null, userArgs: [], claudeExecutable: null,
      });
      let parked = null;
      const fakeQuery = () => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: 'eph-sid' };
          await new Promise(() => {}); // turn never completes; canUseTool parks below
        },
        close() {},
        // canUseTool is consumed via options, not the iterator — see below
      });
      // ephemeral spawn: single-prompt query; capture options.canUseTool via onCall pattern
      let capturedOpts = null;
      sdk.__setQueryForTests(({ options } = {}) => {
        capturedOpts = options;
        return fakeQuery();
      });
      const runP = sdk.spawnEphemeralSession('do it', { cwd: tmpDir, project: 'proj' });
      runP.catch(() => {});
      await waitMicro(() => !!capturedOpts);
      const p = capturedOpts.canUseTool('Bash', { command: 'ls' }, { toolUseID: 'eph-perm' });
      p.catch(() => {});
      await waitMicro(() => sdk.getPendingApprovals().some((x) => x.id === 'eph-perm'));
      // 模块级扫描应覆盖 ephemeral host
      assert.equal(sdk.autoCancelApproval('eph-perm', 'perm'), true);
      const snap = sdk.getPendingApprovals().find((x) => x.id === 'eph-perm');
      assert.equal(snap.autoCancelled, true);
      // 手动 resolve 仍可用（取消不解决）
      assert.equal(sdk.resolveApproval('eph-perm', { decision: 'allow' }), true);
      const r = await p;
      assert.equal(r.behavior, 'allow');
      sdk.stopSession();
      await runP.catch(() => {});
    } finally {
      mock.timers.reset();
    }
  });
  it('取消后到期不点火、仍 pending、快照 autoCancelled=true、手动 resolve 仍可用', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'plan-cancel' }, deps, broadcasts };
      await drivePending({
        toolName: 'ExitPlanMode', input: { plan: 'x' }, ctrl,
        broadcastType: 'sdk-plan-pending',
        prefs: { autoApproveSeconds: 0, approvalModal: { planAutoApproveSeconds: 2 } },
      });
      assert.equal(sdk.autoCancelApproval('plan-cancel', 'plan'), true);
      // 首次取消广播一次 sdk-plan-auto-cancel
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-plan-auto-cancel' && b.id === 'plan-cancel').length, 1);
      // 幂等：第二次取消仍 true 但不再广播
      assert.equal(sdk.autoCancelApproval('plan-cancel', 'plan'), true);
      assert.equal(broadcasts.filter((b) => b.type === 'sdk-plan-auto-cancel' && b.id === 'plan-cancel').length, 1);
      // kind 守卫：perm kind 不匹配
      assert.equal(sdk.autoCancelApproval('plan-cancel', 'perm'), false);

      mock.timers.tick(10_000);
      await tick();
      assert.equal(ctrl.result, undefined, 'cancelled entry must not auto-fire');
      const snap = sdk.getPendingApprovals().find((p) => p.id === 'plan-cancel');
      assert.equal(snap.autoCancelled, true);
      assert.equal(snap.autoApproveAt, null);

      // 保持 pending：手动批准依然生效
      assert.equal(sdk.resolveApproval('plan-cancel', { approve: true, feedback: '' }), true);
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'allow');
      // resolve 之后再取消 → false（entry 已删）
      assert.equal(sdk.autoCancelApproval('plan-cancel', 'plan'), false);
    } finally {
      mock.timers.reset();
    }
  });

  it('perm 取消：广播 perm-hook-auto-cancel，到期不点火', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'perm-cancel' }, deps, broadcasts };
      await drivePending({
        toolName: 'Bash', input: { command: 'ls' }, ctrl,
        broadcastType: 'perm-hook-pending',
        prefs: { autoApproveSeconds: 1 },
      });
      assert.equal(sdk.autoCancelApproval('perm-cancel', 'perm'), true);
      assert.equal(broadcasts.filter((b) => b.type === 'perm-hook-auto-cancel' && b.id === 'perm-cancel').length, 1);
      mock.timers.tick(5000);
      await tick();
      assert.equal(ctrl.result, undefined);
      assert.equal(sdk.resolveApproval('perm-cancel', { decision: 'deny' }), true);
      await tick(10);
      assert.equal(ctrl.result?.behavior, 'deny');
    } finally {
      mock.timers.reset();
    }
  });

  it('stopSession teardown 清兜底计时器：到期不再点火', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { deps, broadcasts } = makeDeps();
      const ctrl = { cutOpts: { toolUseID: 'plan-td' }, deps, broadcasts };
      await drivePending({
        toolName: 'ExitPlanMode', input: { plan: 'x' }, ctrl,
        broadcastType: 'sdk-plan-pending',
        prefs: { autoApproveSeconds: 0, approvalModal: { planAutoApproveSeconds: 2 } },
      });
      sdk.stopSession();
      await tick(10);
      mock.timers.tick(10_000);
      await tick(10);
      assert.equal(
        broadcasts.some((b) => b.type === 'sdk-plan-resolved' && b.reason === 'auto-approved'),
        false,
        'teardown must prevent any later auto-approve fire',
      );
    } finally {
      mock.timers.reset();
    }
  });
});
