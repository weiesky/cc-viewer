import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHAT_VIEW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/components/chat/ChatView.jsx'), 'utf8');

describe('ChatView system-open project scope', () => {
  it('passes the current project and instance from every file-open call', () => {
    const calls = [...CHAT_VIEW.matchAll(/tryOpenWithSystem\([^;]+/g)].map((match) => match[0]);
    assert.equal(calls.length, 6, 'review all ChatView system-open callers when adding another one');
    for (const call of calls) {
      assert.ok(call.includes('project: this.props.viewProject || this.props.projectName'), call);
      assert.ok(call.includes('instance: this.props.viewInstance'), call);
    }
  });
});
