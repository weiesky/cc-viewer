// Coverage: startup-time behavior of CCV_BASE_URL — the External line in non-CLI startup logs and
// baseUrl config warnings (the validation block after setLang in server.js + startedLocal/Network/External printing).
// These lines print only once in startViewer's listen callback, a structure that api-base-url.test.js's
// before-flip-env approach cannot cover, so this separate file sets env before import and captures output via console.error/console.warn interception.
// Private port window 18510-18519 (unique in the repo, no overlap with api-base-url's 18500-18509).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Must be set before any import that pulls in findcc.js ──
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-base-url-startup-'));
mkdirSync(join(tmpDir, 'logs'), { recursive: true });
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';
process.env.NODE_ENV = 'test';
delete process.env.CCV_BASE_PATH;
delete process.env.CCV_ALLOWED_HOSTS;
delete process.env.CCV_USE_PASSWORD;
delete process.env.CCV_PASSWORD;
process.env.CCV_START_PORT = '18510';
process.env.CCV_MAX_PORT = '18519';
process.env.CCV_BASE_URL = 'https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}';

describe('CCV_BASE_URL startup output (non-CLI mode)', { concurrency: false }, () => {
  let mod, errorLines, warnLines;

  before(async () => {
    // console.error/warn interception: started* lines go through console.error, config warnings through console.warn
    errorLines = [];
    warnLines = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args) => { errorLines.push(args.map(String).join(' ')); };
    console.warn = (...args) => { warnLines.push(args.map(String).join(' ')); };
    try {
      mod = await import('../server/server.js');
      const srv = await mod.startViewer();
      assert.ok(srv, 'server should start');
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }
  });

  after(async () => {
    delete process.env.CCV_BASE_URL;
    await new Promise((resolve) => {
      mod.stopViewer();
      setTimeout(() => { rmSync(tmpDir, { recursive: true, force: true }); resolve(); }, 200);
    });
  });

  it('startup log prints the External line (public URL + ccv own ?token=)', () => {
    const external = errorLines.find((l) => l.includes('External:'));
    assert.ok(external, `expected an External line, got:\n${errorLines.join('\n')}`);
    assert.ok(external.includes('https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/?token='),
      `External line must carry host+prefix+token, got: ${external}`);
    // token must be ccv's ACCESS_TOKEN (getAccessToken and the printed line share the same source)
    assert.ok(external.includes(`?token=${mod.getAccessToken()}`), 'External line must carry the real ACCESS_TOKEN');
  });

  it('Network line keeps its {token} prefix, not re-substituted by ACCESS_TOKEN (single-pass i18n interpolation regression lock)', () => {
    const network = errorLines.find((l) => l.includes('Network:'));
    assert.ok(network, 'expected a Network line');
    assert.ok(network.includes('/arca/api/v1/session/{token}/?token='),
      `Network line must keep the literal {token} prefix, got: ${network}`);
  });

  it('Local line carries the prefix, no warning pollution for a valid value', () => {
    const local = errorLines.find((l) => l.includes('Local:'));
    assert.ok(local?.includes('/arca/api/v1/session/{token}/'), `Local line must carry prefix, got: ${local}`);
    assert.ok(!warnLines.some((l) => l.includes('CCV_BASE_URL')), `no warning expected for a valid value, got:\n${warnLines.join('\n')}`);
  });
});
