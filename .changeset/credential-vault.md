---
"cc-viewer": patch
---

Encrypt cc-viewer's local credentials at rest in a new AES-256-GCM vault, separate from plain config.

- New `credential-vault.js` (AES-256-GCM, per-record random IV, machine-local `master.key` at 0600), `credential-store.js` (vault-backed `credentials.json` at 0600), `credential-access.js` (read-plain / write-cipher / migrate / fallback with fail-closed semantics), and `credential-migrate.js` (one-time startup migration).
- Proxy profile `apiKey`s, the LAN password (`auth.password` / `authByProject.*`), and IM app secrets are moved out of `profile.json` / `preferences.json` into the vault. Low-sensitivity IM cred fields (appKey/appId/botId) stay base64. Plain config files no longer carry these secrets.
- Fail-closed everywhere: a profile whose apiKey can't be decrypted is dropped from routing (never forwards your default credential to a third-party host), and an unreadable LAN password denies remote access instead of falling back to the empty-password allow-all.
- Startup migration is idempotent with write-then-read-back verification; a differing on-disk plaintext wins. `config-backup` now also backs up `credentials.json` + `master.key` and keeps historical plaintext backups as a recovery path.
- The vault files (`credentials.json`, `master.key`) are denied to IM-driven sessions and the remote file API (im-deny, permissions.deny, file-access-policy).

No action is required on upgrade: existing plaintext/base64 secrets are migrated automatically on first start, with a pre-migration backup kept.

**Upgrade step — restart everything:** after upgrading, restart all running ccv processes **and any in-flight `claude` sessions** (which carry a long-lived, already-injected copy of the old interceptor). A stale reader would serve a stripped `profile.json` whose `apiKey` is now empty; with an empty key the old interceptor skips the auth rewrite but still rewrites the URL, forwarding your default Anthropic credential to a third-party baseURL. The fail-closed guard only exists in the new code, so it cannot fire in an old process.
