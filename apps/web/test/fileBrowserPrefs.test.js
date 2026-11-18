/**
 * Unit tests for src/utils/fileBrowserPrefs.js — node:test with an in-memory
 * sessionStorage mock (mirrors fileExpandedPathsStorage.test.js).
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFS, sanitizePrefs, loadDirPrefs, saveDirPrefs, dirCacheKey,
} from '../src/utils/fileBrowserPrefs.js';

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

after(() => { delete globalThis.sessionStorage; });

describe('sanitizePrefs', () => {
  it('returns the defaults for null / non-object input', () => {
    assert.deepEqual(sanitizePrefs(null), DEFAULT_PREFS);
    assert.deepEqual(sanitizePrefs(undefined), DEFAULT_PREFS);
    assert.deepEqual(sanitizePrefs('string'), DEFAULT_PREFS);
    assert.deepEqual(sanitizePrefs(42), DEFAULT_PREFS);
  });

  it('drops invalid enum values back to the defaults', () => {
    assert.deepEqual(sanitizePrefs({ viewMode: 'bogus', sortBy: 'bogus', sortOrder: 'sideways' }), DEFAULT_PREFS);
  });

  it('keeps valid values and backfills missing keys', () => {
    assert.deepEqual(sanitizePrefs({ viewMode: 'list' }), { ...DEFAULT_PREFS, viewMode: 'list' });
    assert.deepEqual(sanitizePrefs({ sortBy: 'size', sortOrder: 'desc' }), { ...DEFAULT_PREFS, sortBy: 'size', sortOrder: 'desc' });
  });
});

describe('loadDirPrefs / saveDirPrefs', () => {
  beforeEach(() => { installMockStorage(); });

  it('returns the defaults when nothing is stored', () => {
    assert.deepEqual(loadDirPrefs('scopeA', 'src'), DEFAULT_PREFS);
  });

  it('round-trips a saved prefs object', () => {
    saveDirPrefs('scopeA', 'src', { viewMode: 'list', sortBy: 'size', sortOrder: 'desc' });
    assert.deepEqual(loadDirPrefs('scopeA', 'src'), { viewMode: 'list', sortBy: 'size', sortOrder: 'desc' });
  });

  it('merges partial patches with the previously stored prefs', () => {
    saveDirPrefs('scopeA', 'src', { viewMode: 'list' });
    saveDirPrefs('scopeA', 'src', { sortBy: 'size' });
    const loaded = loadDirPrefs('scopeA', 'src');
    assert.equal(loaded.viewMode, 'list');
    assert.equal(loaded.sortBy, 'size');
    assert.equal(loaded.sortOrder, 'asc');
  });

  it('isolates prefs by scope key', () => {
    saveDirPrefs('scopeA', 'src', { viewMode: 'list' });
    saveDirPrefs('scopeB', 'src', { viewMode: 'grid' });
    assert.equal(loadDirPrefs('scopeA', 'src').viewMode, 'list');
    assert.equal(loadDirPrefs('scopeB', 'src').viewMode, 'grid');
  });

  it('isolates prefs by directory path within a scope', () => {
    saveDirPrefs('scopeA', 'a', { sortBy: 'size' });
    saveDirPrefs('scopeA', 'b', { sortBy: 'mtime' });
    assert.equal(loadDirPrefs('scopeA', 'a').sortBy, 'size');
    assert.equal(loadDirPrefs('scopeA', 'b').sortBy, 'mtime');
    assert.equal(loadDirPrefs('scopeA', 'c').sortBy, 'name');
  });

  it('falls back to defaults on corrupt JSON', () => {
    const store = installMockStorage();
    store.set('ccv.fileBrowserModal.prefs.v1.scopeA', '{not-json');
    assert.deepEqual(loadDirPrefs('scopeA', 'src'), DEFAULT_PREFS);
  });

  it('falls back to defaults when the stored doc is not an object', () => {
    const store = installMockStorage();
    store.set('ccv.fileBrowserModal.prefs.v1.scopeA', '"just a string"');
    assert.deepEqual(loadDirPrefs('scopeA', 'src'), DEFAULT_PREFS);
  });

  it('survives a throwing sessionStorage (private mode)', () => {
    installThrowingStorage();
    assert.deepEqual(loadDirPrefs('scopeA', 'src'), DEFAULT_PREFS);
    // saveDirPrefs must not throw either — failure is silent.
    saveDirPrefs('scopeA', 'src', { viewMode: 'list' });
  });

  it('round-trips prefs for a directory literally named "__proto__"', () => {
    saveDirPrefs('scopeA', '__proto__', { viewMode: 'list', sortBy: 'size' });
    const loaded = loadDirPrefs('scopeA', '__proto__');
    assert.equal(loaded.viewMode, 'list');
    assert.equal(loaded.sortBy, 'size');
  });
});

describe('dirCacheKey', () => {
  it('returns the raw path for the default order (shared with the tree)', () => {
    assert.equal(dirCacheKey('src', 'name', 'asc'), 'src');
    assert.equal(dirCacheKey('', 'name', 'asc'), '');
  });

  it('uses a distinct key for any non-default order so the tree cache is not polluted', () => {
    assert.notEqual(dirCacheKey('src', 'size', 'asc'), 'src');
    assert.notEqual(dirCacheKey('src', 'name', 'desc'), 'src');
    assert.notEqual(dirCacheKey('src', 'size', 'desc'), dirCacheKey('src', 'size', 'asc'));
    assert.notEqual(dirCacheKey('src', 'mtime', 'asc'), dirCacheKey('src', 'size', 'asc'));
  });
});
