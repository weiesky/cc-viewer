import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLocalized } from '../src/utils/resolveLocalized.js';

describe('resolveLocalized', () => {
  it('returns plain strings unchanged', () => {
    assert.equal(resolveLocalized('hello', 'en'), 'hello');
    assert.equal(resolveLocalized('你好', 'zh'), '你好');
  });

  it('picks the exact language', () => {
    assert.equal(resolveLocalized({ en: 'E', zh: 'Z' }, 'en'), 'E');
    assert.equal(resolveLocalized({ en: 'E', zh: 'Z' }, 'zh'), 'Z');
  });

  it('strips region to the base language (zh-TW -> zh, pt-BR -> pt)', () => {
    assert.equal(resolveLocalized({ zh: 'Z' }, 'zh-TW'), 'Z');
    assert.equal(resolveLocalized({ pt: 'P' }, 'pt-BR'), 'P');
  });

  it('prefers exact region key over base when present', () => {
    assert.equal(resolveLocalized({ 'zh-TW': 'TW', zh: 'Z' }, 'zh-TW'), 'TW');
  });

  it('falls back to en then zh', () => {
    assert.equal(resolveLocalized({ en: 'E', zh: 'Z' }, 'ko'), 'E');
    assert.equal(resolveLocalized({ zh: 'Z' }, 'ko'), 'Z');
  });

  it('falls back to first non-empty value when no preferred lang present', () => {
    assert.equal(resolveLocalized({ fr: 'F' }, 'ko'), 'F');
  });

  it('treats empty / whitespace values as absent', () => {
    assert.equal(resolveLocalized({ en: '   ', zh: 'Z' }, 'en'), 'Z');
    assert.equal(resolveLocalized({ en: '' }, 'en'), '');
  });

  it('skips non-string values (only string entries are eligible)', () => {
    assert.equal(resolveLocalized({ en: 42, zh: 'Z' }, 'en'), 'Z');
    assert.equal(resolveLocalized({ en: { nested: 'x' }, zh: 'Z' }, 'en'), 'Z');
    assert.equal(resolveLocalized({ en: 42 }, 'en'), '');
  });

  it('returns "" for non-localizable / malformed input', () => {
    assert.equal(resolveLocalized({}, 'en'), '');
    assert.equal(resolveLocalized([], 'en'), '');
    assert.equal(resolveLocalized(['x'], 'en'), '');
    assert.equal(resolveLocalized(42, 'en'), '');
    assert.equal(resolveLocalized(null, 'en'), '');
    assert.equal(resolveLocalized(undefined, 'en'), '');
  });

  it('does not crash when lang is missing / non-string', () => {
    assert.equal(resolveLocalized({ en: 'E' }, undefined), 'E');
    assert.equal(resolveLocalized({ zh: 'Z' }, null), 'Z');
  });
});
