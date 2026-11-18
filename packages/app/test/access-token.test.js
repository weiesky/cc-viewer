// Coverage: lib/access-token.js — the self-update ACCESS_TOKEN handoff contract.
// takeInheritedAccessToken must accept only the exact randomBytes(16).toString('hex')
// shape and always strip the key from the env object (so it never leaks into children).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ACCESS_TOKEN_ENV, ACCESS_TOKEN_RE, takeInheritedAccessToken } from '../server/lib/access-token.js';

const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('access-token handoff', () => {
  it('accepts a valid 32-lowercase-hex token and strips the env key', () => {
    const env = { [ACCESS_TOKEN_ENV]: VALID, OTHER: '1' };
    assert.equal(takeInheritedAccessToken(env), VALID);
    assert.equal(env[ACCESS_TOKEN_ENV], undefined);
    assert.equal(env.OTHER, '1');
  });

  it('rejects malformed values but still strips the key', () => {
    const bad = [
      VALID.toUpperCase(),        // uppercase hex
      VALID.slice(0, 31),         // too short
      VALID + 'f',                // too long
      VALID.replace('a', 'g'),    // non-hex char
      VALID + '\n',               // trailing newline
      '',                         // empty
      123,                        // non-string
      null,
      undefined,
    ];
    for (const value of bad) {
      const env = { [ACCESS_TOKEN_ENV]: value };
      assert.equal(takeInheritedAccessToken(env), null, `should reject ${JSON.stringify(value)}`);
      assert.equal(ACCESS_TOKEN_ENV in env, false, 'key must be stripped even when rejected');
    }
  });

  it('pins the env-name wire contract (old helper ↔ new server)', () => {
    assert.equal(ACCESS_TOKEN_ENV, 'CCV_ACCESS_TOKEN');
  });

  it('still returns a valid token when the env is frozen (strip is best-effort)', () => {
    const env = Object.freeze({ [ACCESS_TOKEN_ENV]: VALID });
    // delete throws silently in strict mode on a frozen object; the token is still
    // returned (documented behavior) — a spread of a frozen env could then carry it.
    assert.equal(takeInheritedAccessToken(env), VALID);
    assert.equal(env[ACCESS_TOKEN_ENV], VALID, 'frozen env cannot be stripped');
  });

  it('returns null when the key is absent', () => {
    assert.equal(takeInheritedAccessToken({}), null);
  });

  it('tolerates a null/invalid env object', () => {
    assert.equal(takeInheritedAccessToken(null), null);
    assert.equal(takeInheritedAccessToken(undefined), null);
  });

  it('matches the exact shape of randomBytes(16).toString("hex")', () => {
    for (let i = 0; i < 100; i++) {
      const token = randomBytes(16).toString('hex');
      assert.ok(ACCESS_TOKEN_RE.test(token), `generated token must validate: ${token}`);
    }
  });

  it('regex is anchored and stateless (no global/sticky lastIndex)', () => {
    assert.equal(ACCESS_TOKEN_RE.global, false);
    assert.equal(ACCESS_TOKEN_RE.sticky, false);
    assert.ok(!ACCESS_TOKEN_RE.test(` ${VALID}`), 'leading space must fail');
    assert.ok(!ACCESS_TOKEN_RE.test(`${VALID} `), 'trailing space must fail');
  });
});
