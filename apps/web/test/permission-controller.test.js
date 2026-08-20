// 行为测试：PermissionController（从 ChatView 抽出的权限审批队列）。
// fake host + mock ws 覆盖 hook/PTY 双路决策、出队、PTY 选项号匹配。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionController } from '../src/components/chat/controllers/permissionController.js';

// node:test 环境可能没有全局 WebSocket；控制器只用到 WebSocket.OPEN 常量。
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = { OPEN: 1 };

function makeHost({ pendingPermission = null, permissionQueue = [], wsOpen = true } = {}) {
  const state = { pendingPermission, permissionQueue };
  const sent = [];        // ws.send 捕获
  const ptyClicks = [];   // promptOptionClick 捕获
  const host = {
    _state: state,
    _sent: sent,
    _ptyClicks: ptyClicks,
    getState: () => state,
    setState: (u) => {
      const partial = typeof u === 'function' ? u(state) : u;
      if (partial) Object.assign(state, partial);
    },
    ws: () => (wsOpen
      ? { readyState: 1, send: (s) => sent.push(JSON.parse(s)) }
      : { readyState: 3, send: () => {} }),
    promptOptionClick: (n) => ptyClicks.push(n),
  };
  return host;
}

const ptyPrompt = {
  options: [
    { number: 1, text: 'Yes' },
    { number: 2, text: 'Yes, allow for this session' },
    { number: 3, text: 'No, keep editing' },
  ],
};

describe('PermissionController — hook 路径', () => {
  it('allow 发 perm-hook-answer decision=allow 并出队', () => {
    const host = makeHost({ pendingPermission: { id: 'p1' }, permissionQueue: [{ id: 'p2' }] });
    const c = new PermissionController(host);
    c.allow('p1');
    assert.deepEqual(host._sent[0], { type: 'perm-hook-answer', id: 'p1', decision: 'allow' });
    assert.equal(host._state.pendingPermission.id, 'p2');
    assert.deepEqual(host._state.permissionQueue, []);
  });

  it('allowSession 带 allowSession:true', () => {
    const host = makeHost({ pendingPermission: { id: 'p1' } });
    const c = new PermissionController(host);
    c.allowSession('p1');
    assert.deepEqual(host._sent[0], { type: 'perm-hook-answer', id: 'p1', decision: 'allow', allowSession: true });
    assert.equal(host._state.pendingPermission, null);
  });

  it('deny 发 decision=deny', () => {
    const host = makeHost({ pendingPermission: { id: 'p1' } });
    const c = new PermissionController(host);
    c.deny('p1');
    assert.deepEqual(host._sent[0], { type: 'perm-hook-answer', id: 'p1', decision: 'deny' });
  });

  it('ws 关闭时不发送但仍出队', () => {
    const host = makeHost({ pendingPermission: { id: 'p1' }, permissionQueue: [{ id: 'p2' }], wsOpen: false });
    const c = new PermissionController(host);
    c.allow('p1');
    assert.equal(host._sent.length, 0);
    assert.equal(host._state.pendingPermission.id, 'p2');
  });
});

describe('PermissionController — PTY 路径', () => {
  it('PTY source: allow 走 promptOptionClick 而非 ws，并出队', () => {
    const host = makeHost({ pendingPermission: { id: 'p1', source: 'pty', ptyPrompt }, permissionQueue: [] });
    const c = new PermissionController(host);
    c.allow('p1');
    assert.equal(host._sent.length, 0, 'PTY 路径不发 ws');
    assert.deepEqual(host._ptyClicks, [1], 'allow → Yes 选项 1');
    assert.equal(host._state.pendingPermission, null);
  });

  it('PTY source: allowSession 命中含 session 的选项', () => {
    const host = makeHost({ pendingPermission: { id: 'p1', source: 'pty', ptyPrompt } });
    const c = new PermissionController(host);
    c.allowSession('p1');
    assert.deepEqual(host._ptyClicks, [2]);
  });

  it('PTY source: deny 命中 No 选项', () => {
    const host = makeHost({ pendingPermission: { id: 'p1', source: 'pty', ptyPrompt } });
    const c = new PermissionController(host);
    c.deny('p1');
    assert.deepEqual(host._ptyClicks, [3]);
  });
});

describe('PermissionController — autoAllow（免审批源头直放）', () => {
  it('hook 路径：发 perm-hook-answer allow，返回 true，且不动 pendingPermission/queue', () => {
    const host = makeHost({ pendingPermission: null, permissionQueue: [{ id: 'q1' }] });
    const c = new PermissionController(host);
    const ok = c.autoAllow({ id: 'h1' });
    assert.equal(ok, true, 'ws 开通已发送 → 返回 true');
    assert.deepEqual(host._sent[0], { type: 'perm-hook-answer', id: 'h1', decision: 'allow' });
    // 关键不变量：不入队、不出队、不设 pendingPermission（故调用方不会弹面板）
    assert.equal(host._state.pendingPermission, null);
    assert.deepEqual(host._state.permissionQueue.map(p => p.id), ['q1']);
  });

  it('PTY 路径：走 promptOptionClick(Yes=1)，返回 true，不发 ws，不动 state', () => {
    const host = makeHost({ pendingPermission: null });
    const c = new PermissionController(host);
    const ok = c.autoAllow({ source: 'pty', ptyPrompt });
    assert.equal(ok, true);
    assert.equal(host._sent.length, 0, 'PTY 路径不发 ws');
    assert.deepEqual(host._ptyClicks, [1], 'allow → Yes 选项 1');
    assert.equal(host._state.pendingPermission, null);
  });

  it('hook 路径 ws 关闭：返回 false 且不发送（让调用方回落到面板路径）', () => {
    const host = makeHost({ wsOpen: false });
    const c = new PermissionController(host);
    let ok;
    assert.doesNotThrow(() => { ok = c.autoAllow({ id: 'h1' }); });
    assert.equal(ok, false, 'ws 未连通 → 返回 false');
    assert.equal(host._sent.length, 0);
  });
});

describe('PermissionController — _findPtyOptionNumber 兜底', () => {
  it('无匹配选项时各 decision 的兜底号', () => {
    const c = new PermissionController(makeHost());
    const empty = { options: [] };
    assert.equal(c._findPtyOptionNumber(empty, 'allow'), 1);
    assert.equal(c._findPtyOptionNumber(empty, 'allowSession'), 2);
    assert.equal(c._findPtyOptionNumber(empty, 'deny'), 0); // options.length=0
    const three = { options: [{ number: 1, text: 'A' }, { number: 2, text: 'B' }, { number: 3, text: 'C' }] };
    assert.equal(c._findPtyOptionNumber(three, 'deny'), three.options.length);
  });
});

describe('PermissionController — shiftQueue', () => {
  it('出队：head 取 queue[0]，queue 去头', () => {
    const host = makeHost({ pendingPermission: { id: 'x' }, permissionQueue: [{ id: 'a' }, { id: 'b' }] });
    const c = new PermissionController(host);
    c.shiftQueue();
    assert.equal(host._state.pendingPermission.id, 'a');
    assert.deepEqual(host._state.permissionQueue.map(p => p.id), ['b']);
  });

  it('队列空时 head 置 null', () => {
    const host = makeHost({ pendingPermission: { id: 'x' }, permissionQueue: [] });
    const c = new PermissionController(host);
    c.shiftQueue();
    assert.equal(host._state.pendingPermission, null);
  });
});
