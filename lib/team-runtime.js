/**
 * Team runtime check — fs-only detection of team lifecycle state.
 *
 * Given a team name and its log-inferred endTime, inspect ~/.claude/teams/{name}/
 * and classify the runtime state:
 *   - 'dead'          — 目录不存在（team 已被完全清理）
 *   - 'residue'       — 目录存在但 inbox 全部静默 > 10 分钟（残留，可清）
 *   - 'possiblyAlive' — 目录存在且 inbox 近期（< 10 分钟）有活动
 *   - 'reused'        — 目录 birthtime 新于 endTime + 5min，疑似被新 session 占用同名
 *   - 'error'         — fs 访问异常（权限/IO 错误），前端应保持 ⏱ 保守降级
 *
 * 这是 fs-only 策略（不调 ps），原因见 plan Step 0：
 *   teammate 不是独立 OS 进程，ps 扫不到。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';

const REUSE_WINDOW_MS = 5 * 60 * 1000;
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;

// 合法的 team name：单段、不含路径分隔符/空字节/点开头
// 仅允许 字母/数字/下划线/中划线/空格 等普通字符
// ⚠️ 白名单假设：调用方传入的 name 已经经过 JSON 解码（即标准 UTF-8 字符串），
//    不会再有 URL 编码、control char 变形等。如果上游变更传参形式，需要在此补防护。
//    当前已知的绕过面：unicode slash (∕ U+2215)、zero-width、mongrelized similar 字符——
//    path.join 不会把它们视为 separator，配合 lstatSync 的 ENOENT 也不会造成越权访问；
//    最坏情况是"找不到目录 → 返 state: 'dead'"，无安全影响。
function isValidTeamName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 255) return false;
  if (/[\\/\0]/.test(name)) return false;         // 路径分隔符、null 字节
  if (name === '.' || name === '..') return false; // 当前/上级目录
  if (name.includes('/..') || name.includes('../')) return false; // 跨段跳跃
  return true;
}

/**
 * @param {string} name — team_name
 * @param {number|null} endTimeMs — log 推断的 team endTime（毫秒）；null 时不做 reuse 检测
 * @param {string} [baseDir] — 可选，用于测试（默认 ~/.claude/teams）
 * @returns {Promise<{state: string, [key: string]: any}>}
 */
export async function checkTeamRuntime(name, endTimeMs, baseDir) {
  if (!isValidTeamName(name)) {
    return { state: 'error', error: 'invalid_name' };
  }
  const root = baseDir || join(homedir(), '.claude', 'teams');
  const teamDir = join(root, name);
  let stat;
  try {
    // lstatSync：不跟随 symlink，避免 symlink 将检测点引到目录外
    stat = lstatSync(teamDir);
    if (stat.isSymbolicLink()) {
      // 拒绝 symlink 形式的 team 目录（防止跨挂载点信息泄漏）
      return { state: 'error', error: 'symlink_rejected' };
    }
    if (!stat.isDirectory()) {
      return { state: 'error', error: 'not_a_directory' };
    }
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: 'dead' };
    return { state: 'error', error: err.message || String(err) };
  }
  // Reuse 检测：birthtime 优先，fallback 到 ctime
  const birthMs = (stat.birthtime && !isNaN(stat.birthtime.getTime()) && stat.birthtime.getTime() > 0)
    ? stat.birthtime.getTime()
    : stat.ctimeMs;
  // m5: 使用 `>=` 而非 `>`：即便 birthMs 恰好等于 endTimeMs + 窗口，也视作 reused；
  // 配合系统时钟小幅回滚的 fragility 需求，>= 更保守。
  if (endTimeMs && Number.isFinite(endTimeMs) && birthMs >= endTimeMs + REUSE_WINDOW_MS) {
    return { state: 'reused', birthMs, endTimeMs };
  }
  // Inbox 活跃度：lstatSync 不跟随 symlink；遇 symlink 跳过
  const inboxDir = join(teamDir, 'inboxes');
  let maxInboxMtime = 0;
  let inboxCount = 0;
  try {
    const entries = readdirSync(inboxDir);
    // 防 DoS：单 inbox 目录限 5000 个文件，超出即截断。
    // 注意：与 buildTeamStatusResponse 的 100-team 上限耦合——
    // 最坏情况总 stat 调用 ≈ 100 × 5000 = 500_000 次，仍需保持 <= 1 秒级响应；
    // 如将来放宽任一上限，需要同步评估另一方。
    const cap = Math.min(entries.length, 5000);
    for (let i = 0; i < cap; i++) {
      const f = entries[i];
      if (!f.endsWith('.json')) continue;
      try {
        const s = lstatSync(join(inboxDir, f));
        if (!s.isFile()) continue;
        if (s.mtimeMs > maxInboxMtime) maxInboxMtime = s.mtimeMs;
        inboxCount++;
      } catch { /* skip bad files */ }
    }
  } catch { /* inbox dir 不存在或不可读，当作无活动 */ }
  const now = Date.now();
  if (maxInboxMtime === 0) return { state: 'residue', inboxCount, lastInboxMtime: 0 };
  if (now - maxInboxMtime < ACTIVE_WINDOW_MS) {
    return { state: 'possiblyAlive', inboxCount, lastInboxMtime: maxInboxMtime };
  }
  return { state: 'residue', inboxCount, lastInboxMtime: maxInboxMtime };
}

/**
 * 批量检测多个 team，返回 name -> status 映射
 * @param {Array<{name: string, endTime?: number|string}>} teams
 * @param {string} [baseDir]
 * @returns {Promise<Record<string, object>>}
 */
export async function checkTeamsRuntime(teams, baseDir) {
  const out = {};
  if (!Array.isArray(teams)) return out;
  for (const t of teams) {
    if (!t || typeof t.name !== 'string') continue;
    // m4: endTime 解析显式前置——传了但解析失败（NaN）则当作未提供，而非沉默错误
    let endMs = null;
    if (t.endTime != null) {
      const raw = typeof t.endTime === 'number' ? t.endTime : Date.parse(t.endTime);
      endMs = Number.isFinite(raw) ? raw : null;
    }
    try {
      out[t.name] = await checkTeamRuntime(t.name, endMs, baseDir);
    } catch (err) {
      out[t.name] = { state: 'error', error: err.message || String(err) };
    }
  }
  return out;
}

/**
 * Endpoint-facing helper：校验+清洗 body.teams，再调度 checkTeamsRuntime。
 * 便于单测而无需起 http server。
 * @param {unknown} body — 已 JSON.parse 过的请求体
 * @param {string} [baseDir]
 */
export async function buildTeamStatusResponse(body, baseDir) {
  const teams = Array.isArray(body?.teams) ? body.teams : [];
  const valid = teams.filter(t => t && isValidTeamName(t.name));
  const safe = valid.slice(0, 100);
  const warnings = [];
  if (valid.length > safe.length) {
    warnings.push(`truncated_to_${safe.length}_teams`);
  }
  const statuses = await checkTeamsRuntime(safe, baseDir);
  return warnings.length > 0 ? { statuses, warnings } : { statuses };
}
