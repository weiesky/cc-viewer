import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Regression: the --usePassword startup hook must write the PROJECT-scoped password
// (authByProject[projectDir]), NOT the global `auth` key — even when CCV_CLI_MODE is not
// set at server.js load time. server.js can be loaded early via interceptor before cli.js
// sets CCV_CLI_MODE=1, which made `isCliMode` false → AUTH_PROJECT null → password wrongly
// written to global. The flag is project-launch-only, so it must target the project.
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-usepw-test-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CCV_PROJECT_DIR = '/tmp/usepw-proj';
process.env.CCV_USE_PASSWORD = '1';
process.env.CCV_PASSWORD = 'STARTPW42';
process.env.CCV_WORKSPACE_MODE = '1'; // skip auto-start/listen
delete process.env.CCV_CLI_MODE;      // simulate early-load / non-CLI at module eval

describe('--usePassword startup hook writes project scope', () => {
  before(async () => { await import('../server/server.js'); });
  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('persists under authByProject[projectDir], not the global auth key', () => {
    const prefs = JSON.parse(readFileSync(join(tmpDir, 'preferences.json'), 'utf-8'));
    assert.ok(prefs.authByProject, 'should write project-scoped auth');
    const entry = prefs.authByProject['/tmp/usepw-proj'];
    assert.ok(entry, 'keyed by the project dir');
    assert.equal(entry.enabled, true);
    // base64-obfuscated on disk, not raw plaintext
    assert.equal(entry.password, Buffer.from('STARTPW42', 'utf-8').toString('base64'));
    assert.equal(prefs.auth, undefined, 'must NOT write the global auth key');
  });

  it('clears the password env vars after consuming the hook (no leak to child env)', () => {
    assert.equal(process.env.CCV_USE_PASSWORD, undefined);
    assert.equal(process.env.CCV_PASSWORD, undefined);
  });
});
