/**
 * branch-lib-log-stream.test.js
 *
 * 针对 server/lib/log-stream.js 的分支覆盖补强测试。
 * 仅新增,不改源码/不动既有测试。
 *
 * 目标未覆盖分支:
 *  - 53-54: 同步 iterateRawEntries 末尾 pending(无尾分隔符)的 yield
 *  - 228-232: streamReconstructedEntriesAsync 的 since 过滤分支
 *  - 250-251: streamReconstructedEntriesAsync 的 async flushSegment(entry) 段边界
 *  - 379-380: _collectDedup 的 __nokey_ 分支(无 ts+url 的条目)
 *  - 447-448: readTailEntries 重试耗尽后 fallback 到 _readTailFull
 *  - 457-458: 循环后 unreachable 兜底(论证不可达)
 */
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let mod;
before(async () => {
  mod = await import('../server/lib/log-stream.js');
});

// ------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------
function msg(role, text) {
  return { role, content: text };
}

const CHECKPOINT_INTERVAL = 10;

/** 模拟 interceptor 写入 delta 日志(与 log-stream.test.js 一致) */
function simulateInterceptorWrites(logFile, turns) {
  let lastMessagesCount = 0;
  let deltaCount = 0;
  const fullConversation = [];

  for (const turn of turns) {
    fullConversation.push(...turn.newMessages);
    const allMessages = [...fullConversation];
    deltaCount++;

    const needsCheckpoint =
      lastMessagesCount === 0 ||
      allMessages.length < lastMessagesCount ||
      (deltaCount % CHECKPOINT_INTERVAL === 0);

    const entry = {
      timestamp: new Date(Date.now() + deltaCount * 1000).toISOString(),
      url: 'https://api.anthropic.com/v1/messages',
      mainAgent: turn.mainAgent !== undefined ? turn.mainAgent : true,
      body: { model: 'claude-opus-4-6', system: [{ type: 'text', text: 'You are helpful.' }] },
      response: { status: 200, body: { content: [{ type: 'text', text: `r-${deltaCount}` }] } },
      duration: 100,
    };

    if (turn.mainAgent === false) {
      entry.body.messages = [...allMessages];
      entry.teammate = turn.teammate || 'worker-1';
      entry.teamName = 'test-team';
    } else if (needsCheckpoint) {
      entry._deltaFormat = 1;
      entry._totalMessageCount = allMessages.length;
      entry._conversationId = 'mainAgent';
      entry._isCheckpoint = true;
      entry.body.messages = [...allMessages];
    } else {
      entry._deltaFormat = 1;
      entry._totalMessageCount = allMessages.length;
      entry._conversationId = 'mainAgent';
      entry._isCheckpoint = false;
      entry.body.messages = allMessages.slice(lastMessagesCount);
    }

    const inProgressEntry = { ...entry, inProgress: true, requestId: `req_${deltaCount}` };
    appendFileSync(logFile, JSON.stringify(inProgressEntry) + '\n---\n');
    appendFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    if (entry.mainAgent !== false) lastMessagesCount = allMessages.length;
  }
  return fullConversation;
}

function collectSyncRecon(filePath, opts = {}) {
  const all = [];
  mod.streamReconstructedEntries(filePath, (seg) => { all.push(...seg); }, opts);
  return all;
}

async function collectAsyncRecon(filePath, opts = {}) {
  const all = [];
  await mod.streamReconstructedEntriesAsync(filePath, (seg) => { all.push(...seg); }, opts);
  return all;
}

let tmpDir;
let logFile;

describe('iterateRawEntries 末尾 pending(同步路径)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-ls-'));
    logFile = join(tmpDir, 'test.jsonl');
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('文件末尾无分隔符时,最后一条仍被同步路径 yield(覆盖 53-54)', () => {
    // 两条 mainAgent 旧格式条目,最后一条不带尾部 \n---\n → 留在 pending
    const e1 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a')] } };
    const e2 = { timestamp: '2026-01-01T00:01:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] } };
    // 注意: 第二条没有结尾分隔符
    writeFileSync(logFile, JSON.stringify(e1) + '\n---\n' + JSON.stringify(e2));

    const out = collectSyncRecon(logFile);
    assert.equal(out.length, 2, '末尾 pending 条目应被读取');
    assert.equal(out[1].body.messages.length, 2);
  });

  it('整个文件只有一条且无分隔符(纯 pending)', () => {
    const e1 = { timestamp: '2026-02-02T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'x')] } };
    writeFileSync(logFile, JSON.stringify(e1)); // 无任何分隔符
    const out = collectSyncRecon(logFile);
    assert.equal(out.length, 1);
  });

  it('分隔符之间存在空段时跳过(覆盖 if(!trimmed) continue 真分支)', () => {
    const e1 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a')] } };
    // 连续分隔符之间留空段 → trimmed 为 '' → continue
    writeFileSync(logFile, JSON.stringify(e1) + '\n---\n\n---\n   \n---\n');
    const out = collectSyncRecon(logFile);
    assert.equal(out.length, 1, '空段应被跳过,仅保留一条有效条目');
  });

  it('全部为非法 JSON 时同步 recon 返回空(覆盖 catch continue + 空段 flush 提前 return)', () => {
    // 每条都无法 JSON.parse → continue → currentSegment 始终为空 → 最终 flushSegment(null) 命中 length===0 return
    writeFileSync(logFile, 'not json\n---\n{broken\n---\nalso bad\n---\n');
    const out = collectSyncRecon(logFile);
    assert.equal(out.length, 0, '非法 JSON 全部跳过');
  });
});

describe('streamReconstructedEntriesAsync since + 段边界', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-ls-'));
    logFile = join(tmpDir, 'test.jsonl');
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('async 跨 checkpoint 边界(15轮)触发 await flushSegment(entry)(覆盖 250-251)', async () => {
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let segCount = 0;
    await mod.streamReconstructedEntriesAsync(logFile, () => { segCount++; }, {});
    assert.ok(segCount >= 2, `跨 checkpoint 应产生多段,实际 ${segCount}`);
  });

  it('async + since 只返回时间戳之后的条目(覆盖 228-232)', async () => {
    const turns = [];
    for (let i = 0; i < 15; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    const all = await collectAsyncRecon(logFile);
    assert.ok(all.length > 0);
    const midTs = all[Math.floor(all.length / 2)].timestamp;

    const filtered = await collectAsyncRecon(logFile, { since: midTs });
    assert.ok(filtered.length < all.length, 'since 过滤后应更少');
    assert.ok(filtered.length > 0, 'since 过滤后应仍有条目');
    for (const e of filtered) {
      assert.ok(new Date(e.timestamp).getTime() > new Date(midTs).getTime(),
        `${e.timestamp} 应晚于 since ${midTs}`);
    }
  });

  it('async + since 在所有条目之后 → 段全部被过滤为空,不调用 onSegment', async () => {
    const turns = [];
    for (let i = 0; i < 12; i++) {
      turns.push({ newMessages: [msg('user', `q${i}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(logFile, turns);

    let onSegmentCalls = 0;
    const result = await mod.streamReconstructedEntriesAsync(logFile, () => { onSegmentCalls++; }, {
      since: '2099-01-01T00:00:00.000Z',
    });
    assert.equal(result, 0, 'since 全过滤后 sentCount 为 0');
    assert.equal(onSegmentCalls, 0, 'toSend 为空时不应调用 onSegment');
  });

  it('全部为非法 JSON 时 async recon 返回空(覆盖 async catch continue + 空段 flush return)', async () => {
    writeFileSync(logFile, 'xxx\n---\n{nope\n---\nzzz\n---\n');
    const out = await collectAsyncRecon(logFile);
    assert.equal(out.length, 0, 'async: 非法 JSON 全部跳过');
  });

  it('async 路径分隔符之间存在空段时跳过(覆盖 async if(!trimmed) continue)', async () => {
    const e1 = { timestamp: '2026-01-01T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a')] } };
    // 走 streamRawEntriesAsync(异步 generator) → 命中 async 迭代器的空段跳过
    writeFileSync(logFile, JSON.stringify(e1) + '\n---\n\n---\n   \n---\n');
    const raws = [];
    await mod.streamRawEntriesAsync(logFile, (r) => raws.push(r));
    assert.equal(raws.length, 1, 'async: 空段应被跳过');
  });

  it('async since 处理无 timestamp 的条目(ts ? : 0 分支)', async () => {
    // 旧格式全量条目,其中一条没有 timestamp 字段
    const e1 = { url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a')] } };
    const e2 = { timestamp: '2026-03-03T00:00:00Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a'), msg('assistant', 'b')] } };
    writeFileSync(logFile, [JSON.stringify(e1), JSON.stringify(e2)].join('\n---\n') + '\n---\n');

    // since 设为很早 → e2 通过; e1 无 ts → getTime()=0 不会 > sinceMs(>0) → 被过滤
    const filtered = await collectAsyncRecon(logFile, { since: '2026-01-01T00:00:00Z' });
    assert.ok(filtered.some(e => e.timestamp === '2026-03-03T00:00:00Z'), '有 ts 的条目应通过');
  });
});

describe('streamRawEntriesAsync onReady 在不存在文件时调用(覆盖 290)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-ls-'));
    logFile = join(tmpDir, 'test.jsonl');
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('不存在文件 + onReady → onReady({totalCount:0}) 被调用', async () => {
    let readyInfo = 'not-called';
    const result = await mod.streamRawEntriesAsync(
      join(tmpDir, 'missing.jsonl'),
      () => { throw new Error('onRawEntry 不应被调用'); },
      { onReady: (info) => { readyInfo = info; } },
    );
    assert.deepEqual(result, { sentCount: 0, totalCount: 0 });
    assert.notEqual(readyInfo, 'not-called', 'onReady 应被调用');
    assert.equal(readyInfo.totalCount, 0);
  });
});

describe('_collectDedup __nokey_ 分支(tail / paged 路径)', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-ls-'));
    logFile = join(tmpDir, 'test.jsonl');
  });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('readTailEntries 处理无 ts/url 的条目(覆盖 379-380)', async () => {
    const normal = { timestamp: '2026-01-01T00:00:00.000Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a')] } };
    const noKey1 = { type: 'special', data: 'no-ts-no-url-1' };
    const noKey2 = { type: 'special', data: 'no-ts-no-url-2' };
    writeFileSync(logFile,
      [JSON.stringify(normal), JSON.stringify(noKey1), JSON.stringify(noKey2)].join('\n---\n') + '\n---\n');

    const result = await mod.readTailEntries(logFile, { limit: 100 });
    // 三条都应保留(两条 __nokey_ 不互相覆盖)
    assert.equal(result.entries.length, 3, '无 key 条目应各自独立保留');
  });

  it('readTailEntries 首条无 timestamp → oldestTimestamp 兜底为空串(覆盖 _readTailFull || \'\')', async () => {
    // 第一条无 ts/url(__nokey_) → 作为 sliced[0] → extractTimestamp 返回 null → || ''
    const noKey = { type: 'special', data: 'leading-nokey' };
    const normal = { timestamp: '2026-05-05T00:00:00.000Z', url: '/v1/messages', mainAgent: true, body: { messages: [msg('user', 'a')] } };
    writeFileSync(logFile,
      [JSON.stringify(noKey), JSON.stringify(normal)].join('\n---\n') + '\n---\n');

    const result = await mod.readTailEntries(logFile, { limit: 100 });
    assert.equal(result.entries.length, 2);
    const first = JSON.parse(result.entries[0]);
    assert.equal(first.type, 'special', '首条应为无 ts 的 __nokey_');
    assert.equal(result.oldestTimestamp, '', '首条无 ts 时 oldestTimestamp 应兜底空串');
  });

  it('仅含空白/分隔符的文件 → _readTailFull totalCount===0(覆盖 465)', async () => {
    // 文件大小 > 0 但所有段 trim 后为空 → dedup 为空 → totalCount===0 提前 return
    writeFileSync(logFile, '   \n---\n\n---\n\t\n---\n');
    const result = await mod.readTailEntries(logFile, { limit: 10 });
    assert.equal(result.entries.length, 0);
    assert.equal(result.hasMore, false);
    assert.equal(result.estimatedTotal, 0);
  });

});

describe('readTailEntries 重试耗尽 fallback(>8MB 文件)', () => {
  let bigDir;
  let bigFile;
  before(() => {
    bigDir = mkdtempSync(join(tmpdir(), 'ccv-branch-ls-big-'));
    bigFile = join(bigDir, 'big.jsonl');
    // 构造 >8MB 文件: 仅文件头部有一个 checkpoint,后续全是大 delta。
    // tail 窗口 2MB→4MB→8MB 均无法回退到头部 checkpoint → 三次都 needsRetry
    // → attempt===MAX_RETRIES 时 fallback 到 _readTailFull(覆盖 447-448)。
    writeFileSync(bigFile, '');
    // 1 轮: 产生头部 checkpoint
    simulateInterceptorWrites(bigFile, [{ newMessages: [msg('user', 'initial'), msg('assistant', 'start')] }]);
    // 后续大 delta: 每条 ~1MB content, 写满 > 8MB
    const bigContent = 'z'.repeat(900000);
    const moreTurns = [];
    for (let i = 1; i <= 12; i++) {
      moreTurns.push({ newMessages: [msg('user', `q${i}-${bigContent}`), msg('assistant', `a${i}`)] });
    }
    simulateInterceptorWrites(bigFile, moreTurns);
  });
  after(() => { rmSync(bigDir, { recursive: true, force: true }); });

  it('窗口内始终无 checkpoint → 重试耗尽 fallback 全文件读(覆盖 447-448)', async () => {
    const fileSize = statSync(bigFile).size;
    assert.ok(fileSize > 8 * 1024 * 1024, `文件需 >8MB 才能耗尽重试,实际 ${fileSize}`);

    const result = await mod.readTailEntries(bigFile, { limit: 5 });
    assert.ok(result.entries.length >= 5, '应返回条目');
    // fallback 走 _readTailFull → 全文件读 → 找到头部 checkpoint
    const first = JSON.parse(result.entries[0]);
    const isCheckpoint = first._isCheckpoint === true || !first._deltaFormat;
    assert.ok(isCheckpoint, 'fallback 全文件读后首条应为 checkpoint');
  });
});
