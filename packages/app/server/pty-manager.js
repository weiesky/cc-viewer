import { resolveNativePath, LOG_DIR } from '../findcc.js';
import { fileURLToPath } from 'node:url';
import { join, dirname, sep } from 'node:path';
import { chmodSync, statSync } from 'node:fs';
import { platform, arch, homedir } from 'node:os';
import { createRequire } from 'node:module';
import { prepareEmbeddedShellSpawn, stripClaudeNoFlickerUnlessOptedIn, applyClaudeAltScreenPref } from './lib/terminal-env.js';
import { killPtyTree } from './lib/term-signals.js';
import { findSafeSliceStart, splitTrailingIncomplete } from './lib/ansi-safe-slice.js';
import { resolveSpawnModel } from './lib/spawn-model-resolver.js';
import { mergeSettingsIntoArgs } from './lib/settings-merge.js';
import { projectKeyForCwd } from './lib/system-prompt-snapshots.js';
import { MODEL_PROMPT_DIR } from './lib/model-system-prompts.js';
import { randomBytes } from 'node:crypto';
// Launch-time system-prompt/thinking-display pipeline lives in lib/launch-config.js
// (shared with the SDK link). Re-exported here for existing consumers/tests.
import { withDefaultThinkingDisplay, resolveLaunchSystemPrompt, insertBeforeDashDash } from './lib/launch-config.js';
export { withDefaultThinkingDisplay } from './lib/launch-config.js';
import { reportSwallowed } from '@ccv/core/error-report';
import { t, tFor } from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Multi-PTY (2026-10): the module used to manage a SINGLE main PTY via module-level
// singletons (`let ptyProcess` + companions). To run parallel projects — each
// activated project's claude keeps running in the background while the main view
// attaches to one of them — the per-PTY state now lives in a Map, plus an
// `activePtyKey` pointer naming the PTY the main view is attached to. Every
// existing no-arg export (writeToPty / resizePty / killPty / getPtyState / ...) keeps its
// signature and operates on the ACTIVE entry, so all current callers (terminal WS, DingTalk
// bridge, chat-queue, theme sync, getClaudePid) are byte-compatible in the single-PTY case.
//
// Map key = per-spawn `instanceKey` (2026-10-06, NOT cwd): the same cwd may host TWO
// concurrent processes (the user can deliberately run two claude/shell instances in one
// project dir), so cwd can no longer be the unique addressing key. Each spawn mints a fresh
// instanceKey; the real cwd is stored on the record (`record.cwd`) so basename/cwd
// reverse-lookups never depend on the key shape. A record's instanceKey is its identity for
// its whole lifetime — self-heal respawns reuse the SAME key via `_respawnInto`.
//
// Per-PTY record shape (one per instanceKey):
//   instanceKey, cwd, ptyProcess, ptyKind, ptySkipPermissions, lastExitCode, outputBuffer,
//   currentWorkspacePath, lastWorkspacePath, lastPtyCols, lastPtyRows,
//   batchBuffer, batchScheduled, sessionId
// `dataListeners` / `exitListeners` stay GLOBAL (single main view broadcasts to its SSE/WS
// clients); a PTY only flushes its output to them while it is the active one (see flushBatch).
const ptys = new Map();
// Key of the PTY the main view is attached to (null until the first spawn). All no-arg
// exports resolve their target through this.
let activePtyKey = null;
let dataListeners = [];
let exitListeners = [];
// In-flight guard for the main PTY spawn, now PER-PTY-KEY: the guard runs before
// `await getPty` and the record is assigned after the await, so two synchronously-arriving
// input messages could both pass the guard and double-spawn (the first pty loses its
// reference → leak + output cross-talk). A Map so concurrent spawns for DIFFERENT projects
// serialize independently instead of falsely blocking each other.
const _spawnInflight = new Map();
// cols/rows clamp range at the resize entry: the upper bound is wide enough (4K-display
// ultra-wide terminals), the lower bound is ≥2 cols/1 row to keep FitAddon's 2×1 (from a
// 0-size container) or a malformed client's NaN/negative from poisoning lastPtyCols/Rows.
const PTY_COLS_MIN = 2, PTY_COLS_MAX = 1000;
const PTY_ROWS_MIN = 1, PTY_ROWS_MAX = 1000;
const MAX_BUFFER = 200000;
// Trim hysteresis: once MAX_BUFFER is exceeded, trim once down to TRIM_TO rather than to
// MAX_BUFFER on every chunk — dropping the ~200KB slice reallocation frequency from once
// per chunk to once per ~20KB of new output.
const BUFFER_TRIM_TO = 180000;
let _ptyImportForTests = null;

// Mint a fresh per-spawn instanceKey. This is the PTY-map key: a crypto-random,
// collision-proof identifier decoupled from cwd, so the same cwd may host multiple
// concurrent records (2026-10-06). crypto.randomBytes (not Date.now/Math.random) keeps it
// unique even across rapid same-tick spawns and steering-test clocks.
function _mintInstanceKey() {
  return `ccv-${randomBytes(18).toString('hex')}`;
}

// Lazily create (or fetch) the per-PTY record for an instanceKey. Every per-PTY field that
// used to be a module singleton is initialized here so a record is always well-formed.
// `cwd` is set at spawn time (the real, persistent working dir) and never cleared on exit —
// reverse-lookups (basename / exact-cwd) read it, never the opaque key.
function _getOrInit(key) {
  let s = ptys.get(key);
  if (!s) {
    s = {
      instanceKey: key,        // the Map key, mirrored on the record for convenience
      cwd: null,               // real working dir (persistent; set at spawn, kept after exit)
      ptyProcess: null,
      ptyKind: null,             // 'claude' | 'shell' | null
      ptySkipPermissions: false,
      lastExitCode: null,
      outputBuffer: '',
      currentWorkspacePath: null,
      lastWorkspacePath: null,   // kept after exit, used for respawn shell
      lastPtyCols: 120,
      lastPtyRows: 30,
      batchBuffer: '',
      batchScheduled: false,
      sessionId: null,           // claude session uuid once its first turn mints one (fed via setPtySessionId)
    };
    ptys.set(key, s);
  }
  return s;
}

// Reverse index sessionId → PTY map key, so a chat send can be routed to the
// exact PTY whose claude owns that conversation (2026-10-05). Maintained by
// setPtySessionId; cleared when a record's sessionId is overwritten or reaped.
const sidToKey = new Map();

// Resolve the record the no-arg exports operate on: the ACTIVE one. Returns null when no
// PTY has ever spawned (so callers degrade to their pre-spawn no-op behavior).
function _active() {
  return activePtyKey != null ? (ptys.get(activePtyKey) || null) : null;
}

// Drop entries that have no live process and no buffered output — keeps the Map from
// growing one stale entry per spawned project over a long-lived server (mirrors
// scratch-pty-manager.maybeReap). Never reaps the ACTIVE entry.
function _maybeReap() {
  if (ptys.size <= 8) return;
  for (const [key, s] of ptys) {
    if (key === activePtyKey) continue;
    if (!s.ptyProcess && !s.outputBuffer) {
      if (s.sessionId) sidToKey.delete(s.sessionId);
      ptys.delete(key);
    }
  }
}

export function _setPtyImportForTests(fn) {
  _ptyImportForTests = fn;
}

// At spawn time, resolve the model id under the "currently effective config" for
// model-customized system prompt matching (resolveSpawnModel: merged --settings launch
// object > env CLAUDE_MODEL/ANTHROPIC_MODEL > settings.json > active third-party proxy
// profile model mapping; no live config signal → null → no model entry injected).
// The old criterion read lastModelUsage from ~/.claude.json — that is usage stats from the
// previous session, not config, so a stale record could force the third-party model's
// override prompt onto an official-model session (review round: deepseek residual-record
// incident). The NODE_TEST_CONTEXT barrier is kept: resolveSpawnModel reads process.env
// model vars, so a dev-machine shell export could leak into unit tests (machine-state
// dependency); tests inject explicitly via _setSpawnModelReaderForTests. env/reader/opts
// are parameterized only for testability (see the guard unit test in
// packages/app/test/pty-manager.test.js).
export function _defaultSpawnModelReader(c, env = process.env, reader = resolveSpawnModel, opts) {
  return env.NODE_TEST_CONTEXT ? null : reader(c, env, opts);
}
let _spawnModelReader = _defaultSpawnModelReader;
export function _setSpawnModelReaderForTests(fn) {
  _spawnModelReader = fn || _defaultSpawnModelReader;
}

// Boot-fallback clock and window: a death within the window after spawn is treated as a
// "boot-period death". Real boot crashes are <1s, so 5s is plenty; a longer window only
// widens the false-positive surface for "user quickly exits on purpose" (review value).
// _now is injectable: the fallback tests need to steer the clock to simulate "exits after
// surviving past the window".
const SYS_PROMPT_BOOT_WINDOW_MS = 5000;
let _now = Date.now;
export function _setNowForTests(fn) {
  _now = fn || Date.now;
}

async function getPty() {
  if (typeof _ptyImportForTests === 'function') {
    return _ptyImportForTests();
  }
  const ptyMod = await import('node-pty');
  return ptyMod.default || ptyMod;
}

// ANSI-safe slice start: the implementation moved to lib/ansi-safe-slice.js (anchor-scan
// algorithm; see that file's doc). Kept exported from this module — server.js destructures
// it for the flood rate-limiter and unit tests import it from here.
export { findSafeSliceStart };

// DEC Private Mode 2026 (Synchronized Output) markers.
// xterm.js 6.0+ supports these natively: it buffers all writes after BEGIN and renders once
// on END, eliminating mid-batch frame flicker. Terminals that do not support them ignore
// the sequences.
const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END   = '\x1b[?2026l';

// Flush a record's batched PTY output to the global dataListeners — but ONLY while that
// record is the ACTIVE one (single main view): two concurrent projects' output must never
// interleave onto the one terminal stream. A background (non-active) record still
// accumulates outputBuffer/batchBuffer so it can be re-attached later; it just doesn't
// broadcast. `force` flushes the trailing half-sequence carry (process exit).
function flushBatch(s, force = false) {
  s.batchScheduled = false;
  if (!s.batchBuffer) return;
  // Batch-boundary half-sequence carry: every batch is wrapped in SYNC markers, so if a
  // batch boundary splits an escape sequence the injected markers would eat its ESC and
  // render the tail literally (the root cause of fragments like `[9m`/`8;2;102m`). The
  // half tail is carried to the next batch (PTY continuation always completes it); when
  // force=true (process exit) nothing is carried and all residue is flushed.
  let safe = s.batchBuffer;
  let carry = '';
  if (!force) [safe, carry] = splitTrailingIncomplete(s.batchBuffer);
  s.batchBuffer = carry;
  if (!safe) return;
  if (s !== _active()) return; // background PTY: buffered for later re-attach, not broadcast
  const chunk = SYNC_BEGIN + safe + SYNC_END;
  for (const cb of dataListeners) {
    try { cb(chunk); } catch { }
  }
}

// Inject a synthetic notice line into the embedded terminal (not claude output). Appending
// to the record's outputBuffer lets newly-connected / reconnected clients see it in the
// snapshot (server.js's data-resync reads getOutputBuffer), then broadcast live to the
// current dataListeners (only while the record is active).
function emitSpawnNotice(s, line) {
  const chunk = `\x1b[2m${line}\x1b[0m\r\n`;
  s.outputBuffer += chunk;
  if (s !== _active()) return;
  for (const cb of dataListeners) {
    try { cb(SYNC_BEGIN + chunk + SYNC_END); } catch { }
  }
}

// Use createRequire().resolve rather than join(__dirname, '..', 'node_modules', ...) —
// when pnpm / yarn workspaces hoist node-pty into an upper node_modules the relative path
// would not resolve, silently failing chmod → EACCES when running the PTY, with no log to
// debug.
function fixSpawnHelperPermissions() {
  const os = platform();
  const cpu = arch();
  const subPath = `node-pty/prebuilds/${os}-${cpu}/spawn-helper`;
  let helperPath;
  try {
    const req = createRequire(import.meta.url);
    helperPath = req.resolve(subPath);
  } catch (err) {
    // node-pty not installed / no prebuild for this platform: skip; spawn will raise its
    // own error
    return;
  }
  try {
    const stat = statSync(helperPath);
    if (!(stat.mode & 0o111)) {
      chmodSync(helperPath, stat.mode | 0o755);
    }
  } catch (err) {
    console.warn('[cc-viewer] fixSpawnHelperPermissions failed:', helperPath, err?.message || err);
  }
}

// withDefaultThinkingDisplay / parseResumeArgs / materializePinnedEntries /
// suppressManuallyFlaggedPinned / injectionConfigured have moved to lib/launch-config.js
// (the SDK path shares the same launch-config pipeline); withDefaultThinkingDisplay is kept
// compatible via the top re-export.

// Always try injecting `--thinking-display summarized` by default; if the target claude (or
// a claude-compatible CLI/fork/wrapper) does not recognize the flag, spawnClaude's onExit
// detects the "unknown option" error, marks claudePath into this set, and skips injection
// on the next spawn — based entirely on live runtime feedback, not version numbers or
// brand.
const _thinkingDisplayRejectedPaths = new Set();

// CC_SYSTEM.md / CC_APPEND_SYSTEM.md in the launch dir are auto-injected as
// --system-prompt-file/--append-system-prompt-file. If the target claude (or third-party
// fork/wrapper) does not recognize the flag, onExit detects "unknown option" and records
// claudePath into this set; the next spawn skips injection and restarts without the flag
// (self-heals like _thinkingDisplayRejectedPaths). Semantics: permanent (process-level) —
// "unknown option" is a deterministic capability signal that this binary does not support
// the flag.
const _systemPromptFileRejectedPaths = new Set();

// One-shot skip token: the relaxed branch of boot-fallback tier 1 (non-signal exit≠0
// within the boot window) covers **transient** crashes (expired API key / network jitter /
// an unrelated instant exit) and must not be written into the permanent rejection set
// above — otherwise a single transient fault would silently disable injection for that
// binary for the whole ccv process lifetime (review P1). The token is consumed (delete) on
// the next spawn: guaranteeing exactly one de-injection retry, after which normal injection
// attempts resume.
const _skipInjectionOncePaths = new Set();

// Suppress one injection notice on internal restarts (-c retry / flag self-heal) so the
// terminal does not print the same line repeatedly.
let _suppressNextSpawnNotice = false;

// ─── System-prompt pinning (resume launches must not re-render variables) ────────
// Re-rendering ${...} variables on a `-c`/`-r` launch makes the system text diverge
// byte-for-byte from the resumed conversation's original → the entire prompt-prefix
// KV cache is invalidated. Instead, pin the content the RESUMED conversation was
// launched with:
//   target identified + snapshot record → re-inject the recorded bytes verbatim
//     (build+render skipped entirely);
//   target identified + no record      → inject NOTHING this launch (never alter the
//     system text an existing context already has);
//   target unidentifiable (-c with no transcripts, bare -r picker) → normal pipeline.
// Store/binding semantics: server/lib/system-prompt-snapshots.js header.
// Implementation: lib/launch-config.js (resolveLaunchSystemPrompt).

// Test/internal only: clear the rejection set
export function _clearThinkingDisplayRejectedPaths() {
  _thinkingDisplayRejectedPaths.clear();
}

// Test only: query whether a path has been marked unsupported
export function _isThinkingDisplayRejected(claudePath) {
  return _thinkingDisplayRejectedPaths.has(claudePath);
}

// Test only: force a path into the rejection set, bypassing the first crash
export function _markThinkingDisplayRejected(claudePath) {
  _thinkingDisplayRejectedPaths.add(claudePath);
}

// Test/internal only: clear the system-prompt-file rejection set (along with the
// one-shot skip tokens, keeping cases clean)
export function _clearSystemPromptFileRejectedPaths() {
  _systemPromptFileRejectedPaths.clear();
  _skipInjectionOncePaths.clear();
}

// Test only: query whether a path has been marked unsupported for --system-prompt-file
export function _isSystemPromptFileRejected(claudePath) {
  return _systemPromptFileRejectedPaths.has(claudePath);
}

export async function spawnClaude(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null) {
  // Mint a FRESH instanceKey for every spawn: the same cwd may host multiple concurrent
  // records (2026-10-06), so we never reuse a cwd-derived key nor kill an existing same-cwd
  // record here. (Self-heal / -c / injection-fallback RESPAWNS are different — they must
  // reuse the SAME record/key, so they go through `_respawnInto`, not this public entry.)
  // WARNING: this is the DELIBERATE-multi-instance entry — every call starts a NEW process
  // even if one is already running for `cwd`. Callers that mean "re-open = reuse the live
  // one" (e.g. the workspace launch route) must go through `ensurePtyForCwd` instead, or they
  // will silently leak a duplicate process.
  const key = _mintInstanceKey();
  // Serialize concurrent spawns FOR THIS KEY (a fresh key means cross-instance spawns never
  // falsely block each other; same-key contention only arises from a respawn racing a spawn).
  while (_spawnInflight.has(key)) { try { await _spawnInflight.get(key); } catch { } }
  const p = _spawnClaudeImpl(key, proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
  _spawnInflight.set(key, p);
  try { return await p; } finally { if (_spawnInflight.get(key) === p) _spawnInflight.delete(key); }
}

// Self-heal respawn: re-run claude in the SAME record (same instanceKey) after a boot crash
// / -c miss / rejected injection. Reusing the key keeps the record's identity (and its
// sidToKey mapping once a sid resolves) stable across the retry — a fresh key would orphan
// the old record and leave sidToKey pointing at a dead key, severing chat routing.
function _respawnInto(key, proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null) {
  const p = _spawnClaudeImpl(key, proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
  _spawnInflight.set(key, p);
  return p.finally(() => { if (_spawnInflight.get(key) === p) _spawnInflight.delete(key); });
}

async function _spawnClaudeImpl(key, proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null) {
  const s = _getOrInit(key);
  // NOTE: activePtyKey is set AFTER pty.spawn succeeds (below), not here — under
  // concurrent spawns for DIFFERENT projects, the active PTY must be the one whose
  // spawn actually completed (and completed LAST), not merely the one called last.
  const pty = await getPty();

  fixSpawnHelperPermissions();

  // If claudePath was not provided, prefer the launcher-verified executable
  // (cli.js probes resolvePreferredClaudeSelection at boot and pins it into
  // CCV_CLAUDE_EXECUTABLE — e.g. a CodeFuse-managed build that this machine's
  // security policy allows). Falling straight to resolveNativePath() can
  // re-resolve to a DIFFERENT binary (the npm global install) that the
  // launcher's selection had deliberately passed over — on managed machines
  // that binary gets SIGKILLed on exec (Gatekeeper/EDR allowlisting), so a
  // workspace launch dies instantly and the terminal falls back to a bare
  // shell (the "[+] new project never starts claude" bug).
  if (!claudePath) {
    const pinned = process.env.CCV_CLAUDE_EXECUTABLE;
    if (pinned && typeof pinned === 'string') {
      try { if (statSync(pinned).isFile()) claudePath = pinned; } catch { }
    }
    if (!claudePath) claudePath = resolveNativePath();
    if (!claudePath) {
      throw new Error('claude not found');
    }
  }

  const env = { ...process.env };
  // CCV owns executable selection. Never let the selected Claude replace itself
  // behind that configuration (especially on enterprise allowlisted machines).
  env.DISABLE_AUTOUPDATER = '1';
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  env.CCV_PROXY_MODE = '1'; // tell interceptor.js not to start a server again
  env.CCV_LOG_DIR = LOG_DIR; // let the forked Claude Code process find the same
  // profile.json etc. resources
  // Self-report project (2026-10, multi-PTY): every main-PTY claude ALSO tags its
  // requests with `x-ccv-project-dir` = its own cwd, so the writer routes its
  // writes to ITS project — not the (possibly re-bound) server project. This is
  // what lets a kept-alive OLD project's background claude keep writing to its
  // own dir after the server binding moves away. Strip CR/LF/control chars
  // defensively (header values may not contain them).
  {
    const headerCwd = String(cwd || process.cwd()).replace(/[\r\n\x00-\x1f\x7f]/g, '');
    if (headerCwd) {
      const projectHeader = `x-ccv-project-dir: ${headerCwd}`;
      env.ANTHROPIC_CUSTOM_HEADERS = env.ANTHROPIC_CUSTOM_HEADERS
        ? `${env.ANTHROPIC_CUSTOM_HEADERS}\n${projectHeader}`
        : projectHeader;
    }
  }
  // Self-report instance (2026-10-06, multi-instance): alongside the project dir, tag every
  // request with this PTY's own instanceKey (`x-ccv-instance`) so the interceptor/writer can
  // pin the request — and later its resolved sessionId — to THIS exact process. This is what
  // disambiguates two concurrent claude instances sharing one cwd (basename routing cannot
  // tell them apart). Strip CR/LF/control chars defensively (header values may not contain
  // them); the instanceKey is internally minted (`ccv-<hex>`) so it is already header-safe.
  {
    const instHeader = String(key || '').replace(/[\r\n\x00-\x1f\x7f]/g, '');
    if (instHeader) {
      const instanceHeader = `x-ccv-instance: ${instHeader}`;
      env.ANTHROPIC_CUSTOM_HEADERS = env.ANTHROPIC_CUSTOM_HEADERS
        ? `${env.ANTHROPIC_CUSTOM_HEADERS}\n${instanceHeader}`
        : instanceHeader;
    }
  }
  // Strip cc-viewer's internal short-circuit switch so it does not leak to the claude child
  delete env.CCV_SKIP_THINKING_DISPLAY;
  // Strip server-only mode markers: a spawned claude (especially teammate subprocesses,
  // which install a fetch hook) is not the ccv server — inheriting CCV_WORKSPACE_MODE would
  // leave the interceptor's workspace binding permanently empty (teammate role assignment
  // silently fails); CCV_ELECTRON_MULTITAB likewise should only be held by the server
  // process (im-process-manager already strips the same for IM workers).
  delete env.CCV_WORKSPACE_MODE;
  delete env.CCV_ELECTRON_MULTITAB;
  // Claude Code's NO_FLICKER makes the embedded xterm use the alt screen and lose
  // scrollback. cc-viewer strips the inherited value by default; set
  // CCV_KEEP_CLAUDE_CODE_NO_FLICKER=1 explicitly when it is actually needed.
  stripClaudeNoFlickerUnlessOptedIn(env);
  // Newer Claude Code renders fullscreen by default (in-place redraw of the whole screen) →
  // the terminal is left with one screen and no scroll-back into history. cc-viewer
  // injects CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1 by default so claude returns to classic
  // streaming rendering with scrollable history; users who want fullscreen flicker-free
  // rendering opt out with CCV_KEEP_CLAUDE_FULLSCREEN=1.
  applyClaudeAltScreenPref(env);

  // Resolve real Node.js path (Electron's process.execPath is the Electron binary)
  let nodePath = process.execPath;
  if (process.versions.electron) {
    const { execSync } = await import('node:child_process');
    try {
      nodePath = execSync(process.platform === 'win32' ? 'where node' : 'which node', { encoding: 'utf-8', windowsHide: true }).trim();
      if (process.platform === 'win32') nodePath = nodePath.split('\n')[0].trim();
    } catch {
      nodePath = process.platform === 'win32' ? 'node' : '/usr/local/bin/node';
    }
  }

  // Override EDITOR/VISUAL to use built-in FileContentView
  if (serverPort) {
    const editorScript = join(__dirname, 'lib', 'ccv-editor.js');
    env.EDITOR = `${nodePath} ${editorScript}`;
    env.VISUAL = env.EDITOR;
    env.CCV_EDITOR_PORT = String(serverPort);
    env.CCVIEWER_PORT = String(serverPort); // For ask-hook bridge
    env.CCVIEWER_PROTOCOL = serverProtocol; // For ask/perm-bridge (http vs https)
    if (internalToken) {
      // Anti-CSRF token for bridge → server calls (round-3 P1). Same shared
      // secret across ask / perm / turn-end bridges so server can route-check
      // header `X-CCViewer-Internal`. Loopback-only by design.
      env.CCVIEWER_INTERNAL_TOKEN = internalToken;
    }
  }

  // Disable Claude Code CLI mouse-event capture to preserve native text selection
  // (copy/paste) in the xterm panel. Without this, Claude enables SGR mouse tracking
  // (DECSET ?1000/1006) and steals the xterm's mouse events. ??= respects an explicit user
  // export (e.g. to see mouse events while debugging).
  env.CLAUDE_CODE_DISABLE_MOUSE ??= '1';

  // Inject ANTHROPIC_BASE_URL via --settings to guarantee it overrides what settings.json
  // contains. Only overrides env.ANTHROPIC_BASE_URL; other settings fields are untouched.
  const settingsObj = {
    env: {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL
    }
  };
  // Inject permissions.deny as a second line of defense for IM workers (skip-permissions;
  // see plan §security 3). Only appends deny rules (deny has the highest precedence and
  // only tightens, never loosens), so it does not break the user's existing permissions.
  // Note: under bypass mode whether deny is still honored depends on Claude Code's
  // behavior; the truly reliable enforcement layer is perm-bridge.js's PreToolUse deny
  // (CCV_IM_DENY). This is a best-effort defense-in-depth layer.
  if (process.env.CCV_IM_DENY === '1') {
    const home = homedir();
    settingsObj.permissions = {
      deny: [
        'Bash(sudo:*)', 'Bash(rm -rf:*)', 'Bash(rm -fr:*)',
        'Bash(git push:*)', 'Bash(npm publish:*)', 'Bash(ssh:*)', 'Bash(scp:*)',
        `Read(${home}/.ssh/**)`, `Edit(${home}/.ssh/**)`, `Write(${home}/.ssh/**)`,
        `Read(${home}/.aws/**)`, `Edit(${home}/.aws/**)`, `Write(${home}/.aws/**)`,
        // File-precise: protect the deny mechanism itself (settings/hooks), the IM
        // credential store (preferences.json), and the credential vault (credentials.json +
        // master.key), but do not block all of ~/.claude — the worker's working directory
        // sits under ~/.claude/cc-viewer/IM_<id>/ and must stay writable.
        `Edit(${home}/.claude/settings.json)`, `Write(${home}/.claude/settings.json)`,
        `Edit(${home}/.claude/settings.local.json)`, `Write(${home}/.claude/settings.local.json)`,
        `Edit(${home}/.claude/cc-viewer/preferences.json)`, `Write(${home}/.claude/cc-viewer/preferences.json)`,
        `Read(${home}/.claude/cc-viewer/credentials.json)`, `Edit(${home}/.claude/cc-viewer/credentials.json)`, `Write(${home}/.claude/cc-viewer/credentials.json)`,
        `Read(${home}/.claude/cc-viewer/master.key)`, `Edit(${home}/.claude/cc-viewer/master.key)`, `Write(${home}/.claude/cc-viewer/master.key)`,
        // Backup copies of the vault (cc-viewer-config-backups/<ts>/) hold the same decryption
        // kit (credentials.json + master.key) — deny the whole subtree or an IM worker could read
        // a rolled backup and decrypt every secret.
        `Read(${home}/.claude/cc-viewer-config-backups/**)`, `Edit(${home}/.claude/cc-viewer-config-backups/**)`, `Write(${home}/.claude/cc-viewer-config-backups/**)`,
      ],
    };
  }
  // Inject --thinking-display summarized; skip injection when either of these holds:
  // - the path is in the rejection set (it crashed because of this last time)
  // - env CCV_SKIP_THINKING_DISPLAY=1 (user global opt-out, consistent with cli.js)
  const shouldInjectThinkingDisplay = !_thinkingDisplayRejectedPaths.has(claudePath)
    && process.env.CCV_SKIP_THINKING_DISPLAY !== '1';

  // Fold any user-supplied --settings into the injected settings so the final argv
  // carries a SINGLE --settings flag. claude is last-wins for duplicate --settings
  // (empirically verified), so a user flag sitting after ours would silently clobber
  // the injected ANTHROPIC_BASE_URL proxy override and the CCV_IM_DENY deny hardening.
  // Merged: injected keys win, deny is unioned, other user config rides along.
  // Runs on the RAW user args BEFORE our own --thinking-display / --system-prompt-file
  // tokens are appended: otherwise a trailing valueless user --settings would consume
  // an injected token as its value, silently dropping the injection. Relative settings
  // paths resolve against the cwd claude itself runs with (spawnDir, computed below).
  const spawnDir = cwd || process.cwd();
  const settingsMerge = mergeSettingsIntoArgs(extraArgs, settingsObj, { cwd: spawnDir });
  if (settingsMerge.warningDetail) {
    console.warn(`[CC Viewer] ${tFor('cli.settingsMergeFailed', 'en', settingsMerge.warningDetail)}`);
  }
  const settingsJson = settingsMerge.settingsJson;
  const userArgs = settingsMerge.args;
  const finalExtraArgs = shouldInjectThinkingDisplay ? withDefaultThinkingDisplay(userArgs) : userArgs;

  // When the launch dir has a non-empty CC_SYSTEM.md / CC_APPEND_SYSTEM.md, auto-append
  // --system-prompt-file / --append-system-prompt-file (each independent; skipped if the
  // user already passed the synonymous flag). Model customization: fuzzy-match against
  // <cwd>/system_prompt/ and <LOG_DIR>/system_prompt/ using the model id resolved from the
  // ACTIVE configuration (proxy profile mapping > env > settings.json); a matched entry
  // (user file first, then built-in presets) wholly replaces the two default sentinels above.
  // Note: currentWorkspacePath is only assigned below, so the cwd param decides the launch
  // dir here. Spawns inside LOG_DIR (IM worker working dir = <LOG_DIR>/IM_<id>/) skip model
  // matching: the IM persona relies on the default sentinel CC_APPEND_SYSTEM.md injection,
  // and a global model entry must not silently replace it. (spawnDir was already assigned
  // at the settings merge above.) insideLogDir stays outside the try: the onExit boot
  // fallback gating below also uses it.
  const insideLogDir = spawnDir === LOG_DIR || spawnDir.startsWith(LOG_DIR + sep);
  // The whole system-prompt build + render pipeline is wrapped in try-catch (PR#128): any
  // unexpected throw (model resolution, a buildSystemPromptFileArgs filesystem race, a
  // render git-subprocess error) falls back to treating it as "no entry matched" — the
  // launch carries no --system-prompt-file/--append-system-prompt-file and claude starts
  // with its own default system prompt. An injection failure must never block the spawn.
  let sysPrompt = { args: [], loaded: [], model: null, entries: [] };
  // The skip-once token is consumed unconditionally BEFORE the pipeline (exactly-once
  // semantics — a leftover token would silently skip the NEXT spawn's injection too).
  const skipOnce = _skipInjectionOncePaths.delete(claudePath);
  try {
    // The whole system-prompt pipeline (resume pin / fresh sentinel+model match /
    // ${...} render / pending record for wire-side Bind A) lives in
    // lib/launch-config.js, shared with the SDK link. PTY-side inputs here: the
    // rejected-binary set + skip-once token (suppressInjection) and the test-seam
    // model reader. settingsJson is always valid JSON (from mergeSettingsIntoArgs).
    const r = resolveLaunchSystemPrompt({
      spawnDir,
      extraArgs: finalExtraArgs,
      env: process.env,
      launchSettings: JSON.parse(settingsJson),
      modelReader: (d, e, o) => _spawnModelReader(d, e, resolveSpawnModel, o),
      insideLogDir,
      logDir: LOG_DIR,
      suppressInjection: _systemPromptFileRejectedPaths.has(claudePath) || skipOnce,
    });
    sysPrompt = r.sysPrompt;
    if (r.diagnostic === 'builtin-disabled') {
      console.warn(`[CC Viewer] model-specific prompt: built-in prompt "${r.sysPrompt.builtinDisabled}" for modelId="${r.resolvedModelId}" is disabled via .builtin-disabled.json in the workspace or global ${MODEL_PROMPT_DIR}/ — falling back to defaults`);
    } else if (r.diagnostic === 'no-match') {
      console.warn(`[CC Viewer] model-specific prompt: modelId="${r.resolvedModelId}" resolved from active config but no matching entry found in workspace or global ${MODEL_PROMPT_DIR}/`);
    } else if (r.diagnostic === 'no-model') {
      console.warn(`[CC Viewer] model-specific prompt: no model id resolved from active config (--settings / env / settings.json / proxy profile) — entries in ${MODEL_PROMPT_DIR}/ skipped for this launch`);
    }
  } catch (err) {
    console.warn('[CC Viewer] system prompt build/render failed, launching without injected prompt:', err?.message || err);
    sysPrompt = { args: [], loaded: [], model: null, entries: [] };
  }
  // Inject the system-prompt args before a literal `--` (tokens after it are prompt text
  // and would swallow a flag), and relocate `--thinking-display` out of the prompt region
  // too. Shared with the headless run link via launch-config.js so both spawn paths keep
  // the same byte order.
  const launchArgs = sysPrompt.args.length || finalExtraArgs.includes('--thinking-display')
    ? insertBeforeDashDash(finalExtraArgs, sysPrompt.args)
    : finalExtraArgs;

  let command = claudePath;
  let args = ['--settings', settingsJson, ...launchArgs];

  // If it is the npm version (cli.js), it must run under node
  if (isNpmVersion && claudePath.endsWith('.js')) {
    command = nodePath;
    args = [claudePath, '--settings', settingsJson, ...launchArgs];
  }

  s.lastExitCode = null;
  s.outputBuffer = '';
  s.currentWorkspacePath = cwd || process.cwd();
  s.lastWorkspacePath = s.currentWorkspacePath;
  // Persist the real cwd on the record (2026-10-06): the Map key is now an opaque
  // instanceKey, so basename/cwd reverse-lookups must read this field, never the key.
  s.instanceKey = key;
  s.cwd = s.currentWorkspacePath;
  // A (re)spawn starts a fresh conversation — drop any sessionId a prior life
  // on this record resolved to, so a stale sid never misroutes a send.
  if (s.sessionId) { sidToKey.delete(s.sessionId); s.sessionId = null; }
  // Boot-window anchor for the injection fallback tiers below (same clock as the
  // comparison — _now(), never Date.now(), so tests can steer both ends together).
  const spawnedAt = _now();

  s.ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: s.lastPtyCols,
    rows: s.lastPtyRows,
    cwd: s.currentWorkspacePath,
    env,
  });
  // This spawn SUCCEEDED — it becomes the main view's active PTY. Set here (after
  // pty.spawn returns) so that under concurrent spawns for different projects the
  // active PTY is the one whose spawn completed LAST, not the one invoked last.
  activePtyKey = key;
  s.ptyKind = 'claude';
  // --allow-dangerously-skip-permissions only enables a later toggle, so it must NOT count.
  s.ptySkipPermissions = extraArgs.includes('--dangerously-skip-permissions');

  // PTY event handlers must be registered immediately after spawn (PR#128): if the child
  // exits before onExit is mounted (missing binary / instant crash / rejected injection
  // flag), the exit event is lost — after the handle is released the event loop may drain.
  // The injection notice is moved to after registration.
  s.ptyProcess.onData((data) => {
    s.outputBuffer += data;
    if (s.outputBuffer.length > MAX_BUFFER) {
      const rawStart = s.outputBuffer.length - BUFFER_TRIM_TO;
      const safeStart = findSafeSliceStart(s.outputBuffer, rawStart);
      s.outputBuffer = s.outputBuffer.slice(safeStart);
    }
    s.batchBuffer += data;
    if (!s.batchScheduled) {
      s.batchScheduled = true;
      setImmediate(() => flushBatch(s));
    }
  });

  s.ptyProcess.onExit(({ exitCode, signal }) => {
    flushBatch(s, true);
    s.lastExitCode = exitCode;
    s.ptyProcess = null;
    s.ptyKind = null;
    s.ptySkipPermissions = false;
    // Boot-period death: an exit within the window after spawn. Any exit outside the window
    // is never part of the "injection dragged the boot into a crash" fallback scope. A
    // single _now() read (review): tiers 1/2 share the same instant, so the injected fake
    // clock cannot diverge between branches.
    const elapsedMs = _now() - spawnedAt;
    const diedInBootWindow = elapsedMs < SYS_PROMPT_BOOT_WINDOW_MS;

    // Auto-retry without -c/--continue if "No conversation found"
    // Note: an early return skips the exitListeners broadcast below — the first failed pty's
    // death is transparent to consumers. Once the new pty starts normally it reports its own
    // state/exit. This keeps the frontend from seeing a spurious exit event.
    const hasContinue = extraArgs.includes('-c') || extraArgs.includes('--continue');
    if (hasContinue && exitCode !== 0 && s.outputBuffer.includes('No conversation found')) {
      console.error('[CC Viewer] -c failed (no conversation), retrying without -c');
      const retryArgs = extraArgs.filter(a => a !== '-c' && a !== '--continue');
      _suppressNextSpawnNotice = true;
      // Respawn into the SAME record/key (closure-captured), not a fresh spawn — keeps the
      // record identity + future sid mapping stable across the retry.
      _respawnInto(key, proxyPort, cwd, retryArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
      return;
    }

    // Post-hoc fallback: if we injected --thinking-display and claude crashed with "unknown
    // option", add that claudePath to the rejection set and restart once without the flag —
    // this self-heals older claude / third-party CLI forks / GLM wrappers. Only triggers in
    // the "we injected it" case: extraArgs lacks the flag but finalExtraArgs has it → it was
    // injected; a crash from the user's own --thinking-display is left alone to avoid
    // overriding user intent. Like the -c retry, an early return skips the exitListeners
    // broadcast so the first spurious failure is transparent to consumers.
    const weInjectedFlag = shouldInjectThinkingDisplay
      && !extraArgs.some(a => a === '--thinking-display' || (typeof a === 'string' && a.startsWith('--thinking-display=')));
    const flagRejected = weInjectedFlag && exitCode !== 0
      && /unknown option ['"]--thinking-display/i.test(s.outputBuffer);
    if (flagRejected) {
      console.error('[CC Viewer] claude rejected --thinking-display, marking as unsupported and retrying without flag');
      _thinkingDisplayRejectedPaths.add(claudePath);
      _suppressNextSpawnNotice = true;
      _respawnInto(key, proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
      return;
    }

    // Post-hoc fallback tier 1: when a claude that had a system-prompt file injected dies
    // abnormally, skip injection and restart once (aligned with the --thinking-display
    // self-heal above; this confirmed branch must come first — with a user-supplied
    // --thinking-display plus injection, this wastes at most one de-injection retry, then
    // the second time broadcasts the real error). The two branches have **different
    // persistence**:
    //  - exact branch (original semantics): output contains "unknown option
    //    --system-prompt-file" — confirms this binary does not support the flag (a stable
    //    capability signal) → write the permanent rejection set; heals in every scenario
    //    (including IM workers, which would otherwise never start).
    //  - relaxed branch (boot fallback): exit≠0 within the boot window — the injection
    //    **may** be what dragged the boot into a crash (or it may be an unrelated transient
    //    fault) → emit only a one-shot skip token, never write the permanent set (review
    //    P1: a single transient crash must not silently disable injection for the whole
    //    process lifetime). Gated by !signal (user Ctrl-C / closing a tab / switching
    //    workspace via killPtyTree are signal terminations, not boot crashes — blindly
    //    restarting would force-pull a session the user just closed; Windows ConPTY has no
    //    POSIX signal semantics — known limitation: Ctrl-C may cause one harmless extra
    //    retry) and !insideLogDir (an IM worker's "de-injection restart" = surviving after
    //    stripping the CC_APPEND_SYSTEM.md persona, which is harder to debug than a crash —
    //    an IM instant exit only broadcasts the real error).
    // No infinite loop: on respawn the rejection set / token empties loaded → this branch
    // no longer hits, retrying exactly once.
    // Tier-1 retry only removes the injection, leaving the rest of the args as-is; when the
    // root cause is something else (e.g. an expired API key), the first error already
    // streamed into the terminal scrollback without loss, and the second death broadcasts
    // as usual.
    const unknownSysFileFlag = /unknown option ['"]--(append-)?system-prompt-file/i.test(s.outputBuffer);
    const injectedBootCrash = !insideLogDir && !signal && diedInBootWindow;
    const sysFileRejected = sysPrompt.loaded.length > 0 && exitCode !== 0
      && (unknownSysFileFlag || injectedBootCrash);
    if (sysFileRejected) {
      if (unknownSysFileFlag) {
        console.error('[CC Viewer] claude rejected --system-prompt-file, marking as unsupported and retrying without injection');
        _systemPromptFileRejectedPaths.add(claudePath);
      } else {
        console.error(`[CC Viewer] claude exited (code ${exitCode}) ${Math.round(elapsedMs / 1000)}s after launch with injected system prompt (${sysPrompt.loaded.join(', ')}); retrying once without injection`);
        _skipInjectionOncePaths.add(claudePath);
      }
      _suppressNextSpawnNotice = true;
      // Wording leaves room (review): a boot-period death may be unrelated to the injection
      // (API key / network etc.); do not assert causation.
      emitSpawnNotice(s, `[CC Viewer] claude exited during boot (code ${exitCode}); the injected system prompt may or may not be the cause — retrying once without ${sysPrompt.loaded.join(', ')}`);
      _respawnInto(key, proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
      return;
    }

    // Post-hoc fallback tier 2: injected and an instant exit with exit=0 — indistinguishable
    // from "the user quickly /exits" (a frequent daily action), so it only prints a
    // diagnostic, does not auto-restart, and does not touch the rejection set (auto-stop
    // would silently disable injection based on usage habits; rejected in review). It also
    // does not early-return — it broadcasts exit as usual, so the frontend exit-banner path
    // is exactly the same as a normal user /exit.
    // !insideLogDir: an IM worker's pty data stream may be relayed via the bridge, so the
    // diagnostic line must not leak into the IM session (review).
    if (sysPrompt.loaded.length > 0 && exitCode === 0 && diedInBootWindow && !insideLogDir) {
      emitSpawnNotice(s, `[CC Viewer] claude exited ${Math.round(elapsedMs / 1000)}s after launch with an injected system prompt (${sysPrompt.loaded.join(', ')}). If this keeps happening the injected prompt may be incompatible — remove the entry or set CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 to skip injection.`);
    }

    // Keep lastWorkspacePath (do not clear) for respawn; also keep record.cwd (the persistent
    // real dir) so basename/cwd reverse-lookups still resolve this record after exit.
    s.currentWorkspacePath = null;
    // Only broadcast the ACTIVE PTY's exit to the global listeners. A background
    // (kept-alive, background) PTY exiting must not push the "exited" banner
    // into the foreground project's terminal, nor fire the whole-process cleanup
    // in codefuse mode. Background exits just record lastExitCode (listLivePtys
    // still observes them).
    if (s === _active()) {
      for (const cb of exitListeners) {
        try { cb(exitCode); } catch { }
      }
    }
  });

  // Print a notice line to the terminal when a system-prompt file was injected (visibility /
  // security); suppressed on internal restarts to avoid repetition. Must be printed after
  // onData/onExit are registered (PR#128) to shrink the window for losing the event when
  // the child exits before the handlers are mounted.
  if (sysPrompt.loaded.length && !sysPrompt.pinned && !_suppressNextSpawnNotice) {
    const modelSuffix = sysPrompt.model ? ` (model match: ${sysPrompt.model})` : '';
    emitSpawnNotice(s, `[CC Viewer] loaded ${sysPrompt.loaded.join(', ')} as system prompt${modelSuffix}`);
  }
  // Pin visibility: a snapshot hit re-injects verbatim; a no-record resume (F2)
  // injects nothing — surfaced ONLY when injection is configured right now
  // (noRecordNotice), otherwise the line would nag feature-less users on every -c.
  // Mutually exclusive with the loaded notice above (the pinned path never prints it).
  if (sysPrompt.pinned && !_suppressNextSpawnNotice) {
    if (sysPrompt.noRecord) {
      if (sysPrompt.noRecordNotice) emitSpawnNotice(s, `[CC Viewer] ${t('cli.systemPromptResumeNoSnapshot')}`);
    } else if (sysPrompt.loaded.length) {
      emitSpawnNotice(s, `[CC Viewer] ${t('cli.systemPromptPinned', { files: sysPrompt.loaded.join(', ') })}`);
    }
  }
  // Settings-merge failures surface via emitSpawnNotice too: console.warn only reaches
  // the server stdout, invisible in the embedded terminal. Localized here (the console.warn
  // above stays English for greppable server logs). Must be emitted after spawn — the
  // outputBuffer reset right before pty.spawn would swallow an earlier write.
  if (settingsMerge.warningDetail && !_suppressNextSpawnNotice) {
    emitSpawnNotice(s, `[CC Viewer] ${t('cli.settingsMergeFailed', settingsMerge.warningDetail)}`);
  }
  _suppressNextSpawnNotice = false;
  _maybeReap();

  return s.ptyProcess;
}

export function writeToPty(data) {
  const s = _active();
  if (s && s.ptyProcess) {
    s.ptyProcess.write(data);
    return true;
  }
  return false;
}

/**
 * Send chunks sequentially to PTY, waiting for PTY output between each.
 * Designed for programmatic input (multi-select, paste, etc.) where
 * the target application (e.g. inquirer) needs time to process each chunk.
 * @param {string[]} chunks - array of input strings to send in order
 * @param {Function} [onComplete] - called when all chunks are sent or on error
 * @param {object} [opts] - { timeoutMs: per-chunk timeout (default 4000), settleMs: delay after ACK (default 150) }
 */
export function writeToPtySequential(chunks, onComplete, opts = {}) {
  const timeoutMs = opts.timeoutMs || 4000;
  const settleMs = opts.settleMs || 150;
  const s = _active();

  if (!s || !s.ptyProcess || !chunks || chunks.length === 0) {
    if (onComplete) onComplete(false);
    return;
  }

  let idx = 0;
  let dataListener = null;

  const cleanup = () => {
    if (dataListener) {
      dataListeners = dataListeners.filter(l => l !== dataListener);
      dataListener = null;
    }
  };

  const sendNext = () => {
    if (idx >= chunks.length || !s.ptyProcess) {
      cleanup();
      // Report success only if every chunk was sent. A PTY that died mid-sequence (idx <
      // length) is a partial/failed injection — callers (e.g. the DingTalk bridge) must learn
      // this to avoid wedging on a turn that will never produce output.
      if (onComplete) onComplete(idx >= chunks.length);
      return;
    }

    const chunk = chunks[idx];
    idx++;

    // Defensive depth (server.js's entry already validates every(string); this is the second
    // line): a non-string chunk makes pty.write throw ERR_INVALID_ARG_TYPE, and the
    // chunk.endsWith below would also throw — inside a setTimeout context with no try/catch
    // that would become an uncaughtException that crashes the whole process. Uniformly catch
    // it and report a failure.
    if (typeof chunk !== 'string') {
      cleanup();
      if (onComplete) onComplete(false);
      return;
    }
    try {
      s.ptyProcess.write(chunk);
    } catch (e) {
      cleanup();
      if (onComplete) onComplete(false);
      return;
    }

    // Space, Enter, arrows need more time for inquirer to re-render
    const isToggleOrSubmit = chunk === ' ' || chunk === '\r'
      || chunk === '\x1b[C' || chunk === '\x1b[A' || chunk === '\x1b[B';
    // Bracket-paste end needs a frame for Ink to settle paste→normal state.
    const isPasteEnd = chunk.endsWith('\x1b[201~');
    const delay = (isToggleOrSubmit || isPasteEnd) ? settleMs : 80;
    setTimeout(sendNext, delay);
  };

  sendNext();
}

/**
 * After the process exits, auto-spawn an interactive shell so the terminal becomes usable
 * again. Returns true if spawned successfully, false if unnecessary or failed.
 */
// Module-level single in-flight guard for spawnShell. spawnShell normally derives its key
// from the CURRENT activePtyKey at call time — but when nothing is active yet (fresh server,
// or after a full reset), two concurrent calls would each mint a DIFFERENT instanceKey before
// the first reaches its `await getPty()`, so a per-key inflight map cannot dedupe them and
// two shells would open. A single shared promise serializes that whole spawn regardless of
// which key it lands on (there is only ever one "current shell" the terminal wants).
let _shellInflight = null;

// Per-cwd in-flight guard for the launch route's ensurePtyForCwd (2026-10-06). Unlike
// `_spawnInflight` (keyed by a freshly-minted instanceKey, so it cannot dedupe two concurrent
// spawns of the SAME cwd), this serializes the live-scan→spawn sequence per cwd so a duplicate
// process is not started by a double launch.
const _cwdLaunchInflight = new Map();

export async function spawnShell() {
  const s = _active();
  if (s && s.ptyProcess) return false; // a process is already running
  if (_shellInflight) return _shellInflight; // reuse the in-flight shell spawn to avoid a double-open
  // Reuse the ACTIVE record's key when there is one (shell re-opens into the dead claude's
  // record). Only when nothing has ever spawned do we mint a fresh instanceKey — never a
  // cwd-derived key (the Map is keyed by instanceKey, 2026-10-06; a cwd key would break the
  // "key is always an instanceKey" invariant).
  const key = activePtyKey != null ? activePtyKey : _mintInstanceKey();
  const p = (async () => {
    if (_spawnInflight.has(key)) return _spawnInflight.get(key);
    const inner = _spawnShellImpl(key);
    _spawnInflight.set(key, inner);
    try { return await inner; } finally { if (_spawnInflight.get(key) === inner) _spawnInflight.delete(key); }
  })();
  _shellInflight = p;
  try { return await p; } finally { if (_shellInflight === p) _shellInflight = null; }
}

async function _spawnShellImpl(key) {
  const s = _getOrInit(key);
  // activePtyKey set after pty.spawn succeeds (below), mirroring _spawnClaudeImpl.
  const cwd = s.lastWorkspacePath || s.cwd || process.cwd();

  const pty = await getPty();

  fixSpawnHelperPermissions();

  const shell = process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh');

  s.lastExitCode = null;
  s.currentWorkspacePath = cwd;
  // Persist identity on the record (mirrors _spawnClaudeImpl): the Map key is an opaque
  // instanceKey, so cwd must live on the record for basename/cwd reverse-lookups.
  s.instanceKey = key;
  s.cwd = cwd;

  // Clean env: remove cc-viewer specific vars so child shells don't inherit them
  // (prevents CCVIEWER_PORT/CCVIEWER_PROTOCOL leaking to non-cc-viewer Claude instances;
  // 115c48b added CCVIEWER_PROTOCOL but only updated spawnClaude; aligning here)
  const shellEnv = { ...process.env };
  delete shellEnv.CCVIEWER_PORT;
  delete shellEnv.CCV_EDITOR_PORT;
  delete shellEnv.CCVIEWER_PROTOCOL;
  delete shellEnv.CCVIEWER_INTERNAL_TOKEN;
  // Also disable the mouse for claude typed by hand in the interactive shell; same reason
  // as spawnClaude.
  shellEnv.CLAUDE_CODE_DISABLE_MOUSE ??= '1';
  // By default let a hand-typed claude in the shell also return to classic streaming render
  // (scrollable history); same reason as spawnClaude; CCV_KEEP_CLAUDE_FULLSCREEN=1 can opt
  // out.
  applyClaudeAltScreenPref(shellEnv);
  const shellSpawn = prepareEmbeddedShellSpawn(shell, shellEnv);

  s.ptyProcess = pty.spawn(shellSpawn.command, shellSpawn.args, {
    name: 'xterm-256color',
    cols: s.lastPtyCols,
    rows: s.lastPtyRows,
    cwd,
    env: shellSpawn.env,
  });
  activePtyKey = key; // spawn succeeded → becomes the active PTY
  s.ptyKind = 'shell';
  s.ptySkipPermissions = false;

  s.ptyProcess.onData((data) => {
    s.outputBuffer += data;
    if (s.outputBuffer.length > MAX_BUFFER) {
      const rawStart = s.outputBuffer.length - BUFFER_TRIM_TO;
      const safeStart = findSafeSliceStart(s.outputBuffer, rawStart);
      s.outputBuffer = s.outputBuffer.slice(safeStart);
    }
    s.batchBuffer += data;
    if (!s.batchScheduled) {
      s.batchScheduled = true;
      setImmediate(() => flushBatch(s));
    }
  });

  s.ptyProcess.onExit(({ exitCode }) => {
    flushBatch(s, true);
    s.lastExitCode = exitCode;
    s.ptyProcess = null;
    s.ptyKind = null;
    s.ptySkipPermissions = false;
    s.currentWorkspacePath = null;
    // Same active-scope guard as the main spawn's onExit: only the foreground
    // (active) PTY's exit is broadcast; a background shell exit stays silent.
    if (s === _active()) {
      for (const cb of exitListeners) {
        try { cb(exitCode); } catch { }
      }
    }
  });

  return true;
}

// cols/rows clamped to finite positive integers: FitAddon computes 2×1 in a 0-size
// container, and a malformed client may send NaN/0/negative — storing those unvalidated
// into lastPtyCols/Rows would poison a later pty.spawn (cols:NaN throws, spawnShell's
// exception is swallowed → the terminal never comes up, with no log). Non-finite values
// fall back to the last valid value.
function _clampDim(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function resizePty(cols, rows) {
  const s = _active();
  if (!s) return;
  s.lastPtyCols = _clampDim(cols, PTY_COLS_MIN, PTY_COLS_MAX, s.lastPtyCols);
  s.lastPtyRows = _clampDim(rows, PTY_ROWS_MIN, PTY_ROWS_MAX, s.lastPtyRows);
  if (s.ptyProcess) {
    try { s.ptyProcess.resize(s.lastPtyCols, s.lastPtyRows); } catch { }
  }
}

// Kill a specific record's PTY (the shared kill path for the no-arg killPty — active —
// and killPtyFor). Keeps the record (and its lastWorkspacePath / scrollback / cwd) so a
// later re-spawn / re-attach resumes cleanly.
function _killPtyRecord(s) {
  if (!s || !s.ptyProcess) return;
  flushBatch(s, true);
  s.batchBuffer = '';
  s.batchScheduled = false;
  // Windows: node-pty's ConPTY kill has a known synchronous-hang issue
  // (microsoft/node-pty#454); a hang would also take down the Ctrl+C exit-chain watchdog.
  // Instead use spawnSync taskkill /T /F to reap the whole process tree (ConPTY agent +
  // claude), bounded (timeout 2s) and providing "dead on return" semantics (which
  // spawnClaude's internal kill→respawn and workspaces stop→launch rely on). ptyProcess
  // .kill() is fully skipped on win32. Non-Windows behavior is unchanged.
  if (!killPtyTree(s.ptyProcess.pid)) {
    try { s.ptyProcess.kill(); } catch { }
  }
  s.ptyProcess = null;
  s.ptyKind = null;
  s.ptySkipPermissions = false;
}

export function killPty() {
  _killPtyRecord(_active());
}

/**
 * Kill a SPECIFIC project's main PTY (multi-PTY, 2026-10) — the per-project
 * counterpart of killPty()/killAllMain(), powering the web header's per-tab
 * close button (POST /api/live-processes/close). Resolution mirrors
 * attachPtyFor (exact match on the record's stored cwd, else project-name
 * reverse lookup). Never
 * spawns; the record (and its scrollback/lastWorkspacePath) is kept so a
 * later re-launch resumes cleanly — same semantics as _killPtyRecord.
 *
 * When the killed record was the ACTIVE one, the attachment re-anchors to
 * another still-RUNNING record (first in Map order) so the shared terminal
 * stream follows a live project instead of going dark; with none left alive
 * the key stays on the dead record (no-arg readers see running:false, the
 * same dead-state a natural exit produces). Records whose process already
 * exited are never re-anchor targets.
 *
 * @returns {{ ok:boolean, key?:string, killedActive?:boolean,
 *            reattachedTo?:string|null, reason?:string }}
 */
export function killPtyFor({ cwd, project, instanceKey } = {}) {
  // Multi-instance forced disambiguation (2026-10-06): a project-name-only close that matches
  // TWO concurrently-live same-basename records is ambiguous — killing "the first live one"
  // would kill an arbitrary process. Refuse and surface the live candidates so the caller
  // re-issues with an instanceKey. Single-match / instance-Keyed calls are unaffected.
  if (!instanceKey && typeof project === 'string' && project) {
    const live = _liveInstancesForProject(project);
    if (live.length > 1) return { ok: false, reason: 'ambiguous', candidates: live };
  }
  const key = _resolveKey({ cwd, project, instanceKey });
  if (!key) return { ok: false, reason: 'not-found' };
  const s = ptys.get(key);
  if (!s) return { ok: false, reason: 'not-found' };
  _killPtyRecord(s);
  const killedActive = key === activePtyKey;
  let reattachedTo = null;
  if (killedActive) {
    for (const [k, other] of ptys) {
      if (k !== key && other && other.ptyProcess) { reattachedTo = k; break; }
    }
    if (reattachedTo) activePtyKey = reattachedTo;
  }
  return { ok: true, key, killedActive, reattachedTo };
}

// Kill EVERY main PTY across all projects (workspaces stop / process teardown). The no-arg
// killPty only kills the ACTIVE one; a kept-alive background project's PTY must also be
// reaped or it leaks past the workspace session.
export function killAllMain() {
  for (const s of ptys.values()) _killPtyRecord(s);
}

/**
 * Resolve a PTY-map key from an exact `cwd` or a `project` name (reverse lookup
 * via projectKeyForCwd, the same mapping the live-processes route uses). Shared
 * by attachPtyFor / killPtyFor — returns null when nothing matches so callers
 * can degrade with their own not-found shape.
 *
 * The Map is keyed by an opaque `instanceKey` (2026-10-06), NOT cwd, so the exact-cwd
 * branch can no longer do `ptys.has(cwd)` — it scans records for a matching `record.cwd`.
 * A single cwd may host multiple live records (multi-instance); ties break
 * live-before-exited, then active-before-background (mirrors the basename branch).
 */
function _resolveKey({ cwd, project, instanceKey } = {}) {
  let key = null;
  // Multi-instance (2026-10-06): an exact instanceKey hits its record directly (the Map key).
  // Validated to the minted shape before use (defense-in-depth).
  if (typeof instanceKey === 'string' && /^ccv-[0-9a-f]+$/.test(instanceKey) && ptys.has(instanceKey)) {
    return instanceKey;
  }
  if (typeof cwd === 'string' && cwd) {
    // Exact-cwd branch: match on the record's persistent cwd, not the (opaque) key.
    let firstMatch = null;
    for (const [k, s] of ptys) {
      if (s.cwd !== cwd) continue;
      if (!firstMatch) firstMatch = k;
      if (s.ptyProcess && k === activePtyKey) { key = k; break; } // active + live: best
      if (s.ptyProcess && !key) key = k;                          // any live record
    }
    if (!key) key = firstMatch;
  }
  if (!key && typeof project === 'string' && project) {
    // Basename collisions: two records can share one project name (same
    // basename, different dirs). Prefer a RUNNING record over an exited one,
    // and the current active over a background one — never blindly take the
    // first insertion (which could be a dead/duplicate record). Known blind
    // spot: two simultaneously-live same-name records still resolve to the
    // first live one (full disambiguation via instanceKey lands in the view-layer phase).
    let firstMatch = null;
    for (const [k, s] of ptys) {
      const recCwd = s.cwd || s.currentWorkspacePath || s.lastWorkspacePath;
      if (projectKeyForCwd(recCwd) !== project) continue;
      if (!firstMatch) firstMatch = k;
      if (s.ptyProcess && k === activePtyKey) { key = k; break; } // active + live: best
      if (s.ptyProcess && !key) key = k;                          // any live record
    }
    if (!key) key = firstMatch;
  }
  return key;
}

/**
 * Count the LIVE records whose basename matches `project` (multi-instance disambiguation,
 * 2026-10-06). When a project-name-only attach/kill arrives while TWO same-cwd (or
 * same-basename) instances are concurrently live, resolving to "the first live one" would
 * silently act on an arbitrary process — the caller MUST name an instanceKey instead. Returns
 * the live candidates so the caller can surface them for disambiguation.
 */
function _liveInstancesForProject(project) {
  const live = [];
  if (typeof project !== 'string' || !project) return live;
  for (const [k, s] of ptys) {
    if (!s || !s.ptyProcess) continue; // LIVE only
    const recCwd = s.cwd || s.currentWorkspacePath || s.lastWorkspacePath;
    if (projectKeyForCwd(recCwd) === project) live.push({ key: k, instanceKey: k, cwd: recCwd });
  }
  return live;
}

/** Exported read-only view of _liveInstancesForProject for the /api/resume-session route's
 *  multi-instance ambiguity guard (mirror of killPtyFor/attachPtyFor). */
export function liveInstancesForProject(project) {
  return _liveInstancesForProject(project);
}

/**
 * Record the claude session uuid a PTY's conversation resolved to, so chat
 * sends can be routed by sessionId (2026-10-05). Called by the v2 writer once
 * a request's metadata yields a sid. Replaces any prior sid mapping for the
 * record (a /clear or -c moves the PTY to a new session).
 */
export function setPtySessionId(project, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return false;
  const key = _resolveKey({ project });
  if (!key) return false;
  const s = ptys.get(key);
  if (!s) return false;
  if (s.sessionId && s.sessionId !== sessionId) sidToKey.delete(s.sessionId);
  s.sessionId = sessionId;
  sidToKey.set(sessionId, key);
  return true;
}

/**
 * Record the claude session uuid for a PTY addressed by its exact instanceKey
 * (2026-10-06, multi-instance). Unlike `setPtySessionId` (basename `project`, which cannot
 * tell two same-cwd instances apart), this pins the sid to THIS process's record via the
 * self-reported `x-ccv-instance` header. The instanceKey is validated before use as a Map
 * key (defense-in-depth, mirroring the `_resumeProject` sanitize in interceptor.js). On a
 * /clear or -c the record moves to a new sid — drop the stale sid index entry first
 * (mirrors setPtySessionId).
 */
export function setPtySessionIdForInstance(instanceKey, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return false;
  if (typeof instanceKey !== 'string' || !/^ccv-[0-9a-f]+$/.test(instanceKey)) return false;
  const s = ptys.get(instanceKey);
  if (!s) return false;
  if (s.sessionId && s.sessionId !== sessionId) sidToKey.delete(s.sessionId);
  s.sessionId = sessionId;
  sidToKey.set(sessionId, instanceKey);
  return true;
}

/**
 * Resolve the PTY-map key for a chat send anchor. Order:
 *   1. project + sessionId TOGETHER: sessionId is trusted only when the record
 *      that `project` resolves to actually owns that sid — during a view switch
 *      the frontend may briefly carry the DEPARTING project's sid alongside the
 *      NEW project, and sid-first routing would send the message back to the old
 *      project's PTY (the exact bleed this fixes). A sid that contradicts the
 *      project is dropped to the project route.
 *   2. sessionId alone (no project): exact conversation → its PTY.
 *   3. project alone: basename reverse lookup (the multi-project view anchor).
 *   4. the active record (legacy no-anchor callers).
 * Returns null only when nothing exists at all.
 *
 * Pure resolution — does NOT move `activePtyKey`. A chat send is a targeted
 * write to one conversation's PTY; re-anchoring the global active pointer here
 * would make resize/scrollback/getPtyState follow whichever project was last
 * SENT to, a new cross-project bleed (review P1, 2026-10-05).
 */
function _resolveKeyByAnchor({ sessionId, project, instanceKey } = {}) {
  // Multi-instance: an explicit instanceKey is the strongest anchor — it pins THIS exact
  // process (disambiguating two same-cwd instances that basename routing cannot).
  if (typeof instanceKey === 'string' && /^ccv-[0-9a-f]+$/.test(instanceKey)) {
    const rec = ptys.get(instanceKey);
    if (rec && rec.ptyProcess) return instanceKey;
  }
  const projKey = (typeof project === 'string' && project) ? _resolveKey({ project }) : null;
  if (typeof sessionId === 'string' && sessionId) {
    const key = sidToKey.get(sessionId);
    // Only honor the sid route when the record is still LIVE (has a process). A record killed
    // via killPtyFor keeps its sid mapping (only respawn/overwrite/reap clear it), so without
    // the liveness check an anchored send to a just-closed project would resolve to the dead
    // record and silently drop the message (writeToPtyFor finds no ptyProcess and returns
    // false with no fallback).
    const rec = key ? ptys.get(key) : null;
    if (rec && rec.ptyProcess) {
      // Consistency check: when the anchor also names a project, the sid must
      // belong to that project's record — else it is a stale cross-view sid.
      if (!projKey || projKey === key) return key;
    }
  }
  if (projKey) return projKey;
  return activePtyKey != null && ptys.has(activePtyKey) ? activePtyKey : null;
}

/** writeToPty variant routed by an explicit anchor instead of the global active pointer. */
export function writeToPtyFor(data, { sessionId, project, instanceKey } = {}) {
  const key = _resolveKeyByAnchor({ sessionId, project, instanceKey });
  const s = key ? ptys.get(key) : null;
  if (s && s.ptyProcess) {
    s.ptyProcess.write(data);
    return true;
  }
  return false;
}

/** writeToPtySequential variant routed by an explicit anchor. */
export function writeToPtySequentialFor(chunks, onComplete, opts = {}, anchor = {}) {
  const key = _resolveKeyByAnchor(anchor);
  const s = key ? ptys.get(key) : null;
  if (!s || !s.ptyProcess || !chunks || chunks.length === 0) {
    if (onComplete) onComplete(false);
    return;
  }
  const timeoutMs = opts.timeoutMs || 4000;
  const settleMs = opts.settleMs || 150;
  let idx = 0;
  let dataListener = null;
  const cleanup = () => {
    if (dataListener) {
      dataListeners = dataListeners.filter(l => l !== dataListener);
      dataListener = null;
    }
  };
  const sendNext = () => {
    if (idx >= chunks.length || !s.ptyProcess) {
      cleanup();
      if (onComplete) onComplete(idx >= chunks.length);
      return;
    }
    const chunk = chunks[idx];
    idx++;
    if (typeof chunk !== 'string') {
      cleanup();
      if (onComplete) onComplete(false);
      return;
    }
    try {
      s.ptyProcess.write(chunk);
    } catch (e) {
      cleanup();
      if (onComplete) onComplete(false);
      return;
    }
    const isToggleOrSubmit = chunk === ' ' || chunk === '\r'
      || chunk === '\x1b[C' || chunk === '\x1b[A' || chunk === '\x1b[B';
    const isPasteEnd = chunk.endsWith('\x1b[201~');
    const delay = (isToggleOrSubmit || isPasteEnd) ? settleMs : 80;
    setTimeout(sendNext, delay);
  };
  sendNext();
}

/**
 * Attach the main view to a specific project's PTY (multi-PTY, 2026-10): moves
 * `activePtyKey` off "last spawned wins" onto the project the user is actually
 * VIEWING. Without this, every no-arg export (writeToPty / spawnShell /
 * getPtyState / getOutputBuffer) stays pinned to the most recently spawned
 * project — a parallel project launched via [+] shows the wrong project's
 * scrollback and keystrokes land in the other project's claude (the "terminal
 * never starts" bug).
 *
 * Resolution: exact `cwd` match on the record's stored cwd first; else a
 * `project` name reverse-lookup (record cwd → projectKeyForCwd, the same
 * mapping the live-processes route uses). Idempotent: re-attaching the
 * already-active key is a no-op; unknown targets change nothing so callers
 * can degrade silently. Never spawns/kills; the record's outputBuffer is
 * untouched — the WS layer replays it as the post-attach snapshot (the batch
 * channel must NOT re-deliver it: background output already lives in
 * outputBuffer, so a force-flush here would double-print it in the terminal).
 */
export function attachPtyFor({ cwd, project, instanceKey } = {}) {
  // Multi-instance forced disambiguation (2026-10-06): a project-name-only attach matching TWO
  // concurrently-live same-basename records is ambiguous — attaching "the first live one" would
  // pin the terminal to an arbitrary process. Refuse and surface the live candidates so the
  // caller re-issues with an instanceKey. Single-match / instance-keyed calls are unaffected.
  if (!instanceKey && typeof project === 'string' && project) {
    const live = _liveInstancesForProject(project);
    if (live.length > 1) return { ok: false, reason: 'ambiguous', candidates: live };
  }
  const key = _resolveKey({ cwd, project, instanceKey });
  if (!key) return { ok: false, reason: 'not-found' };
  const s = ptys.get(key);
  if (!s) return { ok: false, reason: 'not-found' };
  const switched = key !== activePtyKey;
  activePtyKey = key;
  return {
    ok: true,
    key,
    switched,
    running: !!s.ptyProcess,
    ptyKind: s.ptyKind || null,
    exitCode: s.lastExitCode,
  };
}

/**
 * parallel-project chips. Returns [{ key, instanceKey, cwd, ptyKind, pid, isActive }] for
 * records whose process is still running (ptyProcess != null); exited-but-
 * unreaped records are excluded. `key`/`instanceKey` are the opaque per-spawn instanceKey
 * the Map is keyed on; `cwd` is the record's real working dir (never the key). `isActive`
 * marks the PTY the main view is attached to. Read-only.
 */
export function listLivePtys() {
  const out = [];
  for (const [key, s] of ptys) {
    if (!s || !s.ptyProcess) continue;
    out.push({
      key,
      instanceKey: key,
      cwd: s.cwd || s.currentWorkspacePath || '',
      ptyKind: s.ptyKind || null,
      pid: s.ptyProcess.pid,
      isActive: key === activePtyKey,
    });
  }
  return out;
}

export function onPtyData(cb) {
  dataListeners.push(cb);
  return () => {
    dataListeners = dataListeners.filter(l => l !== cb);
    _maybeReap(); // a listener dropping off is a natural point to reclaim idle records
  };
}

export function onPtyExit(cb) {
  exitListeners.push(cb);
  return () => {
    exitListeners = exitListeners.filter(l => l !== cb);
    _maybeReap();
  };
}

export function getPtyPid() {
  const s = _active();
  return s && s.ptyProcess ? s.ptyProcess.pid : null;
}

export function getPtyState() {
  const s = _active();
  return {
    running: !!(s && s.ptyProcess),
    exitCode: s ? s.lastExitCode : null,
  };
}

/** Kind of the active PTY: 'claude' | 'shell' | null. */
export function getPtyKind() {
  const s = _active();
  return s ? s.ptyKind : null;
}

/**
 * Kind of an ANCHOR-SPECIFIC PTY: 'claude' | 'shell' | null (2026-10-06, for /api/resume-session).
 * Unlike getPtyKind (active-scoped) and _resolveKeyByAnchor (which falls back to activePtyKey),
 * this resolves STRICTLY via _resolveKey — a provided-but-unresolved project/instanceKey returns
 * null rather than the active PTY's kind. The resume route depends on this to never inject
 * `/resume <uuid>` into the wrong (active) project's conversation when the anchor doesn't resolve.
 */
export function getPtyKindFor({ project, instanceKey } = {}) {
  const key = _resolveKey({ project, instanceKey });
  const s = key ? ptys.get(key) : null;
  return (s && s.ptyProcess) ? s.ptyKind : null;
}

/**
 * True iff `project` names a currently-LIVE ccv claude PTY (main interactive, ptyKind 'claude').
 * Used by interceptor.markSessionStart to decide whether a SessionStart hook from a non-bound
 * cwd belongs to a parallel project this server manages (and so its resume should re-bind the
 * writer keyed by that project) versus an unrelated process to ignore.
 */
export function isLiveClaudeProject(project) {
  if (typeof project !== 'string' || !project) return false;
  for (const [, s] of ptys) {
    if (!s || !s.ptyProcess || s.ptyKind !== 'claude') continue;
    const recCwd = s.cwd || s.currentWorkspacePath || s.lastWorkspacePath;
    if (projectKeyForCwd(recCwd) === project) return true;
  }
  return false;
}

/** True iff the active Claude session was launched with --dangerously-skip-permissions. */
export function getPtySkipPermissions() {
  const s = _active();
  return !!(s && s.ptyKind === 'claude' && s.ptySkipPermissions);
}

export function getCurrentWorkspace() {
  const s = _active();
  return {
    running: !!(s && s.ptyProcess),
    exitCode: s ? s.lastExitCode : null,
    cwd: s ? s.currentWorkspacePath : null,
  };
}

export function getOutputBuffer() {
  const s = _active();
  return s ? s.outputBuffer : '';
}

/**
 * Launch-or-reattach for a workspace cwd (2026-10-06, multi-instance). Now that spawnClaude
 * mints a fresh instanceKey per call and no longer kills an existing same-cwd record, an
 * explicit re-launch of an ALREADY-LIVE cwd would silently start a duplicate process (the
 * old mutual-kill used to replace it). This gate restores the intended "re-open = reuse"
 * semantics for the launch path: if a claude is already running for `cwd`, attach the main
 * view to it and report `attached:true` WITHOUT spawning; otherwise spawn fresh.
 *
 * Deliberate multi-instance (a second concurrent claude in the same cwd) still goes through
 * the public `spawnClaude` — this helper is only the de-dup guard for the launch route.
 *
 * @returns {Promise<{ spawned:boolean, attached:boolean, key:string|null, running:boolean }>}
 */
export async function ensurePtyForCwd({ cwd, proxyPort, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null } = {}) {
  if (typeof cwd !== 'string' || !cwd) return { spawned: false, attached: false, key: null, running: false };
  // Serialize concurrent launches for the SAME cwd (review P1 / TOCTOU): the live-scan below
  // + `spawnClaude` are two separate steps, so two simultaneous launches of one cwd could both
  // miss the scan and both mint a fresh instanceKey (a duplicate process). `_spawnInflight` is
  // keyed by instanceKey and cannot dedupe across distinct minted keys, so we hold a per-cwd
  // in-flight promise here — the second caller waits for the first, then re-scans and finds
  // the now-live record (attaching instead of spawning).
  while (_cwdLaunchInflight.has(cwd)) { try { await _cwdLaunchInflight.get(cwd); } catch { } }
  // Prefer an already-LIVE claude for this exact cwd (not a shell). Re-attaching rather than
  // re-spawning preserves the running session and avoids a duplicate process.
  for (const [k, s] of ptys) {
    if (s && s.cwd === cwd && s.ptyProcess && s.ptyKind === 'claude') {
      activePtyKey = k; // attach the main view to the live record
      return { spawned: false, attached: true, key: k, running: true };
    }
  }
  const p = spawnClaude(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
  _cwdLaunchInflight.set(cwd, p);
  try {
    await p;
    return { spawned: true, attached: false, key: activePtyKey, running: true };
  } finally {
    if (_cwdLaunchInflight.get(cwd) === p) _cwdLaunchInflight.delete(cwd);
  }
}

// Test only: clear ALL multi-PTY state (the Map, the active pointer, and the global
// listener arrays) so suites that spawn real/mock PTYs don't leak records between cases.
// The old singleton model reset via killPty() nulling one record; with a Map that no longer
// isolates tests, so they call this in beforeEach/afterEach instead.
export function _resetForTests() {
  for (const s of ptys.values()) _killPtyRecord(s);
  ptys.clear();
  sidToKey.clear();
  activePtyKey = null;
  dataListeners = [];
  exitListeners = [];
  _spawnInflight.clear();
  _shellInflight = null;
  _cwdLaunchInflight.clear();
}
