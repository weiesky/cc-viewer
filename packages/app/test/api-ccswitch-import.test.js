// Route tests for GET /api/ccswitch-providers and POST /api/ccswitch-import.
// The pure lib is covered by ccswitch-import.test.js; this file covers the HTTP
// surface: the local-only 403 gate, the response `ok` contract, the corrupt
// profile.json abort (no destructive overwrite), the max-seeding on first
// import, off-host apiKey masking, and the SSE broadcast payload.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

// Isolate LOG_DIR (PROFILE_PATH = join(LOG_DIR, 'profile.json')) before any findcc-loading import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ccswitch-route-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const PROFILE_PATH = join(tmpDir, 'profile.json');
const FAKE_KEY = 'sk-fake-token-abcd9876';

// node:sqlite is needed to build the fixture db; absent (Node < 22.5) the
// db-dependent suites skip — same guard pattern as ccswitch-import.test.js.
const hasSqlite = (() => {
  try { return !!createRequire(import.meta.url)('node:sqlite').DatabaseSync; }
  catch { return false; }
})();

function mkReq(body) {
  const handlers = {};
  return {
    on(ev, fn) {
      handlers[ev] = fn;
      if (ev === 'end') {
        if (body && handlers.data) handlers.data(Buffer.from(body));
        handlers.end();
      }
      return this;
    },
    destroy() {},
  };
}

// The POST end-handler is async — res.done resolves when the handler calls end().
function mkRes() {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  let status = 0;
  let payload = '';
  return {
    writeHead(s) { status = s; },
    end(b) { payload = b || ''; resolve(); },
    get status() { return status; },
    get payload() { return payload; },
    done,
  };
}

function mkSseClient() {
  return { writable: true, destroyed: false, written: '', write(p) { this.written += p; return true; } };
}

function mkDeps() {
  return { MAX_POST_BODY: 1024 * 1024, clients: [] };
}

let getRoute; let postRoute;
before(async () => {
  const { preferencesRoutes } = await import('../server/routes/preferences.js');
  getRoute = preferencesRoutes.find((r) => r.path === '/api/ccswitch-providers' && r.method === 'GET');
  postRoute = preferencesRoutes.find((r) => r.path === '/api/ccswitch-import' && r.method === 'POST');
  assert.ok(getRoute, 'GET /api/ccswitch-providers route must exist');
  assert.ok(postRoute, 'POST /api/ccswitch-import route must exist');
});
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('POST /api/ccswitch-import gate & contract (no db needed)', { concurrency: false }, () => {
  it('rejects a non-local caller with 403 and ok:false, writing nothing', async () => {
    if (existsSync(PROFILE_PATH)) rmSync(PROFILE_PATH);
    const res = mkRes();
    await postRoute.handler(mkReq('{}'), res, {}, /* isLocal */ false, mkDeps());
    await res.done;
    assert.equal(res.status, 403);
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, false, '403 must carry ok:false so the client cannot misread it as success');
    assert.match(data.error, /local-only/);
    assert.equal(existsSync(PROFILE_PATH), false, 'a rejected import must not touch profile.json');
  });

  it('returns 400 with ok:false on a malformed request body', async () => {
    const res = mkRes();
    await postRoute.handler(mkReq('not-json{'), res, {}, /* isLocal */ true, mkDeps());
    await res.done;
    assert.equal(res.status, 400);
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, false, '400 must carry ok:false (the client keys success on data.ok, not counters)');
    assert.ok(data.error);
  });
});

// The suites below need a real (fixture) cc-switch.db: HOME is pointed at a temp
// dir whose .cc-switch/cc-switch.db is a valid SQLite db with one claude provider,
// so discoverCcSwitchProviders() resolves it as the primary probe path.
describe('ccswitch routes with a fixture db', { skip: !hasSqlite, concurrency: false }, () => {
  let tmpHome; let realHome;

  before(() => {
    realHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'ccv-ccswitch-route-home-'));
    const dbDir = join(tmpHome, '.cc-switch');
    mkdirSync(dbDir, { recursive: true });
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    const db = new DatabaseSync(join(dbDir, 'cc-switch.db'));
    db.exec('CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT, is_current INTEGER, sort_index INTEGER)');
    // Provider vars as stored in cc-switch's settings_config JSON column. Kept as
    // a named object so the source never contains an inline object after the "env"
    // key — that shape trips the test-env-isolation-guard scanner (subprocess env).
    const providerEnv = { ANTHROPIC_BASE_URL: 'https://fake.example.com', ANTHROPIC_AUTH_TOKEN: FAKE_KEY };
    db.prepare('INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?)').run(
      'row-1', 'claude', 'FakeProv',
      JSON.stringify({ env: providerEnv }),
      1, 1,
    );
    db.close();
    process.env.HOME = tmpHome;
  });

  after(() => {
    process.env.HOME = realHome;
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('first import with no profile.json seeds max, writes 0o600, broadcasts a credential-free refresh', async () => {
    if (existsSync(PROFILE_PATH)) rmSync(PROFILE_PATH);
    const deps = mkDeps();
    const sse = mkSseClient();
    deps.clients.push(sse);
    const res = mkRes();
    await postRoute.handler(mkReq('{}'), res, {}, /* isLocal */ true, deps);
    await res.done;
    assert.equal(res.status, 200);
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, true);
    assert.equal(data.imported, 1);
    const written = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    assert.equal(written.profiles[0].id, 'max', 'max must be seeded first even when profile.json never existed');
    const ccs = written.profiles.find((p) => p.id === 'ccs_row-1');
    assert.ok(ccs, 'imported provider must be persisted');
    assert.equal(ccs.apiKey, FAKE_KEY);
    if (process.platform !== 'win32') {
      assert.equal(statSync(PROFILE_PATH).mode & 0o777, 0o600, 'profile.json must be created 0o600');
    }
    assert.match(sse.written, /event: proxy_profile/, 'import must broadcast proxy_profile');
    assert.match(sse.written, /"profile":"refresh"/, 'broadcast must be the refresh sentinel');
    assert.ok(!sse.written.includes(FAKE_KEY), 'SSE broadcast must never carry credentials');
  });

  it('re-import preserves user proxy_ profiles and prunes ccs_ entries deleted in cc-switch', async () => {
    writeFileSync(PROFILE_PATH, JSON.stringify({
      profiles: [
        { id: 'max', name: 'Default' },
        { id: 'proxy_mine', name: 'Mine', baseURL: 'https://mine.example.com', apiKey: 'user-key-1111' },
        { id: 'ccs_gone', name: 'Stale', baseURL: 'https://gone.example.com', apiKey: 'stale-key' },
      ],
    }));
    const res = mkRes();
    await postRoute.handler(mkReq('{}'), res, {}, true, mkDeps());
    await res.done;
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, true);
    const written = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
    assert.ok(written.profiles.find((p) => p.id === 'proxy_mine'), 'user-created profile must survive');
    assert.equal(written.profiles.find((p) => p.id === 'ccs_gone'), undefined, 'ccs_ entry deleted on the cc-switch side must be pruned');
    assert.ok(written.profiles.find((p) => p.id === 'ccs_row-1'));
  });

  it('aborts without writing when profile.json exists but is unparseable', async () => {
    const corrupt = '{"profiles": [ TRUNCATED';
    writeFileSync(PROFILE_PATH, corrupt);
    const res = mkRes();
    await postRoute.handler(mkReq('{}'), res, {}, true, mkDeps());
    await res.done;
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, false, 'corrupt profile.json must abort the import');
    assert.match(data.error, /unreadable/);
    assert.equal(data.imported, 0);
    assert.equal(readFileSync(PROFILE_PATH, 'utf-8'), corrupt, 'the corrupt file must be left untouched, never overwritten');
  });

  it('aborts when profile.json parses to a non-object shape', async () => {
    const arrayShaped = '["not", "an", "object"]';
    writeFileSync(PROFILE_PATH, arrayShaped);
    const res = mkRes();
    await postRoute.handler(mkReq('{}'), res, {}, true, mkDeps());
    await res.done;
    const data = JSON.parse(res.payload);
    assert.equal(data.ok, false);
    assert.match(data.error, /unexpected shape/);
    assert.equal(readFileSync(PROFILE_PATH, 'utf-8'), arrayShaped, 'file must be left untouched');
  });

  it('GET masks the apiKey for a remote caller and returns plaintext locally', async () => {
    const resRemote = mkRes();
    await getRoute.handler({}, resRemote, {}, /* isLocal */ false, mkDeps());
    await resRemote.done;
    const remote = JSON.parse(resRemote.payload);
    assert.equal(remote.profiles.length, 1);
    assert.ok(!resRemote.payload.includes(FAKE_KEY), 'full apiKey must not reach a remote caller');
    assert.match(remote.profiles[0].apiKey, /\*\*\*\*/, 'remote apiKey must be masked');

    const resLocal = mkRes();
    await getRoute.handler({}, resLocal, {}, /* isLocal */ true, mkDeps());
    await resLocal.done;
    const local = JSON.parse(resLocal.payload);
    assert.equal(local.profiles[0].apiKey, FAKE_KEY, 'local caller gets plaintext for the edit form');
  });
});
