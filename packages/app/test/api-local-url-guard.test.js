// /api/local-url returns the full ACCESS_TOKEN. It must be gated on admin AND
// same-origin: the server has a permissive global CORS prelude and loopback skips
// auth, so an unguarded read hands a cross-site page the token end-to-end.
//
// Isolation: plugin-loader is stubbed (only runWaterfallHook is used here) so this
// test never touches the real plugin directory; the route module imports it eagerly.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const LOADER_URL = new URL('../server/lib/plugin-loader.js', import.meta.url).href;
const LOADER_SRC = `
export async function runWaterfallHook(name, initialValue) { return initialValue; }
`;

function fakeRes() {
  const res = { statusCode: null, body: '', headers: null };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers; };
  res.end = (chunk) => { res.body = chunk || ''; };
  return res;
}

const fakeReq = (headers = {}) => ({ headers });

describe('GET /api/local-url — admin + same-origin gate', () => {
  let handler;

  before(async () => {
    registerHooks({
      load(url, context, nextLoad) {
        if (url === LOADER_URL) return { format: 'module', shortCircuit: true, source: LOADER_SRC };
        return nextLoad(url, context);
      },
    });
    const { miscRoutes } = await import('../server/routes/misc.js');
    handler = miscRoutes.find((r) => r.method === 'GET' && r.path === '/api/local-url').handler;
  });

  const deps = {
    getLocalIp: () => '127.0.0.1',
    protocol: 'http',
    actualPort: 7008,
    ACCESS_TOKEN: 'test-access-token',
  };
  const parsedUrl = new URL('http://127.0.0.1:7008/api/local-url');

  it('rejects a cross-site Origin with 403 and never leaks the token', async () => {
    const res = fakeRes();
    const req = fakeReq({ origin: 'https://evil.example' });
    req.ccvIsAdmin = true;
    await handler(req, res, parsedUrl, true, deps);
    assert.equal(res.statusCode, 403);
    assert.doesNotMatch(res.body, /test-access-token/);
  });

  it('rejects an Origin-less cross-site no-cors request with 403', async () => {
    const res = fakeRes();
    await handler(fakeReq({ 'sec-fetch-site': 'cross-site' }), res, parsedUrl, true, deps);
    assert.equal(res.statusCode, 403);
  });

  it('rejects a non-admin caller with 403', async () => {
    const res = fakeRes();
    await handler(fakeReq(), res, parsedUrl, false, deps);
    assert.equal(res.statusCode, 403);
  });

  it('allows CLI/native clients without an Origin header', async () => {
    const res = fakeRes();
    await handler(fakeReq(), res, parsedUrl, true, deps);
    assert.equal(res.statusCode, 200);
    assert.match(JSON.parse(res.body).url, /token=test-access-token/);
  });

  it('allows a same-origin admin browser request', async () => {
    const res = fakeRes();
    await handler(fakeReq({ origin: 'http://127.0.0.1:7008' }), res, parsedUrl, true, deps);
    assert.equal(res.statusCode, 200);
    assert.match(JSON.parse(res.body).url, /token=test-access-token/);
  });

  it('allows an authenticated remote admin on a same-origin page', async () => {
    const res = fakeRes();
    const req = fakeReq({ origin: 'http://127.0.0.1:7008' });
    req.ccvIsAdmin = true;
    await handler(req, res, parsedUrl, false, deps);
    assert.equal(res.statusCode, 200);
  });
});
