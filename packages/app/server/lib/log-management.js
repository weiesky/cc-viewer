import { existsSync, realpathSync, readdirSync, readFileSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join, sep, dirname, basename } from 'node:path';
import { reconstructEntries } from './delta-reconstructor.js';
import { sanitizePathComponent } from './v2/layout.js';
import { listV2Sessions } from './v2/adapter.js';
import { summarizeSessionPage } from './v2/session-list.js';
import { listSessionIds } from './v2/replay.js';

// wire-v2 S5 addressing (spec §12): 'v2:<project>/<session_id>' in every
// existing ?file= parameter slot. Components must survive the same whitelist
// the writer used to create them — anything else (.., separators, empty) is
// rejected before a single path join happens.
export const V2_REF_RE = /^v2:([^/]+)\/([^/]+)$/;

/** Parse a v2 addressing string → { project, sessionId } or null. */
export function parseV2Ref(file) {
  const m = typeof file === 'string' ? file.match(V2_REF_RE) : null;
  if (!m) return null;
  if (m[1] !== sanitizePathComponent(m[1]) || m[2] !== sanitizePathComponent(m[2])) return null;
  return { project: m[1], sessionId: m[2] };
}

export function validateLogPath(logDir, file) {
  // v2 branch: strip the prefix, then the realpath must land inside
  // LOG_DIR/<project>/sessions/<session_id>/ (spec §12). Returns the absolute
  // session DIRECTORY — log-stream's generators dispatch on it.
  if (typeof file === 'string' && file.startsWith('v2:')) {
    const ref = parseV2Ref(file);
    if (!ref) {
      const err = new Error('Invalid v2 log reference');
      err.code = 'ACCESS_DENIED';
      throw err;
    }
    const dir = join(logDir, ref.project, 'sessions', ref.sessionId);
    if (!existsSync(join(dir, 'journal.jsonl'))) {
      const err = new Error('File not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    const realPath = realpathSync(dir);
    const realLogDir = realpathSync(logDir);
    if (!realPath.startsWith(realLogDir + sep)) {
      const err = new Error('Access denied');
      err.code = 'ACCESS_DENIED';
      throw err;
    }
    return realPath;
  }
  const filePath = join(logDir, file);
  if (!existsSync(filePath)) {
    const err = new Error('File not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const realPath = realpathSync(filePath);
  const realLogDir = realpathSync(logDir);
  if (realPath !== realLogDir && !realPath.startsWith(realLogDir + sep)) {
    const err = new Error('Access denied');
    err.code = 'ACCESS_DENIED';
    throw err;
  }
  return realPath;
}

export function isLogFileName(name) {
  return name.endsWith('.jsonl');
}

// 解析日志文件名里的时间戳 `YYYYMMDD_HHMMSS`（带不带 `<pid>__` 前缀都适用）。
// 用于「按时间排序 / 判最新」——文件名整串排序会把 `<pid>__` 前缀（'1' < 'c'）的最新文件排到最底，
// 必须按时间戳排。无法解析时返回 ''（排到最后）。v2 convert 消费，防漂移。
export function parseLogTs(name) {
  const m = name.match(/_(\d{8}_\d{6})\.jsonl$/);
  return m ? m[1] : '';
}

// meta.startTs (ISO) → the v1 list's compact local-time stamp 'YYYYMMDD_HHMMSS'
// so formatTimestamp / the desc sort work on v2 items unchanged.
function compactLocalTs(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * wire-v2: the log list — one item per session dir,
 * addressed as `v2:<project>/<sid>` (spec §12), same grouped output shape so
 * the frontend log table renders it unchanged. Teammate sessions
 * (meta.leader present) are NOT listed: the adapter re-joins them into their
 * leader's stream, so a separate row would double-show that traffic.
 */
export function listV2Logs(logDir, currentProjectName) {
  const grouped = {};
  if (!existsSync(logDir)) return { ...grouped, _currentProject: currentProjectName || '' };
  for (const entry of readdirSync(logDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const project = entry.name;
    try {
      for (const s of listV2Sessions(join(logDir, project))) {
        if (s.leader) continue;
        if (s.size === 0) continue;
        if (s.discard) continue; // quota-probe orphans: never listed (2026-07-16)
        if (!grouped[project]) grouped[project] = [];
        grouped[project].push({
          file: `v2:${project}/${s.sid}`,
          kind: 'v2',
          timestamp: compactLocalTs(s.startTs),
          size: s.size,
          turns: s.turns,
          preview: s.preview || [],
        });
      }
      if (grouped[project]) {
        grouped[project].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp) || b.file.localeCompare(a.file));
      }
    } catch (err) {
      console.error(`[CC Viewer] listV2Logs: skipping unreadable project ${project}:`, err?.message || err);
      continue;
    }
  }
  return { ...grouped, _currentProject: currentProjectName || '' };
}

/**
 * Server-side paginated v2 log list for ONE project (2026-07-31). The modal
 * only ever renders the current project's sessions, so instead of summarizing
 * every session up front we page: enumerate session dirs (readdir — cheap),
 * read each meta.json only for the startTs ordering + leader filter, sort
 * newest-first, then run the EXPENSIVE summarize (journal fold + dir walk +
 * prompts head) on just the `pageSize` sessions of the requested page — those
 * go through the same row cache as listV2Sessions, so revisiting a page is
 * ~1-3ms. Trade-off documented inline: `size==0` and `discard` verdicts live
 * behind that summarize, so `total` is the pre-filter session count (the empty
 * / quota-probe sessions are excluded as their pages are computed). For
 * realistic data (empties + probes are a small minority) this keeps cold open
 * at ~1 page of work instead of N.
 *
 * @returns {{items: Array, total: number, page: number, pageSize: number}}
 *   items rows keep the exact listV2Logs shape {file, kind, timestamp, size, turns, preview}.
 */
export function listV2LogsPage(logDir, project, { page = 1, pageSize = 50 } = {}) {
  const out = { items: [], total: 0, page, pageSize, _currentProject: project || '' };
  if (!project) return out;
  const projectDir = join(logDir, project);
  if (!existsSync(projectDir)) return out;

  // Cheap pass: order candidates by startTs without paying per-session folds.
  const candidates = [];
  for (const dirName of listSessionIds(projectDir)) {
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(projectDir, 'sessions', dirName, 'meta.json'), 'utf-8')); } catch { /* journal is self-describing */ }
    if (meta && meta.leader) continue; // teammate — folded into its leader's row
    candidates.push({ dirName, startTs: (meta && meta.startTs) || '' });
  }
  // Newest first; dirName tiebreak matches listV2Logs' file tiebreak for stability.
  candidates.sort((a, b) => b.startTs.localeCompare(a.startTs) || b.dirName.localeCompare(a.dirName));
  out.total = candidates.length;

  const start = (page - 1) * pageSize;
  for (const c of candidates.slice(start, start + pageSize)) {
    let s = null;
    try { s = summarizeSessionPage(projectDir, c.dirName); } catch { continue; }
    if (!s) continue;
    if (s.leader) continue;
    if (s.size === 0) continue;
    if (s.discard) continue; // quota-probe orphans: never listed
    out.items.push({
      file: `v2:${project}/${s.sid}`,
      kind: 'v2',
      timestamp: compactLocalTs(s.startTs),
      size: s.size,
      turns: s.turns,
      preview: s.preview || [],
    });
  }
  return out;
}

/**
 * 1.7.0 v1 view: list legacy v1 `.jsonl` files, grouped per project — same row
 * shape as listV2Logs so LogTable renders both views unchanged. Every
 * timestamped `.jsonl` is listed, INCLUDING legacy `<pid>__`-prefixed ones
 * (the instance concept is gone; filenames are shown as-is). `_temp` and other
 * non-`_YYYYMMDD_HHMMSS.jsonl` names are excluded by the timestamp regex.
 * turns/preview come from a pre-1.7 `<project>.json` stats file when one still
 * carries per-file entries (v9 stats no longer track v1 files) — best-effort.
 */
export async function listLocalLogs(logDir, currentProjectName) {
  const grouped = {};
  if (!existsSync(logDir)) return { ...grouped, _currentProject: currentProjectName || '' };

  const entries = await readdir(logDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = entry.name;
    const projectDir = join(logDir, project);
    // A single unreadable project dir (permissions / concurrent removal /
    // EMFILE) only skips that project — it must not sink the whole list.
    try {
      const files = (await readdir(projectDir)).filter(isLogFileName);
      let statsFiles = null;
      try {
        const statsFile = join(projectDir, `${project}.json`);
        if (existsSync(statsFile)) {
          statsFiles = JSON.parse(await readFile(statsFile, 'utf-8')).files;
        }
      } catch { /* stats are cosmetic (turns/preview) — missing/corrupt is fine */ }
      for (const f of files) {
        const match = f.match(/^(.+?)_(\d{8}_\d{6})\.jsonl$/);
        if (!match) continue;
        const ts = match[2];
        const filePath = join(projectDir, f);
        let size;
        try { size = (await stat(filePath)).size; } catch { continue; }
        if (size === 0) continue;
        const stats = statsFiles?.[f] || null;
        const turns = stats?.summary?.sessionCount || 0;
        if (!grouped[project]) grouped[project] = [];
        grouped[project].push({ file: `${project}/${f}`, timestamp: ts, size, turns, preview: stats?.preview || [] });
      }
      if (grouped[project]) {
        grouped[project].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp) || b.file.localeCompare(a.file));
      }
    } catch (err) {
      console.error(`[CC Viewer] listLocalLogs: skipping unreadable project ${project}:`, err?.message || err);
      continue;
    }
  }
  return { ...grouped, _currentProject: currentProjectName || '' };
}

/**
 * v1 files that WOULD appear as rows in the v1 view (same filter as
 * listLocalLogs: timestamped `.jsonl`, non-empty). Gates the v1-view entry
 * link — kept beside the lister so badge count and rows can't drift.
 */
export function countListedV1Files(projectDir) {
  if (!existsSync(projectDir)) return 0;
  let n = 0;
  try {
    for (const f of readdirSync(projectDir)) {
      if (!/^(.+?)_(\d{8}_\d{6})\.jsonl$/.test(f)) continue;
      try { if (statSync(join(projectDir, f)).size > 0) n++; } catch { /* raced away */ }
    }
  } catch { return 0; }
  return n;
}

// v1 `.jsonl` ONLY — a `v2:` ref would validate but then mis-join below;
// v2 reads go through log-stream's session-dir dispatch, never this helper.
export async function readLocalLog(logDir, file) {
  const realPath = validateLogPath(logDir, file);
  if (file.startsWith('v2:')) {
    const err = new Error('readLocalLog does not support v2 refs');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  const filePath = realPath;
  const content = await readFile(filePath, 'utf-8');
  const parsed = content.split('\n---\n').filter(line => line.trim()).map(entry => {
    try { return JSON.parse(entry); } catch { return null; }
  }).filter(Boolean);
  const map = new Map();
  for (const entry of parsed) {
    const key = `${entry.timestamp}|${entry.url}`;
    map.set(key, entry);
  }
  return reconstructEntries(Array.from(map.values()));
}

/**
 * Soft-delete log units — 1.7.0: NOTHING is ever unlinked.
 * - `v2:<project>/<sid>` refs: the session dir is renamed into the project's
 *   `sessions-removed-<YYYYMMDD>/` recycle dir (same convention the converter
 *   uses for superseded output; move the dir back to restore).
 * - legacy `.jsonl` names: renamed into `removed-<YYYYMMDD>/` beside them —
 *   the UI no longer lists v1 files, but the API stays safe if called.
 * A session owned by a LIVE process is refused: primary check is the caller's
 * own writer (opts.liveSessionDir); cross-process, meta.pid liveness and a
 * fresh journal mtime both refuse.
 */
export function deleteLogFiles(logDir, files, opts = {}) {
  const liveSessionDir = opts.liveSessionDir || null;
  const now = opts.now || Date.now;
  const kill = opts.processKill || ((pid) => process.kill(pid, 0));
  const stamp = (() => {
    const d = new Date(now());
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  })();
  const results = [];
  const realLogDir = realpathSync(logDir);
  for (const file of files) {
    // ── v2 session refs ──
    const ref = parseV2Ref(file);
    if (ref) {
      try {
        const dir = join(logDir, ref.project, 'sessions', ref.sessionId);
        if (!existsSync(dir)) {
          results.push({ file, error: 'Not found' });
          continue;
        }
        const realPath = realpathSync(dir);
        if (!realPath.startsWith(realLogDir + sep)) {
          results.push({ file, error: 'Access denied' });
          continue;
        }
        if (liveSessionDir && realPath === realpathSync(liveSessionDir)) {
          results.push({ file, error: 'Session is live (owned by this process)' });
          continue;
        }
        let live = false;
        try {
          const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'));
          if (meta && typeof meta.pid === 'number' && meta.pid !== process.pid) {
            try { kill(meta.pid); live = true; } catch (err) {
              // EPERM means the pid EXISTS under another user — that IS live
              // (review P1: cross-user LOG_DIR sharing must not soft-delete a
              // session out from under its writer). Anything else = pid gone.
              if (err && err.code === 'EPERM') live = true;
            }
          }
        } catch { /* unreadable meta — fall through to the mtime guard */ }
        try {
          const jStat = statSync(join(dir, 'journal.jsonl'));
          if (now() - jStat.mtimeMs < LIVE_SESSION_MTIME_MS) live = true;
        } catch { /* no journal — nothing fresh to protect */ }
        if (live) {
          results.push({ file, error: 'Session looks live (recent activity or owner process running)' });
          continue;
        }
        const recycleDir = join(logDir, ref.project, `sessions-removed-${stamp}`);
        mkdirSync(recycleDir, { recursive: true });
        let target = join(recycleDir, ref.sessionId);
        if (existsSync(target)) target = `${target}-${now()}`;
        renameSync(realPath, target);
        results.push({ file, ok: true, movedTo: target });
      } catch (err) {
        results.push({ file, error: err.message });
      }
      continue;
    }
    // ── legacy v1 files ──
    if (!file || file.includes('..') || !isLogFileName(file)) {
      results.push({ file, error: 'Invalid file name' });
      continue;
    }
    const filePath = join(logDir, file);
    try {
      if (!existsSync(filePath)) {
        results.push({ file, error: 'Not found' });
        continue;
      }
      const realPath = realpathSync(filePath);
      if (realPath !== realLogDir && !realPath.startsWith(realLogDir + sep)) {
        results.push({ file, error: 'Access denied' });
        continue;
      }
      const recycleDir = join(dirname(realPath), `removed-${stamp}`);
      mkdirSync(recycleDir, { recursive: true });
      let target = join(recycleDir, basename(realPath));
      if (existsSync(target)) target = target.replace(/\.jsonl$/, `-${now()}.jsonl`);
      renameSync(realPath, target);
      results.push({ file, ok: true, movedTo: target });
    } catch (err) {
      results.push({ file, error: err.message });
    }
  }
  return results;
}

// A session whose journal moved within this window is treated as live and
// refused by deleteLogFiles (cross-process guard; the in-process guard is the
// caller's own writer state).
export const LIVE_SESSION_MTIME_MS = 5 * 60 * 1000;
