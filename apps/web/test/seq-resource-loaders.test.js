/**
 * Unit tests for src/utils/seqResourceLoaders.js
 *
 * 覆盖三个静默加载器（loadFsSkills / loadProjectMemory / loadClaudeMdList）及其
 * 共用 seq-guard fetch 包装。重点分支：
 *   - seq 失效（在途请求被 ++seq 标记为 stale）→ 不 setState
 *   - 网络错误 / parse 错误 / http 非 2xx / payload 结构错误
 *   - loadFsSkills 的 isLocalLog 短路、失败时不 clobber 历史数组（保留乐观态）
 *   - 成功路径 setState 落具体数据
 *
 * 依赖说明：seqResourceLoaders.js -> apiUrl.js，后者在模块加载时读取
 * window.location.search，故所有 import 之前必须先挂 globalThis.window。
 * apiUrl 用 .js 后缀 import，依赖链干净，可直接静态 import。
 */
import { describe, it, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ── 在 import 目标模块前安装浏览器全局 ──────────────────────────────────────
const _origWindow = globalThis.window;
const _origDocument = globalThis.document;
const _origFetch = globalThis.fetch;

globalThis.window = { location: { search: '' } };
// apiUrl.getBasePath 会摸 document.querySelector；给个不带 <base> 的最小 mock。
globalThis.document = { querySelector: () => null };

const { loadFsSkills, loadProjectMemory, loadClaudeMdList } =
  await import('../src/utils/seqResourceLoaders.js');

after(() => {
  if (_origWindow === undefined) delete globalThis.window; else globalThis.window = _origWindow;
  if (_origDocument === undefined) delete globalThis.document; else globalThis.document = _origDocument;
  if (_origFetch === undefined) delete globalThis.fetch; else globalThis.fetch = _origFetch;
});

// ── 测试用假组件：记录 setState 调用，支持函数式更新 ─────────────────────────
function makeComponent(initialState = {}) {
  const comp = {
    state: { ...initialState },
    setStateCalls: [],
    _fsSkillsSeq: 0,
    _memorySeq: 0,
    _claudeMdSeq: 0,
    setState(updater) {
      const patch = typeof updater === 'function' ? updater(comp.state) : updater;
      comp.setStateCalls.push(patch);
      Object.assign(comp.state, patch);
    },
  };
  return comp;
}

/** 装一个一次性 fetch mock：调用计数 + 自定义实现。返回 restore 句柄。 */
function installFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return impl(url, opts, calls.length);
  };
  return { calls };
}

/** 构造一个 Response-like 对象 */
function res({ ok = true, status = 200, json }) {
  return { ok, status, json };
}

describe('seqResourceLoaders — loadFsSkills', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });
  after(() => { globalThis.fetch = _origFetch; });

  it('isLocalLog 短路：不发请求，返回 local_log，不动 seq', async () => {
    const comp = makeComponent({ _fsSkills: null });
    let fetched = false;
    globalThis.fetch = async () => { fetched = true; return res({ json: async () => ({}) }); };
    const out = await loadFsSkills(comp, { isLocalLog: true });
    assert.deepEqual(out, { ok: false, reason: 'local_log' });
    assert.equal(fetched, false, '本地日志不应触发网络');
    assert.equal(comp._fsSkillsSeq, 0, 'seq 未递增');
    assert.equal(comp.setStateCalls.length, 0);
  });

  it('成功：setState 落 skills 数组并返回 ok', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => res({ ok: true, status: 200, json: async () => ({ ok: true, skills: ['a', 'b'] }) }));
    const out = await loadFsSkills(comp, {});
    assert.deepEqual(out, { ok: true, skills: ['a', 'b'] });
    assert.deepEqual(comp.state._fsSkills, ['a', 'b']);
    assert.equal(comp._fsSkillsSeq, 1);
  });

  it('网络错误：reason=network，且不 clobber 已有数组（保留历史乐观态）', async () => {
    const comp = makeComponent({ _fsSkills: ['old'] });
    installFetch(async () => { throw new Error('boom'); });
    const out = await loadFsSkills(comp, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'network', 'errorKind=network 优先于 message');
    // setState(prev => ...) 应保留旧数组
    assert.deepEqual(comp.state._fsSkills, ['old']);
  });

  it('网络错误且无历史数组：回落 false', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => { throw new Error('boom'); });
    const out = await loadFsSkills(comp, {});
    assert.equal(out.reason, 'network');
    assert.equal(comp.state._fsSkills, false);
  });

  it('http 非 2xx：reason=http:NNN（payload 无 error 字段时）', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => res({ ok: false, status: 503, json: async () => ({}) }));
    const out = await loadFsSkills(comp, {});
    assert.deepEqual(out, { ok: false, reason: 'http:503' });
    assert.equal(comp.state._fsSkills, false);
  });

  it('payload 带 error 字段：reason 用 server message', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => res({ ok: false, status: 500, json: async () => ({ error: 'no skills dir' }) }));
    const out = await loadFsSkills(comp, {});
    assert.equal(out.reason, 'no skills dir');
  });

  it('ok 但 skills 非数组：判失败，保留历史数组', async () => {
    const comp = makeComponent({ _fsSkills: ['keep'] });
    installFetch(async () => res({ ok: true, status: 200, json: async () => ({ ok: true, skills: 'not-array' }) }));
    const out = await loadFsSkills(comp, {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'http:200', 'data.error 缺失 → http:status');
    assert.deepEqual(comp.state._fsSkills, ['keep']);
  });

  it('parse 错误：r.json() 抛 → reason=parse', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => res({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
    const out = await loadFsSkills(comp, {});
    assert.equal(out.reason, 'parse');
    assert.equal(comp.state._fsSkills, false);
  });

  it('stale：fetch 期间 seq 被后发请求顶替 → 返回 stale，不 setState', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => {
      // 模拟在途时另一请求把 seq 抢走
      comp._fsSkillsSeq = 99;
      return res({ ok: true, status: 200, json: async () => ({ ok: true, skills: ['x'] }) });
    });
    const out = await loadFsSkills(comp, {});
    assert.deepEqual(out, { ok: false, reason: 'stale' });
    assert.equal(comp.setStateCalls.length, 0, 'stale 不允许 setState');
  });

  it('stale on network error：fetch reject 后 seq 已变 → stale 短路', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => {
      comp._fsSkillsSeq = 99;
      throw new Error('net');
    });
    const out = await loadFsSkills(comp, {});
    assert.deepEqual(out, { ok: false, reason: 'stale' });
    assert.equal(comp.setStateCalls.length, 0);
  });

  it('stale on parse error：r.json() 抛之后 seq 已变 → stale（覆盖 parse 路径 stale 分支）', async () => {
    const comp = makeComponent({ _fsSkills: null });
    installFetch(async () => res({
      ok: true,
      status: 200,
      json: async () => { comp._fsSkillsSeq = 99; throw new Error('bad json'); },
    }));
    const out = await loadFsSkills(comp, {});
    assert.deepEqual(out, { ok: false, reason: 'stale' });
    assert.equal(comp.setStateCalls.length, 0, 'parse 期间变 stale 不 setState');
  });
});

describe('seqResourceLoaders — loadProjectMemory', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });
  after(() => { globalThis.fetch = _origFetch; });

  it('成功：setState(_memory = data)', async () => {
    const comp = makeComponent({ _memory: null });
    installFetch(async () => res({ ok: true, status: 200, json: async () => ({ text: 'mem' }) }));
    await loadProjectMemory(comp);
    assert.deepEqual(comp.state._memory, { text: 'mem' });
    assert.equal(comp._memorySeq, 1);
  });

  it('网络错误：_memory=false', async () => {
    const comp = makeComponent({ _memory: null });
    installFetch(async () => { throw new Error('net'); });
    await loadProjectMemory(comp);
    assert.equal(comp.state._memory, false);
  });

  it('http 非 2xx：_memory=false', async () => {
    const comp = makeComponent({ _memory: null });
    installFetch(async () => res({ ok: false, status: 404, json: async () => ({}) }));
    await loadProjectMemory(comp);
    assert.equal(comp.state._memory, false);
  });

  it('stale：seq 被顶替 → 直接 return，不 setState', async () => {
    const comp = makeComponent({ _memory: null });
    installFetch(async () => {
      comp._memorySeq = 42;
      return res({ ok: true, status: 200, json: async () => ({ text: 'late' }) });
    });
    await loadProjectMemory(comp);
    assert.equal(comp.setStateCalls.length, 0);
  });
});

describe('seqResourceLoaders — loadClaudeMdList', () => {
  beforeEach(() => { globalThis.fetch = _origFetch; });
  after(() => { globalThis.fetch = _origFetch; });

  it('成功：setState(_claudeMd = entries 数组)，允许空数组', async () => {
    const comp = makeComponent({ _claudeMd: null });
    installFetch(async () => res({ ok: true, status: 200, json: async () => ({ entries: [] }) }));
    await loadClaudeMdList(comp);
    assert.deepEqual(comp.state._claudeMd, []);
  });

  it('成功：非空 entries 原样落地', async () => {
    const comp = makeComponent({ _claudeMd: null });
    const entries = [{ id: 1, scope: 'project', tail: 'x' }];
    installFetch(async () => res({ ok: true, status: 200, json: async () => ({ entries }) }));
    await loadClaudeMdList(comp);
    assert.deepEqual(comp.state._claudeMd, entries);
  });

  it('entries 非数组：_claudeMd=false', async () => {
    const comp = makeComponent({ _claudeMd: null });
    installFetch(async () => res({ ok: true, status: 200, json: async () => ({ entries: { bad: 1 } }) }));
    await loadClaudeMdList(comp);
    assert.equal(comp.state._claudeMd, false);
  });

  it('http 非 2xx：_claudeMd=false', async () => {
    const comp = makeComponent({ _claudeMd: null });
    installFetch(async () => res({ ok: false, status: 500, json: async () => ({ entries: [] }) }));
    await loadClaudeMdList(comp);
    assert.equal(comp.state._claudeMd, false);
  });

  it('网络错误：_claudeMd=false', async () => {
    const comp = makeComponent({ _claudeMd: null });
    installFetch(async () => { throw new Error('net'); });
    await loadClaudeMdList(comp);
    assert.equal(comp.state._claudeMd, false);
  });

  it('stale：seq 被顶替 → 不 setState', async () => {
    const comp = makeComponent({ _claudeMd: null });
    installFetch(async () => {
      comp._claudeMdSeq = 7;
      return res({ ok: true, status: 200, json: async () => ({ entries: [{ id: 9 }] }) });
    });
    await loadClaudeMdList(comp);
    assert.equal(comp.setStateCalls.length, 0);
  });
});
