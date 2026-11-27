/**
 * sdk-task-label.test.js — direct unit tests for the shared label predicate
 * exported by packages/core/src/sdk-task-label.js. Most consumers exercise
 * the happy paths indirectly (sdk-task-table / sdkTaskTracker / persist tests);
 * this file locks the guard branches and the terminal-scoping contract.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hasWireTaskLabel, hasTrackerTaskLabel } from '../src/sdk-task-label.js';

describe('@ccv/core/sdk-task-label — hasWireTaskLabel (server/wire shape)', () => {
  it('returns false for null/undefined/non-object inputs', () => {
    assert.equal(hasWireTaskLabel(null), false);
    assert.equal(hasWireTaskLabel(undefined), false);
    assert.equal(hasWireTaskLabel('string'), false);
    assert.equal(hasWireTaskLabel(42), false);
  });

  it('returns true for a terminal entry with a non-empty description', () => {
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, description: 'Done' }), true);
  });

  it('returns true for a terminal entry with a non-empty summary', () => {
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, summary: 'Result' }), true);
  });

  it('returns false for a terminal entry with no description AND no summary', () => {
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true }), false);
    assert.equal(hasWireTaskLabel({ status: 'failed', terminal: true }), false);
    assert.equal(hasWireTaskLabel({ status: 'stopped', terminal: true }), false);
    assert.equal(hasWireTaskLabel({ status: 'killed', terminal: true }), false);
  });

  it('returns false for a terminal entry whose labels are empty/whitespace strings', () => {
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, description: '' }), false);
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, summary: '   ' }), false);
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, description: '', summary: '' }), false);
  });

  it('returns true for a non-terminal entry regardless of label', () => {
    // In-flight rows stay visible so a later task_progress(description) can
    // still relabel them.
    assert.equal(hasWireTaskLabel({ status: 'running' }), true);
    assert.equal(hasWireTaskLabel({ status: 'pending' }), true);
    assert.equal(hasWireTaskLabel({ status: 'running', description: '' }), true);
  });

  it('honours the explicit terminal flag over the status word', () => {
    // terminal: true wins even if status word is not in the terminal set
    // (defensive — the server fold always sets both consistently, but an
    // older/hand-built payload may carry only the flag).
    assert.equal(hasWireTaskLabel({ terminal: true }), false);
    assert.equal(hasWireTaskLabel({ terminal: true, description: 'Labeled' }), true);
  });

  it('ignores non-string label fields (defensive)', () => {
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, description: 0 }), false);
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, summary: null }), false);
    assert.equal(hasWireTaskLabel({ status: 'completed', terminal: true, summary: {} }), false);
  });
});

describe('@ccv/core/sdk-task-label — hasTrackerTaskLabel (client tracker shape)', () => {
  it('returns false for null/undefined/non-object inputs', () => {
    assert.equal(hasTrackerTaskLabel(null), false);
    assert.equal(hasTrackerTaskLabel(undefined), false);
    assert.equal(hasTrackerTaskLabel('string'), false);
    assert.equal(hasTrackerTaskLabel(42), false);
  });

  it('returns true for a terminal row with a non-empty subject', () => {
    assert.equal(hasTrackerTaskLabel({ status: 'completed', subject: 'Done' }), true);
  });

  it('returns true for a terminal row with a non-empty description (the summary-mapped field)', () => {
    assert.equal(hasTrackerTaskLabel({ status: 'completed', description: 'Result' }), true);
  });

  it('returns false for a terminal row with no subject AND no description', () => {
    assert.equal(hasTrackerTaskLabel({ status: 'completed' }), false);
    assert.equal(hasTrackerTaskLabel({ status: 'failed' }), false);
  });

  it('returns false for a terminal row whose labels are empty/whitespace strings', () => {
    assert.equal(hasTrackerTaskLabel({ status: 'completed', subject: '' }), false);
    assert.equal(hasTrackerTaskLabel({ status: 'completed', description: '   ' }), false);
    assert.equal(hasTrackerTaskLabel({ status: 'completed', subject: '', description: '' }), false);
  });

  it('returns true for a non-terminal row regardless of label', () => {
    assert.equal(hasTrackerTaskLabel({ status: 'pending' }), true);
    assert.equal(hasTrackerTaskLabel({ status: 'in_progress' }), true);
    assert.equal(hasTrackerTaskLabel({ status: 'pending', subject: '' }), true);
    // Unknown/missing status → treated as not terminal (not in the client
    // terminal set {completed, failed}) → stays visible.
    assert.equal(hasTrackerTaskLabel({}), true);
    assert.equal(hasTrackerTaskLabel({ status: 'unknown' }), true);
  });

  it('ignores non-string label fields (defensive)', () => {
    assert.equal(hasTrackerTaskLabel({ status: 'completed', subject: 0 }), false);
    assert.equal(hasTrackerTaskLabel({ status: 'completed', description: null }), false);
    assert.equal(hasTrackerTaskLabel({ status: 'completed', description: {} }), false);
  });
});

describe('@ccv/core/sdk-task-label — shape dual', () => {
  it('wire shape and client shape agree on the same logical entry', () => {
    // Wire: description (title) + summary (terminal result). Client: subject
    // (title) + description (terminal result). A summary-bearing terminal entry
    // maps to a description-bearing terminal client row; both predicates keep it.
    const wire = { status: 'completed', terminal: true, summary: 'Find dispatch' };
    const client = { status: 'completed', subject: null, description: 'Find dispatch' };
    assert.equal(hasWireTaskLabel(wire), true);
    assert.equal(hasTrackerTaskLabel(client), true);
  });
});
