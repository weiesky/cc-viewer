/**
 * Integration: file-access-policy's onLogDirChange registration (module-load
 * side effect) must invalidate the allowlist-roots cache when setLogDir fires.
 * Without the registration, the second getAllowedRoots() would return the stale
 * cached roots computed under the previous LOG_DIR.
 *
 * Own file = own process: mutates findcc's LOG_DIR and the policy cache.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Both under /tmp so setLogDir's security gate accepts them.
const dirA = mkdtempSync('/tmp/ccv-policy-a-');
const dirB = mkdtempSync('/tmp/ccv-policy-b-');

// Import order matters: the policy module registers its bump listener at load.
const findcc = await import('../packages/app/findcc.js');
const policy = await import('../packages/app/server/lib/file-access-policy.js');

function seedWorkspaces(dir, projectName) {
  writeFileSync(join(dir, 'workspaces.json'), JSON.stringify({
    workspaces: [{ id: 'x1', path: join(dir, projectName), projectName, lastUsed: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' }],
  }));
}

test('setLogDir triggers the policy cache invalidation via onLogDirChange registration', () => {
  seedWorkspaces(dirA, 'wsAlpha');
  seedWorkspaces(dirB, 'wsBeta');

  assert.equal(findcc.setLogDir(dirA), true);
  const rootsA = policy.getAllowedRoots(); // warms the cache under dirA
  assert.ok(rootsA.some(r => r.raw.includes('wsAlpha')), `roots should include wsAlpha, got ${JSON.stringify(rootsA)}`);

  assert.equal(findcc.setLogDir(dirB), true); // registration must fire bumpWorkspacesVersion
  const rootsB = policy.getAllowedRoots();
  assert.ok(rootsB.some(r => r.raw.includes('wsBeta')), `roots should include wsBeta, got ${JSON.stringify(rootsB)}`);
  assert.ok(!rootsB.some(r => r.raw.includes('wsAlpha')), `stale cached roots would still include wsAlpha, got ${JSON.stringify(rootsB)}`);

  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
});
