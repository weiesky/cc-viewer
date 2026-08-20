import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnScratch,
  writeScratch,
  resizeScratch,
  killScratch,
  killAllScratch,
  onScratchData,
  onScratchExit,
  getScratchPid,
  getScratchState,
  getScratchOutputBuffer,
  getScratchStartupCwd,
  getScratchActiveCount,
  getScratchShellBasename,
  _setPtyImportForTests,
} from '../server/scratch-pty-manager.js';

const TID_A = 'tab-test-a';
const TID_B = 'tab-test-b';

afterEach(() => {
  killAllScratch();
  _setPtyImportForTests(null);
});

describe('scratch-pty-manager: state queries without PTY', () => {
  it('getScratchPid returns null when no PTY for id', () => {
    assert.equal(getScratchPid(TID_A), null);
  });

  it('getScratchState returns not running when no PTY for id', () => {
    const s = getScratchState(TID_A);
    assert.equal(s.running, false);
    assert.equal(typeof s.cwd, 'string');
  });

  it('getScratchOutputBuffer returns empty string for unknown id', () => {
    assert.equal(getScratchOutputBuffer(TID_A), '');
  });

  it('getScratchStartupCwd returns a non-empty string', () => {
    const cwd = getScratchStartupCwd();
    assert.equal(typeof cwd, 'string');
    assert.ok(cwd.length > 0);
  });

  it('getScratchActiveCount returns 0 when no ptys', () => {
    assert.equal(getScratchActiveCount(), 0);
  });
});

describe('scratch-pty-manager: operations without PTY', () => {
  it('writeScratch returns false and does not throw when no PTY for id', () => {
    let result;
    assert.doesNotThrow(() => { result = writeScratch(TID_A, 'echo hi\r'); });
    assert.equal(result, false);
  });

  it('resizeScratch does not throw for unknown id', () => {
    assert.doesNotThrow(() => resizeScratch(TID_A, 80, 24));
  });

  it('killScratch is no-op for unknown id', () => {
    assert.doesNotThrow(() => killScratch(TID_A));
  });

  it('killAllScratch is no-op when nothing to kill', () => {
    assert.doesNotThrow(() => killAllScratch());
  });
});

describe('scratch-pty-manager: listener registration & isolation', () => {
  it('onScratchData registers and unregisters per id', () => {
    let called = false;
    const unsubscribe = onScratchData(TID_A, () => { called = true; });
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
    assert.equal(called, false);
  });

  it('onScratchExit registers and unregisters per id', () => {
    let called = false;
    const unsubscribe = onScratchExit(TID_A, () => { called = true; });
    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
    assert.equal(called, false);
  });

  it('listeners on different ids do not cross-fire (registration is isolated)', () => {
    let aCount = 0;
    let bCount = 0;
    const unA = onScratchData(TID_A, () => aCount++);
    const unB = onScratchData(TID_B, () => bCount++);
    // 没 pty 时不会触发；这里只验证注册路径互不污染
    unA();
    unB();
    assert.equal(aCount, 0);
    assert.equal(bCount, 0);
    // 解注册后 state 应该被回收（通过对外 API 间接验证：再次拿 state 仍是默认值）
    assert.equal(getScratchState(TID_A).running, false);
    assert.equal(getScratchState(TID_B).running, false);
  });
});

describe('scratch-pty-manager: API shape', () => {
  it('spawnScratch throws/rejects without id', async () => {
    await assert.rejects(() => spawnScratch(), /requires id/);
    await assert.rejects(() => spawnScratch(''), /requires id/);
  });
});

describe('scratch-pty-manager: embedded shell env', () => {
  it('strips inherited CLAUDE_CODE_NO_FLICKER even for zsh scratch shells', async () => {
    const prevShell = process.env.SHELL;
    const prevNoFlicker = process.env.CLAUDE_CODE_NO_FLICKER;
    const prevKeep = process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
    const spawned = [];

    process.env.SHELL = '/bin/zsh';
    process.env.CLAUDE_CODE_NO_FLICKER = '1';
    delete process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;

    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 9000 + spawned.length,
          command,
          args,
          opts,
          write() {},
          resize() {},
          kill() {},
          onData() {},
          onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));

    try {
      await spawnScratch('tab-env-zsh');
      assert.equal(spawned.length, 1);
      assert.equal(spawned[0].command, '/bin/zsh');
      assert.deepEqual(spawned[0].args, []);
      assert.equal(spawned[0].opts.env.CLAUDE_CODE_NO_FLICKER, undefined);
      assert.ok(spawned[0].opts.env.ZDOTDIR, 'zsh wrapper should set ZDOTDIR');
      assert.ok(spawned[0].opts.env.CCV_ORIGINAL_ZDOTDIR, 'zsh wrapper should remember original ZDOTDIR');
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
      if (prevNoFlicker === undefined) delete process.env.CLAUDE_CODE_NO_FLICKER;
      else process.env.CLAUDE_CODE_NO_FLICKER = prevNoFlicker;
      if (prevKeep === undefined) delete process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER;
      else process.env.CCV_KEEP_CLAUDE_CODE_NO_FLICKER = prevKeep;
    }
  });
});

describe('scratch-pty-manager: Windows shell fallback', () => {
  it('spawns cmd.exe when SHELL is unset on Windows', async (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows only');
      return;
    }
    const prevShell = process.env.SHELL;
    const prevComSpec = process.env.ComSpec;
    const spawned = [];
    delete process.env.SHELL;
    delete process.env.ComSpec;

    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 9999,
          command,
          args,
          opts,
          write() {},
          resize() {},
          kill() {},
          onData() {},
          onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));

    try {
      await spawnScratch('win-shell-test');
      assert.equal(spawned.length, 1);
      assert.equal(spawned[0].command, 'cmd.exe');
    } finally {
      if (prevShell !== undefined) process.env.SHELL = prevShell;
      else delete process.env.SHELL;
      if (prevComSpec !== undefined) process.env.ComSpec = prevComSpec;
      else delete process.env.ComSpec;
    }
  });

  it('getScratchShellBasename returns cmd.exe when SHELL is unset on Windows', (t) => {
    if (process.platform !== 'win32') {
      t.skip('Windows only');
      return;
    }
    const prevShell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      assert.equal(getScratchShellBasename(), 'cmd.exe');
    } finally {
      if (prevShell !== undefined) process.env.SHELL = prevShell;
      else delete process.env.SHELL;
    }
  });
});
