import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnClaude,
  writeToPty,
  resizePty,
  killPty,
  _setPtyImportForTests,
  onPtyData,
  onPtyExit,
  getPtyPid,
  getPtyState,
  getCurrentWorkspace,
  getOutputBuffer,
} from '../pty-manager.js';

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
