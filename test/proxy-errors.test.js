import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractApiErrorMessage, formatProxyRequestError } from '../lib/proxy-errors.js';

describe('extractApiErrorMessage', () => {
  it('提取 error.message', () => {
    const text = JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: '模型全局请求额度超限(并发限流)' }
    });
    assert.equal(extractApiErrorMessage(429, text), '模型全局请求额度超限(并发限流)');
  });

  it('提取顶层 message', () => {
    const text = JSON.stringify({ message: 'service unavailable' });
    assert.equal(extractApiErrorMessage(503, text), 'service unavailable');
  });

  it('非 JSON 返回兜底信息', () => {
    const text = 'bad gateway';
    assert.equal(extractApiErrorMessage(502, text), 'API Error (502): bad gateway');
  });

  it('truncates long non-JSON text to 200 chars', () => {
    const text = 'x'.repeat(300);
    const result = extractApiErrorMessage(500, text);
    assert.ok(result.includes('x'.repeat(200)));
    assert.ok(!result.includes('x'.repeat(201)));
  });

  it('handles empty error object gracefully', () => {
    const text = JSON.stringify({ error: {} });
    assert.equal(extractApiErrorMessage(500, text), 'API Error (500): {"error":{}}');
  });
});

describe('formatProxyRequestError', () => {
  it('将头超时转换为固定提示', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'UND_ERR_HEADERS_TIMEOUT' };
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: Upstream headers timeout');
  });

  it('保留普通错误内容', () => {
    const err = new Error('network down');
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: network down');
  });

  it('converts body timeout to fixed message', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'UND_ERR_BODY_TIMEOUT' };
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: Upstream body timeout');
  });

  it('appends cause.message when present', () => {
    const err = new Error('fetch failed');
    err.cause = { message: 'ECONNREFUSED' };
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: fetch failed (ECONNREFUSED)');
  });

  it('appends cause.code when no cause.message', () => {
    const err = new Error('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: fetch failed (ENOTFOUND)');
  });

  it('falls back to cause itself when no message or code', () => {
    const err = new Error('fetch failed');
    err.cause = 'raw cause string';
    assert.equal(formatProxyRequestError(err), '[CC-Viewer Proxy] Request failed: fetch failed (raw cause string)');
  });

  it('handles non-Error input', () => {
    const result = formatProxyRequestError('just a string');
    assert.equal(result, '[CC-Viewer Proxy] Request failed: just a string');
  });

  it('handles null/undefined input', () => {
    const result = formatProxyRequestError(null);
    assert.equal(result, '[CC-Viewer Proxy] Request failed: null');
  });
});
