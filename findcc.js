import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir, arch } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
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
  const globalRoot = getGlobalNodeModulesDir();

  // 1. 优先：平台特定 optionalDependency 里的原生二进制（如
  //    @anthropic-ai/claude-code-darwin-arm64/claude）。
  //    这是 Claude Code 2.x 真正的原生二进制源头，postinstall 只是把它复制到
  //    wrapper 包的 bin/claude.exe。如果 postinstall 没跑（--ignore-scripts /
  //    某些 pnpm 配置），bin/claude.exe 是个报错 stub；直接用平台特定路径可以
  //    绕过 stub 问题。
  const platformBin = findPlatformBinary(globalRoot);
  if (platformBin) return platformBin;

  // 2. 尝试 which/command -v（继承当前 process.env PATH）
  for (const cmd of [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`]) {
    try {
      const result = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env }).trim();
      // 排除 shell function 的输出（多行说明不是路径）
      if (result && !result.includes('\n') && existsSync(result)) {
        // 只排除 .js 文件（老版本 npm 分发的 cli.js，需要 node 运行，
        // 由 resolveNpmClaudePath 处理）。Claude Code 2.x+ 的 npm 包内
        // 直接打包了原生二进制（bin/claude.exe），应当作 native 处理。
        let real = result;
        try { real = realpathSync(result); } catch { }
        if (real.endsWith('.js')) continue;
        return result;
      }
    } catch {
      // ignore
    }
  }

  // 3. 检查常见 native 安装路径
  const home = homedir();
  const candidates = NATIVE_CANDIDATES.map(p =>
    p.startsWith('~') ? join(home, p.slice(2)) : p
  );
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
  }

  // 4. 兜底：wrapper 包的 bin/claude(.exe)（可能是 postinstall 后的真实二进制，
  //    也可能是 stub；若能走到这一步说明平台特定包也没找到，没法再兜底了）
  const inPkg = findPackagedBinary(globalRoot);
  if (inPkg) return inPkg;

  return null;
}

// 在给定的 node_modules 根目录下扫描 PACKAGES 里每个候选包的 bin/claude(.exe)
// 导出以便测试；生产代码通过 resolveNativePath 调用。
export function findPackagedBinary(nodeModulesRoot) {
  if (!nodeModulesRoot) return null;
  for (const pkg of PACKAGES) {
    for (const name of ['claude.exe', 'claude']) {
      const p = join(nodeModulesRoot, pkg, 'bin', name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// 检测当前平台对应的 optionalDependency 包名片段。
// 返回如 "darwin-arm64" | "linux-x64" | "linux-x64-musl" | "win32-arm64"，
// 未知平台返回 null。逻辑与 @anthropic-ai/claude-code 的 install.cjs 保持一致。
export function detectPlatformKey() {
  const platform = process.platform;
  let cpu = arch();
  if (platform === 'darwin') {
    // Rosetta 2：x64 Node 跑在 Apple Silicon 上会报 arch()==='x64'，但应该用 arm64 原生二进制
    if (cpu === 'x64') {
      try {
        const r = spawnSync('sysctl', ['-n', 'sysctl.proc_translated'], { encoding: 'utf-8' });
        if (r.status === 0 && r.stdout.trim() === '1') cpu = 'arm64';
      } catch { /* ignore */ }
    }
    return `darwin-${cpu}`;
  }
  if (platform === 'linux') {
    // musl 检测：process.report 在 musl 上没有 glibcVersionRuntime 字段
    let musl = false;
    try {
      const report = typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
      musl = report && report.header?.glibcVersionRuntime === undefined;
    } catch { /* ignore */ }
    return `linux-${cpu}${musl ? '-musl' : ''}`;
  }
  if (platform === 'win32') return `win32-${cpu}`;
  return null;
}

// 检测 Claude Code 2.x wrapper 包是否已安装。install.cjs 是 2.x wrapper 独有的
// 文件（1.x 的 cli.js 分发不带它），可作为"是 2.x 布局"的可靠标识。
// 当我们既找不到 cli.js 也找不到原生二进制时，此函数用来区分"根本没装 claude"
// 和"装了 2.x 但 postinstall/optional 依赖出问题了"两种情况，给出更精准的提示。
export function hasClaude2xWrapper(nodeModulesRoot) {
  if (!nodeModulesRoot) return false;
  for (const pkg of PACKAGES) {
    if (existsSync(join(nodeModulesRoot, pkg, 'install.cjs'))) return true;
  }
  return false;
}

// Claude Code 2.x 把真正的原生二进制放在平台特定的 optional dependency 包中
// （如 @anthropic-ai/claude-code-darwin-arm64/claude）。postinstall 只是把它复制到
// 主包的 bin/claude.exe。如果 postinstall 没跑（--ignore-scripts / pnpm），bin/claude.exe
// 会是一个报错的 stub；直接定位平台特定包里的原生二进制更可靠。
export function findPlatformBinary(nodeModulesRoot) {
  if (!nodeModulesRoot) return null;
  const key = detectPlatformKey();
  if (!key) return null;
  const binName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const pkgNames = [`@anthropic-ai/claude-code-${key}`, `@ali/claude-code-${key}`];
  for (const pkgName of pkgNames) {
    const candidates = [
      // 扁平布局（npm 提升 optional dep 到 global node_modules 顶层）
      join(nodeModulesRoot, pkgName, binName),
      // 嵌套布局（optional dep 保留在 wrapper 包内部）
      join(nodeModulesRoot, '@anthropic-ai', 'claude-code', 'node_modules', pkgName, binName),
      join(nodeModulesRoot, '@ali', 'claude-code', 'node_modules', pkgName, binName),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
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
