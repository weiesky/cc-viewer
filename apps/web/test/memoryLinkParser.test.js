import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseMemoryLink } from '../src/utils/memoryLinkParser.js';

describe('parseMemoryLink', () => {
  describe('happy path: single .md basename', () => {
    it('accepts plain .md basename', () => {
      assert.deepEqual(parseMemoryLink('foo.md'), { open: 'foo.md' });
    });

    it('accepts .md with hyphens / underscores / digits', () => {
      assert.deepEqual(parseMemoryLink('user-prefs_v2.md'), { open: 'user-prefs_v2.md' });
    });

    it('strips query string before validation', () => {
      assert.deepEqual(parseMemoryLink('foo.md?v=1'), { open: 'foo.md' });
    });

    it('strips trailing hash before validation', () => {
      assert.deepEqual(parseMemoryLink('foo.md#section'), { open: 'foo.md' });
    });

    it('decodes URL-encoded basename', () => {
      assert.deepEqual(parseMemoryLink('hello%20world.md'), { open: 'hello world.md' });
    });

    it('trims surrounding whitespace', () => {
      assert.deepEqual(parseMemoryLink('  foo.md  '), { open: 'foo.md' });
    });
  });

  describe('anchor: pass through to browser', () => {
    it('returns allow for #section', () => {
      assert.deepEqual(parseMemoryLink('#intro'), { allow: true });
    });
    it('returns allow for # alone', () => {
      assert.deepEqual(parseMemoryLink('#'), { allow: true });
    });
  });

  describe('reject: known dangerous schemes', () => {
    for (const scheme of ['javascript', 'data', 'file', 'vbscript', 'blob']) {
      it(`rejects ${scheme}: lowercase`, () => {
        assert.deepEqual(parseMemoryLink(`${scheme}:alert(1)`), { reject: true });
      });
      it(`rejects ${scheme}: mixed case`, () => {
        // 大小写混合不应绕过——白名单设计下任何 scheme 都拒绝
        const mixed = scheme[0].toUpperCase() + scheme.slice(1);
        assert.deepEqual(parseMemoryLink(`${mixed}:alert(1)`), { reject: true });
      });
    }
  });

  describe('reject: any other scheme (whitelist policy)', () => {
    it('rejects http://', () => {
      assert.deepEqual(parseMemoryLink('http://example.com'), { reject: true });
    });
    it('rejects https://', () => {
      assert.deepEqual(parseMemoryLink('https://example.com/foo.md'), { reject: true });
    });
    it('rejects mailto:', () => {
      assert.deepEqual(parseMemoryLink('mailto:foo@bar'), { reject: true });
    });
    it('rejects ftp://', () => {
      assert.deepEqual(parseMemoryLink('ftp://server/file.md'), { reject: true });
    });
    it('rejects tel:', () => {
      assert.deepEqual(parseMemoryLink('tel:+15555555555'), { reject: true });
    });
    it('rejects sms:', () => {
      assert.deepEqual(parseMemoryLink('sms:+15555555555'), { reject: true });
    });
    it('rejects intent:', () => {
      assert.deepEqual(parseMemoryLink('intent://scan/#Intent;...end'), { reject: true });
    });
    it('rejects chrome:', () => {
      assert.deepEqual(parseMemoryLink('chrome://settings'), { reject: true });
    });
    it('rejects chrome-extension:', () => {
      assert.deepEqual(parseMemoryLink('chrome-extension://abc/foo.md'), { reject: true });
    });
    it('rejects about:', () => {
      assert.deepEqual(parseMemoryLink('about:blank'), { reject: true });
    });
    it('rejects ws://', () => {
      assert.deepEqual(parseMemoryLink('ws://localhost'), { reject: true });
    });
    it('rejects custom hypothetical x-app:', () => {
      assert.deepEqual(parseMemoryLink('x-app:open?id=1'), { reject: true });
    });
    it('rejects custom hypothetical foo.bar+baz:', () => {
      assert.deepEqual(parseMemoryLink('foo.bar+baz:payload'), { reject: true });
    });
    it('rejects MAILTO: (mixed case bypass attempt)', () => {
      assert.deepEqual(parseMemoryLink('MAILTO:foo@bar'), { reject: true });
    });
  });

  describe('reject: path traversal / absolute paths', () => {
    it('rejects absolute unix path', () => {
      assert.deepEqual(parseMemoryLink('/etc/passwd.md'), { reject: true });
    });
    it('rejects absolute windows path', () => {
      assert.deepEqual(parseMemoryLink('\\Windows\\System32\\foo.md'), { reject: true });
    });
    it('rejects relative path with separator', () => {
      assert.deepEqual(parseMemoryLink('subdir/foo.md'), { reject: true });
    });
    it('rejects backslash separator', () => {
      assert.deepEqual(parseMemoryLink('subdir\\foo.md'), { reject: true });
    });
    it('rejects ..', () => {
      assert.deepEqual(parseMemoryLink('..'), { reject: true });
    });
    it('rejects names starting with dot', () => {
      assert.deepEqual(parseMemoryLink('.hidden.md'), { reject: true });
    });
  });

  describe('reject: non-md / empty / malformed', () => {
    it('rejects empty string', () => {
      assert.deepEqual(parseMemoryLink(''), { reject: true });
    });
    it('rejects undefined', () => {
      assert.deepEqual(parseMemoryLink(undefined), { reject: true });
    });
    it('rejects whitespace-only', () => {
      assert.deepEqual(parseMemoryLink('   '), { reject: true });
    });
    it('rejects .txt', () => {
      assert.deepEqual(parseMemoryLink('foo.txt'), { reject: true });
    });
    it('rejects extensionless', () => {
      assert.deepEqual(parseMemoryLink('foo'), { reject: true });
    });
    it('rejects malformed URL-encoded', () => {
      assert.deepEqual(parseMemoryLink('%ZZ.md'), { reject: true });
    });
  });
});
