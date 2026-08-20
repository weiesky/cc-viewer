import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR + workspace mode (skip interceptor log-file init) BEFORE any import that
// loads findcc/interceptor. initForWorkspace() then sets _logDir to our temp project dir.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-session-pin-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { pinFilePath, readPin, writePin } = await import('../server/lib/session-pin-store.js');
const { sessionPinRoutes } = await import('../server/routes/session-pin.js');
const { initForWorkspace } = await import('../server/interceptor.js');

after(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

// ─── session-pin-store (pure, parameterized by logDir) ──────────────────────
describe('session-pin-store', () => {
  it('pinFilePath is the single project-shared file', () => {
    const d = mkdtempSync(join(tmpdir(), 'ccv-pinpath-'));
    assert.equal(pinFilePath(d), join(d, '.session-pin.json'));
    rmSync(d, { recursive: true, force: true });
  });

  it('write → read round-trip; null clears; missing → null', () => {
    const d = mkdtempSync(join(tmpdir(), 'ccv-pin-rt-'));
    assert.equal(readPin(d), null);            // nothing written yet
    assert.equal(writePin(d, '1717000000000'), true);
    assert.equal(readPin(d), '1717000000000');
    // clear
    assert.equal(writePin(d, null), true);
    assert.equal(readPin(d), null);
    assert.ok(!existsSync(pinFilePath(d)), 'file removed on clear');
    rmSync(d, { recursive: true, force: true });
  });

  it('no active project (logDir="") → read null / write no-op', () => {
    assert.equal(readPin(''), null);
    assert.equal(writePin('', 'x'), false);
  });

  it('atomic write leaves valid JSON and no stray .tmp files', () => {
    const d = mkdtempSync(join(tmpdir(), 'ccv-pin-atomic-'));
    writePin(d, 'v1');
    writePin(d, 'v2');
    const obj = JSON.parse(readFileSync(pinFilePath(d), 'utf-8'));
    assert.equal(obj.pinnedSessionId, 'v2');
    assert.ok(!readdirSync(d).some((f) => f.includes('.tmp-')), 'no leftover tmp files');
    rmSync(d, { recursive: true, force: true });
  });

  it('corrupt / wrong-shape file reads back as null (no throw)', () => {
    const d = mkdtempSync(join(tmpdir(), 'ccv-pin-corrupt-'));
    writeFileSync(pinFilePath(d), '{not json');
    assert.equal(readPin(d), null);
    writeFileSync(pinFilePath(d), JSON.stringify({ pinnedSessionId: 123 }));
    assert.equal(readPin(d), null); // non-string → null
    rmSync(d, { recursive: true, force: true });
  });

  it('legacy per-instance pin files are ignored (orphans, not read)', () => {
    const d = mkdtempSync(join(tmpdir(), 'ccv-pin-legacy-'));
    writeFileSync(join(d, '.session-pin.alpha.json'), JSON.stringify({ pinnedSessionId: 'old' }));
    assert.equal(readPin(d), null); // only the shared file counts
    rmSync(d, { recursive: true, force: true });
  });
});

// ─── GET/POST /api/session-pin route (real interceptor _logDir via workspace) ─
describe('session-pin route', () => {
  const projectDir = join(tmpDir, 'projA');
  initForWorkspace(projectDir, { forceNew: true }); // sets interceptor _logDir/_projectName
  const logDir = join(tmpDir, 'projA'); // findcc LOG_DIR(=tmpDir)/<projectName=projA>

  const getHandler = sessionPinRoutes.find((r) => r.method === 'GET').handler;
  const postHandler = sessionPinRoutes.find((r) => r.method === 'POST').handler;

  function callGet(deps) {
    let payload = '';
    const res = { writeHead() {}, end(b) { payload = b || ''; } };
    getHandler({}, res, { pathname: '/api/session-pin' }, false, deps);
    return JSON.parse(payload || '{}');
  }
  function callPost(deps, body) {
    return new Promise((resolve) => {
      const req = new EventEmitter();
      let status = 0;
      const res = { writeHead(c) { status = c; }, end(b) { resolve({ status, data: JSON.parse(b || '{}') }); } };
      postHandler(req, res, { pathname: '/api/session-pin' }, false, deps);
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      req.emit('end');
    });
  }

  it('GET returns null pin when nothing is set', () => {
    const out = callGet({ clients: [], MAX_POST_BODY: 1 << 20 });
    assert.deepEqual(out, { pinnedSessionId: null });
  });

  it('POST persists, broadcasts session_pin, GET reads it back', async () => {
    const sent = [];
    const clients = [{ write(p) { sent.push(p); return true; } }];
    const deps = { clients, MAX_POST_BODY: 1 << 20 };
    const { status, data } = await callPost(deps, { pinnedSessionId: '1717000000001' });
    assert.equal(status, 200);
    assert.equal(data.pinnedSessionId, '1717000000001');
    // broadcast happened with the session_pin event + payload
    assert.equal(sent.length, 1);
    assert.match(sent[0], /event: session_pin/);
    assert.match(sent[0], /1717000000001/);
    // persisted under the project-shared file and read back
    assert.equal(readPin(logDir), '1717000000001');
    assert.deepEqual(callGet(deps), { pinnedSessionId: '1717000000001' });
  });

  it('POST null clears the pin', async () => {
    const deps = { clients: [], MAX_POST_BODY: 1 << 20 };
    const { status } = await callPost(deps, { pinnedSessionId: null });
    assert.equal(status, 200);
    assert.equal(readPin(logDir), null);
  });

  it('POST with malformed JSON → 400', async () => {
    const deps = { clients: [], MAX_POST_BODY: 1 << 20 };
    const { status } = await callPost(deps, '{bad');
    assert.equal(status, 400);
  });
});
