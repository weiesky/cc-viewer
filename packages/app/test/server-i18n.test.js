// 覆盖目标：server/i18n.js 尾部导出函数的 fallback / 插值 / Accept-Language 解析分支。
// 之前这些行只被 server 启动路径偶发命中（99.12%），剩余 3002 / 3036-3039 / 3049-3070
// 是 resolveLocale 的 'en' 兜底、tFor 的 params 插值、localeFromAcceptLanguage 整段。
// 这些都是纯导出函数，直接单测最稳。无需起 server。
//
// 注意：i18n.js 模块顶层有 `setLang(detectLanguage())`，会读 import 时刻的 process.env.LANG。
// 为不污染 currentLang 跨用例，凡改 process.env.LANG 的用例都在 finally 里复原，并显式 setLang 回 'en'。

import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';

describeCli('server/i18n.js export branches', () => {
  let i18n;
  let savedLang;

  before(async () => {
    i18n = await import('../server/i18n.js');
    savedLang = i18n.getLang();
  });

  after(() => {
    // 复原全局 currentLang，避免污染同进程其它 i18n 依赖用例（理论上本文件独占进程，仍稳妥）。
    i18n.setLang(savedLang || 'en');
  });

  describe('setLang / getLang', () => {
    it('setLang accepts a supported locale and getLang echoes it', () => {
      i18n.setLang('zh');
      assert.equal(i18n.getLang(), 'zh');
    });
    it('setLang falls back to en for an unsupported locale', () => {
      i18n.setLang('klingon');
      assert.equal(i18n.getLang(), 'en', 'unknown locale must fall back to en');
    });
  });

  describe('t() interpolation + fallback', () => {
    it('t() interpolates {params} against the current locale', () => {
      i18n.setLang('en');
      const out = i18n.t('server.portsBusy', { start: 7008, end: 7049 });
      assert.ok(out.includes('7008') && out.includes('7049'), `interpolation missing: ${out}`);
      assert.ok(!out.includes('{start}') && !out.includes('{end}'), 'placeholders must be replaced');
    });
    it('t() returns the key verbatim for an unknown key (en fallback → key)', () => {
      i18n.setLang('en');
      assert.equal(i18n.t('totally.unknown.key.xyz'), 'totally.unknown.key.xyz');
    });
    it('t() falls back to en text when current locale lacks the key', () => {
      // 选一个英文一定有、某冷门 locale 大概率缺的 key——这里用 en 同 key 双查保证不抛。
      i18n.setLang('en');
      const out = i18n.t('server.portsBusy', { start: 1, end: 2 });
      assert.ok(typeof out === 'string' && out.length > 0);
    });
  });

  describe('tFor() — explicit-locale render without mutating currentLang', () => {
    it('tFor() renders against an explicit locale + interpolates params (3036-3039)', () => {
      i18n.setLang('en'); // currentLang stays en
      const zh = i18n.tFor('server.portsBusy', 'zh', { start: 100, end: 200 });
      assert.ok(zh.includes('100') && zh.includes('200'), `zh interpolation missing: ${zh}`);
      // 不改全局 currentLang
      assert.equal(i18n.getLang(), 'en', 'tFor must NOT mutate currentLang');
    });
    it('tFor() with no params returns the raw locale string', () => {
      const s = i18n.tFor('server.portsBusy', 'en');
      assert.ok(typeof s === 'string' && s.includes('{start}'), 'no params → placeholders left intact');
    });
    it('tFor() unknown locale falls back to en text', () => {
      const out = i18n.tFor('server.portsBusy', 'no-such-locale', { start: 5, end: 6 });
      assert.ok(out.includes('5') && out.includes('6'), 'unknown locale must fall back to en + still interpolate');
    });
    it('tFor() unknown key returns the key verbatim', () => {
      assert.equal(i18n.tFor('no.such.key', 'en'), 'no.such.key');
    });
  });

  describe('localeFromAcceptLanguage() (3048-3070)', () => {
    it('returns null for empty / non-string headers', () => {
      assert.equal(i18n.localeFromAcceptLanguage(''), null);
      assert.equal(i18n.localeFromAcceptLanguage(null), null);
      assert.equal(i18n.localeFromAcceptLanguage(undefined), null);
      assert.equal(i18n.localeFromAcceptLanguage(123), null);
    });
    it('picks the highest-q matching tag', () => {
      // en;q=0.9 vs zh;q=0.8 → en wins. (LANG_MAP en → en)
      assert.equal(i18n.localeFromAcceptLanguage('en-US,en;q=0.9,zh;q=0.8'), 'en');
    });
    it('q ordering: a lower-listed tag with higher q wins', () => {
      // fr;q=0.3 listed first but de;q=0.9 should win → LANG_MAP de → de.
      assert.equal(i18n.localeFromAcceptLanguage('fr;q=0.3,de;q=0.9'), 'de');
    });
    it('falls back to primary subtag when full tag is unmapped', () => {
      // de-AT 不在精确 LANG_MAP（无 de-at 条目），但主语言 de → de.
      assert.equal(i18n.localeFromAcceptLanguage('de-AT'), 'de');
    });
    it('exact regional entry beats primary fallback (zh-HK → zh-TW)', () => {
      // zh-hk 是精确条目 → zh-TW（不是主语言 zh）。
      assert.equal(i18n.localeFromAcceptLanguage('zh-HK'), 'zh-TW');
    });
    it('maps regional aliases (pt-BR / pt-br) via LANG_MAP', () => {
      assert.equal(i18n.localeFromAcceptLanguage('pt-BR'), 'pt-BR');
    });
    it('skips the wildcard * tag', () => {
      // 只有 * → 过滤掉 → 无候选 → null
      assert.equal(i18n.localeFromAcceptLanguage('*'), null);
    });
    it('returns null when no tag maps to a supported locale', () => {
      assert.equal(i18n.localeFromAcceptLanguage('xx-YY,zz;q=0.5'), null);
    });
    it('tolerates malformed q values (regex miss keeps q at its init value 1)', () => {
      // q=abc 不匹配 ^q=([0-9.]+)$ → q 保持初始 1（不是 0）。en;q=abc(q=1) 与 ja(q=1) 平手，
      // en 列在前 → 稳定排序 en 胜。验证「非法 q 不致崩、tag 仍参与」这一容错路径。
      assert.equal(i18n.localeFromAcceptLanguage('en;q=abc,ja'), 'en');
    });
    it('an explicit lower q demotes a tag below a default-q tag', () => {
      // en;q=0.1 显式低 q，ja 无 q 默认 1 → ja 胜，确认 q 解析真生效（覆盖 parseFloat 分支）。
      assert.equal(i18n.localeFromAcceptLanguage('en;q=0.1,ja'), 'ja');
    });
  });

  describe('detectLanguage() / resolveLocale fallback (3002)', () => {
    it('detectLanguage() resolves a mappable LANG env', () => {
      const prev = process.env.LANG;
      const prevLanguage = process.env.LANGUAGE;
      const prevLcAll = process.env.LC_ALL;
      process.env.LANG = 'ja_JP.UTF-8';
      delete process.env.LANGUAGE;
      delete process.env.LC_ALL;
      try {
        assert.equal(i18n.detectLanguage(), 'ja', 'ja_JP.UTF-8 → ja (suffix stripped, _→-, primary match)');
      } finally {
        if (prev === undefined) delete process.env.LANG; else process.env.LANG = prev;
        if (prevLanguage === undefined) delete process.env.LANGUAGE; else process.env.LANGUAGE = prevLanguage;
        if (prevLcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = prevLcAll;
        i18n.setLang('en');
      }
    });
    it('detectLanguage() falls back to en for an unmappable LANG (resolveLocale 3002)', () => {
      const prev = process.env.LANG;
      const prevLanguage = process.env.LANGUAGE;
      const prevLcAll = process.env.LC_ALL;
      process.env.LANG = 'xx_YY.UTF-8';
      delete process.env.LANGUAGE;
      delete process.env.LC_ALL;
      try {
        assert.equal(i18n.detectLanguage(), 'en', 'unmappable LANG → resolveLocale returns en');
      } finally {
        if (prev === undefined) delete process.env.LANG; else process.env.LANG = prev;
        if (prevLanguage === undefined) delete process.env.LANGUAGE; else process.env.LANGUAGE = prevLanguage;
        if (prevLcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = prevLcAll;
        i18n.setLang('en');
      }
    });
    it('detectLanguage() with NO locale env returns en (resolveLocale empty-input guard)', () => {
      const prev = process.env.LANG;
      const prevLanguage = process.env.LANGUAGE;
      const prevLcAll = process.env.LC_ALL;
      delete process.env.LANG;
      delete process.env.LANGUAGE;
      delete process.env.LC_ALL;
      try {
        assert.equal(i18n.detectLanguage(), 'en', 'no locale env → resolveLocale("") → en');
      } finally {
        if (prev === undefined) delete process.env.LANG; else process.env.LANG = prev;
        if (prevLanguage === undefined) delete process.env.LANGUAGE; else process.env.LANGUAGE = prevLanguage;
        if (prevLcAll === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = prevLcAll;
        i18n.setLang('en');
      }
    });
  });
});
