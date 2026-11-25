/**
 * tool-summary.test.js — unit tests for utils/toolSummary.js (the per-tool
 * pill summary registry) plus source-contract assertions for the collapsed
 * tool pill change (inline `Name: summary`, label removal, ellipsis CSS).
 *
 * Source-string contract style follows minimal-chat-wiring.test.js: render-level
 * tests cannot run under node:test, so we assert the JSX/CSS wiring directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getToolSummary, shortenPath, TOOL_SUMMARY_FORMATTERS, MAX_SUMMARY_CHARS } from '../src/utils/toolSummary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (...p) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf-8');

const chatMessage = src('components', 'chat', 'ChatMessage.jsx');
const chatMessageCss = src('components', 'chat', 'ChatMessage.module.css');
const globalCss = src('global.css');
const i18n = src('i18n.js');

describe('toolSummary — Bash', () => {
  it('prefers description (the call reason) over command', () => {
    assert.equal(
      getToolSummary('Bash', { command: 'sudo true', description: 'Run sudo true to refresh sudo credentials' }),
      'Run sudo true to refresh sudo credentials'
    );
  });

  it('falls back to the first command line when description is blank/missing', () => {
    assert.equal(getToolSummary('Bash', { command: 'ls -la' }), 'ls -la');
    assert.equal(getToolSummary('Bash', { command: 'ls -la', description: '   ' }), 'ls -la');
  });

  it('uses only the first line of a multi-line command', () => {
    assert.equal(getToolSummary('Bash', { command: 'cd /tmp\npnpm run build\nls' }), 'cd /tmp');
  });

  it('collapses newlines inside a description to a single line', () => {
    assert.equal(getToolSummary('Bash', { description: 'line one\nline two' }), 'line one line two');
  });

  it('returns null when neither description nor command is usable', () => {
    assert.equal(getToolSummary('Bash', {}), null);
    assert.equal(getToolSummary('Bash', { command: '', description: '' }), null);
  });
});

describe('toolSummary — Read', () => {
  it('keeps the last 3 path segments with an ellipsis prefix', () => {
    assert.equal(
      getToolSummary('Read', { file_path: '/Users/me/proj/apps/web/src/components/chat/ChatMessage.jsx' }),
      '…/components/chat/ChatMessage.jsx'
    );
  });

  it('passes short paths through unchanged', () => {
    assert.equal(getToolSummary('Read', { file_path: 'src/i18n.js' }), 'src/i18n.js');
    assert.equal(getToolSummary('Read', { file_path: 'README.md' }), 'README.md');
  });

  it('shortens Windows-style separators', () => {
    assert.equal(getToolSummary('Read', { file_path: 'C:\\a\\b\\c\\d.js' }), '…/b/c/d.js');
  });

  it('returns null without a file_path', () => {
    assert.equal(getToolSummary('Read', {}), null);
  });
});

describe('shortenPath', () => {
  it('respects maxSegments and rejects empty input', () => {
    assert.equal(shortenPath('/a/b/c/d/e.js', 2), '…/d/e.js');
    assert.equal(shortenPath('', 3), null);
    assert.equal(shortenPath(null, 3), null);
    assert.equal(shortenPath(42, 3), null);
  });
});

describe('toolSummary — TaskUpdate', () => {
  it('prefers subject', () => {
    assert.equal(getToolSummary('TaskUpdate', { taskId: '3', subject: 'Run tests', status: 'in_progress' }), 'Run tests');
  });

  it('falls back to #id → status, then either part alone', () => {
    assert.equal(getToolSummary('TaskUpdate', { taskId: '3', status: 'in_progress' }), '#3 → in_progress');
    assert.equal(getToolSummary('TaskUpdate', { status: 'completed' }), 'completed');
    assert.equal(getToolSummary('TaskUpdate', { taskId: 7 }), '#7');
    assert.equal(getToolSummary('TaskUpdate', { taskId: 0 }), '#0');
    assert.equal(getToolSummary('TaskUpdate', {}), null);
  });

  it('ignores non-scalar/blank taskIds instead of stringifying garbage', () => {
    assert.equal(getToolSummary('TaskUpdate', { taskId: {}, status: 'done' }), 'done');
    assert.equal(getToolSummary('TaskUpdate', { taskId: true }), null);
    assert.equal(getToolSummary('TaskUpdate', { taskId: '   ', status: 'done' }), 'done');
  });
});

describe('toolSummary — Grep / Glob / Task / TaskCreate / WebFetch / WebSearch', () => {
  it('formats each first-batch tool', () => {
    assert.equal(getToolSummary('Grep', { pattern: 'foo.*bar' }), '/foo.*bar/');
    assert.equal(getToolSummary('Grep', {}), null);
    assert.equal(getToolSummary('Glob', { pattern: 'apps/web/src/**/*.jsx' }), 'apps/web/src/**/*.jsx');
    assert.equal(getToolSummary('Task', { description: 'Explore pill renderer', subagent_type: 'Explore' }), 'Explore pill renderer');
    assert.equal(getToolSummary('Task', { subagent_type: 'Explore' }), 'Explore');
    assert.equal(getToolSummary('TaskCreate', { subject: 'Implement registry' }), 'Implement registry');
    assert.equal(getToolSummary('WebFetch', { url: 'https://example.com/docs' }), 'https://example.com/docs');
    assert.equal(getToolSummary('WebSearch', { query: 'cc-viewer pill' }), 'cc-viewer pill');
  });
});

describe('toolSummary — sanitize coverage', () => {
  it('strips bidi/format control chars incl. ALM, LRM/RLM, ZWNBSP', () => {
    // U+061C ARABIC LETTER MARK — the one bidi control the original regex missed.
    assert.equal(getToolSummary('Bash', { command: 'echo ؜hi' }), 'echo hi');
    assert.equal(getToolSummary('Bash', { description: 'a‎b‏c﻿d' }), 'abcd');
    // Literal RLO/LRI/BOM (mirrors slash-command-labels.test.js convention).
    assert.equal(getToolSummary('Bash', { description: 'x‮y⁦z﻿' }), 'xyz');
  });
});

describe('toolSummary — unknown tools and prototype safety', () => {
  it('falls back to description for unknown/MCP tools, else null', () => {
    assert.equal(getToolSummary('mcp__server__thing', { description: 'Do X' }), 'Do X');
    assert.equal(getToolSummary('mcp__server__thing', { query: 'select 1' }), null);
  });

  it('does not resolve prototype keys as formatters', () => {
    assert.equal(getToolSummary('toString', {}), null);
    assert.equal(getToolSummary('__proto__', {}), null);
    assert.equal(getToolSummary('hasOwnProperty', {}), null);
    // Prototype names hit the conservative unknown-tool branch, never a formatter.
    assert.equal(getToolSummary('constructor', { description: 'x' }), 'x');
    assert.equal(getToolSummary('constructor', { command: 'ls' }), null);
  });

  it('rejects non-string names', () => {
    assert.equal(getToolSummary(undefined, { description: 'x' }), null);
    assert.equal(getToolSummary(null, {}), null);
    assert.equal(getToolSummary(42, { description: 'x' }), null);
    assert.equal(getToolSummary({}, { description: 'x' }), null);
    assert.equal(getToolSummary(true, { description: 'x' }), null);
  });
});

describe('toolSummary — input coercion', () => {
  it('returns null for missing/non-object/non-string input', () => {
    assert.equal(getToolSummary('Bash', undefined), null);
    assert.equal(getToolSummary('Bash', null), null);
    assert.equal(getToolSummary('Bash', 42), null);
  });

  it('parses a valid JSON string input', () => {
    assert.equal(getToolSummary('Bash', '{"command":"ls -la"}'), 'ls -la');
  });

  it('returns null for partial/malformed JSON strings (streaming middle state)', () => {
    assert.equal(getToolSummary('Bash', '{"command":"ls'), null);
  });

  it('strips a leading "[object Object]" artifact before parsing', () => {
    assert.equal(getToolSummary('Bash', '[object Object]{"command":"ls"}'), 'ls');
  });
});

describe('toolSummary — clamping and robustness', () => {
  it('clamps huge summaries to MAX_SUMMARY_CHARS with an ellipsis', () => {
    const huge = 'x'.repeat(10000);
    const out = getToolSummary('Bash', { description: huge });
    assert.equal(out.length, MAX_SUMMARY_CHARS);
    assert.ok(out.endsWith('…'));
  });

  it('respects the exact clamp boundary', () => {
    const exact = getToolSummary('Bash', { description: 'x'.repeat(200) });
    assert.equal(exact.length, 200);
    assert.ok(!exact.endsWith('…'));
    const over = getToolSummary('Bash', { description: 'x'.repeat(201) });
    assert.equal(over.length, 200);
    assert.ok(over.endsWith('…'));
    // Exercises the trimEnd branch: 199th code point is a space.
    const spaced = getToolSummary('Bash', { description: 'x'.repeat(198) + ' yy' });
    assert.ok(spaced.endsWith('…'));
    assert.ok(!spaced.endsWith(' …'));
  });

  it('never splits a surrogate pair at the clamp boundary', () => {
    const out = getToolSummary('Bash', { description: 'x'.repeat(198) + '😀' + 'y'.repeat(50) });
    assert.ok(out.endsWith('😀…'), 'astral char survives whole at the boundary');
    assert.ok(out.isWellFormed());
  });

  it('strips bidi/format control characters from summaries', () => {
    assert.equal(getToolSummary('Bash', { description: 'git status‮ evil‬' }), 'git status evil');
    assert.equal(getToolSummary('mcp__x__y', { description: 'a⁦b﻿c' }), 'abc');
  });

  it('unknown-tool branch collapses whitespace-only descriptions to null', () => {
    assert.equal(getToolSummary('mcp__x__y', { description: ' \n\t ' }), null);
  });

  it('every formatter returns string|null for hostile inputs without throwing', () => {
    const hostileInputs = [{}, { description: 42 }, { command: null }, { pattern: [] }, { file_path: {} }, { subject: 0, taskId: {}, status: true }];
    for (const name of Object.keys(TOOL_SUMMARY_FORMATTERS)) {
      for (const input of hostileInputs) {
        const out = getToolSummary(name, input);
        assert.ok(out === null || typeof out === 'string', `${name} returned ${typeof out}`);
      }
    }
  });
});

describe('toolSummary — source contract', () => {
  it('ChatMessage imports getToolSummary and calls it inside _renderSimplifiedToolPill', () => {
    assert.ok(chatMessage.includes("import { getToolSummary } from '../../utils/toolSummary';"));
    const pillStart = chatMessage.indexOf('_renderSimplifiedToolPill(tu, tr) {');
    const pillEnd = chatMessage.indexOf('renderToolResult(tr) {', pillStart);
    assert.ok(pillStart > 0 && pillEnd > pillStart, 'pill method located');
    const pillBody = chatMessage.slice(pillStart, pillEnd);
    assert.ok(pillBody.includes('getToolSummary(tu.name, tu.input)'), 'summary computed from the full tool_use block');
    assert.ok(pillBody.includes('{tu.name}{summary ? <span className={styles.simplifiedToolSummary}>: {summary}</span> : \'\'}'), 'summary rendered inline after the name in a fainter span');
  });

  it('the summary renders one shade fainter than the tool name', () => {
    assert.ok(chatMessageCss.includes('.simplifiedToolSummary {'), 'summary span style exists');
    assert.ok(chatMessageCss.includes('color: var(--text-summary-faint);'), 'summary uses the fainter variable');
    assert.ok(chatMessageCss.includes('.simplifiedToolTag:hover .simplifiedToolSummary'), 'summary brightens on pill hover');
    assert.equal((globalCss.match(/--text-summary-faint:/g) || []).length, 2, 'defined for dark + light themes');
    // Pin the actual values per theme so a polarity swap fails the test.
    const darkBlockStart = globalCss.indexOf('\n:root, [data-theme="dark"] {');
    const lightBlockStart = globalCss.indexOf('\n[data-theme="light"] {');
    assert.ok(darkBlockStart > 0 && lightBlockStart > darkBlockStart, 'theme blocks located');
    const darkBlock = globalCss.slice(darkBlockStart, lightBlockStart);
    const lightBlock = globalCss.slice(lightBlockStart);
    assert.ok(darkBlock.includes('--text-summary-faint: rgba(255, 255, 255, 0.36);'), 'dark value pinned');
    assert.ok(lightBlock.includes('--text-summary-faint: rgba(0, 0, 0, 0.28);'), 'light value pinned');
  });

  it('pill CSS stacks one per line, clamps width with ellipsis (no !important)', () => {
    const blockStart = chatMessageCss.indexOf('.simplifiedToolTag {');
    const blockEnd = chatMessageCss.indexOf('}', blockStart);
    assert.ok(blockStart > 0, 'tag block located');
    const block = chatMessageCss.slice(blockStart, blockEnd);
    for (const decl of ['display: block', 'width: fit-content', 'max-width: min(420px, 100%)', 'white-space: nowrap', 'overflow: hidden', 'text-overflow: ellipsis', 'box-sizing: border-box']) {
      assert.ok(block.includes(decl), `missing ${decl}`);
    }
    assert.ok(!/!important/.test(block), 'no !important in the pill block');
  });

  it('the "tools used" label and its i18n key are gone', () => {
    assert.ok(!chatMessage.includes('simplifiedLabelAdded'));
    assert.ok(!chatMessage.includes("t('ui.toolsUsed')"));
    assert.ok(!chatMessage.includes('simplifiedToolLabel'));
    assert.ok(!chatMessageCss.includes('.simplifiedToolLabel'));
    assert.ok(!i18n.includes('"ui.toolsUsed"'));
  });
});
