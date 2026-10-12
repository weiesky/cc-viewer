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

// Multi-project (2026-10-12): scratch PTYs are keyed by (tab id, resolved workspace
// cwd) so each viewed workspace owns an isolated shell group; switching away keeps the
// old group's processes alive and switching back re-attaches them. Callers that omit
// cwd fall back to STARTUP_CWD (pre-multi-project API shape — keeps older tests and
// any un-updated call site on a single, well-defined bucket).
function effCwd(opts) {
  return (opts && typeof opts.cwd === 'string' && opts.cwd) ? opts.cwd : STARTUP_CWD;
}
function keyFor(id, cwd) {
  // Space separator is collision-free: the id charset (SCRATCH_ID_RE, [A-Za-z0-9_-])
  // excludes spaces, so the first space always delimits even when the cwd contains them.
  return `${id} ${cwd || STARTUP_CWD}`;
}

// composite key -> { ptyProcess, dataListeners, exitListeners, lastExitCode, outputBuffer, lastCols, lastRows, batchBuffer, batchScheduled, cwd }
const ptys = new Map();
// composite key -> in-flight spawn Promise; dedupes concurrent spawns for the same id+cwd
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

function newState(cwd) {
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
    cwd: cwd || STARTUP_CWD,
  };
}

// 仅在确实有消费方时才创建条目；为 onScratchData/onScratchExit 与 spawnScratch 复用
function getOrInit(id, cwd) {
  const k = keyFor(id, cwd);
  let s = ptys.get(k);
  if (!s) {
    s = newState(cwd);
    ptys.set(k, s);
  }
  return { k, s };
}

// 当某 key 既无 pty 又无监听器时清掉空记录，防止懒注册场景下 Map 长尾膨胀。
// Identity check: a kill+quick-respawn replaces the entry under the same key — the old
// process's async onExit must not delete the NEW live record (leaks an unreachable
// shell and desyncs the caps).
function maybeReap(k, s) {
  if (!s.ptyProcess && s.dataListeners.length === 0 && s.exitListeners.length === 0) {
    if (ptys.get(k) === s) ptys.delete(k);
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
// Multi-project: the shell's cwd comes from the viewed-workspace resolution threaded
// through opts.cwd (server.js upgrade handler); STARTUP_CWD remains the fallback.
export async function spawnScratch(id, opts) {
  if (!id || typeof id !== 'string') throw new Error('spawnScratch requires id');
  const cwd = effCwd(opts);
  const { k, s } = getOrInit(id, cwd);
  if (s.ptyProcess) return s.ptyProcess;
  if (_spawnInflight.has(k)) return _spawnInflight.get(k);
  const p = (async () => {
    const pty = await getPty();
    fixSpawnHelperPermissions();
    // Stale-record guard: a killAll/killForCwd during the async getPty() window deletes
    // the record from ptys. Without this check the freshly spawned process below would
    // be assigned to an orphaned state object — a live shell no Map entry can reach
    // (invisible to getScratchPid/writeScratch/kill, uncounted against the caps).
    if (ptys.get(k) !== s) {
      throw new Error('scratch record reaped during spawn');
    }

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

    const proc = pty.spawn(shellSpawn.command, shellSpawn.args, {
      name: 'xterm-256color',
      cols: s.lastCols,
      rows: s.lastRows,
      cwd: s.cwd,
      env: shellSpawn.env,
    });
    // The synchronous spawn above cannot interleave with a reap, but belt-and-braces:
    // re-check before publishing so a process is never attached to a reaped record.
    if (ptys.get(k) !== s) {
      try { proc.kill(); } catch { }
      throw new Error('scratch record reaped during spawn');
    }

    s.lastExitCode = null;
    s.outputBuffer = '';
    s.ptyProcess = proc;

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
      // A shell that exits while its page is away (switch-away already removed
      // listeners) would otherwise linger as a dead entry against the caps.
      maybeReap(k, s);
    });

    return s.ptyProcess;
  })();
  _spawnInflight.set(k, p);
  try {
    return await p;
  } finally {
    _spawnInflight.delete(k);
  }
}

export function writeScratch(id, data, opts) {
  const s = ptys.get(keyFor(id, effCwd(opts)));
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

export function resizeScratch(id, cols, rows, opts) {
  const s = ptys.get(keyFor(id, effCwd(opts)));
  if (!s) return;
  s.lastCols = _clampScratchDim(cols, 2, 1000, s.lastCols);
  s.lastRows = _clampScratchDim(rows, 1, 1000, s.lastRows);
  if (s.ptyProcess) {
    try { s.ptyProcess.resize(s.lastCols, s.lastRows); } catch { }
  }
}

// Shared teardown for killScratch/killAllScratch: kill the process tree, flush the
// batch pipeline, then drop the record entirely (listeners included — the frontend
// ws.close path unsubscribes separately).
function _killEntry(k, s) {
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
  ptys.delete(k);
}

export function killScratch(id, opts) {
  _killEntry(keyFor(id, effCwd(opts)), ptys.get(keyFor(id, effCwd(opts))));
}

export function killAllScratch() {
  for (const [k, s] of [...ptys.entries()]) {
    _killEntry(k, s);
  }
}

// Kill every scratch PTY belonging to ONE workspace cwd (closing a project/instance via
// /api/live-processes/close). The match is against the record's stored spawn cwd, which
// was realpathSync-normalized at the upgrade — so callers pass candidates in BOTH path
// spaces (raw spawn cwd + its realpath): when the workspace dir was later deleted,
// realpathSync(raw) throws and only the raw candidate can match, while the bucket key
// may be the realpath. Same-basename twins have distinct cwds, so this never reaps a
// sibling workspace's shells. Accepts a single cwd string or an array of candidates.
// Returns the number reaped.
export function killScratchForCwd(cwd) {
  const cands = (Array.isArray(cwd) ? cwd : [cwd]).filter((c) => typeof c === 'string' && c);
  if (cands.length === 0) return 0;
  let n = 0;
  for (const [k, s] of [...ptys.entries()]) {
    if (s && cands.includes(s.cwd)) {
      _killEntry(k, s);
      n++;
    }
  }
  return n;
}

export function onScratchData(id, cb, opts) {
  const cwd = effCwd(opts);
  const { k, s } = getOrInit(id, cwd);
  s.dataListeners.push(cb);
  return () => {
    s.dataListeners = s.dataListeners.filter(l => l !== cb);
    maybeReap(k, s);
  };
}

export function onScratchExit(id, cb, opts) {
  const cwd = effCwd(opts);
  const { k, s } = getOrInit(id, cwd);
  s.exitListeners.push(cb);
  return () => {
    s.exitListeners = s.exitListeners.filter(l => l !== cb);
    maybeReap(k, s);
  };
}

export function getScratchPid(id, opts) {
  const s = ptys.get(keyFor(id, effCwd(opts)));
  return s?.ptyProcess ? s.ptyProcess.pid : null;
}

export function getScratchState(id, opts) {
  const cwd = effCwd(opts);
  const s = ptys.get(keyFor(id, cwd));
  return {
    running: !!(s?.ptyProcess),
    exitCode: s?.lastExitCode ?? null,
    // The record always carries its real spawn cwd; only a missing record falls back to
    // the requested cwd (pre-spawn probe). No `|| cwd` blur — a corrupted record must
    // surface, not silently report the requester's cwd.
    cwd: s ? s.cwd : cwd,
  };
}

export function getScratchOutputBuffer(id, opts) {
  return ptys.get(keyFor(id, effCwd(opts)))?.outputBuffer ?? '';
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

// Per-workspace cap companion to the global count above: entries belonging to one
// resolved cwd (hidden workspaces keep their PTYs alive by design, so the global cap
// alone would starve multi-workspace use).
export function getScratchPtyCountForCwd(cwd) {
  const target = effCwd({ cwd });
  let n = 0;
  for (const s of ptys.values()) if (s.cwd === target) n++;
  return n;
}

// 服务端 upgrade 阶段判断 id 是否是"已有重连"，避免 cap 误伤老 tab 重连
export function hasScratchPty(id, opts) {
  return ptys.has(keyFor(id, effCwd(opts)));
}

// 当前 spawn 用的 shell basename（zsh / bash / fish 等），供前端渲染 tab 标签
export function getScratchShellBasename() {
  return basename(process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh')) || 'shell';
}
