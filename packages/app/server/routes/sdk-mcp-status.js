// SDK-mode "MCP server status" on-demand route. The panel opens/refreshes via this HTTP
// pull; there is no turn-driven refresh (MCP status is not turn-correlated). A
// `session-inactive` outcome is a NORMAL state (no turn run yet / query dead), so it
// returns 200 with { ok:false, reason } rather than an HTTP error.
import { reportSwallowed } from '../lib/error-report.js';

async function sdkMcpStatus(req, res) {
  try {
    // Dynamic import: sdk-manager is only loaded in SDK mode (resume.js parity). The
    // literal specifier satisfies the boundary verifier's R7 rule.
    const sdk = await import('../lib/sdk-manager.js');
    const r = await sdk.fetchMcpStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.ok ? { ok: true, snapshot: r.snapshot } : { ok: false, reason: r.reason }));
  } catch (err) {
    reportSwallowed('sdk-mcp-status-route', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
}

export const sdkMcpStatusRoutes = [
  { method: 'GET', match: 'exact', path: '/api/sdk-mcp-server-status', handler: sdkMcpStatus },
];
