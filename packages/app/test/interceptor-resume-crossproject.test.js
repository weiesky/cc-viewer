/**
 * interceptor-resume-crossproject.test.js — markSessionStart cross-project guard
 * (interceptor.js), relaxed 2026-10-06 for true /resume into a PARALLEL viewed project.
 *
 * Previously markSessionStart dropped any SessionStart hook whose cwd mapped to a
 * non-bound project, so a /resume inside a parallel project never re-bound the writer.
 * Now: a hook whose cwd matches a LIVE ccv-managed claude project arms beginResumeSwitch
 * keyed by THAT project; a genuinely unmanaged project is still dropped; the bound
 * project still arms the default (bound) key.
 *
 * Isolation: CCV_LOG_DIR / CLAUDE_CONFIG_DIR pinned to a private mkdtemp BEFORE the
 * dynamic imports. pty-manager is mocked via _setPtyImportForTests (no real spawn).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CCV_PROXY_MODE = '1';   // skip module-top setupInterceptor auto-run
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;
const iso = mkdtempSync(join(tmpdir(), 'ccv-resume-xproj-'));
process.env.CCV_LOG_DIR = iso;
process.env.CLAUDE_CONFIG_DIR = iso;

const TRANSCRIPT_UUID = 'bbbb2222-89ab-4cde-8f01-23456789abcd';

let interceptor;
let ptyMgr;
let projectKeyForCwd;

after(() => {
  try { rmSync(iso, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(0), 30).unref();
});

async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('markSessionStart cross-project guard (parallel-project true-resume)', () => {
  before(async () => {
    interceptor = await import('../server/interceptor.js');
    ptyMgr = await import('../server/pty-manager.js');
    ({ projectKeyForCwd } = await import('../server/lib/system-prompt-snapshots.js'));
    // Bind the server to a project so _projectName is non-empty.
    const boundDir = join(iso, 'boundProj');
    mkdirSync(boundDir, { recursive: true });
    interceptor.initForWorkspace(boundDir, { forceNew: true });
    interceptor._v2Writer.resetSessions();
  });

  after(() => {
    try { ptyMgr._resetForTests(); ptyMgr._setPtyImportForTests(null); } catch {}
  });

  it('arms the bound project key for a bound-cwd resume hook', async () => {
    interceptor._v2Writer._pendingResumeSwitch.clear();
    const boundCwd = join(iso, 'boundProj');
    interceptor.markSessionStart({ source: 'resume', sessionId: 's-bound', transcriptPath: `/t/${TRANSCRIPT_UUID}.jsonl`, cwd: boundCwd });
    await flushMicrotasks();
    assert.ok(interceptor._v2Writer._pendingResumeSwitch.get('boundProj'), 'bound project switch armed');
  });

  it('arms a parallel project key when the hook cwd is a LIVE ccv claude project', async () => {
    interceptor._v2Writer._pendingResumeSwitch.clear();
    const parallelDir = join(iso, 'parallelProj');
    mkdirSync(parallelDir, { recursive: true });
    // Make the parallel project a live ccv-managed claude PTY.
    ptyMgr._resetForTests();
    ptyMgr._setPtyImportForTests(() => ({ spawn: () => ({ onData() {}, onExit() {}, kill() {}, resize() {}, write() {}, pid: 60000 }) }));
    await ptyMgr.spawnClaude(9999, parallelDir, [], 'claude');

    interceptor.markSessionStart({ source: 'resume', sessionId: 's-par', transcriptPath: `/t/${TRANSCRIPT_UUID}.jsonl`, cwd: parallelDir });
    await flushMicrotasks();
    const parallelKey = projectKeyForCwd(parallelDir);
    assert.ok(interceptor._v2Writer._pendingResumeSwitch.get(parallelKey), 'parallel project switch armed under its own key');
  });

  it('drops a resume hook from an unmanaged (non-live) project', async () => {
    interceptor._v2Writer._pendingResumeSwitch.clear();
    const foreignCwd = join(iso, 'foreignNotLive');
    mkdirSync(foreignCwd, { recursive: true });
    // No PTY spawned for this cwd → isLiveClaudeProject false → dropped.
    interceptor.markSessionStart({ source: 'resume', sessionId: 's-foreign', transcriptPath: `/t/${TRANSCRIPT_UUID}.jsonl`, cwd: foreignCwd });
    await flushMicrotasks();
    assert.equal(interceptor._v2Writer._pendingResumeSwitch.get(projectKeyForCwd(foreignCwd)), undefined, 'unmanaged project switch NOT armed');
  });
});
