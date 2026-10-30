/**
 * server-sdk-attach-replay.test.js
 *
 * Source-anchor contract: the view-attach branch must replay ALL pending SDK approvals
 * (plan + ask + perm), not only plans. The old `{ planOnly: true }` call orphaned an
 * ask/perm raised before a workspace switch into a server-side timeout-deny — the user
 * switched back to find the modal gone and the question unanswerable. The full replay is
 * safe because (a) the replay helpers filter by the just-stamped view project+instance,
 * and (b) the frontend dedupes by id, so a re-replay never double-opens a modal.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');

describe('server attach replays all SDK pending approvals (R1)', () => {
  // The attach branch is the one that re-runs when an EXISTING connection re-stamps its
  // view (view switch) — distinguished from the initial-connect replay by the surrounding
  // "View changes use attach" comment.
  function attachWindow() {
    const idx = SERVER_SRC.indexOf('View changes use attach');
    assert.ok(idx > -1, 'attach branch exists');
    return SERVER_SRC.slice(idx, idx + 700);
  }

  it('the attach branch calls the full replay (no planOnly filter)', () => {
    const w = attachWindow();
    assert.match(w, /replaySdkPendingApprovals\(\);/, 'attach replays all approvals');
    assert.doesNotMatch(w, /replaySdkPendingApprovals\(\{\s*planOnly/, 'attach no longer passes planOnly');
  });

  it('the replay helper has no planOnly filter (full replay is the only mode)', () => {
    assert.doesNotMatch(SERVER_SRC, /planOnly/, 'planOnly was removed once full replay became universal');
  });
});
