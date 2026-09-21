// Credential vault — real at-rest encryption for cc-viewer's secrets.
//
// The legacy encodings were obfuscation, not security: profile.json held apiKeys in plaintext,
// and the LAN password / IM app secrets were base64 inside preferences.json (trivially reversible;
// the code comments said so themselves). This module upgrades them to AES-256-GCM with a
// per-record random IV and a machine-local master key.
//
// Key model: a single 256-bit `master.key` (0600) generated on first use and stored next to the
// data root. This is the standard trade-off for a headless background server (no interactive
// passphrase prompt, no OS-keychain native dep). At-rest on a single machine it is inherently
// bounded — anyone who reads BOTH master.key and the ciphertext can decrypt — but it raises the
// bar from "plaintext / base64 in a world-readable-shape file" to "needs the key file too", and it
// is the prerequisite for any cloud handling (only ciphertext, never plaintext, may leave the
// machine; the master key never does).
//
// Boundary: L1-lib. Path-injected (no LOG_DIR import) so it stays a pure primitive.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_MODE = 0o600;
const IV_BYTES = 12;   // GCM standard
const TAG_BYTES = 16;  // GCM auth tag
const KEY_BYTES = 32;  // AES-256

// Process-local cache so we don't re-read/re-stat the key file on every encrypt. Keyed by the
// master.key path so tests that redirect LOG_DIR get a fresh key per path.
const _keyCache = new Map();

/**
 * Load (or lazily create) the master key at `keyPath`. Created with randomBytes(32) + 0600 on
 * first use. Throws if the key file exists but is malformed (wrong length) — better to fail loud
 * than silently re-derive and orphan existing ciphertext.
 */
export function loadMasterKey(keyPath) {
  // Cache is only valid while the on-disk key still exists. If the key file was removed out
  // from under us (a wipe of the data root, an OS cleanup), a stale cached key would let a
  // writer re-encrypt with a key that no longer exists on disk — leaving ciphertext that a
  // later cold process cannot read, and splitting state from _keyUsable()'s disk check.
  if (_keyCache.has(keyPath) && existsSync(keyPath)) return _keyCache.get(keyPath);
  _keyCache.delete(keyPath);
  let key;
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath);
    // Stored raw (32 bytes). Tolerate a trailing newline for hand-inspectability.
    const trimmed = raw.subarray(0, KEY_BYTES);
    if (trimmed.length !== KEY_BYTES) {
      throw new Error(`credential-vault: master key at ${keyPath} has ${trimmed.length} bytes, expected ${KEY_BYTES}`);
    }
    key = Buffer.from(trimmed);
  } else {
    key = randomBytes(KEY_BYTES);
    mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, key, { mode: KEY_MODE });
    try { chmodSync(keyPath, KEY_MODE); } catch { /* best-effort; non-POSIX */ }
  }
  _keyCache.set(keyPath, key);
  return key;
}

/**
 * Encrypt a UTF-8 secret → base64(iv | tag | ciphertext). Returns '' for empty input so callers
 * can distinguish "no secret" from "a secret that decrypts to empty".
 */
export function encryptSecret(keyPath, plain) {
  if (!plain) return '';
  const key = loadMasterKey(keyPath);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Decrypt a value produced by encryptSecret. Returns '' for empty input. Throws on malformed
 * input or auth-tag mismatch (tampered / wrong key) — callers decide whether to fall back to a
 * legacy encoding or surface the error.
 */
export function decryptSecret(keyPath, stored) {
  if (!stored) return '';
  const key = loadMasterKey(keyPath);
  const buf = Buffer.from(String(stored), 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error('credential-vault: ciphertext too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}

/**
 * Heuristic: does `stored` look like vault ciphertext (vs a legacy plaintext/base64 value)?
 * Used by the one-time migration to detect already-migrated values. Not a security boundary —
 * just a shape check (base64 that decodes to ≥ IV+TAG bytes).
 */
export function looksEncrypted(stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(stored)) return false;
  let buf;
  try { buf = Buffer.from(stored, 'base64'); } catch { return false; }
  return buf.length >= IV_BYTES + TAG_BYTES + 1;
}

/** Test hook: drop the cached key for `keyPath` (or all) so a fresh one is (re)generated. */
export function _resetKeyCache(keyPath) {
  if (keyPath === undefined) _keyCache.clear();
  else _keyCache.delete(keyPath);
}
