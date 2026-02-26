#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { t } from './i18n.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const INJECT_START = '// >>> Start CC Viewer Web Service >>>';
const INJECT_END = '// <<< Start CC Viewer Web Service <<<';
const INJECT_IMPORT = "import '../../cc-viewer/interceptor.js';";
const INJECT_BLOCK = `${INJECT_START}\n${INJECT_IMPORT}\n${INJECT_END}`;


const SHELL_HOOK_START = '# >>> CC-Viewer Auto-Inject >>>';
const SHELL_HOOK_END = '# <<< CC-Viewer Auto-Inject <<<';

// Claude Code cli.js 包名候选列表，按优先级排列
const CLAUDE_CODE_PACKAGES = [
  '@anthropic-ai/claude-code',
  '@ali/claude-code',
];

function getGlobalNodeModulesDir() {
  try {
    return execSync('npm root -g', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function resolveClaudeCodeCliPath() {
  // 候选基础目录：__dirname 的上级（适用于常规 npm 安装）+ 全局 node_modules（适用于符号链接安装）
  const baseDirs = [resolve(__dirname, '..')];
  const globalRoot = getGlobalNodeModulesDir();
  if (globalRoot && globalRoot !== resolve(__dirname, '..')) {
    baseDirs.push(globalRoot);
  }

  for (const baseDir of baseDirs) {
    for (const packageName of CLAUDE_CODE_PACKAGES) {
      const candidate = join(baseDir, packageName, 'cli.js');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  // 兜底：返回全局目录下的默认路径，便于错误提示
  return join(globalRoot || resolve(__dirname, '..'), CLAUDE_CODE_PACKAGES[0], 'cli.js');
}

const cliPath = resolveClaudeCodeCliPath();

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
  if (isNative) {
    return `${SHELL_HOOK_START}
claude() {
  # Avoid recursion if ccv invokes claude
  if [ "$1" = "--ccv-internal" ]; then
    shift
    command claude "$@"
    return
  fi
  ccv run -- claude --ccv-internal "$@"
}
${SHELL_HOOK_END}`;
  }

  return `${SHELL_HOOK_START}
claude() {
  local cli_js=""
  for candidate in "$HOME/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js" "$HOME/.npm-global/lib/node_modules/@ali/claude-code/cli.js"; do
    if [ -f "$candidate" ]; then
      cli_js="$candidate"
      break
    fi
  done
  if [ -n "$cli_js" ] && ! grep -q "CC Viewer" "$cli_js" 2>/dev/null; then
    ccv 2>/dev/null
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
      // Check if existing hook matches desired mode
      const isNativeHook = content.includes('ccv run -- claude');
      if (!!isNative === !!isNativeHook) {
        return { path: configPath, status: 'exists' };
      }
      // Mismatch: remove old hook first
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
  const configPath = getShellConfigPath();
  try {
    if (!existsSync(configPath)) return { path: configPath, status: 'not_found' };
    const content = readFileSync(configPath, 'utf-8');
    if (!content.includes(SHELL_HOOK_START)) return { path: configPath, status: 'clean' };
    const regex = new RegExp(`\\n?${SHELL_HOOK_START}[\\s\\S]*?${SHELL_HOOK_END}\\n?`, 'g');
    const newContent = content.replace(regex, '\n');
    writeFileSync(configPath, newContent);
    return { path: configPath, status: 'removed' };
  } catch (err) {
    return { path: configPath, status: 'error', error: err.message };
  }
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

function getNativeInstallPath() {
  // 1. 尝试 which/command -v（继承当前 process.env PATH）
  for (const cmd of ['which claude', 'command -v claude']) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env }).trim();
      // 排除 shell function 的输出（多行说明不是路径）
      if (result && !result.includes('\n') && existsSync(result)) {
        return result;
      }
    } catch {
      // ignore
    }
  }

  // 2. 检查常见 native 安装路径
  const home = homedir();
  const candidates = [
    join(home, '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }

  return null;
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
    // [Debug] Verify hook execution
    // console.error(`[CC-Viewer] Hook triggered for: ${cmd} ${cmdArgs.join(' ')}`);

    // Determine the path to the native 'claude' executable
    if (cmd === 'claude') {
      const nativePath = getNativeInstallPath();
      if (nativePath) {
        cmd = nativePath;
      }
    }
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;

    // [Debug] Force ANTHROPIC_BASE_URL via process.env is not enough for some reason?
    // Let's also check if we can pass it via command line args if supported, but claude cli doesn't seem to have a --base-url arg documented.
    // However, maybe the issue is that 'env' in spawn options isn't overriding what claude internal config has?
    // Claude Code likely reads from ~/.claude/settings.json which might take precedence over env vars?
    // No, usually env vars take precedence.

    // [Fix] Check if user has ANTHROPIC_BASE_URL in settings.json and use it in proxy.js
    // We already do that in proxy.js: getOriginalBaseUrl().

    // [Crucial Fix]
    // Use --settings JSON argument to force ANTHROPIC_BASE_URL configuration
    // This is safer and more reliable than env vars which might be ignored.

    // console.error(`[CC-Viewer] Setting ANTHROPIC_BASE_URL to ${env.ANTHROPIC_BASE_URL}`);

    // Construct settings JSON string
    // Note: We need to be careful with quoting for the shell/spawn.
    // Since we use spawn without shell, we can pass the JSON string directly as an argument.
    const settingsJson = JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
      }
    });

    // Inject --settings argument
    // We put it at the beginning of args to ensure it's picked up
    cmdArgs.unshift(settingsJson);
    cmdArgs.unshift('--settings');

    // Force non-interactive if needed? No, we want interactive.

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

// === 主逻辑 ===

const args = process.argv.slice(2);
const isUninstall = args.includes('--uninstall');
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

if (args[0] === 'run') {
  runProxyCommand(args);
} else if (args.includes('--uninstall')) {
  const cliResult = removeCliJsInjection();
  const shellResult = removeShellHook();

  if (cliResult === 'removed' || cliResult === 'clean') {
    console.log(t('cli.uninstall.cliCleaned'));
  } else if (cliResult === 'not_found') {
    // console.log(t('cli.uninstall.cliNotFound'));
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

  console.log(t('cli.uninstall.done'));
  process.exit(0);
} else {
  // Installation Logic
  let mode = 'unknown';
  if (existsSync(cliPath)) {
    mode = 'npm';
  } else {
    const nativePath = getNativeInstallPath();
    if (nativePath) {
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
}
