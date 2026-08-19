import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeV2Entries } from '../packages/app/server/lib/v2-transcript-normalizer.js';
import { buildSingleToolResultCore } from '../apps/web/src/utils/toolResultCore.js';

// ============================================================================
// End-to-end: v2 transcript row → normalized messages → toolResultCore image
// extraction. toolResultCore is a pure-JS module (no vite deps), so it can be
// imported statically — the same convention as test/compact-result-preview.test.js.
// ============================================================================

let uuidSeq = 0;
function makeToolResultRow({ toolUseId = 'tu-1', content, sessionId = 'sid-1', ts = '2026-07-30T03:43:40.000Z' }) {
  return {
    type: 'user',
    uuid: `uuid-${++uuidSeq}`,
    sessionId,
    timestamp: ts,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
  };
}

describe('v2 → toolResult 图片提取', () => {
  it('base64 image 块 → dataURL src', () => {
    const row = makeToolResultRow({
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
    });
    const entry = normalizeV2Entries([row])[0];
    const block = entry.body.messages[0].content[0];
    const result = buildSingleToolResultCore(block, null);
    assert.deepEqual(result.images, [{ src: 'data:image/png;base64,AAAA', mediaType: 'image/png' }]);
  });

  it('text + image 混合 → text 与 images 都保留', () => {
    const row = makeToolResultRow({
      content: [
        { type: 'text', text: 'result text' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } },
      ],
    });
    const entry = normalizeV2Entries([row])[0];
    const block = entry.body.messages[0].content[0];
    const result = buildSingleToolResultCore(block, null);
    assert.equal(result.resultText, 'result text');
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].src, 'data:image/jpeg;base64,BBBB');
  });

  it('2MB 超限 base64 → oversized 占位降级', () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    const row = makeToolResultRow({
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } }],
    });
    const entry = normalizeV2Entries([row])[0];
    const block = entry.body.messages[0].content[0];
    const result = buildSingleToolResultCore(block, null);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].oversized, true);
    assert.equal(result.images[0].mediaType, 'image/png');
    assert.equal('src' in result.images[0], false);
  });

  it('白名单外 MIME → 跳过', () => {
    const row = makeToolResultRow({
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'AAAA' } }],
    });
    const entry = normalizeV2Entries([row])[0];
    const block = entry.body.messages[0].content[0];
    const result = buildSingleToolResultCore(block, null);
    assert.deepEqual(result.images, []);
  });

  it('url source → 直接使用', () => {
    const row = makeToolResultRow({
      content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } }],
    });
    const entry = normalizeV2Entries([row])[0];
    const block = entry.body.messages[0].content[0];
    const result = buildSingleToolResultCore(block, null);
    assert.deepEqual(result.images, [{ src: 'https://example.com/x.png', mediaType: 'image/url' }]);
  });
});
