/**
 * branch-lib-im-process-manager.test.js
 *
 * 分支补强：server/lib/im/im-process-manager.js。姊妹文件 im-process-manager.test.js
 * 已覆盖 buildChildEnv / spawn / status(ready/booting/dead) / stop(注入 killImpl) /
 * reconcile 主路径，但放过了若干分支：
 *   - resolveNodeBinary 的 electron 分支(行 24-29)：execSync(which/where node) 成功
 *     与抛错回退两条；
 *   - spawnImProcess 的 openSync 失败退化 'ignore'(行 73 catch + 行 83 if(fd!==null)
 *     的 false 臂)、child 无 unref(行 82 ?.)、child 为 undefined(行 84 ?.pid)；
 *   - defaultKill(行 88-91)：未注入 killImpl 时真实进程组杀 → 两处 catch 全走(用
 *     必死的高位 PID 999999，process.kill(-pid)/process.kill(pid) 均 ESRCH，安全)；
 *   - getImProcessStatus 的 hung 态(行 134 第三个 || 臂) 与 ready-but-not-connected
 *     (行 135 !!live.connected 的 false 臂)。
 *
 * 隔离：私有 mkdtemp 作 CCV_LOG_DIR(import 目标模块前设好);动态 import 目标;
 * 不碰源码/package.json/其它测试;改动的全局(process.env.PATH / process.versions
 * .electron)在 finally/after 还原;无裸控制字节;无 query-busting import。
 */

import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 私有 LOG_DIR —— 必须在任何会读取 LOG_DIR 的模块 import 之前设好。
const PRIV_LOG = mkdtempSync(join(tmpdir(), 'ccv-branch-impm-'));
process.env.CCV_LOG_DIR = PRIV_LOG;

let pm;       // im-process-manager
let lockMod;  // im-lock (lockPath / imDir)

before(async () => {
  pm = await import('../server/lib/im/im-process-manager.js');
  lockMod = await import('../server/lib/im/im-lock.js');
});

after(() => {
  try { rmSync(PRIV_LOG, { recursive: true, force: true }); } catch { /* noop */ }
});

let seq = 0;
const uid = () => `pmbr_${process.pid}_${seq++}`;
const wipe = (id) => { try { rmSync(lockMod.imDir(id), { recursive: true, force: true }); } catch { /* noop */ } };

const waitUntil = async (pred, { timeout = 2000, interval = 10 } = {}) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await pred()) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, interval));
  }
};

// 直接落一份自定义 pid 的锁（acquireImLock 只能写 process.pid）。
const writeLock = (id, lock) => {
  const dir = lockMod.imDir(id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(lockMod.lockPath(id), JSON.stringify(lock), { mode: 0o600 });
};

describe('im-process-manager 分支补强: resolveNodeBinary electron 分支', () => {
  const origElectron = process.versions.electron;

  after(() => {
    if (origElectron === undefined) { try { delete process.versions.electron; } catch { /* noop */ } }
    else process.versions.electron = origElectron;
  });

  it('electron 下 execSync(which/where node) 成功时返回解析到的真实 node 路径', () => {
    process.versions.electron = '30.0.0';
    const p = pm.resolveNodeBinary();
    // PATH 正常 → which node 应解析出某个非空路径(命中 if(p) return p)
    assert.ok(typeof p === 'string' && p.length > 0);
    // 不会是 electron 的 execPath 兜底分支(那是非 electron 路径)，应是 which 的结果或最终回退常量
    assert.notEqual(p, undefined);
  });

  it('electron 下 execSync 抛错时回退到平台默认 node 常量', () => {
    process.versions.electron = '30.0.0';
    const origPath = process.env.PATH;
    process.env.PATH = ''; // which/where 不可达 → execSync 抛错 → 命中 catch + 末尾回退三元
    try {
      const p = pm.resolveNodeBinary();
      const expected = process.platform === 'win32' ? 'node' : '/usr/local/bin/node';
      assert.equal(p, expected);
    } finally {
      process.env.PATH = origPath;
    }
  });

  it('electron + win32 时走 `where node`(execSync 在 mac 抛错)→ 回退 "node"(win32 末尾三元臂)', () => {
    process.versions.electron = '30.0.0';
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      // mac 上无 `where` 命令 → execSync 抛错 → catch → 末尾 win32 三元臂返回 'node'
      const p = pm.resolveNodeBinary();
      assert.equal(p, 'node');
    } finally {
      Object.defineProperty(process, 'platform', origPlatform);
    }
  });

  it('非 electron 时直接返回 process.execPath(早返回臂)', () => {
    try { delete process.versions.electron; } catch { process.versions.electron = undefined; }
    const p = pm.resolveNodeBinary();
    assert.equal(p, process.execPath);
  });
});

describe('im-process-manager 分支补强: spawnImProcess 退化与可选链', () => {
  it('openSync 失败时退化为 stdio=ignore(catch + if(fd!==null) false 臂)', () => {
    const id = uid(); wipe(id);
    const dir = lockMod.imDir(id);
    mkdirSync(dir, { recursive: true });
    // 把 process.out.log 预先建成目录 → openSync(...,'a') 抛 EISDIR → 命中 catch，fd 保持 null
    mkdirSync(join(dir, 'process.out.log'), { recursive: true });

    const records = [];
    const fakeSpawn = (cmd, args, options) => { records.push(options); return { pid: 11, unref() {} }; };
    const res = pm.spawnImProcess(id, { spawnImpl: fakeSpawn });
    assert.equal(res.pid, 11);
    assert.equal(records.length, 1);
    assert.equal(records[0].stdio, 'ignore'); // 退化分支生效
    wipe(id);
  });

  it('child 无 unref 时 ?. 跳过且 child 为 undefined 时 ?.pid 取 undefined', () => {
    const id = uid(); wipe(id);
    // child 无 unref：unref?.() 命中可选链 short-circuit（不抛）
    const r1 = pm.spawnImProcess(id, { spawnImpl: () => ({ pid: 22 }) });
    assert.equal(r1.pid, 22);
    wipe(id);

    const id2 = uid(); wipe(id2);
    // child 为 undefined：child?.pid → undefined，且 child?.unref?.() 安全
    const r2 = pm.spawnImProcess(id2, { spawnImpl: () => undefined });
    assert.equal(r2.pid, undefined);
    assert.ok(typeof r2.dir === 'string');
    wipe(id2);
  });

  it('child.unref 抛错时 try/catch 吞掉(行 82 catch)', () => {
    const id = uid(); wipe(id);
    const r = pm.spawnImProcess(id, { spawnImpl: () => ({ pid: 33, unref() { throw new Error('boom'); } }) });
    assert.equal(r.pid, 33);
    wipe(id);
  });

  it('日志 fd 在内部 closeSync 前已被关闭时 catch 吞掉 EBADF(行 83 catch)', async () => {
    const { closeSync } = await import('node:fs');
    const id = uid(); wipe(id);
    // spawnImpl 拿到 options.stdio=[ignore, fd, fd]，抢先 closeSync(fd)；
    // 之后 im-process-manager 自身 closeSync(fd) 触发 EBADF → 命中 catch。
    const spawnImpl = (cmd, args, options) => {
      const fd = Array.isArray(options.stdio) ? options.stdio[1] : null;
      if (typeof fd === 'number') { try { closeSync(fd); } catch { /* noop */ } }
      return { pid: 44, unref() {} };
    };
    const r = pm.spawnImProcess(id, { spawnImpl });
    assert.equal(r.pid, 44);
    wipe(id);
  });
});

describe('im-process-manager 分支补强: defaultKill(未注入 killImpl)', () => {
  it('stopImProcess 不注入 killImpl 时真实 defaultKill 对必死 PID 两处 catch 全走，升级 SIGKILL 后清锁', async () => {
    const id = uid(); wipe(id);
    // 落一份 pid=999999 的锁（确定不存在；process.kill(-pid)/(pid) 均 ESRCH → 两处 catch）
    writeLock(id, { pid: 999999, port: null, startedAt: new Date().toISOString() });
    // isAlive 恒真 → 跳过 alreadyDead，进入 SIGTERM(defaultKill) → 轮询不释放 → 超时 SIGKILL(defaultKill) → 清锁
    const r = await pm.stopImProcess(id, { isAlive: () => true, timeoutMs: 30, pollIntervalMs: 5 });
    assert.equal(r.stopped, true);
    assert.equal(r.forced, true);
    assert.equal(lockMod.readImLock(id), null); // 强制清锁
    wipe(id);
  });
});

describe('im-process-manager 分支补强: stopImProcess 默认 timeout/poll', () => {
  it('不传 timeoutMs/pollIntervalMs 时取默认(?? 8000 / ?? 200)，干净退出', async () => {
    const id = uid(); wipe(id);
    writeLock(id, { pid: process.pid, port: null, startedAt: new Date().toISOString() });
    // killImpl 在 SIGTERM 即清锁 → 首次默认 200ms 轮询即发现锁释放 → stopped(非 forced)
    const killImpl = (pid, sig) => { if (sig === 'SIGTERM') lockMod.clearImLock(id); };
    const r = await pm.stopImProcess(id, { killImpl, isAlive: () => true });
    assert.equal(r.stopped, true);
    assert.ok(!r.forced);
    wipe(id);
  });

  it('无锁时直接 alreadyDead(行 106 早返回块)', async () => {
    const id = uid(); wipe(id);
    const r = await pm.stopImProcess(id, { killImpl: () => {}, timeoutMs: 50, pollIntervalMs: 5 });
    assert.equal(r.alreadyDead, true);
    assert.equal(r.stopped, true);
    wipe(id);
  });

  it('轮询中持有者 pid 死亡时清锁并 stopped(行 118 块)', async () => {
    const id = uid(); wipe(id);
    writeLock(id, { pid: process.pid, port: null, startedAt: new Date().toISOString() });
    let alive = true; // 第一次入口判活(进入 kill)；首轮 poll 后转死 → 命中 L118
    const isAlive = () => { const v = alive; alive = false; return v; };
    const r = await pm.stopImProcess(id, { killImpl: () => {}, isAlive, timeoutMs: 500, pollIntervalMs: 5 });
    assert.equal(r.stopped, true);
    assert.ok(!r.forced);
    assert.equal(lockMod.readImLock(id), null); // 已清锁
    wipe(id);
  });
});

describe('im-process-manager 分支补强: reconcile spawn 失败 catch(e)', () => {
  it('enabled+dead 平台 spawnImProcess 抛错时被 catch 吞掉(console.error)，不计入 spawned', async () => {
    const { saveConfig } = await import('../server/lib/im/im-config.js');
    // 私有 LOG_DIR 下清空 prefs，仅启用 dingtalk
    saveConfig('dingtalk', { enabled: true, appKey: 'k', appSecret: 's' });
    wipe('dingtalk'); // 确保无锁 → getImLiveness 判 dead → 进入 spawn 分支
    const origErr = console.error;
    const errs = [];
    console.error = (...a) => { errs.push(a.join(' ')); };
    try {
      const spawned = await pm.reconcileImProcesses({
        spawnImpl: () => { throw new Error('spawn boom'); },
      });
      assert.ok(!spawned.includes('dingtalk')); // 抛错 → 未 push
      assert.ok(errs.some((m) => m.includes('reconcile spawn failed') && m.includes('spawn boom')));
    } finally {
      console.error = origErr;
      wipe('dingtalk');
    }
  });

  it('spawn 抛出无 message 的值时 e?.message || e 取 e 本身(行 155 || 臂)', async () => {
    const { saveConfig } = await import('../server/lib/im/im-config.js');
    saveConfig('dingtalk', { enabled: true, appKey: 'k', appSecret: 's' });
    wipe('dingtalk');
    const origErr = console.error;
    const errs = [];
    console.error = (...a) => { errs.push(a.map(String).join(' ')); };
    try {
      // 抛字符串(无 .message) → e?.message 为 undefined → || e → 'raw-string-failure'
      const spawned = await pm.reconcileImProcesses({
        spawnImpl: () => { throw 'raw-string-failure'; }, // eslint-disable-line no-throw-literal
      });
      assert.ok(!spawned.includes('dingtalk'));
      assert.ok(errs.some((m) => m.includes('raw-string-failure')));
    } finally {
      console.error = origErr;
      wipe('dingtalk');
    }
  });
});

describe('im-process-manager 分支补强: getImProcessStatus hung / ready-未连接', () => {
  it('hung 态：running=true(命中第三个 || 臂)、connected=false', async () => {
    const id = uid(); wipe(id);
    // 有 port 的锁 + probe 失败 + pid 存活 → getImLiveness 判 hung
    writeLock(id, { pid: process.pid, port: 7077, startedAt: new Date().toISOString() });
    const s = await pm.getImProcessStatus(id, {
      probe: async () => ({ ok: false }),
      pidAlive: () => true,
    });
    assert.equal(s.state, 'hung');
    assert.equal(s.running, true);     // ready||booting||hung → hung 臂
    assert.equal(s.connected, false);  // state!=='ready' → && 短路
    assert.equal(s.pid, process.pid);
    assert.equal(s.port, 7077);
    wipe(id);
  });

  it('ready 但未连接：connected 命中 !!live.connected 的 false 臂', async () => {
    const id = uid(); wipe(id);
    writeLock(id, { pid: process.pid, port: 7078, startedAt: new Date().toISOString() });
    const s = await pm.getImProcessStatus(id, {
      probe: async () => ({ ok: true, connected: false, pid: process.pid }),
    });
    assert.equal(s.state, 'ready');
    assert.equal(s.running, true);
    assert.equal(s.connected, false); // ready 但 connected 假 → !!live.connected 为 false
    wipe(id);
  });
});

describe('im-process-manager 分支补强: spawnImProcess 省略 spawnImpl', () => {
  // ████████ 死命令(2026-06-06 数据事故,绝对不可恢复旧写法)████████
  // 本用例旧版为覆盖「行 63 `opts.spawnImpl || nodeSpawn` 默认臂」真实拉起过 detached
  // worker(cli.js --im <bogus>)。这正是删除用户 40GB 真实数据的事故引爆器之一:
  // detached worker 脱离测试生命周期、子链剥离 CCV_* 后以真实 ~/.claude/cc-viewer 为
  // LOG_DIR。【任何测试都绝不允许真实 spawn IM worker】——`|| nodeSpawn` 默认臂在测试
  // 环境属"设计性不可覆盖"(L4 铁闸先行拦截),安全优先于覆盖率,不要为凑分恢复旧写法。
  // █████████████████████████████████████████████████████████████
  it('省略 spawnImpl → L4 测试铁闸拦截,绝不真实拉起 worker', () => {
    const id = `${uid()}_bogusplat`; wipe(id);
    const res = pm.spawnImProcess(id); // opts 省略 → 命中铁闸(NODE_TEST_CONTEXT 且无显式放行)
    assert.equal(res.blockedByTestGuard, true, '测试环境必须被 L4 铁闸拦截');
    assert.equal(res.pid, undefined, '绝不允许产生真实 pid');
    assert.ok(res.dir.includes(`IM_${id}`), '仍返回 dir 形状供调用方容错');
    wipe(id);
  });
});
