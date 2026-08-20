/**
 * stats-worker (wire-v2, stats schema v9) — worker-thread integration tests.
 *
 * The scan unit is a v2 session directory: counts/usage come from journal
 * req/done lines, previews from conversations/main/e<N>.jsonl event slices.
 * Fixtures are hand-written journal/conv lines (full control over msgTo/
 * epoch/usage shapes) plus one REAL V2Writer round-trip pinning that the
 * hand-written format matches what the writer actually produces.
 *
 * Data-safety: all fixtures live in private tmp dirs; nothing touches a real
 * CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSessionDirName } from '../server/lib/v2/session-select.js';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { V2Writer } from '../server/lib/v2/v2-writer.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WORKER_PATH = join(__dirname, '..', 'server', 'lib', 'stats-worker.js');

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Spawn worker, send a message, collect responses until expectedType is received */
function runWorker(msg, expectedType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    const messages = [];
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`Timeout waiting for ${expectedType}, got: ${JSON.stringify(messages)}`));
    }, timeout);

    worker.on('message', (m) => {
      messages.push(m);
      if (m.type === expectedType) {
        clearTimeout(timer);
        worker.terminate();
        resolve(messages);
      }
    });
    worker.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.postMessage(msg);
  });
}

// ─── v2 session fixture builder (hand-written journal/conv lines) ────────────

function makeSession(projectDir, sid, { requests = [], convEvents = [] } = {}) {
  const dir = join(projectDir, 'sessions', sid);
  mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid: 1, startTs: '2026-07-14T00:00:00.000Z' }));
  const lines = [JSON.stringify({ ph: 'meta', wireFormat: 2 })];
  for (const r of requests) {
    const { _done, ...req } = r;
    lines.push(JSON.stringify({ ph: 'req', ...req }));
    if (_done) lines.push(JSON.stringify({ ph: 'done', seq: r.seq, ts: r.ts, status: 'ok', ...(_done === true ? {} : _done) }));
  }
  writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
  const byEpoch = new Map();
  for (const ev of convEvents) {
    const e = ev.epoch || 0;
    if (!byEpoch.has(e)) byEpoch.set(e, []);
    const { epoch, ...rest } = ev;
    byEpoch.get(e).push(JSON.stringify(rest));
  }
  for (const [e, evLines] of byEpoch) {
    writeFileSync(join(dir, 'conversations', 'main', `e${e}.jsonl`), evLines.join('\n') + '\n');
  }
  return dir;
}

/** Shorthand main request journal line. */
function mainReq(seq, msgTo, { model = 'claude-fable-5', epoch = 0, usage = null, kind = 'main' } = {}) {
  return {
    seq,
    rid: `r${seq}`,
    ts: `2026-07-14T00:00:0${Math.min(seq, 9)}.000Z`,
    kind,
    conv: 'main',
    epoch,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    model,
    msgFrom: 0,
    msgTo,
    _done: usage ? { usage, dur: 10 } : true,
  };
}

const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] });

describe('stats-worker v2: session parsing via init', () => {
  let logDir;
  beforeEach(() => { logDir = makeTmpDir(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('parses models and usage from journal req/done lines', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-1', {
      requests: [
        mainReq(1, 1, { model: 'mA', usage: { in: 100, out: 50, cr: 30, cw: 10 } }),
        mainReq(2, 3, { model: 'mA', usage: { out: 5, cw: 7 } }),
        mainReq(3, 3, { model: 'mB' }), // done without usage
        { seq: 4, rid: 'r4', ts: '2026-07-14T00:00:04.000Z', kind: 'heartbeat', url: 'https://api.anthropic.com/api/eval/sdk-x', method: 'POST' }, // no model, no done
      ],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [userMsg('hello world')] },
        { seq: 2, t: 'append', msgs: [{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, userMsg('second turn')] },
      ],
    });

    const messages = await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    assert.ok(messages.some(m => m.type === 'init-done'));

    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats._v, 12);
    // v10: per-unit size = recursive session-dir bytes; journalSize = cache key.
    const sizedUnit = Object.values(stats.files)[0];
    assert.ok(sizedUnit.size >= sizedUnit.journalSize, 'folder size includes journal + conv/blob files');
    assert.ok(sizedUnit.journalSize > 0);
    assert.equal(stats.summary.requestCount, 4);
    assert.equal(stats.summary.input_tokens, 100);
    assert.equal(stats.summary.output_tokens, 55);
    assert.equal(stats.summary.cache_read_input_tokens, 30);
    assert.equal(stats.summary.cache_creation_input_tokens, 17);
    assert.equal(stats.models['mA'], 2);
    assert.equal(stats.models['mB'], 1);
    assert.equal(stats.summary.fileCount, 1);
    const unit = stats.files['sessions/sid-1'];
    assert.ok(unit, 'unit keyed by sessions/<sid>');
    assert.deepEqual(unit.preview, ['hello world', 'second turn']);
  });

  it('restart continuation in the SAME epoch does not inflate sessionCount (epoch seeding, 2026-07-15)', async () => {
    const projectDir = join(logDir, 'proj');
    // Journal shape a post-fix restarted writer produces: epochs 0,0 then a
    // /clear into 1, then the RESTARTED generation continues in epoch 1 with a
    // fresh snapshot — sessionCount must stay 2 (distinct epochs), not grow.
    makeSession(projectDir, 'sid-1', {
      requests: [
        mainReq(1, 1),
        mainReq(2, 3),
        mainReq(3, 1, { epoch: 1 }),           // /clear
        mainReq(4, 2, { epoch: 1, evt: 'snapshot' }), // restart snapshot, SAME epoch
        mainReq(5, 4, { epoch: 1 }),
      ],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [userMsg('one')] },
        { seq: 2, t: 'append', msgs: [{ role: 'assistant', content: 'r' }, userMsg('two')] },
        { seq: 3, t: 'snapshot', epoch: 1, msgs: [userMsg('post clear')] },
        { seq: 4, t: 'snapshot', epoch: 1, msgs: [userMsg('post clear'), { role: 'assistant', content: 'r' }] },
        { seq: 5, t: 'append', epoch: 1, msgs: [{ role: 'assistant', content: 'r2' }, userMsg('after restart')] },
      ],
    });
    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.files['sessions/sid-1'].summary.sessionCount, 2,
      'restart continues an EXISTING epoch — no phantom session');
  });

  it('counts turns from msgTo growth and sessions from distinct epochs (/clear)', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-1', {
      requests: [
        mainReq(1, 1),
        mainReq(2, 3),
        mainReq(3, 3),  // unchanged wire → not a new turn
        mainReq(4, 1, { epoch: 1 }), // /clear: shrink resets tracking, new epoch
        mainReq(5, 3, { epoch: 1 }),
      ],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [userMsg('turn one')] },
        { seq: 2, t: 'append', msgs: [{ role: 'assistant', content: 'r' }, userMsg('turn two')] },
        { seq: 4, t: 'snapshot', epoch: 1, msgs: [userMsg('after clear')] },
        { seq: 5, t: 'append', epoch: 1, msgs: [{ role: 'assistant', content: 'r' }, userMsg('post clear turn')] },
      ],
    });

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    // Turns: seq1 (1>0), seq2 (3>1), seq4 (shrink of 3→1 is below the >4 gap
    // threshold, but 1<3 so not a new turn either), seq5 (3 not > 3) — the v1
    // formula counts growth beyond the running max: seq1 + seq2 = 2 turns,
    // then epoch 1 wire never exceeds max 3 → stays 2... unless the shrink
    // reset fires. With maxMsgLen 3 → len 1: 1 < 1.5 but gap 2 ≤ 4 → NO reset
    // (v1 behavior for short sessions) → total turns = 2.
    assert.equal(stats.summary.turnCount, 2);
    assert.equal(stats.summary.sessionCount, 2, 'two epochs = two v1-style sessions');
    assert.deepEqual(stats.files['sessions/sid-1'].preview,
      ['turn one', 'turn two', 'after clear', 'post clear turn']);
  });

  it('a real /clear-scale shrink resets turn tracking', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-1', {
      requests: [
        mainReq(1, 12),                 // long-running conversation
        mainReq(2, 1, { epoch: 1 }),    // /clear: 1 < 6 and gap 11 > 4 → reset
        mainReq(3, 3, { epoch: 1 }),
      ],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [userMsg('long history')] },
        { seq: 2, t: 'snapshot', epoch: 1, msgs: [userMsg('fresh start')] },
        { seq: 3, t: 'append', epoch: 1, msgs: [{ role: 'assistant', content: 'r' }, userMsg('next')] },
      ],
    });
    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.summary.turnCount, 3, 'reset makes post-clear growth count again');
  });

  it('SUGGESTION MODE requests are excluded from turns and previews', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-1', {
      requests: [mainReq(1, 1), mainReq(2, 2)],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [userMsg('real prompt')] },
        { seq: 2, t: 'append', msgs: [userMsg('[SUGGESTION MODE: predict the next input]')] },
      ],
    });
    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.summary.turnCount, 1);
    assert.deepEqual(stats.files['sessions/sid-1'].preview, ['real prompt']);
  });

  it('strips system tags from previews and dedups repeated snapshot texts', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-1', {
      requests: [mainReq(1, 1), mainReq(2, 1)],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [{ role: 'user', content: '<system-reminder>noise</system-reminder>fix the bug' }] },
        // cache_control migration style mid-epoch snapshot repeats the state
        { seq: 2, t: 'snapshot', msgs: [{ role: 'user', content: '<system-reminder>noise</system-reminder>fix the bug' }] },
        // replace-tail ctl carries the swapped tail as .msg — collected too
        { seq: 3, t: 'ctl', op: 'replace-tail', msg: { role: 'user', content: 'probe swapped real' } },
      ],
    });
    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.deepEqual(stats.files['sessions/sid-1'].preview, ['fix the bug', 'probe swapped real']);
  });

  it('tolerates malformed journal lines and sessions without conversations', async () => {
    const projectDir = join(logDir, 'proj');
    const dir = makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { usage: { in: 1, out: 2 } })], convEvents: [{ seq: 1, t: 'snapshot', msgs: [userMsg('x')] }] });
    appendFileSync(join(dir, 'journal.jsonl'), '{broken json\n');
    makeSession(projectDir, 'sid-2', { requests: [mainReq(1, 1, { model: 'mC' })] }); // no conv events at all
    rmSync(join(projectDir, 'sessions', 'sid-2', 'conversations'), { recursive: true, force: true });

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.summary.requestCount, 2);
    assert.equal(stats.models['mC'], 1);
    assert.equal(stats.summary.fileCount, 2);
  });

  it('a project without any v2 session writes no stats file', async () => {
    const projectDir = join(logDir, 'proj');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'legacy.jsonl'), JSON.stringify({ body: { model: 'old' } }));
    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    assert.equal(existsSync(join(projectDir, 'proj.json')), false, 'v1-only projects are no longer counted');
  });
});

describe('stats-worker v2: incremental update & scan-all', () => {
  let logDir;
  beforeEach(() => { logDir = makeTmpDir(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('unchanged sessions are reused from cache; the updated unit is re-parsed', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-1', {
      requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })],
      convEvents: [{ seq: 1, t: 'snapshot', msgs: [userMsg('one')] }],
    });
    const dir2 = makeSession(projectDir, 'sid-2', {
      requests: [mainReq(1, 1, { model: 'mB', usage: { in: 2, out: 2 } })],
      convEvents: [{ seq: 1, t: 'snapshot', msgs: [userMsg('two')] }],
    });
    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');

    // Append a new request to sid-2 only.
    appendFileSync(join(dir2, 'journal.jsonl'),
      JSON.stringify({ ph: 'req', seq: 2, rid: 'r2', ts: '2026-07-14T00:00:09.000Z', kind: 'main', conv: 'main', epoch: 0, url: 'https://api.anthropic.com/v1/messages', model: 'mB', msgFrom: 1, msgTo: 3 }) + '\n' +
      JSON.stringify({ ph: 'done', seq: 2, ts: '2026-07-14T00:00:09.500Z', status: 'ok', usage: { in: 5, out: 5 } }) + '\n');
    appendFileSync(join(dir2, 'conversations', 'main', 'e0.jsonl'),
      JSON.stringify({ seq: 2, t: 'append', msgs: [{ role: 'assistant', content: 'r' }, userMsg('two more')] }) + '\n');

    const messages = await runWorker({ type: 'update', logDir, projectName: 'proj', logFile: dir2 }, 'update-done');
    assert.ok(messages.some(m => m.type === 'update-done' && m.logFile === 'sessions/sid-2'));

    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats.summary.requestCount, 3);
    assert.equal(stats.summary.input_tokens, 8);
    assert.equal(stats.models['mB'], 2);
    assert.deepEqual(stats.files['sessions/sid-2'].preview, ['two', 'two more']);
  });

  it('scan-all generates stats for every project directory with sessions', async () => {
    for (const p of ['alpha', 'beta']) {
      makeSession(join(logDir, p), 'sid-1', {
        requests: [mainReq(1, 1, { model: `model-${p}`, usage: { in: 1, out: 1 } })],
        convEvents: [{ seq: 1, t: 'snapshot', msgs: [userMsg(p)] }],
      });
    }
    writeFileSync(join(logDir, 'stray.txt'), 'not a dir');
    const messages = await runWorker({ type: 'scan-all', logDir }, 'scan-all-done');
    assert.ok(messages.some(m => m.type === 'scan-all-done'));
    for (const p of ['alpha', 'beta']) {
      const stats = JSON.parse(readFileSync(join(logDir, p, `${p}.json`), 'utf-8'));
      assert.equal(stats.models[`model-${p}`], 1);
    }
  });

  it('scan-all on empty/odd logDir does not crash the worker', async () => {
    const messages = await runWorker({ type: 'scan-all', logDir }, 'scan-all-done');
    assert.ok(messages.every(m => m.type !== 'error'));
  });
});

// ─── real-writer format pin ──────────────────────────────────────────────────
describe('stats-worker v2: V2Writer round-trip format pin', () => {
  let logDir;
  beforeEach(() => { logDir = makeTmpDir(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('sessions produced by the real writer parse into sane stats', async () => {
    const SID = 'ab345678-9abc-4def-8012-3456789abcde';
    const w = new V2Writer({ logDir, project: 'proj', enabled: true, minFreeBytes: 0 });
    const entry = {
      timestamp: '2026-07-14T01:00:00.000Z',
      project: 'proj',
      url: 'https://api.anthropic.com/v1/messages?beta=true',
      method: 'POST',
      body: {
        model: 'claude-fable-5',
        system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
        tools: [{ name: 'Edit' }],
        metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID }) },
        messages: [userMsg('real writer prompt')],
      },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
      mainAgent: true, requestId: 'rid_1',
    };
    const h = w.ingestRequest(entry, entry.body.messages);
    w.ingestCompletion(h, {
      ...entry,
      response: { status: 200, body: { content: [], usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33, cache_creation_input_tokens: 44 } } },
      duration: 10,
    });
    await w.flush();

    await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    const stats = JSON.parse(readFileSync(join(logDir, 'proj', 'proj.json'), 'utf-8'));
    assert.equal(stats.summary.requestCount, 1);
    assert.equal(stats.summary.turnCount, 1);
    assert.equal(stats.summary.sessionCount, 1);
    assert.equal(stats.summary.input_tokens, 11);
    assert.equal(stats.summary.output_tokens, 22);
    assert.equal(stats.summary.cache_read_input_tokens, 33);
    assert.equal(stats.summary.cache_creation_input_tokens, 44);
    assert.equal(stats.models['claude-fable-5'], 1);
    // Task C: the writer names the dir `<ts>_<uuid>`; the stats unit key follows.
    const dirName = resolveSessionDirName(join(logDir, 'proj'), SID) || SID;
    assert.deepEqual(stats.files[`sessions/${dirName}`].preview, ['real writer prompt']);
  });
});

// ─── per-session containment (issue #129) ─────────────────────────────────────
describe('stats-worker per-session containment', () => {
  let logDir;
  beforeEach(() => { logDir = makeTmpDir(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('one unreadable session is skipped; healthy siblings still counted', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-good', {
      requests: [mainReq(1, 1, { model: 'mA', usage: { in: 100, out: 50 } })],
      convEvents: [{ seq: 1, t: 'snapshot', msgs: [userMsg('healthy prompt')] }],
    });
    // Corrupt sibling: journal.jsonl is a DIRECTORY — reading it throws
    // (EISDIR on POSIX), the crash class the per-session catch contains.
    const bad = join(projectDir, 'sessions', 'sid-bad');
    mkdirSync(join(bad, 'journal.jsonl'), { recursive: true });
    writeFileSync(join(bad, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'sid-bad', pid: 1, startTs: '2026-07-14T00:00:00.000Z' }));

    const messages = await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    assert.ok(messages.some(m => m.type === 'init-done'), 'worker completes instead of dying');

    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.ok(stats.files['sessions/sid-good'], 'healthy session counted');
    assert.equal(stats.files['sessions/sid-good'].preview[0], 'healthy prompt');
    assert.equal(stats.files['sessions/sid-bad'], undefined, 'broken session skipped, not crashed on');
    assert.equal(stats.summary.input_tokens, 100);
  });
});

// ─── discardable sessions vs the incremental cache (2026-07-16) ───────────────
describe('stats-worker discardable-session cache interplay', () => {
  let logDir;
  beforeEach(() => { logDir = makeTmpDir(); });
  afterEach(() => { try { rmSync(logDir, { recursive: true, force: true }); } catch {} });

  it('a probe unit in a stale pre-v11 cache is not resurrected (version bump forces re-parse)', async () => {
    const projectDir = join(logDir, 'proj');
    makeSession(projectDir, 'sid-real', {
      requests: [mainReq(1, 1, { model: 'mA', usage: { in: 10, out: 5 } })],
      convEvents: [{ seq: 1, t: 'snapshot', msgs: [userMsg('real prompt')] }],
    });
    // probe orphan (sub-only, no leader)
    const probeDir = join(projectDir, 'sessions', 'sid-probe');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'sid-probe', pid: 1, startTs: '2026-07-16T00:00:00.000Z' }));
    writeFileSync(join(probeDir, 'journal.jsonl'),
      JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n'
      + JSON.stringify({ ph: 'req', seq: 1, rid: 'rq', kind: 'sub', ts: '2026-07-16T00:00:00.000Z', url: 'u' }) + '\n');
    // Stale PRE-upgrade cache (v10) containing the probe unit with MATCHING
    // journal size+mtime — without the version bump the reuse branch would
    // copy it straight back into filesStats.
    const st = statSync(join(probeDir, 'journal.jsonl'));
    writeFileSync(join(projectDir, 'proj.json'), JSON.stringify({
      _v: 10,
      files: {
        'sessions/sid-probe': {
          models: {}, summary: { requestCount: 1 }, preview: [],
          size: 1, journalSize: st.size, lastModified: st.mtime.toISOString(),
        },
      },
      summary: { fileCount: 1, requestCount: 1 },
      models: {},
    }));

    const messages = await runWorker({ type: 'init', logDir, projectName: 'proj' }, 'init-done');
    assert.ok(messages.some(m => m.type === 'init-done'));
    const stats = JSON.parse(readFileSync(join(projectDir, 'proj.json'), 'utf-8'));
    assert.equal(stats._v, 12);
    assert.equal(stats.files['sessions/sid-probe'], undefined, 'stale cached probe unit dropped');
    assert.ok(stats.files['sessions/sid-real'], 'real session counted');
    assert.equal(stats.summary.fileCount, 1);
  });
});
