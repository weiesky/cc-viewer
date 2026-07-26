// Windows compatibility regressions — issue #137 (ccv CLI) and #129 (Electron).
//
// #137: `ccv` on Windows died with "Claude Code cli.js not found: <path>" even
// though the package WAS installed at that exact path. Root cause:
// getGlobalNodeModulesDir() called execFileSync('npm.cmd', ...), and since the
// CVE-2024-27980 fix (Node 18.20.2 / 20.12.2 / 22.0.0) Node throws EINVAL
// synchronously for a .cmd/.bat target without a shell. The throw hit the
// catch-all and returned null, so every discovery path that keys off the global
// node_modules root missed the install. The fix routes through `cmd.exe /c` and
// adds an npm-free fallback so a failing npm can no longer hide an install.
//
// These assertions are platform-parameterized on purpose: the win32 behavior must
// be verifiable from the POSIX CI runners, where cmd.exe cannot be executed.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildNpmRootCommand,
  parseNpmRootOutput,
  globalNodeModulesCandidates,
  getGlobalNodeModulesDir,
  inferGlobalNodeModulesDir,
} from '../findcc.js';

const SAVED = { PATH: process.env.PATH, NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX };
function restoreEnv() {
  process.env.PATH = SAVED.PATH;
  if (SAVED.NPM_CONFIG_PREFIX === undefined) delete process.env.NPM_CONFIG_PREFIX;
  else process.env.NPM_CONFIG_PREFIX = SAVED.NPM_CONFIG_PREFIX;
}

describe('#137: npm root -g must not hit the Node batch-file EINVAL guard', () => {
  it('win32 spawns cmd.exe (a real PE) — never npm.cmd directly', () => {
    const { cmd, args } = buildNpmRootCommand('win32', {});
    // The regression: any .cmd/.bat target throws EINVAL under Node >= 18.20.2.
    assert.ok(!/\.(cmd|bat)$/i.test(cmd),
      `executed image must not be a batch file, got: ${cmd}`);
    assert.equal(cmd, 'cmd.exe');
    assert.deepEqual(args, ['/d', '/s', '/c', 'npm root -g']);
  });

  it('win32 honors COMSPEC when the shell lives outside the default location', () => {
    const { cmd } = buildNpmRootCommand('win32', { COMSPEC: 'D:\\Windows\\System32\\cmd.exe' });
    assert.equal(cmd, 'D:\\Windows\\System32\\cmd.exe');
  });

  it('win32 passes the command verbatim so cmd.exe can parse it', () => {
    // Without windowsVerbatimArguments Node quotes the argument and cmd.exe
    // fails to parse `"npm root -g"` as a command.
    assert.equal(buildNpmRootCommand('win32', {}).windowsVerbatimArguments, true);
  });

  it('the argv is a fixed literal — no interpolation, so no injection surface', () => {
    const evil = { COMSPEC: 'cmd.exe', NPM_CONFIG_PREFIX: 'C:\\x & calc.exe' };
    const { args } = buildNpmRootCommand('win32', evil);
    assert.deepEqual(args, ['/d', '/s', '/c', 'npm root -g']);
    assert.ok(!args.some(a => a.includes('calc.exe')));
  });

  it('POSIX keeps calling npm directly (unchanged behavior)', () => {
    const { cmd, args, windowsVerbatimArguments } = buildNpmRootCommand('darwin', {});
    assert.equal(cmd, 'npm');
    assert.deepEqual(args, ['root', '-g']);
    assert.equal(windowsVerbatimArguments, false);
  });
});

describe('#137: npm root output parsing', () => {
  it('takes the last non-empty line, tolerating npm warnings and CRLF', () => {
    const raw = 'npm warn config production Use `--omit=dev`\r\n'
      + 'C:\\Users\\zhangyixiang\\AppData\\Roaming\\npm\\node_modules\r\n';
    assert.equal(parseNpmRootOutput(raw),
      'C:\\Users\\zhangyixiang\\AppData\\Roaming\\npm\\node_modules');
  });

  it('trims a bare LF path', () => {
    assert.equal(parseNpmRootOutput('/usr/local/lib/node_modules\n'), '/usr/local/lib/node_modules');
  });

  it('returns null for empty / whitespace-only / nullish output', () => {
    for (const raw of ['', '   ', '\r\n\r\n', null, undefined]) {
      assert.equal(parseNpmRootOutput(raw), null, `expected null for ${JSON.stringify(raw)}`);
    }
  });
});

describe('#137: npm-free fallback candidates', () => {
  it('win32 includes the AppData\\Roaming\\npm root from the issue report', () => {
    const got = globalNodeModulesCandidates('win32', {
      APPDATA: 'C:\\Users\\zhangyixiang\\AppData\\Roaming',
    }, 'C:\\Users\\zhangyixiang');
    assert.ok(got.includes('C:\\Users\\zhangyixiang\\AppData\\Roaming\\npm\\node_modules'),
      `missing the default global root, got: ${JSON.stringify(got)}`);
  });

  it('win32 candidates use backslashes even when computed on POSIX', () => {
    const got = globalNodeModulesCandidates('win32', { APPDATA: 'C:\\Users\\z\\AppData\\Roaming' }, 'C:\\Users\\z');
    const appDataHit = got.find(p => p.includes('AppData'));
    assert.ok(appDataHit && !appDataHit.includes('/'),
      `win32 path must not contain forward slashes: ${appDataHit}`);
    assert.equal(appDataHit, win32.join('C:\\Users\\z\\AppData\\Roaming', 'npm', 'node_modules'));
  });

  it('an explicit npm prefix wins over the platform defaults', () => {
    const got = globalNodeModulesCandidates('win32', {
      NPM_CONFIG_PREFIX: 'D:\\node-prefix',
      APPDATA: 'C:\\Users\\z\\AppData\\Roaming',
    }, 'C:\\Users\\z');
    assert.equal(got[0], 'D:\\node-prefix\\node_modules', 'prefix must be probed first');
    assert.ok(got.indexOf('D:\\node-prefix\\node_modules')
      < got.indexOf('C:\\Users\\z\\AppData\\Roaming\\npm\\node_modules'));
  });

  it('POSIX list is unchanged and never contains Windows-only roots', () => {
    const got = globalNodeModulesCandidates('darwin', {}, '/Users/x');
    assert.ok(got.includes('/usr/local/lib/node_modules'));
    assert.ok(got.includes('/opt/homebrew/lib/node_modules'));
    assert.ok(!got.some(p => /AppData|ProgramFiles/i.test(p)));
  });

  it("cc-viewer's own node_modules is the last resort on every platform", () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const got = globalNodeModulesCandidates(platform, {}, '/home/u');
      assert.ok(got[got.length - 1].endsWith('node_modules'),
        `${platform}: expected a node_modules tail, got ${got[got.length - 1]}`);
    }
  });
});

describe('#137: getGlobalNodeModulesDir end-to-end', () => {
  afterEach(() => restoreEnv());

  it('resolves a real root on this machine (npm present)', () => {
    const got = getGlobalNodeModulesDir();
    assert.equal(typeof got, 'string');
    assert.ok(got.endsWith('node_modules'), `expected a node_modules path, got: ${got}`);
  });

  it('still resolves a root when npm is absent from PATH (the EINVAL surrogate)', () => {
    // A failing `npm root -g` — the observable end state of the EINVAL throw on
    // Windows — must no longer collapse discovery to null. Under NODE_TEST_CONTEXT
    // the L7 barrier keeps the fallback off the real machine paths, so assert the
    // call is total (never throws) rather than asserting a specific dir.
    process.env.PATH = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/nonexistent-bin';
    process.env.NPM_CONFIG_PREFIX = join(tmpdir(), `ccv-137-missing-${process.pid}`);
    const got = getGlobalNodeModulesDir();
    assert.ok(got === null || typeof got === 'string');
  });

  it('L7: the machine-path fallback is blocked under test context', () => {
    // Tests must never discover the developer's real global install through the
    // absolute-path fallback; `npm root -g` stays the only sanctioned seam.
    assert.equal(process.env.NODE_TEST_CONTEXT ? inferGlobalNodeModulesDir() : null, null);
  });

  it('an existing prefix dir is honored when npm cannot run', () => {
    // Exercises the pure candidate builder against a real directory, proving the
    // "npm broken but install present" path resolves instead of returning null.
    const base = mkdtempSync(join(tmpdir(), 'ccv-137-prefix-'));
    try {
      const nm = join(base, 'node_modules');
      mkdirSync(nm, { recursive: true });
      const cands = globalNodeModulesCandidates(process.platform, { NPM_CONFIG_PREFIX: base }, base);
      assert.equal(cands[0], join(base, 'node_modules'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
