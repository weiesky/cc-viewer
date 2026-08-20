/**
 * Coverage-gap tests for src/utils/apiUrl.js
 *
 * apiUrl.js 在【模块加载时】读取 window.location.search 解析出 _urlToken（line 2），
 * 所以要测带 token 的 appendToken 分支，必须在【动态 import 之前】把 window.location.search
 * 设成含 token 的值，并在 isolated 进程内只 import 一次（模块级常量无法重置）。
 *
 * 既有覆盖（test/file-open / seq-resource-loaders / voice-pack-player）在【无 token】
 * 场景下走通了 getBasePath/apiUrl，但漏掉了：
 *   - window.__CCV_BASE_PATH__ 优先分支（line 7）
 *   - <base href> 读取分支（line 10）
 *   - appendToken 真正附加 token（line 18），含 base 末尾斜杠剥离（line 24）
 *   - apiUrl 中 base 拼接 + token 同时存在（? / & 分隔符选择）
 *
 * 本文件在加载前预置 window.location.search = '?token=SECRET'，覆盖 token 分支；
 * getBasePath 各分支通过运行时改写 window / document mock 触发。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const _origWindow = globalThis.window;
const _origDocument = globalThis.document;

// 必须在动态 import apiUrl 之前设置：模块顶层会立刻读取 location.search 固化 token。
globalThis.window = { location: { search: '?token=SECRET&foo=bar' } };
globalThis.document = { querySelector: () => null };

const { apiUrl, getBasePath, appendToken } = await import('../src/utils/apiUrl.js');

after(() => {
  if (_origWindow === undefined) delete globalThis.window; else globalThis.window = _origWindow;
  if (_origDocument === undefined) delete globalThis.document; else globalThis.document = _origDocument;
});

describe('appendToken — token 来自 location.search（模块加载时固化）', () => {
  it('无 query 的 path → 用 ? 起始追加 token', () => {
    assert.equal(appendToken('/api/x'), '/api/x?token=SECRET');
  });

  it('已含 query 的 path → 用 & 追加 token', () => {
    assert.equal(appendToken('/api/x?a=1'), '/api/x?a=1&token=SECRET');
  });

  it('ws:// 完整 URL 同样追加', () => {
    assert.equal(appendToken('ws://h/p'), 'ws://h/p?token=SECRET');
  });
});

describe('getBasePath — 各来源分支', () => {
  it('window.__CCV_BASE_PATH__ 优先于 <base> 标签（line 7）', () => {
    globalThis.window.__CCV_BASE_PATH__ = '/proxy/';
    // 即便 document 提供了 base，也应被全局变量覆盖
    globalThis.document = { querySelector: () => ({ href: 'http://x/other/', getAttribute: () => '/other/' }) };
    try {
      assert.equal(getBasePath(), '/proxy/');
    } finally {
      delete globalThis.window.__CCV_BASE_PATH__;
      globalThis.document = { querySelector: () => null };
    }
  });

  it('读取 <base> 的 getAttribute(href)（line 10），优先于 .href 绝对值', () => {
    globalThis.document = {
      querySelector: (sel) => (sel === 'base'
        ? { href: 'http://host/abs/sub/', getAttribute: () => '/sub/' }
        : null),
    };
    try {
      assert.equal(getBasePath(), '/sub/');
    } finally {
      globalThis.document = { querySelector: () => null };
    }
  });

  it('有 <base> 元素但 href 为空 → 回退 ""', () => {
    globalThis.document = { querySelector: () => ({ href: '', getAttribute: () => '/ignored/' }) };
    try {
      assert.equal(getBasePath(), '');
    } finally {
      globalThis.document = { querySelector: () => null };
    }
  });

  it('document 无 querySelector → 返回 ""', () => {
    const saved = globalThis.document;
    globalThis.document = {};
    try {
      assert.equal(getBasePath(), '');
    } finally {
      globalThis.document = saved;
    }
  });

  it('无 <base> 标签 → 返回 ""', () => {
    assert.equal(getBasePath(), '');
  });
});

describe('apiUrl — base 拼接 + token 组合', () => {
  it('有 base：剥离末尾斜杠后拼 path，再用 ? 追加 token（line 24）', () => {
    globalThis.window.__CCV_BASE_PATH__ = '/proxy/';
    try {
      // base '/proxy/' → '/proxy' + '/api/x' = '/proxy/api/x'，无 query → '?token'
      assert.equal(apiUrl('/api/x'), '/proxy/api/x?token=SECRET');
    } finally {
      delete globalThis.window.__CCV_BASE_PATH__;
    }
  });

  it('有 base 且 path 含 query → 用 & 追加 token', () => {
    globalThis.window.__CCV_BASE_PATH__ = '/proxy';
    try {
      assert.equal(apiUrl('/api/x?a=1'), '/proxy/api/x?a=1&token=SECRET');
    } finally {
      delete globalThis.window.__CCV_BASE_PATH__;
    }
  });

  it('无 base：path 原样 + token', () => {
    assert.equal(apiUrl('/api/git-repos'), '/api/git-repos?token=SECRET');
  });
});
