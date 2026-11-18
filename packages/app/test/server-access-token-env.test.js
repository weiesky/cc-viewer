// Coverage: server.js honors the CCV_ACCESS_TOKEN self-update handoff at module load —
// a valid token is adopted as ACCESS_TOKEN, the env key is stripped before any child
// spawn, and a malformed value falls back to a fresh random 32-hex token.
// server.js evaluates ACCESS_TOKEN once at import, so each scenario needs a fresh
// process; we spawn `node -e` children that dynamic-import server.js and report back.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SERVER_URL = new URL('../server/server.js', import.meta.url).href;
const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function loadTokenInChild(extraEnv) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-token-env-'));
  try {
    const script = `
      process.env.CCV_LOG_DIR = ${JSON.stringify(tmpDir)};
      process.env.CLAUDE_CONFIG_DIR = ${JSON.stringify(tmpDir)};
      // CCV_WORKSPACE_MODE=1 is load-bearing: it skips the auto startViewer() call, so
      // importing server.js evaluates the module (and ACCESS_TOKEN) WITHOUT binding a port.
      process.env.CCV_WORKSPACE_MODE = '1';
      process.env.CCV_CLI_MODE = '0';
      process.env.NODE_ENV = 'test';
      delete process.env.CCV_USE_PASSWORD;
      delete process.env.CCV_PASSWORD;
      delete process.env.CCV_BASE_PATH;
      delete process.env.CCV_ALLOWED_HOSTS;
      const mod = await import(${JSON.stringify(SERVER_URL)});
      console.log(JSON.stringify({ token: mod.getAccessToken(), envLeft: process.env.CCV_ACCESS_TOKEN === undefined }));
      // stopViewer() is required: interceptor.js leaves fs.watchFile handles open, and
      // without this the child never exits (would only end via the spawnSync timeout).
      mod.stopViewer();
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
      timeout: 20000,
    });
    // A hung child is NOT visible via res.status: server.js installs a SIGTERM handler,
    // so spawnSync's timeout SIGTERM makes it exit 0 with error ETIMEDOUT. Assert on
    // res.error/signal too, or a hang would pass silently after burning the timeout.
    assert.equal(res.error, undefined, `child must not time out or error.\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.equal(res.signal, null, 'child must exit on its own, not via a signal');
    assert.equal(res.status, 0, `child should exit cleanly.\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    const line = res.stdout.trim().split('\n').find((l) => l.startsWith('{') && l.includes('"token"'));
    assert.ok(line, `expected a JSON result line.\nstdout: ${res.stdout}`);
    return JSON.parse(line);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('server.js CCV_ACCESS_TOKEN handoff', () => {
  it('adopts a valid inherited token and strips it from the env', () => {
    const out = loadTokenInChild({ CCV_ACCESS_TOKEN: VALID });
    assert.equal(out.token, VALID, 'valid handoff token must be adopted as ACCESS_TOKEN');
    assert.equal(out.envLeft, true, 'CCV_ACCESS_TOKEN must be stripped from the process env after read');
  });

  it('falls back to a fresh random token on a malformed value', () => {
    const out = loadTokenInChild({ CCV_ACCESS_TOKEN: 'ZZZ-not-a-token' });
    assert.match(out.token, /^[a-f0-9]{32}$/, 'malformed value must fall back to a random 32-hex token');
    assert.equal(out.envLeft, true, 'env key must be stripped even when rejected');
  });

  it('generates a random token when no handoff is present', () => {
    const env = { ...process.env };
    delete env.CCV_ACCESS_TOKEN;
    const out = loadTokenInChild(env);
    assert.match(out.token, /^[a-f0-9]{32}$/);
  });
});
