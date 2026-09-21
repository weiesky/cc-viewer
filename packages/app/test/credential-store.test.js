import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ Data-safety isolation — do NOT revert to static imports (2026-06-06 incident) ████
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-credstore-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const {
  setSecret, getSecret, hasSecret, deleteSecret, migrateLegacySecret,
  credentialsFileFor, masterKeyPathFor,
} = await import('../server/lib/credential-store.js');

let workDir;
function credFile() { return join(workDir, 'credentials.json'); }
function keyPath() { return join(workDir, 'master.key'); }

describe('credential-store', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ccv-cs-case-'));
  });
  after(() => {
    try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  });

  it('credentialsFileFor / masterKeyPathFor derive canonical paths from the data root', () => {
    assert.equal(credentialsFileFor('/x'), '/x/credentials.json');
    assert.equal(masterKeyPathFor('/x'), '/x/master.key');
  });

  it('set/get round-trips a secret by kind+ref', () => {
    setSecret(credFile(), keyPath(), 'profile-apiKey', 'p1', 'sk-123');
    assert.equal(getSecret(credFile(), keyPath(), 'profile-apiKey', 'p1'), 'sk-123');
  });

  it('writes credentials.json at 0600', () => {
    setSecret(credFile(), keyPath(), 'lan-password', 'global', 'AB1234');
    if (process.platform !== 'win32') {
      assert.equal(statSync(credFile()).mode & 0o777, 0o600);
    }
  });

  it('never stores plaintext (on-disk value differs from the secret)', () => {
    setSecret(credFile(), keyPath(), 'lan-password', 'global', 'AB1234');
    const onDisk = readFileSync(credFile(), 'utf-8');
    assert.ok(!onDisk.includes('AB1234'));
  });

  it('hasSecret reflects presence; missing returns ""', () => {
    assert.equal(hasSecret(credFile(), 'im-secret', 'dingtalk.appSecret'), false);
    assert.equal(getSecret(credFile(), keyPath(), 'im-secret', 'dingtalk.appSecret'), '');
    setSecret(credFile(), keyPath(), 'im-secret', 'dingtalk.appSecret', 'topsecret');
    assert.equal(hasSecret(credFile(), 'im-secret', 'dingtalk.appSecret'), true);
  });

  it('setSecret with empty value removes the entry', () => {
    setSecret(credFile(), keyPath(), 'lan-password', 'global', 'AB1234');
    setSecret(credFile(), keyPath(), 'lan-password', 'global', '');
    assert.equal(hasSecret(credFile(), 'lan-password', 'global'), false);
  });

  it('deleteSecret removes a secret and is a no-op when absent', () => {
    setSecret(credFile(), keyPath(), 'profile-apiKey', 'p1', 'sk');
    deleteSecret(credFile(), 'profile-apiKey', 'p1');
    assert.equal(hasSecret(credFile(), 'profile-apiKey', 'p1'), false);
    deleteSecret(credFile(), 'profile-apiKey', 'never-there'); // no throw
  });

  it('scopes secrets by kind and ref independently', () => {
    setSecret(credFile(), keyPath(), 'lan-password', 'global', 'g');
    setSecret(credFile(), keyPath(), 'lan-password', 'proj:/a', 'p');
    setSecret(credFile(), keyPath(), 'im-secret', 'global', 'x');
    assert.equal(getSecret(credFile(), keyPath(), 'lan-password', 'global'), 'g');
    assert.equal(getSecret(credFile(), keyPath(), 'lan-password', 'proj:/a'), 'p');
    assert.equal(getSecret(credFile(), keyPath(), 'im-secret', 'global'), 'x');
  });

  it('migrateLegacySecret migrates a base64 legacy value once (idempotent)', () => {
    const b64 = Buffer.from('my-secret', 'utf-8').toString('base64');
    const decode = (s) => Buffer.from(s, 'base64').toString('utf-8');
    const wrote = migrateLegacySecret(credFile(), keyPath(), 'im-secret', 'feishu.appSecret', b64, decode);
    assert.equal(wrote, true);
    assert.equal(getSecret(credFile(), keyPath(), 'im-secret', 'feishu.appSecret'), 'my-secret');
    // second run does not rewrite / does not report a new migration
    const again = migrateLegacySecret(credFile(), keyPath(), 'im-secret', 'feishu.appSecret', b64, decode);
    assert.equal(again, false);
  });

  it('migrateLegacySecret migrates a plaintext legacy value (identity decode)', () => {
    const wrote = migrateLegacySecret(credFile(), keyPath(), 'profile-apiKey', 'p9', 'sk-plain', (s) => s);
    assert.equal(wrote, true);
    assert.equal(getSecret(credFile(), keyPath(), 'profile-apiKey', 'p9'), 'sk-plain');
  });

  it('migrateLegacySecret ignores empty legacy values', () => {
    assert.equal(migrateLegacySecret(credFile(), keyPath(), 'lan-password', 'global', '', (s) => s), false);
  });
});
