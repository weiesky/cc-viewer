import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSdkSessionLister,
  listSdkSessionInstances,
  findSdkSessionByInstance,
} from '../server/lib/sdk-session-index.js';

afterEach(() => { registerSdkSessionLister(null); });

describe('SDK session index', () => {
  it('is empty without a registered SDK manager', () => {
    assert.deepEqual(listSdkSessionInstances(), []);
    assert.equal(findSdkSessionByInstance('ccv-abc123'), null);
  });

  it('projects the registered lister without copying its rows', () => {
    const rows = [{ cwd: '/a', instanceKey: 'ccv-abc123' }];
    registerSdkSessionLister(() => rows);
    assert.equal(listSdkSessionInstances(), rows);
    assert.equal(findSdkSessionByInstance('ccv-abc123'), rows[0]);
    rows.length = 0;
    assert.deepEqual(listSdkSessionInstances(), []);
  });

  it('degrades to empty when the registry projection fails', () => {
    registerSdkSessionLister(() => { throw new Error('boom'); });
    assert.deepEqual(listSdkSessionInstances(), []);
  });
});
