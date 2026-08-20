/**
 * Unit tests for src/utils/fileOpen.js
 *
 * tryOpenWithSystem(path, source)：扩展名命中 SYSTEM_OPEN_EXTS 时 POST /api/open-file
 * 并返回 true；否则不发请求、返回 false。覆盖：各类命中扩展、大小写归一化、
 * 无扩展名/未命中扩展、空 path、请求体结构、fetch reject 被 .catch 吞掉。
 *
 * 依赖链：fileOpen.js -> './apiUrl'（无扩展名 import，需 vite-loader 补 .js）。
 * apiUrl.js 在加载时读 window.location.search，故在动态 import 前先挂 globalThis.window。
 */
import './_shims/register.mjs';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const _origWindow = globalThis.window;
const _origDocument = globalThis.document;
const _origFetch = globalThis.fetch;

globalThis.window = { location: { search: '' } };
globalThis.document = { querySelector: () => null };

const { tryOpenWithSystem } = await import('../src/utils/fileOpen.js');

after(() => {
  if (_origWindow === undefined) delete globalThis.window; else globalThis.window = _origWindow;
  if (_origDocument === undefined) delete globalThis.document; else globalThis.document = _origDocument;
  if (_origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = _origFetch;
});

/** 装 fetch mock，记录每次调用的 url/opts，可指定 reject 行为 */
function installFetch({ reject = false } = {}) {
  const calls = [];
  globalThis.fetch = (url, opts) => {
    calls.push({ url, opts });
    return reject ? Promise.reject(new Error('network down')) : Promise.resolve({ ok: true });
  };
  return calls;
}

describe('fileOpen.tryOpenWithSystem — 命中扩展名', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });

  const hits = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pdf'];
  for (const ext of hits) {
    it(`.${ext} → 返回 true 且 POST /api/open-file`, () => {
      const calls = installFetch();
      const path = `/x/report.${ext}`;
      const handled = tryOpenWithSystem(path, 'file-explorer');
      assert.equal(handled, true);
      assert.equal(calls.length, 1, '应发一次请求');
      const { url, opts } = calls[0];
      assert.ok(url.endsWith('/api/open-file'), `url=${url}`);
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers['Content-Type'], 'application/json');
      assert.deepEqual(JSON.parse(opts.body), { path, source: 'file-explorer' });
    });
  }

  it('大写扩展名归一化命中（.PDF）', () => {
    const calls = installFetch();
    assert.equal(tryOpenWithSystem('/A/B.PDF', 'git-diff'), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].opts.body), { path: '/A/B.PDF', source: 'git-diff' });
  });

  it('混合大小写（.DocX）命中', () => {
    const calls = installFetch();
    assert.equal(tryOpenWithSystem('file.DocX', 'chat-message'), true);
    assert.equal(calls.length, 1);
  });

  it('source 透传进 body', () => {
    const calls = installFetch();
    tryOpenWithSystem('a.xlsx', 'git-changes');
    assert.equal(JSON.parse(calls[0].opts.body).source, 'git-changes');
  });

  it('fetch reject 被内部 .catch 吞掉，函数仍同步返回 true 不抛', () => {
    installFetch({ reject: true });
    assert.doesNotThrow(() => {
      const r = tryOpenWithSystem('a.pdf', 'file-explorer');
      assert.equal(r, true);
    });
  });
});

describe('fileOpen.tryOpenWithSystem — 未命中', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });

  it('未知扩展名 .txt → false 且不发请求', () => {
    let called = false;
    globalThis.fetch = () => { called = true; return Promise.resolve({}); };
    assert.equal(tryOpenWithSystem('/x/notes.txt', 'file-explorer'), false);
    assert.equal(called, false);
  });

  it('源码扩展 .js → false', () => {
    let called = false;
    globalThis.fetch = () => { called = true; return Promise.resolve({}); };
    assert.equal(tryOpenWithSystem('main.js', 'git-diff'), false);
    assert.equal(called, false);
  });

  it('无扩展名文件（split 后取整个文件名当 ext）→ false', () => {
    let called = false;
    globalThis.fetch = () => { called = true; return Promise.resolve({}); };
    // 'README'.split('.').pop() === 'README' → 不在集合内
    assert.equal(tryOpenWithSystem('README', 'file-explorer'), false);
    assert.equal(called, false);
  });

  it('空 path：归一为 "" → false（守卫 path||""）', () => {
    let called = false;
    globalThis.fetch = () => { called = true; return Promise.resolve({}); };
    assert.equal(tryOpenWithSystem('', 'file-explorer'), false);
    assert.equal(called, false);
  });

  it('null path：path||"" 守卫，不抛，返回 false', () => {
    let called = false;
    globalThis.fetch = () => { called = true; return Promise.resolve({}); };
    assert.equal(tryOpenWithSystem(null, 'file-explorer'), false);
    assert.equal(called, false);
  });

  it('undefined path：同样守卫返回 false', () => {
    assert.equal(tryOpenWithSystem(undefined, 'x'), false);
  });

  it('带 pdf 子串但非扩展名（pdf.txt）→ 取末段 txt → false', () => {
    let called = false;
    globalThis.fetch = () => { called = true; return Promise.resolve({}); };
    assert.equal(tryOpenWithSystem('my.pdf.txt', 'file-explorer'), false);
    assert.equal(called, false);
  });

  it('多段扩展（archive.pdf）命中末段 pdf → true', () => {
    const calls = installFetch();
    assert.equal(tryOpenWithSystem('archive.tar.pdf', 'file-explorer'), true);
    assert.equal(calls.length, 1);
  });
});
