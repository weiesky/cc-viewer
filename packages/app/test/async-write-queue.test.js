import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AsyncWriteQueue } from '../server/lib/async-write-queue.js';

describe('AsyncWriteQueue', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'awq-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should append data to file', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('hello\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'hello\n---\n');
    await queue.close();
  });

  it('should batch multiple appends in one tick', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('a\n---\n');
    queue.append('b\n---\n');
    queue.append('c\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'a\n---\nb\n---\nc\n---\n');
    await queue.close();
  });

  it('should preserve write order across ticks', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('first\n---\n');
    await queue.flush();
    queue.append('second\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'first\n---\nsecond\n---\n');
    await queue.close();
  });

  it('should call onDone callbacks after write', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    let callbackCalled = false;
    queue.append('data\n---\n', () => { callbackCalled = true; });
    await queue.flush();
    assert.ok(callbackCalled);
    await queue.close();
  });

  it('should support dynamic path via getter', async () => {
    const file1 = join(tmpDir, 'log1.jsonl');
    const file2 = join(tmpDir, 'log2.jsonl');
    let currentPath = file1;
    const queue = new AsyncWriteQueue(() => currentPath);
    queue.append('old-data\n---\n');
    await queue.flush();
    currentPath = file2;
    queue.append('new-data\n---\n');
    await queue.flush();
    assert.equal(readFileSync(file1, 'utf-8'), 'old-data\n---\n');
    assert.equal(readFileSync(file2, 'utf-8'), 'new-data\n---\n');
    await queue.close();
  });

  it('should use sync mode when CCV_SYNC_WRITES is set', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath, { syncMode: true });
    queue.append('sync-data\n---\n');
    // Sync mode writes immediately, no need to flush
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'sync-data\n---\n');
    await queue.close();
  });

  it('should handle close with pending data', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('pending\n---\n');
    await queue.close();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'pending\n---\n');
  });

  it('should handle empty flush', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    await queue.flush(); // should not throw
    await queue.close();
  });

  it('should track pendingBytes', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    assert.equal(queue.pendingBytes, 0);
    queue.append('data');
    assert.ok(queue.pendingBytes > 0);
    await queue.flush();
    assert.equal(queue.pendingBytes, 0);
    await queue.close();
  });

  it('should ignore appends after close', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('before\n---\n');
    await queue.close();
    queue.append('after\n---\n');
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'before\n---\n');
  });

  it('should handle concurrent flushes', async () => {
    const filePath = join(tmpDir, 'test.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('a');
    const [r1, r2] = await Promise.all([queue.flush(), queue.flush()]);
    assert.equal(r1, undefined);
    assert.equal(r2, undefined);
    await queue.close();
  });

  // ─── 巨条防同步阻塞（-c 全量 checkpoint 场景）────────────────────────────
  // opts.highWaterMark 仅测试用：默认 50MB 在单测里分配不现实

  it('oversized single buffer stays ASYNC even with empty queue (核心回归锁)', async () => {
    const filePath = join(tmpDir, 'big.log');
    const queue = new AsyncWriteQueue(filePath, { highWaterMark: 1000 });
    const big = 'x'.repeat(1500) + '\n---\n';
    queue.append(big);
    // 异步路径 = 同 tick 内只入队不落盘；同步路径（appendFileSync）会立即建文件
    assert.ok(queue.pendingBytes >= 1500, '巨条必须入队（异步）');
    assert.equal(existsSync(filePath), false, '同 tick 文件不应存在 —— appendFileSync 即回归');
    await queue.flush();
    assert.equal(readFileSync(filePath, 'utf-8'), big);
    await queue.close();
  });

  it('oversized buffer arriving on top of existing backlog still goes async', async () => {
    const filePath = join(tmpDir, 'big2.log');
    const queue = new AsyncWriteQueue(filePath, { highWaterMark: 1000 });
    queue.append('small-1\n---\n');           // 触发 scheduleDrain（_draining=true）
    const big = 'y'.repeat(2000) + '\n---\n'; // backlog + 巨条远超 HWM
    queue.append(big);
    assert.ok(queue.pendingBytes >= 2000, '巨条入队而非同步插队');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content, 'small-1\n---\n' + big, '落盘顺序与 append 顺序一致');
    await queue.close();
  });

  it('drain 在途时小条不抢同步（同步插队会撕裂分块写中的条目）', async () => {
    const filePath = join(tmpDir, 'order.log');
    const queue = new AsyncWriteQueue(filePath, { highWaterMark: 100 });
    queue.append('a'.repeat(150) + '\n---\n'); // 巨条（>HWM）异步入队，_draining=true
    queue.append('tail\n---\n');               // wouldExceed 但 draining → 入队不同步
    assert.equal(existsSync(filePath), false, '小条不得 appendFileSync 插队');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.endsWith('tail\n---\n'), '小条排在巨条之后');
    assert.equal(content.length, 150 + 5 + 'tail\n---\n'.length);
    await queue.close();
  });

  it('chunked write: 多字节 UTF-8 跨 8MB 块边界往返一致', async () => {
    const filePath = join(tmpDir, 'utf8.log');
    const queue = new AsyncWriteQueue(filePath);
    // 8MB 块边界附近铺满 3 字节 CJK：字符串 slice 切块必撕裂，Buffer.subarray 字节切则无损
    const CHUNK = 8 * 1024 * 1024;
    const cjk = '汉'.repeat(Math.ceil((CHUNK + 64) / 3) + 8); // 字节数刚越过一个块边界
    const data = cjk + '\n---\n';
    queue.append(data);
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.equal(content.length, data.length, '长度一致');
    assert.equal(content, data, '内容一致（块边界无乱码）');
    await queue.close();
  });

  it('chunked write 后续小条落盘顺序不乱', async () => {
    const filePath = join(tmpDir, 'seq.log');
    const queue = new AsyncWriteQueue(filePath);
    const big = 'z'.repeat(9 * 1024 * 1024) + '\n---\n'; // 跨 2 个块
    queue.append(big);
    await queue.flush();
    queue.append('after\n---\n');
    await queue.flush();
    const content = readFileSync(filePath, 'utf-8');
    assert.ok(content.startsWith('zzz'));
    assert.ok(content.endsWith('after\n---\n'));
    assert.equal(content.length, big.length + 'after\n---\n'.length);
    await queue.close();
  });

  it('opts.highWaterMark 缺省时不影响既有行为（小数据全异步）', async () => {
    const filePath = join(tmpDir, 'default.log');
    const queue = new AsyncWriteQueue(filePath);
    queue.append('normal\n---\n');
    assert.equal(existsSync(filePath), false, '默认 50MB 阈值下小条走异步');
    await queue.flush();
    assert.equal(readFileSync(filePath, 'utf-8'), 'normal\n---\n');
    await queue.close();
  });
});
