#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, realpathSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { t } from './i18n.js';
import { INJECT_IMPORT, resolveCliPath, resolveNativePath, resolveNpmClaudePath, buildShellCandidates, setLogDir, LOG_DIR } from './findcc.js';
import { ensureHooks } from './lib/ensure-hooks.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const INJECT_START = '// >>> Start CC Viewer Web Service >>>';
const INJECT_END = '// <<< Start CC Viewer Web Service <<<';
const INJECT_BLOCK = `${INJECT_START}\n${INJECT_IMPORT}\n${INJECT_END}`;


const SHELL_HOOK_START = '# >>> CC-Viewer Auto-Inject >>>';
const SHELL_HOOK_END = '# <<< CC-Viewer Auto-Inject <<<';

const cliPath = resolveCliPath();

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
  if [ -n "$cli_js" ] && ! grep -q "CC Viewer" "$cli_js" 2>/dev/null; then
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
  const content = readFileSync(cliPath, 'utf-8');
  if (content.includes(INJECT_START)) {
    return 'exists';
  }
  const lines = content.split('\n');
  lines.splice(2, 0, INJECT_BLOCK);
  writeFileSync(cliPath, lines.join('\n'));
  return 'injected';
}

function removeCliJsInjection() {
  try {
    if (!existsSync(cliPath)) return 'not_found';
    const content = readFileSync(cliPath, 'utf-8');
    if (!content.includes(INJECT_START)) return 'clean';
    const regex = new RegExp(`${INJECT_START}\\n${INJECT_IMPORT}\\n${INJECT_END}\\n?`, 'g');
    writeFileSync(cliPath, content.replace(regex, ''));
    return 'removed';
  } catch {
    return 'error';
  }
}

async function runProxyCommand(args) {
  try {
    // Dynamic import to avoid side effects when just installing
    const { startProxy } = await import('./proxy.js');
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

    const settingsJson = JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
      }
    });

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

// ensureHooks() extracted to lib/ensure-hooks.js (shared with electron/tab-worker.js)

async function runCliMode(extraClaudeArgs = [], cwd, noOpen = false) {
  // 首先尝试 npm 版本（包括 nvm 安装），找不到再尝试 native 版本
  let claudePath = resolveNpmClaudePath();
  let isNpmVersion = !!claudePath;

  if (!claudePath) {
    claudePath = resolveNativePath();
  }

  if (!claudePath) {
    console.error(t('cli.cMode.notFound'));
    process.exit(1);
  }

  console.log(t('cli.cMode.starting'));

  const workingDir = cwd || process.cwd();

  // 注册工作区
  const { registerWorkspace } = await import('./workspace-registry.js');
  registerWorkspace(workingDir);

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
  const { startProxy } = await import('./proxy.js');
  const proxyPort = await startProxy();
  process.env.CCV_PROXY_PORT = String(proxyPort);

  // 3. 启动 HTTP 服务器
  const serverMod = await import('./server.js');

  // 等待服务器启动完成
  await new Promise(resolve => {
    const check = () => {
      const port = serverMod.getPort();
      if (port) resolve(port);
      else setTimeout(check, 100);
    };
    setTimeout(check, 200);
  });

  const port = serverMod.getPort();

  // 3. 启动 PTY 中的 claude
  const { spawnClaude, killPty } = await import('./pty-manager.js');
  try {
    await spawnClaude(proxyPort, workingDir, extraClaudeArgs, claudePath, isNpmVersion, port);
  } catch (err) {
    console.error('[CC Viewer] Failed to spawn Claude:', err.message);
    await serverMod.stopViewer();
    process.exit(1);
  }

  // 4. 自动打开浏览器
  const protocol = serverMod.getProtocol();
  const url = `${protocol}://127.0.0.1:${port}`;
  if (!noOpen) {
    try {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      const { execSync } = await import('node:child_process');
      execSync(`${cmd} ${url}`, { stdio: 'ignore', timeout: 5000 });
    } catch {}
  }

  console.log(`CC Viewer:`);
  console.log(`  ➜ Local:   ${url}`);
  const _lanIps = serverMod.getAllLocalIps();
  const _token = serverMod.getAccessToken();
  for (const _ip of _lanIps) {
    console.log(`  ➜ Network: ${protocol}://${_ip}:${port}?token=${_token}`);
  }

  // 5. 注册退出处理
  const cleanup = () => {
    killPty();
    serverMod.stopViewer().finally(() => process.exit());
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function runSdkMode(extraClaudeArgs = [], cwd, noOpen = false) {
  // 检查 SDK 是否可用
  let sdkManager;
  try {
    sdkManager = await import('./lib/sdk-manager.js');
    if (!sdkManager.isSdkAvailable()) throw new Error('query not available');
  } catch {
    console.warn('[CC Viewer] Agent SDK not available, falling back to PTY mode (-C)');
    return runCliMode(extraClaudeArgs, cwd, noOpen);
  }

  const workingDir = cwd || process.cwd();

  // 注册工作区
  const { registerWorkspace } = await import('./workspace-registry.js');
  registerWorkspace(workingDir);

  // 不需要 ensureHooks — SDK canUseTool 处理 AskUserQuestion + 权限
  // 不需要 proxy — SDK 直接管理 API 通信

  // 设置环境标记（必须在 import server.js 之前）
  process.env.CCV_CLI_MODE = '1';
  process.env.CCV_SDK_MODE = '1';
  process.env.CCV_PROJECT_DIR = workingDir;
  process.env.CCV_PROXY_MODE = '1'; // 使 interceptor.js 惰性

  // 启动 HTTP 服务器
  const serverMod = await import('./server.js');

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
  });

  // 注册 SDK 回调到 server.js（WS 消息路由用）
  serverMod.setSdkResolveApproval(sdkManager.resolveApproval);
  serverMod.setSdkSendUserMessage(sdkManager.sendUserMessage);

  // 自动打开浏览器
  const protocol = serverMod.getProtocol();
  const url = `${protocol}://127.0.0.1:${port}`;
  if (!noOpen) {
    try {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      const { execSync } = await import('node:child_process');
      execSync(`${cmd} ${url}`, { stdio: 'ignore', timeout: 5000 });
    } catch {}
  }

  console.log(`CC Viewer (SDK mode):`);
  console.log(`  ➜ Local:   ${url}`);
  const _lanIps = serverMod.getAllLocalIps();
  const _token = serverMod.getAccessToken();
  for (const _ip of _lanIps) {
    console.log(`  ➜ Network: ${protocol}://${_ip}:${port}?token=${_token}`);
  }

  // 注册退出处理
  const cleanup = () => {
    sdkManager.stopSession();
    serverMod.stopViewer().finally(() => process.exit());
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

async function runCliModeWorkspaceSelector(extraClaudeArgs = [], noOpen = false) {
  // 首先尝试 npm 版本（包括 nvm 安装），找不到再尝试 native 版本
  let claudePath = resolveNpmClaudePath();
  let isNpmVersion = !!claudePath;

  if (!claudePath) {
    claudePath = resolveNativePath();
  }

  if (!claudePath) {
    console.error(t('cli.cMode.notFound'));
    process.exit(1);
  }

  console.log(t('cli.cMode.starting'));

  process.env.CCV_CLI_MODE = '1';
  process.env.CCV_WORKSPACE_MODE = '1';

  // 启动代理
  const { startProxy } = await import('./proxy.js');
  const proxyPort = await startProxy();
  process.env.CCV_PROXY_PORT = String(proxyPort);

  // 启动 HTTP 服务器（工作区模式，不初始化 interceptor 日志）
  const serverMod = await import('./server.js');

  // 工作区模式下 server.js 跳过了自动启动，需要手动调用
  await serverMod.startViewer();

  const port = serverMod.getPort();

  // 保存 extraClaudeArgs 和 claudePath 供后续 launch 使用
  serverMod.setWorkspaceClaudeArgs(extraClaudeArgs);
  serverMod.setWorkspaceClaudePath(claudePath, isNpmVersion);

  // 自动打开浏览器
  const wsProtocol = serverMod.getProtocol();
  const url = `${wsProtocol}://127.0.0.1:${port}`;
  if (!noOpen) {
    try {
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      const { execSync } = await import('node:child_process');
      execSync(`${cmd} ${url}`, { stdio: 'ignore', timeout: 5000 });
    } catch {}
  }

  console.log(`CC Viewer (Workspace):`);
  console.log(`  ➜ Local:   ${url}`);
  const _lanIps = serverMod.getAllLocalIps();
  const _token = serverMod.getAccessToken();
  for (const _ip of _lanIps) {
    console.log(`  ➜ Network: ${wsProtocol}://${_ip}:${port}?token=${_token}`);
  }

  // 注册退出处理
  const { killPty } = await import('./pty-manager.js');
  const cleanup = () => {
    killPty();
    serverMod.stopViewer().finally(() => process.exit());
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
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

  // 清理 statusLine 配置和脚本（兼容历史版本遗留）
  try {
    const settingsPath = resolve(homedir(), '.claude', 'settings.json');
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.statusLine?.command?.includes('ccv-statusline')) {
        delete settings.statusLine;
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('Cleaned statusLine config from settings.json');
      }
    }
    const ccvScript = resolve(homedir(), '.claude', 'ccv-statusline.sh');
    if (existsSync(ccvScript)) {
      unlinkSync(ccvScript);
      console.log('Removed ccv-statusline.sh');
    }
    // 清理 context-window.json
    const ctxFile = resolve(homedir(), '.claude', 'context-window.json');
    if (existsSync(ctxFile)) {
      unlinkSync(ctxFile);
    }
  } catch { }

  console.log(t('cli.uninstall.reloadShell'));
  console.log(t('cli.uninstall.done'));
  process.exit(0);
}

if (isLogger) {
  // 安装/修复 hook 逻辑（原来无参数 ccv 的行为）
  let mode = 'unknown';

  let prefersNative = true;
  const paths = (process.env.PATH || '').split(':');
  for (const dir of paths) {
    if (!dir) continue;
    const exePath = resolve(dir, 'claude');
    if (existsSync(exePath)) {
      try {
        const real = realpathSync(exePath);
        if (real.includes('node_modules')) {
          prefersNative = false;
        } else {
          prefersNative = true;
        }
        break;
      } catch (e) {
        // ignore
      }
    }
  }

  const nativePath = resolveNativePath();
  const hasNpm = existsSync(cliPath);

  if (prefersNative) {
    if (nativePath) {
      mode = 'native';
    } else if (hasNpm) {
      mode = 'npm';
    }
  } else {
    if (hasNpm) {
      mode = 'npm';
    } else if (nativePath) {
      mode = 'native';
    }
  }

  if (mode === 'unknown') {
    console.error(t('cli.inject.notFound', { path: cliPath }));
    console.error('Also could not find native "claude" command in PATH.');
    console.error('Please make sure @anthropic-ai/claude-code is installed.');
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

if (args[0] === 'run') {
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
