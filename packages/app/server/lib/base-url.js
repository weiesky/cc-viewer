// CCV_BASE_URL (cloud / reverse-proxy deployment behind a public URL): parse + URL building.
// Pure functions, no side effects. Callers read env fresh on every call — server.js deliberately
// re-reads base-path config per request (tests flip env without restarting the server).
//
// Accepted forms:
//   1. host[:port][/path]           arca-sandbox-office.alipay.com/arca/api/v1/session/{token}
//   2. /path                        /arca/api/v1/session/{token}
//   3. scheme://host[:port][/path]  https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}
// ws:// and wss:// are accepted aliases: ws -> http, wss -> https (WS URLs are derived).
//
// The path is split by hand instead of using `new URL(...).pathname` on purpose: WHATWG URL
// parsing percent-encodes `{`/`}` in special-scheme paths, which would corrupt the literal
// `{token}` session segment into `%7Btoken%7D` for <base href>/window.__CCV_BASE_PATH__ injection
// (the wire-encoded form is derived separately for request matching — see wireBasePath).
// Manual splitting also avoids `new URL('http://' + '//path')`-style authority misdetection.
import { normalizeBasePath } from './base-path.js';

// wireBasePath / wireBasePathVariants live in base-path.js (the path-utility home); re-exported
// here so base-url consumers (plugin-runtime cookie Path) have a single import site.
export { wireBasePath, wireBasePathVariants } from './base-path.js';

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;
// hostname | bracketed IPv6, optional numeric port; no userinfo, no non-ASCII (use punycode).
const AUTHORITY_RE = /^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9._-]+))(?::(\d{1,5}))?$/;

const EMPTY = Object.freeze({ ok: true, scheme: null, host: null, port: null, basePath: '', warning: null });

function invalid() {
  return { ok: false, scheme: null, host: null, port: null, basePath: '', warning: 'baseUrl.invalid' };
}

/** Trim + strip CRLF so a hostile/mangled env value cannot inject lines into logs or JS. */
export function sanitizeBaseUrlValue(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/[\r\n]/g, '');
}

/**
 * Parse a CCV_BASE_URL value.
 * @returns {{
 *   ok: boolean,                       // false = value ignored, caller falls back to CCV_BASE_PATH
 *   scheme: 'http'|'https'|null,       // normalized; null = user omitted the scheme
 *   host: string|null,                 // lowercased hostname, IPv6 keeps brackets, no port
 *   port: number|null,
 *   basePath: string,                  // normalized ('/a/b/' or '' for root), braces kept literal
 *   warning: string|null,              // i18n key (baseUrl.invalid / baseUrl.queryFragmentIgnored)
 * }}
 */
export function parseBaseUrl(raw) {
  let text = sanitizeBaseUrlValue(raw);
  if (!text) return { ...EMPTY };

  let scheme = null;
  const m = SCHEME_RE.exec(text);
  if (m) {
    const proto = m[1].toLowerCase();
    if (proto === 'http' || proto === 'ws') scheme = 'http';
    else if (proto === 'https' || proto === 'wss') scheme = 'https';
    else return invalid();
    text = text.slice(m[0].length);
  }

  // Query/fragment are never part of a mounted prefix or a generated base URL.
  let warning = null;
  const cut = text.search(/[?#]/);
  if (cut !== -1) {
    text = text.slice(0, cut);
    warning = 'baseUrl.queryFragmentIgnored';
  }
  // A value that carried a scheme but nothing after it ('https://', 'https://?x=1') is a
  // configuration error, not "no prefix" — surface it so resolveBaseConfig can fall back.
  if (m && !text) return invalid();
  // A query/fragment-only value ('?x=1', '#f') is a configuration error too: accepting it as
  // "valid, no prefix" would silently override a configured CCV_BASE_PATH with nothing.
  if (!m && cut !== -1 && !text) return invalid();
  if (!text) return { ...EMPTY, warning };

  let host = null;
  let port = null;
  let pathRaw = '';
  // Exactly one leading '/' means path-only. '//...' is a protocol-relative authority and is
  // parsed as host — injecting it as a path would produce a cross-origin <base href="//evil">.
  if (text.startsWith('/') && !text.startsWith('//')) {
    pathRaw = text;
  } else {
    const authorityPart = text.startsWith('//') ? text.slice(2) : text;
    const slash = authorityPart.indexOf('/');
    const authority = slash === -1 ? authorityPart : authorityPart.slice(0, slash);
    pathRaw = slash === -1 ? '' : authorityPart.slice(slash);
    if (!authority || authority.includes('@') || authority === '*') return invalid();
    const am = AUTHORITY_RE.exec(authority);
    if (!am) return invalid();
    if (am[3] !== undefined) {
      const p = Number(am[3]);
      if (!Number.isInteger(p) || p < 1 || p > 65535) return invalid();
      port = p;
    }
    host = am[1] !== undefined ? `[${am[1].toLowerCase()}]` : am[2].toLowerCase();
  }

  // The path is used verbatim in HTML/JS injection, so whitespace, control characters and
  // backslashes are rejected rather than silently diverging from the wire-encoded request
  // pathname. A '//' path would inject a protocol-relative <base href="//..."> (cross-origin);
  // a backslash is rejected for the same reason — WHATWG URL resolution treats '/\evil.com/x'
  // like '//evil.com/x', turning every relative API call (token appended) into a cross-origin
  // request. C0 controls are rejected as well (they would reach the startup console raw).
  if (/\s/.test(pathRaw) || /[\\\u0000-\u001f\u007f]/.test(pathRaw) || pathRaw.startsWith('//')) return invalid();

  // normalizeBasePath: '' for root, adds the trailing slash that disambiguates startsWith,
  // and strips CRLF from the path itself. Braces ({token}) stay literal.
  return { ok: true, scheme, host, port, basePath: normalizeBasePath(pathRaw), warning };
}

/**
 * Merge CCV_BASE_URL (preferred) and legacy CCV_BASE_PATH into the one effective config.
 *
 * Rules:
 *   - CCV_BASE_URL unset/blank              -> CCV_BASE_PATH (unchanged back-compat)
 *   - CCV_BASE_URL invalid                  -> CCV_BASE_PATH + 'baseUrl.invalid' warning
 *   - CCV_BASE_URL valid (even host-only)   -> CCV_BASE_URL wins outright; a host-only form
 *                                              authoritatively means "no prefix" and does NOT
 *                                              fall back to CCV_BASE_PATH
 *   - both set and CCV_BASE_URL valid       -> + 'baseUrl.overridesBasePath' warning
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ basePath: string, scheme: 'http'|'https'|null, host: string|null,
 *             port: number|null, source: 'baseUrl'|'basePath'|'none',
 *             warning: string|null, warningValue: string }}
 */
export function resolveBaseConfig(env = process.env) {
  const rawBasePath = env.CCV_BASE_PATH;
  const sanitized = sanitizeBaseUrlValue(env.CCV_BASE_URL);
  const legacyBasePath = normalizeBasePath(rawBasePath);

  if (!sanitized) {
    return {
      basePath: legacyBasePath, scheme: null, host: null, port: null,
      source: legacyBasePath ? 'basePath' : 'none', warning: null, warningValue: '',
    };
  }

  const parsed = parseBaseUrl(sanitized);
  if (!parsed.ok) {
    return {
      basePath: legacyBasePath, scheme: null, host: null, port: null,
      source: legacyBasePath ? 'basePath' : 'none',
      warning: 'baseUrl.invalid', warningValue: sanitized,
    };
  }

  return {
    basePath: parsed.basePath, scheme: parsed.scheme, host: parsed.host, port: parsed.port,
    source: 'baseUrl',
    warning: parsed.warning || (legacyBasePath ? 'baseUrl.overridesBasePath' : null),
    warningValue: sanitized,
  };
}

/** Hostname to add to the Host-header allowlist (lowercased, port-free, IPv6 bracketed), or null. */
export function baseUrlAllowedHost(env = process.env) {
  const parsed = parseBaseUrl(env.CCV_BASE_URL);
  return parsed.ok && parsed.host ? parsed.host : null;
}

/** First hop of X-Forwarded-Proto when it is http/https; null otherwise. */
export function forwardedProto(req) {
  const raw = req?.headers?.['x-forwarded-proto'];
  if (typeof raw !== 'string') return null;
  const first = raw.split(',')[0].trim().toLowerCase();
  return first === 'http' || first === 'https' ? first : null;
}

/**
 * Scheme for user-facing URLs when CCV_BASE_URL carries a host.
 * Priority: explicit scheme in CCV_BASE_URL -> request X-Forwarded-Proto -> https.
 * Defaulting to https is deliberate: a host-based cloud deployment is normally TLS-terminated
 * in front of ccv, and the proxy should send X-Forwarded-Proto. WS URLs are derived by the
 * caller (https -> wss, http -> ws).
 */
export function resolveExternalScheme({ scheme = null, req = null } = {}) {
  if (scheme === 'http' || scheme === 'https') return scheme;
  return forwardedProto(req) || 'https';
}

/** `{scheme}://{host}[:{port}]{basePath}[?token=...]`; empty basePath renders as '/'. */
export function buildExternalUrl({ scheme = 'https', host, port = null, basePath = '', token = null } = {}) {
  if (!host) return null;
  const authority = port ? `${host}:${port}` : host;
  const path = basePath || '/';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${scheme === 'http' ? 'http' : 'https'}://${authority}${path}${query}`;
}

/**
 * One-liner for the four call sites (startup log, auto-open, cli print ×2, /api/local-url):
 * build the public URL from a resolveBaseConfig() result, or null when the config has no host.
 * Scheme: explicit in CCV_BASE_URL > this request's X-Forwarded-Proto (pass req when available)
 * > https. Always carries ccv's own ACCESS_TOKEN — a remote URL without it is a 403 dead link.
 */
export function externalUrlFromConfig(cfg, { token = null, req = null } = {}) {
  if (!cfg?.host) return null;
  return buildExternalUrl({
    scheme: resolveExternalScheme({ scheme: cfg.scheme, req }),
    host: cfg.host,
    port: cfg.port,
    basePath: cfg.basePath,
    token,
  });
}
