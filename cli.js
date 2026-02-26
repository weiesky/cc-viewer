#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
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

function buildShellHook() {
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
const isVersion = process.argv.includes('--v') || process.argv.includes('--version');

if (isVersion) {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
  console.log(`cc-viewer v${pkg.version}`);
  process.exit(0);
}

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

  console.log(t('cli.uninstall.done'));
  process.exit(0);
}

// 正常安装流程
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
