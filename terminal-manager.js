/**
 * terminal-manager.js — Multi-terminal manager for CC Viewer
 *
 * Wraps pty-manager's core logic to support multiple concurrent terminal instances.
 * Each terminal is identified by a string `tid` (terminal id).
 * Backward compatible: a 'default' terminal is created on first use.
 */

import { resolveNativePath } from './findcc.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { chmodSync, statSync } from 'node:fs';
import { platform, arch } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Constants ───────────────────────────────────────────────────
export const MAX_TERMINALS = 8;
const MAX_BUFFER = 200000;

// ─── Shared Helpers ──────────────────────────────────────────────

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
 * Find a safe slice start in a buffer to avoid cutting ANSI escape sequences.
 * Scans forward from rawStart up to 64 bytes looking for a safe position.
 */
function findSafeSliceStart(buf, rawStart) {
  const scanLimit = Math.min(rawStart + 64, buf.length);
  let i = rawStart;
  while (i < scanLimit) {
    const ch = buf.charCodeAt(i);
    if (ch === 0x1b) {
      let j = i + 1;
      while (j < scanLimit && !((buf.charCodeAt(j) >= 0x40 && buf.charCodeAt(j) <= 0x7e) && j > i + 1)) {
        j++;
      }
      if (j < scanLimit) {
        return j + 1;
      }
      i = j;
      continue;
    }
    if ((ch >= 0x20 && ch <= 0x3f)) {
      i++;
      continue;
    }
    break;
  }
  return i < buf.length ? i : rawStart;
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

// ─── Terminal Instance ───────────────────────────────────────────

/**
 * @typedef {Object} TerminalInstance
 * @property {string} tid
 * @property {object|null} ptyProcess
 * @property {Function[]} dataListeners
 * @property {Function[]} exitListeners
 * @property {number|null} lastExitCode
 * @property {string} outputBuffer
 * @property {string|null} currentWorkspacePath
 * @property {string|null} lastWorkspacePath
 * @property {number} cols
 * @property {number} rows
 * @property {string} batchBuffer
 * @property {boolean} batchScheduled
 * @property {number} createdAt
 * @property {string} label
 */

/** @type {Map<string, TerminalInstance>} */
const terminals = new Map();

/**
 * Create a new terminal instance slot (does not spawn a process).
 * @param {string} tid - Terminal identifier
 * @param {object} [options]
 * @param {string} [options.label] - Human-readable label
 * @param {string} [options.cwd] - Initial working directory
 * @param {number} [options.cols=120]
 * @param {number} [options.rows=30]
 * @returns {TerminalInstance}
 */
export function createTerminal(tid, options = {}) {
  if (terminals.has(tid)) {
    return terminals.get(tid);
  }
  if (terminals.size >= MAX_TERMINALS) {
    throw new Error(`Maximum terminal limit (${MAX_TERMINALS}) reached`);
  }

  const instance = {
    tid,
    ptyProcess: null,
    dataListeners: [],
    exitListeners: [],
    lastExitCode: null,
    outputBuffer: '',
    currentWorkspacePath: options.cwd || null,
    lastWorkspacePath: options.cwd || null,
    cols: options.cols || 120,
    rows: options.rows || 30,
    batchBuffer: '',
    batchScheduled: false,
    createdAt: Date.now(),
    label: options.label || tid,
  };

  terminals.set(tid, instance);
  return instance;
}

// ─── Batch Flush (per-instance) ──────────────────────────────────

function flushBatch(inst) {
  inst.batchScheduled = false;
  if (!inst.batchBuffer) return;
  const chunk = inst.batchBuffer;
  inst.batchBuffer = '';
  for (const cb of inst.dataListeners) {
    try { cb(chunk); } catch { }
  }
}

// ─── Attach PTY listeners (shared between spawnClaude and spawnShell) ─

function attachPtyListeners(inst) {
  const proc = inst.ptyProcess;
  if (!proc) return;

  proc.onData((data) => {
    inst.outputBuffer += data;
    if (inst.outputBuffer.length > MAX_BUFFER) {
      const rawStart = inst.outputBuffer.length - MAX_BUFFER;
      const safeStart = findSafeSliceStart(inst.outputBuffer, rawStart);
      inst.outputBuffer = inst.outputBuffer.slice(safeStart);
    }
    inst.batchBuffer += data;
    if (!inst.batchScheduled) {
      inst.batchScheduled = true;
      setImmediate(() => flushBatch(inst));
    }
  });

  proc.onExit(({ exitCode }) => {
    flushBatch(inst);
    inst.lastExitCode = exitCode;
    inst.ptyProcess = null;
    inst.currentWorkspacePath = null;
    for (const cb of inst.exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });
}

// ─── Spawn Claude ────────────────────────────────────────────────

/**
 * Spawn a Claude process in the given terminal.
 * If the terminal does not exist yet, it is created automatically.
 *
 * @param {string} tid
 * @param {number} proxyPort
 * @param {string} cwd
 * @param {string[]} [extraArgs=[]]
 * @param {string|null} [claudePath=null]
 * @param {boolean} [isNpmVersion=false]
 * @param {number|null} [serverPort=null]
 * @returns {Promise<object>} The spawned pty process
 */
export async function spawnClaude(tid, proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null) {
  let inst = terminals.get(tid);
  if (!inst) {
    inst = createTerminal(tid);
  }

  // Kill existing process in this terminal
  if (inst.ptyProcess) {
    killTerminal(tid);
  }

  const pty = await getPty();
  fixSpawnHelperPermissions();

  if (!claudePath) {
    claudePath = resolveNativePath();
    if (!claudePath) {
      throw new Error('claude not found');
    }
  }

  const env = { ...process.env };
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  env.CCV_PROXY_MODE = '1';

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

  if (serverPort) {
    const editorScript = join(__dirname, 'lib', 'ccv-editor.js');
    env.EDITOR = `${nodePath} ${editorScript}`;
    env.VISUAL = env.EDITOR;
    env.CCV_EDITOR_PORT = String(serverPort);
    env.CCVIEWER_PORT = String(serverPort);
  }

  const settingsJson = JSON.stringify({
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
    }
  });

  let command = claudePath;
  let args = ['--settings', settingsJson, ...extraArgs];

  if (isNpmVersion && claudePath.endsWith('.js')) {
    command = nodePath;
    args = [claudePath, '--settings', settingsJson, ...extraArgs];
  }

  inst.lastExitCode = null;
  inst.outputBuffer = '';
  inst.currentWorkspacePath = cwd || process.cwd();
  inst.lastWorkspacePath = inst.currentWorkspacePath;

  inst.ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: inst.cols,
    rows: inst.rows,
    cwd: inst.currentWorkspacePath,
    env,
  });

  // Handle auto-retry on "No conversation found" (same as pty-manager)
  const retryHandler = (exitCode) => {
    const hasContinue = extraArgs.includes('-c') || extraArgs.includes('--continue');
    if (hasContinue && exitCode !== 0 && inst.outputBuffer.includes('No conversation found')) {
      console.error(`[CC Viewer] Terminal ${tid}: -c failed (no conversation), retrying without -c`);
      const retryArgs = extraArgs.filter(a => a !== '-c' && a !== '--continue');
      // Remove the retry handler before re-spawning
      inst.exitListeners = inst.exitListeners.filter(cb => cb !== retryHandler);
      spawnClaude(tid, proxyPort, cwd, retryArgs, claudePath, isNpmVersion, serverPort);
    }
  };
  inst.exitListeners.unshift(retryHandler);

  attachPtyListeners(inst);

  return inst.ptyProcess;
}

// ─── Spawn Shell ─────────────────────────────────────────────────

/**
 * Spawn an interactive shell in the given terminal after process exit.
 * @param {string} tid
 * @returns {Promise<boolean>}
 */
export async function spawnShell(tid) {
  const inst = terminals.get(tid);
  if (!inst) return false;
  if (inst.ptyProcess) return false;

  const cwd = inst.lastWorkspacePath || process.cwd();
  const pty = await getPty();
  fixSpawnHelperPermissions();

  const shell = process.env.SHELL || '/bin/sh';

  inst.lastExitCode = null;
  inst.currentWorkspacePath = cwd;

  const shellEnv = { ...process.env };
  delete shellEnv.CCVIEWER_PORT;
  delete shellEnv.CCV_EDITOR_PORT;

  inst.ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: inst.cols,
    rows: inst.rows,
    cwd,
    env: shellEnv,
  });

  attachPtyListeners(inst);
  return true;
}

// ─── Attach to existing tmux session ─────────────────────────────

/**
 * Attach to an existing tmux session in the given terminal.
 * @param {string} tid - terminal id
 * @param {string} tmuxTarget - tmux target (session name or session:window.pane)
 * @param {boolean} [readOnly=false] - if true, attach with -r flag
 * @returns {Promise<boolean>}
 */
export async function attachTmux(tid, tmuxTarget, readOnly = false) {
  const inst = terminals.get(tid);
  if (!inst) return false;
  if (inst.ptyProcess) return false; // already has a running process

  const pty = await getPty();
  fixSpawnHelperPermissions();

  // Find tmux binary
  const { execSync } = await import('node:child_process');
  let tmuxPath;
  try {
    tmuxPath = execSync('which tmux', { encoding: 'utf-8' }).trim();
  } catch {
    return false; // tmux not available
  }
  if (!tmuxPath) return false;

  const args = ['attach-session', '-t', tmuxTarget];
  if (readOnly) args.push('-r');

  inst.lastExitCode = null;
  inst.currentWorkspacePath = null; // tmux manages its own cwd

  const shellEnv = { ...process.env };
  delete shellEnv.CCVIEWER_PORT;
  delete shellEnv.CCV_EDITOR_PORT;

  inst.ptyProcess = pty.spawn(tmuxPath, args, {
    name: 'xterm-256color',
    cols: inst.cols,
    rows: inst.rows,
    env: shellEnv,
  });

  attachPtyListeners(inst);
  return true;
}

// ─── Create new tmux session ─────────────────────────────────────

/**
 * Create a new tmux session and attach to it in the given terminal.
 * @param {string} tid - CCV terminal id
 * @param {string} sessionName - desired tmux session name
 * @param {string} cwd - working directory for the session
 * @returns {Promise<boolean>}
 */
export async function createTmuxSession(tid, sessionName, cwd) {
  const inst = terminals.get(tid);
  if (!inst) return false;
  if (inst.ptyProcess) return false;

  const pty = await getPty();
  fixSpawnHelperPermissions();

  let tmuxPath;
  try {
    const { execSync } = await import('node:child_process');
    tmuxPath = execSync('which tmux', { encoding: 'utf-8' }).trim();
  } catch { return false; }

  const args = ['new-session', '-s', sessionName];
  if (cwd) args.push('-c', cwd);

  inst.lastExitCode = null;
  inst.currentWorkspacePath = cwd || null;

  const shellEnv = { ...process.env };
  delete shellEnv.CCVIEWER_PORT;
  delete shellEnv.CCV_EDITOR_PORT;

  inst.ptyProcess = pty.spawn(tmuxPath, args, {
    name: 'xterm-256color',
    cols: inst.cols,
    rows: inst.rows,
    cwd: cwd || undefined,
    env: shellEnv,
  });

  attachPtyListeners(inst);
  return true;
}

// ─── Terminal Operations ─────────────────────────────────────────

/**
 * Write data to a terminal's PTY process.
 * @param {string} tid
 * @param {string} data
 * @returns {boolean}
 */
export function writeToTerminal(tid, data) {
  const inst = terminals.get(tid);
  if (inst && inst.ptyProcess) {
    inst.ptyProcess.write(data);
    return true;
  }
  return false;
}

/**
 * Send chunks sequentially to a terminal's PTY, with delays between each.
 * @param {string} tid
 * @param {string[]} chunks
 * @param {Function} [onComplete]
 * @param {object} [opts]
 */
export function writeToTerminalSequential(tid, chunks, onComplete, opts = {}) {
  const inst = terminals.get(tid);
  const timeoutMs = opts.timeoutMs || 4000;
  const settleMs = opts.settleMs || 150;

  if (!inst || !inst.ptyProcess || !chunks || chunks.length === 0) {
    if (onComplete) onComplete(false);
    return;
  }

  let idx = 0;

  const sendNext = () => {
    if (idx >= chunks.length || !inst.ptyProcess) {
      if (onComplete) onComplete(true);
      return;
    }

    const chunk = chunks[idx];
    idx++;

    inst.ptyProcess.write(chunk);

    const isToggleOrSubmit = chunk === ' ' || chunk === '\r'
      || chunk === '\x1b[C' || chunk === '\x1b[A' || chunk === '\x1b[B';
    const delay = isToggleOrSubmit ? settleMs : 80;
    setTimeout(sendNext, delay);
  };

  sendNext();
}

/**
 * Resize a terminal's PTY.
 * @param {string} tid
 * @param {number} cols
 * @param {number} rows
 */
export function resizeTerminal(tid, cols, rows) {
  const inst = terminals.get(tid);
  if (!inst) return;
  inst.cols = cols;
  inst.rows = rows;
  if (inst.ptyProcess) {
    try { inst.ptyProcess.resize(cols, rows); } catch { }
  }
}

/**
 * Kill the PTY process in a terminal (does not remove the terminal slot).
 * @param {string} tid
 */
export function killTerminal(tid) {
  const inst = terminals.get(tid);
  if (!inst) return;
  if (inst.ptyProcess) {
    flushBatch(inst);
    inst.batchBuffer = '';
    inst.batchScheduled = false;
    try { inst.ptyProcess.kill(); } catch { }
    inst.ptyProcess = null;
  }
}

/**
 * Kill all terminal PTY processes across every registered terminal.
 */
export function killAllTerminals() {
  for (const [tid] of terminals) {
    killTerminal(tid);
  }
}

/**
 * Remove a terminal entirely (kill process + remove from registry).
 * @param {string} tid
 */
export function removeTerminal(tid) {
  killTerminal(tid);
  terminals.delete(tid);
}

/**
 * Rename a terminal's label.
 * @param {string} tid
 * @param {string} label - New human-readable label
 * @returns {boolean} Whether the rename succeeded
 */
export function renameTerminal(tid, label) {
  const inst = terminals.get(tid);
  if (!inst) return false;
  inst.label = label;
  return true;
}

// ─── Query Methods ───────────────────────────────────────────────

/**
 * Get the state of a terminal.
 * @param {string} tid
 * @returns {{ running: boolean, exitCode: number|null, tid: string, label: string, createdAt: number }|null}
 */
export function getTerminalState(tid) {
  const inst = terminals.get(tid);
  if (!inst) return null;
  return {
    tid: inst.tid,
    label: inst.label,
    running: !!inst.ptyProcess,
    exitCode: inst.lastExitCode,
    createdAt: inst.createdAt,
    cwd: inst.currentWorkspacePath || inst.lastWorkspacePath,
  };
}

/**
 * Get the full output buffer of a terminal.
 * @param {string} tid
 * @returns {string}
 */
export function getTerminalBuffer(tid) {
  const inst = terminals.get(tid);
  return inst ? inst.outputBuffer : '';
}

/**
 * Check whether a line (after stripping ANSI escapes) is decorative / status-bar noise.
 * Decorative lines include box-drawing borders, empty prompts, and progress bars.
 */
function isDecorativeLine(raw) {
  // Strip ANSI escape sequences
  const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b[()][AB012]/g, '').trim();
  if (!line) return true;
  // Line consists entirely of box-drawing / decoration characters and whitespace
  if (/^[\s\u2500-\u257f\u2580-\u259f\u2550-\u256c\u2190-\u21ff─═│┌┐└┘├┤┬┴┼↯░▓█▒\-=|+]+$/.test(line)) return true;
  // Line is just a prompt symbol with optional whitespace
  if (/^[❯$%>#\s]+$/.test(line)) return true;
  // Progress bars or status bars with block chars or percentage
  if (/[░▓█▒]/.test(line)) return true;
  if (/\d+(\.\d+)?%/.test(line) && line.length < 80) return true;
  // CC status bar: emoji + model stats
  if (/[🏢🌐🔧⚙️🤖💬📎✓✗⚡]/.test(line) && line.length < 80) return true;
  // Short lines (< 25 chars) that are likely UI labels, not content
  if (line.length < 25) return true;
  return false;
}

/**
 * Get the last N meaningful lines from a terminal's output buffer,
 * skipping decorative borders, empty prompts, and status bars.
 * @param {string} tid
 * @param {number} [lines=5]
 * @returns {string}
 */
export function getTerminalBufferPreview(tid, lines = 5) {
  const inst = terminals.get(tid);
  if (!inst || !inst.outputBuffer) return '';
  const allLines = inst.outputBuffer.split('\n');

  // Scan backwards to collect the requested number of meaningful lines
  const meaningful = [];
  for (let i = allLines.length - 1; i >= 0 && meaningful.length < lines; i--) {
    if (!isDecorativeLine(allLines[i])) {
      meaningful.unshift(allLines[i]);
    }
  }

  return meaningful.join('\n');
}

/**
 * Get the PID of a terminal's PTY process.
 * @param {string} tid
 * @returns {number|null}
 */
export function getTerminalPid(tid) {
  const inst = terminals.get(tid);
  return inst && inst.ptyProcess ? inst.ptyProcess.pid : null;
}

/**
 * List all terminals with their basic state.
 * @returns {Array<{ tid: string, label: string, running: boolean, exitCode: number|null, createdAt: number, cwd: string|null }>}
 */
export function listTerminals() {
  const result = [];
  for (const [tid, inst] of terminals) {
    result.push({
      tid,
      label: inst.label,
      running: !!inst.ptyProcess,
      exitCode: inst.lastExitCode,
      createdAt: inst.createdAt,
      cwd: inst.currentWorkspacePath || inst.lastWorkspacePath,
    });
  }
  return result;
}

// ─── Event Subscriptions ─────────────────────────────────────────

/**
 * Register a data listener for a terminal.
 * @param {string} tid
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function onTerminalData(tid, callback) {
  const inst = terminals.get(tid);
  if (!inst) return () => {};
  inst.dataListeners.push(callback);
  return () => {
    inst.dataListeners = inst.dataListeners.filter(l => l !== callback);
  };
}

/**
 * Register an exit listener for a terminal.
 * @param {string} tid
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function onTerminalExit(tid, callback) {
  const inst = terminals.get(tid);
  if (!inst) return () => {};
  inst.exitListeners.push(callback);
  return () => {
    inst.exitListeners = inst.exitListeners.filter(l => l !== callback);
  };
}
