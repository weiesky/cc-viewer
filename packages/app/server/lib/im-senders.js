// IM 发送者身份持久化 —— 每个 IM worker 把解析到的「发送者 senderId → {name, avatar}」写到
// ~/.claude/cc-viewer/IM_<id>/im-senders.json，供主进程的 /api/im/:platform/senders 读取，
// 让「对话记录」弹窗能按 senderId 显示真实姓名 + 头像。
//
// 设计（与 im-lock.js 同风格）：
// - 原子写：temp + renameSyncWithRetry，读方永不见半写 JSON。
// - 读容忍：坏 / 缺 / 非对象一律降级为 {}，绝不抛。
// - 容量上限：按 ts 保留最近 MAX_SENDERS 个，避免无限增长（群聊发送者可能很多）。
// - 这些是本地数据（不入 preferences、不外发），与现有本地日志同级。
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { imDir } from './im-lock.js';
import { renameSyncWithRetry } from './file-api.js';

export const MAX_SENDERS = 500;

function sendersPath(id) { return join(imDir(id), 'im-senders.json'); }

/** 读发送者映射；不存在 / 坏 JSON / 非对象 → {}。 */
export function readSenders(id) {
  try {
    const o = JSON.parse(readFileSync(sendersPath(id), 'utf-8'));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch { return {}; }
}

/** 原子写整张映射（temp + rename）。 */
function writeSenders(id, map) {
  const dir = imDir(id);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `im-senders.json.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(tmp, JSON.stringify(map), { mode: 0o600 });
    renameSyncWithRetry(tmp, sendersPath(id));
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best-effort */ }
    throw err;
  }
}

/**
 * upsert 一个发送者。merge 进现有映射，盖上 ts；超过 MAX_SENDERS 时丢弃最旧的。
 * name/avatar 任一为空都接受（部分平台只有名字没头像）。整段失败静默（持久化失败非致命）。
 * @returns {boolean} 是否实际写入
 */
export function upsertSender(id, senderId, profile = {}) {
  if (typeof senderId !== 'string' || !senderId) return false;
  const name = profile.name != null ? String(profile.name) : null;
  const avatar = profile.avatar != null ? String(profile.avatar) : null;
  try {
    const map = readSenders(id);
    const prev = map[senderId];
    // 无新信息（name/avatar 都没变且都已存在）→ 跳过写盘，省 IO。
    if (prev && prev.name === name && prev.avatar === avatar) return false;
    map[senderId] = { name, avatar, ts: tsNow() };

    const keys = Object.keys(map);
    if (keys.length > MAX_SENDERS) {
      keys
        .sort((a, b) => (map[a].ts || 0) - (map[b].ts || 0))
        .slice(0, keys.length - MAX_SENDERS)
        .forEach((k) => { delete map[k]; });
    }
    writeSenders(id, map);
    return true;
  } catch {
    return false; // 持久化失败不影响消息流
  }
}

// 单独抽出便于测试注入（避免直接用 Date.now 影响可测性，但保持简单）。
function tsNow() { return Date.now(); }
