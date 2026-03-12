import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-server-logs-'));
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

describe('server local logs endpoints', () => {
  let startViewer, stopViewer, getPort;
  let port;

  before(async () => {
    // Prepare a fake project with logs (note: server reads default LOG_DIR; we validate response shape)
    const fakeLogDir = join(tmpDir, 'logs');
    const project = join(fakeLogDir, 'projX');
    mkdirSync(project, { recursive: true });
    const fileName = 'projX_20260101_120000.jsonl';
    writeFileSync(join(project, fileName), JSON.stringify({ timestamp: '2026-01-01T12:00:00Z' }) + '\n---\n');
    writeFileSync(join(project, 'projX.json'), JSON.stringify({ files: { [fileName]: { summary: { sessionCount: 3 } } } }));

    const mod = await import('../server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    const srv = await startViewer();
    assert.ok(srv);
    port = getPort();
  });

  after(() => {
    stopViewer();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/local-logs returns grouped logs with stats', async () => {
    const res = await httpRequest(port, '/api/local-logs');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.equal(typeof data._currentProject, 'string');
  });

  it('GET /api/download-log rejects invalid file name', async () => {
    const res = await httpRequest(port, '/api/download-log?file=../../etc/passwd');
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid file name'));
  });

  it('GET /api/download-log rejects invalid file type', async () => {
    const res = await httpRequest(port, '/api/download-log?file=projX/20260101.txt');
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid file type'));
  });

  it('GET /api/download-log returns 404 when file not found', async () => {
    const res = await httpRequest(port, '/api/download-log?file=projX/not-exist.jsonl');
    assert.equal(res.status, 404);
  });
});
