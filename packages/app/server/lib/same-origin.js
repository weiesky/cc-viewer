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
  // Sec-Fetch-Site is set by browsers even on Origin-less subresource/no-cors GETs;
  // check it first so a cross-site page cannot slip through the no-Origin CLI path.
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers?.origin;
  if (!origin) return true; // CLI/native clients do not send Origin.
  try {
    const originUrl = new URL(origin);
    // Host is the invariant (already allowlist-guarded). Scheme can differ legitimately
    // when a TLS-terminating reverse proxy fronts the server (browser sees https, the
    // backend still parses http) — so compare host, and only when the proxy explicitly
    // forwards the scheme (X-Forwarded-Proto) do we also require it to match.
    const originHost = originUrl.host.toLowerCase();
    const reqHost = String(parsedUrl?.host || req.headers?.host || '').toLowerCase();
    if (originHost !== reqHost) return false;
    const xfp = req.headers?.['x-forwarded-proto'];
    if (xfp && originUrl.protocol.replace(':', '').toLowerCase() !== String(xfp).toLowerCase()) return false;
    return true;
  } catch {
    return false;
  }
}
