#!/usr/bin/env node

// Windows NTFS + Defender increase per-async-IO overhead; default 4 threads aren't enough
if (process.platform === 'win32' && !process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '16';
}

import { readFileSync, writeFileSync, existsSync, realpathSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { t } from './server/i18n.js';
import { INJECT_IMPORT, LEGACY_INJECT_IMPORTS, resolveCliPath, resolveNativePath, resolveNpmClaudePath, buildShellCandidates, setLogDir, LOG_DIR, hasClaude2xWrapper, getGlobalNodeModulesDir, PACKAGES, getClaudeConfigDir, isBrowserOpenSuppressed, applyAgentTeamsDefault } from './findcc.js';
import { ensureHooks, removeAllManagedHooks } from './server/lib/ensure-hooks.js';
import { injectCliJsAt, removeCliJsInjectionAt, INJECT_START as _INJECT_START, INJECT_END as _INJECT_END, buildInjectBlock as _buildInjectBlock } from './server/lib/cli-inject.js';
import { normalizeBasePath } from './server/lib/base-path.js';
import { createHardenedCleanup, installWinKeypressFallback } from './server/lib/term-signals.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Default agent-teams (UltraPlan / AgentTeam) on unless the user explicitly
// configured the flag (shell env or settings.json). Runs before any mode dispatch,
// so the value is inherited by the spawned claude and reported by /api/claude-settings.
applyAgentTeamsDefault();

// Injection marker constants are defined in server/lib/cli-inject.js (for testability);
// This file only re-exports them for use by helpers and hooks, preserving existing behavior.
const INJECT_START = _INJECT_START;
const INJECT_END = _INJECT_END;
const INJECT_BLOCK = _buildInjectBlock(INJECT_IMPORT);


const SHELL_HOOK_START = '# >>> CC-Viewer Auto-Inject >>>';
const SHELL_HOOK_END = '# <<< CC-Viewer Auto-Inject <<<';

const cliPath = resolveCliPath();

// Unified "claude not found" error message: distinguishes between "Claude Code 2.x wrapper
// installed but native binary not ready (--ignore-scripts / --omit=optional / certain pnpm
// configurations)" and "claude not installed at all," giving targeted fix guidance.
function reportClaudeNotFound(cliPathHint) {
  const globalRoot = getGlobalNodeModulesDir();
  if (hasClaude2xWrapper(globalRoot)) {
    // 2.x wrapper 在场但找不到可执行二进制：大概率是 postinstall 没跑
    console.error(t('cli.claude2x.binaryMissing'));
    for (const pkg of PACKAGES) {
      const installScript = resolve(globalRoot, pkg, 'install.cjs');
      if (existsSync(installScript)) {
        console.error(`  node ${installScript}`);
        break;
      }
    }
    console.error(t('cli.claude2x.reinstallHint'));
  } else {
    // 完全没检测到 Claude Code 安装
    console.error(t('cli.inject.notFound', { path: cliPathHint || cliPath }));
    console.error(t('cli.notFound.nativeHint'));
  }
}

function getShellConfigPath() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return resolve(homedir(), '.zshrc');
  if (shell.includes('bash')) {
    const bashProfile = resolve(homedir(), '.bash_profile');
    if (process.platform === 'darwin' && existsSync(bashProfile)) return bashProfile;
    return resolve(homedir(), '.bashrc');
  }
  return resolve(homedir(), '.zshrc');
}

function buildShellHook(isNative) {
  // Commands/flags that should pass through directly without ccv interception
  // These are non-interactive commands that don't involve API calls
  const passthroughCommands = [
    // Subcommands (no API calls)
    'doctor',      // health check for auto-updater
    'install',     // install native build
    'update',      // self-update
    'upgrade',     // alias for update
    'auth',        // authentication management
    'setup-token', // token setup
    'agents',      // list configured agents
    'plugin',      // plugin management
    'plugins',     // alias for plugin
    'mcp',         // MCP server configuration
  ];

  const passthroughFlags = [
    // Version/help info
    '--version', '-v', '--v',
    '--help', '-h',
  ];

  if (isNative) {
    return `${SHELL_HOOK_START}
claude() {
  # Avoid recursion if ccv invokes claude
  if [ "$1" = "--ccv-internal" ]; then
    shift
    command claude "$@"
    return
  fi
  # Pass through certain commands directly without ccv interception
  case "$1" in
    ${passthroughCommands.join('|')})
      command claude "$@"
      return
      ;;
    ${passthroughFlags.join('|')})
      command claude "$@"
      return
      ;;
  esac
  ccv run -- claude --ccv-internal "$@"
}
${SHELL_HOOK_END}`;
  }

  const candidates = buildShellCandidates();
  return `${SHELL_HOOK_START}
claude() {
  # Avoid recursion if ccv invokes claude (used by the 2.x self-heal path below)
  if [ "$1" = "--ccv-internal" ]; then
    shift
    command claude "$@"
    return
  fi
  # Pass through certain commands directly without ccv interception
  case "$1" in
    ${passthroughCommands.join('|')})
      command claude "$@"
      return
      ;;
    ${passthroughFlags.join('|')})
      command claude "$@"
      return
      ;;
  esac
  local cli_js=""
  for candidate in ${candidates}; do
    if [ -f "$candidate" ]; then
      cli_js="$candidate"
      break
    fi
  done
  if [ -z "$cli_js" ]; then
    # cli.js 消失 → Claude Code 已升级到 2.1.114+（native-only 分发）。
    # 后台重写 hook（下次 shell 就是 native hook），当前调用直接走 native proxy 路径。
    ( ccv -logger >/dev/null 2>&1 & )
    ccv run -- claude --ccv-internal "$@"
    return $?
  fi
  if ! grep -q "CC Viewer" "$cli_js" 2>/dev/null; then
    ccv -logger 2>/dev/null
  fi
  command claude "$@"
}
${SHELL_HOOK_END}`;
}

function installShellHook(isNative) {
  const configPath = getShellConfigPath();
  try {
    let content = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';

    if (content.includes(SHELL_HOOK_START)) {
      const hook = buildShellHook(isNative);
      // Extract existing hook content
      const regex = new RegExp(`${SHELL_HOOK_START}[\\s\\S]*?${SHELL_HOOK_END}`);
      const existingMatch = content.match(regex);
      if (existingMatch && existingMatch[0] === hook) {
        return { path: configPath, status: 'exists' };
      }
      // Hook content differs: remove old and reinstall
      removeShellHook();
      content = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
    }

    const hook = buildShellHook(isNative);
    const newContent = content.endsWith('\n') ? content + '\n' + hook + '\n' : content + '\n\n' + hook + '\n';
    writeFileSync(configPath, newContent);
    return { path: configPath, status: 'installed' };
  } catch (err) {
    return { path: configPath, status: 'error', error: err.message };
  }
}

function removeShellHook() {
  // 扫描所有可能的 shell 配置文件，清理所有遗留 hook
  const configPath = getShellConfigPath();
  const allPaths = new Set([configPath]);
  const home = homedir();
  for (const f of ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile']) {
    allPaths.add(resolve(home, f));
  }
  let lastResult = { path: configPath, status: 'clean' };
  for (const p of allPaths) {
    try {
      if (!existsSync(p)) continue;
      const content = readFileSync(p, 'utf-8');
      if (!content.includes(SHELL_HOOK_START)) continue;
      const regex = new RegExp(`\\n?${SHELL_HOOK_START}[\\s\\S]*?${SHELL_HOOK_END}\\n?`, 'g');
      const newContent = content.replace(regex, '\n');
      writeFileSync(p, newContent);
      lastResult = { path: p, status: 'removed' };
    } catch (err) {
      lastResult = { path: p, status: 'error', error: err.message };
    }
  }
  return lastResult;
}

function injectCliJs() {
  return injectCliJsAt(cliPath, INJECT_IMPORT, LEGACY_INJECT_IMPORTS);
}

function removeCliJsInjection() {
  return removeCliJsInjectionAt(cliPath, INJECT_IMPORT, LEGACY_INJECT_IMPORTS);
}

async function runProxyCommand(args) {
  try {
    // Dynamic import to avoid side effects when just installing
    const { startProxy } = await import('./server/proxy.js');
    const proxyPort = await startProxy();

    // args = ['run', '--', 'command', 'claude', ...] or ['run', 'claude', ...]
    // Our hook uses: ccv run -- claude --ccv-internal "$@"
    // args[0] is 'run'.
    // If args[1] is '--', then command starts at args[2].

    let cmdStartIndex = 1;
    if (args[1] === '--') {
      cmdStartIndex = 2;
    }

    let cmd = args[cmdStartIndex];
    if (!cmd) {
      console.error('No command provided to run.');
      process.exit(1);
    }
    let cmdArgs = args.slice(cmdStartIndex + 1);

    // If cmd is 'claude' and next arg is '--ccv-internal', remove it
    // and we must use 'command claude' to avoid infinite recursion of the shell function?
    // Node spawn doesn't use shell functions, so 'claude' should resolve to the binary in PATH.
    // BUT, if 'claude' is a function in the current shell, spawn won't see it unless we use shell:true.
    // We are using shell:false (default).
    // So spawn('claude') should find /usr/local/bin/claude (the binary).
    // The issue might be that ccv itself is running in a way that PATH is weird?

    // Wait, the shell hook adds '--ccv-internal'. We should strip it before spawning.
    if (cmdArgs[0] === '--ccv-internal') {
      cmdArgs.shift();
    }

    const env = { ...process.env };
    // Determine the path to the native 'claude' executable
    if (cmd === 'claude') {
      const nativePath = resolveNativePath();
      if (nativePath) {
        cmd = nativePath;
      }
    }
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
    env.CCV_PROXY_MODE = '1'; // 告诉 interceptor.js 不要再启动 server
    // 剥离 cc-viewer 的内部短路开关，避免泄漏给 claude 子进程
    delete env.CCV_SKIP_THINKING_DISPLAY;

    const settingsJson = JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
      }
    });

    // 注入默认 --thinking-display summarized，仅对 claude 二进制（其他命令如 `ccv run -- sometool` 跳过）。
    // 若 claude 不识别该 flag（老版本/fork）会 unknown option 崩溃——由 pty-manager.js::spawnClaude 的
    // onExit reactive retry 兜底；cli.js 这条路径是一次性子进程，没有 respawn 机会，用户需手动重试。
    // 可通过环境变量 CCV_SKIP_THINKING_DISPLAY=1 强制跳过。
    const isClaudeCmd = cmd === 'claude' || /[\\/]claude(\.exe)?$/.test(cmd);
    if (isClaudeCmd && process.env.CCV_SKIP_THINKING_DISPLAY !== '1') {
      const { withDefaultThinkingDisplay } = await import('./server/pty-manager.js');
      cmdArgs = withDefaultThinkingDisplay(cmdArgs);
    }

    cmdArgs.unshift(settingsJson);
    cmdArgs.unshift('--settings');

    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', env });

    child.on('exit', (code) => {
      process.exit(code);
    });

    child.on('error', (err) => {
      console.error('Failed to start command:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('Proxy error:', err);
    process.exit(1);
  }
}

// ensureHooks() extracted to server/lib/ensure-hooks.js (shared with electron/tab-worker.js)

// Print the `--pid` instance id + this project's previously-used ids in the startup banner,
// so the user can recall which id to reuse (with `-c`) next time. No-op without `--pid`.
function printInstanceBanner(serverMod) {
  try {
    const id = serverMod.getInstanceId && serverMod.getInstanceId();
    if (!id) return;
    console.log(`  ${t('cli.instanceId', { id })}`);
    const known = (serverMod.getKnownInstances && serverMod.getKnownInstances()) || [];
    const others = known.filter((x) => x !== id);
    if (others.length) console.log(`  ${t('cli.instanceHistory', { ids: others.join(', ') })}`);
  } catch { /* banner is best-effort */ }
}

async function runCliMode(extraClaudeArgs = [], cwd, noOpen = false) {
  // 首先尝试 npm 版本（包括 nvm 安装），找不到再尝试 native 版本
  let claudePath = resolveNpmClaudePath();
  let isNpmVersion = !!claudePath;

  if (!claudePath) {
    claudePath = resolveNativePath();
  }

  if (!claudePath) {
    reportClaudeNotFound(cliPath);
    process.exit(1);
  }

  console.log(t('cli.cMode.starting'));

  const workingDir = cwd || process.cwd();

  // 注册工作区（IM worker 跳过：避免把 IM_<id>/ 目录塞进工作区选择器）
  if (!process.env.CCV_IM_PLATFORM) {
    const { registerWorkspace } = await import('./server/workspace-registry.js');
    await registerWorkspace(workingDir);
  }

  // 确保 AskUserQuestion hook 已注册到 ~/.claude/settings.json
  ensureHooks();

  // 2. 设置 CLI 模式标记（必须在 import proxy.js 之前，
  //    因为 proxy.js → interceptor.js 可能触发 server.js 加载，
  //    server.js 的 isCliMode 在模块顶层求值且只执行一次）
  process.env.CCV_CLI_MODE = '1';
  process.env.CCV_PROJECT_DIR = workingDir;
  process.env.CCV_PROXY_MODE = '1';
  // 当 --dangerously-skip-permissions 生效时，通知 perm-bridge 不要拦截
  if (extraClaudeArgs.includes('--dangerously-skip-permissions')) {
    process.env.CCV_BYPASS_PERMISSIONS = '1';
  }

  // 1. 启动代理
  const { startProxy } = await import('./server/proxy.js');
  const proxyPort = await startProxy();
  process.env.CCV_PROXY_PORT = String(proxyPort);

  // 3. 启动 HTTP 服务器
  const serverMod = await import('./server/server.js');

  // 等待服务器启动完成。IM worker 加 30s 死线：端口段(7050-7099)耗尽时 getPort() 恒为 0，
  // 否则 worker 会永久空转并占着 im.lock(port:null)。超时则退出(exit 钩子释放锁)，让用户快速看到失败、
  // manager 也能据此判死。普通 ccv 保持原有无限轮询行为不变。
  const _imPortDeadline = process.env.CCV_IM_PLATFORM ? Date.now() + 30000 : null;
  await new Promise((resolve, reject) => {
    const check = () => {
      const port = serverMod.getPort();
      if (port) return resolve(port);
      if (_imPortDeadline && Date.now() > _imPortDeadline) {
        return reject(new Error('no free port in 7050-7099 within 30s'));
      }
      setTimeout(check, 100);
    };
    setTimeout(check, 200);
  }).catch((e) => {
    console.error('[CC Viewer] IM worker could not bind a port:', e.message);
    process.exit(1); // process.on('exit') 会按身份释放 im.lock
  });

  const port = serverMod.getPort();
  const serverProtocol = serverMod.getProtocol();

  // IM worker：服务器监听成功后把真实端口回填进 im.lock（manager 据此做 HTTP 身份探测）
  if (process.env.CCV_IM_PLATFORM) {
    try {
      const { updateImLockPort } = await import('./server/lib/im-lock.js');
      updateImLockPort(process.env.CCV_IM_PLATFORM, port);
    } catch (e) {
      console.error('[CC Viewer] updateImLockPort failed:', e.message);
    }
  }

  // 3. 启动 PTY 中的 claude
  const { spawnClaude, killPty } = await import('./server/pty-manager.js');
  try {
    await spawnClaude(proxyPort, workingDir, extraClaudeArgs, claudePath, isNpmVersion, port, serverProtocol, serverMod.getInternalToken());
  } catch (err) {
    console.error('[CC Viewer] Failed to spawn Claude:', err.message);
    await serverMod.stopViewer();
    process.exit(1);
  }

  // 4. 自动打开浏览器
  const protocol = serverMod.getProtocol();
  const basePath = normalizeBasePath(process.env.CCV_BASE_PATH);
  const url = `${protocol}://127.0.0.1:${port}${basePath}`;
  if (!noOpen) {
    try {
      // URL 含 & 在 cmd.exe 下会被当命令分隔符切断 query；用 spawn 数组传参避免 shell interpolation。
      // Win 上 `start` 是 cmd.exe 内置不是 .exe，必须 shell:true；用 spawn + 数组让 Node 自己 escape。
      // 第二个 arg '""' 是 `start` 的 window-title 占位（否则 start 会把 URL 当 title）。
      const { spawn } = await import('node:child_process');
      // Headless/container envs may lack xdg-open/open/start → spawn asynchronously emits an 'error' event,
      // which try/catch cannot catch (it only catches synchronous throws); without a handler the process
      // would crash. Swallow it here as a best-effort fallback.
      let child;
      if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsHide: true });
      } else {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
      }
      child.on('error', () => {});
      child.unref();
    } catch {}
  }

  console.log(`CC Viewer:`);
  console.log(`  ➜ Local:   ${url}`);
  const _lanIps = serverMod.getAllLocalIps();
  const _token = serverMod.getAccessToken();
  for (const _ip of _lanIps) {
    console.log(`  ➜ Network: ${protocol}://${_ip}:${port}${basePath}?token=${_token}`);
  }
  // 密码登录已启用时,把当前密码打印出来 —— 否则 `ccv --usePassword`(随机密码)在 CLI 模式下
  // 用户无从得知密码(server.js 的密码打印只在非 CLI 模式生效)。空密码=无防护,给出警告。
  const _auth = serverMod.getAuthConfig && serverMod.getAuthConfig();
  if (_auth && _auth.enabled) {
    if (_auth.password === '') console.error(`  ${t('server.passwordEmptyWarn')}`);
    else console.log(`  ${t('server.passwordActive', { password: _auth.password })}`);
  }
  printInstanceBanner(serverMod);

  // 5. 注册退出处理（hardened：watchdog 5s 强退 + 连按 Ctrl+C 立退，
  //    防 Windows 上 ConPTY kill / IM teardown 挂住导致"Ctrl+C 完全无反应"）
  const cleanup = createHardenedCleanup({
    doCleanup: () => {
      killPty();
      return serverMod.stopViewer();
    },
  });
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  // Windows 兜底：ConPTY 下控制台 Ctrl+C 事件偶发不送达（SIGINT 永不触发），
  // raw mode keypress 直连 cleanup。silent 模式本地终端无人读 stdin，无副作用；
  // darwin / 非 TTY 内部自动跳过。
  installWinKeypressFallback({ onInterrupt: cleanup });
}

// 启动一个独立常驻 IM worker。本质是「在 IM_<id>/ 工作目录、绑 127.0.0.1、skip-permissions」的 runCliMode，
// 外加：全局唯一锁、CC_APPEND_SYSTEM.md 人格预置/迁移、IM 专属 env。由 im-process-manager 以 detached 子进程拉起，
// 也可手动 `ccv --im <id>` 启动。
async function runImMode(platformId) {
  const { getDescriptor } = await import('./server/lib/im-config.js');
  if (!getDescriptor(platformId)) {
    console.error(t('cli.imUnknownPlatform', { id: platformId }));
    process.exit(1);
  }

  const { acquireImLock, releaseImLock, imDir } = await import('./server/lib/im-lock.js');
  const { ensureImAppendSystem, migrateImClaudeMd } = await import('./server/lib/im-append-system.js');
  const { ensureImBuiltinSkills } = await import('./server/lib/im-skills.js');

  const dir = imDir(platformId);
  mkdirSync(dir, { recursive: true });

  // 全局唯一：被活进程持有则拒绝启动（loser 退出，manager 会观察到子进程秒退）
  const lockRes = acquireImLock(platformId);
  if (!lockRes.ok) {
    console.error(t('cli.imAlreadyRunning', { id: platformId, pid: lockRes.holder?.pid ?? '?' }));
    process.exit(3);
  }
  // 退出时按身份释放锁（exit 同步钩子在 process.exit()/SIGINT/SIGTERM→cleanup 后仍执行；
  // SIGKILL 不触发，由 manager 的 getImLiveness 兜底清理陈旧锁）
  process.on('exit', () => { try { releaseImLock(platformId, process.pid); } catch { /* noop */ } });

  // 一次性把遗留的 CLAUDE.md 迁为 CC_APPEND_SYSTEM.md（幂等：迁移=rename 移动、内容不丢；目标已有内容时不动 CLAUDE.md）；再确保默认存在。
  // 该文件由 pty-manager 启动 claude 时自动注入为 --append-system-prompt-file（追加系统提示，比旧
  // CLAUDE.md 项目记忆更难被来信指令绕过）。失败非致命：worker 照常启动。
  try { migrateImClaudeMd(platformId, dir); }
  catch (e) { console.warn('[CC Viewer] migrateImClaudeMd failed (non-fatal):', e.message); }
  try { ensureImAppendSystem(platformId, dir); }
  catch (e) { console.warn('[CC Viewer] ensureImAppendSystem failed (non-fatal):', e.message); }

  // 受管同步内置默认技能（manage-ccv-projects：列出/启动 ccv 项目 + 自我介绍）。失败非致命：worker 照常启动。
  try { ensureImBuiltinSkills(platformId, dir); }
  catch (e) { console.warn('[CC Viewer] ensureImBuiltinSkills failed (non-fatal):', e.message); }

  // 以下 env 必须在 import server.js（runCliMode 内）之前设置：server 顶层读 START_PORT/MAX_PORT/HOST。
  process.env.CCV_IM_PLATFORM = platformId;
  process.env.CCV_START_PORT = process.env.CCV_START_PORT || '7050'; // IM 端口段从 7050 起
  process.env.CCV_MAX_PORT = process.env.CCV_MAX_PORT || '7099';
  process.env.CCV_HOST = '127.0.0.1';  // 仅 loopback：不把 skip-perms 端点暴露到局域网
  process.env.CCV_IM_DENY = '1';       // 启用 perm-bridge 的 IM 硬拦截层
  // IM 人格(CC_APPEND_SYSTEM.md)必须始终注入：清掉全局 opt-out，使手动 `ccv --im` 也不被它关掉
  // （manager 拉起的 worker 由 buildChildEnv 已剥离全部 CCV_*，此处对其为 no-op，仅覆盖手动启动路径）。
  delete process.env.CCV_DISABLE_AUTO_SYSTEM_PROMPT;

  // worker 全自动：skip-permissions + 不开浏览器，工作目录设为 IM_<id>/
  return runCliMode(['--dangerously-skip-permissions'], dir, true);
}

async function runSdkMode(extraClaudeArgs = [], cwd, noOpen = false) {
  // 检查 SDK 是否可用
  let sdkManager;
  try {
    sdkManager = await import('./server/lib/sdk-manager.js');
    if (!sdkManager.isSdkAvailable()) throw new Error('query not available');
  } catch {
    console.warn('[CC Viewer] Agent SDK not available, falling back to PTY mode (-C)');
    return runCliMode(extraClaudeArgs, cwd, noOpen);
  }

  const workingDir = cwd || process.cwd();

  // 注册工作区
  const { registerWorkspace } = await import('./server/workspace-registry.js');
  await registerWorkspace(workingDir);

  // 不需要 ensureHooks — SDK canUseTool 处理 AskUserQuestion + 权限
  // 不需要 proxy — SDK 直接管理 API 通信

  // 设置环境标记（必须在 import server.js 之前）
  process.env.CCV_CLI_MODE = '1';
  process.env.CCV_SDK_MODE = '1';
  process.env.CCV_PROJECT_DIR = workingDir;
  process.env.CCV_PROXY_MODE = '1'; // 使 interceptor.js 惰性

  // 启动 HTTP 服务器
  const serverMod = await import('./server/server.js');

  await new Promise(resolve => {
    const check = () => {
      const port = serverMod.getPort();
      if (port) resolve(port);
      else setTimeout(check, 100);
    };
    setTimeout(check, 200);
  });

  const port = serverMod.getPort();
  const { basename } = await import('node:path');

  // 解析 permission mode from CLI args
  // --d / --dangerously-skip-permissions → bypassPermissions（跳过所有权限检查）
  // --ad / --allow-dangerously-skip-permissions → default（只是允许用户后续切换，不立即跳过）
  let permissionMode = 'default';
  if (extraClaudeArgs.includes('--dangerously-skip-permissions')) {
    permissionMode = 'bypassPermissions';
  }

  // 初始化 SDK 会话
  sdkManager.initSdkSession(workingDir, basename(workingDir), {
    onEntry: (entry) => serverMod.pushSdkEntry(entry),
    onStreamingStatus: (data) => serverMod.setSdkStreamingState(data),
    broadcastWs: (msg) => serverMod.broadcastWsMessage(msg),
    permissionMode,
    runWaterfallHook: (await import('./server/lib/plugin-loader.js')).runWaterfallHook,
    // Round-3 P0: SDK mode has no Stop hook (ensureHooks() skipped above), so
    // the only place we learn a turn ended is the SDK 'result' message. Forward
    // it to the same SSE channel the Stop hook bridge uses in PTY mode.
    // 包 try/catch + warn：rising-edge flush 假设「下一轮 active 之前 onTurnEnd 已到」，
    // 若 SDK 内部异常吞掉了 result 消息这条信号就丢了 —— 至少打个 warn 让排查时有线索。
    // 显式 typeof 检查：以前用可选链 `?.()` 在 export 缺失时返回 undefined → catch 永远不触发
    // → 「至少 warn」承诺落空，turn-end 静默丢，bug 极难追。
    onTurnEnd: ({ sessionId, ts }) => {
      if (typeof serverMod.broadcastTurnEnd !== 'function') {
        console.warn('[sdk] serverMod.broadcastTurnEnd is not a function (export missing?); turn-end signal dropped');
        return;
      }
      try { serverMod.broadcastTurnEnd(sessionId, ts); }
      catch (err) { console.warn('[sdk] broadcastTurnEnd threw:', err?.message); }
    },
  });

  // 注册 SDK 回调到 server.js（WS 消息路由用）
  serverMod.setSdkResolveApproval(sdkManager.resolveApproval);
  serverMod.setSdkCancelApproval(sdkManager.cancelApproval);
  serverMod.setSdkSendUserMessage(sdkManager.sendUserMessage);
  serverMod.setSdkInterruptTurn(sdkManager.interruptTurn);

  // 自动打开浏览器
  const protocol = serverMod.getProtocol();
  const basePath = normalizeBasePath(process.env.CCV_BASE_PATH);
  const url = `${protocol}://127.0.0.1:${port}${basePath}`;
  if (!noOpen) {
    try {
      // URL 含 & 在 cmd.exe 下会被当命令分隔符切断 query；用 spawn 数组传参避免 shell interpolation。
      // Win 上 `start` 是 cmd.exe 内置不是 .exe，必须 shell:true；用 spawn + 数组让 Node 自己 escape。
      // 第二个 arg '""' 是 `start` 的 window-title 占位（否则 start 会把 URL 当 title）。
      const { spawn } = await import('node:child_process');
      // Headless/container envs may lack xdg-open/open/start → spawn asynchronously emits an 'error' event,
      // which try/catch cannot catch (it only catches synchronous throws); without a handler the process
      // would crash. Swallow it here as a best-effort fallback.
      let child;
      if (process.platform === 'win32') {
        child = spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true, windowsHide: true });
      } else {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
      }
      child.on('error', () => {});
      child.unref();
    } catch {}
  }

  console.log(`CC Viewer (SDK mode):`);
  console.log(`  ➜ Local:   ${url}`);
  const _lanIps = serverMod.getAllLocalIps();
  const _token = serverMod.getAccessToken();
  for (const _ip of _lanIps) {
    console.log(`  ➜ Network: ${protocol}://${_ip}:${port}${basePath}?token=${_token}`);
  }
  // 密码登录已启用时,把当前密码打印出来 —— 否则 `ccv --usePassword`(随机密码)在 CLI 模式下
  // 用户无从得知密码(server.js 的密码打印只在非 CLI 模式生效)。空密码=无防护,给出警告。
  const _auth = serverMod.getAuthConfig && serverMod.getAuthConfig();
  if (_auth && _auth.enabled) {
    if (_auth.password === '') console.error(`  ${t('server.passwordEmptyWarn')}`);
    else console.log(`  ${t('server.passwordActive', { password: _auth.password })}`);
  }
  printInstanceBanner(serverMod);

  // 注册退出处理（hardened，与 PTY 模式同款三层防御）
  const cleanup = createHardenedCleanup({
    doCleanup: () => {
      sdkManager.stopSession();
      return serverMod.stopViewer();
    },
  });
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  installWinKeypressFallback({ onInterrupt: cleanup });
}

// === 主逻辑 ===

const args = process.argv.slice(2);

// --- CCV 专属参数提取（必须在动态 import 之前） ---
let noOpen = false;

// 提取 --log-dir <path>
const logDirIdx = args.indexOf('--log-dir');
if (logDirIdx !== -1) {
  const logDirVal = args[logDirIdx + 1];
  if (logDirVal && !logDirVal.startsWith('-')) {
    const prevDir = LOG_DIR;
    setLogDir(logDirVal);
    if (LOG_DIR === prevDir) {
      console.error(`Error: --log-dir path rejected (must be under home directory or /tmp/): ${logDirVal}`);
      process.exit(1);
    }
    args.splice(logDirIdx, 2);
  } else {
    console.error('Error: --log-dir requires a path argument');
    process.exit(1);
  }
}

// 提取 --no-open
const noOpenIdx = args.indexOf('--no-open');
if (noOpenIdx !== -1) {
  noOpen = true;
  args.splice(noOpenIdx, 1);
}
// L7 sandbox: never pop real browser windows from tests (NODE_TEST_CONTEXT) or
// CCV_NO_OPEN=1 environments — single derivation point feeding both run modes.
if (!noOpen && isBrowserOpenSuppressed()) {
  noOpen = true;
}

// Extract --user-name <name>
const userNameIdx = args.indexOf('--user-name');
if (userNameIdx !== -1) {
  const userNameVal = args[userNameIdx + 1];
  if (userNameVal && !userNameVal.startsWith('-')) {
    process.env.CCV_USER_NAME = userNameVal;
    args.splice(userNameIdx, 2);
  } else {
    console.error(t('cli.userNameRequired'));
    process.exit(1);
  }
}

// Extract --user-avatar <path|url>
const userAvatarIdx = args.indexOf('--user-avatar');
if (userAvatarIdx !== -1) {
  const userAvatarVal = args[userAvatarIdx + 1];
  if (userAvatarVal && !userAvatarVal.startsWith('-')) {
    // URLs and data URIs stored as-is; relative paths resolved to absolute immediately
    if (!userAvatarVal.startsWith('http://') && !userAvatarVal.startsWith('https://') &&
        !userAvatarVal.startsWith('data:') && !isAbsolute(userAvatarVal)) {
      process.env.CCV_USER_AVATAR = resolve(process.cwd(), userAvatarVal);
    } else {
      process.env.CCV_USER_AVATAR = userAvatarVal;
    }
    args.splice(userAvatarIdx, 2);
  } else {
    console.error(t('cli.userAvatarRequired'));
    process.exit(1);
  }
}

// Extract --usePassword[=<pwd>] — enable password login at startup.
// Bare form → random 6-char password; =<pwd> form → explicit. server.js resolves
// the final value: explicit > already-persisted > random.
const usePwdIdx = args.findIndex((a) => a === '--usePassword' || a.startsWith('--usePassword='));
if (usePwdIdx !== -1) {
  const arg = args[usePwdIdx];
  process.env.CCV_USE_PASSWORD = '1';
  const eq = arg.indexOf('=');
  if (eq !== -1) {
    const val = arg.slice(eq + 1);
    if (val.length > 0) process.env.CCV_PASSWORD = val;
  }
  args.splice(usePwdIdx, 1);
}

// Extract --pid[=<name>] / --pid <name> — instance id for per-instance session-pin isolation.
// NB: "pid" here is an instance *id* LABEL (user-chosen, e.g. alpha/beta), NOT an OS process id —
// it only keys the session-pin file `.session-pin.<id>.json`; unrelated to process.pid.
// ccv-owned (NEVER forwarded to claude — an unknown --pid would otherwise crash claude): sets
// CCV_INSTANCE_ID and splices out. Sanitized to a filesystem-safe token (it becomes part of a
// `.session-pin.<id>.json` filename → guard against path traversal / invalid names).
const pidIdx = args.findIndex((a) => a === '--pid' || a.startsWith('--pid='));
if (pidIdx !== -1) {
  const arg = args[pidIdx];
  let rawVal;
  if (arg.startsWith('--pid=')) {
    rawVal = arg.slice('--pid='.length);
    args.splice(pidIdx, 1);
  } else {
    rawVal = args[pidIdx + 1];
    if (rawVal && !rawVal.startsWith('-')) args.splice(pidIdx, 2);
    else { console.error(t('cli.pidInvalid')); process.exit(1); }
  }
  const sanitized = (rawVal || '').replace(/[^a-zA-Z0-9_\-.]/g, '_');
  if (!sanitized) { console.error(t('cli.pidInvalid')); process.exit(1); }
  process.env.CCV_INSTANCE_ID = sanitized;
}

// Extract --im <platformId> — 启动一个独立常驻 IM worker：工作目录 IM_<id>/、绑 127.0.0.1、
// skip-permissions、全局唯一锁。必须在动态 import 之前提取（runImMode 会在 import server.js 前设 env）。
let imPlatform = null;
const imIdx = args.indexOf('--im');
if (imIdx !== -1) {
  const val = args[imIdx + 1];
  if (val && !val.startsWith('-')) {
    imPlatform = val;
    args.splice(imIdx, 2);
  } else {
    console.error(t('cli.imRequiresId'));
    process.exit(1);
  }
}

// ccv 自有命令判断
const isLogger = args.includes('-logger');
const isUninstall = args.includes('--uninstall') || args.includes('-uninstall');
const isHelp = args.includes('--help') || args.includes('-h') || args[0] === 'help';
const isVersion = args.includes('--v') || args.includes('--version') || args.includes('-v');

if (isHelp) {
  console.log(t('cli.help'));
  process.exit(0);
}

if (isVersion) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
    console.log(`cc-viewer v${pkg.version}`);
  } catch (e) {
    console.error('Failed to read version:', e.message);
  }
  process.exit(0);
}

if (isUninstall) {
  const cliResult = removeCliJsInjection();
  const shellResult = removeShellHook();

  if (cliResult === 'removed' || cliResult === 'clean') {
    console.log(t('cli.uninstall.cliCleaned'));
  } else if (cliResult === 'not_found') {
    // Silent is better for mixed mode uninstall
  } else {
    console.log(t('cli.uninstall.cliFail'));
  }

  if (shellResult.status === 'removed') {
    console.log(t('cli.uninstall.hookRemoved', { path: shellResult.path }));
  } else if (shellResult.status === 'clean' || shellResult.status === 'not_found') {
    console.log(t('cli.uninstall.hookClean', { path: shellResult.path }));
  } else {
    console.log(t('cli.uninstall.hookFail', { error: shellResult.error }));
  }

  // 清理 settings.json 里的 cc-viewer-managed hooks + 历史 statusLine 残留
  // 一次性 read-modify-write，避免对 settings.json 做两轮 IO。
  try {
    const settingsPath = resolve(getClaudeConfigDir(), 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      let mutated = false;

      // 1) 移除所有带 cc-viewer-managed marker 的 hook entry（PreToolUse + Stop）
      //    无此清理 → npm uninstall 后用户 settings.json 仍含 dead path → claude 启动
      //    时每个工具调用都 ENOENT 报错。
      const removed = removeAllManagedHooks(settings);
      if (removed > 0) {
        mutated = true;
        console.log(`Removed ${removed} cc-viewer-managed hook entr${removed === 1 ? 'y' : 'ies'} from settings.json`);
      }

      // 2) 历史 statusLine 残留
      if (settings.statusLine?.command?.includes('ccv-statusline')) {
        delete settings.statusLine;
        mutated = true;
        console.log('Cleaned statusLine config from settings.json');
      }

      if (mutated) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
      }
    }
    const ccvScript = resolve(getClaudeConfigDir(), 'ccv-statusline.sh');
    if (existsSync(ccvScript)) {
      unlinkSync(ccvScript);
      console.log('Removed ccv-statusline.sh');
    }
    // 清理 context-window.json
    const ctxFile = resolve(getClaudeConfigDir(), 'context-window.json');
    if (existsSync(ctxFile)) {
      unlinkSync(ctxFile);
    }
  } catch { }

  console.log(t('cli.uninstall.reloadShell'));
  console.log(t('cli.uninstall.done'));
  process.exit(0);
}

if (isLogger) {
  // 模式选择：有 cli.js 就走 npm 注入模式（pre-2.1.113），没有就走 native proxy
  // 模式（2.1.114+）。单一判据，不再靠 realpath 的启发式。
  const nativePath = resolveNativePath();
  const hasNpm = existsSync(cliPath);
  let mode = 'unknown';
  if (hasNpm) mode = 'npm';
  else if (nativePath) mode = 'native';

  if (mode === 'unknown') {
    reportClaudeNotFound(cliPath);
    process.exit(1);
  }

  if (mode === 'npm') {
    try {
      const cliResult = injectCliJs();
      const shellResult = installShellHook(false);

      if (cliResult === 'exists' && shellResult.status === 'exists') {
        console.log(t('cli.alreadyWorking'));
      } else {
        if (cliResult === 'exists') {
          console.log(t('cli.inject.exists'));
        } else {
          console.log(t('cli.inject.success'));
        }

        if (shellResult.status === 'installed') {
          console.log('All READY!');
        } else if (shellResult.status !== 'exists') {
          console.log(t('cli.hook.fail', { error: shellResult.error }));
        }
      }
      console.log(t('cli.usage.hint'));
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.error(t('cli.inject.notFound', { path: cliPath }));
        console.error(t('cli.inject.notFoundHint'));
      } else {
        console.error(t('cli.inject.fail', { error: err.message }));
      }
      process.exit(1);
    }
  } else {
    // Native Mode
    try {
      console.log('Detected Claude Code Native Install.');
      const shellResult = installShellHook(true);

      if (shellResult.status === 'exists') {
        console.log(t('cli.alreadyWorking'));
      } else if (shellResult.status === 'installed') {
        console.log('Native Hook Installed! All READY!');
      } else {
        console.log(t('cli.hook.fail', { error: shellResult.error }));
      }
      console.log(t('cli.usage.hint'));
    } catch (err) {
      console.error('Failed to install native hook:', err);
      process.exit(1);
    }
  }
  process.exit(0);
}

if (imPlatform) {
  // 独立 IM worker 模式
  runImMode(imPlatform).catch(err => {
    console.error('IM mode error:', err);
    process.exit(1);
  });
} else if (args[0] === 'run') {
  runProxyCommand(args);
} else if (args.includes('-SDK') || args.includes('--sdk')) {
  // SDK 模式（显式 -SDK 切换）
  const claudeArgs = args.filter(a => a !== '-SDK' && a !== '--sdk')
    .map(a => a === '--d' ? '--dangerously-skip-permissions' : a === '--ad' ? '--allow-dangerously-skip-permissions' : a);
  runSdkMode(claudeArgs, process.cwd(), noOpen).catch(err => {
    console.error('SDK mode error:', err);
    process.exit(1);
  });
} else {
  // PTY 模式（默认）
  const claudeArgs = args.map(a => a === '--d' ? '--dangerously-skip-permissions' : a === '--ad' ? '--allow-dangerously-skip-permissions' : a);
  runCliMode(claudeArgs, process.cwd(), noOpen).catch(err => {
    console.error('CLI mode error:', err);
    process.exit(1);
  });
}
