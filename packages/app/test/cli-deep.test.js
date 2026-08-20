// cli.js Round-2 收尾补测 —— 专攻 cli-modes / cli-extra / cli / cli-inject 之后仍未覆盖的
// 「错误传播 / 顶层 .catch / SDK-available 入口 / npm-mode -logger 通用错误」分支。
//
// 现状（合并既有 cli*.test.js 后 cli.js ≈ 67.8%）：大块剩余缺口是 runCliMode / runSdkMode
// 的真实 server 启动主体（315-430、489-593，需拉起常驻 viewer + 真 PTY claude，故「放过」），
// 以及 runCliModeWorkspaceSelector（596-667，定义后从未被 argv 派发引用 → 死代码，不可达）。
//
// 本文件聚焦既有测试没碰到、但**可达且会快速退出**的错误传播路径：
//   A. runProxyCommand 的 try/catch（295-297 `Proxy error:` + exit 1）
//      —— 用 ESM loader 让 `import('./server/proxy.js')` 抛错触发。
//   B. 顶层四个派发器的 `.catch(err => { console.error(...); process.exit(1) })`：
//        - 默认 PTY：runCliMode 主体（934-936 `CLI mode error:`）
//        - -SDK：runSdkMode 主体（927-929 `SDK mode error:`）
//        - --im：runImMode 主体（917-919 `IM mode error:`）
//      runCliMode/runSdkMode/runImMode 在 claude-not-found 时是 process.exit(1)（不 reject），
//      故既有测试都没碰到这三个 .catch。这里让一个**入口之后的动态 import 抛错**使 async
//      函数 reject，从而把控制权交给顶层 .catch。
//      同时这条路也覆盖 runCliMode/runSdkMode 在「claude 找到」时进入主体的入口若干行
//      （315-322 / 484-489），既有测试只测了「claude 没找到」早退。
//   C. npm-mode -logger 的 injectCliJs() 抛非 ENOENT 错误（884 + 888-891 `cli.inject.fail`）
//      —— fake 全局 cli.js 预置 legacy marker（regex 命中 → 触发 writeFileSync），文件 + 父目录
//      只读 → writeFileSync 抛 EACCES（非 ENOENT）→ 走通用失败分支。
//
// 手法（与 test/cli-modes.test.js / cli-extra.test.js 一致）：
//   - cli.js 无导出 → 全部 spawn 子进程（execFileSync，带 timeout）驱动。
//   - 用 `--import <register.mjs>` 注册 ESM loader（resolve hook 按 resolved URL 后缀拦截相对
//     动态 import），让指定模块在 import 时抛错。loader 文件落在隔离 tmp 目录。
//   - claude「找得到」用 fake `claude` POSIX 脚本放进 PATH（resolveNativePath 的 `which claude`
//     命中，非 .js → 当 native 处理），让 runCliMode/runSdkMode 越过 claude 解析进入主体。
//   - 全程隔离 HOME / NPM_CONFIG_PREFIX / CLAUDE_CONFIG_DIR / CCV_LOG_DIR，绝不碰真实 shell 配置。
//
// 进程卫生：execFileSync 同步等子进程退出 + timeout 兜底；所有断言路径上的子进程都会自行退出
//   （要么 import 抛错走 .catch + process.exit，要么 EACCES 后 exit 1），不常驻、不留孤儿。
//
// 放过（记 skipped）：
//   - cli.js 4-6 行 win32 UV_THREADPOOL_SIZE（process.platform === 'win32' only，darwin 不可达）。
//   - 779-780 版本读取失败（__dirname/package.json 固定，不改源码无法令其 ENOENT）。
//   - 885-887 npm-mode -logger 的 ENOENT 分支（cliPath 在 mode 探测时 existsSync=true、inject 时
//     消失的 TOCTOU race，无法稳定复现）。
//   - 315-430 / 489-593 真实 server 启动主体、596-667 workspace selector（不可达死代码）。

import { describe, it, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, chmodSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_PATH = resolve(REPO_ROOT, 'packages', 'app', 'cli.js');

// ── 临时目录登记，统一在 after() 清理（先复原 chmod 再删，避免只读目录删不掉） ──
const tmpDirs = [];
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) {
    try { chmodSync(d, 0o755); } catch {}
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

/** spawn cli.js，收集 stdout/stderr/exitCode，永不抛。同步等待退出，timeout 兜底。 */
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

// 写一个 ESM loader：当某个动态 import 解析后的 URL 以 `suffix` 结尾时抛错，否则放行。
// 返回 NODE_OPTIONS 片段（`--import <register.mjs>`）。
function importBlockerNodeOptions(suffix, label) {
  const dir = mkTmp('ccv-deep-block-');
  // resolve hook：先调 next 得到真实 URL，再按后缀判断是否拦截（相对动态 import 的
  // specifier 是 './server/...'，但解析后的 r.url 是绝对 file:// 路径，后缀匹配更稳）。
  writeFileSync(join(dir, 'block.mjs'),
    "export async function resolve(specifier, context, next) {\n" +
    "  const r = await next(specifier, context);\n" +
    `  if (r && r.url && r.url.endsWith(${JSON.stringify(suffix)})) {\n` +
    `    throw new Error(${JSON.stringify(label)});\n` +
    "  }\n" +
    "  return r;\n" +
    "}\n");
  writeFileSync(join(dir, 'register.mjs'),
    "import { register } from 'node:module';\n" +
    "register('./block.mjs', import.meta.url);\n");
  return `--import ${join(dir, 'register.mjs')}`;
}

// fake `claude`（POSIX 脚本，非 .js）放进 PATH → resolveNativePath 的 `which claude` 命中 →
// runCliMode/runSdkMode 越过 claude 解析进入主体。返回 { bin, home, prefix }。
function fakeNativeClaudeEnv() {
  const root = mkTmp('ccv-deep-claude-');
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  const claude = join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\necho FAKE_CLAUDE\nexit 0\n');
  chmodSync(claude, 0o755);
  return { bin, home, prefix: join(root, 'noprefix') };
}

// ════════════════════ A. runProxyCommand try/catch（Proxy error:）════════════════════
// `ccv run -- echo`：runProxyCommand 第一步 `import('./server/proxy.js')` 被 loader 阻断 →
// 抛错 → 落入 try/catch（294-297）→ console.error('Proxy error:', err) + process.exit(1)。
// 既有 cli-extra / cli-modes 只覆盖了 proxy 成功后的 spawn 分支，没碰这个 catch。

describeCli('cli-deep: runProxyCommand —— proxy import 抛错走 catch（Proxy error:）', { concurrency: false }, () => {
  it('run -- echo + proxy.js import 被阻断 → "Proxy error:" 退出 1', () => {
    const NODE_OPTIONS = importBlockerNodeOptions('/server/proxy.js', 'blocked-proxy-for-test');
    const r = runCli(['run', '--', 'echo', 'hi'], { env: { NODE_OPTIONS } });
    assert.equal(r.exitCode, 1, 'proxy 启动失败应 exit 1');
    const all = r.stderr + r.stdout;
    assert.ok(all.includes('Proxy error:'),
      `应命中 runProxyCommand catch 的 "Proxy error:"，实得: ${all.slice(-300)}`);
    assert.ok(all.includes('blocked-proxy-for-test'),
      '应携带被阻断 import 的原始错误');
  });
});

// ════════════════════ B1. 默认 PTY → runCliMode 主体 reject → 顶层 .catch ════════════════════
// fake native claude 命中 → runCliMode 越过 claude 解析进入主体 → 跑完
// registerWorkspace + ensureHooks + env 设置（315-340）→ 在 `import('./server/proxy.js')`
// （startProxy 来源，第一个会 bind 端口的步骤之前）处被 loader 阻断 → 抛错 → runCliMode reject →
// 顶层 `.catch`（934-936）打印 "CLI mode error:" + exit 1。
// 选 proxy.js 作为阻断点（而非更早的 workspace-registry）：能多覆盖 ensureHooks/env 若干行，
// 且 throw 发生在任何端口 bind（startProxy / server.js listen）之前 → 子进程不留监听、不占端口。
// 既有测试只测了「claude 没找到 → process.exit(1)」，从没让 runCliMode 真正 reject。

describeCli('cli-deep: 默认 PTY runCliMode 主体抛错 → 顶层 .catch（CLI mode error:）', { concurrency: false }, () => {
  it('claude 可用 + proxy.js import 阻断（bind 端口前）→ "CLI mode error:" 退出 1', () => {
    const c = fakeNativeClaudeEnv();
    const NODE_OPTIONS = importBlockerNodeOptions('/server/proxy.js', 'blocked-proxy-for-test');
    const r = runCli(['--no-open', 'dummy'], {
      env: {
        PATH: `${c.bin}:/usr/bin:/bin`,
        HOME: c.home,
        SHELL: '/bin/zsh',
        NPM_CONFIG_PREFIX: c.prefix,
        CLAUDE_CONFIG_DIR: join(c.home, '.claude'),
        NODE_OPTIONS,
      },
    });
    assert.equal(r.exitCode, 1);
    const all = r.stderr + r.stdout;
    // 进入了主体（claude 解析通过 → 打印 starting）
    assert.ok(all.includes('Starting CC Viewer') || all.includes('starting') || all.includes('CLI'),
      `应进入 runCliMode 主体（越过 claude 解析），实得: ${all.slice(-300)}`);
    assert.ok(all.includes('CLI mode error:'),
      `runCliMode reject 应被顶层 .catch 捕获并打印 "CLI mode error:"，实得: ${all.slice(-300)}`);
    assert.ok(all.includes('blocked-proxy-for-test'), '应携带被阻断 import 的原始错误');
  });
});

// ════════════════════ B2. -SDK → runSdkMode 主体 reject → 顶层 .catch ════════════════════
// 本仓库装了 @anthropic-ai/claude-agent-sdk → isSdkAvailable() true → runSdkMode 不 fallback，
// 进入主体 → 跑完 registerWorkspace + 三个 env 设置（484-500）→ 在 `import('./server/server.js')`
// 处被 loader 阻断 → reject → 顶层 `.catch`（927-929）打印 "SDK mode error:" + exit 1。
// 阻断点选 server.js（runSdkMode 第一个会 bind 端口的步骤就是 import server.js → 模块顶层
// auto-startViewer）：throw 在 server.js 模块体执行前 → 无任何端口 bind，子进程干净退出。
// 覆盖 SDK-available 入口 + 主体前半段（cli-modes 只测了 SDK 不可用 fallback 路径）。

describeCli('cli-deep: -SDK runSdkMode（SDK 可用）主体抛错 → 顶层 .catch（SDK mode error:）', { concurrency: false }, () => {
  it('SDK 可用 + server.js import 阻断（bind 端口前）→ "SDK mode error:" 退出 1', () => {
    const c = fakeNativeClaudeEnv();
    const NODE_OPTIONS = importBlockerNodeOptions('/server/server.js', 'blocked-server-for-test');
    const r = runCli(['--sdk', '--no-open', 'dummy'], {
      env: {
        PATH: `${c.bin}:/usr/bin:/bin`,
        HOME: c.home,
        SHELL: '/bin/zsh',
        NPM_CONFIG_PREFIX: c.prefix,
        CLAUDE_CONFIG_DIR: join(c.home, '.claude'),
        NODE_OPTIONS,
      },
    });
    assert.equal(r.exitCode, 1);
    const all = r.stderr + r.stdout;
    assert.ok(!all.includes('falling back to PTY mode'),
      'SDK 装好时不应走 fallback（应进入 runSdkMode 主体）');
    assert.ok(all.includes('SDK mode error:'),
      `runSdkMode reject 应被顶层 .catch 捕获并打印 "SDK mode error:"，实得: ${all.slice(-300)}`);
    assert.ok(all.includes('blocked-server-for-test'), '应携带被阻断 import 的原始错误');
  });
});

// ════════════════════ B3. --im → runImMode 主体 reject → 顶层 .catch ════════════════════
// `--im dingtalk`（合法平台）→ runImMode 进入主体 → 在 `import('./server/lib/im/im-lock.js')`
// （acquireImLock 来源）处被 loader 阻断 → 抛错 → runImMode reject → 顶层 `.catch`（916-919）
// 打印 "IM mode error:" + exit 1。既有测试只覆盖了 runImMode 内部 process.exit 早退路径。

describeCli('cli-deep: --im runImMode 主体抛错 → 顶层 .catch（IM mode error:）', { concurrency: false }, () => {
  it('合法平台 + im-lock import 阻断 → "IM mode error:" 退出 1', () => {
    const home = mkTmp('ccv-deep-im-');
    const logDir = mkTmp('ccv-deep-imlog-');
    const NODE_OPTIONS = importBlockerNodeOptions('/server/lib/im/im-lock.js', 'blocked-imlock-for-test');
    const r = runCli(['--im', 'dingtalk'], {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: home,
        SHELL: '/bin/zsh',
        NPM_CONFIG_PREFIX: join(home, 'noprefix'),
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CCV_LOG_DIR: logDir,
        NODE_OPTIONS,
      },
    });
    assert.equal(r.exitCode, 1);
    const all = r.stderr + r.stdout;
    assert.ok(all.includes('IM mode error:'),
      `runImMode reject 应被顶层 .catch 捕获并打印 "IM mode error:"，实得: ${all.slice(-300)}`);
    assert.ok(all.includes('blocked-imlock-for-test'), '应携带被阻断 import 的原始错误');
  });
});

// ════════════════════ C. npm-mode -logger：injectCliJs 抛非 ENOENT → cli.inject.fail ════════════════════
// fake npm（`npm root -g` → 自建 gnm）+ 其中 fake 全局 cli.js 预置 legacy inject marker。
// -logger 探测到 cli.js 存在 → mode='npm' → injectCliJs() 读到 legacy marker（regex 命中）→
// 计算出与原文不同的 updated → 尝试 writeFileSync。把 fake cli.js + 其父目录设只读 →
// writeFileSync 抛 EACCES（err.code !== 'ENOENT'）→ 走通用失败分支（884 + 888-891）→
// console.error(cli.inject.fail) + exit 1。既有 cli-modes 只覆盖了注入成功路径。

describeCli('cli-deep: -logger npm-mode injectCliJs writeFileSync 失败 → cli.inject.fail', { concurrency: false }, () => {
  it('legacy marker + 只读 cli.js/父目录 → EACCES（非 ENOENT）→ "Installation failed" 退出 1', () => {
    const root = mkTmp('ccv-deep-npmerr-');
    const bin = join(root, 'bin');
    const gnm = join(root, 'gnm');
    const pkg = join(gnm, '@anthropic-ai', 'claude-code');
    const home = join(root, 'home');
    mkdirSync(bin, { recursive: true });
    mkdirSync(pkg, { recursive: true });
    mkdirSync(home, { recursive: true });

    // fake 全局 cli.js：预置 *legacy* marker（regex 会命中 → rewrite → 触发 writeFileSync）
    const fakeCli = join(pkg, 'cli.js');
    writeFileSync(fakeCli,
      '#!/usr/bin/env node\n' +
      '// >>> Start CC Viewer Web Service >>>\n' +
      "import '../../cc-viewer/interceptor.js';\n" +
      '// <<< Start CC Viewer Web Service <<<\n' +
      'console.log("stub");\n');

    // fake npm：`npm root -g` 报告我们的 gnm
    const fakeNpm = join(bin, 'npm');
    writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
    chmodSync(fakeNpm, 0o755);
    writeFileSync(join(home, '.zshrc'), '# my zshrc\n');

    // cli.js 只读 + 父目录只读 → writeFileSync 抛 EACCES
    chmodSync(fakeCli, 0o444);
    chmodSync(pkg, 0o555);

    const r = runCli(['-logger'], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        SHELL: '/bin/zsh',
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CCV_LOG_DIR: 'tmp',
      },
    });

    // 复原权限供后续断言读取 + after() 清理
    chmodSync(pkg, 0o755);
    try { chmodSync(fakeCli, 0o644); } catch {}

    // root 用户会无视权限位（writeFileSync 不抛）→ 注入成功；非 root 下命中 EACCES 失败分支。
    const stillLegacy = readFileSync(fakeCli, 'utf-8').includes("../../cc-viewer/interceptor.js");
    if (stillLegacy) {
      // 写失败（非 root）：应 exit 1 + cli.inject.fail 文案（含 EACCES / Installation failed）
      assert.equal(r.exitCode, 1, '注入写失败应 exit 1');
      const all = r.stderr + r.stdout;
      assert.ok(all.includes('Installation failed') || all.includes('EACCES') || all.includes('安装失败'),
        `应命中 cli.inject.fail（通用错误分支），实得: ${all.slice(-300)}`);
    } else {
      // root：写成功，legacy marker 被 rewrite 成当前形态 → exit 0（仍是有效覆盖：走了注入成功路径）
      assert.equal(r.exitCode, 0);
      assert.ok(readFileSync(fakeCli, 'utf-8').includes("import 'cc-viewer/interceptor.js';"),
        'root 下 legacy marker 应被 rewrite 成当前 INJECT_IMPORT');
    }
  });
});

// ════════════════════ C2. npm-mode -logger：cli.js 注入成功但 shell hook 写失败 → cli.hook.fail ════════════════════
// fake cli.js 可写（injectCliJs 成功 → cliResult='injected'）但 .zshrc + home 只读 →
// installShellHook(false) 的 writeFileSync 抛 → catch 返回 {status:'error'} →
// shellResult.status 既非 'installed' 也非 'exists'（879 `!== 'exists'` true）→ 命中 880-881
// console.log(cli.hook.fail)。这是 cli-modes 的 *native*-mode hook.fail 在 npm 分支的对应物
// （那条走 904-905，本条走 880-881，不同 i18n key 与代码分支）。整体仍 exit 0。

describeCli('cli-deep: -logger npm-mode cli.js 注入成功但 hook 写失败 → cli.hook.fail（880-881）', { concurrency: false }, () => {
  it('可写 cli.js + 只读 .zshrc/home → 注入成功、hook 写失败，报 hook fail，整体 exit 0', () => {
    const root = mkTmp('ccv-deep-npmhookfail-');
    const bin = join(root, 'bin');
    const gnm = join(root, 'gnm');
    const pkg = join(gnm, '@anthropic-ai', 'claude-code');
    const home = join(root, 'home');
    mkdirSync(bin, { recursive: true });
    mkdirSync(pkg, { recursive: true });
    mkdirSync(home, { recursive: true });

    // fake 全局 cli.js：全新（无 marker）+ 可写 → injectCliJs 成功注入
    const fakeCli = join(pkg, 'cli.js');
    writeFileSync(fakeCli, '#!/usr/bin/env node\nconsole.log("stub");\n');
    const fakeNpm = join(bin, 'npm');
    writeFileSync(fakeNpm, `#!/bin/sh\necho "${gnm}"\n`);
    chmodSync(fakeNpm, 0o755);

    // .zshrc + home 只读 → installShellHook(false) 写 hook 失败 → {status:'error'}
    const zshrc = join(home, '.zshrc');
    writeFileSync(zshrc, '# my zshrc\n');
    chmodSync(zshrc, 0o444);
    chmodSync(home, 0o555);

    const r = runCli(['-logger'], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        SHELL: '/bin/zsh',
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        CCV_LOG_DIR: 'tmp',
      },
    });

    // 复原权限供断言读取 + after() 清理
    chmodSync(home, 0o755);
    try { chmodSync(zshrc, 0o644); } catch {}

    assert.equal(r.exitCode, 0, '-logger 整体应 exit 0（hook 写失败只是某一步）');
    // cli.js 注入应已成功（与 hook 写失败相互独立）
    assert.ok(readFileSync(fakeCli, 'utf-8').includes('cc-viewer/interceptor.js'),
      'cli.js 注入应已成功（injectCliJs 与 installShellHook 相互独立）');
    // root 会无视权限位（hook 写成功）；非 root 下命中 hook.fail 文案。
    const hookWritten = readFileSync(zshrc, 'utf-8').includes('CC-Viewer Auto-Inject');
    if (!hookWritten) {
      assert.ok(/Failed to write shell hook|hook/i.test(r.stdout),
        `hook 写失败时应命中 cli.hook.fail 文案，实得: ${r.stdout.slice(-300)}`);
    }
  });
});
