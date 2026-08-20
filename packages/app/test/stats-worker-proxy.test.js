/**
 * stats-worker proxy aggregation — worker-thread integration tests (review P1:
 * the disk-scanning branch of aggregateProxyStats had zero coverage; only the
 * pure functions in proxy-stats.js were tested).
 *
 * Covered:
 *  - proxy_*.jsonl shards aggregated into <project>.json proxyStats
 *    (cross-day: two shards merge into one aggregate)
 *  - corrupt jsonl lines are skipped without killing the scan
 *  - the records cache is worker-memory only: NO proxyStatsFiles field in the
 *    persisted JSON (review P1: raw records must not be duplicated on disk)
 *  - append + second update inside ONE worker (memory cache path) re-parses
 *    the changed shard and refreshes the aggregate
 *  - proxy-only project (shards, zero sessions) still writes stats (the
 *    early-return guards must not bail before proxy aggregation)
 *  - a session-only project gets an empty-but-present proxyStats shape
 *
 * Data-safety: fixtures live in private tmp dirs; nothing touches a real
 * CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { writeFileSync, mkdirSync, rmSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WORKER_PATH = join(__dirname, '..', 'server', 'lib', 'stats-worker.js');

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-proxy-stats-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Spawn a worker and drive it through several messages sequentially.
 * steps: [{ msg, expectedType }] — resolves with all collected messages. */
function runWorkerSeq(steps, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const messages = [];
    let i = 0;
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Timeout at step ${i}, got: ${JSON.stringify(messages)}`));
    }, timeout);
    worker.on('message', (m) => {
      messages.push(m);
      if (m.type === steps[i].expectedType) {
        i += 1;
        if (i >= steps.length) {
          clearTimeout(timer);
          worker.terminate();
          resolve(messages);
        } else {
          worker.postMessage(steps[i].msg);
        }
      }
    });
    worker.on('error', (err) => { clearTimeout(timer); reject(err); });
    worker.postMessage(steps[0].msg);
  });
}

function runWorker(msg, expectedType, timeout = 5000) {
  return runWorkerSeq([{ msg, expectedType }], timeout);
}

// Minimal valid v2 session (one completed kind:'main' request) so the project
// passes the discardable-session and empty-filesStats guards.
function makeMinimalSession(projectDir, sid = 'sid-1') {
  const dir = join(projectDir, 'sessions', sid);
  mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid: 1, startTs: '2026-07-14T00:00:00.000Z' }));
  const req = { ph: 'req', seq: 1, rid: 'r1', ts: '2026-07-14T00:00:01.000Z', kind: 'main', conv: 'main', epoch: 0, url: 'https://api.anthropic.com/v1/messages', method: 'POST', model: 'mA', msgFrom: 0, msgTo: 1 };
  const done = { ph: 'done', seq: 1, ts: req.ts, status: 'ok', usage: { in: 10, out: 5 } };
  writeFileSync(join(dir, 'journal.jsonl'), [JSON.stringify({ ph: 'meta', wireFormat: 2 }), JSON.stringify(req), JSON.stringify(done)].join('\n') + '\n');
}

function proxyRecord(overrides = {}) {
  return JSON.stringify({
    ts: '2026-07-14T01:00:00.000Z',
    method: 'POST',
    path: '/v1/messages',
    model: 'mA',
    profile_id: 'default',
    profile_name: 'Default',
    upstream_status: 200,
    final_status: 200,
    attempts: 1,
    retries: 0,
    duration_ms: 100,
    succeeded: true,
    retry_codes: [],
    ...overrides,
  });
}

let logDir;
beforeEach(() => { logDir = makeTmpDir(); });
afterEach(() => { rmSync(logDir, { recursive: true, force: true }); });

describe('stats-worker proxy aggregation', { concurrency: false }, () => {
  it('aggregates cross-day shards into proxyStats and persists NO raw-records cache', async () => {
    const projectDir = join(logDir, 'proj');
    makeMinimalSession(projectDir);
    writeFileSync(join(projectDir, 'proxy_2026-07-13.jsonl'),
      proxyRecord({ ts: '2026-07-13T01:00:00.000Z' }) + '\n'
      + proxyRecord({ ts: '2026-07-13T02:00:00.000Z', final_status: 503, succeeded: false, retries: 2, attempts: 3, retry_codes: [503, 503] }) + '\n');
    writeFileSync(join(projectDir, 'proxy_2026-07-14.jsonl'), proxyRecord() + '\n');

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats._v, 12);
    assert.ok(stats.proxyStats, 'proxyStats must be present');
    assert.equal(stats.proxyStats.summary.totalRequests, 3, 'both day shards must be merged');
    assert.equal(stats.proxyStats.summary.totalFailed, 1);
    assert.equal(stats.proxyStatsFiles, undefined, 'raw-records cache must NOT be persisted (worker-memory only)');
    assert.ok(!JSON.stringify(stats).includes('proxyStatsFiles'));
  });

  it('skips corrupt jsonl lines without dropping the healthy ones', async () => {
    const projectDir = join(logDir, 'proj');
    makeMinimalSession(projectDir);
    writeFileSync(join(projectDir, 'proxy_2026-07-14.jsonl'),
      proxyRecord() + '\n' + '{corrupt line\n' + proxyRecord({ ts: '2026-07-14T02:00:00.000Z' }) + '\n');

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.proxyStats.summary.totalRequests, 2, 'corrupt line skipped, both valid records counted');
  });

  it('re-parses a changed shard on a second update in the same worker (memory cache path)', async () => {
    const projectDir = join(logDir, 'proj');
    makeMinimalSession(projectDir);
    const shard = join(projectDir, 'proxy_2026-07-14.jsonl');
    writeFileSync(shard, proxyRecord() + '\n');

    // One worker instance drives init → (mutate shard) → update, so the second
    // aggregation runs against the worker-memory cache and must detect the
    // size change and re-parse the shard.
    const worker = new Worker(WORKER_PATH);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout waiting for init-done/update-done')), 5000);
        let phase = 0;
        worker.on('message', (m) => {
          if (m.type === 'init-done' && phase === 0) {
            phase = 1;
            const first = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
            try { assert.equal(first.proxyStats.summary.totalRequests, 1); } catch (err) { clearTimeout(timer); reject(err); return; }
            appendFileSync(shard, proxyRecord({ ts: '2026-07-14T03:00:00.000Z', final_status: 429, succeeded: false, retries: 1, attempts: 2, retry_codes: [429] }) + '\n');
            worker.postMessage({ type: 'update', logDir, projectName: 'proj', logFile: 'proxy_2026-07-14.jsonl' });
          } else if (m.type === 'update-done' && phase === 1) {
            clearTimeout(timer);
            resolve();
          }
        });
        worker.on('error', (err) => { clearTimeout(timer); reject(err); });
        worker.postMessage({ type: 'init', logDir, projectName: 'proj' });
      });
    } finally {
      await worker.terminate();
    }
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.proxyStats.summary.totalRequests, 2, 'appended record must be picked up by the cached-worker update');
    assert.equal(stats.proxyStats.summary.totalRetries, 1);
  });

  it('proxy-only project (no sessions) still writes stats with proxyStats', async () => {
    const projectDir = join(logDir, 'proxyonly');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'proxy_2026-07-14.jsonl'), proxyRecord() + '\n');

    await runWorker({ type: 'init', logDir, projectName: 'proxyonly' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proxyonly.json'), 'utf-8'));
    assert.equal(stats._v, 12);
    assert.equal(stats.proxyStats.summary.totalRequests, 1, 'proxy shards alone must produce stats (early-return guards)');
    assert.equal(stats.summary.fileCount, 0, 'no session units');
  });

  it('session-only project (no proxy shards) still writes token stats with an empty proxyStats', async () => {
    const projectDir = join(logDir, 'proj');
    makeMinimalSession(projectDir);

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.ok(stats.files['sessions/sid-1'], 'session stats intact');
    assert.ok(stats.proxyStats, 'proxyStats present even with zero proxy traffic');
    assert.equal(stats.proxyStats.summary.totalRequests, 0);
  });

  it('CCV_PROXY_STATS_RETAIN_DAYS prunes shards older than the window (review P2)', async () => {
    const projectDir = join(logDir, 'proj');
    makeMinimalSession(projectDir);
    const oldShard = join(projectDir, 'proxy_2020-01-01.jsonl');
    writeFileSync(oldShard, proxyRecord({ ts: '2020-01-01T01:00:00.000Z' }) + '\n');
    writeFileSync(join(projectDir, 'proxy_2099-01-01.jsonl'), proxyRecord({ ts: '2099-01-01T01:00:00.000Z' }) + '\n');

    process.env.CCV_PROXY_STATS_RETAIN_DAYS = '30'; // worker inherits process.env at spawn
    try {
      await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    } finally {
      delete process.env.CCV_PROXY_STATS_RETAIN_DAYS;
    }
    assert.equal(existsSync(oldShard), false, 'shard older than the window must be deleted');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.proxyStats.summary.totalRequests, 1, 'only the surviving shard aggregates');
  });

  it('without the retention env nothing is ever deleted (opt-in policy)', async () => {
    const projectDir = join(logDir, 'proj');
    makeMinimalSession(projectDir);
    const oldShard = join(projectDir, 'proxy_2020-01-01.jsonl');
    writeFileSync(oldShard, proxyRecord({ ts: '2020-01-01T01:00:00.000Z' }) + '\n');

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    assert.equal(existsSync(oldShard), true, 'no env → no deletion');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.proxyStats.summary.totalRequests, 1);
  });
});
