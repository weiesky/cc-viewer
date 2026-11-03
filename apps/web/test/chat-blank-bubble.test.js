/**
 * chat-blank-bubble.test.js — blank-whitespace text must not render an empty
 * `chat-boxer` bubble.
 *
 * Root cause (SubAgent 空白气泡交接, 2026-11-03): a text block like '   ' or
 * '\n\n' is truthy, so both shared render paths in ChatMessage.jsx passed the
 * `if (tb.text)` / `if (!block.text)` guards, yet renderAssistantText parses it
 * to zero segments. The wrapper <div className="chat-boxer"> was pushed
 * unconditionally, and .chat-boxer has background/border/padding even with no
 * children → a visible empty bubble. Main messages hide it because ChatView
 * pre-filters blank text via isSystemText; SubAgent/Teammate respContent is
 * passed through unfiltered, so the blank bubble surfaced there.
 *
 * Fix (shared render layer, not the data entry): in BOTH paths, skip when
 * renderAssistantText yields zero segments, before creating the chat-boxer.
 *
 * These tests assert the behavior contract (blank → empty segments) AND the
 * source contract (the zero-segment guard sits before chat-boxer creation in
 * both the legacy and the in-order path). JSX is not executed in node:test, so
 * the render-layer assertions use the repo's source-slice contract style (see
 * chat-ghost-clamp.test.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderAssistantText } from '../src/utils/systemTags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_MESSAGE = join(__dirname, '..', 'src', 'components', 'chat', 'ChatMessage.jsx');
const src = readFileSync(CHAT_MESSAGE, 'utf-8');

/** Extract a window of source starting at a method's definition (not a call site). */
function methodBody(name, span = 6000) {
  // Anchor on the definition form `name(args) {` — a call site has no trailing '{'.
  const re = new RegExp(`\\n  ${name}\\s*\\(`, 'g');
  let m;
  let start = -1;
  while ((m = re.exec(src)) !== null) {
    const afterParen = src.indexOf(')', re.lastIndex);
    if (afterParen !== -1 && src.slice(afterParen + 1).trimStart().startsWith('{')) { start = m.index + 1; break; }
  }
  assert.ok(start !== -1, `method ${name} definition must exist`);
  return src.slice(start, start + span);
}

describe('renderAssistantText: blank input parses to zero segments (the guard condition)', () => {
  it('whitespace-only text yields { segments: [] }', () => {
    for (const blank of ['   ', '\n\n', ' \n ', '\t \t', '\n \n']) {
      assert.deepEqual(renderAssistantText(blank).segments, [], JSON.stringify(blank));
    }
  });

  it('normal text still yields a text segment (guard must not over-delete)', () => {
    const r = renderAssistantText('hello');
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].type, 'text');
  });

  it('a legal empty system-tag still yields a system-tag segment (not over-deleted)', () => {
    const r = renderAssistantText('<task-notification></task-notification>');
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].type, 'system-tag');
  });
});

describe('ChatMessage: zero-segment guard precedes chat-boxer creation in BOTH paths', () => {
  it('legacy path (_renderAssistantContentLegacy) guards segments before chat-boxer', () => {
    const body = methodBody('_renderAssistantContentLegacy');
    const textLoop = body.indexOf('textBlocks.forEach');
    assert.ok(textLoop !== -1, 'legacy textBlocks loop must exist');
    const segIdx = body.indexOf('renderAssistantText(tb.text)', textLoop);
    const guardIdx = body.indexOf('segments.length === 0', textLoop);
    const boxerIdx = body.indexOf('className="chat-boxer"', textLoop);
    assert.ok(segIdx !== -1, 'renderAssistantText called on tb.text');
    assert.ok(guardIdx !== -1, 'zero-segment guard present in legacy path');
    assert.ok(boxerIdx !== -1, 'chat-boxer still rendered for non-empty text');
    assert.ok(segIdx < guardIdx && guardIdx < boxerIdx,
      'guard must sit between renderAssistantText and chat-boxer creation');
  });

  it('in-order path (_renderAssistantContentInOrder) guards segments before chat-boxer', () => {
    const body = methodBody('_renderAssistantContentInOrder');
    const textBranch = body.indexOf("if (block.type === 'text')");
    assert.ok(textBranch !== -1, 'in-order text branch must exist');
    const segIdx = body.indexOf('renderAssistantText(block.text)', textBranch);
    const guardIdx = body.indexOf('segments.length === 0', textBranch);
    const boxerIdx = body.indexOf('className="chat-boxer"', textBranch);
    assert.ok(segIdx !== -1, 'renderAssistantText called on block.text');
    assert.ok(guardIdx !== -1, 'zero-segment guard present in in-order path');
    assert.ok(boxerIdx !== -1, 'chat-boxer still rendered for non-empty text');
    assert.ok(segIdx < guardIdx && guardIdx < boxerIdx,
      'guard must sit between renderAssistantText and chat-boxer creation');
  });

  it('both guards skip without rendering (return in forEach, continue in for-loop)', () => {
    const legacy = methodBody('_renderAssistantContentLegacy');
    assert.match(legacy, /segments\.length === 0\) return;/, 'legacy forEach guard returns early');
    const inOrder = methodBody('_renderAssistantContentInOrder');
    assert.match(inOrder, /segments\.length === 0\) continue;/, 'in-order loop guard continues');
  });
});
