/**
 * Log Stream — 流式分段读取模块
 *
 * 关键设计：server 不做 delta 重建，只做去重和流式发送。
 * 重建交给客户端（浏览器内存更充裕）。
 *
 * 内存控制：
 * - 文件读取：openSync + readSync 1MB 分块，generator 逐条 yield
 * - 去重：用 regex 提取 key，不做 JSON.parse（存原始字符串）
 * - 异步发送：逐条 write + 定期 setImmediate yield（GC + buffer drain）
 */

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { open as fsOpen, stat as fsStat } from 'node:fs/promises';
import { isCheckpointEntry, isDeltaEntry, reconstructSegment } from './delta-reconstructor.js';
import { isV2SessionDir, iterateV2RawEntries, iterateV2RawEntriesAsync, readV2WindowedEntries, streamV2WindowedEntries } from './v2/adapter.js';

const READ_CHUNK_SIZE = 1024 * 1024; // 1MB
const SEPARATOR = '\n---\n';

/**
 * Generator：分块读取 JSONL 文件，逐条 yield 原始 JSON 字符串。
 * 内存 = 1MB buffer + pending。
 */
function* iterateRawEntries(filePath) {
  // wire-v2 S5: a session DIRECTORY resolves to the v2→v1 adapter stream — the
  // synthesized entries feed every downstream consumer unchanged (spec §11).
  if (isV2SessionDir(filePath)) {
    yield* iterateV2RawEntries(filePath);
    return;
  }
  const fileSize = statSync(filePath).size;
  if (fileSize === 0) return;

  const fd = openSync(filePath, 'r');
  const buf = Buffer.alloc(Math.min(READ_CHUNK_SIZE, fileSize));
  let offset = 0;
  let pending = '';

  try {
    while (offset < fileSize) {
      const toRead = Math.min(buf.length, fileSize - offset);
      const bytesRead = readSync(fd, buf, 0, toRead, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;

      const raw = pending + buf.toString('utf-8', 0, bytesRead);
      const parts = raw.split(SEPARATOR);
      pending = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) yield trimmed;
      }
    }

    if (pending.trim()) {
      yield pending.trim();
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * 异步 Generator：分块读取 JSONL 文件，逐条 yield 原始 JSON 字符串。
 * 使用 fs.promises.open + fileHandle.read，不阻塞事件循环。
 *
 * @param {string} filePath
 * @param {{ startOffset?: number }} [opts] - startOffset>0 时从该偏移量开始读取并跳过首条（可能被截断）
 */
// Exported since wire-v2 S4: the verify tool needs a SINGLE streaming pass —
// streamRawEntriesAsync's dedup map (~half the file resident) plus its second
// send pass are pure waste for a scan-only consumer (review P2).
export async function* iterateRawEntriesAsync(filePath, { startOffset = 0 } = {}) {
  // wire-v2 S5: adapter branch. startOffset is a BYTE offset into a physical
  // file — meaningless for a synthesized stream, so v2 always reads in full
  // (readTailEntries routes v2 through its full-read path for the same reason).
  if (isV2SessionDir(filePath)) {
    yield* iterateV2RawEntriesAsync(filePath);
    return;
  }
  let fh;
  try {
    const st = await fsStat(filePath);
    if (st.size === 0) return;
    fh = await fsOpen(filePath, 'r');
    const fileSize = st.size;
    const buf = Buffer.alloc(Math.min(READ_CHUNK_SIZE, fileSize - startOffset));
    let offset = startOffset;
    let pending = '';
    let isFirst = startOffset > 0;

    while (offset < fileSize) {
      const toRead = Math.min(buf.length, fileSize - offset);
      const { bytesRead } = await fh.read(buf, 0, toRead, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;

      const raw = pending + buf.toString('utf-8', 0, bytesRead);
      const parts = raw.split(SEPARATOR);
      pending = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (isFirst) { isFirst = false; continue; }
        yield trimmed;
      }
    }

    if (pending.trim()) {
      if (isFirst) return;
      yield pending.trim();
    }
  } finally {
    if (fh) await fh.close();
  }
}

/**
 * 轻量预扫描：统计条目总数（原始条目数，不去重）。
 * 用于 SSE load_start 的 total 字段（进度显示）。
 */
export async function countLogEntries(filePath) {
  if (!existsSync(filePath)) return 0;
  let count = 0;
  for await (const _ of iterateRawEntriesAsync(filePath)) { count++; }
  return count;
}

/** 用 regex 从原始 JSON 字符串中提取 timestamp（不做 JSON.parse） */
function extractTimestamp(raw) {
  const m = raw.match(/"timestamp"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

/** 用 regex 从原始 JSON 字符串中提取 timestamp|url 去重 key（不做 JSON.parse） */
function extractDedupKey(raw) {
  const ts = extractTimestamp(raw);
  const urlMatch = raw.match(/"url"\s*:\s*"([^"]+)"/);
  if (ts && urlMatch) return `${ts}|${urlMatch[1]}`;
  // fallback: 无法提取 key 时返回 null；调用方改用位置键 __nokey_<index> 入表（非内容哈希）。
  return null;
}

/**
 * 对原始 JSON 字符串用 regex 检测是否为 checkpoint（不做 JSON.parse）。
 * - 匹配 `"_isCheckpoint":true` → 显式 checkpoint
 * - 或不包含 `"_deltaFormat"` → 旧格式全量条目，天然 checkpoint
 */
function isCheckpointRaw(raw) {
  if (/"_isCheckpoint"\s*:\s*true/.test(raw)) return true;
  if (!raw.includes('"_deltaFormat"')) return true;
  return false;
}

function isSegmentBoundary(entry) {
  if (!entry.mainAgent) return false;
  if (!entry._deltaFormat) return true;
  return isCheckpointEntry(entry);
}

// ============================================================================
// 同步 API — 重建为全量格式的同步变体（当前无生产消费者，保留给测试与未来批处理；退役评估归 wire-v2 S6c）
// ============================================================================

export function streamReconstructedEntries(filePath, onSegment, opts = {}) {
  if (!existsSync(filePath)) return 0;
  const stat = statSync(filePath);
  if (stat.size === 0) return 0;

  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;
  let currentSegment = [];
  let dedup = new Map();
  let sentCount = 0;
  // 跨段共享 seq 守卫状态：stale checkpoint 自成段边界，必须文件级跟踪才能识破乱序
  const seqState = { lastSeq: 0, lastEpoch: null };

  function flushSegment(nextCp) {
    if (currentSegment.length === 0) return;
    const dedupedSegment = Array.from(dedup.values());
    reconstructSegment(dedupedSegment, nextCp, seqState);

    let toSend = dedupedSegment;
    if (sinceMs) {
      toSend = dedupedSegment.filter(e => {
        const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
        return ts > sinceMs;
      });
    }
    if (toSend.length > 0) {
      onSegment(toSend);
      sentCount += toSend.length;
    }
    currentSegment = [];
    dedup = new Map();
  }

  for (const rawEntry of iterateRawEntries(filePath)) {
    let entry;
    try { entry = JSON.parse(rawEntry); } catch { continue; }

    if (isSegmentBoundary(entry) && currentSegment.length > 0) {
      const key = `${entry.timestamp}|${entry.url}`;
      const last = currentSegment[currentSegment.length - 1];
      const lastKey = `${last.timestamp}|${last.url}`;
      if (key !== lastKey) {
        flushSegment(entry);
      }
    }

    const key = `${entry.timestamp}|${entry.url}`;
    dedup.set(key, entry);
    currentSegment.push(entry);
  }

  flushSegment(null);
  return sentCount;
}

export async function streamReconstructedEntriesAsync(filePath, onSegment, opts = {}) {
  if (!existsSync(filePath)) return 0;
  try {
    const st = await fsStat(filePath);
    if (st.size === 0) return 0;
  } catch { return 0; }

  const sinceMs = opts.since ? new Date(opts.since).getTime() : 0;
  let currentSegment = [];
  let dedup = new Map();
  let sentCount = 0;
  // 跨段共享 seq 守卫状态：stale checkpoint 自成段边界，必须文件级跟踪才能识破乱序
  const seqState = { lastSeq: 0, lastEpoch: null };

  async function flushSegment(nextCp) {
    if (currentSegment.length === 0) return;
    const dedupedSegment = Array.from(dedup.values());
    reconstructSegment(dedupedSegment, nextCp, seqState);

    let toSend = dedupedSegment;
    if (sinceMs) {
      toSend = dedupedSegment.filter(e => {
        const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
        return ts > sinceMs;
      });
    }
    if (toSend.length > 0) {
      await onSegment(toSend);
      sentCount += toSend.length;
    }
    currentSegment = [];
    dedup = new Map();
  }

  for await (const rawEntry of iterateRawEntriesAsync(filePath)) {
    let entry;
    try { entry = JSON.parse(rawEntry); } catch { continue; }

    if (isSegmentBoundary(entry) && currentSegment.length > 0) {
      const key = `${entry.timestamp}|${entry.url}`;
      const last = currentSegment[currentSegment.length - 1];
      const lastKey = `${last.timestamp}|${last.url}`;
      if (key !== lastKey) {
        await flushSegment(entry);
      }
    }

    const key = `${entry.timestamp}|${entry.url}`;
    dedup.set(key, entry);
    currentSegment.push(entry);
  }

  await flushSegment(null);
  return sentCount;
}

// ============================================================================
// 异步 API — 用于 SSE/HTTP：不做重建，直接发原始 JSON 字符串
// ============================================================================

/**
 * 异步流式发送原始条目（不重建 delta）。
 *
 * - 用 generator 逐条读取原始 JSON 字符串
 * - regex 提取 key 去重（后出现的覆盖先出现的）
 * - 逐条调用 onRawEntry(rawJsonString)
 * - 每 N 条 setImmediate yield 让 GC + write buffer drain
 *
 * server 不做 JSON.parse / JSON.stringify / reconstruct = 内存峰值极低。
 * 客户端收到后自行 reconstructEntries()。
 *
 * @param {string} filePath
 * @param {(rawJson: string) => void} onRawEntry - 原始 JSON 字符串回调
 * @param {object} [opts]
 * @param {string} [opts.since] - ISO 时间戳，只发送 timestamp >= since 的条目
 * @param {number} [opts.limit] - 只发送最新 N 条（去重后），向前扩展到 checkpoint 边界
 * @param {(raw: string) => void} [opts.onScan] - Pass 1 中对每条原始条目调用（不受 since 影响）
 * @param {(info: {totalCount: number, hasMore?: boolean, oldestTs?: string}) => void} [opts.onReady] - Pass 1 完成、Pass 2 开始前调用
 * @returns {Promise<{sentCount: number, totalCount: number}>}
 */
export async function streamRawEntriesAsync(filePath, onRawEntry, opts = {}) {
  const empty = { sentCount: 0, totalCount: 0 };
  if (!existsSync(filePath)) { if (opts.onReady) opts.onReady({ totalCount: 0 }); return empty; }
  // v2 session dirs skip the size probe: a directory's st.size is 0 on some
  // filesystems (Windows) and never reflects the synthesized stream anyway.
  if (!isV2SessionDir(filePath)) {
    const stat = statSync(filePath);
    if (stat.size === 0) { if (opts.onReady) opts.onReady({ totalCount: 0 }); return empty; }
  }

  const sinceFilter = opts.since || null;
  const onScan = opts.onScan || null;
  const onReady = opts.onReady || null;

  // v2 windowed path: the adapter guarantees a reconstructable baseline at the
  // window start (synthesized checkpoint), which the byte-tail heuristics below
  // cannot — expand-to-checkpoint over adapter output could walk arbitrarily
  // far back on a session with sparse organic snapshots.
  // S10a: streaming two-pass — `since` is pushed into window membership so the
  // /events incremental reconnect path materializes only the entries it will
  // send (the historical full materialization here was the primary OOM path).
  // onScan is retired on this branch: the newest-mainAgent raws come back as
  // `mainAgentRing` in the result instead (adapter P0-2).
  if (isV2SessionDir(filePath)) {
    // cached defaults FALSE here: streamRawEntriesAsync serves the /events
    // cold-load / live-attach and the workspaces live-source reload — these
    // suppress the ≤ttl cache READ (they must not start from a stale window).
    // Level-1 scan coalescing still collapses concurrent reconnects; the join
    // staleness is bounded by one in-flight scan (not the ttl) — see
    // singleflight.js cached=false note.
    const res = await streamV2WindowedEntries(
      filePath,
      { limit: opts.limit, since: sinceFilter, onReady, cached: opts.cached === true },
      onRawEntry,
    );
    await new Promise(resolve => setImmediate(resolve));
    return { sentCount: res.sentCount, totalCount: res.totalCount, mainAgentRing: res.mainAgentRing };
  }

  // 第一遍：异步 generator 逐条读取 → dedup Map 存原始字符串（不 parse）
  // 内存 = 去重后的原始字符串总量 ≈ 文件大小的一半（inProgress 被 completed 覆盖）
  const dedup = new Map();
  for await (const raw of iterateRawEntriesAsync(filePath)) {
    if (onScan) onScan(raw);
    const key = extractDedupKey(raw);
    if (key) {
      dedup.set(key, raw);
    } else {
      dedup.set(`__nokey_${dedup.size}`, raw);
    }
  }

  const totalCount = dedup.size;

  // limit 裁剪：只保留最新 N 条，向前扩展到 checkpoint 边界
  let sendMap = dedup;
  let hasMore = false;
  let oldestTs = null;
  const limitVal = opts.limit;

  if (limitVal && limitVal > 0 && totalCount > limitVal) {
    const allEntries = Array.from(dedup.entries());
    let startIdx = Math.max(0, allEntries.length - limitVal);
    // 向前扩展到最近的 checkpoint 边界
    while (startIdx > 0 && !isCheckpointRaw(allEntries[startIdx][1])) {
      startIdx--;
    }
    hasMore = startIdx > 0;
    const sliced = allEntries.slice(startIdx);
    sendMap = new Map(sliced);
    // 提取最早条目的 timestamp
    if (sliced.length > 0) {
      oldestTs = extractTimestamp(sliced[0][1]);
    }
  }

  // Pass 1 完成，通知调用方（server 可在此时发送 load_start）
  if (onReady) onReady({ totalCount, hasMore, oldestTs });

  // 第二遍：逐条发送 + 定期 yield + since 过滤
  let sentCount = 0;
  const YIELD_INTERVAL = 20; // 每 20 条 yield 一次

  for (const [key, raw] of sendMap) {
    // since 过滤：只发送 timestamp >= since 的条目
    // 注：字符串比较对 ISO 8601 等长格式（YYYY-MM-DDTHH:mm:ss.SSSZ）天然正确，
    // 此处 since 和 ts 均来自同一 interceptor 的 new Date().toISOString()，格式一致。
    if (sinceFilter && !key.startsWith('__nokey_')) {
      const ts = extractTimestamp(raw);
      if (ts && ts < sinceFilter) continue;
    }

    await onRawEntry(raw);
    sentCount++;
    if (sentCount % YIELD_INTERVAL === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  // 最终 yield 确保最后一批 buffer drain
  await new Promise(resolve => setImmediate(resolve));

  return { sentCount, totalCount };
}

// ============================================================================
// Tail Read — 从文件尾部高效读取最新条目（移动端首屏加载优化）
// ============================================================================

const TAIL_INITIAL_BYTES = 2 * 1024 * 1024; // 首次尝试读取末尾 2MB
const TAIL_FALLBACK_THRESHOLD = 2 * 1024 * 1024; // 小于此值直接全文件读（与 TAIL_INITIAL_BYTES 相等但概念独立）

/** 收集异步可迭代对象中的条目到 dedup Map（extractDedupKey + last-write-wins） */
async function _collectDedup(asyncIterable) {
  const dedup = new Map();
  for await (const raw of asyncIterable) {
    const key = extractDedupKey(raw);
    if (key) {
      dedup.set(key, raw);
    } else {
      dedup.set(`__nokey_${dedup.size}`, raw);
    }
  }
  return dedup;
}

/**
 * 从末尾取 limit 条 + 向前扩展到 checkpoint 边界。
 * @returns {{ sliced: string[], hasMore: boolean, startsAtCheckpoint: boolean }}
 */
function _sliceToCheckpoint(entries, limit) {
  limit = Math.max(limit, 1);
  if (entries.length <= limit) {
    return { sliced: entries, hasMore: false, startsAtCheckpoint: entries.length === 0 || isCheckpointRaw(entries[0]) };
  }
  let startIdx = Math.max(0, entries.length - limit);
  while (startIdx > 0 && !isCheckpointRaw(entries[startIdx])) {
    startIdx--;
  }
  return {
    sliced: entries.slice(startIdx),
    hasMore: startIdx > 0,
    startsAtCheckpoint: isCheckpointRaw(entries[startIdx]),
  };
}

/**
 * 从文件尾部读取最新 limit 条条目（去重 + checkpoint 边界扩展）。
 *
 * 优化策略：只读文件末尾 2-8MB，避免全文件扫描。
 * 小文件 (< 2MB) 自动 fallback 到全文件读取。
 * 当尾部窗口内找不到 checkpoint 时自动扩大窗口重试，确保 delta 重建正确。
 *
 * @param {string} filePath
 * @param {{ limit?: number }} opts
 * @returns {Promise<{ entries: string[], hasMore: boolean, oldestTimestamp: string, estimatedTotal: number }>}
 */
export async function readTailEntries(filePath, { limit = 300, cached = true } = {}) {
  const emptyResult = { entries: [], hasMore: false, oldestTimestamp: '', estimatedTotal: 0 };
  if (!existsSync(filePath)) return emptyResult;
  // v2 session dirs have no byte-offset tail window — the adapter windows by
  // entry count and synthesizes a baseline checkpoint at the window start.
  // cached defaults TRUE: the /api/local-log tail + IM popup are historical
  // read-only reads (S10b) and may consume a ≤ttl-stale window.
  if (isV2SessionDir(filePath)) {
    const win = await readV2WindowedEntries(filePath, { limit, cached });
    return { entries: win.entries, hasMore: win.hasMore, oldestTimestamp: win.oldestTimestamp, estimatedTotal: win.totalCount };
  }
  const st = statSync(filePath);
  if (st.size === 0) return emptyResult;

  const fileSize = st.size;

  if (fileSize <= TAIL_FALLBACK_THRESHOLD) {
    return _readTailFull(filePath, limit, fileSize);
  }

  let tailBytes = TAIL_INITIAL_BYTES;
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startOffset = Math.max(0, fileSize - tailBytes);
    const dedup = await _collectDedup(iterateRawEntriesAsync(filePath, { startOffset }));
    const collected = dedup.size;

    const allEntries = Array.from(dedup.values());
    const { sliced, hasMore: sliceHasMore, startsAtCheckpoint } = _sliceToCheckpoint(allEntries, limit);

    // 需要重试的条件：条目不足 或 窗口内无 checkpoint（delta 重建会截断）
    const needsRetry = (collected < limit || !startsAtCheckpoint) && startOffset > 0;
    if (needsRetry && attempt < MAX_RETRIES) {
      tailBytes *= 2;
      continue;
    }
    if (needsRetry && attempt === MAX_RETRIES) {
      return _readTailFull(filePath, limit, fileSize);
    }

    const hasMore = startOffset > 0 || sliceHasMore;
    const oldestTimestamp = sliced.length > 0 ? (extractTimestamp(sliced[0]) || '') : '';
    const avgBytes = tailBytes / Math.max(collected, 1);
    const estimatedTotal = Math.round(fileSize / avgBytes);

    return { entries: sliced, hasMore, oldestTimestamp, estimatedTotal };
  }

  return emptyResult; // unreachable
}

/** fallback：全文件读取后取尾部 limit 条 */
async function _readTailFull(filePath, limit, fileSize) {
  const dedup = await _collectDedup(iterateRawEntriesAsync(filePath));
  const totalCount = dedup.size;
  if (totalCount === 0) return { entries: [], hasMore: false, oldestTimestamp: '', estimatedTotal: 0 };

  const allEntries = Array.from(dedup.values());
  const { sliced, hasMore } = _sliceToCheckpoint(allEntries, limit);
  const oldestTimestamp = extractTimestamp(sliced[0]) || '';
  return { entries: sliced, hasMore, oldestTimestamp, estimatedTotal: totalCount };
}
