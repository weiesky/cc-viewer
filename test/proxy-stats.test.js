/**
 * server/lib/proxy-stats.js — pure functions for proxy retry statistics.
 * Coverage: buildRecord / isRecordSucceeded / dailyFileName / dailyFilePath /
 * parseDailyFileName / todayStr / percentile / computeStreak / aggregateRecords.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecord, isRecordSucceeded, dailyFileName, dailyFilePath,
  parseDailyFileName, todayStr, percentile, computeStreak, aggregateRecords,
  mergeProxyFileCache,
} from '../server/lib/proxy-stats.js';

describe('proxy-stats buildRecord', () => {
  it('补全默认值并派生 retries/succeeded', () => {
    const r = buildRecord({ method: 'POST', path: '/v1/messages', model: 'opus', finalStatus: 200, attempts: 3, durationMs: 850, retryCodes: [503, 503] });
    assert.equal(r.retries, 2);
    assert.equal(r.succeeded, true);
    assert.equal(r.method, 'POST');
    assert.deepEqual(r.retry_codes, [503, 503]);
  });

  it('attempts 缺失时默认 1，retries=0', () => {
    const r = buildRecord({ finalStatus: 500 });
    assert.equal(r.attempts, 1);
    assert.equal(r.retries, 0);
    assert.equal(r.succeeded, false);
  });

  it('finalStatus=0 视为失败', () => {
    const r = buildRecord({ finalStatus: 0, attempts: 2 });
    assert.equal(r.succeeded, false);
  });

  it('model 非 string 时为空串', () => {
    const r = buildRecord({ model: 123, finalStatus: 200 });
    assert.equal(r.model, '');
  });

  it('profileId/profileName 缺失时回退 default/Default', () => {
    const r = buildRecord({ finalStatus: 200 });
    assert.equal(r.profile_id, 'default');
    assert.equal(r.profile_name, 'Default');
  });

  it('profileId/profileName 正确透传', () => {
    const r = buildRecord({ profileId: 'proxy_x', profileName: '讯飞星辰', finalStatus: 200 });
    assert.equal(r.profile_id, 'proxy_x');
    assert.equal(r.profile_name, '讯飞星辰');
  });
});

describe('proxy-stats isRecordSucceeded', () => {
  it('2xx/3xx 成功，4xx/5xx/0 失败', () => {
    assert.equal(isRecordSucceeded({ final_status: 200 }), true);
    assert.equal(isRecordSucceeded({ final_status: 301 }), true);
    assert.equal(isRecordSucceeded({ final_status: 404 }), false);
    assert.equal(isRecordSucceeded({ final_status: 503 }), false);
    assert.equal(isRecordSucceeded({ final_status: 0 }), false);
    assert.equal(isRecordSucceeded({}), false);
  });
});

describe('proxy-stats dailyFileName / dailyFilePath / parseDailyFileName', () => {
  it('文件名格式 proxy_YYYY-MM-DD.jsonl', () => {
    assert.equal(dailyFileName('2026-07-08'), 'proxy_2026-07-08.jsonl');
  });

  it('路径拼接', () => {
    const p = dailyFilePath('/logs/proj', '2026-07-08');
    assert.ok(p.endsWith('proj/proxy_2026-07-08.jsonl'));
  });

  it('parseDailyFileName 正确解析', () => {
    assert.equal(parseDailyFileName('proxy_2026-07-08.jsonl'), '2026-07-08');
    assert.equal(parseDailyFileName('proxy_2026-07-08.jsonl.zip'), null);
    assert.equal(parseDailyFileName('retry_2026-07-08.jsonl'), null);
    assert.equal(parseDailyFileName('proxy_test.jsonl'), null);
  });
});

describe('proxy-stats todayStr', () => {
  it('格式 YYYY-MM-DD', () => {
    const s = todayStr(new Date('2026-07-08T15:30:00'));
    assert.equal(s, '2026-07-08');
  });
});

describe('proxy-stats percentile', () => {
  it('空数组返回 0', () => {
    assert.equal(percentile([], 0.95), 0);
    assert.equal(percentile(null, 0.5), 0);
  });

  it('单元素返回该元素', () => {
    assert.equal(percentile([42], 0.5), 42);
    assert.equal(percentile([42], 0.95), 42);
  });

  it('P50/P95/P99 nearest-rank', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // nearest-rank: idx = ceil(p*n)-1
    // P50: ceil(5)-1=4 → 50
    assert.equal(percentile(sorted, 0.5), 50);
    // P95: ceil(9.5)-1=9 → 100
    assert.equal(percentile(sorted, 0.95), 100);
    // P99: ceil(9.9)-1=9 → 100
    assert.equal(percentile(sorted, 0.99), 100);
  });
});

describe('proxy-stats computeStreak', () => {
  it('空数组', () => {
    const s = computeStreak([]);
    assert.equal(s.current.count, 0);
    assert.equal(s.worstFailure, 0);
  });

  it('全成功', () => {
    const recs = [{ final_status: 200 }, { final_status: 200 }];
    const s = computeStreak(recs);
    assert.equal(s.current.type, 'success');
    assert.equal(s.current.count, 2);
    assert.equal(s.worstFailure, 0);
  });

  it('全失败', () => {
    const recs = [{ final_status: 503 }, { final_status: 503 }, { final_status: 429 }];
    const s = computeStreak(recs);
    assert.equal(s.current.type, 'failure');
    assert.equal(s.current.count, 3);
    assert.equal(s.worstFailure, 3);
  });

  it('交替 + 最长连续失败', () => {
    const recs = [
      { final_status: 200 }, { final_status: 503 }, { final_status: 503 },
      { final_status: 200 }, { final_status: 429 },
    ];
    const s = computeStreak(recs);
    assert.equal(s.current.type, 'failure');
    assert.equal(s.current.count, 1);
    assert.equal(s.worstFailure, 2);
  });
});

describe('proxy-stats aggregateRecords', () => {
  it('空数组返回空聚合', () => {
    const r = aggregateRecords([]);
    assert.equal(r.summary.totalRequests, 0);
    assert.equal(r.summary.upstreamAvailabilityPct, 0);
    assert.deepEqual(r.byModel, []);
    assert.deepEqual(r.recentRecords, []);
    assert.equal(r.slowest, null);
  });

  it('单条成功记录', () => {
    const r = aggregateRecords([
      buildRecord({ method: 'POST', path: '/v1/messages', model: 'opus', finalStatus: 200, attempts: 1, durationMs: 500 }),
    ]);
    assert.equal(r.summary.totalRequests, 1);
    assert.equal(r.summary.totalRetries, 0);
    assert.equal(r.summary.totalSucceeded, 1);
    assert.equal(r.summary.totalFirstOk, 1);
    assert.equal(r.summary.upstreamAvailabilityPct, 100);
    assert.equal(r.summary.downstreamAvailabilityPct, 100);
    assert.equal(r.summary.p50Ms, 500);
    assert.equal(r.slowest.duration_ms, 500);
    assert.equal(r.fastest.duration_ms, 500);
  });

  it('多条：可用率双口径 + 分位数 + byModel + retryDistribution + retryCodes', () => {
    const recs = [
      buildRecord({ model: 'opus', path: '/v1/messages', finalStatus: 503, attempts: 3, durationMs: 200, retryCodes: [503, 503] }),
      buildRecord({ model: 'opus', path: '/v1/messages', finalStatus: 200, attempts: 1, durationMs: 850 }),
      buildRecord({ model: 'sonnet', path: '/v1/messages', finalStatus: 200, attempts: 2, durationMs: 1200, retryCodes: [429] }),
      buildRecord({ model: 'sonnet', path: '/v1/messages', finalStatus: 429, attempts: 3, durationMs: 500, retryCodes: [429, 429] }),
    ];
    const r = aggregateRecords(recs);
    assert.equal(r.summary.totalRequests, 4);
    assert.equal(r.summary.totalRetries, 5);
    assert.equal(r.summary.totalSucceeded, 2);
    assert.equal(r.summary.totalFailed, 2);
    assert.equal(r.summary.totalFirstOk, 1);
    // Upstream availability = 1/4 = 25
    assert.equal(r.summary.upstreamAvailabilityPct, 25);
    // Downstream availability = 2/4 = 50
    assert.equal(r.summary.downstreamAvailabilityPct, 50);
    // byModel: opus + sonnet
    assert.equal(r.byModel.length, 2);
    const opus = r.byModel.find(m => m.model === 'opus');
    assert.equal(opus.requests, 2);
    assert.equal(opus.succeeded, 1);
    assert.equal(opus.failed, 1);
    assert.equal(opus.firstOk, 1);
    assert.equal(opus.upstreamAvailabilityPct, 50);
    assert.equal(opus.availabilityPct, 50);
    // retryDistribution: {0:1, 1:1, 2:2}
    assert.deepEqual(r.retryDistribution, [{ retries: 0, count: 1 }, { retries: 1, count: 1 }, { retries: 2, count: 2 }]);
    // retryCodes: 429 appears 3 times, 503 appears 2 times
    assert.deepEqual(r.retryCodes, [{ code: 429, count: 3 }, { code: 503, count: 2 }]);
    // slowest=1200, fastest=850 (only successful and >0)
    assert.equal(r.slowest.duration_ms, 1200);
    assert.equal(r.fastest.duration_ms, 850);
  });

  it('byPath 限制 Top 10', () => {
    const recs = [];
    for (let i = 0; i < 15; i++) {
      recs.push(buildRecord({ path: `/p${i}`, finalStatus: 200, attempts: 1, durationMs: 100 }));
    }
    const r = aggregateRecords(recs);
    assert.equal(r.byPath.length, 10);
  });

  it('byProfile 按 profile 聚合并携带 profile_name', () => {
    const recs = [
      buildRecord({ profileId: 'proxy_a', profileName: '讯飞', model: 'opus', finalStatus: 503, attempts: 3, durationMs: 200 }),
      buildRecord({ profileId: 'proxy_a', profileName: '讯飞', model: 'opus', finalStatus: 200, attempts: 1, durationMs: 850 }),
      buildRecord({ profileId: 'proxy_b', profileName: '官方', model: 'sonnet', finalStatus: 200, attempts: 1, durationMs: 500 }),
      buildRecord({ finalStatus: 200, attempts: 1, durationMs: 300 }), // no profile → default
    ];
    const r = aggregateRecords(recs);
    assert.equal(r.byProfile.length, 3);
    const a = r.byProfile.find(p => p.profile_id === 'proxy_a');
    assert.equal(a.profile_name, '讯飞');
    assert.equal(a.requests, 2);
    assert.equal(a.succeeded, 1);
    assert.equal(a.upstreamAvailabilityPct, 50);
    const def = r.byProfile.find(p => p.profile_id === 'default');
    assert.equal(def.profile_name, 'Default');
    assert.equal(def.requests, 1);
  });

  it('recentRecords 默认 50 条且倒序（最新在前）', () => {
    const recs = [];
    for (let i = 0; i < 60; i++) {
      recs.push(buildRecord({ ts: `2026-07-08T${String(i).padStart(2, '0')}:00:00.000`, path: '/v1/messages', finalStatus: 200, attempts: 1 }));
    }
    const r = aggregateRecords(recs);
    assert.equal(r.recentRecords.length, 50);
    // Newest (largest ts) should come first
    assert.ok(r.recentRecords[0].ts >= r.recentRecords[1].ts);
  });
});

describe('proxy-stats mergeProxyFileCache 增量缓存', () => {
  // Build two records (from different files)
  const rec1 = buildRecord({ path: '/v1/messages', model: 'opus', finalStatus: 200, attempts: 1, durationMs: 100, ts: '2026-07-09T00:00:00.000Z' });
  const rec2 = buildRecord({ path: '/v1/messages', model: 'sonnet', finalStatus: 503, attempts: 2, durationMs: 200, ts: '2026-07-10T00:00:00.000Z' });

  it('未变化文件复用缓存记录，不要求重新提供 records', () => {
    const existingCache = {
      'proxy_2026-07-09.jsonl': { size: 100, lastModified: '2026-07-09T01:00:00.000Z', records: [rec1] },
    };
    // File unchanged: worker only provides size/lastModified (no records)
    const files = [{ name: 'proxy_2026-07-09.jsonl', size: 100, lastModified: '2026-07-09T01:00:00.000Z' }];
    const { records, cache } = mergeProxyFileCache({ existingCache, files });
    assert.equal(records.length, 1);
    assert.equal(records[0].model, 'opus');
    // Cache should write back the reused records
    assert.deepEqual(cache['proxy_2026-07-09.jsonl'].records, [rec1]);
  });

  it('变化文件用新解析的 records 并更新缓存', () => {
    const staleRec = buildRecord({ path: '/v1/messages', model: 'old', finalStatus: 500, attempts: 1, durationMs: 1, ts: '2026-07-09T00:00:00.000Z' });
    const existingCache = {
      'proxy_2026-07-09.jsonl': { size: 100, lastModified: '2026-07-09T01:00:00.000Z', records: [staleRec] },
    };
    // File changed: worker provides new records (size differs)
    const files = [{ name: 'proxy_2026-07-09.jsonl', size: 250, lastModified: '2026-07-09T02:00:00.000Z', records: [rec1] }];
    const { records, cache } = mergeProxyFileCache({ existingCache, files });
    assert.equal(records.length, 1);
    assert.equal(records[0].model, 'opus', '应使用新解析的记录而非过期缓存');
    assert.equal(cache['proxy_2026-07-09.jsonl'].size, 250);
    assert.equal(cache['proxy_2026-07-09.jsonl'].lastModified, '2026-07-09T02:00:00.000Z');
  });

  it('新增文件（缓存中无）用 worker 提供的 records 并写入缓存', () => {
    const existingCache = {
      'proxy_2026-07-09.jsonl': { size: 100, lastModified: '2026-07-09T01:00:00.000Z', records: [rec1] },
    };
    const files = [
      { name: 'proxy_2026-07-09.jsonl', size: 100, lastModified: '2026-07-09T01:00:00.000Z' },
      { name: 'proxy_2026-07-10.jsonl', size: 200, lastModified: '2026-07-10T01:00:00.000Z', records: [rec2] },
    ];
    const { records, cache } = mergeProxyFileCache({ existingCache, files });
    assert.equal(records.length, 2);
    assert.ok(cache['proxy_2026-07-10.jsonl'], '新文件应进缓存');
    assert.equal(cache['proxy_2026-07-10.jsonl'].records.length, 1);
  });

  it('已删除文件不再出现在缓存或记录中', () => {
    const existingCache = {
      'proxy_2026-07-08.jsonl': { size: 50, lastModified: '2026-07-08T01:00:00.000Z', records: [rec1] },
      'proxy_2026-07-09.jsonl': { size: 100, lastModified: '2026-07-09T01:00:00.000Z', records: [rec2] },
    };
    // 07-08 file has been deleted, no longer in files
    const files = [{ name: 'proxy_2026-07-09.jsonl', size: 100, lastModified: '2026-07-09T01:00:00.000Z' }];
    const { records, cache } = mergeProxyFileCache({ existingCache, files });
    assert.equal(records.length, 1);
    assert.equal(records[0].model, 'sonnet');
    assert.ok(!cache['proxy_2026-07-08.jsonl'], '已删除文件应从缓存移除');
  });

  it('无缓存且文件无 records → 跳过（worker 应保证变化文件带 records）', () => {
    const files = [{ name: 'proxy_2026-07-09.jsonl', size: 100, lastModified: '2026-07-09T01:00:00.000Z' }];
    const { records, cache } = mergeProxyFileCache({ existingCache: null, files });
    assert.equal(records.length, 0);
    assert.ok(!cache['proxy_2026-07-09.jsonl']);
  });

  it('合并后的 records 可正确喂给 aggregateRecords', () => {
    const existingCache = {
      'proxy_2026-07-09.jsonl': { size: 100, lastModified: '2026-07-09T01:00:00.000Z', records: [rec1] },
    };
    const files = [
      { name: 'proxy_2026-07-09.jsonl', size: 100, lastModified: '2026-07-09T01:00:00.000Z' },
      { name: 'proxy_2026-07-10.jsonl', size: 200, lastModified: '2026-07-10T01:00:00.000Z', records: [rec2] },
    ];
    const { records } = mergeProxyFileCache({ existingCache, files });
    const stats = aggregateRecords(records);
    assert.equal(stats.summary.totalRequests, 2);
  });
});
