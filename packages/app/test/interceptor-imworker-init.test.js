/**
 * interceptor.js — IM worker（CCV_IM_PLATFORM）进程的 v2 写路径。
 *
 * 1.7.0 前 IM worker 有专属 v1 boot 分支（auto-continue 最近日志）且被排除在 v2 写之外；
 * 两者都已随 v1 写路径退役。本文件钉住新的不变量：IM worker 与普通进程一致 ——
 * v2 writer 启用、LOG_FILE 恒空、请求经 fetch hook 正常写入 v2 session。
 *
 * 独立测试文件 = 独立进程；interceptor.js 在保护清单：只测不改。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const logDir = mkdtempSync(join(tmpdir(), 'ccv-imw-init-'));
process.env.CCV_LOG_DIR = logDir;
process.env.CLAUDE_CONFIG_DIR = logDir;
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
process.env.CCV_IM_PLATFORM = 'dingtalk'; // IM worker 模式

const SID = 'aaaa1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

const savedArgv = process.argv.slice();

let mod;
before(async () => {
  // 注意：不能含 --agent-name（否则 _isTeammate=true 走 teammate 分支）
  process.argv = [process.argv[0], process.argv[1]];
  globalThis.fetch = async () => new Response('{"content":[]}', {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  mod = await import('../server/interceptor.js');
  mod.setupInterceptor();
  await mod._initPromise;
});

after(() => {
  process.argv = savedArgv;
  delete process.env.CCV_IM_PLATFORM;
  try { rmSync(logDir, { recursive: true, force: true }); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30).unref();
});

describe('IM worker 初始化（v2-only：与普通进程同一写路径）', () => {
  it('CCV_IM_PLATFORM 进程 v2 writer 启用、LOG_FILE 恒空、无 v1 resume 机器', () => {
    assert.equal(mod.LOG_FILE, '', 'v1 单文件日志已退役，IM worker 不再 continue 最近日志');
    assert.ok(mod._v2Writer.enabled, 'IM worker 的 v2 writer 必须启用（旧 CCV_IM_PLATFORM 排除已移除）');
    assert.equal(mod._resumeState, undefined, 'v1 resume 交互机器已随写路径删除（不再导出）');
  });

  it('IM worker 的请求经 fetch hook 正常写入 v2 session', async () => {
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'im' }], metadata: { user_id: USER_ID } }),
    });
    await mod._v2Writer.flush();
    const project = basename(process.cwd()).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    // Task C: writer names the dir `<ts>_<uuid>`; resolve by UUID suffix.
    const sroot = join(logDir, project, 'sessions');
    const dir = join(sroot, readdirSync(sroot).find((n) => n === SID || n.endsWith('_' + SID)) || SID);
    assert.ok(existsSync(join(dir, 'journal.jsonl')), 'v2 session journal 应已写入');
    assert.equal(mod.getLiveLogSource(), dir, 'live source 指向 IM worker 自己的 v2 session dir');
  });
});
