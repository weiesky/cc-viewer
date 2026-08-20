import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// interceptor.js 在 import 时会按 argv/env 决定是否 setupInterceptor()（patch 全局 fetch + resume）。
// 单测只验证 IM 逐字累加器的纯逻辑，故 CCV_PROXY_MODE=1 抑制这些副作用（见 interceptor.js 末尾两处
// `!process.env.CCV_PROXY_MODE` 守卫），CCV_LOG_DIR 重定向到临时目录隔离任何落盘。
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_LOG_DIR = mkdtempSync(join(tmpdir(), 'ccv-imlive-'));

const { imTextDeltaOf, getImLiveText, resetImLiveText } = await import('../server/interceptor.js');

describe('imTextDeltaOf — 只认可见正文 text_delta', () => {
  it('returns the text for a text_delta event', () => {
    assert.equal(imTextDeltaOf({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } }), 'hello');
  });
  it('skips thinking_delta (推理块不计入逐字正文)', () => {
    assert.equal(imTextDeltaOf({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'reasoning…' } }), null);
  });
  it('skips input_json_delta / signature_delta / non-delta events', () => {
    assert.equal(imTextDeltaOf({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } }), null);
    assert.equal(imTextDeltaOf({ type: 'content_block_delta', delta: { type: 'signature_delta', signature: 'x' } }), null);
    assert.equal(imTextDeltaOf({ type: 'content_block_start', content_block: { type: 'text' } }), null);
    assert.equal(imTextDeltaOf({ type: 'message_stop' }), null);
  });
  it('is null-safe for malformed events', () => {
    assert.equal(imTextDeltaOf(null), null);
    assert.equal(imTextDeltaOf({}), null);
    assert.equal(imTextDeltaOf({ type: 'content_block_delta' }), null);
    assert.equal(imTextDeltaOf({ type: 'content_block_delta', delta: { type: 'text_delta', text: 42 } }), null);
  });
});

describe('getImLiveText / resetImLiveText', () => {
  beforeEach(() => resetImLiveText());
  it('starts empty and reset clears it', () => {
    assert.equal(getImLiveText(), '');
    resetImLiveText();
    assert.equal(getImLiveText(), '');
  });
  // 注：跨 API 调用的累计 + 分隔在 interceptor 的 SSE 代理循环内完成（依赖 imTextDeltaOf 的判定），
  // 此处覆盖判定规则与重置；端到端累计行为由 im-bridge-core 流式用例（注入假 getLiveText）守住。
});
