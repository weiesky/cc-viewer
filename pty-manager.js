import { resolveNativePath, LOG_DIR } from './findcc.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { chmodSync, statSync } from 'node:fs';
import { platform, arch } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ptyProcess = null;
let dataListeners = [];
let exitListeners = [];
let lastExitCode = null;
let outputBuffer = '';
let currentWorkspacePath = null;
let lastWorkspacePath = null; // 进程退出后保留，用于 respawn shell
let lastPtyCols = 120;
let lastPtyRows = 30;
const MAX_BUFFER = 200000;
let batchBuffer = '';
let batchScheduled = false;
let _ptyImportForTests = null;

export function _setPtyImportForTests(fn) {
  _ptyImportForTests = fn;
}

async function getPty() {
  if (typeof _ptyImportForTests === 'function') {
    return _ptyImportForTests();
  }
  const ptyMod = await import('node-pty');
  return ptyMod.default || ptyMod;
}

/**
 * 在 outputBuffer 截断时，找到安全的截断位置，
 * 避免从 ANSI 转义序列中间开始导致终端状态紊乱。
 * 策略：从截断点向后扫描，跳过可能被截断的不完整转义序列。
 */
function findSafeSliceStart(buf, rawStart) {
  // 从 rawStart 开始，向后最多扫描 64 字节寻找安全起点
  const scanLimit = Math.min(rawStart + 64, buf.length);
  let i = rawStart;
  while (i < scanLimit) {
    const ch = buf.charCodeAt(i);
    // 如果当前字符是 ESC (0x1b)，可能是新转义序列的开头，
    // 但也可能是被截断的序列的中间部分，跳过整个序列
    if (ch === 0x1b) {
      // 找到 ESC，向后寻找序列结束符（字母字符）
      let j = i + 1;
      while (j < scanLimit && !((buf.charCodeAt(j) >= 0x40 && buf.charCodeAt(j) <= 0x7e) && j > i + 1)) {
        j++;
      }
      if (j < scanLimit) {
        // 找到完整序列末尾，从下一个字符开始是安全的
        return j + 1;
      }
      // 序列不完整，继续扫描
      i = j;
      continue;
    }
    // 如果字符是 CSI 参数字符 (0x30-0x3f) 或中间字符 (0x20-0x2f)，
    // 说明我们在转义序列中间，继续向后
    if ((ch >= 0x20 && ch <= 0x3f)) {
      i++;
      continue;
    }
    // 普通可见字符或控制字符（非转义相关），这是安全位置
    break;
  }
  return i < buf.length ? i : rawStart;
}

function flushBatch() {
  batchScheduled = false;
  if (!batchBuffer) return;
  const chunk = batchBuffer;
  batchBuffer = '';
  for (const cb of dataListeners) {
    try { cb(chunk); } catch { }
  }
}

function fixSpawnHelperPermissions() {
  try {
    const os = platform();
    const cpu = arch();
    const helperPath = join(__dirname, 'node_modules', 'node-pty', 'prebuilds', `${os}-${cpu}`, 'spawn-helper');
    const stat = statSync(helperPath);
    if (!(stat.mode & 0o111)) {
      chmodSync(helperPath, stat.mode | 0o755);
    }
  } catch { }
}

// Opus 4.7 默认不再返回 thinking；为所有非显式覆写的调用加上 summarized。
// 纯函数：仅根据 args 决定是否注入；用户已显式传入 `--thinking-display` 时原样返回。
export function withDefaultThinkingDisplay(args) {
  if (!Array.isArray(args)) return args;
  const hasFlag = args.some(a =>
    a === '--thinking-display' || (typeof a === 'string' && a.startsWith('--thinking-display='))
  );
  return hasFlag ? args : [...args, '--thinking-display', 'summarized'];
}

// 默认总是尝试注入 `--thinking-display summarized`；若目标 claude（或 claude-兼容 CLI/fork/wrapper）
// 不识别该 flag，spawnClaude 的 onExit 会检测到 "unknown option" 错误，自动把 claudePath
// 标记到本集合，下次 spawn 直接跳过注入——完全基于实际运行反馈，不依赖版本号或品牌。
const _thinkingDisplayRejectedPaths = new Set();

// 仅用于测试/内部：清空拒绝集
export function _clearThinkingDisplayRejectedPaths() {
  _thinkingDisplayRejectedPaths.clear();
}

// 仅用于测试：查询路径是否已被标记为不支持
export function _isThinkingDisplayRejected(claudePath) {
  return _thinkingDisplayRejectedPaths.has(claudePath);
}

// 仅用于测试：强制把路径加入拒绝集，绕过第一次 crash
export function _markThinkingDisplayRejected(claudePath) {
  _thinkingDisplayRejectedPaths.add(claudePath);
}

export async function spawnClaude(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http') {
  if (ptyProcess) {
    killPty();
  }

  const pty = await getPty();

  fixSpawnHelperPermissions();

  // 如果没有提供 claudePath，尝试自动查找
  if (!claudePath) {
    claudePath = resolveNativePath();
    if (!claudePath) {
      throw new Error('claude not found');
    }
  }

  const env = { ...process.env };
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  env.CCV_PROXY_MODE = '1'; // 告诉 interceptor.js 不要再启动 server
  env.CCV_LOG_DIR = LOG_DIR; // 让 fork 出的 Claude Code 进程找到同一份 profile.json 等资源
  // 剥离 cc-viewer 的内部短路开关，避免泄漏给 claude 子进程
  delete env.CCV_SKIP_THINKING_DISPLAY;

  // Resolve real Node.js path (Electron's process.execPath is the Electron binary)
  let nodePath = process.execPath;
  if (process.versions.electron) {
    const { execSync } = await import('node:child_process');
    try {
      nodePath = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8' }).trim();
      if (process.platform === 'win32') nodePath = nodePath.split('\n')[0].trim();
    } catch {
      nodePath = process.platform === 'win32' ? 'node' : '/usr/local/bin/node';
    }
  }

  // Override EDITOR/VISUAL to use built-in FileContentView
  if (serverPort) {
    const editorScript = join(__dirname, 'lib', 'ccv-editor.js');
    env.EDITOR = `${nodePath} ${editorScript}`;
    env.VISUAL = env.EDITOR;
    env.CCV_EDITOR_PORT = String(serverPort);
    env.CCVIEWER_PORT = String(serverPort); // For ask-hook bridge
    env.CCVIEWER_PROTOCOL = serverProtocol; // For ask/perm-bridge (http vs https)
  }

  // 禁用 Claude Code CLI 的鼠标事件捕获，保住 xterm 面板原生文本选中（复制粘贴）。
  // 不设时 Claude 会启 SGR mouse tracking (DECSET ?1000/1006)，抢走 xterm 的鼠标事件。
  // ??= 尊重用户显式 export（比如调试时想看 mouse event）。
  // 注意：NO_FLICKER 此处**故意**不注入——它会强制 alt-screen 销毁 xterm scrollback；
  // 需要闪烁优化的用户自行 `export CLAUDE_CODE_NO_FLICKER=1`。
  env.CLAUDE_CODE_DISABLE_MOUSE ??= '1';

  // 通过 --settings 注入 ANTHROPIC_BASE_URL，确保覆盖 settings.json 中的配置。
  // 仅覆盖 env.ANTHROPIC_BASE_URL，不影响其他 settings 字段。
  const settingsJson = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
    }
  });

  // 注入 --thinking-display summarized；以下任一情况跳过注入：
  // - 路径在拒绝集里（上次因此 crash 过）
  // - 环境变量 CCV_SKIP_THINKING_DISPLAY=1（用户全局 opt-out，与 cli.js 保持一致）
  const shouldInjectThinkingDisplay = !_thinkingDisplayRejectedPaths.has(claudePath)
    && process.env.CCV_SKIP_THINKING_DISPLAY !== '1';
  const finalExtraArgs = shouldInjectThinkingDisplay ? withDefaultThinkingDisplay(extraArgs) : extraArgs;

  let command = claudePath;
  let args = ['--settings', settingsJson, ...finalExtraArgs];

  // 如果是 npm 版本（cli.js），需要使用 node 来运行
  if (isNpmVersion && claudePath.endsWith('.js')) {
    command = nodePath;
    args = [claudePath, '--settings', settingsJson, ...finalExtraArgs];
  }

  lastExitCode = null;
  outputBuffer = '';
  currentWorkspacePath = cwd || process.cwd();
  lastWorkspacePath = currentWorkspacePath;

  ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd: currentWorkspacePath,
    env,
  });

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - MAX_BUFFER;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch();
    lastExitCode = exitCode;
    ptyProcess = null;

    // Auto-retry without -c/--continue if "No conversation found"
    // 注意：早退 return 会跳过下方的 exitListeners 广播——第一次失败的 pty 死亡对消费者
    // 是透明的。新 pty 正常启动后自己会上报 state/exit。这样避免前端看到一次假的退出事件。
    const hasContinue = extraArgs.includes('-c') || extraArgs.includes('--continue');
    if (hasContinue && exitCode !== 0 && outputBuffer.includes('No conversation found')) {
      console.error('[CC Viewer] -c failed (no conversation), retrying without -c');
      const retryArgs = extraArgs.filter(a => a !== '-c' && a !== '--continue');
      spawnClaude(proxyPort, cwd, retryArgs, claudePath, isNpmVersion, serverPort, serverProtocol);
      return;
    }

    // 事后兜底：如果我们注入了 --thinking-display 且 claude 以 "unknown option" 崩溃，
    // 把该 claudePath 加入拒绝集并去掉 flag 重启一次——老版 claude / 三方 CLI fork / GLM wrapper 由此自愈。
    // 只在「我们注入的」场景触发：extraArgs 没有 flag 但 finalExtraArgs 有 → 说明是注入的；
    // 用户自己传了 --thinking-display 崩溃则不动，避免覆盖用户意图。
    // 和 -c 重试一致，早退 return 跳过 exitListeners 广播，让第一次假失败对消费者透明。
    const weInjectedFlag = shouldInjectThinkingDisplay
      && !extraArgs.some(a => a === '--thinking-display' || (typeof a === 'string' && a.startsWith('--thinking-display=')));
    const flagRejected = weInjectedFlag && exitCode !== 0
      && /unknown option ['"]--thinking-display/i.test(outputBuffer);
    if (flagRejected) {
      console.error('[CC Viewer] claude rejected --thinking-display, marking as unsupported and retrying without flag');
      _thinkingDisplayRejectedPaths.add(claudePath);
      spawnClaude(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol);
      return;
    }

    // 保留 lastWorkspacePath，不清除，用于 respawn
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });

  return ptyProcess;
}

export function writeToPty(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
    return true;
  }
  return false;
}

/**
 * Send chunks sequentially to PTY, waiting for PTY output between each.
 * Designed for programmatic input (multi-select, paste, etc.) where
 * the target application (e.g. inquirer) needs time to process each chunk.
 * @param {string[]} chunks - array of input strings to send in order
 * @param {Function} [onComplete] - called when all chunks are sent or on error
 * @param {object} [opts] - { timeoutMs: per-chunk timeout (default 4000), settleMs: delay after ACK (default 150) }
 */
export function writeToPtySequential(chunks, onComplete, opts = {}) {
  const timeoutMs = opts.timeoutMs || 4000;
  const settleMs = opts.settleMs || 150;

  if (!ptyProcess || !chunks || chunks.length === 0) {
    if (onComplete) onComplete(false);
    return;
  }

  let idx = 0;
  let dataListener = null;

  const cleanup = () => {
    if (dataListener) {
      dataListeners = dataListeners.filter(l => l !== dataListener);
      dataListener = null;
    }
  };

  const sendNext = () => {
    if (idx >= chunks.length || !ptyProcess) {
      cleanup();
      if (onComplete) onComplete(true);
      return;
    }

    const chunk = chunks[idx];
    idx++;

    ptyProcess.write(chunk);

    // Space, Enter, arrows need more time for inquirer to re-render
    const isToggleOrSubmit = chunk === ' ' || chunk === '\r'
      || chunk === '\x1b[C' || chunk === '\x1b[A' || chunk === '\x1b[B';
    const delay = isToggleOrSubmit ? settleMs : 80;
    setTimeout(sendNext, delay);
  };

  sendNext();
}

/**
 * 进程退出后，自动 spawn 一个交互式 shell，让终端恢复可用。
 * 返回 true 表示成功 spawn，false 表示无需或失败。
 */
export async function spawnShell() {
  if (ptyProcess) return false; // 已有进程在运行
  const cwd = lastWorkspacePath || process.cwd();

  const pty = await getPty();

  fixSpawnHelperPermissions();

  const shell = process.env.SHELL || '/bin/sh';

  lastExitCode = null;
  currentWorkspacePath = cwd;

  // Clean env: remove cc-viewer specific vars so child shells don't inherit them
  // (prevents CCVIEWER_PORT/CCVIEWER_PROTOCOL leaking to non-cc-viewer Claude instances;
  // 115c48b 加入 CCVIEWER_PROTOCOL 但只更新 spawnClaude，此处对齐)
  const shellEnv = { ...process.env };
  delete shellEnv.CCVIEWER_PORT;
  delete shellEnv.CCV_EDITOR_PORT;
  delete shellEnv.CCVIEWER_PROTOCOL;
  // 交互 shell 里手动敲 claude 时也禁鼠标，理由同 spawnClaude；NO_FLICKER 仍不注入
  shellEnv.CLAUDE_CODE_DISABLE_MOUSE ??= '1';

  ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd,
    env: shellEnv,
  });

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - MAX_BUFFER;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch();
    lastExitCode = exitCode;
    ptyProcess = null;
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });

  return true;
}

export function resizePty(cols, rows) {
  lastPtyCols = cols;
  lastPtyRows = rows;
  if (ptyProcess) {
    try { ptyProcess.resize(cols, rows); } catch { }
  }
}

export function killPty() {
  if (ptyProcess) {
    flushBatch();
    batchBuffer = '';
    batchScheduled = false;
    try { ptyProcess.kill(); } catch { }
    ptyProcess = null;
  }
}

export function onPtyData(cb) {
  dataListeners.push(cb);
  return () => {
    dataListeners = dataListeners.filter(l => l !== cb);
  };
}

export function onPtyExit(cb) {
  exitListeners.push(cb);
  return () => {
    exitListeners = exitListeners.filter(l => l !== cb);
  };
}

export function getPtyPid() {
  return ptyProcess ? ptyProcess.pid : null;
}

export function getPtyState() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
  };
}

export function getCurrentWorkspace() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
    cwd: currentWorkspacePath,
  };
}

export function getOutputBuffer() {
  return outputBuffer;
}
