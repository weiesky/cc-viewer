/**
 * GET /events 的 kv-cache / context_window 扫描语义回归（onScan 记忆化 + 单次 parse）。
 *
 * 修复背景：旧 onScan 对全文件每条含 "mainAgent":true 的 raw 做完整 JSON.parse，
 * `-c` 大会话日志含多个巨型 checkpoint 时每次 SSE 连接阻塞 event loop 数秒。
 * 新逻辑只记忆最后一条真实 mainAgent raw（子串过滤 teammate），Pass 1 结束后单次 parse。
 * 本测试锁定语义不变量：发出的 context_window 帧反映"最后一条真实 mainAgent"，
 * 末尾的 teammate 伪 mainAgent 条目不得顶掉它。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 环境隔离必须先于任何 findcc/interceptor 加载（同 api-proxy-profiles.test.js 模式）
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-events-scan-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
// This suite pins the LEGACY /events scan semantics (load_chunk passthrough +
// mainAgentRing-driven kv/context). Wire v3 is default-on since V3.S6 and
// replaces those frames on v2 sources — pin the escape hatch explicitly.
// The v3 path's kv/context coverage lives in test/v3-assembler.test.js.
process.env.CCV_WIRE_V3 = '0';
// 私有高位端口窗,避免与用户真实 ccv 服务(7008-7099)抢端口(2026-06-06 审计 port-clash)。
// server.js 顶层把 CCV_START_PORT/MAX_PORT 冻结为 const,故必须在 import server.js 之前设好(本文件 before() 内动态 import,此处即生效)。
process.env.CCV_START_PORT = '17930';
process.env.CCV_MAX_PORT = '17939';

// 1.7.0：日志存储只有 v2 session dir。测试数据不再手写 v1 .jsonl，而是用生产
// V2Writer 直接 ingest v1-shape entry（与 fetch hook 的调用面完全一致），再由
// /events 经 adapter 合成流读回 —— 覆盖「写 v2 → adapter 读 → SSE」全链路。
const SID_MAIN = '12121212-3434-5656-7878-909090909090';
const SID_TM = '21212121-4343-6565-8787-090909090909';
const uid = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });

function makeMainAgentTools() {
  return [
    { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' },
    { name: 'Read' }, { name: 'Write' }, { name: 'Glob' },
    { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' },
    { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
  ];
}

function mainAgentEntry(ts, inputTokens, sid, messages, extra = {}) {
  return {
    timestamp: ts,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {},
    mainAgent: true,
    duration: 5,
    body: {
      model: 'claude-opus-4-8',
      // 完整 mainAgent 形态（system 含 You are Claude Code + 12 tools）：teammate 条目
      // 的 mainAgent 由 adapter 用 isMainAgentRequest 对回填 body 重算，必须真实成立。
      system: [{ type: 'text', text: 'You are Claude Code' }],
      tools: makeMainAgentTools(),
      metadata: { user_id: uid(sid) },
      messages,
    },
    response: { status: 200, body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
    ...extra,
  };
}

/** 读 SSE 流并解析帧，收到 untilEvents 任一事件或超时即断开返回 */
function collectSSE(port, path, untilEvents, timeoutMs) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const req = request({
      hostname: '127.0.0.1', port, path,
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buf = '';
      const timer = setTimeout(() => { req.destroy(); resolve(frames); }, timeoutMs);
      res.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = { event: 'message', data: '' };
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data += line.slice(6);
            else if (line.startsWith('data:')) ev.data += line.slice(5);
          }
          frames.push(ev);
          if (untilEvents.includes(ev.event)) {
            clearTimeout(timer);
            req.destroy();
            resolve(frames);
            return;
          }
        }
      });
      res.on('error', () => { clearTimeout(timer); resolve(frames); });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /events kv/context scan semantics', { concurrency: false }, () => {
  let port, stopViewer;

  before(async () => {
    // workspace 模式：先 initForWorkspace 绑定项目，再经 v2 writer 预写会话数据
    const interceptor = await import('../packages/app/server/interceptor.js');
    interceptor.initForWorkspace(join(tmpDir, 'scanproj'), { forceNew: true });
    assert.equal(interceptor.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串');

    // (1) leader session：两条真实 mainAgent（经模块自己的 v2 writer 写入，
    //     使 getLiveLogSource() 指向该 session —— /events 的冷加载读源）
    const w = interceptor._v2Writer;
    const m1 = mainAgentEntry('2026-06-06T01:00:00.000Z', 111, SID_MAIN, [{ role: 'user', content: 'hi' }]);
    const m2 = mainAgentEntry('2026-06-06T01:01:00.000Z', 222, SID_MAIN, [ // ← 最后一条真实 mainAgent
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'more' },
    ]);
    for (const e of [m1, m2]) {
      const h = w.ingestRequest(e, null);
      w.ingestCompletion(h, e);
    }
    await w.flush();
    assert.ok(interceptor.getLiveLogSource().endsWith(SID_MAIN), 'live source 应指向 leader session');

    // (2) teammate 伪 mainAgent（teammate 子进程条目也可能双标 mainAgent:true）：
    //     写成 sibling teammate session（meta.leader），adapter 读 leader 时按 §10 re-join。
    //     必须不顶掉上面那条真实 mainAgent。
    const { V2Writer } = await import('../packages/app/server/lib/v2/v2-writer.js');
    const tw = new V2Writer({ logDir: tmpDir, project: 'scanproj', leader: { agentName: 'bob' } });
    const t1 = mainAgentEntry('2026-06-06T01:02:00.000Z', 999, SID_TM,
      [{ role: 'user', content: 'tm task' }], { teammate: 'bob' });
    const th = tw.ingestRequest(t1, null);
    tw.ingestCompletion(th, t1);
    await tw.flush();

    const mod = await import('../packages/app/server/server.js');
    const srv = await mod.startViewer();
    assert.ok(srv, 'server should start');
    stopViewer = mod.stopViewer;
    port = mod.getPort();
    assert.ok(port > 0);
  });

  after(async () => {
    await new Promise((resolve) => {
      stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  it('context_window 帧反映最后一条真实 mainAgent；teammate 伪条目被过滤', async () => {
    const frames = await collectSSE(port, '/events', ['context_window'], 10000);
    const cw = frames.find(f => f.event === 'context_window');
    assert.ok(cw, `必须收到 context_window 帧（实收事件：${frames.map(f => f.event).join(',')}）`);
    const data = JSON.parse(cw.data);
    assert.equal(data.total_input_tokens, 222,
      'context_window 应来自 input_tokens=222 的最后一条真实 mainAgent（999 是 teammate 伪条目）');
  });

  it('load_chunk 仍逐条透传全部 3 条原始条目（记忆化不影响数据流）', async () => {
    const frames = await collectSSE(port, '/events', ['load_end'], 10000);
    const chunks = frames.filter(f => f.event === 'load_chunk');
    assert.equal(chunks.length, 3, '3 条条目各占一个 load_chunk 帧');
    const tokens = chunks.map(c => JSON.parse(c.data)[0].response.body.usage.input_tokens);
    assert.deepEqual(tokens, [111, 222, 999]);
  });

  it('热切换:context_window 窗口档位跟随 response.body.model(权威上游模型)', async () => {
    // 代理热切换语义:body.model 是客户端原始模型(claude-opus-4-8),response.body.model
    // 才是真实上游模型(kimi-k3 → 规则表 256K 档)。getContextSizeForModel 的 entry 路径
    // 必须取后者,且不被启动缓存/请求名带偏。
    const w = (await import('../packages/app/server/interceptor.js'))._v2Writer;
    const hot = mainAgentEntry('2026-06-06T01:03:00.000Z', 333, SID_MAIN,
      [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'hot' }]);
    hot.response.body.model = 'kimi-k3';
    const h = w.ingestRequest(hot, null);
    w.ingestCompletion(h, hot);
    await w.flush();

    const frames = await collectSSE(port, '/events', ['context_window'], 10000);
    const cw = frames.find(f => f.event === 'context_window');
    assert.ok(cw, `必须收到 context_window 帧（实收事件：${frames.map(f => f.event).join(',')}）`);
    const data = JSON.parse(cw.data);
    assert.equal(data.total_input_tokens, 333, 'context_window 应来自最新那条热切换 mainAgent');
    assert.equal(data.context_window_size, 256000,
      '窗口档位应跟随 response.body.model(kimi-k3 → 256K),而非请求名 claude-opus-4-8 的 1M');
  });
});
