// Credential store — one encrypted home for cc-viewer's secrets, separate from plain config.
//
// Splitting secrets OUT of preferences.json / profile.json into their own credentials.json is
// what makes them safe to handle differently: the plain config can sync freely, while secrets
// live only as vault ciphertext (see credential-vault.js) in a 0600 file that is excluded from
// config-backup. It also means a future "sync plain config" path never drags a key along by
// accident — the secret is in a different file entirely.
//
// On-disk shape (credentials.json, 0600):
//   { version: 1, creds: { "<kind>:<ref>": "<base64(iv|tag|ct)>" } }
// kind ∈ profile-apiKey | lan-password | im-secret. ref scopes the secret (profile id /
// project dir / "<platform>.<field>"). Values are ciphertext from credential-vault.
//
// Reads/writes go through the unified json-store kernel (sync locked atomic write), sharing the
// same per-file lock discipline as every other config file. Path-injected; the caller supplies
// both the credentials file and the master key path (both derive from LOG_DIR at the call site).
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readJsonSafe, mutateJsonSync } from './json-store.js';
import { encryptSecret, decryptSecret, looksEncrypted } from './credential-vault.js';

const VERSION = 1;

/** Compose the storage key for a secret. */
export function credKey(kind, ref) { return `${kind}:${ref}`; }

// Distinguish "credentials file is ABSENT" from "present but UNREADABLE/corrupt". Read paths
// (hasSecret/getSecret) treat an unreadable file as "no entries", which is fail-OPEN for a gate
// that treats empty as allow-all. vaultUnreadable() lets the access layer fail CLOSED instead.
function _readCreds(file) {
  const data = readJsonSafe(file, {});
  return (data && typeof data === 'object' && data.creds && typeof data.creds === 'object')
    ? data.creds
    : {};
}

/**
 * True when `file` exists but cannot be parsed as a credentials file (corrupt/torn/EACCES).
 * Absent → false. This is the fail-closed signal: a vault that SHOULD have entries but can't be
 * read must never be treated as "empty" (→ empty password / empty apiKey).
 */
export function vaultUnreadable(file) {
  if (!existsSync(file)) return false;
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    // A parsed file is "readable" iff it is a plain object (it may simply have no creds yet).
    return !(data && typeof data === 'object' && !Array.isArray(data));
  } catch {
    return true;
  }
}

/**
 * Store a secret. `plain` empty/'' removes the entry (secrets are deleted, never stored empty).
 * Returns true on success.
 */
export function setSecret(file, keyPath, kind, ref, plain) {
  const key = credKey(kind, ref);
  // strictCorrupt: a corrupt credentials.json must never be overwritten by the fallback — losing
  // the whole vault (every secret) is unacceptable, unlike a self-healing preferences.json.
  mutateJsonSync(file, (data) => {
    if (!data || typeof data !== 'object') data = {};
    if (!data.creds || typeof data.creds !== 'object') data.creds = {};
    if (!plain) {
      delete data.creds[key];
    } else {
      data.creds[key] = encryptSecret(keyPath, plain);
    }
    data.version = VERSION;
  }, { mode: 0o600, fallback: {}, strictCorrupt: true });
  return true;
}

/**
 * Read a secret back to plaintext. Returns '' when absent. Throws only on tampered/wrong-key
 * ciphertext (auth-tag failure) — the caller decides whether that is fatal.
 */
export function getSecret(file, keyPath, kind, ref) {
  const stored = _readCreds(file)[credKey(kind, ref)];
  if (!stored) return '';
  return decryptSecret(keyPath, stored);
}

/** Does a ciphertext entry exist for this secret? */
export function hasSecret(file, kind, ref) {
  return Boolean(_readCreds(file)[credKey(kind, ref)]);
}

/** Remove a secret. No-op if absent. */
export function deleteSecret(file, kind, ref) {
  const key = credKey(kind, ref);
  mutateJsonSync(file, (data) => {
    if (data && typeof data === 'object' && data.creds && typeof data.creds === 'object') {
      delete data.creds[key];
    }
  }, { mode: 0o600, fallback: {}, strictCorrupt: true });
}

/**
 * Idempotent one-time migration helper: given a legacy value (plaintext or base64), ensure a
 * ciphertext entry exists. If the entry already holds ciphertext, leave it (idempotent). If the
 * legacy value is empty, do nothing. Returns true if it wrote a NEW ciphertext entry.
 * `decodeLegacy` turns the legacy on-disk value into plaintext (identity for plaintext fields,
 * base64-decode for the base64 fields).
 */
export function migrateLegacySecret(file, keyPath, kind, ref, legacyOnDisk, decodeLegacy) {
  if (!legacyOnDisk) return false;
  if (hasSecret(file, kind, ref)) return false; // already migrated
  const plain = decodeLegacy(legacyOnDisk);
  if (!plain) return false;
  setSecret(file, keyPath, kind, ref, plain);
  return true;
}

// Re-export so migration callers can detect already-encrypted legacy values without a second import.
export { looksEncrypted };

/** Canonical paths for the credentials file and master key, derived from a data root. */
export function credentialsFileFor(logDir) { return join(logDir, 'credentials.json'); }
export function masterKeyPathFor(logDir) { return join(logDir, 'master.key'); }
