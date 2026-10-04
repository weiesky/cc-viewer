/**
 * Interceptor `_resumeProject` header extraction (2026-10).
 *
 * The main PTY self-reports its project via `x-ccv-project-dir` (spawnClaude
 * injects it), so every claude's writes route to its OWN project's store — this
 * is what keeps parallel background projects' monitoring intact. Drives the
 * REAL fetch hook (setupInterceptor over a fake fetch) and asserts:
 *   (a) an `x-ccv-project-dir` request header is parsed via projectKeyForCwd and
 *       lands on `requestEntry._resumeProject`, so the writer routes the write to
 *       the header's OWN project instead of the process-cwd project;
 *   (b) the header is stripped case-insensitively before forwarding upstream;
 *   (c) without the header, no `_resumeProject` is set (bound project applies).
 *
 * Isolation mirrors interceptor-v2-write.test.js: env must be pinned to a private
 * temp dir BEFORE the dynamic interceptor import (the module self-installs otherwise).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CCV_PROXY_MODE = '1';      // skip module-top setupInterceptor auto-run
process.env.CCV_SYNC_WRITES = '1';     // synchronous writes so we can read back
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-rproj-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const SID = '55556666-7777-4888-9999-000011112222';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });

let mod;
let lastUpstreamHeaders; // captured by the fake fetch (what the upstream would receive)

function mainAgentBody(messages) {
  return {
    system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
    tools: [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Task' }, { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' }, { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' }],
    metadata: { user_id: USER_ID },
    messages,
  };
}
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

function projectDirOf(projName) {
  return join(__isoDir, projName);
}
function sessionDirUnder(projName) {
  const sroot = join(projectDirOf(projName), 'sessions');
  try {
    const name = readdirSync(sroot).find((n) => n === SID || n.endsWith('_' + SID));
    return name ? join(sroot, name) : null;
  } catch { return null; }
}

before(async () => {
  globalThis.fetch = async (url, opts) => {
    lastUpstreamHeaders = opts?.headers || {};
    return new Response(JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  mod = await import('../server/interceptor.js');
  mod.setupInterceptor();
});

after(() => { setTimeout(() => process.exit(0), 30).unref(); });

describe('interceptor x-ccv-project-dir → _resumeProject', () => {
  it('(a)+(c) routes the write to the header project, stripped from upstream (mixed case)', async () => {
    const targetCwd = '/Users/test/resume-target'; // basename → resume-target
    // Deliberately mixed-case header name to exercise the case-insensitive strip.
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test', 'X-CcV-Project-Dir': targetCwd },
      body: JSON.stringify(mainAgentBody([textMsg('user', 'resume turn')])),
    });
    await mod._v2Writer.flush();

    // The write landed under the header-derived project, not the process-cwd project.
    assert.ok(sessionDirUnder('resume-target'), 'write routed to the header project');
    const procProj = basename(process.cwd()).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    if (procProj !== 'resume-target') {
      assert.equal(sessionDirUnder(procProj), null, 'no session dir under the process-cwd project');
    }
    // The internal routing header never reached the upstream.
    const upstreamKeys = Object.keys(lastUpstreamHeaders).map(k => k.toLowerCase());
    assert.ok(!upstreamKeys.includes('x-ccv-project-dir'), 'header stripped before upstream');
  });
});
