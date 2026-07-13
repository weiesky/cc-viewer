// Pure function + integration tests for ccswitch-import.
// mapProviderToProfile / mergeImportedProfiles are pure-function unit tests;
// readCcSwitchProviders runs integration verification against the real local cc-switch.db (run if present, skip otherwise).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import {
  mapProviderToProfile,
  mergeImportedProfiles,
  findCcSwitchDbPath,
  readCcSwitchProviders,
  discoverCcSwitchProviders,
} from '../server/lib/ccswitch-import.js';

describe('mapProviderToProfile', () => {
  it('完整 claude 供应商映射所有字段', () => {
    const row = {
      id: 'abc-123',
      app_type: 'claude',
      name: '讯飞',
      is_current: 1,
      settings_config: JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://maas.example.com',
          ANTHROPIC_AUTH_TOKEN: 'sk-token-xxx',
          ANTHROPIC_MODEL: 'astron-code',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus-m',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-m',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-m',
          ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'should-be-ignored', // the _NAME variant must be ignored
        },
      }),
    };
    const p = mapProviderToProfile(row);
    assert.equal(p.id, 'ccs_abc-123');
    assert.equal(p.name, '讯飞');
    assert.equal(p.baseURL, 'https://maas.example.com');
    assert.equal(p.apiKey, 'sk-token-xxx');
    assert.equal(p.ANTHROPIC_MODEL, 'astron-code');
    assert.equal(p.ANTHROPIC_DEFAULT_OPUS_MODEL, 'opus-m');
    assert.equal(p.ANTHROPIC_DEFAULT_SONNET_MODEL, 'sonnet-m');
    assert.equal(p.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'haiku-m');
    assert.equal(p.source, 'cc-switch');
    // the _NAME variant must not leak into any field
    assert.equal(JSON.stringify(p).includes('_NAME'), false);
    assert.equal(JSON.stringify(p).includes('should-be-ignored'), false);
  });

  it('app_type 非 claude 返回 null', () => {
    const row = {
      id: 'x', app_type: 'codex', name: 'codex-prov',
      settings_config: JSON.stringify({ env: { OPENAI_API_KEY: 'sk' } }),
    };
    assert.equal(mapProviderToProfile(row), null);
  });

  it('settings_config 无 env 字段返回 null（如 Claude Official 只有配置无凭证）', () => {
    const row = {
      id: 'official', app_type: 'claude', name: 'Claude Official',
      settings_config: JSON.stringify({ env: { CLAUDE_CODE_EFFORT_LEVEL: 'max' } }),
    };
    assert.equal(mapProviderToProfile(row), null);
  });

  it('settings_config 非 JSON 返回 null', () => {
    const row = { id: 'bad', app_type: 'claude', name: 'Bad', settings_config: 'not json{' };
    assert.equal(mapProviderToProfile(row), null);
  });

  it('settings_config 为 null 返回 null', () => {
    const row = { id: 'n', app_type: 'claude', name: 'N', settings_config: null };
    assert.equal(mapProviderToProfile(row), null);
  });

  it('缺 baseURL 返回 null（只有 token 不够）', () => {
    const row = {
      id: 't', app_type: 'claude', name: 'T',
      settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk' } }),
    };
    assert.equal(mapProviderToProfile(row), null);
  });

  it('ANTHROPIC_API_KEY 也能映射到 apiKey', () => {
    const row = {
      id: 'k', app_type: 'claude', name: 'K',
      settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_API_KEY: 'sk-key' } }),
    };
    const p = mapProviderToProfile(row);
    assert.equal(p.apiKey, 'sk-key');
  });

  it('ANTHROPIC_AUTH_TOKEN 优先于 ANTHROPIC_API_KEY', () => {
    const row = {
      id: 'both', app_type: 'claude', name: 'Both',
      settings_config: JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://x',
          ANTHROPIC_AUTH_TOKEN: 'token-val',
          ANTHROPIC_API_KEY: 'key-val',
        },
      }),
    };
    const p = mapProviderToProfile(row);
    assert.equal(p.apiKey, 'token-val');
  });
});

describe('mergeImportedProfiles', () => {
  it('更新已有 ccs_ + 保留用户自建 proxy_ + 追加新 ccs_', () => {
    const existing = [
      { id: 'max', name: 'Default' },
      { id: 'proxy_mine', name: '我的', baseURL: 'https://mine', apiKey: 'k1' },
      { id: 'ccs_old', name: '旧讯飞', baseURL: 'https://old', apiKey: 'old-key' },
    ];
    const imported = [
      { id: 'ccs_old', name: '新讯飞', baseURL: 'https://new', apiKey: 'new-key', source: 'cc-switch' },
      { id: 'ccs_new', name: '新供应商', baseURL: 'https://newp', apiKey: 'k2', source: 'cc-switch' },
    ];
    const r = mergeImportedProfiles(existing, imported);
    // max stays at the front
    assert.equal(r.profiles[0].id, 'max');
    // user-created profile is preserved unchanged
    const mine = r.profiles.find(p => p.id === 'proxy_mine');
    assert.deepEqual(mine, { id: 'proxy_mine', name: '我的', baseURL: 'https://mine', apiKey: 'k1' });
    // ccs_old is updated with new data
    const old = r.profiles.find(p => p.id === 'ccs_old');
    assert.equal(old.baseURL, 'https://new');
    assert.equal(old.apiKey, 'new-key');
    // ccs_new is appended
    const neu = r.profiles.find(p => p.id === 'ccs_new');
    assert.ok(neu);
    assert.equal(r.imported, 1);
    assert.equal(r.updated, 1);
  });

  it('cc-switch 侧删除的 ccs_ 从列表移除（不保留过期凭证）', () => {
    const existing = [
      { id: 'max', name: 'Default' },
      { id: 'ccs_deleted', name: '已删', baseURL: 'https://d', apiKey: 'dk' },
      { id: 'proxy_keep', name: '保留', baseURL: 'https://k', apiKey: 'kk' },
    ];
    const imported = []; // cc-switch side now has none
    const r = mergeImportedProfiles(existing, imported);
    assert.equal(r.profiles.find(p => p.id === 'ccs_deleted'), undefined);
    assert.ok(r.profiles.find(p => p.id === 'proxy_keep'));
    assert.ok(r.profiles.find(p => p.id === 'max'));
  });

  it('空 existing + 首次导入', () => {
    const imported = [
      { id: 'ccs_a', name: 'A', baseURL: 'https://a', apiKey: 'ka', source: 'cc-switch' },
    ];
    const r = mergeImportedProfiles([], imported);
    assert.equal(r.profiles.length, 1);
    assert.equal(r.imported, 1);
    assert.equal(r.updated, 0);
  });

  it('空 imported 不影响 existing', () => {
    const existing = [
      { id: 'max', name: 'Default' },
      { id: 'proxy_x', name: 'X', baseURL: 'https://x', apiKey: 'k' },
    ];
    const r = mergeImportedProfiles(existing, []);
    assert.equal(r.profiles.length, 2);
    assert.equal(r.imported, 0);
    assert.equal(r.updated, 0);
  });
});

describe('findCcSwitchDbPath', () => {
  it('本机有 db 则返回路径，无则返回 null', () => {
    const p = findCcSwitchDbPath();
    const expected = `${homedir()}/.cc-switch/cc-switch.db`;
    if (existsSync(expected)) {
      assert.equal(p, expected);
    } else {
      assert.equal(p, null);
    }
  });
});

// Integration test: real local cc-switch.db (run only if a *valid* one is present).
// A bare existsSync is not enough — the dev machine may carry a cc-switch.db-shaped
// file (e.g. a different schema, no providers table). The guard below opens it
// read-only with node:sqlite (when available) and confirms the providers table exists.
// Missing file / no node:sqlite / open error / no providers table → skip, not fail.
const realDb = `${homedir()}/.cc-switch/cc-switch.db`;
function hasValidCcSwitchDb() {
  if (!existsSync(realDb)) return false;
  try {
    // node:sqlite ships as ESM; load it synchronously via createRequire so the
    // describe({ skip }) guard stays synchronous. Unavailable on older Node → skip.
    const req = createRequire(import.meta.url);
    let DatabaseSync;
    try { ({ DatabaseSync } = req('node:sqlite')); }
    catch { return false; }
    if (!DatabaseSync) return false;
    const db = new DatabaseSync(realDb, { readOnly: true });
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='providers'").get();
      return !!row;
    } finally {
      try { db.close(); } catch { /* best effort */ }
    }
  } catch {
    return false;
  }
}
const hasRealDb = hasValidCcSwitchDb();
describe('readCcSwitchProviders (integration)', { skip: !hasRealDb }, () => {
  it('从真实 db 读出 claude 供应商并正确映射', async () => {
    const { profiles, error } = await readCcSwitchProviders(realDb);
    assert.equal(error, null);
    assert.ok(Array.isArray(profiles));
    // local machine has at least 1 claude provider (iFlyTek)
    if (profiles.length > 0) {
      const p = profiles[0];
      assert.ok(p.id.startsWith('ccs_'));
      assert.ok(p.baseURL);
      assert.ok(p.apiKey);
      assert.equal(p.source, 'cc-switch');
    }
  });

  it('只读模式不锁定 db（cc-switch 运行时也可读）', async () => {
    // read twice in a row to verify no SQLITE_BUSY error
    const r1 = await readCcSwitchProviders(realDb);
    const r2 = await readCcSwitchProviders(realDb);
    assert.equal(r1.error, null);
    assert.equal(r2.error, null);
  });
});

describe('discoverCcSwitchProviders (integration)', { skip: !hasRealDb }, () => {
  it('完整链路：探测 + 读取', async () => {
    const r = await discoverCcSwitchProviders();
    assert.ok(r.dbPath);
    assert.equal(r.error, null);
    assert.ok(Array.isArray(r.profiles));
  });
});
