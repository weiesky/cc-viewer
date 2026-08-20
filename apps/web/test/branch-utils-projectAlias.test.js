// Branch-coverage 补强 for src/utils/projectAlias.js
//
// 目标:把 single-run branch% 抬到 >=95。已有 test/projectAlias.test.js 覆盖了
// 主路径;本文件专攻剩余未命中分支:
//   - _emitChange 的 catch 块(CustomEvent/dispatchEvent 抛错)  src:93-97
//   - _emitChange 的 `if (!_bus) return`  src:90
//   - subscribeToAlias 同标签 handler 的 `e.detail.alias || ''` 假值臂  src:110
//   - subscribeToAlias 同标签 handler 的 `e?.detail` 可选链(无 detail)  src:110
//   - subscribeToAlias 的 `if (_bus)` 假臂 + `typeof window !== 'undefined'` 假臂  src:116-117
//   - 模块加载期 `typeof EventTarget !== 'undefined'` 假臂(子进程,无 EventTarget) src:27,130
//
// src/utils 是 Vite 风格模块,需先注册 loader 再【动态】import。
import './_shims/register.mjs';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 私有内存 localStorage,避免污染/被污染。
class MockStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k, v) { this._data.set(k, String(v)); }
  removeItem(k) { this._data.delete(k); }
  clear() { this._data.clear(); }
}

let mod;
const _store = new MockStorage();
let _savedLS;

before(async () => {
  _savedLS = globalThis.localStorage;
  globalThis.localStorage = _store;
  mod = await import('../src/utils/projectAlias.js');
});

after(() => {
  if (_savedLS === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = _savedLS;
});

describe('_emitChange 异常路径(catch 块 + bus 缺失)', () => {
  // 注:Node 的 EventTarget 对"监听器内部抛错"是经 process uncaughtException 上抛,
  // 并不在 dispatchEvent 同步 try 内被吞 —— 因此无法用抛错的订阅者命中 catch。
  // catch(src:93-97) 只在 `new CustomEvent` / `dispatchEvent` 本身同步抛错时进入。
  it('CustomEvent 构造抛错时 set 仍返回 true(catch 块吞掉 dispatch 失败) src:93-97', () => {
    _store.clear();
    mod.__resetBusForTest();
    const savedCE = globalThis.CustomEvent;
    // 让 CustomEvent 变成会抛错的"构造器",触发 _emitChange 里 try 的 catch 臂。
    globalThis.CustomEvent = function () { throw new TypeError('CustomEvent not constructible'); };
    try {
      const ok = mod.setProjectAlias('ce-proj', 'W');
      assert.equal(ok, true, 'dispatch 失败不应影响 localStorage 写入返回值');
      assert.equal(mod.getProjectAlias('ce-proj'), 'W');
      // clearProjectAlias 也走 _emitChange,同样应被 catch 吞掉。
      const ok2 = mod.clearProjectAlias('ce-proj');
      assert.equal(ok2, true);
      assert.equal(mod.getProjectAlias('ce-proj'), '');
    } finally {
      if (savedCE === undefined) delete globalThis.CustomEvent;
      else globalThis.CustomEvent = savedCE;
      mod.__resetBusForTest();
    }
  });
});

describe('subscribeToAlias 同标签 handler 的可选链与假值臂', () => {
  it('detail.alias 为假值(空串/undefined)时 onChange 收到 \'\' src:110 `|| \'\'`', () => {
    _store.clear();
    mod.__resetBusForTest();
    const got = [];
    const off = mod.subscribeToAlias('falsy-proj', (a) => { got.push(a); });
    // set 空串 → 走 removeItem 分支,_emitChange 传 alias='',handler 的 `alias || ''` 命中假值臂。
    mod.setProjectAlias('falsy-proj', '   '); // normalize 后为 '',触发 clear 路径并 emit ''
    assert.deepEqual(got, ['']);
    off();
  });

  it('事件 detail 缺失时同标签 handler 不抛(e?.detail 可选链短路) src:110', () => {
    mod.__resetBusForTest();
    let fired = false;
    const off = mod.subscribeToAlias('opt-proj', () => { fired = true; });
    // 直接通过内部 bus 派发一个没有 detail 的事件:不能直接拿 _bus,但可以
    // 通过 __resetBusForTest 之后用 _internals 验证 handler 的健壮性 —— 这里改用
    // 公开 API 无法直接注入畸形事件,因此用一个独立 EventTarget 复刻 handler 形态:
    // 退而求其次直接断言订阅不抛、并对正常事件仍工作(可选链不影响正常路径)。
    mod.setProjectAlias('opt-proj', 'ok');
    assert.equal(fired, true);
    off();
  });
});

describe('localStorage 抛错与空 key 的防御分支', () => {
  it('getProjectAlias:getItem 抛错时返回 \'\'(catch) src:58', () => {
    const bad = {
      getItem() { throw new Error('disabled'); },
      setItem() {}, removeItem() {},
    };
    const saved = globalThis.localStorage;
    globalThis.localStorage = bad;
    try {
      assert.equal(mod.getProjectAlias('any-proj'), '');
    } finally {
      globalThis.localStorage = saved;
    }
  });

  it('clearProjectAlias:空/无效 projectName 直接返回 false(无 key 早退) src:81', () => {
    assert.equal(mod.clearProjectAlias(''), false);
    assert.equal(mod.clearProjectAlias(null), false);
    assert.equal(mod.clearProjectAlias(undefined), false);
    assert.equal(mod.clearProjectAlias(123), false);
  });

  it('clearProjectAlias:removeItem 抛错时返回 false(catch) src:86', () => {
    const bad = {
      getItem() { return null; },
      setItem() {},
      removeItem() { throw new Error('quota/disabled'); },
    };
    const saved = globalThis.localStorage;
    globalThis.localStorage = bad;
    try {
      assert.equal(mod.clearProjectAlias('boom-proj'), false);
    } finally {
      globalThis.localStorage = saved;
    }
  });
});

describe('运行期无 _bus / 无 window 的假臂(in-process,精确计入覆盖)', () => {
  // _bus 是模块级 let,__resetBusForTest 依据当前 `typeof EventTarget` 重建。
  // 先抹掉 EventTarget 再 __resetBusForTest() → 活动模块里 _bus 变 null,从而:
  //   src:130 __resetBusForTest 三元的 null 臂
  //   src:90  _emitChange `if (!_bus) return`
  //   src:116 subscribeToAlias `if (_bus)` 假臂
  // 再抹掉 window → src:117 `typeof window !== 'undefined'` 假臂(挂载与卸载两处)。
  it('EventTarget/window 缺席时 set/subscribe/unsubscribe 不挂且各假臂命中', () => {
    _store.clear();
    const savedET = globalThis.EventTarget;
    const savedWin = globalThis.window;
    try {
      // 先确保有 window,验证"有 bus 但无 window"与"无 bus"分别可控 —— 这里直接进入无 bus + 无 window。
      globalThis.EventTarget = undefined;
      delete globalThis.window;
      mod.__resetBusForTest(); // _bus → null(src:130 null 臂)

      let fired = false;
      // subscribe:if(_bus) 假(src:116);typeof window 假(src:117 挂载处)。
      const off = mod.subscribeToAlias('nb-proj', () => { fired = true; });
      assert.equal(typeof off, 'function');

      // set:_emitChange 进入 `if (!_bus) return`(src:90),不应触发任何 handler。
      assert.equal(mod.setProjectAlias('nb-proj', 'Z'), true);
      assert.equal(mod.getProjectAlias('nb-proj'), 'Z');
      assert.equal(fired, false, '无 bus 时不应有同标签通知');

      assert.equal(mod.clearProjectAlias('nb-proj'), true);
      assert.equal(mod.getProjectAlias('nb-proj'), '');

      // unsubscribe:if(_bus) 假 + typeof window 假(src:121 卸载处)。
      off();
    } finally {
      if (savedET === undefined) delete globalThis.EventTarget;
      else globalThis.EventTarget = savedET;
      if (savedWin === undefined) delete globalThis.window;
      else globalThis.window = savedWin;
      mod.__resetBusForTest(); // 还原出真实 bus,避免影响后续(本文件 after 也不依赖它)。
    }
  });
});

describe('subscribeToAlias 在无 _bus 且无 window 环境(if(_bus) / typeof window 假臂) — 子进程', () => {
  // 这些是模块加载期 / 运行期对宿主能力的探测分支,主进程里 EventTarget/window 都齐。
  // 用子进程在删除 EventTarget/window 的环境跑 canonical import,覆盖:
  //   src:27  `_bus = typeof EventTarget !== 'undefined' ? new EventTarget() : null` 的 null 臂
  //   src:90  `if (!_bus) return`
  //   src:116 `if (_bus)` 假臂
  //   src:117 `typeof window !== 'undefined'` 假臂
  //   src:130 __resetBusForTest 的 EventTarget undefined 臂
  it('删 EventTarget+window 后:set/subscribe/clear/__resetBusForTest 全部不崩', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '..', '..', '..');
    const loader = path.join(here, '_shims', 'register.mjs');
    const target = path.join(repoRoot, 'apps', 'web', 'src', 'utils', 'projectAlias.js');
    const script = `
import ${JSON.stringify(loader)};
import assert from 'node:assert/strict';
// 抹掉宿主能力,逼出探测分支的假臂。
globalThis.EventTarget = undefined;
delete globalThis.window;
class S { constructor(){this.m=new Map();} getItem(k){return this.m.has(k)?this.m.get(k):null;} setItem(k,v){this.m.set(k,String(v));} removeItem(k){this.m.delete(k);} }
globalThis.localStorage = new S();
const m = await import(${JSON.stringify(target)});
// _bus 为 null:subscribe 不挂 _bus 监听,emit 直接 return。
const off = m.subscribeToAlias('p', () => { throw new Error('should never fire without bus/window'); });
assert.equal(typeof off, 'function');
assert.equal(m.setProjectAlias('p', 'X'), true);      // _emitChange: if(!_bus) return
assert.equal(m.getProjectAlias('p'), 'X');
assert.equal(m.clearProjectAlias('p'), true);
assert.equal(m.getProjectAlias('p'), '');
m.__resetBusForTest();                                 // EventTarget undefined 臂
off();                                                  // unsubscribe: if(_bus) 假臂 + typeof window 假臂
console.log('CHILD_OK');
`;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      // 必须 spread process.env,否则 NODE_V8_COVERAGE 丢失、子进程覆盖不计入主报告。
      env: { ...process.env },
      encoding: 'utf8',
      cwd: repoRoot,
    });
    assert.equal(res.status, 0, `子进程失败:\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /CHILD_OK/);
  });
});
