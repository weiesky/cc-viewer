// 分支补强：server/pty-manager.js 在既有 pty-manager*.test.js / scratch-pty-manager*.test.js
// 之外仍未覆盖的分支：
//   - findSafeSliceStart（实现在 server/lib/ansi-safe-slice.js，此处测 onData 裁剪集成）：
//     rawStart 落在 ESC 上（锚点语义 → 序列完整保留）、落在参数残片上（锚到下一个 ESC）、
//     纯文本无锚点（scanLimit fallback）；裁剪滞回 BUFFER_TRIM_TO=180000
//   - spawnClaude：Electron 环境（process.versions.electron）解析真实 node 路径
//     （which/where 成功 与 失败 catch 兜底两条）
//   - resizePty / killPty 的 try-catch（底层 resize/kill 抛错被吞）
//   - onData / onExit listener 抛错被 try{}catch{} 吞掉
//
// _shims/register.mjs：pty-manager.js 顶层 import 链涉及 findcc.js 等纯 Node 模块，不走 Vite 风格，
// 但按隔离规范保留 shim 注册；目标模块用动态 import 加载。

import './_shims/register.mjs';
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, chmodSync as fsChmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { join } from 'node:path';

const mod = await import('../server/pty-manager.js');
const {
  spawnClaude,
  spawnShell,
  writeToPty,
  resizePty,
  killPty,
  _setPtyImportForTests,
  onPtyData,
  onPtyExit,
  getOutputBuffer,
  getPtyState,
  getPtyPid,
  _clearThinkingDisplayRejectedPaths,
} = mod;

const waitUntil = async (predicate, { timeoutMs = 800, intervalMs = 5 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitUntil timeout');
};

// 可控 mock pty 工厂：每个实例暴露 _emitData/_emitExit，并可让 resize/kill 抛错
function makeImport(spawned, { resizeThrows = false, killThrows = false } = {}) {
  return () => ({
    spawn(command, args, opts) {
      const dataHandlers = [];
      const exitHandlers = [];
      let killed = false;
      const inst = {
        pid: 50000 + spawned.length,
        command, args, opts,
        writes: [],
        write(data) { inst.writes.push(data); },
        resize() { if (resizeThrows) throw new Error('resize boom'); },
        kill() {
          if (killThrows) throw new Error('kill boom');
          if (killed) return;
          killed = true;
          for (const cb of [...exitHandlers]) cb({ exitCode: 0 });
        },
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

describe('branch-pty-manager: findSafeSliceStart 锚点语义 onData 裁剪集成', () => {
  let spawned;

  beforeEach(async () => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeImport(spawned));
    // 每个用例用全新 pty，spawnClaude 会把 outputBuffer 重置为空
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  // 裁剪滞回：超 MAX_BUFFER 后裁到 TRIM_TO，rawStart = total - TRIM_TO。
  // 让 prefix.length = total - TRIM_TO，则 rawStart 正好指向 payload 第一个字符。
  const TRIM_TO = 180000;
  const PREFIX = 'a'.repeat(20050); // total = 20050 + 180000 > MAX_BUFFER(200000)，rawStart = 20050

  it('rawStart 落在完整 ESC 序列起点 → 返回 ESC 本身，序列完整保留（新锚点语义）', () => {
    const seq = '\x1b[31m';
    const body = seq + 'Z'.repeat(TRIM_TO - seq.length - 'TAIL_A_END'.length) + 'TAIL_A_END';
    const inst = spawned[0];
    inst._emitData(PREFIX + body);
    const buf = getOutputBuffer();
    assert.ok(buf.startsWith('\x1b[31m'), '应以完整 ESC 序列开头而非跳过它');
    assert.ok(buf.endsWith('TAIL_A_END'));
    assert.equal(buf.length, TRIM_TO);
  });

  it('rawStart 落在参数残片上（前缀 ESC 被裁掉）→ 锚到下一个 ESC，不残留 [9m 类乱码', () => {
    // 残片 '[9m' 在裁剪点，真正的下一个序列在其后
    const frag = '[9m';
    const next = '\x1b[0m';
    const body = frag + next + 'Z'.repeat(TRIM_TO - frag.length - next.length - 'TAIL_B_END'.length) + 'TAIL_B_END';
    const inst = spawned[0];
    inst._emitData(PREFIX + body);
    const buf = getOutputBuffer();
    assert.ok(buf.startsWith('\x1b[0m'), '应锚到下一个 ESC，跳过孤儿残片');
    assert.ok(!buf.startsWith('[9m'));
    assert.ok(buf.endsWith('TAIL_B_END'));
  });

  it('纯文本无 ESC/LF 锚点 → fallback 到 scanLimit（rawStart+4096），尾部完整', () => {
    const body = 'Z'.repeat(TRIM_TO - 'TAIL_C_END'.length) + 'TAIL_C_END';
    const inst = spawned[0];
    inst._emitData(PREFIX + body);
    const buf = getOutputBuffer();
    assert.equal(buf[0], 'Z');
    assert.equal(buf.length, TRIM_TO - 4096);
    assert.ok(buf.endsWith('TAIL_C_END'));
  });
});

describe('branch-pty-manager: spawnClaude Electron node 路径解析', () => {
  let spawned;
  let electronWasDefined;
  let prevElectron;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeImport(spawned));
    electronWasDefined = Object.prototype.hasOwnProperty.call(process.versions, 'electron');
    prevElectron = process.versions.electron;
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
    // 还原 process.versions.electron
    if (electronWasDefined) {
      Object.defineProperty(process.versions, 'electron', { value: prevElectron, configurable: true, writable: false, enumerable: true });
    } else {
      try { delete process.versions.electron; } catch { /* ignore */ }
    }
  });

  it('process.versions.electron 存在时走 which/where 解析真实 node（成功或 catch 兜底均不抛）', async () => {
    Object.defineProperty(process.versions, 'electron', { value: '99.0.0', configurable: true });
    // npm 版本 + .js → command 必须是解析出的 node 路径而非脚本本身
    await spawnClaude(9000, process.cwd(), [], '/path/to/cli.js', true);
    const inst = spawned[0];
    // command 应是某个 node 路径字符串（which node 成功）或 fallback 默认值；总之非空且 args[0] 是脚本
    assert.equal(typeof inst.command, 'string');
    assert.ok(inst.command.length > 0);
    assert.equal(inst.args[0], '/path/to/cli.js');
  });

  it('Electron + which node 失败时走 catch 兜底（清空 PATH 强制 which 失败）', async () => {
    Object.defineProperty(process.versions, 'electron', { value: '99.0.0', configurable: true });
    const prevPath = process.env.PATH;
    // 清空 PATH，使 execSync('which node') 找不到 node 而抛错 → 进入 catch 分支(行 189-191)
    process.env.PATH = '';
    try {
      await spawnClaude(9000, process.cwd(), [], '/usr/local/bin/claude', false);
      const inst = spawned[0];
      // 非 win32 catch 分支兜底为 '/usr/local/bin/node'；此处只确认 spawn 成功未抛
      assert.equal(typeof inst.command, 'string');
      assert.ok(getPtyState().running);
    } finally {
      process.env.PATH = prevPath;
    }
  });
});

describe('branch-pty-manager: resizePty / killPty 底层抛错被吞', () => {
  afterEach(() => {
    _setPtyImportForTests(null);
  });

  it('resizePty 在底层 resize 抛错时不向外抛（catch 吞掉）', async () => {
    const spawned = [];
    _setPtyImportForTests(makeImport(spawned, { resizeThrows: true }));
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    assert.doesNotThrow(() => resizePty(123, 45));
    killPty();
  });

  it('killPty 在底层 kill 抛错时不向外抛（catch 吞掉）并清空状态', async () => {
    const spawned = [];
    _setPtyImportForTests(makeImport(spawned, { killThrows: true }));
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    assert.ok(getPtyState().running);
    assert.doesNotThrow(() => killPty());
    // kill 抛错也应把 ptyProcess 置空
    assert.equal(getPtyState().running, false);
    assert.equal(getPtyPid(), null);
  });
});

describe('branch-pty-manager: listener 回调抛错被 try/catch 吞掉', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _clearThinkingDisplayRejectedPaths();
    _setPtyImportForTests(makeImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('onPtyData 回调抛错不影响其它 listener，也不冒泡(flushBatch 的 try{}catch{})', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    let goodCalled = false;
    const unsubBad = onPtyData(() => { throw new Error('bad data listener'); });
    const unsubGood = onPtyData(() => { goodCalled = true; });
    spawned[0]._emitData('hello-listener');
    // flushBatch 通过 setImmediate 异步触发
    await waitUntil(() => goodCalled);
    unsubBad();
    unsubGood();
    assert.ok(goodCalled, '抛错的 listener 不应阻断后续 listener');
  });

  it('onPtyExit 回调抛错不影响其它 listener，也不冒泡', async () => {
    await spawnClaude(9000, process.cwd(), [], '/bin/echo');
    let goodCode = null;
    const unsubBad = onPtyExit(() => { throw new Error('bad exit listener'); });
    const unsubGood = onPtyExit((code) => { goodCode = code; });
    // 直接 emit exit（非 -c/非 flag 拒绝路径，走正常 exitListeners 广播）
    spawned[0]._emitExit(3);
    unsubBad();
    unsubGood();
    assert.equal(goodCode, 3, '抛错的 exit listener 不应阻断广播');
    assert.equal(getPtyState().running, false);
  });
});

describe('branch-pty-manager: spawnShell exit listener 抛错与 buffer 截断', () => {
  let spawned;

  beforeEach(() => {
    spawned = [];
    _setPtyImportForTests(makeImport(spawned));
  });

  afterEach(() => {
    killPty();
    _setPtyImportForTests(null);
  });

  it('shell onExit 时抛错的 exit listener 被吞，状态仍清空', async () => {
    killPty();
    await spawnShell();
    let good = null;
    const unsubBad = onPtyExit(() => { throw new Error('shell bad exit'); });
    const unsubGood = onPtyExit((code) => { good = code; });
    spawned[0]._emitExit(9);
    unsubBad();
    unsubGood();
    assert.equal(good, 9);
    assert.equal(getPtyState().running, false);
  });
});

// fixSpawnHelperPermissions 是私有函数，分支依赖 createRequire().resolve(子路径含 os.arch())
// 与目标文件权限位。本机 darwin-arm64 prebuild 永远 resolve 成功且已是 0o755，下述两条分支
// 在普通单测进程内不可达。改用子进程 + 自定义 ESM module loader 把 node:os 的 arch() 改成
// 可控假值：
//   - 假值无对应 prebuild → resolve 抛错 → 覆盖 catch return(112-114)
//   - 假值配合 NODE_PATH 指向一份无执行位的伪 node-pty prebuild → resolve 命中它，
//     !(mode & 0o111) 为真 → chmodSync 执行(117-119)
// 子进程 env 必须 spread process.env 以保留 NODE_V8_COVERAGE，覆盖记到同一份 canonical
// pty-manager.js URL，被父 test runner 合并计入。
describe('branch-pty-manager: fixSpawnHelperPermissions 子进程驱动私有分支', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccv-branch-ptyhelper-'));
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const ptyManagerUrl = new URL('../server/pty-manager.js', import.meta.url).href;
  const realOs = {
    platform: os.platform(), homedir: os.homedir(), tmpdir: os.tmpdir(),
    hostname: os.hostname(), EOL: os.EOL,
  };

  // 写 loader：拦截 node:os，仅把 arch() 改成 fakeArch，其余用真实常量值（避免递归 import node:os）。
  function writeLoader(fakeArch) {
    const loaderPath = join(dir, 'os-mock-loader.mjs');
    writeFileSync(loaderPath, [
      `const REAL = ${JSON.stringify(realOs)};`,
      `export async function resolve(specifier, context, next) {`,
      `  if (specifier === 'node:os' || specifier === 'os') return { url: 'ccv-mock-os:v1', shortCircuit: true };`,
      `  return next(specifier, context);`,
      `}`,
      `export async function load(url, context, next) {`,
      `  if (url === 'ccv-mock-os:v1') {`,
      `    const src = [`,
      `      'export const platform = () => ' + JSON.stringify(REAL.platform) + ';',`,
      `      'export const arch = () => ' + ${JSON.stringify(JSON.stringify(fakeArch))} + ';',`,
      `      'export const homedir = () => ' + JSON.stringify(REAL.homedir) + ';',`,
      `      'export const tmpdir = () => ' + JSON.stringify(REAL.tmpdir) + ';',`,
      `      'export const hostname = () => ' + JSON.stringify(REAL.hostname) + ';',`,
      `      'export const EOL = ' + JSON.stringify(REAL.EOL) + ';',`,
      `      'export const cpus = () => [];',`,
      `      'export const networkInterfaces = () => ({});',`,
      `      'const def = { platform, arch, homedir, tmpdir, hostname, EOL, cpus, networkInterfaces };',`,
      `      'export default def;',`,
      `    ].join('\\n');`,
      `    return { format: 'module', source: src, shortCircuit: true };`,
      `  }`,
      `  return next(url, context);`,
      `}`,
    ].join('\n'));
    const regPath = join(dir, 'register.mjs');
    writeFileSync(regPath, [
      `import { register } from 'node:module';`,
      `import { pathToFileURL } from 'node:url';`,
      `register(${JSON.stringify(loaderPath)}, pathToFileURL(${JSON.stringify(loaderPath)}));`,
    ].join('\n'));
    return regPath;
  }

  function writeRunner(fakeArch, extraLines = []) {
    const runPath = join(dir, 'run.mjs');
    writeFileSync(runPath, [
      `import os from 'node:os';`,
      `if (os.arch() !== ${JSON.stringify(fakeArch)}) { console.error('MOCK_FAILED'); process.exit(2); }`,
      `const mod = await import(${JSON.stringify(ptyManagerUrl)});`,
      `mod._setPtyImportForTests(() => ({`,
      `  spawn(command, args, opts) { return { pid: 1, command, args, opts, write(){}, resize(){}, kill(){}, onData(){}, onExit(){} }; },`,
      `}));`,
      `await mod.spawnClaude(9000, process.cwd(), [], '/bin/echo');`,
      `if (!mod.getPtyState().running) { console.error('NOT_RUNNING'); process.exit(3); }`,
      `mod.killPty();`,
      ...extraLines,
      `console.log('OK_DONE');`,
    ].join('\n'));
    return runPath;
  }

  it('os.arch 无对应 prebuild → resolve 抛错被 catch 吞，spawnClaude 仍成功(112-114)', () => {
    const regPath = writeLoader('ccvfakearch');
    const runPath = writeRunner('ccvfakearch');
    const res = spawnSync(process.execPath, ['--import', regPath, runPath], {
      env: { ...process.env }, encoding: 'utf-8', timeout: 60000,
    });
    assert.equal(res.status, 0, `子进程应成功退出，stderr=${res.stderr}`);
    assert.match(res.stdout, /OK_DONE/, 'resolve 失败被 catch 吞，流程继续');
  });

  // chmodSync 抛错的 catch(120-122)：伪 prebuild 的 spawn-helper 是指向 /dev/null 的符号链接，
  // resolve 跟随到 /dev/null(owner root, mode 0o666 无执行位) → !(mode & 0o111) 为真 →
  // 普通用户 chmodSync(/dev/null) 抛 EPERM → 进 catch(console.warn)。
  // root 用户能 chmod /dev/null 不抛，故 root 下此分支不可达 → 跳过。
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const itUnlessRoot = (isRoot || os.platform() === 'win32') ? it.skip : it;
  itUnlessRoot('chmodSync 失败被 catch 吞(120-122)', () => {
    const fakeArch = 'ccs';
    const helperDir = join(dir, 'np2', 'node-pty', 'prebuilds', `${realOs.platform}-${fakeArch}`);
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(dir, 'np2', 'node-pty', 'package.json'), '{"name":"node-pty","version":"0.0.0"}');
    // 符号链接指向 /dev/null（root 拥有、无执行位）；非 root chmod 抛 EPERM
    symlinkSync('/dev/null', join(helperDir, 'spawn-helper'));

    const regPath = writeLoader(fakeArch);
    const runPath = writeRunner(fakeArch);
    const res = spawnSync(process.execPath, ['--import', regPath, runPath], {
      env: { ...process.env, NODE_PATH: join(dir, 'np2') },
      encoding: 'utf-8', timeout: 60000,
    });
    assert.equal(res.status, 0, `子进程应成功退出，stderr=${res.stderr}`);
    // chmod EPERM 被 catch 吞，console.warn 打到 stderr，流程继续
    assert.match(res.stdout, /OK_DONE/, 'chmodSync 抛错被 catch 吞，spawnClaude 仍完成');
  });

  it('伪 prebuild 无执行位 → chmodSync 补执行位(117-119)', () => {
    const fakeArch = 'ccvtest';
    // 在私有目录造一份伪 node-pty 包，prebuild 子路径文件无执行位(0o644)
    const helperDir = join(dir, 'nodepath', 'node-pty', 'prebuilds', `${realOs.platform}-${fakeArch}`);
    mkdirSync(helperDir, { recursive: true });
    writeFileSync(join(dir, 'nodepath', 'node-pty', 'package.json'), '{"name":"node-pty","version":"0.0.0"}');
    const helperFile = join(helperDir, 'spawn-helper');
    writeFileSync(helperFile, 'fake-helper');
    fsChmodSync(helperFile, 0o644); // 无执行位 → 触发 !(mode & 0o111)

    const regPath = writeLoader(fakeArch);
    const runPath = writeRunner(fakeArch, [
      `import { statSync } from 'node:fs';`,
      `const m = statSync(${JSON.stringify(helperFile)}).mode & 0o111;`,
      `if (!m) { console.error('NOT_CHMODDED'); process.exit(4); }`,
      `console.log('HELPER_EXEC_BIT_SET');`,
    ]);
    const res = spawnSync(process.execPath, ['--import', regPath, runPath], {
      env: { ...process.env, NODE_PATH: join(dir, 'nodepath') },
      encoding: 'utf-8', timeout: 60000,
    });
    assert.equal(res.status, 0, `子进程应成功退出，stderr=${res.stderr}`);
    assert.match(res.stdout, /HELPER_EXEC_BIT_SET/, 'chmodSync 应给伪 helper 补上执行位');
    assert.match(res.stdout, /OK_DONE/);
  });
});
