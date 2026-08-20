/**
 * Gap top-up for src/utils/promptClassifier.js
 *
 * test/permission-detect.test.js covers isPlanApprovalPrompt / pickPlanApproveOptionNumber /
 * isDangerousOperationPrompt (via an inlined copy), leaving parseToolInfoFromBuffer
 * (L82-112) entirely uncovered. This file imports the REAL module and drives every
 * branch of parseToolInfoFromBuffer:
 *   - Bash via buffer "Bash command" / "Run shell command" (cmd extracted vs. not)
 *   - Edit via "make this edit to <path>"
 *   - Write via "write this new file <path>" / "write to <path>" / bare /write/ fallback
 *   - Read via "read <path>" and via options "allow reading from <path>"
 *   - WebFetch (fetch/url) and WebSearch (search)
 *   - the final Tool fallback
 *
 * Module has clean imports — direct static import works.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolInfoFromBuffer } from '../src/utils/promptClassifier.js';

describe('parseToolInfoFromBuffer — Bash', () => {
  it('extracts the command from a "Bash command" block (4-space indented body)', () => {
    const buf = 'Bash command\n\n    npm run build\n';
    const r = parseToolInfoFromBuffer(buf, 'Run this?', []);
    assert.deepEqual(r, { toolName: 'Bash', input: { command: 'npm run build' } });
  });

  it('extracts a multi-line command and de-indents each line', () => {
    const buf = 'Run shell command\n\n    git add .\n    git commit -m x\n';
    const r = parseToolInfoFromBuffer(buf, 'Run?', []);
    assert.equal(r.toolName, 'Bash');
    assert.equal(r.input.command, 'git add .\ngit commit -m x');
  });

  it('falls back to {description} when the command body cannot be matched', () => {
    // "Bash command" present (triggers branch) but no indented body → cmd is null.
    const buf = 'Bash command without indented body here';
    const r = parseToolInfoFromBuffer(buf, 'Allow Bash?', []);
    assert.deepEqual(r, { toolName: 'Bash', input: { description: 'Allow Bash?' } });
  });
});

describe('parseToolInfoFromBuffer — Edit', () => {
  it('pulls file_path out of "make this edit to <path>"', () => {
    const r = parseToolInfoFromBuffer('', 'Do you want to make this edit to /src/app.js?', []);
    assert.deepEqual(r, { toolName: 'Edit', input: { file_path: '/src/app.js' } });
  });

  it('tolerates no trailing question mark', () => {
    const r = parseToolInfoFromBuffer('', 'Make this edit to /a/b.txt', []);
    assert.deepEqual(r, { toolName: 'Edit', input: { file_path: '/a/b.txt' } });
  });
});

describe('parseToolInfoFromBuffer — Write', () => {
  it('matches "write this new file <path>"', () => {
    const r = parseToolInfoFromBuffer('', 'Do you want to write this new file /tmp/new.txt?', []);
    assert.deepEqual(r, { toolName: 'Write', input: { file_path: '/tmp/new.txt' } });
  });

  it('matches "write to <path>"', () => {
    const r = parseToolInfoFromBuffer('', 'Write to /tmp/out.log?', []);
    assert.deepEqual(r, { toolName: 'Write', input: { file_path: '/tmp/out.log' } });
  });

  it('falls back to {description} when "write" appears but no path pattern matches', () => {
    const r = parseToolInfoFromBuffer('', 'May Claude overwrite something', []);
    // "write" matched by /write/i (inside overwrite) → Write fallback with description.
    assert.deepEqual(r, { toolName: 'Write', input: { description: 'May Claude overwrite something' } });
  });
});

describe('parseToolInfoFromBuffer — Read', () => {
  it('matches "read <path>" in the question', () => {
    const r = parseToolInfoFromBuffer('', 'Allow Claude to read /etc/hosts?', []);
    assert.deepEqual(r, { toolName: 'Read', input: { file_path: '/etc/hosts' } });
  });

  it('matches "allow reading from <path>" in the options (pins current non-greedy capture)', () => {
    // SUSPECTED BUG: the option regex /allow reading from\s+(.+?)(?:\s+from this project)?/
    // is non-greedy with an OPTIONAL trailing group, so (.+?) captures the minimum — a single
    // char ('/') — not the full path. Pinning current behavior; see notes.
    const r = parseToolInfoFromBuffer(
      '',
      'Grant permission?',
      [{ text: 'Allow reading from /var/data from this project' }],
    );
    assert.deepEqual(r, { toolName: 'Read', input: { file_path: '/' } });
  });
});

describe('parseToolInfoFromBuffer — Web tools', () => {
  it('routes "fetch" questions to WebFetch', () => {
    const r = parseToolInfoFromBuffer('', 'Allow Claude to fetch this resource?', []);
    assert.deepEqual(r, { toolName: 'WebFetch', input: { description: 'Allow Claude to fetch this resource?' } });
  });

  it('routes "url" questions to WebFetch', () => {
    const r = parseToolInfoFromBuffer('', 'Open this URL for me', []);
    assert.equal(r.toolName, 'WebFetch');
  });

  it('routes "search" questions to WebSearch', () => {
    const r = parseToolInfoFromBuffer('', 'Allow web search for cats?', []);
    assert.deepEqual(r, { toolName: 'WebSearch', input: { description: 'Allow web search for cats?' } });
  });
});

describe('parseToolInfoFromBuffer — fallback & empty inputs', () => {
  it('returns the generic Tool fallback when nothing matches', () => {
    const r = parseToolInfoFromBuffer('', 'Some unrelated prompt', []);
    assert.deepEqual(r, { toolName: 'Tool', input: { description: 'Some unrelated prompt' } });
  });

  it('tolerates undefined question and options', () => {
    const r = parseToolInfoFromBuffer('', undefined, undefined);
    assert.deepEqual(r, { toolName: 'Tool', input: { description: undefined } });
  });
});
