# Config Convergence & Cloud-Sync Advisory (cc-viewer)

> **Status: advisory / proposal — NOT implemented.** This document maps every local cc-viewer
> config/state file to a proposed database/cloud-store schema, and defines a future cloud-sync
> model. It is a design reference for the enterprise (genv-style) cloud deployment, written so
> that a later implementation pass has zero ambiguity about where each piece of config lives and
> how it should sync. No code in this repo is changed by this document.

---

## 0. TL;DR

- **Today** every piece of cc-viewer config/state is a local JSON file under `LOG_DIR`
  (default `~/.claude/cc-viewer`, override `CCV_LOG_DIR`). There is **no** cloud client, account
  model, or remote sync of any kind.
- **Local stays the fast path.** Local JSON files remain the primary read/write store for
  low-latency local CRUD. Database/cloud sync is a **secondary** compatibility layer, not a
  replacement.
- **Cloud model (decided): _cloud-authoritative, local read-only fallback._** When cloud is
  enabled and reachable, the cloud copy wins and is materialized down to local files. When the
  cloud is unreachable, local files serve as a **read-only fallback** — the instance does not
  accept local edits while offline (it does not queue a local-write → push → reconcile loop).
- **SQLite:** out of scope. This document only records the direction (a future
  single-file `cc-viewer.db`). **No `better-sqlite3` is introduced** — it is a native dependency
  that would force build/sign/CI changes. Local convergence stays on JSON.
- **Credentials on cloud:** two strategies are documented (§6). **Decision: credentials sync to
  cloud as ciphertext** (S2 direction), but the cloud-side encryption/sync is deferred to a later
  phase owned by the cloud team. This pass only builds the local vault; with cloud sync disabled
  it stays purely local (local-to-local).

---

## 1. Scope & confirmed decisions

| # | Decision | Value |
|---|---|---|
| 1 | What this doc is | An advisory mapping + sync model for the cloud team. Local config convergence (a unified JSON store kernel, an encrypted credential vault) is cc-viewer's own concern and is **not** prescribed here — only the local ↔ cloud contract is. |
| 2 | Credential scope | cc-viewer's **real** 3 credential classes only: `profile.json` `apiKey`, `preferences.json` `auth.password`, IM platform secrets. genv's `official-auth`/`aima`/SSO do **not** exist here and are **not** covered. |
| 3 | Cloud sync semantics | **Cloud-authoritative, local read-only fallback** (§5). |
| 4 | Credentials on cloud | Sync to cloud as **ciphertext** (S2 direction); cloud-side encryption deferred to a later cloud-team phase. This pass builds the local vault only; sync disabled ⇒ purely local. |
| 5 | SQLite | Direction recorded only; no native SQLite dependency is introduced (§8). |

---

## 2. Where config lives today (ground truth)

**Data root:** `LOG_DIR`, resolved in `packages/app/findcc.js:95-130`
(`resolveLogDir`), default `join(getClaudeConfigDir(), 'cc-viewer')` = `~/.claude/cc-viewer`,
env override `CCV_LOG_DIR` (`findcc.js:96`), live binding `export let LOG_DIR` (`findcc.js:134`),
runtime-mutable via `setLogDir()` (`findcc.js:150`).

> ⚠️ **Two roots diverge.** A handful of modules bypass `LOG_DIR` and hardcode
> `join(getClaudeConfigDir(), 'cc-viewer', …)`, so they ignore `CCV_LOG_DIR`:
> `server/lib/updater.js:91`, `server/lib/terminal-env.js:46`,
> `server/routes/files-fs.js:87`, `server/routes/files-content.js:279`, `server/cli.js:84,1083,1098`.
> A cloud-sync agent that follows `LOG_DIR` will **miss** these (notably `update-check.json` and
> the shell-rc wrappers). Reconcile these onto `LOG_DIR` before relying on any sync.

### 2.1 The single correct write path

`preferences.json` is written through **one** canonical writer — `packages/app/server/lib/prefs-store.js`:

- `readPrefsRaw(file)` `:30` — tolerant read (`{}` on miss/corrupt/non-object).
- `mutatePrefs(mutator, file)` `:58` — **the kernel**: `withFileLockAsync(preferences.lock)` →
  read raw → in-place mutate (may be async) → atomic tmp→`renameSyncWithRetry` write, mode `0600`
  + `chmod` re-assert.
- `applyPrefsPatch(target, patch, {logDir})` `:73` — domain merge (approvalModal/voicePack reconcile).

This is the **only** writer that is both locked and atomic. Any cloud-sync write **must** go
through `mutatePrefs` — bypassing it breaks the lock invariants documented at `prefs-store.js:1-9`.

### 2.2 The lock & atomic primitives (reusable, zero new wheels)

- `server/lib/async-file-lock.js:97` `withFileLockAsync(lockPath, fn, {deadline, retryMs,
  staleThresholdMs, writePid, ensureDir})` — in-process Promise chain + cross-process
  `open('wx')` file lock, PID-liveness + mtime stale detection.
- `server/lib/file-api.js:148` `renameSyncWithRetry(src, dst, {retries, delayMs})` — retries only
  `EACCES/EPERM/EBUSY` (Windows file-locked-by-reader).

### 2.3 Store inventory (the convergence surface)

Global files directly under `LOG_DIR`:

| File | Canonical module | Lock | Atomic | Mode | Domain semantics | Cloud class (§4) |
|---|---|---|---|---|---|---|
| `preferences.json` | `lib/prefs-store.js` (via `lib/json-store.js`) | ✅ | ✅ | 0600 | UI prefs, `auth` (enabled only), `authByProject`, `prefsByProject`, IM platform keys, `disabledPlugins` | **B (mixed: plain + secret refs)** |
| `profile.json` | `server/interceptor.js` (via `lib/json-store.js`) | ✅ | ✅ | 0600 | `{profiles:[{id,name,baseURL,…}], active}` — **apiKey now lives in the credential vault**, hot-reloaded via `watchFile` | **B (mixed)** |
| `credentials.json` | `lib/credential-store.js` (via `lib/json-store.js`) | ✅ | ✅ | 0600 | AES-256-GCM vault ciphertext: proxy `apiKey`, LAN password, IM secrets (`creds` map) | **E (credential, never plain)** |
| `master.key` | `lib/credential-vault.js` | — | — | 0600 | machine-local vault key; without it the vault ciphertext is unrecoverable | **E (never leaves the machine)** |
| `workspaces.json` | `server/workspace-registry.js:13` | ✅ | ✅ | umask | local workspace registry `{workspaces:[{id,path,projectName,lastUsed,createdAt}]}` | **C (local-only)** |
| `ask-store.json` | `lib/ask/ask-store.js:25` | ✅ | ✅ | umask | `SCHEMA_VERSION=1`, 24h TTL prune, first-write-wins terminal guard | **D (ephemeral, no sync)** |
| `retry-config.json` | `server/interceptor.js:109` | ❌ | ❌ | 0600 | proxy retry tuning, file overrides env | **A (plain sync)** |
| `.session-pin.json` (per project) | `lib/session-pin-store.js:17` | ❌ | ✅ | umask | per-project session pin; null→delete | **C (local-only)** |
| `active-profile.json` (per project) | `server/interceptor.js:128` | ❌ | ✅ | 0600 | `{activeId, roles:{subagent,teammate}}` per-workspace profile/role pick | **A (plain sync)** |

> The remaining stores are operational/derived state, not user config: session wire logs
> (`lib/v2/*`), stats caches (`stats-worker.js`, `proxy-stats.js`), system-prompt snapshots/live,
> voice-packs, plugins dir, IM-worker dirs (`IM_<id>/*`), recycle bins, `update-check.json`.
> These are **class D** (do not sync) — see §4.

### 2.4 Files with multiple writers (converged)

The config writers are now converged onto a single locked + atomic kernel (`lib/json-store.js`:
`readJsonSafe` / `writeJsonAtomic` / `mutateJson` / `mutateJsonSync` / `withJsonLock`). The lock
name is derived from the data file (`<file>.lock`), fixing the old fixed-basename collision.

- **`preferences.json`:** `lib/prefs-store.js` (`mutatePrefs`), `lib/auth.js`, `lib/im/im-config.js`,
  and the routes all do read-merge-write inside the kernel's lock (the old `auth.js` lock-free and
  `im-config.js` unlocked/non-atomic writers are closed).
- **`profile.json`:** all write sites (`interceptor.js`, `routes/preferences.js`) now write via
  `mutateJsonSync` with `strictCorrupt` (a present-but-corrupt file is never overwritten by a fallback).
- **`~/.claude/settings.json` — 3 writers:** `ensure-hooks.js:340` (atomic), `routes/preferences.js:295` (plain), `cli.js:1080` (plain).

**Implication:** all writers of a file must go through one locked + atomic path (cc-viewer side),
otherwise cloud sync has no consistent on-disk state to materialize or compare.

---

## 3. Where credentials live today

cc-viewer has **no** `official-auth`/`aima`/SSO. Credentials are encrypted at rest in a local
AES-256-GCM vault (`lib/credential-vault.js` + `lib/credential-store.js`); the pre-vault plaintext /
base64 copies in `profile.json` / `preferences.json` are migrated out on first start and no longer
carried. The credential surface:

| # | Field | At rest in | Encoding | Write site | Read site | Risk |
|---|---|---|---|---|---|---|
| C1 | `profiles[].apiKey` | `credentials.json` (vault) | **AES-256-GCM** | `routes/preferences.js` (via `credential-access.js`) | `interceptor.js` (request injection, fail-closed) | **highest** |
| C2 | `auth.password` / `authByProject.*.password` | `credentials.json` (vault) | AES-256-GCM | `lib/auth.js` | `lib/auth.js` (fail-closed) | high |
| C3 | `dingtalk/feishu/wecom/discord` `appSecret/botToken` | `credentials.json` (vault) | AES-256-GCM | `lib/im/im-config.js` | adapters via `loadConfig` | high |
| — | low-sensitivity IM cred fields (`appKey/appId/botId`) | `preferences.json` | base64 | `lib/im/im-config.js` | adapters | low |

**Leakage amplifiers:**

- `lib/config-backup.js:13` copies `preferences.json` + `profile.json` + `credentials.json` +
  `master.key` into `~/.claude/cc-viewer-config-backups/<ts>/`, KEEP=10. A backup dir therefore holds
  the full decryption kit (ciphertext + key together) and is denied to IM sessions and the remote
  file API. **Historical pre-encryption backups still hold the old plaintext** and are deliberately
  KEPT as the recovery path (not auto-cleaned) — handle them as sensitive until the vault is verified.
- `server/server.js:1139` prints the LAN password to **stderr** at startup (plaintext into process
  logs / container stdout). Same for `ACCESS_TOKEN` at `:1135`.
- Session wire logs persist the API key masked to first-8+last-4 (`interceptor.js:850-866`) → 12
  plaintext chars per request retained indefinitely. Out of scope for vault, but note for cloud
  log shipping.

---

## 4. Cloud sync classes

Every config file is assigned one of four sync classes. This is the core of the advisory.

| Class | Meaning | Files |
|---|---|---|
| **A — plain sync** | Non-secret user config. Safe to push to cloud and pull down verbatim. | `retry-config.json`, per-project `active-profile.json`, the non-secret keys of `preferences.json` (UI prefs, `disabledPlugins`, `prefsByProject`), `profile.json` minus `apiKey` |
| **B — mixed (plain + secret)** | One file holds both plain config and credentials. Split before sync: plain part → class A, secret part → class E (vault). | `preferences.json` (auth.password + IM secrets), `profile.json` (apiKey) |
| **C — local-only** | Machine/instance-bound; meaningless or harmful on another machine. Never sync. | `workspaces.json` (local paths), per-project `.session-pin.json` |
| **D — ephemeral / derived, no sync** | Operational state, caches, logs, TTL stores. Regenerated; never sync. | `ask-store.json`, `update-check.json`, session wire logs, stats caches, system-prompt snapshots/live, voice-packs, plugins dir, `IM_<id>/*`, recycle bins |
| **E — secret (vault)** | Credentials. Encrypted at rest before any sync is even considered. See §6. | C1/C2/C3 above |

---

## 5. Cloud sync model (decided semantics)

> **Cloud-authoritative, local read-only fallback.**

```
                    ┌──────────────┐
        pull (on    │              │
   boot + interval) │  Cloud DB    │
   ◄────────────────│ (auth'd API) │
                    │              │
   ── materialize ─►│  writes go   │
   to local files   │  to cloud    │
                    └──────────────┘
```

### 5.1 When cloud is enabled AND reachable

1. **Pull → materialize.** On boot (and on a poll/refresh), fetch the cloud copy of class-A config
   and the *ciphertext* of class-E secrets (per §6). Write them into the local JSON files through
   the canonical writers (`mutatePrefs` for `preferences.json`, the unified kernel elsewhere).
   The cloud copy is the source of truth — local files become a **projection** of cloud.
2. **Writes go to cloud first.** A local config edit (via `/api/preferences` etc.) is applied to
   the cloud; on success the local file is updated to match. The local file is not the primary
   record while cloud is up.

### 5.2 When cloud is unreachable (or sync is disabled)

- Local files act as a **read-only fallback**. The instance keeps serving from the last
  materialized local copy.
- **No local write queue.** The instance does **not** accept local edits while offline and does
  **not** buffer "pending push" mutations to reconcile later. This deliberately avoids the
  local-write → push-fail → mark-unsynced → compensate loop. (Rationale: in the cloud-authored
  deployment, an offline container is treated as degraded/read-only rather than a fork of the
  config that must later be merged.)

### 5.3 Unsynced marking — scoped to *pull*, not push

Because writes are cloud-first (5.1), the only divergence is a **stale local projection** when a
pull fails. That is tracked as a lightweight *sync-health* marker, not a write-backlog:

- Keep a `sync-state.json` (class D, local-only) recording per-config-key `lastPulledAt` /
  `lastPullError`. A failed pull marks the affected keys `stale`, surfaced in the UI ("config may
  be out of date; last synced <ts>"). On the next successful pull the marker clears.
- This is **not** the same as genv's local-priority unsynced-write queue; it exists only to make
  the read-only fallback honest about staleness.

### 5.4 Hard constraints for any sync implementation

- **Never bypass `mutatePrefs`** (or the unified kernel) when writing `preferences.json` /
  `profile.json` locally — doing so breaks the file-lock invariants (`prefs-store.js:1-9`).
- **Apply equal-or-stricter redaction than the existing GET routes** before any value leaves the
  process (`routes/preferences.js:127-131,160-162` already strip secrets). A sync path that leaks
  a secret is a credential-exfiltration channel.
- **Collapse the multi-writer files first** (§2.4). Sync needs one consistent on-disk state.
- **Reconcile the `CCV_LOG_DIR` bypasses** (§2) before trusting "sync everything under LOG_DIR".
- **Exclude `*.lock` and `*.tmp-<pid>-<hex>` strays** from any pull/push diff.

---

## 6. Credentials & cloud (two strategies)

Credentials (C1 apiKey, C2 password, C3 IM secrets) must be **encrypted at rest** before any cloud
handling. The local vault cc-viewer uses is: AES-256-GCM, per-record random IV, with a machine-local
`master.key` (`0600`, generated on first boot). `config-backup` backs `master.key` up **alongside**
`credentials.json` (a backup dir is therefore equivalent to the vault — ciphertext + key together),
which keeps the recovery path complete but means a backup leak is a vault leak.

### Strategy S1 — credentials never leave the machine

- Cloud syncs **only class-A plain config**. Class-E credentials stay local, encrypted in the
  vault, and are **never** pushed.
- The cloud record for a profile carries everything **except** `apiKey`; each machine holds its own
  apiKey locally (or an operator injects it per-device).
- **Pros:** smallest blast radius; a cloud breach exposes no bearer credentials; aligns with
  least-privilege. **Cons:** apiKeys must be provisioned per machine (no roaming of secrets).

### Strategy S2 — ciphertext syncs, key stays local (decided direction)

- Class-E credentials are pushed to cloud **only as vault ciphertext** (`base64(iv|tag|ct)`).
  The `master.key` **never** leaves the machine as part of cloud sync. (Note: `config-backup` does
  copy it into the local rolling-backup dir alongside the ciphertext — that is a local recovery
  path, not a cloud channel, and the backup dir is denied to IM sessions and the remote file API.)
- Cloud stores ciphertext blobs it cannot decrypt; a machine that already has the matching
  `master.key` pulls + decrypts.
- **Pros:** secrets roam between machines that share the key. **Cons:** key distribution becomes
  the hard problem (out of band); a cloud breach exposes ciphertext (weaker than S1 but not
  plaintext); lost `master.key` = unrecoverable ciphertext.

> **Decision (confirmed):** credentials sync to cloud as **ciphertext** (S2 direction), but the
> actual cloud-side encryption/sync is **deferred to a later phase owned by the cloud team** —
> the recommended path is for the cloud to provide the encryption scheme. This pass only builds
> the **local vault** (encrypted at rest). When cloud sync is **not** enabled, the vault is purely
> local: local-to-local, nothing leaves the machine.

---

## 7. Proposed database mapping

Local JSON → relational/cloud-store mapping. Class C/D are listed for completeness but are marked
"no sync". This is the **recommended target schema for the cloud side**; it does not exist yet.

### 7.1 `preferences.json` (class B → split)

Non-secret keys (class A) → table `user_preferences`:

| Column | Source (local) | Notes |
|---|---|---|
| `user_id` (PK) | — (cloud tenant) | new; no local equivalent today |
| `lang` | `preferences.lang` | server reads at `server.js:1110-1118` |
| `ui` (jsonb) | remaining UI prefs | opaque blob, verbatim |
| `disabled_plugins` (jsonb) | `preferences.disabledPlugins` | read by `lib/plugin-loader.js:9,37,151` |
| `prefs_by_project` (jsonb) | `preferences.prefsByProject` | per-project forks (`routes/project-prefs.js`) |
| `updated_at` | — | sync bookkeeping (§5.3) |

Secret keys (class E) → **not** in `user_preferences`; see `credentials` table (7.4).

### 7.2 `profile.json` (class B → split)

Non-secret part (class A) → table `proxy_profiles`:

| Column | Source | Notes |
|---|---|---|
| `profile_id` (PK) | `profiles[].id` | |
| `user_id` (FK) | — | |
| `name` | `profiles[].name` | |
| `base_url` | `profiles[].baseURL` | |
| `model_map` (jsonb) | `profiles[].model…` | non-secret mapping fields |
| `is_active` | `profile.json active` | active-profile pointer |
| `updated_at` | — | |

`apiKey` (class E) → `credentials` table (7.4), keyed by `profile_id`.

### 7.3 `retry-config.json` / `active-profile.json` (class A)

→ table `runtime_config` (`user_id` PK, `retry_config` jsonb, `active_profile` jsonb, `updated_at`).
Low value; candidate to fold into `user_preferences` if you prefer fewer tables.

### 7.4 `credentials` table (class E — only under strategy S2)

| Column | Source | Notes |
|---|---|---|
| `cred_id` (PK) | — | |
| `user_id` (FK) | — | |
| `kind` | `profile-apiKey` / `lan-password` / `im-secret` | |
| `ref` | `profile_id` / platform / `authByProject` key | discriminator |
| `ciphertext` | vault `base64(iv|tag|ct)` | **never plaintext** |
| `updated_at` | — | |

Under **S1** this table is **not created**; credentials stay in the local vault only. Under the
**decided S2 direction** the cloud stores ciphertext it cannot decrypt, keyed by `user_id` + `ref`.

### 7.5 Class C / D — no tables

`workspaces.json`, `.session-pin.json`, `ask-store.json`, `update-check.json`, session logs,
stats caches, system-prompt snapshots/live, voice-packs, plugins, `IM_<id>/*` → **no cloud table**;
remain local files (class C/D).

---

## 8. SQLite direction (recorded, not built)

A later phase may collapse the local JSON files into a single-file `~/.claude/cc-viewer/cc-viewer.db`
(SQLite) so the *local* store mirrors the cloud relational schema (profiles / prefs / runtime_config /
local-only vault). JSON then degrades to a one-time import source.

**Why not now:** `better-sqlite3` is a native dependency that forces build/sign/CI changes and a
tarball-baseline rebuild. Local convergence therefore stays on a unified **JSON** store kernel —
one locked + atomic write path per file — which is the prerequisite for any later SQLite or
cloud projection.
