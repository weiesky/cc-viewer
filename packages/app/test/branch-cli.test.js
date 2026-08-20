// branch-cli: cli.js BRANCH 覆盖补强（单跑合并口径）。
//
// 既有 cli*.test.js 覆盖了 runCliMode/runSdkMode 启动主体、-logger npm/native、--uninstall、参数解析，
// 但合并口径下仍有若干分支未命中。本文件只攻**可达且不引入平台专属死分支**的剩余分支：
//
//   A. 顶层参数派发三元的 `--ad` 中段（853 SDK / 860 PTY）。map 在 run*Mode 早退前同一表达式内已求值，
//      故「claude 找不到」干净早退即可命中（不起 server）。这两行恒执行 → 只增 BRH 不增 BRF。
//   B. getShellConfigPath 的 `SHELL||''` 空臂（56）、installShellHook 的 `existsSync(cfg)?read:''`
//      空臂（159）+ 差异重装重读（168-171）—— 走本机 native `-logger` / `--uninstall`（无 server，cheap）。
//   C. --uninstall 移除 managed hook 的 `if(removed>0)` 真臂 + `removed===1?'y':'ies'` 三元两臂（743-745）
//      —— settings.json 预置 1 个 / 2 个带 `# cc-viewer-managed` marker 的 hook command。
//   D. runImMode 全程启动 + updateImLockPort 回填真实端口（351 死线三元 IM 臂、371 IM 回填块、457 exit
//      释放锁）。IM worker 用 noOpen=true → **不进浏览器块** → 不引入 darwin 上不可达的 win32 平台臂。
//      私有端口窗经 CCV_START_PORT/CCV_MAX_PORT 注入覆盖默认 7050-7099。
//
// 刻意不做：runCliMode/runSdkMode 不带 --no-open 的「浏览器打开块」（395-407 / 558-570）。该块在 darwin
//   上每进入一次就把 win32 / xdg-open 平台臂塞进分支分母却无法命中（hit 率 ~50%），净拉低 branch%；
//   故本文件一律早退 / noOpen=true 回避它。
//
// 隔离：临时 HOME/CCV_LOG_DIR/CLAUDE_CONFIG_DIR（mkdtemp）；cheap 用例剥离 PATH 制造 claude-not-found；
//   IM 用例用 fake npm（`npm root -g`→自建 gnm）+ fake 常驻 claude（同 cli-boot）。spawn env 一律
//   spread process.env 保留 NODE_V8_COVERAGE。waitUntil 轮询替代固定 sleep；LIVE set 登记子进程，
//   after() SIGKILL 兜底 + 清临时目录。
//
// 放过（见返回 notes）：win32-only 臂（L4 UV_THREADPOOL / 浏览器块 win32 分支，macOS 不可达）；
//   IM 端口 30s 死线 reject（357-364，需 30s 等待 + 占满端口窗，太重）；updateImLockPort catch（376-377，
//   需 im-lock 写失败）；spawnClaude reject catch（385-388，需特制 PTY 失败）；SDK onTurnEnd（538-543，
//   需真实 SDK turn）；版本读取失败（706-707，需 fs 注入）；-logger npm ENOENT（812-814，existsSync 守卫
//   后 readFileSync 必成功 → TOCTOU 不可达）；native hook catch（834-837，installShellHook 内部已
//   try/catch 不外抛 → 死）；`cwd||process.cwd()`（318/485，派发恒传 process.cwd() → 备路不可达）；
//   password 空臂（420/583，server 不会解析出空密码）；reportClaudeNotFound 2.x-wrapper 臂（37-50，需伪造）。

import { describe, it, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_PATH = resolve(REPO_ROOT, 'packages', 'app', 'cli.js');

// ──────────────── 进程 / 临时目录卫生 ────────────────
const LIVE = new Set();
const tmpDirs = [];

function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// 守卫兜底:spawn 字面量里始终先给 CCV_LOG_DIR 默认值(调用方 env 可覆盖),
// 保证任何 fixture 漏配时子进程也绝不落真实 ~/.claude/cc-viewer(2026-06-06 事故防再犯)。
const GUARD_FALLBACK_LOG_DIR = mkTmp('ccv-branch-cli-guard-');

after(() => {
  for (const child of LIVE) {
    try { child.kill('SIGKILL'); } catch {}
  }
  LIVE.clear();
  for (const d of tmpDirs) {
    try { chmodSync(d, 0o755); } catch {}
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

// ──────────────── cheap：execFileSync 起子进程（无 server），永不抛 ────────────────
// env 中值为 undefined 的键表示"从父环境删除该变量"（用于制造 SHELL 缺失等）。
function runCli(args = [], opts = {}) {
  const env = { CCV_LOG_DIR: 'tmp', ...process.env, ...opts.env };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf-8', timeout: opts.timeout || 30000, env, cwd: opts.cwd || REPO_ROOT,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status ?? `signal:${err.signal}` };
  }
}

// "claude 完全找不到"的 env：剥离 PATH、fake HOME、无真实 npm prefix、隔离 CLAUDE_CONFIG_DIR。
function noClaudeEnv(extra = {}) {
  const home = mkTmp('ccv-branch-noclaude-');
  return {
    PATH: '/usr/bin:/bin',
    HOME: home,
    SHELL: '/bin/zsh',
    NPM_CONFIG_PREFIX: join(home, 'noprefix'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CCV_LOG_DIR: mkTmp('ccv-branch-noclaude-log-'),
    ...extra,
  };
}

// 本机 2.x native 安装下的 npm-mode -logger fixture：fake npm + 全局 cli.js（带 CC Viewer marker →
// injectCliJs 视为 exists、不改它；mode='npm'）。用于驱动 installShellHook(false) 的两种 config 读分支。
function npmLoggerFixture() {
  const root = mkTmp('ccv-branch-logger-');
  const bin = join(root, 'bin');
  const gnm = join(root, 'gnm');
  const pkg = join(gnm, '@anthropic-ai', 'claude-code');
  const home = join(root, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(pkg, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(pkg, 'cli.js'), '#!/usr/bin/env node\n// CC Viewer injected\nconsole.log("x");\n');
  const fakeNpm = join(bin, 'npm');
  writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
  chmodSync(fakeNpm, 0o755);
  return { root, bin, gnm, home };
}

// ════════════════════ A. 参数派发 --ad 三元中段（853 SDK / 860 PTY）════════════════════
describeCli('branch-cli: 参数派发 --ad 三元中段（853/860）', () => {
  it('PTY 默认模式 `--ad`：args.map 命中 --ad 中段后 claude-not-found 早退', () => {
    // --no-open: defense in depth on top of the L7 sandbox — this run reaches the
    // browser-open decision point if claude resolution ever regresses.
    const r = runCli(['--ad', '--no-open'], { env: noClaudeEnv() });
    assert.equal(r.exitCode, 1, 'claude 找不到应 exit 1');
    assert.ok(/not found|claude/i.test(r.stderr + r.stdout), '应报 claude not found');
  });

  it('SDK 模式 `-SDK --ad`：args.filter+map 命中 --ad 中段后 SDK fallback → 早退', () => {
    // SDK 在仓库可用 → -SDK 进 runSdkMode；让 agent-sdk import 失败 → fallback 到 runCliMode →
    // claude-not-found exit 1（dispatch 的 filter+map 三元已先求值）。
    const blockDir = mkTmp('ccv-branch-sdkblock-');
    writeFileSync(join(blockDir, 'block.mjs'),
      "export async function resolve(specifier, context, next) {\n" +
      "  if (specifier === '@anthropic-ai/claude-agent-sdk') throw new Error('blocked-sdk-for-test');\n" +
      "  return next(specifier, context);\n" +
      "}\n");
    writeFileSync(join(blockDir, 'register.mjs'),
      "import { register } from 'node:module';\nregister('./block.mjs', import.meta.url);\n");
    const r = runCli(['-SDK', '--ad', '--no-open'], {
      env: noClaudeEnv({ NODE_OPTIONS: `--import ${join(blockDir, 'register.mjs')}` }),
    });
    assert.equal(r.exitCode, 1, 'SDK 不可用 fallback 后 claude 找不到应 exit 1');
  });
});

// ════════════════════ B. getShellConfigPath / installShellHook 的 cheap 读分支（56 / 159 / 171）════════════════════
describeCli('branch-cli: getShellConfigPath / installShellHook 读分支（56 / 159 / 171）', () => {
  it('--uninstall 且 SHELL 未设置 → getShellConfigPath 走 SHELL||\'\' 空臂（56），默认 .zshrc，exit 0', () => {
    const home = mkTmp('ccv-branch-noshell-');
    writeFileSync(join(home, '.zshrc'), '# empty\n');
    const r = runCli(['--uninstall'], {
      env: { HOME: home, SHELL: undefined, CLAUDE_CONFIG_DIR: join(home, '.claude'), CCV_LOG_DIR: mkTmp('ccv-branch-noshell-log-') },
    });
    assert.equal(r.exitCode, 0, `SHELL 缺失时 --uninstall 应干净退出；实得 ${r.exitCode}`);
    assert.ok(r.stdout.length > 0, '应有 uninstall 输出');
  });

  it('npm -logger 且 fakeHOME 无 .zshrc → installShellHook 走 existsSync?:\'\' 空臂（159），写出 hook', () => {
    const fx = npmLoggerFixture(); // 不创建 .zshrc → existsSync(configPath)=false → 空臂
    const r = runCli(['-logger'], {
      env: {
        PATH: `${fx.bin}:/usr/bin:/bin`, HOME: fx.home, SHELL: '/bin/zsh',
        CLAUDE_CONFIG_DIR: join(fx.home, '.claude'), CCV_LOG_DIR: mkTmp('ccv-branch-logger-log-'),
      },
    });
    assert.equal(r.exitCode, 0, `-logger npm 模式应 exit 0；实得 ${r.exitCode} out=${r.stdout}${r.stderr}`);
    const zshrc = join(fx.home, '.zshrc');
    assert.ok(existsSync(zshrc), 'installShellHook 应新建 .zshrc');
    assert.ok(readFileSync(zshrc, 'utf-8').includes('CC-Viewer Auto-Inject'), 'hook 应写入');
  });

  it('npm -logger 且 .zshrc 含「不同的」旧 hook → 走重装重读臂（168-171）后重装', () => {
    const fx = npmLoggerFixture();
    // marker 在场但内容陈旧 → installShellHook 命中 includes(START) 但 existingMatch[0]!==hook →
    // removeShellHook() + 重读 content（171 existsSync?read:''）后重装。
    writeFileSync(join(fx.home, '.zshrc'),
      '# user\n# >>> CC-Viewer Auto-Inject >>>\nclaude() { echo STALE; }\n# <<< CC-Viewer Auto-Inject <<<\n');
    const r = runCli(['-logger'], {
      env: {
        PATH: `${fx.bin}:/usr/bin:/bin`, HOME: fx.home, SHELL: '/bin/zsh',
        CLAUDE_CONFIG_DIR: join(fx.home, '.claude'), CCV_LOG_DIR: mkTmp('ccv-branch-logger-log2-'),
      },
    });
    assert.equal(r.exitCode, 0, `-logger npm 重装应 exit 0；实得 ${r.exitCode}`);
    const after = readFileSync(join(fx.home, '.zshrc'), 'utf-8');
    assert.ok(after.includes('CC-Viewer Auto-Inject'), '重装后 hook 仍在');
    assert.ok(!after.includes('STALE'), '陈旧 hook 体应被替换');
    assert.ok(after.includes('# user'), '用户内容应保留');
  });
});

// ════════════════════ C. --uninstall 移除 managed hook：743-745 if(removed>0) 真臂 + 三元两臂 ════════════════════
// settings.json 内带 `# cc-viewer-managed` marker 的 hook command 会被 removeAllManagedHooks 移除，
// removed>0 → 进 744-745 块；removed===1 → 'entry'(单数)、removed>1 → 'entries'(复数)。两用例覆盖两臂。
function uninstallWithManagedHooks(count) {
  const home = mkTmp(`ccv-branch-uninst${count}-`);
  const cfg = join(home, '.claude');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(home, '.zshrc'), '# empty\n');
  const mk = (n) => ({ matcher: '*', hooks: [{ type: 'command', command: `node /x/${n}.js # cc-viewer-managed` }] });
  const hooks = { PreToolUse: [mk('a')] };
  if (count >= 2) hooks.Stop = [mk('b')];
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ hooks }, null, 2));
  const r = runCli(['--uninstall'], {
    env: { HOME: home, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: cfg, CCV_LOG_DIR: mkTmp(`ccv-branch-uninst${count}-log-`) },
  });
  return { r, cfg };
}

describeCli('branch-cli: --uninstall 清理 managed hook（743-745 两臂）', () => {
  it('settings.json 恰含 1 个 managed hook → removed===1 \'entry\' 单数臂', () => {
    const { r, cfg } = uninstallWithManagedHooks(1);
    assert.equal(r.exitCode, 0, `--uninstall 应 exit 0；实得 ${r.exitCode} out=${r.stdout}`);
    assert.ok(/Removed 1 .*entry/.test(r.stdout), `应打印 "Removed 1 ... entry"（单数）；实得:\n${r.stdout}`);
    const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf-8'));
    assert.ok(!(settings.hooks?.PreToolUse?.length), 'PreToolUse managed hook 应被移除');
  });

  it('settings.json 含 2 个 managed hook → removed>1 \'entries\' 复数臂', () => {
    const { r } = uninstallWithManagedHooks(2);
    assert.equal(r.exitCode, 0, `--uninstall 应 exit 0；实得 ${r.exitCode}`);
    assert.ok(/Removed 2 .*entries/.test(r.stdout), `应打印 "Removed 2 ... entries"（复数）；实得:\n${r.stdout}`);
  });
});

// ════════════════════ D. IM worker 全程启动 → updateImLockPort 回填端口（351/371/457）════════════════════
function waitUntil(cond, { timeoutMs = 30000, intervalMs = 50, label = 'condition' } = {}) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const tick = async () => {
      let ok = false;
      try { ok = await cond(); } catch (e) { return rej(e); }
      if (ok) return res(true);
      if (Date.now() - start > timeoutMs) return rej(new Error(`waitUntil timeout (${timeoutMs}ms): ${label}`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

function portFree(port, host = '127.0.0.1') {
  return new Promise((res) => {
    const sock = net.connect({ port, host });
    let settled = false;
    const done = (free) => { if (settled) return; settled = true; sock.destroy(); res(free); };
    sock.once('connect', () => done(false));
    sock.once('error', () => done(true));
    setTimeout(() => done(true), 1500);
  });
}

function imFixture({ startPort, endPort }) {
  const root = mkTmp('ccv-branch-im-');
  const bin = join(root, 'bin');
  const gnm = join(root, 'gnm');
  const pkg = join(gnm, '@anthropic-ai', 'claude-code');
  const home = join(root, 'home');
  const logDir = join(root, 'log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(pkg, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  writeFileSync(join(pkg, 'cli.js'),
    '#!/usr/bin/env node\nprocess.stdout.write("FAKE_CLAUDE_UP\\n");\nprocess.stdin.resume();\nsetInterval(() => {}, 1 << 30);\n');
  const fakeNpm = join(bin, 'npm');
  writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
  chmodSync(fakeNpm, 0o755);
  writeFileSync(join(home, '.zshrc'), '# zshrc\n');

  const env = {
    ...process.env, // 保留 NODE_V8_COVERAGE
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    SHELL: '/bin/zsh',
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    // L7 escape hatch: the fake resident claude is discovered through the fake
    // `npm root -g` seam (resolveNpmClaudePath step 2), which the lookup gate
    // blocks by default. Safety does NOT come from the sanitized PATH alone —
    // with the gate off, resolveNativePath's absolute candidates ignore PATH —
    // but from resolution ORDERING: cli.js consults resolveNpmClaudePath first
    // and the fake npm reliably satisfies it, so the native fallback never runs.
    CCV_TEST_ALLOW_REAL_CLAUDE: '1',
    CCV_LOG_DIR: logDir,
    CCV_START_PORT: String(startPort),
    CCV_MAX_PORT: String(endPort),
    CCV_HOST: '127.0.0.1',
    CCV_IM_PLATFORM: undefined,
    CCV_CLI_MODE: undefined,
    CCV_SDK_MODE: undefined,
    CCV_PROXY_MODE: undefined,
    CCV_BASE_PATH: undefined,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return { home, logDir, env };
}

async function bootAndSignal({ args, env, cwd, signal = 'SIGINT', markerRe = /CC Viewer/ }) {
  const child = spawn(process.execPath, [CLI_PATH, ...args], { env: { CCV_LOG_DIR: GUARD_FALLBACK_LOG_DIR, ...env }, cwd: cwd || REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  LIVE.add(child);
  let out = '';
  let exited = false;
  let exitInfo = { code: null, sig: null };
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('exit', (code, sig) => { exited = true; exitInfo = { code, sig }; });
  try {
    await waitUntil(() => markerRe.test(out) || exited, { timeoutMs: 40000, intervalMs: 50, label: `boot marker (${markerRe})` });
    assert.ok(!exited, `cli.js 应在 boot 完成前存活；提前退出 out=\n${out.slice(-700)}`);
    assert.ok(markerRe.test(out), `应打印 marker ${markerRe}，实得:\n${out.slice(-700)}`);
    child.kill(signal);
    await waitUntil(() => exited, { timeoutMs: 20000, intervalMs: 50, label: 'process exit after signal' });
    return { stdout: out, exitCode: exitInfo.code, signal: exitInfo.sig };
  } finally {
    if (!exited) {
      try { child.kill('SIGKILL'); } catch {}
      try { await waitUntil(() => exited, { timeoutMs: 8000, intervalMs: 50, label: 'sigkill exit' }); } catch {}
    }
    LIVE.delete(child);
  }
}

function parseLocalPort(out) {
  const m = out.match(/Local:\s+https?:\/\/127\.0\.0\.1:(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

describeCli('branch-cli: --im 全程启动 → updateImLockPort 回填端口（351/371/457）', { concurrency: false }, () => {
  it('--im dingtalk：建 IM_dingtalk/ + 取锁 + server 启动 + 回填 im.lock 端口，SIGINT exit 0', async () => {
    const fx = imFixture({ startPort: 18868, endPort: 18871 });
    const r = await bootAndSignal({ args: ['--im', 'dingtalk'], env: fx.env, signal: 'SIGINT', markerRe: /CC Viewer:/ });

    assert.equal(r.exitCode, 0, `IM SIGINT cleanup 应 exit 0；实得 code=${r.exitCode} sig=${r.signal}`);
    assert.ok(existsSync(join(fx.logDir, 'IM_dingtalk')), 'runImMode 应建 IM_dingtalk/');
    assert.ok(existsSync(join(fx.logDir, 'IM_dingtalk', 'CC_APPEND_SYSTEM.md')), 'ensureImAppendSystem 应写默认 CC_APPEND_SYSTEM.md');
    assert.ok(/Local:\s+http:\/\/127\.0\.0\.1:188\d\d/.test(r.stdout), '应打印 Local URL（server 启动成功）');
    const boundPort = parseLocalPort(r.stdout);
    assert.ok(boundPort >= 18868 && boundPort <= 18871, `IM 端口应在私有子窗，实得 ${boundPort}`);
    await waitUntil(() => portFree(boundPort), { timeoutMs: 8000, intervalMs: 100, label: `im port ${boundPort} freed` });
    assert.ok(await portFree(boundPort), `退出后 IM 端口 ${boundPort} 应释放`);
  });
});

// ── IM 全局唯一锁竞争：锁被活进程持有时第二个 --im 拒绝启动 → exit 3（451 真臂 + 452-453）──
describeCli('branch-cli: --im 锁竞争 → 第二实例 exit 3（451-453）', { concurrency: false }, () => {
  it('同 LOG_DIR 下并发两个 --im dingtalk：先到者持锁，后到者 acquireImLock 失败 → exit 3', async () => {
    // 复用同一 fixture（同 home/logDir → 同 im.lock 路径）让两实例竞争同一把锁。
    const fx = imFixture({ startPort: 18872, endPort: 18875 });

    // 第一实例：起到 server marker（持锁）。沿用 bootAndSignal 内部机制但不立即发信号 —— 这里手动管理。
    const first = spawn(process.execPath, [CLI_PATH, '--im', 'dingtalk'], {
      env: { CCV_LOG_DIR: GUARD_FALLBACK_LOG_DIR, ...fx.env }, cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    LIVE.add(first);
    let firstOut = '';
    let firstExited = false;
    first.stdout.on('data', (d) => { firstOut += d.toString(); });
    first.stderr.on('data', (d) => { firstOut += d.toString(); });
    first.on('exit', () => { firstExited = true; });

    try {
      // 等第一实例取到锁（im.lock 文件出现且持锁，或已打印启动 marker）。
      await waitUntil(() => /CC Viewer:/.test(firstOut) || existsSync(join(fx.logDir, 'IM_dingtalk', 'im.lock')) || firstExited,
        { timeoutMs: 40000, intervalMs: 50, label: 'first im holds lock' });
      assert.ok(!firstExited, `第一实例应持锁存活；提前退出 out=\n${firstOut.slice(-500)}`);

      // 第二实例：同 env → acquireImLock 失败 → exit 3。
      const r2 = runCli(['--im', 'dingtalk'], { env: { ...fx.env, CCV_LOG_DIR: fx.logDir }, timeout: 30000 });
      assert.equal(r2.exitCode, 3, `锁被持有时第二个 --im 应 exit 3；实得 ${r2.exitCode} out=${r2.stdout}${r2.stderr}`);
    } finally {
      // 收掉第一实例。
      try { first.kill('SIGINT'); } catch {}
      try { await waitUntil(() => firstExited, { timeoutMs: 15000, intervalMs: 50, label: 'first im exit' }); } catch {}
      if (!firstExited) { try { first.kill('SIGKILL'); } catch {} }
      LIVE.delete(first);
    }
  });
});
