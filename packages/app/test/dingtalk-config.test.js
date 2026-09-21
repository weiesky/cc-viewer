import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

// DingTalk config lives as the `dingtalk` key in LOG_DIR/preferences.json. Redirect LOG_DIR
// into a temp dir via CCV_LOG_DIR BEFORE importing the module (LOG_DIR is resolved at module
// load and getPrefsPath() reads it fresh), isolating the test from the real prefs file.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-dingtalk-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const {
  DEFAULT_DT_CONFIG,
  encodeSecret,
  decodeSecret,
  normalizeDingTalk,
  loadDingTalkConfig,
  loadDingTalkState,
  saveDingTalkConfig,
  getPrefsPath,
} = await import('../server/lib/im/dingtalk-config.js');
const { _resetCredentialAccess, writeSecret } = await import('../server/lib/credential-access.js');

// appSecret now lives in the credential vault (credentials.json, AES-256-GCM); preferences.json
// keeps the secret field CLEARED (''). appKey (a low-sensitivity cred) stays base64 on disk.
const credFile = join(tmpDir, 'credentials.json');
const masterKey = join(tmpDir, 'master.key');
function reset() {
  if (existsSync(getPrefsPath())) rmSync(getPrefsPath());
  try { rmSync(credFile, { force: true }); } catch {}
  try { rmSync(masterKey, { force: true }); } catch {}
  _resetCredentialAccess();
}

describe('encodeSecret / decodeSecret', () => {
  it('roundtrips and is base64 (not raw)', () => {
    const enc = encodeSecret('app-secret-xyz');
    assert.notEqual(enc, 'app-secret-xyz');
    assert.equal(decodeSecret(enc), 'app-secret-xyz');
  });
  it('handles empty / garbage gracefully', () => {
    assert.equal(encodeSecret(''), '');
    assert.equal(decodeSecret(''), '');
    assert.equal(decodeSecret(null), '');
    assert.equal(decodeSecret(123), '');
  });
});

describe('normalizeDingTalk', () => {
  it('coerces types and trims', () => {
    const n = normalizeDingTalk({ enabled: 1, appKey: '   key  ', appSecret: ' sec ', allowStaffIds: ['a', 'a', ' b ', '', 2], maxChunkChars: '4000' });
    assert.deepEqual(n, { enabled: true, appKey: 'key', appSecret: 'sec', allowStaffIds: ['a', 'b'], maxChunkChars: 4000, blockOnSkipPermissions: false, ackCard: true, cardTemplateId: '', aiCardTemplateId: '', aiCardStreamKey: '' });
  });
  it('defaults / clamps maxChunkChars', () => {
    assert.equal(normalizeDingTalk({}).maxChunkChars, 3800);
    assert.equal(normalizeDingTalk({ maxChunkChars: 10 }).maxChunkChars, 500);
    assert.equal(normalizeDingTalk({ maxChunkChars: 99999 }).maxChunkChars, 5000);
    assert.equal(normalizeDingTalk({ maxChunkChars: 'nope' }).maxChunkChars, 3800);
  });
  it('empty config matches the default shape', () => {
    assert.deepEqual(normalizeDingTalk({}), DEFAULT_DT_CONFIG);
  });
});

describe('save / load roundtrip', () => {
  it('defaults to disabled + empty when no file exists', () => {
    reset();
    assert.deepEqual(loadDingTalkConfig(), DEFAULT_DT_CONFIG);
  });

  it('roundtrips through preferences.json (plaintext in memory; appKey base64 on disk; appSecret in the vault)', () => {
    reset();
    saveDingTalkConfig({ enabled: true, appKey: 'ding123', appSecret: 'topsecret', allowStaffIds: ['u1'], maxChunkChars: 2000 });
    assert.deepEqual(loadDingTalkConfig(), { enabled: true, appKey: 'ding123', appSecret: 'topsecret', allowStaffIds: ['u1'], maxChunkChars: 2000, blockOnSkipPermissions: false, ackCard: true, cardTemplateId: '', aiCardTemplateId: '', aiCardStreamKey: '' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.dingtalk.enabled, true);
    // appSecret is NOT on disk (cleared); it lives as ciphertext in credentials.json
    assert.equal(onDisk.dingtalk.appSecret, '', 'secret field cleared on disk (vault-backed)');
    assert.equal(onDisk.dingtalk.appKey, Buffer.from('ding123', 'utf-8').toString('base64'), 'low-sensitivity cred stays base64');
    const creds = JSON.parse(readFileSync(credFile, 'utf-8'));
    const stored = creds.creds['im-secret:dingtalk.appSecret'];
    assert.ok(stored, 'secret lives in the vault');
    assert.notEqual(stored, 'topsecret');
    assert.ok(!readFileSync(credFile, 'utf-8').includes('topsecret'), 'no plaintext anywhere');
  });

  it('preserves unrelated preferences (read-merge-write)', () => {
    reset();
    writeFileSync(getPrefsPath(), JSON.stringify({ themeColor: 'light', auth: { enabled: true, password: 'eA==' } }, null, 2));
    saveDingTalkConfig({ enabled: true, appKey: 'k', appSecret: 's' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.themeColor, 'light');
    assert.equal(onDisk.auth.password, 'eA==');
    assert.equal(onDisk.dingtalk.appSecret, '', 'secret field cleared on disk (vault-backed)');
    assert.equal(onDisk.dingtalk.appKey, Buffer.from('k', 'utf-8').toString('base64'));
  });

  it('preserves the stored secret when saved with an empty appSecret', () => {
    reset();
    saveDingTalkConfig({ enabled: true, appKey: 'k', appSecret: 'keepme' });
    // edit another field, leaving appSecret blank
    const saved = saveDingTalkConfig({ enabled: false, appKey: 'k2', appSecret: '' });
    assert.equal(saved.appSecret, 'keepme', 'empty secret must preserve the stored one');
    assert.equal(loadDingTalkConfig().appSecret, 'keepme');
    assert.equal(loadDingTalkConfig().appKey, 'k2');
    assert.equal(loadDingTalkConfig().enabled, false);
  });

  it('keeps the legacy secret when the vault is unreadable and a field is saved (no secret wipe)', () => {
    reset();
    // legacy (pre-migration) state: secret as base64 in preferences.json, NO vault entry yet
    writeFileSync(getPrefsPath(), JSON.stringify({
      dingtalk: { enabled: true, appKey: Buffer.from('k', 'utf-8').toString('base64'), appSecret: Buffer.from('SUPER-SECRET', 'utf-8').toString('base64') },
    }));
    // make the vault unreadable: an entry exists somewhere + master.key is gone
    writeSecret('im-secret', 'other.field', 'x');
    rmSync(masterKey, { force: true });
    _resetCredentialAccess();
    // save an unrelated field (UI sends appSecret:'' because it never holds the secret)
    saveDingTalkConfig({ enabled: true, appKey: 'k', maxChunkChars: 1234, appSecret: '' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.notEqual(onDisk.dingtalk.appSecret, '', 'unreadable vault must NOT clear the legacy secret');
    assert.equal(onDisk.dingtalk.appSecret, Buffer.from('SUPER-SECRET', 'utf-8').toString('base64'), 'legacy secret preserved');
    assert.equal(loadDingTalkConfig().appSecret, 'SUPER-SECRET', 'secret still resolves for the bridge');
  });

  it('round-trips blockOnSkipPermissions and exposes it in admin state', () => {
    reset();
    saveDingTalkConfig({ enabled: true, appKey: 'k', appSecret: 's', blockOnSkipPermissions: true });
    assert.equal(loadDingTalkConfig().blockOnSkipPermissions, true);
    assert.equal(loadDingTalkState().blockOnSkipPermissions, true);
    // omitted → coerces to false
    assert.equal(saveDingTalkConfig({ enabled: true, appKey: 'k', appSecret: '' }).blockOnSkipPermissions, false);
  });

  it('returns defaults on a corrupt file', () => {
    reset();
    saveDingTalkConfig({ enabled: true, appKey: 'k', appSecret: 's' });
    writeFileSync(getPrefsPath(), 'not json{{');
    assert.deepEqual(loadDingTalkConfig(), DEFAULT_DT_CONFIG);
  });

  it('writes preferences.json with 0600 permissions (POSIX)', { skip: platform() === 'win32' }, () => {
    reset();
    saveDingTalkConfig({ enabled: true, appKey: 'k', appSecret: 'permtest' });
    assert.equal(statSync(getPrefsPath()).mode & 0o777, 0o600);
  });
});

describe('loadDingTalkState (admin-facing)', () => {
  it('masks the secret, exposes hasSecret + appKey', () => {
    reset();
    saveDingTalkConfig({ enabled: true, appKey: 'pubkey', appSecret: 'shh' });
    const st = loadDingTalkState();
    assert.equal(st.appKey, 'pubkey');
    assert.equal(st.hasSecret, true);
    assert.equal(st.enabled, true);
    assert.equal('appSecret' in st, false, 'must never return appSecret');
  });
  it('hasSecret is false when no secret stored', () => {
    reset();
    saveDingTalkConfig({ enabled: false, appKey: 'k', appSecret: '' });
    assert.equal(loadDingTalkState().hasSecret, false);
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
