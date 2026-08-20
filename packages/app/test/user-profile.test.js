// user-profile coverage: the resolveAvatar file-path branch (38-57) and the
// CCV_USER_NAME/CCV_USER_AVATAR override precedence in getUserProfile. resolveAvatar is
// internal, so it is exercised through getUserProfile with CCV_USER_AVATAR pointed at files.
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { getUserProfile, clearProfileCache } = await import('../server/lib/user-profile.js');

const workDir = mkdtempSync(join(tmpdir(), 'ccv-userprofile-'));
const savedEnv = {};

function saveEnv() { for (const k of ['CCV_USER_NAME', 'CCV_USER_AVATAR']) savedEnv[k] = process.env[k]; }
function restoreEnv() {
  for (const k of ['CCV_USER_NAME', 'CCV_USER_AVATAR']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

beforeEach(() => { saveEnv(); clearProfileCache(); });
afterEach(() => { restoreEnv(); clearProfileCache(); });
after(() => rmSync(workDir, { recursive: true, force: true }));

describe('getUserProfile name precedence', () => {
  it('CCV_USER_NAME overrides the OS-detected display name', async () => {
    process.env.CCV_USER_NAME = 'Custom Person';
    delete process.env.CCV_USER_AVATAR;
    const p = await getUserProfile();
    assert.equal(p.name, 'Custom Person');
  });

  it('falls back to an OS name (non-empty) when CCV_USER_NAME is unset', async () => {
    delete process.env.CCV_USER_NAME;
    delete process.env.CCV_USER_AVATAR;
    const p = await getUserProfile();
    assert.equal(typeof p.name, 'string');
    assert.ok(p.name.length > 0);
  });
});

describe('resolveAvatar (via CCV_USER_AVATAR)', () => {
  it('passes a data: URI through unchanged', async () => {
    process.env.CCV_USER_AVATAR = 'data:image/png;base64,AAAA';
    const p = await getUserProfile();
    assert.equal(p.avatar, 'data:image/png;base64,AAAA');
  });

  it('passes an http(s) URL through unchanged', async () => {
    process.env.CCV_USER_AVATAR = 'https://example.com/a.png';
    const p = await getUserProfile();
    assert.equal(p.avatar, 'https://example.com/a.png');
  });

  it('reads a local PNG file path and returns a base64 data URI with the right mime', async () => {
    const png = join(workDir, 'avatar.png');
    // a tiny but valid byte payload; resolveAvatar does not decode, only base64-encodes
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    writeFileSync(png, bytes);
    process.env.CCV_USER_AVATAR = png;
    const p = await getUserProfile();
    assert.ok(p.avatar.startsWith('data:image/png;base64,'), 'PNG path → data:image/png URI');
    assert.equal(p.avatar.split(',')[1], bytes.toString('base64'));
  });

  it('maps .jpg / .jpeg to image/jpeg', async () => {
    const jpg = join(workDir, 'pic.jpeg');
    writeFileSync(jpg, Buffer.from([1, 2, 3, 4]));
    process.env.CCV_USER_AVATAR = jpg;
    const p = await getUserProfile();
    assert.ok(p.avatar.startsWith('data:image/jpeg;base64,'));
  });

  it('rejects a disallowed extension (e.g. .svg) → keeps the OS avatar (override ignored)', async () => {
    const svg = join(workDir, 'x.svg');
    writeFileSync(svg, '<svg/>');
    process.env.CCV_USER_AVATAR = svg;
    const p = await getUserProfile();
    // resolveAvatar returns null for .svg → getUserProfile leaves avatar at the OS value
    // (null on non-darwin / in CI). The override must NOT have produced an svg data URI.
    assert.ok(p.avatar === null || !/svg/.test(p.avatar), 'svg override must be ignored');
  });

  it('returns null (keeps OS avatar) for a non-existent file path', async () => {
    process.env.CCV_USER_AVATAR = join(workDir, 'does-not-exist.png');
    const p = await getUserProfile();
    assert.ok(p.avatar === null || !p.avatar.includes('does-not-exist'));
  });

  it('swallows a read error (a directory named like a .png) → catch arm returns null', async () => {
    const dirPng = join(workDir, 'a-directory.png');
    mkdirSync(dirPng, { recursive: true }); // exists + passes the ext allowlist, but readFileSync throws EISDIR
    process.env.CCV_USER_AVATAR = dirPng;
    const p = await getUserProfile();
    assert.ok(p.avatar === null || !p.avatar.startsWith('data:image/png'), 'EISDIR read → resolveAvatar catch → override ignored');
  });

  it('rejects an oversized avatar file (> 2MB) and ignores the override', async () => {
    const big = join(workDir, 'huge.png');
    writeFileSync(big, Buffer.alloc(2 * 1024 * 1024 + 1)); // just over MAX_AVATAR_SIZE
    process.env.CCV_USER_AVATAR = big;
    const p = await getUserProfile();
    assert.ok(p.avatar === null || !p.avatar.startsWith('data:image/png'), 'oversized file → override ignored');
  });
});
