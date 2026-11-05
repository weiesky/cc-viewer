// Coverage: server/lib/base-url.js — parsing/merging/URL building for CCV_BASE_URL (public URL of a cloud reverse proxy).
// Pure-function unit tests: no filesystem access, no server startup.
// Highest-risk lock: basePath must keep the literal {token} (new URL encodes braces as %7B; the injection side needs the literal form),
// while wireBasePath must produce the encoded form (a request pathname parsed by new URL can only match in encoded form).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeBaseUrlValue,
  parseBaseUrl,
  resolveBaseConfig,
  baseUrlAllowedHost,
  forwardedProto,
  resolveExternalScheme,
  buildExternalUrl,
  externalUrlFromConfig,
  wireBasePath,
  wireBasePathVariants,
} from '../server/lib/base-url.js';
import { tFor } from '../server/i18n.js';

const ARCA = 'arca-sandbox-office.alipay.com';
const ARCA_PATH = '/arca/api/v1/session/{token}';

describe('base-url lib', () => {
  describe('sanitizeBaseUrlValue', () => {
    it('null/undefined → empty string; trims; strips CRLF (prevents log/injection line breakage)', () => {
      assert.equal(sanitizeBaseUrlValue(null), '');
      assert.equal(sanitizeBaseUrlValue(undefined), '');
      assert.equal(sanitizeBaseUrlValue('  /proxy/  '), '/proxy/');
      assert.equal(sanitizeBaseUrlValue('/pro\r\nxy/'), '/proxy/');
    });
  });

  describe('parseBaseUrl', () => {
    it('unset/empty/root → ok, no host, empty basePath', () => {
      assert.deepEqual(parseBaseUrl(undefined), { ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });
      assert.deepEqual(parseBaseUrl(''), { ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });
      assert.deepEqual(parseBaseUrl('/'), { ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });
    });

    it('form 1: host+path (no scheme)', () => {
      const r = parseBaseUrl(`${ARCA}${ARCA_PATH}`);
      assert.deepEqual(r, {
        ok: true, scheme: null, host: ARCA, port: null,
        basePath: '/arca/api/v1/session/{token}/', warning: null,
      });
      // The literal {token} must be preserved — the injected <base href>/__CCV_BASE_PATH__ uses the literal form
      assert.ok(r.basePath.includes('{token}'));
      assert.ok(!r.basePath.includes('%7B'));
    });

    it('form 2: path only', () => {
      const r = parseBaseUrl(ARCA_PATH);
      assert.deepEqual(r, {
        ok: true, scheme: null, host: null, port: null,
        basePath: '/arca/api/v1/session/{token}/', warning: null,
      });
    });

    it('form 3: full URL with explicit https/http scheme', () => {
      assert.deepEqual(parseBaseUrl(`https://${ARCA}${ARCA_PATH}`), {
        ok: true, scheme: 'https', host: ARCA, port: null,
        basePath: '/arca/api/v1/session/{token}/', warning: null,
      });
      assert.deepEqual(parseBaseUrl(`http://${ARCA}/x`), {
        ok: true, scheme: 'http', host: ARCA, port: null, basePath: '/x/', warning: null,
      });
    });

    it('ws/wss normalized to http/https (WS URLs are derived by the caller)', () => {
      assert.equal(parseBaseUrl(`ws://${ARCA}/x`).scheme, 'http');
      assert.equal(parseBaseUrl(`wss://${ARCA}/x`).scheme, 'https');
    });

    it('host-only form: empty basePath (authoritative no-prefix)', () => {
      assert.deepEqual(parseBaseUrl(ARCA), { ok: true, scheme: null, host: ARCA, port: null, basePath: '', warning: null });
      assert.deepEqual(parseBaseUrl(`https://${ARCA}`), { ok: true, scheme: 'https', host: ARCA, port: null, basePath: '', warning: null });
    });

    it('with port: host strips the port, port is numeric', () => {
      const r = parseBaseUrl(`${ARCA}:8443/x`);
      assert.deepEqual(r, { ok: true, scheme: null, host: ARCA, port: 8443, basePath: '/x/', warning: null });
    });

    it('IPv6 keeps brackets, hostname lowercased', () => {
      assert.deepEqual(parseBaseUrl('http://[::1]:7008/x'), { ok: true, scheme: 'http', host: '[::1]', port: 7008, basePath: '/x/', warning: null });
      assert.equal(parseBaseUrl('HTTP://EXAMPLE.COM/X').host, 'example.com');
    });

    it('invalid values → ok:false + baseUrl.invalid', () => {
      for (const bad of [
        `${ARCA}:99999/x`,          // port out of range
        `${ARCA}:0/x`,              // port 0
        `${ARCA}:abc/x`,            // non-numeric port
        'https://user:pass@h/x',    // credentials
        'ftp://h/x',                // unsupported scheme
        '*',                        // wildcard is not a valid authority
        'https://bad host/x',       // authority contains a space
        '/x y/',                    // path contains whitespace (necessarily diverges from the wire form)
        '/x y/?q=1',                // whitespace + query string: invalid takes precedence over queryFragment
        'https://',                 // scheme only, no authority: a config error rather than "no prefix"
        'https://?x=1',             // scheme + bare query string: same as above
        `${ARCA}//x`,               // path '//...' would inject a protocol-relative <base href="//x/">
      ]) {
        const r = parseBaseUrl(bad);
        assert.equal(r.ok, false, `${bad} 应判非法`);
        assert.equal(r.warning, 'baseUrl.invalid', `${bad} 告警 key`);
      }
    });

    it('leading // parses as authority (prevents cross-origin <base href="//evil"> injection)', () => {
      const r = parseBaseUrl('//evil.example/x');
      assert.equal(r.ok, true);
      assert.equal(r.host, 'evil.example');
      assert.equal(r.basePath, '/x/');
      assert.equal(r.scheme, null);
    });

    it('query string/fragment truncated + queryFragmentIgnored warning', () => {
      const r = parseBaseUrl(`https://${ARCA}/path?x=1#frag`);
      assert.equal(r.ok, true);
      assert.equal(r.basePath, '/path/');
      assert.equal(r.warning, 'baseUrl.queryFragmentIgnored');
    });

    it('parses after CRLF sanitization', () => {
      const r = parseBaseUrl(`https://${ARCA}/x\r\ny/`);
      assert.equal(r.ok, true);
      assert.equal(r.basePath, '/xy/');
    });

    it('backslash rejected as cross-origin injection (WHATWG parses /\\evil as protocol-relative)', () => {
      const r = parseBaseUrl('/\\evil.example/x');
      assert.equal(r.ok, false);
      assert.equal(r.warning, 'baseUrl.invalid');
    });

    it('C0 control characters rejected (risk of reaching the startup terminal/injection string verbatim)', () => {
      const esc = parseBaseUrl(`/p${String.fromCharCode(27)}[31m/x`);
      assert.equal(esc.ok, false);
      const del = parseBaseUrl(`/p${String.fromCharCode(127)}/x`);
      assert.equal(del.ok, false);
    });

    it('bare query string/bare fragment rejected as invalid (otherwise silently overrides CCV_BASE_PATH with empty)', () => {
      for (const bad of ['?x=1', '#frag']) {
        const r = parseBaseUrl(bad);
        assert.equal(r.ok, false, `${bad} 应判非法`);
        assert.equal(r.warning, 'baseUrl.invalid');
      }
      // and must not override a valid CCV_BASE_PATH
      const cfg = resolveBaseConfig({ CCV_BASE_URL: '?x=1', CCV_BASE_PATH: '/p/' });
      assert.equal(cfg.source, 'basePath');
      assert.equal(cfg.basePath, '/p/');
      assert.equal(cfg.warning, 'baseUrl.invalid');
    });
  });

  describe('resolveBaseConfig precedence matrix', () => {
    it('neither set → none', () => {
      assert.deepEqual(resolveBaseConfig({}), {
        basePath: '', scheme: null, host: null, port: null, source: 'none', warning: null, warningValue: '',
      });
    });

    it('legacy CCV_BASE_PATH only → basePath (fully backward compatible)', () => {
      const r = resolveBaseConfig({ CCV_BASE_PATH: '/p/' });
      assert.deepEqual(r, {
        basePath: '/p/', scheme: null, host: null, port: null, source: 'basePath', warning: null, warningValue: '',
      });
    });

    it('valid CCV_BASE_URL only → baseUrl', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}${ARCA_PATH}` });
      assert.equal(r.source, 'baseUrl');
      assert.equal(r.basePath, '/arca/api/v1/session/{token}/');
      assert.equal(r.host, ARCA);
      assert.equal(r.scheme, 'https');
      assert.equal(r.warning, null);
    });

    it('host-only form authoritatively produces no prefix (no fallback to legacy)', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}`, CCV_BASE_PATH: '/legacy/' });
      assert.equal(r.source, 'baseUrl');
      assert.equal(r.basePath, '');
      assert.equal(r.warning, 'baseUrl.overridesBasePath');
    });

    it('both set and valid → CCV_BASE_URL wins + overridesBasePath warning', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}/new/base`, CCV_BASE_PATH: '/legacy/' });
      assert.equal(r.basePath, '/new/base/');
      assert.equal(r.source, 'baseUrl');
      assert.equal(r.warning, 'baseUrl.overridesBasePath');
      assert.equal(r.warningValue, `https://${ARCA}/new/base`);
    });

    it('invalid CCV_BASE_URL → fall back to legacy + invalid warning', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: 'https://bad host/x', CCV_BASE_PATH: '/legacy/' });
      assert.equal(r.source, 'basePath');
      assert.equal(r.basePath, '/legacy/');
      assert.equal(r.warning, 'baseUrl.invalid');
    });

    it('invalid CCV_BASE_URL with no legacy → none + invalid warning', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: 'ftp://h/x' });
      assert.equal(r.source, 'none');
      assert.equal(r.basePath, '');
      assert.equal(r.warning, 'baseUrl.invalid');
    });

    it('queryFragment warning passed through', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}/x?y=1` });
      assert.equal(r.warning, 'baseUrl.queryFragmentIgnored');
    });
  });

  describe('baseUrlAllowedHost', () => {
    it('valid with host → bare hostname (lowercase, no port, IPv6 bracketed)', () => {
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: `${ARCA}:8443/x` }), ARCA);
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: 'http://[::1]:7008/x' }), '[::1]');
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: 'HTTPS://EXAMPLE.COM/x' }), 'example.com');
    });

    it('path-only/invalid/unset → null', () => {
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: '/x/' }), null);
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: 'ftp://h/x' }), null);
      assert.equal(baseUrlAllowedHost({}), null);
    });
  });

  describe('forwardedProto', () => {
    it('takes the first hop, trims, lowercases, accepts only http/https', () => {
      assert.equal(forwardedProto({ headers: { 'x-forwarded-proto': 'http' } }), 'http');
      assert.equal(forwardedProto({ headers: { 'x-forwarded-proto': 'HTTPS, http' } }), 'https');
      assert.equal(forwardedProto({ headers: { 'x-forwarded-proto': 'garbage' } }), null);
      assert.equal(forwardedProto({ headers: {} }), null);
      assert.equal(forwardedProto(null), null);
    });
  });

  describe('resolveExternalScheme', () => {
    it('explicit scheme wins → XFP → default https', () => {
      assert.equal(resolveExternalScheme({ scheme: 'http', req: { headers: { 'x-forwarded-proto': 'https' } } }), 'http');
      assert.equal(resolveExternalScheme({ scheme: null, req: { headers: { 'x-forwarded-proto': 'http' } } }), 'http');
      assert.equal(resolveExternalScheme({ scheme: null, req: { headers: {} } }), 'https');
      assert.equal(resolveExternalScheme({}), 'https');
    });
  });

  describe('buildExternalUrl', () => {
    it('joins host/port/basePath/token; empty basePath renders as /', () => {
      assert.equal(
        buildExternalUrl({ scheme: 'https', host: ARCA, basePath: '/arca/api/v1/session/{token}/', token: 'abc' }),
        `https://${ARCA}/arca/api/v1/session/{token}/?token=abc`,
      );
      assert.equal(buildExternalUrl({ scheme: 'https', host: ARCA, token: 'abc' }), `https://${ARCA}/?token=abc`);
      assert.equal(buildExternalUrl({ scheme: 'http', host: ARCA, port: 8443, basePath: '/x/' }), `http://${ARCA}:8443/x/`);
      assert.equal(buildExternalUrl({ scheme: 'https', host: '[::1]', port: 7008 }), 'https://[::1]:7008/');
      assert.equal(buildExternalUrl({ scheme: 'https', host: null }), null);
    });
    it('buildExternalUrl: null-scheme guard, externalUrlFromConfig one-liner wrapper', () => {
      assert.equal(buildExternalUrl({ scheme: null, host: 'h' }), 'https://h/');
      assert.equal(
        externalUrlFromConfig(
          { host: ARCA, port: null, scheme: null, basePath: '/x/' },
          { token: 'tk', req: { headers: { 'x-forwarded-proto': 'http' } } },
        ),
        `http://${ARCA}/x/?token=tk`,
      );
      assert.equal(externalUrlFromConfig({ host: null, basePath: '/x/' }, { token: 'tk' }), null);
      assert.equal(externalUrlFromConfig(null), null);
    });
  });

  describe('wireBasePath / wireBasePathVariants', () => {
    it('literal {token} serialized as %7Btoken%7D (match side); no prefix → empty string', () => {
      assert.equal(wireBasePath('/arca/api/v1/session/{token}/'), '/arca/api/v1/session/%7Btoken%7D/');
      assert.equal(wireBasePath('/proxy/'), '/proxy/');
      assert.equal(wireBasePath(''), '');
    });

    it('variants include both percent-encoding cases (guards against proxies rewriting %XX case); deduped when unencoded', () => {
      assert.deepEqual(wireBasePathVariants('/proxy/'), ['/proxy/']);
      assert.deepEqual(
        [...wireBasePathVariants('/arca/api/v1/session/{token}/')].sort(),
        ['/arca/api/v1/session/%7Btoken%7D/', '/arca/api/v1/session/%7Btoken%7d/', '/arca/api/v1/session/%7btoken%7D/', '/arca/api/v1/session/%7btoken%7d/'].sort(),
      );
      // When the config itself is lowercase-encoded, the other case combinations are generated too (reverse-proxy rewrite direction is unknowable)
      assert.deepEqual(
        [...wireBasePathVariants('/a/%7btoken%7d/')].sort(),
        ['/a/%7Btoken%7D/', '/a/%7Btoken%7d/', '/a/%7btoken%7D/', '/a/%7btoken%7d/'].sort(),
      );
    });
  });

  describe('i18n key translation presence (zh/en + interpolation)', () => {
    for (const [key, hasValue] of [['baseUrl.invalid', true], ['baseUrl.queryFragmentIgnored', true], ['baseUrl.overridesBasePath', false]]) {
      it(`${key} has translations in zh/en`, () => {
        for (const lang of ['zh', 'en']) {
          const msg = tFor(key, lang, { value: 'xyz' });
          assert.notEqual(msg, key, `${lang} 不应回落为 key 本身`);
          if (hasValue) assert.ok(msg.includes('xyz'), `${lang} 文案应包含插值后的 value`);
        }
      });
    }

    it('server.startedExternal has zh/en translations and {url} interpolates', () => {
      for (const lang of ['zh', 'en']) {
        const msg = tFor('server.startedExternal', lang, { url: 'https://h/p/?token=x' });
        assert.notEqual(msg, 'server.startedExternal', `${lang} 不应回落为 key 本身`);
        assert.ok(msg.includes('https://h/p/?token=x'), `${lang} 文案应包含插值后的 url`);
      }
    });
  });
});
