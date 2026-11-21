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
import { reportSwallowed } from '../../lib/error-report.js';
import { ensureSessionDirSync, compactLocalTs14, sanitizePathComponent, normalizeSessionCwd } from './layout.js';
import { resolveSessionDirName, latestMainSession } from './session-select.js';
import { acquireSessionClaim, releaseSessionClaim, isForeignLiveOwned } from './session-owner.js';
import { BlobStore } from './blob-store.js';
import { Journal } from './journal.js';
import { ConversationStore } from './conversation-store.js';
import { parseUserId, classifyKind, ConvResolver } from './identity.js';
import { parseAgentId, findHeader } from './agent-id.js';
import { extractUserTexts, flattenPromptText, isSuggestionMode, readPromptsHead } from '../user-prompt-extract.js';
import { iterateJsonlLines } from './jsonl-read.js';
import { consumePendingForWireByKey, writeSnapshotByKey, systemTextOfBody } from '../system-prompt-snapshots.js';
import { rotateSessionDir, SHARD_PROMPT_THRESHOLD } from './shard-manager.js';

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
    this._exactConvFps = opts.exactConvFps;
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
    // Multi-instance (same-cwd twin): per-instance fallback pointer so a
    // metadata-less request (heartbeat/countTokens) from twin B routes to B's
    // own session, never to the process-global _currentSid (twin A). Keyed by
    // `_ccvInstance` → {sid, project}. Only ever SET on a main-agent turn
    // (teammate/subagent children inherit the parent's x-ccv-instance but run
    // their own sid — letting them set this would hijack the parent's pointer).
    this._currentSidByInstance = new Map(); // instKey → {sid, project}
    this._pendingNoSid = [];    // legacy (no-instance) requests seen before any sid.
    // Per-instance cold-start hold buckets: instKeyOr'' → {project, items:[]}.
    // Kept separate from _pendingNoSid so a twin's held heartbeats flush only on
    // that twin's first sid-bearing request, not on the other twin's.
    this._pendingNoSidByInstance = new Map();
    // forceNew (2026-11): instanceKeys of RETIRED generations (an SDK forceNew teardown).
    // A retired instance's late traffic (a draining child's heartbeat/completion) may still
    // write into its OWN old dir (history stays consistent) but must NEVER move the live
    // pointers (`_currentSid` / `_currentSidByInstance` / `_onSessionResolved`) — else the
    // fresh generation's bound cold-load flips back to the old conversation. Append-only;
    // random keys never collide with a future generation. Cleared only by resetSessions().
    this._retiredInstances = new Set();
    // Contract with the caller: originalMessages held here must be a reference
    // the caller never MUTATES (the interceptor's original array is only ever
    // REASSIGNED away from body.messages, never mutated in place — safe).
    this._lateHandles = new Map(); // rid → handle for held requests whose completion arrives after the flush
    this._diskGuardTripped = false;
    // Shard rotation seam (tests): prompt ceiling per shard. The production
    // default is SHARD_PROMPT_THRESHOLD (2000); tests inject a tiny value so a
    // few fixture prompts trigger the cut.
    this._shardPrompts = typeof opts.shardPrompts === 'number' && opts.shardPrompts > 0 ? opts.shardPrompts : 0;
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
    // Two-level: project → instance. The instance level (R1) stops a same-cwd
    // twin from consuming the OTHER twin's armed switch; '' is the legacy
    // (no-instance) slot, preserving the old per-project behavior for producers
    // that carry no x-ccv-instance. Value: {transcriptUuid, hookSid}; consumed
    // one-shot on the matching instance's next main request.
    this._pendingResumeSwitch = new Map(); // projSan → Map<instKeyOr'', {transcriptUuid, hookSid}>
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
  // Shard rotation (2026-11): fired AFTER a rotation rebinds the session to a
  // fresh skeleton. The live feed must re-attach the dir WITHOUT suppressing
  // history — the fresh shard's first post-cut content is new, not cold-load
  // history (the default shrink→rebuild path would suppress and swallow it).
  setOnShardRotated(fn) { this._onShardRotated = typeof fn === 'function' ? fn : null; }

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
    // Same-process twin guard: the pid-level skipForeignLive above is blind to a
    // same-cwd twin of THIS process (shared pid). A `-c`/history-replay on one
    // twin must never adopt the OTHER twin's live dir (two Journals, one file).
    if (this._isBoundToOtherInstance(basename(prev.dir), project,
      (entry && typeof entry._ccvInstance === 'string' && entry._ccvInstance) ? entry._ccvInstance : null)) return null;
    if (this._claimsEnabled()) {
      if (!acquireSessionClaim(prev.dir).ok) return null;
      // Record immediately (not only in _session): a throw between here and
      // _session must not leak an untracked lock file until process exit.
      this._claimedDirs.add(prev.dir);
    }
    return { dirName: basename(prev.dir), identityUUID: prev.sessionId };
  }

  /** Per-instance fallback pointer for metadata-less routing (R3): the sid a
   *  twin's heartbeat/countTokens should resolve to. Returns null when the
   *  instance has not yet run a main turn — in that case the caller must NOT
   *  fall back to the process-global `_currentSid` (that would write twin B's
   *  cold-start traffic into twin A's dir). */
  _currentSidFor(instKey) {
    if (!instKey) return this._currentSid;
    const cur = this._currentSidByInstance.get(instKey);
    return cur ? cur.sid : null;
  }

  /** The sid an instance is CURRENTLY bound to (main-turn routing pointer), or null.
   *  Read-only; used by the resume twin-ownership guard to tell "this instance owns the
   *  conversation it is actively writing" apart from "this instance merely shares a
   *  deterministic key with a dead prior author". */
  currentSidForInstance(instKey) {
    if (typeof instKey !== 'string' || !instKey) return null;
    const cur = this._currentSidByInstance.get(instKey);
    return cur ? cur.sid : null;
  }

  /** In-terminal /resume signal (interceptor.markSessionStart → here): arm a
   *  one-shot routing switch. `transcriptUuid` is the resumed conversation's
   *  stable identity (transcript basename); `hookSid` is the fresh session
   *  uuid the hook minted — used as the NEW dir identity when the resumed
   *  conversation was never recorded by ccv (it must not be the old wire sid:
   *  `<ts>_<oldSid>` would be re-resolved back to the OLD dir by
   *  resolveSessionDirName). Last-wins across repeated /resume picks. */
  beginResumeSwitch({ transcriptUuid, hookSid, project, instanceKey = null } = {}) {
    try {
      if (!transcriptUuid || typeof transcriptUuid !== 'string') return;
      // Keyed by the project the resumed conversation belongs to (defaults to the
      // currently-bound project — markSessionStart's guard already ensures the
      // hook's cwd matches it). Per-project so a scoped reset clears only that one.
      const key = sanitizePathComponent(project || this._projectFn() || '');
      const inst = (typeof instanceKey === 'string' && /^ccv-[0-9a-f]+$/.test(instanceKey)) ? instanceKey : '';
      let bucket = this._pendingResumeSwitch.get(key);
      if (!bucket) { bucket = new Map(); this._pendingResumeSwitch.set(key, bucket); }
      // Last-wins across repeated /resume picks, but ONLY within the same
      // (project, instance) — a twin must not clobber its sibling's armed switch.
      bucket.set(inst, {
        transcriptUuid,
        hookSid: (typeof hookSid === 'string' && hookSid) ? hookSid : null,
      });
    } catch (err) {
      reportSwallowed('v2-write.resume-switch', err);
    }
  }

  /** Same-process live-bind guard (R1/R7): is `dirName` currently bound in THIS
   *  process's `_sessions` to a DIFFERENT instance? The pid-level `owner.lock`
   *  guard (`isForeignLiveOwned`) is blind to same-cwd twins — both share this
   *  process's pid, so a twin adopting the other's live dir would produce two
   *  Journal objects writing the same file with independently-seeded seqs
   *  (certain corruption). Used by the resume-switch and `-c` adoption paths to
   *  fall back to fork semantics instead. */
  _isBoundToOtherInstance(dirName, project, instKey) {
    const projectDir = join(this._logDir, sanitizePathComponent(project));
    const targetDir = join(projectDir, this._sessionsDirName, dirName);
    for (const s of this._sessions.values()) {
      if (s && s.paths && s.paths.dir === targetDir) {
        const owner = s._instanceKey || null;
        // Same identity → not a conflict (a twin re-joining its OWN dir).
        if (owner === instKey && owner !== null) return false;
        // Owner is a known twin but the caller is a DIFFERENT instance, OR the
        // caller carries no instance identity while the dir is owned by one
        // (a legacy producer must not re-bind a twin's dir — that is the very
        // "two Journals, one file" this guard exists to prevent). Both conflict.
        // An unattributed legacy binding (owner null) with an unattributed caller
        // (instKey null) is allowed to preserve legacy self re-join semantics.
        return !(owner === null && instKey === null);
      }
    }
    return false;
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
  _resolveResumeSwitch(sid, project, prevSid = null, instanceKey = null) {
    const key = this._projKey(project);
    const bucket = this._pendingResumeSwitch.get(key);
    const inst = (typeof instanceKey === 'string' && instanceKey) ? instanceKey : '';
    const sw = bucket ? bucket.get(inst) : null;
    if (bucket) { bucket.delete(inst); if (bucket.size === 0) this._pendingResumeSwitch.delete(key); } // one-shot
    if (!sw) return null;
    const projectDir = join(this._logDir, sanitizePathComponent(project));
    let dirName = resolveSessionDirName(projectDir, sw.transcriptUuid, this._sessionsDirName);
    let identity = sw.transcriptUuid;
    if (dirName) {
      const targetDir = join(projectDir, this._sessionsDirName, dirName);
      // Liveness guard is UNCONDITIONAL (mirror _resolveAdoption's
      // unconditional skipForeignLive): even a non-claiming writer must never
      // re-bind into a dir another live window is writing. The acquire below
      // additionally arbitrates for claiming writers.
      // Same-process twin guard: the pid-level check above is blind to two
      // same-cwd instances of THIS process (shared pid) — also refuse a dir
      // currently bound to a different instance here (manual /resume in a twin).
      if (isForeignLiveOwned(targetDir)
        || this._isBoundToOtherInstance(dirName, project, inst)
        || (this._claimsEnabled() && !acquireSessionClaim(targetDir).ok)) {
        dirName = null; // live foreign owner / live twin — never share its journal
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
      // Sharding (2026-11): persist the ACTIVE shard's prompt counter so a
      // restart re-seeds from meta instead of the prompts.jsonl line count —
      // that file is archived with its shard (PROMPTS-capped) and would seed
      // an under-count, letting a near-threshold shard grow unboundedly.
      // First-write-wins: the counter is carried forward by the rotation's own
      // meta carry-over, not rewritten here.
      shardPromptsActive: 0,
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
      // Identity UUID (wire sessionId / adopted folder's UUID) — shard rotation
      // re-stamps it on the recreated active dir so the session's identity stays
      // stable across the cut without re-reading the frozen meta.
      _identityId: identityId,
      // The instanceKey that stamped meta.json — shard rotation re-stamps it on
      // the recreated active dir (shard-manager.js) so multi-instance routing
      // survives the cut.
      _instanceKey: instanceKey || null,
      // In-flight request count + rotation state (shard-manager.js): the cut is
      // deferred until no request is open and the write queue is idle.
      _inflight: 0,
      _shardArmed: false,
      _rotating: false,
      _shardRetryQueued: false,
      // New-user-prompt count on the CURRENT shard (the rotation trigger).
      // Seeded once from the live prompts.jsonl on first contact (restart).
      _partPrompts: 0,
      _promptsSeeded: false,
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
      // Instance this request belongs to (same-cwd twin routing). Extracted once
      // at the top so the resume-switch/adoption/metadata-less paths all agree.
      const instKey = (typeof entry._ccvInstance === 'string' && entry._ccvInstance) ? entry._ccvInstance : null;
      // forceNew (2026-11): a RETIRED generation (SDK forceNew teardown) may still be
      // draining — its trailing completion should land in its OWN old dir, but it must
      // never move `_currentSid` / `_currentSidByInstance` / `_onSessionResolved`, and its
      // metadata-less traffic must not be routed or held (it would misroute into the fresh
      // generation's dir). Read once; gates below.
      const retired = !!(instKey && this._retiredInstances.has(instKey));
      // Captured BEFORE the reassignment below: when a /resume switch arrives
      // on a FRESH wire sid, the departing conversation's binding is keyed by
      // this previous sid, not the incoming one (review P2 — the fresh-sid
      // variant would otherwise leak the old dir's claim + map entry until
      // process exit, blocking other windows from resuming that ended
      // conversation). Per-instance (R3): a twin must depart from ITS OWN
      // previous sid, not the process-global last-writer — otherwise twin A's
      // /resume would resolve against twin B's binding and release B's claim.
      const prevSid = this._currentSidFor(instKey);
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
        if (entryProject && entryProject === this._projectFn() && !retired) {
          this._currentSid = sid;
        }
        // Per-instance pointer (R3): pin the sid for THIS instance so its later
        // metadata-less requests route back here. MAIN-AGENT GATE mirrors the
        // `_onSessionResolved` gate below: only the main interactive claude's own
        // turn sets it. A teammate/subagent child INHERITS the parent's
        // `x-ccv-instance` but runs its OWN conversation/sid — without this gate
        // it would overwrite the parent instance's pointer with the teammate's
        // sid, misrouting the parent's heartbeats into the teammate's session.
        const isMainAgentTurn = entry.mainAgent === true && !entry.teammate && !entry.isHeartbeat && !entry.isCountTokens;
        if (instKey && isMainAgentTurn && !retired) {
          this._currentSidByInstance.set(instKey, { sid, project: entryProject });
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
        if (this._onSessionResolved && entryProject && isMainAgentTurn && !retired) {
          try { this._onSessionResolved(sid, entryProject, instKey); } catch (err) { reportSwallowed('v2-write.session-resolved', err); }
        }
      } else if (instKey) {
        // forceNew (2026-11): a retired generation's metadata-less traffic is dropped, not
        // routed (its pointer is gone) nor held (a held heartbeat would later flush into the
        // NEW generation's dir). Returning null writes nothing — clean for a dead generation.
        if (retired) return null;
        // Metadata-less request from a known instance: route to that instance's
        // own session. If it has not run a main turn yet, there is NO pointer —
        // deliberately do NOT fall back to the process-global `_currentSid`,
        // which would write twin B's cold-start heartbeat into twin A's dir.
        const own = this._currentSidByInstance.get(instKey);
        if (own) {
          sid = own.sid;
        } else {
          let bucket = this._pendingNoSidByInstance.get(instKey);
          if (!bucket) { bucket = { project, items: [] }; this._pendingNoSidByInstance.set(instKey, bucket); }
          if (bucket.items.length < 64) {
            bucket.items.push({ entry, originalMessages, rid: entry.requestId || null });
            return null;
          }
          // Bucket overflow safety valve: mint a throwaway noid sid for THIS
          // request only. Deliberately NOT written into _currentSidByInstance —
          // this branch may be a heartbeat/teammate (not a gated main turn), and
          // a noid must never become the instance's durable pointer.
          sid = `noid-${process.pid}-${Date.now()}`;
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
        // Instance-keyed (R1): a twin consumes only ITS OWN armed switch.
        const rsBucket = this._pendingResumeSwitch.get(this._projKey(project));
        if (rsBucket && rsBucket.has(instKey || '') && entry.mainAgent
          && !entry.isCountTokens && !entry.isHeartbeat) {
          // Locally guarded (review P2): the switch resolution does dir-scan
          // fs work (resolveSessionDirName → readdirSync) whose residual
          // throw surface (EACCES/ENOTDIR) would otherwise escape to the
          // outer catch and drop THIS request entirely — the resumed
          // conversation's first main turn. A failure must degrade to normal
          // routing (recorded in the current dir), never to a lost entry.
          try { adoptTarget = this._resolveResumeSwitch(sid, project, prevSid, instKey); }
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

      // Shard rotation (shard-manager.js): the live content is archived into the
      // session's own `parts/<N>/` and this session is rebound to a fresh
      // skeleton. The trigger is PROMPT-COUNT based, not bytes: after
      // SHARD_PROMPT_THRESHOLD user-prompt turns on the main conversation, the
      // NEXT new user prompt starts a fresh shard — so every part holds whole
      // user-prompt→loop segments, never a half-turn. Rotation is DEFERRED to a
      // quiescent point (no in-flight request + an idle write queue, so a
      // req/done never splits across shards and a chunked drain never tears a
      // line across the cut). Cost below threshold: one O(1) counter check.
      try { this._armShardRotation(s); } catch (err) { reportSwallowed('v2-write.shard-arm', err); }
      // Run an already-armed cut at this quiescent point (no in-flight request
      // on this session yet — the count is bumped by _ingestInto below). This
      // is what lets the NEXT new-user-prompt after a threshold-crossing one
      // land in a fresh shard. (_armShardRotation already runs _maybeRotate
      // when it arms with nothing in flight; this covers cuts armed earlier.)
      if (s._shardArmed && (s._inflight || 0) === 0) this._maybeRotate(s);

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
      // after the flush still gets its done line (folded by rid). R3: flush the
      // legacy no-instance bucket AND only THIS request's instance bucket — a
      // twin's held heartbeats must never be flushed into the other twin's dir.
      const instBucket = instKey ? this._pendingNoSidByInstance.get(instKey) : null;
      if (this._pendingNoSid.length > 0 || (instBucket && instBucket.items.length > 0)) {
        const pending = this._pendingNoSid.splice(0);
        if (instBucket) {
          pending.push(...instBucket.items);
          this._pendingNoSidByInstance.delete(instKey);
        }
        for (const p of pending) {
          const pseq = this._ingestInto(s, sid, p.entry, p.originalMessages);
          const prid = p.rid; // captured at hold time — the seam may have deleted entry.requestId by now
          if (pseq != null && prid) {
            // Held requests count as in-flight too (they complete later via
            // _lateHandles): a rotation must not fire while one is open.
            const handle = { s, sid, seq: pseq, rid: prid, paths: s.paths, journal: s.journal, counted: false };
            this._openHandle(handle);
            this._lateHandles.set(prid, handle);
            if (this._lateHandles.size > 64) {
              const evicted = this._lateHandles.keys().next().value;
              const evictedHandle = this._lateHandles.get(evicted);
              this._lateHandles.delete(evicted);
              // Evicting a still-open handle must release its in-flight count,
              // or the session would never rotate again (stuck at >0). The
              // handle is unreachable afterwards, so close without re-arming
              // the rotation latch (its completion can never arrive).
              this._closeHandle(evictedHandle, { rotate: false });
            }
          }
        }
      }

      const seq = this._ingestInto(s, sid, entry, originalMessages);
      const handle = seq == null ? null : { s, sid, seq, rid: entry.requestId || `${seq}`, paths: s.paths, journal: s.journal, counted: false };
      if (handle) {
        // In-flight guard for shard rotation: a completion must land its
        // done/response in the SAME shard that holds its req line. Count the
        // request as open until ingestCompletion closes it; rotation only runs
        // once this reaches zero (and the queue is flushed).
        this._openHandle(handle);
      }
      if (seq != null && this._onActivity) {
        try { this._onActivity(s.paths.dir); } catch { /* nudge only — never disturb the write */ }
      }
      // The handle carries the RESOLVED session object, not just the sid:
      // resetSessions() (workspace switch) clears the _sessions map, and a
      // completion arriving after the switch must still land its done/response
      // lines in the session the request belonged to (review P2: a map lookup
      // at completion time silently dropped them). It ALSO snapshots the
      // request-time paths so a shard rotation between request and completion
      // keeps the done/response in the shard that owns this seq.
      return handle;
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

    // Shard trigger (2026-11): a NEW main-conversation user prompt is the cut
    // node. See _countShardPrompt for the counting rule. On crossing the prompt
    // ceiling, rotate BEFORE this request's blob/conv/journal writes so the new
    // prompt opens the fresh shard (this is the quiescent point: this request's
    // in-flight count isn't bumped until after _ingestInto returns).
    if (this._countShardPrompt(s, kind, msgs)) {
      if ((s._partPrompts || 0) > this._shardThresholdPrompts() && (s._inflight || 0) === 0 && !s._rotating) {
        s._shardArmed = true;
        this._maybeRotate(s);
        if (!s._rotating && !s._shardArmed) s._partPrompts = 1; // rotated: this prompt starts the new shard
      }
    }

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
      // Write to the shard that owns this seq — the request-time paths snapshot
      // on the handle (NOT s.paths, which a shard rotation may have since
      // rebound to the fresh active dir). Falls back to the session's current
      // paths for legacy handles without a snapshot.
      const donePaths = handle.paths || s.paths;
      const doneJournal = handle.journal || s.journal;
      this._queue.appendTo(
        donePaths.responsesPath,
        JSON.stringify({
          seq: handle.seq,
          rid,
          body: respBody,
          ...(resp && resp.headers && { headers: resp.headers }),
          ...(resp && resp.statusText && { statusText: resp.statusText }),
        }) + '\n'
      );

      const usage = respBody && respBody.usage ? respBody.usage : null;
      doneJournal.writeDone({
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
      // Close the in-flight guard opened at ingestRequest and, when this was
      // the last open request, run any armed shard rotation (quiescent point).
      this._closeHandle(handle);
    } catch (err) {
      reportSwallowed('v2-write.ingestCompletion', err);
    }
  }

  /** Open an in-flight handle: every counted handle must close exactly once
   *  (see _closeHandle). Centralized so the increment sites can't drift. */
  _openHandle(handle) {
    if (!handle || typeof handle.seq !== 'number') return;
    handle.s._inflight = (handle.s._inflight || 0) + 1;
    handle.counted = true;
  }

  /** Close a counted handle exactly once (the `counted` latch makes a double
   *  close a no-op) and, when it was the session's last open request, run any
   *  armed shard rotation (quiescent point). `rotate:false` for paths where
   *  the handle is already unreachable (late-handle eviction) — re-arming the
   *  rotation latch there would be wasted work. */
  _closeHandle(handle, { rotate = true } = {}) {
    const s = handle && (handle.s || this._sessions.get(handle.sid));
    if (!s) return;
    if (typeof handle.seq === 'number' && handle.counted && s._inflight > 0) {
      handle.counted = false; // one-shot latch: a double completion can't double-decrement
      s._inflight -= 1;
      if (rotate && s._inflight === 0) this._maybeRotate(s);
    }
  }

  /** Release a request's in-flight count WITHOUT writing a done/response line —
   *  for requests that will never complete (fetch reject on Esc/network error,
   *  stream read abort). Without it `_inflight` leaks ≥1 and the session never
   *  rotates again for this process's lifetime. */
  releaseHandle(handle) {
    try {
      this._closeHandle(handle);
    } catch (err) { reportSwallowed('v2-write.release-handle', err); }
  }

  /** Arm shard rotation once the live dir crosses the threshold. Cheap: an O(1)
   *  counter bump per new user prompt. The actual cut is deferred to
   *  _maybeRotate (quiescent point). */
  _armShardRotation(s) {
    if (!s || s._shardArmed || s._rotating) return;
    // Only rotate live session trees — the offline converter writes to a
    // staging sibling (sessionsDirName 'sessions-migrating') whose promote/
    // verify flow assumes one dir per logical session.
    if (this._sessionsDirName !== 'sessions') return;
    // Prompt-count trigger (no disk probing): the per-session counter
    // `_partPrompts` is bumped on each NEW main-conversation user prompt (see
    // _countShardPrompt). On first contact (a re-attached/restarted session)
    // seed it from the LIVE meta's `shardPromptsActive` (persisted at the last
    // rotation); the prompts.jsonl LINE COUNT is only the legacy fallback —
    // that file is archived with its shard (PROMPTS-capped), so seeding from
    // it after a rotation would under-count and let a near-threshold shard
    // grow unboundedly across restarts.
    if (!s._promptsSeeded) {
      s._promptsSeeded = true;
      let seeded = null;
      try {
        const meta = JSON.parse(readFileSync(s.paths.metaPath, 'utf-8'));
        if (meta && typeof meta.shardPromptsActive === 'number' && meta.shardPromptsActive >= 0) seeded = meta.shardPromptsActive;
      } catch { /* no meta (legacy/external producer) — fall back to the file scan */ }
      if (seeded == null) {
        let lines = 0;
        try { for (const _ of iterateJsonlLines(s.paths.promptsPath)) lines++; } catch { lines = 0; }
        seeded = lines;
      }
      s._partPrompts = seeded;
    }
    if ((s._partPrompts || 0) < this._shardThresholdPrompts()) return;
    s._shardArmed = true;
    // An armed cut takes effect at the next quiescent point (the request start
    // with none open, or the last completion) — _maybeRotate runs from both. If
    // THIS request armed it and nothing is in flight yet, cut right away.
    if ((s._inflight || 0) === 0) this._maybeRotate(s);
  }

  _shardThresholdPrompts() {
    return (typeof this._shardPrompts === 'number' && this._shardPrompts > 0) ? this._shardPrompts : SHARD_PROMPT_THRESHOLD;
  }

  /** Count one NEW main-conversation user prompt toward the shard ceiling and
   *  bump the per-session counter. Rule: read the conv store's CURRENT wire
   *  length (read-only, no side effect); a fresh user turn appends a
   *  non-tool-result user message at [prevCount, len). A SNAPSHOT (restart /
   *  -c / compact / dual-writer) has prevCount < len only for genuinely new
   *  tail content — so scanning that slice never recounts history. Tool-loop
   *  follow-ups append only tool_result/assistant and do NOT count.
   *  @returns {boolean} true when this entry carried a new user prompt. */
  _countShardPrompt(s, kind, msgs) {
    if (kind !== 'main' || !msgs || msgs.length === 0) return false;
    const prevCount = s.convs.count('main');
    for (let i = prevCount; i < msgs.length; i++) {
      const m = msgs[i];
      if (m && m.role === 'user' && !this._isToolResultMsg(m)) {
        s._partPrompts = (s._partPrompts || 0) + 1;
        return true;
      }
    }
    return false;
  }

  /** Run an armed rotation at a quiescent point — SYNCHRONOUSLY, before the
   *  triggering request's `_ingestInto`. The cut is safe only when: no request
   *  is in flight on this session (its completion must land in the same shard
   *  as its req) AND the write queue is idle (a chunked drain re-opens the
   *  target path per chunk, so a mid-drain rename would tear a line across
   *  shards). When the queue is busy the cut stays armed and retries at the
   *  next request start / completion. */
  _maybeRotate(s) {
    if (!s || s._rotating) return;
    if ((s._inflight || 0) > 0) return; // completion of the last one re-triggers
    if (!s._shardArmed) return;
    if (!this._queue.isIdle) {
      // The drain hasn't settled — a mid-drain rename would tear a chunked line
      // across shards. Park ONE retry on the drain-complete callback (the true
      // idle point) instead of busy-retrying per request.
      if (!s._shardRetryQueued) {
        s._shardRetryQueued = true;
        this._queue.onIdle(() => {
          s._shardRetryQueued = false;
          this._maybeRotate(s);
        });
      }
      return;
    }
    s._rotating = true;
    try {
      const rotated = rotateSessionDir(this, s);
      if (rotated) {
        // Re-claim the freshly created active dir so multi-window isolation
        // survives the cut (the old claim rode the rename into the shard).
        if (this._claimsEnabled() && acquireSessionClaim(s.paths.dir).ok) {
          this._claimedDirs.add(s.paths.dir);
        }
        s._shardArmed = false;
        s._partPrompts = 0; // fresh active shard starts its prompt count over
      }
    } catch (err) {
      reportSwallowed('v2-write.shard-rotate', err);
    } finally {
      s._rotating = false;
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

  /** True when a wire message is a tool_result carrier (not a fresh user
   *  prompt). The shard cut only opens on a genuine user turn — tool-loop
   *  follow-ups append tool_result blocks at the wire tail and must not count. */
  _isToolResultMsg(msg) {
    const c = msg && msg.content;
    if (typeof c === 'string') return false; // plain-text user prompt
    if (!Array.isArray(c)) return false;
    return c.some((b) => b && b.type === 'tool_result');
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
      this._currentSidByInstance.clear();
      this._pendingNoSidByInstance.clear();
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
      this._pendingNoSidByInstance.clear();
      this._lateHandles.clear();
      // _currentSid only clears when it pointed at the dropped project — the
      // background project's live "current" pointer survives a scoped reset.
      if (matchAll) {
        this._currentSid = null;
        this._currentSidByInstance.clear();
      } else {
        const cur = this._currentSid ? this._sessions.get(this._currentSid) : null;
        if (this._currentSid && !cur) this._currentSid = null;
        // Drop only the switched-away project's per-instance pointers (mirrors
        // the _currentSid rule): a background project's twin keeps its pointer.
        for (const [k, v] of [...this._currentSidByInstance]) {
          if (sanitizePathComponent(v.project || '') === targetSan) this._currentSidByInstance.delete(k);
        }
      }
      // `-c` adoption latch + pending /resume switch, both per-project now: a
      // scoped reset clears only the switched-away project's latch (a background
      // project's armed resume switch / adoption survives); a full reset clears all.
      if (matchAll) {
        this._adopted.clear();
        this._pendingResumeSwitch.clear();
        this._retiredInstances.clear(); // full reset: no retired generation survives a workspace wipe
      } else {
        this._adopted.delete(targetSan);
        this._pendingResumeSwitch.delete(targetSan);
      }
    } catch (err) {
      reportSwallowed('v2-write.reset-sessions', err);
    }
  }

  /** Same-project forceNew relaunch (R2): a NEW claude instance is being spawned
   *  in the SAME cwd as a live twin. The twin keeps its session bindings
   *  (`_sessions`) and owner.lock claims (`_claimedDirs`) — releasing them would
   *  expose its live dirs to the sibling's cold-load/adoption. Only
   *  launch-boundary state that could hijack or misroute the FRESH twin is
   *  cleared: held pre-sid traffic, late handles, and any armed /resume switch
   *  (which belongs to the outgoing launch context, not the new twin). The
   *  `-c` adoption latch is intentionally LEFT SET — forceNew never adopts an
   *  old folder, and clearing it would wrongly re-enable adoption for the
   *  still-live twin. Same-process mis-adoption is prevented by the
   *  `_isBoundToOtherInstance` guard in _resolveAdoption/_resolveResumeSwitch,
   *  not by poisoning the project latch. */
  resetForLiveRelaunch(targetProject) {
    try {
      const key = this._projKey(targetProject);
      this._pendingNoSid.length = 0;
      this._pendingNoSidByInstance.clear();
      // Late handles are _openHandle-counted when parked; a bare clear() would
      // leak their in-flight count and wedge shard rotation for the surviving
      // twin's session (resetSessions gets away with it only because it also
      // drops the sessions). Close each without re-arming rotation first.
      for (const h of this._lateHandles.values()) this._closeHandle(h, { rotate: false });
      this._lateHandles.clear();
      this._pendingResumeSwitch.delete(key);
      // Clear the process-global current pointer only when it pointed at this
      // project (mirrors the scoped-reset terminal state), so the fresh twin's
      // pre-sid traffic cannot follow it into the OLD twin's dir. The
      // per-instance pointers are kept — they are how the still-live twin's own
      // metadata-less traffic keeps routing to its own dir.
      if (this._currentSid) {
        const cur = this._sessions.get(this._currentSid);
        if (!cur || this._projKey(cur.project || '') === key) this._currentSid = null;
      }
      // DELIBERATELY NOT touched: _sessions, _claimedDirs, _adopted,
      // _currentSidByInstance.
    } catch (err) {
      reportSwallowed('v2-write.reset-relaunch', err);
    }
  }

  /**
   * Retire a CLOSED random-key SDK session (2026-11). Marks the instanceKey retired so
   * its late traffic stops moving the live pointers, and clears the per-instance routing
   * state the closed session held.
   *
   * Call ONLY from the explicit SDK close path (routes/resume.js, wasFreshKey===true) —
   * a random per-generation key is never re-created, so retirement is permanent and safe.
   * Never from a launch or initForWorkspace/resetForLiveRelaunch: a same-cwd sibling stays
   * LIVE and depends on its per-instance pointers surviving a relaunch.
   */
  retireInstance(instKey) {
    if (typeof instKey !== 'string' || !/^ccv-[0-9a-f]+$/.test(instKey)) return;
    this._retiredInstances.add(instKey);
    // Cap the append-only set (random keys never collide with a future generation).
    if (this._retiredInstances.size > 64) this._retiredInstances.delete(this._retiredInstances.values().next().value);
    // The retired instance's own routing state: its metadata-less traffic must not route
    // to its old sid, and any held cold-start bucket must never flush into the new dir.
    const prior = this._currentSidByInstance.get(instKey);
    this._currentSidByInstance.delete(instKey);
    this._pendingNoSidByInstance.delete(instKey);
    if (prior && this._currentSid === prior.sid) this._currentSid = null;
  }

  /**
   * Release a CLOSED instance's per-instance routing state WITHOUT retiring the key
   * (2026-11, same-cwd sibling close). Unlike retireInstance this does NOT add the key to
   * `_retiredInstances`: a DETERMINISTIC cwd-derived key is re-created by a later normal
   * relaunch, so retiring it would permanently gate the legitimate rebuilt session. Only
   * clears the closed instance's per-instance pointer + cold-start bucket so its draining
   * traffic stops moving the live pointers. Used by the SDK close path for wasFreshKey=false.
   */
  releaseInstance(instKey) {
    if (typeof instKey !== 'string' || !/^ccv-[0-9a-f]+$/.test(instKey)) return;
    const prior = this._currentSidByInstance.get(instKey);
    this._currentSidByInstance.delete(instKey);
    this._pendingNoSidByInstance.delete(instKey);
    if (prior && this._currentSid === prior.sid) this._currentSid = null;
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
