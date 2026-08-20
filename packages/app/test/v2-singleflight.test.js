/**
 * wire-v2 S10b — SingleFlight in-flight coalescing + bounded TTL micro-cache
 * (server/lib/v2/singleflight.js) and its integration into the windowed reads
 * (server/lib/v2/adapter.js).
 *
 * Concurrent identical window loads (multi-tab /events, reconnect storms,
 * /api/local-log + IM on the live session) used to run one full synthesis
 * EACH — the 2026-07-15 OOM multiplier. These tests pin:
 *   - one shared run under N concurrent same-key callers
 *   - different keys do not share
 *   - the TTL cache serves within the window and expires after it
 *   - cached=false (the /events live-attach path) never READS the cache but
 *     still joins an in-flight run and still populates it
 *   - failed runs are never cached and release the in-flight slot
 *   - integration: N concurrent readV2WindowedEntries(sameDir,sameLimit) run
 *     exactly one Pass A scan; the /events (cached=false) caller does not
 *     consume a stale cached window
 *
 * Data-safety: fixtures live in mkdtemp dirs; nothing touches a real
 * CCV_LOG_DIR.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SingleFlight } from '../server/lib/v2/singleflight.js';
import { V2Writer } from '../server/lib/v2/v2-writer.js';
import { readV2WindowedEntries, _v2WindowStatsForTest } from '../server/lib/v2/adapter.js';

// ─── SingleFlight unit ───────────────────────────────────────────────────────
describe('SingleFlight coalescing', () => {
  let clock;
  const mkClock = () => { let t = 1000; return { now: () => t, advance: (ms) => { t += ms; } }; };
  beforeEach(() => { clock = mkClock(); });

  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };

  it('coalesces N concurrent same-key callers into one run', async () => {
    const sf = new SingleFlight({ now: clock.now });
    let runs = 0;
    const d = deferred();
    const fn = () => { runs++; return d.promise; };
    const p1 = sf.run('k', fn);
    const p2 = sf.run('k', fn);
    const p3 = sf.run('k', fn);
    d.resolve('V');
    assert.deepEqual(await Promise.all([p1, p2, p3]), ['V', 'V', 'V']);
    assert.equal(runs, 1, 'one shared run');
  });

  it('different keys do not share', async () => {
    const sf = new SingleFlight({ now: clock.now });
    let runs = 0;
    await Promise.all([
      sf.run('a', () => { runs++; return 'A'; }),
      sf.run('b', () => { runs++; return 'B'; }),
    ]);
    assert.equal(runs, 2);
  });

  it('serves the TTL cache within the window and re-runs after expiry', async () => {
    const sf = new SingleFlight({ ttlMs: 500, now: clock.now });
    let runs = 0;
    const fn = () => { runs++; return `r${runs}`; };
    assert.equal(await sf.run('k', fn), 'r1');
    clock.advance(300);
    assert.equal(await sf.run('k', fn), 'r1', 'served from cache');
    assert.equal(runs, 1);
    clock.advance(300); // now 600ms past the first run > ttl
    assert.equal(await sf.run('k', fn), 'r2', 're-run after expiry');
    assert.equal(runs, 2);
  });

  it('cached=false skips the cache READ but still populates and coalesces', async () => {
    const sf = new SingleFlight({ ttlMs: 500, now: clock.now });
    let runs = 0;
    const fn = () => { runs++; return `r${runs}`; };
    assert.equal(await sf.run('k', fn), 'r1'); // populate
    // Live-attach caller: must NOT get the cached r1, must run fresh.
    assert.equal(await sf.run('k', fn, { cached: false }), 'r2');
    assert.equal(runs, 2);
    // But its result DID populate the cache for a later historical reader.
    assert.equal(await sf.run('k', fn), 'r2');
    assert.equal(runs, 2, 'historical reader served the fresh r2 from cache');
  });

  it('never caches a failed run and releases the in-flight slot', async () => {
    const sf = new SingleFlight({ now: clock.now });
    await assert.rejects(sf.run('k', () => { throw new Error('boom'); }), /boom/);
    assert.equal(sf._statsForTest().inflightSize, 0, 'slot released');
    let runs = 0;
    assert.equal(await sf.run('k', () => { runs++; return 'ok'; }), 'ok', 'next run is fresh, not a cached error');
    assert.equal(runs, 1);
  });
});

// ─── integration: window reads coalesce Pass A ───────────────────────────────
describe('windowed read coalescing (S10b)', () => {
  let dir;
  const SID = 'c1234567-89ab-4cde-8f01-23456789abcd';
  const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
  const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });
  const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
  const TOOLS = [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Task' }, { name: 'Read' }, { name: 'Grep' }, { name: 'Glob' }]
    .map((t) => ({ ...t, input_schema: {} }));
  let tsc = 0;
  const nextTs = () => new Date(Date.UTC(2026, 6, 14, 5, 0, 0, ++tsc)).toISOString();
  const mainEntry = (messages) => ({
    timestamp: nextTs(), project: 'proj', url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST',
    headers: {}, body: { model: 'm', system: SYSTEM, tools: TOOLS, metadata: { user_id: userIdOf(SID) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false, mainAgent: true, requestId: `rid_${++tsc}`,
  });

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ccv-sf-'));
    const w = new V2Writer({ logDir: dir, project: 'proj', enabled: true, minFreeBytes: 0 });
    const msgs = [textMsg('user', 'turn 1')];
    const fire = (e) => { const h = w.ingestRequest(e, e.body.messages); w.ingestCompletion(h, { ...e, response: { status: 200, headers: {}, body: { content: [], usage: { input_tokens: 1, output_tokens: 1 } } }, duration: 1 }); };
    fire(mainEntry([...msgs]));
    for (let i = 2; i <= 8; i++) { msgs.push(textMsg('assistant', `r${i - 1}`), textMsg('user', `turn ${i}`)); fire(mainEntry([...msgs])); }
    await w.flush();
    _v2WindowStatsForTest(true); // reset counters
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  const sessionDir = () => join(dir, 'proj', 'sessions', SID);

  it('N concurrent identical window reads run exactly one Pass A scan', async () => {
    const sdir = sessionDir();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => readV2WindowedEntries(sdir, { limit: 3, cached: true })),
    );
    // All callers get the same window.
    for (const r of results) assert.deepEqual(r.entries, results[0].entries);
    const stats = _v2WindowStatsForTest();
    assert.equal(stats.scanRuns, 1, 'one shared Pass A scan across 5 concurrent callers');
    assert.equal(stats.materializeRuns, 1, 'one shared Pass B materialization');
  });

  it('the live-attach (cached=false) caller does not consume a stale cached window', async () => {
    const sdir = sessionDir();
    // Prime the cache with a historical read.
    await readV2WindowedEntries(sdir, { limit: 3, cached: true });
    const primed = _v2WindowStatsForTest();
    assert.equal(primed.materializeRuns, 1);
    // A subsequent cached read is served from the TTL cache (no new run).
    await readV2WindowedEntries(sdir, { limit: 3, cached: true });
    assert.equal(_v2WindowStatsForTest().materializeRuns, 1, 'cached read reused');
    // The live-attach caller (cached=false) forces a fresh materialization.
    await readV2WindowedEntries(sdir, { limit: 3, cached: false });
    assert.equal(_v2WindowStatsForTest().materializeRuns, 2, 'live-attach ran fresh, ignored the cache');
  });
});
