import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-server-plugins-'));
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

describe('server plugin endpoints', () => {
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

  after(() => {
    stopViewer();
    rmSync(tmpDir, { recursive: true, force: true });
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
}); 
