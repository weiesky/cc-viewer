/**
 * Unit tests for src/utils/markdownHrefClassify.js — pure function, plain node:test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMdHref, escapeAttr } from '../src/utils/markdownHrefClassify.js';

describe('classifyMdHref — external', () => {
  it('classifies http/https as external', () => {
    assert.deepEqual(classifyMdHref('https://example.com'), { kind: 'external' });
    assert.deepEqual(classifyMdHref('http://example.com/a?b=1#c'), { kind: 'external' });
    assert.deepEqual(classifyMdHref('HTTPS://example.com'), { kind: 'external' });
  });

  it('classifies protocol-relative URLs as external (before "/"-local check)', () => {
    assert.deepEqual(classifyMdHref('//example.com/x'), { kind: 'external' });
  });

  it('classifies mailto as external', () => {
    assert.deepEqual(classifyMdHref('mailto:a@b.com'), { kind: 'external' });
  });
});

describe('classifyMdHref — anchor', () => {
  it('classifies # anchors as anchor', () => {
    assert.deepEqual(classifyMdHref('#'), { kind: 'anchor' });
    assert.deepEqual(classifyMdHref('#section-1'), { kind: 'anchor' });
  });
});

describe('classifyMdHref — local-file', () => {
  it('classifies absolute paths', () => {
    assert.deepEqual(classifyMdHref('/Users/foo/x.md'), { kind: 'local-file', path: '/Users/foo/x.md' });
  });

  it('strips leading ./ from relative paths', () => {
    assert.deepEqual(classifyMdHref('./docs/a.md'), { kind: 'local-file', path: 'docs/a.md' });
  });

  it('keeps ../ relative paths (server rejects with 400, viewer shows error)', () => {
    assert.deepEqual(classifyMdHref('../x.md'), { kind: 'local-file', path: '../x.md' });
  });

  it('classifies schemeless relative paths as local files', () => {
    assert.deepEqual(classifyMdHref('docs/a.md'), { kind: 'local-file', path: 'docs/a.md' });
    assert.deepEqual(classifyMdHref('README.md'), { kind: 'local-file', path: 'README.md' });
  });

  it('strips #fragment and ?query from local paths', () => {
    assert.deepEqual(classifyMdHref('./a.md#L2'), { kind: 'local-file', path: 'a.md' });
    assert.deepEqual(classifyMdHref('/abs/x.md#heading'), { kind: 'local-file', path: '/abs/x.md' });
    assert.deepEqual(classifyMdHref('./a.md?t=1'), { kind: 'local-file', path: 'a.md' });
  });

  it('decodes percent-encoded local paths', () => {
    assert.deepEqual(classifyMdHref('./a%20b.md'), { kind: 'local-file', path: 'a b.md' });
  });

  it('keeps malformed percent sequences without throwing', () => {
    assert.deepEqual(classifyMdHref('/foo/100%.md'), { kind: 'local-file', path: '/foo/100%.md' });
  });
});

describe('classifyMdHref — file:// URIs', () => {
  it('strips file:// prefix and decodes', () => {
    assert.deepEqual(classifyMdHref('file:///Users/a%20b.md'), { kind: 'local-file', path: '/Users/a b.md' });
  });

  it('handles file://localhost/ prefix', () => {
    assert.deepEqual(classifyMdHref('file://localhost/x/y.md'), { kind: 'local-file', path: '/x/y.md' });
  });

  it('rejects UNC-style file://host/share as unsafe', () => {
    assert.deepEqual(classifyMdHref('file://server/share/x.md'), { kind: 'unsafe' });
  });

  it('handles Windows drive via file URI', () => {
    assert.deepEqual(classifyMdHref('file:///C:/Users/a.md'), { kind: 'local-file', path: '/C:/Users/a.md' });
  });
});

describe('classifyMdHref — Windows drive letters', () => {
  it('detects drive letters before scheme matching', () => {
    assert.deepEqual(classifyMdHref('C:\\Users\\a.md'), { kind: 'local-file', path: 'C:\\Users\\a.md' });
    assert.deepEqual(classifyMdHref('C:/Users/a.md'), { kind: 'local-file', path: 'C:/Users/a.md' });
  });

  it('normalizes drive paths like other branches (fragment/query stripped, percent-decoded)', () => {
    assert.deepEqual(classifyMdHref('C:\\Users\\a.md#L2'), { kind: 'local-file', path: 'C:\\Users\\a.md' });
    assert.deepEqual(classifyMdHref('C:/Users/a%20b.md'), { kind: 'local-file', path: 'C:/Users/a b.md' });
  });
});

describe('classifyMdHref — unsafe / other', () => {
  it('rejects javascript:/data:/vbscript: (case-insensitive)', () => {
    assert.deepEqual(classifyMdHref('javascript:alert(1)'), { kind: 'unsafe' });
    assert.deepEqual(classifyMdHref('JAVASCRIPT:alert(1)'), { kind: 'unsafe' });
    assert.deepEqual(classifyMdHref('data:text/html,<b>x</b>'), { kind: 'unsafe' });
    assert.deepEqual(classifyMdHref('vbscript:x'), { kind: 'unsafe' });
  });

  it('passes through other DOMPurify-allowed schemes unchanged', () => {
    assert.deepEqual(classifyMdHref('tel:+1234'), { kind: 'other' });
    assert.deepEqual(classifyMdHref('ftp://host/x'), { kind: 'other' });
  });

  it('rejects empty and non-string input', () => {
    assert.deepEqual(classifyMdHref(''), { kind: 'unsafe' });
    assert.deepEqual(classifyMdHref('   '), { kind: 'unsafe' });
    assert.deepEqual(classifyMdHref(null), { kind: 'unsafe' });
    assert.deepEqual(classifyMdHref(undefined), { kind: 'unsafe' });
  });

  it('trims surrounding whitespace before classification', () => {
    assert.deepEqual(classifyMdHref('  /x.md  '), { kind: 'local-file', path: '/x.md' });
    assert.deepEqual(classifyMdHref(' https://example.com '), { kind: 'external' });
  });

  it('handles uppercase scheme and drive letters', () => {
    assert.deepEqual(classifyMdHref('FILE:///x.md'), { kind: 'local-file', path: '/x.md' });
    assert.deepEqual(classifyMdHref('c:/x.md'), { kind: 'local-file', path: 'c:/x.md' });
  });

  it('rejects scheme-relative file URIs without slashes as unsafe', () => {
    assert.deepEqual(classifyMdHref('file:relative.md'), { kind: 'unsafe' });
  });

  it('passes through the full other-scheme allowlist', () => {
    for (const s of ['tel:+1', 'callto:+1', 'sms:+1', 'ftp://h/x', 'cid:x', 'xmpp:a@b', 'matrix:u/a']) {
      assert.deepEqual(classifyMdHref(s), { kind: 'other' }, s);
    }
  });
});

describe('escapeAttr', () => {
  it('escapes &, ", < for attribute interpolation', () => {
    assert.equal(escapeAttr('a&b"c<d'), 'a&amp;b&quot;c&lt;d');
    // ">" is intentionally not escaped: inside a double-quoted attribute value
    // it is harmless; only `"` can close the attribute.
    assert.equal(escapeAttr('"><script>'), '&quot;>&lt;script>');
  });
});
