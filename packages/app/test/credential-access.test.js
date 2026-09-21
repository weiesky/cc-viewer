import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ Data-safety isolation — do NOT revert to static imports (2026-06-06 incident) ████
// credential-access captures its credential root from LOG_DIR AT MODULE LOAD, so CCV_LOG_DIR
// must point at the isolation dir BEFORE the (top-level await) import below.
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-credaccess-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const {
  readSecretOr, writeSecret, removeSecret, migrateFieldWithVerify, persistProfilesApiKeys,
  getCredentialsFile, getMasterKeyPath, _resetCredentialAccess,
} = await import('../server/lib/credential-access.js');

function credFile() { return join(__isoDir, 'credentials.json'); }
function keyPath() { return join(__isoDir, 'master.key'); }

describe('credential-access', () => {
  beforeEach(() => {
    // wipe the credential root between cases (the module captured __isoDir at load)
    try { rmSync(credFile(), { force: true }); } catch {}
    try { rmSync(keyPath(), { force: true }); } catch {}
    _resetCredentialAccess();
  });
  after(() => {
    try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  });

  it('captures the credential root from LOG_DIR at load', () => {
    assert.equal(getCredentialsFile(), credFile());
    assert.equal(getMasterKeyPath(), keyPath());
  });

  it('write + read round-trips a secret; unreadable=false', () => {
    assert.equal(writeSecret('lan-password', 'global', 'AB1234'), true);
    const r = readSecretOr('lan-password', 'global');
    assert.equal(r.value, 'AB1234');
    assert.equal(r.unreadable, false);
  });

  it('read with no vault entry returns the legacy fallback (read-fallback), unreadable=false', () => {
    const r = readSecretOr('im-secret', 'dingtalk.appSecret', 'legacy-plain');
    assert.equal(r.value, 'legacy-plain');
    assert.equal(r.unreadable, false);
  });

  it('vault is authoritative: a stored value beats the fallback', () => {
    writeSecret('lan-password', 'global', 'vault-val');
    const r = readSecretOr('lan-password', 'global', 'legacy-val');
    assert.equal(r.value, 'vault-val');
  });

  it('write empty removes the entry; removeSecret is idempotent', () => {
    writeSecret('lan-password', 'global', 'x');
    writeSecret('lan-password', 'global', '');
    assert.equal(readSecretOr('lan-password', 'global').value, '');
    assert.equal(removeSecret('lan-password', 'global'), true);
  });

  it('master.key is created at 0600 on first write (empty vault)', () => {
    writeSecret('lan-password', 'global', 'x');
    assert.ok(existsSync(keyPath()));
    if (process.platform !== 'win32') {
      assert.equal(statSync(keyPath()).mode & 0o777, 0o600);
    }
  });

  it('hard-fails (unreadable) when ciphertext exists but master.key is missing — never mints', () => {
    writeSecret('lan-password', 'global', 'topsecret');
    assert.ok(existsSync(keyPath()));
    // simulate key loss
    rmSync(keyPath(), { force: true });
    _resetCredentialAccess();
    const r = readSecretOr('lan-password', 'global', 'fallback');
    assert.equal(r.unreadable, true);
    // must NOT have minted a fresh key
    assert.equal(existsSync(keyPath()), false);
  });

  it('migrateFieldWithVerify migrates a legacy plaintext and verifies read-back', () => {
    const r = migrateFieldWithVerify('profile-apiKey', 'p1', 'sk-abc');
    assert.deepEqual(r, { migrated: true, verified: true });
    assert.equal(readSecretOr('profile-apiKey', 'p1').value, 'sk-abc');
  });

  it('migrateFieldWithVerify is idempotent when the vault already holds the same value', () => {
    migrateFieldWithVerify('profile-apiKey', 'p1', 'sk-abc');
    const r = migrateFieldWithVerify('profile-apiKey', 'p1', 'sk-abc');
    assert.deepEqual(r, { migrated: true, verified: true });
  });

  it('migrateFieldWithVerify lets a differing on-disk value overwrite the vault (user intent wins)', () => {
    writeSecret('profile-apiKey', 'p1', 'old-vault-val');
    const r = migrateFieldWithVerify('profile-apiKey', 'p1', 'new-disk-val');
    assert.equal(r.migrated, true);
    assert.equal(readSecretOr('profile-apiKey', 'p1').value, 'new-disk-val');
  });

  it('migrateFieldWithVerify ignores empty legacy values', () => {
    assert.deepEqual(migrateFieldWithVerify('lan-password', 'global', ''), { migrated: false, verified: false });
  });

  it('FAIL-CLOSED: a corrupt credentials.json reads as unreadable (never empty), and writeSecret refuses', () => {
    // a vault with an entry, then the file is corrupted
    writeSecret('lan-password', 'global', 'REALPW');
    writeFileSync(credFile(), '{ not json{{', 'utf-8');
    _resetCredentialAccess();
    const r = readSecretOr('lan-password', 'global');
    assert.equal(r.unreadable, true, 'corrupt vault file must read as unreadable, not as "no entry" (fail-open)');
    // writeSecret must refuse to mint/overwrite over an unreadable vault
    assert.equal(writeSecret('lan-password', 'global', 'NEW'), false);
  });

  it('FAIL-CLOSED: a corrupt credentials.json with a missing master.key does NOT mint a new key', () => {
    writeSecret('lan-password', 'global', 'REALPW');
    writeFileSync(credFile(), '{ truncated', 'utf-8');
    rmSync(keyPath(), { force: true });
    _resetCredentialAccess();
    const r = readSecretOr('lan-password', 'global');
    assert.equal(r.unreadable, true);
    assert.equal(existsSync(keyPath()), false, 'must not mint a new key over an unreadable vault');
  });

  it('persistProfilesApiKeys keeps the plaintext key on disk when the vault write fails (no key loss)', () => {
    // make the vault unusable: an entry exists but master.key is gone → writeSecret returns false
    writeSecret('profile-apiKey', 'p1', 'existing');
    rmSync(keyPath(), { force: true });
    _resetCredentialAccess();
    const incoming = [{ id: 'p1', name: 'x', baseURL: 'https://x', apiKey: 'sk-NEW-PLAIN' }];
    const out = persistProfilesApiKeys(incoming, null, { isMaskedFn: () => false });
    assert.equal(out[0].apiKey, 'sk-NEW-PLAIN', 'failed vault write must keep the plaintext on disk (not strip it)');
  });

  it('persistProfilesApiKeys preserves a vault entry on an empty-string save (unreadable-vault no-op save)', () => {
    writeSecret('profile-apiKey', 'p1', 'sk-real');
    // a save that carries apiKey:'' (as hydrate serves when the vault can't be read) must NOT delete it
    const incoming = [{ id: 'p1', name: 'x', baseURL: 'https://x', apiKey: '' }];
    const out = persistProfilesApiKeys(incoming, [{ id: 'p1', name: 'x', baseURL: 'https://x', apiKey: '' }], { isMaskedFn: () => false });
    assert.equal(out[0].apiKey, '');
    assert.equal(readSecretOr('profile-apiKey', 'p1').value, 'sk-real', 'empty-string save must not delete the vault entry');
  });

  it('persistProfilesApiKeys deletes the vault entry only when the profile is removed from the list', () => {
    writeSecret('profile-apiKey', 'p1', 'sk-real');
    writeSecret('profile-apiKey', 'p2', 'sk-real2');
    // full-replacement: p2 removed → its vault entry is deleted; p1 kept
    const incoming = [{ id: 'p1', name: 'x', apiKey: '' }];
    persistProfilesApiKeys(incoming, [{ id: 'p1', name: 'x', apiKey: '' }, { id: 'p2', name: 'y', apiKey: '' }], { isMaskedFn: () => false });
    assert.equal(readSecretOr('profile-apiKey', 'p2').value, '', 'removed profile loses its vault entry');
    assert.equal(readSecretOr('profile-apiKey', 'p1').value, 'sk-real', 'kept profile retains its entry');
  });
});
