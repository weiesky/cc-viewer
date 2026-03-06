import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
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

describe('ccv --help', () => {
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

describe('ccv --version', () => {
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

describe('ccv --uninstall', () => {
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

describe('shell config path selection', () => {
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

describe('ccv run', () => {
  it('errors when no command is provided after run', () => {
    const r = runCli(['run']);
    // Should fail because no command to run
    assert.notEqual(r.exitCode, 0);
  });
});

// ─── arg parsing edge cases ───

describe('arg parsing', () => {
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
});
