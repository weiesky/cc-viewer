// Lock fallback semantics for AskUserQuestion options[].description being missing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  optionAriaLabel,
  hasOptionDescription,
} from '../src/utils/askOptionDesc.js';

describe('optionAriaLabel', () => {
  it('returns label when description is missing / falsy', () => {
    assert.equal(optionAriaLabel({ label: '红' }), '红');
    assert.equal(optionAriaLabel({ label: '蓝', description: undefined }), '蓝');
    assert.equal(optionAriaLabel({ label: '绿', description: null }), '绿');
    assert.equal(optionAriaLabel({ label: '黄', description: '' }), '黄');
  });

  it('combines label and description when both present', () => {
    assert.equal(optionAriaLabel({ label: 'A', description: 'desc' }), 'A: desc');
  });

  it('coerces non-string label via String() to match original JSX template-literal behavior', () => {
    assert.equal(optionAriaLabel({ label: 123 }), '123');
    assert.equal(optionAriaLabel({ label: 0 }), '0');
    assert.equal(optionAriaLabel({ label: 123, description: 'd' }), '123: d');
  });

  it('returns empty string when opt or label is missing', () => {
    assert.equal(optionAriaLabel(null), '');
    assert.equal(optionAriaLabel(undefined), '');
    assert.equal(optionAriaLabel({}), '');
    assert.equal(optionAriaLabel({ label: null }), '');
    assert.equal(optionAriaLabel({ label: undefined }), '');
  });
});

describe('hasOptionDescription', () => {
  it('false for missing / falsy description', () => {
    assert.equal(hasOptionDescription({ label: 'A' }), false);
    assert.equal(hasOptionDescription({ label: 'A', description: undefined }), false);
    assert.equal(hasOptionDescription({ label: 'A', description: null }), false);
    assert.equal(hasOptionDescription({ label: 'A', description: '' }), false);
    assert.equal(hasOptionDescription({ label: 'A', description: 0 }), false);
  });

  it('true for any truthy description (including whitespace, numbers, objects)', () => {
    // 与原 `opt.description && ...` 严格等价：whitespace-only/非零数字/对象都视为 truthy
    assert.equal(hasOptionDescription({ label: 'A', description: 'x' }), true);
    assert.equal(hasOptionDescription({ label: 'A', description: '   ' }), true);
    assert.equal(hasOptionDescription({ label: 'A', description: 5 }), true);
    assert.equal(hasOptionDescription({ label: 'A', description: { x: 1 } }), true);
    assert.equal(hasOptionDescription({ label: 'A', description: [1] }), true);
  });

  it('false for nullish opt', () => {
    assert.equal(hasOptionDescription(null), false);
    assert.equal(hasOptionDescription(undefined), false);
  });
});
