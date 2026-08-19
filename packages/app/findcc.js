import { resolve, join, sep, delimiter, isAbsolute, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync, readFileSync, readdirSync, statSync, accessSync, constants as fsConstants } from 'node:fs';
import { homedir, tmpdir, arch } from 'node:os';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { threadId } from 'node:worker_threads';
import { reportSwallowed } from './server/lib/error-report.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// cc-viewer's sibling node_modules/. In production (npm install), this is the real
// node_modules directory; under `npm link` / git clone dev setups the path may resolve
// incorrectly, and getGlobalNodeModulesDir() serves as the fallback.
// Computed inline rather than imported from server/_paths.js, to avoid root files
// forming a reverse dependency on internal server modules.
const NODE_MODULES = resolve(__dirname, '..');

// ============ Configuration (third-party adapters only need to modify this section) ============

/**
 * Resolve Claude Code config directory.
 * Third-party wrappers may set CLAUDE_CONFIG_DIR to redirect
 * Claude Code's config from ~/.claude/ to a custom location.
 * @returns {string} absolute path to the Claude config directory
 */
// ████████ Test isolation barrier L1c helper — DO NOT REMOVE (2026-07-12 data loss) ████████
// A ccv-hosted shell exports CCV_LOG_DIR=<real user data dir> (and possibly CLAUDE_CONFIG_DIR)
// into every child process — the claude pty, its Bash tool, any nested shell. A direct
// `node --test <file>` run there inherits those vars and sails through the explicit-value fast
// paths below, handing the test process the REAL user directories; test fixtures/cleanup then
// delete real user data (confirmed 2026-07-12: a pty-manager fixture's finally-rmSync wiped the
// user's global system_prompt/ model prompts). Policy: a test process may only ever target
// disposable temp directories. This helper decides whether an explicit dir qualifies.
function isDisposableTmpPath(p) {
  const roots = new Set();
  const t = resolve(tmpdir());
  roots.add(t);
  try { roots.add(realpathSync(t)); } catch { /* keep the unresolved form */ }
  if (process.platform !== 'win32') { roots.add('/tmp'); roots.add('/private/tmp'); }
  const forms = new Set([resolve(p)]);
  try { forms.add(realpathSync(resolve(p))); } catch { /* path may not exist yet */ }
  for (const f of forms) {
    for (const r of roots) {
      if (f === r || f.startsWith(r + sep)) return true;
    }
  }
  return false;
}

export function getClaudeConfigDir() {
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir && typeof envDir === 'string' && envDir.trim()) {
    const raw = envDir.trim();
    const resolved = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : resolve(raw);
    // ████ L1d: in test context an explicit CLAUDE_CONFIG_DIR must still be a throwaway dir —
    // an inherited real config dir would re-open the 2026-06-06 updater CACHE_DIR hole. ████
    if (process.env.NODE_TEST_CONTEXT && !isDisposableTmpPath(resolved)) {
      console.warn(`[findcc] L1d test-isolation barrier: CLAUDE_CONFIG_DIR="${raw}" is not under the OS temp dir — forcing a private guard config dir (tests may only target disposable temp dirs)`);
      return join(tmpdir(), 'cc-viewer-test', `guard-cfg-${process.pid}-${threadId}`);
    }
    return resolved;
  }
  // ████████ Test isolation barrier L1b — DO NOT REMOVE (prevents data-loss regressions, 2026-06-06) ████████
  // CCV_LOG_DIR=tmp only redirects LOG_DIR; it does not cover this function: updater.js's
  // CACHE_DIR = join(getClaudeConfigDir(),'cc-viewer') resolves to the real ~/.claude/cc-viewer
  // in tests, and branch-lib-updater.test.js's rmSync(CACHE_DIR,{recursive}) once destroyed a
  // user's 40 GB log history because of this (confirmed root cause in 2026-06-06 incident 1/4).
  // settings.json, ensure-hooks, ~/.claude/* expansion all derive from this function — when in
  // test mode (node:test injects NODE_TEST_CONTEXT) without an explicit CLAUDE_CONFIG_DIR, always
  // use a process-private temp directory; never resolve to the real ~/.claude.
  // Unit test: test/logdir-test-guard.test.js.
  if (process.env.NODE_TEST_CONTEXT) {
    return join(tmpdir(), 'cc-viewer-test', `guard-cfg-${process.pid}-${threadId}`);
  }
  // ████████████████████████████████████████████████████████████████████████████
  return join(homedir(), '.claude');
}

// Default the experimental agent-teams flag (UltraPlan / AgentTeam) ON at launch,
// unless the user has explicitly configured it — via a shell env var (any value,
// including "0") or the Claude settings.json `env` block. Deferring to settings.json
// keeps it authoritative for BOTH the UI gate and the spawned claude process, so an
// explicit opt-out there can't be silently overridden by the injected default.
export function applyAgentTeamsDefault() {
  if (process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS !== undefined) return;
  try {
    const settings = JSON.parse(readFileSync(join(getClaudeConfigDir(), 'settings.json'), 'utf8'));
    if (settings?.env && Object.prototype.hasOwnProperty.call(settings.env, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')) return;
  } catch {
    // No/unreadable/invalid settings.json → fall through to the default. Benign best-effort read.
  }
  process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';
}

function resolveLogDir() {
  const envDir = process.env.CCV_LOG_DIR;
  if (typeof envDir === 'string' && envDir.trim()) {
    const raw = envDir.trim();
    // Allow 'tmp' or 'temp' keyword to use system temp directory (common in tests)
    if (raw === 'tmp' || raw === 'temp') {
      return join(tmpdir(), 'cc-viewer-test', `${process.pid}-${threadId}`);
    }
    const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
    const resolved = resolve(expanded);
    // ████████ Test isolation barrier L1c — DO NOT REMOVE (2026-07-12 data loss) ████████
    // The NODE_TEST_CONTEXT guard below only covers the no-CCV_LOG_DIR case; this explicit-value
    // fast path used to accept ANY inherited dir. Inside a ccv-hosted shell CCV_LOG_DIR points at
    // the real ~/.claude/cc-viewer, so a direct `node --test <file>` there resolved LOG_DIR to
    // real user data — test cleanup then deleted it (2026-07-12: the user's global system_prompt/
    // entries were wiped this way, twice). Tests may only target disposable temp dirs: anything
    // outside the OS temp root is forced to the private guard dir. Use CCV_LOG_DIR=tmp or a
    // mkdtemp path in tests. Unit test: test/logdir-test-guard.test.js.
    if (process.env.NODE_TEST_CONTEXT && !isDisposableTmpPath(resolved)) {
      console.warn(`[findcc] L1c test-isolation barrier: CCV_LOG_DIR="${raw}" is not under the OS temp dir — forcing a private guard LOG_DIR (tests may only target disposable temp dirs; use CCV_LOG_DIR=tmp or a mkdtemp path)`);
      return join(tmpdir(), 'cc-viewer-test', `guard-${process.pid}-${threadId}`);
    }
    // ████████████████████████████████████████████████████████████████████████████
    return resolved;
  }
  // Test isolation barrier: in node:test environment (NODE_TEST_CONTEXT is auto-injected by the
  // test runner and inherited by spawned child processes via spread env), if CCV_LOG_DIR is not
  // explicitly set, never resolve to the real user directory — force a process-private temp
  // directory. 2026-06-06 incident: a test probe with no env guard treated the real
  // ~/.claude/cc-viewer as LOG_DIR, and cleanup logic wiped the entire user data tree.
  // No test run is allowed to touch the live filesystem or local storage.
  if (process.env.NODE_TEST_CONTEXT) {
    return join(tmpdir(), 'cc-viewer-test', `guard-${process.pid}-${threadId}`);
  }
  return join(getClaudeConfigDir(), 'cc-viewer');
}

// Log storage root directory (all project logs and preferences are stored here)
// Uses `let` to support runtime modification via setLogDir() (ES module live binding)
export let LOG_DIR = resolveLogDir();

// Listeners notified synchronously after LOG_DIR changes. findcc is a leaf
// module and must not import its consumers — dependents (e.g.
// server/lib/file-access-policy.js) register here instead of findcc importing
// them (which used to be a lazy dynamic import to dodge the cycle).
const _logDirListeners = [];
export function onLogDirChange(listener) {
  if (typeof listener === 'function') _logDirListeners.push(listener);
}

/**
 * Runtime modification of the log storage root directory.
 * Supports ~/... expansion. All modules that reference `LOG_DIR` via `import { LOG_DIR }`
 * will automatically see the updated value.
 */
export function setLogDir(dir) {
  if (!dir || typeof dir !== 'string') return false;
  const raw = dir.trim();
  if (!raw) return false;
  const resolved = resolve(raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw);
  // Security: restrict to home directory or /tmp to prevent writes to system directories
  const home = homedir();
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp/')) return false;
  LOG_DIR = resolved;
  // workspace registry file location changes with LOG_DIR; registered listeners
  // (the allowlist cache in file-access-policy) invalidate their caches.
  for (const listener of _logDirListeners) {
    try { listener(resolved); } catch (err) { reportSwallowed('findcc.logdir-listener', err); }
  }
  return true;
}

// npm package name candidates (priority order)
export const PACKAGES = ['@anthropic-ai/claude-code', '@ali/claude-code'];

// Entry files within each npm package (relative to package root)
export const CLI_ENTRY = 'cli.js';

// Native binary name candidates (~ will be expanded to homedir() at runtime)
const NATIVE_CANDIDATES = [
  '~/.claude/local/claude',
  '/usr/local/bin/claude',
  '~/.local/bin/claude',
  '/opt/homebrew/bin/claude',
];

// Command names used for which/command -v lookup
export const BINARY_NAME = 'claude';

export const CLAUDE_EXECUTABLE_PREF_KEY = 'claudeExecutablePath';

export function expandClaudeExecutablePath(value, platform = process.platform) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const homeRelative = raw.startsWith('~/') || raw.startsWith('~\\');
  const expanded = homeRelative ? join(homedir(), raw.slice(2)) : raw;
  const absolute = platform === 'win32' ? win32.isAbsolute(expanded) : isAbsolute(expanded);
  if (!absolute) return null;
  return platform === 'win32' ? win32.normalize(expanded) : resolve(expanded);
}

export function resolveExplicitClaudePath(value, platform = process.platform) {
  const expanded = expandClaudeExecutablePath(value, platform);
  if (!expanded || !existsSync(expanded)) return null;
  try {
    if (!statSync(expanded).isFile()) return null;
  } catch { return null; }
  let real = expanded;
  try { real = realpathSync(expanded); } catch { }
  const isJs = real.toLowerCase().endsWith('.js');
  try {
    if (isJs) {
      accessSync(real, fsConstants.R_OK);
    } else if (platform === 'win32') {
      if (!real.toLowerCase().endsWith('.exe')) return null;
    } else {
      accessSync(expanded, fsConstants.X_OK);
    }
  } catch {
    return null;
  }
  return {
    path: isJs ? real : expanded,
    realPath: real,
    isNpmVersion: isJs,
  };
}

export function readConfiguredClaudePath(prefsFile = join(LOG_DIR, 'preferences.json')) {
  try {
    const prefs = JSON.parse(readFileSync(prefsFile, 'utf8'));
    const value = prefs?.[CLAUDE_EXECUTABLE_PREF_KEY];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function resolveConfiguredClaudePath(prefsFile) {
  return resolveExplicitClaudePath(readConfiguredClaudePath(prefsFile));
}

function describeClaudeSelection(path, isNpmVersion, source) {
  let realPath = path;
  try { realPath = realpathSync(path); } catch { }
  return { path, realPath, isNpmVersion, source };
}

/**
 * Resolve the executable used by every CCV launch surface.
 * A non-empty saved configuration is authoritative: if it is invalid, return
 * an error instead of silently starting a different (possibly unapproved) build.
 */
export function resolvePreferredClaudeSelection({ prefsFile } = {}) {
  const configuredValue = readConfiguredClaudePath(prefsFile);
  if (configuredValue) {
    const configured = resolveExplicitClaudePath(configuredValue);
    return configured
      ? { ...configured, source: 'configured' }
      : { error: 'configured-invalid', configuredPath: configuredValue };
  }

  const codeFusePath = resolveCodeFuseClaudePath();
  if (codeFusePath) return describeClaudeSelection(codeFusePath, false, 'codefuse');

  // Native path (platform-specific binary) takes priority over PATH-based and
  // npm-based resolution. On Windows, PATH may surface a postinstall stub that
  // causes ERROR_BAD_EXE_FORMAT (193 / 216); the platform binary bypasses that.
  const nativePath = resolveNativePath();
  if (nativePath) return describeClaudeSelection(nativePath, false, 'native');

  const pathSelection = resolveClaudeFromPath();
  if (pathSelection) return describeClaudeSelection(pathSelection.path, pathSelection.isNpmVersion, 'path');

  const npmPath = resolveNpmClaudePath();
  if (npmPath) return describeClaudeSelection(npmPath, true, 'npm');

  return null;
}

// The import statement injected at the top of @anthropic-ai/claude-code/cli.js.
// EXTERNAL CONTRACT: uses bare specifier resolved via package.json `exports` —
// the physical path can change without touching this line; keep in sync with
// cli.js::removeCliJsInjection's legacy marker migration logic.
export const INJECT_IMPORT = "import 'cc-viewer/interceptor.js';";

// Historical INJECT_IMPORT forms, used for cleaning up old markers during uninstall/reinstall.
// Whenever INJECT_IMPORT changes, add the old value here — otherwise existing users upgrading
// won't have the old marker recognized by the new version, causing stale injection residue
// plus new injection failure = double damage.
//
// Prune policy: each entry records the version when it was added. When a legacy entry has
// been present for 4+ major releases (i.e. users have had at least several opportunities to
// run `ccv -logger` for auto-rewrite), it can be considered for removal. Before deleting,
// check whether the old version still has download volume on the npm registry.
export const LEGACY_INJECT_IMPORTS = [
  // added in 1.6.273 — relative path form before bare-specifier migration
  "import '../../cc-viewer/interceptor.js';",
];

// ============ Exported functions ============

// ████████ Test isolation barrier L7 — DO NOT REMOVE (browser-window / real-claude leak) ████████
// Claude-binary discovery must NEVER find the user's real installation from inside tests:
// the absolute NATIVE_CANDIDATES (/usr/local/bin/claude, /opt/homebrew/bin/claude) and the
// `npm root -g` global lookup ignore the PATH/HOME isolation every CLI test relies on, so
// "claude not found" tests used to find and RUN the real claude (30–120s each), open real
// browser windows, and -logger paths could even mutate a real global claude install via
// injectCliJs. Same convention as L1/L1b (NODE_TEST_CONTEXT) with the CCV_TEST_ALLOW_*
// escape idiom of L4 (im-process-manager). PATH-mediated `which` lookup stays UNGATED on
// purpose — an isolated PATH with a fake `claude` is the sanctioned test fixture seam, as is
// an explicit CLAUDE_CONFIG_DIR. Unit test: test/claude-lookup-test-guard.test.js.
export function isRealClaudeLookupBlocked() {
  return !!process.env.NODE_TEST_CONTEXT && process.env.CCV_TEST_ALLOW_REAL_CLAUDE !== '1';
}

// Browser auto-open suppression: tests must never pop real browser windows, and
// CCV_NO_OPEN=1 offers the same switch to any environment without the --no-open flag.
export function isBrowserOpenSuppressed() {
  return process.env.CCV_NO_OPEN === '1' || !!process.env.NODE_TEST_CONTEXT;
}
// ████████████████████████████████████████████████████████████████████████████

// `npm root -g` — the single source of truth for the global node_modules root.
//
// Windows: npm ships as `npm.cmd`, and since the CVE-2024-27980 fix (Node
// 18.20.2 / 20.12.2 / 22.0.0) handing a `.cmd`/`.bat` target to execFileSync
// throws EINVAL *synchronously*. That threw straight into the catch below and
// returned null, so every Claude-discovery path that depends on the global root
// silently missed an `npm i -g @anthropic-ai/claude-code` install and `ccv`
// died with "cli.js not found" (issue #137).
//
// `cmd.exe /c npm root -g` is the doc-sanctioned non-shell route: the executed
// image is cmd.exe (a real PE), and the argv is a fixed literal — no caller or
// user input is ever interpolated, so there is no command-injection surface.
// Exported for unit tests: the win32 branch must be assertable off-Windows.
export function buildNpmRootCommand(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return {
      cmd: env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm root -g'],
      // cmd.exe must receive `npm root -g` as one token; Node's default quoting
      // would wrap it in quotes that cmd then fails to parse.
      windowsVerbatimArguments: true,
    };
  }
  return { cmd: 'npm', args: ['root', '-g'], windowsVerbatimArguments: false };
}

// npm may prepend warnings (funding/update notices) to stdout; the resolved path
// is the last non-empty line. Exported for unit tests.
export function parseNpmRootOutput(raw) {
  const lines = String(raw ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

export function getGlobalNodeModulesDir() {
  const { cmd, args, windowsVerbatimArguments } = buildNpmRootCommand();
  try {
    const out = execFileSync(cmd, args, {
      encoding: 'utf-8',
      windowsHide: true,
      // npm on Windows (cmd.exe + Defender) is routinely slower than 2s; a
      // premature timeout was itself a source of "claude not found".
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsVerbatimArguments,
    });
    const dir = parseNpmRootOutput(out);
    if (dir && existsSync(dir)) return dir;
    return dir || inferGlobalNodeModulesDir();
  } catch {
    // npm missing, not on PATH, or slower than the timeout — fall back to the
    // well-known layouts so discovery still works without ever running npm.
    return inferGlobalNodeModulesDir();
  }
}

// Ordered candidate list for the npm-free global-root fallback. Pure (no fs
// access) and parameterized so tests can assert the win32 ordering off-Windows.
export function globalNodeModulesCandidates(platform = process.platform, env = process.env, home = homedir()) {
  // Use the target platform's separator so the win32 branch is assertable from a
  // POSIX test run (at runtime on Windows this is exactly what `join` does).
  const pj = platform === 'win32' ? win32.join : join;
  const candidates = [];
  const prefix = env.NPM_CONFIG_PREFIX || env.npm_config_prefix;
  if (prefix) {
    // Windows installs land directly in <prefix>/node_modules; POSIX adds lib/.
    candidates.push(pj(prefix, 'node_modules'), pj(prefix, 'lib', 'node_modules'));
  }
  if (platform === 'win32') {
    // The default `npm i -g` target for the official Node installer.
    if (env.APPDATA) candidates.push(pj(env.APPDATA, 'npm', 'node_modules'));
    if (env.ProgramFiles) candidates.push(pj(env.ProgramFiles, 'nodejs', 'node_modules'));
    if (env.LOCALAPPDATA) {
      candidates.push(pj(env.LOCALAPPDATA, 'nvm', 'node_modules'));
      candidates.push(pj(env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'node_modules'));
    }
  } else {
    candidates.push(
      pj(home, '.npm-global', 'lib', 'node_modules'),
      '/usr/local/lib/node_modules',
      '/opt/homebrew/lib/node_modules',
      pj(home, '.volta', 'tools', 'image', 'node_modules'),
    );
  }
  // The dir holding cc-viewer itself IS a global node_modules when ccv was
  // installed with `npm i -g` — a reliable last resort on any platform.
  candidates.push(NODE_MODULES);
  return candidates.filter(Boolean);
}

// npm-free fallback for the global node_modules root. `npm root -g` can fail for
// reasons that have nothing to do with whether Claude Code is installed (npm not
// on a GUI process's PATH, a corporate shim that is slow to start, EINVAL as
// above). These are the canonical global prefixes; the first one that exists wins.
// L7: these are absolute machine paths that ignore PATH/HOME isolation exactly
// like the raw NATIVE_CANDIDATES — blocked under test context, where `npm root -g`
// (real or fixture) remains the only sanctioned seam.
export function inferGlobalNodeModulesDir() {
  if (isRealClaudeLookupBlocked()) return null;
  for (const dir of globalNodeModulesCandidates()) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

export function resolveCliPath() {
  // Candidate base directories: local node_modules (cc-viewer's sibling) + global node_modules.
  // L7: under test context the NODE_MODULES sibling scan is blocked — on 1.x-layout machines it
  // finds a REAL global @anthropic-ai/claude-code/cli.js with no npm and no PATH involved, and
  // -logger tests would then mutate that real install via injectCliJs. The globalRoot push below
  // stays UNGATED: `npm root -g` is the fake-npm fixture seam (npmLoggerFixture) tests rely on.
  const blocked = isRealClaudeLookupBlocked();
  const baseDirs = blocked ? [] : [NODE_MODULES];
  const globalRoot = getGlobalNodeModulesDir();
  if (globalRoot && globalRoot !== NODE_MODULES) {
    baseDirs.push(globalRoot);
  }

  for (const baseDir of baseDirs) {
    for (const packageName of PACKAGES) {
      const candidate = join(baseDir, packageName, CLI_ENTRY);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  // 兜底：返回全局目录下的默认路径，便于错误提示
  // L7: under the block the fallback hint must NEVER be a real existing path — when the
  // real `npm root -g` equals NODE_MODULES the loop above never scanned it (the push is
  // gated on inequality), and rooting the hint there would let cli.js's existsSync go
  // npm-mode against the real global install. Root it at a never-existing guard dir,
  // keeping the package-shaped suffix consumers assert on.
  const fallbackRoot = blocked
    ? join(tmpdir(), 'cc-viewer-test', `guard-gnm-${process.pid}-${threadId}`)
    : (globalRoot || NODE_MODULES);
  return join(fallbackRoot, PACKAGES[0], CLI_ENTRY);
}

/**
 * 查找 npm 版本的 claude（包括 nvm 安装）
 * 返回 node_modules 中的 claude cli.js 路径
 */
export function resolveNpmClaudePath() {
  // 1. 尝试 which/command -v 找到 npm 安装的 claude（Windows 上用 `where`，否则 POSIX 二选一）
  const lookupCmds = process.platform === 'win32'
    ? [`where ${BINARY_NAME}`]
    : [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`];
  for (const cmd of lookupCmds) {
    try {
      // Windows `where` 输出可能多行 CRLF，取第一行 trim 即可
      const rawOut = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env, windowsHide: true });
      const result = rawOut.split(/\r?\n/)[0].trim();
      if (result && existsSync(result)) {
        // 只接受 npm 安装的符号链接（解析后指向 node_modules）
        try {
          const real = realpathSync(result);
          if (real.includes('node_modules')) {
            // realpath 在 Win 上是 backslash，统一 normalize 成 '/' 再匹配
            const normReal = real.replace(/\\/g, '/');
            const match = normReal.match(/(.*node_modules\/@[^/]+\/[^/]+)\//);
            if (match) {
              const packageDir = match[1];
              // Claude Code 1.x: cli.js (injected with interceptor)
              const cliPath = join(packageDir, CLI_ENTRY);
              if (existsSync(cliPath)) {
                return cliPath;
              }
              // Claude Code 2.x layout ships no cli.js — the package's bin/ binary IS
              // the entry point; without this fallback the resolver returns null and
              // the launch dies with no claude at all.
              const binPath = findNpmBinFallback(packageDir);
              if (binPath) return binPath;
            }
          }
        } catch { }
      }
    } catch {
      // ignore
    }
  }

  // L7: the global node_modules lookup below ignores PATH isolation (`npm root -g` finds the
  // real global root regardless of a sanitized PATH) — blocked under test context.
  if (isRealClaudeLookupBlocked()) return null;

  // 2. 尝试从全局 node_modules 查找
  const globalRoot = getGlobalNodeModulesDir();
  if (globalRoot) {
    for (const packageName of PACKAGES) {
      const pkgDir = join(globalRoot, packageName);
      // Claude Code 1.x: cli.js
      const cliPath = join(pkgDir, CLI_ENTRY);
      if (existsSync(cliPath)) {
        return cliPath;
      }
      // Claude Code 2.x: no cli.js, fall back to the package's bin/ entry.
      const binPath = findNpmBinFallback(pkgDir);
      if (binPath) return binPath;
    }
  }

  return null;
}

// Claude Code 2.x npm packages ship no cli.js — bin/claude(.exe) is the entry point.
// `claude.exe` is checked FIRST even on POSIX: 2.1.x's package.json maps
// `bin: {"claude": "bin/claude.exe"}` on every platform (verified on macOS 2.1.207,
// where bin/claude.exe is the platform-native binary hard-linked into bin/).
// Returns the first existing bin candidate under `<pkgDir>/bin`, or null (1.x layout).
function findNpmBinFallback(pkgDir) {
  const binDir = join(pkgDir, 'bin');
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude.exe', 'claude'];
  for (const name of names) {
    const binPath = join(binDir, name);
    if (existsSync(binPath)) return binPath;
  }
  return null;
}

/**
 * 从 which/where 的原始输出中挑出能直接 CreateProcess/exec 的候选行。
 * Windows 的 `where` 会列出 PATH 中全部同名匹配——npm 全局安装时第一行往往是给
 * git-bash 用的**无扩展名 sh shim**（#!/bin/sh 文本文件），其后是 .cmd/.ps1，都不是
 * PE：node-pty/ConPTY 直接 spawn 会抛 "Cannot create process, error code: 193"
 * (ERROR_BAD_EXE_FORMAT)。win32 只接受 .exe 行；POSIX 取第一行。
 * 导出供单测；生产代码经 resolveNativePath 调用。
 */
export function pickSpawnableLookupResult(rawOut, platform = process.platform) {
  const lines = String(rawOut || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (platform === 'win32') return lines.find((l) => l.toLowerCase().endsWith('.exe')) || null;
  return lines[0] || null;
}

/**
 * Resolve the `claude` executable explicitly selected by the caller's PATH.
 *
 * Wrappers such as CodeFuse's `cfuse --ccv` prepend their managed Claude Code
 * directory to PATH before launching ccv. This lookup must happen before any
 * global npm fallback, otherwise an unrelated global @anthropic-ai install wins
 * and the wrapper-provided (and potentially enterprise-approved) binary is lost.
 *
 * Returns both the path and whether Node is required for a legacy cli.js entry.
 */
export function resolveClaudeFromPath() {
  const lookupCmds = process.platform === 'win32'
    ? [`where ${BINARY_NAME}`]
    : [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`];

  for (const cmd of lookupCmds) {
    try {
      const rawOut = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env, windowsHide: true });
      const result = pickSpawnableLookupResult(rawOut);
      if (!result || !existsSync(result)) continue;

      let real = result;
      try { real = realpathSync(result); } catch { }
      if (real.endsWith('.js')) return { path: real, isNpmVersion: true };
      return { path: result, isNpmVersion: false };
    } catch {
      // Try the next lookup command.
    }
  }

  return null;
}

// Starpoint currently approves the CodeFuse-managed Claude Code 2.1.199 build.
// Keep standalone `ccv` on the same binary as `cfuse --ccv`; callers can move
// the pin deliberately after a new enterprise build has been approved.
export const DEFAULT_CODEFUSE_CLAUDE_VERSION = '2.1.199';

export function resolveCodeFuseClaudePath(
  codeFuseClaudeRoot = null,
  version = process.env.CCV_CODEFUSE_CLAUDE_VERSION?.trim() || DEFAULT_CODEFUSE_CLAUDE_VERSION,
) {
  // Never let a test process escape its disposable fixtures into the real home.
  // Tests exercise this resolver by passing an explicit temporary root.
  if (!codeFuseClaudeRoot) {
    if (isRealClaudeLookupBlocked()) return null;
    codeFuseClaudeRoot = join(homedir(), '.codefuse', 'fuse', 'engine', 'bin', 'claude');
  }
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  const versionDir = join(codeFuseClaudeRoot, version);
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude', 'claude.exe'];
  for (const name of names) {
    const candidate = join(versionDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveNativePath() {
  // L7: steps 1 & 4 (platform/packaged binaries under `npm root -g`) ignore PATH isolation —
  // neutralized under test context via a null globalRoot (both helpers null-guard).
  const globalRoot = isRealClaudeLookupBlocked() ? null : getGlobalNodeModulesDir();

  // 1. 优先：平台特定 optionalDependency 里的原生二进制（如
  //    @anthropic-ai/claude-code-darwin-arm64/claude）。
  //    这是 Claude Code 2.x 真正的原生二进制源头，postinstall 只是把它复制到
  //    wrapper 包的 bin/claude.exe。如果 postinstall 没跑（--ignore-scripts /
  //    某些 pnpm 配置），bin/claude.exe 是个报错 stub；直接用平台特定路径可以
  //    绕过 stub 问题。
  const platformBin = findPlatformBinary(globalRoot);
  if (platformBin) return platformBin;

  // 2. 尝试 which/command -v（继承当前 process.env PATH；Win 上用 `where`）
  const lookupCmds = process.platform === 'win32'
    ? [`where ${BINARY_NAME}`]
    : [`which ${BINARY_NAME}`, `command -v ${BINARY_NAME}`];
  for (const cmd of lookupCmds) {
    try {
      const rawOut = execSync(cmd, { encoding: 'utf-8', shell: true, env: process.env, windowsHide: true });
      // win32 过滤掉 sh shim / .cmd / .ps1，只取 .exe（否则 ConPTY spawn 报 error 193）
      const result = pickSpawnableLookupResult(rawOut);
      if (result && existsSync(result)) {
        // 只排除 .js 文件（老版本 npm 分发的 cli.js，需要 node 运行，
        // 由 resolveNpmClaudePath 处理）。Claude Code 2.x+ 的 npm 包内
        // 直接打包了原生二进制（bin/claude.exe），应当作 native 处理。
        let real = result;
        try { real = realpathSync(result); } catch { }
        if (real.endsWith('.js')) continue;
        return result;
      }
    } catch {
      // ignore
    }
  }

  // 3. 检查常见 native 安装路径
  //    注意：~/.claude/ 前缀走 getClaudeConfigDir()，尊重 CLAUDE_CONFIG_DIR 重定向；
  //    其他 ~/ 前缀（如 ~/.local）只走普通 homedir 展开。
  // L7: under test context only the ~/.claude/ candidates survive — they expand through
  // getClaudeConfigDir(), which L1b already redirects to a private temp dir under tests (and
  // an explicit CLAUDE_CONFIG_DIR is the sanctioned fixture seam). The raw absolute candidates
  // (/usr/local/bin, /opt/homebrew/bin) and plain-~ ones ignore PATH/HOME isolation entirely.
  const home = homedir();
  const claudeDir = getClaudeConfigDir();
  const nativeCandidates = isRealClaudeLookupBlocked()
    ? NATIVE_CANDIDATES.filter(p => p.startsWith('~/.claude/'))
    : NATIVE_CANDIDATES;
  const candidates = nativeCandidates.map(p => {
    if (p.startsWith('~/.claude/')) return join(claudeDir, p.slice('~/.claude/'.length));
    if (p.startsWith('~')) return join(home, p.slice(2));
    return p;
  });
  for (const p of candidates) {
    if (existsSync(p)) {
      return p;
    }
    // Windows 原生安装器（install.ps1）落的是 claude.exe（如 ~/.local/bin/claude.exe），
    // 无扩展名候选在 win32 上永远 miss，这里补查 .exe 变体。
    if (process.platform === 'win32' && existsSync(p + '.exe')) {
      return p + '.exe';
    }
  }

  // 4. 兜底：wrapper 包的 bin/claude(.exe)（可能是 postinstall 后的真实二进制，
  //    也可能是 stub；若能走到这一步说明平台特定包也没找到，没法再兜底了）
  const inPkg = findPackagedBinary(globalRoot);
  if (inPkg) return inPkg;

  return null;
}

// 在给定的 node_modules 根目录下扫描 PACKAGES 里每个候选包的 bin/claude(.exe)
// 导出以便测试；生产代码通过 resolveNativePath 调用。
export function findPackagedBinary(nodeModulesRoot) {
  if (!nodeModulesRoot) return null;
  for (const pkg of PACKAGES) {
    for (const name of ['claude.exe', 'claude']) {
      const p = join(nodeModulesRoot, pkg, 'bin', name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// 检测当前平台对应的 optionalDependency 包名片段。
// 返回如 "darwin-arm64" | "linux-x64" | "linux-x64-musl" | "win32-arm64"，
// 未知平台返回 null。逻辑与 @anthropic-ai/claude-code 的 install.cjs 保持一致。
export function detectPlatformKey() {
  const platform = process.platform;
  let cpu = arch();
  if (platform === 'darwin') {
    // Rosetta 2：x64 Node 跑在 Apple Silicon 上会报 arch()==='x64'，但应该用 arm64 原生二进制
    if (cpu === 'x64') {
      try {
        const r = spawnSync('sysctl', ['-n', 'sysctl.proc_translated'], { encoding: 'utf-8' });
        if (r.status === 0 && r.stdout.trim() === '1') cpu = 'arm64';
      } catch { /* ignore */ }
    }
    return `darwin-${cpu}`;
  }
  if (platform === 'linux') {
    // musl 检测：process.report 在 musl 上没有 glibcVersionRuntime 字段
    let musl = false;
    try {
      const report = typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
      musl = report && report.header?.glibcVersionRuntime === undefined;
    } catch { /* ignore */ }
    return `linux-${cpu}${musl ? '-musl' : ''}`;
  }
  if (platform === 'win32') return `win32-${cpu}`;
  return null;
}

// 检测 Claude Code 2.x wrapper 包是否已安装。install.cjs 是 2.x wrapper 独有的
// 文件（1.x 的 cli.js 分发不带它），可作为"是 2.x 布局"的可靠标识。
// 当我们既找不到 cli.js 也找不到原生二进制时，此函数用来区分"根本没装 claude"
// 和"装了 2.x 但 postinstall/optional 依赖出问题了"两种情况，给出更精准的提示。
export function hasClaude2xWrapper(nodeModulesRoot) {
  if (!nodeModulesRoot) return false;
  for (const pkg of PACKAGES) {
    if (existsSync(join(nodeModulesRoot, pkg, 'install.cjs'))) return true;
  }
  return false;
}

// Claude Code 2.x 把真正的原生二进制放在平台特定的 optional dependency 包中
// （如 @anthropic-ai/claude-code-darwin-arm64/claude）。postinstall 只是把它复制到
// 主包的 bin/claude.exe。如果 postinstall 没跑（--ignore-scripts / pnpm），bin/claude.exe
// 会是一个报错的 stub；直接定位平台特定包里的原生二进制更可靠。
export function findPlatformBinary(nodeModulesRoot) {
  if (!nodeModulesRoot) return null;
  const key = detectPlatformKey();
  if (!key) return null;
  const binName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const pkgNames = [`@anthropic-ai/claude-code-${key}`, `@ali/claude-code-${key}`];
  for (const pkgName of pkgNames) {
    const candidates = [
      // 扁平布局（npm 提升 optional dep 到 global node_modules 顶层）
      join(nodeModulesRoot, pkgName, binName),
      // 嵌套布局（optional dep 保留在 wrapper 包内部）
      join(nodeModulesRoot, '@anthropic-ai', 'claude-code', 'node_modules', pkgName, binName),
      join(nodeModulesRoot, '@ali', 'claude-code', 'node_modules', pkgName, binName),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Collect spawnable Claude Code entry points for the machine-level selector.
 * This is intentionally read-only and never executes a discovered binary.
 */
export function discoverClaudeExecutables({ configuredPath = null, allowReal = false, includeDefaults = true } = {}) {
  const found = [];
  const seen = new Set();
  const inferNpmVersion = (realPath) => {
    const normalized = String(realPath).replace(/\\/g, '/');
    const match = normalized.match(/^(.*\/node_modules\/@(?:anthropic-ai|ali)\/claude-code)(?:\/|$)/);
    if (!match) return null;
    try {
      const pkg = JSON.parse(readFileSync(join(match[1], 'package.json'), 'utf8'));
      return typeof pkg.version === 'string' ? pkg.version : null;
    } catch { return null; }
  };
  const add = (value, source, version = null) => {
    const expanded = expandClaudeExecutablePath(value);
    const resolved = resolveExplicitClaudePath(expanded);
    if (!resolved || seen.has(resolved.realPath)) return;
    const { realPath } = resolved;
    seen.add(realPath);
    found.push({
      path: expanded,
      realPath,
      source,
      version: version || inferNpmVersion(realPath),
      isNpmVersion: resolved.isNpmVersion,
    });
  };

  // Keep the saved value first so the UI does not jump when it is also found
  // through PATH or a package scan.
  if (configuredPath) add(configuredPath, 'configured');
  if (!includeDefaults || (isRealClaudeLookupBlocked() && !allowReal)) return found;

  // CodeFuse keeps one directory per managed Claude version.
  const codeFuseRoot = join(homedir(), '.codefuse', 'fuse', 'engine', 'bin', 'claude');
  try {
    const versions = readdirSync(codeFuseRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const names = process.platform === 'win32' ? ['claude.exe'] : ['claude', 'claude.exe'];
      for (const name of names) add(join(codeFuseRoot, version, name), 'codefuse', version);
    }
  } catch { /* CodeFuse is optional. */ }

  // Scan PATH directly. Avoid shelling out to `which`/`where` from the HTTP
  // request path: a wrapper or slow shell startup must not block the viewer.
  const pathNames = process.platform === 'win32' ? [`${BINARY_NAME}.exe`] : [BINARY_NAME];
  for (const dir of String(process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const name of pathNames) add(resolve(dir, name), 'path');
  }

  // npm wrapper, its 2.x bin entry, and the platform-specific optional package.
  const npmRoots = new Set([NODE_MODULES]);
  const globalRoot = getGlobalNodeModulesDir();
  if (globalRoot) npmRoots.add(globalRoot);
  for (const root of npmRoots) {
    for (const pkg of PACKAGES) {
      const pkgDir = join(root, pkg);
      add(join(pkgDir, CLI_ENTRY), 'npm');
      add(join(pkgDir, 'bin', 'claude.exe'), 'npm');
      add(join(pkgDir, 'bin', 'claude'), 'npm');
    }
    const platformBin = findPlatformBinary(root);
    if (platformBin) add(platformBin, 'npm-platform');
  }

  // Native installer defaults and common package-manager locations.
  const home = homedir();
  const claudeDir = getClaudeConfigDir();
  for (const value of NATIVE_CANDIDATES) {
    const expanded = value.startsWith('~/.claude/')
      ? join(claudeDir, value.slice('~/.claude/'.length))
      : value.startsWith('~/') ? join(home, value.slice(2)) : value;
    add(expanded, 'native');
    if (process.platform === 'win32') add(expanded + '.exe', 'native');
  }
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || home;
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    add(join(userProfile, '.local', 'bin', 'claude.exe'), 'native');
    if (localAppData) add(join(localAppData, 'Programs', 'claude', 'claude.exe'), 'native');
    if (appData) add(join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), 'npm');
  }

  return found;
}

export function buildShellCandidates() {
  const globalRoot = getGlobalNodeModulesDir();
  // 使用 $HOME 而非硬编码绝对路径，保证 shell 可移植性
  const dirs = [];
  if (globalRoot) {
    // 将绝对路径中的 homedir 替换为 $HOME
    const home = homedir();
    const shellRoot = globalRoot.startsWith(home)
      ? '$HOME' + globalRoot.slice(home.length)
      : globalRoot;
    for (const pkg of PACKAGES) {
      dirs.push(`"${shellRoot}/${pkg}/${CLI_ENTRY}"`);
    }
  }
  return dirs.join(' ');
}
