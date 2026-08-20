/**
 * interceptor.js — 顺序不变量的生产端（1.7.0 v2-only）。
 *
 * v1 的 `_seq` 写盘生产端已随 v1 写路径退役；幸存的顺序轴是 v2 journal 的 `seq`：
 *   1. journal req 行的 seq 在 fetch hook 的【同步】发起段内分配 —— 并发发起也
 *      严格按发起序 +1 递增（§3.7 守卫：发起序永不与落盘序背离）
 *   2. adapter 合成视图对 main 会话条目回填 `_seq`（=journal seq）与稳定
 *      `_seqEpoch`（'v2:<sid>'），完成序倒置守卫的语义得以保留
 *   3. in-flight placeholder 与 completed 是同一请求的两个相位，共享同一 _seq
 *   4. 非 mainAgent 条目不合成 _seq/_seqEpoch
 *
 * harness 复用 interceptor-fetch.test.js 的策略：env → 动态 import → setupInterceptor。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全死命令：env 必须先锁到进程私有临时目录，再动态 import interceptor ████
// 严禁把 ../server/interceptor.js 改成顶层静态 import。
process.env.CCV_PROXY_MODE = '1';      // 跳过模块自执行 setupInterceptor
process.env.CCV_SYNC_WRITES = '1';     // 同步写盘，便于读取断言
delete process.env.CCV_WORKSPACE_MODE;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-seqprod-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const SID = 'cccc1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let iterateV2RawEntries;

function sessionDir() {
  const project = basename(process.cwd()).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  // Task C: writer names the dir `<ts>_<uuid>`; resolve by UUID suffix.
  const sroot = join(__isoDir, project, 'sessions');
  let name = SID;
  try { name = readdirSync(sroot).find((n) => n === SID || n.endsWith('_' + SID)) || SID; } catch { /* not created yet */ }
  return join(sroot, name);
}

function readEntries() {
  const dir = mod.getLiveLogSource();
  if (!dir) return [];
  return [...iterateV2RawEntries(dir)].map(p => JSON.parse(p));
}

function readJournalReqs() {
  return readFileSync(join(sessionDir(), 'journal.jsonl'), 'utf-8')
    .trim().split('\n').map(l => JSON.parse(l)).filter(l => l.ph === 'req');
}

function makeMainAgentTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' },
    { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}
function mainAgentBody(messages, extra = {}) {
  return {
    system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
    tools: makeMainAgentTools(),
    model: 'claude-test',
    metadata: { user_id: USER_ID },
    messages,
    ...extra,
  };
}

async function fireMainAgent(messages) {
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    body: JSON.stringify(mainAgentBody(messages)),
  });
}

let nextResponse = null; // () => Response：为下一次上游 fetch 注入返回

before(async () => {
  globalThis.fetch = async () =>
    nextResponse ? nextResponse() : new Response('{"content":[{"type":"text","text":"ok"}]}', {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  mod = await import('../server/interceptor.js');
  ({ iterateV2RawEntries } = await import('../server/lib/v2/adapter.js'));
  mod.setupInterceptor();
  assert.equal(mod.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串');
});

after(() => {
  // 顶层 watchFile(PROFILE_PATH) 会阻止进程退出，强制终止
  setTimeout(() => process.exit(0), 30).unref();
});

describe('interceptor — v2 journal seq / adapter _seq 生产端不变量', () => {
  it('journal seq 在同步发起段分配：并发发起也按发起序严格 +1 递增', async () => {
    // 三个 fetch 连续【同步】发起（不等待彼此）：ingestRequest 在 hook 的同步段执行，
    // seq 必须按发起序分配，与完成序无关。
    const p1 = fireMainAgent([{ role: 'user', content: 'q1' }]);
    const p2 = fireMainAgent([
      { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    const p3 = fireMainAgent([
      { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q3' },
    ]);
    await Promise.all([p1, p2, p3]);
    await mod._v2Writer.flush();

    const reqs = readJournalReqs();
    assert.equal(reqs.length, 3, '应有 3 条 journal req 行');
    for (let i = 0; i < reqs.length; i++) {
      assert.equal(reqs[i].seq, i + 1, `journal seq 严格按发起序 +1（第 ${i + 1} 条）`);
    }
    // 发起序 = 文件序 = msgTo 递增序（后发起的 wire 更长）
    assert.deepEqual(reqs.map(r => r.msgTo), [1, 3, 5], 'journal 行序与发起序一致');
  });

  it('adapter 视图：mainAgent completed 条目 _seq 单调、_seqEpoch 稳定为 v2:<sid>', () => {
    const completed = readEntries().filter(e => e.mainAgent && !e.inProgress);
    assert.equal(completed.length, 3, '应有 3 条 completed mainAgent 条目');

    const seqs = completed.map(e => e._seq);
    assert.ok(seqs.every(s => typeof s === 'number'), '每条 mainAgent 条目都应带数值 _seq');
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `_seq 必须严格递增（${seqs[i - 1]} → ${seqs[i]}）`);
    }

    const epochs = new Set(completed.map(e => e._seqEpoch));
    assert.equal(epochs.size, 1, '同一 session 所有条目必须共享同一 _seqEpoch');
    assert.equal([...epochs][0], `v2:${SID}`, '_seqEpoch 是 v2 session 标识 token');
  });

  it('placeholder 与 completed 共享同一 _seq（同一请求的两个相位）', async () => {
    // 流式响应：completion 在上游流结束之前不会 ingest → 期间 adapter 视图
    // 把该请求合成为 inProgress placeholder。流结束后同一 seq 变为 completed。
    // 上游 reader 用 gate 卡住第一次 read（拦截器的捕获循环是 eager 的，内存
    // Response 会瞬间读完 —— 必须真正阻塞上游才能观察到 in-flight 相位）。
    const sse = 'data: {"type":"message_start","message":{"id":"s1","role":"assistant","model":"m","content":[]}}\n\n'
      + 'data: {"type":"message_stop"}\n\n';
    let release;
    const gate = new Promise(r => { release = r; });
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: {
        getReader() {
          let phase = 0;
          return {
            read: async () => {
              phase++;
              if (phase === 1) { await gate; return { done: false, value: new TextEncoder().encode(sse) }; }
              return { done: true, value: undefined };
            },
          };
        },
      },
    });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify(mainAgentBody([
        { role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' }, { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'q3' }, { role: 'assistant', content: 'a3' },
        { role: 'user', content: 'q4' },
      ], { stream: true })),
    });
    nextResponse = null;
    // 给拦截器的捕获循环一个 tick 进入第一次 read（阻塞在 gate 上）
    await new Promise(r => setTimeout(r, 20));
    await mod._v2Writer.flush();

    // 上游流未结束 → journal 只有 req 行 → adapter 呈现 inProgress placeholder
    const placeholder = readEntries().find(e => e.inProgress && e.mainAgent);
    assert.ok(placeholder, '应合成 inProgress placeholder');
    assert.equal(typeof placeholder._seq, 'number');
    const seq = placeholder._seq;
    const epoch = placeholder._seqEpoch;

    // 放行上游并消费返回流 → completion ingest → 同一 seq 变 completed
    release();
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    await mod._v2Writer.flush();
    const entries = readEntries();
    assert.ok(!entries.some(e => e.inProgress && e._seq === seq), '完成后不再呈现 placeholder 相位');
    const completed = entries.find(e => !e.inProgress && e._seq === seq);
    assert.ok(completed, 'placeholder 与 completed 必须共享同一 _seq（同一请求）');
    assert.equal(completed._seqEpoch, epoch);
  });

  it('非 mainAgent 请求不合成 _seq/_seqEpoch', async () => {
    const before = readEntries().length;
    // 无 Claude Code system/tools 特征 → isMainAgentRequest=false
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'sub' }] }),
    });
    await mod._v2Writer.flush();
    const entries = readEntries().slice(before);
    assert.ok(entries.length > 0, '非 mainAgent 请求仍应被记录');
    for (const e of entries) {
      assert.equal(e._seq, undefined, '非 mainAgent 条目不得携带 _seq');
      assert.equal(e._seqEpoch, undefined, '非 mainAgent 条目不得携带 _seqEpoch');
    }
  });
});
