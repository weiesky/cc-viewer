// Async Write Queue — 非阻塞追加写入，替代 appendFileSync
// 单写者模式保证写入顺序，进程退出时回退同步写入保证不丢数据

import { appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';

const HIGH_WATER_MARK = 50 * 1024 * 1024; // 50MB — backlog 超过此值降级为同步写入
const WRITE_CHUNK_BYTES = 8 * 1024 * 1024; // 8MB — 单次 async append 上限，巨条分块让出 FS handle

export class AsyncWriteQueue {
  /**
   * @param {string|(() => string)} pathOrGetter - 文件路径或返回路径的函数（支持动态路径）
   * @param {object} [opts]
   * @param {boolean} [opts.syncMode] - 强制同步模式
   * @param {number} [opts.highWaterMark] - backlog 同步降级阈值（默认 50MB；测试用）
   */
  constructor(pathOrGetter, opts = {}) {
    this._pathOrGetter = pathOrGetter;
    this._queue = [];          // { path: string, data: string, onDone?: Function }[]
    this._pendingBytes = 0;
    this._draining = false;
    this._drainPromise = null;
    this._closed = false;
    this._flushResolvers = []; // resolve() callbacks waiting for flush()
    this._syncMode = opts.syncMode || !!process.env.CCV_SYNC_WRITES;
    // typeof 防御：字符串 "1000" 能通过 > 0 协转检查，但后续字节比较会退化为字典序
    this._highWaterMark = (typeof opts.highWaterMark === 'number' && opts.highWaterMark > 0)
      ? opts.highWaterMark : HIGH_WATER_MARK;
  }

  _getPath() {
    return typeof this._pathOrGetter === 'function' ? this._pathOrGetter() : this._pathOrGetter;
  }

  get filePath() { return this._getPath(); }
  get pendingBytes() { return this._pendingBytes; }

  append(data, onDone) {
    return this.appendTo(this._getPath(), data, onDone);
  }

  /**
   * Explicit-path variant (wire-v2 S2): same queue, same ordering/drain
   * machinery, caller supplies the target file. Within one drain batch, path
   * groups are written in first-enqueue order, so a caller enqueuing
   * conversation lines before the journal line keeps that relative order on
   * disk (WIRE_FORMAT_V2.md §1.3 write-order protocol). Empty/falsy path stays
   * a silent no-op — workspace mode and leaderless teammates rely on it.
   */
  appendTo(path, data, onDone) {
    if (this._closed) return;
    if (!path) {
      if (onDone) try { onDone(); } catch {}
      return;
    }

    // 同步降级是 backlog 的内存压力保护，不是按条规则：
    // - 单条超大 buffer（-c 重启后的全量 checkpoint，可达数十 MB）必须走异步 ——
    //   对它 appendFileSync 正是 Windows event loop 卡死点；其内存代价 ≈ 字符串本就在内存。
    // - drain 在途时绝不抢同步（正确性硬约束）：_drain 现按 8MB 分块写，appendFileSync
    //   插队会落在分块中间、把条目撕裂进另一条 JSON 内部。又因"队列非空 ⇒ 必已 scheduleDrain
    //   ⇒ _draining=true"，这条 backlog 同步分支实际只是防御性兜底，正常运行不会触发。
    const byteLen = Buffer.byteLength(data);
    const wouldExceed = this._pendingBytes + byteLen >= this._highWaterMark;
    const oversizedSingle = byteLen >= this._highWaterMark;
    if (this._syncMode || (wouldExceed && !oversizedSingle && !this._draining)) {
      try { appendFileSync(path, data); } catch {}
      if (onDone) try { onDone(); } catch {}
      return;
    }

    this._queue.push({ path, data, onDone });
    this._pendingBytes += byteLen;
    this._scheduleDrain();
  }

  async flush() {
    if (this._queue.length === 0 && !this._draining) return;
    return new Promise(resolve => {
      this._flushResolvers.push(resolve);
      this._scheduleDrain();
    });
  }

  async close() {
    this._closed = true;
    // 等待 in-flight 异步 drain 完成，防止退出时丢失正在写入的数据
    if (this._drainPromise) {
      try { await this._drainPromise; } catch {}
    }
    // 同步兜底：排空 drain 完成后可能新入队的剩余项
    this._drainSync();
  }

  // Synchronous drain for process exit — guarantees no data loss
  _drainSync() {
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      try {
        appendFileSync(item.path, item.data);
        if (item.onDone) item.onDone();
      } catch {}
    }
    this._pendingBytes = 0;
    for (const resolve of this._flushResolvers) resolve();
    this._flushResolvers.length = 0;
  }

  _scheduleDrain() {
    if (this._draining) return;
    this._draining = true;
    // queueMicrotask 批量收集同 tick 的 append 调用
    queueMicrotask(() => { this._drainPromise = this._drain(); });
  }

  async _drain() {
    while (this._queue.length > 0) {
      // Group by path — entries for the same file are batched together
      const batch = this._queue.splice(0);
      const byPath = new Map();
      for (const item of batch) {
        if (!byPath.has(item.path)) byPath.set(item.path, []);
        byPath.get(item.path).push(item);
      }

      for (const [path, items] of byPath) {
        const callbacks = [];
        let combined = '';
        for (const item of items) {
          combined += item.data;
          if (item.onDone) callbacks.push(item.onDone);
        }

        try {
          // 巨条分块：单次 async append 超过 8MB 时按字节切片顺序写，
          // 避免一次巨型写独占 FS handle（Windows NTFS 上拖垮其它 I/O）。
          // 必须按 Buffer 字节切（而非字符串 slice），否则多字节 UTF-8 字符
          // 跨界会被 per-call 编码撕裂成乱码。顺序 await 保证落盘顺序。
          // Buffer.from 对超大 combined 有一次性内存翻倍（30MB 串 → +30MB Buffer），
          // 循环结束即释放，等价于字符串自身的量级，可接受。
          const buf = Buffer.from(combined, 'utf-8');
          if (buf.length <= WRITE_CHUNK_BYTES) {
            await appendFile(path, buf);
          } else {
            for (let pos = 0; pos < buf.length; pos += WRITE_CHUNK_BYTES) {
              await appendFile(path, buf.subarray(pos, pos + WRITE_CHUNK_BYTES));
            }
          }
        } catch {}
        for (const cb of callbacks) {
          try { cb(); } catch {}
        }
      }

      let totalBytes = 0;
      for (const [, items] of byPath) {
        for (const item of items) totalBytes += Buffer.byteLength(item.data);
      }
      this._pendingBytes -= totalBytes;
      if (this._pendingBytes < 0) this._pendingBytes = 0;
    }

    this._draining = false;

    for (const resolve of this._flushResolvers) resolve();
    this._flushResolvers.length = 0;
  }
}
