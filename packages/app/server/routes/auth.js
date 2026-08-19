// Password-auth API routes. See server/lib/auth.js for the underlying logic and
// the plan for the overall design.
//
//   GET  /api/auth/state   — public; reveals the plaintext password only to admin (isLocal).
//   POST /api/auth/config  — admin-only (!isLocal → 403); enable/disable + set password.
//   POST /api/auth/login   — public + IP rate-limited; on success Set-Cookie ccv_auth=ACCESS_TOKEN.
import { createHash, timingSafeEqual } from 'node:crypto';
import { generatePassword } from '../lib/auth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Constant-time, case-INSENSITIVE password comparison. Both sides are upper-cased
// (the canonical display form) before hashing, so a remote user typing lowercase on
// a phone still matches. Hashing to a fixed 32-byte digest sidesteps length leakage
// and timingSafeEqual's equal-length requirement.
function passwordMatches(input, expected) {
  const a = createHash('sha256').update(String(input).toUpperCase()).digest();
  const b = createHash('sha256').update(String(expected).toUpperCase()).digest();
  return timingSafeEqual(a, b);
}

function readBody(req, deps, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > deps.MAX_POST_BODY) req.destroy();
  });
  req.on('end', () => cb(body));
}

function buildState(deps, isLocal) {
  // Reports the EFFECTIVE config (gate enforces this) plus enough scope info for the
  // admin UI to manage both the global default and a per-project override.
  // Passwords (effective + global) are only revealed to the admin (local).
  const s = deps.getAuthState();
  return {
    enabled: s.effective.enabled,
    isAdmin: isLocal,
    password: isLocal ? s.effective.password : null,
    scope: s.scope,                       // 'project' | 'global' — which one is in effect
    hasProjectOverride: s.hasProjectOverride,
    projectDir: s.projectDir,             // null when not project-scoped (non-CLI mode)
    global: { enabled: s.global.enabled, password: isLocal ? s.global.password : null },
  };
}

// ─── Login rate limiting (per source IP, in-memory) ───
// Keyed on req.socket.remoteAddress (X-Forwarded-For is never parsed, so it can't
// be spoofed over LAN). 20/60s is generous enough for NAT'd households yet far below
// the default password space (2 letters + 4 digits = 26^2·10^4 ≈ 6.76e6; case-insensitive
// doesn't shrink it since the letters are uppercase-only): ~months to brute-force from a
// single IP. The Map is bounded to avoid growth.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const RATE_MAP_MAX = 1000;
const loginAttempts = new Map(); // ip -> { count, windowStart }

// Only *failed* logins are counted (recordFailedAttempt), so a NAT'd household
// doing many correct logins is never locked out — the limiter only throttles
// brute-force guessing. isRateLimited is a pure read (no increment).
function isRateLimited(ip) {
  const rec = loginAttempts.get(ip);
  return !!rec && Date.now() - rec.windowStart <= RATE_WINDOW_MS && rec.count > RATE_MAX;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    rec = { count: 0, windowStart: now };
    loginAttempts.set(ip, rec);
  }
  rec.count++;
  if (loginAttempts.size > RATE_MAP_MAX) {
    for (const [k, v] of loginAttempts) {
      if (now - v.windowStart > RATE_WINDOW_MS) loginAttempts.delete(k);
      if (loginAttempts.size <= RATE_MAP_MAX) break;
    }
  }
}

function authState(req, res, parsedUrl, isLocal, deps) {
  res.writeHead(200, JSON_HEADERS);
  res.end(JSON.stringify(buildState(deps, isLocal)));
}

function authConfigPost(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) {
    res.writeHead(403, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'admin-only' }));
    return;
  }
  readBody(req, deps, (body) => {
    let incoming;
    try {
      incoming = JSON.parse(body);
    } catch {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const state = deps.getAuthState();
    // clearOverride → drop this project's override so it inherits the global default.
    if (incoming.clearOverride === true) {
      deps.clearAuthOverride();
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify(buildState(deps, isLocal)));
      return;
    }
    // Target scope: explicit 'global' → global; otherwise project when this server has a
    // project (else global). The server coerces project→global when no project exists.
    const scope = incoming.scope === 'global' || !state.projectDir ? 'global' : 'project';
    // Start from the target scope's CURRENT config (NOT the effective one): editing the
    // global default while a project override is active must not read the override.
    const cur = scope === 'global'
      ? state.global
      : (state.hasProjectOverride ? state.effective : { enabled: false, password: '' });
    const next = { enabled: cur.enabled, password: cur.password };
    if (typeof incoming.enabled === 'boolean') next.enabled = incoming.enabled;
    const passwordProvided = typeof incoming.password === 'string';
    if (passwordProvided) next.password = incoming.password;
    // Enabling with no existing password and none explicitly provided → auto-generate.
    // An explicit '' is respected (admin chose "no protection").
    if (next.enabled && next.password === '' && !passwordProvided) {
      next.password = generatePassword();
    }
    deps.setAuthConfig(next, scope);
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify(buildState(deps, isLocal)));
  });
}

function authLogin(req, res, parsedUrl, isLocal, deps) {
  const ip = req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    res.writeHead(429, JSON_HEADERS);
    res.end(JSON.stringify({ ok: false, error: 'rate-limited' }));
    return;
  }
  readBody(req, deps, (body) => {
    let password = '';
    try {
      password = String(JSON.parse(body).password ?? '');
    } catch { /* treat as empty → fails below */ }
    const cfg = deps.authConfig;
    // Only issue a cookie when protection is on with a non-empty password that matches.
    // (Empty-password mode needs no login; disabled mode must not mint new cookies.)
    const ok = cfg.enabled && cfg.password !== '' && passwordMatches(password, cfg.password);
    if (ok) {
      res.writeHead(200, {
        ...JSON_HEADERS,
        'Set-Cookie': `ccv_auth=${deps.ACCESS_TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
      });
      res.end(JSON.stringify({ ok: true }));
    } else {
      recordFailedAttempt(ip);
      res.writeHead(401, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false }));
    }
  });
}

export const authRoutes = [
  { method: 'GET', match: 'exact', path: '/api/auth/state', handler: authState },
  { method: 'POST', match: 'exact', path: '/api/auth/config', handler: authConfigPost },
  { method: 'POST', match: 'exact', path: '/api/auth/login', handler: authLogin },
];
