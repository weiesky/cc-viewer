import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(dir, '..', 'src', 'components', 'chat', 'ChatView.jsx'), 'utf-8');

describe('queued prompt wire presentation', () => {
  it('reuses the shared exact-envelope parser for user-style rendering', () => {
    assert.ok(jsx.includes("from '@ccv/core/queued-prompt'"));
    assert.ok(jsx.includes('extractQueuedPromptWireMessage'));
    assert.ok(jsx.includes('queuedPromptDisplayText'));
    const branch = jsx.match(/const queuedPrompt = extractQueuedPromptWireMessage\(msg\);[\s\S]{0,1200}?continue;/);
    assert.ok(branch, 'the system branch has a dedicated queued-prompt path');
    assert.ok(branch[0].includes('role="user"'), 'the system wrapper is displayed as a user bubble');
    assert.ok(branch[0].includes('text={queuedPrompt.content}'), 'protocol wrapper is not shown as prompt text');
    assert.ok(!branch[0].includes('msg.content ='), 'raw message content is not rewritten');
    assert.ok(!branch[0].includes('msg.role ='), 'raw message role is not rewritten');
  });

  it('does not insert another user message into session.messages or the request body', () => {
    const branch = jsx.match(/const queuedPrompt = extractQueuedPromptWireMessage\(msg\);[\s\S]{0,1200}?continue;/)[0];
    assert.ok(!branch.includes('messages.push'), 'wire display must not create duplicate model/user entries');
    assert.ok(!branch.includes('body.messages'), 'wire body is untouched');
  });
});
