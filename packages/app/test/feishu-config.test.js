import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

// Feishu config lives as the `feishu` key in LOG_DIR/preferences.json. Redirect LOG_DIR before import.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-feishu-cfg-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const { getDescriptor, normalize, loadConfig, loadState, saveConfig, getPrefsPath } = await import('../server/lib/im/im-config.js');

function reset() { if (existsSync(getPrefsPath())) rmSync(getPrefsPath()); }

describe('feishu descriptor + normalize', () => {
  it('exposes the feishu defaults and allowList field', () => {
    const d = getDescriptor('feishu');
    assert.equal(d.allowListField, 'allowUserIds');
    assert.deepEqual(d.defaults, { enabled: false, appId: '', appSecret: '', region: 'feishu', allowUserIds: [], maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, aiCard: false });
  });

  it('empty config matches the default shape', () => {
    assert.deepEqual(normalize('feishu', {}), getDescriptor('feishu').defaults);
  });

  it('coerces types, trims, de-dups allowUserIds, clamps chunk', () => {
    const n = normalize('feishu', { enabled: 1, appId: '  cli_x  ', appSecret: ' sec ', allowUserIds: ['a', 'a', ' b ', '', 7], maxChunkChars: '6000' });
    assert.deepEqual(n, { enabled: true, appId: 'cli_x', appSecret: 'sec', region: 'feishu', allowUserIds: ['a', 'b'], maxChunkChars: 5000, blockOnSkipPermissions: false, ackCard: true, aiCard: false });
  });

  it('region normalizes to feishu unless explicitly lark', () => {
    assert.equal(normalize('feishu', { region: 'lark' }).region, 'lark');
    assert.equal(normalize('feishu', { region: 'whatever' }).region, 'feishu');
    assert.equal(normalize('feishu', {}).region, 'feishu');
  });
});

describe('feishu save / load roundtrip', () => {
  it('defaults to disabled when no file exists', () => {
    reset();
    assert.deepEqual(loadConfig('feishu'), getDescriptor('feishu').defaults);
  });

  it('roundtrips (plaintext in memory, base64 cred/secret on disk), keeps region plaintext', () => {
    reset();
    saveConfig('feishu', { enabled: true, appId: 'cli_abc', appSecret: 'topsecret', region: 'lark', allowUserIds: ['ou_1'] });
    assert.deepEqual(loadConfig('feishu'), { enabled: true, appId: 'cli_abc', appSecret: 'topsecret', region: 'lark', allowUserIds: ['ou_1'], maxChunkChars: 3800, blockOnSkipPermissions: false, ackCard: true, aiCard: false });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.feishu.appSecret, Buffer.from('topsecret', 'utf-8').toString('base64'));
    assert.equal(onDisk.feishu.appId, Buffer.from('cli_abc', 'utf-8').toString('base64'));
    assert.equal(onDisk.feishu.region, 'lark', 'region is stored plaintext (not a secret)');
  });

  it('preserves the stored secret when saved with an empty appSecret', () => {
    reset();
    saveConfig('feishu', { enabled: true, appId: 'cli', appSecret: 'keepme' });
    const saved = saveConfig('feishu', { enabled: false, appId: 'cli2', appSecret: '' });
    assert.equal(saved.appSecret, 'keepme');
    assert.equal(loadConfig('feishu').appId, 'cli2');
  });

  it('does not collide with a sibling dingtalk key', () => {
    reset();
    saveConfig('dingtalk', { enabled: true, appKey: 'dk', appSecret: 'ds' });
    saveConfig('feishu', { enabled: true, appId: 'fa', appSecret: 'fs' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.ok(onDisk.dingtalk && onDisk.feishu, 'both platforms persist as flat siblings');
    assert.equal(loadConfig('dingtalk').appKey, 'dk');
    assert.equal(loadConfig('feishu').appId, 'fa');
  });

  it('writes preferences.json with 0600 permissions (POSIX)', { skip: platform() === 'win32' }, () => {
    reset();
    saveConfig('feishu', { enabled: true, appId: 'cli', appSecret: 'permtest' });
    assert.equal(statSync(getPrefsPath()).mode & 0o777, 0o600);
  });
});

describe('feishu loadState (admin-facing)', () => {
  it('masks the secret, exposes hasSecret + appId + region, never appSecret', () => {
    reset();
    saveConfig('feishu', { enabled: true, appId: 'pub_cli', appSecret: 'shh', region: 'lark' });
    const st = loadState('feishu');
    assert.equal(st.appId, 'pub_cli');
    assert.equal(st.region, 'lark');
    assert.equal(st.hasSecret, true);
    assert.equal('appSecret' in st, false, 'must never return appSecret');
  });
});

after(() => { rmSync(tmpDir, { recursive: true, force: true }); });
