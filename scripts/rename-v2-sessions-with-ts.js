#!/usr/bin/env node
// Task C — one-off maintenance script: rename v2 session dirs from `<uuid>` to
// `<yyyymmddhhmmss>_<uuid>` (local creation time prefix), so sessions sort/read
// by time in the filesystem. Idempotent, dry-run by default, with a reverse
// manifest + an automatic hardlink backup on --apply.
//
//   node scripts/rename-v2-sessions-with-ts.js            # dry-run: print the plan
//   node scripts/rename-v2-sessions-with-ts.js --apply    # rename (manifest + backup)
//   node scripts/rename-v2-sessions-with-ts.js --apply --no-backup
//
// Rollback: every run writes LOG_DIR/rename-manifest-<ts>.json (old→new). The
// hardlink backup (sessions-backup-<ts>/) is a second safety net — rename never
// mutates file CONTENTS (v2 files are append-only / atomic tmp→rename), so
// hardlinks share inodes safely.
//
// LIVE sessions (a running ccv writing them) are SKIPPED, never renamed out from
// under the writer — quit ccv and re-run to convert the rest.

import { readdirSync, statSync, existsSync, renameSync, realpathSync, writeFileSync, openSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LOG_DIR } from '../packages/app/findcc.js';
import { compactLocalTs14 } from '../packages/app/server/lib/v2/layout.js';
import { LIVE_SESSION_MTIME_MS } from '../packages/app/server/lib/log-management.js';

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

/** Already `<14digits>_...`? A canonical UUID never matches (its `-` sits at
 *  index 8 < 14, and it has no `_`), so this only skips true migrated dirs. */
export function isAlreadyMigrated(name) {
  return /^\d{14}_/.test(name);
}

/** Best creation-time source for a session dir, as an ISO string, or null.
 *  meta.startTs → first journal `ph:'req'` ts → dir mtime (the guaranteed
 *  floor; only a statSync throw yields null). */
export function resolveStartTs(sessionDir) {
  try {
    const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'));
    if (meta && typeof meta.startTs === 'string' && meta.startTs) return meta.startTs;
  } catch { /* fall through */ }
  try {
    const head = readFileSync(join(sessionDir, 'journal.jsonl'), 'utf-8');
    for (const line of head.split('\n')) {
      const t = line.trim();
      if (!t.includes('"ph":"req"')) continue;
      try { const o = JSON.parse(t); if (o.ph === 'req' && o.ts) return o.ts; } catch { /* torn */ }
    }
  } catch { /* fall through */ }
  try { return new Date(statSync(sessionDir).mtimeMs).toISOString(); } catch { return null; }
}

/** Is a session likely being written by a live ccv? (meta.pid alive — EPERM =
 *  cross-user live — OR journal mtime within LIVE_SESSION_MTIME_MS.) Mirrors the
 *  deleteLogFiles heuristic (log-management.js) — that copy is inline, not
 *  exported, so re-implemented here against the same shared threshold. */
export function isLiveSession(sessionDir, opts = {}) {
  const now = opts.now || (() => Date.now());
  const processKill = opts.processKill || ((pid) => process.kill(pid, 0));
  try {
    const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf-8'));
    // Unlike deleteLogFiles (which excludes its OWN pid), this script is never a
    // session owner — so ANY alive meta.pid means a live ccv is writing it.
    if (meta && typeof meta.pid === 'number') {
      try { processKill(meta.pid); return true; }
      catch (err) { if (err && err.code === 'EPERM') return true; }
    }
  } catch { /* unreadable meta — fall through to mtime */ }
  try {
    if (now() - statSync(join(sessionDir, 'journal.jsonl')).mtimeMs < LIVE_SESSION_MTIME_MS) return true;
  } catch { /* no journal — nothing fresh */ }
  return false;
}

/** Build the rename plan across every project under logDir. Pure (no mutation).
 *  Returns { renames:[{project,from,to,fromDir,toDir}], skipped:[{project,name,reason}] }. */
export function planRenames(logDir, opts = {}) {
  const renames = [];
  const skipped = [];
  let projects = [];
  try { projects = readdirSync(logDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return { renames, skipped }; }
  for (const project of projects) {
    const sessionsRoot = join(logDir, project, 'sessions');
    if (!existsSync(sessionsRoot)) continue; // not a project dir
    let names = [];
    try { names = readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
    catch { continue; }
    for (const name of names) {
      const fromDir = join(sessionsRoot, name);
      if (isAlreadyMigrated(name)) { skipped.push({ project, name, reason: 'already-migrated' }); continue; }
      if (isLiveSession(fromDir, opts)) { skipped.push({ project, name, reason: 'live' }); continue; }
      const iso = resolveStartTs(fromDir);
      const ts = iso ? compactLocalTs14(iso) : '';
      if (!ts) { skipped.push({ project, name, reason: 'no-timestamp' }); continue; }
      const to = `${ts}_${name}`;
      const toDir = join(sessionsRoot, to);
      if (existsSync(toDir)) { skipped.push({ project, name, reason: 'target-exists' }); continue; }
      renames.push({ project, from: name, to, fromDir, toDir });
    }
  }
  return { renames, skipped };
}

// ── side-effecting run ──────────────────────────────────────────────────────

function log(...a) { console.log(...a); }

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const noBackup = argv.includes('--no-backup');
  const realLog = realpathSync(LOG_DIR);

  log(`[rename-v2] LOG_DIR = ${LOG_DIR}`);
  log(`[rename-v2] mode = ${apply ? 'APPLY' : 'DRY-RUN (pass --apply to rename)'}`);

  const { renames, skipped } = planRenames(LOG_DIR);
  const bySkip = skipped.reduce((m, s) => ((m[s.reason] = (m[s.reason] || 0) + 1), m), {});

  log(`\n[rename-v2] ${renames.length} to rename, ${skipped.length} skipped ` +
    `(${Object.entries(bySkip).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'})`);
  for (const r of renames) log(`  ${r.project}/sessions/${r.from}  →  ${r.to}`);
  const live = skipped.filter((s) => s.reason === 'live');
  if (live.length) log(`\n[rename-v2] ⚠ ${live.length} LIVE session(s) skipped — quit ccv and re-run to convert them.`);

  if (!apply) { log('\n[rename-v2] dry-run only — nothing changed.'); return 0; }
  if (renames.length === 0) { log('\n[rename-v2] nothing to do.'); return 0; }

  // 1) reverse manifest — write + fsync BEFORE the first rename (a crash between
  //    a rename and a late flush would otherwise lose that entry).
  const stamp = compactLocalTs14(new Date().toISOString());
  const manifestPath = join(LOG_DIR, `rename-manifest-${stamp}.json`);
  const manifest = { createdAt: new Date().toISOString(), logDir: LOG_DIR, renames: renames.map((r) => ({ project: r.project, from: r.from, to: r.to })) };
  const fd = openSync(manifestPath, 'w');
  try { writeFileSync(fd, JSON.stringify(manifest, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
  log(`\n[rename-v2] manifest written: ${manifestPath}`);

  // 2) automatic hardlink backup per project (default on; --no-backup opts out).
  if (!noBackup) {
    for (const project of [...new Set(renames.map((r) => r.project))]) {
      const src = join(LOG_DIR, project, 'sessions');
      const dst = join(LOG_DIR, project, `sessions-backup-${stamp}`);
      if (existsSync(dst)) continue;
      try { execFileSync('cp', ['-al', src, dst]); log(`[rename-v2] backup: ${dst}`); }
      catch (err) { console.error(`[rename-v2] backup FAILED for ${project} — aborting before any rename:`, err.message); return 1; }
    }
  }

  // 3) rename (atomic per-dir, same fs), with a realpath containment guard.
  let renamed = 0, failed = 0;
  for (const r of renames) {
    try {
      if (!realpathSync(r.fromDir).startsWith(realLog)) { console.error(`[rename-v2] SKIP escaping path: ${r.fromDir}`); failed++; continue; }
      renameSync(r.fromDir, r.toDir);
      renamed++;
    } catch (err) { console.error(`[rename-v2] rename FAILED ${r.from} → ${r.to}:`, err.message); failed++; }
  }

  log(`\n[rename-v2] done: ${renamed} renamed, ${failed} failed, ${skipped.length} skipped.`);
  log(`[rename-v2] rollback with the manifest: ${manifestPath}`);
  return failed > 0 ? 1 : 0;
}

// Run only when invoked directly (not when imported by the test).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
