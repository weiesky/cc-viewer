import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildShellCandidates, getGlobalNodeModulesDir } from '../findcc.js';

// Test resolveLogDir by spawning a subprocess with different CCV_LOG_DIR values.
// This avoids module cache busting which dilutes coverage.
function getLogDirWithEnv(envVal) {
  const result = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { LOG_DIR } from './findcc.js'; process.stdout.write(LOG_DIR);`,
  ], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf-8',
    env: { ...process.env, CCV_LOG_DIR: envVal },
    timeout: 5000,
  });
  return result;
}

describe('findcc: resolveLogDir', () => {
  it('uses "tmp" keyword to resolve to system tmpdir', () => {
    const logDir = getLogDirWithEnv('tmp');
    assert.ok(logDir.startsWith(tmpdir()), `expected ${logDir} to start with ${tmpdir()}`);
    assert.ok(logDir.includes('cc-viewer-test'));
  });

  it('uses "temp" keyword to resolve to system tmpdir', () => {
    const logDir = getLogDirWithEnv('temp');
    assert.ok(logDir.startsWith(tmpdir()));
    assert.ok(logDir.includes('cc-viewer-test'));
  });

  it('expands ~/ prefix to homedir', () => {
    const logDir = getLogDirWithEnv('~/my-logs');
    assert.equal(logDir, join(homedir(), 'my-logs'));
  });

  it('resolves absolute path as-is', () => {
    const logDir = getLogDirWithEnv('/tmp/custom-ccv-logs');
    assert.equal(logDir, '/tmp/custom-ccv-logs');
  });

  it('defaults to ~/.claude/cc-viewer when env is empty', () => {
    const result = execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { LOG_DIR } from './findcc.js'; process.stdout.write(LOG_DIR);`,
    ], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf-8',
      env: { ...process.env, CCV_LOG_DIR: '' },
      timeout: 5000,
    });
    assert.equal(result, join(homedir(), '.claude', 'cc-viewer'));
  });
});

describe('findcc: buildShellCandidates', () => {
  it('returns a string with quoted paths', () => {
    const result = buildShellCandidates();
    assert.equal(typeof result, 'string');
    if (result.length > 0) {
      const parts = result.split(' ').filter(Boolean);
      for (const p of parts) {
        assert.ok(p.startsWith('"') && p.endsWith('"'), `expected quoted path: ${p}`);
      }
    }
  });
});

describe('findcc: getGlobalNodeModulesDir', () => {
  it('returns a string or null', () => {
    const result = getGlobalNodeModulesDir();
    assert.ok(result === null || typeof result === 'string');
  });
});
