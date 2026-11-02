// Unit tests for src/utils/approvalDismissal.js — the dismiss-wipe policy that
// decides whether an approval frame reopens a minimised ApprovalModal.
//
// Regression guarded (fork review 2026-10-29): after a WS blip the server
// replays sdk-plan-pending as null → <same id>. The pending clear made prevId
// read null, so the old prevId === nextId guard fell through and WIPED the
// dismissal — reopening a modal the user had minimised. The policy must keep
// dismissals on the null → id transition and only wipe on a real id change.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldWipeApprovalDismissal } from '../src/utils/approvalDismissal.js';

describe('shouldWipeApprovalDismissal', () => {
  it('never reopens on a same-id re-bubble (id → same id)', () => {
    assert.equal(shouldWipeApprovalDismissal('p1', 'p1'), false);
  });

  it('never reopens on a clear of an empty slot (null → null)', () => {
    assert.equal(shouldWipeApprovalDismissal(null, null), false);
  });

  it('keeps the dismissal on a WS-reconnect replay (null → same id)', () => {
    // The blip cleared the pending to null; the replay brings the SAME id back.
    // Wiping here is exactly the bug — the minimised modal must stay minimised.
    assert.equal(shouldWipeApprovalDismissal(null, 'p1'), false);
  });

  it('keeps dismissals for a brand-new pending too (null → id, nothing to wipe)', () => {
    // A fresh plan id has no dismissal entry, so not wiping is a harmless no-op
    // AND it is what keeps the replay case (above) safe. Both share this edge.
    assert.equal(shouldWipeApprovalDismissal(null, 'brand-new'), false);
  });

  it('wipes when a new pending replaces a pending one (id → different id)', () => {
    // A genuinely new plan must not be suppressed by the previous plan's
    // dismissal — this is the only transition that reopens the modal.
    assert.equal(shouldWipeApprovalDismissal('p1', 'p2'), true);
  });

  it('wipes on a real clear of a pending (id → null)', () => {
    assert.equal(shouldWipeApprovalDismissal('p1', null), true);
  });
});
