// 覆盖目标：server/lib/base-url.js —— CCV_BASE_URL（云端反代公网 URL）的解析/合并/URL 生成。
// 纯函数单测，不碰文件系统、不起 server。
// 最高危锁定：basePath 必须保留字面 {token}（new URL 会把花括号编码成 %7B，注入侧必须字面），
// 而 wireBasePath 必须给出编码形式（请求 pathname 经 new URL 解析后只有编码形式可匹配）。

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
    it('null/undefined → 空串；trim；剥 CRLF（防日志/注入断行）', () => {
      assert.equal(sanitizeBaseUrlValue(null), '');
      assert.equal(sanitizeBaseUrlValue(undefined), '');
      assert.equal(sanitizeBaseUrlValue('  /proxy/  '), '/proxy/');
      assert.equal(sanitizeBaseUrlValue('/pro\r\nxy/'), '/proxy/');
    });
  });

  describe('parseBaseUrl', () => {
    it('未设/空串/根 → ok，无 host，basePath 为空', () => {
      assert.deepEqual(parseBaseUrl(undefined), { ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });
      assert.deepEqual(parseBaseUrl(''), { ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });
      assert.deepEqual(parseBaseUrl('/'), { ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });
    });

    it('形式1 host+path（无 scheme）', () => {
      const r = parseBaseUrl(`${ARCA}${ARCA_PATH}`);
      assert.deepEqual(r, {
        ok: true, scheme: null, host: ARCA, port: null,
        basePath: '/arca/api/v1/session/{token}/', warning: null,
      });
      // 字面 {token} 必须保留 —— 注入 <base href>/__CCV_BASE_PATH__ 用字面形式
      assert.ok(r.basePath.includes('{token}'));
      assert.ok(!r.basePath.includes('%7B'));
    });

    it('形式2 仅路径', () => {
      const r = parseBaseUrl(ARCA_PATH);
      assert.deepEqual(r, {
        ok: true, scheme: null, host: null, port: null,
        basePath: '/arca/api/v1/session/{token}/', warning: null,
      });
    });

    it('形式3 完整 URL：https/http 显式 scheme', () => {
      assert.deepEqual(parseBaseUrl(`https://${ARCA}${ARCA_PATH}`), {
        ok: true, scheme: 'https', host: ARCA, port: null,
        basePath: '/arca/api/v1/session/{token}/', warning: null,
      });
      assert.deepEqual(parseBaseUrl(`http://${ARCA}/x`), {
        ok: true, scheme: 'http', host: ARCA, port: null, basePath: '/x/', warning: null,
      });
    });

    it('ws/wss 归一为 http/https（WS URL 由调用方派生）', () => {
      assert.equal(parseBaseUrl(`ws://${ARCA}/x`).scheme, 'http');
      assert.equal(parseBaseUrl(`wss://${ARCA}/x`).scheme, 'https');
    });

    it('host-only 形式：basePath 为空（权威无前缀）', () => {
      assert.deepEqual(parseBaseUrl(ARCA), { ok: true, scheme: null, host: ARCA, port: null, basePath: '', warning: null });
      assert.deepEqual(parseBaseUrl(`https://${ARCA}`), { ok: true, scheme: 'https', host: ARCA, port: null, basePath: '', warning: null });
    });

    it('带端口：host 去端口、port 数字', () => {
      const r = parseBaseUrl(`${ARCA}:8443/x`);
      assert.deepEqual(r, { ok: true, scheme: null, host: ARCA, port: 8443, basePath: '/x/', warning: null });
    });

    it('IPv6 带括号、hostname 小写化', () => {
      assert.deepEqual(parseBaseUrl('http://[::1]:7008/x'), { ok: true, scheme: 'http', host: '[::1]', port: 7008, basePath: '/x/', warning: null });
      assert.equal(parseBaseUrl('HTTP://EXAMPLE.COM/X').host, 'example.com');
    });

    it('非法值 → ok:false + baseUrl.invalid', () => {
      for (const bad of [
        `${ARCA}:99999/x`,          // 端口越界
        `${ARCA}:0/x`,              // 端口 0
        `${ARCA}:abc/x`,            // 非数字端口
        'https://user:pass@h/x',    // 凭证
        'ftp://h/x',                // 不支持的 scheme
        '*',                        // 通配符不是合法 authority
        'https://bad host/x',       // authority 含空格
        '/x y/',                    // 路径含空白（与线格式必然发散）
        '/x y/?q=1',                // 空白 + 查询串：invalid 优先于 queryFragment
        'https://',                 // 只有 scheme 没有主体：配置错误而非"无前缀"
        'https://?x=1',             // scheme + 纯查询串：同上
        `${ARCA}//x`,               // 路径 '//...' 会注入协议相对 <base href="//x/">
      ]) {
        const r = parseBaseUrl(bad);
        assert.equal(r.ok, false, `${bad} 应判非法`);
        assert.equal(r.warning, 'baseUrl.invalid', `${bad} 告警 key`);
      }
    });

    it('// 开头按 authority 解析（防 <base href="//evil"> 跨源注入）', () => {
      const r = parseBaseUrl('//evil.example/x');
      assert.equal(r.ok, true);
      assert.equal(r.host, 'evil.example');
      assert.equal(r.basePath, '/x/');
      assert.equal(r.scheme, null);
    });

    it('查询串/锚点截断 + queryFragmentIgnored 告警', () => {
      const r = parseBaseUrl(`https://${ARCA}/path?x=1#frag`);
      assert.equal(r.ok, true);
      assert.equal(r.basePath, '/path/');
      assert.equal(r.warning, 'baseUrl.queryFragmentIgnored');
    });

    it('CRLF 净化后再解析', () => {
      const r = parseBaseUrl(`https://${ARCA}/x\r\ny/`);
      assert.equal(r.ok, true);
      assert.equal(r.basePath, '/xy/');
    });
  });

  describe('resolveBaseConfig 优先级矩阵', () => {
    it('两者未设 → none', () => {
      assert.deepEqual(resolveBaseConfig({}), {
        basePath: '', scheme: null, host: null, port: null, source: 'none', warning: null, warningValue: '',
      });
    });

    it('仅 legacy CCV_BASE_PATH → basePath（完全向后兼容）', () => {
      const r = resolveBaseConfig({ CCV_BASE_PATH: '/p/' });
      assert.deepEqual(r, {
        basePath: '/p/', scheme: null, host: null, port: null, source: 'basePath', warning: null, warningValue: '',
      });
    });

    it('仅 CCV_BASE_URL 合法 → baseUrl', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}${ARCA_PATH}` });
      assert.equal(r.source, 'baseUrl');
      assert.equal(r.basePath, '/arca/api/v1/session/{token}/');
      assert.equal(r.host, ARCA);
      assert.equal(r.scheme, 'https');
      assert.equal(r.warning, null);
    });

    it('host-only 形式权威产出无前缀（不回退 legacy）', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}`, CCV_BASE_PATH: '/legacy/' });
      assert.equal(r.source, 'baseUrl');
      assert.equal(r.basePath, '');
      assert.equal(r.warning, 'baseUrl.overridesBasePath');
    });

    it('两者同设且合法 → CCV_BASE_URL 优先 + overridesBasePath 告警', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}/new/base`, CCV_BASE_PATH: '/legacy/' });
      assert.equal(r.basePath, '/new/base/');
      assert.equal(r.source, 'baseUrl');
      assert.equal(r.warning, 'baseUrl.overridesBasePath');
      assert.equal(r.warningValue, `https://${ARCA}/new/base`);
    });

    it('非法 CCV_BASE_URL → 回退 legacy + invalid 告警', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: 'https://bad host/x', CCV_BASE_PATH: '/legacy/' });
      assert.equal(r.source, 'basePath');
      assert.equal(r.basePath, '/legacy/');
      assert.equal(r.warning, 'baseUrl.invalid');
    });

    it('非法 CCV_BASE_URL 且无 legacy → none + invalid 告警', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: 'ftp://h/x' });
      assert.equal(r.source, 'none');
      assert.equal(r.basePath, '');
      assert.equal(r.warning, 'baseUrl.invalid');
    });

    it('queryFragment 告警透传', () => {
      const r = resolveBaseConfig({ CCV_BASE_URL: `https://${ARCA}/x?y=1` });
      assert.equal(r.warning, 'baseUrl.queryFragmentIgnored');
    });
  });

  describe('baseUrlAllowedHost', () => {
    it('合法且带 host → 纯 hostname（小写、去端口、IPv6 带括号）', () => {
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: `${ARCA}:8443/x` }), ARCA);
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: 'http://[::1]:7008/x' }), '[::1]');
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: 'HTTPS://EXAMPLE.COM/x' }), 'example.com');
    });

    it('仅路径/非法/未设 → null', () => {
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: '/x/' }), null);
      assert.equal(baseUrlAllowedHost({ CCV_BASE_URL: 'ftp://h/x' }), null);
      assert.equal(baseUrlAllowedHost({}), null);
    });
  });

  describe('forwardedProto', () => {
    it('取首跳、trim、小写、仅认 http/https', () => {
      assert.equal(forwardedProto({ headers: { 'x-forwarded-proto': 'http' } }), 'http');
      assert.equal(forwardedProto({ headers: { 'x-forwarded-proto': 'HTTPS, http' } }), 'https');
      assert.equal(forwardedProto({ headers: { 'x-forwarded-proto': 'garbage' } }), null);
      assert.equal(forwardedProto({ headers: {} }), null);
      assert.equal(forwardedProto(null), null);
    });
  });

  describe('resolveExternalScheme', () => {
    it('显式 scheme 优先 → XFP → 默认 https', () => {
      assert.equal(resolveExternalScheme({ scheme: 'http', req: { headers: { 'x-forwarded-proto': 'https' } } }), 'http');
      assert.equal(resolveExternalScheme({ scheme: null, req: { headers: { 'x-forwarded-proto': 'http' } } }), 'http');
      assert.equal(resolveExternalScheme({ scheme: null, req: { headers: {} } }), 'https');
      assert.equal(resolveExternalScheme({}), 'https');
    });
  });

  describe('buildExternalUrl', () => {
    it('拼接 host/port/basePath/token；空 basePath 渲染为 /', () => {
      assert.equal(
        buildExternalUrl({ scheme: 'https', host: ARCA, basePath: '/arca/api/v1/session/{token}/', token: 'abc' }),
        `https://${ARCA}/arca/api/v1/session/{token}/?token=abc`,
      );
      assert.equal(buildExternalUrl({ scheme: 'https', host: ARCA, token: 'abc' }), `https://${ARCA}/?token=abc`);
      assert.equal(buildExternalUrl({ scheme: 'http', host: ARCA, port: 8443, basePath: '/x/' }), `http://${ARCA}:8443/x/`);
      assert.equal(buildExternalUrl({ scheme: 'https', host: '[::1]', port: 7008 }), 'https://[::1]:7008/');
      assert.equal(buildExternalUrl({ scheme: 'https', host: null }), null);
    });
    it('buildExternalUrl：scheme null 防御、externalUrlFromConfig 一行式封装', () => {
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
    it('字面 {token} 序列化为 %7Btoken%7D（匹配侧）；无前缀 → 空串', () => {
      assert.equal(wireBasePath('/arca/api/v1/session/{token}/'), '/arca/api/v1/session/%7Btoken%7D/');
      assert.equal(wireBasePath('/proxy/'), '/proxy/');
      assert.equal(wireBasePath(''), '');
    });

    it('变体含百分号编码大小写两种形式（防御改写 %XX 大小写的代理）；无编码时去重', () => {
      assert.deepEqual(wireBasePathVariants('/proxy/'), ['/proxy/']);
      assert.deepEqual(
        wireBasePathVariants('/arca/api/v1/session/{token}/'),
        ['/arca/api/v1/session/%7Btoken%7D/', '/arca/api/v1/session/%7btoken%7d/'],
      );
      // 配置本身是小写编码形式时，大写变体同样生成（反向代理改写方向不可知）
      assert.deepEqual(wireBasePathVariants('/a/%7btoken%7d/'), ['/a/%7btoken%7d/', '/a/%7Btoken%7D/']);
    });
  });

  describe('i18n key 翻译存在性（zh/en + 插值）', () => {
    for (const [key, hasValue] of [['baseUrl.invalid', true], ['baseUrl.queryFragmentIgnored', true], ['baseUrl.overridesBasePath', false]]) {
      it(`${key} 在 zh/en 中有翻译`, () => {
        for (const lang of ['zh', 'en']) {
          const msg = tFor(key, lang, { value: 'xyz' });
          assert.notEqual(msg, key, `${lang} 不应回落为 key 本身`);
          if (hasValue) assert.ok(msg.includes('xyz'), `${lang} 文案应包含插值后的 value`);
        }
      });
    }

    it('server.startedExternal 在 zh/en 中有翻译且 {url} 可插值', () => {
      for (const lang of ['zh', 'en']) {
        const msg = tFor('server.startedExternal', lang, { url: 'https://h/p/?token=x' });
        assert.notEqual(msg, 'server.startedExternal', `${lang} 不应回落为 key 本身`);
        assert.ok(msg.includes('https://h/p/?token=x'), `${lang} 文案应包含插值后的 url`);
      }
    });
  });
});
