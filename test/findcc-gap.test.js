// 覆盖 findcc.js 中既有 findcc.test.js 未触及的导出函数（in-process 直调，便于 c8 计入）：
//   - setLogDir()          —— 拒空/非串/非法目录、接受 /tmp 与 ~ 展开、live-binding 生效
//   - resolveCliPath()     —— 真实环境下返回 .../cli.js 路径
//   - resolveNpmClaudePath() —— which/command-v 命中 node_modules 软链 / 全局兜底 / 跳过非 nm 路径
//   - getGlobalNodeModulesDir() —— npm 缺失时返回 null（catch 分支）
//
// 手法：findcc.test.js 对 LOG_DIR/resolveNativePath 用子进程隔离；本文件改为 in-process，
// 通过临时覆写 process.env.PATH / NPM_CONFIG_PREFIX 隔离外部 claude/npm，after-each 还原，
// 避免污染同进程其它用例与真实日志目录。

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

import {
  setLogDir,
  resolveCliPath,
  resolveNpmClaudePath,
  getGlobalNodeModulesDir,
  pickSpawnableLookupResult,
  resolveClaudeFromPath,
  resolveCodeFuseClaudePath,
  DEFAULT_CODEFUSE_CLAUDE_VERSION,
  resolveExplicitClaudePath,
  readConfiguredClaudePath,
  resolveConfiguredClaudePath,
  resolvePreferredClaudeSelection,
  discoverClaudeExecutables,
  resolveNativePath,
  applyAgentTeamsDefault,
} from '../findcc.js';

// ─── 环境快照：所有改写 process.env 的用例跑完后必须还原 ───
const SAVED = {
  PATH: process.env.PATH,
  NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX,
  CCV_LOG_DIR: process.env.CCV_LOG_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
};

function restoreEnv() {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
}

after(() => { restoreEnv(); });

// ════════════════════════ setLogDir ════════════════════════
// setLogDir 改写 module-global live binding LOG_DIR。findcc.test.js 用子进程读 LOG_DIR，
// 不在本进程断言其值，因此这里 in-process 改写不会破坏那边；本块用 import 进来的 setLogDir
// 校验"接受/拒绝"语义，再用 import('../findcc.js') 动态读回 LOG_DIR 验证 live-binding。

describe('findcc: setLogDir 边界与安全约束', () => {
  let scratch;

  before(() => {
    scratch = mkdtempSync(join(tmpdir(), 'findcc-setlogdir-'));
  });

  afterEach(async () => {
    // 每个用例后把 LOG_DIR 重置回一个确定的合法值，避免跨用例串味
    setLogDir('/tmp/findcc-gap-reset');
  });

  after(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  async function readLogDir() {
    const mod = await import('../findcc.js');
    return mod.LOG_DIR;
  }

  it('忽略 undefined / 空串 / 纯空白 / 非字符串', async () => {
    setLogDir('/tmp/findcc-baseline');
    const baseline = await readLogDir();
    setLogDir();             // undefined
    assert.equal(await readLogDir(), baseline, 'undefined 不应改变 LOG_DIR');
    setLogDir('');           // 空串
    assert.equal(await readLogDir(), baseline, '空串不应改变 LOG_DIR');
    setLogDir('   ');        // 纯空白 → trim 后为空
    assert.equal(await readLogDir(), baseline, '纯空白不应改变 LOG_DIR');
    setLogDir(42);           // 非字符串
    assert.equal(await readLogDir(), baseline, '非字符串不应改变 LOG_DIR');
  });

  it('拒绝 home / /tmp 之外的路径（安全约束）', async () => {
    setLogDir('/tmp/findcc-before-reject');
    const before = await readLogDir();
    setLogDir('/etc/ccv-evil');
    assert.equal(await readLogDir(), before, '/etc 路径必须被拒，LOG_DIR 不变');
    setLogDir('/var/root/ccv');
    assert.equal(await readLogDir(), before, '/var 路径必须被拒，LOG_DIR 不变');
  });

  it('接受 /tmp/ 下的绝对路径并生效（live binding）', async () => {
    const dir = '/tmp/findcc-gap-accepted';
    setLogDir(dir);
    assert.equal(await readLogDir(), dir, 'LOG_DIR 应更新为 /tmp 下路径');
  });

  it('接受 home 目录下的路径', async () => {
    const dir = join(homedir(), '.findcc-gap-home-logs');
    setLogDir(dir);
    assert.equal(await readLogDir(), dir, 'home 下路径应被接受');
  });

  it('展开 ~/ 前缀为 homedir 后再做安全校验', async () => {
    setLogDir('~/findcc-gap-tilde');
    assert.equal(await readLogDir(), join(homedir(), 'findcc-gap-tilde'),
      '~/x 应展开为 <home>/x 并被接受');
  });

  it('returns boolean: true on accept — INCLUDING a path equal to the current LOG_DIR — false on reject', async () => {
    // Regression pin (2026-07-14): cli.js used to detect rejection by diffing
    // LOG_DIR before/after, which mis-rejected `--log-dir <current default>`
    // (a no-op change). setLogDir now returns the accept/reject verdict itself.
    const dir = '/tmp/findcc-gap-samevalue';
    assert.equal(setLogDir(dir), true, 'fresh valid path accepted');
    assert.equal(setLogDir(dir), true, 'SAME path again must still report accepted (the fixed bug)');
    assert.equal(await readLogDir(), dir);
    assert.equal(setLogDir('/etc/ccv-evil'), false, 'rejected path reports false');
    assert.equal(setLogDir(''), false, 'empty string reports false');
    assert.equal(setLogDir(undefined), false, 'undefined reports false');
    assert.equal(await readLogDir(), dir, 'rejections leave LOG_DIR untouched');
  });
});

// ════════════════════════ resolveCliPath ════════════════════════

describe('findcc: resolveCliPath', () => {
  it('返回以 cli.js 结尾的绝对路径字符串', () => {
    const p = resolveCliPath();
    assert.equal(typeof p, 'string');
    assert.ok(p.endsWith('cli.js'), `应以 cli.js 结尾: ${p}`);
    // 路径里必须含某个已知包名（@anthropic-ai/claude-code 或 @ali/claude-code）
    assert.ok(/@(anthropic-ai|ali)\/claude-code/.test(p), `应含已知包名: ${p}`);
  });
});

// ════════════════════════ getGlobalNodeModulesDir ════════════════════════

describe('findcc: getGlobalNodeModulesDir', () => {
  afterEach(() => { restoreEnv(); });

  it('npm 命令缺失时返回 null（catch 分支）', () => {
    // 隔离 PATH 到只含基本工具但不含 npm；execSync("npm root -g") 抛错 → 返回 null
    process.env.PATH = '/usr/bin:/bin';
    process.env.NPM_CONFIG_PREFIX = '/tmp/findcc-gap-fake-prefix-' + Date.now();
    assert.equal(getGlobalNodeModulesDir(), null);
  });
});

// ════════════════════════ resolveNpmClaudePath ════════════════════════
// 通过临时 PATH 覆写让 which/command -v 命中我们构造的 shim。shim 必须可执行，
// 否则 macOS 的 which 找不到。

describe('findcc: resolveNpmClaudePath', () => {
  let base;

  before(() => {
    base = mkdtempSync(join(tmpdir(), 'findcc-npm-'));
  });

  afterEach(() => { restoreEnv(); });

  after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('which 命中指向 node_modules 内 cli.js 的软链 → 返回该 cli.js', () => {
    const root = mkdtempSync(join(base, 'case1-'));
    const shimDir = join(root, 'shim');
    const pkgDir = join(root, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });
    const realCli = join(pkgDir, 'cli.js');
    writeFileSync(realCli, '#!/usr/bin/env node\n');
    chmodSync(realCli, 0o755);            // which 需要 target 可执行
    const shim = join(shimDir, 'claude');
    symlinkSync(realCli, shim);

    process.env.PATH = `${shimDir}:/usr/bin:/bin`;
    process.env.NPM_CONFIG_PREFIX = '/tmp/findcc-gap-fake-prefix-' + Date.now();

    const got = resolveNpmClaudePath();
    // macOS 上 /tmp realpath 为 /private/tmp，故用 endsWith 比对包内相对路径
    assert.ok(got && got.endsWith(join('@anthropic-ai', 'claude-code', 'cli.js')),
      `应解析到 node_modules 内的 cli.js，实得: ${got}`);
  });

  it('which 命中的二进制 realpath 不在 node_modules 内 → 跳过；无全局兜底则返回 null', () => {
    const root = mkdtempSync(join(base, 'case2-'));
    const shimDir = join(root, 'shim');
    mkdirSync(shimDir, { recursive: true });
    const fakeClaude = join(shimDir, 'claude');     // 直接是普通可执行，非 node_modules 软链
    writeFileSync(fakeClaude, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeClaude, 0o755);

    // PATH 不含 npm → 全局兜底 getGlobalNodeModulesDir() 返回 null → 整体 null
    process.env.PATH = `${shimDir}:/usr/bin:/bin`;
    process.env.NPM_CONFIG_PREFIX = '/tmp/findcc-gap-fake-prefix-' + Date.now();

    assert.equal(resolveNpmClaudePath(), null,
      'realpath 不在 node_modules 内的 claude 应被跳过，且无全局兜底 → null');
  });

  it('which 全部 miss 时走全局 node_modules 兜底（fake npm 报告 gnm 内含包）', () => {
    const root = mkdtempSync(join(base, 'case3-'));
    const binDir = join(root, 'bin');
    const gnm = join(root, 'gnm');
    const pkgDir = join(gnm, '@anthropic-ai', 'claude-code');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'cli.js'), '#!/usr/bin/env node\n');
    // 伪造 npm：`npm root -g` 打印我们的 gnm 路径
    const fakeNpm = join(binDir, 'npm');
    writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
    chmodSync(fakeNpm, 0o755);

    // PATH 含 fake npm，但无任何 claude → step1 全 miss → step2 兜底命中
    process.env.PATH = `${binDir}:/usr/bin:/bin`;
    delete process.env.NPM_CONFIG_PREFIX;

    // This test exercises the step-2 npm-root-g fallback IN-PROCESS, which the L7 lookup
    // gate blocks under NODE_TEST_CONTEXT — open the sanctioned escape door for this one
    // assertion (same idiom as im-spawn-test-guard's CCV_TEST_ALLOW_IM_SPAWN).
    process.env.CCV_TEST_ALLOW_REAL_CLAUDE = '1';
    try {
      const got = resolveNpmClaudePath();
      assert.equal(got, join(pkgDir, 'cli.js'),
        `应从 fake npm 报告的全局 node_modules 兜底找到 cli.js，实得: ${got}`);
      // 顺带验证 getGlobalNodeModulesDir 也走通 fake npm
      assert.equal(getGlobalNodeModulesDir(), gnm);
    } finally {
      delete process.env.CCV_TEST_ALLOW_REAL_CLAUDE;
    }
  });

  // ── Claude Code 2.x 布局（无 cli.js，bin/claude.exe 即入口；2.1.x 在 macOS 上
  //    package.json bin 映射也是 bin/claude.exe——真实布局已在本机核实）──
  it('2.x 全局兜底：无 cli.js、有 bin/claude.exe → 返回该 bin 路径', () => {
    const root = mkdtempSync(join(base, 'case4-'));
    const binDir = join(root, 'bin');
    const gnm = join(root, 'gnm');
    const pkgDir = join(gnm, '@anthropic-ai', 'claude-code');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    writeFileSync(join(pkgDir, 'bin', 'claude.exe'), 'fake-native-binary');
    const fakeNpm = join(binDir, 'npm');
    writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
    chmodSync(fakeNpm, 0o755);

    process.env.PATH = `${binDir}:/usr/bin:/bin`;
    delete process.env.NPM_CONFIG_PREFIX;
    process.env.CCV_TEST_ALLOW_REAL_CLAUDE = '1';
    try {
      const got = resolveNpmClaudePath();
      assert.equal(got, join(pkgDir, 'bin', 'claude.exe'),
        `2.x 布局应回退到 bin/claude.exe，实得: ${got}`);
    } finally {
      delete process.env.CCV_TEST_ALLOW_REAL_CLAUDE;
    }
  });

  it('2.x which 命中支：软链 realpath 落在包内、无 cli.js、有 bin/claude → 返回该 bin', () => {
    const root = mkdtempSync(join(base, 'case5-'));
    const shimDir = join(root, 'shim');
    const pkgDir = join(root, 'node_modules', '@anthropic-ai', 'claude-code');
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(join(pkgDir, 'bin'), { recursive: true });
    const realBin = join(pkgDir, 'bin', 'claude');
    writeFileSync(realBin, '#!/bin/sh\nexit 0\n');
    chmodSync(realBin, 0o755);
    symlinkSync(realBin, join(shimDir, 'claude'));

    process.env.PATH = `${shimDir}:/usr/bin:/bin`;
    process.env.NPM_CONFIG_PREFIX = '/tmp/findcc-gap-fake-prefix-' + Date.now();

    const got = resolveNpmClaudePath();
    assert.ok(got && got.endsWith(join('@anthropic-ai', 'claude-code', 'bin', 'claude')),
      `2.x which 命中支应回退到包内 bin/claude，实得: ${got}`);
  });
});

// ════════════════ pickSpawnableLookupResult（error 193 修复） ════════════════
// Windows `where claude` 输出首行常是 npm 的无扩展名 sh shim（#!/bin/sh 文本），
// 其后是 .cmd/.ps1 —— 都不是 PE，ConPTY 直接 spawn 报 "error code: 193"。
// win32 必须只挑 .exe 行；POSIX 维持取首行的旧语义。

describe('findcc: resolveClaudeFromPath', () => {
  let base;

  before(() => {
    base = mkdtempSync(join(tmpdir(), 'findcc-path-first-'));
  });

  afterEach(() => { restoreEnv(); });

  after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('prefers a wrapper-managed native executable outside node_modules', () => {
    const binDir = mkdtempSync(join(base, 'native-'));
    const managedClaude = join(binDir, 'claude');
    writeFileSync(managedClaude, '#!/bin/sh\nexit 0\n');
    chmodSync(managedClaude, 0o755);
    process.env.PATH = `${binDir}:/usr/bin:/bin`;

    assert.deepEqual(resolveClaudeFromPath(), {
      path: managedClaude,
      isNpmVersion: false,
    });
  });

  it('resolves a legacy npm symlink to cli.js and marks it for Node', () => {
    const root = mkdtempSync(join(base, 'legacy-'));
    const binDir = join(root, 'bin');
    const pkgDir = join(root, 'node_modules', '@anthropic-ai', 'claude-code');
    const cliPath = join(pkgDir, 'cli.js');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(cliPath, '#!/usr/bin/env node\n');
    chmodSync(cliPath, 0o755);
    symlinkSync(cliPath, join(binDir, 'claude'));
    process.env.PATH = `${binDir}:/usr/bin:/bin`;

    const selected = resolveClaudeFromPath();
    assert.ok(selected?.path.endsWith(join('@anthropic-ai', 'claude-code', 'cli.js')),
      `expected the real cli.js path, got ${selected?.path}`);
    assert.equal(selected?.isNpmVersion, true);
  });
});

describe('findcc: resolveCodeFuseClaudePath', () => {
  it('finds only the pinned CodeFuse-managed 2.1.199 build', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-codefuse-'));
    try {
      const approvedDir = join(root, DEFAULT_CODEFUSE_CLAUDE_VERSION);
      const newerDir = join(root, '2.1.217');
      mkdirSync(approvedDir, { recursive: true });
      mkdirSync(newerDir, { recursive: true });
      writeFileSync(join(approvedDir, 'claude'), 'approved');
      writeFileSync(join(newerDir, 'claude'), 'not-yet-approved');

      assert.equal(resolveCodeFuseClaudePath(root), join(approvedDir, 'claude'));
      assert.equal(resolveCodeFuseClaudePath(root, '2.1.217'), join(newerDir, 'claude'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid version selectors and missing approved builds', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-codefuse-missing-'));
    try {
      assert.equal(resolveCodeFuseClaudePath(root), null);
      assert.equal(resolveCodeFuseClaudePath(root, '../2.1.199'), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('findcc: configured Claude executable', () => {
  it('reads and resolves the persisted machine-level executable path', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-configured-'));
    try {
      const executable = join(root, 'claude');
      const prefsFile = join(root, 'preferences.json');
      writeFileSync(executable, '#!/bin/sh\nexit 0\n');
      chmodSync(executable, 0o755);
      writeFileSync(prefsFile, JSON.stringify({ claudeExecutablePath: executable }));

      assert.equal(readConfiguredClaudePath(prefsFile), executable);
      assert.deepEqual(resolveConfiguredClaudePath(prefsFile), {
        path: executable,
        realPath: realpathSync(executable),
        isNpmVersion: false,
      });
      assert.deepEqual(resolveExplicitClaudePath(executable), {
        path: executable,
        realPath: realpathSync(executable),
        isNpmVersion: false,
      });
      assert.deepEqual(resolvePreferredClaudeSelection({ prefsFile }), {
        path: executable,
        realPath: realpathSync(executable),
        isNpmVersion: false,
        source: 'configured',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns null for a missing/invalid configured path', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-configured-missing-'));
    try {
      const prefsFile = join(root, 'preferences.json');
      writeFileSync(prefsFile, JSON.stringify({ claudeExecutablePath: join(root, 'missing') }));
      assert.equal(resolveConfiguredClaudePath(prefsFile), null);
      assert.equal(resolveExplicitClaudePath(''), null);
      assert.deepEqual(resolvePreferredClaudeSelection({ prefsFile }), {
        error: 'configured-invalid',
        configuredPath: join(root, 'missing'),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('collects a configured candidate without touching real machine locations in tests', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-discovery-'));
    try {
      const executable = join(root, 'claude.exe');
      writeFileSync(executable, 'fixture');
      chmodSync(executable, 0o755);
      const candidates = discoverClaudeExecutables({
        configuredPath: executable,
        includeDefaults: false,
      });
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].path, executable);
      assert.equal(candidates[0].source, 'configured');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects relative paths and non-executable POSIX files', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-configured-perms-'));
    try {
      const executable = join(root, 'claude');
      writeFileSync(executable, '#!/bin/sh\nexit 0\n');
      chmodSync(executable, 0o644);
      assert.equal(resolveExplicitClaudePath('relative/claude'), null);
      if (process.platform !== 'win32') assert.equal(resolveExplicitClaudePath(executable), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects Windows shell shims but accepts an .exe entry', () => {
    if (process.platform !== 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'findcc-configured-win-'));
    try {
      const cmd = join(root, 'claude.cmd');
      const exe = join(root, 'claude.exe');
      writeFileSync(cmd, 'fixture');
      writeFileSync(exe, 'fixture');
      assert.equal(resolveExplicitClaudePath(cmd), null);
      assert.equal(resolveExplicitClaudePath(exe)?.isNpmVersion, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('findcc: pickSpawnableLookupResult win32 只接受 .exe', () => {
  it('win32：跳过 sh shim / .cmd / .ps1，选中 .exe 行', () => {
    const out = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude\r\n'
      + 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd\r\n'
      + 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.ps1\r\n'
      + 'C:\\Users\\x\\.local\\bin\\claude.exe\r\n';
    assert.equal(pickSpawnableLookupResult(out, 'win32'), 'C:\\Users\\x\\.local\\bin\\claude.exe');
  });

  it('win32：扩展名大小写不敏感（CLAUDE.EXE 也接受）', () => {
    assert.equal(pickSpawnableLookupResult('C:\\bin\\CLAUDE.EXE\r\n', 'win32'), 'C:\\bin\\CLAUDE.EXE');
  });

  it('win32：全是非 PE shim 时返回 null（让后续候选路径兜底，而不是抱回 193）', () => {
    const out = 'C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\n';
    assert.equal(pickSpawnableLookupResult(out, 'win32'), null);
  });

  it('POSIX：维持取首行旧语义', () => {
    assert.equal(pickSpawnableLookupResult('/usr/local/bin/claude\n', 'darwin'), '/usr/local/bin/claude');
  });

  it('空/空白输出返回 null', () => {
    assert.equal(pickSpawnableLookupResult('', 'win32'), null);
    assert.equal(pickSpawnableLookupResult('\r\n\r\n', 'win32'), null);
    assert.equal(pickSpawnableLookupResult(null, 'darwin'), null);
  });
});

// ═══════════ resolveNativePath win32 候选路径 .exe 变体（原生安装器布局） ═══════════
// Windows 原生安装器（install.ps1）落 ~/.local/bin/claude.exe；无扩展名候选在 win32
// 上永远 miss。用 CLAUDE_CONFIG_DIR 重定向 ~/.claude/local 候选到临时目录验证 .exe 补查。

describe('findcc: resolveNativePath win32 候选 .exe 变体', () => {
  const origPlatform = process.platform;
  function setPlatform(p) { Object.defineProperty(process, 'platform', { value: p, configurable: true }); }

  it('win32 下 ~/.claude/local/claude.exe（仅 .exe 存在）可被发现', () => {
    const root = mkdtempSync(join(tmpdir(), 'findcc-exe-variant-'));
    mkdirSync(join(root, 'local'), { recursive: true });
    writeFileSync(join(root, 'local', 'claude.exe'), 'MZ-fake');
    // 隔离：PATH 砍空让 npm root -g 与 where/which 全失败 → step1/2 miss；
    // CLAUDE_CONFIG_DIR 指到临时目录让 ~/.claude/local 候选落进我们的 fixture。
    process.env.PATH = '';
    delete process.env.NPM_CONFIG_PREFIX;
    process.env.CLAUDE_CONFIG_DIR = root;
    setPlatform('win32');
    try {
      assert.equal(resolveNativePath(), join(root, 'local', 'claude.exe'));
    } finally {
      setPlatform(origPlatform);
      restoreEnv();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══════════ applyAgentTeamsDefault：启动期默认开启 agent-teams，尊重显式配置 ═══════════
// 默认把 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 置 '1'，但当用户已通过 shell env（任意值，
// 含 '0'）或 settings.json 的 env 块显式配置时，一律不覆盖——让 settings.json 对 UI 与
// 真正的 claude 进程都保持权威，避免 UI 显示关闭而进程仍强开的分歧。
describe('findcc: applyAgentTeamsDefault', () => {
  const KEY = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';
  let root;
  function setup() {
    root = mkdtempSync(join(tmpdir(), 'agentteams-default-'));
    process.env.CLAUDE_CONFIG_DIR = root;
    delete process.env[KEY];
  }
  function teardown() {
    restoreEnv();
    delete process.env[KEY];
    if (root) rmSync(root, { recursive: true, force: true });
  }

  it('unset + 无 settings.json → 默认置 "1"', () => {
    setup();
    try {
      applyAgentTeamsDefault();
      assert.equal(process.env[KEY], '1');
    } finally { teardown(); }
  });

  it('shell env 显式 "0" → 保留（不覆盖）', () => {
    setup();
    process.env[KEY] = '0';
    try {
      applyAgentTeamsDefault();
      assert.equal(process.env[KEY], '0');
    } finally { teardown(); }
  });

  it('shell env 显式 "1" → 保留', () => {
    setup();
    process.env[KEY] = '1';
    try {
      applyAgentTeamsDefault();
      assert.equal(process.env[KEY], '1');
    } finally { teardown(); }
  });

  it('settings.json env 显式配置该键（"0"）→ 不注入默认（保持 undefined，交给 settings.json 权威）', () => {
    setup();
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ env: { [KEY]: '0' } }));
    try {
      applyAgentTeamsDefault();
      assert.equal(process.env[KEY], undefined);
    } finally { teardown(); }
  });

  it('settings.json 存在但无该键 → 仍置默认 "1"', () => {
    setup();
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ env: { FOO: 'bar' } }));
    try {
      applyAgentTeamsDefault();
      assert.equal(process.env[KEY], '1');
    } finally { teardown(); }
  });

  it('settings.json 非法 JSON → 吞掉错误并落默认 "1"', () => {
    setup();
    writeFileSync(join(root, 'settings.json'), '{ not valid json');
    try {
      applyAgentTeamsDefault();
      assert.equal(process.env[KEY], '1');
    } finally { teardown(); }
  });
});
