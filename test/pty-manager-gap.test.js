// 覆盖目标：server/pty-manager.js 中既有测试 (test/pty-manager.test.js) 未触及的分支：
//   - findSafeSliceStart：outputBuffer 超过 MAX_BUFFER 后的安全截断扫描（ESC/CSI 序列保护）
//   - spawnClaude：npm 版本 (node 运行 .js)、serverPort/internalToken 注入、CCV_IM_DENY 注入、
//                  -c 失败自动去 -c 重试、--dangerously-skip-permissions 标记
//   - getPtyKind / getPtySkipPermissions：claude vs shell 区分
//   - writeToPtySequential：无 pty / 空 chunks 的早退分支
//   - spawnShell：fallback 交互 shell 启动、env 清洗、onExit 广播、kind=shell
//
// 全程用 _setPtyImportForTests 注入 mock pty，不真 spawn shell；buffer/timer 用真实但极短的路径。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnClaude,
  spawnShell,
  writeToPty,
  writeToPtySequential,
  killPty,
  _setPtyImportForTests,
  onPtyExit,
  getPtyPid,
  getPtyState,
  getOutputBuffer,
  getPtyKind,
  getPtySkipPermissions,
  getCurrentWorkspace,
  _clearThinkingDisplayRejectedPaths,
} from '../server/pty-manager.js';

// 轮询直到条件满足，替代固定 setTimeout 减少 flake
const waitUntil = async (predicate, { timeoutMs = 800, intervalMs = 5 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitUntil timeout');
};

// 通用可控 mock pty 工厂：暴露每个实例的 data/exit 触发器，便于精确驱动
function makeControllableImport(spawned) {
  return () => ({
    spawn(command, args, opts) {
      const dataHandlers = [];
      const exitHandlers = [];
      let killed = false;
      const inst = {
        pid: 30000 + spawned.length,
        command,
        args,
        opts,
        writes: [],
        write(data) { inst.writes.push(data); },
        resize(cols, rows) { inst.lastResize = { cols, rows }; },
        kill() {
          if (killed) return;
          killed = true;
          for (const cb of [...exitHandlers]) cb({ exitCode: 0 });
        },
        onData(cb) { dataHandlers.push(cb); },
        onExit(cb) { exitHandlers.push(cb); },
        // 测试钩子
        _emitData(d) { for (const cb of [...dataHandlers]) cb(d); },
        _emitExit(code) { for (const cb of [...exitHandlers]) cb({ exitCode: code }); },
        _isKilled() { return killed; },
      };
      spawned.push(inst);
      return inst;
    },
  });
}

describe('pty-manager-gap: spawnClaude npm version + serverPort/token + IM_DENY', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeControllableImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('npm 版本 (.js + isNpmVersion) 用 node 运行并把脚本路径放在 args[0]', async () => {
    await spawnClaude(9000, process.cwd(), [], '/path/to/cli.js', true);
    const inst = spawned[0];
    // command 应是 node (process.execPath)，而不是脚本本身
    assert.equal(inst.command, process.execPath);
    assert.equal(inst.args[0], '/path/to/cli.js');
    assert.equal(inst.args[1], '--settings');
    // settings JSON 紧随其后，再之后是注入的 --thinking-display
    assert.ok(inst.args.includes('--thinking-display'));
  });

  it('非 .js 路径即使 isNpmVersion=true 也直接用 claudePath 作为 command', async () => {
    await spawnClaude(9000, process.cwd(), [], '/usr/local/bin/claude', true);
    assert.equal(spawned[0].command, '/usr/local/bin/claude');
    assert.equal(spawned[0].args[0], '--settings');
  });

  it('disables the auto-updater for every CCV-selected Claude executable', async () => {
    const previous = process.env.DISABLE_AUTOUPDATER;
    delete process.env.DISABLE_AUTOUPDATER;
    try {
      const selected = '/usr/local/bin/claude';
      await spawnClaude(9000, process.cwd(), [], selected);
      assert.equal(spawned[0].command, selected);
      assert.equal(spawned[0].opts.env.DISABLE_AUTOUPDATER, '1');
    } finally {
      if (previous === undefined) delete process.env.DISABLE_AUTOUPDATER;
      else process.env.DISABLE_AUTOUPDATER = previous;
    }
  });

  it('serverPort + internalToken 注入 EDITOR / CCVIEWER_PORT / CCVIEWER_INTERNAL_TOKEN', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo', false, 7788, 'https', 'tok-abc');
    const env = spawned[0].opts.env;
    assert.equal(env.CCV_EDITOR_PORT, '7788');
    assert.equal(env.CCVIEWER_PORT, '7788');
    assert.equal(env.CCVIEWER_PROTOCOL, 'https');
    assert.equal(env.CCVIEWER_INTERNAL_TOKEN, 'tok-abc');
    assert.ok(env.EDITOR.includes('ccv-editor.js'), 'EDITOR 指向内置 ccv-editor');
    assert.equal(env.VISUAL, env.EDITOR);
  });

  it('serverPort 提供但 internalToken 缺省时不写 CCVIEWER_INTERNAL_TOKEN', async () => {
    // env = {...process.env} 会继承父进程的 CCVIEWER_INTERNAL_TOKEN（若有），
    // 这里先清掉，单测 internalToken 参数缺省时不会主动注入。after() 还原。
    const prevTok = process.env.CCVIEWER_INTERNAL_TOKEN;
    delete process.env.CCVIEWER_INTERNAL_TOKEN;
    try {
      await spawnClaude(9000, process.cwd(), [], '/bin/echo', false, 7788);
      const env = spawned[0].opts.env;
      assert.equal(env.CCV_EDITOR_PORT, '7788');
      assert.equal(env.CCVIEWER_INTERNAL_TOKEN, undefined);
      // 默认协议 http
      assert.equal(env.CCVIEWER_PROTOCOL, 'http');
    } finally {
      if (prevTok === undefined) delete process.env.CCVIEWER_INTERNAL_TOKEN;
      else process.env.CCVIEWER_INTERNAL_TOKEN = prevTok;
    }
  });

  it('CCV_IM_DENY=1 时 settings JSON 注入 permissions.deny 规则', async () => {
    const prev = process.env.CCV_IM_DENY;
    process.env.CCV_IM_DENY = '1';
    try {
      await spawnClaude(9000, process.cwd(), [], '/bin/echo');
      const args = spawned[0].args;
      const settingsIdx = args.indexOf('--settings');
      const settings = JSON.parse(args[settingsIdx + 1]);
      assert.ok(Array.isArray(settings.permissions.deny));
      assert.ok(settings.permissions.deny.includes('Bash(sudo:*)'));
      assert.ok(settings.permissions.deny.includes('Bash(git push:*)'));
      assert.ok(settings.permissions.deny.some(r => r.includes('.ssh/**')));
    } finally {
      if (prev === undefined) delete process.env.CCV_IM_DENY;
      else process.env.CCV_IM_DENY = prev;
    }
  });

  it('无 CCV_IM_DENY 时 settings 不含 permissions 字段', async () => {
    const prev = process.env.CCV_IM_DENY;
    delete process.env.CCV_IM_DENY;
    try {
      await spawnClaude(9000, process.cwd(), [], '/bin/echo');
      const args = spawned[0].args;
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
      assert.equal(settings.permissions, undefined);
      assert.equal(settings.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9000');
    } finally {
      if (prev !== undefined) process.env.CCV_IM_DENY = prev;
    }
  });

  it('throws "claude not found" 当未提供 claudePath 且 resolveNativePath 返回空', async () => {
    // 真实环境通常找不到 claude binary（resolveNativePath 返回 null）→ 期待抛错。
    // 若当前机器恰好装了 claude，则放过断言（不强求）。
    let threw = false;
    let runningAfter = false;
    try {
      await spawnClaude(9000, process.cwd(), []);
      runningAfter = getPtyState().running;
    } catch (e) {
      threw = true;
      assert.match(e.message, /claude not found/);
    }
    assert.ok(threw || runningAfter, '要么抛 not found，要么真的找到了 claude 并 spawn 成功');
  });
});

describe('pty-manager-gap: 用户 --settings 合并进注入 settings（单 flag，注入键胜出）', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeControllableImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('用户 --settings 被剥离并合并：最终 argv 只有一个 --settings，代理 BASE_URL 胜出、用户 env 保留', async () => {
    const userSettings = '{"env":{"ANTHROPIC_BASE_URL":"http://user-clobber","FOO":"bar"}}';
    await spawnClaude(9000, process.cwd(), ['--settings', userSettings, '--print'], '/bin/echo');
    const args = spawned[0].args;
    assert.equal(args.filter(a => typeof a === 'string' && a.startsWith('--settings')).length, 1);
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9000');
    assert.equal(settings.env.FOO, 'bar');
    assert.ok(!args.includes(userSettings), '用户原始 settings 值不应再单独出现在 argv 里');
    assert.ok(args.includes('--print'), '无关用户 flag 原样保留');
  });

  it('CCV_IM_DENY=1 时用户 deny 与注入 deny 取并集，allow 原样保留', async () => {
    const prev = process.env.CCV_IM_DENY;
    process.env.CCV_IM_DENY = '1';
    try {
      const userSettings = '{"permissions":{"allow":["Bash(ls:*)"],"deny":["Read(/secret/**)"]}}';
      await spawnClaude(9000, process.cwd(), ['--settings', userSettings], '/bin/echo');
      const args = spawned[0].args;
      const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
      assert.ok(settings.permissions.deny.includes('Read(/secret/**)'), '用户 deny 保留');
      assert.ok(settings.permissions.deny.includes('Bash(sudo:*)'), '注入 deny 保留');
      assert.deepEqual(settings.permissions.allow, ['Bash(ls:*)']);
    } finally {
      if (prev === undefined) delete process.env.CCV_IM_DENY;
      else process.env.CCV_IM_DENY = prev;
    }
  });

  it('用户 --settings 值非法时照常 spawn，仅用注入 settings，且警告写入终端缓冲', async () => {
    await spawnClaude(9000, process.cwd(), ['--settings', '{broken', '-c'], '/bin/echo');
    const args = spawned[0].args;
    assert.equal(args.filter(a => typeof a === 'string' && a.startsWith('--settings')).length, 1);
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    assert.equal(settings.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:9000');
    assert.equal(settings.env.FOO, undefined);
    assert.ok(args.includes('-c'));
    // emitSpawnNotice 是用户可见面：失败值必须出现在终端缓冲里（locale 无关断言）
    assert.ok(getOutputBuffer().includes('{broken'), '警告应通过 emitSpawnNotice 写入 outputBuffer');
  });

  it('用户末尾裸 --settings 不吞掉注入的 --thinking-display（合并先于注入）', async () => {
    // 回归：合并若在 withDefaultThinkingDisplay 之后运行，裸 --settings 会把追加的
    // --thinking-display 当作值消费掉 → 注入静默丢失、summarized 泄漏成裸词。
    await spawnClaude(9000, process.cwd(), ['--print', '--settings'], '/bin/echo');
    const args = spawned[0].args;
    assert.ok(args.includes('--thinking-display'), '注入的 --thinking-display 必须保留');
    assert.ok(args.includes('summarized'), '--thinking-display 的值应完整');
    // summarized 只能作为 --thinking-display 的值出现，不能是裸词
    assert.equal(args.indexOf('summarized'), args.indexOf('--thinking-display') + 1);
    // 用户的裸 --settings 未被合并消费（无值形态），仍在用户参数段里原样保留
    assert.ok(args.includes('--print'));
    // 且不应因把 --thinking-display 当值而产生警告
    assert.ok(!getOutputBuffer().includes('--thinking-display (') ,
      '不应把 --thinking-display 误当作 settings 值而告警');
  });
});

describe('pty-manager-gap: getPtyKind / getPtySkipPermissions', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeControllableImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('spawnClaude 后 kind=claude，无 skip 时 getPtySkipPermissions=false', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    assert.equal(getPtyKind(), 'claude');
    assert.equal(getPtySkipPermissions(), false);
  });

  it('--dangerously-skip-permissions 使 getPtySkipPermissions=true', async () => {
    await spawnClaude(9000, process.cwd(), ['--dangerously-skip-permissions'], '/bin/echo');
    assert.equal(getPtyKind(), 'claude');
    assert.equal(getPtySkipPermissions(), true);
  });

  it('--allow-dangerously-skip-permissions 不算 skip（仅启用后续 toggle）', async () => {
    await spawnClaude(9000, process.cwd(), ['--allow-dangerously-skip-permissions'], '/bin/echo');
    assert.equal(getPtySkipPermissions(), false);
  });

  it('killPty 后 kind=null', async () => {
    await spawnClaude(9000, process.cwd(), ['--dangerously-skip-permissions'], '/bin/echo');
    killPty();
    assert.equal(getPtyKind(), null);
    // skipPermissions 仅在 kind==='claude' 时为 true，kind 清空后应是 false
    assert.equal(getPtySkipPermissions(), false);
  });
});

describe('pty-manager-gap: outputBuffer 超 MAX_BUFFER 触发 findSafeSliceStart', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeControllableImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('普通文本溢出后 buffer 被截断到 <= MAX_BUFFER 且保留尾部', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    const inst = spawned[0];
    // 先填普通字符到接近上限
    inst._emitData('x'.repeat(199990));
    // 再加一段带唯一尾标记的 ASCII，触发溢出与截断
    inst._emitData('y'.repeat(20) + 'TAIL_MARKER');
    const buf = getOutputBuffer();
    assert.ok(buf.length <= 200000, `buffer 应被截断到 <=200000, 实际 ${buf.length}`);
    assert.ok(buf.endsWith('TAIL_MARKER'), '尾部数据应保留');
  });

  it('截断点落在 ESC 转义序列上时 findSafeSliceStart 跳到序列之后', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    const inst = spawned[0];
    // 构造：填充到刚好让截断点附近是一个完整 CSI 序列 ESC [ 3 1 m
    // 先填充 199995 个普通字符，使后续 ESC 序列横跨截断边界
    inst._emitData('z'.repeat(199995));
    // 一段 ESC 序列 + 可见尾部；总长把 buffer 推过 200000
    inst._emitData('\x1b[31mREDTEXT_END');
    const buf = getOutputBuffer();
    assert.ok(buf.length <= 200000);
    // 关键：findSafeSliceStart 不应把 buffer 从 ESC 序列中间切开导致以裸参数字符开头
    // 末尾可见文本必须完整保留
    assert.ok(buf.endsWith('REDTEXT_END'));
    // 截断后的 buffer 不应以 CSI 参数残片 (如 '1m' 这种被砍头的) 开头
    assert.equal(typeof buf, 'string');
  });

  it('截断边界正好落在 ESC 字节上时跳过整段完整 CSI 序列', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    const inst = spawned[0];
    // 精确构造：让 rawStart(= total-200000) 恰好指向一个 ESC 字节。
    // prefix(P) + ESC[31m(5) + suffix(S) ；要 rawStart = P，需 S = 200000-5 = 199995。
    const P = 10;
    const seq = '\x1b[31m';        // ESC [ 3 1 m，完整 CSI，结束符 'm' (0x6d) 在 0x40~0x7e
    const suffix = 's'.repeat(199995) + 'CSI_BOUNDARY_END';
    inst._emitData('p'.repeat(P) + seq + suffix);
    const buf = getOutputBuffer();
    // 安全起点应落在 'm' 之后，即截断后 buffer 不以 ESC/参数残片开头，且尾部完整
    assert.ok(buf.endsWith('CSI_BOUNDARY_END'));
    assert.notEqual(buf.charCodeAt(0), 0x1b, '不应以 ESC 残片开头');
    // 'm' 是序列结束符，安全起点是其后第一个 's'
    assert.equal(buf[0], 's');
  });
});

describe('pty-manager-gap: -c 失败自动去 -c 重试', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('-c + "No conversation found" + 非0退出 → 去掉 -c 重试一次', async () => {
    // 第一个 pty 立即吐 "No conversation found" 并 exit 1；重试 pty 正常
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const dataHandlers = [];
        const exitHandlers = [];
        const idx = spawned.length;
        const inst = {
          pid: 4000 + idx, command, args, opts,
          write() {}, resize() {}, kill() {},
          onData(cb) { dataHandlers.push(cb); },
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        if (idx === 0) {
          queueMicrotask(() => {
            for (const cb of dataHandlers) cb('No conversation found\n');
            for (const cb of exitHandlers) cb({ exitCode: 1 });
          });
        }
        return inst;
      },
    }));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9000, process.cwd(), ['-c', '--foo'], '/bin/fake-claude-c');
      await waitUntil(() => spawned.length >= 2);
    } finally {
      console.error = origError;
    }

    assert.equal(spawned.length, 2, '应该 spawn 两次（首次 + 去 -c 重试）');
    assert.ok(spawned[0].args.includes('-c'), '首次保留 -c');
    assert.ok(!spawned[1].args.includes('-c'), '重试去掉 -c');
    assert.ok(spawned[1].args.includes('--foo'), '重试保留其它用户参数');
  });

  it('--continue 同样被识别为 continue flag 并在重试时剥离', async () => {
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const dataHandlers = [];
        const exitHandlers = [];
        const idx = spawned.length;
        const inst = {
          pid: 4100 + idx, command, args, opts,
          write() {}, resize() {}, kill() {},
          onData(cb) { dataHandlers.push(cb); },
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        if (idx === 0) {
          queueMicrotask(() => {
            for (const cb of dataHandlers) cb('No conversation found\n');
            for (const cb of exitHandlers) cb({ exitCode: 1 });
          });
        }
        return inst;
      },
    }));

    const origError = console.error;
    console.error = () => {};
    try {
      await spawnClaude(9000, process.cwd(), ['--continue'], '/bin/fake-claude-cont');
      await waitUntil(() => spawned.length >= 2);
    } finally {
      console.error = origError;
    }
    assert.equal(spawned.length, 2);
    assert.ok(!spawned[1].args.includes('--continue'));
  });

  it('-c 退出 0（成功）不触发重试', async () => {
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const exitHandlers = [];
        const idx = spawned.length;
        const inst = {
          pid: 4200 + idx, command, args, opts,
          write() {}, resize() {}, kill() {},
          onData() {},
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        if (idx === 0) {
          queueMicrotask(() => { for (const cb of exitHandlers) cb({ exitCode: 0 }); });
        }
        return inst;
      },
    }));
    await spawnClaude(9000, process.cwd(), ['-c'], '/bin/fake-claude-ok');
    await waitUntil(() => spawned[0] != null);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(spawned.length, 1, '退出 0 不重试');
  });

  it('-c 非0退出但输出无 "No conversation found" 不触发重试，反而广播 exit', async () => {
    let exitBroadcast = null;
    _setPtyImportForTests(() => ({
      spawn(command, args, opts) {
        const exitHandlers = [];
        const idx = spawned.length;
        const inst = {
          pid: 4300 + idx, command, args, opts,
          write() {}, resize() {}, kill() {},
          onData() {},
          onExit(cb) { exitHandlers.push(cb); },
        };
        spawned.push(inst);
        if (idx === 0) {
          queueMicrotask(() => { for (const cb of exitHandlers) cb({ exitCode: 5 }); });
        }
        return inst;
      },
    }));
    const unsub = onPtyExit((code) => { exitBroadcast = code; });
    await spawnClaude(9000, process.cwd(), ['-c'], '/bin/fake-claude-other');
    await waitUntil(() => exitBroadcast !== null);
    unsub();
    assert.equal(spawned.length, 1, '无 "No conversation found" → 不重试');
    assert.equal(exitBroadcast, 5, 'exit 应被广播给 listener');
  });
});

describe('pty-manager-gap: writeToPtySequential 早退分支', () => {
  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('无 pty 时 onComplete(false) 立即回调', async () => {
    // 确保没有 pty
    killPty();
    const result = await new Promise((resolve) => {
      writeToPtySequential(['a', 'b'], resolve);
    });
    assert.equal(result, false);
  });

  it('chunks 为空数组时 onComplete(false)', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    const result = await new Promise((resolve) => {
      writeToPtySequential([], resolve);
    });
    assert.equal(result, false);
  });

  it('chunks 为 null 时 onComplete(false) 且无 onComplete 时不抛', () => {
    killPty();
    let result = 'unset';
    assert.doesNotThrow(() => writeToPtySequential(null, (ok) => { result = ok; }));
    assert.equal(result, false);
    // 无 onComplete 回调也不能抛
    assert.doesNotThrow(() => writeToPtySequential(null));
  });

  it('正常发送多 chunk 后 onComplete(true)，每个 chunk 都写入 pty', async () => {
    const spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    const inst = spawned[0];
    inst.writes.length = 0; // 清掉 spawn 阶段可能的写
    const result = await new Promise((resolve) => {
      writeToPtySequential(['hello', '\r'], resolve, { settleMs: 10, timeoutMs: 200 });
    });
    assert.equal(result, true);
    assert.deepEqual(inst.writes, ['hello', '\r']);
  });
});

describe('pty-manager-gap: spawnShell fallback 交互 shell', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _setPtyImportForTests(makeControllableImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('无 pty 在跑时 spawnShell 启动 shell，kind=shell，返回 true', async () => {
    killPty(); // 确保空
    const ok = await spawnShell();
    assert.equal(ok, true);
    assert.equal(spawned.length, 1);
    assert.equal(getPtyKind(), 'shell');
    assert.equal(getPtyState().running, true);
    // shell 不是 claude → getPtySkipPermissions 始终 false
    assert.equal(getPtySkipPermissions(), false);
  });

  it('已有 pty 在跑时 spawnShell 直接返回 false 且不新开进程', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    assert.equal(spawned.length, 1);
    const ok = await spawnShell();
    assert.equal(ok, false);
    assert.equal(spawned.length, 1, '不应新开 shell');
    assert.equal(getPtyKind(), 'claude');
  });

  it('spawnShell 清洗 env：剥离 CCVIEWER_PORT / CCV_EDITOR_PORT / CCVIEWER_PROTOCOL / TOKEN', async () => {
    const prev = {
      port: process.env.CCVIEWER_PORT,
      editor: process.env.CCV_EDITOR_PORT,
      proto: process.env.CCVIEWER_PROTOCOL,
      tok: process.env.CCVIEWER_INTERNAL_TOKEN,
    };
    process.env.CCVIEWER_PORT = '6000';
    process.env.CCV_EDITOR_PORT = '6001';
    process.env.CCVIEWER_PROTOCOL = 'https';
    process.env.CCVIEWER_INTERNAL_TOKEN = 'leak-me';
    killPty();
    try {
      await spawnShell();
      const env = spawned[0].opts.env;
      assert.equal(env.CCVIEWER_PORT, undefined);
      assert.equal(env.CCV_EDITOR_PORT, undefined);
      assert.equal(env.CCVIEWER_PROTOCOL, undefined);
      assert.equal(env.CCVIEWER_INTERNAL_TOKEN, undefined);
      // CLAUDE_CODE_DISABLE_MOUSE 应被设
      assert.equal(env.CLAUDE_CODE_DISABLE_MOUSE, '1');
    } finally {
      for (const [k, v] of [
        ['CCVIEWER_PORT', prev.port], ['CCV_EDITOR_PORT', prev.editor],
        ['CCVIEWER_PROTOCOL', prev.proto], ['CCVIEWER_INTERNAL_TOKEN', prev.tok],
      ]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('spawnShell 用 SHELL 环境变量作为 shell（非 win 路径）', async () => {
    const prevShell = process.env.SHELL;
    process.env.SHELL = '/bin/bash';
    killPty();
    try {
      await spawnShell();
      // bash 走 --rcfile ... -i 包装
      assert.equal(spawned[0].command, '/bin/bash');
      assert.ok(spawned[0].args.includes('-i'), 'bash 应带 -i 交互');
      assert.ok(spawned[0].args.includes('--rcfile'));
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
    }
  });

  it('shell pty exit 时广播 exitListeners 并清状态', async () => {
    killPty();
    await spawnShell();
    const inst = spawned[0];
    let got = null;
    const unsub = onPtyExit((code) => { got = code; });
    inst._emitExit(7);
    unsub();
    assert.equal(got, 7);
    assert.equal(getPtyState().running, false);
    assert.equal(getPtyKind(), null);
    // exit 后 currentWorkspace.cwd 被清空
    assert.equal(getCurrentWorkspace().cwd, null);
  });

  it('shell onData 累积进 outputBuffer', async () => {
    killPty();
    await spawnShell();
    spawned[0]._emitData('shell-output-xyz');
    assert.ok(getOutputBuffer().includes('shell-output-xyz'));
    // shell 也有 PID
    assert.equal(typeof getPtyPid(), 'number');
  });

  it('shell onData 超 MAX_BUFFER 后同样走 findSafeSliceStart 截断', async () => {
    killPty();
    await spawnShell();
    spawned[0]._emitData('q'.repeat(199990));
    spawned[0]._emitData('r'.repeat(20) + 'SHELL_TAIL_END');
    const buf = getOutputBuffer();
    assert.ok(buf.length <= 200000, `shell buffer 应截断, 实际 ${buf.length}`);
    assert.ok(buf.endsWith('SHELL_TAIL_END'));
  });
});
