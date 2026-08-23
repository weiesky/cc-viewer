import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  spawnClaude,
  spawnShell,
  writeToPty,
  writeToPtySequential,
  resizePty,
  killPty,
  _setPtyImportForTests,
  onPtyData,
  onPtyExit,
  getPtyPid,
  getPtyState,
  getCurrentWorkspace,
  getOutputBuffer,
  withDefaultThinkingDisplay,
  _clearThinkingDisplayRejectedPaths,
  _isThinkingDisplayRejected,
  _markThinkingDisplayRejected,
  _clearSystemPromptFileRejectedPaths,
  _isSystemPromptFileRejected,
  _setSpawnModelReaderForTests,
  _defaultSpawnModelReader,
  _setNowForTests,
} from '../server/pty-manager.js';
import { LOG_DIR } from '../findcc.js';

// ─── getPtyPid / getPtyState / getCurrentWorkspace (no PTY running) ───

describe('pty-manager: state queries without PTY', () => {
  it('getPtyPid returns null when no PTY', () => {
    assert.equal(getPtyPid(), null);
  });

  it('getPtyState returns not running when no PTY', () => {
    const state = getPtyState();
    assert.equal(state.running, false);
  });

  it('getCurrentWorkspace returns not running when no PTY', () => {
    const ws = getCurrentWorkspace();
    assert.equal(ws.running, false);
    assert.equal(ws.cwd, null);
  });

  it('getOutputBuffer returns empty string initially', () => {
    const buf = getOutputBuffer();
    assert.equal(typeof buf, 'string');
  });
});

// ─── writeToPty / resizePty / killPty (no-op when no PTY) ───

describe('pty-manager: operations without PTY', () => {
  it('writeToPty does not throw when no PTY', () => {
    assert.doesNotThrow(() => writeToPty('test'));
  });

  it('resizePty does not throw when no PTY', () => {
    assert.doesNotThrow(() => resizePty(80, 24));
  });

  it('killPty does not throw when no PTY', () => {
    assert.doesNotThrow(() => killPty());
  });
});

// ─── onPtyData / onPtyExit listener registration ───

describe('pty-manager: listener registration', () => {
  it('onPtyData registers and unregisters listener', () => {
    let called = false;
    const unsubscribe = onPtyData(() => { called = true; });
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
    // Listener removed, but we can't easily verify without spawning PTY
    assert.equal(called, false);
  });

  it('onPtyExit registers and unregisters listener', () => {
    let called = false;
    const unsubscribe = onPtyExit(() => { called = true; });
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
    assert.equal(called, false);
  });

  it('multiple listeners can be registered', () => {
    const unsub1 = onPtyData(() => {});
    const unsub2 = onPtyData(() => {});
    assert.equal(typeof unsub1, 'function');
    assert.equal(typeof unsub2, 'function');
    unsub1();
    unsub2();
  });
});

// ─── spawnClaude integration (requires claude binary) ───

describe('pty-manager: spawnClaude integration', () => {
  let spawned = [];

  beforeEach(() => {
    spawned = [];
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const dataHandlers = [];
        const exitHandlers = [];
        let killed = false;
        const inst = {
          pid: 12345 + spawned.length,
          command,
          args,
          opts,
          write(data) {
            for (const cb of dataHandlers) cb(`out:${data}`);
          },
          resize() {},
          kill() {
            if (killed) return;
            killed = true;
            for (const cb of exitHandlers) cb({ exitCode: 0 });
          },
          onData(cb) { dataHandlers.push(cb); },
          onExit(cb) { exitHandlers.push(cb); },
          _isKilled() { return killed; },
        };
        spawned.push(inst);
        return inst;
      },
    }));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
    _setSpawnModelReaderForTests(null);
  });

  it('getPtyPid returns PID when PTY is running', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    assert.equal(getPtyPid(), 12345);
    killPty();
    assert.equal(getPtyPid(), null);
  });

  it('getPtyState reflects running state after spawn', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    const state = getPtyState();
    assert.equal(state.running, true);
    killPty();
    assert.equal(getPtyState().running, false);
  });

  it('getCurrentWorkspace returns cwd after spawn', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    const ws = getCurrentWorkspace();
    assert.equal(ws.running, true);
    assert.equal(ws.cwd, process.cwd());
  });

  it('onPtyData receives data from PTY', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    await new Promise((resolve) => {
      const unsub = onPtyData((data) => {
        unsub();
        assert.ok(data.includes('out:'));
        resolve();
      });
      writeToPty('echo test\r');
    });
  });

  it('onPtyExit fires when PTY exits', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    await new Promise((resolve) => {
      const unsub = onPtyExit((exitCode) => {
        unsub();
        assert.equal(exitCode, 0);
        resolve();
      });
      killPty();
    });
  });

  it('getOutputBuffer accumulates PTY output', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    writeToPty('echo test\r');
    await new Promise(r => setTimeout(r, 0));
    const buf = getOutputBuffer();
    assert.ok(buf.includes('out:'));
  });

  it('resizePty does not throw while running', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    assert.doesNotThrow(() => resizePty(80, 24));
  });

  it('spawnClaude kills existing PTY before spawning new one', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    const first = spawned[0];
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    assert.equal(first._isKilled(), true);
    assert.equal(spawned.length, 2);
  });

  it('spawnClaude strips inherited CLAUDE_CODE_NO_FLICKER by default', async () => {
    const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER;
    const prevKeep = process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    delete process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
    try {
      await spawnClaude(9999, process.cwd(), [], '/bin/echo');
      assert.equal(spawned[0].opts.env.CLAUDE_CODE_NO_FLICKER, undefined);
    } finally {
      if (prevNoFlicker === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER;
      else process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker;
      if (prevKeep === undefined) delete process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
      else process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER = prevKeep;
    }
  });

  it('spawnClaude preserves CLAUDE_CODE_NO_FLICKER with explicit cc-viewer opt-in', async () => {
    const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER;
    const prevKeep = process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER = '1';
    try {
      await spawnClaude(9999, process.cwd(), [], '/bin/echo');
      assert.equal(spawned[0].opts.env.CLAUDE_CODE_NO_FLICKER, '1');
    } finally {
      if (prevNoFlicker === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER;
      else process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker;
      if (prevKeep === undefined) delete process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
      else process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER = prevKeep;
    }
  });

  // 轮询等条件满足；替代固定 setTimeout 在慢 CI 上的 flake
  const waitUntil = async (predicate, { timeoutMs = 500, intervalMs = 5 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`waitUntil timeout after ${timeoutMs}ms`);
  };

  // 构造一个 mock pty：第一次 spawn 吐 errorText 并按 exitPayload 退出（默认 exit 1 无 signal），后续正常
  const makeMockPtyOnceCrash = (errorText, exitPayload = { exitCode: 1 }) => () => ({
    spawn(command, args, opts) {
      const dataHandlers = [];
      const exitHandlers = [];
      const idx = spawned.length;
      const inst = {
        pid: 1000 + idx, command, args, opts,
        write() {}, resize() {}, kill() {},
        onData(cb) { dataHandlers.push(cb); },
        onExit(cb) { exitHandlers.push(cb); },
      };
      spawned.push(inst);
      if (idx === 0) {
        queueMicrotask(() => {
          for (const cb of dataHandlers) cb(errorText);
          for (const cb of exitHandlers) cb(exitPayload);
        });
      }
      return inst;
    },
  });

  it('retries without --thinking-display when claude crashes with unknown option (single quotes)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeMockPtyOnceCrash("error: unknown option '--thinking-display'\n"));

    const origError = console.error;
    console.error = () => {};

    await spawnClaude(9999, process.cwd(), [], '/bin/fake-claude');
    await waitUntil(() => spawned.length >= 2);

    console.error = origError;

    assert.equal(spawned.length, 2, 'should have spawned twice (initial + retry)');
    assert.ok(spawned[0].args.includes('--thinking-display'), 'first spawn has flag');
    assert.ok(!spawned[1].args.includes('--thinking-display'), 'retry spawn strips flag');
    assert.equal(_isThinkingDisplayRejected('/bin/fake-claude'), true, 'path marked as rejecting the flag');
  });

  it('retries also on double-quoted error variant', async () => {
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeMockPtyOnceCrash('error: unknown option "--thinking-display"\n'));

    const origError = console.error;
    console.error = () => {};

    await spawnClaude(9999, process.cwd(), [], '/bin/fake-claude-dq');
    await waitUntil(() => spawned.length >= 2);

    console.error = origError;

    assert.equal(spawned.length, 2);
    assert.ok(!spawned[1].args.includes('--thinking-display'));
    assert.equal(_isThinkingDisplayRejected('/bin/fake-claude-dq'), true);
  });

  it('does not retry if crash is unrelated to --thinking-display', async () => {
    _clearThinkingDisplayRejectedPaths();

    let spawnCount = 0;
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const exitHandlers = [];
        const inst = {
          pid: 200 + spawnCount,
          command, args, opts,
          write() {}, resize() {}, kill() {},
          onData() {},
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        if (spawnCount === 0) {
          // 非 flag 相关的崩溃，不应触发 retry
          queueMicrotask(() => {
            for (const cb of exitHandlers) cb({ exitCode: 2 });
          });
        }
        spawnCount++;
        return inst;
      },
    }));

    await spawnClaude(9999, process.cwd(), [], '/bin/fake-claude-2');
    // 等待异步 exit 处理完——用短轮询确认 spawned 计数稳定
    await waitUntil(() => spawned[0] != null);
    await new Promise(r => setTimeout(r, 30)); // 短暂额外等待确保不会有第二次 spawn

    assert.equal(spawned.length, 1, 'should NOT retry for unrelated crash');
    assert.equal(_isThinkingDisplayRejected('/bin/fake-claude-2'), false, 'non-flag crash does not touch rejected set');
  });

  it('skips injection when CCV_SKIP_THINKING_DISPLAY=1', async () => {
    _clearThinkingDisplayRejectedPaths();
    const prev = process.env.CCV_SKIP_THINKING_DISPLAY;
    process.env.CCV_SKIP_THINKING_DISPLAY = '1';

    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 500, command, args, opts,
          write() {}, resize() {}, kill() {},
          onData() {}, onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));

    try {
      await spawnClaude(9999, process.cwd(), [], '/bin/fake-claude-env');
      assert.equal(spawned.length, 1);
      assert.ok(!spawned[0].args.includes('--thinking-display'),
        'env var short-circuits injection');
    } finally {
      if (prev === undefined) delete process.env.CCV_SKIP_THINKING_DISPLAY;
      else process.env.CCV_SKIP_THINKING_DISPLAY = prev;
    }
  });

  it('skips injection when claudePath is in rejected set (no crash+retry loop)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _markThinkingDisplayRejected('/bin/fake-claude-pre-rejected');

    let spawnCount = 0;
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const exitHandlers = [];
        const inst = {
          pid: 400 + spawnCount,
          command, args, opts,
          write() {}, resize() {}, kill() {},
          onData() {},
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        spawnCount++;
        return inst;
      },
    }));

    await spawnClaude(9999, process.cwd(), [], '/bin/fake-claude-pre-rejected');
    assert.equal(spawned.length, 1, 'single spawn, no crash loop');
    assert.ok(!spawned[0].args.includes('--thinking-display'), 'flag skipped because path was pre-rejected');
  });

  it('does not retry when user explicitly passed --thinking-display themselves', async () => {
    _clearThinkingDisplayRejectedPaths();

    let spawnCount = 0;
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const dataHandlers = [];
        const exitHandlers = [];
        const inst = {
          pid: 300 + spawnCount,
          command, args, opts,
          write() {}, resize() {}, kill() {},
          onData(cb) { dataHandlers.push(cb); },
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        if (spawnCount === 0) {
          queueMicrotask(() => {
            for (const cb of dataHandlers) cb("error: unknown option '--thinking-display'\n");
            for (const cb of exitHandlers) cb({ exitCode: 1 });
          });
        }
        spawnCount++;
        return inst;
      },
    }));

    // 用户显式传了 flag：即使崩溃也不是「我们注入」的锅，不自动改用户意图
    await spawnClaude(9999, process.cwd(), ['--thinking-display', 'off'], '/bin/fake-claude-3');
    await waitUntil(() => spawned[0] != null);
    await new Promise(r => setTimeout(r, 30)); // 短暂额外等待确保不会有第二次 spawn

    assert.equal(spawned.length, 1, 'user-provided flag → no auto-retry');
  });

  // ─── system-prompt-file (CC_SYSTEM.md / CC_APPEND_SYSTEM.md) 自愈，镜像 --thinking-display ───
  it('retries without --system-prompt-file when claude rejects it (CC_SYSTEM.md present)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-sysfile-'));
    writeFileSync(join(dir, 'CC_SYSTEM.md'), 'OVERRIDE PROMPT', 'utf-8');
    _setPtyImportForTests(makeMockPtyOnceCrash("error: unknown option '--system-prompt-file'\n"));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-sysfile');
      await waitUntil(() => spawned.length >= 2);
    } finally {
      console.error = origError;
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 2, 'initial + retry');
    assert.ok(spawned[0].args.includes('--system-prompt-file'), 'first spawn injects the flag');
    assert.ok(!spawned[1].args.includes('--system-prompt-file'), 'retry strips the flag');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-sysfile'), true, 'path marked as rejecting');
  });

  it('retries on --append-system-prompt-file rejection (double-quoted, CC_APPEND_SYSTEM.md present)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-appendfile-'));
    writeFileSync(join(dir, 'CC_APPEND_SYSTEM.md'), 'APPEND PROMPT', 'utf-8');
    _setPtyImportForTests(makeMockPtyOnceCrash('error: unknown option "--append-system-prompt-file"\n'));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-appendfile');
      await waitUntil(() => spawned.length >= 2);
    } finally {
      console.error = origError;
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 2);
    assert.ok(spawned[0].args.includes('--append-system-prompt-file'), 'first spawn injects append flag');
    assert.ok(!spawned[1].args.includes('--append-system-prompt-file'), 'retry strips append flag');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-appendfile'), true);
  });

  // ─── 启动兜底（分级）：注入过 system prompt 的引导期死亡 ───
  // 一级放宽：exit≠0 引导窗口内非信号死亡 → 即使不是 unknown option 也去注入重试一次
  //（旧语义「unrelated crash 不重试」被有意替换——注入可能就是拖崩启动的原因）。
  it('boot fallback tier-1: unrelated quick crash with injection → ONE retry without injection, later spawns inject again', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-boot-t1-'));
    const sysFile = join(dir, 'CC_SYSTEM.md');
    writeFileSync(sysFile, 'OVERRIDE PROMPT', 'utf-8');
    _setPtyImportForTests(makeMockPtyOnceCrash('error: some other failure\n'));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-boot-t1');
      await waitUntil(() => spawned.length >= 2);

      assert.equal(spawned.length, 2, 'quick non-signal crash with injection retries once');
      assert.ok(spawned[0].args.includes(sysFile), 'first spawn injected');
      assert.ok(!spawned[1].args.some(a => String(a).includes('CC_SYSTEM.md')), 'retry spawn strips injection');
      // review P1：放宽半支绝不写永久拒绝集——瞬态崩溃不能永久禁用注入
      assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-boot-t1'), false,
        'transient boot crash must NOT permanently mark the path');
      // 一次性令牌已被重试消费：后续 spawn 恢复注入尝试(mock 只在 idx 0 崩溃)
      await spawnClaude(9999, dir, [], '/bin/fake-claude-boot-t1');
      await waitUntil(() => spawned.length >= 3);
      assert.ok(spawned[2].args.includes(sysFile), 'subsequent spawn injects again (one-shot token consumed)');
    } finally {
      console.error = origError;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('boot fallback tier-1: exact "unknown option" half still marks the path PERMANENTLY (capability signal)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    // IM worker（cwd 在 LOG_DIR 内）+ 精确 unknown-option → 仍自愈重试且写永久集——
    // 精确半支不受 insideLogDir 门控（否则 IM worker 在不支持该 flag 的 claude 上永远起不来）。
    const imDir = join(LOG_DIR, 'IM_unknown-option');
    const personaFile = join(imDir, 'CC_APPEND_SYSTEM.md');
    _setPtyImportForTests(makeMockPtyOnceCrash("error: unknown option '--append-system-prompt-file'\n"));

    const origError = console.error;
    console.error = () => {};
    try {
      mkdirSync(imDir, { recursive: true });
      writeFileSync(personaFile, 'IM PERSONA', 'utf-8');
      await spawnClaude(9999, imDir, [], '/bin/fake-claude-im-unknown');
      await waitUntil(() => spawned.length >= 2);
      assert.ok(spawned[0].args.includes(personaFile), 'first spawn injected the persona');
      assert.ok(!spawned[1].args.includes(personaFile), 'retry strips the unsupported flag injection');
      assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-im-unknown'), true,
        'unknown-option is a stable capability signal → permanent set');
    } finally {
      console.error = origError;
      rmSync(imDir, { recursive: true, force: true });
    }
  });

  it('boot fallback tier-1: signal-terminated quick death → NO retry (user Ctrl-C / kill)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-boot-sig-'));
    writeFileSync(join(dir, 'CC_SYSTEM.md'), 'OVERRIDE PROMPT', 'utf-8');
    _setPtyImportForTests(makeMockPtyOnceCrash('', { exitCode: 130, signal: 2 })); // SIGINT

    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-boot-sig');
      await waitUntil(() => spawned[0] != null);
      await new Promise(r => setTimeout(r, 30)); // 确认没有第二次 spawn
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 1, 'signal termination must not trigger the boot fallback');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-boot-sig'), false);
  });

  it('boot fallback tier-1: crash AFTER the boot window → NO retry (relaxed half only covers boot)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-boot-late-'));
    writeFileSync(join(dir, 'CC_SYSTEM.md'), 'OVERRIDE PROMPT', 'utf-8');
    _setPtyImportForTests(makeMockPtyOnceCrash('error: some other failure\n'));
    // 拨表：spawn 取 t=0，onExit 的窗口判定取 t=6000（> 5s 窗口）→ 放宽半支不触发
    let t = 0;
    _setNowForTests(() => { const v = t; t += 6000; return v; });

    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-boot-late');
      await waitUntil(() => spawned[0] != null);
      await new Promise(r => setTimeout(r, 30));
    } finally {
      _setNowForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 1, "post-boot crash is not the injection fallback's business");
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-boot-late'), false);
  });

  it('boot fallback tier-2: quick exit 0 with injection → no retry, no reject, diagnostic notice + normal exit broadcast', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-boot-t2-'));
    writeFileSync(join(dir, 'CC_SYSTEM.md'), 'OVERRIDE PROMPT', 'utf-8');
    _setPtyImportForTests(makeMockPtyOnceCrash('', { exitCode: 0 }));
    const exits = [];
    const removeExit = onPtyExit((code) => exits.push(code));

    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-boot-t2');
      await waitUntil(() => exits.length >= 1);
      await new Promise(r => setTimeout(r, 30));
    } finally {
      removeExit();
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 1, 'exit 0 never auto-restarts (indistinguishable from a fast user /exit)');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-boot-t2'), false, 'no auto-disable of injection');
    assert.deepEqual(exits, [0], 'exit broadcast reaches listeners as usual');
    assert.match(getOutputBuffer(), /injected system prompt/, 'diagnostic notice lands in the terminal buffer');
  });

  it('boot fallback: quick crash WITHOUT injection → completely untouched', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-boot-noinj-'));
    _setPtyImportForTests(makeMockPtyOnceCrash('error: some other failure\n'));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-boot-noinj');
      await waitUntil(() => spawned[0] != null);
      await new Promise(r => setTimeout(r, 30));
    } finally {
      console.error = origError;
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 1, 'no injection → boot fallback never fires');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-boot-noinj'), false);
  });

  it('boot fallback: IM worker (cwd inside LOG_DIR) quick crash → NO de-injection retry (persona protected)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const imDir = join(LOG_DIR, 'IM_boot-fallback');
    const personaFile = join(imDir, 'CC_APPEND_SYSTEM.md');
    _setPtyImportForTests(makeMockPtyOnceCrash('error: some other failure\n'));

    try {
      mkdirSync(imDir, { recursive: true });
      writeFileSync(personaFile, 'IM PERSONA', 'utf-8');
      await spawnClaude(9999, imDir, [], '/bin/fake-claude-boot-im');
      await waitUntil(() => spawned[0] != null);
      await new Promise(r => setTimeout(r, 30));
      assert.ok(spawned[0].args.includes(personaFile), 'persona injected on first spawn');
      assert.equal(spawned.length, 1, 'IM worker must not be de-persona-restarted by the relaxed half');
      assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-boot-im'), false);
    } finally {
      rmSync(imDir, { recursive: true, force: true });
    }
  });

  // ─── 模型定制 system prompt(<dir>/system_prompt/)注入与自愈 ───
  it('model-specific prompt supersedes CC_SYSTEM.md when the spawn model matches', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-modelprompt-'));
    writeFileSync(join(dir, 'CC_SYSTEM.md'), 'DEFAULT PROMPT', 'utf-8');
    mkdirSync(join(dir, 'system_prompt'));
    const modelFile = join(dir, 'system_prompt', 'OPUS_SYSTEM.md');
    writeFileSync(modelFile, 'OPUS PROMPT', 'utf-8');
    _setSpawnModelReaderForTests(() => 'claude-opus-4-8[1m]');

    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-modelmatch');
      assert.ok(spawned[0].args.includes(modelFile), 'model file injected');
      assert.ok(!spawned[0].args.includes(join(dir, 'CC_SYSTEM.md')), 'default sentinel superseded');
      assert.ok(getOutputBuffer().includes('(model match: OPUS)'), 'spawn notice carries the model suffix');
    } finally {
      _setSpawnModelReaderForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('_defaultSpawnModelReader: NODE_TEST_CONTEXT 短路为 null,生产环境透传底层 reader', () => {
    // 直接断言 guard 本身(参数化 env/reader,不触真实 ~/.claude.json)：
    // 若有人删掉 NODE_TEST_CONTEXT 守卫,第一条立即失败。
    assert.equal(_defaultSpawnModelReader('/x', { NODE_TEST_CONTEXT: '1' }, () => 'claude-opus-4-8'), null);
    assert.equal(_defaultSpawnModelReader('/x', {}, () => 'claude-opus-4-8'), 'claude-opus-4-8');
    // opts(含 launchSettings)必须原样透传给底层 reader —— 否则 --settings 里的模型信号到不了 resolver
    assert.equal(
      _defaultSpawnModelReader('/x', {}, (c, env, opts) => opts?.launchSettings?.env?.ANTHROPIC_MODEL, { launchSettings: { env: { ANTHROPIC_MODEL: 'm-launch' } } }),
      'm-launch',
    );
  });

  it('default spawn model reader is inert under NODE_TEST_CONTEXT (no injected reader → no model match)', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-modelinert-'));
    mkdirSync(join(dir, 'system_prompt'));
    const modelFile = join(dir, 'system_prompt', 'OPUS_SYSTEM.md');
    writeFileSync(modelFile, 'OPUS PROMPT', 'utf-8');
    // 不注入 reader：默认读取器在 NODE_TEST_CONTEXT 下必须返回 null → 条目不注入
    _setSpawnModelReaderForTests(null);

    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-modelinert');
      assert.ok(!spawned[0].args.includes(modelFile), 'model file must not be injected under tests by default');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('spawns with cwd inside LOG_DIR (IM worker) skip model matching; IM persona sentinel still injects', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    // 全局模型条目 + LOG_DIR 下的 IM worker 目录(带人格 CC_APPEND_SYSTEM.md)
    // 写盘 setup 放 try 内：setup 中途抛错也能走 finally 清理,不泄漏到同进程后续测试。
    const globalDir = join(LOG_DIR, 'system_prompt');
    const globalFile = join(globalDir, 'OPUS_SYSTEM.md');
    const imDir = join(LOG_DIR, 'IM_test-worker');
    const personaFile = join(imDir, 'CC_APPEND_SYSTEM.md');
    _setSpawnModelReaderForTests(() => 'claude-opus-4-8');

    try {
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(globalFile, 'GLOBAL OPUS PROMPT', 'utf-8');
      mkdirSync(imDir, { recursive: true });
      writeFileSync(personaFile, 'IM PERSONA', 'utf-8');
      await spawnClaude(9999, imDir, [], '/bin/fake-claude-imworker');
      assert.ok(!spawned[0].args.includes(globalFile), 'global model entry must not supersede the IM persona');
      assert.ok(spawned[0].args.includes(personaFile), 'IM persona sentinel still injected');
    } finally {
      _setSpawnModelReaderForTests(null);
      rmSync(globalDir, { recursive: true, force: true });
      rmSync(imDir, { recursive: true, force: true });
    }
  });

  it('self-heal also strips a rejected model-specific --system-prompt-file', async () => {
    _clearThinkingDisplayRejectedPaths();
    _clearSystemPromptFileRejectedPaths();
    const dir = mkdtempSync(join(tmpdir(), 'ccv-pty-modelheal-'));
    mkdirSync(join(dir, 'system_prompt'));
    const modelFile = join(dir, 'system_prompt', 'OPUS_SYSTEM.md');
    writeFileSync(modelFile, 'OPUS PROMPT', 'utf-8');
    _setSpawnModelReaderForTests(() => 'claude-opus-4-8');
    _setPtyImportForTests(makeMockPtyOnceCrash("error: unknown option '--system-prompt-file'\n"));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9999, dir, [], '/bin/fake-claude-modelheal');
      await waitUntil(() => spawned.length >= 2);
    } finally {
      console.error = origError;
      _setSpawnModelReaderForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(spawned.length, 2, 'initial + retry');
    assert.ok(spawned[0].args.includes(modelFile), 'first spawn injects the model file');
    assert.ok(!spawned[1].args.includes('--system-prompt-file'), 'retry strips the flag');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-modelheal'), true);
  });
});

// ─── writeToPtySequential delay rules ───

describe('pty-manager: writeToPtySequential delay rules', () => {
  let writeTimestamps = [];
  let spawned = [];

  beforeEach(() => {
    writeTimestamps = [];
    spawned = [];
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 22000 + spawned.length,
          command,
          args,
          opts,
          write(data) {
            writeTimestamps.push({ data, t: Date.now() });
          },
          resize() {},
          kill() {},
          onData() {},
          onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
    _setSpawnModelReaderForTests(null);
  });

  // 工具栏快捷按钮路径：[paste-end-chunk, '\r'] 写入 paste 块后必须等 settleMs
  // 给 Ink TUI 完成 bracket-paste 状态切换，再写 \r 才能可靠触发提交。
  it('paste-end chunk waits settleMs (not 80ms) before next chunk', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    writeTimestamps = []; // 清掉 spawn 注入的初始 write
    await new Promise((resolve) => {
      writeToPtySequential(
        ['\x1b[200~/clear\x1b[201~', '\r'],
        resolve,
        { settleMs: 250 }
      );
    });
    assert.equal(writeTimestamps.length, 2, 'two writes expected');
    const gap = writeTimestamps[1].t - writeTimestamps[0].t;
    assert.ok(gap >= 200, `expected paste-end → \\r gap >=200ms, got ${gap}ms`);
    assert.ok(gap < 500, `expected paste-end → \\r gap <500ms, got ${gap}ms`);
  });

  // inquirer 路径回归：普通字符 chunk（非 paste-end / 非 toggle）仍走硬编码 80ms，
  // 不被新加的 isPasteEnd 分支误命中。
  it('regular char chunk still waits ~80ms (not settleMs)', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    writeTimestamps = [];
    await new Promise((resolve) => {
      writeToPtySequential(
        ['a', 'b'],
        resolve,
        { settleMs: 500 } // 故意拉大 settleMs，验证普通 chunk 不受影响
      );
    });
    assert.equal(writeTimestamps.length, 2);
    const gap = writeTimestamps[1].t - writeTimestamps[0].t;
    assert.ok(gap >= 50, `expected regular char gap >=50ms, got ${gap}ms`);
    assert.ok(gap < 300, `expected regular char gap <300ms (not settleMs:500), got ${gap}ms`);
  });
});

// ─── resize 钳制 + 非字符串 chunk 容错 + spawn 在途闸 ───

describe('pty-manager: resize clamp / chunk validation / spawn guard', () => {
  let spawned;
  let resizeCalls;

  beforeEach(() => {
    spawned = [];
    resizeCalls = [];
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 23000 + spawned.length,
          command, args, opts,
          _killed: false,
          write() {},
          resize(c, r) { resizeCalls.push([c, r]); },
          kill() { this._killed = true; },
          onData() {},
          onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
    _setSpawnModelReaderForTests(null);
  });

  it('resizePty clamps NaN/0/negative/oversize to finite positive bounds', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    resizeCalls = [];
    resizePty(NaN, NaN);     // 非有限 → 回退到上一个有效值（spawn 用的 120×30）
    resizePty(0, 0);         // 0 → 下界 2×1
    resizePty(-5, -9);       // 负 → 下界
    resizePty(99999, 99999); // 超大 → 上界 1000
    resizePty(120, 40);      // 正常透传
    for (const [c, r] of resizeCalls) {
      assert.ok(Number.isFinite(c) && c >= 2 && c <= 1000, `cols clamped: ${c}`);
      assert.ok(Number.isFinite(r) && r >= 1 && r <= 1000, `rows clamped: ${r}`);
    }
    assert.deepEqual(resizeCalls[resizeCalls.length - 1], [120, 40], 'valid dims pass through');
  });

  it('writeToPtySequential with non-string chunk does not crash, reports failure', async () => {
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    // 第 2 个是数字：sendNext 的非字符串守卫拦成失败上报，不冒泡成 uncaughtException
    // （真实 pty.write 会抛 ERR_INVALID_ARG_TYPE，chunk.endsWith 也会抛）。
    const ok = await new Promise((resolve) => {
      writeToPtySequential(['a', 123, 'c'], resolve, { settleMs: 10 });
    });
    assert.equal(ok, false, 'non-string chunk reports failure, not crash');
  });

  it('writeToPtySequential survives a throwing write (cleanup + onComplete(false))', async () => {
    // 用一个第 2 次 write 抛错的 pty，验证 sendNext 的 try/catch 兜住、不冒泡成 uncaught
    let writeCount = 0;
    _setPtyImportForTests(() => ({
      spawn() {
        return {
          pid: 24000,
          write() { if (++writeCount === 2) throw new Error('ERR_INVALID_ARG_TYPE'); },
          resize() {}, kill() {}, onData() {}, onExit() {},
        };
      },
    }));
    await spawnClaude(9999, process.cwd(), [], '/bin/echo');
    const ok = await new Promise((resolve) => {
      writeToPtySequential(['a', 'b', 'c'], resolve, { settleMs: 10 });
    });
    assert.equal(ok, false, 'throwing mid-sequence reports failure, not crash');
  });

  it('concurrent spawnShell calls spawn exactly one shell (in-flight guard)', async () => {
    // PTY 未运行态下两条同步到达的 input → 两次 spawnShell。无闸会双开（spawned.length===2）。
    const [a, b] = await Promise.all([spawnShell(), spawnShell()]);
    assert.equal(spawned.length, 1, 'only one shell spawned despite concurrent calls');
    // 复用同一在途 promise：两个返回值一致
    assert.equal(a, b);
  });

  it('3 concurrent spawnClaude calls never double-open (while-gate, ≥3 并发)', async () => {
    // spawnClaude 是 kill+respawn 语义：串行化下每次 spawn 前先 kill 上一个，全程至多一个存活。
    // 闸用 `if` 而非 `while` 时：A 完成后 B/C 都已过 if 检查 → implB/implC 并发双开，
    // 出现两个同时存活的 PTY。这里在每次 spawn 时断言此前所有实例都已 _killed。
    let maxLiveAtSpawn = 0;
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const liveBefore = spawned.filter((s) => !s._killed).length;
        if (liveBefore > maxLiveAtSpawn) maxLiveAtSpawn = liveBefore;
        const inst = {
          pid: 25000 + spawned.length,
          command, args, opts, _killed: false,
          write() {}, resize() {}, kill() { this._killed = true; }, onData() {}, onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));
    await Promise.all([
      spawnClaude(9999, process.cwd(), [], '/bin/echo'),
      spawnClaude(9999, process.cwd(), [], '/bin/echo'),
      spawnClaude(9999, process.cwd(), [], '/bin/echo'),
    ]);
    assert.equal(maxLiveAtSpawn, 0, 'no live PTY existed when a new impl spawned (no overlap)');
    const live = spawned.filter((s) => !s._killed).length;
    assert.equal(live, 1, 'exactly one PTY survives after serialized kill+respawn');
  });
});

// ─── output buffer truncation ───

describe('pty-manager: output buffer limits', () => {
  it('getOutputBuffer returns string', () => {
    const buf = getOutputBuffer();
    assert.equal(typeof buf, 'string');
  });

  // Note: Testing MAX_BUFFER truncation requires spawning PTY and generating >200KB output,
  // which is impractical for unit tests. This is better suited for integration tests.
});

// ─── withDefaultThinkingDisplay ───

describe('pty-manager: withDefaultThinkingDisplay', () => {
  it('appends --thinking-display summarized when flag is absent', () => {
    const out = withDefaultThinkingDisplay([]);
    assert.deepEqual(out, ['--thinking-display', 'summarized']);
  });

  it('appends at the END so existing args come first', () => {
    const out = withDefaultThinkingDisplay(['-p', 'hello']);
    assert.deepEqual(out, ['-p', 'hello', '--thinking-display', 'summarized']);
  });

  it('leaves args unchanged when user passed --thinking-display in space form', () => {
    const input = ['--thinking-display', 'off', '-p', 'x'];
    const out = withDefaultThinkingDisplay(input);
    assert.deepEqual(out, input);
    assert.equal(out, input, 'should return same reference to signal no-op');
  });

  it('leaves args unchanged when user passed --thinking-display in equals form', () => {
    const input = ['--thinking-display=full', '-p', 'x'];
    const out = withDefaultThinkingDisplay(input);
    assert.deepEqual(out, input);
    assert.equal(out, input);
  });

  it('does not mutate input array when appending', () => {
    const input = ['-p', 'hello'];
    const before = [...input];
    withDefaultThinkingDisplay(input);
    assert.deepEqual(input, before, 'input array must not be mutated');
  });

  it('returns non-array input unchanged (defensive)', () => {
    assert.equal(withDefaultThinkingDisplay(null), null);
    assert.equal(withDefaultThinkingDisplay(undefined), undefined);
  });

  it('detects the flag even mid-array (not just at start)', () => {
    const input = ['-p', 'hello', '--thinking-display', 'summarized'];
    const out = withDefaultThinkingDisplay(input);
    assert.equal(out, input, 'existing flag mid-array should suppress append');
    // And no duplicate flag appended
    const count = out.filter(a => a === '--thinking-display').length;
    assert.equal(count, 1);
  });
});

// ─── -c/-r resume-launch system-prompt pinning (system-prompt-snapshots.js) ─────
// A resume launch must pin the resumed conversation's original injection verbatim
// (never re-render variables → the prompt-prefix KV cache survives); an identified
// target with no snapshot record → inject nothing (F2); an unidentifiable target →
// the normal build/render pipeline.
describe('pty-manager: -c/-r system-prompt pinning', () => {
  const UUID_A = 'aaaa1111-89ab-4cde-8f01-23456789abcd';
  const UUID_B = 'bbbb2222-89ab-4cde-8f01-23456789abcd';
  const PINNED_CONTENT = 'PINNED-RENDER git-status-at-launch α';
  const PINNED_WITH_PLACEHOLDER = 'rendered once: ${os.platform} stays literal';
  let spawned = [];
  let dir;
  let fakeProjects;
  let snaps;
  let LOG_DIR_RESOLVED;

  const storeDir = () => {
    const key = dir.replace(/\/$/, '').split('/').pop().replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    return join(LOG_DIR_RESOLVED, key, 'system-prompt-snapshots');
  };
  const pendingFile = () => join(storeDir(), 'pending.json');
  const readPendings = () => JSON.parse(readFileSync(pendingFile(), 'utf-8')).pendings;
  const makeTranscript = (uuid, mtimeMs) => {
    const tDir = join(fakeProjects, dir.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(tDir, { recursive: true });
    const f = join(tDir, `${uuid}.jsonl`);
    writeFileSync(f, '{"type":"summary"}\n{"type":"user","message":{}}\n');
    const d = new Date(mtimeMs);
    utimesSync(f, d, d);
  };
  const sysFileArg = (inst, flag) => {
    const i = inst.args.indexOf(flag);
    return i === -1 ? null : inst.args[i + 1];
  };
  // Local copies of the outer describe's helpers (const-scoped there, not visible here).
  const waitUntil = async (predicate, { timeoutMs = 800, intervalMs = 5 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { if (predicate()) return; } catch { }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`waitUntil timeout after ${timeoutMs}ms`);
  };
  // Mock pty whose FIRST spawn emits errorText and exits 1 (no signal); later spawns idle.
  const makeMockPtyOnceCrash = (errorText) => () => ({
    spawn(command, args, opts) {
      const dataHandlers = [];
      const exitHandlers = [];
      const idx = spawned.length;
      const inst = {
        pid: 92000 + idx, command, args, opts,
        write() {}, resize() {}, kill() {},
        onData(cb) { dataHandlers.push(cb); },
        onExit(cb) { exitHandlers.push(cb); },
      };
      spawned.push(inst);
      if (idx === 0) {
        queueMicrotask(() => {
          for (const cb of dataHandlers) cb(errorText);
          for (const cb of exitHandlers) cb({ exitCode: 1 });
        });
      }
      return inst;
    },
  });

  beforeEach(async () => {
    spawned = [];
    dir = mkdtempSync(join(tmpdir(), 'ccv-pty-pin-'));
    fakeProjects = mkdtempSync(join(tmpdir(), 'ccv-pty-pin-proj-'));
    process.env.CCV_PROJECTS_DIR = fakeProjects;
    snaps = await import('../server/lib/system-prompt-snapshots.js');
    ({ LOG_DIR: LOG_DIR_RESOLVED } = await import('../findcc.js'));
    rmSync(storeDir(), { recursive: true, force: true });
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 91000 + spawned.length, command, args, opts,
          write() {}, resize() {}, kill() {}, onData() {}, onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
    delete process.env.CCV_PROJECTS_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeProjects, { recursive: true, force: true });
    delete process.env.CCV_DISABLE_AUTO_SYSTEM_PROMPT;
  });

  it('-r <uuid> with a snapshot pins the recorded content verbatim (source file ignored, NO re-render)', async () => {
    // The live workspace file must NOT matter on the pinned path — different content,
    // plus a template variable that would re-render to something else if it ran.
    writeFileSync(join(dir, 'CC_APPEND_SYSTEM.md'), 'LIVE-FILE ${os.platform}', 'utf-8');
    makeTranscript(UUID_A, Date.now()); // gc protection: record whose transcript exists survives appendPending
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_WITH_PLACEHOLDER }],
      model: 'k3',
    });

    await spawnClaude(9999, dir, ['-r', UUID_A], '/bin/fake-claude-pin');

    const pinnedPath = sysFileArg(spawned[0], '--append-system-prompt-file');
    assert.ok(pinnedPath, 'pinned append flag present');
    assert.ok(pinnedPath.includes('cc-viewer-rendered-prompts'), 'injected from the pinned-temp dir');
    assert.equal(readFileSync(pinnedPath, 'utf-8'), PINNED_WITH_PLACEHOLDER,
      'byte-identical to the snapshot — the literal ${os.platform} proves no re-render ran');
    const pendings = readPendings();
    assert.equal(pendings.length, 1);
    assert.equal(pendings[0].resumeExpected, true);
    assert.equal(pendings[0].resolvedUuid, UUID_A);
    assert.deepEqual(pendings[0].entries.map(e => e.content), [PINNED_WITH_PLACEHOLDER]);
    assert.ok(getOutputBuffer().includes('Resumed session'), 'pinned notice (not the fresh "loaded" one)');
  });

  it('--resume=<uuid> (equals form) pins the snapshot too', async () => {
    makeTranscript(UUID_A, Date.now());
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT }],
    });

    await spawnClaude(9999, dir, [`--resume=${UUID_A}`], '/bin/fake-claude-pin-eq');

    const pinnedPath = sysFileArg(spawned[0], '--append-system-prompt-file');
    assert.ok(pinnedPath, 'equals-form resume resolves the snapshot');
    assert.equal(readFileSync(pinnedPath, 'utf-8'), PINNED_CONTENT);
    assert.equal(readPendings()[0].resolvedUuid, UUID_A);
  });

  it('-c resolves the newest MAIN transcript and pins its snapshot (sidechain/teammate ignored)', async () => {
    makeTranscript(UUID_A, Date.now() - 60_000);
    makeTranscript(UUID_B, Date.now());
    snaps.writeSnapshot(dir, UUID_B, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT }],
    });
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: 'OLDER-CONTENT' }],
    });

    await spawnClaude(9999, dir, ['-c'], '/bin/fake-claude-pin-c');

    const pinnedPath = sysFileArg(spawned[0], '--append-system-prompt-file');
    assert.ok(pinnedPath, 'pinned append flag present');
    assert.equal(readFileSync(pinnedPath, 'utf-8'), PINNED_CONTENT, 'the NEWEST transcript\'s snapshot wins');
    assert.equal(readPendings()[0].resolvedUuid, UUID_B);
  });

  it('-r <uuid> without a snapshot → F2: no injection at all (even with live sentinel files), notice shown, NO pending', async () => {
    writeFileSync(join(dir, 'CC_APPEND_SYSTEM.md'), 'LIVE-FILE ${os.platform}', 'utf-8');
    makeTranscript(UUID_A, Date.now());

    await spawnClaude(9999, dir, ['-r', UUID_A], '/bin/fake-claude-pin-f2');

    assert.equal(sysFileArg(spawned[0], '--append-system-prompt-file'), null, 'no append injection');
    assert.equal(sysFileArg(spawned[0], '--system-prompt-file'), null, 'no override injection');
    assert.equal(existsSync(pendingFile()), false, 'F2 queues nothing (empty pendings never persist)');
    assert.match(getOutputBuffer(), /systemPromptResumeNoSnapshot|No recorded system prompt/);
  });

  it('F2 notice is suppressed when no injection is configured at all (feature-less users stay quiet)', async () => {
    makeTranscript(UUID_A, Date.now());
    // No CC_APPEND_SYSTEM.md / CC_SYSTEM.md / system_prompt dirs in dir.

    await spawnClaude(9999, dir, ['-r', UUID_A], '/bin/fake-claude-pin-f2q');

    assert.equal(sysFileArg(spawned[0], '--append-system-prompt-file'), null);
    assert.ok(!getOutputBuffer().includes('systemPromptResumeNoSnapshot')
      && !getOutputBuffer().includes('No recorded system prompt'), 'no F2 noise for feature-less resumes');
  });

  it('-c with no transcripts at all → fresh pipeline (injection proceeds, no resume pending)', async () => {
    writeFileSync(join(dir, 'CC_APPEND_SYSTEM.md'), 'STATIC-CONTENT', 'utf-8');

    await spawnClaude(9999, dir, ['-c'], '/bin/fake-claude-pin-fresh');

    const injected = sysFileArg(spawned[0], '--append-system-prompt-file');
    assert.ok(injected, 'fresh injection proceeds');
    assert.equal(readFileSync(injected, 'utf-8'), 'STATIC-CONTENT');
    assert.equal(existsSync(pendingFile()), false, 'a doomed -c leaves no resume pending (the no-conversation retry respawns fresh)');
  });

  it('bare -r (interactive picker) → normal pipeline, and NO identity-less pending is queued', async () => {
    writeFileSync(join(dir, 'CC_APPEND_SYSTEM.md'), 'STATIC-CONTENT', 'utf-8');

    await spawnClaude(9999, dir, ['-r'], '/bin/fake-claude-pin-picker');

    const injected = sysFileArg(spawned[0], '--append-system-prompt-file');
    assert.ok(injected, 'picker launches keep the fresh pipeline (target unknowable at spawn)');
    assert.equal(existsSync(pendingFile()), false,
      'no identity-less pending — a stolen hook could bind it to an innocent conversation');
  });

  it('manual same-flag args suppress the matching pinned entry (manual-first parity with the fresh path)', async () => {
    makeTranscript(UUID_A, Date.now());
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [
        { flag: '--system-prompt-file', basename: 'CC_SYSTEM.md', content: 'PINNED-OVERRIDE' },
        { flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT },
      ],
    });

    await spawnClaude(9999, dir, ['-r', UUID_A, '--append-system-prompt-file', '/myown/manual.md'], '/bin/fake-claude-pin-manual');

    assert.ok(sysFileArg(spawned[0], '--system-prompt-file'), 'override pin survives');
    assert.equal(readFileSync(sysFileArg(spawned[0], '--system-prompt-file'), 'utf-8'), 'PINNED-OVERRIDE');
    // The append slot is the user's own manual flag — the pinned append entry must not appear twice.
    const appendUses = spawned[0].args.filter(a => a === '--append-system-prompt-file');
    assert.equal(appendUses.length, 1, 'only the manual append flag remains');
    assert.equal(sysFileArg(spawned[0], '--append-system-prompt-file'), '/myown/manual.md');
    // And the pending carries the POST-suppression snapshot entries (override only).
    assert.deepEqual(readPendings()[0].entries.map(e => e.content), ['PINNED-OVERRIDE']);
  });

  it('manual --system-prompt flag suppresses the pinned OVERRIDE entry', async () => {
    makeTranscript(UUID_A, Date.now());
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [
        { flag: '--system-prompt-file', basename: 'CC_SYSTEM.md', content: 'PINNED-OVERRIDE' },
        { flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT },
      ],
    });

    await spawnClaude(9999, dir, ['-r', UUID_A, '--system-prompt', 'inline override'], '/bin/fake-claude-pin-manual2');

    assert.equal(sysFileArg(spawned[0], '--system-prompt-file'), null, 'pinned override suppressed by manual --system-prompt');
    assert.ok(sysFileArg(spawned[0], '--append-system-prompt-file'), 'append pin survives');
  });

  it('a fully manual-suppressed pin injects nothing and queues nothing (ran without ccv injection)', async () => {
    makeTranscript(UUID_A, Date.now());
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT }],
    });

    await spawnClaude(9999, dir, ['-r', UUID_A, '--append-system-prompt-file', '/myown/manual.md'], '/bin/fake-claude-pin-allsup');

    assert.equal(spawned[0].args.filter(a => a === '--append-system-prompt-file').length, 1, 'only the manual flag');
    assert.equal(existsSync(pendingFile()), false, 'no empty pending (writeSnapshot would refuse it anyway)');
  });

  it('flag-rejection self-heal strips pinned injection exactly once (pin path honors the retry machinery)', async () => {
    _clearSystemPromptFileRejectedPaths();
    makeTranscript(UUID_A, Date.now());
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT }],
    });
    _setPtyImportForTests(makeMockPtyOnceCrash("error: unknown option '--append-system-prompt-file'\n"));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9999, dir, ['-r', UUID_A], '/bin/fake-claude-pin-reject');
      await waitUntil(() => spawned.length >= 2);
    } finally {
      console.error = origError;
    }

    assert.equal(spawned.length, 2, 'initial + one retry, no loop');
    assert.ok(sysFileArg(spawned[0], '--append-system-prompt-file'), 'first spawn injects the pinned file');
    assert.equal(sysFileArg(spawned[1], '--append-system-prompt-file'), null, 'retry strips the pinned injection');
    assert.equal(_isSystemPromptFileRejected('/bin/fake-claude-pin-reject'), true, 'path marked as rejecting');
  });

  it('CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 disables pinning too (no injection, no pending)', async () => {
    process.env.CCV_DISABLE_AUTO_SYSTEM_PROMPT = '1';
    makeTranscript(UUID_A, Date.now());
    snaps.writeSnapshot(dir, UUID_A, {
      entries: [{ flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: PINNED_CONTENT }],
    });

    await spawnClaude(9999, dir, ['-r', UUID_A], '/bin/fake-claude-pin-env');

    assert.equal(sysFileArg(spawned[0], '--append-system-prompt-file'), null);
    assert.equal(existsSync(pendingFile()), false);
  });

  it('fresh launch (no resume flags) records a Bind A pending with the launch content', async () => {
    writeFileSync(join(dir, 'CC_APPEND_SYSTEM.md'), 'STATIC-CONTENT', 'utf-8');

    await spawnClaude(9999, dir, [], '/bin/fake-claude-pin-pending');

    const pendings = readPendings();
    assert.equal(pendings.length, 1);
    assert.equal(pendings[0].resumeExpected, false);
    assert.deepEqual(pendings[0].entries, [
      { flag: '--append-system-prompt-file', basename: 'CC_APPEND_SYSTEM.md', content: 'STATIC-CONTENT' },
    ]);
  });

  it('fresh launch without any injection writes no pending (no-record ≡ no-injection under F2)', async () => {
    await spawnClaude(9999, dir, [], '/bin/fake-claude-pin-empty');
    assert.equal(existsSync(pendingFile()), false);
  });
});
