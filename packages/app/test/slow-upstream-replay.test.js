// Verifies that a transient terminal-WS disconnect does not lose a still-pending
// slow-upstream advisory, and that settlement removes its reconnect snapshot.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-slow-upstream-replay-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_CLI_MODE = '1';
process.env.CCV_SDK_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_IM_PLATFORM;
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_BASE_URL;
delete process.env.CCV_ALLOWED_HOSTS;

let server, sdk, proxyStats, port;
const clients = new Set();

function connect(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    ws.on('error', reject);
    ws.on('open', () => {
      clients.add(ws);
      resolve({ ws, messages });
    });
  });
}

async function waitFor(pred, label) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 3000) throw new Error(`timeout: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

before(async () => {
  server = await import('../server/server.js');
  sdk = await import('../server/lib/sdk-manager.js');
  proxyStats = await import('../server/lib/proxy/proxy-stats.js');
  sdk.__setQueryForTests(() => ({
    async *[Symbol.asyncIterator]() { yield* []; },
    interrupt() { return Promise.resolve(); },
    close() {},
  }));
  sdk.initSdkSession('/work/slow-a', 'slow-a');
  sdk.initSdkSession('/work/slow-b', 'slow-b');
  const [a, b] = sdk.listSdkSessions();
  await server.startViewer();
  port = server.getPort();
  await waitFor(() => port > 0, 'SDK-mode viewer');
  const first = await connect(`/ws/terminal?project=slow-a&instance=${encodeURIComponent(a.instanceKey)}`);
  const second = await connect(`/ws/terminal?project=slow-b&instance=${encodeURIComponent(b.instanceKey)}`);
  await waitFor(() => first.messages.some(m => m.type === 'state'), 'first connection initialized');
  await waitFor(() => second.messages.some(m => m.type === 'state'), 'second connection initialized');
  proxyStats.emitSlowUpstream({ type: 'slow', requestId: 'sq-replay-a', cwd: '/work/slow-a', instanceKey: a.instanceKey, waitingMs: 30000 });
  proxyStats.emitSlowUpstream({ type: 'slow', requestId: 'sq-replay-b', cwd: '/work/slow-b', instanceKey: b.instanceKey, waitingMs: 40000 });
  await waitFor(() => first.messages.some(m => m.type === 'sdk-slow-upstream'), 'first advisory');
  await waitFor(() => second.messages.some(m => m.type === 'sdk-slow-upstream'), 'second advisory');
  await first.ws.close();
});

after(async () => {
  for (const ws of clients) {
    if (ws.readyState === 1 || ws.readyState === 0) {
      await new Promise(resolve => { ws.once('close', resolve); ws.close(); });
    }
  }
  try { sdk.stopSession(); } catch {}
  server.stopViewer();
  await new Promise(resolve => setTimeout(resolve, 100));
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('slow-upstream terminal-WS replay', () => {
  it('restores only the viewed instance after reconnect and forgets resolved requests', async () => {
    const a = sdk.listSdkSessions().find(s => s.cwd === '/work/slow-a');
    const b = sdk.listSdkSessions().find(s => s.cwd === '/work/slow-b');
    const reconnected = await connect(`/ws/terminal?project=slow-a&instance=${encodeURIComponent(a.instanceKey)}`);
    await waitFor(() => reconnected.messages.some(m => m.type === 'state'), 'reconnect replay complete');
    const replayed = reconnected.messages.filter(m => m.type === 'sdk-slow-upstream');
    assert.deepEqual(replayed.map(m => m.requestId), ['sq-replay-a']);
    assert.ok(replayed[0].waitingMs >= 30000, 'replay preserves elapsed waiting time');
    reconnected.ws.send(JSON.stringify({ type: 'attach', project: 'slow-b', instanceKey: b.instanceKey }));
    await waitFor(() => reconnected.messages.some(m => m.type === 'sdk-slow-upstream' && m.requestId === 'sq-replay-b'), 'attach replay');
    proxyStats.emitSlowUpstream({ type: 'resolved', requestId: 'sq-replay-a', cwd: '/work/slow-a', instanceKey: a.instanceKey });
    const afterResolved = await connect(`/ws/terminal?project=slow-a&instance=${encodeURIComponent(a.instanceKey)}`);
    await waitFor(() => afterResolved.messages.some(m => m.type === 'state'), 'post-resolution replay complete');
    assert.equal(afterResolved.messages.filter(m => m.type === 'sdk-slow-upstream').length, 0, 'a settled request is not replayed');
    const other = await connect(`/ws/terminal?project=slow-b&instance=${encodeURIComponent(b.instanceKey)}`);
    await waitFor(() => other.messages.some(m => m.type === 'state'), 'second instance replay complete');
    assert.deepEqual(other.messages.filter(m => m.type === 'sdk-slow-upstream').map(m => m.requestId), ['sq-replay-b']);
  });
});
