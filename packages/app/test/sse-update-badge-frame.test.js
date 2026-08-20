import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sseUpdateBadgeFrame } from '../server/routes/events.js';

// sseUpdateBadgeFrame 给新连接的 SSE 客户端补推「有新版」徽标事件，使版本徽标跨刷新持续显示。
describe('sseUpdateBadgeFrame', () => {
  it('truthy pending → 合法 SSE 帧：event 行 + data(JSON) + 以空行收尾', () => {
    const pending = { version: '9.9.9', source: 'major_available' };
    const frame = sseUpdateBadgeFrame(pending);
    assert.ok(frame, 'should return a frame');
    assert.ok(frame.startsWith('event: update_major_available\n'), 'starts with event line');
    assert.ok(frame.endsWith('\n\n'), 'terminated by blank line');

    const m = frame.match(/^data: (.+)\n\n$/m);
    assert.ok(m, 'has a data line');
    assert.deepEqual(JSON.parse(m[1]), pending, 'data is the JSON-encoded pending object');
  });

  it('保留 source 字段（deferred_busy / brew_managed 也走同一帧）', () => {
    const frame = sseUpdateBadgeFrame({ version: '2.0.0', source: 'brew_managed' });
    const m = frame.match(/^data: (.+)\n\n$/m);
    assert.equal(JSON.parse(m[1]).source, 'brew_managed');
  });

  it('falsy pending → null（无缓存时不补推）', () => {
    assert.equal(sseUpdateBadgeFrame(null), null);
    assert.equal(sseUpdateBadgeFrame(undefined), null);
    assert.equal(sseUpdateBadgeFrame(0), null);
    assert.equal(sseUpdateBadgeFrame(''), null);
  });
});
