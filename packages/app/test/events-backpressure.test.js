import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sendToClients,
  sendEventToClients,
  sendChunkToClients,
} from '../server/lib/log-watcher.js';
import { streamRawEntriesAsync } from '../server/lib/log-stream.js';
import { awaitDrainOrClose } from '../server/lib/sse-backpressure.js';

/**
 * 构造一个能模拟 backpressure / dead 状态的 SSE client。
 * - mode='ok' : write 永远返 true
 * - mode='full' : write 永远返 false（不会自动 emit drain）
 * - mode='throw' : write 抛错
 * - mode='drain-after' : write 第一次返 false，N ms 后 emit('drain')
 */
class FakeClient extends EventEmitter {
  constructor(mode = 'ok') {
    super();
    this.mode = mode;
    this.destroyed = false;
    this.writable = true;
    this.writes = [];
    this.ended = false;
  }
  write(payload) {
    if (this.mode === 'throw') {
      throw new Error('mock write error');
    }
    this.writes.push(payload);
    return this.mode !== 'full' && this.mode !== 'drain-after';
  }
  end() { this.ended = true; }
}

describe('SSE backpressure: _safeSseWrite via sendToClients', () => {
  it('keeps healthy client in array and writes payload', () => {
    const c = new FakeClient('ok');
    const clients = [c];
    sendToClients(clients, { ts: 1, url: '/a' });
    assert.equal(clients.length, 1);
    assert.equal(c.writes.length, 1);
    assert.match(c.writes[0], /^data: .+\n\n$/);
  });

  it('removes client whose write throws', () => {
    const good = new FakeClient('ok');
    const bad = new FakeClient('throw');
    const clients = [good, bad];
    sendToClients(clients, { ts: 1, url: '/a' });
    assert.equal(clients.length, 1, 'bad client removed');
    assert.ok(clients.includes(good), 'good client kept');
    assert.equal(good.writes.length, 1);
  });

  it('removes destroyed client without writing', () => {
    const c = new FakeClient('ok');
    c.destroyed = true;
    const clients = [c];
    sendToClients(clients, { ts: 1, url: '/a' });
    assert.equal(clients.length, 0);
    assert.equal(c.writes.length, 0);
  });

  it('removes !writable client without writing', () => {
    const c = new FakeClient('ok');
    c.writable = false;
    const clients = [c];
    sendToClients(clients, { ts: 1, url: '/a' });
    assert.equal(clients.length, 0);
    assert.equal(c.writes.length, 0);
  });

  it('keeps backpressured client on first write-false (sets timestamp), then removes after tolerance window', () => {
    const c = new FakeClient('full');
    const clients = [c];
    // 第一次 write 返 false：标记时间戳但不剔除
    sendToClients(clients, { ts: 1 });
    assert.equal(clients.length, 1, 'still in array on first backpressure');
    assert.ok(c._sseBackpressureSince, 'backpressure timestamp set');
    // 模拟未排空持续远超容忍窗口（不绑定具体常量值，直接把起点推到很久以前）
    c._sseBackpressureSince = Date.now() - 10 * 60 * 1000;
    sendToClients(clients, { ts: 2 });
    assert.equal(clients.length, 0, 'removed after sustained backpressure beyond tolerance window');
    assert.ok(c.ended, 'client.end() called');
  });

  it('resets backpressure timestamp after drain event', () => {
    const c = new FakeClient('drain-after');
    const clients = [c];
    sendToClients(clients, { ts: 1 });
    assert.ok(c._sseBackpressureSince > 0);
    c.emit('drain');
    assert.equal(c._sseBackpressureSince, 0, 'timestamp reset by drain');
    assert.equal(clients.length, 1, 'client kept');
  });
});

describe('SSE backpressure: sendEventToClients', () => {
  it('writes named-event payload with correct format', () => {
    const c = new FakeClient('ok');
    const clients = [c];
    sendEventToClients(clients, 'load_start', { total: 42 });
    assert.equal(c.writes.length, 1);
    assert.match(c.writes[0], /^event: load_start\ndata: \{"total":42\}\n\n$/);
  });

  it('removes throwing client and continues with others', () => {
    const a = new FakeClient('ok');
    const bad = new FakeClient('throw');
    const b = new FakeClient('ok');
    const clients = [a, bad, b];
    sendEventToClients(clients, 'context_window', { foo: 1 });
    assert.equal(clients.length, 2);
    assert.ok(clients.includes(a));
    assert.ok(clients.includes(b));
    assert.equal(a.writes.length, 1);
    assert.equal(b.writes.length, 1);
  });
});

describe('SSE backpressure: sendChunkToClients', () => {
  it('formats already-stringified data into load_chunk SSE payload', () => {
    const c = new FakeClient('ok');
    const clients = [c];
    sendChunkToClients(clients, '[{"x":1}]');
    assert.equal(c.writes.length, 1);
    assert.equal(c.writes[0], 'event: load_chunk\ndata: [{"x":1}]\n\n');
  });

  it('safely skips dead clients', () => {
    const dead = new FakeClient('ok'); dead.destroyed = true;
    const live = new FakeClient('ok');
    const clients = [dead, live];
    sendChunkToClients(clients, '[{}]');
    assert.equal(clients.length, 1);
    assert.equal(live.writes.length, 1);
  });
});

// ---------------------------------------------------------------------------
// /events 默认 limit 行为：通过直接调用 server/lib/log-stream.js 验证（与 server.js 中
// `effectiveLimit` 决策结合）。新增 server-side 默认 limit 的最关键不变量是：
//   1) `streamRawEntriesAsync` 在 limit > 0 时切片到 ≤ limit + 给出 hasMore/oldestTs
//   2) limit = undefined（即 ?limit=0 或老调用）时不切片
// 这两条已经被 lib/log-stream 既有测试间接覆盖；这里再加一个端到端 fixture，
// 确保 server.js 1c 改动后回调改 async 不影响输出 + 默认窗口边界对齐
// ---------------------------------------------------------------------------

describe('streamRawEntriesAsync limit behavior (covers /events default-window contract)', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ccv-events-bp-'));
  });

  function makeRaw(i, opts = {}) {
    const ts = `2026-05-05T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
    return JSON.stringify({
      timestamp: ts,
      url: `/req/${i}`,
      method: 'POST',
      // 老格式（无 _deltaFormat）→ 天然 checkpoint，limit 切片不会被向前扩展打散
      ...(opts.checkpoint ? { _isCheckpoint: true } : {}),
    });
  }

  it('limit=undefined returns all entries', async () => {
    const file = join(dir, 'log.jsonl');
    const entries = Array.from({ length: 50 }, (_, i) => makeRaw(i));
    writeFileSync(file, entries.join('\n---\n'));

    const collected = [];
    const result = await streamRawEntriesAsync(file, async (raw) => { collected.push(raw); });
    assert.equal(collected.length, 50);
    assert.equal(result.totalCount, 50);

    rmSync(dir, { recursive: true, force: true });
  });

  it('limit=10 returns ≤10 entries with hasMore=true and oldestTs', async () => {
    const file = join(dir, 'log.jsonl');
    const entries = Array.from({ length: 50 }, (_, i) => makeRaw(i));
    writeFileSync(file, entries.join('\n---\n'));

    const collected = [];
    let loadStart = null;
    await streamRawEntriesAsync(file, async (raw) => { collected.push(raw); }, {
      limit: 10,
      onReady: (info) => { loadStart = info; },
    });
    assert.ok(loadStart);
    assert.equal(loadStart.totalCount, 50);
    assert.equal(loadStart.hasMore, true, 'hasMore should be set when truncated');
    assert.match(loadStart.oldestTs, /^2026-05-05T/, 'oldestTs should be ISO');
    assert.ok(collected.length >= 1 && collected.length <= 50, 'count within bounds');
    assert.ok(collected.length <= 11, 'collected should be ≤ limit (with checkpoint slack)');

    rmSync(dir, { recursive: true, force: true });
  });

  it('limit equal to total entries → hasMore=false', async () => {
    const file = join(dir, 'log.jsonl');
    const entries = Array.from({ length: 5 }, (_, i) => makeRaw(i));
    writeFileSync(file, entries.join('\n---\n'));

    let loadStart = null;
    const collected = [];
    await streamRawEntriesAsync(file, async (raw) => { collected.push(raw); }, {
      limit: 100,
      onReady: (info) => { loadStart = info; },
    });
    assert.equal(loadStart.totalCount, 5);
    assert.ok(!loadStart.hasMore, 'hasMore should be false when limit ≥ totalCount');
    assert.equal(collected.length, 5);

    rmSync(dir, { recursive: true, force: true });
  });

  it('async onRawEntry callback is awaited (preserves order even with delays)', async () => {
    const file = join(dir, 'log.jsonl');
    const entries = Array.from({ length: 10 }, (_, i) => makeRaw(i));
    writeFileSync(file, entries.join('\n---\n'));

    const collected = [];
    await streamRawEntriesAsync(file, async (raw) => {
      // 强制让出事件循环
      await new Promise((resolve) => setImmediate(resolve));
      collected.push(raw);
    });
    assert.equal(collected.length, 10);
    // 确保顺序保持（按 i=0..9）
    for (let i = 0; i < 10; i++) {
      assert.match(collected[i], new RegExp(`/req/${i}\\b`));
    }

    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// awaitDrainOrClose helper — 回归：N 次 backpressure 等待不得在 res 上累积监听器。
// 之前内联在 server.js /events 处理里的写法对 drain/close/error 都用 res.once()，
// 但只有触发的那个会自动摘掉，剩下两个会一直留在 res 上，N 次 backpressure 后
// 触发 MaxListenersExceededWarning（11 close listeners / 11 error listeners）。
// ---------------------------------------------------------------------------

describe('awaitDrainOrClose: SSE backpressure listener cleanup', () => {
  it('removes drain/close/error listeners after drain wins', async () => {
    const res = new EventEmitter();
    const p = awaitDrainOrClose(res, 1000);
    assert.equal(res.listenerCount('drain'), 1);
    assert.equal(res.listenerCount('close'), 1);
    assert.equal(res.listenerCount('error'), 1);
    res.emit('drain');
    await p;
    assert.equal(res.listenerCount('drain'), 0, 'drain listener removed');
    assert.equal(res.listenerCount('close'), 0, 'close listener removed even though it didn\'t fire');
    assert.equal(res.listenerCount('error'), 0, 'error listener removed even though it didn\'t fire');
  });

  it('removes drain/close/error listeners after close wins', async () => {
    const res = new EventEmitter();
    const p = awaitDrainOrClose(res, 1000);
    res.emit('close');
    await p;
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
  });

  it('removes drain/close/error listeners after error wins', async () => {
    const res = new EventEmitter();
    const p = awaitDrainOrClose(res, 1000);
    res.emit('error');
    await p;
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
  });

  it('removes drain/close/error listeners after timeout fires (no drain ever emitted)', async () => {
    const res = new EventEmitter();
    const p = awaitDrainOrClose(res, 5);
    await p;
    assert.equal(res.listenerCount('drain'), 0, 'drain listener cleaned up on timeout');
    assert.equal(res.listenerCount('close'), 0, 'close listener cleaned up on timeout');
    assert.equal(res.listenerCount('error'), 0, 'error listener cleaned up on timeout');
  });

  it('regression: 20 sequential backpressure waits never accumulate listeners', async () => {
    const res = new EventEmitter();
    // 模拟一个常驻的 removeFromClients 监听器（server.js:1097-1098 那两个），
    // 验证 helper 的累计净增为 0，不会把这条常驻监听器顶到 maxListeners 之上。
    const permanent = () => {};
    res.on('close', permanent);
    res.on('error', permanent);
    const baseline = {
      drain: res.listenerCount('drain'),
      close: res.listenerCount('close'),
      error: res.listenerCount('error'),
    };
    for (let i = 0; i < 20; i++) {
      const p = awaitDrainOrClose(res, 1000);
      // 模拟 drain 排空 — 最常见的 happy path
      res.emit('drain');
      await p;
      assert.equal(res.listenerCount('drain'), baseline.drain, `drain count stable at iter ${i}`);
      assert.equal(res.listenerCount('close'), baseline.close, `close count stable at iter ${i}`);
      assert.equal(res.listenerCount('error'), baseline.error, `error count stable at iter ${i}`);
    }
  });

  it('regression: 20 sequential timeout waits never accumulate listeners', async () => {
    const res = new EventEmitter();
    for (let i = 0; i < 20; i++) {
      // 短超时模拟 5s 兜底触发
      await awaitDrainOrClose(res, 1);
      assert.equal(res.listenerCount('drain'), 0, `iter ${i} drain`);
      assert.equal(res.listenerCount('close'), 0, `iter ${i} close`);
      assert.equal(res.listenerCount('error'), 0, `iter ${i} error`);
    }
  });

  it('idempotent: extra non-error emits after resolution do not re-trigger anything', async () => {
    const res = new EventEmitter();
    const p = awaitDrainOrClose(res, 1000);
    res.emit('drain');
    await p;
    // 第二次 emit 不应该有任何挂着的 listener 接收 — 验证 cleanup 完整。
    // 不重发 'error'：EventEmitter 在没有 error listener 时 emit('error') 会抛，
    // 那是 EventEmitter 自身的语义不是 helper 的 bug；listenerCount=0 已足以证明
    // helper 把 error 监听器摘干净了。
    res.emit('close');
    res.emit('drain');
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
  });
});
