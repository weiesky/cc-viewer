import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnServiceProcess } from '../server/lib/plugin-service-manager.js';

// Spawn guard unit test (mirrors im-spawn-test-guard.test.js): under NODE_TEST_CONTEXT,
// with no spawnImpl and without CCV_TEST_ALLOW_PLUGIN_SPAWN=1, spawnServiceProcess must
// refuse a real spawn.
describe('plugin spawn test guard', () => {
  it('refuses real spawn under NODE_TEST_CONTEXT without opt-in', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-psg-'));
    try {
      delete process.env.CCV_TEST_ALLOW_PLUGIN_SPAWN;
      const r = spawnServiceProcess(
        { name: 'guard-test', entryPath: '/x/service.mjs', pluginDir: '/x', prefix: '/plugins/guard-test', env: {} },
        { logDir: tmpRoot, serverPid: 1 },
      );
      assert.equal(r.blockedByTestGuard, true);
      assert.equal(r.pid, undefined);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
