/**
 * src/components/files/importFiles.js 单元测试 —— FileExplorer / FileBrowserModal
 * 共享的外部文件导入管线（原 FileExplorer.jsx 内联实现，verbatim 抽取）。
 *
 * 依赖（antd message/Modal、apiUrl 顶层读 window.location）需要：
 *  - 先 register vite-loader + antd-stub
 *  - 提供 window / document 全局
 *  - 再【动态 import】目标模块
 */
import './_shims/register.mjs';
import { register } from 'node:module';
register('./_shims/antd-stub.mjs', import.meta.url);

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const I18N_SRC = readFileSync(join(SRC, 'i18n.js'), 'utf-8');

// apiUrl.js 顶层执行 `new URLSearchParams(window.location.search)`，import 前 window 必须就位
globalThis.window = globalThis.window || { location: { search: '' } };
if (!globalThis.window.location) globalThis.window.location = { search: '' };
globalThis.document = globalThis.document || { querySelector: () => null };

// 打桩全局 fetch：每个用例覆写 fetchHandler；默认抛错以暴露未配置的用例。
const ORIG_FETCH = globalThis.fetch;
let fetchHandler = async () => { throw new Error('fetchHandler not set'); };
globalThis.fetch = (...args) => fetchHandler(...args);
after(() => { globalThis.fetch = ORIG_FETCH; });

const resp = (ok, body) => ({ ok, json: async () => body });

let M; // importFiles 模块

before(async () => {
  M = await import('../src/components/files/importFiles.js');
});

// ─── 伪 DataTransfer / FileSystemEntry 工厂 ──────────────────
const dragEvent = (types) => ({ dataTransfer: { types } });

function fakeFileEntry(name, fullPath, file) {
  return {
    name, fullPath: fullPath || `/${name}`, isFile: true, isDirectory: false,
    file: (resolve) => resolve(file || { name, size: 1 }),
  };
}

function fakeDirEntry(name, fullPath, children) {
  return {
    name, fullPath: fullPath || `/${name}`, isFile: false, isDirectory: true,
    // Faithful DirectoryReader: Chrome serves ≤100 entries per readEntries call
    // and always terminates with an empty batch. Two batches (>100 items) force
    // readAllEntries' re-loop to actually run — without it this test deadlocks.
    createReader: () => {
      const batches = children.length > 1
        ? [children.slice(0, 100), children.slice(100)]
        : [children];
      let i = 0;
      return {
        readEntries: (cb) => cb(i < batches.length ? batches[i++] : []),
      };
    },
  };
}

describe('importFiles i18n completeness', () => {
  it('every ui.* key used by the shared module is defined in i18n.js', () => {
    const MODULE_SRC = readFileSync(join(SRC, 'components', 'files', 'importFiles.js'), 'utf-8');
    const keys = [...MODULE_SRC.matchAll(/t\('(ui\.[^']+)'/g)].map(m => m[1]);
    assert.ok(keys.length >= 8, `expected the module to use ≥8 i18n keys, found ${keys.length}`);
    for (const key of keys) {
      assert.ok(I18N_SRC.includes(`"${key}": {`), `i18n key ${key} used by importFiles.js is not defined`);
    }
  });
});

describe('isExternalFileDrag', () => {
  it('accepts Files without the internal-move marker', () => {
    assert.equal(M.isExternalFileDrag(dragEvent(['Files'])), true);
  });
  it('rejects tree-internal moves and non-file drags', () => {
    assert.equal(M.isExternalFileDrag(dragEvent(['Files', 'text/x-internal-move'])), false);
    assert.equal(M.isExternalFileDrag(dragEvent(['text/plain'])), false);
    assert.equal(M.isExternalFileDrag(dragEvent(['text/x-internal-move'])), false);
  });
});

describe('getTopLevelEntries', () => {
  it('returns null without items or without webkitGetAsEntry support', () => {
    assert.equal(M.getTopLevelEntries(null), null);
    assert.equal(M.getTopLevelEntries([]), null);
    assert.equal(M.getTopLevelEntries([{ kind: 'file' }]), null);
  });
  it('collects file-kind entries and skips non-file kinds', () => {
    const entry = fakeFileEntry('a.txt');
    const items = [
      { kind: 'string', webkitGetAsEntry: () => null },
      { kind: 'file', webkitGetAsEntry: () => entry },
      { kind: 'file', webkitGetAsEntry: () => null },
    ];
    assert.deepEqual(M.getTopLevelEntries(items), [entry]);
  });
});

describe('expandEntries', () => {
  it('flattens nested directories into {file, relPath} with relative paths', async () => {
    const tree = [
      fakeDirEntry('docs', '/docs', [
        fakeFileEntry('a.txt', '/docs/a.txt'),
        fakeDirEntry('sub', '/docs/sub', [fakeFileEntry('b.txt', '/docs/sub/b.txt')]),
      ]),
      fakeFileEntry('top.txt', '/top.txt'),
    ];
    const out = await M.expandEntries(tree, 0);
    assert.deepEqual(out.map(e => e.relPath).sort(), ['docs/a.txt', 'docs/sub/b.txt', 'top.txt']);
  });
  it('skips OS noise files (.DS_Store & friends)', async () => {
    const out = await M.expandEntries([fakeFileEntry('.DS_Store'), fakeFileEntry('keep.txt')], 0);
    assert.deepEqual(out.map(e => e.relPath), ['keep.txt']);
  });
  it('depth cap 32 stops recursion', async () => {
    const deep = fakeDirEntry('loop', '/loop', [fakeFileEntry('x.txt', '/loop/x.txt')]);
    assert.deepEqual(await M.expandEntries([deep], 33), []);
  });
  it('unreadable entries are skipped, not fatal', async () => {
    const bad = { name: 'bad.txt', fullPath: '/bad.txt', isFile: true, isDirectory: false, file: (_r, reject) => reject(new Error('denied')) };
    const out = await M.expandEntries([bad, fakeFileEntry('ok.txt')], 0);
    assert.deepEqual(out.map(e => e.relPath), ['ok.txt']);
  });
  it('readAllEntries loops across batches (Chrome serves ≤100 per call)', async () => {
    // 150 files in one directory → the fake serves 100 + 50; a missing re-loop
    // would silently drop the second batch (and a broken loop hangs this test).
    const kids = Array.from({ length: 150 }, (_, i) => fakeFileEntry(`f${i}.txt`, `/big/f${i}.txt`));
    const out = await M.expandEntries([fakeDirEntry('big', '/big', kids)], 0);
    assert.equal(out.length, 150);
    assert.ok(out.some(e => e.relPath === 'big/f149.txt'), 'second batch must be read');
  });
});

describe('importFiles', () => {
  it('posts each File[] entry to /api/import-file with the encoded target dir', async () => {
    const calls = [];
    fetchHandler = async (url, opts) => {
      calls.push({ url, hasBody: opts && opts.body instanceof FormData, method: opts && opts.method });
      return resp(true, { ok: true, relPath: 'x' });
    };
    let renamed = null;
    await M.importFiles([{ name: 'a.txt' }, { name: 'b.png' }], 'src/lib', { onFileRenamed: (o, n) => { renamed = n; } });
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.equal(c.method, 'POST');
      assert.ok(c.hasBody, 'must post FormData');
      assert.ok(c.url.startsWith('/api/import-file?dir=src%2Flib'), `dir must be encoded, got ${c.url}`);
    }
    assert.equal(renamed, 'x', 'first successful relPath must flow to onFileRenamed(null, relPath)');
  });

  it('empty dir (no subDir) posts dir=<targetDir> verbatim', async () => {
    const calls = [];
    fetchHandler = async (url) => { calls.push(url); return resp(true, { ok: true }); };
    await M.importFiles([{ name: 'a.txt' }], '', {});
    assert.ok(calls[0].startsWith('/api/import-file?dir='), `root import must use empty dir, got ${calls[0]}`);
  });

  it('entry-shape payload preserves directory structure in dir params', async () => {
    const calls = [];
    fetchHandler = async (url) => { calls.push(decodeURIComponent(url)); return resp(true, { ok: true }); };
    const payload = {
      topEntries: [fakeDirEntry('docs', '/docs', [fakeFileEntry('a.txt', '/docs/a.txt')])],
      flatFiles: [{ name: 'docs' }],
    };
    await M.importFiles(payload, 'base', {});
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('dir=base/docs'), `subDir must join targetDir, got ${calls[0]}`);
  });

  it('failures do not call onFileRenamed when nothing succeeded', async () => {
    fetchHandler = async () => resp(false, { error: 'nope' });
    let called = false;
    await M.importFiles([{ name: 'a.txt' }], '', { onFileRenamed: () => { called = true; } });
    assert.equal(called, false);
  });

  it('empty payload is a no-op (no fetch)', async () => {
    let calls = 0;
    fetchHandler = async () => { calls++; return resp(true, { ok: true }); };
    await M.importFiles([], '', {});
    assert.equal(calls, 0);
  });
});
