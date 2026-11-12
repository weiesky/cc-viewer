import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { hasOtherNormalInstance, normalInstancePortRange, probeInstance } from '../server/lib/update-instances.js';

describe('update instance detection', () => {
  it('only scans the default normal-instance range', () => {
    assert.deepEqual(normalInstancePortRange({}), [7008, 7049]);
    assert.deepEqual(normalInstancePortRange({ CCV_IM_PLATFORM: 'dingtalk' }), []);
    assert.deepEqual(normalInstancePortRange({ CCV_WORKSPACE_MODE: '1' }), []);
    assert.deepEqual(normalInstancePortRange({ CCV_START_PORT: '7100', CCV_MAX_PORT: '7110' }), []);
  });
  it('ignores the current port and identifies only normal ccv instances', async () => {
    const checked = [];
    const found = await hasOtherNormalInstance({ portRange: [7008, 7010], currentPort: 7009, probe: async (port) => { checked.push(port); return port === 7010; } });
    assert.equal(found, true);
    assert.deepEqual(checked, [7008, 7010]);
    assert.equal(await hasOtherNormalInstance({ portRange: [], probe: async () => { throw new Error('must not probe'); } }), false);
  });
  it('probes the version identity instead of treating any listening port as ccv', async (t) => {
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(req.url === '/api/version-info' ? JSON.stringify({ version: '1.9.24', instanceKind: 'normal', instancePort: server.address().port }) : '{}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    assert.equal(await probeInstance(server.address().port), true);
    assert.equal(await probeInstance(1, { timeoutMs: 20 }), false);
  });
});
