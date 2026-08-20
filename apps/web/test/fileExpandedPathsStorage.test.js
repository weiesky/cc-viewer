/**
 * Unit tests for src/utils/fileExpandedPathsStorage.js
 *
 * 覆盖 sessionStorage 读写、projectName 隔离、空名守卫、JSON 损坏回退、抛异常 mock。
 * Node 没有内置 sessionStorage，挂一个 in-memory mock 到 globalThis。
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadExpandedPaths,
  saveExpandedPaths,
  loadGitChangesCollapsedDirs,
  saveGitChangesCollapsedDirs,
} from '../src/utils/fileExpandedPathsStorage.js';

// 这套 mock 不是真 sessionStorage 的完整行为等价物，只覆盖本模块用到的
// getItem / setItem / removeItem。type coercion 已对齐（setItem 内部 String()），
// quota / private mode 通过 installThrowingStorage 模拟。
function installMockStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    _peek: () => store,
  };
  return store;
}

function installThrowingStorage() {
  globalThis.sessionStorage = {
    getItem() { throw new Error('private mode'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('quota'); },
  };
}

// 全局清理：跑完整套测试后摘掉 mock，防止后续可能引入的 jsdom 测试踩坑。
after(() => { delete globalThis.sessionStorage; });

describe('fileExpandedPathsStorage — round trip', () => {
  beforeEach(() => { installMockStorage(); });

  it('saves then loads the same set', () => {
    saveExpandedPaths('cc-viewer', new Set(['src', 'src/utils']));
    const loaded = loadExpandedPaths('cc-viewer');
    assert.equal(loaded.size, 2);
    assert.ok(loaded.has('src'));
    assert.ok(loaded.has('src/utils'));
  });

  it('returns empty Set when no entry exists', () => {
    const loaded = loadExpandedPaths('cc-viewer');
    assert.equal(loaded.size, 0);
  });

  it('removes key when saving empty set', () => {
    const store = installMockStorage();
    saveExpandedPaths('cc-viewer', new Set(['a']));
    assert.equal(store.size, 1);
    saveExpandedPaths('cc-viewer', new Set());
    assert.equal(store.size, 0);
  });
});

describe('fileExpandedPathsStorage — project isolation', () => {
  beforeEach(() => { installMockStorage(); });

  it('different projects do not share state', () => {
    saveExpandedPaths('projectA', new Set(['src', 'lib']));
    saveExpandedPaths('projectB', new Set(['test']));
    const a = loadExpandedPaths('projectA');
    const b = loadExpandedPaths('projectB');
    assert.equal(a.size, 2);
    assert.ok(a.has('src'));
    assert.ok(a.has('lib'));
    assert.equal(b.size, 1);
    assert.ok(b.has('test'));
  });

  it('does not leak path between projects', () => {
    saveExpandedPaths('projectA', new Set(['secret/folder']));
    const b = loadExpandedPaths('projectB');
    assert.equal(b.size, 0);
  });
});

describe('fileExpandedPathsStorage — empty projectName guard', () => {
  beforeEach(() => { installMockStorage(); });

  it('load returns empty Set when projectName is empty', () => {
    assert.equal(loadExpandedPaths('').size, 0);
    assert.equal(loadExpandedPaths(null).size, 0);
    assert.equal(loadExpandedPaths(undefined).size, 0);
  });

  it('save is a no-op when projectName is empty', () => {
    const store = installMockStorage();
    saveExpandedPaths('', new Set(['a', 'b']));
    saveExpandedPaths(null, new Set(['a', 'b']));
    saveExpandedPaths(undefined, new Set(['a', 'b']));
    assert.equal(store.size, 0);
  });

  it('rejects non-string projectName', () => {
    const store = installMockStorage();
    saveExpandedPaths(123, new Set(['a']));
    saveExpandedPaths({}, new Set(['a']));
    assert.equal(store.size, 0);
    assert.equal(loadExpandedPaths(123).size, 0);
  });
});

describe('fileExpandedPathsStorage — corruption fallback', () => {
  it('returns empty Set on invalid JSON', () => {
    installMockStorage();
    sessionStorage.setItem('ccv_fileExpandedPaths:p', 'not json {{{');
    const loaded = loadExpandedPaths('p');
    assert.equal(loaded.size, 0);
  });

  it('returns empty Set when stored value is not an array', () => {
    installMockStorage();
    sessionStorage.setItem('ccv_fileExpandedPaths:p', '{"foo":"bar"}');
    const loaded = loadExpandedPaths('p');
    assert.equal(loaded.size, 0);
  });

  it('filters non-string entries from stored array', () => {
    installMockStorage();
    sessionStorage.setItem('ccv_fileExpandedPaths:p', '["a", 123, null, "b"]');
    const loaded = loadExpandedPaths('p');
    assert.equal(loaded.size, 2);
    assert.ok(loaded.has('a'));
    assert.ok(loaded.has('b'));
  });
});

describe('fileExpandedPathsStorage — storage exception tolerance', () => {
  it('load returns empty Set when sessionStorage.getItem throws', () => {
    installThrowingStorage();
    const loaded = loadExpandedPaths('p');
    assert.equal(loaded.size, 0);
  });

  it('save swallows exceptions silently', () => {
    installThrowingStorage();
    // should not throw
    saveExpandedPaths('p', new Set(['a']));
  });

  it('save with empty set swallows removeItem throw', () => {
    installThrowingStorage();
    // 空 set 走 removeItem 分支；私模 / 配额异常仍要静默吞掉。
    saveExpandedPaths('p', new Set());
  });
});

describe('fileExpandedPathsStorage — GitChanges bucket', () => {
  beforeEach(() => { installMockStorage(); });

  it('GitChanges bucket round-trip saves then loads', () => {
    saveGitChangesCollapsedDirs('cc-viewer', new Set(['repo1::src', 'repo1::src/utils']));
    const loaded = loadGitChangesCollapsedDirs('cc-viewer');
    assert.equal(loaded.size, 2);
    assert.ok(loaded.has('repo1::src'));
    assert.ok(loaded.has('repo1::src/utils'));
  });

  it('GitChanges bucket isolated from FileExplorer bucket', () => {
    // 同 projectName 同 path 字符串，两个 bucket 各存各的不串扰
    saveExpandedPaths('proj', new Set(['src/utils']));
    saveGitChangesCollapsedDirs('proj', new Set(['repo::src']));
    const file = loadExpandedPaths('proj');
    const git = loadGitChangesCollapsedDirs('proj');
    assert.equal(file.size, 1);
    assert.ok(file.has('src/utils'));
    assert.ok(!file.has('repo::src'));
    assert.equal(git.size, 1);
    assert.ok(git.has('repo::src'));
    assert.ok(!git.has('src/utils'));
  });

  it('GitChanges empty projectName skipped', () => {
    const store = installMockStorage();
    saveGitChangesCollapsedDirs('', new Set(['a']));
    saveGitChangesCollapsedDirs(null, new Set(['a']));
    assert.equal(store.size, 0);
    assert.equal(loadGitChangesCollapsedDirs('').size, 0);
  });
});
