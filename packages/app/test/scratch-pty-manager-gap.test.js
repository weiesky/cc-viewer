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
  onScratchData,
  onScratchExit,
  getScratchPid,
  getScratchState,
  getScratchOutputBuffer,
  getScratchActiveCount,
  getScratchPtyCount,
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
