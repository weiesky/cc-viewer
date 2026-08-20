/**
 * isInputValidationError 分类行为（src/utils/toolResultClassifier.js）
 * 锁定 InputValidationError | <tool_use_error> regex + 与 isPermissionDenied 互斥关系。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyToolResultError as classify } from '../src/utils/toolResultClassifier.js';

describe('isInputValidationError classification', () => {
  it('matches "InputValidationError" string', () => {
    const r = classify('InputValidationError: required field "description" missing', true);
    assert.equal(r.isInputValidationError, true);
    assert.equal(r.isPermissionDenied, false);
  });

  it('matches "<tool_use_error>" XML tag', () => {
    const r = classify('<tool_use_error>schema validation failed</tool_use_error>', true);
    assert.equal(r.isInputValidationError, true);
    assert.equal(r.isPermissionDenied, false);
  });

  it('case-insensitive — matches lowercase variants', () => {
    const r1 = classify('inputvalidationerror: foo', true);
    assert.equal(r1.isInputValidationError, true);
    const r2 = classify('<TOOL_USE_ERROR>oops</TOOL_USE_ERROR>', true);
    assert.equal(r2.isInputValidationError, true);
  });

  it('returns falsy when isError=false (regex match without error flag is ignored)', () => {
    const r = classify('InputValidationError mention in non-error block', false);
    assert.ok(!r.isInputValidationError, 'should be falsy');
  });

  it('returns falsy when resultText is empty/null', () => {
    // 原 regex chain 短路求值返回 falsy 值（如 ''）而非严格 false。下游用 truthy check，等价。
    assert.ok(!classify('', true).isInputValidationError);
    assert.ok(!classify(null, true).isInputValidationError);
    assert.ok(!classify(undefined, true).isInputValidationError);
  });

  it('mutual exclusion with isPermissionDenied — permission deny wins even if regex hit', () => {
    // 极端 case：服务端把 InputValidationError 与 "doesn't want to proceed" 都返回的混合文本
    const r = classify(
      "InputValidationError: User doesn't want to proceed with this tool use",
      true,
    );
    assert.ok(r.isPermissionDenied);
    assert.ok(!r.isInputValidationError, 'permission-denied takes precedence');
  });

  it('non-validation errors do not match (Read failure / Bash exit code)', () => {
    const r1 = classify('ENOENT: no such file or directory', true);
    assert.ok(!r1.isInputValidationError);
    const r2 = classify('exit code 1\nstderr: command not found', true);
    assert.ok(!r2.isInputValidationError);
  });

  it('isUltraplan flag — only set when permission denied AND mentions ultraplan', () => {
    const r1 = classify('User rejected tool use; switching to ultraplan mode', true);
    assert.ok(r1.isPermissionDenied);
    assert.ok(r1.isUltraplan);
    const r2 = classify("User doesn't want to proceed", true);
    assert.ok(r2.isPermissionDenied);
    assert.ok(!r2.isUltraplan);
  });
});
