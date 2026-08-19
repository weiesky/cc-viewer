/**
 * L7 test-isolation guard — findcc.js claude-binary discovery under NODE_TEST_CONTEXT.
 *
 * Background: the absolute NATIVE_CANDIDATES (/usr/local/bin/claude, /opt/homebrew/bin/claude)
 * and the `npm root -g` global lookups ignore the PATH/HOME isolation CLI tests rely on, so
 * "claude not found" tests used to find and RUN the user's real claude (30–120s each), open
 * real browser windows, and -logger paths could mutate a real global install via injectCliJs.
 * Guard semantics (findcc.js isRealClaudeLookupBlocked): in node:test context without
 * CCV_TEST_ALLOW_REAL_CLAUDE=1, PATH-independent discovery vectors are blocked; the two
 * sanctioned fixture seams stay open — a fake `claude` on an isolated PATH (`which`), and an
 * explicit CLAUDE_CONFIG_DIR (`~/.claude/local/claude` candidate, already L1b-redirected).
 *
 * All discovery assertions run in child processes with sanitized PATH/npm (the which seam is
 * deliberately ungated, so an inherited PATH would find a real claude regardless of the block).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { isRealClaudeLookupBlocked, isBrowserOpenSuppressed } from '../packages/app/findcc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const FINDCC_URL = pathToFileURL(join(REPO_ROOT, 'packages', 'app', 'findcc.js')).href;
// findcc.js's un-exported NODE_MODULES = the repo's parent directory (cc-viewer's siblings).
const REAL_NODE_MODULES = join(REPO_ROOT, '..');
const SANITIZED_PATH = '/usr/bin:/bin';

/**
 * Child-process probe: import findcc under a controlled env and print the requested
 * expressions. Keys with `undefined` in envPatch are deleted. `...process.env` spread
 * satisfies the L2 static isolation scanner.
 */
function probe(exprs, envPatch) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.CCV_TEST_ALLOW_REAL_CLAUDE;
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CCV_NO_OPEN;
  for (const [k, v] of Object.entries(envPatch || {})) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  const body = Object.entries(exprs)
    .map(([label, expr]) => `console.log(${JSON.stringify(label)} + '=' + (${expr}));`)
    .join(' ');
  const out = execFileSync(process.execPath, ['-e',
    `import(${JSON.stringify(FINDCC_URL)}).then(m => { ${body} }).catch(e => { console.error(e); process.exit(1); });`,
  ], { env, encoding: 'utf-8', timeout: 30000 });
  const result = {};
  for (const label of Object.keys(exprs)) {
    const m = out.match(new RegExp(`${label}=(.*)`));
    assert.ok(m, `probe must print ${label}, got: ${out}`);
    result[label] = m[1].trim();
  }
  return result;
}

/** Env that closes the two sanctioned seams so only the L7 block is under test. */
function blockedEnv(extra) {
  return {
    NODE_TEST_CONTEXT: 'child-v8',
    PATH: SANITIZED_PATH,                                  // which-seam: no claude reachable
    NPM_CONFIG_PREFIX: mkdtempSync(join(tmpdir(), 'ccv-guard-npm-')), // npm root -g → empty prefix
    ...extra,
  };
}

describe('L7 claude-lookup guard — PATH-independent discovery blocked in tests', () => {
  it('blocked: both resolvers return null even on machines with a real claude installed', () => {
    const r = probe({
      NATIVE: 'm.resolveNativePath()',
      NPM: 'm.resolveNpmClaudePath()',
    }, blockedEnv());
    assert.equal(r.NATIVE, 'null',
      'resolveNativePath must be null under the block (absolute candidates + npm-root-g are the leak)');
    assert.equal(r.NPM, 'null', 'resolveNpmClaudePath must be null under the block');
  });

  it('which-seam preserved: a fake executable claude on an isolated PATH is still found', () => {
    const fakeBin = mkdtempSync(join(tmpdir(), 'ccv-guard-fakebin-'));
    const fakeClaude = join(fakeBin, 'claude');
    writeFileSync(fakeClaude, '#!/bin/sh\nexit 0\n');
    chmodSync(fakeClaude, 0o755);
    const r = probe({ NATIVE: 'm.resolveNativePath()' },
      blockedEnv({ PATH: `${fakeBin}:${SANITIZED_PATH}` }));
    assert.equal(r.NATIVE, fakeClaude, 'fake-PATH fixture seam must keep working under the block');
  });

  it('npm-root-g leak blocked: a WORKING fake npm reporting a seeded global cli.js still yields null', () => {
    // Non-vacuous variant of the headline case: with an npm-less PATH the npm
    // lookup fails regardless of the gate, so this probe supplies a fake `npm`
    // whose `root -g` points at a fixture global root CONTAINING a claude-code
    // cli.js — the only thing standing between it and the resolver is the gate.
    const root = mkdtempSync(join(tmpdir(), 'ccv-guard-gnm-'));
    const binDir = join(root, 'bin');
    const pkgDir = join(root, 'gnm', '@anthropic-ai', 'claude-code');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'cli.js'), '#!/usr/bin/env node\n');
    const fakeNpm = join(binDir, 'npm');
    writeFileSync(fakeNpm, `#!/bin/sh\necho "${join(root, 'gnm')}"\n`);
    chmodSync(fakeNpm, 0o755);
    const r = probe({ NPM: 'm.resolveNpmClaudePath()' },
      blockedEnv({ PATH: `${binDir}:${SANITIZED_PATH}` }));
    assert.equal(r.NPM, 'null',
      'the gate must block the npm-root-g route even when npm works and the package exists');
  });

  it('npm-free machine-path fallback blocked (#137 fix must not become an L7 hole)', () => {
    // inferGlobalNodeModulesDir() probes absolute machine roots (~/.npm-global,
    // /usr/local/lib/node_modules, %APPDATA%\npm, cc-viewer's own parent dir …)
    // with NO npm and NO PATH involved — exactly the vector L7 exists to close.
    // It must stay null under the block even though production relies on it.
    const r = probe({ INFER: 'String(m.inferGlobalNodeModulesDir())' }, blockedEnv());
    assert.equal(r.INFER, 'null',
      'the npm-free global-root fallback must be gated by the L7 block');
  });

  it('npm-free fallback is non-vacuous: it DOES resolve once the block is lifted', () => {
    // Guards against the previous assertion passing for the wrong reason.
    const r = probe({ INFER: 'String(m.inferGlobalNodeModulesDir())' },
      blockedEnv({ CCV_TEST_ALLOW_REAL_CLAUDE: '1' }));
    assert.notEqual(r.INFER, 'null',
      'with the escape flag the fallback must find a real global root');
  });

  it('CLAUDE_CONFIG_DIR seam preserved: seeded local/claude is still found', () => {
    const cfg = mkdtempSync(join(tmpdir(), 'ccv-guard-cfg-'));
    mkdirSync(join(cfg, 'local'), { recursive: true });
    const seeded = join(cfg, 'local', 'claude');
    writeFileSync(seeded, '#!/bin/sh\nexit 0\n');
    chmodSync(seeded, 0o755);
    const r = probe({ NATIVE: 'm.resolveNativePath()' },
      blockedEnv({ CLAUDE_CONFIG_DIR: cfg }));
    assert.equal(r.NATIVE, seeded, 'the ~/.claude/ candidate must stay allowed (L1b-safe seam)');
  });

  it('escape flag: CCV_TEST_ALLOW_REAL_CLAUDE=1 disables the block', () => {
    const r = probe({ BLOCKED: 'm.isRealClaudeLookupBlocked()' },
      blockedEnv({ CCV_TEST_ALLOW_REAL_CLAUDE: '1' }));
    assert.equal(r.BLOCKED, 'false');
  });

  it('production semantics untouched: predicate false without NODE_TEST_CONTEXT', () => {
    const r = probe({ BLOCKED: 'm.isRealClaudeLookupBlocked()' }, { PATH: SANITIZED_PATH });
    assert.equal(r.BLOCKED, 'false');
  });

  it('resolveCliPath under block: hint keeps the package shape but cannot exist / reach real node_modules', () => {
    const r = probe({ CLI: 'm.resolveCliPath()' }, blockedEnv());
    assert.ok(r.CLI.endsWith('cli.js'), `hint must keep cli.js suffix: ${r.CLI}`);
    assert.match(r.CLI, /@(anthropic-ai|ali)\/claude-code/, `hint must keep package shape: ${r.CLI}`);
    assert.ok(!existsSync(r.CLI), `blocked hint must not point at an existing install: ${r.CLI}`);
    assert.ok(!r.CLI.startsWith(REAL_NODE_MODULES + '/'),
      `blocked hint must not root at the real sibling node_modules: ${r.CLI}`);
  });
});

describe('L7 browser-open guard — isBrowserOpenSuppressed', () => {
  it('true under NODE_TEST_CONTEXT alone (this is why tests cannot pop browser windows)', () => {
    const r = probe({ SUP: 'm.isBrowserOpenSuppressed()' }, { NODE_TEST_CONTEXT: 'child-v8' });
    assert.equal(r.SUP, 'true');
  });

  it('true under CCV_NO_OPEN=1 alone (env switch for non-test environments)', () => {
    const r = probe({ SUP: 'm.isBrowserOpenSuppressed()' }, { CCV_NO_OPEN: '1' });
    assert.equal(r.SUP, 'true');
  });

  it('false in a clean production env', () => {
    const r = probe({ SUP: 'm.isBrowserOpenSuppressed()' }, {});
    assert.equal(r.SUP, 'false');
  });
});

describe('L7 in-process sanity (this test process runs under node:test)', () => {
  it('both predicates are active right here', () => {
    assert.equal(isRealClaudeLookupBlocked(), true,
      'the test process itself must be blocked (NODE_TEST_CONTEXT is set by the runner)');
    assert.equal(isBrowserOpenSuppressed(), true);
  });
});

describe('L7 wiring source-guards (consumers must keep consulting the suppressor)', () => {
  // A true end-to-end probe is awkward (--help exits before the open point, and
  // driving a full boot to the open call would need a real claude), so pin the
  // wiring the same way modal-mask.test.js pins its CSS reference: assert the
  // consuming source still contains the exact derivation. Deleting either line
  // re-opens real browser windows from tests without failing anything else.
  it('cli.js derives noOpen from isBrowserOpenSuppressed()', () => {
    const src = readFileSync(join(REPO_ROOT, 'packages', 'app', 'cli.js'), 'utf-8');
    assert.match(src, /if \(!noOpen && isBrowserOpenSuppressed\(\)\)/,
      'cli.js must fold isBrowserOpenSuppressed() into its noOpen derivation');
  });

  it('server.js gates the legacy (<2.0.69) auto-open on the suppressor', () => {
    const src = readFileSync(join(REPO_ROOT, 'packages', 'app', 'server', 'server.js'), 'utf-8');
    assert.match(src, /&& !isBrowserOpenSuppressed\(\)/,
      'server.js legacy auto-open must be guarded by !isBrowserOpenSuppressed()');
  });
});
