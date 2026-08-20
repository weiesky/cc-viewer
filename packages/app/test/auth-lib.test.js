import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

// Auth config now lives as the `auth` key in LOG_DIR/preferences.json. Redirect LOG_DIR
// into a temp dir via CCV_LOG_DIR BEFORE importing auth.js (LOG_DIR is resolved at module
// load and getPrefsPath() reads it fresh), isolating the test from the real prefs file.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-auth-test-'));
process.env.CCV_LOG_DIR = tmpDir;

const {
  generatePassword,
  parseCookies,
  decideAuth,
  loadAuthConfig,
  loadAuthState,
  saveAuthConfig,
  clearProjectOverride,
  getPrefsPath,
  renderLoginPage,
} = await import('../server/lib/auth.js');

const TOKEN = 'a'.repeat(32);

// Base ctx helper: defaults to a remote, unauthenticated, password-enabled request.
function ctx(overrides = {}) {
  return {
    isStaticAsset: false,
    pathname: '/api/foo',
    isLocal: false,
    urlToken: null,
    cookieToken: null,
    accessToken: TOKEN,
    enabled: true,
    password: 'SECRET12',
    wantsHtml: false,
    ...overrides,
  };
}

describe('generatePassword', () => {
  it('returns the requested length (default 6)', () => {
    assert.equal(generatePassword().length, 6);
    assert.equal(generatePassword(12).length, 12);
    assert.equal(generatePassword(1).length, 1);
  });

  it('only emits A-Z0-9', () => {
    for (let i = 0; i < 200; i++) {
      assert.match(generatePassword(16), /^[A-Z0-9]+$/);
    }
  });

  it('default shape is 2 letters + 4 digits (e.g. AB1234)', () => {
    for (let i = 0; i < 200; i++) {
      assert.match(generatePassword(), /^[A-Z]{2}[0-9]{4}$/);
    }
  });

  it('keeps the 2-letter prefix + digit tail at other lengths', () => {
    assert.match(generatePassword(8), /^[A-Z]{2}[0-9]{6}$/); // 2 letters + 6 digits
    assert.match(generatePassword(1), /^[A-Z]$/);            // len<2 → all letters
  });

  it('is not constant across calls', () => {
    const set = new Set();
    for (let i = 0; i < 50; i++) set.add(generatePassword());
    assert.ok(set.size > 40, 'passwords should be varied');
  });
});

describe('parseCookies', () => {
  it('parses a normal header', () => {
    assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  });

  it('returns {} for missing/empty/non-string', () => {
    assert.deepEqual(parseCookies(''), {});
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(null), {});
    assert.deepEqual(parseCookies(123), {});
  });

  it('first occurrence wins on duplicate keys', () => {
    assert.deepEqual(parseCookies('ccv_auth=first; ccv_auth=second'), { ccv_auth: 'first' });
  });

  it('skips malformed segments without "="', () => {
    assert.deepEqual(parseCookies('garbage; ccv_auth=tok; alsogarbage'), { ccv_auth: 'tok' });
  });

  it('trims whitespace around keys and values', () => {
    assert.deepEqual(parseCookies('  ccv_auth =  tok  '), { ccv_auth: 'tok' });
  });
});

describe('decideAuth', () => {
  it('always allows the login endpoint regardless of enabled/token', () => {
    assert.equal(decideAuth(ctx({ pathname: '/api/auth/login', enabled: true })).action, 'allow');
    assert.equal(decideAuth(ctx({ pathname: '/api/auth/login', enabled: false })).action, 'allow');
  });

  it('allows static assets', () => {
    assert.equal(decideAuth(ctx({ isStaticAsset: true })).action, 'allow');
  });

  it('allows local (admin) requests', () => {
    assert.equal(decideAuth(ctx({ isLocal: true })).action, 'allow');
  });

  it('allows a matching URL token', () => {
    assert.equal(decideAuth(ctx({ urlToken: TOKEN })).action, 'allow');
  });

  it('allows a matching cookie token', () => {
    assert.equal(decideAuth(ctx({ cookieToken: TOKEN })).action, 'allow');
  });

  it('allows everyone when enabled with an empty password', () => {
    assert.equal(decideAuth(ctx({ enabled: true, password: '' })).action, 'allow');
  });

  it('remote + enabled + no credential + HTML → login-page', () => {
    assert.equal(decideAuth(ctx({ wantsHtml: true })).action, 'login-page');
  });

  it('remote + enabled + no credential + non-HTML → unauthorized', () => {
    assert.equal(decideAuth(ctx({ wantsHtml: false })).action, 'unauthorized');
  });

  it('remote + disabled + bad token → forbidden (original behaviour)', () => {
    assert.equal(decideAuth(ctx({ enabled: false, wantsHtml: true })).action, 'forbidden');
    assert.equal(decideAuth(ctx({ enabled: false, wantsHtml: false })).action, 'forbidden');
  });

  it('a wrong token does not allow', () => {
    assert.equal(decideAuth(ctx({ urlToken: 'wrong', cookieToken: 'wrong', wantsHtml: true })).action, 'login-page');
  });
});

describe('loadAuthConfig / saveAuthConfig (stored in preferences.json auth key)', () => {
  it('defaults to disabled + empty when no file exists', () => {
    if (existsSync(getPrefsPath())) rmSync(getPrefsPath());
    assert.deepEqual(loadAuthConfig(), { enabled: false, password: '' });
  });

  it('roundtrips through preferences.json (plaintext in memory, base64 on disk)', () => {
    saveAuthConfig({ enabled: true, password: 'ABC123XY' });
    // load returns plaintext (admin-facing)
    assert.deepEqual(loadAuthConfig(), { enabled: true, password: 'ABC123XY' });
    // on disk it's under the `auth` key, base64-encoded — NOT raw plaintext
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.auth.enabled, true);
    assert.notEqual(onDisk.auth.password, 'ABC123XY', 'must not store raw plaintext');
    assert.equal(onDisk.auth.password, Buffer.from('ABC123XY', 'utf-8').toString('base64'));
  });

  it('preserves unrelated preferences (read-merge-write, both directions)', () => {
    // Seed a preferences.json with non-auth keys, then save auth and confirm they survive.
    writeFileSync(getPrefsPath(), JSON.stringify({ themeColor: 'light', logDir: '/x' }, null, 2));
    saveAuthConfig({ enabled: true, password: 'KEEP1234' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.themeColor, 'light');
    assert.equal(onDisk.logDir, '/x');
    assert.equal(onDisk.auth.password, Buffer.from('KEEP1234', 'utf-8').toString('base64'));
    assert.deepEqual(loadAuthConfig(), { enabled: true, password: 'KEEP1234' });
  });

  it('normalizes non-boolean/non-string fields', () => {
    const saved = saveAuthConfig({ enabled: 1, password: null });
    assert.deepEqual(saved, { enabled: true, password: '' });
    assert.deepEqual(loadAuthConfig(), { enabled: true, password: '' });
  });

  it('returns defaults on a corrupt file', () => {
    saveAuthConfig({ enabled: true, password: 'x' });
    writeFileSync(getPrefsPath(), 'not json{{');
    assert.deepEqual(loadAuthConfig(), { enabled: false, password: '' });
  });

  it('writes preferences.json with 0600 permissions (POSIX)', { skip: platform() === 'win32' }, () => {
    saveAuthConfig({ enabled: true, password: 'PERMTEST' });
    const mode = statSync(getPrefsPath()).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

describe('scoped auth: global default + per-project override', () => {
  const PROJ = '/tmp/projA';
  const OTHER = '/tmp/projB';
  function reset() { if (existsSync(getPrefsPath())) rmSync(getPrefsPath()); }

  it('with no override, a project resolves to the global default', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: true, password: 'GLOBALPW' });
    assert.deepEqual(loadAuthConfig(null), { enabled: true, password: 'GLOBALPW' });
    const st = loadAuthState(PROJ);
    assert.equal(st.scope, 'global');
    assert.equal(st.hasProjectOverride, false);
    assert.deepEqual(st.effective, { enabled: true, password: 'GLOBALPW' });
  });

  it('a project override wins over global (only for that project)', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    saveAuthConfig({ enabled: true, password: 'PROJPW' }, { scope: 'project', projectDir: PROJ });
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: true, password: 'PROJPW' }); // override
    assert.deepEqual(loadAuthConfig(OTHER), { enabled: true, password: 'GLOBALPW' }); // still global
    const st = loadAuthState(PROJ);
    assert.equal(st.scope, 'project');
    assert.equal(st.hasProjectOverride, true);
    assert.deepEqual(st.effective, { enabled: true, password: 'PROJPW' });
    assert.deepEqual(st.global, { enabled: true, password: 'GLOBALPW' });
    // on disk: override is base64 under authByProject[PROJ], not raw
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.authByProject[PROJ].password, Buffer.from('PROJPW', 'utf-8').toString('base64'));
  });

  it('a DISABLED override still wins (does not fall back to global)', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    saveAuthConfig({ enabled: false, password: '' }, { scope: 'project', projectDir: PROJ });
    // override exists (even disabled) → project has no protection, NOT global's
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: false, password: '' });
    assert.equal(loadAuthState(PROJ).hasProjectOverride, true);
  });

  it('clearProjectOverride makes the project inherit global again', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    saveAuthConfig({ enabled: true, password: 'PROJPW' }, { scope: 'project', projectDir: PROJ });
    clearProjectOverride(PROJ);
    assert.equal(loadAuthState(PROJ).hasProjectOverride, false);
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: true, password: 'GLOBALPW' });
  });

  it('project scope without projectDir falls back to writing global', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'X' }, { scope: 'project' }); // no projectDir
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.ok(onDisk.auth, 'should have written global auth');
    assert.equal(onDisk.authByProject, undefined);
  });
});

describe('renderLoginPage', () => {
  it('is a self-contained HTML page with the login form wiring', () => {
    const html = renderLoginPage({ lang: 'en' });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /type="password"/);
    assert.match(html, /\/api\/auth\/login/);
    assert.match(html, /location\.reload\(\)/);
    // Must not pull in the SPA bundle.
    assert.doesNotMatch(html, /\/assets\//);
  });

  it('hides the error banner by default, shows it when error=true', () => {
    assert.match(renderLoginPage({ lang: 'en', error: false }), /id="e" style="display:none"/);
    assert.doesNotMatch(renderLoginPage({ lang: 'en', error: true }), /id="e" style="display:none"/);
  });

  it('sets RTL direction for Arabic', () => {
    assert.match(renderLoginPage({ lang: 'ar' }), /dir="rtl"/);
    assert.match(renderLoginPage({ lang: 'en' }), /dir="ltr"/);
  });

  it('includes a password reveal toggle (eye) with an i18n aria-label', () => {
    const html = renderLoginPage({ lang: 'en' });
    assert.match(html, /id="tg"[^>]*type="button"/);      // toggle is a button, not a submit
    assert.match(html, /aria-label="Show\/hide password"/); // localized label present
    assert.match(html, /id="eyeOn"/);
    assert.match(html, /id="eyeOff"/);
    assert.match(html, /p\.type = reveal \? 'text' : 'password'/); // toggles input type
  });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
