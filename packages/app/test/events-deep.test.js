// Deep coverage for server/routes/events.js — fills residual arms left by
// api-events-gap.test.js / events-kv-context-scan.test.js / events-backpressure.test.js.
// wire-v2 (1.7.0): the resume flow (resume_prompt frame, /api/resume-choice) and
// the v1 LOG_FILE are gone; /events streams the live v2 session (getLiveLogSource).
//   /events ping timer callback: 30s setInterval writes ping
//   /events server_config write catch: res.write throws → warned + swallowed
//   /events streamRawEntriesAsync write catch: load_chunk write throws → return
//   /events backpressure await: res.write returns false → awaitDrainOrClose
//   (/api/entries/page removed in 1.7.0 P3)
//
// Isolation pattern (key): non-workspace cold-start mode — env / cwd set BEFORE
// importing the interceptor so the project binding resolves inside the tmp dir.
//   - chdir to a deterministic temp project dir → projectName=basename predictable
//   - CCV_PROXY_MODE=1 → skips setupInterceptor()'s http/https patch and the
//     server.js autostart, but module init still runs normally
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// ── Cold-start isolation: env / cwd BEFORE importing the interceptor ─────────
const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-events-deep-'));
const logRoot = join(tmpRoot, 'logs');
const projectCwd = join(tmpRoot, 'evdeepproj');
mkdirSync(logRoot, { recursive: true });
mkdirSync(projectCwd, { recursive: true });
process.env.CCV_LOG_DIR = logRoot;
process.env.CCV_PROXY_MODE = '1';            // skip http patch + server autostart
delete process.env.CCV_WORKSPACE_MODE;       // cold-start project binding from cwd
delete process.env.CCV_CLI_MODE;
delete process.env.CCV_IM_PLATFORM;
const origCwd = process.cwd();
process.chdir(projectCwd);

const projectName = basename(projectCwd).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
const projectLogDir = join(logRoot, projectName);
mkdirSync(projectLogDir, { recursive: true });

function mainAgentEntry(tstamp, inputTokens, extra = {}) {
  return {
    timestamp: tstamp,
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST', status: 200, mainAgent: true,
    body: { model: 'claude-opus-4-8', system: [{ type: 'text', text: 'You are Claude Code' }], tools: [{ name: 'Bash' }], messages: [{ role: 'user', content: 'hi' }] },
    response: { body: { usage: { input_tokens: inputTokens, output_tokens: 10 } } },
    ...extra,
  };
}
const SEP = '\n---\n';
function serialize(entries) { return entries.map(e => JSON.stringify(e)).join(SEP) + SEP; }

// ── 收集型 res（亦 EventEmitter，支持可注入 write 行为） ─────────────────────────
function makeRes(opts = {}) {
  const res = new EventEmitter();
  res.statusCode = 0; res.headers = null; res.chunks = []; res.ended = false;
  res.destroyed = false; res.writable = true;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => {
    const s = c == null ? '' : (Buffer.isBuffer(c) ? c.toString('utf-8') : String(c));
    if (opts.onWrite) { const r = opts.onWrite(s, res); if (r !== undefined) return r; }
    res.chunks.push(s);
    return true;
  };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c.toString('utf-8') : String(c)); res.ended = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}
function bodyStr(res) { return res.chunks.join(''); }
function parseFrames(out) {
  const frames = [];
  for (const block of out.split('\n\n')) {
    if (!block.trim()) continue;
    const ev = { event: 'message', data: '' };
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) ev.event = line.slice(7);
      else if (line.startsWith('data: ')) ev.data += line.slice(6);
    }
    frames.push(ev);
  }
  return frames;
}
function url(pathname, query = {}) { return { pathname, searchParams: new URLSearchParams(query) }; }

let interceptor, eventsMod, events;

before(async () => {
  interceptor = await import('../server/interceptor.js');
  await interceptor._initPromise;
  assert.equal(interceptor._projectName, projectName);

  eventsMod = await import('../server/routes/events.js');
  const find = (p, m) => eventsMod.eventsRoutes.find(r => r.path === p && r.method === m).handler;
  events = find('/events', 'GET');
});

after(() => {
  process.chdir(origCwd);
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Seed the LIVE v2 session (the /events read source): fresh session id per
// call so each test sees exactly its own entries.
let sidCounter = 0;
async function seedV2(entries) {
  const w = interceptor._v2Writer;
  w.resetSessions();
  const sid = `30000000-0000-4000-8000-${String(++sidCounter).padStart(12, '0')}`;
  for (const e of entries) {
    e.body.metadata = { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid }) };
    const h = w.ingestRequest(e, e.body.messages);
    w.ingestCompletion(h, e);
  }
  await w.flush();
}

function eventsDeps(over = {}) {
  return {
    turnEndDebounceMs: 1234, DEFAULT_EVENTS_LIMIT: 400, SSE_BACKPRESSURE_TIMEOUT_MS: 50,
    pendingMajorUpdate: null, clients: [], ...over,
  };
}

describe('events-deep: /events server_config catch + ping', () => {
  it('swallows a throwing server_config write and still completes', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    // 仅在 server_config 那次 write 抛错，其余照常
    const res = makeRes({
      onWrite(s) { if (s.startsWith('event: server_config')) throw new Error('boom'); },
    });
    await events(req, res, url('/events'), true, eventsDeps());
    // 后续帧仍写入（load_end 等），handler 不抛
    const frames = parseFrames(bodyStr(res));
    assert.ok(frames.find(f => f.event === 'load_end'), 'server_config 写失败后流程继续');
  });

  it('ping timer writes an SSE ping after 30s', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes();
    const deps = eventsDeps();
    await events(req, res, url('/events'), true, deps);
    res.chunks.length = 0; // 清掉加载阶段帧，只看 ping
    t.mock.timers.tick(30000);
    const frames = parseFrames(bodyStr(res));
    assert.ok(frames.find(f => f.event === 'ping'), 'ping 帧在 30s 后写出');
    // 清理：移除 client + 停掉 interval（close 会 clearInterval）
    req.emit('close');
  });
});

describe('events-deep: /events streaming write catch + backpressure', () => {
  it('returns from the stream callback when a load_chunk write throws', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    const res = makeRes({
      onWrite(s) { if (s.startsWith('event: load_chunk')) throw new Error('pipe gone'); },
    });
    // handler 不应抛；load_chunk 写抛被 catch → return（该条跳过）
    await events(req, res, url('/events'), true, eventsDeps());
    assert.ok(true, 'events 在 load_chunk 写抛时不抛穿');
  });

  it('awaits drain when a data write returns false', async () => {
    await seedV2([mainAgentEntry('2026-06-06T01:00:00.000Z', 100)]);
    const req = new EventEmitter(); req.headers = {};
    // data 行（load_chunk 的第二次 write，即 raw 内容）返回 false → !drained → awaitDrainOrClose
    let dataWrites = 0;
    const res = makeRes({
      onWrite(s) {
        // load_chunk 的内容行不以 'event:' 开头（是 raw JSON 串）
        if (!s.startsWith('event: ') && !s.startsWith('data: ') && s.includes('"mainAgent"')) {
          dataWrites++;
          return false; // 触发 backpressure
        }
      },
    });
    await events(req, res, url('/events'), true, eventsDeps({ SSE_BACKPRESSURE_TIMEOUT_MS: 30 }));
    assert.ok(dataWrites >= 1, 'data 写至少一次返回 false 触发 backpressure 路径');
  });
});

