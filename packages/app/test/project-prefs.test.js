import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate LOG_DIR + declare an active project BEFORE any findcc/interceptor-loading import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-project-prefs-test-'));
const projectKey = join(tmpDir, 'projectA');
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';   // skip interceptor log-file init
process.env.CCV_PROJECT_DIR = projectKey; // makes hasActiveProject() true + the fork key
process.env.CCV_CLI_MODE = '0';

const prefsFile = join(tmpDir, 'preferences.json');
const deps = { getPrefsFile: () => prefsFile, MAX_POST_BODY: 1024 * 1024 };

function getPrefs(handler, isLocal = true) {
  let payload = '';
  const res = { writeHead() {}, end(b) { payload = b || ''; } };
  handler({}, res, { pathname: '/api/preferences' }, isLocal, deps);
  return JSON.parse(payload || '{}');
}

function callPost(handler, body, isLocal = true, pathname = '/api/project-prefs') {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    let status = 0;
    const res = {
      writeHead(code) { status = code; },
      end(b) { resolve({ status, data: JSON.parse(b || '{}') }); },
    };
    handler(req, res, { pathname }, isLocal, deps);
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
}

function callGetList(handler, isLocal = true) {
  let status = 0, payload = '';
  const res = { writeHead(c) { status = c; }, end(b) { payload = b || ''; } };
  handler({}, res, { pathname: '/api/project-prefs' }, isLocal, deps);
  return { status, data: JSON.parse(payload || '{}') };
}

describe('project-prefs lib + routes', { concurrency: false }, () => {
  let prefsGet, prefsPost, toggle, update, del, list;
  let lib, store;

  before(async () => {
    const pref = await import('../server/routes/preferences.js');
    prefsGet = pref.preferencesRoutes.find((r) => r.path === '/api/preferences' && r.method === 'GET').handler;
    prefsPost = pref.preferencesRoutes.find((r) => r.path === '/api/preferences' && r.method === 'POST').handler;
    const pp = await import('../server/routes/project-prefs.js');
    toggle = pp.projectPrefsRoutes.find((r) => r.path === '/api/project-prefs/toggle').handler;
    update = pp.projectPrefsRoutes.find((r) => r.path === '/api/project-prefs/update').handler;
    del = pp.projectPrefsRoutes.find((r) => r.path === '/api/project-prefs/delete').handler;
    list = pp.projectPrefsRoutes.find((r) => r.path === '/api/project-prefs' && r.method === 'GET').handler;
    lib = await import('../server/lib/project-prefs.js');
    store = await import('../server/lib/prefs-store.js');
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
  beforeEach(() => { if (existsSync(prefsFile)) unlinkSync(prefsFile); });

  // ─── lib units ──────────────────────────────────────────────────────────
  it('getCurrentProjectKey is the full CCV_PROJECT_DIR; hasActiveProject true', () => {
    assert.equal(lib.getCurrentProjectKey(), projectKey);
    assert.equal(lib.hasActiveProject(), true);
  });

  it('snapshotForFork strips secrets / machine-level / meta keys', () => {
    const snap = lib.snapshotForFork({
      expandThinking: true, themeColor: 'dark',
      auth: { enabled: true, password: 'x' }, authByProject: { '/p': {} },
      prefsByProject: { '/q': {} }, logDir: '/l', claudeConfigDir: '/c',
      dingtalk: { secret: 's' }, _isLocal: true,
    });
    assert.deepEqual(snap, { expandThinking: true, themeColor: 'dark' });
  });

  it('resolveScoped lets fork win over global and keeps unforked global keys', () => {
    const out = lib.resolveScoped(
      { themeColor: 'light', expandThinking: false, expandDiff: true },
      { themeColor: 'dark', expandThinking: true },
    );
    assert.equal(out.themeColor, 'dark');       // fork wins
    assert.equal(out.expandThinking, true);      // fork wins
    assert.equal(out.expandDiff, true);          // global passes through
  });

  // ─── toggle (fork lifecycle) ────────────────────────────────────────────
  it('toggle on snapshots current global prefs into prefsByProject[key]', async () => {
    writeFileSync(prefsFile, JSON.stringify({ expandThinking: true, themeColor: 'dark' }));
    const { status, data } = await callPost(toggle, { enabled: true });
    assert.equal(status, 200);
    assert.equal(data.projectScoped, true);
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.ok(onDisk.prefsByProject[projectKey], 'fork created');
    assert.deepEqual(onDisk.prefsByProject[projectKey], { expandThinking: true, themeColor: 'dark' });
  });

  it('toggle off deletes the fork key (inherits global again)', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { [projectKey]: { themeColor: 'dark' } } }));
    await callPost(toggle, { enabled: false });
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.ok(!onDisk.prefsByProject || !(projectKey in onDisk.prefsByProject), 'fork removed');
  });

  // ─── GET resolution ─────────────────────────────────────────────────────
  it('GET (non-loopback) returns the fork values when the project has a fork', async () => {
    writeFileSync(prefsFile, JSON.stringify({
      themeColor: 'light',
      prefsByProject: { [projectKey]: { themeColor: 'dark', expandThinking: true } },
    }));
    const data = getPrefs(prefsGet, /* isLocal */ false);
    assert.equal(data.themeColor, 'dark', 'LAN client sees fork');
    assert.equal(data.expandThinking, true);
    assert.equal(data._projectScoped, true);
    assert.equal(data._isLocal, false);
    assert.equal('prefsByProject' in data, false, 'fork blob never exposed');
    assert.equal('_projectPrefsKeys' in data, false, 'keys list is loopback-only');
  });

  it('GET (loopback) always returns GLOBAL + _projectPrefsKeys, even when a fork exists', () => {
    writeFileSync(prefsFile, JSON.stringify({
      themeColor: 'light',
      prefsByProject: { [projectKey]: { themeColor: 'dark' }, '/other/app': { themeColor: 'dark' } },
    }));
    const data = getPrefs(prefsGet, /* isLocal */ true);
    assert.equal(data.themeColor, 'light', 'admin sees global');
    assert.equal(data._projectScoped, false);
    assert.deepEqual(new Set(data._projectPrefsKeys), new Set([projectKey, '/other/app']));
  });

  // ─── update / delete ────────────────────────────────────────────────────
  it('update (current project, no project param) merges into the fork', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { [projectKey]: { themeColor: 'dark' } } }));
    const { status } = await callPost(update, { patch: { expandThinking: true } });
    assert.equal(status, 200);
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.deepEqual(onDisk.prefsByProject[projectKey], { themeColor: 'dark', expandThinking: true });
  });

  it('update for a fork that does not exist 404s', async () => {
    writeFileSync(prefsFile, JSON.stringify({}));
    const { status } = await callPost(update, { patch: { expandThinking: true } });
    assert.equal(status, 404);
  });

  it('update with an explicit project is forbidden for non-loopback clients', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { '/other/app': { themeColor: 'dark' } } }));
    const { status } = await callPost(update, { project: '/other/app', patch: { themeColor: 'light' } }, /* isLocal */ false);
    assert.equal(status, 403);
  });

  it('update strips _-meta and secret keys from the patch', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { [projectKey]: {} } }));
    await callPost(update, { patch: { themeColor: 'dark', _isLocal: true, auth: { password: 'x' }, dingtalk: { s: 1 } } });
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.deepEqual(onDisk.prefsByProject[projectKey], { themeColor: 'dark' });
  });

  it('delete is loopback-only and removes the named fork', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { '/other/app': { themeColor: 'dark' } } }));
    const denied = await callPost(del, { project: '/other/app' }, /* isLocal */ false);
    assert.equal(denied.status, 403);
    const ok = await callPost(del, { project: '/other/app' }, /* isLocal */ true);
    assert.equal(ok.status, 200);
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.ok(!onDisk.prefsByProject || !('/other/app' in onDisk.prefsByProject));
  });

  // ─── list (admin) ───────────────────────────────────────────────────────
  it('GET /api/project-prefs lists forks for loopback and 403s for remote', () => {
    writeFileSync(prefsFile, JSON.stringify({
      prefsByProject: {
        [projectKey]: { themeColor: 'dark', auth: { password: 'leak' }, dingtalk: { s: 1 } },
        '/other/app': { themeColor: 'light' },
      },
    }));
    assert.equal(callGetList(list, /* isLocal */ false).status, 403);
    const { status, data } = callGetList(list, /* isLocal */ true);
    assert.equal(status, 200);
    assert.deepEqual(new Set(Object.keys(data.projects)), new Set([projectKey, '/other/app']));
    assert.equal(data.projects[projectKey].isCurrent, true);
    assert.equal(data.projects['/other/app'].isCurrent, false);
    // defensive stripping: never surface secrets even if somehow present in a fork
    assert.equal('auth' in data.projects[projectKey].prefs, false);
    assert.equal('dingtalk' in data.projects[projectKey].prefs, false);
  });

  // ─── global POST hardening ──────────────────────────────────────────────
  it('POST /api/preferences strips _-meta + prefsByProject and writes global only', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { [projectKey]: { themeColor: 'dark' } } }));
    const { status } = await callPost(prefsPost, {
      themeColor: 'light', _isLocal: true, _projectScoped: true,
      prefsByProject: { '/evil': { themeColor: 'dark' } },
    }, /* isLocal */ true, '/api/preferences');
    assert.equal(status, 200);
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.equal(onDisk.themeColor, 'light');
    assert.equal('_isLocal' in onDisk, false, 'meta never persisted');
    assert.equal('_projectScoped' in onDisk, false);
    // incoming prefsByProject ignored; existing fork preserved untouched
    assert.deepEqual(onDisk.prefsByProject, { [projectKey]: { themeColor: 'dark' } });
  });

  it('mutatePrefs round-trips a valid JSON file (atomic write keeps it parseable)', async () => {
    await store.mutatePrefs((p) => { p.themeColor = 'dark'; });
    const onDisk = JSON.parse(readFileSync(prefsFile, 'utf-8'));
    assert.equal(onDisk.themeColor, 'dark');
  });

  // ─── shared merge (applyPrefsPatch) — same impl for fork update AND global POST ──────────
  it('update deep-merges approvalModal — untouched siblings + voicePack fields preserved', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { [projectKey]: {
      approvalModal: { modalEnabled: true, soundEnabled: true, voicePack: { enabled: true, volume: 0.5 } },
    } } }));
    const { status } = await callPost(update, { patch: { approvalModal: { soundEnabled: false, voicePack: { volume: 0.8 } } } });
    assert.equal(status, 200);
    const am = JSON.parse(readFileSync(prefsFile, 'utf-8')).prefsByProject[projectKey].approvalModal;
    assert.equal(am.modalEnabled, true, 'untouched top-level sibling preserved (not wiped)');
    assert.equal(am.soundEnabled, false, 'patched key updated');
    assert.equal(am.voicePack.enabled, true, 'voicePack sibling preserved');
    assert.equal(am.voicePack.volume, 0.8, 'voicePack field updated');
  });

  it('POST /api/preferences deep-merges approvalModal the same way (no drift vs fork update)', async () => {
    writeFileSync(prefsFile, JSON.stringify({ approvalModal: { modalEnabled: true, voicePack: { enabled: true, volume: 0.3 } } }));
    const { status } = await callPost(prefsPost, { approvalModal: { voicePack: { volume: 0.9 } } }, true, '/api/preferences');
    assert.equal(status, 200);
    const am = JSON.parse(readFileSync(prefsFile, 'utf-8')).approvalModal;
    assert.equal(am.modalEnabled, true, 'global sibling preserved');
    assert.equal(am.voicePack.enabled, true);
    assert.equal(am.voicePack.volume, 0.9);
  });

  it('resolveScoped merges approvalModal (fork over global) and returns a copy, not the global ref', () => {
    const out = lib.resolveScoped({ approvalModal: { modalEnabled: true, soundEnabled: true } }, { approvalModal: { soundEnabled: false } });
    assert.equal(out.approvalModal.modalEnabled, true, 'global AM sibling kept');
    assert.equal(out.approvalModal.soundEnabled, false, 'fork AM overrides');
    const g = { approvalModal: { modalEnabled: true } };
    const out2 = lib.resolveScoped(g, { themeColor: 'dark' }); // fork has no approvalModal
    assert.equal(out2.approvalModal.modalEnabled, true);
    assert.notEqual(out2.approvalModal, g.approvalModal, 'no-fork-AM branch returns a shallow copy, not an alias');
  });

  // ─── lock / atomicity / lib units ───────────────────────────────────────────────────────
  it('mutatePrefs serializes concurrent writers — no lost update', async () => {
    writeFileSync(prefsFile, JSON.stringify({}));
    await Promise.all([
      store.mutatePrefs((p) => { p.a = 1; }),
      store.mutatePrefs((p) => { p.b = 2; }),
      store.mutatePrefs((p) => { p.c = 3; }),
    ]);
    assert.deepEqual(JSON.parse(readFileSync(prefsFile, 'utf-8')), { a: 1, b: 2, c: 3 }, 'all three landed');
  });

  it('toggle returns 409 when there is no active project (workspace mode, no project dir)', async () => {
    const prev = process.env.CCV_PROJECT_DIR;
    delete process.env.CCV_PROJECT_DIR;
    try {
      const { status, data } = await callPost(toggle, { enabled: true });
      assert.equal(status, 409);
      assert.equal(data.error, 'no-active-project');
    } finally { process.env.CCV_PROJECT_DIR = prev; }
  });

  it('update with explicit project as loopback admin SUCCEEDS', async () => {
    writeFileSync(prefsFile, JSON.stringify({ prefsByProject: { '/other/app': { themeColor: 'dark' } } }));
    const { status } = await callPost(update, { project: '/other/app', patch: { themeColor: 'light' } }, /* isLocal */ true);
    assert.equal(status, 200);
    assert.equal(JSON.parse(readFileSync(prefsFile, 'utf-8')).prefsByProject['/other/app'].themeColor, 'light');
  });

  it('update with a non-string project from a remote client is treated as current (no admin-branch bypass)', async () => {
    writeFileSync(prefsFile, JSON.stringify({})); // no current fork
    const { status } = await callPost(update, { project: {}, patch: { themeColor: 'x' } }, /* isLocal */ false);
    assert.equal(status, 404, 'object project → current branch (no fork → 404), never the 403 admin path');
  });

  it('hasFork: a present-but-empty fork still counts (hasOwnProperty semantics)', () => {
    assert.equal(lib.hasFork({ prefsByProject: { [projectKey]: {} } }, projectKey), true);
    assert.equal(lib.hasFork({ prefsByProject: {} }, projectKey), false);
    assert.equal(lib.hasFork({}, projectKey), false);
  });

  it('stripSensitive removes secrets, IM creds, machine-level paths and the forks map (single source)', () => {
    const o = lib.stripSensitive({ themeColor: 'dark', auth: {}, authByProject: {}, prefsByProject: {}, logDir: '/l', claudeConfigDir: '/c', dingtalk: {} });
    assert.deepEqual(o, { themeColor: 'dark' });
  });

  it('readPrefsRaw returns {} on a corrupt file', () => {
    writeFileSync(prefsFile, '{ broken json');
    assert.deepEqual(store.readPrefsRaw(), {});
  });
});
