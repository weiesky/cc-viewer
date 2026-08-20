// pty-manager deep coverage — the pure-function and no-pty branches the gap suite
// (pty-manager-gap.test.js) leaves uncovered: withDefaultThinkingDisplay's three arms, the
// thinking-display rejected-path set helpers, and writeToPtySequential's early-return when no
// PTY is live. No real PTY needed for these; the gap suite already covers spawn paths via the
// mock-import seam.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  withDefaultThinkingDisplay,
  _clearThinkingDisplayRejectedPaths,
  _isThinkingDisplayRejected,
  _markThinkingDisplayRejected,
  writeToPtySequential,
  writeToPty,
  killPty,
  getPtyState,
} from '../server/pty-manager.js';

describe('withDefaultThinkingDisplay', () => {
  it('returns the input unchanged when it is not an array', () => {
    assert.equal(withDefaultThinkingDisplay(null), null);
    assert.equal(withDefaultThinkingDisplay(undefined), undefined);
    const obj = { not: 'array' };
    assert.equal(withDefaultThinkingDisplay(obj), obj);
  });

  it('appends --thinking-display summarized when the flag is absent', () => {
    const out = withDefaultThinkingDisplay(['--print', '-c']);
    assert.deepEqual(out, ['--print', '-c', '--thinking-display', 'summarized']);
  });

  it('leaves args untouched when --thinking-display is already present (separate token)', () => {
    const args = ['--thinking-display', 'full'];
    const out = withDefaultThinkingDisplay(args);
    assert.deepEqual(out, args);
  });

  it('leaves args untouched when --thinking-display=… is present (equals form)', () => {
    const args = ['--thinking-display=detailed', '--print'];
    const out = withDefaultThinkingDisplay(args);
    assert.deepEqual(out, args);
  });

  it('returns a NEW array (does not mutate the input) when injecting', () => {
    const args = ['--print'];
    const out = withDefaultThinkingDisplay(args);
    assert.notEqual(out, args);
    assert.deepEqual(args, ['--print'], 'input not mutated');
  });
});

describe('thinking-display rejected-path set', () => {
  beforeEach(() => _clearThinkingDisplayRejectedPaths());

  it('marks a path as rejected and reports it', () => {
    assert.equal(_isThinkingDisplayRejected('/path/to/claude'), false);
    _markThinkingDisplayRejected('/path/to/claude');
    assert.equal(_isThinkingDisplayRejected('/path/to/claude'), true);
  });

  it('clear() empties the set', () => {
    _markThinkingDisplayRejected('/a');
    _markThinkingDisplayRejected('/b');
    _clearThinkingDisplayRejectedPaths();
    assert.equal(_isThinkingDisplayRejected('/a'), false);
    assert.equal(_isThinkingDisplayRejected('/b'), false);
  });
});

describe('writeToPtySequential with no live PTY', () => {
  beforeEach(() => { try { killPty(); } catch { /* none */ } });

  it('invokes onComplete(false) immediately when there is no PTY process', () => {
    assert.equal(getPtyState().running, false, 'precondition: no PTY');
    let called = null;
    writeToPtySequential(['hello'], (ok) => { called = ok; });
    assert.equal(called, false, 'onComplete(false) on the no-pty early return');
  });

  it('does not throw when onComplete is omitted and no PTY is live', () => {
    assert.doesNotThrow(() => writeToPtySequential(['x']));
  });

  it('writeToPty is a no-op (no throw) when no PTY is live', () => {
    assert.doesNotThrow(() => writeToPty('data'));
  });
});
