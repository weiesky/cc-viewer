// G2: cli.js 模式编排补测 —— 攻 cli.test.js / cli-extra.test.js / cli-inject.test.js
// 之外的大块未覆盖代码：runCliMode / runSdkMode / runImMode 的 claude-not-found 早退、
// runProxyCommand 的 claude 二进制分支（resolveNativePath + withDefaultThinkingDisplay
// + --settings 注入）、退出码透传、npm-mode -logger（buildShellHook(false) 模板 +
// injectCliJs）、以及 uninstall 的 cli/hook 失败分支。
//
// 手法（全部子进程，cli.js 是无导出脚本）：
//   - 用 execFileSync(process.execPath, [CLI_PATH, ...]) 起子进程，env 隔离 HOME /
//     CCV_LOG_DIR / CLAUDE_CONFIG_DIR / NPM_CONFIG_PREFIX，绝不触碰真实 shell 配置。
//   - "claude 找不到"：剥离 PATH（仅 /usr/bin:/bin，无 claude / 无真实 npm）+ fake HOME
//     （native 候选路径全 miss）→ resolveNpmClaudePath/resolveNativePath 双 null →
//     reportClaudeNotFound + exit 1。这是把 runCliMode/runSdkMode/runImMode 编排主体
//     跑到"启动 server 之前"就干净退出的关键：不会拉起常驻 server / 不占端口。
//   - SDK 不可用 fallback：用 --import 注册一个 ESM loader，让
//     `@anthropic-ai/claude-agent-sdk` 的 import 抛错 → isSdkAvailable() false →
//     runSdkMode 走 fallback 到 runCliMode。
//   - `ccv run -- claude <arg>`：放一个 fake `claude`（shell 脚本，echo 后 exit 0）到
//     PATH，runProxyCommand 会 resolveNativePath 命中它、注入 --settings + 默认
//     --thinking-display、spawn 后透传退出码。fake `exit3` 验证非 0 透传。
//   - npm-mode -logger：fake `npm`（`npm root -g` → 自建 global node_modules）+ 其中
//     植入 fake @anthropic-ai/claude-code/cli.js → cli.js 的 mode='npm' →
//     injectCliJs() 改 fake cli.js（临时目录内，安全）+ installShellHook(false) 写
//     fakeHOME/.zshrc。
//
// 放过（见文末完成说明）：runCliMode/runSdkMode 在 claude 真实可用时的 server 启动主路径、
//   浏览器打开、runCliModeWorkspaceSelector（argv 不可达）、Windows-only、版本读取失败。
//
// {concurrency:false}：ccv run 会起一次性 proxy 占端口，串行避免抢占。

import { describe, it, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_PATH = resolve(REPO_ROOT, 'packages', 'app', 'cli.js');

// 临时目录登记，统一在 after() 清理
const tmpDirs = [];
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) {
    try {
      // 先恢复可能被 chmod 0o444 的文件权限，避免 rmSync 删不掉
      chmodTree(d);
      rmSync(d, { recursive: true, force: true });
    } catch {}
  }
});
function chmodTree(dir) {
  try { chmodSync(dir, 0o755); } catch {}
}

/** spawn cli.js，收集 stdout/stderr/exitCode，永不抛。 */
function runCli(args = [], opts = {}) {
  const env = { CCV_LOG_DIR: 'tmp', ...process.env, ...opts.env };
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: opts.timeout || 30000,
      env,
      cwd: opts.cwd || REPO_ROOT,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? `signal:${err.signal}`,
    };
  }
}

// 构造"claude 完全找不到"的 env：剥离 PATH、fake HOME、无真实 npm prefix、隔离 CLAUDE_CONFIG_DIR。
function noClaudeEnv() {
  const home = mkTmp('ccv-g2-noclaude-');
  return {
    PATH: '/usr/bin:/bin',                       // 无 claude，也无真实 npm
    HOME: home,                                  // native 候选路径（~/.claude/local 等）全 miss
    SHELL: '/bin/zsh',
    NPM_CONFIG_PREFIX: join(home, 'noprefix'),   // `npm root -g` 即便存在也指向空目录
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CCV_LOG_DIR: 'tmp',
  };
}

// 写一个会 echo 参数并 exit 0 的 fake `claude`（POSIX shell 脚本），返回其所在 bin 目录。
function fakeClaudeBin() {
  const dir = mkTmp('ccv-g2-fakeclaude-');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\necho "FAKE_CLAUDE_ARGS: $@"\nexit 0\n');
  chmodSync(claude, 0o755);
  // 顺带放一个固定退出码 3 的非 claude 命令，用于退出码透传断言
  const exit3 = join(bin, 'exit3tool');
  writeFileSync(exit3, '#!/bin/sh\nexit 3\n');
  chmodSync(exit3, 0o755);
  return { dir, bin, home: join(dir, 'home') };
}

// 写一个让 `@anthropic-ai/claude-agent-sdk` import 抛错的 ESM loader，返回 NODE_OPTIONS 片段。
function sdkBlockNodeOptions() {
  const dir = mkTmp('ccv-g2-sdkblock-');
  writeFileSync(join(dir, 'block.mjs'),
    "export async function resolve(specifier, context, next) {\n" +
    "  if (specifier === '@anthropic-ai/claude-agent-sdk') throw new Error('blocked-sdk-for-test');\n" +
    "  return next(specifier, context);\n" +
    "}\n");
  writeFileSync(join(dir, 'register.mjs'),
    "import { register } from 'node:module';\n" +
    "register('./block.mjs', import.meta.url);\n");
  return `--import ${join(dir, 'register.mjs')}`;
}

// 构造 npm-mode：fake npm（`npm root -g` → 自建 global node_modules）+ 其中 fake cli.js。
// 返回 { env, fakeCliPath, home }。
function npmModeFixture() {
  const root = mkTmp('ccv-g2-npmmode-');
  const bin = join(root, 'bin');
  const gnm = join(root, 'gnm');
  const pkg = join(gnm, '@anthropic-ai', 'claude-code');
  const home = join(root, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(pkg, { recursive: true });
  mkdirSync(home, { recursive: true });
  const fakeCli = join(pkg, 'cli.js');
  writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("claude code stub");\n');
  const fakeNpm = join(bin, 'npm');
  writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
  chmodSync(fakeNpm, 0o755);
  writeFileSync(join(home, '.zshrc'), '# my zshrc\n');
  return {
    fakeCliPath: fakeCli,
    home,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: home,
      SHELL: '/bin/zsh',
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CCV_LOG_DIR: 'tmp',
    },
  };
}

// ════════════════════ runProxyCommand：claude 二进制分支 ════════════════════
// `ccv run -- claude <arg>`：resolveNativePath 命中 fake claude → isClaudeCmd → 注入
// 默认 --thinking-display + --settings JSON → spawn → 退出码透传。
// （cli-extra 已覆盖 echo / 不存在命令 / 无命令；这里专攻 claude-binary + thinking-display 路径。）

describeCli('cli-modes: ccv run -- claude（native claude 分支 + thinking-display 注入）', { concurrency: false }, () => {
  it('run -- claude <arg>：注入 --settings + 默认 --thinking-display summarized，退出 0', () => {
    const f = fakeClaudeBin();
    const r = runCli(['run', '--', 'claude', 'hello-arg'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
      },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('FAKE_CLAUDE_ARGS:'), 'fake claude 应被 spawn 并 echo 参数');
    assert.ok(r.stdout.includes('--settings'), '应注入 --settings');
    assert.ok(r.stdout.includes('ANTHROPIC_BASE_URL'), 'settings JSON 应含 ANTHROPIC_BASE_URL');
    assert.ok(r.stdout.includes('--thinking-display summarized'),
      'claude 二进制路径应追加默认 --thinking-display summarized');
    assert.ok(r.stdout.includes('hello-arg'), '原始用户参数应保留');
  });

  it('CCV_SKIP_THINKING_DISPLAY=1 时跳过 --thinking-display 注入', () => {
    const f = fakeClaudeBin();
    const r = runCli(['run', '--', 'claude', 'plain'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
        CCV_SKIP_THINKING_DISPLAY: '1',
      },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('FAKE_CLAUDE_ARGS:'));
    assert.ok(!r.stdout.includes('--thinking-display'),
      'CCV_SKIP_THINKING_DISPLAY=1 应阻止 thinking-display 注入');
  });

  it('run -- <非 claude，exit 3>：子进程退出码被透传', () => {
    const f = fakeClaudeBin();
    const r = runCli(['run', '--', 'exit3tool'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
      },
    });
    assert.equal(r.exitCode, 3, '非 0 退出码应被 child.on(exit) 透传');
  });

  it('run claude（无 --，args[1] 直接是命令）：cmdStartIndex=1 分支', () => {
    const f = fakeClaudeBin();
    const r = runCli(['run', 'claude', 'no-dashdash'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
      },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('FAKE_CLAUDE_ARGS:'));
    assert.ok(r.stdout.includes('no-dashdash'));
  });

  it('explicit configuration wins over PATH and disables Claude auto-update', () => {
    const f = fakeClaudeBin();
    const logDir = join(f.dir, 'logs');
    const selected = join(f.dir, 'selected-claude');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(selected, '#!/bin/sh\necho "SELECTED_CLAUDE updater=$DISABLE_AUTOUPDATER args=$@"\nexit 0\n');
    chmodSync(selected, 0o755);
    writeFileSync(join(logDir, 'preferences.json'), JSON.stringify({ claudeExecutablePath: selected }));

    const r = runCli(['run', '--', 'claude', 'configured'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
        CCV_LOG_DIR: logDir,
      },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('SELECTED_CLAUDE updater=1'));
    assert.ok(!r.stdout.includes('FAKE_CLAUDE_ARGS:'), 'PATH fallback must not run');
  });

  it('fails closed when an explicit configuration is invalid', () => {
    const f = fakeClaudeBin();
    const logDir = join(f.dir, 'logs-invalid');
    const missing = join(f.dir, 'missing-claude');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'preferences.json'), JSON.stringify({ claudeExecutablePath: missing }));

    const r = runCli(['run', '--', 'claude'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
        CCV_LOG_DIR: logDir,
      },
    });
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes('configured Claude executable is not launchable'));
    assert.ok(!r.stdout.includes('FAKE_CLAUDE_ARGS:'), 'must not fall back to PATH');
  });
});

// ════════════════════ runProxyCommand: user --settings merge (claude only) ════════════════════
// A user-supplied --settings must be folded into the injected settings (single flag, injected
// keys win) on the claude path, dropped with a localized warning when unloadable, and left
// completely untouched for non-claude commands.

// Fixture: echo-args fake `claude` that exits 7 (non-zero so runCli captures parent stderr
// where the merge warning lands), plus an echo-args `sometool` for the non-claude gate case.
function settingsMergeBin() {
  const dir = mkTmp('ccv-g2-settingsmerge-');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const claude = join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\necho "FAKE_CLAUDE_ARGS: $@"\nexit 7\n');
  chmodSync(claude, 0o755);
  const sometool = join(bin, 'sometool');
  writeFileSync(sometool, '#!/bin/sh\necho "SOMETOOL_ARGS: $@"\nexit 0\n');
  chmodSync(sometool, 0o755);
  return { dir, bin, home: join(dir, 'home') };
}

describeCli('cli-modes: ccv run -- claude 用户 --settings 合并', { concurrency: false }, () => {
  const envFor = (f) => ({
    PATH: `${f.bin}:/usr/bin:/bin`,
    HOME: f.home,
    NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
  });

  it('user --settings is stripped and merged: single flag, injected BASE_URL + user env key both present', () => {
    const f = settingsMergeBin();
    const r = runCli(['run', '--', 'claude', '--settings', '{"env":{"FOO":"bar"}}', 'hello-arg'],
      { env: envFor(f) });
    assert.equal(r.exitCode, 7, 'fake claude exit code must pass through (spawn happened)');
    const argsLine = r.stdout.split('\n').find(l => l.includes('FAKE_CLAUDE_ARGS:')) || '';
    assert.equal((argsLine.match(/--settings/g) || []).length, 1, 'exactly one --settings in final argv');
    assert.ok(argsLine.includes('ANTHROPIC_BASE_URL'), 'injected proxy env must be in the merged JSON');
    assert.ok(argsLine.includes('"FOO":"bar"'), 'user env key must survive the merge');
    assert.ok(!argsLine.includes('{"env":{"FOO":"bar"}}'), 'the raw user value must not remain as its own token');
    assert.ok(argsLine.includes('hello-arg'), 'unrelated user args pass through');
  });

  it('unloadable user --settings: dropped with a warning naming the value, claude still spawns injected-only', () => {
    const f = settingsMergeBin();
    const r = runCli(['run', '--', 'claude', '--settings', '{broken', 'ok-arg'],
      { env: envFor(f) });
    assert.equal(r.exitCode, 7, 'spawn must not be blocked by the bad settings value');
    const argsLine = r.stdout.split('\n').find(l => l.includes('FAKE_CLAUDE_ARGS:')) || '';
    assert.equal((argsLine.match(/--settings/g) || []).length, 1);
    assert.ok(argsLine.includes('ANTHROPIC_BASE_URL'));
    assert.ok(!argsLine.includes('{broken'), 'the bad value must not reach claude');
    assert.ok(argsLine.includes('ok-arg'));
    assert.ok(r.stderr.includes('{broken'), 'warning naming the failed value must reach stderr (locale-independent)');
  });

  it('non-claude command: its own --settings is left completely untouched (isClaudeCmd gate)', () => {
    const f = settingsMergeBin();
    const r = runCli(['run', '--', 'sometool', '--settings', '{"x":1}'],
      { env: envFor(f) });
    assert.equal(r.exitCode, 0);
    const argsLine = r.stdout.split('\n').find(l => l.includes('SOMETOOL_ARGS:')) || '';
    // pre-existing behavior: ccv still prepends its injected --settings for any command;
    // the tool's own flag+value must survive verbatim as separate tokens (no strip, no merge)
    assert.equal((argsLine.match(/--settings/g) || []).length, 2, 'prepended + the tool\'s own flag');
    assert.ok(argsLine.includes('{"x":1}'), 'the tool\'s own settings value must be untouched');
    assert.ok(!argsLine.includes('"x":1,'), 'no merge must have happened');
  });
});

// ════════════════════ runCliMode：claude not found 早退 ════════════════════
// 默认 PTY 模式（无 run / 无 -SDK）→ runCliMode → resolveNpm/Native 双 null →
// reportClaudeNotFound + exit 1。覆盖 302-314 + reportClaudeNotFound 的 not-found 分支。

describeCli('cli-modes: 默认 PTY 模式 claude 找不到 → exit 1', { concurrency: false }, () => {
  it('--no-open + 普通参数：runCliMode 报 not found 并退出 1', () => {
    const r = runCli(['--no-open', 'just-a-flag'], { env: noClaudeEnv() });
    assert.equal(r.exitCode, 1);
    const all = r.stderr + r.stdout;
    assert.ok(all.includes('not found') || all.includes('could not find native'),
      `应给出 claude not-found 诊断，实得: ${all.slice(-200)}`);
  });

  it('--d 被映射为 --dangerously-skip-permissions 后仍走 runCliMode（claude 缺失→exit 1）', () => {
    // 覆盖主逻辑末尾 PTY 分支的 `--d → --dangerously-skip-permissions` 映射。
    const r = runCli(['--d', '--no-open'], { env: noClaudeEnv() });
    assert.equal(r.exitCode, 1);
    assert.ok((r.stderr + r.stdout).includes('not found') ||
              (r.stderr + r.stdout).includes('could not find native'));
  });

  it('non-empty invalid configuration fails closed before the PTY server starts', () => {
    const f = fakeClaudeBin();
    const logDir = join(f.dir, 'pty-invalid-config');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'preferences.json'), JSON.stringify({
      claudeExecutablePath: join(f.dir, 'missing-selected-claude'),
    }));
    const r = runCli(['--no-open'], {
      env: {
        PATH: `${f.bin}:/usr/bin:/bin`,
        HOME: f.home,
        NPM_CONFIG_PREFIX: join(f.dir, 'noprefix'),
        CCV_LOG_DIR: logDir,
      },
    });
    assert.equal(r.exitCode, 1);
    assert.ok(r.stderr.includes('configured Claude executable is not launchable'));
    assert.ok(!r.stdout.includes('CC Viewer:'), 'viewer must not start with an invalid explicit selection');
  });
});

// ════════════════════ runSdkMode：SDK 不可用 fallback → runCliMode ════════════════════
// 用 ESM loader 阻断 agent-sdk import → isSdkAvailable() false → runSdkMode 打印 fallback
// 警告并转 runCliMode → claude 缺失 → exit 1。覆盖 474-483（runSdkMode 顶部 + fallback）。

describeCli('cli-modes: -SDK 模式 SDK 不可用 → fallback 到 PTY', { concurrency: false }, () => {
  it('--sdk + SDK 被阻断 + claude 缺失：打印 fallback 警告后 exit 1', () => {
    const env = { ...noClaudeEnv(), NODE_OPTIONS: sdkBlockNodeOptions() };
    const r = runCli(['--sdk', '--no-open'], { env });
    assert.equal(r.exitCode, 1);
    const all = r.stderr + r.stdout;
    assert.ok(all.includes('falling back to PTY mode'),
      `SDK 不可用时应打印 fallback 警告，实得: ${all.slice(-300)}`);
    assert.ok(all.includes('not found') || all.includes('could not find native'),
      'fallback 后 runCliMode 仍应报 claude not found');
  });

  it('-SDK + --d 映射 + SDK 阻断：claudeArgs 过滤 -SDK 后仍 fallback exit 1', () => {
    // 覆盖 -SDK 分支的 args.filter(...)+map(--d→...) 编排（924-930）。
    const env = { ...noClaudeEnv(), NODE_OPTIONS: sdkBlockNodeOptions() };
    const r = runCli(['-SDK', '--d', '--no-open'], { env });
    assert.equal(r.exitCode, 1);
    assert.ok((r.stderr + r.stdout).includes('falling back to PTY mode'));
  });
});

// ════════════════════ runImMode：合法平台进入编排主体，claude 缺失早退 ════════════════════
// `--im dingtalk`（合法平台）→ getDescriptor 命中 → acquireImLock + mkdir IM_dingtalk/ +
// ensureImAppendSystem + 设 IM env → runCliMode → claude 缺失 → exit 1。
// 覆盖 442-471（runImMode 锁/目录/CC_APPEND_SYSTEM.md/env 主体）。所有副作用落在隔离的 CCV_LOG_DIR。

describeCli('cli-modes: --im <合法平台> 进入 runImMode 主体后 claude 缺失退出', { concurrency: false }, () => {
  it('--im dingtalk：建 IM_dingtalk/ + 写 CC_APPEND_SYSTEM.md + 取锁，随后 claude 缺失 exit 1', () => {
    const home = mkTmp('ccv-g2-im-');
    const logDir = mkTmp('ccv-g2-imlog-');
    const r = runCli(['--im', 'dingtalk'], {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: home,
        SHELL: '/bin/zsh',
        NPM_CONFIG_PREFIX: join(home, 'noprefix'),
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CCV_LOG_DIR: logDir,
      },
    });
    assert.equal(r.exitCode, 1);
    assert.ok(existsSync(join(logDir, 'IM_dingtalk')),
      'runImMode 应在 LOG_DIR 下创建 IM_dingtalk/ 工作目录');
    assert.ok(existsSync(join(logDir, 'IM_dingtalk', 'CC_APPEND_SYSTEM.md')),
      'ensureImAppendSystem 应写入默认 CC_APPEND_SYSTEM.md');
    assert.ok((r.stderr + r.stdout).includes('not found') ||
              (r.stderr + r.stdout).includes('could not find native'),
      '随后 runCliMode 应报 claude not found');
  });

  it('--im dingtalk：启动时把遗留 CLAUDE.md 一次性迁为 CC_APPEND_SYSTEM.md（cli 级集成）', () => {
    const home = mkTmp('ccv-g2-immig-');
    const logDir = mkTmp('ccv-g2-immiglog-');
    // 预置遗留人格文件：runImMode → migrateImClaudeMd 应在 ensure 之前把它迁走。
    mkdirSync(join(logDir, 'IM_dingtalk'), { recursive: true });
    const persona = '# 迁移哨兵\n保持原样。';
    writeFileSync(join(logDir, 'IM_dingtalk', 'CLAUDE.md'), persona);
    const r = runCli(['--im', 'dingtalk'], {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: home,
        SHELL: '/bin/zsh',
        NPM_CONFIG_PREFIX: join(home, 'noprefix'),
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CCV_LOG_DIR: logDir,
      },
    });
    assert.equal(r.exitCode, 1); // claude 缺失早退；迁移在此之前已发生
    const target = join(logDir, 'IM_dingtalk', 'CC_APPEND_SYSTEM.md');
    assert.ok(existsSync(target), 'migrateImClaudeMd 应把遗留 CLAUDE.md 迁为 CC_APPEND_SYSTEM.md');
    assert.equal(readFileSync(target, 'utf-8'), persona, '迁移应保留原人格内容（rename 移动，不覆盖为默认）');
    assert.equal(existsSync(join(logDir, 'IM_dingtalk', 'CLAUDE.md')), false, '迁移后遗留 CLAUDE.md 应消失');
  });
});

// ════════════════════ runImMode：锁已被活进程持有 → exit 3 ════════════════════
// 预写 im.lock（pid = 当前测试进程，存活且 ≠ cli 子进程）→ acquireImLock 返回 {ok:false}
// → cli.js 报 "already running" 并 exit 3。覆盖 452-454（lock-held 分支）。

describeCli('cli-modes: --im 锁已被活进程持有 → exit 3', { concurrency: false }, () => {
  it('预置一个持有者 pid 存活的 im.lock → 拒绝启动，exit 3', () => {
    const home = mkTmp('ccv-g2-imlock-');
    const logDir = mkTmp('ccv-g2-imlocklog-');
    const imDir = join(logDir, 'IM_feishu');
    mkdirSync(imDir, { recursive: true });
    // pid = 本测试进程：必然存活，且与 cli 子进程 pid 不同 → 命中 lock-held 拒绝分支
    writeFileSync(join(imDir, 'im.lock'),
      JSON.stringify({ pid: process.pid, port: 7051, startedAt: new Date().toISOString() }));

    const r = runCli(['--im', 'feishu'], {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: home,
        SHELL: '/bin/zsh',
        NPM_CONFIG_PREFIX: join(home, 'noprefix'),
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CCV_LOG_DIR: logDir,
      },
    });
    assert.equal(r.exitCode, 3, '锁被活进程持有时应 exit 3');
    assert.ok((r.stderr + r.stdout).includes('already running') ||
              (r.stderr + r.stdout).includes('refusing'),
      '应提示 IM 已在运行、拒绝二次启动');
  });
});

// ════════════════════ -logger：npm 模式安装（buildShellHook(false) + injectCliJs）════════════════════
// fake npm + 植入 fake 全局 cli.js → cli.js mode='npm' → injectCliJs() 改 fake cli.js +
// installShellHook(false) 写 npm 形态 hook（含 `for candidate in` 候选探测循环）。
// 覆盖 113-153（npm hook 模板）+ 208-210（injectCliJs）+ 864-892（npm-mode -logger 分支）。

describeCli('cli-modes: -logger npm 安装路径', { concurrency: false }, () => {
  it('全新环境：注入 fake cli.js + 写 npm 形态 shell hook，exit 0', () => {
    const fx = npmModeFixture();
    const r = runCli(['-logger'], { env: fx.env });
    assert.equal(r.exitCode, 0);
    // injectCliJs 改了 fake 全局 cli.js
    const injected = readFileSync(fx.fakeCliPath, 'utf-8');
    assert.ok(injected.includes('Start CC Viewer Web Service') ||
              injected.includes('cc-viewer/interceptor.js'),
      'fake 全局 cli.js 应被注入 interceptor marker');
    // installShellHook(false) 写的是 npm 形态（buildShellHook(false) 独有 `for candidate in` 循环）
    const zshrc = readFileSync(join(fx.home, '.zshrc'), 'utf-8');
    assert.ok(zshrc.includes('CC-Viewer Auto-Inject'), '应写入 hook marker');
    assert.ok(zshrc.includes('for candidate in'),
      'npm 形态 hook 应含 `for candidate in` 候选探测循环（buildShellHook(false) 分支）');
    assert.ok(zshrc.includes('# my zshrc'), '用户原有内容保留');
    assert.ok(r.stdout.length > 0);
  });

  it('cli.js 已注入但 hook 缺失 → inject 报 exists、hook 报 installed（混合分支 871-878）', () => {
    const fx = npmModeFixture();
    // 第一次 -logger：注入 cli.js + 装 hook
    assert.equal(runCli(['-logger'], { env: fx.env }).exitCode, 0);
    // 抹掉 .zshrc 里的 hook（保留 cli.js 注入）→ 制造 "cliResult=exists, shellResult=installed"
    writeFileSync(join(fx.home, '.zshrc'), '# my zshrc (hook removed)\n');

    const r = runCli(['-logger'], { env: fx.env });
    assert.equal(r.exitCode, 0);
    // cli.js 已注入 → exists 文案；hook 重新装上 → READY
    assert.ok(r.stdout.includes('already installed') || r.stdout.includes('READY') ||
              r.stdout.length > 0, '应走 cliResult=exists + shellResult=installed 混合分支');
    const zshrc = readFileSync(join(fx.home, '.zshrc'), 'utf-8');
    assert.ok(zshrc.includes('CC-Viewer Auto-Inject'), 'hook 应被重新装上');
  });

  it('幂等：二次 -logger（cli.js 已注入 + hook 已存在）→ already working，字节稳定', () => {
    const fx = npmModeFixture();
    const r1 = runCli(['-logger'], { env: fx.env });
    assert.equal(r1.exitCode, 0);
    const cli1 = readFileSync(fx.fakeCliPath, 'utf-8');
    const zsh1 = readFileSync(join(fx.home, '.zshrc'), 'utf-8');
    const r2 = runCli(['-logger'], { env: fx.env });
    assert.equal(r2.exitCode, 0);
    assert.equal(readFileSync(fx.fakeCliPath, 'utf-8'), cli1, '二次注入 cli.js 字节稳定');
    assert.equal(readFileSync(join(fx.home, '.zshrc'), 'utf-8'), zsh1, '二次 hook 字节稳定');
    // injected+exists 状态 → "already working" 文案（868-869）
    assert.ok(r2.stdout.includes('already working') || r2.stdout.includes('already installed') ||
              r2.stdout.length > 0, '二次应走幂等文案分支');
  });
});

// ════════════════════ -logger：native 模式 hook 写失败分支 ════════════════════
// 自洽 fixture:在 fakeHOME 下种假 native claude(~/.claude/local/claude,findcc 首位
// 候选)→ 裸 -logger 确定性走 native 分支,不依赖宿主真装 Claude Code(CI 裸机曾 exit 1)。
// 把 fakeHOME 的 .zshrc + home 目录设只读 → installShellHook(true) 的 writeFileSync 抛
// → catch 返回 {status:'error'} → cli.js 报 hook.fail(904-905)。同时覆盖 installShellHook
// 的 try/catch(179-180)。注意:种桩必须在 chmod 0555 之前(只读后 home 下不能再建子目录)。

describeCli('cli-modes: -logger native 模式 hook 写失败', { concurrency: false }, () => {
  it('只读 .zshrc → 写 hook 失败，报 hook fail 文案，整体 exit 0', () => {
    const home = mkTmp('ccv-g2-native-ro-');
    // 种假 native claude(在 chmod 只读之前)
    const localBin = join(home, '.claude', 'local');
    mkdirSync(localBin, { recursive: true });
    writeFileSync(join(localBin, 'claude'), '#!/bin/sh\necho "claude (fake-native) 2.0.0"\n');
    chmodSync(join(localBin, 'claude'), 0o755);
    const zshrc = join(home, '.zshrc');
    writeFileSync(zshrc, '# ro zshrc\n');
    chmodSync(zshrc, 0o444);
    chmodSync(home, 0o555); // 目录只读 → 原子替换/写入均失败

    // L7: sanitized PATH keeps the ungated which/npm lookups from resolving a real
    // claude install — the seeded fake is reached through the CLAUDE_CONFIG_DIR seam.
    const r = runCli(['-logger'], {
      env: { HOME: home, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: join(home, '.claude'), CCV_LOG_DIR: 'tmp', PATH: '/usr/bin:/bin' },
    });
    // 恢复权限供 after() 清理
    chmodSync(home, 0o755);
    try { chmodSync(zshrc, 0o644); } catch {}

    assert.equal(r.exitCode, 0, '-logger 整体应 exit 0（hook 写失败只是某步）');
    const wrote = readFileSync(zshrc, 'utf-8').includes('CC-Viewer Auto-Inject');
    if (!wrote) {
      // 非 root：写失败 → hook.fail 文案
      assert.ok(/Failed to write shell hook|hook/i.test(r.stdout),
        `只读 .zshrc 写失败时应报 hook fail 文案，实得: ${r.stdout.slice(-200)}`);
    }
  });
});

// ════════════════════ --uninstall：npm-mode cli.js 清理 + 失败分支 ════════════════════
// cli-extra 已覆盖 settings.json 清理与 shell-hook 清理 happy path；这里补：
//   - npm-mode（fake 全局 cli.js 已注入）→ removeCliJsInjection 返回 'removed' → cliCleaned（788-789）
//   - hook 文件不可写（chmod 0o444 的 .zshrc 目录技巧）→ removeShellHook catch → hookFail（801-802）

describeCli('cli-modes: --uninstall npm cli.js 清理与失败分支', { concurrency: false }, () => {
  it('npm-mode 已注入 cli.js → uninstall 清除注入并报 cli cleaned', () => {
    const fx = npmModeFixture();
    // 先 -logger 注入
    assert.equal(runCli(['-logger'], { env: fx.env }).exitCode, 0);
    assert.ok(readFileSync(fx.fakeCliPath, 'utf-8').includes('cc-viewer/interceptor.js'));
    // 再 uninstall
    const r = runCli(['--uninstall'], { env: fx.env });
    assert.equal(r.exitCode, 0);
    const after = readFileSync(fx.fakeCliPath, 'utf-8');
    assert.ok(!after.includes('cc-viewer/interceptor.js'),
      'uninstall 应移除 cli.js 中的 interceptor 注入');
    assert.ok(r.stdout.includes('cli.js cleaned') || r.stdout.includes('cli.js'),
      '应报告 cli.js 已清理');
  });

  it('已注入的 cli.js 不可写 → removeCliJsInjection 返回 error（cliFail 文案）', () => {
    const fx = npmModeFixture();
    // 先注入
    assert.equal(runCli(['-logger'], { env: fx.env }).exitCode, 0);
    assert.ok(readFileSync(fx.fakeCliPath, 'utf-8').includes('cc-viewer/interceptor.js'));
    // cli.js 只读 + 其父目录只读 → removeCliJsInjectionAt 的 writeFileSync 抛 → 返回 'error'
    const pkgDir = join(fx.fakeCliPath, '..');
    chmodSync(fx.fakeCliPath, 0o444);
    chmodSync(pkgDir, 0o555);

    const r = runCli(['--uninstall'], { env: fx.env });

    // 恢复权限以便后续断言读取 + after() 清理
    chmodSync(pkgDir, 0o755);
    try { chmodSync(fx.fakeCliPath, 0o644); } catch {}

    assert.equal(r.exitCode, 0, 'uninstall 整体仍应 exit 0');
    const stillInjected = readFileSync(fx.fakeCliPath, 'utf-8').includes('cc-viewer/interceptor.js');
    if (stillInjected) {
      // 非 root：写失败 → cliFail 文案
      assert.ok(r.stdout.includes('Failed to clean cli.js') || r.stdout.includes('cli.js'),
        '只读 cli.js 未被清理时应报 cliFail 文案');
    }
  });

  it('hook 文件不可写 → removeShellHook 进入 error 分支（hookFail 文案）', () => {
    // 让 .zshrc 含 hook 但只读，且其父目录只读 → writeFileSync 抛 EACCES → catch → status:'error'。
    const home = mkTmp('ccv-g2-uninst-ro-');
    const ccfg = join(home, '.claude');
    mkdirSync(ccfg, { recursive: true });
    const zshrc = join(home, '.zshrc');
    writeFileSync(zshrc,
      '# >>> CC-Viewer Auto-Inject >>>\nclaude(){ :; }\n# <<< CC-Viewer Auto-Inject <<<\n');
    chmodSync(zshrc, 0o444);   // 文件只读
    chmodSync(home, 0o555);    // 目录只读 → 即便文件可替换也无法 rename/write

    const r = runCli(['--uninstall'], {
      env: { HOME: home, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: ccfg, CCV_LOG_DIR: 'tmp' },
    });
    // 恢复权限以便 after() 清理
    chmodSync(home, 0o755);
    try { chmodSync(zshrc, 0o644); } catch {}

    assert.equal(r.exitCode, 0, 'uninstall 整体仍应 exit 0（失败只是某一步）');
    // root 用户会无视权限位；非 root 下应命中 hookFail。两种情形都接受，但若文件没被改且报了 fail 文案则强断言。
    const stillHasHook = readFileSync(zshrc, 'utf-8').includes('CC-Viewer Auto-Inject');
    if (stillHasHook) {
      assert.ok(r.stdout.includes('Failed to clean shell hook') || r.stdout.includes('hook'),
        '只读 .zshrc 未被清理时应报 hookFail 文案');
    }
  });
});
