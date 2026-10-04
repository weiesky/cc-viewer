// Same-origin guard for sensitive browser-facing endpoints.
//
// Loopback identifies the socket peer, not the browser page that initiated a
// request. Since the server intentionally has permissive CORS for legacy APIs,
// sensitive endpoints (executable selection, process kill, ...) need their own
// same-origin guard stacked on the admin check: a cross-site page riding the
// user's browser (token cookie / ?token= URL) must not reach them, while
// CLI/native clients (no Origin header) and same-origin pages pass through.
//
// Canonical implementation — every call site imports from here.
export function isSameOriginBrowserRequest(req, parsedUrl) {
  const origin = req.headers?.origin;
  if (!origin) return true; // CLI/native clients do not send Origin.
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  try {
    const originUrl = new URL(origin);
    if (parsedUrl?.origin) return originUrl.origin.toLowerCase() === parsedUrl.origin.toLowerCase();
    return originUrl.host.toLowerCase() === String(req.headers?.host || '').toLowerCase();
  } catch {
    return false;
  }
}
