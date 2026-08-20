/**
 * Process-liveness probe (server/lib/pid-alive.js) — the validity test behind
 * owner.lock claims. Real kill(0) probes, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { isPidAlive } from '../server/lib/pid-alive.js';

describe('isPidAlive', () => {
  it('this process and its parent are alive', () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(process.ppid), true);
  });

  it('a reaped child pid is dead', () => {
    const { pid } = spawnSync(process.execPath, ['-e', '']);
    assert.equal(isPidAlive(pid), false);
  });

  it('garbage pids are dead: 0, negative, non-integer, huge', () => {
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(1.5), false);
    assert.equal(isPidAlive('123'), false);
    assert.equal(isPidAlive(2 ** 31), false);
  });
});
