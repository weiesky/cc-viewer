// SDK-mode "Context usage" on-demand route. The panel opens/refreshes via this HTTP pull;
// the automatic turn-end/compact refreshes flow over the WS broadcast instead. A
// `session-inactive` outcome is a NORMAL state (no turn run yet / query dead), so it
// returns 200 with { ok:false, reason } rather than an HTTP error.
import { reportSwallowed } from '../lib/error-report.js';

async function sdkContextUsage(req, res) {
  try {
    // Dynamic import: sdk-manager is only loaded in SDK mode (resume.js parity). The
    // literal specifier satisfies the boundary verifier's R7 rule.
    const sdk = await import('../lib/sdk-manager.js');
    const r = await sdk.fetchContextUsage();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.ok ? { ok: true, snapshot: r.snapshot } : { ok: false, reason: r.reason }));
  } catch (err) {
    reportSwallowed('sdk-context-route', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
}

export const sdkContextRoutes = [
  { method: 'GET', match: 'exact', path: '/api/sdk-context-usage', handler: sdkContextUsage },
];
