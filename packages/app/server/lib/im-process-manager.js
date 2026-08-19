// IM 进程管理（父进程侧）—— 由主交互式 ccv 调用，负责把每个启用的 IM 作为 detached 常驻
// 子进程拉起 / 停止 / 查询状态 / 启动时 reconcile。worker 自身（cli.js runImMode）持有 im.lock；
// 本模块只读锁 + 探活 + spawn/kill。
//
// 设计：detached + unref（主 ccv 关闭后 worker 仍在线）；停止时杀**进程组**清理 worker 的
// Claude PTY + proxy 等孙进程；env 用「前缀剥离 + 白名单回填」杜绝 CCV_*/CCVIEWER_* 泄漏。
// v1 不做常驻 supervisor（reconcile-on-startup + 配置保存即驱动 已覆盖主路径，且避免多主进程互斗）。
import { spawn as nodeSpawn, execSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPlatforms, loadConfig } from './im-config.js';
import {
  imDir, readImLock, clearImLock, isPidAlive, getImLiveness, defaultProbe,
} from './im-lock.js';

const CLI_JS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 解析真实 node 二进制（Electron 下 process.execPath 是 Electron，需要 `which node`）。 */
export function resolveNodeBinary() {
  if (!process.versions.electron) return process.execPath;
  try {
    const out = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8', windowsHide: true });
    const p = process.platform === 'win32' ? out.split('\n')[0].trim() : out.trim();
    if (p) return p;
  } catch { /* fall through */ }
  return process.platform === 'win32' ? 'node' : '/usr/local/bin/node';
}

/**
 * 构建 worker 子进程环境（前缀剥离 + 白名单回填）。
 * - 先继承全部 process.env（保住 PATH / HOME / ANTHROPIC_ * / 代理 / locale 等）。
 * - 删除所有 CCV_ 与 CCVIEWER_ 前缀的内部变量（面向未来：新增的 CCV_ 变量也不会泄漏）。
 *   尤其防住：CCV_BYPASS_PERMISSIONS、CCV_ELECTRON_MULTITAB（会让 worker 不起 Claude PTY）、
 *   CCV_PASSWORD、CCV_USER_NAME/AVATAR、CCV_PROXY_MODE、CCV_PROJECT_DIR 等误导项。
 * - 仅 CCV_LOG_DIR 在父进程显式设置时回填（共享同一份 prefs 与日志根；生产默认不设，worker 走默认）。
 * - 再写入 worker 专属 env。
 */
export function buildChildEnv(id, base = process.env) {
  const env = { ...base };
  const inheritedLogDir = base.CCV_LOG_DIR;
  for (const k of Object.keys(env)) {
    if (k.startsWith('CCV_') || k.startsWith('CCVIEWER_')) delete env[k];
  }
  if (inheritedLogDir) env.CCV_LOG_DIR = inheritedLogDir;
  env.CCV_IM_PLATFORM = id;
  env.CCV_START_PORT = '7050';
  env.CCV_MAX_PORT = '7099';
  env.CCV_HOST = '127.0.0.1';
  env.CCV_IM_DENY = '1';
  return env;
}

/**
 * 以 detached 子进程拉起一个 IM worker：`node cli.js --im <id> --no-open`，cwd=IM_<id>/。
 * @param {string} id
 * @param {{ spawnImpl?: Function }} [opts] 测试可注入 spawnImpl
 * @returns {{ pid:number|undefined, dir:string, outLog:string }}
 */
export function spawnImProcess(id, opts = {}) {
  // ████████ 测试隔离铁闸 L4 —— 绝对不可移除(2026-06-06 数据事故防再犯)████████
  // 单元测试【绝不允许】拉起真实 detached IM worker:
  //  1) detached worker 脱离测试生命周期常驻(PPID=1),测试结束后仍在运行;
  //  2) buildChildEnv 按设计剥离 CCV_*,worker 子链最终把真实 ~/.claude/cc-viewer 当 LOG_DIR;
  //  3) 测试与用户真实 worker 在锁/端口(7050-7099)/配置上互相干扰——
  //     2026-06-06 该链条曾三次把用户 40GB 历史日志整树删除。
  // 注入 spawnImpl 的纯单测(假 spawn)不受影响;确需真实 spawn 的集成测试必须显式
  // CCV_TEST_ALLOW_IM_SPAWN=1 并自行负责完全隔离(私有 CCV_LOG_DIR + 私有端口窗)。
  if (process.env.NODE_TEST_CONTEXT && !opts.spawnImpl && process.env.CCV_TEST_ALLOW_IM_SPAWN !== '1') {
    const dir = imDir(id);
    console.warn(`[im-process-manager] 测试环境拒绝真实 spawn IM worker '${id}'(L4 铁闸;如确需请设 CCV_TEST_ALLOW_IM_SPAWN=1)`);
    return { pid: undefined, dir, outLog: join(dir, 'process.out.log'), blockedByTestGuard: true };
  }
  // ████████████████████████████████████████████████████████████████████████
  const spawnImpl = opts.spawnImpl || nodeSpawn;
  const dir = imDir(id);
  mkdirSync(dir, { recursive: true });
  const outLog = join(dir, 'process.out.log');

  let stdio = 'ignore';
  let fd = null;
  try {
    fd = openSync(outLog, 'a');
    stdio = ['ignore', fd, fd];
  } catch { /* 无法开日志文件时退化为 ignore */ }

  const child = spawnImpl(resolveNodeBinary(), [CLI_JS, '--im', id, '--no-open'], {
    cwd: dir,
    env: buildChildEnv(id),
    stdio,
    detached: true,        // 自成进程组 leader → 停止时可整组杀，清理孙进程
    windowsHide: true,
  });
  try { child.unref?.(); } catch { /* noop */ }
  if (fd !== null) { try { closeSync(fd); } catch { /* 子进程已 dup */ } }
  return { pid: child?.pid, dir, outLog };
}

/** 默认进程组杀（worker 是 detached group leader）；失败回退单进程。 */
function defaultKill(pid, signal) {
  try { process.kill(-pid, signal); return; } catch { /* not a group leader / windows */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
}

/**
 * 停止一个 IM worker：SIGTERM（worker cleanup 断适配器 + 释放锁）→ 轮询锁释放/进程死 →
 * 超时 SIGKILL 进程组 → 清锁。
 * @param {string} id
 * @param {{ killImpl?:Function, isAlive?:Function, timeoutMs?:number, pollIntervalMs?:number }} [opts]
 */
export async function stopImProcess(id, opts = {}) {
  const kill = opts.killImpl || defaultKill;
  const isAlive = opts.isAlive || isPidAlive;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const pollMs = opts.pollIntervalMs ?? 200;

  const lock = readImLock(id);
  if (!lock || !lock.pid || !isAlive(lock.pid)) {
    clearImLock(id);
    return { stopped: true, alreadyDead: true };
  }

  kill(lock.pid, 'SIGTERM');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const l = readImLock(id);
    if (!l || l.pid !== lock.pid) return { stopped: true };   // worker 干净退出已释放锁
    if (!isAlive(lock.pid)) { clearImLock(id); return { stopped: true }; }
  }
  kill(lock.pid, 'SIGKILL');
  await sleep(pollMs);
  clearImLock(id);
  return { stopped: true, forced: true };
}

/**
 * 查询某 IM 的进程状态（供 header chip / 路由）。
 * @returns {Promise<{state:string, running:boolean, connected:boolean, connectionState:string, lastError:string|null, pid:number|null, port:number|null, startedAt:string|null}>}
 */
export async function getImProcessStatus(id, opts = {}) {
  const live = await getImLiveness(id, opts);
  return {
    state: live.state,
    running: live.state === 'ready' || live.state === 'booting' || live.state === 'hung',
    connected: live.state === 'ready' && !!live.connected,
    // Tri-state IM link status from the worker's own report; a non-ready process cannot be
    // connected or reconnecting, so it reads as disconnected.
    connectionState: live.state === 'ready'
      ? (live.connectionState || (live.connected ? 'connected' : 'disconnected'))
      : 'disconnected',
    lastError: live.lastError ?? null,
    pid: live.lock?.pid ?? null,
    port: live.lock?.port ?? null,
    startedAt: live.lock?.startedAt ?? null,
  };
}

/**
 * 启动时对账：为每个 enabled 且当前无活进程（state==='dead'）的 IM 拉起 worker。幂等（worker 侧 wx 锁兜底）。
 * @returns {Promise<string[]>} 本次拉起的平台 id 列表
 */
export async function reconcileImProcesses(opts = {}) {
  const spawned = [];
  for (const id of listPlatforms()) {
    let cfg;
    try { cfg = loadConfig(id); } catch { continue; }
    if (!cfg.enabled) continue;
    const live = await getImLiveness(id, opts);
    if (live.state === 'dead') {
      try { spawnImProcess(id, opts); spawned.push(id); }
      catch (e) { console.error(`[CC Viewer] reconcile spawn failed for IM ${id}:`, e?.message || e); }
    }
  }
  return spawned;
}

export { defaultProbe };
