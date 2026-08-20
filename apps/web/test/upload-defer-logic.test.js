/**
 * uploadDeferLogic 纯函数单测:覆盖「图片上传未完成时按发送 → 缓发不漏图」机制里
 * 可判定的两块逻辑(shouldDeferSend / reduceUploading)。真正的 setState / URL.revokeObjectURL
 * 副作用由 ChatView 执行,这里只验算法结果。参考 single-ws-submit.test.js 的纯函数范式。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldDeferSend, reduceUploading } from '../src/components/chat/uploadDeferLogic.js';

describe('shouldDeferSend', () => {
  it('无上传在途 → 不缓发(走立即发送,等价旧行为)', () => {
    assert.equal(shouldDeferSend({ uploadingCount: 0 }), false);
  });

  it('有上传在途 → 缓发', () => {
    assert.equal(shouldDeferSend({ uploadingCount: 2 }), true);
  });

  it('只要在途就缓发,不被「已 deferred」短路(第二次 Enter 也必须 defer,否则会落到立即发送丢图)', () => {
    // 双发幂等由 _deferSend 的实例标志负责,不在本纯判定里;故 alreadyDeferred 不参与、传了也不影响。
    assert.equal(shouldDeferSend({ uploadingCount: 1 }), true);
    assert.equal(shouldDeferSend({ uploadingCount: 1, alreadyDeferred: true }), true);
  });
});

describe('reduceUploading', () => {
  it('add 两项 → remove 首项 → 仅剩第二项,并报告被移除项的 url 需 revoke', () => {
    let s = [];
    s = reduceUploading(s, { type: 'add', item: { id: 'a', name: 'a.png', previewUrl: 'blob:a' } }).next;
    s = reduceUploading(s, { type: 'add', item: { id: 'b', name: 'b.png', previewUrl: 'blob:b' } }).next;
    assert.equal(s.length, 2);

    const r = reduceUploading(s, { type: 'remove', id: 'a' });
    assert.deepEqual(r.next.map(i => i.id), ['b']);
    assert.deepEqual(r.revoke, ['blob:a']);
  });

  it('add 同 id 去重(不重复登记)', () => {
    let s = reduceUploading([], { type: 'add', item: { id: 'a', previewUrl: 'blob:a' } }).next;
    const r = reduceUploading(s, { type: 'add', item: { id: 'a', previewUrl: 'blob:a2' } });
    assert.equal(r.next.length, 1);
  });

  it('remove 不存在的 id → 数组不变、无 revoke', () => {
    const s = reduceUploading([], { type: 'add', item: { id: 'a', previewUrl: 'blob:a' } }).next;
    const r = reduceUploading(s, { type: 'remove', id: 'zzz' });
    assert.equal(r.next, s);
    assert.deepEqual(r.revoke, []);
  });

  it('无 previewUrl 的占位(拖拽 spinner-only)remove 时 revoke 为空', () => {
    const s = reduceUploading([], { type: 'add', item: { id: 'd', name: 'x' } }).next;
    const r = reduceUploading(s, { type: 'remove', id: 'd' });
    assert.deepEqual(r.next, []);
    assert.deepEqual(r.revoke, []);
  });

  it('clear → 清空并报告所有 previewUrl 需 revoke', () => {
    let s = [];
    s = reduceUploading(s, { type: 'add', item: { id: 'a', previewUrl: 'blob:a' } }).next;
    s = reduceUploading(s, { type: 'add', item: { id: 'b' } }).next; // 无 url
    s = reduceUploading(s, { type: 'add', item: { id: 'c', previewUrl: 'blob:c' } }).next;
    const r = reduceUploading(s, { type: 'clear' });
    assert.deepEqual(r.next, []);
    assert.deepEqual(r.revoke, ['blob:a', 'blob:c']);
  });
});
