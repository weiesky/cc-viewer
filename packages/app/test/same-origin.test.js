// Unit tests for the canonical same-origin guard (server/lib/same-origin.js).
//
// Covers the two regressions this guard must not reintroduce:
//  - F2: an Origin-less cross-site no-cors GET must not pass just because it has no Origin.
//  - F1: a TLS-terminating reverse proxy makes the browser Origin https while the backend
//    parses http; strict scheme comparison used to reject every legitimate WS/write call.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginBrowserRequest } from '../server/lib/same-origin.js';

const req = (headers) => ({ headers });
// Real callers pass a parsed URL instance (host + origin); mirror that shape here.
const parsed = (origin) => new URL(origin);

describe('isSameOriginBrowserRequest', () => {
  it('allows CLI/native requests without an Origin header', () => {
    assert.equal(isSameOriginBrowserRequest(req({}), parsed('http://127.0.0.1:7008')), true);
    assert.equal(isSameOriginBrowserRequest(req({ host: '127.0.0.1:7008' }), null), true);
  });

  it('rejects cross-site no-cors requests even without an Origin header (F2)', () => {
    assert.equal(isSameOriginBrowserRequest(req({ 'sec-fetch-site': 'cross-site' }), parsed('http://127.0.0.1:7008')), false);
    assert.equal(isSameOriginBrowserRequest(req({ 'sec-fetch-site': 'cross-site', host: '127.0.0.1:7008' }), null), false);
  });

  it('rejects a cross-site Origin', () => {
    assert.equal(
      isSameOriginBrowserRequest(req({ origin: 'https://evil.example' }), parsed('http://127.0.0.1:7008')),
      false,
    );
  });

  it('allows a same-origin browser request', () => {
    assert.equal(
      isSameOriginBrowserRequest(req({ origin: 'http://127.0.0.1:7008' }), parsed('http://127.0.0.1:7008')),
      true,
    );
  });

  it('compares host case-insensitively and falls back to req.headers.host', () => {
    assert.equal(
      isSameOriginBrowserRequest(req({ origin: 'HTTP://LOCALHOST:7008', host: 'localhost:7008' }), null),
      true,
    );
  });

  it('allows https->http scheme mismatch under a TLS-terminating reverse proxy without XFP (F1)', () => {
    assert.equal(
      isSameOriginBrowserRequest(req({ origin: 'https://ccv.example.com' }), parsed('http://ccv.example.com')),
      true,
    );
  });

  it('honors X-Forwarded-Proto when the proxy forwards the scheme', () => {
    assert.equal(
      isSameOriginBrowserRequest(
        req({ origin: 'https://ccv.example.com', 'x-forwarded-proto': 'https' }),
        parsed('http://ccv.example.com'),
      ),
      true,
    );
    assert.equal(
      isSameOriginBrowserRequest(
        req({ origin: 'http://ccv.example.com', 'x-forwarded-proto': 'https' }),
        parsed('http://ccv.example.com'),
      ),
      false,
    );
  });

  it('rejects a malformed Origin instead of throwing', () => {
    assert.equal(isSameOriginBrowserRequest(req({ origin: 'not a url' }), parsed('http://127.0.0.1:7008')), false);
  });

  it('rejects host mismatches even when both parse', () => {
    assert.equal(
      isSameOriginBrowserRequest(req({ origin: 'http://127.0.0.1:7008' }), parsed('http://127.0.0.1:9999')),
      false,
    );
  });
});
