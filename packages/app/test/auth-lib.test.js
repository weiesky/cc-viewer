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
const { _resetCredentialAccess } = await import('../server/lib/credential-access.js');

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

  // ── decideAuth().isAdmin (remote-admin elevation, container/cloud) ──
  // isAdmin must be true exactly for the credential-bearing/trusted branches, false for the
  // unauthenticated exemptions (static asset, login page) and for rejected requests.
  describe('decideAuth isAdmin flag', () => {
    it('isLocal → isAdmin true', () => {
      assert.equal(decideAuth(ctx({ isLocal: true })).isAdmin, true);
    });
    it('valid urlToken / cookieToken → isAdmin true', () => {
      assert.equal(decideAuth(ctx({ urlToken: TOKEN })).isAdmin, true);
      assert.equal(decideAuth(ctx({ cookieToken: TOKEN })).isAdmin, true);
    });
    it('empty-password mode → allow (read) but isAdmin FALSE (destructive actions stay credential/loopback-gated)', () => {
      const d = decideAuth(ctx({ enabled: true, password: '' }));
      assert.equal(d.action, 'allow', '空密码 = 不设防，读放行');
      assert.equal(d.isAdmin, false, '空密码 ≠ admin：写/删/改密码仍需凭证或本机');
    });
    it('static asset / login endpoint → allow but isAdmin FALSE (no credential)', () => {
      assert.equal(decideAuth(ctx({ isStaticAsset: true })).isAdmin, false);
      assert.equal(decideAuth(ctx({ pathname: '/api/auth/login', enabled: true })).isAdmin, false);
    });
    it('rejected remote (no credential) → isAdmin false on every non-allow action', () => {
      assert.equal(decideAuth(ctx({ wantsHtml: true, enabled: true, password: 'X1' })).isAdmin, false);   // login-page
      assert.equal(decideAuth(ctx({ wantsHtml: false, enabled: true, password: 'X1' })).isAdmin, false);  // unauthorized
      assert.equal(decideAuth(ctx({ enabled: false })).isAdmin, false);                                    // forbidden
    });
  });
});

describe('loadAuthConfig / saveAuthConfig (password in the credential vault)', () => {
  // The LAN password now lives in LOG_DIR/credentials.json (AES-256-GCM), NOT in
  // preferences.json. preferences.json keeps only { enabled }. Reset wipes both stores.
  const credFile = join(tmpDir, 'credentials.json');
  const masterKey = join(tmpDir, 'master.key');
  function wipeCred() {
    try { rmSync(credFile, { force: true }); } catch {}
    try { rmSync(masterKey, { force: true }); } catch {}
    try { rmSync(getPrefsPath(), { force: true }); } catch {} // also drop any leftover/corrupt prefs
    _resetCredentialAccess();
  }

  it('defaults to disabled + empty when no file exists', () => {
    if (existsSync(getPrefsPath())) rmSync(getPrefsPath());
    wipeCred();
    assert.deepEqual(loadAuthConfig(), { enabled: false, password: '', passwordUnreadable: false });
  });

  it('roundtrips (plaintext in memory, AES-256-GCM ciphertext in credentials.json, none in preferences.json)', () => {
    wipeCred();
    saveAuthConfig({ enabled: true, password: 'ABC123XY' });
    // load returns plaintext (admin-facing)
    assert.deepEqual(loadAuthConfig(), { enabled: true, password: 'ABC123XY', passwordUnreadable: false });
    // preferences.json carries NO password field at all
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.auth.enabled, true);
    assert.equal(onDisk.auth.password, undefined, 'preferences.json must not carry the password');
    // the secret is in credentials.json as ciphertext (not plaintext, not base64-of-plaintext)
    const creds = JSON.parse(readFileSync(credFile, 'utf-8'));
    const stored = creds.creds['lan-password:global'];
    assert.ok(stored, 'vault should hold lan-password:global');
    assert.notEqual(stored, 'ABC123XY');
    assert.notEqual(stored, Buffer.from('ABC123XY', 'utf-8').toString('base64'));
    assert.ok(!readFileSync(credFile, 'utf-8').includes('ABC123XY'), 'no plaintext anywhere');
  });

  it('preserves unrelated preferences (read-merge-write, both directions)', () => {
    wipeCred();
    writeFileSync(getPrefsPath(), JSON.stringify({ themeColor: 'light', logDir: '/x' }, null, 2));
    saveAuthConfig({ enabled: true, password: 'KEEP1234' });
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.themeColor, 'light');
    assert.equal(onDisk.logDir, '/x');
    assert.equal(onDisk.auth.password, undefined);
    assert.deepEqual(loadAuthConfig(), { enabled: true, password: 'KEEP1234', passwordUnreadable: false });
  });

  it('normalizes non-boolean/non-string fields', () => {
    wipeCred();
    const saved = saveAuthConfig({ enabled: 1, password: null });
    assert.deepEqual(saved, { enabled: true, password: '' });
    assert.deepEqual(loadAuthConfig(), { enabled: true, password: '', passwordUnreadable: false });
  });

  it('returns defaults on a corrupt file', () => {
    wipeCred();
    saveAuthConfig({ enabled: true, password: 'x' });
    writeFileSync(getPrefsPath(), 'not json{{');
    assert.deepEqual(loadAuthConfig(), { enabled: false, password: '', passwordUnreadable: false });
  });

  it('writes preferences.json with 0600 permissions (POSIX)', { skip: platform() === 'win32' }, () => {
    wipeCred();
    saveAuthConfig({ enabled: true, password: 'PERMTEST' });
    const mode = statSync(getPrefsPath()).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('master.key is created at 0600 and the vault refuses to silently re-mint when key is lost (unreadable)', { skip: platform() === 'win32' }, () => {
    wipeCred();
    saveAuthConfig({ enabled: true, password: 'KEYTEST' });
    assert.equal(statSync(masterKey).mode & 0o777, 0o600);
    // simulate master.key loss: password becomes UNREADABLE (not empty), and no new key is minted
    rmSync(masterKey, { force: true });
    _resetCredentialAccess(); // drop the cached key so the loss is actually observed
    const cfg = loadAuthConfig();
    assert.equal(cfg.passwordUnreadable, true, 'lost key → unreadable, never empty (fail-closed)');
    assert.equal(existsSync(masterKey), false, 'must not silently mint a new key over existing ciphertext');
    // decideAuth denies a remote unauthenticated request instead of opening the gate
    const d = decideAuth(ctx({ enabled: cfg.enabled, password: cfg.password, passwordUnreadable: cfg.passwordUnreadable }));
    assert.notEqual(d.action, 'allow', 'unreadable password must not fall through to allow-all');
  });

  it('FAIL-CLOSED on a corrupt credentials.json: password reads unreadable and the gate denies remote access', { skip: platform() === 'win32' }, () => {
    wipeCred();
    saveAuthConfig({ enabled: true, password: 'REALPW99' });
    // corrupt the vault file itself (not the key)
    writeFileSync(credFile, '{ not json{{', 'utf-8');
    _resetCredentialAccess();
    const cfg = loadAuthConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.passwordUnreadable, true, 'corrupt vault → unreadable, never empty (would be allow-all)');
    // remote unauthenticated request must be denied, not allowed
    const d = decideAuth(ctx({ enabled: cfg.enabled, password: cfg.password, passwordUnreadable: cfg.passwordUnreadable, isLocal: false, urlToken: null, cookieToken: null }));
    assert.notEqual(d.action, 'allow', 'a corrupt vault must not open the LAN gate');
  });
});

describe('scoped auth: global default + per-project override', () => {
  const PROJ = '/tmp/projA';
  const OTHER = '/tmp/projB';
  const credFile = join(tmpDir, 'credentials.json');
  const masterKey = join(tmpDir, 'master.key');
  function reset() {
    if (existsSync(getPrefsPath())) rmSync(getPrefsPath());
    try { rmSync(credFile, { force: true }); } catch {}
    try { rmSync(masterKey, { force: true }); } catch {}
    _resetCredentialAccess();
  }

  it('with no override, a project resolves to the global default', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: true, password: 'GLOBALPW', passwordUnreadable: false });
    assert.deepEqual(loadAuthConfig(null), { enabled: true, password: 'GLOBALPW', passwordUnreadable: false });
    const st = loadAuthState(PROJ);
    assert.equal(st.scope, 'global');
    assert.equal(st.hasProjectOverride, false);
    assert.deepEqual(st.effective, { enabled: true, password: 'GLOBALPW', passwordUnreadable: false });
  });

  it('a project override wins over global (only for that project)', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    saveAuthConfig({ enabled: true, password: 'PROJPW' }, { scope: 'project', projectDir: PROJ });
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: true, password: 'PROJPW', passwordUnreadable: false }); // override
    assert.deepEqual(loadAuthConfig(OTHER), { enabled: true, password: 'GLOBALPW', passwordUnreadable: false }); // still global
    const st = loadAuthState(PROJ);
    assert.equal(st.scope, 'project');
    assert.equal(st.hasProjectOverride, true);
    assert.deepEqual(st.effective, { enabled: true, password: 'PROJPW', passwordUnreadable: false });
    assert.deepEqual(st.global, { enabled: true, password: 'GLOBALPW', passwordUnreadable: false });
    // on disk: authByProject[PROJ] carries NO password; the override secret is in the vault
    const onDisk = JSON.parse(readFileSync(getPrefsPath(), 'utf-8'));
    assert.equal(onDisk.authByProject[PROJ].password, undefined);
    const creds = JSON.parse(readFileSync(credFile, 'utf-8'));
    assert.ok(creds.creds[`lan-password:proj:${PROJ}`], 'override secret lives in the vault');
  });

  it('a DISABLED override still wins (does not fall back to global)', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    saveAuthConfig({ enabled: false, password: '' }, { scope: 'project', projectDir: PROJ });
    // override exists (even disabled) → project has no protection, NOT global's
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: false, password: '', passwordUnreadable: false });
    assert.equal(loadAuthState(PROJ).hasProjectOverride, true);
  });

  it('clearProjectOverride makes the project inherit global again', () => {
    reset();
    saveAuthConfig({ enabled: true, password: 'GLOBALPW' }, { scope: 'global' });
    saveAuthConfig({ enabled: true, password: 'PROJPW' }, { scope: 'project', projectDir: PROJ });
    clearProjectOverride(PROJ);
    assert.equal(loadAuthState(PROJ).hasProjectOverride, false);
    assert.deepEqual(loadAuthConfig(PROJ), { enabled: true, password: 'GLOBALPW', passwordUnreadable: false });
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
