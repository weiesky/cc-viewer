// Resume watchdog (L2): detect a `-c`/`-r` continuation that BYPASSED ccv (shell hook
// missing or claude invoked directly), so the panel can warn that the system-prompt
// injection was lost and the prompt-prefix cache will be fully rewritten.
//
// 裸续接检测(L2):发现「transcript 在写、但 ccv 没观测到对应 wire 流量」的会话,
// 经 SSE 提示用户(一次性,可关闭)。判定三重门,缺一不报:
//   1. 该会话 uuid 有 snapshot 记录(曾注入过 —— 从未注入的会话裸奔无损,不报);
//   2. 当前工作区仍配置着注入(injectionConfigured —— 用户已删掉注入配置则不报);
//   3. transcript 在快照写入之后又有可观增长,且 ccv 的 v2 会话目录里没有对应活动
//      (有 = 请求经过了 ccv,不是裸奔)。
// Failure philosophy: every error degrades to "no report" — never throws, never
// affects the request or spawn paths.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { reportSwallowed } from '@ccv/core/error-report';
import { LOG_DIR } from '../../findcc.js';
import { injectionConfigured } from './launch-config.js';
import { readSnapshotByKey, transcriptDirForCwd, projectKeyForCwd } from './system-prompt-snapshots.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// transcript 必须比快照记录新这么多才算「发生了新的续接」——文件系统 mtime 粒度 +
// 快照写入与 transcript flush 的既有竞态窗口内不误报。
const RESUME_MIN_GAP_MS = 5 * 1000;

/**
 * 检测当前工作区最近被续接、但未经 ccv 的会话。
 * Detect recently-resumed sessions of this workspace that bypassed ccv.
 *
 * @param {object} p
 * @param {string} p.cwd 当前工作区目录
 * @param {string} [p.logDir]
 * @param {(uuid: string) => boolean} p.hasWireActivity 该 uuid 是否已有 ccv wire 观测
 *   (由调用方提供 —— v2 sessions 目录存在该 uuid 的目录/journal;测试直接注入)
 * @param {number} [p.now]
 * @returns {{ uuid: string, transcriptPath: string }|null}
 */
export function detectBypassedResume({ cwd, logDir = LOG_DIR, hasWireActivity, now = Date.now() }) {
  try {
    if (!cwd || typeof hasWireActivity !== 'function') return null;
    const projectKey = projectKeyForCwd(cwd);
    if (!projectKey) return null;
    // Gate 2: injection still configured (user removed the config → nothing lost).
    if (!injectionConfigured(cwd, logDir)) return null;
    const tDir = transcriptDirForCwd(cwd);
    if (!tDir || !existsSync(tDir)) return null;
    let latest = null;
    for (const f of readdirSync(tDir)) {
      if (!f.endsWith('.jsonl')) continue;
      const uuid = f.slice(0, -'.jsonl'.length);
      if (!UUID_RE.test(uuid)) continue;
      // Gate 1: only sessions that ever had an injection (a snapshot record).
      const snap = readSnapshotByKey(projectKey, uuid, logDir);
      if (!snap) continue;
      const full = join(tDir, uuid + '.jsonl');
      let mtime;
      try { mtime = statSync(full).mtimeMs; } catch { continue; }
      // Gate 3a: transcript grew meaningfully AFTER the snapshot was recorded.
      if (mtime - snap.createdAt < RESUME_MIN_GAP_MS) continue;
      // Gate 3b: ccv observed no wire traffic for this uuid (a ccv-routed resume
      // would have produced a v2 session dir).
      if (hasWireActivity(uuid)) continue;
      if (!latest || mtime > latest.mtime) latest = { uuid, transcriptPath: full, mtime };
    }
    return latest ? { uuid: latest.uuid, transcriptPath: latest.transcriptPath } : null;
  } catch (err) {
    reportSwallowed('resume-watchdog.detect', err);
    return null;
  }
}

/** 当前工作区 v2 sessions 目录里是否存在该 uuid 的活动目录。 */
export function v2HasWireActivity(projectKey, uuid, logDir = LOG_DIR) {
  try {
    const sessDir = join(logDir, projectKey, 'sessions');
    if (!existsSync(sessDir)) return false;
    for (const d of readdirSync(sessDir)) {
      if (d.includes(uuid)) return true;
    }
    return false;
  } catch {
    return true; // 读失败按「有活动」处理 —— 宁可不报,不可误报
  }
}

/**
 * 启动周期检测(默认 60s,仅当前工作区;命中后按 uuid 去重,每个 uuid 只报一次)。
 * Start the periodic watcher. onHit({uuid, transcriptPath}) fires at most once per uuid.
 * @returns {{ stop: () => void }}
 */
export function startResumeWatchdog({ cwd, onHit, intervalMs = 60_000, logDir = LOG_DIR } = {}) {
  const reported = new Set();
  const projectKey = projectKeyForCwd(cwd);
  const tick = () => {
    try {
      const hit = detectBypassedResume({
        cwd, logDir,
        hasWireActivity: (uuid) => v2HasWireActivity(projectKey, uuid, logDir),
      });
      if (hit && !reported.has(hit.uuid)) {
        reported.add(hit.uuid);
        onHit?.(hit);
      }
    } catch (err) { reportSwallowed('resume-watchdog.tick', err); }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), _reported: reported };
}
