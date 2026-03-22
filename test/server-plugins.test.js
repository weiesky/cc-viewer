import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGINS_DIR } from '../lib/plugin-loader.js';

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

  after(() => {
    stopViewer();
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

  it('DELETE /api/plugins removes first-level packaged plugin entry', async () => {
    const pluginDir = join(PLUGINS_DIR, 'test-packaged-del');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.mjs'), `
      export default {
        name: 'test-packaged-del',
        hooks: { localUrl(v) { return { url: v.url + '/pkg' }; } }
      };
    `);
    await httpRequest(port, '/api/plugins/reload', { method: 'POST' });

    const listRes = await httpRequest(port, '/api/plugins');
    assert.equal(listRes.status, 200);
    const before = listRes.json().plugins.find(p => p.file === 'test-packaged-del/index.mjs');
    assert.ok(before);

    const delRes = await httpRequest(port, '/api/plugins?file=test-packaged-del/index.mjs', { method: 'DELETE' });
    assert.equal(delRes.status, 200);
    const data = delRes.json();
    const after = data.plugins.find(p => p.file === 'test-packaged-del/index.mjs');
    assert.equal(!!after, false);
    assert.equal(existsSync(pluginDir), false);
  });

  // --- POST /api/plugins/install-from-url tests ---

  it('POST /api/plugins/install-from-url rejects missing url', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('required'));
  });

  it('POST /api/plugins/install-from-url rejects invalid URL', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'not-a-url' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid URL'));
  });

  it('POST /api/plugins/install-from-url rejects non-http protocol', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'ftp://example.com/plugin.js' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid URL'));
  });

  it('POST /api/plugins/install-from-url returns 500 for unreachable URL', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'https://127.0.0.1:1/nonexistent-plugin.js' },
    });
    assert.equal(res.status, 500);
    assert.ok(res.json().error.includes('Failed to fetch'));
  });
}); 
