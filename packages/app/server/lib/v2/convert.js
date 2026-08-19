// Wire Format v2 — S8 offline v1→v2 converter (docs/refactor/WIRE_FORMAT_V2_PLAN.md §S8).
//
// Converts a project's historical v1 JSONL files into v2 session dirs:
//   enumerate *.jsonl ascending by filename timestamp (sessions span
//   rotation files, so order is mandatory) → per file: fresh incremental
//   reconstructor (rotation resets v1 delta state, so every file is
//   self-contained) feeding ONE shared V2Writer bound to the STAGING dir
//   (`sessions-migrating/`) → full golden verify (verifyV1File against the
//   staging root) → promote each staged session into `sessions/` via renameSync.
//
// STRICTLY ADDITIVE: v1 files are never written, moved, or deleted. The only
// writes are the staging tree, the promoted session dirs, and the state file.
//
// Resume: file-level checkpoints in `wire-v2-convert-state.json`. A restart
// re-runs the first incomplete file; sessions spanning the resume boundary are
// safe by construction (Journal seeds seq from disk, ConversationStore falls
// back to a full snapshot when the prefix test fails) at a small size cost.
//
// Session-level skip: a sid whose real `sessions/<sid>` dir already exists is
// dual-write output — authoritative, never re-ingested. Convert while
// dual-write is enabled (the UI says so): then any tail appended to the active
// v1 file after conversion belongs to dual-written sessions and skipping is
// exact. (With dual-write off and CC actively writing, the then-active
// session's post-conversion tail would stay unconverted — documented edge.)

import { readdirSync, existsSync, statSync, statfsSync, renameSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { iterateRawEntriesAsync } from '../log-stream.js';
import { createIncrementalReconstructor } from '../delta-reconstructor.js';
import { isLogFileName, parseLogTs } from '../log-management.js';
import { reportSwallowed } from '../error-report.js';
import { V2Writer } from './v2-writer.js';
import { verifyV1File } from './verify.js';
import { parseUserId } from './identity.js';
import { sanitizePathComponent, writeFileAtomicSync, sessionPaths } from './layout.js';
import { listSessionIds } from './replay.js';
import { resolveSessionDirName } from './session-select.js';

export const STAGING_DIR_NAME = 'sessions-migrating';
// Sessions that fail golden verify are moved here instead of being promoted into
// `sessions/`. The migration still completes — a single bad session is held for
// inspection, never a batch-wide abort (weak verify dependency, user 2026-07-15).
export const QUARANTINE_DIR_NAME = 'sessions-quarantine';
export const STATE_FILE_NAME = 'wire-v2-convert-state.json';
const STATE_VERSION = 1;
const STOP_CHECK_EVERY = 50; // entries between shouldStop() polls

/** Enumerate a project's v1 log files, ascending by filename timestamp.
 *  Excludes `_temp.jsonl` (resume scratch). */
export function listV1Files(projectDir) {
  if (!existsSync(projectDir)) return [];
  return readdirSync(projectDir)
    .filter(name => isLogFileName(name) && !name.endsWith('_temp.jsonl'))
    .sort((a, b) => parseLogTs(a).localeCompare(parseLogTs(b)) || a.localeCompare(b));
}

/** Projects under logDir that have at least one v1 log file (CLI --all). */
export function listConvertibleProjects(logDir) {
  if (!existsSync(logDir)) return [];
  const out = [];
  for (const entry of readdirSync(logDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      if (listV1Files(join(logDir, entry.name)).length > 0) out.push(entry.name);
    } catch { /* unreadable project dir — not convertible */ }
  }
  return out.sort();
}

export function readConvertState(projectDir) {
  try {
    const raw = readFileSync(join(projectDir, STATE_FILE_NAME), 'utf-8');
    const state = JSON.parse(raw);
    return state && state.version === STATE_VERSION ? state : null;
  } catch {
    return null;
  }
}

function writeConvertState(projectDir, state) {
  writeFileAtomicSync(join(projectDir, STATE_FILE_NAME), JSON.stringify(state, null, 2) + '\n');
}

/** done-line historical timestamp: request start + duration (falls back to start). */
function doneTsOf(entry) {
  const start = Date.parse(entry.timestamp);
  if (!Number.isFinite(start)) return entry.timestamp || undefined;
  const dur = typeof entry.duration === 'number' && entry.duration > 0 ? entry.duration : 0;
  return new Date(start + dur).toISOString();
}

/**
 * Convert one project's v1 logs to v2. Long-running; the caller (worker/CLI)
 * owns threading. Progress/state are observable via `onProgress` and the
 * state file. Throws on fatal errors after persisting status:'error'.
 *
 * @param {string} logDir
 * @param {string} project - directory name under logDir (no path separators)
 * @param {object} [opts]
 * @param {Function} [opts.onProgress] - ({phase, file, fileIndex, filesTotal, entries, sessionsConverted, sessionsSkipped})
 * @param {Function} [opts.shouldStop] - polled between entries; true → persist 'stopped' and return
 * @param {boolean}  [opts.verify=true] - golden verify before promote (non-fatal:
 *   failing sessions are quarantined, not aborted; the migration still completes)
 * @param {Function} [opts.verifyFn] - injected verifyV1File (tests)
 * @param {Function} [opts.statfs] - injected statfsSync (tests)
 * @param {number}   [opts.spaceFactor=2] - free-space assertion multiplier
 * @returns {Promise<object>} final state object
 */
export async function convertProject(logDir, project, opts = {}) {
  if (!project || project !== sanitizePathComponent(project)) {
    throw new Error(`invalid project name: ${JSON.stringify(project)}`);
  }
  const projectDir = join(logDir, project);
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : () => false;
  const doVerify = opts.verify !== false;
  const verifyFn = typeof opts.verifyFn === 'function' ? opts.verifyFn : verifyV1File;
  const statfs = opts.statfs || statfsSync;
  const spaceFactor = typeof opts.spaceFactor === 'number' ? opts.spaceFactor : 2;

  const files = listV1Files(projectDir);
  const prev = readConvertState(projectDir);
  const prevFiles = new Map((prev && Array.isArray(prev.files) ? prev.files : []).map(f => [f.name, f]));

  const state = {
    version: STATE_VERSION,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentFile: null,
    // A previously-done file is only trusted at the same size: a grown file
    // (the active log) is re-run in full — its new sessions get converted, its
    // already-promoted/dual-written sessions are skipped at session level.
    files: files.map(name => {
      const old = prevFiles.get(name);
      let size = 0;
      try { size = statSync(join(projectDir, name)).size; } catch { }
      const done = !!(old && old.done && old.size === size);
      return { name, size, done };
    }),
    sessionsConverted: prev && prev.status !== 'done' ? (prev.sessionsConverted || 0) : 0,
    sessionsSkipped: 0,
    sessionsQuarantined: 0,
    quarantined: [], // [{ sessionId (dir name), uuid, reasons: string[] }] — held-back sessions
    entries: 0,
    // Verify-phase progress, persisted so the frontend (which renders from the
    // state file only) can show "verifying (x/n) · m entries" instead of a
    // static label. verifyEntries accumulates ACROSS files (the moving signal
    // when one big file dominates); all three keep their final values on done.
    verifyIndex: 0,
    verifyTotal: 0,
    verifyEntries: 0,
    lastError: null,
  };

  // Free-space assertion: staging + promoted copies of everything still pending.
  const pendingBytes = state.files.filter(f => !f.done).reduce((a, f) => a + f.size, 0);
  try {
    const st = statfs(logDir);
    const free = Number(st.bavail) * Number(st.bsize);
    if (free < pendingBytes * spaceFactor) {
      state.status = 'error';
      state.lastError = `insufficient disk space: ${free} bytes free < ${spaceFactor}x pending ${pendingBytes} bytes`;
      state.finishedAt = new Date().toISOString();
      writeConvertState(projectDir, state);
      throw new Error(state.lastError);
    }
  } catch (err) {
    if (state.status === 'error') throw err;
    reportSwallowed('v2-convert.statfs', err); // statfs failure alone doesn't block conversion
  }
  writeConvertState(projectDir, state);

  const writer = new V2Writer({
    logDir,
    project,
    enabled: true,
    sessionsDirName: STAGING_DIR_NAME,
    metaExtra: { origin: 'convert', convertedAt: new Date().toISOString() },
    exactConvFps: true, // golden gate replays byte-identical wire — 80-char snips are too coarse
    statfs,
  });

  const skipSids = new Set();     // dual-write-authoritative sessions
  const seenSids = new Set();
  const sidSources = new Map();   // sid → Set<file name> (stamped into meta at promote)
  // Cold-start hold replay: sid-less entries at a file head return a null
  // handle (V2Writer parks them until the first sid appears); calling
  // ingestCompletion right away would look up _lateHandles BEFORE that flush
  // and silently drop the done line. Buffer those completions and replay them
  // after the first successful ingest (real-data finding 2026-07-14). Bounded
  // by the writer's own 64-entry hold queue.
  const pendingDone = [];

  try {
    for (let i = 0; i < state.files.length; i++) {
      const f = state.files[i];
      if (f.done) continue;
      if (shouldStop()) { // file-boundary stop: exact even when files are tiny
        await writer.flush();
        state.status = 'stopped';
        state.finishedAt = new Date().toISOString();
        writeConvertState(projectDir, state);
        return state;
      }
      state.currentFile = f.name;
      writeConvertState(projectDir, state);

      const filePath = join(projectDir, f.name);
      // Fresh per-file reconstructor: rotation resets the v1 delta state, so the
      // first mainAgent entry of every file is a full checkpoint (interceptor.js
      // checkAndRotateLogFile) — no cross-file reconstruction state is needed.
      const reconstructor = createIncrementalReconstructor();
      let sinceStopCheck = 0;

      for await (const raw of iterateRawEntriesAsync(filePath)) {
        if (++sinceStopCheck >= STOP_CHECK_EVERY) {
          sinceStopCheck = 0;
          if (shouldStop()) {
            await writer.flush(); // stopped-state on disk must not be ahead of the writes it describes
            state.status = 'stopped';
            state.finishedAt = new Date().toISOString();
            writeConvertState(projectDir, state);
            return state;
          }
        }
        let entry;
        try { entry = JSON.parse(raw); } catch { continue; } // torn tail frame
        if (entry.ccvRotationContext || entry.inProgress) continue;
        reconstructor.reconstruct(entry);
        if (entry._staleReorder || entry._reconstructBroken) continue; // poisoned twin; the good copy converts

        const parsed = parseUserId(entry.body && entry.body.metadata && entry.body.metadata.user_id);
        const sid = parsed ? parsed.sessionId : null;
        if (sid) {
          if (!seenSids.has(sid)) {
            seenSids.add(sid);
            // Task C: a live dual-written session's dir is `<ts>_<uuid>`, so
            // match by UUID (resolve-by-scan), not a bare `sessions/<uuid>` path.
            if (resolveSessionDirName(projectDir, sid)) {
              skipSids.add(sid);
              state.sessionsSkipped++;
            } else {
              state.sessionsConverted++;
            }
          }
          if (skipSids.has(sid)) continue;
          let src = sidSources.get(sid);
          if (!src) sidSources.set(sid, src = new Set());
          src.add(f.name);
        }
        // Metadata-less entries (heartbeat/countTokens) fall through to the
        // writer's _currentSid routing — same semantics as the live path.
        // Old entries (pre-requestId era) get a synthetic rid: the cold-start
        // hold queue recovers completions by rid, and a null rid would leave
        // held requests without their done line (real-data finding 2026-07-14).
        if (!entry.requestId) entry.requestId = `cvt_${i}_${state.entries}`;
        const handle = writer.ingestRequest(entry, entry.body && entry.body.messages);
        if (handle) {
          writer.ingestCompletion(handle, entry, { doneTs: doneTsOf(entry) });
          if (pendingDone.length > 0) {
            // The hold queue has flushed (a sid resolved) — late handles exist now.
            for (const p of pendingDone.splice(0)) writer.ingestCompletion(null, p.entry, p.opts);
          }
        } else {
          pendingDone.push({ entry, opts: { doneTs: doneTsOf(entry) } });
        }
        state.entries++;
      }

      await writer.flush(); // file checkpoint must not be ahead of its writes
      f.done = true;
      state.currentFile = null;
      writeConvertState(projectDir, state);
      onProgress({ phase: 'convert', file: f.name, fileIndex: i + 1, filesTotal: state.files.length, entries: state.entries, sessionsConverted: state.sessionsConverted, sessionsSkipped: state.sessionsSkipped });
    }
    await writer.flush();

    // ---- golden verify (staging) — weak, per-session dependency -------------
    // Verify no longer gates the whole batch: a diff/integrity violation flags
    // only the SPECIFIC staged session that produced it (verify attributes every
    // diff to its sessionId). Those sessions are quarantined below; everything
    // clean still promotes. One bad session never aborts the migration
    // (user 2026-07-15). `suspectSessions` is uncapped, so a >50-diff file still
    // yields the complete quarantine set.
    const quarantineSids = new Map(); // staged dir name → reasons[] (merged across files)
    if (doVerify && listSessionIds(projectDir, STAGING_DIR_NAME).length > 0) {
      state.status = 'verifying';
      state.verifyTotal = state.files.length;
      writeConvertState(projectDir, state);
      // Per-entry progress: verifyEntries accumulates across files; state-file
      // writes are time-throttled (≥1s) so a huge file can't turn the scan into
      // an fsync storm. The per-FILE advance below is written unconditionally.
      let entriesBase = 0;
      let lastEntriesWrite = 0;
      for (let i = 0; i < state.files.length; i++) {
        const f = state.files[i];
        let report = null;
        try {
          report = await verifyFn(join(projectDir, f.name), {
            sessionsDirName: STAGING_DIR_NAME,
            onProgress: ({ entriesScanned }) => {
              state.verifyEntries = entriesBase + (entriesScanned || 0);
              const now = Date.now();
              if (now - lastEntriesWrite >= 1000) {
                lastEntriesWrite = now;
                writeConvertState(projectDir, state);
              }
            },
          });
        } catch (err) {
          // Verify is a soft check — a crash in the verifier itself (e.g. an
          // unreadable staged session) must not sink the migration. Skip this
          // file's attribution and keep going; unverified sessions still promote.
          reportSwallowed('v2-convert.verify', err);
        }
        if (report) {
          for (const s of report.suspectSessions || []) {
            const prev = quarantineSids.get(s.sessionId) || [];
            quarantineSids.set(s.sessionId, [...prev, ...(s.reasons || [])].slice(0, 10));
          }
        }
        // Advance the persisted counter even when verifyFn threw — x must reach
        // n at the end of the loop, never skip numbers.
        entriesBase = state.verifyEntries;
        state.verifyIndex = i + 1;
        writeConvertState(projectDir, state);
        onProgress({ phase: 'verify', file: f.name, fileIndex: i + 1, filesTotal: state.files.length, entries: state.entries, sessionsConverted: state.sessionsConverted, sessionsSkipped: state.sessionsSkipped, quarantined: quarantineSids.size });
        if (shouldStop()) {
          state.status = 'stopped';
          state.finishedAt = new Date().toISOString();
          writeConvertState(projectDir, state);
          return state;
        }
      }
    }

    // ---- promote staging → sessions/ (same volume, per-session atomic) ------
    const stagingRoot = join(projectDir, STAGING_DIR_NAME);
    const quarantineRoot = join(projectDir, QUARANTINE_DIR_NAME);
    if (listSessionIds(projectDir, STAGING_DIR_NAME).length > 0) {
      mkdirSync(join(projectDir, 'sessions'), { recursive: true }); // fresh project: parent may not exist yet
    }
    for (const sid of listSessionIds(projectDir, STAGING_DIR_NAME)) {
      const staged = join(stagingRoot, sid);
      // Task C: `sid` is the staged dir name `<ts>_<uuid>`. A LIVE dual-write dir
      // for the same UUID may carry a DIFFERENT ts prefix, so detect the
      // collision by UUID (from the staged meta.sessionId), not the exact name.
      let stagedUuid = sid;
      try { stagedUuid = JSON.parse(readFileSync(join(staged, 'meta.json'), 'utf-8')).sessionId || sid; } catch { /* fall back to name */ }
      if (resolveSessionDirName(projectDir, stagedUuid)) {
        // A dual-write session appeared for this uuid mid-conversion — live data
        // wins (authoritative), so drop the staged copy even if it was flagged.
        rmSync(staged, { recursive: true, force: true });
        continue;
      }
      // Verify flagged this session: hold it in `sessions-quarantine/` for
      // inspection instead of promoting corrupt data into the live view. The
      // migration still completes; the user is told which sessions were held.
      if (quarantineSids.has(sid)) {
        mkdirSync(quarantineRoot, { recursive: true });
        const held = join(quarantineRoot, sid);
        rmSync(held, { recursive: true, force: true }); // idempotent across re-runs
        renameSync(staged, held);
        state.sessionsQuarantined++;
        state.quarantined.push({ sessionId: sid, uuid: stagedUuid, reasons: quarantineSids.get(sid) });
        continue;
      }
      const target = sessionPaths(logDir, project, sid).dir;
      // sidSources is keyed by the UUID (ingest time), not the staged dir name.
      const src = sidSources.get(stagedUuid);
      if (src && src.size > 0) {
        try {
          const metaPath = join(staged, 'meta.json');
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
          meta.sources = [...src].sort();
          writeFileAtomicSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
        } catch (err) {
          reportSwallowed('v2-convert.meta-sources', err); // sources are advisory
        }
      }
      renameSync(staged, target);
    }
    // Every staged session has been renamed away or dropped above — anything
    // left is junk (.DS_Store from Finder browsing, real-data 2026-07-14).
    // Guard on "no session dirs remain" before the recursive removal.
    try {
      if (existsSync(stagingRoot) && listSessionIds(projectDir, STAGING_DIR_NAME).length === 0) {
        rmSync(stagingRoot, { recursive: true, force: true });
      }
    } catch { /* leftover staging dir is cosmetic — never fail a completed migration on it */ }

    state.status = 'done';
    state.finishedAt = new Date().toISOString();
    writeConvertState(projectDir, state);
    onProgress({ phase: 'done', filesTotal: state.files.length, entries: state.entries, sessionsConverted: state.sessionsConverted, sessionsSkipped: state.sessionsSkipped, quarantined: state.sessionsQuarantined });
    return state;
  } catch (err) {
    if (state.status !== 'error') {
      state.status = 'error';
      state.lastError = String(err && err.message || err);
      state.finishedAt = new Date().toISOString();
      try { writeConvertState(projectDir, state); } catch { }
    }
    throw err;
  } finally {
    await writer.close();
  }
}
