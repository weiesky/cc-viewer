import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { threadId } from 'node:worker_threads';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============ 配置区（第三方适配只需修改此处）============

function resolveLogDir() {
  const envDir = process.env.CCV_LOG_DIR;
  if (typeof envDir === 'string' && envDir.trim()) {
    const raw = envDir.trim();
    // 允许通过 'tmp' 或 'temp' 关键字使用系统临时目录（常用于测试）
    if (raw === 'tmp' || raw === 'temp') {
      return join(tmpdir(), 'cc-viewer-test', `${process.pid}-${threadId}`);
    }
    const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
    return resolve(expanded);
  }
  return join(homedir(), '.claude', 'cc-viewer');
}

// 日志存储根目录（所有项目日志、偏好设置均存放于此）
// 使用 let 以支持运行时通过 setLogDir() 修改（ES module live binding）
export let LOG_DIR = resolveLogDir();

/**
 * 运行时修改日志存储根目录。
 * 支持 ~/... 展开。所有通过 `import { LOG_DIR }` 引用的模块会自动看到新值。
 */
export function setLogDir(dir) {
  if (!dir || typeof dir !== 'string') return;
  const raw = dir.trim();
  if (!raw) return;
  const resolved = resolve(raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw);
  // 安全：限制在 home 目录或 /tmp 下，防止写入系统目录
  const home = homedir();
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp/')) return;
  LOG_DIR = resolved;
}

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

/**
 * 查找 npm 版本的 claude（包括 nvm 安装）
 * 返回 node_modules 中的 claude cli.js 路径
 */
export function resolveNpmClaudePath() {
  // 1. 尝试 which/command -v 找到 npm 安装的 claude
  for (const cmd of [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`]) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env }).trim();
      // 排除 shell function 的输出（多行说明不是路径）
      if (result && !result.includes('\n') && existsSync(result)) {
        // 只接受 npm 安装的符号链接（解析后指向 node_modules）
        try {
          const real = realpathSync(result);
          if (real.includes('node_modules')) {
            // 找到 npm 版本，返回 cli.js 的路径
            // real 可能是 .../node_modules/@anthropic-ai/claude-code/bin/claude
            // 我们需要返回 .../node_modules/@anthropic-ai/claude-code/cli.js
            const match = real.match(/(.*node_modules\/@[^/]+\/[^/]+)\//);
            if (match) {
              const packageDir = match[1];
              const cliPath = join(packageDir, CLI_ENTRY);
              if (existsSync(cliPath)) {
                return cliPath;
              }
            }
          }
        } catch { }
      }
    } catch {
      // ignore
    }
  }

  // 2. 尝试从全局 node_modules 查找
  const globalRoot = getGlobalNodeModulesDir();
  if (globalRoot) {
    for (const packageName of PACKAGES) {
      const cliPath = join(globalRoot, packageName, CLI_ENTRY);
      if (existsSync(cliPath)) {
        return cliPath;
      }
    }
  }

  return null;
}

export function resolveNativePath() {
  // 1. 尝试 which/command -v（继承当前 process.env PATH）
  for (const cmd of [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`]) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env }).trim();
      // 排除 shell function 的输出（多行说明不是路径）
      if (result && !result.includes('\n') && existsSync(result)) {
        // 排除 npm 安装的符号链接（解析后指向 node_modules）
        try {
          const real = realpathSync(result);
          if (real.includes('node_modules')) continue;
        } catch { }
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
