/**
 * Wire Format v2 core library unit tests (S2 — server/lib/v2/*).
 * Spec: docs/refactor/WIRE_FORMAT_V2.md; plan: docs/refactor/WIRE_FORMAT_V2_PLAN.md.
 *
 * Pure unit tier: everything runs against mkdtemp dirs, no interceptor, no
 * server. Coverage mandated by the plan's S2 row: dual-encoding user_id,
 * path-injection rejection, /clear→epoch, /compact→continuation, same-prompt
 * parallel subAgents (tool_use.id), no-metadata fallback, write-order/atomic
 * files, failure isolation, disk guard.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sanitizePathComponent, sessionPaths, ensureSessionDirSync, convEpochPath, writeFileAtomicSync, dirSizeSync } from '../packages/app/server/lib/v2/layout.js';
import { listV2Sessions } from '../packages/app/server/lib/v2/adapter.js';
import { _resetForTest as _resetSessionList } from '../packages/app/server/lib/v2/session-list.js';
import { resolveSessionDirName } from '../packages/app/server/lib/v2/session-select.js';
import { parseUserId, ConvResolver, classifyKind, firstUserPromptText } from '../packages/app/server/lib/v2/identity.js';
import { BlobStore } from '../packages/app/server/lib/v2/blob-store.js';
import { ConversationStore } from '../packages/app/server/lib/v2/conversation-store.js';
import { Journal } from '../packages/app/server/lib/v2/journal.js';
import { V2Writer } from '../packages/app/server/lib/v2/v2-writer.js';
import { AsyncWriteQueue } from '../packages/app/server/lib/async-write-queue.js';
import { _resetForTest } from '../packages/app/server/lib/error-report.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ccv-v2-')); _resetForTest(); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const SID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const jsonUserId = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
const clearMsg = () => textMsg('user', '<command-name>/clear</command-name>');

function readLines(path) {
  return readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l));
}

// Task C: the V2Writer now names dirs `<ts>_<uuid>`; resolve the real dir by
// UUID (falls back to the bare id for direct ensureSessionDirSync fixtures).
const sp = (project, sid) => sessionPaths(dir, project, resolveSessionDirName(join(dir, project), sid) || sid);

// ─── identity: dual-encoding user_id (spec §8) ──────────────────────────────
describe('parseUserId dual encoding', () => {
  it('parses the modern JSON encoding', () => {
    assert.deepEqual(parseUserId(jsonUserId), { sessionId: SID, encoding: 'json' });
  });

  it('parses the legacy underscore-delimited encoding', () => {
    const legacy = `user_deadbeef123_account__session_${SID}`;
    assert.deepEqual(parseUserId(legacy), { sessionId: SID, encoding: 'delimited' });
    const withAcct = `user_x_account_9f-uuid_session_${SID}`;
    assert.deepEqual(parseUserId(withAcct), { sessionId: SID, encoding: 'delimited' });
  });

  it('returns null for garbage, JSON without session_id, and non-UUID tails', () => {
    assert.equal(parseUserId(undefined), null);
    assert.equal(parseUserId(''), null);
    assert.equal(parseUserId('{"device_id":"d"}'), null);
    assert.equal(parseUserId('user_x_session_notauuid'), null);
    assert.equal(parseUserId('plain string'), null);
  });
});

// ─── layout: path-injection rejection + atomic files (spec §2/§3) ───────────
describe('layout sanitization and atomic creation', () => {
  it('rejects path-traversal in every derived component', () => {
    assert.equal(sanitizePathComponent('../../etc/passwd'), '.._.._etc_passwd');
    assert.equal(sanitizePathComponent('..'), '_');
    assert.equal(sanitizePathComponent(''), '_');
    assert.equal(sanitizePathComponent('sub-abc123DEF_-.'), 'sub-abc123DEF_-.');
    const p = sessionPaths(dir, '../evil', 'sid/../../up');
    assert.ok(p.dir.startsWith(join(dir, '.._evil')), p.dir);
    assert.ok(!p.dir.includes('/../'), 'no traversal survives');
  });

  it('creates skeleton + meta + journal sentinel idempotently', () => {
    const p1 = ensureSessionDirSync(dir, 'proj', SID, { userIdRaw: jsonUserId, userIdEncoding: 'json' });
    const p2 = ensureSessionDirSync(dir, 'proj', SID, { userIdRaw: 'SHOULD-NOT-OVERWRITE' });
    assert.equal(p1.metaPath, p2.metaPath);
    const meta = JSON.parse(readFileSync(p1.metaPath, 'utf8'));
    assert.equal(meta.wireFormat, 2);
    assert.equal(meta.sessionId, SID);
    assert.equal(meta.userIdRaw, jsonUserId, 'second ensure must not rewrite meta');
    const sentinel = readLines(p1.journalPath);
    assert.equal(sentinel.length, 1);
    assert.deepEqual(sentinel[0], { ph: 'meta', wireFormat: 2, sessionId: SID });
    assert.ok(existsSync(p1.conversationsDir) && existsSync(p1.blobsDir));
  });

  it('writeFileAtomicSync leaves no tmp residue', () => {
    const target = join(dir, 'x.json');
    writeFileAtomicSync(target, '{"a":1}');
    assert.equal(readFileSync(target, 'utf8'), '{"a":1}');
    assert.deepEqual(readdirSync(dir).filter(f => f.includes('.tmp-')), []);
  });
});

// ─── blob store: CAS + idempotence (spec §7) ────────────────────────────────
describe('BlobStore', () => {
  it('same content → same ref, one file; different content → different refs', () => {
    const paths = ensureSessionDirSync(dir, 'proj', SID);
    const store = new BlobStore(paths);
    const tools = [{ name: 'Bash', input_schema: { type: 'object' } }];
    const r1 = store.put(tools);
    const r2 = store.put(JSON.parse(JSON.stringify(tools)));
    assert.equal(r1, r2);
    assert.match(r1, /^sha256-[0-9a-f]{16}$/);
    const r3 = store.put([{ name: 'Other' }]);
    assert.notEqual(r1, r3);
    assert.equal(readdirSync(paths.blobsDir).length, 2);
    assert.equal(store.put(undefined), null);
    assert.deepEqual(JSON.parse(readFileSync(join(paths.blobsDir, `${r1}.json`), 'utf8')), tools);
  });
});

// ─── conversation store: event predicate matrix (spec §6/§9) ────────────────
describe('ConversationStore event judgement', () => {
  let paths, queue, store;
  beforeEach(() => {
    paths = ensureSessionDirSync(dir, 'proj', SID);
    queue = new AsyncWriteQueue('', { syncMode: true }); // deterministic: writes land immediately
    store = new ConversationStore(paths, queue);
  });

  const ingest = (msgs, seq) => store.ingest('main', msgs, { seq, rid: `r${seq}` });

  it('first event snapshots, prefix growth appends, unchanged wire writes nothing', () => {
    const m1 = [textMsg('user', 'hello')];
    const r1 = ingest(m1, 1);
    assert.equal(r1.evt, 'snapshot');
    assert.deepEqual([r1.msgFrom, r1.msgTo], [0, 1]);

    const m2 = [...m1, textMsg('assistant', 'hi'), textMsg('user', 'go on')];
    const r2 = ingest(m2, 2);
    assert.equal(r2.evt, 'append');
    assert.deepEqual([r2.msgFrom, r2.msgTo], [1, 3]);

    const r3 = ingest(m2, 3);
    assert.equal(r3.evt, null, 'unchanged wire → no conversation event');

    const lines = readLines(convEpochPath(paths, 'main', 0));
    assert.deepEqual(lines.map(l => l.t), ['snapshot', 'append']);
    assert.deepEqual(lines[1].msgs.length, 2, 'append stores only the tail slice');
    assert.deepEqual(lines.map(l => l.seq), [1, 2], 'every line carries its initiating seq');
  });

  it('/clear opens a new epoch file (spec §3.4→epoch)', () => {
    ingest([textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'c'),
            textMsg('assistant', 'd'), textMsg('user', 'e'), textMsg('assistant', 'f')], 1);
    const post = [clearMsg(), textMsg('assistant', 'fresh')];
    const r = store.ingest('main', post, { seq: 2, rid: 'r2' });
    assert.equal(r.boundary, 'clear');
    assert.equal(r.epoch, 1);
    assert.equal(r.evt, 'snapshot');
    assert.ok(existsSync(convEpochPath(paths, 'main', 0)));
    const e1 = readLines(convEpochPath(paths, 'main', 1));
    assert.equal(e1[0].t, 'snapshot');
    assert.equal(e1[0].msgs.length, 2);
  });

  it('restart continuation: a fresh store seeds epoch from disk and snapshots into e_max', () => {
    // Generation A: e0 content, then /clear → e1 content.
    ingest([textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'c'),
            textMsg('assistant', 'd'), textMsg('user', 'e'), textMsg('assistant', 'f')], 1);
    store.ingest('main', [clearMsg(), textMsg('assistant', 'fresh')], { seq: 2, rid: 'r2' });
    assert.ok(existsSync(convEpochPath(paths, 'main', 1)), 'generation A left e1 on disk');

    // Generation B: fresh store on the SAME paths (process restart / -c).
    // Its first event must land in e1 as a self-contained snapshot — writing
    // to e0 would append newer seqs into the older file (the 2026-07-15 bug).
    const storeB = new ConversationStore(paths, queue);
    const wire = [clearMsg(), textMsg('assistant', 'fresh'), textMsg('user', 'after restart')];
    const r = storeB.ingest('main', wire, { seq: 3, rid: 'r3' });
    assert.equal(r.evt, 'snapshot');
    assert.equal(r.epoch, 1, 'epoch seeded from the existing e1, not reset to 0');
    const e1 = readLines(convEpochPath(paths, 'main', 1));
    assert.equal(e1.length, 2, 'restart snapshot appended to e1');
    assert.deepEqual([e1[1].t, e1[1].seq, e1[1].msgs.length], ['snapshot', 3, 3]);
    const e0 = readLines(convEpochPath(paths, 'main', 0));
    assert.deepEqual(e0.map(l => l.seq), [1], 'e0 untouched — no newer seq behind e1');

    // A later /clear on the seeded store keeps advancing: e2.
    const r2 = storeB.ingest('main', [clearMsg(), textMsg('assistant', 'fresh2')], { seq: 4, rid: 'r4' });
    assert.equal(r2.epoch, 2);
    assert.ok(existsSync(convEpochPath(paths, 'main', 2)));
  });

  it('epoch seeding takes the MAX epoch file, not a count (gapped e0+e5 seeds 5)', () => {
    ingest([textMsg('user', 'seed me')], 1); // creates e0 + the conv dir
    writeFileSync(join(paths.conversationsDir, 'main', 'e5.jsonl'),
      JSON.stringify({ seq: 2, rid: 'r2', t: 'snapshot', msgs: [textMsg('user', 'gapped epoch')] }) + '\n');
    const storeB = new ConversationStore(paths, queue);
    const r = storeB.ingest('main', [textMsg('user', 'after gap')], { seq: 3, rid: 'r3' });
    assert.equal(r.epoch, 5, 'max-N semantics, not file count');
    assert.equal(r.evt, 'snapshot');
  });

  it('restart continuation on an e0-only conversation stays in e0 (seed=0 path unchanged)', () => {
    ingest([textMsg('user', 'one')], 1);
    const storeB = new ConversationStore(paths, queue);
    const r = storeB.ingest('main', [textMsg('user', 'one'), textMsg('assistant', 'two')], { seq: 2, rid: 'r2' });
    assert.equal(r.epoch, 0);
    assert.equal(r.evt, 'snapshot', 'fresh store always snapshots its first event');
    assert.deepEqual(readLines(convEpochPath(paths, 'main', 0)).map(l => l.t), ['snapshot', 'snapshot']);
  });

  it('/compact stays in the SAME epoch with a compact ctl (spec §3.5)', () => {
    ingest([textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'c'),
            textMsg('assistant', 'd'), textMsg('user', 'e'), textMsg('assistant', 'f'),
            textMsg('user', 'g'), textMsg('assistant', 'h')], 1);
    const summary = [textMsg('user', 'This session is being continued from a previous conversation. Summary: …')];
    const r = store.ingest('main', summary, { seq: 2, rid: 'r2' });
    assert.equal(r.epoch, 0, 'compact must NOT fork the epoch');
    assert.equal(r.evt, 'snapshot');
    assert.equal(r.ctl, 'compact');
    const lines = readLines(convEpochPath(paths, 'main', 0));
    assert.deepEqual(lines.map(l => l.t), ['snapshot', 'snapshot', 'ctl']);
    assert.equal(lines[2].op, 'compact');
  });

  it('tool_result tail with SAME tool_use_id but changed body → replace-tail detected (content-aware fp)', () => {
    // Review P2: the client-shared messageFingerprint keys tool_result on id
    // only — using it for the write-side judgement made same-id body edits
    // invisible to v2 (and the verify digest is blind to that class). The
    // judgement now uses v1's content-aware fingerprintMsg; this pins it.
    const trMsg = (body) => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tr_1', content: body }] });
    ingest([textMsg('assistant', 'q'), trMsg('first result')], 1);
    const r = ingest([textMsg('assistant', 'q'), trMsg('EDITED result')], 2);
    assert.equal(r.ctl, 'replace-tail', 'same-id tool_result body edit must produce a replace-tail event');
  });

  it('same-length tail-content change → replace-tail ctl (spec §3.3)', () => {
    const base = [textMsg('user', 'q'), textMsg('assistant', 'draft answer')];
    ingest(base, 1);
    const replaced = [base[0], textMsg('assistant', 'REAL answer')];
    const r = ingest(replaced, 2);
    assert.equal(r.ctl, 'replace-tail');
    const lines = readLines(convEpochPath(paths, 'main', 0));
    const ctl = lines[lines.length - 1];
    assert.equal(ctl.t, 'ctl');
    assert.equal(ctl.op, 'replace-tail');
    assert.equal(ctl.msg.content[0].text, 'REAL answer');
  });

  it('same-length but WHOLLY different wire (first message differs) → snapshot, not replace-tail', () => {
    // Real-data class (2026-07-14): pre-flag proxy teammates interleave a
    // second conversation into the leader's main stream; when the two streams
    // happen to be equal-length, a tail-only patch would replay a franken-mix.
    ingest([textMsg('user', 'conv A opening'), textMsg('assistant', 'A reply')], 1);
    const r = ingest([textMsg('user', 'conv B opening'), textMsg('assistant', 'B reply')], 2);
    assert.equal(r.ctl, null, 'must NOT be judged an in-place tail replace');
    assert.equal(r.evt, 'snapshot');
    const lines = readLines(convEpochPath(paths, 'main', 0));
    assert.equal(lines[lines.length - 1].t, 'snapshot');
    assert.equal(lines[lines.length - 1].reason, 'tail-mismatch');
    assert.equal(lines[lines.length - 1].msgs[0].content[0].text, 'conv B opening', 'snapshot carries the full new wire');
  });

  it('exactFps mode distinguishes wires sharing an 80-char prefix (converter golden-gate grade)', () => {
    const long = (suffix) => [textMsg('user', 'x'.repeat(120) + suffix)];
    // Default (live) fingerprints truncate at 80 chars: same-prefix wires are "unchanged".
    const rDefault = (() => {
      const s = new ConversationStore(paths, queue);
      s.ingest('main', long('AAA'), { seq: 1, rid: 'r1' });
      return s.ingest('main', long('BBB'), { seq: 2, rid: 'r2' });
    })();
    assert.equal(rDefault.evt, null, 'cheap live fps cannot see past 80 chars (accepted)');
    // Exact mode (offline converter) must snapshot the second wire.
    const s2 = new ConversationStore(ensureSessionDirSync(dir, 'proj2', SID), queue, { exactFps: true });
    s2.ingest('main', long('AAA'), { seq: 1, rid: 'r1' });
    const rExact = s2.ingest('main', long('BBB'), { seq: 2, rid: 'r2' });
    assert.equal(rExact.ctl, 'replace-tail', 'full-content hash sees the divergence (single-msg wire → tail swap, replay exact)');
  });

  it('exactFps judges cache_control migration onto an OLD message as append (S4 归一化决策 2026-07-14)', () => {
    const p3 = ensureSessionDirSync(dir, 'proj3', SID);
    const s = new ConversationStore(p3, queue, { exactFps: true });
    const opening = 'hello world, a long opening prompt';
    const a1 = textMsg('assistant', 'reply one');
    s.ingest('main', [{ role: 'user', content: opening }, a1], { seq: 1, rid: 'r1' });

    // The client migrates a cache_control breakpoint onto msg[0]: string
    // content becomes a block array with cache_control — byte-different,
    // semantically identical. Pre-normalization this failed the prefix test
    // and snapshot-stormed every request of the conversation.
    const migrated = { role: 'user', content: [{ type: 'text', text: opening, cache_control: { type: 'ephemeral', ttl: '1h' } }] };
    const r = s.ingest('main', [migrated, a1, textMsg('user', 'turn 2')], { seq: 2, rid: 'r2' });
    assert.equal(r.evt, 'append', 'cache_control/form migration must not fail the prefix test');
    const lines = readLines(convEpochPath(p3, 'main', 0));
    assert.deepEqual(lines[lines.length - 1].msgs.map((m) => m.content?.[0]?.text ?? m.content), ['turn 2'], 'only the new slice is stored');

    // Control: a GENUINE content edit on the old message must still snapshot.
    const edited = { role: 'user', content: opening + ' EDITED' };
    const r2 = s.ingest('main', [edited, a1, textMsg('user', 'turn 2'), textMsg('user', 'turn 3')], { seq: 3, rid: 'r3' });
    assert.equal(r2.evt, 'snapshot');
  });

  it('prefix-test failure without /clear (short window / overlap) → raw snapshot', () => {
    ingest([textMsg('user', 'a'), textMsg('assistant', 'b'), textMsg('user', 'c')], 1);
    // v1 §3.1-style short window: unrelated 2-msg sequence, shorter than prev
    const r = ingest([textMsg('user', 'plan-mode window'), textMsg('assistant', 'x')], 2);
    assert.equal(r.evt, 'snapshot');
    const lines = readLines(convEpochPath(paths, 'main', 0));
    assert.equal(lines[lines.length - 1].reason, 'shrunk');
    // tail-mismatch flavor: longer but the claimed prefix boundary doesn't match
    ingest([textMsg('user', 'X'), textMsg('assistant', 'Y'), textMsg('user', 'Z'), textMsg('user', 'W')], 3);
    const lines2 = readLines(convEpochPath(paths, 'main', 0));
    assert.equal(lines2[lines2.length - 1].reason, 'tail-mismatch');
  });

  it('two conversations never cross-contaminate state', () => {
    const a1 = store.ingest('main', [textMsg('user', 'main1')], { seq: 1, rid: 'r1' });
    const b1 = store.ingest('sub-x', [textMsg('user', 'sub1')], { seq: 2, rid: 'r2' });
    const a2 = store.ingest('main', [textMsg('user', 'main1'), textMsg('assistant', 'm2')], { seq: 3, rid: 'r3' });
    assert.equal(a1.evt, 'snapshot');
    assert.equal(b1.evt, 'snapshot');
    assert.equal(a2.evt, 'append', 'sub ingest in between must not disturb main continuity');
  });
});

// ─── identity: parallel same-prompt subagents (plan risk #7) ────────────────
describe('ConvResolver', () => {
  it('two parallel same-prompt subagents get DISTINCT keys via tool_use.id', () => {
    const r = new ConvResolver();
    r.registerSpawns({
      content: [
        { type: 'tool_use', name: 'Agent', id: 'toolu_AAAAAAAAAAAA1', input: { prompt: 'Review the diff carefully' } },
        { type: 'tool_use', name: 'Agent', id: 'toolu_BBBBBBBBBBBB2', input: { prompt: 'Review the diff carefully' } },
      ],
    });
    const k1 = r.resolveSub([textMsg('user', 'Review the diff carefully')]);
    const k2 = r.resolveSub([textMsg('user', 'Review the diff carefully')]);
    assert.notEqual(k1.convKey, k2.convKey);
    assert.ok(k1.convKey.startsWith('sub-') && !k1.convKey.startsWith('sub-fp-'), k1.convKey);
    assert.ok(k1.isNew && k2.isNew);
  });

  it('continuity: a growing sub conversation keeps its key', () => {
    const r = new ConvResolver();
    r.registerSpawns({ content: [{ type: 'tool_use', name: 'Task', id: 'toolu_CCCCCCCCCCCC3', input: { prompt: 'explore the code' } }] });
    const first = r.resolveSub([textMsg('user', 'explore the code')]);
    const second = r.resolveSub([textMsg('user', 'explore the code'), textMsg('assistant', 'found'), textMsg('user', 'more')]);
    assert.equal(second.convKey, first.convKey);
    assert.equal(second.isNew, false);
  });

  it('no registered spawn → fp fallback with ordinal split for identical prompts', () => {
    const r = new ConvResolver();
    const a = r.resolveSub([textMsg('user', 'same prompt')]);
    const b = r.resolveSub([textMsg('user', 'same prompt')]); // same len → continuity match
    assert.equal(b.convKey, a.convKey, 'same length re-send is continuity, not a new conv');
    assert.match(a.convKey, /^sub-fp-[0-9a-f]{8}$/);
  });

  it('firstUserPromptText handles string and block content', () => {
    assert.equal(firstUserPromptText([{ role: 'user', content: 'plain' }]), 'plain');
    assert.equal(firstUserPromptText([textMsg('user', 'blocky')]), 'blocky');
    assert.equal(firstUserPromptText([]), '');
  });

  const REMINDER = '<system-reminder>\nAs you answer, use the following context:\n# claudeMd\nlots of boilerplate…\n</system-reminder>';

  it('firstUserPromptText strips leading system-reminder preambles', () => {
    // Harness shape observed in real wires: reminder is its own text block,
    // the actual prompt is the next block (they concatenate before stripping).
    const wireMsg = { role: 'user', content: [{ type: 'text', text: REMINDER }, { type: 'text', text: 'explore the code' }] };
    assert.equal(firstUserPromptText([wireMsg]), 'explore the code');
    // String content and stacked reminders strip the same way.
    assert.equal(firstUserPromptText([{ role: 'user', content: `${REMINDER}\n${REMINDER}\n do it` }]), 'do it');
    // Unterminated reminder → no usable prompt text.
    assert.equal(firstUserPromptText([{ role: 'user', content: '<system-reminder>\nbroken' }]), '');
    // TERMINATED reminder-only message (no prompt after) → also empty.
    assert.equal(firstUserPromptText([{ role: 'user', content: REMINDER }]), '');
    // Only LEADING reminders are stripped: a reminder AFTER the prompt stays
    // in the text (pinned behavior — callers fingerprint the prompt START,
    // and the harness shape observed in real wires is leading-only).
    const trailing = firstUserPromptText([{ role: 'user', content: [{ type: 'text', text: 'short prompt' }, { type: 'text', text: REMINDER }] }]);
    assert.ok(trailing.startsWith('short prompt'), 'prompt text survives');
    assert.ok(trailing.includes('<system-reminder>'), 'trailing reminder is NOT stripped (leading-only contract)');
  });

  it('tool_use.id keying survives the harness reminder preamble (plan 关键事实 2026-07-14: 0-hit bug)', () => {
    const r = new ConvResolver();
    r.registerSpawns({ content: [{ type: 'tool_use', name: 'Agent', id: 'toolu_DDDDDDDDDDDD4', input: { prompt: 'explore the code' } }] });
    const wire = [{ role: 'user', content: [{ type: 'text', text: REMINDER }, { type: 'text', text: 'explore the code' }] }];
    const k = r.resolveSub(wire);
    assert.equal(k.convKey, `sub-${'toolu_DDDDDDDDDDDD4'.slice(-12)}`, 'registry prefix must match the reminder-stripped wire prompt');
  });

  it('parallel subs with different prompts but identical reminder preamble get distinct keys', () => {
    const r = new ConvResolver();
    const a = r.resolveSub([{ role: 'user', content: [{ type: 'text', text: REMINDER }, { type: 'text', text: 'Angle A: line-by-line diff scan' }] }]);
    const b = r.resolveSub([{ role: 'user', content: [{ type: 'text', text: REMINDER }, { type: 'text', text: 'Angle B: removed-behavior audit' }] }]);
    // Pre-fix: the 200-char fp covered only reminder boilerplate → same fp →
    // same-length continuity match interleaved both agents into one conv.
    assert.notEqual(a.convKey, b.convKey);
    assert.ok(a.isNew && b.isNew);
  });
});

// ─── classifyKind ────────────────────────────────────────────────────────────
describe('classifyKind', () => {
  it('maps entry flags to journal kinds', () => {
    assert.equal(classifyKind({ isHeartbeat: true }), 'heartbeat');
    assert.equal(classifyKind({ isCountTokens: true }), 'countTokens');
    assert.equal(classifyKind({ teammate: 'cr-x', mainAgent: true }), 'teammate');
    assert.equal(classifyKind({ mainAgent: true }), 'main');
    assert.equal(classifyKind({ body: { messages: [] } }), 'sub');
    assert.equal(classifyKind({ body: {} }), 'misc');
  });
});

// ─── journal: two-phase lines + seq monotonicity ─────────────────────────────
describe('Journal', () => {
  it('writes req/done phases; seq allocated at initiation stays the semantic order', async () => {
    const paths = ensureSessionDirSync(dir, 'proj', SID);
    const queue = new AsyncWriteQueue('');
    const j = new Journal(paths, queue);
    const s1 = j.nextSeq();
    const s2 = j.nextSeq(); // two requests initiated in order…
    j.writeReq({ seq: s2, rid: 'b', ts: 't2', kind: 'main', url: 'u' });
    j.writeDone({ seq: s2, rid: 'b', ts: 't3', status: 'ok' });
    j.writeReq({ seq: s1, rid: 'a', ts: 't1', kind: 'main', url: 'u' }); // …completing out of order
    j.writeDone({ seq: s1, rid: 'a', ts: 't4', status: 'ok' });
    await queue.flush();
    const lines = readLines(paths.journalPath);
    assert.equal(lines[0].ph, 'meta', 'sentinel first frame survives');
    const folded = new Map();
    for (const l of lines.slice(1)) folded.set(`${l.seq}:${l.ph}`, l);
    assert.ok(folded.has('1:req') && folded.has('1:done') && folded.has('2:req') && folded.has('2:done'),
      'reader folds by seq regardless of physical order');
  });
});

// ─── V2Writer: orchestration, fallback routing, isolation, disk guard ────────
describe('V2Writer', () => {
  const mkEntry = (over = {}) => ({
    timestamp: '2026-07-13T12:00:00.000Z',
    url: 'https://api.anthropic.com/v1/messages?beta=true',
    method: 'POST',
    headers: { 'x-api-key': 'sk-12****ab' },
    requestId: over.requestId || 'req_1',
    mainAgent: true,
    body: {
      model: 'claude-fable-5',
      metadata: { user_id: jsonUserId },
      tools: [{ name: 'Bash' }],
      system: [{ type: 'text', text: 'You are Claude Code' }],
      messages: [textMsg('user', 'hello')],
    },
    ...over,
  });

  it('full request+completion round trip produces blob-deduped journal/conv/responses', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry();
    const h1 = w.ingestRequest(e1, e1.body.messages);
    assert.ok(h1 && h1.seq === 1 && h1.sid === SID);
    w.ingestCompletion(h1, { ...e1, duration: 1234, response: { status: 200, body: { model: 'claude-fable-5', usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn', content: [] } } });

    const e2 = mkEntry({ requestId: 'req_2' });
    e2.body.messages = [...e1.body.messages, textMsg('assistant', 'hi'), textMsg('user', 'next')];
    const h2 = w.ingestRequest(e2, e2.body.messages);
    w.ingestCompletion(h2, { ...e2, duration: 99, response: { status: 200, body: { usage: {}, content: [] } } });
    await w.flush();

    const paths = sp('proj', SID);
    const journal = readLines(paths.journalPath);
    const reqs = journal.filter(l => l.ph === 'req');
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0].blobs.tools, reqs[1].blobs.tools, 'unchanged tools → same blob ref');
    assert.equal(readdirSync(paths.blobsDir).length, 2, 'tools + system, deduped across requests');
    assert.deepEqual(journal.filter(l => l.ph === 'done').map(l => l.status), ['ok', 'ok']);
    assert.equal(journal.find(l => l.ph === 'done' && l.seq === 1).usage.in, 10);

    const conv = readLines(convEpochPath(paths, 'main', 0));
    assert.deepEqual(conv.map(l => l.t), ['snapshot', 'append']);

    const responses = readLines(paths.responsesPath);
    assert.equal(responses.length, 2);
    assert.equal(responses[0].body.stop_reason, 'end_turn');

    const meta = JSON.parse(readFileSync(paths.metaPath, 'utf8'));
    assert.ok(!('instanceId' in meta), 'instance concept removed — writer never stamps it');
    assert.equal(meta.userIdEncoding, 'json');
  });

  it('metadata-less requests route to the current session; cold-start ones are held then flushed', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    // cold start: heartbeat arrives before any sid-bearing request
    const hb = { timestamp: 't0', url: 'https://api/eval/sdk-x', method: 'POST', isHeartbeat: true, requestId: 'hb1', body: {} };
    assert.equal(w.ingestRequest(hb, null), null, 'held in memory, no dir yet');
    assert.ok(!existsSync(join(dir, 'proj')), 'nothing on disk before first sid');

    const e = mkEntry();
    const h = w.ingestRequest(e, e.body.messages);
    assert.ok(h);
    await w.flush();
    const journal = readLines(sp('proj', SID).journalPath);
    const kinds = journal.filter(l => l.ph === 'req').map(l => l.kind);
    assert.deepEqual(kinds, ['heartbeat', 'main'], 'held heartbeat flushed into the resolved session first');

    // subsequent metadata-less request routes straight to the active session
    const ct = { timestamp: 't2', url: 'https://api/v1/messages/count_tokens', method: 'POST', isCountTokens: true, requestId: 'ct1', body: { messages: [textMsg('user', 'count me')] } };
    const hct = w.ingestRequest(ct, ct.body.messages);
    assert.ok(hct && hct.sid === SID);
    await w.flush();
    const journal2 = readLines(sp('proj', SID).journalPath);
    const ctReq = journal2.find(l => l.ph === 'req' && l.kind === 'countTokens');
    assert.equal(ctReq.conv, 'misc', 'countTokens keeps wire fidelity under misc');
  });

  it('disabled writer is a total no-op', () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: false });
    const e = mkEntry();
    assert.equal(w.ingestRequest(e, e.body.messages), null);
    assert.ok(!existsSync(join(dir, 'proj')));
  });

  it('journal req line carries residual body params; responses line carries statusText', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkEntry();
    e.body = { ...e.body, max_tokens: 32000, temperature: 1, stream: true, thinking: { type: 'enabled', budget_tokens: 4096 } };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, duration: 5, response: { status: 200, statusText: 'OK', headers: { 'x-h': '1' }, body: { usage: {}, content: [] } } });
    await w.flush();

    const paths = sp('proj', SID);
    const req = readLines(paths.journalPath).find(l => l.ph === 'req');
    assert.deepEqual(req.params, {
      model: 'claude-fable-5',
      metadata: { user_id: jsonUserId },
      max_tokens: 32000,
      temperature: 1,
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 4096 },
    }, 'params = whole body minus messages/system/tools');
    const resp = readLines(paths.responsesPath)[0];
    assert.equal(resp.statusText, 'OK');
  });

  it('params omitted for non-object bodies and bodies with only decomposed fields', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry(); // binds the session (params present: model + metadata)
    w.ingestRequest(e1, e1.body.messages);
    // only decomposed fields → empty rest → no params key
    const e2 = mkEntry({ requestId: 'req_2' });
    e2.body = { system: e1.body.system, tools: e1.body.tools, messages: [textMsg('user', 'bare')] };
    w.ingestRequest(e2, e2.body.messages);
    // non-object body → no params key (and no crash)
    const e3 = mkEntry({ requestId: 'req_3' });
    e3.body = 'not-json';
    w.ingestRequest(e3, null);
    // array body → no params key (arrays are typeof 'object')
    const e4 = mkEntry({ requestId: 'req_4' });
    e4.body = [textMsg('user', 'array body')];
    w.ingestRequest(e4, null);
    await w.flush();

    const reqs = readLines(sp('proj', SID).journalPath).filter(l => l.ph === 'req');
    assert.equal(reqs.length, 4);
    assert.ok(reqs[0].params, 'first request carries params');
    assert.equal(reqs[1].params, undefined, 'empty rest emits no params key');
    assert.equal(reqs[2].params, undefined, 'string body emits no params key');
    assert.equal(reqs[3].params, undefined, 'array body emits no params key');
  });

  it('prompts.jsonl: snapshot writes all prompts, append writes only the new slice, dedup holds', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry(); // snapshot: ['hello']
    w.ingestRequest(e1, e1.body.messages);
    const e2 = mkEntry({ requestId: 'req_2' });
    e2.body.messages = [textMsg('user', 'hello'), textMsg('assistant', 'hi'), textMsg('user', 'second question')];
    w.ingestRequest(e2, e2.body.messages); // append slice = [assistant hi, user second question]
    await w.flush();

    const paths = sp('proj', SID);
    const lines = readLines(paths.promptsPath);
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0].texts, ['hello']);
    assert.deepEqual(lines[1].texts, ['second question'], 'append emits only the new user prompt');
    assert.ok(lines.every(l => typeof l.seq === 'number'));
  });

  it('prompts.jsonl: caveat/command wrappers and suggestion probes never land in the cache', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry();
    e1.body.messages = [{ role: 'user', content: '<local-command-caveat>Caveat: generated by local commands</local-command-caveat>\n<command-name>/theme</command-name>' }];
    w.ingestRequest(e1, e1.body.messages);
    const e2 = mkEntry({ requestId: 'req_2' });
    e2.body.messages = [textMsg('user', '[SUGGESTION MODE: predict input]')];
    w.ingestRequest(e2, e2.body.messages);
    const e3 = mkEntry({ requestId: 'req_3' });
    e3.body.messages = [textMsg('user', 'a real prompt\nwith newline ' + 'x'.repeat(200))];
    w.ingestRequest(e3, e3.body.messages);
    await w.flush();

    const lines = readLines(sp('proj', SID).promptsPath);
    const all = lines.flatMap(l => l.texts);
    assert.equal(all.length, 1, 'only the real prompt recorded');
    assert.ok(!all[0].includes('\n') && all[0].length === 100, 'flattened + 100-char cap');
  });

  it('prompts.jsonl: a restarted process seeding from the file stays idempotent on resume snapshots', async () => {
    const w1 = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry();
    e1.body.messages = [textMsg('user', 'q1')];
    w1.ingestRequest(e1, e1.body.messages);
    await w1.flush();

    // New process onto the same session dir: first main wire replays FULL
    // history → ConversationStore emits a fresh snapshot. The seeded dedup set
    // must keep q1 out of the file a second time.
    const w2 = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e2 = mkEntry({ requestId: 'req_r2' });
    e2.body.messages = [textMsg('user', 'q1'), textMsg('assistant', 'a1'), textMsg('user', 'q2')];
    w2.ingestRequest(e2, e2.body.messages);
    await w2.flush();

    const lines = readLines(sp('proj', SID).promptsPath);
    assert.deepEqual(lines.flatMap(l => l.texts), ['q1', 'q2'], 'no duplicate q1 after restart');
  });

  it('prompts.jsonl: a suggestion probe swapped for the real prompt (replace-tail) is captured', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry();                       // snapshot → captures q1
    e1.body.messages = [textMsg('user', 'q1'), textMsg('assistant', 'draft')];
    w.ingestRequest(e1, e1.body.messages);
    const e2 = mkEntry({ requestId: 'req_2' });  // append of a probe → skipped by isSuggestionMode
    e2.body.messages = [textMsg('user', 'q1'), textMsg('assistant', 'draft'), textMsg('user', '[SUGGESTION MODE: predict next]')];
    w.ingestRequest(e2, e2.body.messages);
    const e3 = mkEntry({ requestId: 'req_3' });  // real prompt supplants the probe, same length → replace-tail
    e3.body.messages = [textMsg('user', 'q1'), textMsg('assistant', 'draft'), textMsg('user', 'the real followup')];
    w.ingestRequest(e3, e3.body.messages);
    await w.flush();
    const lines = readLines(sp('proj', SID).promptsPath);
    assert.deepEqual(lines.flatMap(l => l.texts), ['q1', 'the real followup'],
      'replace-tail arm captures the real prompt that supplanted the probe');
  });

  it('prompts.jsonl: heartbeats and sub/misc conversations never write it', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkEntry();
    w.ingestRequest(e, e.body.messages); // establishes the session
    const ct = { timestamp: 't2', url: 'https://api/v1/messages/count_tokens', method: 'POST', isCountTokens: true, requestId: 'ct1', body: { messages: [textMsg('user', 'count me')] } };
    w.ingestRequest(ct, ct.body.messages);
    await w.flush();
    const lines = readLines(sp('proj', SID).promptsPath);
    assert.deepEqual(lines.flatMap(l => l.texts), ['hello'], 'misc conv (countTokens) contributed nothing');
  });

  it('v2 failure is swallowed+reported, never thrown (failure isolation)', () => {
    // Force ensureSessionDirSync to fail: logDir points at a FILE.
    const fileAsDir = join(dir, 'not-a-dir');
    writeFileSync(fileAsDir, 'x');
    const w = new V2Writer({ logDir: fileAsDir, project: 'proj', enabled: true });
    const e = mkEntry();
    let handle;
    assert.doesNotThrow(() => { handle = w.ingestRequest(e, e.body.messages); });
    assert.equal(handle, null);
    assert.doesNotThrow(() => w.ingestCompletion(null, e));
  });

  it('disk guard: low free space disables v2 writes for the process', () => {
    const w = new V2Writer({
      logDir: dir, project: 'proj', enabled: true,
      statfs: () => ({ bavail: 10, bsize: 512 }), // 5KB free
    });
    const e = mkEntry();
    assert.equal(w.ingestRequest(e, e.body.messages), null);
    assert.ok(!existsSync(join(dir, 'proj')), 'no session dir created under disk pressure');
  });

  it('teammate meta records leader linkage (spec §10)', async () => {
    const w = new V2Writer({
      logDir: dir, project: 'proj', enabled: true,
      leader: { agentName: 'cr-product', teamName: 'review', parentSessionId: 'leader-sid' },
    });
    const e = mkEntry({ teammate: 'cr-product', teamName: 'review' });
    const h = w.ingestRequest(e, e.body.messages);
    assert.ok(h);
    await w.flush();
    const paths = sp('proj', SID);
    const meta = JSON.parse(readFileSync(paths.metaPath, 'utf8'));
    assert.equal(meta.leader.agentName, 'cr-product');
    const req = readLines(paths.journalPath).find(l => l.ph === 'req');
    assert.equal(req.kind, 'teammate');
    assert.equal(req.conv, 'main', 'teammate traffic is the main conversation of its own session');
  });

  it('Agent spawns registered from completions key subsequent sub conversations', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkEntry();
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, {
      ...e,
      response: { status: 200, body: { content: [{ type: 'tool_use', name: 'Agent', id: 'toolu_ZZZZZZZZZZZZ9', input: { prompt: 'do the sub work' } }], usage: {} } },
    });
    const sub = mkEntry({ requestId: 'req_sub', mainAgent: false });
    sub.body.messages = [textMsg('user', 'do the sub work')];
    const hs = w.ingestRequest(sub, sub.body.messages);
    assert.ok(hs);
    await w.flush();
    const paths = sp('proj', SID);
    const req = readLines(paths.journalPath).find(l => l.rid === 'req_sub');
    assert.equal(req.kind, 'sub');
    assert.equal(req.conv, 'sub-' + 'toolu_ZZZZZZZZZZZZ9'.slice(-12), 'conv key derives from the spawning tool_use.id');
    assert.ok(existsSync(convEpochPath(paths, req.conv, 0)));
  });

  it('seq stays monotonic per session FILE across writer/session-object recreation (P1-a)', async () => {
    const w1 = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry();
    const h1 = w1.ingestRequest(e1, e1.body.messages);
    assert.equal(h1.seq, 1);
    await w1.close();

    // Fresh writer binding onto the SAME session dir (process re-attach /
    // workspace A→B→A after resetSessions) must continue, not restart at 1.
    const w2 = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e2 = mkEntry({ requestId: 'req_2' });
    const h2 = w2.ingestRequest(e2, e2.body.messages);
    assert.equal(h2.seq, 2, 'seq seeded from the existing journal, no collision');
    await w2.flush();
    const journal = readLines(sp('proj', SID).journalPath).filter(l => l.ph === 'req');
    assert.deepEqual(journal.map(l => l.seq), [1, 2]);
  });

  it('completion arriving AFTER resetSessions still lands its done/response lines (review P2)', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkEntry();
    const h = w.ingestRequest(e, e.body.messages);
    w.resetSessions(); // workspace switch while the request is in flight
    w.ingestCompletion(h, { ...e, duration: 7, response: { status: 200, body: { usage: { input_tokens: 2 } } } });
    await w.flush();
    const paths = sp('proj', SID);
    const done = readLines(paths.journalPath).find(l => l.ph === 'done' && l.seq === h.seq);
    assert.ok(done, 'done line written into the ORIGINAL session dir via the handle-carried session');
    assert.equal(readLines(paths.responsesPath).length, 1, 'response line not dropped');
  });

  it('held request completing after the flush still gets its done line (late handle)', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const held = { timestamp: 't0', url: 'u', method: 'POST', isCountTokens: true, requestId: 'ct-late', body: { messages: [textMsg('user', 'held')] } };
    assert.equal(w.ingestRequest(held, held.body.messages), null);
    const e = mkEntry();
    w.ingestRequest(e, e.body.messages); // flushes the held request
    w.ingestCompletion(null, { ...held, duration: 5, response: { status: 200, body: { usage: {} } } });
    await w.flush();
    const journal = readLines(sp('proj', SID).journalPath);
    const heldReq = journal.find(l => l.ph === 'req' && l.rid === 'ct-late');
    const heldDone = journal.find(l => l.ph === 'done' && l.rid === 'ct-late');
    assert.ok(heldReq, 'held req line exists');
    assert.ok(heldDone, 'late completion folded by rid');
    assert.equal(heldDone.seq, heldReq.seq);
  });

  it('resetConversations drops continuity → next ingest snapshots fresh, seq keeps counting', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e1 = mkEntry();
    w.ingestRequest(e1, e1.body.messages);
    w.resetConversations();
    const e2 = mkEntry({ requestId: 'req_2' });
    e2.body.messages = [...e1.body.messages, textMsg('assistant', 'hi')];
    const h2 = w.ingestRequest(e2, e2.body.messages);
    assert.equal(h2.seq, 2, 'journal seq survives the reset');
    await w.flush();
    const conv = readLines(convEpochPath(sp('proj', SID), 'main', 0));
    assert.deepEqual(conv.map(l => l.t), ['snapshot', 'snapshot'], 'post-reset ingest re-snapshots');
  });
});

// ─── concurrency: N interleaved request/completion pairs, single-writer queue ─
describe('concurrent ingest', () => {
  it('N pairs fired without awaiting yield exactly N req + N done with contiguous seq', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const N = 20;
    const mk = (i) => ({
      timestamp: `2026-07-13T12:00:${String(i).padStart(2, '0')}.000Z`,
      url: 'https://api.anthropic.com/v1/messages', method: 'POST', requestId: `r${i}`,
      mainAgent: true,
      body: { metadata: { user_id: JSON.stringify({ session_id: SID }) }, messages: [textMsg('user', 'concurrent')] },
    });
    const handles = [];
    for (let i = 0; i < N; i++) handles.push(w.ingestRequest(mk(i), mk(i).body.messages));
    // complete in REVERSE order, no awaits in between — physical write order ≠ seq order
    for (let i = N - 1; i >= 0; i--) {
      w.ingestCompletion(handles[i], { ...mk(i), duration: i, response: { status: 200, body: { content: [], usage: {} } } });
    }
    await w.flush();
    const journal = readLines(sp('proj', SID).journalPath).filter(l => l.ph !== 'meta');
    const reqs = journal.filter(l => l.ph === 'req');
    const dones = journal.filter(l => l.ph === 'done');
    assert.equal(reqs.length, N, 'no dropped req lines');
    assert.equal(dones.length, N, 'no dropped done lines');
    assert.deepEqual(reqs.map(l => l.seq).sort((a, b) => a - b), Array.from({ length: N }, (_, i) => i + 1), 'contiguous initiation seq');
    assert.deepEqual(new Set(dones.map(l => l.seq)).size, N, 'every seq folded exactly once');
  });
});

// ─── write-order: conv lines land before/with the journal line ───────────────
describe('write-order protocol', () => {
  it('within one ingest, blob exists on disk before the journal line is even enqueued', () => {
    const paths = ensureSessionDirSync(dir, 'proj', SID);
    const observed = [];
    const spyQueue = {
      appendTo(path, data, onDone) {
        if (path === paths.journalPath) {
          // At journal-enqueue time the blob referenced by the line must exist.
          const line = JSON.parse(data);
          if (line.ph === 'req' && line.blobs) {
            observed.push(existsSync(join(paths.blobsDir, `${line.blobs.tools}.json`)));
          }
        }
        if (onDone) onDone();
      },
      flush: async () => {}, close: async () => {},
    };
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true, queue: spyQueue });
    const e = {
      timestamp: 't', url: 'u', method: 'POST', requestId: 'r1', mainAgent: true,
      body: { metadata: { user_id: jsonUserId }, tools: [{ name: 'Bash' }], messages: [textMsg('user', 'x')] },
    };
    w.ingestRequest(e, e.body.messages);
    assert.deepEqual(observed, [true], 'journal line enqueued only after its blob is durable');
  });

  it('within one request, the conv line is enqueued before the journal req line', () => {
    const paths = ensureSessionDirSync(dir, 'proj', SID);
    const order = [];
    const spyQueue = {
      appendTo(path, data, onDone) {
        order.push(path === paths.journalPath ? 'journal'
          : (path.includes('conversations') ? 'conv'
            : (path === paths.promptsPath ? 'prompts' : 'other')));
        if (onDone) onDone();
      },
      flush: async () => {}, close: async () => {},
    };
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true, queue: spyQueue });
    const e = {
      timestamp: 't', url: 'u', method: 'POST', requestId: 'r1', mainAgent: true,
      body: { metadata: { user_id: jsonUserId }, messages: [textMsg('user', 'x')] },
    };
    w.ingestRequest(e, e.body.messages);
    // The prompts display cache must never precede the journal req line
    // (a prompts failure must not cost the request its journal record).
    assert.deepEqual(order, ['conv', 'journal', 'prompts']);
  });

  it('cold-start hold flush: cross-request batch ordering is best-effort (documented, read side tolerates)', async () => {
    // A held metadata-less request flushes together with the first sid-bearing
    // one. AsyncWriteQueue groups by path at FIRST-enqueue position, so the
    // journal group (keyed at the held request's position) drains before the
    // later request's conv line — this pins the documented weak ordering so an
    // S3+ change to the queue's grouping is caught deliberately, not silently.
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const held = { timestamp: 't0', url: 'u', method: 'POST', isCountTokens: true, requestId: 'ct', body: { messages: [textMsg('user', 'held')] } };
    assert.equal(w.ingestRequest(held, held.body.messages), null, 'held: no sid yet');
    const e = {
      timestamp: 't1', url: 'u', method: 'POST', requestId: 'r1', mainAgent: true,
      body: { metadata: { user_id: jsonUserId }, messages: [textMsg('user', 'first')] },
    };
    assert.ok(w.ingestRequest(e, e.body.messages));
    await w.flush();
    const journal = readLines(sp('proj', SID).journalPath);
    const kinds = journal.filter(l => l.ph === 'req').map(l => l.kind);
    assert.deepEqual(kinds, ['countTokens', 'main'], 'held request journals first, in one batch');
    assert.ok(existsSync(convEpochPath(sp('proj', SID), 'misc', 0)), 'held conv content still lands');
  });
});

// ─── multi-window isolation: owner.lock claim lifecycle ─────────────────────
describe('V2Writer owner claim lifecycle', () => {
  const mkMain = () => ({
    timestamp: '2026-07-13T12:00:00.000Z', url: 'https://api.anthropic.com/v1/messages', method: 'POST',
    headers: {}, requestId: 'r1', mainAgent: true,
    body: { model: 'm', metadata: { user_id: jsonUserId }, messages: [textMsg('user', 'hello')] },
  });
  const lockPath = () => join(sp('proj', SID).dir, 'owner.lock');

  it('_session claims a fresh dir with this process pid; close() releases it synchronously', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkMain();
    w.ingestRequest(e, e.body.messages);
    const lock = JSON.parse(readFileSync(lockPath(), 'utf-8'));
    assert.equal(lock.pid, process.pid, 'the writing process claimed its session dir');
    const closing = w.close(); // release runs in close()'s synchronous head…
    assert.equal(existsSync(lockPath()), false, '…so the lock is gone even if the drain hangs past the 2s shutdown race');
    await closing;
  });

  it('resetSessions() (workspace switch) releases the claim — the dir becomes adoptable', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkMain();
    w.ingestRequest(e, e.body.messages);
    assert.equal(existsSync(lockPath()), true);
    w.resetSessions();
    assert.equal(existsSync(lockPath()), false);
    await w.close();
  });

  it('a teammate writer (leader set) never claims — any project viewer keeps following it', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true, leader: { agentName: 'sub', teamName: 't' } });
    const e = mkMain();
    w.ingestRequest(e, e.body.messages);
    assert.equal(existsSync(lockPath()), false);
    await w.close();
  });

  it('an IM worker (CCV_IM_PLATFORM) never claims', async () => {
    process.env.CCV_IM_PLATFORM = 'dingtalk';
    try {
      const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
      const e = mkMain();
      w.ingestRequest(e, e.body.messages);
      assert.equal(existsSync(lockPath()), false);
      await w.close();
    } finally { delete process.env.CCV_IM_PLATFORM; }
  });

  it('owner.lock is invisible to the read surfaces: listV2Sessions rows and dirSizeSync unaffected', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true });
    const e = mkMain();
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, { ...e, duration: 1, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } } });
    await w.flush();
    assert.equal(existsSync(lockPath()), true, 'claim present while the writer lives');
    const withLock = listV2Sessions(join(dir, 'proj'));
    assert.equal(withLock.length, 1, 'the claimed session lists normally');
    const sizeWith = dirSizeSync(sp('proj', SID).dir);
    await w.close(); // releases the lock
    _resetSessionList(); // journal is untouched by the lock — without this the second call is a cache hit and asserts nothing
    const withoutLock = listV2Sessions(join(dir, 'proj'));
    assert.equal(withoutLock.length, 1);
    assert.equal(withLock[0].sid, withoutLock[0].sid, 'row identity identical with/without the sidecar');
    assert.ok(sizeWith - dirSizeSync(sp('proj', SID).dir) < 200, 'the sidecar only ever adds its own ~60 bytes');
  });

  it('the offline converter (staging sessionsDirName) never stamps live ownership onto migrated history', async () => {
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true, sessionsDirName: 'sessions-migrating', metaExtra: { origin: 'convert' } });
    const e = mkMain();
    w.ingestRequest(e, e.body.messages);
    const staged = join(dir, 'proj', 'sessions-migrating');
    const names = readdirSync(staged);
    assert.equal(names.length, 1);
    assert.equal(existsSync(join(staged, names[0], 'owner.lock')), false);
    await w.close();
  });
});
