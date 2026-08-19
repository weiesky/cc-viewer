import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

// WeCom config lives as the `wecom` key in LOG_DIR/preferences.json. Redirect LOG_DIR before import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-wecom-cfg-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const { getDescriptor, normalize, loadConfig, loadState, saveConfig, getPrefsPath } = await import('../packages/app/server/lib/im-config.js');

function reset() { if (existsSync(getPrefsPath())) rmSync(getPrefsPath()); }

describe('wecom descriptor + normalize', () => {
  it('exposes the wecom defaults and allowList field', () => {
    const d = getDescriptor('wecom');
    assert.equal(d.allowListField, 'allowUserIds');
    assert.deepEqual(d.defaults, { enabled: false, botId: '', secret: '', allowUserIds: [], maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, aiCard: false });
  });

  it('empty config matches the default shape', () => {
    assert.deepEqual(normalize('wecom', {}), getDescriptor('wecom').defaults);
  });

  it('coerces types, trims, de-dups allowUserIds, clamps chunk', () => {
    const n = normalize('wecom', { enabled: 1, botId: '  bot_x  ', secret: ' s ', allowUserIds: ['a', 'a', ' b ', '', 9], maxChunkChars: '99999' });
    assert.deepEqual(n, { enabled: true, botId: 'bot_x', secret: 's', allowUserIds: ['a', 'b'], maxChunkChars: 5000, blockOnSkipPermissions: false, ackCard: true, aiCard: false });
  });
});

describe('wecom save / load roundtrip', () => {
  it('defaults to disabled when no file exists', () => {
    reset();
    assert.deepEqual(loadConfig('wecom'), getDescriptor('wecom').defaults);
  });

  it('roundtrips (plaintext in memory, base64 cred/secret on disk)', () => {
    reset();
    saveConfig('wecom', { enabled: true, botId: 'bot_abc', secret: 'topsecret', allowUserIds: ['zhangsan'] });
    assert.deepEqual(loadConfig('wecom'), { enabled: true, botId: 'bot_abc', secret: 'topsecret', allowUserIds: ['zhangsan'], maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, aiCard: false });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.wecom.secret, Buffer.from('topsecret', 'utf-8').toString('base64'));
    assert.equal(onDisk.wecom.botId, Buffer.from('bot_abc', 'utf-8').toString('base64'));
  });

  it('preserves the stored secret when saved with an empty secret', () => {
    reset();
    saveConfig('wecom', { enabled: true, botId: 'bot', secret: 'keepme' });
    const saved = saveConfig('wecom', { enabled: false, botId: 'bot2', secret: '' });
    assert.equal(saved.secret, 'keepme');
    assert.equal(loadConfig('wecom').botId, 'bot2');
  });

  it('does not collide with sibling dingtalk/feishu keys', () => {
    reset();
    saveConfig('dingtalk', { enabled: true, appKey: 'dk', appSecret: 'ds' });
    saveConfig('feishu', { enabled: true, appId: 'fa', appSecret: 'fs' });
    saveConfig('wecom', { enabled: true, botId: 'wb', secret: 'ws' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.ok(onDisk.dingtalk && onDisk.feishu && onDisk.wecom, 'all three platforms persist as flat siblings');
    assert.equal(loadConfig('wecom').botId, 'wb');
  });

  it('writes preferences.json with 0600 permissions (POSIX)', { skip: platform() === 'win32' }, () => {
    reset();
    saveConfig('wecom', { enabled: true, botId: 'bot', secret: 'permtest' });
    assert.equal(statSync(getPrefsPath()).mode & 0o777, 0o600);
  });
});

describe('wecom loadState (admin-facing)', () => {
  it('masks the secret, exposes hasSecret + botId, never secret', () => {
    reset();
    saveConfig('wecom', { enabled: true, botId: 'pub_bot', secret: 'shh' });
    const st = loadState('wecom');
    assert.equal(st.botId, 'pub_bot');
    assert.equal(st.hasSecret, true);
    assert.equal('secret' in st, false, 'must never return the secret');
  });
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
