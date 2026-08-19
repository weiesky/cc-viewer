// 启动期配置备份 — 2026-06-06 LOG_DIR 整树删除事故防再犯。
// preferences.json(auth/IM token/偏好)、profile.json(代理热切换)、workspaces.json(工作区注册表)
// 是无法从日志/会话重建的"静态设置";本模块在 server 启动时把它们备份到 LOG_DIR **之外**
// 的兄弟目录(默认 ~/.claude/cc-viewer-config-backups/<时间戳>/),滚动保留最近 KEEP 份。
// 全程 best-effort:任何失败只返回 {ok:false},绝不抛错阻塞启动。
import { existsSync, mkdirSync, copyFileSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { LOG_DIR } from '../../findcc.js';

const CONFIG_FILES = ['preferences.json', 'profile.json', 'workspaces.json'];
const KEEP = 10;
// 备份子目录名:严格时间戳形态。prune 只删匹配此形态的目录,绝不波及其它内容。
const STAMP_RE = /^\d{8}_\d{6}$/;

export function getBackupRoot(logDir = LOG_DIR) {
  return join(dirname(logDir), 'cc-viewer-config-backups');
}

/**
 * 备份 logDir 下的配置文件到 getBackupRoot()/<YYYYMMDD_HHMMSS>/,并滚动清理。
 * @param {string} [logDir] 默认 findcc 的 LOG_DIR(live binding)
 * @param {Date}   [now]    注入时钟,便于测试
 * @returns {{ok:boolean, dir?:string, copied?:string[], pruned?:number, error?:string}}
 */
export function backupConfigs(logDir = LOG_DIR, now = new Date()) {
  try {
    const candidates = CONFIG_FILES.filter((f) => existsSync(join(logDir, f)));
    if (!candidates.length) return { ok: true, copied: [], pruned: 0 };
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    const root = getBackupRoot(logDir);
    const dir = join(root, stamp);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const copied = [];
    for (const f of candidates) {
      try {
        copyFileSync(join(logDir, f), join(dir, f));
        // preferences 携带密钥,备份份保持 0600(copyFileSync 跟随 umask,需显式收紧)
        chmodSync(join(dir, f), 0o600);
        copied.push(f);
      } catch { /* 单文件失败不影响其它 */ }
    }
    let pruned = 0;
    try {
      const entries = readdirSync(root).filter((d) => STAMP_RE.test(d)).sort();
      while (entries.length > KEEP) {
        rmSync(join(root, entries.shift()), { recursive: true, force: true });
        pruned++;
      }
    } catch { /* prune 失败不影响本次备份 */ }
    return { ok: true, dir, copied, pruned };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
