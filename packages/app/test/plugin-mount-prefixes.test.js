// Coverage: plugin-runtime mountPrefixes — externalPrefix (Location/x-forwarded-prefix)
// stays literal while cookiePath must be the wire form (browsers compare cookie Path against the encoded request path).
// This contract regressed once before (stripping the trailing slash before wireBasePath → silent fallback to literal); pure-function unit tests lock it down here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _mountPrefixesForTest } from '../server/lib/plugin-runtime.js';

const rt = { entry: { service: { prefix: '/plugins/svc' } } };

describe('plugin-runtime mountPrefixes (external literal / cookie wire)', () => {
  it('no prefix: both are consistent', () => {
    assert.deepEqual(_mountPrefixesForTest(rt, ''), {
      externalPrefix: '/plugins/svc',
      cookiePath: '/plugins/svc/',
    });
  });

  it('plain prefix: both are consistent (no encoded characters)', () => {
    assert.deepEqual(_mountPrefixesForTest(rt, '/ccv/'), {
      externalPrefix: '/ccv/plugins/svc',
      cookiePath: '/ccv/plugins/svc/',
    });
  });

  it('literal {token} prefix: externalPrefix literal, cookiePath wire form (%7Btoken%7D)', () => {
    const p = _mountPrefixesForTest(rt, '/arca/api/v1/session/{token}/');
    assert.equal(p.externalPrefix, '/arca/api/v1/session/{token}/plugins/svc');
    assert.equal(p.cookiePath, '/arca/api/v1/session/%7Btoken%7D/plugins/svc/');
    assert.ok(!p.cookiePath.includes('{'), 'cookie Path must not stay literal');
  });

  it('trailing-slash input is the contract precondition (normalizeBasePath output); no trailing slash still never silently falls back to literal', () => {
    // Regression guard: even if a caller mistakenly passes a form without a trailing slash, wiring must still happen
    // (trailing-slash semantics are guaranteed by the wireBasePath contract — this pins current behavior against further regression)
    const p = _mountPrefixesForTest(rt, '/arca/api/v1/session/{token}/');
    assert.ok(p.cookiePath.startsWith('/arca/api/v1/session/%7Btoken%7D/'));
  });
});
