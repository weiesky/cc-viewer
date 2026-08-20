/**
 * Unit tests for src/utils/gitApi.js — fetchAllRepos()
 *
 * 依赖链：gitApi.js -> './apiUrl'（无扩展名 import，需 vite-loader）。
 * apiUrl.js 加载时读 window.location.search，故在动态 import 前先挂 globalThis.window（无 token，
 * 让 apiUrl 返回纯净 path 便于断言 URL）。
 *
 * fetchAllRepos 行为：
 *   主路径：GET /api/git-repos → { repos: [...] }；对每个 repo 并发拉 git-status + git-log-unpushed，
 *           归并出 { ...repo, changes, insertions, deletions, commits, hasUpstream, branch, upstream,
 *           truncated, totalCount }。
 *   回退一：git-repos 抛错/!ok → 尝试 GET /api/git-status（单仓库兼容），ok 则返回单元素数组（'.'根仓库）。
 *   回退二：git-status 也失败 → 返回 []。
 *
 * 覆盖：
 *   - git-repos 成功 + 多仓库归并（含默认值兜底、totalCount 推断、布尔归一）
 *   - git-status / git-log-unpushed 子请求 !ok 与 reject 时各自的默认对象
 *   - git-repos !ok → 回退 git-status 成功（单仓库）
 *   - git-repos !ok 且 git-status !ok → []
 *   - git-repos 网络异常（reject）→ 回退路径
 *   - git-repos 成功但 data.repos 缺失 → 空 repoList → []
 *   - URL 拼接（encodeURIComponent repo.path）
 */
import './_shims/register.mjs';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const _origWindow = globalThis.window;
const _origDocument = globalThis.document;
const _origFetch = globalThis.fetch;

globalThis.window = { location: { search: '' } };
globalThis.document = { querySelector: () => null };

const { fetchAllRepos } = await import('../src/utils/gitApi.js');

after(() => {
  if (_origWindow === undefined) delete globalThis.window; else globalThis.window = _origWindow;
  if (_origDocument === undefined) delete globalThis.document; else globalThis.document = _origDocument;
  if (_origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = _origFetch;
});

/** 构造一个最小 Response-like 对象 */
function res({ ok = true, status = 200, json, text } = {}) {
  return {
    ok,
    status,
    json: () => Promise.resolve(typeof json === 'function' ? json() : json),
    text: () => Promise.resolve(typeof text === 'function' ? text() : text),
  };
}

/**
 * 安装 fetch mock。
 * @param {(url:string)=>(object|Promise)} router 按 url 返回 Response-like 或 thenable；
 *        返回值若是 Promise.reject 则模拟网络异常。
 * @returns {{calls: string[]}} 记录所有调用过的 url
 */
function installFetch(router) {
  const calls = [];
  globalThis.fetch = (url) => {
    calls.push(url);
    const r = router(url);
    return r instanceof Promise ? r : Promise.resolve(r);
  };
  return { calls };
}

describe('fetchAllRepos — 主路径 /api/git-repos 成功', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });

  it('多仓库：归并 status + commits，填默认值与推断 totalCount', async () => {
    const { calls } = installFetch((url) => {
      if (url.includes('/api/git-repos')) {
        return res({ json: { repos: [
          { name: 'a', path: '/repo a', isRoot: true },
          { name: 'b', path: '/repo/b' },
        ] } });
      }
      if (url.includes('/api/git-status')) {
        if (url.includes(encodeURIComponent('/repo a'))) {
          return res({ json: { changes: [{ file: 'x', status: 'M' }], insertions: 5, deletions: 2 } });
        }
        // repo b：status 缺省字段 → 走 || 兜底
        return res({ json: {} });
      }
      if (url.includes('/api/git-log-unpushed')) {
        if (url.includes(encodeURIComponent('/repo a'))) {
          return res({ json: {
            commits: [{ hash: 'h1' }, { hash: 'h2' }],
            hasUpstream: 1, branch: 'main', upstream: 'origin/main',
            truncated: 1, totalCount: 9,
          } });
        }
        // repo b：commits 缺省 → totalCount 推断为 0
        return res({ json: {} });
      }
      throw new Error('unexpected url ' + url);
    });

    const out = await fetchAllRepos();
    assert.equal(out.length, 2);

    const a = out[0];
    assert.equal(a.name, 'a');
    assert.equal(a.isRoot, true);
    assert.deepEqual(a.changes, [{ file: 'x', status: 'M' }]);
    assert.equal(a.insertions, 5);
    assert.equal(a.deletions, 2);
    assert.equal(a.commits.length, 2);
    assert.equal(a.hasUpstream, true, 'hasUpstream 应被 !! 归一为布尔');
    assert.equal(a.branch, 'main');
    assert.equal(a.upstream, 'origin/main');
    assert.equal(a.truncated, true);
    assert.equal(a.totalCount, 9, '显式 totalCount 透传');

    const b = out[1];
    assert.deepEqual(b.changes, []);
    assert.equal(b.insertions, 0);
    assert.equal(b.deletions, 0);
    assert.deepEqual(b.commits, []);
    assert.equal(b.hasUpstream, false);
    assert.equal(b.branch, null, 'branch 缺省 → null');
    assert.equal(b.upstream, null);
    assert.equal(b.truncated, false);
    assert.equal(b.totalCount, 0, 'totalCount 缺省 → 由 commits.length 推断');

    // URL 拼接含 encodeURIComponent（空格 → %20）
    assert.ok(calls.some((u) => u.includes('/api/git-status?repo=' + encodeURIComponent('/repo a'))));
    assert.ok(calls.some((u) => u.includes('/api/git-log-unpushed?repo=' + encodeURIComponent('/repo/b'))));
  });

  it('子请求 git-status !ok / git-log-unpushed !ok → 各自默认对象', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) return res({ json: { repos: [{ name: 'r', path: 'p' }] } });
      if (url.includes('/api/git-status')) return res({ ok: false, status: 500 });
      if (url.includes('/api/git-log-unpushed')) return res({ ok: false, status: 404 });
      throw new Error('unexpected');
    });
    const out = await fetchAllRepos();
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].changes, []);
    assert.equal(out[0].insertions, 0);
    assert.deepEqual(out[0].commits, []);
    assert.equal(out[0].hasUpstream, false);
    assert.equal(out[0].totalCount, 0);
  });

  it('子请求 fetch reject → catch 兜底为默认对象', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) return res({ json: { repos: [{ name: 'r', path: 'p' }] } });
      // status/log 子请求直接网络异常
      return Promise.reject(new Error('boom'));
    });
    const out = await fetchAllRepos();
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].changes, []);
    assert.deepEqual(out[0].commits, []);
    assert.equal(out[0].hasUpstream, false);
  });

  it('data.repos 缺失 → repoList 为 [] → 返回 []', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) return res({ json: {} });
      throw new Error('should not fetch status when no repos');
    });
    const out = await fetchAllRepos();
    assert.deepEqual(out, []);
  });
});

describe('fetchAllRepos — 回退路径', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });

  it('git-repos !ok → 回退 git-status 成功 → 单根仓库', async () => {
    const { calls } = installFetch((url) => {
      if (url.includes('/api/git-repos')) return res({ ok: false, status: 404 });
      if (url.includes('/api/git-status')) {
        return res({ json: { changes: [{ file: 'a' }], insertions: 3, deletions: 1 } });
      }
      throw new Error('unexpected');
    });
    const out = await fetchAllRepos();
    assert.equal(out.length, 1);
    assert.equal(out[0].name, '.');
    assert.equal(out[0].path, '.');
    assert.equal(out[0].isRoot, true);
    assert.deepEqual(out[0].changes, [{ file: 'a' }]);
    assert.equal(out[0].insertions, 3);
    assert.equal(out[0].deletions, 1);
    assert.deepEqual(out[0].commits, []);
    assert.equal(out[0].hasUpstream, false);
    // 回退分支不带 repo 参数
    assert.ok(calls.some((u) => u.endsWith('/api/git-status')));
  });

  it('git-repos 抛错（reject）→ 回退 git-status，缺省字段兜底', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) return Promise.reject(new Error('network down'));
      if (url.includes('/api/git-status')) return res({ json: {} });
      throw new Error('unexpected');
    });
    const out = await fetchAllRepos();
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].changes, []);
    assert.equal(out[0].insertions, 0);
    assert.equal(out[0].deletions, 0);
  });

  it('git-repos !ok 且 回退 git-status 也 !ok → []', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) return res({ ok: false, status: 500 });
      if (url.includes('/api/git-status')) return res({ ok: false, status: 500 });
      throw new Error('unexpected');
    });
    const out = await fetchAllRepos();
    assert.deepEqual(out, []);
  });

  it('git-repos !ok 且 回退 git-status reject → [] (内层 catch)', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) return res({ ok: false, status: 500 });
      if (url.includes('/api/git-status')) return Promise.reject(new Error('down'));
      throw new Error('unexpected');
    });
    const out = await fetchAllRepos();
    assert.deepEqual(out, []);
  });

  it('git-repos.json() 解析抛错 → 进入 catch → 回退', async () => {
    installFetch((url) => {
      if (url.includes('/api/git-repos')) {
        return res({ json: () => { throw new Error('bad json'); } });
      }
      if (url.includes('/api/git-status')) return res({ json: { changes: [], insertions: 0, deletions: 0 } });
      throw new Error('unexpected');
    });
    const out = await fetchAllRepos();
    assert.equal(out.length, 1);
    assert.equal(out[0].name, '.');
  });
});
