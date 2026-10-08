/**
 * /resume per-project recent-sessions list (server/lib/v2/resume-list.js).
 *
 * Scoped to ONE project (the currently-bound one). Verifies: newest-first
 * ordering by meta.startTs; `limit` slicing; `sessionUuid` comes from
 * meta.sessionId (not the `<ts>_<uuid>` dir name); teammate / empty / quota-probe
 * sessions are excluded; `running` is derived from a fresh journal mtime
 * (injectable `now`); `pinnedId` is passed through verbatim from the project pin
 * file; rows from OTHER projects are never listed.
 *
 * Fixture pattern mirrors v2-session-list.test.js: V2Writer + mkdtempSync, with
 * CCV_LOG_DIR isolation handled by pointing the writer/aggregator at a temp dir.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { _resetForTest } from '../server/lib/v2/session-list.js';
import { listResumeSessions } from '../server/lib/v2/resume-list.js';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';
import { LIVE_SESSION_MTIME_MS } from '../server/lib/log-file-utils.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-resume-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID_A = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SID_B = 'b7772cc9-1bc8-56ab-cdfe-5d9a61b25495';
const SID_C = 'c5555cc9-2bc8-56ab-cdfe-5d9a61b25495';
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
const TOOLS = [{ name: 'Edit', input_schema: {} }];

let tsCounter = 0;
function nextTs() {
  return new Date(Date.UTC(2026, 6, 13, 5, 0, 0, ++tsCounter)).toISOString();
}

function mainEntry(messages, { sid, project }) {
  return {
    timestamp: nextTs(),
    project,
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-fable-5', system: SYSTEM, tools: TOOLS, metadata: { user_id: userIdOf(sid) }, messages },
    response: null,
    duration: 0,
    isStream: false,
    isHeartbeat: false,
    isCountTokens: false,
    mainAgent: true,
    requestId: `rid_${++tsCounter}`,
  };
}

function writerFor(project) {
  return new V2Writer({ logDir: dir, project, enabled: true, minFreeBytes: 0 });
}

async function seedSession(project, sid, prompt) {
  const w = writerFor(project);
  const e = mainEntry([textMsg('user', prompt)], { sid, project });
  const h = w.ingestRequest(e, e.body.messages);
  w.ingestCompletion(h, {
    ...e,
    response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } },
    duration: 42,
  });
  await w.flush();
  await w.close();
}

describe('listResumeSessions', () => {
  it('empty / missing project → empty result', () => {
    assert.deepEqual(listResumeSessions(join(dir, 'nope'), { project: 'projA' }), { items: [], total: 0 });
    assert.deepEqual(listResumeSessions(dir, { project: '' }), { items: [], total: 0 });
    assert.deepEqual(listResumeSessions(dir, {}), { items: [], total: 0 });
  });

  it('lists one project newest-first by startTs, with uuid from meta.sessionId', async () => {
    // Seed in an order that is NOT the recency order to prove the sort.
    await seedSession('projA', SID_A, 'alpha first');
    await seedSession('projA', SID_B, 'bravo second');
    await seedSession('projA', SID_C, 'charlie third');

    const { items, total } = listResumeSessions(dir, { project: 'projA', limit: 10 });
    assert.equal(total, 3);
    assert.equal(items.length, 3);
    // Newest startTs first: SID_C (last seeded) → SID_B → SID_A.
    assert.deepEqual(items.map(i => i.sessionUuid), [SID_C, SID_B, SID_A]);
    // sessionUuid is the CC uuid, not the dir name.
    for (const it2 of items) {
      assert.match(it2.file, /^v2:[^/]+\//);
      assert.ok(it2.sessionUuid && it2.sessionUuid.length === 36);
      assert.ok(Array.isArray(it2.preview));
      assert.equal(typeof it2.turns, 'number');
      assert.equal(typeof it2.running, 'boolean');
      assert.ok('pinnedId' in it2);
      assert.equal(it2.source, 'ccv');
      assert.equal(it2.project, 'projA', 'every row belongs to the queried project');
    }
  });

  it('never lists rows from other projects', async () => {
    await seedSession('projA', SID_A, 'in projA');
    await seedSession('projB', SID_B, 'in projB');
    const { items } = listResumeSessions(dir, { project: 'projA', limit: 10 });
    assert.deepEqual(items.map(i => i.sessionUuid), [SID_A], 'only projA rows are listed');
    assert.ok(items.every(i => i.project === 'projA'));
  });

  it('respects limit', async () => {
    await seedSession('projA', SID_A, 'one');
    await seedSession('projA', SID_B, 'two');
    await seedSession('projA', SID_C, 'three');
    const { items, total } = listResumeSessions(dir, { project: 'projA', limit: 2 });
    assert.equal(total, 2, 'total = surviving rows shown (top-N sliced before summarize)');
    assert.equal(items.length, 2);
    assert.deepEqual(items.map(i => i.sessionUuid), [SID_C, SID_B]);
  });

  it('excludes teammate sessions (meta.leader present)', async () => {
    await seedSession('projA', SID_A, 'leader session');
    // Write a teammate session: meta.leader set via writer leader opt.
    const w = new V2Writer({ logDir: dir, project: 'projA', enabled: true, minFreeBytes: 0, leader: { agentName: 'tm', teamName: 'team' } });
    const e = mainEntry([textMsg('user', 'teammate turn')], { sid: SID_B, project: 'projA' });
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    await w.close();

    const { items } = listResumeSessions(dir, { project: 'projA', limit: 10 });
    assert.deepEqual(items.map(i => i.sessionUuid), [SID_A], 'teammate session must be folded out');
  });

  it('running reflects journal mtime within LIVE_SESSION_MTIME_MS (injected now)', async () => {
    await seedSession('projA', SID_A, 'active');
    const freshNow = Date.now();
    const live = listResumeSessions(dir, { project: 'projA', limit: 10, now: freshNow });
    assert.equal(live.items[0].running, true, 'just-written session is live');
    const laterNow = freshNow + LIVE_SESSION_MTIME_MS + 60000;
    const stale = listResumeSessions(dir, { project: 'projA', limit: 10, now: laterNow });
    assert.equal(stale.items[0].running, false, 'session idle past the window is not live');
  });

  it('passes the project pin value through as pinnedId (verbatim)', async () => {
    await seedSession('projA', SID_A, 'pinned target');
    const projDir = join(dir, 'projA');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, '.session-pin.json'), JSON.stringify({ pinnedSessionId: 'ts-stable-id-xyz' }));
    const { items } = listResumeSessions(dir, { project: 'projA', limit: 10 });
    assert.equal(items[0].pinnedId, 'ts-stable-id-xyz');
  });

  it('quota-probe orphan dirs never occupy a top-limit slot (filtered before slice)', async () => {
    // Regression: quota probes (no main/teammate req → discard) used to be sliced
    // into the top-`limit` by recency and only then dropped, crowding real rows
    // out of the list. The aggregator now drops them up front via a bounded
    // journal head-scan (sessionHasMainOrTeammateReq) BEFORE the top-N slice.
    // Seed one real ccv session, then a fresh probe dir.
    await seedSession('projA', SID_A, 'real session');
    // A probe dir: journal with a single max_tokens=1 sub req and no main kind.
    const probeDir = join(dir, 'projA', 'sessions', '99999999999999_quota-probe');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'meta.json'), JSON.stringify({
      startTs: '9999-12-31T00:00:00.000Z', sessionId: SID_C, wireFormat: 2,
    }));
    writeFileSync(join(probeDir, 'journal.jsonl'),
      JSON.stringify({ ph: 'meta', wireFormat: 2, sessionId: SID_C }) + '\n' +
      JSON.stringify({ ph: 'req', seq: 1, rid: '1', ts: '9999-12-31T00:00:00.000Z', kind: 'sub', params: { max_tokens: 1 } }) + '\n');

    // limit=1: the probe is newest by startTs, but must NOT win the slot — it is
    // filtered by the pre-slice discard check, so the real session still shows.
    const { items, total } = listResumeSessions(dir, { project: 'projA', limit: 1 });
    assert.equal(items.length, 1);
    assert.equal(items[0].sessionUuid, SID_A, 'probe must be filtered before the slice');
    assert.equal(total, 1, 'probe must not count toward total');
  });

  it('writer routes a self-reported project to entry._resumeProject, not the bound project', async () => {
    // The writer is bound to projBound (the ccv process cwd project), but this
    // request carries a _resumeProject override (set by the interceptor from the
    // x-ccv-project-dir header every main PTY self-reports). The write must land
    // under the override project — this keeps parallel background projects' writes
    // routed to their own store.
    const w = new V2Writer({ logDir: dir, project: 'projBound', enabled: true, minFreeBytes: 0 });
    const e = mainEntry([textMsg('user', 'resume into other project')], { sid: SID_A, project: 'projBound' });
    e._resumeProject = 'projOther';
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    await w.close();

    // The session dir exists under projOther, not projBound.
    assert.ok(resolveSessionDirName(join(dir, 'projOther'), SID_A), 'write landed under the override project');
    assert.equal(resolveSessionDirName(join(dir, 'projBound'), SID_A), null, 'no dir minted under the bound project');
  });

  it('writer ignores a stale/foreign entry.project when no _resumeProject is set', async () => {
    // Regression guard: a generic entry.project that diverges from the bound
    // project (fixtures, teammate reshuffles) must NOT reroute the write — only
    // the explicit _resumeProject marker does.
    const w = new V2Writer({ logDir: dir, project: 'projBound', enabled: true, minFreeBytes: 0 });
    const e = mainEntry([textMsg('user', 'normal turn')], { sid: SID_B, project: 'someStaleProject' });
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 });
    await w.flush();
    await w.close();

    assert.ok(resolveSessionDirName(join(dir, 'projBound'), SID_B), 'write stays under the bound project');
    assert.equal(resolveSessionDirName(join(dir, 'someStaleProject'), SID_B), null, 'stale entry.project did not reroute');
  });
});
