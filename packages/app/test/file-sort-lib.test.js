// Unit tests for server/lib/file-sort.js — node:test, no fixtures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSortParams, compareEntries } from '../server/lib/file-sort.js';

function paramsFor(pairs) {
  return new URLSearchParams(pairs);
}

describe('normalizeSortParams', () => {
  it('defaults to name/asc when params are missing', () => {
    assert.deepEqual(normalizeSortParams(paramsFor({})), { sort: 'name', order: 'asc' });
    assert.deepEqual(normalizeSortParams(null), { sort: 'name', order: 'asc' });
  });
  it('accepts name/size/mtime and asc/desc', () => {
    assert.deepEqual(normalizeSortParams(paramsFor({ sort: 'size', order: 'desc' })), { sort: 'size', order: 'desc' });
    assert.deepEqual(normalizeSortParams(paramsFor({ sort: 'mtime', order: 'asc' })), { sort: 'mtime', order: 'asc' });
  });
  it('silently falls back on unknown values (never 400)', () => {
    assert.deepEqual(normalizeSortParams(paramsFor({ sort: 'bogus', order: 'sideways' })), { sort: 'name', order: 'asc' });
    // Prototype-pollution attempt must not throw or produce a weird sort key.
    assert.deepEqual(normalizeSortParams(paramsFor({ sort: '__proto__' })), { sort: 'name', order: 'asc' });
  });
});

describe('compareEntries', () => {
  const fileA = { name: 'a.txt', type: 'file', size: 100, mtimeMs: 1000 };
  const fileB = { name: 'b.txt', type: 'file', size: 10, mtimeMs: 2000 };
  const fileNoMeta = { name: 'ghost.txt', type: 'file', size: null, mtimeMs: null };
  const dirX = { name: 'x', type: 'directory', size: null, mtimeMs: 500 };
  const dirY = { name: 'y', type: 'directory', size: null, mtimeMs: 500 };

  it('directories always come before files (name/asc)', () => {
    const cmp = compareEntries('name', 'asc');
    const sorted = [fileA, dirX, fileB, dirY].sort(cmp);
    assert.deepEqual(sorted.map(e => e.name), ['x', 'y', 'a.txt', 'b.txt']);
  });

  it('directories stay on top even when order=desc, but their own order is reversed', () => {
    const cmp = compareEntries('size', 'desc');
    const sorted = [fileA, dirX, fileB, dirY].sort(cmp);
    // Directories first (reversed name desc within dirs), then files by size desc.
    assert.deepEqual(sorted.map(e => e.name), ['y', 'x', 'a.txt', 'b.txt']);
  });

  it('sorts by name asc/desc within the same entry kind', () => {
    const files = [fileA, fileB];
    assert.deepEqual(files.slice().sort(compareEntries('name', 'asc')).map(e => e.name), ['a.txt', 'b.txt']);
    assert.deepEqual(files.slice().sort(compareEntries('name', 'desc')).map(e => e.name), ['b.txt', 'a.txt']);
  });

  it('sorts by size, with null values last regardless of order', () => {
    const items = [fileNoMeta, fileA, fileB];
    assert.deepEqual(items.slice().sort(compareEntries('size', 'asc')).map(e => e.name),
      ['b.txt', 'a.txt', 'ghost.txt']);
    assert.deepEqual(items.slice().sort(compareEntries('size', 'desc')).map(e => e.name),
      ['a.txt', 'b.txt', 'ghost.txt']);
  });

  it('sorts by mtimeMs with name tie-breaker', () => {
    const f1 = { name: 'z.txt', type: 'file', size: 0, mtimeMs: 100 };
    const f2 = { name: 'a.txt', type: 'file', size: 0, mtimeMs: 100 };
    const f3 = { name: 'm.txt', type: 'file', size: 0, mtimeMs: 50 };
    const items = [f1, f2, f3];
    assert.deepEqual(items.slice().sort(compareEntries('mtime', 'asc')).map(e => e.name),
      ['m.txt', 'a.txt', 'z.txt']);
  });
});
