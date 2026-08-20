/**
 * Unit tests for electron/window-state.js
 *
 * 覆盖:loadState(损坏 JSON / 形状非法 / 正常)、saveState 往返、validateState
 * (越界丢弃 / 部分可见保留 / 最小尺寸钳制 / maximized 透传 / 多显示器)。
 * fs 经注入的 fake 读写,不碰磁盘、不依赖 Electron screen。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadState, saveState, validateState } from '../electron/window-state.js';

const WA_PRIMARY = { x: 0, y: 0, width: 1920, height: 1080 };   // 主屏 workArea
const WA_SECOND = { x: 1920, y: 0, width: 1920, height: 1080 }; // 右侧扩展屏

describe('loadState', () => {
  it('returns parsed state for valid JSON', () => {
    const read = () => JSON.stringify({ x: 10, y: 20, width: 1400, height: 900, maximized: true });
    assert.deepEqual(loadState(read, '/x'), { x: 10, y: 20, width: 1400, height: 900, maximized: true });
  });
  it('returns null on missing file (read throws)', () => {
    assert.equal(loadState(() => { throw new Error('ENOENT'); }, '/x'), null);
  });
  it('returns null on corrupt JSON', () => {
    assert.equal(loadState(() => '{ "x": 1,', '/x'), null);
  });
  it('returns null on non-numeric bounds', () => {
    assert.equal(loadState(() => JSON.stringify({ x: 'a', y: 0, width: 800, height: 600 }), '/x'), null);
  });
});

describe('saveState — round-trip', () => {
  it('save then load yields the same state', () => {
    let disk = null;
    const write = (_p, data) => { disk = data; };
    const state = { x: 5, y: 6, width: 1000, height: 700, maximized: false };
    assert.equal(saveState(write, '/x', state), true);
    assert.deepEqual(loadState(() => disk, '/x'), state);
  });
  it('returns false when write throws (best-effort, no crash)', () => {
    assert.equal(saveState(() => { throw new Error('EACCES'); }, '/x', { x: 0, y: 0, width: 800, height: 600 }), false);
  });
});

describe('validateState', () => {
  it('passes through an on-screen state', () => {
    const s = { x: 100, y: 100, width: 1400, height: 900, maximized: false };
    assert.deepEqual(validateState(s, [WA_PRIMARY]), s);
  });
  it('rejects a state fully off-screen (monitor unplugged)', () => {
    const s = { x: 2200, y: 100, width: 1400, height: 900, maximized: false };
    assert.equal(validateState(s, [WA_PRIMARY]), null);
  });
  it('accepts the same state when the second monitor is present', () => {
    const s = { x: 2200, y: 100, width: 1400, height: 900, maximized: false };
    assert.deepEqual(validateState(s, [WA_PRIMARY, WA_SECOND]), s);
  });
  it('accepts a partially visible window (enough to grab the title bar)', () => {
    const s = { x: -800, y: 0, width: 1400, height: 900, maximized: false };
    assert.deepEqual(validateState(s, [WA_PRIMARY]), s);
  });
  it('rejects a sliver overlap (< 100px visible)', () => {
    const s = { x: 1900, y: 0, width: 1400, height: 900, maximized: false }; // 仅 20px 在屏内
    assert.equal(validateState(s, [WA_PRIMARY]), null);
  });
  it('clamps size up to the 800x600 minimum', () => {
    const s = { x: 0, y: 0, width: 400, height: 300, maximized: false };
    assert.deepEqual(validateState(s, [WA_PRIMARY]), { x: 0, y: 0, width: 800, height: 600, maximized: false });
  });
  it('preserves the maximized flag', () => {
    const s = { x: 0, y: 0, width: 1400, height: 900, maximized: true };
    assert.equal(validateState(s, [WA_PRIMARY]).maximized, true);
  });
  it('preserves a large window spanning two displays', () => {
    const s = { x: 0, y: 0, width: 3000, height: 900, maximized: false };
    assert.deepEqual(validateState(s, [WA_PRIMARY, WA_SECOND]), s);
  });
  it('allows negative coordinates (left-side secondary display, common on macOS)', () => {
    const WA_LEFT = { x: -1920, y: 0, width: 1920, height: 1080 };
    const s = { x: -1800, y: 100, width: 1400, height: 900, maximized: false };
    assert.deepEqual(validateState(s, [WA_LEFT, WA_PRIMARY]), s);
  });
  it('returns null for null state / empty displays', () => {
    assert.equal(validateState(null, [WA_PRIMARY]), null);
    assert.equal(validateState({ x: 0, y: 0, width: 800, height: 600 }, []), null);
  });
});
