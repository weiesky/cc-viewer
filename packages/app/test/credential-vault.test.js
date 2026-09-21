import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// ████ Data-safety isolation — do NOT revert to static imports (2026-06-06 incident) ████
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-credvault-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const {
  encryptSecret, decryptSecret, loadMasterKey, looksEncrypted, _resetKeyCache,
} = await import('../server/lib/credential-vault.js');

let workDir;
function keyPath() { return join(workDir, 'master.key'); }

describe('credential-vault', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ccv-cv-case-'));
    _resetKeyCache();
  });
  after(() => {
    try { rmSync(__isoDir, { recursive: true, force: true }); } catch {}
  });

  it('generates a 32-byte master.key with 0600 on first use', () => {
    const k = loadMasterKey(keyPath());
    assert.equal(k.length, 32);
    assert.ok(existsSync(keyPath()));
    if (process.platform !== 'win32') {
      assert.equal(statSync(keyPath()).mode & 0o777, 0o600);
    }
  });

  it('reuses the same master key across calls (stable ciphertext decrypt)', () => {
    const a = loadMasterKey(keyPath());
    const b = loadMasterKey(keyPath());
    assert.deepEqual(a, b);
  });

  it('throws on a malformed (wrong-length) master key', () => {
    writeFileSync(keyPath(), Buffer.from('short'), { mode: 0o600 });
    _resetKeyCache();
    assert.throws(() => loadMasterKey(keyPath()), /master key/);
  });

  it('encrypt → decrypt round-trips a secret', () => {
    const ct = encryptSecret(keyPath(), 'sk-ant-abcdef-123');
    assert.ok(ct);
    assert.notEqual(ct, 'sk-ant-abcdef-123');
    assert.equal(decryptSecret(keyPath(), ct), 'sk-ant-abcdef-123');
  });

  it('encrypt returns "" for empty input; decrypt returns "" for empty input', () => {
    assert.equal(encryptSecret(keyPath(), ''), '');
    assert.equal(decryptSecret(keyPath(), ''), '');
  });

  it('uses a random IV per record (same plaintext → different ciphertext)', () => {
    const x = encryptSecret(keyPath(), 'same');
    const y = encryptSecret(keyPath(), 'same');
    assert.notEqual(x, y);
    assert.equal(decryptSecret(keyPath(), x), 'same');
    assert.equal(decryptSecret(keyPath(), y), 'same');
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const ct = encryptSecret(keyPath(), 'secret');
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0x01; // flip a bit in the ciphertext
    const tampered = buf.toString('base64');
    assert.throws(() => decryptSecret(keyPath(), tampered));
  });

  it('rejects decryption with a different master key', () => {
    const ct = encryptSecret(keyPath(), 'secret');
    const otherKey = join(workDir, 'other.key');
    writeFileSync(otherKey, randomBytes(32), { mode: 0o600 });
    assert.throws(() => decryptSecret(otherKey, ct));
  });

  it('looksEncrypted recognizes vault output and rejects plaintext', () => {
    assert.ok(looksEncrypted(encryptSecret(keyPath(), 'hello')));
    assert.equal(looksEncrypted('sk-ant-plain'), false);
    assert.equal(looksEncrypted(''), false);
    assert.equal(looksEncrypted(null), false);
  });
});
