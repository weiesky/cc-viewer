/**
 * 单元测试 — src/utils/terminalClipboard.js
 *
 * 覆盖：
 *   - clipboardKeyAction：Ctrl+C/Ctrl+V 命中、修饰键/类型/平台/键位的各分支。
 *   - copyTextToClipboard：navigator.clipboard.writeText 优先路径、writeText 抛错回退、
 *     无 clipboard API 时走 document.execCommand 兜底，以及空串短路。
 *
 * terminalClipboard.js 顶层无 DOM 访问（navigator/document 只在函数体内用），故可直接 import。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clipboardKeyAction, copyTextToClipboard, planPasteSend } from '../src/utils/terminalClipboard.js';

const kd = (over = {}) => ({ type: 'keydown', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: '', code: '', ...over });

describe('clipboardKeyAction', () => {
  it('Ctrl+C（非 Mac）→ copy（key 与 code 两种来源都命中）', () => {
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'c' }), { isMac: false }), 'copy');
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, code: 'KeyC' }), { isMac: false }), 'copy');
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'C' }), { isMac: false }), 'copy'); // CapsLock 大写
  });

  it('Ctrl+V（非 Mac）→ paste', () => {
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'v' }), { isMac: false }), 'paste');
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, code: 'KeyV' }), { isMac: false }), 'paste');
  });

  it('Mac → 一律 null（Ctrl 维持终端原义，复制粘贴走 Cmd）', () => {
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'c' }), { isMac: true }), null);
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'v' }), { isMac: true }), null);
  });

  it('带 Shift/Alt/Meta → null（Ctrl+Shift+V 等不接管，交回原生）', () => {
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, shiftKey: true, key: 'v' }), { isMac: false }), null);
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, altKey: true, key: 'c' }), { isMac: false }), null);
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, metaKey: true, key: 'v' }), { isMac: false }), null);
  });

  it('无 Ctrl → null', () => {
    assert.equal(clipboardKeyAction(kd({ key: 'c' }), { isMac: false }), null);
    assert.equal(clipboardKeyAction(kd({ key: 'v' }), { isMac: false }), null);
  });

  it('非 keydown（keyup/keypress）→ null', () => {
    assert.equal(clipboardKeyAction(kd({ type: 'keyup', ctrlKey: true, key: 'v' }), { isMac: false }), null);
    assert.equal(clipboardKeyAction(kd({ type: 'keypress', ctrlKey: true, key: 'c' }), { isMac: false }), null);
  });

  it('其它键 / 空事件 → null', () => {
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'a' }), { isMac: false }), null);
    assert.equal(clipboardKeyAction(null, { isMac: false }), null);
    assert.equal(clipboardKeyAction(undefined), null);
  });

  it('默认 opts（不传 isMac）按非 Mac 处理', () => {
    assert.equal(clipboardKeyAction(kd({ ctrlKey: true, key: 'v' })), 'paste');
  });
});

describe('planPasteSend', () => {
  const WRAP = (s) => `\x1b[200~${s}\x1b[201~`;
  // 用可识别的 sanitize 以验证「确实经过消毒」：把注入序列替换为标记
  const sanitize = (s) => s.replace(/\x1b\[20[01]~/g, '<X>');

  it('空串 / 非字符串 → null', () => {
    assert.equal(planPasteSend('', { active: true }), null);
    assert.equal(planPasteSend(null, { active: true }), null);
    assert.equal(planPasteSend(undefined), null);
  });

  describe('原生路径 active=false', () => {
    it('bracketedPasteMode 且无注入 → null（交 xterm 自动包裹）', () => {
      assert.equal(planPasteSend('hi', { active: false, bracketedPasteMode: true, sanitize }), null);
      assert.equal(planPasteSend('line1\nline2', { active: false, bracketedPasteMode: true, sanitize }), null);
    });
    it('单行 + 无包裹模式 → null（交浏览器原生插入）', () => {
      assert.equal(planPasteSend('hello', { active: false, bracketedPasteMode: false, sanitize }), null);
    });
    it('多行 + 无包裹模式 → 包裹发送', () => {
      assert.equal(planPasteSend('a\nb', { active: false, bracketedPasteMode: false, sanitize }), WRAP('a\nb'));
      assert.equal(planPasteSend('a\rb', { active: false, sanitize }), WRAP('a\rb'));
    });
    it('含注入序列 → 即使开了 bracketedPasteMode 也接管 + 消毒', () => {
      const text = `x\x1b[201~rm -rf`;
      assert.equal(planPasteSend(text, { active: false, bracketedPasteMode: true, sanitize }), WRAP('x<X>rm -rf'));
    });
  });

  describe('主动路径 active=true', () => {
    it('bracketedPasteMode → 即便单行也自行包裹（无原生 paste 事件可依赖）', () => {
      assert.equal(planPasteSend('hi', { active: true, bracketedPasteMode: true, sanitize }), WRAP('hi'));
    });
    it('单行 + 无包裹模式 → 原样返回', () => {
      assert.equal(planPasteSend('hello', { active: true, bracketedPasteMode: false, sanitize }), 'hello');
    });
    it('多行 → 包裹', () => {
      assert.equal(planPasteSend('a\nb', { active: true, bracketedPasteMode: false, sanitize }), WRAP('a\nb'));
    });
    it('含注入序列 → 消毒后包裹', () => {
      assert.equal(planPasteSend(`p\x1b[200~q`, { active: true, sanitize }), WRAP('p<X>q'));
    });
  });

  it('默认 sanitize 为 identity（不传时不改动文本）', () => {
    assert.equal(planPasteSend('a\nb', { active: true }), WRAP('a\nb'));
  });
});

describe('copyTextToClipboard', () => {
  // Node 21+ 的 globalThis.navigator 是只读 getter，需用 defineProperty 覆盖；teardown 还原。
  let descNav, descDoc;
  const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  beforeEach(() => {
    descNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    descDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
  });
  afterEach(() => {
    if (descNav) Object.defineProperty(globalThis, 'navigator', descNav); else delete globalThis.navigator;
    if (descDoc) Object.defineProperty(globalThis, 'document', descDoc); else delete globalThis.document;
  });

  it('空串 / 非字符串 → false 且不调用任何剪贴板 API', async () => {
    let called = false;
    setGlobal('navigator', { clipboard: { writeText: async () => { called = true; } } });
    assert.equal(await copyTextToClipboard(''), false);
    assert.equal(await copyTextToClipboard(null), false);
    assert.equal(await copyTextToClipboard(123), false);
    assert.equal(called, false);
  });

  it('安全上下文：调用 navigator.clipboard.writeText 并返回 true', async () => {
    let got = null;
    setGlobal('navigator', { clipboard: { writeText: async (t) => { got = t; } } });
    assert.equal(await copyTextToClipboard('hello'), true);
    assert.equal(got, 'hello');
  });

  it('writeText 抛错 → 回退 execCommand 兜底', async () => {
    let execArg = null;
    setGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
    setGlobal('document', makeFakeDocument((cmd) => { execArg = cmd; return true; }));
    assert.equal(await copyTextToClipboard('fallback-me'), true);
    assert.equal(execArg, 'copy');
  });

  it('无 clipboard API → 直接走 execCommand 兜底，并还原原焦点', async () => {
    setGlobal('navigator', {});
    let restored = false;
    const prev = { focus: () => { restored = true; } };
    setGlobal('document', makeFakeDocument(() => true, prev));
    assert.equal(await copyTextToClipboard('x'), true);
    assert.equal(restored, true);
  });

  it('execCommand 返回 false → 整体 false', async () => {
    setGlobal('navigator', {});
    setGlobal('document', makeFakeDocument(() => false));
    assert.equal(await copyTextToClipboard('x'), false);
  });

  it('execCommand 抛错 → 被 catch，整体 false（不向上抛）', async () => {
    setGlobal('navigator', {});
    setGlobal('document', makeFakeDocument(() => { throw new Error('boom'); }));
    assert.equal(await copyTextToClipboard('x'), false);
  });

  it('无 document.body（SSR / 无 body）→ 整体 false 且不创建元素', async () => {
    setGlobal('navigator', {});
    let created = false;
    setGlobal('document', { activeElement: null, createElement: () => { created = true; return {}; } });
    assert.equal(await copyTextToClipboard('x'), false);
    assert.equal(created, false);
  });
});

// 最小 document 桩：支持 createElement('textarea')/body.appendChild/removeChild/execCommand/activeElement。
function makeFakeDocument(execImpl, activeElement = null) {
  const appended = [];
  return {
    activeElement,
    body: {
      appendChild: (el) => { appended.push(el); },
      removeChild: (el) => { const i = appended.indexOf(el); if (i >= 0) appended.splice(i, 1); },
    },
    createElement: () => ({
      value: '',
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
    }),
    execCommand: (cmd) => execImpl(cmd),
  };
}
