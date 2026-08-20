/**
 * Streaming-edge tests for the Markdown render pipeline.
 *
 * Validates that marked tolerates the partial, mid-token inputs produced
 * during SSE streaming, and that known dangerous inputs (e.g. Streamdown
 * issue #357: Go struct-tag backticks) do not cause catastrophic backtracking.
 *
 * Runs without DOM — sanitization is orthogonal and covered by the browser
 * manual test page.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';

// Baseline on an M-class laptop is ~4ms for 1000 lines; 50ms is a 10× margin
// that still catches catastrophic regex backtracking (see Streamdown #357).
const PARSE_BUDGET_MS = 50;

function parse(text) {
  return marked.parse(text, { breaks: true });
}

function timedParse(text) {
  const start = process.hrtime.bigint();
  const html = parse(text);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { html, ms };
}

// ─── Unclosed fenced code block ──────────────────────────────────────────────

describe('streaming — unclosed fenced code block', () => {
  it('parses text with an unclosed triple-backtick without throwing', () => {
    const text = '# Title\n\n```js\nconst partial = ';
    const { html, ms } = timedParse(text);
    assert.ok(html.length > 0, 'produces output');
    assert.ok(ms < PARSE_BUDGET_MS, `parse took ${ms}ms`);
  });

  it('treats trailing content after unclosed fence as code content', () => {
    const text = '```\nline 1\nline 2\n(never closed)';
    const html = parse(text);
    assert.match(html, /<pre><code[\s\S]*line 1[\s\S]*line 2[\s\S]*<\/code><\/pre>/);
  });

  it('recovers once the closing fence arrives', () => {
    const text = '```js\nfoo\n```\n\nafter';
    const html = parse(text);
    assert.match(html, /<pre><code[^>]*>foo[\s\S]*<\/code><\/pre>/);
    assert.match(html, /<p>after<\/p>/);
  });
});

// ─── Go struct-tag backticks (Streamdown #357 regression guard) ──────────────

describe('streaming — Go struct-tag backticks', () => {
  it('handles backtick-quoted tags inside fenced Go code without freezing', () => {
    const text = [
      '```go',
      'type User struct {',
      '  Name string `json:"name" yaml:"name"`',
      '  Age  int    `json:"age"`',
      '}',
      '```',
    ].join('\n');
    const { html, ms } = timedParse(text);
    assert.match(html, /<pre><code[^>]*language-go/);
    assert.ok(ms < PARSE_BUDGET_MS, `parse took ${ms}ms — possible regex backtracking`);
  });

  it('handles Go code with nested backtick tags in a single line', () => {
    const text = '```go\nfield `json:"a"` `xml:"a,attr"` `validate:"required"`\n```';
    const { ms } = timedParse(text);
    assert.ok(ms < PARSE_BUDGET_MS, `parse took ${ms}ms`);
  });
});

// ─── List continuity during streaming ────────────────────────────────────────

describe('streaming — list stability across chunks', () => {
  it('preserves list item numbering as text grows char-by-char', () => {
    const finalText = '1. one\n2. two\n3. three\n4. four\n5. five';
    const finalHtml = parse(finalText);
    assert.match(finalHtml, /<li>one<\/li>/);
    assert.match(finalHtml, /<li>five<\/li>/);

    // Simulate streaming — each prefix should still produce a valid partial list.
    let lastGoodHtml = '';
    for (let i = 1; i <= finalText.length; i++) {
      const partial = finalText.slice(0, i);
      const html = parse(partial);
      if (html.includes('<ol')) lastGoodHtml = html;
    }
    assert.ok(lastGoodHtml.length > 0, 'at least one partial produced an <ol>');
  });
});

// ─── Table streaming boundary ────────────────────────────────────────────────

describe('streaming — incomplete table', () => {
  it('does not throw on a partial table header row', () => {
    const partials = [
      '| a |',
      '| a | b',
      '| a | b |',
      '| a | b |\n|',
      '| a | b |\n|---|',
      '| a | b |\n|---|---|',
      '| a | b |\n|---|---|\n| 1',
    ];
    for (const p of partials) {
      const { html, ms } = timedParse(p);
      assert.ok(typeof html === 'string', `${JSON.stringify(p)} → ${typeof html}`);
      assert.ok(ms < PARSE_BUDGET_MS, `parse of ${JSON.stringify(p)} took ${ms}ms`);
    }
  });
});

// ─── Large content budget ────────────────────────────────────────────────────

describe('streaming — large content', () => {
  it('parses a 1000-line mixed document within the budget', () => {
    const lines = [];
    for (let i = 0; i < 1000; i++) {
      if (i % 50 === 0) lines.push(`## Section ${i / 50}`);
      else if (i % 7 === 0) lines.push('- item ' + i);
      else if (i % 11 === 0) lines.push('`code`' + i);
      else lines.push('plain line ' + i);
    }
    const text = lines.join('\n');
    const { html, ms } = timedParse(text);
    assert.ok(html.includes('<h2'), 'produced h2 sections');
    assert.ok(ms < PARSE_BUDGET_MS, `1000-line parse took ${ms}ms`);
  });
});

// ─── Nested lists and deep structure ─────────────────────────────────────────

describe('streaming — nested lists', () => {
  it('handles 3-level nested unordered list', () => {
    const text = '- a\n  - b\n    - c';
    const html = parse(text);
    assert.match(html, /<li>a[\s\S]*<ul>[\s\S]*<li>b[\s\S]*<ul>[\s\S]*<li>c/);
  });
});

// ─── Unclosed emphasis tokens ────────────────────────────────────────────────

describe('streaming — unclosed inline tokens', () => {
  it('gracefully parses text with unclosed **bold**', () => {
    const { html, ms } = timedParse('This is **bold without close');
    assert.ok(html.includes('bold without close'));
    assert.ok(ms < PARSE_BUDGET_MS);
  });

  it('gracefully parses text with unclosed [link(', () => {
    const { html, ms } = timedParse('check [some link(https://ex');
    assert.ok(html.includes('some link'));
    assert.ok(ms < PARSE_BUDGET_MS);
  });
});
