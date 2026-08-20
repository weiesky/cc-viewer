// 覆盖目标：server/lib/base-path.js —— CCV_BASE_PATH 的统一 normalize / validate / strip。
// 纯函数单测，不碰文件系统、不起 server。
// 重点锁定剥离结果的前导斜杠语义（路由表按 '/api/...' 匹配，丢前导斜杠 = 全路由命不中）
// 与 '/proxy/' 尾斜杠对 '/proxyextra' 的 startsWith 防歧义。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBasePath, validateBasePath, stripBasePath } from '../server/lib/base-path.js';
import { tFor } from '../server/i18n.js';

describe('base-path lib', () => {
  describe('normalizeBasePath', () => {
    it('undefined / 空串 / 根 "/" → ""（无前缀）', () => {
      assert.equal(normalizeBasePath(undefined), '');
      assert.equal(normalizeBasePath(''), '');
      assert.equal(normalizeBasePath('/'), '');
    });

    it('补尾斜杠：/proxy 与 /proxy/ 都归一为 /proxy/', () => {
      assert.equal(normalizeBasePath('/proxy'), '/proxy/');
      assert.equal(normalizeBasePath('/proxy/'), '/proxy/');
    });

    it('多级路径归一', () => {
      assert.equal(normalizeBasePath('/a/b/c'), '/a/b/c/');
      assert.equal(normalizeBasePath('/a/b/c/'), '/a/b/c/');
    });

    it('缺前导斜杠的非法值 → ""（忽略，防止注入段产出相对 <base>）', () => {
      assert.equal(normalizeBasePath('proxy/x'), '');
      assert.equal(normalizeBasePath('proxy/x/'), '');
    });

    it('裸换行符被剥除（防 index.html 注入的 JS 串断行成语法错误）', () => {
      assert.equal(normalizeBasePath('/pro\nxy/'), '/proxy/');
      assert.equal(normalizeBasePath('/pro\rxy'), '/proxy/');
    });
  });

  describe('validateBasePath', () => {
    it('合法值 / 未设 / 根 → ok，无 warning', () => {
      assert.deepEqual(validateBasePath('/proxy/'), { ok: true, normalized: '/proxy/', warning: null });
      assert.deepEqual(validateBasePath(undefined), { ok: true, normalized: '', warning: null });
      assert.deepEqual(validateBasePath(''), { ok: true, normalized: '', warning: null });
      assert.deepEqual(validateBasePath('/'), { ok: true, normalized: '', warning: null });
    });

    it('缺前导斜杠 → 忽略（normalized 为空）+ warning key', () => {
      const r = validateBasePath('proxy/x');
      assert.equal(r.ok, false);
      assert.equal(r.normalized, '');
      assert.equal(r.warning, 'basePath.missingLeadingSlash');
    });

    it('warning key 在 i18n zh/en 中有翻译，且 {value} 占位符可插值', () => {
      for (const lang of ['zh', 'en']) {
        const msg = tFor('basePath.missingLeadingSlash', lang, { value: 'xyz/' });
        assert.notEqual(msg, 'basePath.missingLeadingSlash', `${lang} 不应回落为 key 本身`);
        assert.ok(msg.includes('xyz/'), `${lang} 文案应包含插值后的 value`);
      }
    });
  });

  describe('stripBasePath', () => {
    it('剥前缀且保留前导斜杠（最高优先：丢前导斜杠 = 路由全挂）', () => {
      assert.equal(stripBasePath('/proxy/api/x', '/proxy/'), '/api/x');
      assert.equal(stripBasePath('/proxy/events', '/proxy/'), '/events');
    });

    it('前缀根路径 → "/"', () => {
      assert.equal(stripBasePath('/proxy/', '/proxy/'), '/');
    });

    it('无前缀配置（normalizedBase 为空）原样返回', () => {
      assert.equal(stripBasePath('/api/x', ''), '/api/x');
      assert.equal(stripBasePath('/', ''), '/');
    });

    it('不匹配的路径原样返回（含尾斜杠防 /proxyextra 歧义）', () => {
      assert.equal(stripBasePath('/proxyextra/x', '/proxy/'), '/proxyextra/x');
      assert.equal(stripBasePath('/other/api/x', '/proxy/'), '/other/api/x');
    });

    it('/proxy/ws 不会被 /proxy/ws-other 的前缀误剥（normalize 的尾斜杠语义）', () => {
      // base '/proxy/ws' 归一为 '/proxy/ws/' 后，'/proxy/ws-other' 不再 startsWith 命中
      assert.equal(stripBasePath('/proxy/ws-other', normalizeBasePath('/proxy/ws')), '/proxy/ws-other');
    });

    it('裸前缀 /proxy（无尾斜杠访问）不剥离——PIN 已知边界，代理侧应 redirect 到 /proxy/', () => {
      assert.equal(stripBasePath('/proxy', '/proxy/'), '/proxy');
    });

    it('多级前缀剥离', () => {
      assert.equal(stripBasePath('/a/b/c/api/x', '/a/b/c/'), '/api/x');
    });
  });
});
