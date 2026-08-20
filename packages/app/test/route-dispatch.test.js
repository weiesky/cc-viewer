import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatcher } from '../server/routes/_dispatch.js';
import { filesContentRoutes } from '../server/routes/files-content.js';

// Guards the one behavior the server.js → server/routes/* split could silently break:
// the dispatcher must reproduce the old if-chain's matching semantics exactly —
// method-distinguished duplicates, prefix vs exact, predicate routes, and first-match-wins order.

function fakeReq(method) { return { method, on() {} }; }
function fakeRes() { return {}; }
function urlOf(pathname) { return { pathname, searchParams: new URLSearchParams() }; }

describe('route dispatcher matching semantics', () => {
  it('dispatches GET vs POST on the same path to DIFFERENT handlers', async () => {
    const hits = [];
    const routes = [
      { method: 'GET', match: 'exact', path: '/api/x', handler: () => hits.push('get') },
      { method: 'POST', match: 'exact', path: '/api/x', handler: () => hits.push('post') },
    ];
    const dispatch = createDispatcher(routes);
    assert.equal(await dispatch(fakeReq('GET'), fakeRes(), urlOf('/api/x')), true);
    assert.equal(await dispatch(fakeReq('POST'), fakeRes(), urlOf('/api/x')), true);
    assert.deepEqual(hits, ['get', 'post']);
  });

  it('exact match does not match a longer path; prefix match does', async () => {
    const exact = createDispatcher([{ method: 'GET', match: 'exact', path: '/api/p', handler: () => {} }]);
    assert.equal(await exact(fakeReq('GET'), fakeRes(), urlOf('/api/p/extra')), false);
    const prefix = createDispatcher([{ method: 'GET', match: 'prefix', path: '/api/p', handler: () => {} }]);
    assert.equal(await prefix(fakeReq('GET'), fakeRes(), urlOf('/api/p/extra')), true);
  });

  it('method gates non-predicate routes (wrong method = no match)', async () => {
    const dispatch = createDispatcher([{ method: 'DELETE', match: 'prefix', path: '/api/w/', handler: () => {} }]);
    assert.equal(await dispatch(fakeReq('POST'), fakeRes(), urlOf('/api/w/123')), false);
    assert.equal(await dispatch(fakeReq('DELETE'), fakeRes(), urlOf('/api/w/123')), true);
  });

  it('walks routes in order and stops at the first match', async () => {
    const hits = [];
    const routes = [
      { method: 'GET', match: 'prefix', path: '/api/', handler: () => hits.push('first') },
      { method: 'GET', match: 'exact', path: '/api/specific', handler: () => hits.push('second') },
    ];
    const dispatch = createDispatcher(routes);
    await dispatch(fakeReq('GET'), fakeRes(), urlOf('/api/specific'));
    assert.deepEqual(hits, ['first'], 'first matching route wins; order is load-bearing');
  });

  it('returns false when nothing matches (caller falls through to static/404)', async () => {
    const dispatch = createDispatcher([{ method: 'GET', match: 'exact', path: '/api/x', handler: () => {} }]);
    assert.equal(await dispatch(fakeReq('GET'), fakeRes(), urlOf('/nope')), false);
  });

  it('predicate routes match on the compound condition only', async () => {
    let hit = 0;
    const dispatch = createDispatcher([
      { predicate: (u, m) => u.startsWith('/api/ask-hook/') && u.includes('/result') && m === 'GET', handler: () => { hit++; } },
    ]);
    assert.equal(await dispatch(fakeReq('GET'), fakeRes(), urlOf('/api/ask-hook/42/result')), true);
    assert.equal(await dispatch(fakeReq('GET'), fakeRes(), urlOf('/api/ask-hook/42')), false, 'missing /result must not match');
    assert.equal(await dispatch(fakeReq('POST'), fakeRes(), urlOf('/api/ask-hook/42/result')), false, 'wrong method must not match');
    assert.equal(hit, 1);
  });
});

describe('files-content registry (method-distinguished + predicate routes)', () => {
  it('registers GET and POST /api/file-content as separate handlers', () => {
    const get = filesContentRoutes.find(r => r.path === '/api/file-content' && r.method === 'GET');
    const post = filesContentRoutes.find(r => r.path === '/api/file-content' && r.method === 'POST');
    assert.ok(get && post, 'both GET and POST /api/file-content must be registered');
    assert.notEqual(get.handler, post.handler, 'GET and POST must route to different handlers');
  });

  it('file-raw is a predicate route accepting GET and HEAD, exact-or-prefix', () => {
    const raw = filesContentRoutes.find(r => typeof r.predicate === 'function');
    assert.ok(raw, 'file-raw must be registered as a predicate route');
    assert.equal(raw.predicate('/api/file-raw', 'GET'), true);
    assert.equal(raw.predicate('/api/file-raw/sub/path.png', 'HEAD'), true);
    assert.equal(raw.predicate('/api/file-raw', 'POST'), false);
    assert.equal(raw.predicate('/api/file-rawish', 'GET'), false);
  });
});
