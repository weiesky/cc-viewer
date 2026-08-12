// cli-boot: cli.js 真实启动路径攻坚 —— runCliMode (337-430) / runSdkMode (502-593)。
//
// 既有 cli-modes.test.js 因进程卫生顾虑，只把这两条编排跑到「启动 server 之前」就用
// claude-not-found 干净早退；server 启动主路径（startProxy → import server.js → 等端口 →
// spawnClaude → 开浏览器 → 打印 URL/Network/password → 注册 SIGINT/SIGTERM cleanup）全程
// 未覆盖。本文件用「真 spawn('node', ['cli.js', ...]) + 全程隔离 + 限时 + 必杀」补上。
//
// 隔离手法：
//   - env：临时 HOME / CCV_LOG_DIR / CLAUDE_CONFIG_DIR（mkdtemp），PATH 仅 fakeBin+/usr/bin:/bin。
//   - 端口：私有窗 17940-17979，经 CCV_START_PORT / CCV_MAX_PORT 注入（server.js 顶层读取）。
//     每个 boot 用例分到不重叠的 4 端口子窗，串行 + 不重叠双保险，杜绝端口互踩。
//   - 防开浏览器：--no-open（cli.js 的 noOpen 分支，跳过 spawn open/xdg-open/cmd.exe）。
//   - fake claude：npm 形态 cli.js（node 跑），常驻读 stdin 不退出 → spawnClaude 经 node-pty 拉起后
//     server 完成启动、打印 marker；随后由我们发 SIGINT/SIGTERM，cleanup() → killPty() 收掉它。
//   - fake npm：`npm root -g` → 自建 global node_modules（内含 @anthropic-ai/claude-code/cli.js）→
//     resolveNpmClaudePath 命中 fake claude（isNpmVersion=true）。
//
// 时序：waitUntil 轮询 stdout 出现启动 marker（CC Viewer: / Local:）→ 发信号 →
//   waitUntil 进程退出 → 断言退出码 0 + 端口已释放 + 工作区已登记等副作用。
//   任何路径 finally 里 SIGKILL 兜底；模块级 LIVE set 登记所有子进程，after() 全杀。
//
// SDK 模式：runSdkMode 不 spawn claude（SDK 直管 API），只需 isSdkAvailable() 为真 + server 启动。
//   仓库 node_modules 已装 @anthropic-ai/claude-agent-sdk，cwd 设为 REPO_ROOT 即可命中，
//   PATH 仍剥离（SDK 路径不需要 claude/npm）。
//
// 放过：runCliModeWorkspaceSelector（596-667，argv 不可达死代码）、Windows-only（5-6 / win32 分支）、
//   版本读取失败（779-780）、-logger ENOENT/error（886-887,908-910，需特制 fs 失败，与本文件主题无关）。
//
// {concurrency:false}：每个用例起一个真 server 占私有端口，串行避免任何窗口抢占。

import { describe, it, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync, readFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CLI_PATH = resolve(REPO_ROOT, 'cli.js');

// ──────────────── 进程 / 临时目录卫生 ────────────────
const LIVE = new Set();      // 所有起过的子进程，after() 兜底全杀
const tmpDirs = [];

function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// 守卫兜底:spawn 字面量里始终先给 CCV_LOG_DIR 默认值(调用方 env 可覆盖),
// 保证任何 fixture 漏配时子进程也绝不落真实 ~/.claude/cc-viewer(2026-06-06 事故防再犯)。
const GUARD_FALLBACK_LOG_DIR = mkTmp('ccv-cli-boot-guard-');

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

// ──────────────── 轮询工具（替代固定 sleep）────────────────
// 每 intervalMs 查一次 cond()，命中即 resolve(true)；累计超 timeoutMs 抛。真实计时依赖在高负载下
// 偶发挂起，用条件轮询而非固定时长 sleep。
function waitUntil(cond, { timeoutMs = 30000, intervalMs = 50, label = 'condition' } = {}) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = cond(); } catch (e) { return rej(e); }
      if (ok) return res(true);
      if (Date.now() - start > timeoutMs) {
        return rej(new Error(`waitUntil timeout (${timeoutMs}ms): ${label}`));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// 端口是否可连（用于断言 server 启动后监听、退出后释放）。
function portFree(port, host = '127.0.0.1') {
  return new Promise((res) => {
    const sock = net.connect({ port, host });
    let settled = false;
    const done = (free) => { if (settled) return; settled = true; sock.destroy(); res(free); };
    sock.once('connect', () => done(false));      // 能连 → 被占用 → 非 free
    sock.once('error', () => done(true));         // 连不上 → free
    setTimeout(() => done(true), 1500);
  });
}

// ──────────────── fixture：fake npm + fake 常驻 claude ────────────────
// 返回 { env, home, logDir, fakeClaudePath }。startPort/endPort 注入私有端口子窗。
function bootFixture({ startPort, endPort }) {
  const root = mkTmp('ccv-boot-');
  const bin = join(root, 'bin');
  const gnm = join(root, 'gnm');
  const pkg = join(gnm, '@anthropic-ai', 'claude-code');
  const home = join(root, 'home');
  const logDir = join(root, 'log');
  mkdirSync(bin, { recursive: true });
  mkdirSync(pkg, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  // fake claude（npm 形态 cli.js）：打印一行 marker，然后常驻读 stdin 永不主动退出。
  // node-pty 经 `node <cli.js>` 拉起它；server 启动主路径在它存活期间完成并打印 URL。
  // 收 SIGINT/SIGTERM 时 cli.js 的 cleanup() → killPty() 终结它（无需它自己处理信号）。
  const fakeClaude = join(pkg, 'cli.js');
  writeFileSync(
    fakeClaude,
    '#!/usr/bin/env node\n' +
    'process.stdout.write("FAKE_CLAUDE_UP\\n");\n' +
    'if (process.env.CCV_TEST_FAKE_CLAUDE_EXIT_CODE !== undefined) {\n' +
    '  process.exit(Number(process.env.CCV_TEST_FAKE_CLAUDE_EXIT_CODE));\n' +
    '}\n' +
    'process.stdin.resume();\n' +
    'setInterval(() => {}, 1 << 30);\n',
  );

  // fake npm：`npm root -g` → 自建 global node_modules。
  const fakeNpm = join(bin, 'npm');
  writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
  chmodSync(fakeNpm, 0o755);

  writeFileSync(join(home, '.zshrc'), '# zshrc\n');

  return {
    home, logDir, fakeClaudePath: fakeClaude,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      SHELL: '/bin/zsh',
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CCV_LOG_DIR: logDir,
      CCV_START_PORT: String(startPort),
      CCV_MAX_PORT: String(endPort),
      CCV_HOST: '127.0.0.1',
    },
  };
}

// ──────────────── 通用：spawn cli.js → 等 boot marker → 发信号 → 等退出 ────────────────
// 全程 finally SIGKILL 兜底。返回 { stdout, exitCode, signal }。
async function bootAndSignal({ args, env, cwd, signal = 'SIGINT', markerRe = /CC Viewer/ }) {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    env: { CCV_LOG_DIR: GUARD_FALLBACK_LOG_DIR, ...env },
    cwd: cwd || REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  LIVE.add(child);

  let out = '';
  let exited = false;
  let exitInfo = { code: null, sig: null };
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('exit', (code, sig) => { exited = true; exitInfo = { code, sig }; });

  try {
    // 1. 等 server 启动主路径完成（打印 marker）。同时若进程提前死亡也立即跳出（避免空等满 timeout）。
    await waitUntil(() => markerRe.test(out) || exited, {
      timeoutMs: 40000, intervalMs: 50, label: `boot marker (${markerRe})`,
    });
    assert.ok(!exited, `cli.js 应在 boot 完成前保持存活；提前退出 out=\n${out.slice(-600)}`);
    assert.ok(markerRe.test(out), `应打印 boot marker ${markerRe}，实得:\n${out.slice(-600)}`);

    // 2. 发信号触发 cleanup（killPty + stopViewer → process.exit）。
    child.kill(signal);

    // 3. 等进程退出。
    await waitUntil(() => exited, { timeoutMs: 20000, intervalMs: 50, label: 'process exit after signal' });

    return { stdout: out, exitCode: exitInfo.code, signal: exitInfo.sig };
  } finally {
    // 任何路径兜底：确保子进程已死。
    if (!exited) {
      try { child.kill('SIGKILL'); } catch {}
      try {
        await waitUntil(() => exited, { timeoutMs: 8000, intervalMs: 50, label: 'sigkill exit' });
      } catch {}
    }
    LIVE.delete(child);
  }
}

// 解析 cli.js stdout 打印的 Local URL 里的端口。
function parseLocalPort(out) {
  const m = out.match(/Local:\s+https?:\/\/127\.0\.0\.1:(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function bootAndWaitForExit({ args, env, cwd }) {
  const child = spawn(process.execPath, [CLI_PATH, ...args], {
    env: { CCV_LOG_DIR: GUARD_FALLBACK_LOG_DIR, ...env },
    cwd: cwd || REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  LIVE.add(child);
  let out = '';
  let exitInfo = null;
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('exit', (code, sig) => { exitInfo = { code, sig }; });

  try {
    await waitUntil(() => exitInfo !== null, {
      timeoutMs: 40000, intervalMs: 50, label: 'CodeFuse-managed process exit',
    });
    return { stdout: out, exitCode: exitInfo.code, signal: exitInfo.sig };
  } finally {
    if (!exitInfo) {
      try { child.kill('SIGKILL'); } catch {}
    }
    LIVE.delete(child);
  }
}

// ════════════════════ runCliMode 真实启动（PTY 默认模式）════════════════════
// 默认 PTY 分支（无 run / 无 -SDK）→ runCliMode：startProxy + import server.js + 等端口 +
// spawnClaude（fake 常驻 claude）+ --no-open（跳过开浏览器）+ 打印 URL/Network + 注册 SIGINT
// cleanup。覆盖 342-417 主体 + 424-430 cleanup（SIGINT 路径）。

describeCli('cli-boot: runCliMode 真实启动 → SIGINT 干净退出', { concurrency: false }, () => {
  it('--no-open：server 启动 + spawn fake claude + 打印 Local/Network，SIGINT 后 exit 0 且端口释放', async () => {
    const fx = bootFixture({ startPort: 17940, endPort: 17943 });
    const r = await bootAndSignal({
      args: ['--no-open', 'extra-arg'],
      env: fx.env,
      signal: 'SIGINT',
      markerRe: /CC Viewer:/,
    });

    assert.equal(r.exitCode, 0, `SIGINT cleanup 应 process.exit(0)；实得 code=${r.exitCode} sig=${r.signal}`);
    assert.ok(r.stdout.includes('Starting CC Viewer CLI mode'), '应打印 cMode.starting');
    assert.ok(/Local:\s+http:\/\/127\.0\.0\.1:179\d\d/.test(r.stdout), '应打印 Local URL（私有端口窗）');
    assert.ok(r.stdout.includes('Network:'), '应打印 Network URL（getAllLocalIps 分支）');

    const boundPort = parseLocalPort(r.stdout);
    assert.ok(boundPort >= 17940 && boundPort <= 17943, `应绑定到私有端口子窗，实得 ${boundPort}`);
    // 工作区登记副作用：registerWorkspace 写入 LOG_DIR 下的 workspaces 记录。
    assert.ok(existsSync(fx.logDir), 'CCV_LOG_DIR 目录应存在');

    // 退出后端口应已释放（stopViewer 关闭监听）。
    await waitUntil(async () => await portFree(boundPort), {
      timeoutMs: 8000, intervalMs: 100, label: `port ${boundPort} freed`,
    });
    assert.ok(await portFree(boundPort), `退出后端口 ${boundPort} 应被释放`);
  });

  it('--d → --dangerously-skip-permissions：CCV_BYPASS_PERMISSIONS 分支（337-338）也走完整启动，SIGTERM exit 0', async () => {
    const fx = bootFixture({ startPort: 17944, endPort: 17947 });
    const r = await bootAndSignal({
      args: ['--d', '--no-open'],
      env: fx.env,
      signal: 'SIGTERM',
      markerRe: /CC Viewer:/,
    });
    assert.equal(r.exitCode, 0, `SIGTERM cleanup 应 exit 0；实得 code=${r.exitCode} sig=${r.signal}`);
    assert.ok(/Local:\s+http:\/\/127\.0\.0\.1:179\d\d/.test(r.stdout), '应打印 Local URL');
    const boundPort = parseLocalPort(r.stdout);
    assert.ok(boundPort >= 17944 && boundPort <= 17947, `端口应在子窗内，实得 ${boundPort}`);
  });
});

describeCli('cli-boot: CodeFuse-managed Claude exit closes CCV', { concurrency: false }, () => {
  it('passes the final Claude exit code through and releases the viewer port', async () => {
    const fx = bootFixture({ startPort: 17960, endPort: 17963 });
    fx.env.CLAUDE_CONFIG_DIR = join(fx.home, '.codefuse', 'engine', 'cc');
    fx.env.CCV_TEST_FAKE_CLAUDE_EXIT_CODE = '7';

    const r = await bootAndWaitForExit({ args: ['--no-open'], env: fx.env });
    assert.equal(r.exitCode, 7, `Claude exit 7 should be passed through; output:\n${r.stdout.slice(-800)}`);
    assert.equal(r.signal, null);

    const boundPort = parseLocalPort(r.stdout);
    if (boundPort !== null) {
      await waitUntil(async () => await portFree(boundPort), {
        timeoutMs: 8000, intervalMs: 100, label: `managed port ${boundPort} freed`,
      });
      assert.ok(await portFree(boundPort), `managed exit should release port ${boundPort}`);
    }
  });
});

// ════════════════════ runCliMode：--usePassword 在 CLI 模式打印密码（419-421）════════════════════
// --usePassword=<pwd> → server.js 启用密码登录 → cli.js 在启动尾部打印 passwordActive 文案
// （server.js 的密码打印只在非 CLI 模式生效，故由 cli.js 这里补打）。覆盖 418-421 的 enabled 分支。

describeCli('cli-boot: runCliMode + --usePassword 打印激活密码', { concurrency: false }, () => {
  it('--usePassword=secret123：启动尾部打印 password active（getAuthConfig enabled 分支）', async () => {
    const fx = bootFixture({ startPort: 17948, endPort: 17951 });
    const r = await bootAndSignal({
      args: ['--no-open', '--usePassword=secret123'],
      env: fx.env,
      signal: 'SIGINT',
      markerRe: /CC Viewer:/,
    });
    assert.equal(r.exitCode, 0);
    // passwordActive 文案含明文密码（CLI 模式 in-process 打印）。
    assert.ok(r.stdout.includes('secret123'),
      `--usePassword=secret123 时应在 CLI 启动尾部打印激活密码，实得:\n${r.stdout.slice(-500)}`);
  });
});

// ════════════════════ runSdkMode 真实启动 ════════════════════
// `--sdk` → runSdkMode：isSdkAvailable() 为真（仓库已装 agent-sdk）→ registerWorkspace +
// import server.js + 等端口 + initSdkSession + 注册 SDK 回调 + --no-open + 打印 URL/Network +
// 注册 SIGINT cleanup。SDK 模式不 spawn claude，故无需 fake claude。覆盖 502-593 主体。

describeCli('cli-boot: runSdkMode 真实启动 → SIGINT 干净退出', { concurrency: false }, () => {
  it('--sdk --no-open：SDK 会话初始化 + server 启动 + 打印 "(SDK mode)"，SIGINT 后 exit 0 且端口释放', async () => {
    // SDK 路径不需要 claude；PATH 仍剥离。cwd=REPO_ROOT 让 agent-sdk import 命中仓库 node_modules。
    const root = mkTmp('ccv-boot-sdk-');
    const home = join(root, 'home');
    const logDir = join(root, 'log');
    mkdirSync(home, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: home,
      SHELL: '/bin/zsh',
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CCV_LOG_DIR: logDir,
      CCV_START_PORT: '17952',
      CCV_MAX_PORT: '17955',
      CCV_HOST: '127.0.0.1',
    };

    // 顺带带上 --usePassword=<pwd>：覆盖 SDK 启动尾部的 passwordActive 打印分支（583-585）。
    const r = await bootAndSignal({
      args: ['--sdk', '--no-open', '--usePassword=sdkpw456'],
      env,
      cwd: REPO_ROOT,
      signal: 'SIGINT',
      markerRe: /CC Viewer \(SDK mode\):/,
    });

    assert.equal(r.exitCode, 0, `SDK 模式 SIGINT cleanup 应 exit 0；实得 code=${r.exitCode} sig=${r.signal}`);
    assert.ok(r.stdout.includes('CC Viewer (SDK mode):'), '应打印 SDK 模式 banner');
    assert.ok(/Local:\s+http:\/\/127\.0\.0\.1:179\d\d/.test(r.stdout), '应打印 Local URL');
    assert.ok(r.stdout.includes('Network:'), '应打印 Network URL');
    assert.ok(r.stdout.includes('sdkpw456'), 'SDK 模式 --usePassword 时应打印激活密码（583-585 分支）');

    const boundPort = parseLocalPort(r.stdout);
    assert.ok(boundPort >= 17952 && boundPort <= 17955, `端口应在 SDK 子窗内，实得 ${boundPort}`);
    await waitUntil(async () => await portFree(boundPort), {
      timeoutMs: 8000, intervalMs: 100, label: `sdk port ${boundPort} freed`,
    });
    assert.ok(await portFree(boundPort), `退出后 SDK server 端口 ${boundPort} 应释放`);
  });

  it('-SDK + --d：args.filter(-SDK) + --d 映射后进入 runSdkMode，bypassPermissions，SIGTERM exit 0', async () => {
    const root = mkTmp('ccv-boot-sdk2-');
    const home = join(root, 'home');
    const logDir = join(root, 'log');
    mkdirSync(home, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: home,
      SHELL: '/bin/zsh',
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CCV_LOG_DIR: logDir,
      CCV_START_PORT: '17956',
      CCV_MAX_PORT: '17959',
      CCV_HOST: '127.0.0.1',
    };
    const r = await bootAndSignal({
      args: ['-SDK', '--d', '--no-open'],
      env,
      cwd: REPO_ROOT,
      signal: 'SIGTERM',
      markerRe: /CC Viewer \(SDK mode\):/,
    });
    assert.equal(r.exitCode, 0, `实得 code=${r.exitCode} sig=${r.signal}`);
    assert.ok(r.stdout.includes('CC Viewer (SDK mode):'));
    const boundPort = parseLocalPort(r.stdout);
    assert.ok(boundPort >= 17956 && boundPort <= 17959, `端口应在子窗内，实得 ${boundPort}`);
  });
});
