// Unit tests for the log-dir change notification seam: findcc (a leaf module)
// exposes onLogDirChange; dependents (file-access-policy) register instead of
// findcc importing them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onLogDirChange, setLogDir, LOG_DIR } from '../packages/app/findcc.js';
import { join } from 'node:path';

// setLogDir's security gate only accepts paths under home or /tmp — use a
// disposable /tmp path (setLogDir resolves, it does not create), matching the
// repo's temp-dir isolation norm.
const fakeDir = (tag) => join('/tmp', `ccv-test-logdir-${tag}-${process.pid}`);

test('setLogDir synchronously notifies registered listeners; bad listeners are isolated', () => {
  const seen = [];
  onLogDirChange((dir) => seen.push(['first', dir]));
  onLogDirChange(() => { throw new Error('boom'); });
  onLogDirChange((dir) => seen.push(['third', dir]));

  const target = fakeDir('notify');
  const before = LOG_DIR;
  assert.equal(setLogDir(target), true);
  assert.deepEqual(seen, [['first', LOG_DIR], ['third', LOG_DIR]]);
  assert.notEqual(LOG_DIR, before);
});

test('setLogDir rejects invalid dirs without notifying', () => {
  let calls = 0;
  onLogDirChange(() => calls++);
  assert.equal(setLogDir(''), false);
  assert.equal(setLogDir(null), false);
  assert.equal(setLogDir('/etc/passwd'), false); // outside home and /tmp
  assert.equal(calls, 0);
});

test('onLogDirChange ignores non-functions', () => {
  onLogDirChange(undefined);
  onLogDirChange('not a function');
  const target = fakeDir('nonfn');
  assert.equal(setLogDir(target), true); // must not throw
});
