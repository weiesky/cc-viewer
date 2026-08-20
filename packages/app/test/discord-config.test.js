import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

// Discord config lives as the `discord` key in LOG_DIR/preferences.json. Redirect LOG_DIR before import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-discord-cfg-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const { getDescriptor, normalize, loadConfig, loadState, saveConfig, getPrefsPath } = await import('../server/lib/im/im-config.js');

function reset() { if (existsSync(getPrefsPath())) rmSync(getPrefsPath()); }

describe('discord descriptor + normalize', () => {
  it('exposes the discord defaults (maxChunkChars 1900) and allowList field', () => {
    const d = getDescriptor('discord');
    assert.equal(d.allowListField, 'allowUserIds');
    assert.deepEqual(d.defaults, { enabled: false, botToken: '', allowUserIds: [], maxChunkChars: 1900, blockOnSkipPermissions: false, ackCard: true });
  });

  it('empty config matches the default shape', () => {
    assert.deepEqual(normalize('discord', {}), getDescriptor('discord').defaults);
  });

  it('coerces types, trims token, de-dups allowUserIds, clamps chunk', () => {
    const n = normalize('discord', { enabled: 1, botToken: '  tok  ', allowUserIds: ['a', 'a', ' b ', '', 9], maxChunkChars: '50' });
    assert.deepEqual(n, { enabled: true, botToken: 'tok', allowUserIds: ['a', 'b'], maxChunkChars: 500, blockOnSkipPermissions: false, ackCard: true });
  });
});

describe('discord save / load roundtrip', () => {
  it('defaults to disabled when no file exists', () => {
    reset();
    assert.deepEqual(loadConfig('discord'), getDescriptor('discord').defaults);
  });

  it('roundtrips (plaintext in memory, base64 secret on disk)', () => {
    reset();
    saveConfig('discord', { enabled: true, botToken: 'topsecrettoken', allowUserIds: ['111'] });
    assert.deepEqual(loadConfig('discord'), { enabled: true, botToken: 'topsecrettoken', allowUserIds: ['111'], maxChunkChars: 1900, blockOnSkipPermissions: false, ackCard: true });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.discord.botToken, Buffer.from('topsecrettoken', 'utf-8').toString('base64'));
    assert.notEqual(onDisk.discord.botToken, 'topsecrettoken');
  });

  it('preserves the stored token when saved with an empty botToken', () => {
    reset();
    saveConfig('discord', { enabled: true, botToken: 'keepme' });
    const saved = saveConfig('discord', { enabled: false, botToken: '' });
    assert.equal(saved.botToken, 'keepme');
  });

  it('does not collide with sibling dingtalk/feishu/wecom keys', () => {
    reset();
    saveConfig('wecom', { enabled: true, botId: 'wb', secret: 'ws' });
    saveConfig('discord', { enabled: true, botToken: 'dt' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.ok(onDisk.wecom && onDisk.discord, 'both platforms persist as flat siblings');
    assert.equal(loadConfig('discord').botToken, 'dt');
  });

  it('writes preferences.json with 0600 permissions (POSIX)', { skip: platform() === 'win32' }, () => {
    reset();
    saveConfig('discord', { enabled: true, botToken: 'permtest' });
    assert.equal(statSync(getPrefsPath()).mode & 0o777, 0o600);
  });
});

describe('discord loadState (admin-facing)', () => {
  it('masks the token, exposes hasSecret, never botToken', () => {
    reset();
    saveConfig('discord', { enabled: true, botToken: 'shh' });
    const st = loadState('discord');
    assert.equal(st.hasSecret, true);
    assert.equal('botToken' in st, false, 'must never return the token');
  });
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
