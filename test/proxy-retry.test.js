/**
 * server/lib/proxy-retry.js — proxy retry engine.
 * Covers: parseRetryAfter / shouldRetryStatus / isStreamResponse / extractModel /
 * applyModelReplacement / resolveRetryConfig / executeRequest (off/serial/race/stagger).
 *
 * executeRequest's fetch is mocked: globalThis.fetch is replaced with a controllable
 * fake function that returns a preset sequence of status codes. Note that
 * proxy-retry.js's singleFetch calls globalThis.fetch with the x-cc-viewer-trace header.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETRY_CONFIG, resolveRetryConfig, parseRetryAfter,
  shouldRetryStatus, isStreamResponse, extractModel, applyModelReplacement,
  executeRequest,
} from '../server/lib/proxy-retry.js';

// ── Pure functions ────────────────────────────────────────────────

describe('proxy-retry parseRetryAfter', () => {
  it('秒数 → 毫秒', () => {
    assert.equal(parseRetryAfter('120'), 120000);
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter('  30  '), 30000);
  });

  it('HTTP 日期 → 与 now 的差值（>=0）', () => {
    const future = new Date(Date.now() + 60000).toUTCString();
    const ms = parseRetryAfter(future);
    assert.ok(ms !== null);
    assert.ok(ms > 50000 && ms < 70000, `expected ~60000, got ${ms}`);
  });

  it('过去的 HTTP 日期 → 0（立即重试）', () => {
    const past = new Date(Date.now() - 60000).toUTCString();
    assert.equal(parseRetryAfter(past), 0);
  });

  it('空值/非法 → null', () => {
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter(undefined), null);
    assert.equal(parseRetryAfter(''), null);
    assert.equal(parseRetryAfter('not-a-date'), null);
    assert.equal(parseRetryAfter('abc123'), null);
  });
});

describe('proxy-retry shouldRetryStatus', () => {
  const codes = [502, 503, 504, 529, 429];
  it('重试状态码 → true', () => {
    assert.equal(shouldRetryStatus(503, codes), true);
    assert.equal(shouldRetryStatus(429, codes), true);
    assert.equal(shouldRetryStatus(529, codes), true);
  });
  it('非重试状态码 → false', () => {
    assert.equal(shouldRetryStatus(200, codes), false);
    assert.equal(shouldRetryStatus(404, codes), false);
    assert.equal(shouldRetryStatus(401, codes), false);
    assert.equal(shouldRetryStatus(0, codes), false);
  });
});

describe('proxy-retry isStreamResponse', () => {
  it('text/event-stream → true', () => {
    const fake = { headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'text/event-stream' : null } };
    assert.equal(isStreamResponse(fake), true);
  });
  it('application/json → false', () => {
    const fake = { headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'application/json' : null } };
    assert.equal(isStreamResponse(fake), false);
  });
});

describe('proxy-retry extractModel', () => {
  it('从 JSON body 解析 model', () => {
    assert.equal(extractModel(JSON.stringify({ model: 'claude-opus-4' })), 'claude-opus-4');
  });
  it('从 Buffer 解析', () => {
    assert.equal(extractModel(Buffer.from(JSON.stringify({ model: 'sonnet' }))), 'sonnet');
  });
  it('无 model 字段 → 空串', () => {
    assert.equal(extractModel(JSON.stringify({ foo: 'bar' })), '');
  });
  it('非法 JSON → 空串', () => {
    assert.equal(extractModel('not json'), '');
    assert.equal(extractModel(null), '');
    assert.equal(extractModel(undefined), '');
  });
});

describe('proxy-retry applyModelReplacement', () => {
  it('opus 家族 → 替换为 profile 的 OPUS 模型', () => {
    const body = JSON.stringify({ model: 'claude-opus-4-20250514' });
    const out = applyModelReplacement(body, { ANTHROPIC_DEFAULT_OPUS_MODEL: 'my-opus' });
    assert.equal(JSON.parse(out).model, 'my-opus');
  });
  it('无匹配家族 → 不替换', () => {
    const body = JSON.stringify({ model: 'unknown-model' });
    const out = applyModelReplacement(body, { ANTHROPIC_DEFAULT_OPUS_MODEL: 'my-opus' });
    assert.equal(out, body);
  });
  it('无 profile → 不替换', () => {
    const body = JSON.stringify({ model: 'claude-opus-4' });
    assert.equal(applyModelReplacement(body, null), body);
  });
});

describe('proxy-retry resolveRetryConfig', () => {
  it('默认 mode=off', () => {
    const cfg = resolveRetryConfig({});
    assert.equal(cfg.mode, 'off');
    assert.deepEqual(cfg.retryStatusCodes, [502, 503, 504, 529, 429]);
    assert.equal(cfg.maxRetries, 60);
  });

  it('解析环境变量', () => {
    const cfg = resolveRetryConfig({
      CCV_PROXY_RETRY_MODE: 'serial',
      CCV_PROXY_RETRY_INTERVAL_MS: '500',
      CCV_PROXY_RETRY_INTERVAL_429_MS: '2000',
      CCV_PROXY_MAX_RETRIES: '10',
      CCV_PROXY_MAX_CONCURRENT: '5',
      CCV_PROXY_RETRY_STATUS_CODES: '500,502,503',
    });
    assert.equal(cfg.mode, 'serial');
    assert.equal(cfg.retryIntervalMs, 500);
    assert.equal(cfg.retryInterval429Ms, 2000);
    assert.equal(cfg.maxRetries, 10);
    assert.equal(cfg.maxConcurrent, 5);
    assert.deepEqual(cfg.retryStatusCodes, [500, 502, 503]);
  });

  it('非法 mode 回落 off', () => {
    const cfg = resolveRetryConfig({ CCV_PROXY_RETRY_MODE: 'invalid' });
    assert.equal(cfg.mode, 'off');
  });
});

// ── executeRequest (mock fetch)──────────────────────────────────
// Mock strategy: replace globalThis.fetch with a controllable function that returns
// a preset status code sequence. proxy-retry.js's singleFetch calls globalThis.fetch
// with the x-cc-viewer-trace header and merges a timeout AbortController. Our mocked
// fetch ignores the signal and directly returns the preset response.

function makeFakeResponse(status, opts = {}) {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ok: status > 0 && status < 400,
    headers: {
      get(k) {
        const kl = k.toLowerCase();
        if (kl === 'content-type') return opts.contentType || 'application/json';
        if (kl === 'retry-after') return opts.retryAfter || null;
        return null;
      },
      entries() { return Object.entries({ 'content-type': opts.contentType || 'application/json', ...(opts.retryAfter ? { 'retry-after': opts.retryAfter } : {}) }); },
    },
    body: null,
    text: async () => opts.body || '',
    json: async () => opts.body ? JSON.parse(opts.body) : {},
  };
}

let _originalFetch;

beforeEach(() => {
  _originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = _originalFetch;
});

// Keep unit tests fast: crush setTimeout delay to 0
const _origSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  globalThis.setTimeout = (fn) => _origSetTimeout(fn, 0);
});
afterEach(() => {
  globalThis.setTimeout = _origSetTimeout;
});

describe('proxy-retry executeRequest mode=off', () => {
  it('不重试，单次 fetch，attempts=1', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(200); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: '{}' },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'off' },
      ctx: {},
    });
    assert.equal(calls, 1);
    assert.equal(r.attempts, 1);
    assert.equal(r.retries, 0);
    assert.equal(r.finalStatus, 200);
    assert.equal(r.succeeded, true);
    assert.deepEqual(r.retryCodes, []);
  });

  it('off 模式遇到 503 也不重试', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(503); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'off' },
      ctx: {},
    });
    assert.equal(calls, 1);
    assert.equal(r.finalStatus, 503);
    assert.equal(r.succeeded, false);
  });
});

describe('proxy-retry executeRequest mode=serial', () => {
  it('503 → 重试到 200', async () => {
    const seq = [503, 503, 200];
    let i = 0;
    globalThis.fetch = async () => makeFakeResponse(seq[i++]);
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', retryIntervalMs: 1, maxRetries: 10 },
      ctx: {},
    });
    assert.equal(r.attempts, 3);
    assert.equal(r.finalStatus, 200);
    assert.equal(r.succeeded, true);
    assert.deepEqual(r.retryCodes, [503, 503]);
  });

  it('达到 maxRetries 后放弃', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(503); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', retryIntervalMs: 1, maxRetries: 3 },
      ctx: {},
    });
    // maxRetries=3: initial + 3 retries = 4 attempts, then give up
    assert.equal(r.attempts, 4);
    assert.equal(r.finalStatus, 503);
    assert.equal(r.succeeded, false);
    assert.equal(r.retryCodes.length, 4);
  });

  it('429 优先用 Retry-After 头', async () => {
    const seq = [{ status: 429, retryAfter: '0' }, { status: 200 }];
    let i = 0;
    globalThis.fetch = async () => {
      const s = seq[i++];
      return makeFakeResponse(s.status, { retryAfter: s.retryAfter });
    };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', retryInterval429Ms: 9999, maxRetries: 5 },
      ctx: {},
    });
    assert.equal(r.attempts, 2);
    assert.equal(r.finalStatus, 200);
    assert.deepEqual(r.retryCodes, [429]);
  });

  it('非重试状态码（404）不重试', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(404); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', maxRetries: 5 },
      ctx: {},
    });
    assert.equal(calls, 1);
    assert.equal(r.attempts, 1);
    assert.equal(r.finalStatus, 404);
  });

  it('流式 200 不重试（首字节后不重试）', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(200, { contentType: 'text/event-stream' }); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', maxRetries: 5 },
      ctx: {},
    });
    assert.equal(calls, 1);
    assert.equal(r.attempts, 1);
    assert.equal(r.succeeded, true);
  });

  it('网络异常（status=0）也重试', async () => {
    const seq = [0, 200];
    let i = 0;
    globalThis.fetch = async () => makeFakeResponse(seq[i++]);
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', retryIntervalMs: 1, maxRetries: 5 },
      ctx: {},
    });
    assert.equal(r.attempts, 2);
    assert.equal(r.finalStatus, 200);
    assert.deepEqual(r.retryCodes, [0]);
  });
});

describe('proxy-retry executeRequest mode=race', () => {
  it('并发齐发，第一个 200 胜出', async () => {
    let calls = 0;
    // First few 503, last one 200
    globalThis.fetch = async () => {
      calls++;
      return makeFakeResponse(calls <= 3 ? 503 : 200);
    };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'race', maxConcurrent: 5, retryIntervalMs: 1, maxRetries: 3 },
      ctx: {},
    });
    assert.equal(r.succeeded, true);
    assert.equal(r.finalStatus, 200);
    assert.ok(r.attempts >= 1);
  });

  it('全部失败 → 达到上限放弃', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(503); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'race', maxConcurrent: 3, retryIntervalMs: 1, maxRetries: 2 },
      ctx: {},
    });
    assert.equal(r.succeeded, false);
    assert.equal(r.finalStatus, 503);
    assert.ok(r.attempts >= 1);
  });
});

describe('proxy-retry executeRequest mode=stagger', () => {
  it('交错发，命中 200 即停', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return makeFakeResponse(calls <= 2 ? 503 : 200);
    };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'stagger', maxConcurrent: 3, retryIntervalMs: 1, maxRetries: 10 },
      ctx: {},
    });
    assert.equal(r.succeeded, true);
    assert.equal(r.finalStatus, 200);
  });

  it('全部失败 → 放弃', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(503); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'stagger', maxConcurrent: 2, retryIntervalMs: 1, maxRetries: 3 },
      ctx: {},
    });
    assert.equal(r.succeeded, false);
    assert.ok(r.attempts >= 1);
  });
});

describe('proxy-retry executeRequest 模型替换', () => {
  it('profile 存在时替换 body model', async () => {
    let capturedBody = null;
    globalThis.fetch = async (url, opts) => {
      capturedBody = opts.body;
      return makeFakeResponse(200);
    };
    await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {}, body: JSON.stringify({ model: 'claude-opus-4' }) },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'off' },
      ctx: { profile: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'replaced-opus' } },
    });
    assert.equal(JSON.parse(capturedBody).model, 'replaced-opus');
  });
});

// ── New coverage: signal preservation / real failure codes / deadline fallback / adaptive backoff / first-wave stagger ──

describe('proxy-retry executeRequest connectTimeoutMs=0 保留外部 signal', () => {
  it('race 模式 connectTimeoutMs=0 时，传给 fetch 的 signal 是 race 控制器的 signal（非 undefined）', async () => {
    let capturedSignal = null;
    globalThis.fetch = async (url, opts) => {
      capturedSignal = opts.signal;
      return makeFakeResponse(200);
    };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'race', maxConcurrent: 2, maxRetries: 1, connectTimeoutMs: 0 },
      ctx: {},
    });
    assert.equal(r.succeeded, true);
    // Fix #1: when connectTimeoutMs=0, timeoutCtl is null; previously signal was overwritten
    // with undefined (race cancellation signal lost). After the fix it falls back to
    // singleFetch's ctx.signal (race passes ctl.signal), so fetch must receive a real signal.
    assert.ok(capturedSignal, 'fetch 应收到 signal（而非 undefined）');
    assert.equal(typeof capturedSignal, 'object');
    assert.equal(typeof capturedSignal.aborted, 'boolean', '应是 AbortSignal 实例');
  });

  it('race 模式 connectTimeoutMs>0 时也传递 signal（timeoutCtl.signal）', async () => {
    let capturedSignal = null;
    globalThis.fetch = async (url, opts) => {
      capturedSignal = opts.signal;
      return makeFakeResponse(200);
    };
    await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'race', maxConcurrent: 2, maxRetries: 1, connectTimeoutMs: 5000 },
      ctx: {},
    });
    assert.ok(capturedSignal, 'fetch 应收到 signal（timeoutCtl 存在时）');
    assert.equal(typeof capturedSignal.aborted, 'boolean');
  });
});

describe('proxy-retry executeRequest 真实最后失败状态码', () => {
  it('race 全失败返回 429 时 finalStatus=429（不再硬编码 503）', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(429); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'race', maxConcurrent: 2, retryInterval429Ms: 0, retryIntervalMs: 0, maxRetries: 1 },
      ctx: {},
    });
    assert.equal(r.succeeded, false);
    assert.equal(r.finalStatus, 429, '应返回真实最后上游状态 429 而非 503');
    assert.equal(r.upstreamStatus, 429, 'upstreamStatus 应是真实 429');
  });

  it('stagger 全失败返回 429 时 finalStatus=429', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(429); };
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'stagger', maxConcurrent: 2, retryInterval429Ms: 0, retryIntervalMs: 0, maxRetries: 2 },
      ctx: {},
    });
    assert.equal(r.succeeded, false);
    assert.equal(r.finalStatus, 429, 'stagger 兜底应返回真实 429');
    assert.equal(r.upstreamStatus, 429);
  });

  it('serial 成功时 upstreamStatus 与 finalStatus 一致', async () => {
    const seq = [503, 200];
    let i = 0;
    globalThis.fetch = async () => makeFakeResponse(seq[i++]);
    const r = await executeRequest({
      url: 'https://example.com/v1/messages',
      fetchOptions: { method: 'POST', headers: {} },
      retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', retryIntervalMs: 1, maxRetries: 5 },
      ctx: {},
    });
    assert.equal(r.finalStatus, 200);
    assert.equal(r.upstreamStatus, 200);
  });
});

describe('proxy-retry executeRequest maxRetryDurationMs 截止兜底', () => {
  it('serial maxRetries=0（无限）时 maxRetryDurationMs 到期后停止', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(503); };
    // start computation and first loop check return 1000 (before deadline=6000) → allow first fetch;
    // subsequent loop check returns 6001 (past deadline) → stop, no longer retry indefinitely.
    const _origDateNow = Date.now;
    let callCount = 0;
    Date.now = () => { const v = callCount < 2 ? 1000 : 6001; callCount++; return v; };
    try {
      const r = await executeRequest({
        url: 'https://example.com/v1/messages',
        fetchOptions: { method: 'POST', headers: {} },
        retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'serial', retryIntervalMs: 1, maxRetries: 0, maxRetryDurationMs: 5000 },
        ctx: {},
      });
      assert.equal(r.finalStatus, 503);
      assert.ok(calls >= 1 && calls <= 2, `应在 deadline 后停止，实际 fetch 次数=${calls}`);
    } finally {
      Date.now = _origDateNow;
    }
  });
});

describe('proxy-retry executeRequest stagger 429 自适应退避', () => {
  it('连续 429 时下次派发间隔应指数增长（记录 setTimeout 延迟）', async () => {
    const delays = [];
    const _origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, d) => { delays.push(d); return _origSetTimeout(fn, d); };
    let calls = 0;
    globalThis.fetch = async () => { calls++; return makeFakeResponse(429); };
    try {
      await executeRequest({
        url: 'https://example.com/v1/messages',
        fetchOptions: { method: 'POST', headers: {} },
        retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'stagger', maxConcurrent: 1, retryInterval429Ms: 100, retryIntervalMs: 50, maxRetries: 4 },
        ctx: {},
      });
    } finally {
      globalThis.setTimeout = _origSetTimeout;
    }
    // Collected delays should include 429 backoff values (100 * 2^n), with at least one item greater than the initial retryInterval429Ms (100)
    const backoffs = delays.filter(d => d >= 100);
    assert.ok(backoffs.length > 0, '应存在 429 退避延迟');
    assert.ok(Math.max(...backoffs) > 100, '退避应指数增长（大于基准 100）');
  });
});

describe('proxy-retry executeRequest stagger 首波交错', () => {
  it('首波按 interval 调度后续派发（不再同 tick 齐发 maxConcurrent）', async () => {
    const delays = [];
    const _origSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, d) => { if (typeof d === 'number' && d > 0) delays.push(d); return _origSetTimeout(fn, d); };
    let calls = 0;
    // First two 503, third 200 wins
    globalThis.fetch = async () => { calls++; return makeFakeResponse(calls <= 2 ? 503 : 200); };
    try {
      await executeRequest({
        url: 'https://example.com/v1/messages',
        fetchOptions: { method: 'POST', headers: {} },
        retryConfig: { ...DEFAULT_RETRY_CONFIG, mode: 'stagger', maxConcurrent: 3, retryIntervalMs: 30, maxRetries: 5 },
        ctx: {},
      });
    } finally {
      globalThis.setTimeout = _origSetTimeout;
    }
    // Fix #11: old implementation fired the first wave synchronously up to maxConcurrent
    // (no interval scheduling). After the fix the scheduler dispatches subsequent requests
    // via setTimeout(interval). At least one scheduling delay == retryIntervalMs (30) should be recorded (first-wave stagger).
    assert.ok(delays.includes(30), `应按 interval=30 调度首波后续派发，记录到的延迟=${JSON.stringify(delays)}`);
  });
});
