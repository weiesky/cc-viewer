import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR before any findcc-loading import (same pattern as api-proxy-profiles.test.js).
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-preferences-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const prefsFile = join(tmpDir, 'preferences.json');
const deps = { getPrefsFile: () => prefsFile, MAX_POST_BODY: 1024 * 1024 };

/** 同步调用 GET handler，返回解析后的回包 */
function getPrefs(handler) {
  let payload = '';
  const res = { writeHead() {}, end(b) { payload = b || ''; } };
  handler({}, res, { pathname: '/api/preferences' }, /* isLocal */ true, deps);
  return JSON.parse(payload);
}

/** 调用 POST handler（req 是流式 EventEmitter），resolve 为 { status, data } */
function postPrefs(handler, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    let status = 0;
    const res = {
      writeHead(code) { status = code; },
      end(b) { resolve({ status, data: JSON.parse(b || '{}') }); },
    };
    handler(req, res, { pathname: '/api/preferences' }, /* isLocal */ true, deps);
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
}

// wire-v2 (1.7.0): the resumeAutoChoice "virtual default" is GONE — the key is
// no longer special-cased anywhere. GET/POST are plain passthrough: a missing
// key stays missing, an explicit value (including null) round-trips unchanged.
describe('/api/preferences plain key passthrough (resumeAutoChoice no longer special-cased)', { concurrency: false }, () => {
  let getHandler, postHandler;

  before(async () => {
    const { preferencesRoutes } = await import('../server/routes/preferences.js');
    getHandler = preferencesRoutes.find((r) => r.path === '/api/preferences' && r.method === 'GET').handler;
    postHandler = preferencesRoutes.find((r) => r.path === '/api/preferences' && r.method === 'POST').handler;
    assert.ok(getHandler && postHandler, 'preferences routes must exist');
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  beforeEach(() => { if (existsSync(prefsFile)) unlinkSync(prefsFile); });

  it('GET does NOT inject resumeAutoChoice when the key is missing (virtual default removed)', () => {
    const data = getPrefs(getHandler);
    assert.equal('resumeAutoChoice' in data, false, 'no injected default');
  });

  it('GET does not create or modify the prefs file', () => {
    getPrefs(getHandler);
    assert.equal(existsSync(prefsFile), false, 'GET must not write preferences.json');
  });

  it('GET preserves an explicit null value (plain passthrough)', () => {
    writeFileSync(prefsFile, JSON.stringify({ resumeAutoChoice: null }));
    const data = getPrefs(getHandler);
    assert.ok('resumeAutoChoice' in data, 'key must be present');
    assert.equal(data.resumeAutoChoice, null);
  });

  it('GET preserves an explicit string value (plain passthrough)', () => {
    writeFileSync(prefsFile, JSON.stringify({ resumeAutoChoice: 'new' }));
    const data = getPrefs(getHandler);
    assert.equal(data.resumeAutoChoice, 'new');
  });

  it('GET falls back to empty prefs on a corrupted file (still no injected keys)', () => {
    writeFileSync(prefsFile, '{not valid json');
    const data = getPrefs(getHandler);
    assert.equal('resumeAutoChoice' in data, false);
    assert.ok(typeof data.logDir === 'string', 'runtime logDir is still returned');
  });

  it('POST echo carries no injected resumeAutoChoice and none is persisted', async () => {
    const { status, data } = await postPrefs(postHandler, { lang: 'en' });
    assert.equal(status, 200);
    assert.equal(data.lang, 'en');
    assert.equal('resumeAutoChoice' in data, false, 'POST echo must match GET shape (no injection)');
    const written = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.equal('resumeAutoChoice' in written, false, 'nothing injected on disk either');
  });

  it('POST persists an explicit null and a later GET returns it (round trip)', async () => {
    const { status } = await postPrefs(postHandler, { resumeAutoChoice: null });
    assert.equal(status, 200);
    const written = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.ok('resumeAutoChoice' in written, 'explicit null must be persisted with the key present');
    assert.equal(written.resumeAutoChoice, null);
    assert.equal(getPrefs(getHandler).resumeAutoChoice, null, 'GET returns the stored null unchanged');
  });
});
