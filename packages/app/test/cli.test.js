import { describe, it, before, after, beforeEach } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, utimesSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'cli.js');
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

/**
 * Helper: run cli.js with given args, return { stdout, stderr, exitCode }.
 * Uses a fake HOME so install/uninstall never touch real shell configs.
 */
function runCli(args = [], opts = {}) {
  const env = { ...process.env, ...opts.env };
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 15000,
      env,
      cwd: opts.cwd || __dirname,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status ?? 1,
    };
  }
}

// ─── --help ───

describeCli('ccv --help', () => {
  it('exits 0 and prints help text', () => {
    const r = runCli(['--help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0, 'should print help output');
  });

  it('-h is an alias for --help', () => {
    const r = runCli(['-h']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0);
  });

  it('"help" subcommand works', () => {
    const r = runCli(['help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0);
  });

  it('all three variants produce the same output', () => {
    const a = runCli(['--help']).stdout;
    const b = runCli(['-h']).stdout;
    const c = runCli(['help']).stdout;
    assert.equal(a, b);
    assert.equal(b, c);
  });
});

// ─── --version ───

describeCli('ccv --version', () => {
  it('exits 0 and prints version from package.json', () => {
    const r = runCli(['--version']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes(`cc-viewer v${PKG.version}`));
  });

  it('-v is an alias', () => {
    const r = runCli(['-v']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes(PKG.version));
  });

  it('--v is an alias', () => {
    const r = runCli(['--v']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes(PKG.version));
  });
});

// ─── --uninstall with isolated HOME ───

describeCli('ccv --uninstall', () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = resolve(tmpdir(), `ccv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(fakeHome, { recursive: true });
  });

  after(() => {
    // cleanup all temp dirs created during this suite
    try {
      // individual cleanup in afterEach would be better, but after() covers it
    } catch {}
  });

  it('exits 0 when nothing to uninstall', () => {
    const zshrc = join(fakeHome, '.zshrc');
    writeFileSync(zshrc, '# empty\n');
    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);
    // Should not crash, should mention done/clean
    assert.ok(r.stdout.length > 0);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('removes shell hook when present', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = [
      '# existing config',
      '',
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() {',
      '  command claude "$@"',
      '}',
      '# <<< CC-Viewer Auto-Inject <<<',
      '',
    ].join('\n');
    writeFileSync(zshrc, hookContent);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);

    const after = readFileSync(zshrc, 'utf-8');
    assert.ok(!after.includes('CC-Viewer Auto-Inject'), 'hook should be removed from .zshrc');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('handles missing .zshrc gracefully', () => {
    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('removes npm mode hook completely', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = [
      '# user config before',
      '',
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() {',
      '  local cli_js=""',
      '  for candidate in "$HOME/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js"; do',
      '    if [ -f "$candidate" ]; then',
      '      cli_js="$candidate"',
      '      break',
      '    fi',
      '  done',
      '  if [ -n "$cli_js" ] && ! grep -q "CC Viewer" "$cli_js" 2>/dev/null; then',
      '    ccv 2>/dev/null',
      '  fi',
      '  command claude "$@"',
      '}',
      '# <<< CC-Viewer Auto-Inject <<<',
      '',
      '# user config after',
    ].join('\n');
    writeFileSync(zshrc, hookContent);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);

    const after = readFileSync(zshrc, 'utf-8');
    assert.ok(!after.includes('CC-Viewer Auto-Inject'), 'hook markers should be removed');
    assert.ok(!after.includes('ccv 2>/dev/null'), 'ccv call should be removed');
    assert.ok(after.includes('# user config before'), 'user config before should remain');
    assert.ok(after.includes('# user config after'), 'user config after should remain');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('removes native mode hook completely', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = [
      '# user config',
      '',
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() {',
      '  if [ "$1" = "--ccv-internal" ]; then',
      '    shift',
      '    command claude "$@"',
      '    return',
      '  fi',
      '  case "$1" in',
      '    doctor|install|update|upgrade|auth|setup-token|agents|plugin|mcp)',
      '      command claude "$@"',
      '      return',
      '      ;;',
      '    --version|-v|--v|--help|-h)',
      '      command claude "$@"',
      '      return',
      '      ;;',
      '  esac',
      '  ccv run -- claude --ccv-internal "$@"',
      '}',
      '# <<< CC-Viewer Auto-Inject <<<',
      '',
    ].join('\n');
    writeFileSync(zshrc, hookContent);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);

    const after = readFileSync(zshrc, 'utf-8');
    assert.ok(!after.includes('CC-Viewer Auto-Inject'), 'hook markers should be removed');
    assert.ok(!after.includes('ccv run'), 'ccv run call should be removed');
    assert.ok(!after.includes('--ccv-internal'), '--ccv-internal flag should be removed');
    assert.ok(after.includes('# user config'), 'user config should remain');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('preserves user content around hook', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = [
      'export PATH="/usr/local/bin:$PATH"',
      'alias ll="ls -la"',
      '',
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() { command claude "$@"; }',
      '# <<< CC-Viewer Auto-Inject <<<',
      '',
      'export EDITOR=vim',
      'source ~/.zsh_custom',
    ].join('\n');
    writeFileSync(zshrc, hookContent);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);

    const after = readFileSync(zshrc, 'utf-8');
    assert.ok(!after.includes('CC-Viewer'), 'hook should be removed');
    assert.ok(after.includes('export PATH'), 'PATH export should remain');
    assert.ok(after.includes('alias ll'), 'alias should remain');
    assert.ok(after.includes('export EDITOR'), 'EDITOR export should remain');
    assert.ok(after.includes('source ~/.zsh_custom'), 'source command should remain');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('handles multiple hooks (should remove all)', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = [
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() { command claude "$@"; }',
      '# <<< CC-Viewer Auto-Inject <<<',
      '',
      '# some user config',
      '',
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() { ccv run -- claude "$@"; }',
      '# <<< CC-Viewer Auto-Inject <<<',
    ].join('\n');
    writeFileSync(zshrc, hookContent);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);

    const after = readFileSync(zshrc, 'utf-8');
    assert.ok(!after.includes('CC-Viewer'), 'all hooks should be removed');
    assert.ok(after.includes('# some user config'), 'user config should remain');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('reports each cleaned rc file separately', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const bashrc = join(fakeHome, '.bashrc');
    const block = [
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() { command claude "$@"; }',
      '# <<< CC-Viewer Auto-Inject <<<',
    ].join('\n');
    writeFileSync(zshrc, block + '\n');
    writeFileSync(bashrc, block + '\n');

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh', LANG: 'en_US.UTF-8' },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(!readFileSync(zshrc, 'utf-8').includes('CC-Viewer'), '.zshrc should be cleaned');
    assert.ok(!readFileSync(bashrc, 'utf-8').includes('CC-Viewer'), '.bashrc should be cleaned');
    assert.ok(r.stdout.includes(zshrc), 'stdout should name the cleaned .zshrc');
    assert.ok(r.stdout.includes(bashrc), 'stdout should name the cleaned .bashrc');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('corrupted block (missing END marker): warns, leaves file untouched, no false removal', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const corrupt = [
      '# user config',
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() { command claude "$@"; }',
      '# end marker was deleted by the user',
    ].join('\n');
    writeFileSync(zshrc, corrupt);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh', LANG: 'en_US.UTF-8' },
    });
    assert.equal(r.exitCode, 0);
    assert.equal(readFileSync(zshrc, 'utf-8'), corrupt, 'corrupted file must not be rewritten');
    assert.ok(r.stdout.includes('damaged'), 'should warn about the damaged block');
    assert.ok(!r.stdout.includes(`Shell hook removed from ${zshrc}`),
      'must not claim a removal that did not happen');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('writes the uninstall tombstone under the config dir', () => {
    const cfgDir = join(fakeHome, '.claude');
    writeFileSync(join(fakeHome, '.zshrc'), '# empty\n');
    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: cfgDir, LANG: 'en_US.UTF-8' },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(existsSync(join(cfgDir, 'cc-viewer', 'uninstalled.flag')),
      'uninstalled.flag should exist after --uninstall');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('outputs helpful message about unset -f claude', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = [
      '# >>> CC-Viewer Auto-Inject >>>',
      'claude() { command claude "$@"; }',
      '# <<< CC-Viewer Auto-Inject <<<',
    ].join('\n');
    writeFileSync(zshrc, hookContent);

    const r = runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('unset -f claude') || r.stdout.includes('重启终端'),
      'should mention unset -f claude or restart terminal');
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

// ─── getShellConfigPath logic (tested indirectly via --uninstall) ───

describeCli('shell config path selection', () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = resolve(tmpdir(), `ccv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(fakeHome, { recursive: true });
  });

  it('uses .zshrc for zsh shell', () => {
    const zshrc = join(fakeHome, '.zshrc');
    const hookContent = '# >>> CC-Viewer Auto-Inject >>>\ntest\n# <<< CC-Viewer Auto-Inject <<<\n';
    writeFileSync(zshrc, hookContent);

    runCli(['--uninstall'], { env: { HOME: fakeHome, SHELL: '/bin/zsh' } });
    const content = readFileSync(zshrc, 'utf-8');
    assert.ok(!content.includes('CC-Viewer Auto-Inject'), 'should have cleaned .zshrc');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('uses .bashrc for bash shell (linux)', () => {
    const bashrc = join(fakeHome, '.bashrc');
    const hookContent = '# >>> CC-Viewer Auto-Inject >>>\ntest\n# <<< CC-Viewer Auto-Inject <<<\n';
    writeFileSync(bashrc, hookContent);

    // Simulate linux bash (no .bash_profile)
    runCli(['--uninstall'], {
      env: { HOME: fakeHome, SHELL: '/bin/bash', CCV_TEST_PLATFORM: 'linux' },
    });

    // On macOS this test may use .bash_profile logic, but the hook in .bashrc
    // should still be cleaned if that's the file getShellConfigPath returns
    if (process.platform !== 'darwin') {
      const content = readFileSync(bashrc, 'utf-8');
      assert.ok(!content.includes('CC-Viewer Auto-Inject'));
    }
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('uses .bash_profile on macOS when it exists', () => {
    if (process.platform !== 'darwin') return; // skip on non-macOS

    const bashProfile = join(fakeHome, '.bash_profile');
    const hookContent = '# >>> CC-Viewer Auto-Inject >>>\ntest\n# <<< CC-Viewer Auto-Inject <<<\n';
    writeFileSync(bashProfile, hookContent);

    runCli(['--uninstall'], { env: { HOME: fakeHome, SHELL: '/bin/bash' } });
    const content = readFileSync(bashProfile, 'utf-8');
    assert.ok(!content.includes('CC-Viewer Auto-Inject'));
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

// ─── "run" subcommand without a command ───

describeCli('ccv run', () => {
  it('errors when no command is provided after run', () => {
    const r = runCli(['run']);
    // Should fail because no command to run
    assert.notEqual(r.exitCode, 0);
  });
});

// ─── arg parsing edge cases ───

describeCli('arg parsing', () => {
  it('--help takes priority even with other flags', () => {
    const r = runCli(['--help', '--version']);
    assert.equal(r.exitCode, 0);
    // Should show help, not version
    assert.ok(!r.stdout.includes(`cc-viewer v${PKG.version}`) || r.stdout.length > 50);
  });

  it('--version takes priority over install', () => {
    const r = runCli(['--version']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes(PKG.version));
    // Should NOT attempt installation
    assert.ok(!r.stdout.includes('READY'));
  });

  it('-logger triggers install logic (not passthrough)', () => {
    const fakeHome = resolve(tmpdir(), `ccv-test-logger-${Date.now()}`);
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(join(fakeHome, '.zshrc'), '# empty\n');
    const r = runCli(['-logger'], {
      env: { HOME: fakeHome, SHELL: '/bin/zsh' },
    });
    // -logger should attempt hook installation, not launch claude
    // It may fail if claude is not installed, but it should NOT show help text
    assert.ok(!r.stdout.includes('Usage:') || r.stdout.includes('READY') || r.stdout.includes('installed') || r.stderr.includes('claude') || r.exitCode !== 0);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('help text reflects new passthrough usage', () => {
    const r = runCli(['--help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('-logger'), 'help should mention -logger');
    assert.ok(r.stdout.includes('passed through') || r.stdout.includes('passed\nthrough') || r.stdout.includes('透传') || r.stdout.includes('透傳'), 'help should mention passthrough');
    // Old -d/-c flags should no longer appear as ccv options
    assert.ok(!r.stdout.includes('-d [path]'), 'help should not mention old -d [path]');
    assert.ok(!r.stdout.includes('-c [path]'), 'help should not mention old -c [path]');
  });
});

// ─── --no-open ───

describeCli('ccv --no-open', () => {
  it('--no-open appears in help text', () => {
    const r = runCli(['--help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('--no-open'), 'help text should document --no-open');
  });

  it('--no-open is stripped before --help (does not error)', () => {
    const r = runCli(['--no-open', '--help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0, 'should print help');
  });
});

// ─── --log-dir ───

describeCli('ccv --log-dir', () => {
  it('--log-dir appears in help text', () => {
    const r = runCli(['--help']);
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('--log-dir'), 'help text should document --log-dir');
  });

  it('--log-dir without value prints error and exits non-zero', () => {
    const r = runCli(['--log-dir']);
    assert.notEqual(r.exitCode, 0, 'should fail without path argument');
    assert.ok(
      r.stderr.includes('--log-dir requires') || r.stdout.includes('--log-dir requires'),
      'should mention --log-dir requires a path'
    );
  });

  it('--log-dir with flag-like value prints error', () => {
    const r = runCli(['--log-dir', '--version']);
    assert.notEqual(r.exitCode, 0, 'should fail when value looks like a flag');
  });

  it('--log-dir is stripped from args before --help', () => {
    const fakeHome = resolve(tmpdir(), `ccv-test-logdir-${Date.now()}`);
    mkdirSync(fakeHome, { recursive: true });
    const logDir = join(fakeHome, 'custom-logs');
    const r = runCli(['--log-dir', logDir, '--help'], {
      env: { HOME: fakeHome },
    });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.length > 0, 'should print help after consuming --log-dir');
    rmSync(fakeHome, { recursive: true, force: true });
  });
});

// ─── Shell hook template invariants ───
// These capture the critical structural guarantees of the hook templates
// generated by buildShellHook(). They are source-grep tests rather than
// behavioral tests because buildShellHook is internal to cli.js; if the
// file is ever refactored to export it, swap these for direct unit tests.

describeCli('ccv -logger: shell hook template invariants', () => {
  const source = readFileSync(CLI_PATH, 'utf-8');

  it('npm-mode hook includes a 2.x self-heal branch (cli.js missing → ccv run)', () => {
    // The legacy npm hook must detect the "cli.js disappeared" case (Claude Code
    // 2.x+ no longer ships cli.js) and route the current invocation through
    // `ccv run -- claude --ccv-internal "$@"` instead of falling through to a
    // bare `command claude` (which would skip cc-viewer interception entirely).
    assert.ok(source.includes('if [ -z "$cli_js" ]'),
      'npm hook should branch on empty cli_js (2.x self-heal path missing)');
    assert.ok(source.includes('ccv run -- claude --ccv-internal'),
      'npm hook self-heal branch should route through `ccv run -- claude --ccv-internal`');
    assert.ok(/ccv -logger[^\n]*&/.test(source),
      'npm hook self-heal branch should background `ccv -logger &` to rewrite ~/.zshrc for future shells');
  });

  it('npm-mode hook still repairs missing interceptor marker (pre-2.x path intact)', () => {
    // The original self-repair (cli.js present but lacks "CC Viewer" marker)
    // must still trigger `ccv -logger`, so legacy users keep auto-reinjecting
    // after every Claude Code upgrade inside the 1.x line.
    assert.ok(source.includes('grep -q "CC Viewer"'),
      'npm hook should still probe cli.js for CC Viewer marker');
  });

  it('native-mode hook exists and routes all non-passthrough calls through `ccv run`', () => {
    // Count occurrences — both the primary native hook and the self-heal branch
    // in the npm hook call `ccv run -- claude --ccv-internal`. There must be
    // at least two occurrences after this change.
    const matches = source.match(/ccv run -- claude --ccv-internal/g) || [];
    assert.ok(matches.length >= 2,
      `expected ≥2 occurrences of 'ccv run -- claude --ccv-internal' (native hook + npm self-heal), got ${matches.length}`);
  });

  it('logger mode selection no longer depends on realpath(node_modules) heuristic', () => {
    // The old `prefersNative` detection loop has been removed; mode is decided
    // purely by cli.js presence. Guard against regressions that reintroduce
    // the realpath-based detection.
    assert.ok(!source.includes("let prefersNative"),
      'prefersNative local should be gone; use hasNpm routing instead');
    assert.ok(!/real\.includes\(['"]node_modules['"]\).*prefersNative/s.test(source),
      'realpath-based prefersNative heuristic should not be reintroduced');
  });

  it('both hook variants carry the self-unsetting ccv-missing guard', () => {
    // A stranded hook (package npm-uninstalled while the function is still loaded
    // in open shells / rc files) must degrade to the real claude AND remove itself,
    // never fail with `command not found: ccv`.
    assert.ok(
      source.includes('hash -r 2>/dev/null; command -v ccv >/dev/null 2>&1 || { unset -f claude; command claude "$@"; return; }'),
      'guard template must rehash, self-unset and fall back to `command claude`');
    const uses = source.match(/\$\{ccvGoneGuard\}/g) || [];
    assert.equal(uses.length, 2,
      `guard must be interpolated into BOTH hook variants (native + npm), got ${uses.length}`);
  });

  it('hook self-heal invocations pass --self-heal so a tombstoned uninstall is respected', () => {
    // Background self-heal from a stale hook must be distinguishable from an
    // explicit user `ccv -logger`, so --uninstall's tombstone can veto it.
    assert.ok(source.includes('( ccv -logger --self-heal >/dev/null 2>&1 & )'),
      'backgrounded 2.x self-heal must pass --self-heal');
    assert.ok(source.includes('ccv -logger --self-heal 2>/dev/null'),
      'missing-marker self-heal must pass --self-heal');
  });
});

// ─── uninstall tombstone vs -logger ───
// The tombstone check runs before -logger's mode detection, so these tests do
// not require a claude installation. CLAUDE_CONFIG_DIR is pinned to a shared
// throwaway dir because the NODE_TEST_CONTEXT guard otherwise gives every
// spawned child a different pid-scoped config dir (tombstone would be invisible).

describeCli('ccv -logger: uninstall tombstone', () => {
  let fakeHome, cfgDir, flagPath;

  beforeEach(() => {
    fakeHome = resolve(tmpdir(), `ccv-test-tomb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    cfgDir = join(fakeHome, '.claude');
    flagPath = join(cfgDir, 'cc-viewer', 'uninstalled.flag');
    mkdirSync(join(cfgDir, 'cc-viewer'), { recursive: true });
    writeFileSync(join(fakeHome, '.zshrc'), '# empty\n');
    // Isolation for the fall-through cases: a sanitized PATH (no npm → the real
    // global claude cli.js is never resolved) plus a fake native claude under the
    // pinned config dir routes -logger's install path into fakeHome only — it
    // must never touch a user-writable real claude install on a dev machine.
    const localBin = join(cfgDir, 'local');
    mkdirSync(localBin, { recursive: true });
    const fakeClaude = join(localBin, 'claude');
    writeFileSync(fakeClaude, '#!/bin/sh\necho "claude (fake-native) 2.0.0"\n');
    chmodSync(fakeClaude, 0o755);
  });

  const envFor = () => ({
    HOME: fakeHome, SHELL: '/bin/zsh', CLAUDE_CONFIG_DIR: cfgDir, LANG: 'en_US.UTF-8',
    PATH: '/usr/bin:/bin',
  });

  it('-logger --self-heal with tombstone: exits 0 silently, installs nothing', () => {
    writeFileSync(flagPath, new Date().toISOString() + '\n');
    const r = runCli(['-logger', '--self-heal'], { env: envFor() });
    assert.equal(r.exitCode, 0);
    assert.ok(!readFileSync(join(fakeHome, '.zshrc'), 'utf-8').includes('CC-Viewer'),
      'self-heal must not reinstall the hook after uninstall');
    assert.ok(existsSync(flagPath), 'self-heal must not clear the tombstone');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('-logger --self-heal without tombstone: falls through to normal install path', () => {
    // The self-heal happy path (hook backgrounds it after a Claude Code upgrade)
    // must NOT be vetoed when no tombstone exists — only the veto is tombstone-gated.
    const r = runCli(['-logger', '--self-heal'], { env: envFor() });
    assert.ok(!r.stdout.includes('--force'),
      'must not print the justUninstalled refusal without a tombstone');
    assert.ok(!existsSync(flagPath), 'must not create a tombstone');
    // Install outcome depends on whether claude is present on this machine; the
    // invariant is reaching mode detection instead of the silent veto exit.
    assert.ok(r.exitCode === 0 || r.exitCode === 1);
    assert.ok((r.stdout + r.stderr).length > 0,
      'should produce install-path output, not the silent self-heal veto');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('plain -logger with a fresh tombstone: refuses with --force hint, keeps tombstone', () => {
    writeFileSync(flagPath, new Date().toISOString() + '\n');
    const r = runCli(['-logger'], { env: envFor() });
    assert.equal(r.exitCode, 0);
    assert.ok(r.stdout.includes('--force'), 'should point the user at ccv -logger --force');
    assert.ok(existsSync(flagPath), 'fresh tombstone must survive a plain -logger');
    assert.ok(!readFileSync(join(fakeHome, '.zshrc'), 'utf-8').includes('CC-Viewer'),
      'hook must not be installed inside the grace period');
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('plain -logger with an aged tombstone: clears it and proceeds', () => {
    writeFileSync(flagPath, new Date().toISOString() + '\n');
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, past the 10min grace
    utimesSync(flagPath, old, old);
    const r = runCli(['-logger'], { env: envFor() });
    // Install outcome depends on whether claude is present on this machine;
    // the invariant is that the tombstone is consumed either way.
    assert.ok(!existsSync(flagPath), 'aged tombstone should be cleared by plain -logger');
    assert.ok(r.exitCode === 0 || r.exitCode === 1);
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('-logger --force with a fresh tombstone: clears it and proceeds', () => {
    writeFileSync(flagPath, new Date().toISOString() + '\n');
    const r = runCli(['-logger', '--force'], { env: envFor() });
    assert.ok(!existsSync(flagPath), '--force should clear even a fresh tombstone');
    assert.ok(r.exitCode === 0 || r.exitCode === 1);
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
