/**
 * Unit tests for src/utils/mdCodePathVerify.js
 *
 * checkPathsExist(paths, {projectKey, fetchImpl}):缓存(true 永久 / false 30s TTL)、
 * projectKey 隔离、并发 in-flight 合并、≤50 分块串行、fetch 失败 → reportSwallowed
 * 且不写缓存(下一批可重试)。
 *
 * 依赖链: mdCodePathVerify.js -> './apiUrl'(无扩展名 import,需 vite-loader 补 .js)。
 * apiUrl.js 在加载时读 window.location.search,故在动态 import 前先挂 globalThis.window。
 * (同 file-open.test.js 模式)
 */
import './_shims/register.mjs';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const _origWindow = globalThis.window;
const _origDocument = globalThis.document;

globalThis.window = { location: { search: '' } };
globalThis.document = { querySelector: () => null };

const { checkPathsExist, dedupePaths, peekPathExists, _resetForTests, MD_EXISTS_MAX_BATCH } =
  await import('../src/utils/mdCodePathVerify.js');

after(() => {
  if (_origWindow === undefined) delete globalThis.window; else globalThis.window = _origWindow;
  if (_origDocument === undefined) delete globalThis.document; else globalThis.document = _origDocument;
});

/** 记录调用的 fetch mock: url/opts 落 calls; 按 paths 回 {results} 或按配置 reject。 */
function installFetch({ reject = false, ok = true, truthy = new Set() } = {}) {
  const calls = [];
  const fetchImpl = (url, opts) => {
    calls.push({ url, opts });
    if (reject) return Promise.reject(new Error('network down'));
    if (!ok) return Promise.resolve({ ok: false });
    const paths = JSON.parse(opts.body).paths;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        results: paths.map(p => ({ path: p, exists: truthy.has(p) })),
      }),
    });
  };
  return { calls, fetchImpl };
}

describe('dedupePaths', () => {
  it('dedupes preserving first-seen order', () => {
    assert.deepEqual(dedupePaths(['a', 'b', 'a', 'c', 'b']), ['a', 'b', 'c']);
    assert.deepEqual(dedupePaths([]), []);
  });
});

describe('checkPathsExist — batching', () => {
  beforeEach(() => _resetForTests());

  it('chunks 120 paths into 3 requests of ≤50, results cover all inputs', async () => {
    const paths = Array.from({ length: 120 }, (_, i) => `f${i}.md`);
    const { calls, fetchImpl } = installFetch({ truthy: new Set(['f0.md', 'f119.md']) });
    const results = await checkPathsExist(paths, { projectKey: 'p', fetchImpl });
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.ok(JSON.parse(c.opts.body).paths.length <= MD_EXISTS_MAX_BATCH);
    }
    // 钉住端点 URL —— 静默改名会让全绿的同时功能全灭
    assert.match(calls[0].url, /\/api\/files-exists(\?|$)/);
    assert.equal(results.size, 120);
    assert.equal(results.get('f0.md'), true);
    assert.equal(results.get('f119.md'), true);
    assert.equal(results.get('f1.md'), false);
  });

  it('dedupes input before fetching', async () => {
    const { calls, fetchImpl } = installFetch({ truthy: new Set(['a.md']) });
    const results = await checkPathsExist(['a.md', 'a.md', 'b.md'], { projectKey: 'p', fetchImpl });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].opts.body).paths, ['a.md', 'b.md']);
    assert.equal(results.get('a.md'), true);
  });
});

describe('checkPathsExist — cache', () => {
  beforeEach(() => _resetForTests());

  it('second call with same projectKey → zero fetches', async () => {
    const { calls, fetchImpl } = installFetch({ truthy: new Set(['a.md']) });
    await checkPathsExist(['a.md', 'b.md'], { projectKey: 'p', fetchImpl });
    await checkPathsExist(['a.md', 'b.md'], { projectKey: 'p', fetchImpl });
    assert.equal(calls.length, 1);
  });

  it('different projectKey → refetch', async () => {
    const { calls, fetchImpl } = installFetch();
    await checkPathsExist(['a.md'], { projectKey: 'p1', fetchImpl });
    await checkPathsExist(['a.md'], { projectKey: 'p2', fetchImpl });
    assert.equal(calls.length, 2);
  });

  it('negative verdict expires after TTL and is re-probed', async () => {
    const { calls, fetchImpl } = installFetch({ truthy: new Set() });
    await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl });
    assert.equal(calls.length, 1);
    // 用 monkey-patch Date.now 把时间推过 TTL(30s),等价于负缓存过期
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;
    try {
      await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl });
      assert.equal(calls.length, 2);
    } finally {
      Date.now = realNow;
    }
  });

  it('positive verdict does not expire with TTL', async () => {
    const { calls, fetchImpl } = installFetch({ truthy: new Set(['a.md']) });
    await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl });
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;
    try {
      await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl });
      assert.equal(calls.length, 1);
    } finally {
      Date.now = realNow;
    }
  });

  it('FIFO-evicts the oldest entry once the cache exceeds 2000', async () => {
    const { calls, fetchImpl } = installFetch({ truthy: new Set() });
    // 2001 条不同路径(全部 false,但 TTL 未过期 → 驱逐才是重探的唯一原因)
    const paths = Array.from({ length: 2001 }, (_, i) => `evict-${i}.md`);
    await checkPathsExist(paths, { projectKey: 'p', fetchImpl });
    const firstRound = calls.length;
    // evict-0 已被 FIFO 逐出 → 重探; evict-2000 仍在缓存 → 不重探
    await checkPathsExist(['evict-0.md', 'evict-2000.md'], { projectKey: 'p', fetchImpl });
    assert.equal(calls.length, firstRound + 1);
    assert.deepEqual(JSON.parse(calls[calls.length - 1].opts.body).paths, ['evict-0.md']);
  });

  it('cache key separates projectKey and path (no concatenation collision)', async () => {
    // (project "a", path "b/c") 与 (project "", path "ab/c") 不得共享缓存槽
    const a = installFetch({ truthy: new Set(['b/c']) });
    await checkPathsExist(['b/c'], { projectKey: 'a', fetchImpl: a.fetchImpl });
    const b = installFetch({ truthy: new Set() });
    const r = await checkPathsExist(['ab/c'], { projectKey: '', fetchImpl: b.fetchImpl });
    assert.equal(b.calls.length, 1, 'collision would have made this a cache hit with 0 fetches');
    assert.equal(r.get('ab/c'), false);
  });

  it('peekPathExists returns cached verdicts, undefined for unknown, undefined after negative TTL', async () => {
    const { fetchImpl } = installFetch({ truthy: new Set(['a.md']) });
    assert.equal(peekPathExists('a.md', 'p'), undefined);
    await checkPathsExist(['a.md', 'b.md'], { projectKey: 'p', fetchImpl });
    assert.equal(peekPathExists('a.md', 'p'), true);
    assert.equal(peekPathExists('b.md', 'p'), false);
    assert.equal(peekPathExists('a.md', 'other-project'), undefined);
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;
    try {
      assert.equal(peekPathExists('b.md', 'p'), undefined, 'negative expires');
      assert.equal(peekPathExists('a.md', 'p'), true, 'positive persists');
    } finally {
      Date.now = realNow;
    }
  });
});

describe('checkPathsExist — in-flight coalescing', () => {
  beforeEach(() => _resetForTests());

  it('concurrent calls for overlapping paths share one request', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = [];
    const fetchImpl = (url, opts) => {
      calls.push({ url, opts });
      return gate.then(() => ({
        ok: true,
        json: () => Promise.resolve({
          results: JSON.parse(opts.body).paths.map(p => ({ path: p, exists: true })),
        }),
      }));
    };
    const p1 = checkPathsExist(['a.md', 'b.md'], { projectKey: 'p', fetchImpl });
    const p2 = checkPathsExist(['b.md', 'c.md'], { projectKey: 'p', fetchImpl });
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    // b.md 只被请求一次(第二次调用 join 了在途槽)
    const requested = calls.flatMap(c => JSON.parse(c.opts.body).paths);
    assert.equal(requested.filter(p => p === 'b.md').length, 1);
    assert.equal(r1.get('b.md'), true);
    assert.equal(r2.get('b.md'), true);
  });
});

describe('checkPathsExist — failure handling', () => {
  beforeEach(() => _resetForTests());

  it('fetch rejection → all false, no throw, NOT cached (retryable)', async () => {
    const bad = installFetch({ reject: true });
    const results = await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl: bad.fetchImpl });
    assert.equal(results.get('a.md'), false);
    // 失败后不写缓存: 换一个好 fetch,同 key 立即重探
    const good = installFetch({ truthy: new Set(['a.md']) });
    const retry = await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl: good.fetchImpl });
    assert.equal(good.calls.length, 1);
    assert.equal(retry.get('a.md'), true);
  });

  it('non-ok response → false, uncached', async () => {
    const bad = installFetch({ ok: false });
    const results = await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl: bad.fetchImpl });
    assert.equal(results.get('a.md'), false);
    const good = installFetch({ truthy: new Set(['a.md']) });
    const retry = await checkPathsExist(['a.md'], { projectKey: 'p', fetchImpl: good.fetchImpl });
    assert.equal(good.calls.length, 1);
  });
});
