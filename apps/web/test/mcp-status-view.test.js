/**
 * Unit tests for src/utils/mcpStatusView.js — the pure view-model behind the SDK-mode
 * "MCP server status" panel. Covers the panel state machine (nextMcpPanelState), the
 * status enum → i18n key / Tag color mapping (incl. the hyphenated 'needs-auth' raw value),
 * and tool counting.
 *
 * The key difference from contextUsageView: the payload is an ARRAY (`servers`), so
 * emptiness is tested with Array.isArray — an empty array [] is 'ready' (zero rows), while
 * a servers:null clear frame is 'inactive'. These cases pin that distinction.
 *
 * src/utils is Vite-style (extensionless relative imports), so the shims loader registers
 * first, then the target is dynamically imported.
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let nextMcpPanelState, statusKey, statusColor, toolCountOf;

before(async () => {
  const m = await import('../src/utils/mcpStatusView.js');
  ({ nextMcpPanelState, statusKey, statusColor, toolCountOf } = m);
});

const SERVERS = [
  { name: 'tavily', status: 'connected', serverInfo: { name: 'tavily', version: '1.2.0' }, tools: [{ name: 'web_search' }] },
  { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
];

describe('mcpStatusView — statusKey / statusColor', () => {
  it('原始枚举(含连字符 needs-auth)→ camelCase i18n 键段;未知 → unknown', () => {
    assert.equal(statusKey('connected'), 'connected');
    assert.equal(statusKey('failed'), 'failed');
    assert.equal(statusKey('needs-auth'), 'needsAuth'); // raw SDK value is hyphenated
    assert.equal(statusKey('pending'), 'pending');
    assert.equal(statusKey('disabled'), 'disabled');
    assert.equal(statusKey('weird'), 'unknown');
    assert.equal(statusKey(undefined), 'unknown');
    assert.equal(statusKey(null), 'unknown');
  });

  it('statusColor 按严重度着色,未知回落 default', () => {
    assert.equal(statusColor('connected'), 'green');
    assert.equal(statusColor('failed'), 'red');
    assert.equal(statusColor('needs-auth'), 'orange');
    assert.equal(statusColor('pending'), 'blue');
    assert.equal(statusColor('disabled'), 'default');
    assert.equal(statusColor('nope'), 'default');
  });
});

describe('mcpStatusView — toolCountOf', () => {
  it('有 tools 数组 → 长度;缺/非数组 → 0', () => {
    assert.equal(toolCountOf(SERVERS[0]), 1);
    assert.equal(toolCountOf(SERVERS[1]), 0);
    assert.equal(toolCountOf({}), 0);
    assert.equal(toolCountOf(null), 0);
    assert.equal(toolCountOf({ tools: 'x' }), 0);
  });
});

describe('mcpStatusView — nextMcpPanelState 面板状态机', () => {
  const SNAP = (ts, servers = SERVERS) => ({ type: 'sdk-mcp-status', ts, trigger: 'request', servers });

  // Mutation-resistance: a guard that REJECTS [] (e.g. `!Array.isArray(s) || s.length===0`)
  // would flip these to inactive — this is the discriminating case for the array inversion.
  // (A truthiness mutation `if(!frame.servers)` is NOT discriminating for [] because [] is
  // truthy; the must-not-reject-empty property is what locks the inversion in.)
  it('变异防护:拒绝空数组的守卫(…|| length===0)会把 [] 误判为 inactive —— 此处锁死 [] → ready', () => {
    assert.equal(nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'ws', frame: SNAP(1, []) }).status, 'ready', 'WS [] must stay ready');
    assert.equal(nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: true, snapshot: SNAP(1, []) } }).status, 'ready', 'HTTP [] must stay ready');
  });

  it('WS 帧 → ready;servers 透传', () => {
    const s0 = { detail: null, status: 'loading' };
    const s1 = nextMcpPanelState(s0, { kind: 'ws', frame: SNAP(100) });
    assert.equal(s1.status, 'ready');
    assert.equal(s1.detail.ts, 100);
    assert.deepEqual(s1.detail.servers, SERVERS);
  });

  it('servers:[] 空数组 → ready(非 inactive)——反转守卫的关键用例', () => {
    const s = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'ws', frame: SNAP(100, []) });
    assert.equal(s.status, 'ready', 'empty array is a legitimate "no MCP servers" result, not inactive');
    assert.deepEqual(s.detail.servers, []);
  });

  it('WS 清帧(servers:null)→ inactive,detail 清空', () => {
    const ready = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'ws', frame: SNAP(100) });
    const s = nextMcpPanelState(ready, { kind: 'ws', frame: { type: 'sdk-mcp-status', ts: 200, servers: null } });
    assert.equal(s.status, 'inactive');
    assert.equal(s.detail, null);
  });

  it('HTTP ok → ready;snapshot.servers 透传;ok 带 [] → ready', () => {
    const s1 = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: true, snapshot: SNAP(50) } });
    assert.equal(s1.status, 'ready');
    assert.deepEqual(s1.detail.servers, SERVERS);
    const s2 = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: true, snapshot: SNAP(50, []) } });
    assert.equal(s2.status, 'ready');
    assert.deepEqual(s2.detail.servers, []);
  });

  it('HTTP session-inactive → inactive(区别于 error)', () => {
    const s = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: false, reason: 'session-inactive' } });
    assert.equal(s.status, 'inactive');
  });

  it('HTTP control-failed/非 ok → error;http-error → error', () => {
    const s1 = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'http', body: { ok: false, reason: 'control-failed' } });
    assert.equal(s1.status, 'error');
    const s2 = nextMcpPanelState({ detail: null, status: 'loading' }, { kind: 'http-error' });
    assert.equal(s2.status, 'error');
  });

  it('ts 单调守卫:落后帧被拒(WS 与 HTTP 两路)', () => {
    const ready = { detail: { servers: SERVERS, ts: 100, trigger: 'request' }, status: 'ready' };
    const staleWs = nextMcpPanelState(ready, { kind: 'ws', frame: SNAP(50) });
    assert.equal(staleWs.detail.ts, 100, 'older WS frame rejected');
    const staleHttp = nextMcpPanelState(ready, { kind: 'http', body: { ok: true, snapshot: SNAP(80) } });
    assert.equal(staleHttp.detail.ts, 100, 'older HTTP snapshot rejected');
    const newer = nextMcpPanelState(ready, { kind: 'ws', frame: SNAP(150) });
    assert.equal(newer.detail.ts, 150, 'newer frame advances');
  });
});
