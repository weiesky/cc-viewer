// Credential access layer — the single place config modules touch the vault.
//
// credential-vault.js / credential-store.js are pure path-injected primitives; this module is
// the seam that binds them to cc-viewer's data root and encodes the cross-cutting rules that
// every credential class shares, so auth.js / im-config.js / interceptor.js / preferences.js
// don't each re-derive (and mis-derive) them:
//
//   1. ONE credential root, resolved from the LIVE LOG_DIR binding on every access.
//      preferences.json (holding auth.enabled + auth refs) and PROFILE_PATH resolve per call from
//      the live LOG_DIR; if the vault root were frozen at load it would split from the files it
//      protects whenever LOG_DIR moves (ccv --log-dir, POST /api/preferences {logDir}) — and both
//      halves would fail dangerously (empty password → LAN gate opens; empty apiKey → default
//      credential sent to a third-party host). So the credential root FOLLOWS LOG_DIR, keeping the
//      vault and the config it protects on the same root. See auth.js decideAuth, which fails
//      closed when the resolved vault entry is unreadable.
//   2. master.key is created ONLY when the vault is empty/absent. A read path that finds
//      ciphertext but no key must hard-fail (unreadable), never mint a fresh key that orphans
//      every existing secret.
//   3. "Unreadable" is a first-class outcome, distinct from "absent". The LAN password gate
//      treats an empty password as allow-all (auth.js), so a decrypt failure must surface as
//      unreadable=true — never as ''.
//
// Boundary: L1-lib (imports json-store + credential-store/vault + findcc for the live root).
import { existsSync, readFileSync } from 'node:fs';
import { reportSwallowed } from '@ccv/core/error-report';
import { LOG_DIR } from '../../findcc.js';
import {
  setSecret, getSecret, hasSecret, deleteSecret, credentialsFileFor, masterKeyPathFor, vaultUnreadable,
} from './credential-store.js';
import { _resetKeyCache } from './credential-vault.js';

// Resolved from the LIVE LOG_DIR binding on every access — deliberately NOT frozen at load, so the
// vault follows the same root as the config files it protects. See header note (1).
function _credsFile() { return credentialsFileFor(LOG_DIR); }
function _keyPath() { return masterKeyPathFor(LOG_DIR); }

export function getCredentialsFile() { return _credsFile(); }
export function getMasterKeyPath() { return _keyPath(); }

/** True when the vault holds at least one entry (so a missing master.key is a hard error). */
function _vaultHasEntries() {
  try {
    const file = _credsFile();
    if (!existsSync(file)) return false;
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    return !!(data && typeof data === 'object' && data.creds && Object.keys(data.creds).length > 0);
  } catch { return false; }
}

/** True when credentials.json exists but cannot be parsed — the fail-CLOSED signal (P0-A). */
function _vaultUnreadable() {
  return vaultUnreadable(_credsFile());
}

/**
 * Guard the key-creation rule. Returns { ok:true } when a key may be used/created, or
 * { ok:false, reason } when ciphertext exists (or the vault is unreadable) but the key is gone
 * (hard-fail — do not mint). An unreadable vault is treated as "has entries": minting a fresh
 * key over it would let the next write overwrite ciphertext we can no longer read.
 */
function _keyUsable() {
  if (existsSync(_keyPath())) return { ok: true };
  if (_vaultUnreadable()) {
    return { ok: false, reason: 'master.key is missing and credentials.json is unreadable; refusing to mint (would orphan existing ciphertext)' };
  }
  if (_vaultHasEntries()) {
    return { ok: false, reason: 'master.key is missing but credentials.json holds entries; refusing to mint a new key (existing secrets would be orphaned)' };
  }
  return { ok: true }; // empty/absent vault → first-ever key may be created on demand
}

/**
 * Read a secret back to plaintext.
 * Returns { value: string, unreadable: boolean }.
 *   - vault entry decrypts → { value, unreadable:false }
 *   - no vault entry → { value: fallbackPlain ?? '', unreadable:false } (legacy/pre-migration)
 *   - vault entry exists but key/decrypt fails → { value: fallbackPlain ?? '', unreadable:true }
 *   - the vault FILE itself is unreadable/corrupt → { value: fallbackPlain ?? '', unreadable:true }
 * `fallbackPlain` is the caller's legacy on-disk value (plaintext or already-base64-DECODED),
 * used only when there is no readable vault entry (the one-version read-fallback).
 */
export function readSecretOr(kind, ref, fallbackPlain = '') {
  try {
    // Fail-closed on an unreadable vault FILE (P0-A): hasSecret below would report "no entry"
    // (readJsonSafe swallows the parse error → {}), and a gate that treats empty as allow-all
    // would then open. Surface unreadable so callers deny / drop instead.
    if (_vaultUnreadable()) {
      return { value: fallbackPlain || '', unreadable: true };
    }
    if (!hasSecret(_credsFile(), kind, ref)) {
      return { value: fallbackPlain || '', unreadable: false };
    }
    const usable = _keyUsable();
    if (!usable.ok) {
      reportSwallowed('credential-access.key-unusable', new Error(usable.reason));
      return { value: fallbackPlain || '', unreadable: true };
    }
    const value = getSecret(_credsFile(), _keyPath(), kind, ref);
    return { value, unreadable: false };
  } catch (err) {
    // Tampered ciphertext / wrong key / IO error → unreadable, never '' silently.
    reportSwallowed('credential-access.read', err);
    return { value: fallbackPlain || '', unreadable: true };
  }
}

/**
 * Write a secret to the vault. `plain` empty removes the entry. Returns true on success; on
 * failure reports and returns false (callers must NOT then strip the legacy field).
 */
export function writeSecret(kind, ref, plain) {
  try {
    const usable = _keyUsable();
    if (!usable.ok) {
      reportSwallowed('credential-access.key-unusable', new Error(usable.reason));
      return false;
    }
    setSecret(_credsFile(), _keyPath(), kind, ref, plain);
    return true;
  } catch (err) {
    reportSwallowed('credential-access.write', err);
    return false;
  }
}

/** Remove a secret. Returns true on success. */
export function removeSecret(kind, ref) {
  try {
    deleteSecret(_credsFile(), kind, ref);
    return true;
  } catch (err) {
    reportSwallowed('credential-access.remove', err);
    return false;
  }
}

/**
 * Idempotent one-field migration with read-back verification (the data-safety invariant):
 *   a) if the legacy plaintext is empty → nothing to do, return { migrated:false, cleared:false }.
 *   b) write the plaintext to the vault, then READ IT BACK and compare. Only when the read-back
 *      matches do we say it is safe to clear the legacy field.
 *   c) if the vault already holds a DIFFERENT value, the on-disk plaintext is the user's later
 *      intent (hand-edit / restored backup / old binary) → it wins and overwrites the vault.
 * `clearLegacy()` is invoked by the CALLER only when this returns { migrated:true, cleared:ok }
 * — it performs the source-file strip inside the caller's own file lock. We never clear here.
 * Returns { migrated:boolean, verified:boolean }.
 */
export function migrateFieldWithVerify(kind, ref, legacyPlain) {
  if (!legacyPlain) return { migrated: false, verified: false };
  try {
    // If the vault already holds this exact value, nothing to write.
    if (hasSecret(_credsFile(), kind, ref)) {
      const existing = getSecret(_credsFile(), _keyPath(), kind, ref);
      if (existing === legacyPlain) return { migrated: true, verified: true };
      // Differing value: fall through and let the on-disk plaintext overwrite (user's later intent).
    }
    if (!writeSecret(kind, ref, legacyPlain)) return { migrated: false, verified: false };
    const readBack = getSecret(_credsFile(), _keyPath(), kind, ref);
    if (readBack !== legacyPlain) {
      reportSwallowed('credential-access.migrate-verify', new Error(`read-back mismatch for ${kind}:${ref}`));
      return { migrated: false, verified: false };
    }
    return { migrated: true, verified: true };
  } catch (err) {
    reportSwallowed('credential-access.migrate', err);
    return { migrated: false, verified: false };
  }
}

/** Test hook: drop cached key state so a fresh root/key is picked up per test. */
export function _resetCredentialAccess() {
  _resetKeyCache(); // clear all cached keys across roots (test hook / root change)
}

/**
 * Persist the apiKeys of an incoming profile list into the vault, and return the list with
 * apiKey STRIPPED for writing to profile.json (the file must never carry the key again).
 *
 * Per profile (kind=profile-apiKey, ref=profile.id):
 *   - masked value (isMaskedFn true) → the client echoed the mask back unchanged: DO NOT touch
 *     the vault entry (preserves the existing key) and do not write the sentinel anywhere.
 *   - non-empty plaintext → writeSecret into the vault.
 *   - empty/absent → the profile genuinely has no key: remove the vault entry.
 * Profiles removed from the list (present in `existingProfiles` but absent in `incomingProfiles`)
 * have their vault entry deleted — but only for a FULL-REPLACEMENT write (pass the on-disk list),
 * never for a merge (cc-switch import passes no existingProfiles → no deletion).
 *
 * Returns the stripped list (apiKey:'') to persist in profile.json.
 */
export function persistProfilesApiKeys(incomingProfiles, existingProfiles, { isMaskedFn } = {}) {
  const isMasked = typeof isMaskedFn === 'function' ? isMaskedFn : () => false;
  const existingById = new Map((Array.isArray(existingProfiles) ? existingProfiles : [])
    .filter(p => p && typeof p.id === 'string').map(p => [p.id, p]));
  const incomingIds = new Set();
  const stripped = (Array.isArray(incomingProfiles) ? incomingProfiles : []).map((p) => {
    if (!p || typeof p.id !== 'string') return p;
    incomingIds.add(p.id);
    const key = typeof p.apiKey === 'string' ? p.apiKey : '';
    if (key && isMasked(key)) {
      // masked echo → the client didn't change the key, so preserve the existing one. Normally the
      // vault already holds it (leave it untouched). But a profile.json that still carries a
      // PLAINTEXT key (pre-migration) has no vault entry yet — migrate that plaintext in now,
      // otherwise stripping the field below would lose the only copy. If that rescue write FAILS
      // (vault unusable), keep the on-disk plaintext rather than stripping it into oblivion.
      if (!hasSecret(getCredentialsFile(), 'profile-apiKey', p.id)) {
        const legacyPlain = existingById.get(p.id)?.apiKey;
        if (legacyPlain && !isMasked(legacyPlain)) {
          const ok = writeSecret('profile-apiKey', p.id, legacyPlain);
          if (!ok) return { ...p, apiKey: legacyPlain }; // vault write failed → keep the on-disk key
        }
      }
      return { ...p, apiKey: '' };
    }
    if (key) {
      // New plaintext → vault. On failure keep the plaintext on disk (do NOT strip): mirroring the
      // auth/IM "preserve legacy on failed vault write" rule, so the key is never lost.
      const ok = writeSecret('profile-apiKey', p.id, key);
      return ok ? { ...p, apiKey: '' } : { ...p, apiKey: key };
    }
    // Empty key: preserve any existing vault entry. An empty apiKey here usually means the key
    // simply wasn't served (an unreadable vault hydrates ''), so deleting on empty would destroy
    // the real ciphertext on a no-op save. A profile's key is removed only by removing the whole
    // profile (the full-replacement diff below), never by an empty-string inference.
    return { ...p, apiKey: '' };
  });
  // Full-replacement: delete vault entries for profiles no longer in the list.
  if (Array.isArray(existingProfiles)) {
    for (const old of existingProfiles) {
      if (old && typeof old.id === 'string' && !incomingIds.has(old.id)) {
        removeSecret('profile-apiKey', old.id);
      }
    }
  }
  return stripped;
}
