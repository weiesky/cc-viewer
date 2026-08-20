/**
 * interceptor.js — globalThis.fetch hook 行为测试（覆盖 setupInterceptor 主体 485-1069）。
 *
 * 策略：
 *   - 顶层设 CCV_PROXY_MODE=1 跳过模块自执行的 setupInterceptor()，
 *     再在测试里手动 import + 调 setupInterceptor()，从而完整驱动 fetch 拦截链。
 *   - 用一个返回固定 Response 的 fake fetch 占位 globalThis.fetch；setupInterceptor() 会把它
 *     包成 _originalFetch 并安装拦截 wrapper。我们通过 globalThis.fetch(...) 触发整条链路。
 *   - CCV_SYNC_WRITES=1 让 v2 写队列走 appendFileSync，写盘后可立即经 adapter 读回断言。
 *   - 1.7.0：写盘只走 v2 session dir（LOG_FILE 恒空）。读回断言统一走
 *     iterateV2RawEntries(getLiveLogSource())（v2→v1 adapter 合成视图）。session 由请求
 *     body 的 metadata.user_id(session_id) 决定 —— before() 先发一条带 SID 的引导请求
 *     建立 _currentSid，之后不带 metadata 的请求按 §8.3 回落路由到同一 session。
 *
 * 注意：所有 env / import 顺序敏感——env 必须在 import('../server/interceptor.js') 之前设好。
 * 该文件不修改任何源码，仅 pin 当前工作区行为。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全死命令(2026-06-06 事故:测试五次删用户真实 ~/.claude 数据)████
// ESM 静态 import 会被 hoist,先于本文件任何语句执行 —— 因此【必须】先锁死
// CCV_LOG_DIR / CLAUDE_CONFIG_DIR 到进程私有临时目录,再让项目模块(interceptor)
// 通过 before() 里的【动态】import 读取这些 env。顺序绝不能反:env→动态 import。
// 严禁把 ../server/interceptor.js 改成顶层静态 import。
process.env.CCV_PROXY_MODE = '1';      // 跳过模块顶层 setupInterceptor 自执行
process.env.CCV_SYNC_WRITES = '1';     // 同步写盘，便于读取断言
delete process.env.CCV_WORKSPACE_MODE; // 走普通（非 workspace）初始化，自动生成 LOG_FILE
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-itcfetch-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

// 本文件的固定 v2 session（引导请求携带；后续无 metadata 请求 §8.3 回落到它）
const SID = 'dddd1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let iterateV2RawEntries;
let nextResponse;   // () => Response：每个 test 注入下一次 _originalFetch 的返回
let lastFetchArgs;  // 记录上游真实收到的 [url, opts]

/** 经 v2→v1 adapter 读取当前 session 的合成 entry 数组（seq 序） */
function readEntries() {
  const dir = mod.getLiveLogSource();
  if (!dir) return [];
  return [...iterateV2RawEntries(dir)].map(p => JSON.parse(p));
}

/** 拿到「已完成」（无 inProgress 标记）的最后一条 entry */
function lastCompleted() {
  const entries = readEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!entries[i].inProgress) return entries[i];
  }
  return null;
}

/**
 * 轮询等待 cond() 为真，替代固定 sleep。每 10ms 查一次，超 timeoutMs 抛 timeout。
 * 用于等 fire-and-forget HTTP POST 落到本地 mock server 这类真实异步完成
 * （非节流计时），固定 sleep 在全量+c8 高负载下会假失败。
 */
async function waitUntil(cond, timeoutMs = 2000, label = 'condition') {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil timeout after ${timeoutMs}ms: ${label}`);
    }
    await new Promise(r => setTimeout(r, 10));
  }
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
    metadata: { user_id: USER_ID },
    messages,
    ...extra,
  };
}

before(async () => {
  // 占位 fetch：被 setupInterceptor 捕获为 _originalFetch
  globalThis.fetch = async (url, opts) => {
    lastFetchArgs = [url, opts];
    return nextResponse ? nextResponse(url, opts) : new Response('{}', { status: 200 });
  };
  mod = await import('../server/interceptor.js');
  ({ iterateV2RawEntries } = await import('../server/lib/v2/adapter.js'));
  mod.setupInterceptor();
  assert.equal(mod.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串（v1 写路径已退役）');
  // 引导请求：携带 SID 建立 _currentSid，让后续无 metadata 请求路由到同一 session。
  // 用 x-api-key 头 → _defaultConfig 捕获 authType='API Key'（下方用例断言此值）。
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'kkk' },
    body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }),
  });
  await mod._v2Writer.flush();
  assert.ok(mod.getLiveLogSource().endsWith(SID), '引导请求应建立本文件的固定 v2 session');
});

after(() => {
  mod.setLivePort(null);
  // 顶层 watchFile(PROFILE_PATH) 会阻止进程退出，强制终止（不影响 --test-force-exit）
  setTimeout(() => process.exit(0), 30).unref();
});

describe('interceptor fetch hook — 基础透传 / 过滤', () => {
  it('内部请求（x-cc-viewer-internal）直接透传，不记录', () => {
    const before = readEntries().length;
    nextResponse = () => new Response('{"x":1}', { status: 200 });
    return globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-cc-viewer-internal': '1' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    }).then(res => {
      assert.equal(res.status, 200);
      assert.equal(readEntries().length, before, '内部请求不应新增日志条目');
    });
  });

  it('非 Anthropic / 非 claude URL 不被拦截记录', () => {
    const before = readEntries().length;
    nextResponse = () => new Response('ok', { status: 200 });
    return globalThis.fetch('https://example.com/unrelated/path', {
      method: 'GET',
    }).then(() => {
      assert.equal(readEntries().length, before, '无关 URL 不记录');
    });
  });

  it('x-cc-viewer-trace 标记请求被记录，且该 header 在转发前被删除', async () => {
    nextResponse = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    const opts = {
      method: 'POST',
      headers: { 'x-cc-viewer-trace': 'true', 'x-api-key': 'kkk' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    };
    await globalThis.fetch('https://upstream.local/proxy/v1/messages', opts);
    // 转发给上游时 trace header 已删
    assert.equal(lastFetchArgs[1].headers['x-cc-viewer-trace'], undefined);
    const entry = lastCompleted();
    assert.equal(entry.url, 'https://upstream.local/proxy/v1/messages');
  });
});

describe('interceptor fetch hook — 凭证缓存与脱敏', () => {
  it('缓存仅一次：后续 x-api-key 不覆盖（once-only 守卫）；日志仍逐条脱敏', async () => {
    // 前面 trace 测试已发过 x-api-key='kkk'，_cachedApiKey 已锁定为首个值，后续不覆盖
    const firstCachedKey = mod._cachedApiKey;
    assert.ok(firstCachedKey, '应已缓存首个 x-api-key');
    nextResponse = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-1234567890abcdef', authorization: 'Bearer tok-1234567890abcdef' },
      body: JSON.stringify({ model: 'claude-test', messages: [] }),
    });
    // once-only：缓存未被新值覆盖
    assert.equal(mod._cachedApiKey, firstCachedKey, '_cachedApiKey 一次性缓存，不被覆盖');
    assert.equal(mod._cachedAuthHeader, 'Bearer tok-1234567890abcdef', 'authorization 首次出现，被缓存');
    // 日志脱敏：长 key → 前 8 + **** + 后 4（逐条独立脱敏，与缓存无关）
    const entry = lastCompleted();
    assert.equal(entry.headers['x-api-key'], 'sk-12345****cdef');
    assert.equal(entry.headers['authorization'], 'Bearer tok-1234****cdef');
  });

  it('短 token 脱敏为 ****（不足 12 字符）', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'short', authorization: 'NoSpaceToken' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const entry = lastCompleted();
    assert.equal(entry.headers['x-api-key'], '****');
    // authorization 无空格 → 整体 ****
    assert.equal(entry.headers['authorization'], '****');
  });

  it('_defaultConfig 仅在首个请求捕获一次（authType=API Key）', () => {
    // 前面已发过带 x-api-key 的请求，_defaultConfig 应已锁定
    assert.ok(mod._defaultConfig, '_defaultConfig 应已捕获');
    assert.equal(typeof mod._defaultConfig.origin, 'string');
    assert.equal(mod._defaultConfig.authType, 'API Key');
  });
});

describe('interceptor fetch hook — mainAgent 模型缓存', () => {
  it('mainAgent 请求缓存 model；haiku 模型额外缓存到 _cachedHaikuModel', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'kk' },
      body: JSON.stringify(mainAgentBody([{ role: 'user', content: 'hi' }], { model: 'claude-3-5-haiku-test' })),
    });
    assert.equal(mod._cachedModel, 'claude-3-5-haiku-test');
    assert.equal(mod._cachedHaikuModel, 'claude-3-5-haiku-test');
  });
});

describe('interceptor fetch hook — 请求分类标记', () => {
  it('count_tokens 请求 isCountTokens=true', async () => {
    nextResponse = () => new Response('{"input_tokens":3}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const entry = lastCompleted();
    assert.equal(entry.isCountTokens, true);
    assert.equal(entry.isHeartbeat, false);
    assert.equal(entry.mainAgent, false);
  });

  it('heartbeat /api/eval/sdk- 请求 isHeartbeat=true', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://statsig.anthropic.com/api/eval/sdk-abc', {
      method: 'POST',
      headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({}),
    });
    const entry = lastCompleted();
    assert.equal(entry.isHeartbeat, true);
  });

  it('非 JSON body 请求仍被记录为完成条目（v2 不持久化原始字符串 body）', async () => {
    // v1 曾把非法 JSON body 截断成 500 字符字符串写盘；v2 journal 只记录结构化
    // 字段（url/method/headers/model/conv 切片），原始字符串 body 不再落盘。
    // 幸存的不变量：这类请求仍产生一条 completed 条目，且不携带 messages。
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const before = readEntries().filter(e => !e.inProgress).length;
    const longBody = 'x'.repeat(800); // 非法 JSON
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'kk' },
      body: longBody,
    });
    const completed = readEntries().filter(e => !e.inProgress);
    assert.equal(completed.length, before + 1, '非 JSON body 请求仍应记录一条完成条目');
    const entry = completed[completed.length - 1];
    assert.equal(entry.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(entry.body.messages, undefined, '无可解析 messages → 条目不携带会话切片');
  });
});

describe('interceptor fetch hook — 非流式响应捕获', () => {
  it('JSON 响应被解析进 response.body，含 status/headers', async () => {
    nextResponse = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }), {
      status: 201, statusText: 'Created', headers: { 'content-type': 'application/json', 'x-foo': 'bar' },
    });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const entry = lastCompleted();
    // v2 journal done 行记录 http status；responses.jsonl 记录 headers/body。
    // statusText 不再持久化（v2 有意收窄——status 数字已足够）。
    assert.equal(entry.response.status, 201);
    assert.equal(entry.response.headers['x-foo'], 'bar');
    assert.deepEqual(entry.response.body, { content: [{ type: 'text', text: 'hi' }] });
    assert.ok(typeof entry.duration === 'number');
  });

  it('非 JSON 响应体 → 截断为字符串（前 1000 字符）', async () => {
    const big = 'y'.repeat(1500);
    nextResponse = () => new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const entry = lastCompleted();
    assert.equal(typeof entry.response.body, 'string');
    assert.equal(entry.response.body.length, 1000);
  });

  it('上游 fetch 抛错 → 拦截器向上抛出（不吞）', async () => {
    nextResponse = () => { throw new Error('network down'); };
    await assert.rejects(
      () => globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': 'kk' }, body: JSON.stringify({ model: 'm', messages: [] }),
      }),
      /network down/,
    );
  });
});

describe('interceptor fetch hook — 流式响应捕获与 SSE 组装', () => {
  function sseResponse(blocks) {
    const text = blocks.map(b => `data: ${JSON.stringify(b)}`).join('\n\n') + '\n\n';
    return new Response(text, { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });
  }

  it('组装 text_delta 流为完整 message 对象', async () => {
    nextResponse = () => sseResponse([
      { type: 'message_start', message: { id: 'msg_s1', role: 'assistant', model: 'm' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]);
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    // 必须真正消费返回流，触发 ReadableStream start() 的写盘
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let passthrough = '';
    while (true) { const { done, value } = await reader.read(); if (done) break; passthrough += dec.decode(value, { stream: true }); }
    // 透传内容应是原始 SSE（拦截器不改下游 bytes）
    assert.ok(passthrough.includes('message_start'));
    const entry = lastCompleted();
    assert.equal(entry.isStream, true);
    assert.equal(entry.response.body.id, 'msg_s1');
    assert.equal(entry.response.body.content[0].text, 'Hello');
    assert.equal(entry.response.body.stop_reason, 'end_turn');
    // 流结束后 streamingState 被重置
    assert.equal(mod.streamingState.active, false);
  });

  it('非标准 SSE（无法组装）→ response.body 回退为原始流内容', async () => {
    // 单个 data 块但非 message_start 开头 → assembleStreamMessage 返回 null → 用 fullContent
    nextResponse = () => new Response('data: {"type":"ping"}\n\n', {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    const entry = lastCompleted();
    // 组装失败 → body 是原始字符串
    assert.equal(typeof entry.response.body, 'string');
    assert.ok(entry.response.body.includes('ping'));
  });

  it('上游流式 fetch 抛错 → resetStreamingState + 向上抛', async () => {
    nextResponse = () => { throw new Error('stream connect fail'); };
    await assert.rejects(
      () => globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': 'kk' },
        body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
      }),
      /stream connect fail/,
    );
    assert.equal(mod.streamingState.active, false);
  });
});

describe('interceptor fetch hook — Headers 实例形态', () => {
  it('options.headers 为 Headers 实例时正确转普通对象记录', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const h = new Headers();
    h.set('x-api-key', 'sk-headersinstance123');
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: h, body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const entry = lastCompleted();
    // 记录里是脱敏后的字符串
    assert.equal(entry.headers['x-api-key'], 'sk-heade****e123');
  });
});

describe('interceptor fetch hook — 流式响应捕获失败兜底', () => {
  it('response.body 为 null → getReader 抛错 → 走 capture failed 兜底分支', async () => {
    // 一个 isStream 请求但响应没有可读 body（response.body === null）
    nextResponse = () => new Response(null, { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'kk' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    // 拦截器返回的是原始 response（capture failed 分支不替换 stream，直接 fallthrough return response）
    assert.equal(res.status, 200);
    const entry = lastCompleted();
    assert.equal(entry.isStream, true);
    assert.equal(entry.response.body, '[Streaming Response - Capture failed]');
    assert.equal(mod.streamingState.active, false);
  });
});

describe('interceptor fetch hook — live-streaming（mainAgent + _livePort）', () => {
  let liveServer, livePort;
  const received = [];

  before(async () => {
    liveServer = createServer((req, res) => {
      let buf = '';
      req.on('data', c => { buf += c; });
      req.on('end', () => {
        try { received.push({ path: req.url, body: JSON.parse(buf || '{}') }); } catch { received.push({ path: req.url, body: null }); }
        res.writeHead(204); res.end();
      });
    });
    await new Promise(r => liveServer.listen(0, '127.0.0.1', r));
    livePort = liveServer.address().port;
  });

  after(async () => {
    mod.setLivePort(null);
    await new Promise(r => liveServer.close(r));
  });

  function makeMainAgentTools() {
    return [
      { name: 'Edit' }, { name: 'Bash' }, { name: 'Task' }, { name: 'Read' },
      { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }, { name: 'Agent' },
      { name: 'WebFetch' }, { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' },
    ];
  }

  it('mainAgent 流式请求：skeleton + 增量 chunk 经 /api/stream-chunk 投递；最终组装写盘', async () => {
    mod.setLivePort(livePort, 'http');
    received.length = 0;

    // 构造含 content_block_stop 的 SSE，触发 liveFlush（sawBlockStop 分支）
    const sse = [
      { type: 'message_start', message: { id: 'live_1', role: 'assistant', model: 'm' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Live' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ].map(b => `data: ${JSON.stringify(b)}`).join('\n\n') + '\n\n';

    nextResponse = () => new Response(sse, { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });

    const body = {
      system: [{ type: 'text', text: 'You are Claude Code, official CLI.' }],
      tools: makeMainAgentTools(),
      messages: [{ role: 'user', content: 'go live' }],
      model: 'm', stream: true,
    };
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'kk' }, body: JSON.stringify(body),
    });
    // 消费返回流，驱动 ReadableStream.start()
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }

    // 等待 fire-and-forget HTTP POST 落到 mock server。skeleton(_chunkSeq=0) 在
    // ReadableStream.start() 内无条件立即派发（不经 50ms 节流），是纯本地 loopback 往返，
    // 几乎必在 2s 内到达。轮询替代固定 sleep，避免高负载下 received 系断言假失败。
    await waitUntil(() => received.length >= 1, 2000, 'skeleton chunk received');

    // 至少收到 skeleton（chunkSeq 0，body null）
    assert.ok(received.length >= 1, '应至少收到 skeleton chunk');
    assert.ok(received.every(r => r.path === '/api/stream-chunk'));
    const skeleton = received.find(r => r.body && r.body._chunkSeq === 0);
    assert.ok(skeleton, '应有 _chunkSeq=0 的 skeleton');
    assert.equal(skeleton.body.response.body, null, 'skeleton 无 body');
    assert.equal(skeleton.body.url, 'https://api.anthropic.com/v1/messages');

    // 最终完整 entry 仍写盘（mainAgent live-stream 跳过磁盘 placeholder，但最终 entry 落盘）
    const entry = lastCompleted();
    assert.equal(entry.response.body.id, 'live_1');
    assert.equal(entry.response.body.content[0].text, 'Live');
  });
});
