// Wire Format v2 — write-path orchestrator (docs/refactor/WIRE_FORMAT_V2.md §13).
//
// The single entry point the interceptor's writeEntry seam will call in S3.
// Hard contract: a v2 failure must NEVER disturb the v1 path — every public
// method is fully caught and routed through reportSwallowed (CLAUDE.md rule);
// the caller does not need its own try/catch.
//
// Write-order protocol per request (spec §1.3):
//   blob (sync, fsync barrier) → conversation event lines → journal req line.
// The HARD guarantee is the blob half: a journal line can never reference a
// missing blob (blobs are durable before the line is even enqueued). The conv
// half is best-effort batch grouping — AsyncWriteQueue._drain groups by path at
// first-enqueue position, so when several requests flush in one batch (e.g. the
// cold-start hold queue), a later request's journal line can land before its
// own conv line. The read side tolerates a missing conv tail by design
// (spec §14, pendingTail-style retry), so this is defense-in-depth, not a
// correctness dependency.

import { statfsSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename, sep } from 'node:path';
import { AsyncWriteQueue } from '../async-write-queue.js';
import { reportSwallowed } from '@ccv/core/error-report';
import { ensureSessionDirSync, compactLocalTs14, sanitizePathComponent, normalizeSessionCwd } from './layout.js';
import { resolveSessionDirName, latestMainSession } from './session-select.js';
import { acquireSessionClaim, releaseSessionClaim, isForeignLiveOwned } from './session-owner.js';
import { BlobStore } from './blob-store.js';
import { Journal } from './journal.js';
import { ConversationStore } from './conversation-store.js';
import { parseUserId, classifyKind, ConvResolver } from './identity.js';
import { parseAgentId, findHeader } from './agent-id.js';
import { extractUserTexts, flattenPromptText, isSuggestionMode, readPromptsHead } from '../user-prompt-extract.js';
import { consumePendingForWireByKey, writeSnapshotByKey, systemTextOfBody } from '../system-prompt-snapshots.js';

// Below this many free bytes on the log volume, v2 skips writing and reports
// once — logging must not be the thing that fills the disk (plan risk #9).
const MIN_FREE_BYTES = 1024 * 1024 * 1024; // 1GB

// Hard ceiling on distinct prompts recorded per session in prompts.jsonl —
// keeps both the in-memory dedup set and the side file bounded for extreme
// thousand-turn sessions (the read side additionally caps at a byte budget).
const PROMPTS_MAX_PER_SESSION = 2000;

export class V2Writer {
  /**
   * @param {object} opts
   * @param {string} opts.logDir       - LOG_DIR root
   * @param {string|Function} opts.project - project directory name, or a getter —
   *   workspace mode rebinds the interceptor's _projectName at runtime; a falsy
   *   resolved project makes ingest a no-op (mirrors v1's empty-LOG_FILE no-op)
   * @param {object|null} [opts.leader]     - teammate processes: {agentName, teamName, parentSessionId}
   * @param {boolean} [opts.enabled]   - always on since 1.7.0; `enabled: false`
   *   is honored only as a test seam (fixtures asserting "nothing written")
   * @param {AsyncWriteQueue} [opts.queue]  - injected queue (tests); defaults to a
   *   dedicated instance so v2 volume never head-of-line-blocks v1's queue.
   * @param {number} [opts.minFreeBytes]    - disk guard threshold (tests)
   * @param {Function} [opts.statfs]        - injected statfsSync (tests)
   */
  constructor(opts = {}) {
    this._logDir = opts.logDir || '';
    this._projectFn = typeof opts.project === 'function'
      ? opts.project
      : () => (opts.project || '');
    this._leader = opts.leader || null;
    // 1.7.0: always on in production; opts.enabled === false is honored only
    // as a test seam (fixtures that must assert "nothing written").
    this._enabled = opts.enabled === false ? false : true;
    this._queue = opts.queue || new AsyncWriteQueue(''); // paths are always explicit
    this._minFreeBytes = typeof opts.minFreeBytes === 'number' ? opts.minFreeBytes : MIN_FREE_BYTES;
    this._statfs = opts.statfs || statfsSync;
    // Offline-converter seams (S8): write under a sibling staging dir name,
    // stamp extra meta fields (e.g. {origin:'convert'}), and use exact
    // conversation judgement fingerprints (byte-grade golden gate). Live
    // writers pass none of these.
    this._sessionsDirName = opts.sessionsDirName || 'sessions';
    this._metaExtra = opts.metaExtra || null;
    this._exactConvFps = !!opts.exactConvFps;
    // S6b live feed: called with the session dir after every ingest so the
    // in-process live cursor can read the fresh appends with zero fs-watch
    // latency. Purely a nudge — the feed's data source stays the files.
    this._onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : null;
    // Fired once per request that resolves a (sid, project) pair — lets the
    // server feed a PTY's sessionId index (pty-manager.setPtySessionId) so chat
    // sends can be routed to the PTY owning that conversation (2026-10-05).
    this._onSessionResolved = typeof opts.onSessionResolved === 'function' ? opts.onSessionResolved : null;
    this._sessions = new Map(); // sessionId → {paths, blobs, journal, convs, resolver}
    // Multi-window isolation (2026-07-17): session dirs this process has
    // claimed via owner.lock. Released synchronously in resetSessions()/close()
    // — a crash skips release harmlessly (claim validity is pid liveness).
    this._claimedDirs = new Set();
    this._currentSid = null;    // last successfully resolved session (fallback routing §8.3)
    this._pendingNoSid = [];    // requests seen before any sid (cold-start heartbeats).
    // Contract with the caller: originalMessages held here must be a reference
    // the caller never MUTATES (the interceptor's original array is only ever
    // REASSIGNED away from body.messages, never mutated in place — safe).
    this._lateHandles = new Map(); // rid → handle for held requests whose completion arrives after the flush
    this._diskGuardTripped = false;
    this._continuedSeen = false;   // P2: wire-level `claude -c` continuation marker
    // `-c` folder adoption (Claude 2.1.210 hands a fresh wire session_id on every
    // continue, so a new folder would otherwise be minted each time). Set from
    // the launch flags via setContinuationMode(); adoption fires at most once per
    // process (the first main request that proves a continuation on the wire).
    this._continuationLaunch = false;
    this._forkSession = false;
    this._resumeSession = false;
    // Per-project `-c` adoption latch (was a single boolean): each project may
    // adopt at most once. Keyed by sanitized project so a scoped resetSessions(t)
    // clears only project t's latch, not a background project's.
    this._adopted = new Set();
    // In-terminal /resume switch (SessionStart hook, source:'resume'): the
    // next MAIN request must be re-routed to the resumed conversation's dir.
    // Per-project (was a single value): keyed by sanitized project, so a scoped
    // reset clears only the switched-away project's pending switch. Value:
    // {transcriptUuid, hookSid}; consumed one-shot on the next main request.
    this._pendingResumeSwitch = new Map();
  }

  /** P2: true once any session's FIRST main wire already carried assistant
   *  turns — the wire-level signature of a continued (-c/-r) conversation. */
  sawContinuedSession() { return this._continuedSeen; }

  /** Launch flags for `-c` folder adoption (set by the interceptor before any
   *  request flows). `continued` = a pre-request continuation signal
   *  (CCV_CLAUDE_CONTINUE / workspace launcher); `fork` = `--fork-session`
   *  (user wants a NEW session — never adopt); `resume` = explicit `-r`/
   *  `--resume` (user-chosen target session — adoption would misroute it to
   *  the LATEST main session, so it keeps its own folder). */
  setContinuationMode({ continued, fork, resume } = {}) {
    this._continuationLaunch = !!continued;
    this._forkSession = !!fork;
    this._resumeSession = !!resume;
  }

  // 1.7.0: v2 is the only format — the writer is always on. The getter is kept
  // because read-side helpers key off it; the sole write inhibitor left is the
  // in-band disk guard.
  get enabled() { return this._enabled; }

  /** Late wiring seam: the live feed is constructed by server.js AFTER this
   *  writer exists (module init order), so the nudge callback arrives here. */
  setOnActivity(fn) { this._onActivity = typeof fn === 'function' ? fn : null; }
  setOnSessionResolved(fn) { this._onSessionResolved = typeof fn === 'function' ? fn : null; }

  /**
   * If this request should adopt the previous main session's folder — a `-c`
   * continuation launch that Claude handed a FRESH wire session_id — return
   * `{ dirName, identityUUID }` of the folder to reuse, else null. Decided at
   * most once per process, before the folder is created. All conditions must
   * hold: continuation launch via `-c`/`--continue` ONLY (not `--fork-session`,
   * not an explicit `-r`/`--resume` — both keep their own folder); main
   * (non-leader) writer; not already adopted; the wire sid has no folder of its
   * own (never hijack a same-UUID restart); the wire actually replays assistant
   * history (excludes the pty-manager `-c`-stripped retry and stray
   * history-less requests); and a previous main session exists.
   * @returns {{dirName:string, identityUUID:string}|null}
   */
  /** Sanitized per-project key for the per-project latches (_adopted /
   *  _pendingResumeSwitch). Single place so the latch keying can't drift. */
  _projKey(project) {
    return sanitizePathComponent(project || '');
  }

  _resolveAdoption(sid, project, msgs, entry) {
    if (this._adopted.has(this._projKey(project)) || this._leader) return null;
    if (!this._continuationLaunch || this._forkSession || this._resumeSession) return null;
    if (this._sessions.has(sid)) return null;
    const m = Array.isArray(msgs) ? msgs
      : (entry && entry.body && Array.isArray(entry.body.messages) ? entry.body.messages : null);
    if (!m || m.length <= 1 || !m.some((x) => x && x.role === 'assistant')) return null;
    const projectDir = join(this._logDir, sanitizePathComponent(project));
    if (resolveSessionDirName(projectDir, sid, this._sessionsDirName)) return null; // same-UUID restart
    // Multi-window isolation: never adopt a dir another LIVE window is writing
    // (that is the two-writers-one-journal corruption), and CLAIM the picked
    // dir atomically BEFORE committing — two simultaneous `-c` launches racing
    // onto the same dead-owned dir get exactly one adopter via the owner.lock
    // 'wx' arbiter; the loser falls through to a fresh dir, which is Claude
    // Code's own continue/fork semantics (fresh wire sid per continue).
    // skipForeignLive is deliberately UNCONDITIONAL while the claim below is
    // _claimsEnabled()-gated: a non-claiming writer must still never adopt a
    // live window's dir — it just doesn't stamp ownership of its own.
    const prev = latestMainSession(projectDir, { skipForeignLive: true });
    if (!prev || !prev.sessionId) return null;
    if (this._claimsEnabled()) {
      if (!acquireSessionClaim(prev.dir).ok) return null;
      // Record immediately (not only in _session): a throw between here and
      // _session must not leak an untracked lock file until process exit.
      this._claimedDirs.add(prev.dir);
    }
    return { dirName: basename(prev.dir), identityUUID: prev.sessionId };
  }

  /** In-terminal /resume signal (interceptor.markSessionStart → here): arm a
   *  one-shot routing switch. `transcriptUuid` is the resumed conversation's
   *  stable identity (transcript basename); `hookSid` is the fresh session
   *  uuid the hook minted — used as the NEW dir identity when the resumed
   *  conversation was never recorded by ccv (it must not be the old wire sid:
   *  `<ts>_<oldSid>` would be re-resolved back to the OLD dir by
   *  resolveSessionDirName). Last-wins across repeated /resume picks. */
  beginResumeSwitch({ transcriptUuid, hookSid, project } = {}) {
    try {
      if (!transcriptUuid || typeof transcriptUuid !== 'string') return;
      // Keyed by the project the resumed conversation belongs to (defaults to the
      // currently-bound project — markSessionStart's guard already ensures the
      // hook's cwd matches it). Per-project so a scoped reset clears only that one.
      const key = sanitizePathComponent(project || this._projectFn() || '');
      this._pendingResumeSwitch.set(key, {
        transcriptUuid,
        hookSid: (typeof hookSid === 'string' && hookSid) ? hookSid : null,
      });
    } catch (err) {
      reportSwallowed('v2-write.resume-switch', err);
    }
  }

  /**
   * Consume the pending /resume switch for the arriving MAIN request: pick
   * the target dir, take its claim, drop the old same-sid binding, and return
   * an adoptTarget for `_session()` (the same channel `-c` adoption uses).
   * Target precedence: the recorded dir of the resumed conversation
   * (resolveSessionDirName by transcript uuid — the log re-joins its original
   * folder, identity preserved) unless another LIVE window holds its claim
   * (acquire fails → fork semantics, mirror of `_resolveAdoption`); else a
   * fresh `<ts>_<hookSid>` dir. Works for BOTH wire behaviors: same-sid
   * (re-bind: delete the old map entry so `_session` re-creates it against
   * the new dir) and fresh-sid (plain targeted adoption).
   * @param {string|null} prevSid - the writer's active sid BEFORE this
   *   request: on a fresh-sid resume the departing conversation is keyed by
   *   it, not by the incoming `sid`
   * @returns {{dirName:string, identityUUID:string}}
   */
  _resolveResumeSwitch(sid, project, prevSid = null) {
    const key = this._projKey(project);
    const sw = this._pendingResumeSwitch.get(key);
    this._pendingResumeSwitch.delete(key); // one-shot
    const projectDir = join(this._logDir, sanitizePathComponent(project));
    let dirName = resolveSessionDirName(projectDir, sw.transcriptUuid, this._sessionsDirName);
    let identity = sw.transcriptUuid;
    if (dirName) {
      const targetDir = join(projectDir, this._sessionsDirName, dirName);
      // Liveness guard is UNCONDITIONAL (mirror _resolveAdoption's
      // unconditional skipForeignLive): even a non-claiming writer must never
      // re-bind into a dir another live window is writing. The acquire below
      // additionally arbitrates for claiming writers.
      if (isForeignLiveOwned(targetDir)
        || (this._claimsEnabled() && !acquireSessionClaim(targetDir).ok)) {
        dirName = null; // live foreign owner — never share its journal
      }
    }
    if (dirName) {
      // Adopt the recorded dir under ITS identity (meta.sessionId,
      // first-write-wins) so `_seqEpoch` continues that conversation.
      try {
        const m = JSON.parse(readFileSync(join(projectDir, this._sessionsDirName, dirName, 'meta.json'), 'utf-8'));
        if (m && m.sessionId) identity = m.sessionId;
      } catch { /* torn meta — transcriptUuid is the correct fallback identity */ }
    } else {
      identity = sw.hookSid || `resume-${process.pid}-${Date.now()}`;
      dirName = `${compactLocalTs14(new Date().toISOString())}_${identity}`;
    }
    // Drop the departing conversation's binding and release its claim — this
    // process has switched away and will not write it again, so other windows
    // may now resume/adopt it. Same-sid wire (the observed behavior): the old
    // binding is keyed by the INCOMING sid; fresh-sid wire: it is keyed by
    // prevSid (review P2 — without this branch the old dir's claim + map
    // entry leaked until process exit).
    const oldKey = this._sessions.has(sid) ? sid
      : (prevSid && prevSid !== sid && this._sessions.has(prevSid)) ? prevSid : null;
    if (oldKey !== null) {
      const old = this._sessions.get(oldKey);
      this._sessions.delete(oldKey);
      releaseSessionClaim(old.paths.dir);
      this._claimedDirs.delete(old.paths.dir);
    }
    return { dirName, identityUUID: identity };
  }

  /** Multi-window isolation: does this writer claim its session dirs? Only a
   *  MAIN interactive leader does — teammate writers (leader set) and IM
   *  workers (CCV_IM_PLATFORM) stay unclaimed so any project viewer keeps
   *  following them (cross-process producers by design), and the offline
   *  converter (staging sessionsDirName) must never stamp live-ownership onto
   *  migrated history. */
  _claimsEnabled() {
    return this._enabled && !this._leader
      && !process.env.CCV_IM_PLATFORM
      && this._sessionsDirName === 'sessions';
  }

  /** Release every dir this process claimed (identity-checked unlinks).
   *  Synchronous on purpose — close() runs it ahead of the bounded async queue
   *  drain so a hung drain can't strand live-looking locks on a clean exit. */
  _releaseAllClaims() {
    for (const dir of this._claimedDirs) releaseSessionClaim(dir);
    this._claimedDirs.clear();
  }

  _session(sessionId, userIdRaw, encoding, project, startTsIso, adoptTarget = null, instanceKey = null, cwd = null) {
    let s = this._sessions.get(sessionId);
    // Cross-project guard: the map is keyed by bare sid, so a sid reused across two
    // projects (a cross-project /resume takeover running alongside its old project)
    // would otherwise reuse the OTHER project's session object and cross-write into
    // the wrong dir. On a project mismatch, drop the stale binding and rebuild for
    // THIS project. The hot path (same project) stays an O(1) map hit.
    if (s && s.project && project && sanitizePathComponent(s.project) !== sanitizePathComponent(project)) {
      this._sessions.delete(sessionId);
      s = null;
    }
    if (s) return s; // hot path: map hit is O(1), the scan below only runs on miss

    // Task C: the dir name carries a creation-time prefix `<ts>_<uuid>`. On a
    // map MISS (cold start / restart / `-c` re-attach) the same session must
    // REUSE its existing dir, not mint a `<now>_<uuid>` sibling (which would
    // split the conversation + reset seq + flip _seqEpoch). Scan for an existing
    // dir by UUID; only when none exists create a new ts-prefixed one. The
    // identity written into meta.sessionId / journal sentinel stays the UUID.
    const startTs = startTsIso || new Date().toISOString();
    const meta = {
      pid: process.pid,
      startTs,
      ...(userIdRaw && { userIdRaw }),
      ...(encoding && { userIdEncoding: encoding }),
      ...(this._leader && { leader: this._leader }),
      // Multi-instance (2026-10-06): stamp the owning PTY instanceKey on the session dir's
      // meta.json (first-write-wins), so two concurrent same-cwd claude instances — which
      // share one basename project dir but mint DIFFERENT wire session UUIDs (different
      // session dirs) — can each be told apart at the directory level by readers/feed/cold
      // load. Absent for legacy/external producers (no self-report) → instance-agnostic.
      ...(instanceKey && { instance: instanceKey }),
      // Same-name session isolation (2026-10-07): stamp the session's owning full cwd so
      // the read-side fallback can tighten by path, telling two cross-dir same-basename
      // projects apart (basename routing cannot). First-write-wins, so an adopted/resumed
      // dir keeps its ORIGINAL author's cwd — never relabeled by the adopting entry.
      // Normalized lexically (no realpath) to match the read side's targetCwd.
      ...(cwd && { cwd: normalizeSessionCwd(cwd) }),
      ...(this._metaExtra || {}),
    };
    const projectDir = join(this._logDir, sanitizePathComponent(project));
    // Identity (meta.sessionId + journal sentinel) — normally the wire UUID; on
    // `-c` adoption it stays the ADOPTED folder's UUID so the frontend session
    // identity (`_seqEpoch = v2:<meta.sessionId>`) and all reuse machinery see
    // one continuous session. meta.json/sentinel are first-write-wins, so writing
    // into the existing adopted folder never overwrites its identity.
    let identityId = sessionId;
    let dirName;
    if (adoptTarget) {
      dirName = adoptTarget.dirName;
      identityId = adoptTarget.identityUUID;
    } else {
      dirName = resolveSessionDirName(projectDir, sessionId, this._sessionsDirName);
      if (!dirName) {
        const ts = compactLocalTs14(startTs) || compactLocalTs14(new Date().toISOString());
        dirName = `${ts}_${sessionId}`;
      }
    }
    const paths = ensureSessionDirSync(this._logDir, project, identityId, meta, this._sessionsDirName, dirName);
    // Multi-window isolation: stamp this process's live claim on the dir. A
    // fresh wire-UUID dir has no contention (always succeeds); the adoption
    // path already holds the claim (idempotent re-entry). Failure (a live
    // foreign holder appeared) degrades to today's unclaimed behavior — the
    // write itself must never be blocked by the claim.
    if (this._claimsEnabled() && acquireSessionClaim(paths.dir).ok) {
      this._claimedDirs.add(paths.dir);
    }
    s = {
      paths,
      blobs: new BlobStore(paths),
      journal: new Journal(paths, this._queue),
      convs: new ConversationStore(paths, this._queue, { exactFps: this._exactConvFps }),
      resolver: new ConvResolver(),
      // The project this session's dir lives under — needed by resetSessions(target)
      // to clear ONLY one project's sessions on a workspace switch, leaving a
      // concurrently-running background project's bindings (a cross-project /resume
      // takeover's old project) intact.
      project,
    };
    this._sessions.set(sessionId, s);
    return s;
  }

  _diskOk() {
    if (this._diskGuardTripped) return false;
    try {
      const st = this._statfs(this._logDir);
      const free = Number(st.bavail) * Number(st.bsize);
      if (free < this._minFreeBytes) {
        this._diskGuardTripped = true;
        reportSwallowed('v2-write.disk-guard', new Error(`free ${free}B < ${this._minFreeBytes}B — v2 writes disabled for this process`));
        return false;
      }
      return true;
    } catch (err) {
      // statfs failing is not a reason to stop logging — warn once, keep writing.
      reportSwallowed('v2-write.statfs', err);
      return true;
    }
  }

  /**
   * Request-initiation ingest. MUST be called in the interceptor's synchronous
   * initiation segment (same place v1 assigns _seq), with the ORIGINAL messages
   * array captured BEFORE the v1 delta path mutates body.messages in place.
   *
   * @param {object} entry - the fully materialized v1 requestEntry
   * @param {Array|null} originalMessages - pre-mutation body.messages reference
   * @returns {{sid:string, seq:number}|null} handle for ingestCompletion, or
   *   null when disabled/failed (caller passes it back verbatim either way).
   */
  ingestRequest(entry, originalMessages) {
    if (!this._enabled || !entry) return null;
    try {
      // Per-request project override (/resume global sessions): only when the
      // interceptor resolved a child claude's own project from the
      // x-ccv-project-dir header does it set `entry._resumeProject` (already
      // sanitized). We MUST key off that explicit marker, NOT the generic
      // `entry.project` — the latter is set for every request (to the process
      // cwd basename) and would silently misroute the moment it diverges from
      // the writer's bound project (e.g. fixtures / teammate reshuffles).
      // Each entry carries its own override, so concurrent sessions from
      // different projects never cross-assign. Falls back to the bound project.
      const project = (typeof entry._resumeProject === 'string' && entry._resumeProject)
        ? entry._resumeProject
        : this._projectFn();
      if (!project) return null; // workspace not selected yet — mirrors v1's empty-LOG_FILE no-op
      if (!this._diskOk()) return null;

      const parsed = parseUserId(entry.body && entry.body.metadata && entry.body.metadata.user_id);
      // Captured BEFORE the reassignment below: when a /resume switch arrives
      // on a FRESH wire sid, the departing conversation's binding is keyed by
      // this previous sid, not the incoming one (review P2 — the fresh-sid
      // variant would otherwise leak the old dir's claim + map entry until
      // process exit, blocking other windows from resuming that ended
      // conversation).
      const prevSid = this._currentSid;
      let sid;
      if (parsed) {
        sid = parsed.sessionId;
        // `_currentSid` = the session of the ACTIVE MAIN claude (the one whose cwd
        // matches the server's currently-bound project). Every claude now
        // self-reports its project via `x-ccv-project-dir` (spawnClaude injects it
        // too, not just resume scratches), so `entry._resumeProject` is that
        // claude's own project. Only the claude whose project == the bound project
        // (`this._projectFn()`) is the main one — a kept-alive OLD project's
        // background claude (header = old project ≠ bound) and resume scratches
        // must NOT move `_currentSid`, or the /resume list's "current" blue dot
        // would drift to whichever background session last emitted a request.
        // A request with NO header at all (legacy / external producer) is treated
        // as the main project's own (project === bound), preserving the old
        // no-header behavior.
        const entryProject = (typeof entry._resumeProject === 'string' && entry._resumeProject)
          ? entry._resumeProject
          : this._projectFn();
        if (entryProject && entryProject === this._projectFn()) {
          this._currentSid = sid;
        }
        // Feed the PTY sid index: this request's owning project just resolved a
        // concrete sessionId, so the PTY serving that project can be addressed by
        // sid. Multi-instance (2026-10-06): also forward the self-reported instanceKey
        // (`_ccvInstance`) so the server can pin the sid to THIS exact process — basename
        // routing cannot tell two same-cwd instances apart. Best-effort — a listener
        // error must not break ingestion.
        // MAIN-AGENT GATE (review P1, 2026-10-06): only pin a sid for the main interactive
        // claude's own requests. A teammate/subagent child process INHERITS the parent's
        // `ANTHROPIC_CUSTOM_HEADERS` (so it carries the parent's `x-ccv-instance`) but runs
        // its OWN conversation/sid — without this gate it would overwrite the parent record's
        // sessionId with the teammate's sid, mis-pinning the instance. Teammate / heartbeat /
        // count_tokens requests are skipped.
        const isMainAgentTurn = entry.mainAgent === true && !entry.teammate && !entry.isHeartbeat && !entry.isCountTokens;
        if (this._onSessionResolved && entryProject && isMainAgentTurn) {
          const instKey = (typeof entry._ccvInstance === 'string' && entry._ccvInstance) ? entry._ccvInstance : null;
          try { this._onSessionResolved(sid, entryProject, instKey); } catch (err) { reportSwallowed('v2-write.session-resolved', err); }
        }
      } else if (this._currentSid) {
        sid = this._currentSid; // §8.3 fallback: route metadata-less requests to the active session
      } else {
        // Cold start before any sid-bearing request: hold in memory; flushed by
        // the first resolved request. Bounded to avoid growing forever on a
        // process that only ever sees metadata-less traffic.
        if (this._pendingNoSid.length < 64) {
          // rid captured NOW: the v1 seam deletes entry.requestId at completion,
          // which can happen before the hold queue flushes (review P3-4 — the
          // held request would otherwise never get its done line).
          this._pendingNoSid.push({ entry, originalMessages, rid: entry.requestId || null });
          return null;
        }
        sid = `noid-${process.pid}-${Date.now()}`;
        this._currentSid = sid;
      }

      // `-c` folder adoption: when this launch is a real continuation but Claude
      // handed a fresh wire session_id, route the writes into the previous main
      // session's folder instead of minting a new (blank) one. Resolved once,
      // before the folder is created; null on every non-adoption path.
      let adoptTarget = null;
      if (parsed) {
        // In-terminal /resume switch outranks launch adoption: the pending
        // signal is consumed by the first REAL main request (countTokens
        // probes and heartbeats wear main-agent body shapes but are not the
        // user's resumed turn — consuming on them would re-bind too early
        // with the same result, but keep the gate strict for clarity).
        if (this._pendingResumeSwitch.has(this._projKey(project)) && entry.mainAgent
          && !entry.isCountTokens && !entry.isHeartbeat) {
          // Locally guarded (review P2): the switch resolution does dir-scan
          // fs work (resolveSessionDirName → readdirSync) whose residual
          // throw surface (EACCES/ENOTDIR) would otherwise escape to the
          // outer catch and drop THIS request entirely — the resumed
          // conversation's first main turn. A failure must degrade to normal
          // routing (recorded in the current dir), never to a lost entry.
          try { adoptTarget = this._resolveResumeSwitch(sid, project, prevSid); }
          catch (err) { reportSwallowed('v2-write.resume-switch-apply', err); }
        }
        if (!adoptTarget) {
          adoptTarget = this._resolveAdoption(sid, project, originalMessages, entry);
          if (adoptTarget) this._adopted.add(this._projKey(project));
        }
      }

      // entry.timestamp = this session's first-request time → meta.startTs +
      // the dir-name ts prefix (task C). First-write-wins: meta is only written
      // when the dir is first created, so this is the session's creation time
      // (live ≈ now; convert = the historical first-entry ts).
      const s = this._session(sid, parsed && entry.body.metadata.user_id, parsed && parsed.encoding, project, entry.timestamp, adoptTarget,
        (typeof entry._ccvInstance === 'string' && entry._ccvInstance) ? entry._ccvInstance : null,
        (typeof entry._resumeProjectCwd === 'string' && entry._resumeProjectCwd) ? entry._resumeProjectCwd : null);

      // System-prompt snapshot, Bind A (wire): the FIRST main request of a session
      // carries the launch's rendered injection in body.system — match it against the
      // project's pending queue and key the snapshot to the wire sid (== transcript
      // uuid for fresh sessions), so a later `-c`/`-r` can pin byte-identical content
      // instead of re-rendering variables and busting the prompt-prefix cache.
      // count_tokens/heartbeat probes wear main-agent shapes but aren't the user's
      // turn (same gate as the resume-switch above); adopted (-c) sessions skip —
      // their pendings are resumeExpected, reserved for the SessionStart-hook bind.
      // The latch only locks on a SUCCESSFUL consume: a session's first main-shaped
      // request can be a small-model side call (title/compression) whose system text
      // the live layer already rewrote to that model's persona (interceptor.js:1124-
      // 1151 rewrites requestEntry.body BEFORE this ingest) — it matches no pending,
      // and latching there would permanently deny the real main-model turns that
      // follow (observed: a session whose 8 later PRO-persona requests never rebound,
      // leaving every later `-c` on the F2 no-record path). Unmatched requests retry;
      // a genuinely injection-less session still consumes its EMPTY pending on some
      // later request (the fallback just records "no injection", so deferring it is
      // harmless). The live-sessions-dir gate keeps the offline converter (staging
      // dirs) from consuming LIVE pendings. Fully caught: a lost bind degrades to
      // the no-record resume path, never to a dropped log entry.
      if (!adoptTarget && entry.mainAgent && !entry.isCountTokens && !entry.isHeartbeat
        && this._sessionsDirName === 'sessions'
        && s && !s.sysPromptBindDone) {
        try {
          const pend = consumePendingForWireByKey(project, systemTextOfBody(entry.body), this._logDir);
          if (pend) {
            s.sysPromptBindDone = true;
            writeSnapshotByKey(project, sid, { entries: pend.entries, model: pend.model, boundVia: 'wire' }, { logDir: this._logDir });
          }
        } catch (err) { reportSwallowed('v2-write.sys-prompt-bind', err); }
      }

      // Flush requests that arrived before the first sid (they belong here).
      // Their handles are parked in _lateHandles so a completion that arrives
      // after the flush still gets its done line (folded by rid).
      if (this._pendingNoSid.length > 0) {
        const pending = this._pendingNoSid.splice(0);
        for (const p of pending) {
          const pseq = this._ingestInto(s, sid, p.entry, p.originalMessages);
          const prid = p.rid; // captured at hold time — the seam may have deleted entry.requestId by now
          if (pseq != null && prid) {
            this._lateHandles.set(prid, { s, sid, seq: pseq, rid: prid });
            if (this._lateHandles.size > 64) {
              this._lateHandles.delete(this._lateHandles.keys().next().value);
            }
          }
        }
      }

      const seq = this._ingestInto(s, sid, entry, originalMessages);
      if (seq != null && this._onActivity) {
        try { this._onActivity(s.paths.dir); } catch { /* nudge only — never disturb the write */ }
      }
      // The handle carries the RESOLVED session object, not just the sid:
      // resetSessions() (workspace switch) clears the _sessions map, and a
      // completion arriving after the switch must still land its done/response
      // lines in the session the request belonged to (review P2: a map lookup
      // at completion time silently dropped them).
      return seq == null ? null : { s, sid, seq, rid: entry.requestId || `${seq}` };
    } catch (err) {
      reportSwallowed('v2-write.ingestRequest', err);
      return null;
    }
  }

  _ingestInto(s, sid, entry, originalMessages) {
    const kind = classifyKind(entry);
    const seq = s.journal.nextSeq();
    const rid = entry.requestId || `${seq}`;
    const msgs = Array.isArray(originalMessages) ? originalMessages
      : (entry.body && Array.isArray(entry.body.messages) ? entry.body.messages : null);

    // P2 wire-level continuation detection: the very first main wire of a
    // session that already carries assistant turns can only be `claude -c`
    // (or -r) resuming an older conversation — a fresh one starts with a
    // single user message. Used by the migrate prompt's `continued` flag.
    if (!this._continuedSeen && kind === 'main' && !s._sawMain && msgs && msgs.length > 1
        && msgs.some((m) => m && m.role === 'assistant')) {
      this._continuedSeen = true;
    }
    if (kind === 'main') s._sawMain = true;

    // 1. Blobs (sync + fsync — the durability barrier).
    const toolsRef = s.blobs.put(entry.body && entry.body.tools);
    const sysRef = s.blobs.put(entry.body && entry.body.system);

    // 2. Conversation event (heartbeats carry no conversation).
    let convKey = null;
    let convResult = null;
    if (kind !== 'heartbeat' && msgs) {
      if (kind === 'main' || kind === 'teammate') convKey = 'main';
      else if (kind === 'sub') convKey = s.resolver.resolveSub(msgs).convKey;
      else convKey = 'misc'; // countTokens & friends: keep wire fidelity under misc
      convResult = s.convs.ingest(convKey, msgs, { seq, rid });
    }

    // Residual body params — every top-level body field except the three that
    // already have dedicated stores (messages → conv, system/tools → blobs).
    // Inlined whole on the req line like headers, so the adapter can rebuild
    // the full v1 body (max_tokens, temperature, thinking, metadata, …).
    let params = null;
    if (entry.body && typeof entry.body === 'object' && !Array.isArray(entry.body)) {
      const rest = { ...entry.body };
      delete rest.messages;
      delete rest.system;
      delete rest.tools;
      if (Object.keys(rest).length > 0) params = rest;
    }

    // 3. Journal req line — LAST, so it never references missing content.
    // Persist the wire agent identity (x-claude-code-agent-id) so teammate
    // names survive cold reads — display no longer depends on the frontend's
    // window-scoped name registry (see agent-id.js).
    const agent = parseAgentId(findHeader(entry.headers, 'x-claude-code-agent-id'));
    s.journal.writeReq({
      seq,
      rid,
      ts: entry.timestamp,
      kind,
      ...(convKey && { conv: convKey }),
      ...(convResult && { epoch: convResult.epoch }),
      url: entry.url,
      method: entry.method,
      ...(entry.body && entry.body.model && { model: entry.body.model }),
      ...(entry.isStream && { isStream: true }),
      ...(entry.headers && { headers: entry.headers }),
      ...(agent && { agent }),
      ...(params && { params }),
      ...((toolsRef || sysRef) && { blobs: { ...(toolsRef && { tools: toolsRef }), ...(sysRef && { sys: sysRef }) } }),
      ...(convResult && { msgFrom: convResult.msgFrom, msgTo: convResult.msgTo }),
      ...(convResult && convResult.evt && { evt: convResult.evt }),
      ...(convResult && convResult.boundary && { boundary: convResult.boundary }),
      ...(entry.proxyProfile && { proxy: { profile: entry.proxyProfile, ...(entry.proxyUrl && { url: entry.proxyUrl }), ...(entry.proxyRole && { role: entry.proxyRole }) } }),
    });

    // 4. prompts.jsonl display cache — strictly AFTER the journal line (a
    // prompts failure must never cost the request its journal record) and
    // fully caught on its own. Main conversation only; the converter drives
    // this same path, so migrated sessions get the cache for free.
    if (convKey === 'main' && convResult && msgs) {
      try { this._appendPrompts(s, seq, msgs, convResult); }
      catch (err) { reportSwallowed('v2-write.prompts', err); }
    }
    return seq;
  }

  /**
   * Append newly-seen user prompts of the main conversation to the session's
   * `prompts.jsonl` ({seq, texts} lines). Idempotent across process restarts:
   * the dedup set is seeded once from the existing file (bounded head read),
   * so a resume/`-c` snapshot replaying the full history appends nothing new.
   */
  _appendPrompts(s, seq, msgs, convResult) {
    // snapshot (msgFrom=0, full wire), append (new tail) — and replace-tail:
    // a suggestion-mode probe replaced by the REAL next user prompt arrives as
    // a same-length tail swap, so skipping ctl entirely would lose exactly
    // those prompts.
    const covered = convResult.evt === 'append' || convResult.evt === 'snapshot'
      || (convResult.evt === 'ctl' && convResult.ctl === 'replace-tail');
    if (!covered) return;
    if (isSuggestionMode(msgs)) return; // next-input probes are not user prompts
    if (!s._promptSeen) s._promptSeen = new Set(readPromptsHead(s.paths.promptsPath));
    const slice = msgs.slice(convResult.msgFrom);
    const texts = [];
    for (const text of extractUserTexts(slice)) {
      if (s._promptSeen.size >= PROMPTS_MAX_PER_SESSION) break;
      const flat = flattenPromptText(text);
      if (!flat || s._promptSeen.has(flat)) continue;
      s._promptSeen.add(flat);
      texts.push(flat);
    }
    if (texts.length > 0) {
      this._queue.appendTo(s.paths.promptsPath, JSON.stringify({ seq, texts }) + '\n');
    }
  }

  /**
   * Completion ingest: responses line + journal done line (+ Agent-spawn
   * registration for future sub-conversation keying, spec §10).
   * @param {{sid:string, seq:number}|null} handle - from ingestRequest
   * @param {object} entry - completed v1 entry (response populated)
   * @param {{doneTs?: string}} [opts] - offline converter: historical done
   *   timestamp (entry start + duration); live callers omit it (wall clock).
   */
  ingestCompletion(handle, entry, opts = {}) {
    if (!this._enabled || !entry) return;
    try {
      // Held cold-start requests returned a null handle at ingestRequest time;
      // recover it by rid (the seam calls us while entry.requestId is intact).
      if (!handle && entry.requestId && this._lateHandles.has(entry.requestId)) {
        handle = this._lateHandles.get(entry.requestId);
        this._lateHandles.delete(entry.requestId);
      }
      if (!handle) return;
      // Prefer the session object carried in the handle (survives
      // resetSessions); the map lookup is only a legacy fallback.
      const s = handle.s || this._sessions.get(handle.sid);
      if (!s) return;

      const resp = entry.response || null;
      const respBody = resp && resp.body !== undefined ? resp.body : null;
      if (respBody && typeof respBody === 'object') s.resolver.registerSpawns(respBody);

      // rid comes from the handle, NOT entry.requestId — the v1 completion path
      // deletes requestId from the entry before writing, and the seam must be
      // free to call us before or after those deletes.
      const rid = handle.rid || `${handle.seq}`;
      this._queue.appendTo(
        s.paths.responsesPath,
        JSON.stringify({
          seq: handle.seq,
          rid,
          body: respBody,
          ...(resp && resp.headers && { headers: resp.headers }),
          ...(resp && resp.statusText && { statusText: resp.statusText }),
        }) + '\n'
      );

      const usage = respBody && respBody.usage ? respBody.usage : null;
      s.journal.writeDone({
        seq: handle.seq,
        rid,
        ts: opts.doneTs || new Date().toISOString(),
        ...(typeof entry.duration === 'number' && { dur: entry.duration }),
        status: resp && resp.error ? 'error' : (respBody == null ? 'capture-failed' : 'ok'),
        ...(resp && typeof resp.status === 'number' && { http: resp.status }),
        ...(usage && {
          usage: {
            ...(usage.input_tokens != null && { in: usage.input_tokens }),
            ...(usage.output_tokens != null && { out: usage.output_tokens }),
            ...(usage.cache_read_input_tokens != null && { cr: usage.cache_read_input_tokens }),
            ...(usage.cache_creation_input_tokens != null && { cw: usage.cache_creation_input_tokens }),
          },
        }),
        ...(respBody && respBody.stop_reason && { stop: respBody.stop_reason }),
      });
      if (this._onActivity && s.paths) {
        try { this._onActivity(s.paths.dir); } catch { /* nudge only — never disturb the write */ }
      }
    } catch (err) {
      reportSwallowed('v2-write.ingestCompletion', err);
    }
  }

  /** Session directory of the writer's current (fallback-routing) session, or
   *  null before the first sid-bearing request. The read side uses this to
   *  resolve "the live session" for /events cold loads (S6b). */
  currentSessionDir() {
    if (!this._currentSid) return null;
    const s = this._sessions.get(this._currentSid);
    return s ? s.paths.dir : null;
  }

  /** The writer's current (fallback-routing) session UUID, or null before the
   *  first sid-bearing request. Exposed so the /resume list can mark exactly ONE
   *  row as the live "current" session (the multi-blue-dot fix) — the row whose
   *  sessionUuid matches this id is the one the main process is actively running. */
  currentSessionId() {
    return this._currentSid || null;
  }

  /** Lifecycle hook: drop in-memory conversation continuity so the next
   *  request snapshots fresh. Journal seq keeps counting (same process, same
   *  session dirs — seq must stay monotonic per session). NOTE: the
   *  in-terminal /resume switch does NOT ride this — it needs a DIR re-bind,
   *  not just fresh continuity (see beginResumeSwitch); this stays for
   *  in-place resets that keep the dir. */
  resetConversations() {
    try {
      for (const s of this._sessions.values()) {
        s.convs.reset();
        s.resolver.reset();
      }
      this._currentSid = null;
    } catch (err) {
      reportSwallowed('v2-write.reset', err);
    }
  }

  /** Lifecycle hook (workspace switch): drop the TARGET project's cached session
   *  bindings so the next request re-creates its session dir under the newly
   *  resolved project. `targetProject` is the project being switched AWAY from —
   *  only its sessions/claims are dropped, so a concurrently-running BACKGROUND
   *  project (a cross-project /resume takeover's old project, still being written
   *  via `entry._resumeProject`) keeps its bindings and continues uninterrupted.
   *  With no argument (legacy callers) it clears everything, matching the old
   *  behavior byte-for-byte. A sid that persists across the switch gets a fresh
   *  dir (and fresh seq) under the new project — different directory, so no seq
   *  collision. */
  resetSessions(targetProject = null) {
    try {
      const matchAll = targetProject == null;
      const targetSan = matchAll ? null : sanitizePathComponent(targetProject);
      // Release live claims FIRST (before the session map is gone): a
      // switched-away workspace's dirs are dormant and legitimately adoptable
      // by other windows from this moment on. Only the target project's claims
      // are released on a scoped reset — the background project keeps its lock.
      if (matchAll) {
        this._releaseAllClaims();
      } else {
        // Match by the project dir prefix (<logDir>/<projectSan>) rather than by
        // positional path segment — the old slice(-3,-2) index assumed a fixed
        // <logDir>/<project>/sessions/<ts>_<sid> depth and broke when
        // _sessionsDirName changed the layout (offline converter staging dirs).
        const prefix = join(this._logDir, targetSan) + sep;
        for (const dir of [...this._claimedDirs]) {
          if (dir === join(this._logDir, targetSan) || dir.startsWith(prefix)) {
            releaseSessionClaim(dir);
            this._claimedDirs.delete(dir);
          }
        }
      }
      for (const [sid, s] of [...this._sessions]) {
        if (matchAll || sanitizePathComponent(s.project || '') === targetSan) {
          this._sessions.delete(sid);
        }
      }
      this._pendingNoSid.length = 0;
      this._lateHandles.clear();
      // _currentSid only clears when it pointed at the dropped project — the
      // background project's live "current" pointer survives a scoped reset.
      if (matchAll) {
        this._currentSid = null;
      } else {
        const cur = this._currentSid ? this._sessions.get(this._currentSid) : null;
        if (this._currentSid && !cur) this._currentSid = null;
      }
      // `-c` adoption latch + pending /resume switch, both per-project now: a
      // scoped reset clears only the switched-away project's latch (a background
      // project's armed resume switch / adoption survives); a full reset clears all.
      if (matchAll) {
        this._adopted.clear();
        this._pendingResumeSwitch.clear();
      } else {
        this._adopted.delete(targetSan);
        this._pendingResumeSwitch.delete(targetSan);
      }
    } catch (err) {
      reportSwallowed('v2-write.reset-sessions', err);
    }
  }

  /** Flush pending queue writes (tests / graceful shutdown). */
  async flush() {
    await this._queue.flush();
  }

  async close() {
    // Synchronous claim release BEFORE the async drain: close() runs under
    // interceptor.js's 2s-bounded shutdown race, and a hung drain must not
    // strand owner.lock files on a clean exit. (A crash skips this entirely —
    // harmless, the claim's validity dies with the pid.)
    try { this._releaseAllClaims(); }
    catch (err) { reportSwallowed('v2-write.release-claims', err); }
    await this._queue.close();
  }
}
