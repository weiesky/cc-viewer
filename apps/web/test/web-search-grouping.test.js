import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractWebSearchGroups,
  safeHref,
  getHostname,
} from '../src/utils/webSearchGrouping.js';

const stu = (id, query = 'q') => ({ type: 'server_tool_use', id, name: 'web_search', input: { query } });
const wsr = (toolUseId, count = 2) => ({
  type: 'web_search_tool_result',
  tool_use_id: toolUseId,
  content: Array.from({ length: count }, (_, i) => ({
    type: 'web_search_result',
    title: `r${i}`,
    url: `https://e.com/${i}`,
    page_age: '1 day',
    encrypted_content: 'XXXX',
  })),
});
const text = (t) => ({ type: 'text', text: t });
const thinking = (t) => ({ type: 'thinking', thinking: t });
const tool_use = (id, name = 'Read') => ({ type: 'tool_use', id, name, input: {} });

describe('extractWebSearchGroups', () => {
  it('returns empty for empty / non-array content', () => {
    assert.deepEqual(extractWebSearchGroups([]), { groups: [], consumedIndices: new Set() });
    assert.deepEqual(extractWebSearchGroups(null), { groups: [], consumedIndices: new Set() });
    assert.deepEqual(extractWebSearchGroups(undefined), { groups: [], consumedIndices: new Set() });
  });

  it('returns empty when no web_search blocks present', () => {
    const c = [text('hi'), thinking('uh'), tool_use('t1')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 0);
    assert.equal(consumedIndices.size, 0);
  });

  it('identifies standard server→result→synthesis sequence', () => {
    const c = [stu('s1', 'cats'), wsr('s1', 3), text('A'), text('B')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    const g = groups[0];
    assert.equal(g.serverToolUseIndex, 0);
    assert.equal(g.webSearchResultIndex, 1);
    assert.deepEqual(g.synthesisTextIndices, [2, 3]);
    assert.equal(g.serverToolUse.input.query, 'cats');
    assert.equal(g.webSearchResult.content.length, 3);
    assert.deepEqual([...consumedIndices].sort((a, b) => a - b), [0, 1, 2, 3]);
  });

  it('keeps pre-narrative text outside any group', () => {
    const c = [text('let me search'), stu('s1'), wsr('s1'), text('results say...')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].serverToolUseIndex, 1);
    assert.deepEqual(groups[0].synthesisTextIndices, [3]);
    assert.equal(consumedIndices.has(0), false);
  });

  it('handles multiple groups in one message', () => {
    const c = [stu('s1'), wsr('s1'), text('A1'), stu('s2'), wsr('s2'), text('A2'), text('A2b')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].synthesisTextIndices, [2]);
    assert.deepEqual(groups[1].synthesisTextIndices, [5, 6]);
    assert.equal(consumedIndices.size, 7);
  });

  it('does not group thinking into synthesis text', () => {
    const c = [stu('s1'), wsr('s1'), text('A'), thinking('reflect'), text('B'), stu('s2'), wsr('s2')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 2);
    assert.deepEqual(groups[0].synthesisTextIndices, [2]);
    assert.equal(consumedIndices.has(3), false);
    assert.equal(consumedIndices.has(4), false);
  });

  it('unpaired server_tool_use (no result) → group with null webSearchResult', () => {
    const c = [stu('s1'), text('something else')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].webSearchResult, null);
    assert.equal(groups[0].webSearchResultIndex, -1);
    assert.deepEqual(groups[0].synthesisTextIndices, []);
    assert.deepEqual([...consumedIndices], [0]);
  });

  it('orphan web_search_tool_result (no server) → group with null serverToolUse', () => {
    const c = [wsr('missing'), text('synthesis')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].serverToolUse, null);
    assert.equal(groups[0].webSearchResultIndex, 0);
    assert.deepEqual(groups[0].synthesisTextIndices, []);
    assert.deepEqual([...consumedIndices], [0]);
  });

  it('mixed with regular tool_use: tool_use breaks synthesis', () => {
    const c = [stu('s1'), wsr('s1'), text('A'), tool_use('r1', 'Read'), text('after read')];
    const { groups, consumedIndices } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].synthesisTextIndices, [2]);
    assert.equal(consumedIndices.has(3), false);
    assert.equal(consumedIndices.has(4), false);
  });

  it('server tool followed by thinking then result → still pairs', () => {
    const c = [stu('s1'), thinking('hmm'), wsr('s1'), text('A')];
    const { groups } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].webSearchResultIndex, 2);
    assert.deepEqual(groups[0].synthesisTextIndices, [3]);
  });

  it('server tool followed by text (not result) → unpaired (data error)', () => {
    const c = [stu('s1'), text('?'), wsr('s1')];
    const { groups } = extractWebSearchGroups(c);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].webSearchResult, null);
    assert.equal(groups[1].serverToolUse, null);
  });

  it('citations field on text block does not affect grouping', () => {
    const c = [stu('s1'), wsr('s1'), { type: 'text', text: 'A', citations: [{ url: 'x' }] }];
    const { groups } = extractWebSearchGroups(c);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].synthesisTextIndices, [2]);
  });
});

describe('safeHref', () => {
  it('passes http and https through', () => {
    assert.equal(safeHref('https://example.com'), 'https://example.com');
    assert.equal(safeHref('http://example.com/path?q=1'), 'http://example.com/path?q=1');
  });

  it('rejects javascript: protocol', () => {
    assert.equal(safeHref('javascript:alert(1)'), null);
    assert.equal(safeHref('JaVaScRiPt:alert(1)'), null);
  });

  it('rejects data: protocol', () => {
    assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), null);
  });

  it('rejects file: protocol (Electron RCE risk)', () => {
    assert.equal(safeHref('file:///etc/passwd'), null);
  });

  it('rejects mailto: and other non-web protocols', () => {
    assert.equal(safeHref('mailto:a@b.c'), null);
    assert.equal(safeHref('ftp://example.com'), null);
  });

  it('rejects invalid / empty / non-string inputs', () => {
    assert.equal(safeHref(''), null);
    assert.equal(safeHref('not a url'), null);
    assert.equal(safeHref(null), null);
    assert.equal(safeHref(undefined), null);
    assert.equal(safeHref(123), null);
    assert.equal(safeHref({}), null);
  });
});

describe('getHostname', () => {
  it('returns hostname for valid url', () => {
    assert.equal(getHostname('https://www.example.com/path'), 'www.example.com');
    assert.equal(getHostname('http://example.com:8080'), 'example.com');
  });

  it('returns truncated string for invalid url', () => {
    const long = 'not-a-url-just-a-very-long-string-that-exceeds-forty-chars-easily';
    const out = getHostname(long);
    assert.ok(out.endsWith('…'));
    assert.equal(out.length, 41);
  });

  it('returns short invalid as-is', () => {
    assert.equal(getHostname('weird'), 'weird');
    assert.equal(getHostname(''), '');
    assert.equal(getHostname(null), '');
  });
});
