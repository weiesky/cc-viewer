/**
 * Unit tests for src/utils/lazyWithReload.js
 *
 * 导出三件套：shouldReloadStaleChunk / reloadOnStaleChunk / handleStaleChunk。
 * 重点状态机：5 分钟窗口内允许 reload 一次，窗口内二次失败拒绝（抛原 error）；
 * sessionStorage 抛 SecurityError/Quota 时静默吞掉、读回 0（→ 偏向 reload）。
 *
 * 依赖：sessionStorage / window.location.reload / Date.now / setTimeout。
 * 模块无 svg、import 链干净，可直接静态 import；浏览器全局挂 globalThis，
 * after() 还原。reload 与 Date.now 用可控 stub，setTimeout 用 node:test fake timers。
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldReloadStaleChunk,
  reloadOnStaleChunk,
  handleStaleChunk,
} from '../src/utils/lazyWithReload.js';

const RELOAD_WINDOW_MS = 5 * 60 * 1000;

const _origSession = globalThis.sessionStorage;
const _origWindow = globalThis.window;
const _origDateNow = Date.now;

let reloadCount;

function installStorage() {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    _peek: () => store,
  };
  return store;
}

function installThrowingStorage() {
  globalThis.sessionStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceeded'); },
    removeItem() { throw new Error('QuotaExceeded'); },
  };
}

function installWindow() {
  reloadCount = 0;
  globalThis.window = { location: { reload: () => { reloadCount += 1; } } };
}

/** 把 Date.now 钉死到固定值，便于精确测窗口边界 */
function freezeNow(ms) {
  Date.now = () => ms;
}

beforeEach(() => {
  installStorage();
  installWindow();
  Date.now = _origDateNow;
});

after(() => {
  if (_origSession === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = _origSession;
  if (_origWindow === undefined) delete globalThis.window; else globalThis.window = _origWindow;
  Date.now = _origDateNow;
});

describe('shouldReloadStaleChunk', () => {
  it('首次（无时间戳）允许 reload 并写入时间戳', () => {
    freezeNow(1_000_000);
    const store = globalThis.sessionStorage._peek();
    assert.equal(shouldReloadStaleChunk('chunk-A'), true);
    assert.equal(store.get('_chunkReloadedAt:chunk-A'), '1000000', '写入当前时间戳');
  });

  it('窗口内二次调用返回 false（不重复刷）', () => {
    freezeNow(1_000_000);
    assert.equal(shouldReloadStaleChunk('chunk-A'), true);
    // 1 分钟后（< 5min 窗口）
    freezeNow(1_000_000 + 60_000);
    assert.equal(shouldReloadStaleChunk('chunk-A'), false);
  });

  it('窗口边界：恰好 5 分钟（<=）仍判 false', () => {
    freezeNow(2_000_000);
    shouldReloadStaleChunk('chunk-B');
    freezeNow(2_000_000 + RELOAD_WINDOW_MS); // diff === window → <= 成立
    assert.equal(shouldReloadStaleChunk('chunk-B'), false);
  });

  it('超过窗口（> 5 分钟）再次允许 reload 并刷新时间戳', () => {
    freezeNow(3_000_000);
    shouldReloadStaleChunk('chunk-C');
    const t2 = 3_000_000 + RELOAD_WINDOW_MS + 1;
    freezeNow(t2);
    assert.equal(shouldReloadStaleChunk('chunk-C'), true);
    assert.equal(globalThis.sessionStorage._peek().get('_chunkReloadedAt:chunk-C'), String(t2));
  });

  it('不同 chunk name 互相隔离', () => {
    freezeNow(4_000_000);
    assert.equal(shouldReloadStaleChunk('A'), true);
    assert.equal(shouldReloadStaleChunk('B'), true, '另一个 chunk 不受 A 的时间戳影响');
  });

  it('sessionStorage 抛异常：读回 0 → 偏向 reload（返回 true）', () => {
    installThrowingStorage();
    freezeNow(5_000_000);
    // last=0, Date.now-0 > window → true；写入也被吞，不抛
    assert.equal(shouldReloadStaleChunk('safari-private'), true);
  });

  it('损坏的时间戳（非数字）按 0 处理 → 允许 reload', () => {
    freezeNow(6_000_000);
    globalThis.sessionStorage._peek().set('_chunkReloadedAt:weird', 'not-a-number');
    // Number('not-a-number'||0) → NaN；Date.now - NaN = NaN；NaN <= window 为 false → reload
    assert.equal(shouldReloadStaleChunk('weird'), true);
  });
});

describe('reloadOnStaleChunk', () => {
  it('首次：触发 window.location.reload 并返回 true', () => {
    freezeNow(1_000_000);
    assert.equal(reloadOnStaleChunk('R1'), true);
    assert.equal(reloadCount, 1);
  });

  it('窗口内二次：不刷，返回 false', () => {
    freezeNow(1_000_000);
    reloadOnStaleChunk('R2');
    assert.equal(reloadCount, 1);
    freezeNow(1_000_000 + 1000);
    assert.equal(reloadOnStaleChunk('R2'), false);
    assert.equal(reloadCount, 1, 'reload 不应再次调用');
  });
});

describe('handleStaleChunk', () => {
  afterEach(function () {
    // 还原 fake timers（若某用例启用）
    this.mock?.timers?.reset?.();
  });

  it('窗口内二次失败：抛出原 error（不 reload）', (t) => {
    freezeNow(1_000_000);
    // 先吃掉首次机会
    shouldReloadStaleChunk('H1');
    freezeNow(1_000_000 + 1000);
    const err = new Error('Failed to fetch dynamically imported module');
    assert.throws(() => handleStaleChunk('H1', err), /Failed to fetch dynamically imported module/);
    assert.equal(reloadCount, 0, '拒绝路径不 reload');
  });

  it('首次：返回永不 resolve 的 Promise，先跑 onReload，200ms 后 reload', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    freezeNow(2_000_000);
    let onReloadRan = false;
    const p = handleStaleChunk('H2', new Error('stale'), { onReload: () => { onReloadRan = true; } });
    assert.ok(p instanceof Promise);
    assert.equal(onReloadRan, true, 'onReload 同步先跑');
    assert.equal(reloadCount, 0, '200ms 内还没 reload');
    t.mock.timers.tick(199);
    assert.equal(reloadCount, 0);
    t.mock.timers.tick(1); // 到 200ms
    assert.equal(reloadCount, 1, 'grace 到点后 reload');
  });

  it('onReload 抛错不阻止 reload（被 try/catch 吞）', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    freezeNow(3_000_000);
    assert.doesNotThrow(() => {
      handleStaleChunk('H3', new Error('stale'), { onReload: () => { throw new Error('toast boom'); } });
    });
    t.mock.timers.tick(200);
    assert.equal(reloadCount, 1, 'toast 抛错后仍按时 reload');
  });

  it('未传 onReload 也安全（可选链）', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    freezeNow(4_000_000);
    const p = handleStaleChunk('H4', new Error('stale'));
    assert.ok(p instanceof Promise);
    t.mock.timers.tick(200);
    assert.equal(reloadCount, 1);
  });

  it('返回的 Promise 永不 resolve（卡 Suspense fallback）', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    freezeNow(5_000_000);
    let settled = false;
    const p = handleStaleChunk('H5', new Error('stale'), {});
    p.then(() => { settled = true; }, () => { settled = true; });
    t.mock.timers.tick(1000);
    // 用微任务 flush 一拍，确认仍未 settle
    return Promise.resolve().then(() => {
      assert.equal(settled, false, 'Promise 应永远 pending');
    });
  });
});
