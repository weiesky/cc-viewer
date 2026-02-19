#!/usr/bin/env node

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { t } from './i18n.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const INJECT_START = '// >>> Start CC Viewer Web Service >>>';
const INJECT_END = '// <<< Start CC Viewer Web Service <<<';
const INJECT_IMPORT = "import '../../cc-viewer/interceptor.js';";
const INJECT_BLOCK = `${INJECT_START}\n${INJECT_IMPORT}\n${INJECT_END}`;
const SHOW_ALL_FILE = '/tmp/cc-viewer-show-all';

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

function buildShellHook() {
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

function installShellHook() {
  const configPath = getShellConfigPath();
  try {
    const content = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
    if (content.includes(SHELL_HOOK_START)) {
      return { path: configPath, status: 'exists' };
    }
    const hook = buildShellHook();
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

// === 主逻辑 ===

const isUninstall = process.argv.includes('--uninstall');

if (isUninstall) {
  const cliResult = removeCliJsInjection();
  const shellResult = removeShellHook();

  if (cliResult === 'removed' || cliResult === 'clean') {
    console.log(t('cli.uninstall.cliCleaned'));
  } else if (cliResult === 'not_found') {
    console.log(t('cli.uninstall.cliNotFound'));
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

  try { unlinkSync(SHOW_ALL_FILE); } catch {}

  console.log(t('cli.uninstall.done'));
  process.exit(0);
}

// 正常安装流程
const showAll = process.argv.includes('--all');
if (showAll) {
  try { writeFileSync(SHOW_ALL_FILE, '1'); } catch {}
} else {
  try { unlinkSync(SHOW_ALL_FILE); } catch {}
}

try {
  const cliResult = injectCliJs();
  const shellResult = installShellHook();

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
