/**
 * live-feed instance-scoped broadcast routing (2026-10-06, multi-instance).
 *
 * `_clientsForInstance(sessionInstance)` narrows a project's client set to the viewers of ONE
 * concurrent same-cwd instance, so instance A's entries never reach instance B's viewers.
 * Backward compatible: clients with no `_ccvViewInstance` stamp (legacy / single-instance
 * view) see every session; sessions with no stamped instance are visible to all.
 *
 * Unit-tests the pure routing predicate (no fs/PTY).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { V2LiveFeed } from '../server/lib/v2/live-feed.js';

// Build a feed with a stub client list and no clientFilter, then exercise the predicate.
function feedWith(clients) {
  const feed = new V2LiveFeed({ clients, getClaudePid: () => null, runParallelHook: null, wireV3: false, project: 'proj' });
  return feed;
}
const viewer = (instance) => ({ _ccvViewInstance: instance }); // a client viewing one instance
const plain = () => ({ _ccvViewProject: 'proj' });               // a legacy / project-only viewer

describe('live-feed _clientsForInstance (multi-instance routing)', () => {
  it('routes a session to only its own instance\'s viewers when instance viewers exist', () => {
    const a = viewer('ccv-aaa');
    const b = viewer('ccv-bbb');
    const feed = feedWith([a, b]);
    const forA = feed._clientsForInstance('ccv-aaa');
    assert.ok(forA.includes(a), 'instance A session reaches A viewer');
    assert.ok(!forA.includes(b), 'instance A session does NOT reach B viewer');
  });

  it('a session with no stamped instance is visible to ALL viewers (legacy/external)', () => {
    const a = viewer('ccv-aaa');
    const p = plain();
    const feed = feedWith([a, p]);
    const out = feed._clientsForInstance(null);
    assert.equal(out.length, 2, 'instanceless session broadcast to everyone');
  });

  it('when NO client is instance-scoped, the broadcast is the full project set (legacy parity)', () => {
    const p1 = plain();
    const p2 = plain();
    const feed = feedWith([p1, p2]);
    const out = feed._clientsForInstance('ccv-aaa'); // an instanced session, but no instance viewers
    assert.equal(out.length, 2, 'no instance viewer → no narrowing (single-instance byte-parity)');
  });

  it('a plain (project-only) viewer still sees an instanced session', () => {
    // A viewer that did NOT pick a specific instance keeps watching the whole project — the
    // instance filter only narrows clients that explicitly scoped themselves to an instance.
    const instViewer = viewer('ccv-aaa');
    const projectViewer = plain();
    const feed = feedWith([instViewer, projectViewer]);
    const out = feed._clientsForInstance('ccv-aaa');
    assert.ok(out.includes(projectViewer), 'project-only viewer still receives the instanced session');
    assert.ok(out.includes(instViewer), 'matching instance viewer receives it');
  });
});
