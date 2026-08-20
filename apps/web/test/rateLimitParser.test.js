/**
 * rateLimitParser 单元测试。
 * 直接测试纯函数 parseRateLimitHeaders / pickHeadlineWindow（零依赖，ESM 直接 import）。
 * fixture 取自真实日志校验过的取值（htmls 项目，status-200 mainAgent 响应）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRateLimitHeaders, pickHeadlineWindow, extractLatestPlanUsage } from '../src/utils/rateLimitParser.js';

// 真实下发的统一限流头（全部为字符串）。
function realHeaders(extra = {}) {
  return {
    'content-type': 'application/json',
    'anthropic-ratelimit-unified-5h-reset': '1779967200',
    'anthropic-ratelimit-unified-5h-status': 'allowed',
    'anthropic-ratelimit-unified-5h-utilization': '0.19',
    'anthropic-ratelimit-unified-7d-reset': '1780178400',
    'anthropic-ratelimit-unified-7d-status': 'allowed',
    'anthropic-ratelimit-unified-7d-utilization': '0.52',
    'anthropic-ratelimit-unified-fallback-percentage': '0.5',
    'anthropic-ratelimit-unified-overage-disabled-reason': 'out_of_credits',
    'anthropic-ratelimit-unified-overage-status': 'rejected',
    'anthropic-ratelimit-unified-representative-claim': 'five_hour',
    'anthropic-ratelimit-unified-reset': '1779967200',
    'anthropic-ratelimit-unified-status': 'allowed',
    ...extra,
  };
}

describe('parseRateLimitHeaders', () => {
  it('解析真实头：归一化出 plan / 两个窗口 / 字符串转数值 / reset 秒转毫秒', () => {
    const r = parseRateLimitHeaders(realHeaders());
    assert.equal(r.source, 'plan');
    assert.equal(r.windows.length, 2);

    const w5 = r.windows.find((w) => w.id === '5h');
    assert.equal(w5.utilization, 0.19);
    assert.equal(w5.status, 'allowed');
    assert.equal(w5.resetAt, 1779967200 * 1000); // 秒 → 毫秒

    const w7 = r.windows.find((w) => w.id === '7d');
    assert.equal(w7.utilization, 0.52);
    assert.equal(w7.resetAt, 1780178400 * 1000);

    assert.equal(r.representativeClaim, 'five_hour');
    assert.equal(r.overallStatus, 'allowed');
    assert.equal(r.overage.status, 'rejected');
    assert.equal(r.overage.disabledReason, 'out_of_credits');
    assert.equal(r.fallbackPercentage, 0.5);
  });

  it('无任何 unified 头 → 返回 null', () => {
    assert.equal(parseRateLimitHeaders({ 'content-type': 'application/json', date: 'x' }), null);
  });

  it('空 / undefined / 非对象输入 → 返回 null（不抛）', () => {
    assert.equal(parseRateLimitHeaders(null), null);
    assert.equal(parseRateLimitHeaders(undefined), null);
    assert.equal(parseRateLimitHeaders('nope'), null);
    assert.equal(parseRateLimitHeaders({}), null);
  });

  it('只有 5h 窗口 → windows 长度为 1，不抛', () => {
    const r = parseRateLimitHeaders({
      'anthropic-ratelimit-unified-5h-utilization': '0.3',
      'anthropic-ratelimit-unified-5h-reset': '1779967200',
      'anthropic-ratelimit-unified-5h-status': 'allowed',
    });
    assert.equal(r.windows.length, 1);
    assert.equal(r.windows[0].id, '5h');
    assert.equal(r.windows[0].utilization, 0.3);
  });

  it('存在多余未知 key（真实 liu 项目的 -fallback）→ 忽略，不抛', () => {
    const r = parseRateLimitHeaders(realHeaders({ 'anthropic-ratelimit-unified-fallback': 'whatever' }));
    assert.equal(r.source, 'plan');
    assert.equal(r.windows.length, 2);
  });

  it('垃圾 utilization / reset → 安全降级为 null，不抛', () => {
    const r = parseRateLimitHeaders({
      'anthropic-ratelimit-unified-5h-utilization': 'abc',
      'anthropic-ratelimit-unified-5h-reset': 'not-a-number',
      'anthropic-ratelimit-unified-5h-status': 'allowed',
    });
    assert.equal(r.windows.length, 1); // status 在 → 窗口仍存在
    assert.equal(r.windows[0].utilization, null);
    assert.equal(r.windows[0].resetAt, null);
    assert.equal(r.windows[0].status, 'allowed');
  });

  it('大小写无关：大写 key 也能解析', () => {
    const r = parseRateLimitHeaders({
      'ANTHROPIC-RATELIMIT-UNIFIED-5H-UTILIZATION': '0.42',
      'Anthropic-RateLimit-Unified-5h-Status': 'allowed',
    });
    assert.equal(r.windows.length, 1);
    assert.equal(r.windows[0].utilization, 0.42);
  });
});

describe('pickHeadlineWindow', () => {
  it('representative-claim=five_hour → 选 5h', () => {
    const r = parseRateLimitHeaders(realHeaders());
    assert.equal(pickHeadlineWindow(r).id, '5h');
  });

  it('claim 指向周 → 选 7d', () => {
    const r = parseRateLimitHeaders(realHeaders({ 'anthropic-ratelimit-unified-representative-claim': 'seven_day' }));
    assert.equal(pickHeadlineWindow(r).id, '7d');
  });

  it('claim 无法识别 → 回落到使用率更高的窗口', () => {
    const r = parseRateLimitHeaders(realHeaders({ 'anthropic-ratelimit-unified-representative-claim': 'mystery' }));
    assert.equal(pickHeadlineWindow(r).id, '7d'); // 0.52 > 0.19
  });

  it('空输入 → null', () => {
    assert.equal(pickHeadlineWindow(null), null);
    assert.equal(pickHeadlineWindow({ windows: [] }), null);
  });
});

describe('extractLatestPlanUsage', () => {
  it('取最近一条带统一限流头的响应', () => {
    const requests = [
      { response: { headers: { 'content-type': 'application/json' } } },                 // 无限流头
      { response: { headers: realHeaders() } },                                            // 较早
      { response: { headers: realHeaders({ 'anthropic-ratelimit-unified-5h-utilization': '0.42' }) } }, // 最新
      { response: { headers: { date: 'x' } } },                                            // 最后但无限流头 → 跳过
    ];
    const r = extractLatestPlanUsage(requests);
    assert.equal(r.source, 'plan');
    assert.equal(r.windows.find((w) => w.id === '5h').utilization, 0.42); // 取到的是最新那条
  });

  it('没有任何带限流头的响应 → null', () => {
    assert.equal(extractLatestPlanUsage([{ response: { headers: { date: 'x' } } }, {}]), null);
  });

  it('非数组 / 空 → null，不抛', () => {
    assert.equal(extractLatestPlanUsage(null), null);
    assert.equal(extractLatestPlanUsage(undefined), null);
    assert.equal(extractLatestPlanUsage([]), null);
  });
});
