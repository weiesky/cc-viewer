import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeThinkingBlocks } from '../src/utils/thinkingMerge.js';

const SEP = '\n\n---\n\n';
const thinking = (t) => ({ type: 'thinking', thinking: t });
const text = (t) => ({ type: 'text', text: t });
const tool_use = (id, name = 'Read') => ({ type: 'tool_use', id, name, input: {} });

describe('mergeThinkingBlocks', () => {
  it('joins multiple non-empty thinking blocks with the --- separator', () => {
    const c = [thinking('first'), tool_use('t1'), thinking('second'), tool_use('t2'), thinking('third')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 3);
    assert.equal(isEmpty, false);
    assert.equal(out, `first${SEP}second${SEP}third`);
    // 恰好 (count-1) 个分隔符
    assert.equal(out.split(SEP).length - 1, 2);
  });

  it('uses blank lines around the rule so marked emits <hr>, not a setext H2', () => {
    const { text: out } = mergeThinkingBlocks([thinking('a'), thinking('b')]);
    assert.ok(out.includes('\n\n---\n\n'));
    // 不存在 `段落\n---`（无空行）这种会被解析成 setext H2 的形态
    assert.ok(!/[^\n]\n---/.test(out));
  });

  it('single block → equals that text, no separator', () => {
    const c = [thinking('only one'), tool_use('t1')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 1);
    assert.equal(isEmpty, false);
    assert.equal(out, 'only one');
    assert.equal(out.includes('---'), false);
  });

  it('trims each segment before joining', () => {
    const { text: out } = mergeThinkingBlocks([thinking('  a  '), thinking('\n b \n')]);
    assert.equal(out, `a${SEP}b`);
  });

  it('all-empty / whitespace blocks → isEmpty true, text empty, count counts them', () => {
    const c = [thinking(''), thinking('   '), thinking('\n')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 3);
    assert.equal(isEmpty, true);
    assert.equal(out, '');
  });

  it('mixed empty + non-empty → only non-empty joined, isEmpty false', () => {
    const c = [thinking(''), thinking('real'), thinking('   '), thinking('also real')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 4);
    assert.equal(isEmpty, false);
    assert.equal(out, `real${SEP}also real`);
    assert.equal(out.split(SEP).length - 1, 1);
  });

  it('drops a segment that is exactly "---" (matches web-search merge precedent)', () => {
    const c = [thinking('alpha'), thinking('---'), thinking('beta')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 3);
    assert.equal(isEmpty, false);
    assert.equal(out, `alpha${SEP}beta`);
  });

  it('no thinking blocks → count 0, isEmpty true, text empty', () => {
    const c = [text('hello'), tool_use('t1'), text('world')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 0);
    assert.equal(isEmpty, true);
    assert.equal(out, '');
  });

  it('empty content array → safe defaults', () => {
    const { text: out, isEmpty, count } = mergeThinkingBlocks([]);
    assert.equal(count, 0);
    assert.equal(isEmpty, true);
    assert.equal(out, '');
  });

  it('non-array input → safe defaults', () => {
    for (const bad of [null, undefined, 'thinking', 42, {}, { type: 'thinking' }]) {
      const { text: out, isEmpty, count } = mergeThinkingBlocks(bad);
      assert.equal(count, 0, `count for ${JSON.stringify(bad)}`);
      assert.equal(isEmpty, true);
      assert.equal(out, '');
    }
  });

  it('preserves order and ignores malformed blocks; non-string thinking treated as empty', () => {
    const c = [null, { type: 'thinking', thinking: 123 }, text('x'), thinking('ok'), thinking('then')];
    const { text: out, isEmpty, count } = mergeThinkingBlocks(c);
    assert.equal(count, 3);                  // 三个 type==='thinking' 的块（含 thinking:123）
    assert.equal(isEmpty, false);
    assert.equal(out, `ok${SEP}then`);       // 非字符串 thinking → '' → 丢弃
  });
});
