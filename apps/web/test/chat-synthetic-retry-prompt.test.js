/**
 * chat-synthetic-retry-prompt.test.js — the `[cc-viewer:retry] ...` continue instruction
 * is session history the model reads, NOT a user chat bubble: renderSessionMessages must
 * skip it in BOTH the user-text-block branch and the string-content branch, via the
 * shared isCcvRetryPrompt util. Transcript/request-panel views keep it (chat-bubble-only
 * hiding).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsx = readFileSync(join(root, 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');
const markers = readFileSync(join(root, 'src', 'utils', 'ccvMarkers.js'), 'utf-8');
const { isCcvRetryPrompt } = await import(join(root, 'src', 'utils', 'ccvMarkers.js'));

describe('synthetic [cc-viewer:retry] prompt hiding', () => {
  it('isCcvRetryPrompt matches the sentinel prefix (and trims leading whitespace)', () => {
    assert.equal(isCcvRetryPrompt('[cc-viewer:retry] The previous response was interrupted…'), true);
    assert.equal(isCcvRetryPrompt('  [cc-viewer:retry] …'), true);
    assert.equal(isCcvRetryPrompt('please continue'), false);
    assert.equal(isCcvRetryPrompt(null), false);
    assert.equal(isCcvRetryPrompt(undefined), false);
  });

  it('the util defines exactly the ccv sentinel the server emits', () => {
    assert.ok(markers.includes("'[cc-viewer:retry]'"), 'sentinel literal present');
  });

  it('ChatView skips the retry prompt in both the text-block and string-content branches', () => {
    const uses = jsx.match(/isCcvRetryPrompt\(/g) || [];
    assert.ok(uses.length >= 2, `isCcvRetryPrompt applied in both branches (${uses.length} sites)`);
    // Text-block branch skips before rendering the user bubble.
    assert.ok(jsx.includes('if (isCcvRetryPrompt(textBlocks[ti].text)) continue;'), 'text-block branch skips');
    // String-content branch gates the bubble render on NOT being a retry prompt.
    assert.ok(jsx.includes('!isCcvRetryPrompt(dispText)'), 'string-content branch skips');
  });
});
