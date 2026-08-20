// server/lib/im/im-lang.js 单测 —— resolvePrefLang 读 preferences.lang 与回退行为。
// 测试期 LOG_DIR 被强制指向临时目录（findcc.js 的 NODE_TEST_CONTEXT 铁闸 / CCV_LOG_DIR=tmp），可安全读写。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../findcc.js';
import { resolvePrefLang } from '../server/lib/im/im-lang.js';

describe('resolvePrefLang', () => {
  const prefsPath = join(LOG_DIR, 'preferences.json');
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });
  afterEach(() => { try { rmSync(prefsPath, { force: true }); } catch {} });

  it('读 preferences.lang', () => {
    writeFileSync(prefsPath, JSON.stringify({ lang: 'ja' }));
    assert.equal(resolvePrefLang(), 'ja');
  });

  it('无 preferences.json → 回退默认参数', () => {
    try { rmSync(prefsPath, { force: true }); } catch {}
    assert.equal(resolvePrefLang('en'), 'en');
  });

  it('无 lang 字段 → 回退默认', () => {
    writeFileSync(prefsPath, JSON.stringify({ theme: 'dark' }));
    assert.equal(resolvePrefLang('zh'), 'zh');
  });

  it('非法 JSON → 回退默认（不抛错）', () => {
    writeFileSync(prefsPath, '{ not json');
    assert.equal(resolvePrefLang('zh'), 'zh');
  });

  it('默认参数为 zh', () => {
    try { rmSync(prefsPath, { force: true }); } catch {}
    assert.equal(resolvePrefLang(), 'zh');
  });

  it('lang 两侧空白被 trim', () => {
    writeFileSync(prefsPath, JSON.stringify({ lang: '  ko  ' }));
    assert.equal(resolvePrefLang(), 'ko');
  });
});
