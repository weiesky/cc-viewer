/**
 * 1.7.0 P2 — startup migration prompt (server/lib/v2/migrate-prompt.js, the
 * /events migrate_prompt frame, and the -c continuation detection channels).
 *
 * Trigger matrix pinned here:
 *   - v1 files present & unconverted → pending (files/bytes counted)
 *   - status:'done' short-circuits → not pending (dual-write covers tail growth)
 *   - convert state marks a file done AT ITS SIZE → not pending
 *   - a grown "done" file when status != 'done' → pending again
 *   - empty v1 shells are ignored; other projects with pending logs counted
 *   - /events emits the migrate_prompt frame only when pending, carrying
 *     `continued` from isContinuedLaunch()
 *   - continuation channels: env (cli.js), markContinuedLaunch (workspace
 *     route), wire-level (first main wire already has assistant turns)
 *
 * Data-safety: env is locked to a mkdtemp dir BEFORE any dynamic import of
 * project modules (2026-06-06 incident rule); fixtures never touch a real
 * CCV_LOG_DIR.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-migrate-prompt-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1'; // interceptor boots project-less; tests bind via initForWorkspace
process.env.CCV_CLI_MODE = '0';
delete process.env.CCV_CLAUDE_CONTINUE;

let migrationStatus, interceptor, eventsRoutes;
before(async () => {
  ({ migrationStatus } = await import('../server/lib/v2/migrate-prompt.js'));
  interceptor = await import('../server/interceptor.js');
  ({ eventsRoutes } = await import('../server/routes/events.js'));
});

const PROJECT = 'projMig';
const projectDir = () => join(tmpDir, PROJECT);
function writeV1(name, bytes = 'x'.repeat(64)) {
  mkdirSync(projectDir(), { recursive: true });
  writeFileSync(join(projectDir(), name), bytes);
}

describe('migrationStatus', () => {
  it('no project / no v1 files → not pending', () => {
    assert.deepEqual(migrationStatus(tmpDir, ''), { pending: false, files: 0, totalBytes: 0, otherProjects: 0 });
    mkdirSync(projectDir(), { recursive: true });
    assert.equal(migrationStatus(tmpDir, PROJECT).pending, false);
  });

  it('unconverted v1 files → pending with file/byte counts; empty shells ignored', () => {
    writeV1(`${PROJECT}_20260101_000000.jsonl`);
    writeV1(`${PROJECT}_20260102_000000.jsonl`);
    writeV1(`${PROJECT}_20260103_000000.jsonl`, ''); // empty shell
    const st = migrationStatus(tmpDir, PROJECT);
    assert.equal(st.pending, true);
    assert.equal(st.files, 2);
    assert.equal(st.totalBytes, 128);
  });

  it('convert state marks files done at size → not pending; status done prevents re-pend from growth', () => {
    const f1 = `${PROJECT}_20260101_000000.jsonl`;
    const f2 = `${PROJECT}_20260102_000000.jsonl`;
    const sizeOf = (n) => statSync(join(projectDir(), n)).size;
    writeFileSync(join(projectDir(), 'wire-v2-convert-state.json'), JSON.stringify({
      version: 1,
      status: 'done',
      files: [
        { name: f1, size: sizeOf(f1), done: true },
        { name: f2, size: sizeOf(f2), done: true },
      ],
    }));
    assert.equal(migrationStatus(tmpDir, PROJECT).pending, false, 'fully converted project stops prompting');

    writeFileSync(join(projectDir(), f2), 'x'.repeat(128)); // grew after conversion
    const st = migrationStatus(tmpDir, PROJECT);
    assert.equal(st.pending, false, 'a grown file after status:done does not re-prompt (migration complete)');
  });

  it('a grown done-file re-pends when status is not done (converter trust rule)', () => {
    const f1 = `${PROJECT}_20260101_000000.jsonl`;
    const f2 = `${PROJECT}_20260102_000000.jsonl`;
    const sizeOf = (n) => statSync(join(projectDir(), n)).size;
    writeFileSync(join(projectDir(), 'wire-v2-convert-state.json'), JSON.stringify({
      version: 1,
      // No status field — simulates an in-progress/interrupted state file
      files: [
        { name: f1, size: sizeOf(f1), done: true },
        { name: f2, size: sizeOf(f2), done: true },
      ],
    }));
    assert.equal(migrationStatus(tmpDir, PROJECT).pending, false, 'files match recorded sizes at pre-grow');

    writeFileSync(join(projectDir(), f2), 'x'.repeat(256)); // grew beyond the 128 left by previous test
    const st = migrationStatus(tmpDir, PROJECT);
    assert.equal(st.pending, true, 'a grown done-file re-pends when status is not done');
    assert.equal(st.files, 1);
  });

  it('other projects with pending v1 logs are counted (fully-converted ones are not)', () => {
    mkdirSync(join(tmpDir, 'otherA'), { recursive: true });
    writeFileSync(join(tmpDir, 'otherA', 'otherA_20260101_000000.jsonl'), 'yyy');
    const st = migrationStatus(tmpDir, PROJECT);
    assert.equal(st.otherProjects, 1);
  });
});

describe('continuation detection channels', () => {
  it('wire-level: a fresh session whose FIRST main wire has assistant turns marks continued', () => {
    assert.equal(interceptor.isContinuedLaunch(), false, 'clean boot');
    // Fresh writer instances for isolation (same class the interceptor uses).
    const V2Writer = interceptor._v2Writer.constructor;
    const mk = () => new V2Writer({ logDir: tmpDir, project: PROJECT, enabled: true, minFreeBytes: 0 });
    const uid = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
    const entryOf = (sid, messages) => ({
      timestamp: new Date().toISOString(),
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: {
        model: 'm',
        system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
        tools: [{ name: 'Bash' }],
        metadata: { user_id: uid(sid) }, messages,
      },
      response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false,
      mainAgent: true, requestId: `r${Math.random()}`,
    });

    const fresh = mk();
    fresh.ingestRequest(entryOf('11111111-1111-4111-8111-111111111111', [{ role: 'user', content: 'hi' }]), null);
    assert.equal(fresh.sawContinuedSession(), false, 'single-user-message first wire is a fresh conversation');
    // Second request growing the wire must NOT trigger (only the FIRST wire counts).
    fresh.ingestRequest(entryOf('11111111-1111-4111-8111-111111111111', [
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'more' },
    ]), null);
    assert.equal(fresh.sawContinuedSession(), false);

    const continued = mk();
    continued.ingestRequest(entryOf('22222222-2222-4222-8222-222222222222', [
      { role: 'user', content: 'old turn' }, { role: 'assistant', content: 'old reply' }, { role: 'user', content: 'continue!' },
    ]), null);
    assert.equal(continued.sawContinuedSession(), true, '-c signature: first wire already has assistant turns');
  });

  it('markContinuedLaunch (workspace route channel) and CCV_CLAUDE_CONTINUE (cli channel) both flip isContinuedLaunch', () => {
    assert.equal(interceptor.isContinuedLaunch(), false);
    process.env.CCV_CLAUDE_CONTINUE = '1';
    assert.equal(interceptor.isContinuedLaunch(), true, 'env channel');
    delete process.env.CCV_CLAUDE_CONTINUE;
    assert.equal(interceptor.isContinuedLaunch(), false);
    interceptor.markContinuedLaunch();
    assert.equal(interceptor.isContinuedLaunch(), true, 'workspace-route channel (sticky)');
  });

  it('markForkSession flips isForkSession, but a workspace switch clears it (fork must not leak into a later -c)', () => {
    assert.equal(interceptor.isForkSession(), false, 'no fork by default');
    interceptor.markForkSession();
    assert.equal(interceptor.isForkSession(), true, 'workspace-route fork channel');
    // A later workspace launch must NOT inherit the fork intent — otherwise one
    // `--fork-session` launch would permanently suppress `-c` adoption for the
    // rest of a long-lived server process.
    interceptor.initForWorkspace(join(tmpDir, 'wsFork', PROJECT));
    assert.equal(interceptor.isForkSession(), false, 'initForWorkspace clears the fork mark');
    // …while the continuation mark stays sticky (the migrate prompt relies on it).
    assert.equal(interceptor.isContinuedLaunch(), true, 'continued mark survives the workspace switch');
  });
});

describe('/events migrate_prompt frame', () => {
  function makeRes() {
    const res = new EventEmitter();
    res.chunks = [];
    res.destroyed = false;
    res.writable = true;
    res.writeHead = () => res;
    res.write = (c) => { res.chunks.push(String(c)); return true; };
    res.end = () => { res.emit('finish'); return res; };
    return res;
  }
  const frames = (res) => res.chunks.join('').split('\n\n').filter(Boolean);
  const migrateFrame = (res) => frames(res).find((f) => f.startsWith('event: migrate_prompt'));

  async function connectEvents() {
    const handler = eventsRoutes.find((r) => r.path === '/events').handler;
    const req = new EventEmitter();
    const res = makeRes();
    const deps = {
      clients: [],
      pendingMajorUpdate: null,
      turnEndDebounceMs: 1000,
      DEFAULT_EVENTS_LIMIT: 1000,
      SSE_BACKPRESSURE_TIMEOUT_MS: 1000,
    };
    await handler(req, res, { searchParams: new URLSearchParams() }, true, deps);
    res.emit('close'); // release the ping timer bookkeeping
    return res;
  }

  it('emits the frame when the CURRENT project has pending v1 logs, with continued flag', async () => {
    // The previous test left a convert state with status:'done' — remove it so
    // this test sees genuinely pending (never-migrated) v1 files.
    try { rmSync(join(tmpDir, PROJECT, 'wire-v2-convert-state.json')); } catch {}
    // Bind the interceptor to the fixture project (workspace mode boots bare;
    // initForWorkspace derives the project name from the path's basename).
    interceptor.initForWorkspace(join(tmpDir, 'ws', PROJECT));
    const res = await connectEvents();
    const frame = migrateFrame(res);
    assert.ok(frame, 'migrate_prompt frame present');
    const data = JSON.parse(frame.split('\ndata: ')[1]);
    assert.equal(data.files >= 1, true);
    assert.equal(typeof data.totalBytes, 'number');
    assert.equal(data.continued, true, 'markContinuedLaunch from the previous describe is sticky');
  });

  it('no frame when the project has no pending v1 logs', async () => {
    const cleanDir = join(tmpDir, 'projClean');
    mkdirSync(cleanDir, { recursive: true });
    interceptor.initForWorkspace(cleanDir);
    const res = await connectEvents();
    assert.equal(migrateFrame(res), undefined);
  });
});
