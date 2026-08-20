// 覆盖目标：server/lib/term-signals.js —— Windows Ctrl+C 退出链三层防御。
// 纯注入单测：fake exit / fake setTimeout / fake stdin(EventEmitter) / fake spawnSync，
// 零文件系统、零真实 spawn、不起 server（测试铁律）。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHardenedCleanup, installWinKeypressFallback, killPtyTree } from '../server/lib/term-signals.js';

// ── helpers ──────────────────────────────────────────────────────────────
function makeExitSpy() {
  const calls = [];
  const exit = (code) => { calls.push(code); };
  return { exit, calls };
}
function makeFakeTimer() {
  const timers = [];
  const setTimeoutImpl = (fn, ms) => {
    const t = { fn, ms, unrefed: false, unref() { this.unrefed = true; } };
    timers.push(t);
    return t;
  };
  return { setTimeoutImpl, timers, fire: (i = 0) => timers[i].fn() };
}
function makeFakeStdin({ isTTY = true } = {}) {
  const stdin = new EventEmitter();
  stdin.isTTY = isTTY;
  stdin.rawModeCalls = [];
  stdin.setRawMode = (v) => { stdin.rawModeCalls.push(v); };
  stdin.resumed = false;
  stdin.resume = () => { stdin.resumed = true; };
  return stdin;
}

describe('term-signals', () => {
  describe('createHardenedCleanup', () => {
    it('首次触发：武装 watchdog(unref) + 执行 doCleanup，promise resolve 后 exit()', async () => {
      const { exit, calls } = makeExitSpy();
      const { setTimeoutImpl, timers } = makeFakeTimer();
      let cleaned = false;
      const cleanup = createHardenedCleanup({
        doCleanup: async () => { cleaned = true; },
        exit, setTimeoutImpl,
      });
      cleanup();
      assert.equal(timers.length, 1, 'watchdog armed');
      assert.equal(timers[0].ms, 5000, 'default 5s（必须 > stopAll 3s race + rename 余量）');
      assert.equal(timers[0].unrefed, true, 'watchdog must be unref-ed');
      await Promise.resolve(); await Promise.resolve();
      assert.equal(cleaned, true);
      assert.deepEqual(calls, [undefined], 'graceful exit()');
    });

    it('doCleanup 同步抛错 → 立即 exit(130)', () => {
      const { exit, calls } = makeExitSpy();
      const { setTimeoutImpl } = makeFakeTimer();
      const cleanup = createHardenedCleanup({
        doCleanup: () => { throw new Error('boom'); },
        exit, setTimeoutImpl,
      });
      cleanup();
      assert.deepEqual(calls, [130]);
    });

    it('doCleanup promise reject → exit(130)', async () => {
      const { exit, calls } = makeExitSpy();
      const { setTimeoutImpl } = makeFakeTimer();
      const cleanup = createHardenedCleanup({
        doCleanup: () => Promise.reject(new Error('teardown failed')),
        exit, setTimeoutImpl,
      });
      cleanup();
      await Promise.resolve(); await Promise.resolve();
      assert.deepEqual(calls, [130]);
    });

    it('doCleanup 永挂 → watchdog 到点 exit(130)', () => {
      const { exit, calls } = makeExitSpy();
      const { setTimeoutImpl, fire } = makeFakeTimer();
      const cleanup = createHardenedCleanup({
        doCleanup: () => new Promise(() => {}), // 永不 settle（模拟 ConPTY/IM teardown 挂死）
        exit, setTimeoutImpl,
      });
      cleanup();
      assert.deepEqual(calls, [], 'not exited yet');
      fire(0);
      assert.deepEqual(calls, [130], 'watchdog force-exit');
    });

    it('二次触发（连按 Ctrl+C）→ 立即 exit(130)，不重复执行 doCleanup', () => {
      const { exit, calls } = makeExitSpy();
      const { setTimeoutImpl, timers } = makeFakeTimer();
      let n = 0;
      const cleanup = createHardenedCleanup({
        doCleanup: () => { n++; return new Promise(() => {}); },
        exit, setTimeoutImpl,
      });
      cleanup();
      cleanup();
      assert.equal(n, 1, 'doCleanup runs once');
      assert.equal(timers.length, 1, 'watchdog armed once');
      assert.deepEqual(calls, [130], 'second invocation exits immediately');
    });

    it('watchdogMs 可注入覆盖', () => {
      const { exit } = makeExitSpy();
      const { setTimeoutImpl, timers } = makeFakeTimer();
      createHardenedCleanup({ doCleanup: () => {}, exit, setTimeoutImpl, watchdogMs: 1234 })();
      assert.equal(timers[0].ms, 1234);
    });

    it('同步 doCleanup（非 promise）完成即 exit()', () => {
      const { exit, calls } = makeExitSpy();
      const { setTimeoutImpl } = makeFakeTimer();
      let ran = false;
      createHardenedCleanup({ doCleanup: () => { ran = true; }, exit, setTimeoutImpl })();
      assert.equal(ran, true);
      assert.deepEqual(calls, [undefined], 'sync doCleanup exits immediately after completion');
    });
  });

  describe('installWinKeypressFallback', () => {
    it('win32 + TTY：装 raw mode，keypress Ctrl+C 直连 onInterrupt', () => {
      const stdin = makeFakeStdin();
      let interrupted = 0;
      const uninstall = installWinKeypressFallback({
        stdin, platform: 'win32',
        onInterrupt: () => { interrupted++; },
        emitKeypressEvents: () => {},
      });
      assert.ok(uninstall, 'installed');
      assert.deepEqual(stdin.rawModeCalls, [true]);
      assert.equal(stdin.resumed, true);
      stdin.emit('keypress', '\u0003', { ctrl: true, name: 'c' });
      assert.equal(interrupted, 1);
      stdin.emit('keypress', '\u0004', { ctrl: true, name: 'd' });
      assert.equal(interrupted, 2, 'Ctrl+D also interrupts');
      stdin.emit('keypress', 'a', { name: 'a' });
      assert.equal(interrupted, 2, 'ordinary keys ignored');
      uninstall(); // 同时摘除本用例挂的 process exit restore 钩子
    });

    it('非 win32 不安装（darwin 行为零变化）', () => {
      const stdin = makeFakeStdin();
      const r = installWinKeypressFallback({ stdin, platform: 'darwin', onInterrupt: () => {}, emitKeypressEvents: () => {} });
      assert.equal(r, null);
      assert.deepEqual(stdin.rawModeCalls, []);
    });

    it('win32 但非 TTY（Electron/管道 spawn）不安装', () => {
      const stdin = makeFakeStdin({ isTTY: false });
      const r = installWinKeypressFallback({ stdin, platform: 'win32', onInterrupt: () => {}, emitKeypressEvents: () => {} });
      assert.equal(r, null);
    });

    it('setRawMode 抛错（极端终端环境）→ 返回 null 不 resume', () => {
      const stdin = makeFakeStdin();
      stdin.setRawMode = () => { throw new Error('EOPNOTSUPP'); };
      const r = installWinKeypressFallback({ stdin, platform: 'win32', onInterrupt: () => {}, emitKeypressEvents: () => {} });
      assert.equal(r, null);
      assert.equal(stdin.resumed, false);
    });

    it('key 对象缺失时按 str 控制字符兜底触发', () => {
      const stdin = makeFakeStdin();
      let interrupted = 0;
      const uninstall = installWinKeypressFallback({
        stdin, platform: 'win32', onInterrupt: () => { interrupted++; }, emitKeypressEvents: () => {},
      });
      stdin.emit('keypress', '\u0003', undefined);
      assert.equal(interrupted, 1, 'bare \\u0003 without key object still interrupts');
      uninstall();
    });

    it('卸载函数恢复 cooked mode 并摘掉 keypress 监听', () => {
      const stdin = makeFakeStdin();
      let interrupted = 0;
      const uninstall = installWinKeypressFallback({
        stdin, platform: 'win32', onInterrupt: () => { interrupted++; }, emitKeypressEvents: () => {},
      });
      uninstall();
      assert.deepEqual(stdin.rawModeCalls, [true, false], 'raw → cooked restored');
      stdin.emit('keypress', '\u0003', { ctrl: true, name: 'c' });
      assert.equal(interrupted, 0, 'listener removed');
    });

    it('process exit 钩子恢复 cooked mode（watchdog exit(130) 路径防终端残留 raw 态）', () => {
      const stdin = makeFakeStdin();
      const uninstall = installWinKeypressFallback({
        stdin, platform: 'win32', onInterrupt: () => {}, emitKeypressEvents: () => {},
      });
      // 模拟进程退出钩子触发（不真退）：找到 install 挂上的 exit listener 调一次
      const listeners = process.listeners('exit');
      listeners[listeners.length - 1]();
      assert.deepEqual(stdin.rawModeCalls, [true, false]);
      uninstall();
    });
  });

  describe('killPtyTree', () => {
    it('win32：spawnSync taskkill /pid <pid> /T /F + 有界 timeout', () => {
      const calls = [];
      const ok = killPtyTree(4321, {
        platform: 'win32',
        spawnSyncImpl: (cmd, args, opts) => { calls.push({ cmd, args, opts }); },
      });
      assert.equal(ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].cmd, 'taskkill');
      assert.deepEqual(calls[0].args, ['/pid', '4321', '/T', '/F']);
      assert.equal(calls[0].opts.timeout, 2000, 'bounded sync block');
      assert.equal(calls[0].opts.windowsHide, true);
    });

    it('非 win32 返回 false 且不调 spawnSync（走原 ptyProcess.kill 路径）', () => {
      let called = false;
      const ok = killPtyTree(4321, { platform: 'darwin', spawnSyncImpl: () => { called = true; } });
      assert.equal(ok, false);
      assert.equal(called, false);
    });

    it('pid 为空返回 false', () => {
      assert.equal(killPtyTree(null, { platform: 'win32', spawnSyncImpl: () => {} }), false);
    });

    it('spawnSync 抛错（taskkill 不存在）不向上抛，仍返回 true 交 watchdog 兜底', () => {
      const ok = killPtyTree(1, { platform: 'win32', spawnSyncImpl: () => { throw new Error('ENOENT'); } });
      assert.equal(ok, true);
    });
  });
});
