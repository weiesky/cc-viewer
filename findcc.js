import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============ 配置区（第三方适配只需修改此处）============

// 日志存储根目录（所有项目日志、偏好设置均存放于此）
export const LOG_DIR = join(homedir(), '.claude', 'cc-viewer');

// npm 包名候选列表（按优先级排列）
export const PACKAGES = ['@anthropic-ai/claude-code', '@ali/claude-code'];

// npm 包内的入口文件（相对于包根目录）
export const CLI_ENTRY = 'cli.js';

// native 二进制候选路径（~ 会在运行时展开为 homedir()）
const NATIVE_CANDIDATES = [
  '~/.claude/local/claude',
  '/usr/local/bin/claude',
  '~/.local/bin/claude',
  '/opt/homebrew/bin/claude',
];

// 用于 which/command -v 查找的命令名
export const BINARY_NAME = 'claude';

// 注入到 cli.js 的 import 语句（相对路径，基于 cli.js 所在位置）
export const INJECT_IMPORT = "import '../../cc-viewer/interceptor.js';";

// ============ 导出函数 ============

export function getGlobalNodeModulesDir() {
  try {
    return execSync('npm root -g', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

export function resolveCliPath() {
  // 候选基础目录：__dirname 的上级（适用于常规 npm 安装）+ 全局 node_modules（适用于符号链接安装）
  const baseDirs = [resolve(__dirname, '..')];
  const globalRoot = getGlobalNodeModulesDir();
  if (globalRoot && globalRoot !== resolve(__dirname, '..')) {
    baseDirs.push(globalRoot);
  }

  for (const baseDir of baseDirs) {
    for (const packageName of PACKAGES) {
      const candidate = join(baseDir, packageName, CLI_ENTRY);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  // 兜底：返回全局目录下的默认路径，便于错误提示
  return join(globalRoot || resolve(__dirname, '..'), PACKAGES[0], CLI_ENTRY);
}

export function resolveNativePath() {
  // 1. 尝试 which/command -v（继承当前 process.env PATH）
  for (const cmd of [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`]) {
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
  const candidates = NATIVE_CANDIDATES.map(p =>
    p.startsWith('~') ? join(home, p.slice(2)) : p
  );
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }

  return null;
}

export function buildShellCandidates() {
  const globalRoot = getGlobalNodeModulesDir();
  // 使用 $HOME 而非硬编码绝对路径，保证 shell 可移植性
  const dirs = [];
  if (globalRoot) {
    // 将绝对路径中的 homedir 替换为 $HOME
    const home = homedir();
    const shellRoot = globalRoot.startsWith(home)
      ? '$HOME' + globalRoot.slice(home.length)
      : globalRoot;
    for (const pkg of PACKAGES) {
      dirs.push(`"${shellRoot}/${pkg}/${CLI_ENTRY}"`);
    }
  }
  return dirs.join(' ');
}
