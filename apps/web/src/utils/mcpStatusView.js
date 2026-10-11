/**
 * Pure view-model for the SDK-mode "MCP server status" panel (SdkMcpStatusTab).
 * No React — every function takes the raw McpServerStatus[] (sdk.d.ts) and returns
 * render-ready plain data, so the whole mapping is node:test-able.
 *
 * contextUsageView.js parity, with ONE inversion: the payload is an ARRAY (`servers`),
 * so emptiness is tested with Array.isArray — an empty array [] is a legitimate "no MCP
 * servers configured" result (status 'ready' with zero rows), NOT the 'inactive' state
 * (reserved for "no session / query dead", signalled by a servers:null clear frame).
 */

/**
 * Panel state machine (extracted pure for testability — DI-controller pattern).
 * prev = { detail: {servers,ts,trigger}|null, status: 'loading'|'ready'|'inactive'|'error' }.
 * event = one of:
 *   { kind:'ws', frame }            — a WS sdk-mcp-status frame (servers array | servers:null)
 *   { kind:'http', body }           — a GET /api/sdk-mcp-server-status JSON body
 *   { kind:'http-error' }           — fetch throw / non-JSON
 * Returns the next { detail, status }. The ts monotone guard rejects stale frames from
 * either source so an out-of-order HTTP response can't clobber a newer WS push.
 */
export function nextMcpPanelState(prev, event) {
  const p = prev && typeof prev === 'object' ? prev : { detail: null, status: 'loading' };
  if (!event || typeof event !== 'object') return p;

  if (event.kind === 'ws') {
    const frame = event.frame;
    if (!frame || typeof frame !== 'object') return p;
    if (!Array.isArray(frame.servers)) return { detail: null, status: 'inactive' }; // clear frame (servers:null)
    if (p.detail && typeof frame.ts === 'number' && frame.ts < p.detail.ts) return p; // stale
    return { detail: { servers: frame.servers, ts: frame.ts, trigger: frame.trigger }, status: 'ready' };
  }

  if (event.kind === 'http') {
    const body = event.body;
    if (body && body.ok && body.snapshot && Array.isArray(body.snapshot.servers)) {
      const s = body.snapshot;
      if (p.detail && typeof s.ts === 'number' && s.ts < p.detail.ts) return p; // stale
      return { detail: { servers: s.servers, ts: s.ts, trigger: s.trigger }, status: 'ready' };
    }
    if (body && body.reason === 'session-inactive') return { detail: null, status: 'inactive' };
    return { ...p, status: 'error' };
  }

  if (event.kind === 'http-error') return { ...p, status: 'error' };
  return p;
}

/**
 * Map the raw SDK status enum to an i18n key segment. The raw value is hyphenated
 * ('needs-auth'); the i18n keys are camelCase ('needsAuth'). Unknown / missing values
 * fall back to 'unknown'. A switch returning literals keeps the keys statically greppable
 * for the tab's i18n source-contract test.
 */
export function statusKey(status) {
  switch (status) {
    case 'connected': return 'connected';
    case 'failed': return 'failed';
    case 'needs-auth': return 'needsAuth';
    case 'pending': return 'pending';
    case 'disabled': return 'disabled';
    default: return 'unknown';
  }
}

/** antd Tag color per status (visual severity), keyed off the i18n segment. */
export function statusColor(status) {
  switch (statusKey(status)) {
    case 'connected': return 'green';
    case 'failed': return 'red';
    case 'needsAuth': return 'orange';
    case 'pending': return 'blue';
    case 'disabled': return 'default';
    default: return 'default';
  }
}

/** Number of tools a server exposes (only present when connected). */
export function toolCountOf(server) {
  return Array.isArray(server?.tools) ? server.tools.length : 0;
}
