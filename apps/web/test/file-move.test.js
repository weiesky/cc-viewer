/**
 * src/components/files/fileMove.js 单元测试 —— FileExplorer / FileBrowserModal
 * 共享的项目内拖拽移动（internal move）逻辑。
 *
 * 依赖（antd message、apiUrl 顶层读 window.location）需要：
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

globalThis.window = globalThis.window || { location: { search: '' } };
if (!globalThis.window.location) globalThis.window.location = { search: '' };
globalThis.document = globalThis.document || { querySelector: () => null };

const ORIG_FETCH = globalThis.fetch;
let fetchHandler = async () => { throw new Error('fetchHandler not set'); };
globalThis.fetch = (...args) => fetchHandler(...args);
after(() => { globalThis.fetch = ORIG_FETCH; });

const resp = (ok, body) => ({ ok, json: async () => body });

let M;

before(async () => {
  M = await import('../src/components/files/fileMove.js');
});

const dragEvent = (types) => ({ dataTransfer: { types } });

describe('fileMove module contracts', () => {
  it('move failures surface a toast on both error paths (never silent)', () => {
    const FILE_MOVE = readFileSync(join(SRC, 'components', 'files', 'fileMove.js'), 'utf-8');
    assert.equal(FILE_MOVE.split('message.error(').length - 1, 2,
      'both the HTTP-error and the network-error path must toast');
  });

  it('useInternalMoveTarget guards empty fromPath and runs canDropMoveOn before onMove', () => {
    const helper = readFileSync(join(SRC, 'components', 'files', 'fileDropTarget.js'), 'utf-8');
    const i = helper.indexOf('const onDrop = useCallback((e) => {');
    const j = helper.indexOf('\n  }, [', i);
    const body = helper.slice(i, j);
    assert.ok(body.includes("console.warn('[fileDropTarget] internal-move drop with empty fromPath"),
      'empty-fromPath drops must warn (platform-bug diagnosability, sidebar parity)');
    assert.ok(body.includes('if (canDropMoveOn(fromPath, targetDir)) onMove(fromPath, targetDir);'),
      'guards must run before onMove');
  });
});

describe('isInternalMoveDrag', () => {
  it('detects the internal-move marker only', () => {
    assert.equal(M.isInternalMoveDrag(dragEvent(['text/plain', 'text/x-internal-move'])), true);
    assert.equal(M.isInternalMoveDrag(dragEvent(['Files'])), false);
    assert.equal(M.isInternalMoveDrag(dragEvent(['text/plain'])), false);
  });
});

describe('canDropMoveOn', () => {
  it('accepts a legal move into another directory', () => {
    assert.equal(M.canDropMoveOn('src/a.txt', 'dest'), true);
    assert.equal(M.canDropMoveOn('a.txt', 'dest/sub'), true);
    assert.equal(M.canDropMoveOn('src/dir', ''), true); // 移到根
  });
  it('rejects self-drop, descendant-drop and same-dir no-op', () => {
    assert.equal(M.canDropMoveOn('src/dir', 'src/dir'), false);          // 自身
    assert.equal(M.canDropMoveOn('src/dir', 'src/dir/sub'), false);      // 自身子目录
    assert.equal(M.canDropMoveOn('src/a.txt', 'src'), false);            // 同目录
    assert.equal(M.canDropMoveOn('a.txt', ''), false);                   // 已在根
  });
  it('rejects empty fromPath', () => {
    assert.equal(M.canDropMoveOn('', 'dest'), false);
    assert.equal(M.canDropMoveOn(null, 'dest'), false);
  });
  it('does not confuse sibling prefixes (src/dir2 is not inside src/dir)', () => {
    assert.equal(M.canDropMoveOn('src/dir', 'src/dir2'), true);
  });
});

describe('moveFile', () => {
  it('posts {fromPath, toDir} and forwards (fromPath, newPath) on success', async () => {
    let seen = null;
    fetchHandler = async (url, opts) => {
      seen = { url, method: opts.method, body: JSON.parse(opts.body) };
      return resp(true, { ok: true, newPath: 'dest/a.txt' });
    };
    let renamed = null;
    await M.moveFile('src/a.txt', 'dest', { onFileRenamed: (o, n) => { renamed = [o, n]; } });
    assert.equal(seen.url, '/api/move-file');
    assert.equal(seen.method, 'POST');
    assert.deepEqual(seen.body, { fromPath: 'src/a.txt', toDir: 'dest' });
    assert.deepEqual(renamed, ['src/a.txt', 'dest/a.txt']);
  });

  it('passes toDir: "" through verbatim (move to project root)', async () => {
    let body = null;
    fetchHandler = async (url, opts) => { body = JSON.parse(opts.body); return resp(true, { ok: true, newPath: 'a.txt' }); };
    await M.moveFile('sub/a.txt', '', {});
    assert.equal(body.toDir, '');
  });

  it('server errors (e.g. 409 same-name) do not call onFileRenamed', async () => {
    fetchHandler = async () => resp(false, { error: 'Target already exists' });
    let called = false;
    await M.moveFile('a.txt', 'dest', { onFileRenamed: () => { called = true; } });
    assert.equal(called, false);
  });

  it('network failures do not call onFileRenamed and do not throw', async () => {
    fetchHandler = async () => { throw new Error('offline'); };
    let called = false;
    await M.moveFile('a.txt', 'dest', { onFileRenamed: () => { called = true; } });
    assert.equal(called, false);
  });
});
