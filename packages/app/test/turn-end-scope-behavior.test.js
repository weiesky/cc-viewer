/**
 * Behavioral coverage for the per-scope turn-end machinery (2026-10 review).
 *
 * The anchor tests (turn-end-scope.test.js) pin the source shape; THIS file
 * pins the runtime semantics through the server's __testing seams — the
 * regression class the refactor fixes (workspace A's rising edge must never
 * cancel workspace B's pending turn_end, and a per-scope turn flag must never
 * light a foreign scope).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';

const server = await import('../server/server.js');
const T = server.__testing;

beforeEach(() => { T.reset(); });

describe('per-scope turn_end rising-edge cancel (behavior)', () => {
  it('a rising edge cancels only the SAME scope pending timer', () => {
    // Two workspaces each schedule a pending turn_end (scoped entries).
    T.scheduleTurnEnd('sid-A', Date.now(), { project: 'projA', instance: null });
    T.scheduleTurnEnd('sid-B', Date.now(), { project: 'projB', instance: null });
    assert.deepEqual(T.getPendingKeys().sort(), ['sid-A', 'sid-B']);
    // A new request lights scope projA (rising edge) → only projA's timer dies.
    T.observeStreamingTick(true, 'cli', 'projA');
    assert.deepEqual(T.getPendingKeys(), ['sid-B'], 'foreign scope timer survives');
  });

  it('the bound scope keeps the legacy no-scope behavior (byte parity)', () => {
    T.scheduleTurnEnd('sid-bound', Date.now()); // no scope ⇒ bound ('')
    T.observeStreamingTick(true, 'cli');        // bound rising edge
    assert.deepEqual(T.getPendingKeys(), [], 'bound cancel clears the bound timer');
  });

  it('a rising edge in one scope does not cancel the BOUND scope timer', () => {
    T.scheduleTurnEnd('sid-bound', Date.now()); // bound pending
    T.observeStreamingTick(true, 'cli', 'projX');
    assert.deepEqual(T.getPendingKeys(), ['sid-bound'], 'foreign edge never touches the bound timer');
  });
});

describe('per-scope turn_active flag (behavior)', () => {
  it('setPtyTurnActive lights only the addressed scope bucket', () => {
    T.setPtyTurnActive(true, 'sid-A', { project: 'projA', instance: null });
    assert.equal(T.getPtyTurnActive('projA'), true);
    assert.equal(T.getPtyTurnActive(), false, 'bound bucket untouched');
    T.clearPtyTurnActive({ project: 'projA', instance: null });
    assert.equal(T.getPtyTurnActive('projA'), false);
  });
});

describe('_resolveScopeForHookPayload (behavior)', () => {
  it('cwd-only payload resolves via projectKeyForCwd (sid absent)', () => {
    const sc = T.resolveScopeForHookPayload({ cwd: '/tmp/some-proj-xyz' });
    assert.equal(sc.project, 'some-proj-xyz', 'cwd → project basename');
    assert.equal(sc.instance, null);
  });

  it('no sid, no cwd → the bound sentinel', () => {
    assert.deepEqual(T.resolveScopeForHookPayload({}), { project: '', instance: null });
    assert.deepEqual(T.resolveScopeForHookPayload(null), { project: '', instance: null });
  });

  it('an unknown sid falls through to the cwd hint', () => {
    const sc = T.resolveScopeForHookPayload({ sessionId: 'no-such-sid-anywhere', cwd: '/tmp/fb-proj' });
    assert.equal(sc.project, 'fb-proj');
  });
});

describe('_resetStreamingBucket captured-key invariant (source anchors)', () => {
  it('all five stream-tail reset sites use the captured key, never re-derive', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../server/interceptor.js'), 'utf8');
    // The captured key + bucket are computed once at activation.
    assert.ok(/const streamingScopeKey = requestEntry\?\.isStream \? scopeKeyForEntry\(requestEntry\) : null;/.test(src), 'key captured at activation');
    assert.ok(/const _resetStreamingBucket = \(\) => \{ if \(streamingScopeKey !== null\) resetStreamingStateFor\(streamingScopeKey\); \};/.test(src), 'reset helper uses the captured key');
    // No stream-tail reset may re-derive from the (rebindable) live entry.
    const rederive = src.match(/resetStreamingStateFor\(scopeKeyForEntry\(/g) || [];
    assert.equal(rederive.length, 0, 'no tail reset re-derives the key from live entry state');
  });
});

describe('queue-suppress scope plumbing (source anchors, both ends)', () => {
  it('client sends project + instanceKey on the queue-suppress frame', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/src/components/chat/ChatView.jsx'), 'utf8');
    assert.ok(/type: 'queue-suppress',[\s\S]{0,120}?project: this\.props\.viewProject \|\| this\.props\.projectName \|\| null,[\s\S]{0,80}?instanceKey: this\.props\.viewInstance \|\| null,/.test(src), 'queue-suppress carries view scope');
  });

  it('server normalizes the queue-suppress scope and clears THAT scope turn flag', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');
    assert.ok(/msg\.type === 'queue-suppress'[\s\S]{0,900}?const qScope = normalizeProducerScope\(/.test(src), 'queue-suppress normalizes the message scope');
    assert.ok(/const qScope = normalizeProducerScope\([\s\S]{0,300}?\);\s*_setTurnActive\(false, null, qScope\);/.test(src), 'the clear lands on the normalized scope');
  });
});

describe('_emitTurnEnd filter behavior (source anchors)', () => {
  it('a scoped turn_end filters via filterClientsByScope; bound falls to the legacy project filter', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../server/server.js'), 'utf8');
    assert.ok(/const target = sc\.project\s*\?\s*filterClientsByScope\(clients, sc\.project, sc\.instance, _projectName \|\| ''\)\s*:\s*_filterClientsByViewProject\(clients, _projectName \|\| ''\);/.test(src), 'scoped vs bound target selection');
  });
});

describe('live-feed filterClientsByInstance delegation (source anchor)', () => {
  it('_clientsForInstance delegates to the shared instance rule over _clientsFor()', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../server/lib/v2/live-feed.js'), 'utf8');
    assert.ok(/return filterClientsByInstance\(this\._clientsFor\(\), sessionInstance \|\| null\);/.test(src), 'instance narrowing composed over the project filter');
  });
});
