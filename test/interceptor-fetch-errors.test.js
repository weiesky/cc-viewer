/**
 * interceptor.js — 深层 error 臂 + hot-switch profile 改写路径覆盖（T10）。
 *
 * 与 test/interceptor-fetch.test.js 同模式（CCV_PROXY_MODE=1 跳过自执行 → 手动 setupInterceptor；
 * fake fetch 先装后 import；CCV_SYNC_WRITES=1 同步写盘可断言）。本文件专打既有 8 个 interceptor
 * 测试未触达的分支：
 *   - active-profile（baseURL+apiKey+activeModel）→ URL 重写 / auth 替换 / model 替换（745-807）
 *   - 流式 reader.read() 中途抛错 → ReadableStream start 的 catch → resetStreamingState + controller.error（1007-1009）
 *   - SSE 块 "data:{...}"（无空格）解析分支 + 非 JSON data 回退（929-932）
 *   - live-stream 高频 chunk → liveFlush 的 in-flight pending-snapshot 合并（861-863）
 *
 * interceptor.js 在保护清单：只测不改。所有源码常量（PROFILE_PATH 等）通过模块导出读取。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, chmodSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

// 端口/路径隔离：interceptor.js 的 LOG_FILE 与 PROFILE_PATH(profile.json) / active-profile.json 全部
// 派生自 CCV_LOG_DIR。本文件不设私有 LOG_DIR 时会落到全套件共享的默认 tmp/，而本文件又对 LOG_FILE /
// active-profile.json 做精确 readback 断言（active-profile 请求记录 / hot-switch / SSE 解析等）。
// 全量并行跑（node:test 每文件独立进程、共享同一默认 LOG_DIR）时别的 interceptor 测试进程写同一份
// log/profile → 串台 → 偶发假失败（实测加压并行可 8/8 复现）。给本进程私有 LOG_DIR + CONFIG_DIR 隔离，
// 必须在 import('../packages/app/server/interceptor.js') 之前设置（模块顶层据此推导 LOG_FILE/PROFILE_PATH）。
process.env.CCV_LOG_DIR = mkdtempSync(join(tmpdir(), 'ccv-intc-fe-'));
process.env.CLAUDE_CONFIG_DIR = process.env.CCV_LOG_DIR;
process.env.CCV_PROXY_MODE = '1';      // 跳过模块顶层 setupInterceptor 自执行
process.env.CCV_SYNC_WRITES = '1';     // 同步写盘，便于读取断言
delete process.env.CCV_WORKSPACE_MODE; // 普通初始化，自动生成 LOG_FILE

// 本文件的固定 v2 session（引导请求携带；后续无 metadata 请求 §8.3 回落到它）
const SID = 'eeee1111-2222-3333-4444-555566667777';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let iterateV2RawEntries;
let nextResponse;   // () => Response：每个 test 注入下一次 _originalFetch 的返回
let lastFetchArgs;  // 上游真实收到的 [url, opts]

/** 经 v2→v1 adapter 读取当前 session 的合成 entry 数组（seq 序） */
function readEntries() {
  const dir = mod.getLiveLogSource();
  if (!dir) return [];
  return [...iterateV2RawEntries(dir)].map(p => JSON.parse(p));
}
function lastCompleted() {
  const entries = readEntries();
  for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].inProgress) return entries[i];
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
function writeProfile(json) {
  mkdirSync(dirname(mod.PROFILE_PATH), { recursive: true });
  writeFileSync(mod.PROFILE_PATH, JSON.stringify(json));
}

before(async () => {
  globalThis.fetch = async (url, opts) => {
    lastFetchArgs = [url, opts];
    return nextResponse ? nextResponse(url, opts) : new Response('{}', { status: 200 });
  };
  mod = await import('../packages/app/server/interceptor.js');
  ({ iterateV2RawEntries } = await import('../packages/app/server/lib/v2/adapter.js'));
  mod.setupInterceptor();
  assert.equal(mod.LOG_FILE, '', '1.7.0 起 LOG_FILE 恒为空串（v1 写路径已退役）');
  // 引导请求：携带 SID 建立 _currentSid，让后续无 metadata 请求路由到同一 session。
  await globalThis.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': 'boot' },
    body: JSON.stringify({ model: 'm', messages: [], metadata: { user_id: USER_ID } }),
  });
  await mod._v2Writer.flush();
  assert.ok(mod.getLiveLogSource().endsWith(SID), '引导请求应建立本文件的固定 v2 session');
});

after(() => {
  mod.setLivePort(null);
  try { rmSync(mod.PROFILE_PATH, { force: true }); } catch { /* noop */ }
  mod._loadProxyProfile(); // 复位 _activeProfile，避免泄漏给同进程后续（本文件已是最后块）
  // 顶层 watchFile(PROFILE_PATH) 会阻止进程退出，强制终止（不影响 --test-force-exit）
  setTimeout(() => process.exit(0), 30).unref();
});

// 注：active profile 设了 activeModel 时，proxy 改写 try 块在 model 段会抛出（interceptor-profile.test.js
// line 18 已记录此既有行为；保护清单不改源）。本块只用 baseURL+apiKey（不设 activeModel），干净覆盖
// URL 重写 / auth 替换 / proxyProfile 记账（745-782, 808）。activeModel 替换段（788-807）列入放过清单。
describe('_loadProxyProfile 损坏文件 + CCV_DEBUG_HOTSWITCH 诊断分支（114-115）', () => {
  it('profile.json 损坏且开 CCV_DEBUG_HOTSWITCH → catch 内打印诊断，_activeProfile 降级 null', () => {
    process.env.CCV_DEBUG_HOTSWITCH = '1';
    try {
      mkdirSync(dirname(mod.PROFILE_PATH), { recursive: true });
      writeFileSync(mod.PROFILE_PATH, '{ corrupt json'); // JSON.parse 抛 → catch（含 debug 日志 114-115）
      mod._loadProxyProfile();
      assert.equal(mod._activeProfile, null, '损坏 profile → _activeProfile 安全降级为 null');
    } finally {
      delete process.env.CCV_DEBUG_HOTSWITCH;
      rmSync(mod.PROFILE_PATH, { force: true });
      mod._loadProxyProfile();
    }
  });
});

describe('hot-switch active profile 改写路径（baseURL + apiKey）', () => {
  before(() => {
    writeProfile({
      active: 'hp1',
      profiles: [
        { id: 'max', name: 'Default' },
        { id: 'hp1', name: 'HotProxy', baseURL: 'https://proxy.example.com/v1', apiKey: 'sk-hotswitch-9999' },
      ],
    });
    mod._loadProxyProfile();
    assert.equal(mod._activeProfile?.name, 'HotProxy', 'active profile 应已加载');
  });
  after(() => {
    rmSync(mod.PROFILE_PATH, { force: true });
    mod._loadProxyProfile(); // _activeProfile → null，避免影响下面非 profile 用例
  });

  it('URL 被重写到 profile.baseURL（path 重叠去重）+ auth 替换 + proxyProfile 记账', async () => {
    nextResponse = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'original-key' },
      body: JSON.stringify({ model: 'claude-orig', messages: [] }),
    });
    // baseURL=.../v1 与 pathname=/v1/messages 重叠 → 去重为 /v1/messages
    assert.equal(lastFetchArgs[0], 'https://proxy.example.com/v1/messages');
    // x-api-key 被替换为 profile.apiKey
    assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-hotswitch-9999');
    // 整块跑完（未在 model 段抛出，因为没设 activeModel）→ 条目仍以原始 URL 记录，
    // 且 proxy 记账落盘（1.8 修复：ingestRequest 移到 proxy 改写之后，journal req 行带 proxy 字段）。
    const entry = lastCompleted();
    assert.ok(entry, '改写后的请求仍应记录完成条目');
    assert.equal(entry.url, 'https://api.anthropic.com/v1/messages', '条目记录原始 URL');
    assert.equal(entry.proxyProfile, 'HotProxy', 'proxyProfile 落盘记账');
    assert.equal(entry.proxyUrl, 'https://proxy.example.com/v1/messages', 'proxyUrl 落盘记账');
  });

  it('baseURL 无路径重叠时直接拼接 origin + 原 path', async () => {
    // 临时换一个无 /v1 前缀的 baseURL（命中 _basePath 为空 / 不重叠分支）
    writeProfile({ active: 'hp2', profiles: [{ id: 'hp2', name: 'NoOverlap', baseURL: 'https://gw.example.com', apiKey: 'sk-2' }] });
    mod._loadProxyProfile();
    nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=1', {
      method: 'POST', headers: { 'x-api-key': 'k' }, body: JSON.stringify({ model: 'm', messages: [] }),
    });
    assert.equal(lastFetchArgs[0], 'https://gw.example.com/v1/messages?beta=1', '无重叠 → origin + 原 path + query');
    // 复原 HotProxy 供后续断言
    writeProfile({ active: 'hp1', profiles: [{ id: 'hp1', name: 'HotProxy', baseURL: 'https://proxy.example.com/v1', apiKey: 'sk-hotswitch-9999' }] });
    mod._loadProxyProfile();
  });

  it('CCV_DEBUG_HOTSWITCH 开启时走诊断日志分支（不报错）', async () => {
    process.env.CCV_DEBUG_HOTSWITCH = '1';
    try {
      nextResponse = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      await globalThis.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': 'k', authorization: 'Bearer old' },
        body: JSON.stringify({ model: 'claude-orig', messages: [] }),
      });
      assert.equal(lastFetchArgs[1].headers['x-api-key'], 'sk-hotswitch-9999');
    } finally {
      delete process.env.CCV_DEBUG_HOTSWITCH;
    }
  });
});

describe('流式 reader 中途抛错 → controller.error', () => {
  it('上游返回一个 read() 第二次抛错的流 → 透传流报错，streamingState 复位', async () => {
    // 自定义 body：第一次 read 返回一块 SSE，第二次 read 抛错，触发 start() 内 while 的 catch。
    let calls = 0;
    const fakeBody = {
      getReader() {
        return {
          read: async () => {
            calls++;
            if (calls === 1) return { done: false, value: new TextEncoder().encode('data: {"type":"message_start","message":{"id":"x"}}\n\n') };
            throw new Error('mid-stream read failure');
          },
        };
      },
    };
    nextResponse = () => ({
      status: 200, statusText: 'OK',
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: fakeBody,
    });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    // 消费返回流：第二块抛错 → reader.read() reject
    const reader = res.body.getReader();
    await assert.rejects(async () => {
      while (true) { const { done } = await reader.read(); if (done) break; }
    }, /mid-stream read failure/);
    assert.equal(mod.streamingState.active, false, 'reader 抛错后 streamingState 被复位');
  });
});

describe('SSE "data:{...}"（无空格）解析分支', () => {
  it('无空格 data: 块被正确解析进 assembled message', async () => {
    // GLM 风格：data: 后无空格。命中 substring(5) 分支（929-932 的 else）。
    const blocks = [
      { type: 'message_start', message: { id: 'ns_1', role: 'assistant', model: 'm' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'NoSpace' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    const text = blocks.map(b => `data:${JSON.stringify(b)}`).join('\n\n') + '\n\n';
    nextResponse = () => new Response(text, { status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' } });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    const entry = lastCompleted();
    assert.equal(entry.response.body.id, 'ns_1');
    assert.equal(entry.response.body.content[0].text, 'NoSpace');
  });

  it('SSE 块无 data: 行 → 该块映射为 null 被滤除（932 return null）', async () => {
    // 一个只含 event: 行（无 data:）的块 + 有效 message_start/stop。无 data 行的块走 `return null`。
    const text = 'event: ping\nid: 1\n\n' +
      `data: ${JSON.stringify({ type: 'message_start', message: { id: 'no_data_blk', role: 'assistant', model: 'm' } })}\n\n` +
      `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
    nextResponse = () => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    const entry = lastCompleted();
    // 钉死正路径：no-data 块(event:ping)被 filter(Boolean) 滤除，剩余 message_start 正确组装出
    // object，id='no_data_blk'。truthy 检查无法区分‘正确组装’与‘退化为原始字符串 fullContent’
    // (interceptor.js:941 `assembledMessage || fullContent`，字符串同样 truthy)。用确切值钉住。
    assert.equal(entry.response.body.id, 'no_data_blk');
  });

  it('data: 后是非 JSON → 该块回退为原始字符串（catch → return jsonStr）', async () => {
    // 一个无法 JSON.parse 的 data 块 + 一个有效 message_start，确保整流仍组装但命中 jsonStr 回退。
    const text = 'data: not-valid-json\n\n' +
      `data: ${JSON.stringify({ type: 'message_start', message: { id: 'mix_1', role: 'assistant', model: 'm' } })}\n\n` +
      `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
    nextResponse = () => new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    const entry = lastCompleted();
    // 钉死正路径：非 JSON 块经 catch→return jsonStr 字符串，进 events 后被 assembleStreamMessage
    // 的 `typeof event!=='object'` 守卫 continue 跳过；有效 message_start 正确组装出 object，id='mix_1'。
    // truthy 检查无法区分‘正确组装’与‘退化为原始字符串 fullContent’(interceptor.js:941 fallback)。用确切值钉住。
    assert.equal(entry.response.body.id, 'mix_1');
  });
});

describe('live-stream 高频 chunk → liveFlush in-flight 合并', () => {
  let liveServer, livePort;
  const received = [];
  before(async () => {
    liveServer = createServer((req, res) => {
      let buf = '';
      req.on('data', c => { buf += c; });
      req.on('end', () => {
        try { received.push(JSON.parse(buf || '{}')); } catch { received.push(null); }
        res.writeHead(204); res.end();
      });
    });
    await new Promise(r => liveServer.listen(0, '127.0.0.1', r));
    livePort = liveServer.address().port;
  });
  after(async () => { mod.setLivePort(null); await new Promise(r => liveServer.close(r)); });

  function mainAgentTools() {
    return ['Edit', 'Bash', 'Task', 'Read', 'Write', 'Glob', 'Grep', 'Agent', 'WebFetch', 'WebSearch', 'NotebookEdit', 'AskUser'].map(name => ({ name }));
  }

  it('多次 read 各带 content_block_stop → liveFlush in-flight pending 合并（861-863）', async () => {
    mod.setLivePort(livePort, 'http');
    received.length = 0;
    // 关键：body 分多次 read 返回，每次一个 block_stop。第一次 read → liveFlush 置 liveFlushInFlight=true
    // （50ms 定时器内不清），后续 read 触发的 liveFlush 命中 in-flight → liveHasPendingSnapshot=true（861-863）。
    const enc = new TextEncoder();
    const blockChunks = [];
    blockChunks.push(`data: ${JSON.stringify({ type: 'message_start', message: { id: 'live_pending', role: 'assistant', model: 'm' } })}\n\n`);
    for (let i = 0; i < 4; i++) {
      blockChunks.push(
        `data: ${JSON.stringify({ type: 'content_block_start', index: i, content_block: { type: 'text' } })}\n\n` +
        `data: ${JSON.stringify({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: 'P' + i } })}\n\n` +
        `data: ${JSON.stringify({ type: 'content_block_stop', index: i })}\n\n`,
      );
    }
    blockChunks.push(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`);
    blockChunks.push(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    let ci = 0;
    const multiBody = {
      getReader() {
        return {
          read: async () => {
            if (ci < blockChunks.length) return { done: false, value: enc.encode(blockChunks[ci++]) };
            return { done: true, value: undefined };
          },
        };
      },
    };
    nextResponse = () => ({ status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'text/event-stream' }), body: multiBody });

    const res = await globalThis.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': 'k' },
      body: JSON.stringify({
        system: [{ type: 'text', text: 'You are Claude Code, official CLI.' }],
        tools: mainAgentTools(),
        messages: [{ role: 'user', content: 'go' }],
        model: 'm', stream: true,
      }),
    });
    const reader = res.body.getReader();
    while (true) { const { done } = await reader.read(); if (done) break; }
    // skeleton(_chunkSeq=0) 在 start() 内无条件立即派发（不经 50ms 节流），是纯本地
    // loopback 往返，几乎必在 2s 内到达。轮询替代固定 sleep，避免高负载下 received 断言假失败。
    await waitUntil(() => received.length >= 1, 2000, 'at least one chunk received');

    assert.ok(received.length >= 1, '至少投递一个 chunk');
    const entry = lastCompleted();
    assert.equal(entry.response.body.id, 'live_pending');
  });
});

// 放最后：本块用 initForWorkspace/resetWorkspace 改写模块的 LOG_FILE 状态（resetWorkspace 把 LOG_FILE 置空），
// 必须在所有依赖 LOG_FILE 落盘断言的用例之后，避免污染它们。
describe('workspace active-profile 写入失败臂（_writeWorkspaceActive catch）', () => {
  let wsDir;
  before(() => {
    const logRoot = dirname(mod.PROFILE_PATH); // 模块内 LOG_DIR
    const projectPath = join(logRoot, '..', 'ws-write-fail-' + Date.now());
    const r = mod.initForWorkspace(projectPath, { forceNew: true });
    wsDir = r.dir;
  });
  after(() => {
    try { chmodSync(wsDir, 0o700); } catch { /* noop */ }
    try { rmSync(wsDir, { recursive: true, force: true }); } catch { /* noop */ }
    mod.resetWorkspace();
  });

  it('active-profile.json 所在目录只读 → 写入抛错被 catch，workspace=false', (t) => {
    if (process.platform === 'win32') { t.skip('chmod 0o500 是 POSIX 语义'); return; }
    // 目录设只读：active-profile.json 的 tmp 写入抛 EACCES → _writeWorkspaceActive catch 分支。
    chmodSync(wsDir, 0o500);
    let res;
    try { res = mod.setActiveProfileForWorkspace('p1'); } finally { chmodSync(wsDir, 0o700); }
    assert.equal(res.workspace, false, 'workspace 写入失败 → false（命中 catch 分支）');
  });
});
