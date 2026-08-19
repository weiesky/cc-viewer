/**
 * 按角色分源 — 自定义端点臂（休眠不生效）。
 *
 * 预置 ANTHROPIC_BASE_URL=https://custom.host → CUSTOM_API_HOST='custom.host'（模块加载即冻结），
 * isOfficialDefaultEndpoint() 恒 false → main=Default 时 sub/teammate 的存储分配**生效**。
 * （官方端点臂在 interceptor-profile.test.js：_defaultConfig 实证捕获 api.anthropic.com → 休眠。
 * 两臂必须分文件：env 冻结 + _defaultConfig 每进程只捕一次。）
 *
 * 环境范式同 interceptor-profile.test.js：env 先于动态 import。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
process.env.ANTHROPIC_BASE_URL = 'https://custom.host'; // ← 本文件的使命：自定义 env 端点
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-prole-custom-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const SID = 'bbbb3333-4444-5555-6666-777788889999';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let proxyProfilesGet;
let nextResponse, lastFetchArgs;

function writeProfile(json) {
  mkdirSync(dirname(mod.PROFILE_PATH), { recursive: true });
  writeFileSync(mod.PROFILE_PATH, JSON.stringify(json));
}
async function postJson(url, body, headers = { 'x-api-key': 'kk' }) {
  nextResponse = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  return globalThis.fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

before(async () => {
  globalThis.fetch = async (url, opts) => {
    lastFetchArgs = [url, opts];
    return nextResponse ? nextResponse(url, opts) : new Response('{}', { status: 200 });
  };
  mod = await import('../packages/app/server/interceptor.js');
  const { preferencesRoutes } = await import('../packages/app/server/routes/preferences.js');
  proxyProfilesGet = preferencesRoutes.find((r) => r.path === '/api/proxy-profiles' && r.method === 'GET').handler;
  mod.setupInterceptor();
  await globalThis.fetch('https://custom.host/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'boot' },
    body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }),
  });
  await mod._v2Writer.flush();
});

after(() => {
  try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  mod.setLivePort(null);
  setTimeout(() => process.exit(0), 30).unref();
});

describe('自定义 env 端点：main=Default 时角色分配生效（不休眠）', () => {
  const SUB_BODY = {
    system: [{ type: 'text', text: 'You are Claude Code.\ncc_is_subagent=true' }],
    messages: [], model: 'claude-x',
  };

  it('isOfficialDefaultEndpoint() = false（env 自定义端点）', () => {
    assert.equal(mod.isOfficialDefaultEndpoint(), false);
  });

  it('GET /api/proxy-profiles 回 officialDefault:false（路由接线臂）', async () => {
    writeProfile({ profiles: [{ id: 'max', name: 'Default' }] });
    const res = {};
    res.writeHead = (code) => { res.statusCode = code; };
    res.end = (b) => { res.body = b || ''; res.done && res.done(); };
    await new Promise((resolve) => {
      res.done = resolve;
      proxyProfilesGet({ headers: {} }, res, { pathname: '/api/proxy-profiles' }, true, {
        maskApiKey: (k) => k, maskProfiles: (d) => d, isMasked: () => false,
        defaultProxyProfiles: { profiles: [{ id: 'max', name: 'Default' }] },
        clients: [],
      });
    });
    const data = JSON.parse(res.body);
    assert.equal(data.officialDefault, false, '自定义 env 端点 → GET 下发 officialDefault:false');
    assert.deepEqual(data.roles, { subagent: 'follow', teammate: 'follow' });
  });

  it('main=Default + sub 显式分配 → sub 标记请求改写到子源', async () => {
    writeProfile({ active: 'max', profiles: [
      { id: 'max', name: 'Default' },
      { id: 'sub1', name: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'sk-sub' },
    ] });
    mod.setActiveProfileForWorkspace('max', { subagent: 'sub1', teammate: 'follow' });
    assert.equal(mod._activeProfile, null, 'main=Default 不改写');
    const rp = mod.getProxyRoleProfiles();
    assert.equal(rp.main, null);
    assert.equal(rp.subagent?.name, 'Sub', '自定义端点 → 子分配不休眠');

    await postJson('https://custom.host/v1/messages', SUB_BODY);
    assert.equal(lastFetchArgs[0], 'https://sub.example.com/v1/messages', '子请求改写到子源');
    assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-sub');
  });

  it('main=Default 的主请求：不改写（Default = 透传到 env 端点）', async () => {
    writeProfile({ active: 'max', profiles: [
      { id: 'max', name: 'Default' },
      { id: 'sub1', name: 'Sub', baseURL: 'https://sub.example.com', apiKey: 'sk-sub' },
    ] });
    mod.setActiveProfileForWorkspace('max', { subagent: 'sub1', teammate: 'follow' });
    await postJson('https://custom.host/v1/messages', { model: 'claude-x', messages: [] });
    assert.equal(lastFetchArgs[0], 'https://custom.host/v1/messages', 'main=Default → 原样透传');
  });
});
