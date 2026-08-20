/**
 * 覆盖 src/utils/markdownProfiler.js 的 DEV=true 分支（既有两套测试只覆盖 DEV=false）：
 *   - line 91-92  : window.__mdStats = stats（模块顶层 DEV-true 副作用）
 *   - line 96-101 : measureParse 计时 + performance.measure('md-parse', ...)
 *   - line 106-110: recordMountSample 计时 + performance.measure('md-mount', ...)
 *   - maybeClearMarks 的 performance.clearMeasures 分支（每 500 次）
 *
 * 手法：node --test 下 import.meta.env 为 undefined，模块顶层 DEV 永远 falsy，
 * DEV-true 路径在浏览器 Vite dev 才进。用 Node 24 的 module.registerHooks 在
 * 加载该模块时把 `const DEV = <import.meta.env 表达式>;` 重写成 `const DEV = true;`，
 * 纯源码替换、不改磁盘文件、不 spawn 子进程、不引 jsdom；只为这一个 URL 生效。
 * 重写后 import 的实例与 DEV=false 的既有测试是不同 ESM 记录，互不污染。
 *
 * window：模块顶层 `typeof window !== 'undefined'` 需要全局 window。node 无 window，
 * 这里在注册 hook 后、import 前注入 globalThis.window = globalThis；用例结束删除。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = new URL('../src/utils/markdownProfiler.js', import.meta.url).href;

// 仅对目标模块做源码重写：把 `const DEV = <import.meta.env 表达式>;` 整体替换成 DEV=true。
// 关键：替换串与原串【等字节长度、等换行位置】（原串 102 字节、换行在 byte 46/67；
// 替换用行注释补到同样的 byte 46/67/末尾）。这样 V8 byte-offset 覆盖区间与磁盘源对齐，
// c8 跨进程按 URL 合并时不会因 offset 漂移而退化回未改写源（DEV=false）的覆盖。
const DEV_INIT_RE = /const DEV = [\s\S]*?=== true;/;
function lenPreservingDevTrue(matched) {
  // 在原 match 内按首/次换行的 byte 偏移切三段，每段填成等长行注释。
  const nl0 = matched.indexOf('\n');
  const nl1 = matched.indexOf('\n', nl0 + 1);
  const seg0 = 'const DEV = true; //'.padEnd(nl0, ' ');          // 第 0 行，至 nl0
  const seg1 = '//'.padEnd(nl1 - nl0 - 1, ' ');                  // 第 1 行
  const seg2 = '//'.padEnd(matched.length - nl1 - 1, ' ');       // 第 2 行
  return seg0 + '\n' + seg1 + '\n' + seg2;
}

let hookRegistered = false;
function installHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  registerHooks({
    load(url, context, nextLoad) {
      if (url === TARGET) {
        const src = readFileSync(fileURLToPath(url), 'utf-8');
        const out = src.replace(DEV_INIT_RE, lenPreservingDevTrue);
        return { format: 'module', shortCircuit: true, source: out };
      }
      return nextLoad(url, context);
    },
  });
}

let mod;
let hadWindow;
let prevWindow;

before(async () => {
  installHook();
  hadWindow = 'window' in globalThis;
  prevWindow = globalThis.window;
  globalThis.window = globalThis;           // 触发模块顶层 window.__mdStats 赋值
  delete globalThis.__mdStats;
  mod = await import('../src/utils/markdownProfiler.js');
});

after(() => {
  if (hadWindow) globalThis.window = prevWindow;
  else delete globalThis.window;
  delete globalThis.__mdStats;
});

describe('markdownProfiler DEV=true — 顶层副作用', () => {
  it('DEV_PROFILER_ENABLED 在重写后为 true', () => {
    assert.equal(mod.DEV_PROFILER_ENABLED, true);
  });

  it('window.__mdStats 被赋值为 stats 实例（含 summary/reset/samples）', () => {
    const s = globalThis.__mdStats;
    assert.ok(s, 'window.__mdStats 应被赋值');
    assert.equal(typeof s.summary, 'function');
    assert.equal(typeof s.reset, 'function');
    assert.ok(s.samples && Array.isArray(s.samples.parse) && Array.isArray(s.samples.mount));
  });
});

describe('measureParse DEV=true — 计时并记录 parse 样本', () => {
  it('返回回调结果并向 __mdStats 记录一条 parse 样本', () => {
    globalThis.__mdStats.reset();
    const out = mod.measureParse(() => 'PARSED');
    assert.equal(out, 'PARSED');
    const sum = globalThis.__mdStats.summary();
    assert.equal(sum.parseN, 1, 'parse 样本数应 +1');
  });

  it('回调抛错时异常仍向外冒泡（计时包裹在 try 外）', () => {
    assert.throws(() => mod.measureParse(() => { throw new Error('boom'); }), /boom/);
  });

  it('多次调用累加 parse 样本计数', () => {
    globalThis.__mdStats.reset();
    mod.measureParse(() => 1);
    mod.measureParse(() => 2);
    mod.measureParse(() => 3);
    assert.equal(globalThis.__mdStats.summary().parseN, 3);
  });
});

describe('recordMountSample DEV=true — 计时并记录 mount 样本', () => {
  it('有限非负数值入参记录一条 mount 样本', () => {
    globalThis.__mdStats.reset();
    mod.recordMountSample(5.5);
    const sum = globalThis.__mdStats.summary();
    assert.equal(sum.mountN, 1);
    assert.equal(sum.mountMax, 5.5);
  });

  it('负数 / NaN / 非有限值仍早退、不记录（DEV-true 也走 guard）', () => {
    globalThis.__mdStats.reset();
    mod.recordMountSample(-1);
    mod.recordMountSample(NaN);
    mod.recordMountSample(Infinity);
    mod.recordMountSample('5');     // 非数字
    assert.equal(globalThis.__mdStats.summary().mountN, 0);
  });

  it('ms=0 是合法样本（>= 0 边界）', () => {
    globalThis.__mdStats.reset();
    mod.recordMountSample(0);
    assert.equal(globalThis.__mdStats.summary().mountN, 1);
  });
});

describe('maybeClearMarks DEV=true — 每 500 次触发 clearMeasures', () => {
  it('累计 500 次 recordParse 后调用 performance.clearMeasures（不抛错）', () => {
    globalThis.__mdStats.reset();
    // 直接驱动 measureParse 500 次以跨过 CLEAR_MARKS_EVERY 阈值；
    // clearMeasures 存在与否都不应抛错（catch 兜底）。
    for (let i = 0; i < 500; i++) mod.measureParse(() => i);
    // 不抛即通过；样本数仍正确累计（受 MAX_SAMPLES=2000 上限内）。
    assert.equal(globalThis.__mdStats.summary().parseN, 500);
  });
});
