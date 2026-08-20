// Unit tests for src/utils/entryCache.js
//
// 覆盖目标：getCacheMeta / saveEntries / loadEntries / clearEntries 全部导出。
//
// entryCache.js 依赖浏览器全局 indexedDB + localStorage。Node 测试环境没有，
// 这里手写最小 fake：
//   - indexedDB.open() 返回带 onupgradeneeded/onsuccess/onerror 的请求对象，
//     回调在微任务里触发；result 暴露 objectStoreNames.contains /
//     createObjectStore / transaction()。
//   - transaction().objectStore() 暴露 get/put/delete/clear，每个返回带
//     onsuccess/onerror 的请求；transaction 自身有 oncomplete/onerror。
//   - localStorage 用 Map 实现，可注入抛异常以验证静默回退。
//
// 模块内部有单例 _dbInstance —— 通过 fake DB 的 onclose() 钩子在每个 describe
// 之间重置，避免跨用例状态泄漏。

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── localStorage mock ───────────────────────────────────────────────────────
class MockStorage {
  constructor() { this._data = new Map(); this.throwOnSet = false; this.throwOnGet = false; this.throwOnRemove = false; }
  getItem(k) { if (this.throwOnGet) throw new Error('boom-get'); return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { if (this.throwOnSet) throw new Error('boom-set'); this._data.set(k, String(v)); }
  removeItem(k) { if (this.throwOnRemove) throw new Error('boom-remove'); this._data.delete(k); }
  clear() { this._data.clear(); }
}

// ── fake IndexedDB ──────────────────────────────────────────────────────────
//
// 一个最小内存实现：每个 store 是一个 Map（key -> value）。
// open 的行为可注入失败（openShouldFail）。
// 单个操作请求可按 store 注入失败（reqFailStores）。

class FakeRequest {
  constructor() { this.onsuccess = null; this.onerror = null; this.result = undefined; this.error = null; }
  _succeed(result) { this.result = result; queueMicrotask(() => { if (this.onsuccess) this.onsuccess({ target: this }); }); }
  _fail(err) { this.error = err || new Error('req-fail'); queueMicrotask(() => { if (this.onerror) this.onerror({ target: this }); }); }
}

class FakeObjectStore {
  constructor(map, name, tx) { this._map = map; this._name = name; this._tx = tx; }
  _maybeFail(req) {
    if (this._tx._db._reqFailStores.has(this._name)) {
      req._fail(new Error(`forced-fail:${this._name}`));
      // 操作失败时也让事务进入 error 路径
      this._tx._markError();
      return true;
    }
    return false;
  }
  get(key) {
    const req = new FakeRequest();
    if (this._maybeFail(req)) return req;
    req._succeed(this._map.has(key) ? this._map.get(key) : undefined);
    return req;
  }
  put(value, key) {
    const req = new FakeRequest();
    if (this._maybeFail(req)) return req;
    this._map.set(key, value);
    req._succeed(key);
    this._tx._markWrite();
    return req;
  }
  delete(key) {
    const req = new FakeRequest();
    if (this._maybeFail(req)) return req;
    this._map.delete(key);
    req._succeed(undefined);
    this._tx._markWrite();
    return req;
  }
  clear() {
    const req = new FakeRequest();
    if (this._maybeFail(req)) return req;
    this._map.clear();
    req._succeed(undefined);
    this._tx._markWrite();
    return req;
  }
}

class FakeTransaction {
  constructor(db, storeNames) {
    this._db = db;
    this._storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.oncomplete = null;
    this.onerror = null;
    this.error = null;
    this._errored = false;
    this._sawWrite = false;
    // 事务完成在一个微任务后触发（读事务无写入也需要 complete）
    queueMicrotask(() => {
      queueMicrotask(() => {
        if (this._errored) {
          this.error = this.error || new Error('tx-error');
          if (this.onerror) this.onerror({ target: this });
        } else if (this.oncomplete) {
          this.oncomplete({ target: this });
        }
      });
    });
  }
  objectStore(name) {
    const map = this._db._stores.get(name);
    if (!map) throw new Error(`no such store: ${name}`);
    return new FakeObjectStore(map, name, this);
  }
  _markWrite() { this._sawWrite = true; }
  _markError() { this._errored = true; }
}

class FakeDB {
  constructor(stores, reqFailStores) {
    this._stores = stores;             // Map<name, Map>
    this._reqFailStores = reqFailStores || new Set();
    this.onclose = null;
    this.objectStoreNames = {
      contains: (n) => this._stores.has(n),
    };
  }
  createObjectStore(name) {
    if (!this._stores.has(name)) this._stores.set(name, new Map());
    return {};
  }
  transaction(storeNames /* , mode */) {
    return new FakeTransaction(this, storeNames);
  }
  // 测试辅助：触发 onclose 让模块单例置 null
  _close() { if (this.onclose) this.onclose(); }
}

class FakeIndexedDB {
  constructor() {
    this._stores = new Map();          // 持久跨连接的数据
    this.openShouldFail = false;
    this.needUpgrade = true;           // 首次 open 触发 upgradeneeded
    this._reqFailStores = new Set();
    this._lastDB = null;
  }
  open(/* name, version */) {
    const req = new FakeRequest();
    const idb = this;
    queueMicrotask(() => {
      if (idb.openShouldFail) {
        req.error = new Error('open-failed');
        if (req.onerror) req.onerror({ target: req });
        return;
      }
      const db = new FakeDB(idb._stores, idb._reqFailStores);
      req.result = db;
      idb._lastDB = db;
      if (idb.needUpgrade) {
        idb.needUpgrade = false;
        // 模拟空库：upgradeneeded 时 store 尚未创建
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
      }
      queueMicrotask(() => { if (req.onsuccess) req.onsuccess({ target: req }); });
    });
    return req;
  }
}

// ── 全局安装/还原 ────────────────────────────────────────────────────────────
let origLocalStorage, origIndexedDB;
let storage, idb;

before(() => {
  origLocalStorage = globalThis.localStorage;
  origIndexedDB = globalThis.indexedDB;
});

after(() => {
  if (origLocalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = origLocalStorage;
  if (origIndexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = origIndexedDB;
});

// 每个 describe 内调用：装新的 storage + idb，并通过动态 import 拿到模块。
// 因为模块单例 _dbInstance 跨 import 缓存（ESM 模块单例），所以在 beforeEach
// 里用 _lastDB._close() 强制重置单例，使每个 describe 用到的是自己的 idb。
let mod;
before(async () => {
  storage = new MockStorage();
  idb = new FakeIndexedDB();
  globalThis.localStorage = storage;
  globalThis.indexedDB = idb;
  mod = await import('../src/utils/entryCache.js');
});

// 在不同 describe 之间替换 idb / storage 数据，并重置模块内单例。
function freshEnv() {
  storage._data.clear();
  storage.throwOnSet = storage.throwOnGet = storage.throwOnRemove = false;
  // 重置单例：先触发当前连接的 onclose（模块会把 _dbInstance 置 null）
  if (idb && idb._lastDB) idb._lastDB._close();
  idb = new FakeIndexedDB();
  globalThis.indexedDB = idb;
}

const META_KEY = 'ccv_cacheMeta';
const CACHE_KEY = 'cache';

// ──────────────────────────────────────────────────────────────────────────
describe('getCacheMeta', () => {
  beforeEach(() => { freshEnv(); });

  it('returns null when no meta stored', () => {
    assert.equal(mod.getCacheMeta(), null);
  });

  it('returns parsed meta when complete', () => {
    storage.setItem(META_KEY, JSON.stringify({ projectName: 'p', lastTs: '2026-01-01T00:00:00Z', count: 3 }));
    const meta = mod.getCacheMeta();
    assert.deepEqual(meta, { projectName: 'p', lastTs: '2026-01-01T00:00:00Z', count: 3 });
  });

  it('returns null when count is 0 (incomplete meta)', () => {
    storage.setItem(META_KEY, JSON.stringify({ projectName: 'p', lastTs: 'x', count: 0 }));
    assert.equal(mod.getCacheMeta(), null);
  });

  it('returns null when projectName missing', () => {
    storage.setItem(META_KEY, JSON.stringify({ lastTs: 'x', count: 2 }));
    assert.equal(mod.getCacheMeta(), null);
  });

  it('returns null on malformed JSON (parse throws, swallowed)', () => {
    storage.setItem(META_KEY, '{not valid');
    assert.equal(mod.getCacheMeta(), null);
  });

  it('returns null when localStorage.getItem throws (silent)', () => {
    storage.throwOnGet = true;
    assert.equal(mod.getCacheMeta(), null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('saveEntries / loadEntries round-trip', () => {
  beforeEach(() => { freshEnv(); });

  it('saves entries and loads them back for the same project', async () => {
    const entries = [
      { id: 1, timestamp: '2026-01-01T00:00:00Z' },
      { id: 2, timestamp: '2026-01-02T00:00:00Z' },
    ];
    await mod.saveEntries('projA', entries);
    const loaded = await mod.loadEntries('projA');
    assert.deepEqual(loaded, entries);
  });

  it('writes meta (projectName/lastTs/count) from the last entry on save', async () => {
    const entries = [
      { id: 1, timestamp: 'ts-1' },
      { id: 2, timestamp: 'ts-LAST' },
    ];
    await mod.saveEntries('projMeta', entries);
    const meta = JSON.parse(storage.getItem(META_KEY));
    assert.deepEqual(meta, { projectName: 'projMeta', lastTs: 'ts-LAST', count: 2 });
  });

  it('does not write meta when last entry has no timestamp', async () => {
    await mod.saveEntries('projNoTs', [{ id: 1 }]);
    assert.equal(storage.getItem(META_KEY), null);
  });

  it('loadEntries returns null when project name does not match', async () => {
    await mod.saveEntries('projA', [{ id: 1, timestamp: 't' }]);
    assert.equal(await mod.loadEntries('OTHER'), null);
  });

  it('loadEntries returns null when nothing cached', async () => {
    assert.equal(await mod.loadEntries('whatever'), null);
  });

  it('saveEntries is a no-op for empty/invalid input (no meta, no store write)', async () => {
    await mod.saveEntries('', [{ id: 1, timestamp: 't' }]);   // empty projectName
    await mod.saveEntries('p', []);                            // empty array
    await mod.saveEntries('p', null);                          // not an array
    assert.equal(storage.getItem(META_KEY), null);
    assert.equal(await mod.loadEntries('p'), null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('loadEntries expiry (MAX_AGE 7 days)', () => {
  beforeEach(() => { freshEnv(); });

  it('evicts and returns null for cache older than 7 days, and clears it', async () => {
    // 直接写入一条 ts 超过 7 天的记录到 fake store
    const stale = Date.now() - (8 * 24 * 60 * 60 * 1000);
    idb._stores.set('entries', new Map([[CACHE_KEY, { projectName: 'projOld', entries: [{ id: 1 }], ts: stale }]]));
    idb.needUpgrade = false; // store 已存在，跳过 upgrade
    // 先放一条 meta，验证过期淘汰会经由 clearEntries -> clearMeta 删除
    storage.setItem(META_KEY, JSON.stringify({ projectName: 'projOld', lastTs: 't', count: 1 }));

    const loaded = await mod.loadEntries('projOld');
    assert.equal(loaded, null, 'stale cache must yield null');

    // clearEntries 是 fire-and-forget；等一拍让其异步删除完成
    await new Promise((r) => setTimeout(r, 10));
    const map = idb._stores.get('entries');
    assert.equal(map.has(CACHE_KEY), false, 'stale entry must be deleted from store');
    assert.equal(storage.getItem(META_KEY), null, 'meta must be cleared on eviction');
  });

  it('keeps fresh cache (ts within 7 days)', async () => {
    const fresh = Date.now() - (1 * 24 * 60 * 60 * 1000);
    idb._stores.set('entries', new Map([[CACHE_KEY, { projectName: 'projFresh', entries: [{ id: 7 }], ts: fresh }]]));
    idb.needUpgrade = false;
    const loaded = await mod.loadEntries('projFresh');
    assert.deepEqual(loaded, [{ id: 7 }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('saveEntries write serialization (_writeId discards stale writes)', () => {
  beforeEach(() => { freshEnv(); });

  it('only the latest concurrent save wins; earlier one is discarded', async () => {
    // 同时发起两次写：第二次 ++_writeId 后，第一次的 myId !== _writeId，被丢弃。
    // saveEntries 在拿到 db 后检查 myId !== _writeId 才丢弃。两次几乎同时发起，
    // 第二次的 _writeId 更大，第一次返回前已被超越。
    const p1 = mod.saveEntries('projSer', [{ id: 'OLD', timestamp: 'old' }]);
    const p2 = mod.saveEntries('projSer', [{ id: 'NEW', timestamp: 'new' }]);
    await Promise.all([p1, p2]);
    const loaded = await mod.loadEntries('projSer');
    // 最终落盘的是最新一次（NEW），OLD 被丢弃
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, 'NEW');
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('clearEntries', () => {
  beforeEach(() => { freshEnv(); });

  it('removes the cached entries and clears meta', async () => {
    await mod.saveEntries('projClr', [{ id: 1, timestamp: 't' }]);
    assert.ok(await mod.loadEntries('projClr'), 'sanity: cached before clear');
    assert.ok(storage.getItem(META_KEY), 'sanity: meta present before clear');

    await mod.clearEntries();
    assert.equal(await mod.loadEntries('projClr'), null);
    assert.equal(storage.getItem(META_KEY), null);
  });

  it('clears meta even when localStorage.removeItem throws (silent)', async () => {
    await mod.saveEntries('projClr2', [{ id: 1, timestamp: 't' }]);
    storage.throwOnRemove = true;   // clearMeta 内部抛异常被吞
    await mod.clearEntries();        // 不应抛
    storage.throwOnRemove = false;
    // store 里的 entries 仍被删除
    assert.equal(await mod.loadEntries('projClr2'), null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('DB open failure fallback', () => {
  beforeEach(() => { freshEnv(); idb.openShouldFail = true; globalThis.indexedDB = idb; });

  it('loadEntries returns null when getDB rejects', async () => {
    assert.equal(await mod.loadEntries('p'), null);
  });

  it('saveEntries swallows the rejection (no throw)', async () => {
    // saveMeta 仍然写了 meta（saveMeta 在 getDB 之前？不——saveEntries 先 await getDB）
    await assert.doesNotReject(mod.saveEntries('p', [{ id: 1, timestamp: 't' }]));
  });

  it('clearEntries swallows the rejection but still clears meta', async () => {
    storage.setItem(META_KEY, JSON.stringify({ projectName: 'p', lastTs: 't', count: 1 }));
    await assert.doesNotReject(mod.clearEntries());
    assert.equal(storage.getItem(META_KEY), null, 'meta cleared before getDB even on open failure');
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('localStorage.setItem throwing during save is silent', () => {
  beforeEach(() => { freshEnv(); });

  it('saveEntries still persists entries even if saveMeta throws', async () => {
    storage.throwOnSet = true;   // saveMeta -> setItem throws, swallowed
    await assert.doesNotReject(mod.saveEntries('projLS', [{ id: 1, timestamp: 't' }]));
    storage.throwOnSet = false;
    // 即便 meta 写失败，entries 仍然落盘可读
    assert.deepEqual(await mod.loadEntries('projLS'), [{ id: 1, timestamp: 't' }]);
    // meta 没写成
    assert.equal(storage.getItem(META_KEY), null);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('store-level request errors resolve gracefully', () => {
  beforeEach(() => { freshEnv(); });

  it('loadEntries resolves null when the get request errors', async () => {
    // 先正常写一条，再让后续 entries store 的请求强制失败
    await mod.saveEntries('projErr', [{ id: 1, timestamp: 't' }]);
    idb._reqFailStores.add('entries');
    assert.equal(await mod.loadEntries('projErr'), null);
    idb._reqFailStores.delete('entries');
  });

  it('saveEntries resolves (no throw) when the write transaction errors', async () => {
    idb._reqFailStores.add('entries');
    await assert.doesNotReject(mod.saveEntries('projErr2', [{ id: 1, timestamp: 't' }]));
    idb._reqFailStores.delete('entries');
  });
});
