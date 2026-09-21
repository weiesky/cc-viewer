// Password-based LAN auth — pure logic, heavily unit-tested.
//
// cc-viewer's original LAN gate is URL `?token=<32-hex>` (server.js ACCESS_TOKEN,
// random per boot, never persisted). This module adds an OPTIONAL second path:
// a password that, once verified, is stored in a cookie (value = ACCESS_TOKEN).
// Both paths coexist — token and cookie are equivalent.
//
// Everything here is side-effect-light and exported so the decision logic can be
// unit-tested directly (loopback HTTP tests always look local, so they cannot
// exercise the remote branch — `decideAuth` covers it as a pure function).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mutateJsonSync } from './json-store.js';
import { readSecretOr, writeSecret, removeSecret } from './credential-access.js';
import { LOG_DIR } from '../../findcc.js';
import { tFor, localeFromAcceptLanguage } from '../i18n.js';

// 默认密码形状 = 前 2 位字母 + 其余数字(默认 6 位 → 2 字母 + 4 数字),好读好记又不易撞。
// 字母用大写 A-Z,数字 0-9;登录侧大小写不敏感(见 routes/auth.js),小写输入照样通过。
const PASSWORD_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 26
const PASSWORD_DIGITS = '0123456789';                  // 10

/**
 * Cryptographically uniform pick of `count` chars from `chars`.
 * Rejection sampling discards bytes ≥ (256 - 256%n) to avoid modulo bias.
 */
function pickFrom(chars, count) {
  const n = chars.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < count) {
    const buf = randomBytes(Math.max(1, count) * 2);
    for (let i = 0; i < buf.length && out.length < count; i++) {
      if (buf[i] < limit) out += chars[buf[i] % n];
    }
  }
  return out;
}

/**
 * Default password: leading letters + trailing digits, `len` chars total.
 * At len=6 (the default) this is 2 letters + 4 digits, e.g. "AB1234".
 * The letter prefix is fixed at 2 (or `len` when len<2); the rest are digits.
 */
export function generatePassword(len = 6) {
  const letters = Math.min(2, len);
  const digits = Math.max(0, len - letters);
  return pickFrom(PASSWORD_LETTERS, letters) + pickFrom(PASSWORD_DIGITS, digits);
}

const DEFAULT_CONFIG = { enabled: false, password: '' };

/**
 * Auth config is persisted as the `auth` key inside the same preferences.json the
 * rest of cc-viewer uses (LOG_DIR/preferences.json) — NOT a separate global file.
 * Path is computed fresh each call: LOG_DIR is a live binding (setLogDir) and tests
 * redirect it via CCV_LOG_DIR before importing.
 */
export function getPrefsPath() {
  return join(LOG_DIR, 'preferences.json');
}

function readPrefs() {
  try {
    const p = getPrefsPath();
    if (!existsSync(p)) return {};
    const obj = JSON.parse(readFileSync(p, 'utf-8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function normalizeAuth(cfg) {
  return {
    enabled: !!(cfg && cfg.enabled),
    password: cfg && typeof cfg.password === 'string' ? cfg.password : '',
  };
}

// The password is kept in memory & over the admin API as plaintext (admin must be able
// to view/copy it). On disk it lives in the encrypted credential vault (credentials.json)
// as AES-256-GCM ciphertext — NOT in preferences.json. The legacy encoding was base64 inside
// preferences.json (obfuscation only); those fields are migrated out at startup and cleared.
//
// CRITICAL fail-closed rule: a password that exists but cannot be decrypted (lost master.key,
// tampered ciphertext) is "unreadable", NOT "empty". decideAuth treats an EMPTY password as
// allow-all, so collapsing an unreadable secret to '' would open the LAN gate. We therefore
// thread a `passwordUnreadable` flag through and deny on it before the empty-password branch.
function encodePassword(plain) {
  return plain ? Buffer.from(plain, 'utf-8').toString('base64') : '';
}
function decodePassword(stored) {
  if (!stored || typeof stored !== 'string') return '';
  try { return Buffer.from(stored, 'base64').toString('utf-8'); } catch { return ''; }
}

// ─── Scoped persistence (global default + optional per-project override) ───
// preferences.json (after migration):
//   auth:          { enabled }                  ← global default (password in vault)
//   authByProject: { "<projectDir>": { enabled } }  ← optional overrides (password in vault)
// Vault refs: 'lan-password:global' and 'lan-password:proj:<resolvedDir>'.
// A project "has an override" iff a key exists for it (even if disabled). The gate
// resolves: project override (if the key exists) else global. To inherit global again,
// the override must be REMOVED (clearProjectOverride), not merely disabled.

function refFor(projectDir) {
  return projectDir ? `proj:${resolve(projectDir)}` : 'global';
}

function decodeStored(a, projectDir = null) {
  // No auth entry at all → the default "disabled, no password" shape; do NOT consult the vault
  // (a stray vault entry must not resurrect a password for a scope the prefs say nothing about,
  // e.g. after preferences.json was wiped/corrupt while credentials.json survived).
  if (!a || typeof a !== 'object') return { enabled: false, password: '', passwordUnreadable: false };
  const enabled = !!a.enabled;
  // Legacy on-disk value (base64) is the read-fallback for the one-version transition window;
  // the vault is authoritative when it holds the entry.
  const legacyPlain = decodePassword(a.password);
  const { value, unreadable } = readSecretOr('lan-password', refFor(projectDir), legacyPlain);
  return { enabled, password: value, passwordUnreadable: unreadable };
}

/** Does this project have its own auth override? (key present, regardless of enabled) */
function hasOverride(prefs, projectDir) {
  return !!(projectDir && prefs.authByProject && Object.prototype.hasOwnProperty.call(prefs.authByProject, projectDir));
}

/**
 * Resolve the EFFECTIVE auth config the gate should enforce for `projectDir`:
 * the project override if one exists, otherwise the global default.
 * Returns { enabled, password } (plaintext). projectDir null → always global.
 */
export function loadAuthConfig(projectDir = null) {
  const prefs = readPrefs();
  const overridden = hasOverride(prefs, projectDir);
  const src = overridden ? prefs.authByProject[projectDir] : prefs.auth;
  return decodeStored(src, overridden ? projectDir : null);
}

/**
 * Rich state for the admin API: the effective config + which scope produced it +
 * whether a project override exists + the global default (all passwords plaintext;
 * the route masks them for non-admins).
 */
export function loadAuthState(projectDir = null) {
  const prefs = readPrefs();
  const overridden = hasOverride(prefs, projectDir);
  return {
    effective: decodeStored(overridden ? prefs.authByProject[projectDir] : prefs.auth, overridden ? projectDir : null),
    global: decodeStored(prefs.auth, null),
    scope: overridden ? 'project' : 'global',
    hasProjectOverride: overridden,
    projectDir: projectDir || null,
  };
}

/**
 * Persist auth config (read-merge-write, preserving all other prefs). `opts.scope`
 * 'global' → the `auth` key; 'project' → authByProject[opts.projectDir] (requires
 * projectDir, else falls back to global). Password stored base64; returns the
 * in-memory (plaintext) normalized shape.
 */
export function saveAuthConfig(cfg, opts = {}) {
  const normalized = normalizeAuth(cfg);
  const scope = opts.scope === 'project' && opts.projectDir ? 'project' : 'global';
  const projectDir = scope === 'project' ? opts.projectDir : null;
  // Write the password to the vault FIRST. Only on success do we persist { enabled } (sans
  // password) to preferences.json — otherwise the legacy field must be preserved so the secret
  // is not lost. (writeSecret verifies the key is usable and reports+false on failure.)
  const wrote = writeSecret('lan-password', refFor(projectDir), normalized.password);
  // Read-merge-write INSIDE the kernel's sync lock so a concurrent prefs/IM save can't be
  // lost between our read and write.
  mutateJsonSync(getPrefsPath(), (prefs) => {
    // persisted shape: { enabled } plus the legacy base64 password ONLY when the vault write
    // failed (preserves the secret for a later migration) — removed once vault-backed.
    const legacyField = wrote ? {} : { password: encodePassword(normalized.password) };
    if (scope === 'project') {
      if (!prefs.authByProject || typeof prefs.authByProject !== 'object') prefs.authByProject = {};
      prefs.authByProject[opts.projectDir] = { enabled: normalized.enabled, ...legacyField };
    } else {
      prefs.auth = { enabled: normalized.enabled, ...legacyField };
    }
  }, { mode: 0o600 });
  return normalized;
}

/** Remove a project's override so it inherits the global default again. No-op if absent. */
export function clearProjectOverride(projectDir) {
  if (!projectDir) return;
  removeSecret('lan-password', refFor(projectDir));
  mutateJsonSync(getPrefsPath(), (prefs) => {
    if (prefs.authByProject && Object.prototype.hasOwnProperty.call(prefs.authByProject, projectDir)) {
      delete prefs.authByProject[projectDir];
    }
  }, { mode: 0o600 });
}

/**
 * Parse a Cookie header into an object.
 * - Segments without `=` are skipped (malformed).
 * - Duplicate keys: first occurrence wins (deterministic).
 */
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key || Object.prototype.hasOwnProperty.call(out, key)) continue;
    out[key] = part.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Pure auth decision, shared by the HTTP request prelude and the WS upgrade handler.
 *
 * ctx = {
 *   isStaticAsset, pathname, isLocal,
 *   urlToken, cookieToken, accessToken,
 *   enabled, password, wantsHtml
 * }
 * → { action: 'allow' | 'login-page' | 'unauthorized' | 'forbidden', isAdmin: boolean }
 *
 * Caller invariants (see plan): 'login-page' / 'unauthorized' / 'forbidden' MUST
 * terminate the request; only 'allow' falls through to the Host allowlist + routing.
 *
 * `isAdmin` = loopback OR an authenticated remote (valid urlToken / cookieToken). It is computed
 * from the credential-bearing allow branches, so the two can never drift apart — server.js uses
 * it to elevate management routes (see lib/is-admin.js). Static-asset, /api/auth/login, AND the
 * empty-password branch are allow-exempt but NOT admin: empty-password mode means "no read
 * protection", but destructive/admin actions (delete skills, change the password, adjust
 * retry/proxy config that multiplies the host's paid upstream spend) must NOT be opened to every
 * unauthenticated LAN/internet client — those stay credential-or-loopback gated even in open mode.
 */
export function decideAuth(ctx) {
  const {
    isStaticAsset, pathname, isLocal,
    urlToken, cookieToken, accessToken,
    enabled, password, wantsHtml,
    passwordUnreadable = false,
  } = ctx;

  // Admin = the credential-bearing / trusted-peer allow branches. Deliberately EXCLUDES the
  // empty-password allow branch: "no read protection" must not become "everyone is admin".
  // Single source of truth for both gating and remote-admin elevation.
  const isAdmin =
    isLocal === true ||
    urlToken === accessToken ||
    cookieToken === accessToken;

  // Fail-closed: a password that EXISTS but could not be decrypted (lost master.key / tampered
  // ciphertext) must deny BEFORE the empty-password allow branch below — otherwise an unreadable
  // secret collapses to '' and opens the LAN gate. Login page stays reachable so the admin can
  // still authenticate via token (which does not depend on the vault).
  if (passwordUnreadable && !isAdmin) {
    return { action: wantsHtml ? 'login-page' : 'unauthorized', isAdmin };
  }

  if (
    isStaticAsset ||
    pathname === '/api/auth/login' || // login endpoint must be reachable unauthenticated
    isLocal ||
    urlToken === accessToken ||
    cookieToken === accessToken ||
    (enabled && password === '')      // empty password = explicitly no protection
  ) {
    return { action: 'allow', isAdmin };
  }

  if (enabled) {
    // Password auth on but no valid credential: HTML navigations get the login page,
    // XHR/asset/WS get a plain 401.
    return { action: wantsHtml ? 'login-page' : 'unauthorized', isAdmin };
  }
  // Password auth off → preserve original token-only behaviour (403).
  return { action: 'forbidden', isAdmin };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Self-contained login page (inline CSS + JS, references NO /assets — static assets
 * are auth-exempt but we don't want to surface the SPA bundle to unauthenticated
 * remotes). On submit it POSTs to /api/auth/login and reloads on success.
 *
 * `lang` is a resolved locale code (caller derives it from Accept-Language).
 */
export function renderLoginPage({ lang = 'en', error = false } = {}) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const title = escapeHtml(tFor('server.auth.loginTitle', lang));
  const placeholder = escapeHtml(tFor('server.auth.loginPlaceholder', lang));
  const btn = escapeHtml(tFor('server.auth.loginBtn', lang));
  const errMsg = escapeHtml(tFor('server.auth.loginError', lang));
  const toggleLabel = escapeHtml(tFor('server.auth.togglePassword', lang));
  const errStyle = error ? '' : ' style="display:none"';
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}" dir="${dir}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #1a1a1a; color: #e8e8e8;
    /* Standalone document (no SPA CSS bundle): keep in sync with --font-ui in src/global.css */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .card {
    width: 100%; max-width: 340px; padding: 32px 28px; margin: 16px;
    background: #242424; border: 1px solid #383838; border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  h1 { margin: 0 0 20px; font-size: 18px; font-weight: 600; text-align: center; }
  input {
    width: 100%; padding: 11px 14px; font-size: 15px; color: #e8e8e8;
    background: #1a1a1a; border: 1px solid #3a3a3a; border-radius: 8px; outline: none;
  }
  input:focus { border-color: #6c8cff; }
  /* Password field + reveal toggle. padding-inline-end leaves room for the eye;
     inset-inline-end keeps it on the correct side under RTL (ar). */
  .field { position: relative; }
  .field input { padding-inline-end: 44px; }
  .toggle {
    position: absolute; top: 50%; inset-inline-end: 6px; transform: translateY(-50%);
    width: 32px; height: 32px; margin: 0; padding: 0;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: 6px; cursor: pointer; color: #9a9a9a;
  }
  .toggle:hover { color: #e8e8e8; background: #2e2e2e; }
  .toggle svg { width: 18px; height: 18px; display: block; }
  #b {
    width: 100%; margin-top: 14px; padding: 11px 14px; font-size: 15px; font-weight: 600;
    color: #fff; background: #4a6cf7; border: none; border-radius: 8px; cursor: pointer;
  }
  #b:hover { background: #3a5ce0; }
  #b:disabled { opacity: 0.6; cursor: default; }
  .error { margin-top: 12px; font-size: 13px; color: #ff7b7b; text-align: center; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <form id="f" autocomplete="off">
      <div class="field">
        <input id="p" type="password" placeholder="${placeholder}" autofocus autocomplete="current-password">
        <button id="tg" type="button" class="toggle" aria-label="${toggleLabel}" title="${toggleLabel}" aria-pressed="false">
          <svg id="eyeOn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          <svg id="eyeOff" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:none"><path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.9 4.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a13.3 13.3 0 0 1-2.2 2.9"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 3.3-.5"/></svg>
        </button>
      </div>
      <button id="b" type="submit">${btn}</button>
      <div class="error" id="e"${errStyle}>${errMsg}</div>
    </form>
  </div>
<script>
(function () {
  var f = document.getElementById('f'), p = document.getElementById('p'),
      b = document.getElementById('b'), e = document.getElementById('e'),
      tg = document.getElementById('tg'),
      eOn = document.getElementById('eyeOn'), eOff = document.getElementById('eyeOff');
  tg.addEventListener('click', function () {
    var reveal = p.type === 'password';
    p.type = reveal ? 'text' : 'password';
    eOn.style.display = reveal ? 'none' : '';
    eOff.style.display = reveal ? '' : 'none';
    tg.setAttribute('aria-pressed', reveal ? 'true' : 'false');
    p.focus();
  });
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    b.disabled = true; e.style.display = 'none';
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: p.value })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) { location.reload(); }
        else { e.style.display = ''; b.disabled = false; p.select(); }
      })
      .catch(function () { e.style.display = ''; b.disabled = false; });
  });
})();
</script>
</body>
</html>`;
}

/** Re-export for callers that resolve the request's preferred locale. */
export { localeFromAcceptLanguage };
