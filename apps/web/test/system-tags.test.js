import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// 覆盖目标: src/utils/systemTags.js (纯逻辑, 无 Vite 语法 -> 直接静态 import)
//   导出: SYSTEM_TAGS (数组) / parseSystemTags(text) / renderAssistantText(text)
//
//   parseSystemTags: 把 assistant/user 文本切成 {type:'text'} 与
//     {type:'system-tag', tag, content} 段, 仅识别白名单标签 (SYSTEM_TAGS),
//     每段 content/text 都 trim, 空段丢弃。
//   renderAssistantText: parseSystemTags 的 LRU 包装 (Map, 上限 512, FIFO 淘汰最旧键)。
// ============================================================================

import { SYSTEM_TAGS, parseSystemTags, renderAssistantText } from '../src/utils/systemTags.js';

describe('systemTags.SYSTEM_TAGS', () => {
  it('is a non-empty array of known tag names', () => {
    assert.ok(Array.isArray(SYSTEM_TAGS));
    assert.ok(SYSTEM_TAGS.length > 0);
    for (const t of ['system-reminder', 'command-name', 'task-notification', 'context', 'environment_details']) {
      assert.ok(SYSTEM_TAGS.includes(t), `expected ${t} in SYSTEM_TAGS`);
    }
  });
});

describe('systemTags.parseSystemTags', () => {
  it('empty / null / undefined -> { segments: [] }', () => {
    assert.deepEqual(parseSystemTags(''), { segments: [] });
    assert.deepEqual(parseSystemTags(null), { segments: [] });
    assert.deepEqual(parseSystemTags(undefined), { segments: [] });
  });

  it('plain text with no tags -> single trimmed text segment', () => {
    const r = parseSystemTags('  hello world  ');
    assert.deepEqual(r.segments, [{ type: 'text', content: 'hello world' }]);
  });

  it('single system tag -> one system-tag segment with trimmed inner content', () => {
    const r = parseSystemTags('<system-reminder>  be careful  </system-reminder>');
    assert.deepEqual(r.segments, [
      { type: 'system-tag', tag: 'system-reminder', content: 'be careful' },
    ]);
  });

  it('text before and after a tag becomes separate text segments', () => {
    const r = parseSystemTags('before <context>ctx body</context> after');
    assert.deepEqual(r.segments, [
      { type: 'text', content: 'before' },
      { type: 'system-tag', tag: 'context', content: 'ctx body' },
      { type: 'text', content: 'after' },
    ]);
  });

  it('drops whitespace-only gap between adjacent tags (no empty text segment)', () => {
    const r = parseSystemTags('<context>a</context>   <todo-reminder>b</todo-reminder>');
    assert.deepEqual(r.segments, [
      { type: 'system-tag', tag: 'context', content: 'a' },
      { type: 'system-tag', tag: 'todo-reminder', content: 'b' },
    ]);
  });

  it('captures tag with attributes ([^>]* in opening tag)', () => {
    const r = parseSystemTags('<command-name id="42" foo="bar">  /clear  </command-name>');
    assert.deepEqual(r.segments, [
      { type: 'system-tag', tag: 'command-name', content: '/clear' },
    ]);
  });

  it('multiline inner content preserved (after trim) via [\\s\\S] match', () => {
    const r = parseSystemTags('<context>line1\nline2\nline3</context>');
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].type, 'system-tag');
    assert.equal(r.segments[0].content, 'line1\nline2\nline3');
  });

  it('unknown tag is NOT treated as system-tag (stays in text)', () => {
    const r = parseSystemTags('text <not-a-system-tag>x</not-a-system-tag> more');
    // whole string has no whitelist tag -> single trimmed text segment
    assert.deepEqual(r.segments, [
      { type: 'text', content: 'text <not-a-system-tag>x</not-a-system-tag> more' },
    ]);
  });

  it('case-insensitive tag matching (i flag), tag name reported as captured', () => {
    const r = parseSystemTags('<SYSTEM-REMINDER>hi</SYSTEM-REMINDER>');
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].type, 'system-tag');
    assert.equal(r.segments[0].tag, 'SYSTEM-REMINDER'); // 原样回传匹配到的大小写
    assert.equal(r.segments[0].content, 'hi');
  });

  it('multiple distinct tags in sequence all captured', () => {
    const r = parseSystemTags(
      '<system-reminder>r</system-reminder><command-name>c</command-name><task-notification>t</task-notification>'
    );
    assert.deepEqual(r.segments.map(s => [s.type, s.tag]), [
      ['system-tag', 'system-reminder'],
      ['system-tag', 'command-name'],
      ['system-tag', 'task-notification'],
    ]);
  });

  it('trailing text after the last tag is emitted (lastIndex < length branch)', () => {
    const r = parseSystemTags('<context>c</context>tail text');
    assert.deepEqual(r.segments, [
      { type: 'system-tag', tag: 'context', content: 'c' },
      { type: 'text', content: 'tail text' },
    ]);
  });

  it('backreference \\1 enforces matching close tag — mismatched close not captured', () => {
    // 开 context, 闭 todo-reminder: 正则要求闭合标签名与开标签一致, 不匹配 -> 整段当 text
    const r = parseSystemTags('<context>body</todo-reminder>');
    assert.deepEqual(r.segments, [
      { type: 'text', content: '<context>body</todo-reminder>' },
    ]);
  });

  it('whitespace-only inner content -> system-tag with empty content (segment still emitted)', () => {
    const r = parseSystemTags('<context>   </context>');
    assert.deepEqual(r.segments, [
      { type: 'system-tag', tag: 'context', content: '' },
    ]);
  });
});

describe('systemTags.renderAssistantText', () => {
  it('empty / falsy input short-circuits to { segments: [] }', () => {
    assert.deepEqual(renderAssistantText(''), { segments: [] });
    assert.deepEqual(renderAssistantText(null), { segments: [] });
    assert.deepEqual(renderAssistantText(undefined), { segments: [] });
  });

  it('produces same structure as parseSystemTags for the same input', () => {
    const text = 'pre <system-reminder>note</system-reminder> post';
    assert.deepEqual(renderAssistantText(text), parseSystemTags(text));
  });

  it('returns the cached (identical) object reference on repeated calls (cache hit)', () => {
    const text = '<context>cached body</context> tail-' + Math.random();
    const first = renderAssistantText(text);
    const second = renderAssistantText(text);
    assert.strictEqual(first, second); // 同一引用 -> 命中缓存
    assert.equal(first.segments[0].content, 'cached body');
  });

  it('distinct inputs get distinct results', () => {
    const a = renderAssistantText('<context>A</context> a-' + Math.random());
    const b = renderAssistantText('<context>B</context> b-' + Math.random());
    assert.notStrictEqual(a, b);
    assert.equal(a.segments[0].content, 'A');
    assert.equal(b.segments[0].content, 'B');
  });

  it('cache survives FIFO eviction past the 512 cap (oldest key dropped, still correct output)', () => {
    // 写满超过 512 个不同 key, 触发 _tagCache.delete(oldest); 不应崩溃, 结果仍正确。
    const probe = 'probe-key-' + Math.random();
    const probeOut = renderAssistantText('<context>probe</context> ' + probe);
    assert.equal(probeOut.segments[0].content, 'probe');

    for (let i = 0; i < 600; i++) {
      renderAssistantText('<context>v' + i + '</context> filler-' + i);
    }

    // probe 早已被淘汰: 重新计算应得到一个新引用, 但内容仍正确
    const probeAgain = renderAssistantText('<context>probe</context> ' + probe);
    assert.equal(probeAgain.segments[0].content, 'probe');
    assert.notStrictEqual(probeOut, probeAgain);
  });
});
