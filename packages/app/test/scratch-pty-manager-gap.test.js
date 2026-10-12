// 覆盖目标：server/scratch-pty-manager.js 中既有测试 (test/scratch-pty-manager.test.js) 未触及的分支：
//   - spawnScratch 后的 onData (累积/截断/批处理 flush) 与 onExit (广播+清状态) 回调
//   - findSafeSliceStart：outputBuffer 超 MAX_BUFFER(50000) 的安全截断（ESC/CSI 保护）
//   - flushBatch：setImmediate 调度后把 batchBuffer 推给 dataListeners
//   - writeScratch 成功路径、resizeScratch 在 pty 存在时调 resize、kill 守卫
//   - spawn-inflight 去重（同 id 并发 spawn 不双开）
//   - getScratchPtyCount / hasScratchPty / getScratchShellBasename / getScratchActiveCount(>0)
//
// 全程注入 mock pty，不真 spawn shell。每个 mock 实例暴露 _emitData/_emitExit 精确驱动回调。
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnScratch,
  writeScratch,
  resizeScratch,
  killScratch,
  killAllScratch,
  killScratchForCwd,
  onScratchData,
  onScratchExit,
  getScratchPid,
  getScratchState,
  getScratchOutputBuffer,
  getScratchActiveCount,
  getScratchPtyCount,
  getScratchPtyCountForCwd,
  hasScratchPty,
  getScratchShellBasename,
  _setPtyImportForTests,
} from '../server/scratch-pty-manager.js';

afterEach(() => {
  killAllScratch();
  _setPtyImportForTests(null);
});

// 可控 mock pty 工厂；spawned 收集所有实例
function makeControllableImport(spawned) {
  return () => ({
    spawn(command, args, opts) {
      const dataHandlers = [];
      const exitHandlers = [];
      let killed = false;
      const inst = {
        pid: 50000 + spawned.length,
        command,
        args,
        opts,
        writes: [],
        lastResize: null,
        write(d) { inst.writes.push(d); },
        resize(cols, rows) { inst.lastResize = { cols, rows }; },
        kill() { killed = true; },
        onData(cb) { dataHandlers.push(cb); },
        onExit(cb) { exitHandlers.push(cb); },
        _emitData(d) { for (const cb of [...dataHandlers]) cb(d); },
        _emitExit(code) { for (const cb of [...exitHandlers]) cb({ exitCode: code }); },
        _isKilled() { return killed; },
      };
      spawned.push(inst);
      return inst;
    },
  });
}

const waitImmediate = () => new Promise(r => setImmediate(r));

describe('scratch-pty-manager-gap: spawnScratch 基本生命周期', () => {
  it('spawn 后 getScratchPid / getScratchState.running 反映真实状态', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const proc = await spawnScratch('g-life');
    assert.equal(proc, spawned[0]);
    assert.equal(getScratchPid('g-life'), spawned[0].pid);
    assert.equal(getScratchState('g-life').running, true);
    assert.equal(getScratchActiveCount(), 1);
    assert.equal(hasScratchPty('g-life'), true);
    assert.equal(getScratchPtyCount(), 1);
  });

  it('同 id 第二次 spawnScratch 复用已存在的 pty（不双开）', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const a = await spawnScratch('g-dup');
    const b = await spawnScratch('g-dup');
    assert.equal(a, b);
    assert.equal(spawned.length, 1, '已有 pty → 直接返回，不再 spawn');
  });

  it('同 id 并发 spawn 通过 inflight Map 去重，只创建一个 pty', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const [p1, p2] = await Promise.all([spawnScratch('g-race'), spawnScratch('g-race')]);
    assert.equal(p1, p2);
    assert.equal(spawned.length, 1, 'inflight 去重，并发只 spawn 一次');
  });
});

describe('scratch-pty-manager-gap: onData 批处理与 buffer 截断', () => {
  it('onData 累积进 outputBuffer，并经 setImmediate flushBatch 推给 listener', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const received = [];
    const unsub = onScratchData('g-data', (chunk) => received.push(chunk));
    await spawnScratch('g-data');
    spawned[0]._emitData('hello-');
    spawned[0]._emitData('world');
    // 批处理：两次 emit 在同一 microtask 队列，setImmediate 后合并 flush
    await waitImmediate();
    assert.equal(getScratchOutputBuffer('g-data'), 'hello-world');
    assert.equal(received.join(''), 'hello-world', 'listener 收到合并后的批');
    unsub();
  });

  it('普通文本超 MAX_BUFFER(50000) 后被截断且保留尾标记', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-trunc');
    spawned[0]._emitData('a'.repeat(49995));
    spawned[0]._emitData('bbbbb' + 'TAILSCRATCH');
    const buf = getScratchOutputBuffer('g-trunc');
    assert.ok(buf.length <= 50000, `应截断到 <=50000, 实际 ${buf.length}`);
    assert.ok(buf.endsWith('TAILSCRATCH'));
  });

  it('截断点落在 ESC 序列上时 findSafeSliceStart 保护尾部可见文本完整', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-esc');
    spawned[0]._emitData('c'.repeat(49998));
    spawned[0]._emitData('\x1b[1;31mSCRATCH_RED_END');
    const buf = getScratchOutputBuffer('g-esc');
    assert.ok(buf.length <= 50000);
    assert.ok(buf.endsWith('SCRATCH_RED_END'), '尾部可见文本不被砍头');
  });

  it('截断边界恰好落在 ESC 字节上时跳过整段完整 CSI 序列', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-esc-boundary');
    // MAX_BUFFER=50000：prefix(P) + ESC[31m(5) + suffix(S)，要 rawStart=P 则 S=50000-5=49995
    const P = 8;
    const seq = '\x1b[31m';
    const suffix = 's'.repeat(49995) + 'SCRATCH_CSI_END';
    spawned[0]._emitData('p'.repeat(P) + seq + suffix);
    const buf = getScratchOutputBuffer('g-esc-boundary');
    assert.ok(buf.endsWith('SCRATCH_CSI_END'));
    assert.notEqual(buf.charCodeAt(0), 0x1b, '不应以 ESC 残片开头');
    assert.equal(buf[0], 's');
  });
});

describe('scratch-pty-manager-gap: onExit 广播与清状态', () => {
  it('pty exit 时广播 exitListeners 并把 ptyProcess 置空、记录 lastExitCode', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    let exitCode = null;
    const unsub = onScratchExit('g-exit', (code) => { exitCode = code; });
    await spawnScratch('g-exit');
    assert.equal(getScratchState('g-exit').running, true);
    spawned[0]._emitExit(13);
    assert.equal(exitCode, 13, 'exit 广播给 listener');
    assert.equal(getScratchState('g-exit').running, false);
    assert.equal(getScratchState('g-exit').exitCode, 13);
    assert.equal(getScratchPid('g-exit'), null, 'exit 后 pid 为 null');
    assert.equal(getScratchActiveCount(), 0);
    unsub();
  });

  it('exit listener 抛错不影响其它 listener（try/catch 隔离）', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    let secondCalled = false;
    const u1 = onScratchExit('g-exit-throw', () => { throw new Error('boom'); });
    const u2 = onScratchExit('g-exit-throw', () => { secondCalled = true; });
    await spawnScratch('g-exit-throw');
    assert.doesNotThrow(() => spawned[0]._emitExit(0));
    assert.equal(secondCalled, true, '第一个 listener 抛错后第二个仍被调用');
    u1(); u2();
  });
});

describe('scratch-pty-manager-gap: writeScratch / resizeScratch / killScratch', () => {
  it('writeScratch 在 pty 存在时写入并返回 true', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-write');
    spawned[0].writes.length = 0;
    const ok = writeScratch('g-write', 'ls -la\r');
    assert.equal(ok, true);
    assert.deepEqual(spawned[0].writes, ['ls -la\r']);
  });

  it('resizeScratch 记录 lastCols/Rows 且在 pty 存在时调用底层 resize', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-resize');
    resizeScratch('g-resize', 132, 43);
    assert.deepEqual(spawned[0].lastResize, { cols: 132, rows: 43 });
  });

  it('resizeScratch 钳制 NaN/0/负/超大为有限正整数（防毒化 lastCols→spawn）', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-clamp');
    resizeScratch('g-clamp', NaN, NaN);     // 非有限 → 回退上一有效值（初值 100×24）
    assert.deepEqual(spawned[0].lastResize, { cols: 100, rows: 24 });
    resizeScratch('g-clamp', 0, 0);         // 0 → 下界 2×1
    assert.deepEqual(spawned[0].lastResize, { cols: 2, rows: 1 });
    resizeScratch('g-clamp', -9, -9);       // 负 → 下界
    assert.deepEqual(spawned[0].lastResize, { cols: 2, rows: 1 });
    resizeScratch('g-clamp', 99999, 99999); // 超大 → 上界 1000
    assert.deepEqual(spawned[0].lastResize, { cols: 1000, rows: 1000 });
    resizeScratch('g-clamp', 120, 40);      // 正常透传
    assert.deepEqual(spawned[0].lastResize, { cols: 120, rows: 40 });
  });

  it('resize 前先 setState：spawn 用最近 resize 设定的 cols/rows', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    // 先注册 listener 建 state，再 resize（此时无 pty），再 spawn
    const unsub = onScratchData('g-resize-pre', () => {});
    resizeScratch('g-resize-pre', 200, 60);
    await spawnScratch('g-resize-pre');
    assert.equal(spawned[0].opts.cols, 200);
    assert.equal(spawned[0].opts.rows, 60);
    unsub();
  });

  it('resizeScratch 底层 resize 抛错被吞掉，不冒泡', async () => {
    const spawned = [];
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 60000, command, args, opts,
          write() {}, kill() {},
          resize() { throw new Error('resize failed'); },
          onData() {}, onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));
    await spawnScratch('g-resize-throw');
    assert.doesNotThrow(() => resizeScratch('g-resize-throw', 80, 24));
  });

  it('killScratch 调底层 kill、置空 pty 并彻底删除记录', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-kill');
    assert.equal(hasScratchPty('g-kill'), true);
    killScratch('g-kill');
    assert.equal(spawned[0]._isKilled(), true);
    assert.equal(getScratchPid('g-kill'), null);
    assert.equal(hasScratchPty('g-kill'), false, 'kill 后整条记录删除');
    assert.equal(getScratchPtyCount(), 0);
  });

  it('killScratch 在底层 kill 抛错时仍清状态删记录', async () => {
    const spawned = [];
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const inst = {
          pid: 61000, command, args, opts,
          write() {}, resize() {},
          kill() { throw new Error('kill failed'); },
          onData() {}, onExit() {},
        };
        spawned.push(inst);
        return inst;
      },
    }));
    await spawnScratch('g-kill-throw');
    assert.doesNotThrow(() => killScratch('g-kill-throw'));
    assert.equal(hasScratchPty('g-kill-throw'), false);
  });

  it('killAllScratch 杀掉多个 id 的全部 pty', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('g-all-1');
    await spawnScratch('g-all-2');
    await spawnScratch('g-all-3');
    assert.equal(getScratchPtyCount(), 3);
    killAllScratch();
    assert.equal(getScratchPtyCount(), 0);
    assert.equal(getScratchActiveCount(), 0);
    for (const inst of spawned) assert.equal(inst._isKilled(), true);
  });
});

describe('scratch-pty-manager-gap: getScratchShellBasename', () => {
  it('返回 SHELL 的 basename（如 zsh / bash）', () => {
    const prev = process.env.SHELL;
    process.env.SHELL = '/usr/local/bin/fish';
    try {
      assert.equal(getScratchShellBasename(), 'fish');
    } finally {
      if (prev === undefined) delete process.env.SHELL;
      else process.env.SHELL = prev;
    }
  });

  it('SHELL 未设时非 win 回退 /bin/sh → basename "sh"', (t) => {
    if (process.platform === 'win32') { t.skip('non-win only'); return; }
    const prev = process.env.SHELL;
    delete process.env.SHELL;
    try {
      assert.equal(getScratchShellBasename(), 'sh');
    } finally {
      if (prev !== undefined) process.env.SHELL = prev;
    }
  });
});

describe('scratch-pty-manager-gap: 多 id 隔离', () => {
  it('两个 id 的 data 互不串扰', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const aRecv = [];
    const bRecv = [];
    const ua = onScratchData('iso-a', (c) => aRecv.push(c));
    const ub = onScratchData('iso-b', (c) => bRecv.push(c));
    await spawnScratch('iso-a');
    await spawnScratch('iso-b');
    // spawned[0] 是 iso-a，spawned[1] 是 iso-b
    spawned[0]._emitData('AAA');
    spawned[1]._emitData('BBB');
    await waitImmediate();
    assert.equal(aRecv.join(''), 'AAA');
    assert.equal(bRecv.join(''), 'BBB');
    assert.equal(getScratchOutputBuffer('iso-a'), 'AAA');
    assert.equal(getScratchOutputBuffer('iso-b'), 'BBB');
    ua(); ub();
  });
});

// Multi-project (2026-10-12): scratch PTYs are keyed by (id, cwd) — same tab id under
// two resolved workspace cwds must be two fully isolated shells.
describe('scratch-pty-manager-gap: per-cwd composite key isolation', () => {
  const DIR_A = '/tmp/ccv-scratch-a';
  const DIR_B = '/tmp/ccv-scratch-b';

  it('same id under two cwds spawns two isolated ptys with correct cwd', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('cw-x', { cwd: DIR_A });
    await spawnScratch('cw-x', { cwd: DIR_B });
    assert.equal(spawned.length, 2);
    assert.equal(spawned[0].opts.cwd, DIR_A);
    assert.equal(spawned[1].opts.cwd, DIR_B);
    assert.equal(getScratchPtyCount(), 2);
    assert.equal(getScratchPtyCountForCwd(DIR_A), 1);
    assert.equal(getScratchPtyCountForCwd(DIR_B), 1);
    assert.equal(hasScratchPty('cw-x', { cwd: DIR_A }), true);
    assert.equal(hasScratchPty('cw-x', { cwd: DIR_B }), true);
    assert.equal(getScratchState('cw-x', { cwd: DIR_A }).cwd, DIR_A);
    assert.equal(getScratchState('cw-x', { cwd: DIR_B }).cwd, DIR_B);
  });

  it('write/buffer/listener are scoped per cwd (no cross-talk)', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const aRecv = [];
    const bRecv = [];
    const ua = onScratchData('cw-iso', (c) => aRecv.push(c), { cwd: DIR_A });
    const ub = onScratchData('cw-iso', (c) => bRecv.push(c), { cwd: DIR_B });
    await spawnScratch('cw-iso', { cwd: DIR_A });
    await spawnScratch('cw-iso', { cwd: DIR_B });
    writeScratch('cw-iso', 'echo a\n', { cwd: DIR_A });
    writeScratch('cw-iso', 'echo b\n', { cwd: DIR_B });
    assert.deepEqual(spawned[0].writes, ['echo a\n']);
    assert.deepEqual(spawned[1].writes, ['echo b\n']);
    spawned[0]._emitData('OUT-A');
    spawned[1]._emitData('OUT-B');
    await waitImmediate();
    assert.equal(aRecv.join(''), 'OUT-A');
    assert.equal(bRecv.join(''), 'OUT-B');
    assert.equal(getScratchOutputBuffer('cw-iso', { cwd: DIR_A }), 'OUT-A');
    assert.equal(getScratchOutputBuffer('cw-iso', { cwd: DIR_B }), 'OUT-B');
    ua(); ub();
  });

  it('killScratch with cwd kills only that bucket; killAllScratch reaps the rest', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('cw-k', { cwd: DIR_A });
    await spawnScratch('cw-k', { cwd: DIR_B });
    killScratch('cw-k', { cwd: DIR_A });
    assert.equal(spawned[0]._isKilled(), true);
    assert.equal(spawned[1]._isKilled(), false);
    assert.equal(getScratchPtyCount(), 1);
    assert.equal(getScratchState('cw-k', { cwd: DIR_B }).running, true);
    killAllScratch();
    assert.equal(getScratchPtyCount(), 0);
  });

  it('no-cwd callers stay on the STARTUP_CWD bucket (back-compat)', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('cw-legacy');
    assert.equal(spawned.length, 1);
    assert.notEqual(spawned[0].opts.cwd, DIR_A);
    assert.equal(getScratchState('cw-legacy').cwd, spawned[0].opts.cwd);
    // A cwd-scoped connection with the same id is a different bucket.
    await spawnScratch('cw-legacy', { cwd: DIR_A });
    assert.equal(spawned.length, 2);
    assert.equal(hasScratchPty('cw-legacy'), true);
    assert.equal(hasScratchPty('cw-legacy', { cwd: DIR_A }), true);
  });

  it('onExit reaps the dead entry when no listeners remain (cap hygiene)', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('cw-exit', { cwd: DIR_A });
    assert.equal(getScratchPtyCount(), 1);
    spawned[0]._emitExit(0);
    await waitImmediate();
    // No listeners were registered → entry reaped instead of lingering against caps.
    assert.equal(getScratchPtyCount(), 0);
    assert.equal(getScratchPtyCountForCwd(DIR_A), 0);
  });

  it('onExit keeps the entry while a listener is still attached', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const codes = [];
    const un = onScratchExit('cw-exit2', (c) => codes.push(c), { cwd: DIR_A });
    await spawnScratch('cw-exit2', { cwd: DIR_A });
    spawned[0]._emitExit(3);
    await waitImmediate();
    assert.deepEqual(codes, [3]);
    assert.equal(getScratchPtyCount(), 1);
    assert.equal(getScratchState('cw-exit2', { cwd: DIR_A }).exitCode, 3);
    un();
    assert.equal(getScratchPtyCount(), 0);
  });

  it('concurrent spawnScratch for different cwds do not share the inflight promise', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    const [pa, pb] = await Promise.all([
      spawnScratch('cw-inf', { cwd: DIR_A }),
      spawnScratch('cw-inf', { cwd: DIR_B }),
    ]);
    assert.notEqual(pa, pb);
    assert.equal(spawned.length, 2);
  });
});

// Cap bookkeeping + inflight rejection cleanup (review 2026-10-12): the WS-layer cap
// reads these counters — a bucket leak or a stuck inflight entry fails silently there.
describe('scratch-pty-manager-gap: cap counters & inflight rejection', () => {
  const DIR_A = '/tmp/ccv-scratch-a';
  const DIR_B = '/tmp/ccv-scratch-b';

  it('cap counters do not leak across cwd buckets', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('cap-1', { cwd: DIR_A });
    await spawnScratch('cap-2', { cwd: DIR_A });
    await spawnScratch('cap-3', { cwd: DIR_B });
    assert.equal(getScratchPtyCountForCwd(DIR_A), 2);
    assert.equal(getScratchPtyCountForCwd(DIR_B), 1);
    killScratch('cap-1', { cwd: DIR_A });
    assert.equal(getScratchPtyCountForCwd(DIR_A), 1);
    assert.equal(getScratchPtyCountForCwd(DIR_B), 1, 'killing in A must not touch B');
    assert.equal(getScratchPtyCount(), 2);
  });

  it('resizeScratch/getScratchPid are scoped per cwd', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('cap-r', { cwd: DIR_A });
    await spawnScratch('cap-r', { cwd: DIR_B });
    resizeScratch('cap-r', 120, 40, { cwd: DIR_B });
    assert.equal(spawned[0].lastResize, null, 'bucket A must not receive B resize');
    assert.deepEqual(spawned[1].lastResize, { cols: 120, rows: 40 });
    assert.equal(getScratchPid('cap-r', { cwd: DIR_A }), spawned[0].pid);
    assert.equal(getScratchPid('cap-r', { cwd: DIR_B }), spawned[1].pid);
  });

  it('a rejected spawn clears its per-key inflight entry (retry works, other keys unblocked)', async () => {
    const spawned = [];
    let failOnce = true;
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        if (failOnce) { failOnce = false; throw new Error('boom'); }
        return makeControllableImport(spawned)().spawn(command, args, opts);
      },
    }));
    await assert.rejects(spawnScratch('inf-1', { cwd: DIR_A }), /boom/);
    // Same key retries and succeeds (finally cleared the inflight entry).
    const p = await spawnScratch('inf-1', { cwd: DIR_A });
    assert.ok(p, 'retry after rejection must respawn');
    // A different cwd bucket was never blocked by the rejected key.
    const p2 = await spawnScratch('inf-1', { cwd: DIR_B });
    assert.ok(p2);
    assert.equal(spawned.length, 2);
  });
});

// Regression (review 2026-10-12): kill+quick-respawn under the same key — the old
// process's async onExit must not maybeReap the NEW live record.
describe('scratch-pty-manager-gap: kill+respawn onExit identity', () => {
  const DIR_A = '/tmp/ccv-scratch-a';

  it('stale onExit after kill+respawn does not delete the new live entry', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('reap-1', { cwd: DIR_A });
    const oldProc = spawned[0];
    killScratch('reap-1', { cwd: DIR_A });
    // Respawn the same (id, cwd) BEFORE the old process's exit event lands.
    await spawnScratch('reap-1', { cwd: DIR_A });
    const newProc = spawned[1];
    assert.notEqual(newProc, oldProc);
    assert.equal(getScratchState('reap-1', { cwd: DIR_A }).running, true);
    assert.equal(getScratchPtyCount(), 1);
    // The old process's exit event arrives late — it must NOT reap the new record.
    oldProc._emitExit(0);
    await waitImmediate();
    assert.equal(getScratchPtyCount(), 1, 'stale onExit must not delete the new entry');
    assert.equal(getScratchState('reap-1', { cwd: DIR_A }).running, true);
    assert.equal(hasScratchPty('reap-1', { cwd: DIR_A }), true);
    // And the new shell is still reachable (writable / killable).
    assert.equal(writeScratch('reap-1', 'echo hi\n', { cwd: DIR_A }), true);
    killAllScratch();
    assert.equal(newProc._isKilled(), true, 'the new shell must remain killable');
  });
});

// killScratchForCwd (2026-10-12): closing a project/instance must reap only that
// workspace's scratch shells — never a same-basename sibling's (twins have distinct cwds).
describe('scratch-pty-manager-gap: killScratchForCwd', () => {
  const DIR_A = '/tmp/ccv-scratch-a';
  const DIR_B = '/tmp/ccv-scratch-b';

  it('reaps only the matching cwd bucket, returns the count, leaves siblings running', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('w-1', { cwd: DIR_A });
    await spawnScratch('w-2', { cwd: DIR_A });
    await spawnScratch('w-3', { cwd: DIR_B });
    const n = killScratchForCwd(DIR_A);
    assert.equal(n, 2, 'should reap both A shells');
    assert.equal(spawned[0]._isKilled(), true);
    assert.equal(spawned[1]._isKilled(), true);
    assert.equal(spawned[2]._isKilled(), false, 'sibling cwd B must be untouched');
    assert.equal(getScratchPtyCountForCwd(DIR_A), 0);
    assert.equal(getScratchPtyCountForCwd(DIR_B), 1);
    assert.equal(getScratchState('w-3', { cwd: DIR_B }).running, true);
  });

  it('no match (or empty cwd) is a no-op', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnScratch('w-x', { cwd: DIR_A });
    assert.equal(killScratchForCwd('/tmp/ccv-scratch-nonexistent'), 0);
    assert.equal(killScratchForCwd(''), 0);
    assert.equal(killScratchForCwd(null), 0);
    assert.equal(getScratchPtyCount(), 1);
    assert.equal(spawned[0]._isKilled(), false);
  });
});

// Stale-record guard (review 2026-10-12): a reap (killAll / killScratchForCwd) landing
// inside the async getPty() window must not let the spawn attach a live process to the
// orphaned state object — the shell would become unreachable (invisible to kill/caps).
describe('scratch-pty-manager-gap: reap-during-spawn guard', () => {
  const DIR_A = '/tmp/ccv-scratch-a';

  it('spawn rejects (and does not leak a reachable shell) when the record is reaped mid-spawn', async () => {
    // A pty import whose getPty() await yields several macrotasks — a wide window so the
    // reap reliably lands before pty.spawn runs.
    let spawned = 0;
    _setPtyImportForTests(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      return {
        spawn() {
          spawned++;
          return {
            pid: 88000 + spawned,
            writes: [],
            write() {}, resize() {}, kill() {},
            onData() {}, onExit() {},
          };
        },
      };
    });
    const p = spawnScratch('race-1', { cwd: DIR_A });
    // Reap immediately after the spawn starts (still inside the getPty() window).
    killScratchForCwd(DIR_A);
    await assert.rejects(p, /reaped during spawn/);
    // No reachable record survives: the shell (if the pty import even spawned) is not
    // addressable, and no entry lingers against the caps.
    assert.equal(getScratchPtyCountForCwd(DIR_A), 0);
    assert.equal(getScratchState('race-1', { cwd: DIR_A }).running, false);
  });
});
