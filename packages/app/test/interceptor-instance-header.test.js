/**
 * Interceptor `x-ccv-instance` extraction + strip (2026-10-06, multi-instance).
 *
 * A spawned claude self-reports its PTY instanceKey via `x-ccv-instance` (spawnClaude
 * injects it alongside `x-ccv-project-dir`). The interceptor must surface it on
 * `requestEntry._ccvInstance` (so the writer can pin the resolved sessionId to THIS exact
 * process — basename routing cannot tell two same-cwd instances apart), and must strip the
 * header before forwarding upstream (it is ccv-internal and must never reach Anthropic).
 *
 * Mirrors interceptor-resume-project.test.js: drives the REAL fetch hook over a fake fetch
 * and captures the upstream-bound headers. Env is pinned to a private temp dir BEFORE the
 * dynamic interceptor import (the module self-installs otherwise).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.CCV_PROXY_MODE = '1';      // skip module-top setupInterceptor auto-run
process.env.CCV_SYNC_WRITES = '1';     // synchronous writes so we can read back
delete process.env.CCV_WORKSPACE_MODE;
delete process.env.CCV_IM_PLATFORM;
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-inst-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const SID = '11112222-3333-4444-5555-666677778888';
const USER_ID = JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: SID });
const INSTANCE = 'ccv-0123456789abcdef0123456789abcdef0123';

let mod;
let lastUpstreamHeaders; // captured by the fake fetch (what the upstream would receive)
let capturedEntry;       // the requestEntry passed to ingestRequest
let resolvedCalls = [];  // (sid, project, instanceKey) pinning calls from the writer

function mainAgentBody(messages) {
  return {
    system: [{ type: 'text', text: 'You are Claude Code, the official CLI.' }],
    tools: [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Task' }, { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' }, { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' }],
    metadata: { user_id: USER_ID },
    messages,
  };
}
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

before(async () => {
  globalThis.fetch = async (url, opts) => {
    lastUpstreamHeaders = opts?.headers || {};
    return new Response(JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  mod = await import('../server/interceptor.js');
  // Capture the entry the interceptor hands to the v2 writer, and the session-resolved
  // callback invocations (sid pinning).
  const origIngest = mod._v2Writer.ingestRequest.bind(mod._v2Writer);
  mod._v2Writer.ingestRequest = (entry, msgs) => { capturedEntry = entry; return origIngest(entry, msgs); };
  mod._v2Writer.setOnSessionResolved((sid, project, instanceKey) => { resolvedCalls.push({ sid, project, instanceKey }); });
  mod.setupInterceptor();
});

after(() => { setTimeout(() => process.exit(0), 30).unref(); });

describe('interceptor x-ccv-instance → _ccvInstance', () => {
  it('extracts a well-formed x-ccv-instance onto the entry and strips it before upstream', async () => {
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      // Mixed-case header name to exercise the case-insensitive read + strip.
      headers: { 'x-api-key': 'sk-test', 'X-CcV-Instance': INSTANCE, 'x-ccv-project-dir': '/Users/test/solo' },
      body: JSON.stringify(mainAgentBody([textMsg('user', 'hi')])),
    });
    await mod._v2Writer.flush();
    assert.equal(capturedEntry && capturedEntry._ccvInstance, INSTANCE, 'instance surfaced on the entry');
    const upstreamKeys = Object.keys(lastUpstreamHeaders).map(k => k.toLowerCase());
    assert.ok(!upstreamKeys.includes('x-ccv-instance'), 'x-ccv-instance stripped before upstream');
    assert.ok(!upstreamKeys.includes('x-ccv-project-dir'), 'x-ccv-project-dir still stripped too');
  });

  it('rejects a malformed instanceKey (no _ccvInstance set)', async () => {
    capturedEntry = null;
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test', 'x-ccv-instance': 'not a valid key!!' },
      body: JSON.stringify(mainAgentBody([textMsg('user', 'hi')])),
    });
    await mod._v2Writer.flush();
    assert.equal(capturedEntry && capturedEntry._ccvInstance, undefined, 'malformed instance not surfaced');
  });

  it('sets no _ccvInstance when the header is absent (legacy producer)', async () => {
    capturedEntry = null;
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test' },
      body: JSON.stringify(mainAgentBody([textMsg('user', 'hi')])),
    });
    await mod._v2Writer.flush();
    assert.equal(capturedEntry && capturedEntry._ccvInstance, undefined, 'no _ccvInstance without the header');
  });

  it('strips x-ccv-instance when headers arrive as a Headers instance (not a plain object)', async () => {
    // The strip loop has a distinct `hdrs instanceof Headers → hdrs.delete(name)` branch;
    // exercise it (the other cases pass a plain object).
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: new Headers({ 'x-api-key': 'sk-test', 'x-ccv-instance': INSTANCE, 'x-ccv-project-dir': '/Users/test/solo' }),
      body: JSON.stringify(mainAgentBody([textMsg('user', 'headers-instance turn')])),
    });
    await mod._v2Writer.flush();
    // lastUpstreamHeaders is the Headers instance the interceptor forwarded; it must no
    // longer carry either ccv-internal header.
    const keys = lastUpstreamHeaders instanceof Headers
      ? [...lastUpstreamHeaders.keys()].map(k => k.toLowerCase())
      : Object.keys(lastUpstreamHeaders).map(k => k.toLowerCase());
    assert.ok(!keys.includes('x-ccv-instance'), 'x-ccv-instance deleted from a Headers instance');
    assert.ok(!keys.includes('x-ccv-project-dir'), 'x-ccv-project-dir deleted from a Headers instance');
  });

  it('pins the sid for a MAIN-agent self-report (carries instanceKey to the session callback)', async () => {
    resolvedCalls = [];
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test', 'x-ccv-instance': INSTANCE, 'x-ccv-project-dir': '/Users/test/solo' },
      body: JSON.stringify(mainAgentBody([textMsg('user', 'main turn')])),
    });
    await mod._v2Writer.flush();
    const pin = resolvedCalls.find(c => c.instanceKey === INSTANCE);
    assert.ok(pin, 'main-agent request resolved a sid pinned to the instanceKey');
    assert.equal(pin.sid, SID);
    assert.equal(pin.project, 'solo');
  });

  it('does NOT pin the sid for a non-main-agent (teammate/subagent) self-report — review P1', async () => {
    // A teammate/subagent child inherits the parent's ANTHROPIC_CUSTOM_HEADERS (so it sends
    // the parent's x-ccv-instance) but runs its OWN conversation/sid. Without the main-agent
    // gate it would overwrite the parent record's sessionId with the teammate's sid.
    resolvedCalls = [];
    // A body whose system prompt marks it a teammate/subagent → isMainAgentRequest=false.
    const teammateBody = {
      system: [{ type: 'text', text: 'You are a teammate agent (cc_is_subagent=true).' }],
      tools: [{ name: 'Read' }],
      metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: '99998888-7777-4666-8555-444433332222' }) },
      messages: [textMsg('user', 'teammate turn')],
    };
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test', 'x-ccv-instance': INSTANCE, 'x-ccv-project-dir': '/Users/test/solo' },
      body: JSON.stringify(teammateBody),
    });
    await mod._v2Writer.flush();
    const pin = resolvedCalls.find(c => c.instanceKey === INSTANCE && c.sid === '99998888-7777-4666-8555-444433332222');
    assert.equal(pin, undefined, 'teammate sid must NOT be pinned onto the parent instance record');
  });

  it('stamps the owning instanceKey onto the session dir meta.json (write-side, first-write-wins)', async () => {
    // Multi-instance B3: the writer must persist `entry._ccvInstance` into meta.json's
    // `instance` field so cold-load / live-feed can tell two same-cwd instances' sessions apart.
    const INST2 = 'ccv-ffee00112233445566778899aabbccddeeff';
    await globalThis.fetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { 'x-api-key': 'sk-test', 'x-ccv-instance': INST2, 'x-ccv-project-dir': '/Users/test/instmeta' },
      body: JSON.stringify(mainAgentBody([textMsg('user', 'meta instance turn')])),
    });
    await mod._v2Writer.flush();
    // Find the session dir under <isoDir>/instmeta/sessions/* and read its meta.json.
    const sroot = join(__isoDir, 'instmeta', 'sessions');
    const dirs = existsSync(sroot) ? readdirSync(sroot) : [];
    assert.ok(dirs.length > 0, 'a session dir was created for the instmeta project');
    const meta = JSON.parse(readFileSync(join(sroot, dirs[0], 'meta.json'), 'utf-8'));
    assert.equal(meta.instance, INST2, 'meta.json carries the owning instanceKey');
  });
});
