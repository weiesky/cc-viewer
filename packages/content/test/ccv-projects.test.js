// server/imSkills/scripts/ccv-projects.mjs 的纯逻辑单测（CLI 入口已被 isMainModule 守卫，import 不会触发）。
// I/O 部分（http 探测 / spawn 启动）依赖真实实例，不在单测覆盖；这里测可纯粹验证的部分。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { logDir, loadWorkspaces, normDir, cleanEnv, adaptiveUrl } from '../server/imSkills/scripts/ccv-projects.mjs';

describe('adaptiveUrl', () => {
  it('开了密码登录 → 去掉 ?token=（回裸地址）', () => {
    assert.equal(adaptiveUrl('http://192.168.1.5:7008?token=abc', true), 'http://192.168.1.5:7008');
  });
  it('没开密码 → 原样带 token', () => {
    assert.equal(adaptiveUrl('http://192.168.1.5:7008?token=abc', false), 'http://192.168.1.5:7008?token=abc');
  });
  it('无 query 时即便开密码也原样', () => {
    assert.equal(adaptiveUrl('http://192.168.1.5:7008', true), 'http://192.168.1.5:7008');
  });
  it('空值安全', () => {
    assert.equal(adaptiveUrl(null, true), null);
    assert.equal(adaptiveUrl('', false), '');
  });
});

describe('cleanEnv', () => {
  const saved = {};
  const keys = ['CCV_LOG_DIR', 'CCV_HOST', 'CCV_IM_PLATFORM', 'CCV_IM_DENY', 'CCV_START_PORT', 'CCV_BASE_PATH', 'CCV_USE_PASSWORD'];
  beforeEach(() => { for (const k of keys) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it('丢掉所有 CCV_*（含 BASE_PATH / USE_PASSWORD），只留 CCV_LOG_DIR', () => {
    process.env.CCV_LOG_DIR = '/tmp/ccv-log';
    process.env.CCV_HOST = '127.0.0.1';
    process.env.CCV_IM_PLATFORM = 'dingtalk';
    process.env.CCV_IM_DENY = '1';
    process.env.CCV_START_PORT = '7050';
    process.env.CCV_BASE_PATH = '/sub';
    process.env.CCV_USE_PASSWORD = '1';
    const env = cleanEnv();
    assert.equal(env.CCV_LOG_DIR, '/tmp/ccv-log'); // 保留
    for (const k of ['CCV_HOST', 'CCV_IM_PLATFORM', 'CCV_IM_DENY', 'CCV_START_PORT', 'CCV_BASE_PATH', 'CCV_USE_PASSWORD']) {
      assert.equal(env[k], undefined, `${k} 应被清掉`);
    }
    assert.ok('PATH' in env || 'Path' in env); // 非 CCV_* 变量保留（PATH 用于找到 ccv）
  });
});

describe('logDir', () => {
  const saved = {};
  const keys = ['CCV_LOG_DIR', 'CLAUDE_CONFIG_DIR'];
  beforeEach(() => { for (const k of keys) saved[k] = process.env[k]; });
  afterEach(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it('CCV_LOG_DIR 显式路径优先', () => {
    process.env.CCV_LOG_DIR = '/var/data/ccv';
    assert.equal(logDir(), resolve('/var/data/ccv'));
  });
  it('未设时回退 (CLAUDE_CONFIG_DIR||~/.claude)/cc-viewer', () => {
    delete process.env.CCV_LOG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(logDir(), join(homedir(), '.claude', 'cc-viewer'));
    process.env.CLAUDE_CONFIG_DIR = '/custom/cfg';
    assert.equal(logDir(), join('/custom/cfg', 'cc-viewer'));
  });
});

describe('loadWorkspaces', () => {
  let dir;
  const saved = {};
  beforeEach(() => {
    saved.CCV_LOG_DIR = process.env.CCV_LOG_DIR;
    dir = mkdtempSync(join(tmpdir(), 'ccv-ws-'));
    process.env.CCV_LOG_DIR = dir; // logDir() → 该目录
  });
  afterEach(() => {
    if (saved.CCV_LOG_DIR === undefined) delete process.env.CCV_LOG_DIR; else process.env.CCV_LOG_DIR = saved.CCV_LOG_DIR;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('读取合法 workspaces.json', () => {
    writeFileSync(join(dir, 'workspaces.json'), JSON.stringify({ workspaces: [{ path: '/a' }, { path: '/b' }] }));
    assert.equal(loadWorkspaces().length, 2);
  });
  it('非法 JSON → []', () => {
    writeFileSync(join(dir, 'workspaces.json'), '{ not json');
    assert.deepEqual(loadWorkspaces(), []);
  });
  it('文件缺失 → []', () => {
    assert.deepEqual(loadWorkspaces(), []);
  });
  it('workspaces 非数组 → []', () => {
    writeFileSync(join(dir, 'workspaces.json'), JSON.stringify({ workspaces: 'oops' }));
    assert.deepEqual(loadWorkspaces(), []);
  });
});

describe('normDir', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-nd-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('已存在目录 → realpath（Windows 小写）', () => {
    const expect = process.platform === 'win32' ? realpathSync(dir).toLowerCase() : realpathSync(dir);
    assert.equal(normDir(dir), expect);
  });
  it('不存在路径 → resolve 兜底，不抛错', () => {
    const p = join(dir, 'nope', 'deeper');
    const expect = process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
    assert.equal(normDir(p), expect);
  });
});
