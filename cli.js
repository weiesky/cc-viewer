#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

const cliPath = resolve(__dirname, '../@anthropic-ai/claude-code/cli.js');

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
  ccv run -- command claude "$@"
}
${SHELL_HOOK_END}`;
  }

  return `${SHELL_HOOK_START}
claude() {
  local cli_js="$HOME/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js"
  if [ -f "$cli_js" ] && ! grep -q "CC Viewer" "$cli_js" 2>/dev/null; then
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
      const isNativeHook = content.includes('ccv run -- command claude');
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
  try {
    const result = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (result && existsSync(result)) {
      return result;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function runProxyCommand(args) {
  try {
    // Dynamic import to avoid side effects when just installing
    const { startProxy } = await import('./proxy.js');
    const proxyPort = await startProxy();

    // args = ['run', '--', 'command', 'claude', ...] or ['run', 'claude', ...]
    // Our hook uses: ccv run -- command claude "$@"
    // args[0] is 'run'.
    // If args[1] is '--', then command starts at args[2].

    let cmdStartIndex = 1;
    if (args[1] === '--') {
      cmdStartIndex = 2;
    }

    const cmd = args[cmdStartIndex];
    if (!cmd) {
      console.error('No command provided to run.');
      process.exit(1);
    }
    const cmdArgs = args.slice(cmdStartIndex + 1);

    const env = { ...process.env };
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
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
