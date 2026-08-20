/**
 * Unit tests for src/utils/svgSanitize.js — SMIL animation hook for DOMPurify.
 * The actual DOMPurify round-trip would need jsdom; here we test the pure guard
 * function and the config shape.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SMIL_TAGS,
  FORBIDDEN_ANIM_TARGET,
  isHostileAnimAttr,
  SVG_SANITIZE_CONFIG,
} from '../src/utils/svgSanitize.js';

describe('isHostileAnimAttr', () => {
  it('blocks SMIL retargeting onto event handlers', () => {
    assert.equal(isHostileAnimAttr('set', 'attributename', 'onclick'), true);
    assert.equal(isHostileAnimAttr('animate', 'attributename', 'onmouseover'), true);
    assert.equal(isHostileAnimAttr('animateTransform', 'attributename', 'onload'), true);
    assert.equal(isHostileAnimAttr('animateMotion', 'attributename', 'onerror'), true);
  });

  it('blocks SMIL retargeting onto href / xlink:href / style', () => {
    assert.equal(isHostileAnimAttr('animate', 'attributename', 'href'), true);
    assert.equal(isHostileAnimAttr('animate', 'attributename', 'xlink:href'), true);
    assert.equal(isHostileAnimAttr('set', 'attributename', 'style'), true);
  });

  it('allows SMIL retargeting onto safe presentation attributes', () => {
    assert.equal(isHostileAnimAttr('animate', 'attributename', 'viewBox'), false);
    assert.equal(isHostileAnimAttr('animateTransform', 'attributename', 'transform'), false);
    assert.equal(isHostileAnimAttr('set', 'attributename', 'fill'), false);
    assert.equal(isHostileAnimAttr('animate', 'attributename', 'opacity'), false);
  });

  it('ignores non-SMIL parent tags even when value would be hostile', () => {
    assert.equal(isHostileAnimAttr('path', 'attributename', 'onclick'), false);
    assert.equal(isHostileAnimAttr('svg', 'attributename', 'href'), false);
    assert.equal(isHostileAnimAttr('g', 'attributename', 'onload'), false);
  });

  it('ignores non-attributeName attrs (only attributeName drives SMIL retargeting)', () => {
    assert.equal(isHostileAnimAttr('set', 'to', 'alert(1)'), false);
    assert.equal(isHostileAnimAttr('animate', 'values', 'onclick;onmouseover'), false);
    assert.equal(isHostileAnimAttr('animate', 'from', 'onclick'), false);
  });

  it('handles empty / null inputs without throwing', () => {
    assert.equal(isHostileAnimAttr('', '', ''), false);
    assert.equal(isHostileAnimAttr(null, 'attributename', 'onclick'), false);
    assert.equal(isHostileAnimAttr('animate', 'attributename', null), false);
  });

  it('trims whitespace before matching', () => {
    assert.equal(isHostileAnimAttr('animate', 'attributename', '  onclick  '), true);
    assert.equal(isHostileAnimAttr('set', 'attributename', '\thref\n'), true);
  });
});

describe('FORBIDDEN_ANIM_TARGET regex', () => {
  it('matches the exact set of dangerous attribute names', () => {
    for (const ok of ['onclick', 'onmouseover', 'onload', 'href', 'xlink:href', 'style']) {
      assert.ok(FORBIDDEN_ANIM_TARGET.test(ok), `should match ${ok}`);
    }
    for (const safe of ['viewBox', 'transform', 'fill', 'opacity', 'd', 'cx']) {
      assert.equal(FORBIDDEN_ANIM_TARGET.test(safe), false, `should not match ${safe}`);
    }
  });

  it('does not match attribute names that merely start with "h" or "s"', () => {
    assert.equal(FORBIDDEN_ANIM_TARGET.test('height'), false);
    assert.equal(FORBIDDEN_ANIM_TARGET.test('stroke'), false);
    assert.equal(FORBIDDEN_ANIM_TARGET.test('stop-color'), false);
  });
});

describe('SVG_SANITIZE_CONFIG', () => {
  it('keeps DOMPurify svg profile', () => {
    assert.equal(SVG_SANITIZE_CONFIG.USE_PROFILES.svg, true);
  });

  it('whitelists every SMIL animation element our anims need', () => {
    for (const tag of ['animate', 'animateMotion', 'animateTransform', 'set', 'mpath']) {
      assert.ok(SVG_SANITIZE_CONFIG.ADD_TAGS.includes(tag), `${tag} should be in ADD_TAGS`);
    }
  });

  it('whitelists the SMIL attributes the new src/img/claude/*.svg files use', () => {
    for (const attr of ['attributeName', 'calcMode', 'values', 'dur', 'repeatCount', 'fill']) {
      assert.ok(SVG_SANITIZE_CONFIG.ADD_ATTR.includes(attr), `${attr} should be in ADD_ATTR`);
    }
  });

  it('outer config object is frozen (shallow only — ADD_TAGS / ADD_ATTR arrays are still mutable)', () => {
    assert.ok(Object.isFrozen(SVG_SANITIZE_CONFIG));
  });
});

describe('SMIL_TAGS', () => {
  it('is a Set of lowercase canonical names', () => {
    assert.ok(SMIL_TAGS.has('set'));
    assert.ok(SMIL_TAGS.has('animate'));
    assert.ok(SMIL_TAGS.has('animatemotion'));
    assert.ok(SMIL_TAGS.has('animatetransform'));
    assert.equal(SMIL_TAGS.has('animateMotion'), false);
  });
});
