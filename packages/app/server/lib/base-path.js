// Unified normalize / validate / strip for CCV_BASE_PATH (reverse-proxy sub-path deployment).
// Pure functions, no side effects; shared by server.js (HTTP strip / <base> injection /
// WS upgrade) and cli.js (startup URL printing) so the normalize logic lives in exactly one
// place. vite.config.js deliberately does NOT reuse this (build-time base has a three-state
// `undefined → '/'` semantic that differs from runtime "unset = no prefix" — see that file).

// Normalize basePath: unset / empty / root '/' → '' (no prefix); anything else gets a trailing
// slash ('/proxy' → '/proxy/'). The trailing slash is the anti-ambiguity key for startsWith
// matching ('/proxy/' never mis-hits '/proxyextra/x'). Invalid values missing the leading '/'
// ('proxy/x') also return '' (ignored) — otherwise the injected segment would produce a
// relative <base> and break the page; the startup warning is validateBasePath's job.
// Backslashes are rejected for the same reason as in parseBaseUrl: WHATWG resolution treats
// '/\evil.com/x' as protocol-relative, which would make the injected <base> cross-origin.
export function normalizeBasePath(raw) {
  if (!raw || raw === '/' || !raw.startsWith('/') || raw.includes('\\')) return '';
  // Strip raw CR/LF: a value containing \n/\r would break the JS string injected into
  // index.html into a syntax error (page-level DoS).
  return raw.replace(/[\r\n]/g, '').replace(/\/?$/, '/');
}

// Validate + normalize. A non-empty value missing the leading '/' (e.g. 'proxy/x') is a
// configuration error: startsWith never matches and stripping silently does nothing. We do
// NOT auto-prepend '/' — auto-fixing would hide a mismatch with the proxy-side prefix and be
// harder to diagnose; instead the value is ignored (behave as no-prefix) and an i18n key is
// returned for the startup console.warn. A value containing a backslash is rejected outright
// (see normalizeBasePath) rather than silently ignored.
export function validateBasePath(raw) {
  if (raw && raw !== '/' && !raw.startsWith('/')) {
    return { ok: false, normalized: '', warning: 'basePath.missingLeadingSlash' };
  }
  if (raw && raw.includes('\\')) {
    return { ok: false, normalized: '', warning: 'basePath.missingLeadingSlash' };
  }
  return { ok: true, normalized: normalizeBasePath(raw), warning: null };
}

// Strip the basePath prefix from a request pathname, guaranteeing a leading '/' on the result
// (route tables match '/api/...'). slice(length - 1) keeps the matched prefix's trailing slash
// as the result's leading slash:
//   stripBasePath('/proxy/api/x', '/proxy/') → '/api/x'
//   stripBasePath('/proxy/',      '/proxy/') → '/'
// Request pathnames are always serialized by new URL (safeParseRequestUrl / browsers alike),
// so literal-prefix characters like '{token}' arrive percent-encoded ('%7Btoken%7D') — matching
// therefore uses the encoded forms from wireBasePathVariants, while injection
// (<base>/window.__CCV_BASE_PATH__) keeps the literal form. A non-matching path is returned
// unchanged and the caller handles it as SPA/404. A bare prefix (no trailing slash, e.g.
// '/proxy' or its encoded form) is treated as the prefix root → '/': together with the
// injected <base href>, relative assets resolve correctly and a shared link missing the
// trailing slash no longer white-screens/404s. The equality check is exact — '/proxyextra'
// is not affected.

// Serialize a literal basePath to wire form (the request-pathname shape): new URL
// percent-encodes WHATWG path characters like '{'/'}' ('/session/{token}/' →
// '/session/%7Btoken%7D/'). Every comparison against an already-parsed request path (prefix
// stripping, plugin cookie Path, ...) MUST use this form; the literal form is only for
// <base href>/JS injection. A value containing '?#' would have its trailing slash eaten by URL
// parsing ('/a?x/' → '/a') — such a config can never match a request anyway, so we fall back
// to the literal form to preserve the old behavior (never over-strip adjacent paths).
export function wireBasePath(normalizedBase) {
  if (!normalizedBase) return '';
  if (/[?#]/.test(normalizedBase)) return normalizedBase;
  try {
    const wire = new URL(`http://ccv-base${normalizedBase}`).pathname;
    // The trailing slash is the key to startsWith disambiguation and the slice leading-slash
    // semantic; if it was lost, fall back (defensive).
    return wire.endsWith('/') ? wire : normalizedBase;
  } catch {
    return normalizedBase;
  }
}

// Match candidates: the wire form plus percent-escape case variants. Some proxies re-case
// individual escapes (%7B → %7b or back), and new URL preserves the incoming case, so ANY
// per-triplet case combination can arrive — generate all 2^N combinations (N is the number of
// escapes, typically 2 for '{token}'). With no escapes this dedupes to a single element.
export function wireBasePathVariants(normalizedBase) {
  const wire = wireBasePath(normalizedBase);
  if (!wire) return [];
  const triplets = [...wire.matchAll(/%([0-9A-Fa-f]{2})/g)];
  if (triplets.length === 0) return [wire];
  const seen = new Set();
  const out = [];
  const walk = (prefix, idx) => {
    if (idx === triplets.length) {
      const candidate = prefix + wire.slice(triplets[idx - 1].index + 3);
      if (!seen.has(candidate)) { seen.add(candidate); out.push(candidate); }
      return;
    }
    const t = triplets[idx];
    const literal = wire.slice(idx === 0 ? 0 : triplets[idx - 1].index + 3, t.index);
    walk(prefix + literal + t[0].toLowerCase(), idx + 1);
    walk(prefix + literal + t[0].toUpperCase(), idx + 1);
  };
  walk('', 0);
  return out;
}

export function stripBasePath(pathname, normalizedBase) {
  if (!normalizedBase) return pathname;
  for (const base of wireBasePathVariants(normalizedBase)) {
    if (pathname.startsWith(base)) return pathname.slice(base.length - 1) || '/';
    if (pathname === base.slice(0, -1)) return '/';
  }
  return pathname;
}
