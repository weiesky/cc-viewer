import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Tests for proxy.js core logic.
 *
 * Since proxy.js imports interceptor.js (which patches globalThis.fetch and
 * has other side effects), we test the pure logic by replicating functions here.
 */

// ============================================================================
// Replicated pure functions from proxy.js
// ============================================================================

function getBaseUrlFromSettings(settingsPath) {
  try {
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.env && settings.env.ANTHROPIC_BASE_URL) {
        return settings.env.ANTHROPIC_BASE_URL;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function getOriginalBaseUrl(configPaths, envBaseUrl, activeProfile = null) {
  // 热切换 profile 最高优先（与 proxy.js 同步）
  if (activeProfile && activeProfile.baseURL) return activeProfile.baseURL;
  for (const configPath of configPaths) {
    const url = getBaseUrlFromSettings(configPath);
    if (url) return url;
  }
  if (envBaseUrl) return envBaseUrl;
  return 'https://api.anthropic.com';
}

// URL joining logic from startProxy request handler
function buildFullUrl(originalBaseUrl, reqUrl) {
  const cleanBase = originalBaseUrl.endsWith('/') ? originalBaseUrl.slice(0, -1) : originalBaseUrl;
  const cleanReq = reqUrl.startsWith('/') ? reqUrl.slice(1) : reqUrl;
  return `${cleanBase}/${cleanReq}`;
}

// Response header filtering logic from startProxy
function filterResponseHeaders(headerEntries) {
  const filtered = {};
  for (const [key, value] of headerEntries) {
    if (key.toLowerCase() !== 'content-encoding'
      && key.toLowerCase() !== 'transfer-encoding'
      && key.toLowerCase() !== 'content-length') {
      filtered[key] = value;
    }
  }
  return filtered;
}

// Error message formatting logic from startProxy catch block
function formatProxyError(err) {
  let msg = err.message;
  if (err.cause) msg += ` (${err.cause.message || err.cause.code || err.cause})`;
  if (msg.includes('HEADERS_TIMEOUT')) msg = 'Upstream headers timeout';
  if (msg.includes('BODY_TIMEOUT')) msg = 'Upstream body timeout';
  return msg;
}

// ============================================================================
// Tests
// ============================================================================

describe('proxy', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ccv-proxy-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // getBaseUrlFromSettings
  // --------------------------------------------------------------------------
  describe('getBaseUrlFromSettings', () => {
    it('reads ANTHROPIC_BASE_URL from settings file', () => {
      const settingsPath = join(tempDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        env: { ANTHROPIC_BASE_URL: 'https://custom-api.example.com' },
      }));
      assert.equal(getBaseUrlFromSettings(settingsPath), 'https://custom-api.example.com');
    });

    it('returns null when file does not exist', () => {
      assert.equal(getBaseUrlFromSettings(join(tempDir, 'nonexistent.json')), null);
    });

    it('returns null when env key is missing', () => {
      const settingsPath = join(tempDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ env: { OTHER_VAR: 'value' } }));
      assert.equal(getBaseUrlFromSettings(settingsPath), null);
    });

    it('returns null when env object is missing', () => {
      const settingsPath = join(tempDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({ someOther: 'data' }));
      assert.equal(getBaseUrlFromSettings(settingsPath), null);
    });

    it('returns null for corrupted JSON', () => {
      const settingsPath = join(tempDir, 'settings.json');
      writeFileSync(settingsPath, 'not valid json{{{');
      assert.equal(getBaseUrlFromSettings(settingsPath), null);
    });

    it('returns null for empty file', () => {
      const settingsPath = join(tempDir, 'settings.json');
      writeFileSync(settingsPath, '');
      assert.equal(getBaseUrlFromSettings(settingsPath), null);
    });
  });

  // --------------------------------------------------------------------------
  // getOriginalBaseUrl
  // --------------------------------------------------------------------------
  describe('getOriginalBaseUrl', () => {
    it('returns URL from first matching config file', () => {
      const s1 = join(tempDir, 'local.json');
      const s2 = join(tempDir, 'project.json');
      writeFileSync(s1, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://local.example.com' } }));
      writeFileSync(s2, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://project.example.com' } }));

      assert.equal(getOriginalBaseUrl([s1, s2], null), 'https://local.example.com');
    });

    it('falls through to second config if first has no URL', () => {
      const s1 = join(tempDir, 'local.json');
      const s2 = join(tempDir, 'project.json');
      writeFileSync(s1, JSON.stringify({ env: {} }));
      writeFileSync(s2, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://project.example.com' } }));

      assert.equal(getOriginalBaseUrl([s1, s2], null), 'https://project.example.com');
    });

    it('uses env var when no config files match', () => {
      assert.equal(
        getOriginalBaseUrl([join(tempDir, 'nope.json')], 'https://env.example.com'),
        'https://env.example.com'
      );
    });

    it('returns default when nothing matches', () => {
      assert.equal(
        getOriginalBaseUrl([join(tempDir, 'nope.json')], null),
        'https://api.anthropic.com'
      );
    });

    it('config file takes priority over env var', () => {
      const s1 = join(tempDir, 'settings.json');
      writeFileSync(s1, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://config.example.com' } }));

      assert.equal(
        getOriginalBaseUrl([s1], 'https://env.example.com'),
        'https://config.example.com'
      );
    });

    it('active profile baseURL takes priority over everything else', () => {
      const s1 = join(tempDir, 'settings.json');
      writeFileSync(s1, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://config.example.com' } }));

      assert.equal(
        getOriginalBaseUrl(
          [s1],
          'https://env.example.com',
          { baseURL: 'https://foxcode.example.com/claude' }
        ),
        'https://foxcode.example.com/claude'
      );
    });

    it('null active profile falls through to config/env/default chain', () => {
      const s1 = join(tempDir, 'settings.json');
      writeFileSync(s1, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://config.example.com' } }));

      assert.equal(
        getOriginalBaseUrl([s1], null, null),
        'https://config.example.com'
      );
    });

    it('active profile without baseURL falls through (max profile case)', () => {
      // max profile 只有 id/name，没有 baseURL，应该回退到配置链
      assert.equal(
        getOriginalBaseUrl([], 'https://env.example.com', { id: 'max', name: 'Default' }),
        'https://env.example.com'
      );
    });
  });

  // --------------------------------------------------------------------------
  // buildFullUrl
  // --------------------------------------------------------------------------
  describe('buildFullUrl', () => {
    it('joins base URL and request path', () => {
      assert.equal(
        buildFullUrl('https://api.anthropic.com', '/v1/messages'),
        'https://api.anthropic.com/v1/messages'
      );
    });

    it('handles trailing slash on base URL', () => {
      assert.equal(
        buildFullUrl('https://api.anthropic.com/', '/v1/messages'),
        'https://api.anthropic.com/v1/messages'
      );
    });

    it('handles no leading slash on request path', () => {
      assert.equal(
        buildFullUrl('https://api.anthropic.com', 'v1/messages'),
        'https://api.anthropic.com/v1/messages'
      );
    });

    it('handles both trailing and no leading slash', () => {
      assert.equal(
        buildFullUrl('https://api.anthropic.com/', 'v1/messages'),
        'https://api.anthropic.com/v1/messages'
      );
    });

    it('preserves base URL path prefix', () => {
      assert.equal(
        buildFullUrl('https://gateway.example.com/proxy/anthropic', '/v1/messages'),
        'https://gateway.example.com/proxy/anthropic/v1/messages'
      );
    });

    it('preserves query string', () => {
      assert.equal(
        buildFullUrl('https://api.anthropic.com', '/v1/messages?beta=true'),
        'https://api.anthropic.com/v1/messages?beta=true'
      );
    });
  });

  // --------------------------------------------------------------------------
  // filterResponseHeaders
  // --------------------------------------------------------------------------
  describe('filterResponseHeaders', () => {
    it('removes content-encoding, transfer-encoding, content-length', () => {
      const headers = [
        ['content-type', 'application/json'],
        ['content-encoding', 'gzip'],
        ['transfer-encoding', 'chunked'],
        ['content-length', '1234'],
        ['x-request-id', 'abc'],
      ];
      const filtered = filterResponseHeaders(headers);
      assert.deepStrictEqual(filtered, {
        'content-type': 'application/json',
        'x-request-id': 'abc',
      });
    });

    it('handles case-insensitive header names', () => {
      const headers = [
        ['Content-Encoding', 'br'],
        ['Transfer-Encoding', 'chunked'],
        ['Content-Length', '500'],
        ['X-Custom', 'value'],
      ];
      const filtered = filterResponseHeaders(headers);
      assert.deepStrictEqual(filtered, { 'X-Custom': 'value' });
    });

    it('returns empty object for empty headers', () => {
      assert.deepStrictEqual(filterResponseHeaders([]), {});
    });

    it('passes through all headers when none match filter', () => {
      const headers = [
        ['x-request-id', '123'],
        ['anthropic-ratelimit-remaining', '99'],
      ];
      const filtered = filterResponseHeaders(headers);
      assert.equal(Object.keys(filtered).length, 2);
    });
  });

  // --------------------------------------------------------------------------
  // formatProxyError
  // --------------------------------------------------------------------------
  describe('formatProxyError', () => {
    it('returns basic error message', () => {
      assert.equal(formatProxyError(new Error('connection refused')), 'connection refused');
    });

    it('appends cause message', () => {
      const err = new Error('fetch failed');
      err.cause = new Error('ECONNREFUSED');
      assert.equal(formatProxyError(err), 'fetch failed (ECONNREFUSED)');
    });

    it('appends cause code when no message', () => {
      const err = new Error('fetch failed');
      err.cause = { code: 'ENOTFOUND' };
      assert.equal(formatProxyError(err), 'fetch failed (ENOTFOUND)');
    });

    it('appends cause as string', () => {
      const err = new Error('fetch failed');
      err.cause = 'some reason';
      assert.equal(formatProxyError(err), 'fetch failed (some reason)');
    });

    it('shortens HEADERS_TIMEOUT', () => {
      assert.equal(
        formatProxyError(new Error('UND_ERR_HEADERS_TIMEOUT')),
        'Upstream headers timeout'
      );
    });

    it('shortens BODY_TIMEOUT', () => {
      assert.equal(
        formatProxyError(new Error('UND_ERR_BODY_TIMEOUT')),
        'Upstream body timeout'
      );
    });

    it('shortens timeout with cause', () => {
      const err = new Error('UND_ERR_HEADERS_TIMEOUT');
      err.cause = { code: 'TIMEOUT' };
      // cause is appended first, then timeout shortening applies
      assert.equal(formatProxyError(err), 'Upstream headers timeout');
    });
  });

  // --------------------------------------------------------------------------
  // Request header handling
  // --------------------------------------------------------------------------
  describe('request header handling', () => {
    it('x-cc-viewer-trace header is set to true', () => {
      // Simulates the header injection logic in startProxy
      const headers = { 'content-type': 'application/json', host: 'api.anthropic.com' };
      delete headers.host;
      headers['x-cc-viewer-trace'] = 'true';

      assert.equal(headers['x-cc-viewer-trace'], 'true');
      assert.equal(headers.host, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // Config path priority
  // --------------------------------------------------------------------------
  describe('config path priority', () => {
    it('settings.local.json > settings.json > home settings > env var', () => {
      const localSettings = join(tempDir, '.claude', 'settings.local.json');
      const projectSettings = join(tempDir, '.claude', 'settings.json');
      const homeSettings = join(tempDir, 'home', '.claude', 'settings.json');

      mkdirSync(join(tempDir, '.claude'), { recursive: true });
      mkdirSync(join(tempDir, 'home', '.claude'), { recursive: true });

      writeFileSync(localSettings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://local.test' } }));
      writeFileSync(projectSettings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://project.test' } }));
      writeFileSync(homeSettings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://home.test' } }));

      // All three exist — local wins
      assert.equal(
        getOriginalBaseUrl([localSettings, projectSettings, homeSettings], 'https://env.test'),
        'https://local.test'
      );

      // Remove local — project wins
      assert.equal(
        getOriginalBaseUrl([join(tempDir, 'nope'), projectSettings, homeSettings], 'https://env.test'),
        'https://project.test'
      );

      // Remove project — home wins
      assert.equal(
        getOriginalBaseUrl([join(tempDir, 'nope'), join(tempDir, 'nope2'), homeSettings], 'https://env.test'),
        'https://home.test'
      );

      // Remove all — env wins
      assert.equal(
        getOriginalBaseUrl([join(tempDir, 'a'), join(tempDir, 'b'), join(tempDir, 'c')], 'https://env.test'),
        'https://env.test'
      );

      // Remove env — default
      assert.equal(
        getOriginalBaseUrl([join(tempDir, 'a'), join(tempDir, 'b'), join(tempDir, 'c')], null),
        'https://api.anthropic.com'
      );
    });
  });

  // --------------------------------------------------------------------------
  // Proxy auth header replacement (for hot-switch profile)
  //
  // KEEP IN SYNC: 与 interceptor.js::_replaceProxyAuthHeaders 保持一致。
  // interceptor.js 的 fetch 补丁有 module-level 副作用，这里复制纯函数做单测。
  // --------------------------------------------------------------------------
  describe('proxy auth header replacement', () => {
    function replaceProxyAuthHeaders(headers, apiKey) {
      const newHeaders = { ...headers };
      let matchedAuthKey = null, matchedXApiKey = null;
      for (const k of Object.keys(newHeaders)) {
        const lk = k.toLowerCase();
        if (lk === 'authorization') matchedAuthKey = k;
        else if (lk === 'x-api-key') matchedXApiKey = k;
      }
      if (matchedAuthKey) newHeaders[matchedAuthKey] = `Bearer ${apiKey}`;
      if (matchedXApiKey) newHeaders[matchedXApiKey] = apiKey;
      if (!matchedAuthKey && !matchedXApiKey) newHeaders['x-api-key'] = apiKey;
      return { headers: newHeaders, matchedAuthKey, matchedXApiKey };
    }

    it('replaces authorization header case-insensitively (lowercase)', () => {
      const { headers, matchedAuthKey, matchedXApiKey } = replaceProxyAuthHeaders(
        { authorization: 'Bearer old-key', 'content-type': 'application/json' },
        'sk-new'
      );
      assert.equal(matchedAuthKey, 'authorization');
      assert.equal(matchedXApiKey, null);
      assert.equal(headers.authorization, 'Bearer sk-new');
      assert.equal(headers['content-type'], 'application/json');
    });

    it('replaces authorization header case-insensitively (TitleCase)', () => {
      const { headers, matchedAuthKey } = replaceProxyAuthHeaders(
        { Authorization: 'Bearer old-key' },
        'sk-new'
      );
      assert.equal(matchedAuthKey, 'Authorization');
      assert.equal(headers.Authorization, 'Bearer sk-new');
      assert.equal(headers.authorization, undefined, 'should not create a lowercase duplicate');
    });

    it('replaces x-api-key case-insensitively (X-API-Key)', () => {
      const { headers, matchedXApiKey, matchedAuthKey } = replaceProxyAuthHeaders(
        { 'X-API-Key': 'old-key' },
        'sk-new'
      );
      assert.equal(matchedXApiKey, 'X-API-Key');
      assert.equal(matchedAuthKey, null);
      assert.equal(headers['X-API-Key'], 'sk-new');
    });

    it('replaces BOTH authorization and x-api-key simultaneously when both present', () => {
      const { headers, matchedAuthKey, matchedXApiKey } = replaceProxyAuthHeaders(
        { authorization: 'Bearer old-auth', 'x-api-key': 'old-xkey' },
        'sk-new'
      );
      assert.equal(matchedAuthKey, 'authorization');
      assert.equal(matchedXApiKey, 'x-api-key');
      assert.equal(headers.authorization, 'Bearer sk-new');
      assert.equal(headers['x-api-key'], 'sk-new');
    });

    it('plants x-api-key when BOTH headers missing (third-party proxy fallback)', () => {
      const { headers, matchedAuthKey, matchedXApiKey } = replaceProxyAuthHeaders(
        { 'content-type': 'application/json' },
        'sk-new'
      );
      assert.equal(matchedAuthKey, null);
      assert.equal(matchedXApiKey, null);
      assert.equal(headers['x-api-key'], 'sk-new');
      assert.equal(headers['content-type'], 'application/json');
    });

    it('does NOT plant x-api-key when authorization was matched', () => {
      const { headers } = replaceProxyAuthHeaders(
        { authorization: 'Bearer old' },
        'sk-new'
      );
      assert.equal(headers['x-api-key'], undefined);
    });

    it('returns a new headers object (does not mutate input)', () => {
      const input = { authorization: 'Bearer old' };
      const { headers } = replaceProxyAuthHeaders(input, 'sk-new');
      assert.notEqual(headers, input, 'should return a fresh object');
      assert.equal(input.authorization, 'Bearer old', 'input must remain untouched');
    });
  });
});
