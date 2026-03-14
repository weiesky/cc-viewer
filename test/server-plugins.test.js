import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function httpRequest(port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json() { return JSON.parse(data); },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('server plugin endpoints', { concurrency: false }, () => {
  let startViewer, stopViewer, getPort;
  let port;

  before(async () => {
    const mod = await import('../server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    const srv = await startViewer();
    assert.ok(srv);
    port = getPort();
    assert.ok(port > 0);
  });

  after(async () => {
    await stopViewer();
  });

  it('GET /api/plugins returns plugins list', async () => {
    const res = await httpRequest(port, '/api/plugins');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.plugins));
    assert.equal(typeof data.pluginsDir, 'string');
  });

  it('POST /api/plugins/upload rejects invalid file type', async () => {
    const res = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'bad.txt', content: 'not js' }] },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('.js or .mjs'));
  });

  it('POST /api/plugins/upload accepts valid plugin and affects local-url', async () => {
    const pluginContent = `
      export default {
        name: 'upload-plugin',
        hooks: {
          localUrl(v) { return { url: v.url + '/u' }; }
        }
      };
    `;
    const res = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-upload.js', content: pluginContent }] },
    });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-upload.js');
    assert.ok(found);
    assert.equal(found.enabled, true);

    const urlRes = await httpRequest(port, '/api/local-url');
    assert.equal(urlRes.status, 200);
    const urlData = urlRes.json();
    assert.ok(urlData.url.includes('/u'));
  });

  it('POST /api/plugins/reload returns updated list', async () => {
    const res = await httpRequest(port, '/api/plugins/reload', { method: 'POST' });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.plugins));
  });

  it('DELETE /api/plugins rejects invalid filename', async () => {
    const res = await httpRequest(port, '/api/plugins?file=../../evil.js', { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/plugins returns 404 when file missing', async () => {
    const res = await httpRequest(port, '/api/plugins?file=not-exist.js', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  it('DELETE /api/plugins removes uploaded plugin', async () => {
    const res = await httpRequest(port, '/api/plugins?file=test-upload.js', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-upload.js');
    assert.equal(!!found, false);
  });

  it('authenticateTerminal hook can deny terminal access', async () => {
    // Upload a plugin that denies terminal access
    const pluginContent = `
      export default {
        name: 'deny-terminal',
        hooks: {
          authenticateTerminal(ctx) {
            return { allowed: false, redirectUrl: 'https://example.com/login' };
          }
        }
      };
    `;
    const uploadRes = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'deny-terminal.js', content: pluginContent }] },
    });
    assert.equal(uploadRes.status, 200);

    // /api/terminal-permission is local (127.0.0.1), so it bypasses the hook
    const localRes = await httpRequest(port, '/api/terminal-permission');
    assert.equal(localRes.status, 200);
    assert.equal(localRes.json().allowed, true);

    // Clean up
    const delRes = await httpRequest(port, '/api/plugins?file=deny-terminal.js', { method: 'DELETE' });
    assert.equal(delRes.status, 200);
  });
});
