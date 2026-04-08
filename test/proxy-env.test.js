import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProxyConfig } from '../lib/proxy-env.js';

describe('resolveProxyConfig', () => {
  it('无代理变量时返回全 undefined', () => {
    const result = resolveProxyConfig({});
    assert.deepStrictEqual(result, {
      httpProxy: undefined,
      httpsProxy: undefined,
      noProxy: undefined,
    });
  });

  it('读取 http_proxy/https_proxy', () => {
    const result = resolveProxyConfig({
      http_proxy: 'http://proxy:8080',
      https_proxy: 'http://proxy:8443',
    });
    assert.equal(result.httpProxy, 'http://proxy:8080');
    assert.equal(result.httpsProxy, 'http://proxy:8443');
  });

  it('大写 HTTP_PROXY/HTTPS_PROXY', () => {
    const result = resolveProxyConfig({
      HTTP_PROXY: 'http://proxy:8080',
      HTTPS_PROXY: 'http://proxy:8443',
    });
    assert.equal(result.httpProxy, 'http://proxy:8080');
    assert.equal(result.httpsProxy, 'http://proxy:8443');
  });

  it('ALL_PROXY 作为 fallback', () => {
    const result = resolveProxyConfig({
      ALL_PROXY: 'http://proxy:9999',
    });
    assert.equal(result.httpProxy, 'http://proxy:9999');
    assert.equal(result.httpsProxy, 'http://proxy:9999');
  });

  it('all_proxy 小写', () => {
    const result = resolveProxyConfig({
      all_proxy: 'http://proxy:9999',
    });
    assert.equal(result.httpProxy, 'http://proxy:9999');
    assert.equal(result.httpsProxy, 'http://proxy:9999');
  });

  it('http_proxy 优先于 ALL_PROXY', () => {
    const result = resolveProxyConfig({
      http_proxy: 'http://specific:8080',
      ALL_PROXY: 'http://fallback:9999',
    });
    assert.equal(result.httpProxy, 'http://specific:8080');
    assert.equal(result.httpsProxy, 'http://fallback:9999');
  });

  it('读取 no_proxy/NO_PROXY', () => {
    const result = resolveProxyConfig({
      no_proxy: 'localhost,127.0.0.1',
    });
    assert.equal(result.noProxy, 'localhost,127.0.0.1');

    const result2 = resolveProxyConfig({
      NO_PROXY: '*.example.com',
    });
    assert.equal(result2.noProxy, '*.example.com');
  });
});
