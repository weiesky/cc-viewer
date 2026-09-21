import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ Data-safety isolation — do NOT revert to static imports (2026-06-06 incident) ████
// credential-migrate captures its roots from LOG_DIR at module load; set CCV_LOG_DIR first.
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-credmig-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { migrateCredentialsToVault } = await import('../server/lib/credential-migrate.js');
const { getSecret } = await import('../server/lib/credential-store.js');

const PREFS = join(__isoDir, 'preferences.json');
const PROFILE = join(__isoDir, 'profile.json');
const CREDS = join(__isoDir, 'credentials.json');
const MKEY = join(__isoDir, 'master.key');

const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
function wipe() {
  for (const f of [PREFS, PROFILE, CREDS, MKEY]) { try { rmSync(f, { force: true }); } catch {} }
}

describe('credential-migrate', () => {
  beforeEach(wipe);
  after(() => { try { rmSync(__isoDir, { recursive: true, force: true }); } catch {} });

  it('migrates auth global password (base64) to the vault and strips it from preferences.json', () => {
    writeFileSync(PREFS, JSON.stringify({ auth: { enabled: true, password: b64('GLOBALPW') } }));
    const s = migrateCredentialsToVault();
    assert.equal(s.auth.migrated, 1);
    assert.equal(s.auth.failed, 0);
    const prefs = JSON.parse(readFileSync(PREFS, 'utf-8'));
    assert.equal(prefs.auth.enabled, true);
    assert.equal(prefs.auth.password, undefined, 'password stripped from preferences.json');
    assert.equal(getSecret(CREDS, MKEY, 'lan-password', 'global'), 'GLOBALPW');
  });

  it('migrates per-project auth overrides with a resolved proj ref', () => {
    writeFileSync(PREFS, JSON.stringify({
      auth: { enabled: true, password: b64('G') },
      authByProject: { '/tmp/projA': { enabled: true, password: b64('PROJPW') } },
    }));
    const s = migrateCredentialsToVault();
    assert.equal(s.auth.migrated, 2);
    assert.equal(getSecret(CREDS, MKEY, 'lan-password', 'proj:/tmp/projA'), 'PROJPW');
    const prefs = JSON.parse(readFileSync(PREFS, 'utf-8'));
    assert.equal(prefs.authByProject['/tmp/projA'].password, undefined);
  });

  it('migrates IM secret fields (base64) but leaves low-sensitivity cred fields base64', () => {
    writeFileSync(PREFS, JSON.stringify({
      dingtalk: { enabled: true, appKey: b64('dingkey'), appSecret: b64('dingsecret') },
      discord: { enabled: true, botToken: b64('discordtoken') },
    }));
    const s = migrateCredentialsToVault();
    assert.equal(s.im.migrated, 2);
    assert.equal(getSecret(CREDS, MKEY, 'im-secret', 'dingtalk.appSecret'), 'dingsecret');
    assert.equal(getSecret(CREDS, MKEY, 'im-secret', 'discord.botToken'), 'discordtoken');
    const prefs = JSON.parse(readFileSync(PREFS, 'utf-8'));
    assert.equal(prefs.dingtalk.appSecret, '', 'secret cleared');
    assert.equal(prefs.dingtalk.appKey, b64('dingkey'), 'low-sensitivity cred stays base64');
  });

  it('migrates profile.json plaintext apiKeys and strips them', () => {
    writeFileSync(PROFILE, JSON.stringify({
      profiles: [
        { id: 'max', name: 'Default' },
        { id: 'p1', name: 'deepseek', baseURL: 'https://x', apiKey: 'sk-real-1' },
        { id: 'p2', name: 'kimi', baseURL: 'https://y', apiKey: 'sk-real-2' },
      ],
    }));
    const s = migrateCredentialsToVault();
    assert.equal(s.profiles.migrated, 2);
    assert.equal(getSecret(CREDS, MKEY, 'profile-apiKey', 'p1'), 'sk-real-1');
    assert.equal(getSecret(CREDS, MKEY, 'profile-apiKey', 'p2'), 'sk-real-2');
    const prof = JSON.parse(readFileSync(PROFILE, 'utf-8'));
    assert.equal(prof.profiles.find(p => p.id === 'p1').apiKey, '', 'apiKey stripped from profile.json');
  });

  it('is idempotent: a second run is a no-op (no new migration)', () => {
    writeFileSync(PREFS, JSON.stringify({ auth: { enabled: true, password: b64('GLOBALPW') } }));
    migrateCredentialsToVault();
    const s2 = migrateCredentialsToVault();
    assert.equal(s2.auth.migrated, 0, 'already-migrated field is not re-migrated');
    assert.equal(getSecret(CREDS, MKEY, 'lan-password', 'global'), 'GLOBALPW');
  });

  it('a differing on-disk plaintext wins over the vault (user later intent)', () => {
    writeFileSync(PROFILE, JSON.stringify({ profiles: [{ id: 'p1', name: 'x', apiKey: 'sk-OLD' }] }));
    migrateCredentialsToVault();
    assert.equal(getSecret(CREDS, MKEY, 'profile-apiKey', 'p1'), 'sk-OLD');
    // user hand-edits profile.json with a NEW plaintext key (old-format reintroduction)
    writeFileSync(PROFILE, JSON.stringify({ profiles: [{ id: 'p1', name: 'x', apiKey: 'sk-NEW' }] }));
    const s = migrateCredentialsToVault();
    assert.equal(s.profiles.migrated, 1);
    assert.equal(getSecret(CREDS, MKEY, 'profile-apiKey', 'p1'), 'sk-NEW', 'on-disk plaintext overwrites the vault');
  });

  it('handles missing files gracefully (no-op, no throw)', () => {
    const s = migrateCredentialsToVault();
    assert.equal(s.auth.migrated, 0);
    assert.equal(s.im.migrated, 0);
    assert.equal(s.profiles.migrated, 0);
  });

  it('leaves low-sensitivity data and non-secret fields untouched', () => {
    writeFileSync(PREFS, JSON.stringify({
      theme: 'dark',
      auth: { enabled: false },
      feishu: { enabled: true, appId: b64('cli_x'), region: 'lark', allowUserIds: ['u1'] },
    }));
    migrateCredentialsToVault();
    const prefs = JSON.parse(readFileSync(PREFS, 'utf-8'));
    assert.equal(prefs.theme, 'dark');
    assert.equal(prefs.feishu.appId, b64('cli_x'));
    assert.equal(prefs.feishu.region, 'lark');
    assert.deepEqual(prefs.feishu.allowUserIds, ['u1']);
  });
});
