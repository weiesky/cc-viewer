/**
 * L5 测试隔离铁闸单测 — server/lib/updater.js checkAndUpdate() 的测试态网络闸。
 *
 * 背景(2026-06-06 数据事故防再犯):起真实 server 的测试,启动链 30s 定时器会调
 * checkAndUpdate() → 真打 registry.npmjs.org,同大版本空闲时甚至 detached `npm install`
 * 真实自更新。L5 语义:测试态(NODE_TEST_CONTEXT 或 NODE_ENV=test)且未注入 fetchImpl
 * → 在 disabled/skipped 早退之后、真实 fetch 之前返回 skipped_test_context,零网络。
 *
 * 隔离:CACHE_FILE / CC_SETTINGS_FILE 在 updater 模块加载期由 env 计算,本文件在
 * 【import 之前】设私有 CLAUDE_CONFIG_DIR / CCV_LOG_DIR,全程不触真实用户路径。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const UPDATER_URL = pathToFileURL(join(REPO_ROOT, 'packages', 'app', 'server', 'lib', 'updater.js')).href;

// 私有目录必须在 import updater 之前就位:settings 缺失 → 自动更新默认启用;
// cache 缺失 → shouldCheck() 为真。两者共同保证调用能走到 L5 闸(而非提前 disabled/skipped)。
const tmpCfg = mkdtempSync(join(tmpdir(), 'ccv-l5-cfg-'));
const tmpLog = mkdtempSync(join(tmpdir(), 'ccv-l5-log-'));
process.env.CLAUDE_CONFIG_DIR = tmpCfg;
process.env.CCV_LOG_DIR = tmpLog;
delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; // 否则 isAutoUpdateEnabled 早退,测不到闸

const { checkAndUpdate } = await import('../packages/app/server/lib/updater.js');

const _origFetch = globalThis.fetch;
after(() => {
  if (_origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = _origFetch;
  for (const d of [tmpCfg, tmpLog]) { try { rmSync(d, { recursive: true, force: true }); } catch { } }
});

describe('updater L5 铁闸(测试态零真实网络)', () => {
  it('NODE_TEST_CONTEXT 下无 fetchImpl → skipped_test_context 且零 fetch 调用(双重断言)', async () => {
    assert.ok(process.env.NODE_TEST_CONTEXT, '前提:node:test 注入 NODE_TEST_CONTEXT');
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('L5 闸失效:真实网络被触发'); };
    try {
      const r = await checkAndUpdate({ brewPrefix: null });
      assert.equal(r.status, 'skipped_test_context');
      assert.equal(calls, 0, '毒化 fetch 计数必须为 0(闸在 fetch 之前返回)');
    } finally {
      if (_origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = _origFetch;
    }
  });

  it('对照:注入 fetchImpl 时闸不触发,走正常逻辑(latest)', async () => {
    let injectedCalls = 0;
    const r = await checkAndUpdate({
      brewPrefix: null,
      fetchImpl: async () => {
        injectedCalls++;
        const { version } = JSON.parse(
          // 用真实 package.json 的版本充当 remote latest → 必然走 latest 分支
          (await import('node:fs')).readFileSync(join(REPO_ROOT, 'packages', 'app', 'package.json'), 'utf-8'),
        );
        return { ok: true, json: async () => ({ 'dist-tags': { latest: version } }) };
      },
    });
    assert.equal(injectedCalls, 1, '注入的 fetchImpl 应被调用');
    assert.equal(r.status, 'latest');
    assert.notEqual(r.status, 'skipped_test_context');
  });

  it('孙进程兜底:无 NODE_TEST_CONTEXT 但 NODE_ENV=test → 闸仍生效(spawnSync 孙进程场景)', () => {
    const cfg2 = mkdtempSync(join(tmpdir(), 'ccv-l5-sub-cfg-'));
    const log2 = mkdtempSync(join(tmpdir(), 'ccv-l5-sub-log-'));
    const env = { ...process.env, NODE_ENV: 'test', CLAUDE_CONFIG_DIR: cfg2, CCV_LOG_DIR: log2 };
    delete env.NODE_TEST_CONTEXT;                          // 模拟跨代丢失
    delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;   // 不靠总开关,单测闸本体
    try {
      const out = execFileSync(process.execPath, ['-e', [
        // 子进程内先毒化全局 fetch(闸失效会打印 FETCH_CALLED 并异常退出),再 canonical import
        "globalThis.fetch = () => { console.log('FETCH_CALLED'); process.exit(7); };",
        `import(${JSON.stringify(UPDATER_URL)})`,
        "  .then(m => m.checkAndUpdate({ brewPrefix: null }))",
        "  .then(r => console.log('STATUS=' + r.status))",
        "  .catch(e => { console.error(e); process.exit(1); });",
      ].join('\n')], { env, encoding: 'utf-8', timeout: 30000 });
      assert.ok(!out.includes('FETCH_CALLED'), '孙进程不得触发任何 fetch:\n' + out);
      assert.match(out, /STATUS=skipped_test_context/, '孙进程应被 NODE_ENV=test 兜底拦截:\n' + out);
    } finally {
      for (const d of [cfg2, log2]) { try { rmSync(d, { recursive: true, force: true }); } catch { } }
    }
  });
});
