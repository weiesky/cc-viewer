// 行为测试：ScrollHighlightController（从 ChatView 抽出的「滚动即褪色」控制器）。
// 用 fake 容器 + node:test mock.timers 覆盖 bind→延迟绑定→scroll 触发→dispose 解绑。

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ScrollHighlightController } from '../src/components/chat/controllers/scrollHighlightController.js';

function makeContainer() {
  const handlers = new Map();
  return {
    _handlers: handlers,
    addEventListener: (ev, fn) => { handlers.set(ev, fn); },
    removeEventListener: (ev, fn) => { if (handlers.get(ev) === fn) handlers.delete(ev); },
    fireScroll: () => { const fn = handlers.get('scroll'); if (fn) fn(); },
  };
}

function makeHost({ container } = {}) {
  const states = [];
  return {
    _states: states,
    getScrollContainer: () => container,
    setState: (u) => { states.push(u); },
  };
}

describe('ScrollHighlightController', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('bind 延迟 500ms 后才绑定 scroll 监听', () => {
    const container = makeContainer();
    const c = new ScrollHighlightController(makeHost({ container }));
    c.bind();
    assert.equal(container._handlers.has('scroll'), false, '延迟期未绑定');
    mock.timers.tick(500);
    assert.equal(container._handlers.has('scroll'), true, '500ms 后已绑定');
  });

  it('scroll 触发 → setState(highlightFading:true) + 立即解绑（一次性）', () => {
    const container = makeContainer();
    const host = makeHost({ container });
    const c = new ScrollHighlightController(host);
    c.bind();
    mock.timers.tick(500);
    container.fireScroll();
    assert.deepEqual(host._states[0], { highlightFading: true });
    // _onScroll 末尾 dispose 解绑监听（一次性）
    assert.equal(container._handlers.has('scroll'), false, 'scroll 后已解绑');
  });

  it('容器为 null 时不绑定、不报错', () => {
    const c = new ScrollHighlightController(makeHost({ container: null }));
    c.bind();
    mock.timers.tick(500);
    // 无异常即通过
    assert.ok(true);
  });

  it('dispose 幂等：重复调用安全', () => {
    const container = makeContainer();
    const c = new ScrollHighlightController(makeHost({ container }));
    c.bind();
    mock.timers.tick(500);
    c.dispose();
    c.dispose();
    assert.equal(container._handlers.has('scroll'), false);
  });

  it('bind 前置 dispose：重复 bind 不会重复堆叠监听', () => {
    const container = makeContainer();
    const c = new ScrollHighlightController(makeHost({ container }));
    c.bind();
    mock.timers.tick(500);
    c.bind(); // 应先 dispose 旧的再延迟绑新的
    assert.equal(container._handlers.has('scroll'), false, 'bind 开头 dispose 解绑了旧监听');
    mock.timers.tick(500);
    assert.equal(container._handlers.has('scroll'), true);
  });
});
