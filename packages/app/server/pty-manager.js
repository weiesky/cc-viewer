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
import { MODEL_PROMPT_DIR } from './lib/model-system-prompts.js';
// Launch-time system-prompt/thinking-display pipeline lives in lib/launch-config.js
// (shared with the SDK link). Re-exported here for existing consumers/tests.
import { withDefaultThinkingDisplay, resolveLaunchSystemPrompt, insertBeforeDashDash } from './lib/launch-config.js';
export { withDefaultThinkingDisplay } from './lib/launch-config.js';
import { t, tFor } from './i18n.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ptyProcess = null;
// Kind of the current PTY: 'claude' (real Claude Code session), 'shell' (fallback bare
// shell auto-spawned on input), or null (none). The DingTalk bridge uses this to refuse
// injecting into a bare shell — typing a prompt into a shell would execute it as a command.
let ptyKind = null;
// Whether the current Claude session was launched with --dangerously-skip-permissions
// (cli.js canonicalizes --d/--ad before spawn). Surfaced for the bridge's RCE warning.
let ptySkipPermissions = false;
let dataListeners = [];
let exitListeners = [];
let lastExitCode = null;
let outputBuffer = '';
let currentWorkspacePath = null;
let lastWorkspacePath = null; // kept after process exit, used for respawn shell
let lastPtyCols = 120;
let lastPtyRows = 30;
// In-flight guard for the main PTY spawn: the guard runs before `await getPty` and
// ptyProcess is assigned after the await, so two synchronously-arriving input messages
// could both pass the guard and double-spawn (the first pty loses its reference → leak +
// output cross-talk). Synchronously reserve a promise and reuse it across concurrent calls,
// never spawning twice (mirrors scratch-pty-manager._spawnInflight).
let _spawnInflight = null;
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
let batchBuffer = '';
let batchScheduled = false;
let _ptyImportForTests = null;

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

function flushBatch(force = false) {
  batchScheduled = false;
  if (!batchBuffer) return;
  // Batch-boundary half-sequence carry: every batch is wrapped in SYNC markers, so if a
  // batch boundary splits an escape sequence the injected markers would eat its ESC and
  // render the tail literally (the root cause of fragments like `[9m`/`8;2;102m`). The
  // half tail is carried to the next batch (PTY continuation always completes it); when
  // force=true (process exit) nothing is carried and all residue is flushed.
  let safe = batchBuffer;
  let carry = '';
  if (!force) [safe, carry] = splitTrailingIncomplete(batchBuffer);
  batchBuffer = carry;
  if (!safe) return;
  const chunk = SYNC_BEGIN + safe + SYNC_END;
  for (const cb of dataListeners) {
    try { cb(chunk); } catch { }
  }
}

// Inject a synthetic notice line into the embedded terminal (not claude output). Appending
// to outputBuffer lets newly-connected / reconnected clients see it in the snapshot
// (server.js's data-resync reads getOutputBuffer), then broadcast live to the current
// dataListeners.
function emitSpawnNotice(line) {
  const chunk = `\x1b[2m${line}\x1b[0m\r\n`;
  outputBuffer += chunk;
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
  // Wait for any in-flight spawn to finish before kill+spawn, avoiding a double-spawn /
  // cross-talk with spawnShell (self-serializing). while rather than if: with ≥3 concurrent
  // spawns, after A finishes B sets a new inflight=pB, and a single if's C would not re-check
  // pB before kill+spawn, letting implB/implC double-spawn — loop until there is genuinely
  // no inflight before proceeding.
  while (_spawnInflight) { try { await _spawnInflight; } catch { } }
  if (ptyProcess) {
    killPty();
  }
  const p = _spawnClaudeImpl(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
  _spawnInflight = p;
  try { return await p; } finally { if (_spawnInflight === p) _spawnInflight = null; }
}

async function _spawnClaudeImpl(proxyPort, cwd, extraArgs = [], claudePath = null, isNpmVersion = false, serverPort = null, serverProtocol = 'http', internalToken = null) {
  const pty = await getPty();

  fixSpawnHelperPermissions();

  // If claudePath was not provided, try to find it automatically
  if (!claudePath) {
    claudePath = resolveNativePath();
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
        // File-precise: protect the deny mechanism itself (settings/hooks) and the IM
        // credential store (preferences.json), but do not block all of ~/.claude — the
        // worker's working directory sits under ~/.claude/cc-viewer/IM_<id>/ and must stay
        // writable.
        `Edit(${home}/.claude/settings.json)`, `Write(${home}/.claude/settings.json)`,
        `Edit(${home}/.claude/settings.local.json)`, `Write(${home}/.claude/settings.local.json)`,
        `Edit(${home}/.claude/cc-viewer/preferences.json)`, `Write(${home}/.claude/cc-viewer/preferences.json)`,
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

  lastExitCode = null;
  outputBuffer = '';
  currentWorkspacePath = cwd || process.cwd();
  lastWorkspacePath = currentWorkspacePath;
  // Boot-window anchor for the injection fallback tiers below (same clock as the
  // comparison — _now(), never Date.now(), so tests can steer both ends together).
  const spawnedAt = _now();

  ptyProcess = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd: currentWorkspacePath,
    env,
  });
  ptyKind = 'claude';
  // --allow-dangerously-skip-permissions only enables a later toggle, so it must NOT count.
  ptySkipPermissions = extraArgs.includes('--dangerously-skip-permissions');

  // PTY event handlers must be registered immediately after spawn (PR#128): if the child
  // exits before onExit is mounted (missing binary / instant crash / rejected injection
  // flag), the exit event is lost — after the handle is released the event loop may drain.
  // The injection notice is moved to after registration.
  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - BUFFER_TRIM_TO;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    flushBatch(true);
    lastExitCode = exitCode;
    ptyProcess = null;
    ptyKind = null;
    ptySkipPermissions = false;
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
    if (hasContinue && exitCode !== 0 && outputBuffer.includes('No conversation found')) {
      console.error('[CC Viewer] -c failed (no conversation), retrying without -c');
      const retryArgs = extraArgs.filter(a => a !== '-c' && a !== '--continue');
      _suppressNextSpawnNotice = true;
      spawnClaude(proxyPort, cwd, retryArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
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
      && /unknown option ['"]--thinking-display/i.test(outputBuffer);
    if (flagRejected) {
      console.error('[CC Viewer] claude rejected --thinking-display, marking as unsupported and retrying without flag');
      _thinkingDisplayRejectedPaths.add(claudePath);
      _suppressNextSpawnNotice = true;
      spawnClaude(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
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
    const unknownSysFileFlag = /unknown option ['"]--(append-)?system-prompt-file/i.test(outputBuffer);
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
      emitSpawnNotice(`[CC Viewer] claude exited during boot (code ${exitCode}); the injected system prompt may or may not be the cause — retrying once without ${sysPrompt.loaded.join(', ')}`);
      spawnClaude(proxyPort, cwd, extraArgs, claudePath, isNpmVersion, serverPort, serverProtocol, internalToken);
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
      emitSpawnNotice(`[CC Viewer] claude exited ${Math.round(elapsedMs / 1000)}s after launch with an injected system prompt (${sysPrompt.loaded.join(', ')}). If this keeps happening the injected prompt may be incompatible — remove the entry or set CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 to skip injection.`);
    }

    // Keep lastWorkspacePath (do not clear) for respawn
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });

  // Print a notice line to the terminal when a system-prompt file was injected (visibility /
  // security); suppressed on internal restarts to avoid repetition. Must be printed after
  // onData/onExit are registered (PR#128) to shrink the window for losing the event when
  // the child exits before the handlers are mounted.
  if (sysPrompt.loaded.length && !sysPrompt.pinned && !_suppressNextSpawnNotice) {
    const modelSuffix = sysPrompt.model ? ` (model match: ${sysPrompt.model})` : '';
    emitSpawnNotice(`[CC Viewer] loaded ${sysPrompt.loaded.join(', ')} as system prompt${modelSuffix}`);
  }
  // Pin visibility: a snapshot hit re-injects verbatim; a no-record resume (F2)
  // injects nothing — surfaced ONLY when injection is configured right now
  // (noRecordNotice), otherwise the line would nag feature-less users on every -c.
  // Mutually exclusive with the loaded notice above (the pinned path never prints it).
  if (sysPrompt.pinned && !_suppressNextSpawnNotice) {
    if (sysPrompt.noRecord) {
      if (sysPrompt.noRecordNotice) emitSpawnNotice(`[CC Viewer] ${t('cli.systemPromptResumeNoSnapshot')}`);
    } else if (sysPrompt.loaded.length) {
      emitSpawnNotice(`[CC Viewer] ${t('cli.systemPromptPinned', { files: sysPrompt.loaded.join(', ') })}`);
    }
  }
  // Settings-merge failures surface via emitSpawnNotice too: console.warn only reaches
  // the server stdout, invisible in the embedded terminal. Localized here (the console.warn
  // above stays English for greppable server logs). Must be emitted after spawn — the
  // outputBuffer reset right before pty.spawn would swallow an earlier write.
  if (settingsMerge.warningDetail && !_suppressNextSpawnNotice) {
    emitSpawnNotice(`[CC Viewer] ${t('cli.settingsMergeFailed', settingsMerge.warningDetail)}`);
  }
  _suppressNextSpawnNotice = false;

  return ptyProcess;
}

export function writeToPty(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
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

  if (!ptyProcess || !chunks || chunks.length === 0) {
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
    if (idx >= chunks.length || !ptyProcess) {
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
      ptyProcess.write(chunk);
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
export async function spawnShell() {
  if (ptyProcess) return false; // a process is already running
  if (_spawnInflight) return _spawnInflight; // reuse the in-flight spawn to avoid double
  const p = _spawnShellImpl();
  _spawnInflight = p;
  try { return await p; } finally { if (_spawnInflight === p) _spawnInflight = null; }
}

async function _spawnShellImpl() {
  const cwd = lastWorkspacePath || process.cwd();

  const pty = await getPty();

  fixSpawnHelperPermissions();

  const shell = process.env.SHELL || (process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh');

  lastExitCode = null;
  currentWorkspacePath = cwd;

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

  ptyProcess = pty.spawn(shellSpawn.command, shellSpawn.args, {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd,
    env: shellSpawn.env,
  });
  ptyKind = 'shell';
  ptySkipPermissions = false;

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - BUFFER_TRIM_TO;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch(true);
    lastExitCode = exitCode;
    ptyProcess = null;
    ptyKind = null;
    ptySkipPermissions = false;
    currentWorkspacePath = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
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
  lastPtyCols = _clampDim(cols, PTY_COLS_MIN, PTY_COLS_MAX, lastPtyCols);
  lastPtyRows = _clampDim(rows, PTY_ROWS_MIN, PTY_ROWS_MAX, lastPtyRows);
  if (ptyProcess) {
    try { ptyProcess.resize(lastPtyCols, lastPtyRows); } catch { }
  }
}

export function killPty() {
  if (ptyProcess) {
    flushBatch(true);
    batchBuffer = '';
    batchScheduled = false;
    // Windows: node-pty's ConPTY kill has a known synchronous-hang issue
    // (microsoft/node-pty#454); a hang would also take down the Ctrl+C exit-chain watchdog.
    // Instead use spawnSync taskkill /T /F to reap the whole process tree (ConPTY agent +
    // claude), bounded (timeout 2s) and providing "dead on return" semantics (which
    // spawnClaude's internal kill→respawn and workspaces stop→launch rely on). ptyProcess
    // .kill() is fully skipped on win32. Non-Windows behavior is unchanged.
    if (!killPtyTree(ptyProcess.pid)) {
      try { ptyProcess.kill(); } catch { }
    }
    ptyProcess = null;
    ptyKind = null;
    ptySkipPermissions = false;
  }
}

export function onPtyData(cb) {
  dataListeners.push(cb);
  return () => {
    dataListeners = dataListeners.filter(l => l !== cb);
  };
}

export function onPtyExit(cb) {
  exitListeners.push(cb);
  return () => {
    exitListeners = exitListeners.filter(l => l !== cb);
  };
}

export function getPtyPid() {
  return ptyProcess ? ptyProcess.pid : null;
}

export function getPtyState() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
  };
}

/** Kind of the active PTY: 'claude' | 'shell' | null. */
export function getPtyKind() {
  return ptyKind;
}

/** True iff the active Claude session was launched with --dangerously-skip-permissions. */
export function getPtySkipPermissions() {
  return ptyKind === 'claude' && ptySkipPermissions;
}

export function getCurrentWorkspace() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
    cwd: currentWorkspacePath,
  };
}

export function getOutputBuffer() {
  return outputBuffer;
}
