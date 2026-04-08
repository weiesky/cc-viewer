import { resolveNativePath } from './findcc.js';
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

export async function spawnClaude(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null) {
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
  }

  // 通过 --settings 注入 ANTHROPIC_BASE_URL，确保覆盖 settings.json 中的配置。
  // 仅覆盖 env.ANTHROPIC_BASE_URL，不影响其他 settings 字段。
  const settingsJson = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
    }
  });

  let command = claudePath;
  let args = ['--settings', settingsJson, ...extraArgs];

  // 如果是 npm 版本（cli.js），需要使用 node 来运行
  if (isNpmVersion && claudePath.endsWith('.js')) {
    command = nodePath;
    args = [claudePath, '--settings', settingsJson, ...extraArgs];
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
    const hasContinue = extraArgs.includes('-c') || extraArgs.includes('--continue');
    if (hasContinue && exitCode !== 0 && outputBuffer.includes('No conversation found')) {
      console.error('[CC Viewer] -c failed (no conversation), retrying without -c');
      const retryArgs = extraArgs.filter(a => a !== '-c' && a !== '--continue');
      spawnClaude(proxyPort, cwd, retryArgs, claudePath, isNpmVersion, serverPort);
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

  ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd,
    env: { ...process.env },
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
