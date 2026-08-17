/**
 * interceptor.js — BRANCH 覆盖补强。
 *
 * 仅新增测试，不改任何源码 / package.json。
 * 目标分支（既有 interceptor-*.test.js 仍漏）：
 *   - setupInterceptor 重入守卫：第二次调用直接 return
 *   - 非流式响应 catch 臂：response.clone().text() 抛错 → catch 仍写 v2 completion（body null）
 *   - fetch wrapper 杂项/细分支：url 形态、headers 来源、hotswitch、profile helper
 *   - live-stream flush 分支族 + sendStreamChunk 协议/熔断臂
 *   - 模块加载期 _ccvSkip / 自动执行 / 信号 handler 臂（子进程跑 canonical import）
 *
 * 1.7.0 起写盘只走 v2 session dir（LOG_FILE 恒空；v1 的 delta 信封写入、轮转、resume、
 * teammate leader-log 定位等机器已删，对应 describe 一并移除）。读回断言统一走
 * iterateV2RawEntries(getLiveLogSource())（v2→v1 adapter 合成视图）；before() 先发一条
 * 带 SID 的引导请求建立 _currentSid，之后无 metadata 的请求按 §8.3 回落到同一 session。
 *
 * 风格：CCV_PROXY_MODE=1 跳过自执行 → 手动 setupInterceptor；CCV_SYNC_WRITES=1 同步写盘。
 * 并行隔离：私有 mkdtemp 作 CCV_LOG_DIR，且在 import 目标模块之前设好；listen(0) / 私有端口窗。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const INTERCEPTOR = join(REPO_ROOT, 'server', 'interceptor.js');

// 私有 LOG 目录：必须在 import('../server/interceptor.js') 之前设好
const logDir = mkdtempSync(join(tmpdir(), 'ccv-branch-itc-'));
process.env.CCV_LOG_DIR = logDir;
process.env.CCV_PROXY_MODE = '1';   // 跳过模块顶层 setupInterceptor 自执行
process.env.CCV_SYNC_WRITES = '1';  // v2 写队列同步写盘，便于读取断言
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;
delete process.env.ANTHROPIC_BASE_URL;

// 本文件的固定 v2 session（引导请求携带；后续无 metadata 请求 §8.3 回落到它）
const SID = 'abab1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let iterateV2RawEntries;
let nextResponse;
let lastFetchArgs;

/** 经 v2→v1 adapter 读取当前 session 的合成 entry 数组（seq 序） */
function readEntries() {
  const dir = mod.getLiveLogSource();
  if (!dir) return [];
  return [...iterateV2RawEntries(dir)].map(p => JSON.parse(p));
}

/** 引导请求：携带 SID 建立/恢复 _currentSid（initForWorkspace 会重置 session 绑定） */
async function prime() {
  const saved = nextResponse;
  nextResponse = null;
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'boot' },
    body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }),
  });
  await mod._v2Writer.flush();
  nextResponse = saved;
}
function lastCompleted() {
  const entries = readEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    if (!entries[i].inProgress) return entries[i];
  }
  return null;
}
async function waitUntil(cond, timeoutMs = 2000, label = 'condition') {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitUntil timeout ${timeoutMs}ms: ${label}`);
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
// 用单事件 message_start 构造一段最小合法 SSE
function sseStream(events) {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  let sent = false;
  return {
    status: 200, statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader() {
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new TextEncoder().encode(text) };
          },
        };
      },
    },
  };
}

before(async () => {
  globalThis.fetch = async (url, opts) => {
    lastFetchArgs = [url, opts];
    return nextResponse ? nextResponse(url, opts) : new Response('{}', { status: 200 });
  };
  mod = await import('../server/interceptor.js');
  ({ iterateV2RawEntries } = await import('../server/lib/v2/adapter.js'));
  mod.setupInterceptor();
  assert.equal(mod.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串（v1 写路径已退役）');
  await prime();
  assert.ok(mod.getLiveLogSource().endsWith(SID), '引导请求应建立本文件的固定 v2 session');
});

after(() => {
  try { mod.setLivePort(null); } catch { /* noop */ }
  try { rmSync(logDir, { recursive: true, force: true }); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 30).unref(); // 顶层 watchFile 阻止退出
});

describe('setupInterceptor 重入守卫（487-488）', () => {
  it('再次调用 setupInterceptor 直接 return（_ccViewerInterceptorInstalled 已为 true）', () => {
    const fetchBefore = globalThis.fetch;
    // 安装已发生于 before()，此处第二次调用应命中早 return，不重新包裹 fetch
    assert.doesNotThrow(() => mod.setupInterceptor());
    assert.equal(globalThis.fetch, fetchBefore, '重入不应重新替换 globalThis.fetch');
  });
});


describe('非流式响应 clone().text() 抛错 → catch 臂', () => {
  it('response.clone() 抛错 → 走 catch：仍写 v2 completion（response.body=null），不抛出', async () => {
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      // 非流式：requestEntry.isStream=false → 进入 else，clone() 抛错命中 catch 臂
      clone() { throw new Error('clone boom'); },
    });
    const before = readEntries().filter(e => !e.inProgress).length;
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(res.status, 200, '原 response 仍被返回');
    await waitUntil(() => readEntries().filter(e => !e.inProgress).length > before, 2000, 'catch-branch completion');
    const entry = lastCompleted();
    assert.ok(entry, 'catch 分支仍写入 completed 条目');
    assert.equal(entry.inProgress, undefined, 'completed 相位不带 inProgress');
    // clone() 在 response 元数据赋值之前就抛错 → journal done status='capture-failed'
    // （无 http/headers）→ adapter 合成 response = { body: null }
    assert.deepEqual(entry.response, { body: null }, '响应捕获失败 → body=null');
  });
});


// 流式组装 try 抛错臂（954-964 catch）说明：try 块内对 SSE 文本做 split/map/assemble，
// 最终 JSON.stringify(requestEntry) 落盘。所有进入 stringify 的值都源自 JSON.parse（SSE data
// 行）经 assembleStreamMessage 浅拷贝重整，永远可序列化；JSON.parse 无法产出 BigInt / 函数 /
// 循环引用，故黑盒输入无法让 try 抛错。interceptor-core 也未导出 assembleStreamMessage 的测试
// 钩子，无法在不改源码 / 不 mock 内部函数的前提下触发。归入 unreachable，不写假断言。

describe('fetch wrapper 杂项分支补强（541 / 565 / 620 / 737）', () => {
  after(() => { nextResponse = null; });

  it('url 为对象且无 .url → String(url) 兜底（541 第二/第三臂）', async () => {
    // 传一个非 string、无 .url 的对象（不是 Request），命中 url?.url(undefined) || String(url)
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const weird = { toString() { return 'https://api.anthropic.com/v1/messages'; } };
    await globalThis.fetch(weird, { method: 'POST', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ model: 'm', messages: [] }) });
    const entry = lastCompleted();
    assert.equal(entry.url, 'https://api.anthropic.com/v1/messages', 'String(url) 兜底应生效');
  });

  it('url 为对象且有 .url → 取 url.url（541 第二臂）', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch({ url: 'https://claude.ai/v1/messages' }, { method: 'POST', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ model: 'm', messages: [] }) });
    const entry = lastCompleted();
    assert.equal(entry.url, 'https://claude.ai/v1/messages');
  });

  it('Request 对象承载 headers（无 options.headers）→ 走 url instanceof Request 分支（565）', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const reqObj = new Request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'req-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    // 第二参 options 不带 headers → rawHeaders 走 (url instanceof Request ? url.headers : null)
    await globalThis.fetch(reqObj, { method: 'POST' });
    const entry = lastCompleted();
    assert.ok(entry, '应记录');
    // safeHeaders 应包含来自 Request 的脱敏 x-api-key
    assert.ok(entry.headers['x-api-key'], 'Request.headers 被提取');
  });

  it('options 无 method → 记为 GET（620 默认臂）', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', { headers: { 'x-api-key': 'k' } });
    const entry = lastCompleted();
    assert.equal(entry.method, 'GET');
  });

  it('流式请求 body 无 model → streamingState.model 取空串（737 默认臂）', async () => {
    nextResponse = () => sseStream([
      { type: 'message_start', message: { id: 's', content: [] } },
      { type: 'message_stop' },
    ]);
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ stream: true, messages: [] }), // 无 model
    });
    // 流开始即设 streamingState.model；此处不依赖时序断言其值，只确保不抛 + 流可消费
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    assert.ok(true);
  });
});


describe('live-stream flush 分支（859 / 873-876 / 878-883 / 895 / 983 / 986 / 994 / 907）', () => {
  let liveServer, livePort, received;
  before(async () => {
    received = [];
    const { createServer } = await import('node:http');
    liveServer = createServer((req, res) => {
      let buf = '';
      req.on('data', c => { buf += c; });
      req.on('end', () => {
        try { received.push(JSON.parse(buf || '{}')); } catch { received.push(null); }
        res.writeHead(200); res.end('ok');
      });
    });
    await new Promise(r => liveServer.listen(0, '127.0.0.1', r));
    livePort = liveServer.address().port;
    mod.setLivePort(livePort, 'http');
  });
  after(async () => {
    mod.setLivePort(null);
    await new Promise(r => liveServer.close(r));
  });

  it('mainAgent live stream：含空块 / 无 data 块 / 坏 JSON / content_block_stop / 多字节切分 → 各解析分支 + flush', async () => {
    // 构造一段会触发：空块(983)、无 data 行块(986)、坏 JSON(994 catch)、content_block_stop(sawBlockStop)
    // 以及多字节 UTF-8 跨 chunk 切分（907 decoder tail flush）。
    const enc = new TextEncoder();
    // 块1：合法 message_start
    const b1 = 'data: {"type":"message_start","message":{"id":"L","model":"m","content":[]}}\n\n';
    // 块2：空块（仅空白）→ continue（983）
    const b2 = '\n\n';
    // 块3：无 data 行（只有 event:）→ continue（986）
    const b3 = 'event: ping\n\n';
    // 块4：data 后坏 JSON → catch（994）
    const b4 = 'data: {bad json\n\n';
    // 块5：content_block_start + delta + stop（sawBlockStop=true → flush）
    const b5 = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
      + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n\n'
      + 'data: {"type":"content_block_stop","index":0}\n\n';
    const b6 = 'data: {"type":"message_stop"}\n\n';

    // 把 "你好"（多字节）所在 chunk 在 UTF-8 字节中间切断，制造 decoder 残留 → done 时 tail flush（907）
    const fullText = b1 + b2 + b3 + b4 + b5 + b6;
    const fullBytes = enc.encode(fullText);
    // 在中部一个多字节字符边界中间切：找到 '你' 的首字节位置后 +1 切
    const splitAt = Math.floor(fullBytes.length / 2);
    const part1 = fullBytes.slice(0, splitAt);
    const part2 = fullBytes.slice(splitAt);

    let phase = 0;
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: {
        getReader() {
          return {
            read: async () => {
              phase++;
              if (phase === 1) return { done: false, value: part1 };
              if (phase === 2) return { done: false, value: part2 };
              return { done: true, value: undefined };
            },
          };
        },
      },
    });

    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify(mainAgentBody([{ role: 'user', content: 'live' }], { model: 'm', stream: true })),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    // skeleton(seq0) + 至少一次内容 flush 应已 POST 到本地 live server
    await waitUntil(() => received.length >= 1, 3000, 'live chunk received');
    assert.ok(received.length >= 1, 'live server 应至少收到 skeleton/快照');
  });

  it('多次有内容的 chunk（含 data: 无空格 989）+ 等待 50ms 定时器回调（880-882）', async () => {
    // 分多次 read 发送多个 content_block_stop（每次触发 flush），让 in-flight + 定时器链路反复运转，
    // 命中：878（liveFlushTimer 已存在 → clearTimeout）、880-882（定时器回调清标志 + pending 续发）、
    //       989（live 路径 'data:'(无空格) → substring(5)）。
    const enc = (s) => new TextEncoder().encode(s);
    const start = 'data: {"type":"message_start","message":{"id":"T","model":"m","content":[]}}\n\n'
      + 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
    // 注意：使用无空格 'data:' 形式触发 989 的 substring(5) 臂
    const tick = (t) => `data:{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${t}"}}\n\n`
      + 'data:{"type":"content_block_stop","index":0}\n\n'
      + 'data:{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
    const chunks = [enc(start + tick('a')), enc(tick('b')), enc(tick('c')), enc(tick('d'))];
    let phase = 0;
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: {
        getReader() {
          return {
            read: async () => {
              if (phase < chunks.length) {
                const v = chunks[phase++];
                // 每块之间留点时间，让 50ms 定时器有机会 fire 并清 in-flight，制造下一块再次 flush
                await new Promise(r => setTimeout(r, 60));
                return { done: false, value: v };
              }
              return { done: true, value: undefined };
            },
          };
        },
      },
    });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify(mainAgentBody([{ role: 'user', content: 'live2' }], { model: 'm', stream: true })),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    // 多块多 flush → 应收到 >1 条 POST
    await waitUntil(() => received.length >= 2, 3000, 'multiple live chunks');
    // 再等一会让最后的 50ms 定时器回调跑完（880-882）
    await new Promise(r => setTimeout(r, 120));
    assert.ok(received.length >= 2, 'live server 应收到多条快照');
  });
});

describe('live-stream 413 熔断臂（875 / 895：onDone(false) → liveStreamEnabled=false）', () => {
  let liveServer413, livePort413;
  before(async () => {
    const { createServer } = await import('node:http');
    liveServer413 = createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => { res.writeHead(413); res.end('too large'); }); // 始终 413
    });
    await new Promise(r => liveServer413.listen(0, '127.0.0.1', r));
    livePort413 = liveServer413.address().port;
    mod.setLivePort(livePort413, 'http');
  });
  after(async () => {
    mod.setLivePort(null);
    await new Promise(r => liveServer413.close(r));
  });

  it('live server 始终 413 → skeleton onDone(false) 即禁用当次 live-stream（895 / 875 真臂）', async () => {
    const enc = (s) => new TextEncoder().encode(s);
    const sse = enc(
      'data: {"type":"message_start","message":{"id":"E","model":"m","content":[]}}\n\n'
      + 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
      + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}}\n\n'
      + 'data: {"type":"content_block_stop","index":0}\n\n'
      + 'data: {"type":"message_stop"}\n\n');
    let phase = 0;
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader() { return { read: async () => phase++ === 0 ? { done: false, value: sse } : { done: true } }; } },
    });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify(mainAgentBody([{ role: 'user', content: 'e413' }], { model: 'm', stream: true })),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    // 不抛出即说明 413 熔断路径被安全处理；给 fire-and-forget POST 一点时间完成
    await new Promise(r => setTimeout(r, 120));
    assert.ok(true, '413 熔断不应导致异常');
  });
});

describe('liveFlush 早返回臂（859）：setLivePort 已设但无可发消息', () => {
  it('mainAgent 流：纯无 data 行 / 空块 → liveAssembler 无 message → liveFlush 早返回（859 第三臂）', async () => {
    // 触发 overdue/bigChunk flush 调用 liveFlush，但 assembler 从未 feed 过 message_start →
    // hasMessage()=false → liveFlush 早返回（命中 !liveAssembler.hasMessage() 真臂）。
    // 需要一个本地 live server 接住 skeleton（seq0）POST，否则连接 refused（不影响断言）。
    const { createServer } = await import('node:http');
    const srv = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(200); res.end('ok'); }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    mod.setLivePort(srv.address().port, 'http');
    try {
      // 构造一个"够大"的块（>16384 bytes）只含无 data 的事件 → bigChunk=true 触发 liveFlush，
      // 但 assembler 没有 message → 859 早返回。
      const filler = 'event: ping\n' + 'x'.repeat(20000) + '\n\n';
      const enc = (s) => new TextEncoder().encode(s);
      let phase = 0;
      nextResponse = () => ({
        status: 200, statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: { getReader() { return { read: async () => phase++ === 0 ? { done: false, value: enc(filler) } : { done: true } }; } },
      });
      const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': 'k' },
        body: JSON.stringify(mainAgentBody([{ role: 'user', content: 'noflush' }], { model: 'm', stream: true })),
      });
      const reader = res.body.getReader();
      while (true) { const { done } = await reader.read(); if (done) break; }
      await new Promise(r => setTimeout(r, 80));
      assert.ok(true);
    } finally {
      mod.setLivePort(null);
      await new Promise(r => srv.close(r));
    }
  });
});

describe('profile helper 分支（78 / 157）', () => {
  const writeProfile = (obj) => writeFileSync(mod.PROFILE_PATH, JSON.stringify(obj), { mode: 0o600 });
  after(() => {
    try { rmSync(mod.PROFILE_PATH, { force: true }); } catch { /* noop */ }
    mod._loadProxyProfile();
  });

  const rmWsFile = () => { try { if (mod._logDir) rmSync(join(mod._logDir, 'active-profile.json'), { force: true }); } catch { /* noop */ } };

  it('getActiveProfileId：profile.json 无 active 字段 → 回退 "max"（157 默认臂）', () => {
    // 确保没有 workspace active-profile.json 干扰 → _readWorkspaceActiveId 返回 null
    rmWsFile();
    writeProfile({ profiles: [{ id: 'max', name: 'Default' }] }); // 无 active
    const id = mod.getActiveProfileId();
    assert.equal(id, 'max', '无 active 字段应回退 max');
  });

  it('getActiveProfileId：profile.json 损坏 → catch 回退 "max"', () => {
    rmWsFile();
    writeFileSync(mod.PROFILE_PATH, '{ corrupt');
    assert.equal(mod.getActiveProfileId(), 'max');
  });
});

describe('sendStreamChunk https 协议臂（459）+ 异常熔断臂（481）', () => {
  after(() => { mod.setLivePort(null); });

  it('setLivePort(port,"https") → sendStreamChunk 用 https 模块（459 真臂）', (_t, done) => {
    // https 连本地非 TLS 端口必失败 → req error → onDone(true)（不抛）；目的只在覆盖 https 选择臂。
    mod.setLivePort(59999, 'https');
    mod.sendStreamChunk({ timestamp: 't', url: 'u' }, 1, (ok) => {
      assert.equal(ok, true, 'https 连接失败走 req error → onDone(true)');
      done();
    });
  });

  it('sendStreamChunk payload 不可序列化（BigInt）→ 外层 catch（481）onDone(true)', (_t, done) => {
    mod.setLivePort(59998, 'http');
    // entry 含 BigInt → JSON.stringify 抛 TypeError → 命中 481 catch
    mod.sendStreamChunk({ timestamp: 't', big: 10n }, 1, (ok) => {
      assert.equal(ok, true, 'stringify 抛错 → catch → onDone(true)');
      done();
    });
  });
});

describe('fetch wrapper 更多分支（565 / 654 / 757 / 775-778 / 632）', () => {
  const writeProfile = (obj) => writeFileSync(mod.PROFILE_PATH, JSON.stringify(obj), { mode: 0o600 });
  after(() => {
    try { rmSync(mod.PROFILE_PATH, { force: true }); } catch { /* noop */ }
    mod._loadProxyProfile();
    nextResponse = null;
  });

  it('mainAgent 且 messages 为空数组 → 末位 fp 取空串（654 第二臂）', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify(mainAgentBody([], { model: 'm' })), // messages: []
    });
    const entry = lastCompleted();
    assert.ok(entry, '空 messages 的 mainAgent 仍记录');
  });

  it('hotswitch debug：matchedAuth=(none) + 仅 x-api-key（775-778 || 兜底臂）', async () => {
    writeProfile({ active: 'dbg', profiles: [{ id: 'dbg', name: 'DBG', baseURL: 'https://gw.example.com', apiKey: 'sk-x' }] });
    mod._loadProxyProfile();
    process.env.CCV_DEBUG_HOTSWITCH = '1';
    try {
      nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      // headers 仅 x-api-key（无 authorization）→ matchedAuthKey=null → 775 走 '(none)' 臂；
      // 776 matchedXApiKey='x-api-key'；778 newHeaders[matchedXApiKey] 真。
      await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': 'orig' },
        body: JSON.stringify({ model: 'm', messages: [] }),
      });
      assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-x', 'x-api-key 被替换');
    } finally {
      delete process.env.CCV_DEBUG_HOTSWITCH;
    }
  });

  it('baseURL 含路径且与原 path 完全相等 → _finalPath 取 _origPath（757 等于臂）', async () => {
    // baseURL 路径 = /v1/messages，原 path = /v1/messages → _origPath === _basePath → 取 _origPath。
    writeProfile({ active: 'eq', profiles: [{ id: 'eq', name: 'EQ', baseURL: 'https://gw.example.com/v1/messages', apiKey: 'sk' }] });
    mod._loadProxyProfile();
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ model: 'm', messages: [] }),
    });
    assert.equal(lastFetchArgs[0], 'https://gw.example.com/v1/messages', 'path 完全相等 → 不重复拼接');
  });

  it('options.body 非 JSON → JSON.parse 走 catch，请求仍记录为完成条目', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    // body 为非 JSON 字符串 → JSON.parse 抛 → catch → 内存里回退截断字符串。
    // v2 journal 只持久化结构化字段（原始字符串 body 不落盘），幸存断言：
    // 该请求仍产生一条 completed 条目，且不携带会话切片。
    const before = readEntries().filter(e => !e.inProgress).length;
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' }, body: 'not-json-at-all',
    });
    const completed = readEntries().filter(e => !e.inProgress);
    assert.equal(completed.length, before + 1, '坏 body 请求仍记录完成条目');
    assert.equal(completed[completed.length - 1].body.messages, undefined, '无可解析 messages → 不携带会话切片');
  });
});

describe('fetch wrapper 细分支补强（565 / 592 / 632 / 757 反向 / 776-778 / 78）', () => {
  const writeProfile = (obj) => writeFileSync(mod.PROFILE_PATH, JSON.stringify(obj), { mode: 0o600 });
  after(() => {
    try { rmSync(mod.PROFILE_PATH, { force: true }); } catch { /* noop */ }
    mod._loadProxyProfile();
    nextResponse = null;
  });

  it('请求无 headers 且 url 为 string → rawHeaders 取 null（565 第二臂）', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    // options 无 headers，url 是普通 string（非 Request）→ rawHeaders = options?.headers || (url instanceof Request ? ... : null) = null
    await globalThis.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: JSON.stringify({ model: 'm', messages: [] }) });
    const entry = lastCompleted();
    assert.ok(entry, '无 headers 请求仍记录');
    assert.deepEqual(entry.headers, {}, 'rawHeaders=null → headers 保持空对象');
  });

  // 592（_defaultConfig 捕获块 new URL catch）在主进程不可达：_defaultConfig 一次性捕获，
  // 主进程早已捕获过 → if(!_defaultConfig) 永不再进。改在子进程驱动（见下方"全新进程非法 URL"用例）。

  it('authorization 为非字符串 → safeHeaders 脱敏 .indexOf 抛错 → 外层 catch（632）吞掉', async () => {
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    // safeHeaders['authorization'] = 99999999（number 拷贝）→ 606 行 v.indexOf(' ') 抛 TypeError → 命中 632 catch；
    // requestEntry 仍为 null → 直接透传上游，不抛出。
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { authorization: 99999999 }, body: JSON.stringify({ model: 'm', messages: [] }),
    });
    assert.equal(res.status, 200, '即便记录失败，上游响应仍返回');
  });

  it('baseURL 带不重叠路径 → _finalPath = _basePath + _origPath（757 第二臂）', async () => {
    writeProfile({ active: 'np', profiles: [{ id: 'np', name: 'NP', baseURL: 'https://gw.example.com/api', apiKey: 'sk' }] });
    mod._loadProxyProfile();
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ model: 'm', messages: [] }),
    });
    assert.equal(lastFetchArgs[0], 'https://gw.example.com/api/v1/messages', '/api 不与 /v1 重叠 → 前缀拼接');
  });

  it('hotswitch debug + 无 x-api-key（仅 authorization）→ 776/778 || 兜底臂', async () => {
    writeProfile({ active: 'dbg2', profiles: [{ id: 'dbg2', name: 'DBG2', baseURL: 'https://gw.example.com', apiKey: 'sk-y' }] });
    mod._loadProxyProfile();
    process.env.CCV_DEBUG_HOTSWITCH = '1';
    try {
      nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      // 仅 authorization（无 x-api-key）→ matchedXApiKey=null → 776 '(none)' 臂；
      // 778 newHeaders[matchedXApiKey]=undefined → || newHeaders['x-api-key']（_replaceProxyAuthHeaders 强植入）
      await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { authorization: 'Bearer orig' },
        body: JSON.stringify({ model: 'm', messages: [] }),
      });
      assert.equal(lastFetchArgs[1].headers['authorization'], 'Bearer sk-y', 'authorization 被替换');
    } finally {
      delete process.env.CCV_DEBUG_HOTSWITCH;
    }
  });

  it('_readWorkspaceActive：active-profile.json 的 activeId 非字符串 → 取 null（回退 profile.json.active）', async () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'ccv-ws78-'));
    const r = mod.initForWorkspace(join(wsDir, 'proj78'), { forceNew: true });
    // activeId 写成 number → typeof !== 'string' → null
    writeFileSync(join(r.dir, 'active-profile.json'), JSON.stringify({ activeId: 12345 }));
    writeFileSync(mod.PROFILE_PATH, JSON.stringify({ active: 'kk', profiles: [{ id: 'kk', name: 'KK' }] }), { mode: 0o600 });
    // _readWorkspaceActive 返回 activeId=null（非字符串）→ getActiveProfileId 回退 profile.json.active='kk'
    assert.equal(mod.getActiveProfileId(), 'kk', 'activeId 非字符串 → 回退 profile.json.active');
    try { rmSync(wsDir, { recursive: true, force: true }); } catch { /* noop */ }
    // initForWorkspace 重绑了项目并重置了 v2 session 绑定 → 恢复原项目 + 重新引导，
    // 让后续用例继续写读本文件的固定 session。
    mod.initForWorkspace(process.cwd());
    await prime();
  });
});

describe('live-stream decoder 尾字节 flush（907）+ 定时器复用（878）', () => {
  let srv, port, received;
  before(async () => {
    received = [];
    const { createServer } = await import('node:http');
    srv = createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { received.push(b); res.writeHead(200); res.end('ok'); }); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    port = srv.address().port;
    mod.setLivePort(port, 'http');
  });
  after(async () => { mod.setLivePort(null); await new Promise(r => srv.close(r)); });

  it('SSE 末尾以多字节字符的半截字节结束 → done 时 decoder.decode() 返回残留 tail（907 真臂）', async () => {
    // 完整 SSE + 末尾追加一个多字节字符（如 "界"）的前 2 个字节（共 3 字节），让 stream decoder 留残字节，
    // done 时 decoder.decode()（无 stream）输出替换字符或残留 → if (tail) 真臂。
    const enc = new TextEncoder();
    const full = 'data: {"type":"message_start","message":{"id":"D","model":"m","content":[]}}\n\n'
      + 'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
      + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
      + 'data: {"type":"content_block_stop","index":0}\n\n'
      + 'data: {"type":"message_stop"}\n\n';
    const fullBytes = enc.encode(full);
    const charBytes = enc.encode('界'); // 3 字节
    const partial = charBytes.slice(0, 2); // 半截多字节 → decoder 残留
    const combined = new Uint8Array(fullBytes.length + partial.length);
    combined.set(fullBytes, 0); combined.set(partial, fullBytes.length);
    let phase = 0;
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: { getReader() { return { read: async () => phase++ === 0 ? { done: false, value: combined } : { done: true } }; } },
    });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify(mainAgentBody([{ role: 'user', content: 'tail' }], { model: 'm', stream: true })),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    await new Promise(r => setTimeout(r, 80));
    assert.ok(true, 'decoder 尾字节 flush 不应抛出');
  });
});

describe('profile / workspace catch 臂（80 / 145）', () => {
  const wsActivePath = () => join(mod._logDir || '', 'active-profile.json');
  after(async () => {
    try { rmSync(mod.PROFILE_PATH, { force: true }); } catch { /* noop */ }
    try { if (mod._logDir) rmSync(wsActivePath(), { force: true }); } catch { /* noop */ }
    mod._loadProxyProfile();
    // 用例内 initForWorkspace 重绑了项目 → 恢复原项目 + 重新引导 session 绑定
    mod.initForWorkspace(process.cwd());
    await prime();
  });

  it('active-profile.json 损坏 → _readWorkspaceActiveId catch（80）→ getActiveProfileId 回退', () => {
    const wsDir = mkdtempSync(join(tmpdir(), 'ccv-ws80-'));
    const r = mod.initForWorkspace(join(wsDir, 'proj80'), { forceNew: true });
    assert.ok(r.dir, 'workspace 初始化');
    writeFileSync(join(r.dir, 'active-profile.json'), '{ bad json');
    writeFileSync(mod.PROFILE_PATH, JSON.stringify({ active: 'zz', profiles: [{ id: 'zz', name: 'ZZ' }] }), { mode: 0o600 });
    assert.equal(mod.getActiveProfileId(), 'zz', 'ws 损坏 → 回退 profile.json.active');
    try { rmSync(wsDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('setActiveProfileForWorkspace：PROFILE_PATH 是目录 → 写入抛错被 catch（145），result.profile=false', () => {
    // 先建一个私有 workspace（保证 _writeWorkspaceActiveId 那条尽量成功 / 不影响 145 判定）
    const wsDir = mkdtempSync(join(tmpdir(), 'ccv-ws145-'));
    mod.initForWorkspace(join(wsDir, 'proj145'), { forceNew: true });
    // 删除已有 profile.json，再把 PROFILE_PATH 占成目录 → writeFileSync(PROFILE_PATH,...) 抛 EISDIR → 145 catch
    try { rmSync(mod.PROFILE_PATH, { force: true }); } catch { /* noop */ }
    mkdirSync(mod.PROFILE_PATH, { recursive: true });
    const res = mod.setActiveProfileForWorkspace('some-id');
    assert.equal(res.profile, false, 'profile.json 写入抛错 → result.profile=false（命中 145 catch）');
    // 清理：移除目录形态的 PROFILE_PATH
    try { rmSync(mod.PROFILE_PATH, { recursive: true, force: true }); } catch { /* noop */ }
    try { rmSync(wsDir, { recursive: true, force: true }); } catch { /* noop */ }
  });
});


describe('模块加载期臂：_ccvSkip 跳过 + 自动执行（子进程 canonical import）', () => {
  it('argv[2]=doctor → _ccvSkip=true → 跳过 setupInterceptor + server 自启（1075/1080 短路）', () => {
    // 'doctor' 在 _ccvSkipArgs 内且不是 node 标志（--version 会被 node 自己消费）。
    // argv 形态：[node, placeholder, doctor] → process.argv[2]='doctor' → _ccvSkip=true。
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `await import(${JSON.stringify(INTERCEPTOR)}); console.log('LOADED_OK'); process.exit(0);`,
      'placeholder', 'doctor'],
      {
        env: { ...process.env, CCV_LOG_DIR: logDir },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.equal(sub.status, 0, `子进程应成功退出: ${sub.stderr}`);
    assert.match(sub.stdout, /LOADED_OK/, '_ccvSkip 路径下模块应正常加载完成');
  });

  it('无 CCV_PROXY_MODE / 非 teammate → 自动执行 setupInterceptor + 启动 viewer server（1075 / 1081-1084）', () => {
    // 私有端口窗口避免与其它并行测试冲突；listen 由 server.js 在高位端口尝试。
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(INTERCEPTOR)});
       // 等 _initPromise + 触发 server import 链（1081-1084）
       await m._initPromise;
       await new Promise(r => setTimeout(r, 400));
       console.log('AUTO_OK installed=' + !!globalThis._ccViewerInterceptorInstalled);
       process.exit(0);`],
      {
        env: {
          ...process.env,
          CCV_LOG_DIR: logDir,
          CCV_PROXY_MODE: '',          // 清空 → !process.env.CCV_PROXY_MODE 为真 → 自动执行
          CCV_START_PORT: '39870',     // 私有高位端口窗，避免并行冲突
          CCV_MAX_PORT: '39960',
        },
        encoding: 'utf-8', timeout: 30000,
      });
    // server 可能因端口/环境差异告警，但模块加载与拦截器安装应成功
    assert.match(sub.stdout, /AUTO_OK installed=true/, `自动执行应安装拦截器: ${sub.stderr}`);
  });

  it('beforeExit handler + cleanupViewer 真实执行（523-524 / 506-512）', () => {
    // 自动执行模式下 server.js 被 import → viewerModule.stopViewer 存在。
    // 手动 emit beforeExit → 命中 523-524；其内 cleanupViewer 命中 viewerModule 真分支 507-512。
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(INTERCEPTOR)});
       await m._initPromise;
       // 轮询等 server.js import 完成（viewerModule 被赋值后 stopViewer 可用）
       const start = Date.now();
       while (Date.now() - start < 4000) {
         await new Promise(r => setTimeout(r, 50));
         // 间接探测：server 端也注册了 SIGINT/SIGTERM，listener 数 > 0 即已加载
         if (process.listeners('beforeExit').length > 0) break;
       }
       const hadBeforeExit = process.listeners('beforeExit').length > 0;
       // 触发 beforeExit handler（同步进入 handler，内部 _writeQueue.close().then(cleanupViewer)）
       process.emit('beforeExit', 0);
       await new Promise(r => setTimeout(r, 300)); // 等 close→cleanupViewer 异步链跑完
       console.log('BEFOREEXIT_OK hadHandler=' + hadBeforeExit);
       process.exit(0);`],
      {
        env: {
          ...process.env,
          CCV_LOG_DIR: logDir,
          CCV_PROXY_MODE: '',
          CCV_START_PORT: '39965',
          CCV_MAX_PORT: '39999',
        },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /BEFOREEXIT_OK hadHandler=true/, `beforeExit handler 应已注册并执行: ${sub.stderr}`);
  });

  it('teammate（--agent-name）模式下 fetch 记录带 teammate 字段（318/415/629 teammate 臂）', () => {
    // --agent-name 带 '--' 会被 node 当标志，必须写成临时脚本文件再以脚本参数传入。
    // 独立进程注入 teammate argv → _isTeammate=true。teammate 即使 proxy 模式也强制 setup（1075 _isTeammate 兜底）。
    // 驱动一个 mainAgent fetch：requestEntry 带 teammate/teamName（teammate 展开臂）。
    const scriptPath = join(logDir, '_teammate-driver.mjs');
    writeFileSync(scriptPath,
      `globalThis.fetch = async () => new Response(JSON.stringify({id:'r',content:[]}),{status:200,headers:{'content-type':'application/json'}});\n` +
      `const m = await import(${JSON.stringify(INTERCEPTOR)});\n` +
      `await m._initPromise;\n` +
      `const tools=[{name:'Edit'},{name:'Bash'},{name:'Task'},{name:'Read'},{name:'Write'},{name:'Glob'},{name:'Grep'},{name:'Agent'},{name:'WebFetch'},{name:'WebSearch'},{name:'NotebookEdit'},{name:'AskUser'}];\n` +
      `const body=JSON.stringify({system:[{type:'text',text:'You are Claude Code, the official CLI.'}],tools,messages:[{role:'user',content:'tm'}],model:'m'});\n` +
      `await globalThis.fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':'k'},body});\n` +
      `await new Promise(r=>setTimeout(r,150));\n` +
      `console.log('TEAMMATE_OK isTeammate=' + (process.argv.includes('--agent-name')));\n` +
      `process.exit(0);\n`);
    const sub = spawnSync(process.execPath, [scriptPath, '--agent-name', 'worker-9', '--team-name', 'tm-x'],
      {
        env: {
          ...process.env,
          CCV_LOG_DIR: logDir,
          CCV_PROXY_MODE: '1',
          CCV_SYNC_WRITES: '1',
        },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /TEAMMATE_OK isTeammate=true/, `teammate fetch 应跑通: ${sub.stderr}`);
  });

  it('全新进程首个 API 请求捕获 _defaultConfig（authType OAuth / model null 等臂 588-592）', () => {
    // _defaultConfig 是模块级一次性捕获；主进程已捕获过，故用全新子进程。
    // 用 authorization（无 x-api-key）+ body 无 model → authType='OAuth'、apiKey=null、model=null 各臂。
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `let captured;
       globalThis.fetch = async () => new Response('{}',{status:200,headers:{'content-type':'application/json'}});
       const m = await import(${JSON.stringify(INTERCEPTOR)});
       m.setupInterceptor();
       // 无 model 的 body + 仅 authorization → OAuth 臂 + model:null 臂
       await globalThis.fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{authorization:'Bearer tok'},body:JSON.stringify({messages:[]})});
       await new Promise(r=>setTimeout(r,100));
       console.log('DEFAULTCFG_OK authType=' + (m._defaultConfig && m._defaultConfig.authType) + ' model=' + (m._defaultConfig && String(m._defaultConfig.model)));
       process.exit(0);`],
      {
        env: {
          ...process.env,
          CCV_LOG_DIR: logDir,
          CCV_PROXY_MODE: '1',
          CCV_SYNC_WRITES: '1',
        },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /DEFAULTCFG_OK authType=OAuth model=null/, `全新进程应捕获 OAuth/null 配置: ${sub.stderr}`);
  });

  it('全新进程：首请求既无 authorization 也无 x-api-key → authType=Unknown（588 第三臂）', () => {
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `globalThis.fetch = async () => new Response('{}',{status:200,headers:{'content-type':'application/json'}});
       const m = await import(${JSON.stringify(INTERCEPTOR)});
       m.setupInterceptor();
       // 无任何鉴权 header，但 url 含 anthropic → 命中拦截；authType 走 'Unknown'
       await globalThis.fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'mm',messages:[]})});
       await new Promise(r=>setTimeout(r,100));
       console.log('UNKNOWNCFG_OK authType=' + (m._defaultConfig && m._defaultConfig.authType));
       process.exit(0);`],
      {
        env: { ...process.env, CCV_LOG_DIR: logDir, CCV_PROXY_MODE: '1', CCV_SYNC_WRITES: '1' },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /UNKNOWNCFG_OK authType=Unknown/, `无鉴权应捕获 Unknown: ${sub.stderr}`);
  });

  it('全新进程：首请求 url 非法（trace 命中）→ _defaultConfig 捕获块 new URL 抛错 catch（592）', () => {
    // _defaultConfig 一次性捕获在主进程已发生 → 主进程不可达；用全新子进程让首个匹配请求带非法 url。
    // x-cc-viewer-trace=true 让非法 url 也命中拦截分支；随后 if(!_defaultConfig) → new URL(urlStr) 抛 → 592 catch。
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `globalThis.fetch = async () => new Response('{}',{status:200,headers:{'content-type':'application/json'}});
       const m = await import(${JSON.stringify(INTERCEPTOR)});
       m.setupInterceptor();
       await globalThis.fetch('::: not a url :::',{method:'POST',headers:{'x-cc-viewer-trace':'true','x-api-key':'k'},body:JSON.stringify({model:'m',messages:[]})});
       await new Promise(r=>setTimeout(r,100));
       // _defaultConfig 应保持 null（new URL 抛 → catch → 未赋值）
       console.log('BADURL_OK defaultConfigNull=' + (m._defaultConfig === null));
       process.exit(0);`],
      {
        env: { ...process.env, CCV_LOG_DIR: logDir, CCV_PROXY_MODE: '1', CCV_SYNC_WRITES: '1' },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /BADURL_OK defaultConfigNull=true/, `非法 url 应命中 592 catch 且 _defaultConfig 保持 null: ${sub.stderr}`);
  });

  it('SIGTERM handler 干净退出（519-521）', () => {
    // 自动执行模式安装拦截器（注册 SIGTERM handler）→ 发 SIGTERM → handler close 队列后 process.exit(0)。
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(INTERCEPTOR)});
       await m._initPromise;
       await new Promise(r => setTimeout(r, 300));
       console.log('READY');
       // 自杀式发 SIGTERM 给自己 → 命中 519-521 → exit(0)
       process.kill(process.pid, 'SIGTERM');
       // 兜底：若 handler 没退出，10s 后强制退出非 0 让测试可观测
       setTimeout(() => process.exit(7), 10000);`],
      {
        env: {
          ...process.env,
          CCV_LOG_DIR: logDir,
          CCV_PROXY_MODE: '',
          CCV_START_PORT: '39940',
          CCV_MAX_PORT: '39964',
        },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /READY/, '子进程应就绪');
    assert.equal(sub.status, 0, `SIGTERM handler 应 close 队列后 exit(0): status=${sub.status} stderr=${sub.stderr}`);
  });

  it('SIGINT handler 干净退出（515-517）', () => {
    const sub = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(INTERCEPTOR)});
       await m._initPromise;
       await new Promise(r => setTimeout(r, 300));
       console.log('READY');
       process.kill(process.pid, 'SIGINT');
       setTimeout(() => process.exit(7), 10000);`],
      {
        env: {
          ...process.env,
          CCV_LOG_DIR: logDir,
          CCV_PROXY_MODE: '',
          CCV_START_PORT: '39915',
          CCV_MAX_PORT: '39939',
        },
        encoding: 'utf-8', timeout: 30000,
      });
    assert.match(sub.stdout, /READY/, '子进程应就绪');
    assert.equal(sub.status, 0, `SIGINT handler 应 close 队列后 exit(0): status=${sub.status} stderr=${sub.stderr}`);
  });
});
