/**
 * interceptor.js — teammate 进程的条目绝不携带 `_seq`/`_seqEpoch`（读侧反向不变量）。
 *
 * 1.7.0：`_seq` 不再于写盘时产出，而由 v2→v1 adapter 仅对「leader 的 main 会话」
 * 合成（kind==='main' 且无 leader 元数据）。teammate session 的条目在 adapter 视图里
 * 必须带 teammate 字段、且绝不合成 _seq/_seqEpoch —— 否则重建端会把 teammate 与
 * mainAgent 两条语义流混进同一 epoch 比较（§3.7 的同源问题）。
 *
 * _isTeammate 由 process.argv 在模块求值期决定 → 独立测试文件（独立进程），argv 注入
 * 必须先于动态 import。teammate + CCV_PROXY_MODE 组合下模块顶层
 * `(!CCV_PROXY_MODE || _isTeammate)` 为 true → setupInterceptor 自执行，fake fetch
 * 必须在 import 前就位。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全死命令：env/argv 必须先锁好，再动态 import interceptor ████
const logDir = mkdtempSync(join(tmpdir(), 'ccv-seqtm-'));
process.env.CCV_LOG_DIR = logDir;
process.env.CLAUDE_CONFIG_DIR = logDir;
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_SYNC_WRITES = '1';
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;

const workCwd = mkdtempSync(join(tmpdir(), 'ccv-seqtm-proj-'));

const SID = 'bbbb1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

const savedArgv = process.argv.slice();
const savedCwd = process.cwd();

let mod;
let iterateV2RawEntries;
before(async () => {
  // fake fetch 先于 import（teammate 模式 import 即自执行 setupInterceptor）
  globalThis.fetch = async () =>
    new Response('{"content":[{"type":"text","text":"ok"}]}', {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  process.argv = [process.argv[0], process.argv[1], '--agent-name', 'worker-1', '--team-name', 'fix-stuff'];
  process.chdir(workCwd);
  mod = await import('../server/interceptor.js');
  ({ iterateV2RawEntries } = await import('../server/lib/v2/adapter.js'));
});

after(() => {
  process.argv = savedArgv;
  try { process.chdir(savedCwd); } catch { /* noop */ }
  try { rmSync(logDir, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(workCwd, { recursive: true, force: true }); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30).unref(); // 顶层 watchFile 阻止退出
});

function readEntries() {
  const dir = mod.getLiveLogSource();
  if (!dir) return [];
  return [...iterateV2RawEntries(dir)].map(p => JSON.parse(p));
}

describe('interceptor — teammate 条目的 _seq 隔离（adapter 视图）', () => {
  it('teammate 的 mainAgent 双标请求：带 teammate 字段、绝不携带 _seq/_seqEpoch', async () => {
    // mainAgent 形态 body（system 含 You are Claude Code + 12 tools）→ 双标场景
    const tools = ['Edit', 'Bash', 'Task', 'Read', 'Write', 'Glob', 'Grep', 'Agent',
      'WebFetch', 'WebSearch', 'NotebookEdit', 'AskUser'].map(name => ({ name }));
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
        tools,
        model: 'claude-test',
        metadata: { user_id: USER_ID },
        messages: [{ role: 'user', content: 'teammate task' }],
      }),
    });
    await mod._v2Writer.flush();

    const logged = readEntries().filter(e => e.url);
    assert.ok(logged.length > 0, 'teammate 请求应被记录');
    for (const e of logged) {
      assert.equal(e.teammate, 'worker-1', '条目应带 teammate 字段（重建端隔离依据）');
      assert.equal(e.teamName, 'fix-stuff', '条目应带 teamName 字段');
      assert.equal(e._seq, undefined, 'teammate 条目绝不携带 _seq');
      assert.equal(e._seqEpoch, undefined, 'teammate 条目绝不携带 _seqEpoch');
    }
  });
});
