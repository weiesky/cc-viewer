import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { isCodeFuseManagedEnvironment } from '../server/lib/codefuse-managed-mode.js';

describe('isCodeFuseManagedEnvironment', () => {
  const home = resolve('/tmp', 'ccv-codefuse-home');
  const managedDir = resolve(home, '.codefuse', 'engine', 'cc');
  const detect = (configDir, platform = 'linux') => {
    const env = configDir === null ? {} : { CLAUDE_CONFIG_DIR: configDir };
    return isCodeFuseManagedEnvironment({ env, home, platform });
  };

  it('accepts the exact CodeFuse Claude config directory', () => {
    assert.equal(detect(managedDir), true);
  });

  it('rejects a missing config directory', () => {
    assert.equal(detect(null), false);
  });

  it('rejects the ordinary Claude config directory', () => {
    assert.equal(detect(resolve(home, '.claude')), false);
  });

  it('requires the entire path to match', () => {
    assert.equal(detect(`${managedDir}-other`), false);
  });

  it('normalizes dot segments before comparing', () => {
    assert.equal(detect(resolve(managedDir, '..', 'cc')), true);
  });

  it('compares Windows paths case-insensitively', () => {
    assert.equal(detect(managedDir.toUpperCase(), 'win32'), true);
  });

  it('keeps POSIX path comparison case-sensitive', () => {
    assert.equal(detect(managedDir.toUpperCase()), false);
  });
});
