// IM 进程唯一性锁 —— 每个独立 IM ccv 进程在 ~/.claude/cc-viewer/IM_<id>/im.lock
// 持有一把"每平台每机唯一"的锁，避免同一机器人被多处接入。
//
// 设计要点（见 plan §5/§6）：
// - 获取用 openSync(path,'wx') 原子哨兵（与 workspace-registry.js 同款），保证并发只有一个赢家。
// - 内容写入走 temp + renameSyncWithRetry（与 file-api.js / saveWorkspaces 一致），避免读到半写 JSON。
// - 读方对 JSON.parse 失败一律容忍（返回 null），绝不据此删锁。
// - 活性判定四态：dead（无锁）/ booting（已建锁未写 port 且在启动窗内）/ ready（已写 port 且 HTTP 身份探测通过）/ hung（pid 存活但探测失败或超启动窗）。
//   长跑 bot 不会更新 mtime，故不沿用 workspace-registry 的 mtime 陈旧判据，改用 PID 存活 + HTTP 身份探测。
// - 释放按身份（仅当锁的 pid === 调用方 pid 才 unlink），避免误删后继进程的锁。
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { LOG_DIR } from '../../findcc.js';
import { renameSyncWithRetry } from './file-api.js';

// 启动窗：已建锁但尚未回填 port 的进程，在此时间内视为"启动中"（不可被判死/重拉）。
export const BOOT_WINDOW_MS = 15000;

// 注意：直接引用 live binding LOG_DIR（findcc.js 用 `export let` + setLogDir 运行时可变），
// 因此每次调用都取最新值，不在模块顶层捕获快照。
export function imDir(id) { return join(LOG_DIR, `IM_${id}`); }
export function lockPath(id) { return join(imDir(id), 'im.lock'); }

/** 进程是否存活。signal 0 仅探测、不投递；EPERM 表示进程存在但非本用户可控（仍算存活）。 */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

/** 读锁内容；文件不存在 / 半写 / 非对象一律返回 null（容忍瞬时不可读）。 */
export function readImLock(id) {
  try {
    const o = JSON.parse(readFileSync(lockPath(id), 'utf-8'));
    return (o && typeof o === 'object') ? o : null;
  } catch { return null; }
}

/** 原子写锁内容：temp + renameSyncWithRetry，读方永远不会看到截断。 */
function writeLockContent(id, payload) {
  const dir = imDir(id);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `im.lock.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
    renameSyncWithRetry(tmp, lockPath(id));
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

/**
 * 获取锁（由 worker 进程自身在启动早期调用）。
 * 返回 { ok: true } 表示获得；{ ok: false, holder } 表示已被活进程持有。
 * 获取阶段用 PID 存活判定持有者活性（HTTP 探测留给 manager 的 reconcile/status）。
 * @param {string} id
 * @param {{ isAlive?: (lock:object)=>boolean }} [opts] 测试可注入 isAlive
 */
export function acquireImLock(id, opts = {}) {
  const isAlive = opts.isAlive || ((lock) => isPidAlive(lock?.pid));
  const dir = imDir(id);
  mkdirSync(dir, { recursive: true });
  const p = lockPath(id);

  for (let attempt = 0; attempt < 3; attempt++) {
    let fd;
    try {
      fd = openSync(p, 'wx'); // O_CREAT | O_EXCL —— 原子哨兵
      closeSync(fd);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readImLock(id);
      // 持有者存活且不是我们自己 → 拒绝（全局唯一）
      if (holder && holder.pid !== process.pid && isAlive(holder)) {
        return { ok: false, holder };
      }
      // 陈旧锁 / 自己的残留 → 回收后重试
      try { unlinkSync(p); } catch { /* 可能已被并发者清掉，继续重试 */ }
      continue;
    }
    // 拿到哨兵 → 写入内容（port 启动后由 updateImLockPort 回填）
    writeLockContent(id, { pid: process.pid, port: null, startedAt: new Date().toISOString() });
    return { ok: true };
  }
  // 多次竞争失败：最后再判一次，活则报告持有者，否则上抛
  const holder = readImLock(id);
  if (holder && holder.pid !== process.pid && isPidAlive(holder.pid)) return { ok: false, holder };
  throw new Error(`acquireImLock(${id}): failed to acquire after retries`);
}

/** 服务器监听成功后回填真实端口（原子写）。 */
export function updateImLockPort(id, port) {
  const lock = readImLock(id);
  if (!lock || lock.pid !== process.pid) return false;
  lock.port = port;
  writeLockContent(id, lock);
  return true;
}

/** 按身份释放：仅当锁的 pid === 传入 pid（默认本进程）才删除。worker 退出时调用。 */
export function releaseImLock(id, pid = process.pid) {
  const lock = readImLock(id);
  if (lock && lock.pid !== pid) return false; // 锁已被后继进程接管，勿误删
  try { unlinkSync(lockPath(id)); } catch { /* 已不存在即视为已释放 */ }
  return true;
}

/** 无条件清除（manager 清理确认已死的陈旧锁时用）。 */
export function clearImLock(id) {
  try { unlinkSync(lockPath(id)); return true; } catch { return false; }
}

/**
 * 默认 HTTP 身份探测：loopback GET worker 自身的 /api/im/<id>/status。
 * 返回 { ok, connected, pid } 或 null（无人应答 / 形状不符 / 超时）。
 * 仅在 worker 已回填 port 后使用。
 */
export function defaultProbe(id, port, { timeoutMs = 400 } = {}) {
  return new Promise((resolveP) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolveP(v); } };
    try {
      const req = httpGet(
        { host: '127.0.0.1', port, path: `/api/im/${encodeURIComponent(id)}/status`, timeout: timeoutMs },
        (res) => {
          if (res.statusCode !== 200) { res.resume(); return finish(null); }
          let body = '';
          res.setEncoding('utf-8');
          res.on('data', (c) => { body += c; if (body.length > 1_000_000) req.destroy(); });
          res.on('end', () => {
            try {
              const j = JSON.parse(body);
              // 身份：能对「该 id」返回 IM status 形状的 loopback 服务即视为我们的 worker
              if (j && (j.connection || typeof j.enabled === 'boolean')) {
                finish({
                  ok: true,
                  connected: !!(j.connection && j.connection.connected),
                  // Old workers (pre-tri-state builds) omit connectionState → derive from connected.
                  connectionState: j.connection?.connectionState
                    ?? (j.connection?.connected ? 'connected' : 'disconnected'),
                  lastError: j.connection?.lastError ?? null,
                  pid: j.pid,
                });
              } else finish(null);
            } catch { finish(null); }
          });
        }
      );
      req.on('error', () => finish(null));
      req.on('timeout', () => { req.destroy(); finish(null); });
    } catch { finish(null); }
  });
}

/**
 * 三态活性判定。
 * @returns {Promise<{ state:'dead'|'booting'|'ready'|'hung', lock:object|null, connected?:boolean }>}
 *   dead    —— 无锁文件（可安全 spawn）
 *   booting —— 已建锁、未回填 port、startedAt 在启动窗内且 pid 存活（视为活，勿重拉）
 *   ready   —— 已回填 port 且 HTTP 身份探测通过（真正在线）
 *   hung    —— pid 存活但探测失败/超启动窗（疑似卡死，可 identity-stop 后重启）
 * @param {string} id
 * @param {{ probe?: Function, now?: ()=>number, pidAlive?: (pid:number)=>boolean }} [opts]
 */
export async function getImLiveness(id, opts = {}) {
  const probe = opts.probe || defaultProbe;
  const now = opts.now || Date.now;
  const pidAlive = opts.pidAlive || isPidAlive;

  const lock = readImLock(id);
  if (!lock) {
    // 文件确实不存在 → dead；存在但读不出（半写）→ 视为 booting（瞬时态，勿删）
    return existsSync(lockPath(id)) ? { state: 'booting', lock: null } : { state: 'dead', lock: null };
  }

  if (lock.port == null) {
    const age = now() - Date.parse(lock.startedAt || '');
    if (Number.isFinite(age) && age < BOOT_WINDOW_MS && pidAlive(lock.pid)) {
      return { state: 'booting', lock };
    }
    return { state: pidAlive(lock.pid) ? 'hung' : 'dead', lock };
  }

  const res = await probe(id, lock.port);
  if (res && res.ok && (res.pid == null || res.pid === lock.pid)) {
    return {
      state: 'ready',
      lock,
      connected: !!res.connected,
      connectionState: res.connectionState ?? (res.connected ? 'connected' : 'disconnected'),
      lastError: res.lastError ?? null,
    };
  }
  return { state: pidAlive(lock.pid) ? 'hung' : 'dead', lock };
}
