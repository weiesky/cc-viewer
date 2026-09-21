---
"cc-viewer": patch
---

Unify local config JSON writes behind a single locked + atomic store kernel and collapse the multi-writer config files.

- New `server/lib/json-store.js` kernel: `readJsonSafe` / `writeJsonAtomic` / `mutateJson` (async lock) / `mutateJsonSync` (sync lock) / `withJsonLock` / `applyJsonPatch` / `lockPathFor`, reusing `async-file-lock` and `renameSyncWithRetry`. Lock name is derived from the data file (`<file>.lock`), fixing the old fixed-basename collision.
- `preferences.json` writers are converged: `im-config.js` was previously neither locked nor atomic, `auth.js` was atomic but lock-free (a known lost-update window). Both now do read-merge-write inside the kernel's sync lock, sharing one `preferences.json.lock` with the async `mutatePrefs` path.
- `profile.json`'s four write sites (interceptor + preferences routes) now write atomically via the kernel.
- Migrated `prefs-store`, `workspace-registry`, `session-pin-store`, and `ask-store` onto the kernel without changing their public signatures.

No behavior change for readers; this is the prerequisite for consistent on-disk state (and any later cloud projection).
