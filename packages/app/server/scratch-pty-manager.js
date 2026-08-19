import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { chmodSync, statSync } from 'node:fs';
import { platform, arch, homedir } from 'node:os';
import { createRequire } from 'node:module';
import { prepareEmbeddedShellSpawn, applyClaudeAltScreenPref } from './lib/terminal-env.js';
import { killPtyTree } from './lib/term-signals.js';
import { findSafeSliceStart, splitTrailingIncomplete } from './lib/ansi-safe-slice.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 模块加载时即捕获，避免后续业务代码 chdir 影响 scratch 终端工作目录
const STARTUP_CWD = (() => {
  try {
    const cwd = process.cwd();
    if (!cwd || cwd === '/') return homedir() || '/';
    return cwd;
  } catch {
    return homedir() || '/';
  }
})();

const MAX_BUFFER = 50000;
// 裁剪滞回：超 MAX_BUFFER 后一次裁到 TRIM_TO，降低每 chunk slice 重分配频率（同 pty-manager.js）
const BUFFER_TRIM_TO = 45000;

// id -> { ptyProcess, dataListeners, exitListeners, lastExitCode, outputBuffer, lastCols, lastRows, batchBuffer, batchScheduled }
const ptys = new Map();
// id -> in-flight spawn Promise，防同 id 并发 spawn 双开
const _spawnInflight = new Map();
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

function newState() {
  return {
    ptyProcess: null,
    dataListeners: [],
    exitListeners: [],
    lastExitCode: null,
    outputBuffer: '',
    lastCols: 100,
    lastRows: 24,
    batchBuffer: '',
    batchScheduled: false,
  };
}

// 仅在确实有消费方时才创建条目；为 onScratchData/onScratchExit 与 spawnScratch 复用
function getOrInit(id) {
  let s = ptys.get(id);
  if (!s) {
    s = newState();
    ptys.set(id, s);
  }
  return s;
}

// 当某 id 既无 pty 又无监听器时清掉空记录，防止懒注册场景下 Map 长尾膨胀
function maybeReap(id, s) {
  if (!s.ptyProcess && s.dataListeners.length === 0 && s.exitListeners.length === 0) {
    ptys.delete(id);
  }
}

function flushBatch(s, force = false) {
  s.batchScheduled = false;
  if (!s.batchBuffer) return;
  // 批边界半截序列缓带（同 pty-manager.flushBatch）：scratch chunk 本身不包 SYNC 标记，
  // 但洪泛限流器会按 flush 包裹——chunk 尾部序列完整才能保证 flush 边界不撕裂。
  // force=true（进程退出）时不缓带，冲洗全部残余。
  let chunk = s.batchBuffer;
  let carry = '';
  if (!force) [chunk, carry] = splitTrailingIncomplete(s.batchBuffer);
  s.batchBuffer = carry;
  if (!chunk) return;
  // snapshot 防 listener 在迭代中卸载产生跳号
  for (const cb of [...s.dataListeners]) {
    try { cb(chunk); } catch { }
  }
}

// 见 pty-manager.js::fixSpawnHelperPermissions 同名函数注释；用 createRequire 而非
// __dirname 相对路径以兼容 pnpm/yarn workspace 的 node-pty hoist 布局。
function fixSpawnHelperPermissions() {
  const os = platform();
  const cpu = arch();
  const subPath = `node-pty/prebuilds/${os}-${cpu}/spawn-helper`;
  let helperPath;
  try {
    const req = createRequire(import.meta.url);
    helperPath = req.resolve(subPath);
  } catch (err) {
    return;
  }
  try {
    const stat = statSync(helperPath);
    if (!(stat.mode & 0o111)) {
      chmodSync(helperPath, stat.mode | 0o755);
    }
  } catch (err) {
    console.warn('[cc-viewer] fixSpawnHelperPermissions failed:', helperPath, err?.message || err);
  }
}

// 注：spawn 失败时 s 留在 Map 但 s.ptyProcess 仍为 null。server connection handler 在
// 失败后仍会通过 onScratchData/onScratchExit 注册 listener；ws.close 时它们通过 maybeReap
// 清空记录，所以无长期泄漏。已知降级体验：用户看到空终端，下次 input 会再试一次 spawn。
export async function spawnScratch(id) {
  if (!id || typeof id !== 'string') throw new Error('spawnScratch requires id');
  const s = getOrInit(id);
  if (s.ptyProcess) return s.ptyProcess;
  if (_spawnInflight.has(id)) return _spawnInflight.get(id);
  const p = (async () => {
    const pty = await getPty();
    fixSpawnHelperPermissions();

    const shell = process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh');
    const env = { ...process.env };
    // 前缀扫描剥离 cc-viewer 主进程的全部协调变量，scratch shell 只继承 cwd + 通用 shell env。
    // cli.js 会在父进程 set 一批 CCV_*（CCV_CLI_MODE / CCV_PROJECT_DIR / CCV_PROXY_PORT / CCV_SDK_MODE /
    // CCV_WORKSPACE_MODE / CCV_BYPASS_PERMISSIONS / CCV_USER_NAME / CCV_USER_AVATAR 等），用前缀
    // 一次性清掉防遗漏；以后新增 CCV_*/CCVIEWER_* 都自动覆盖，scratch 里跑 ccv 不会反向劫持父级服务。
    for (const k of Object.keys(env)) {
      if (k.startsWith('CCV_') || k.startsWith('CCVIEWER_')) delete env[k];
    }
    delete env.ANTHROPIC_BASE_URL;
    env.CLAUDE_CODE_DISABLE_MOUSE ??= '1';
    // 默认让 scratch 里手敲的 claude 也回到经典流式渲染、终端可滚历史;想保留全屏设
    // CCV_KEEP_CLAUDE_FULLSCREEN=1 opt-out。CCV_* 已被上方剥离，opt-out 靠 sourceEnv(父进程 env)检测。
    applyClaudeAltScreenPref(env);
    const shellSpawn = prepareEmbeddedShellSpawn(shell, env);

    s.lastExitCode = null;
    s.outputBuffer = '';

    s.ptyProcess = pty.spawn(shellSpawn.command, shellSpawn.args, {
      name: 'xterm-256color',
      cols: s.lastCols,
      rows: s.lastRows,
      cwd: STARTUP_CWD,
      env: shellSpawn.env,
    });

    s.ptyProcess.onData((data) => {
      s.outputBuffer += data;
      if (s.outputBuffer.length > MAX_BUFFER) {
        const rawStart = s.outputBuffer.length - BUFFER_TRIM_TO;
        const safeStart = findSafeSliceStart(s.outputBuffer, rawStart);
        s.outputBuffer = s.outputBuffer.slice(safeStart);
      }
      s.batchBuffer += data;
      if (!s.batchScheduled) {
        s.batchScheduled = true;
        setImmediate(() => flushBatch(s));
      }
    });

    s.ptyProcess.onExit(({ exitCode }) => {
      flushBatch(s, true);
      s.lastExitCode = exitCode;
      s.ptyProcess = null;
      for (const cb of [...s.exitListeners]) {
        try { cb(exitCode); } catch { }
      }
    });

    return s.ptyProcess;
  })();
  _spawnInflight.set(id, p);
  try {
    return await p;
  } finally {
    _spawnInflight.delete(id);
  }
}

export function writeScratch(id, data) {
  const s = ptys.get(id);
  if (s?.ptyProcess) {
    s.ptyProcess.write(data);
    return true;
  }
  return false;
}

// cols/rows 钳制为有限正整数（同 pty-manager.resizePty 的理由：防 NaN/2×1 毒化 lastCols
// 后毒化 respawn）。非有限值回退到上一个有效值。
function _clampScratchDim(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function resizeScratch(id, cols, rows) {
  const s = ptys.get(id);
  if (!s) return;
  s.lastCols = _clampScratchDim(cols, 2, 1000, s.lastCols);
  s.lastRows = _clampScratchDim(rows, 1, 1000, s.lastRows);
  if (s.ptyProcess) {
    try { s.ptyProcess.resize(s.lastCols, s.lastRows); } catch { }
  }
}

export function killScratch(id) {
  const s = ptys.get(id);
  if (!s) return;
  if (s.ptyProcess) {
    flushBatch(s, true);
    s.batchBuffer = '';
    s.batchScheduled = false;
    // 与 pty-manager.killPty 同款：win32 用 taskkill /T 收割 ConPTY 树，
    // 绕开 node-pty kill 的同步挂起问题；非 Windows 走原路径。
    if (!killPtyTree(s.ptyProcess.pid)) {
      try { s.ptyProcess.kill(); } catch { }
    }
    s.ptyProcess = null;
  }
  // 显式 kill 后整条记录清掉，监听器一并丢弃（前端 ws.close 也会清）
  ptys.delete(id);
}

export function killAllScratch() {
  for (const id of [...ptys.keys()]) {
    killScratch(id);
  }
}

export function onScratchData(id, cb) {
  const s = getOrInit(id);
  s.dataListeners.push(cb);
  return () => {
    s.dataListeners = s.dataListeners.filter(l => l !== cb);
    maybeReap(id, s);
  };
}

export function onScratchExit(id, cb) {
  const s = getOrInit(id);
  s.exitListeners.push(cb);
  return () => {
    s.exitListeners = s.exitListeners.filter(l => l !== cb);
    maybeReap(id, s);
  };
}

export function getScratchPid(id) {
  const s = ptys.get(id);
  return s?.ptyProcess ? s.ptyProcess.pid : null;
}

export function getScratchState(id) {
  const s = ptys.get(id);
  return {
    running: !!(s?.ptyProcess),
    exitCode: s?.lastExitCode ?? null,
    cwd: STARTUP_CWD,
  };
}

export function getScratchOutputBuffer(id) {
  return ptys.get(id)?.outputBuffer ?? '';
}

export function getScratchStartupCwd() {
  return STARTUP_CWD;
}

export function getScratchActiveCount() {
  let n = 0;
  for (const s of ptys.values()) if (s.ptyProcess) n++;
  return n;
}

// 服务端 upgrade 阶段做硬上限用：返回 Map 当前条目数（含已退出但未回收的 state）
export function getScratchPtyCount() {
  return ptys.size;
}

// 服务端 upgrade 阶段判断 id 是否是"已有重连"，避免 cap 误伤老 tab 重连
export function hasScratchPty(id) {
  return ptys.has(id);
}

// 当前 spawn 用的 shell basename（zsh / bash / fish 等），供前端渲染 tab 标签
export function getScratchShellBasename() {
  return basename(process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh')) || 'shell';
}
