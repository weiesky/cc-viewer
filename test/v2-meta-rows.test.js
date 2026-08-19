/**
 * V3.S2 — readV2RequestsMeta unit tests (direct new-server-script coverage).
 * Pins: row shape (top-level timestamp/url), done-line usage mapping,
 * inProgress, windowing (limit/before/hasMore), typeTag via shared
 * classifyRequest, cacheLoss reasons incl. the server-side ttl fix (the
 * client's string-minus-string NaN never fires), passB:false skip, and the
 * deliberate mainAgent divergence (kind-based, not body-looking).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-meta-rows-'));
process.env.CCV_LOG_DIR = tmpRoot;
process.env.CLAUDE_CONFIG_DIR = tmpRoot;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const { V2Writer } = await import('../packages/app/server/lib/v2/v2-writer.js');
const { readV2RequestsMeta } = await import('../packages/app/server/lib/v2/meta-rows.js');
const { resolveSessionDirName } = await import('../packages/app/server/lib/v2/session-select.js');

const SID = 'a1a2a3a4-2222-4333-8444-000000000002';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const SYS = [{ type: 'text', text: 'You are Claude Code test system.' }];
const TOOLS_A = [{ name: 'Bash', description: 'tool set A' }];
const TOOLS_B = [{ name: 'Bash', description: 'tool set B (changed)' }];

const project = 'metaproj';
let sessionDir;

function entryOf(i, messages, { tools = TOOLS_A, mainAgent = true, system = SYS, ts = null } = {}) {
  return {
    timestamp: ts || `2026-07-16T10:00:0${i}.000Z`,
    project,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: {},
    body: { model: 'claude-fable-5', system, tools, metadata: { user_id: USER_ID }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
    mainAgent, requestId: `rid_${i}`,
  };
}

before(async () => {
  const w = new V2Writer({ logDir: tmpRoot, project, enabled: true, minFreeBytes: 0 });
  const fire = (e, usage, { complete = true } = {}) => {
    const h = w.ingestRequest(e, e.body.messages);
    if (complete) w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage } }, duration: 42 });
  };
  const t1 = [textMsg('user', 'turn 1')];
  const t2 = [...t1, textMsg('assistant', 'r1'), textMsg('user', 'turn 2')];
  const t3 = [...t2, textMsg('assistant', 'r2'), textMsg('user', 'turn 3')];
  // seq1: main checkpoint
  fire(entryOf(0, t1), { input_tokens: 10, output_tokens: 5 });
  // seq2: main delta, tools changed, cache-create dominant → cacheLoss tools_change
  fire(entryOf(1, t2, { tools: TOOLS_B }), { input_tokens: 20, output_tokens: 6, cache_creation_input_tokens: 100, cache_read_input_tokens: 0 });
  // seq3: main delta 10 minutes later, same body shape → ttl (server-side fix)
  fire(entryOf(2, t3, { tools: TOOLS_B, ts: '2026-07-16T10:11:00.000Z' }), { input_tokens: 30, output_tokens: 7, cache_creation_input_tokens: 90, cache_read_input_tokens: 1 });
  // seq4: sub-agent request
  fire(entryOf(3, [textMsg('user', 'sub work')], { mainAgent: false, system: [{ type: 'text', text: 'You are a helper subagent.' }], ts: '2026-07-16T10:11:30.000Z' }), { input_tokens: 3, output_tokens: 1 });
  // seq5: in-flight (no completion)
  fire(entryOf(5, [...t3, textMsg('assistant', 'r3'), textMsg('user', 'turn 4')], { tools: TOOLS_B, ts: '2026-07-16T10:12:00.000Z' }), null, { complete: false });
  await w.flush();
  const basename = resolveSessionDirName(join(tmpRoot, project), SID) || SID;
  sessionDir = join(tmpRoot, project, 'sessions', basename);
});

after(() => { rmSync(join(tmpRoot, project), { recursive: true, force: true }); });

describe('readV2RequestsMeta (V3.S2 unit)', () => {
  it('folds journal req+done into rows with top-level timestamp/url and mapped usage', async () => {
    const { rows, totalCount, hasMore, oldestTimestamp } = await readV2RequestsMeta(sessionDir, {});
    assert.equal(totalCount, 5);
    assert.equal(hasMore, false);
    assert.equal(rows.length, 5);
    assert.equal(oldestTimestamp, rows[0].timestamp);
    for (const r of rows) {
      assert.match(r.timestamp, /^2026-07-16T/); // top-level `timestamp`, not `ts`
      assert.ok(r.url.startsWith('https://'));
      assert.ok(Number.isInteger(r.seq));
    }
    assert.deepEqual(rows[1].usage, { input_tokens: 20, output_tokens: 6, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 });
    assert.equal(rows[1].status, 200);
    assert.equal(rows[1].duration, 42);
    assert.equal(rows[1].inProgress, false);
  });

  it('marks the never-completed request inProgress', async () => {
    const { rows } = await readV2RequestsMeta(sessionDir, {});
    const last = rows[rows.length - 1];
    assert.equal(last.inProgress, true);
    assert.equal(last.usage, null);
    assert.equal(last.status, undefined);
  });

  it('typeTag comes from the shared classifyRequest; mainAgent is kind-derived', async () => {
    const { rows } = await readV2RequestsMeta(sessionDir, {});
    assert.equal(rows[0].typeTag?.type, 'MainAgent');
    assert.equal(rows[0].mainAgent, true);
    const sub = rows.find((r) => r.kind === 'sub');
    assert.ok(sub, 'sub row present');
    assert.equal(sub.mainAgent, false);
    assert.equal(sub.typeTag?.type, 'SubAgent');
  });

  it('cacheLoss: tools_change on adjacent mains; ttl fires with parsed timestamps (client NaN-gap fixed)', async () => {
    const { rows } = await readV2RequestsMeta(sessionDir, {});
    assert.ok(rows[1].cacheLoss, 'second main has cache-create dominant usage');
    assert.ok(rows[1].cacheLoss.reasons.includes('tools_change'), JSON.stringify(rows[1].cacheLoss));
    assert.equal(rows[2].cacheLoss?.reason, 'ttl', '10-minute gap → ttl (server-side Date.parse fix)');
  });

  it('windowing: tail-limit + before + hasMore', async () => {
    const { rows, hasMore, totalCount } = await readV2RequestsMeta(sessionDir, { limit: 2 });
    assert.equal(totalCount, 5);
    assert.equal(hasMore, true);
    assert.equal(rows.length, 2);
    const { rows: beforeRows } = await readV2RequestsMeta(sessionDir, { before: '2026-07-16T10:11:00.000Z' });
    assert.equal(beforeRows.length, 2, 'only the first two mains precede the ttl turn');
  });

  it('passB:false returns journal-only rows (typeTag/cacheLoss deferred)', async () => {
    const { rows } = await readV2RequestsMeta(sessionDir, { passB: false });
    assert.ok(rows.every((r) => r.typeTag === null && r.cacheLoss === null));
    assert.equal(rows[0].mainAgent, true, 'kind-derived flag still present');
  });

  it('since scopes the delta window; nokey rows always resend (review P1-2)', async () => {
    const { rows, totalCount } = await readV2RequestsMeta(sessionDir, { since: '2026-07-16T10:11:00.000Z', passB: false });
    assert.equal(totalCount, 5, 'totalCount reflects the pre-since window');
    assert.ok(rows.length < 5 && rows.length >= 3, `since filtered: got ${rows.length}`);
    assert.ok(rows.every((r) => !r.timestamp || r.timestamp >= '2026-07-16T10:11:00.000Z'));
  });
});

describe('teammate fold + sid disambiguation (review F2)', () => {
  const TM_SID = 'b1b2b3b4-3333-4444-8555-000000000003';
  let leaderDir;

  before(async () => {
    const { writeFileSync, readFileSync } = await import('node:fs');
    // teammate session in the same project, then stamp meta.leader pointing
    // at the leader UUID (the writer contract: interceptor records
    // parentSessionId; the readers key on it — adapter.js:618)
    const w = new V2Writer({ logDir: tmpRoot, project, enabled: true, minFreeBytes: 0 });
    const e = entryOf(0, [textMsg('user', 'teammate work')], { ts: '2026-07-16T10:20:00.000Z' });
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: TM_SID }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 2, output_tokens: 1 } } }, duration: 4 });
    await w.flush();
    const tmBase = resolveSessionDirName(join(tmpRoot, project), TM_SID) || TM_SID;
    const metaPath = join(tmpRoot, project, 'sessions', tmBase, 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    meta.leader = { parentSessionId: SID, agentName: 'tm1' };
    writeFileSync(metaPath, JSON.stringify(meta));
    leaderDir = sessionDir;
  });

  it('teammate rows fold into the leader window with mainAgent=false and the teammate name', async () => {
    const { rows } = await readV2RequestsMeta(leaderDir, {});
    const tmRow = rows.find((r) => r.sessionId === TM_SID);
    assert.ok(tmRow, 'teammate row folded in');
    assert.equal(tmRow.mainAgent, false, 'kind main inside a teammate dir is NOT mainAgent');
    assert.equal(tmRow.teammate, 'tm1', 'v1 contract: teammate = agentName string | true');
    assert.equal(tmRow.kind, 'main', 'journal kind preserved; the dir meta demotes it');
  });

  it('readV2SingleEntry sid param disambiguates the same seq across leader and teammate dirs', async () => {
    const { readV2SingleEntry } = await import('../packages/app/server/lib/v2/adapter.js');
    const leader = await readV2SingleEntry(leaderDir, { seq: 1, sessionId: SID, cached: false });
    const teammate = await readV2SingleEntry(leaderDir, { seq: 1, sessionId: TM_SID, cached: false });
    assert.ok(leader && teammate);
    const lMsg = JSON.parse(leader.entry).body.messages[0].content[0].text;
    const tMsg = JSON.parse(teammate.entry).body.messages[0].content[0].text;
    assert.equal(lMsg, 'turn 1');
    assert.equal(tMsg, 'teammate work');
  });
});

// ─── quota-check classification via restored params (2026-07-16) ──────────────
// isQuotaCheck reads body.max_tokens; before req.params existed the v2-rebuilt
// body lacked it, so quota probes fell through to SubAgent. With params the
// row re-classifies as Count:Quota — matching V1, where the body was full.
describe('quota probe typeTag via req.params', () => {
  const qProject = 'quotaproj';
  let qDir;

  before(async () => {
    const w = new V2Writer({ logDir: tmpRoot, project: qProject, enabled: true, minFreeBytes: 0 });
    const main = entryOf(0, [textMsg('user', 'bind session')]);
    const hm = w.ingestRequest(main, main.body.messages);
    w.ingestCompletion(hm, { ...main, response: { status: 200, headers: {}, body: { content: [], usage: {} } }, duration: 1 });
    const quota = {
      timestamp: '2026-07-16T10:20:00.000Z',
      project: qProject,
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {},
      body: { model: 'claude-haiku-4-5-20251001', max_tokens: 1, metadata: { user_id: USER_ID }, messages: [{ role: 'user', content: 'quota' }] },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
      mainAgent: false, requestId: 'rid_quota',
    };
    const hq = w.ingestRequest(quota, quota.body.messages);
    w.ingestCompletion(hq, { ...quota, response: { status: 200, headers: {}, body: { content: [], usage: {} } }, duration: 1 });
    await w.flush();
    const basename = resolveSessionDirName(join(tmpRoot, qProject), SID) || SID;
    qDir = join(tmpRoot, qProject, 'sessions', basename);
  });

  after(() => { rmSync(join(tmpRoot, qProject), { recursive: true, force: true }); });

  it('quota probe row classifies as Count:Quota (V1 parity)', async () => {
    const { rows } = await readV2RequestsMeta(qDir, {});
    const quotaRow = rows.find((r) => r.url.endsWith('/v1/messages') && r.seq === 2);
    assert.ok(quotaRow, 'quota row present');
    assert.equal(quotaRow.typeTag?.type, 'Count');
    assert.equal(quotaRow.typeTag?.subType, 'Quota');
  });
});

// ─── Pass B 双信号（2026-08-05 回归：2.1.199 subagent 也被授予 SendMessage，
// cc_is_subagent / agent 形态是硬判据）─────────────────────────────────────
describe('Pass B wire-agent classification', () => {
  const SID2 = '22223333-4444-5555-6666-777788889999';
  const USER2 = JSON.stringify({ device_id: 'd2', account_uuid: 'a', session_id: SID2 });
  let dir2;

  before(async () => {
    const w = new V2Writer({ logDir: tmpRoot, project, enabled: true, minFreeBytes: 0 });
    const mkEntry = (i, { system, tools, mainAgent = false, headers = {}, ts = null }) => ({
      timestamp: ts || `2026-08-05T00:00:0${i}.000Z`,
      project,
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers,
      body: { model: 'deepseek-v4-flash', system, tools, metadata: { user_id: USER2 }, messages: [textMsg('user', `turn ${i}`)] },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
      mainAgent, requestId: `rid2_${i}`,
    });
    const fire = (e) => { const h = w.ingestRequest(e, e.body.messages); w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage: {} } }, duration: 42 }); };
    // anon subagent: SDK prompt + SendMessage tool + cc_is_subagent=true billing (the Explore shape)
    fire(mkEntry(1, {
      system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.199.cc8; cc_is_subagent=true;' }, { type: 'text', text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.' }, { type: 'text', text: 'You are a file search specialist for Claude Code.' }],
      tools: [{ name: 'Bash' }, { name: 'SendMessage' }],
      headers: { 'x-claude-code-agent-id': 'a7eea0a140349f80d' },
    }));
    // named teammate: SDK prompt + SendMessage, billing WITHOUT cc_is_subagent, named wire id
    fire(mkEntry(2, {
      system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.199.7a6; cc_entrypoint=cli;' }, { type: 'text', text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.' }],
      tools: [{ name: 'Bash' }, { name: 'SendMessage' }],
      headers: { 'x-claude-code-agent-id': 'frontend-reviewer@session-abc' },
    }));
    await w.flush();
    const basename = resolveSessionDirName(join(tmpRoot, project), SID2) || SID2;
    dir2 = join(tmpRoot, project, 'sessions', basename);
  });

  it('anon subagent (cc_is_subagent + SendMessage) → SubAgent, never Teammate', async () => {
    const { rows } = await readV2RequestsMeta(dir2, {});
    const anon = rows[0];
    assert.equal(anon.typeTag.type, 'SubAgent');
    assert.equal(anon.typeTag.subType, 'Search', 'file search specialist → role tag Search');
    assert.equal(anon.agent.agentName, null);
  });

  it('named teammate → Teammate with the persisted name as subType', async () => {
    const { rows } = await readV2RequestsMeta(dir2, {});
    const named = rows[1];
    assert.equal(named.typeTag.type, 'Teammate');
    assert.equal(named.typeTag.subType, 'frontend-reviewer', 'agent name surfaced as the Teammate subType');
    assert.equal(named.agent.agentName, 'frontend-reviewer');
  });

  it('SubAgent role tag is NOT overwritten by an agent name (withAgentNameSubType Teammate-only)', async () => {
    const { rows } = await readV2RequestsMeta(dir2, {});
    // anon row is SubAgent:Search — if the name override leaked to SubAgent it
    // would be null; assert the role tag survived.
    assert.equal(rows[0].typeTag.subType, 'Search');
  });
});
