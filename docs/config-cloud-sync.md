# Config Cloud Sync — Cloud Contract (cc-viewer)

> This document defines the contract between cc-viewer and the cloud: which keys go up, which
> endpoints the cloud must provide (name/params/storage/return), and how secrets are handled
> separately. Local implementation details are out of scope.

---

## 1. Sync scope

The cloud accepts **only** the following:

| Cloud object | Source (local) | Keys | Notes |
|---|---|---|---|
| `user_preferences` | `preferences.json`, per-project `active-profile.json` | `lang`, `ui`, `disabledPlugins`, `prefsByProject`, `activeProfile` | Non-secret UI/feature prefs + per-project profile/role assignment |
| `proxy_profiles` | `profile.json` | `profiles[].id/name/baseURL/model…`, `active` | **No `apiKey`** (secrets go to §4) |
| `credentials` | local vault ciphertext | `kind`, `ref`, `ciphertext` | **Ciphertext only**, see §4 |

> **Not** synced (machine/instance-bound, runtime, or tuning): `retry-config.json` (retry tuning,
> per-instance), `workspaces.json`, `.session-pin.json`, `ask-store.json`, `update-check.json`,
> session wire logs, stats caches, system-prompt snapshots/live, voice-packs, plugins,
> `IM_<id>/*`, trash.

**Secret-splitting rule**: `preferences.json` and `profile.json` are mixed files. Split before
sync — the plaintext part goes to `user_preferences`/`proxy_profiles`; secrets
(`profiles[].apiKey`, `auth.password`, IM `appSecret/botToken`) go to the `credentials`
ciphertext channel (§4). Cloud endpoints **must not** carry secret fields inside plaintext objects.

---

## 2. Sync semantics (cloud is authoritative)

- **Cloud is authoritative**: when the cloud is enabled and reachable, local files are a
  projection of the cloud. Writes land on the cloud first, then materialize locally; pulls happen
  at startup (and on poll).
- **Local read-only fallback**: when the cloud is unreachable, the local copy is read-only. The
  instance does **not** accept local edits and does **not** buffer offline writes for later push.
- **Staleness flag**: a failed pull only means "local projection is stale". A local
  `sync-state.json` records `lastPulledAt` / `lastPullError` per key; the UI surfaces "last synced
  <ts>" and clears it on the next successful pull. No write queue.

---

## 3. Cloud endpoints (REST, authenticated by `userId`)

All endpoints authenticate and resolve `user_id`. Request/response are JSON.

### 3.1 `user_preferences` (plaintext prefs)

**`GET /config/preferences?userId=<id>`**
- **Returns** `200`: `{ lang, ui, disabledPlugins, prefsByProject, activeProfile, updatedAt }`
- Fields (what it stores → which feature it drives; cloud key ↔ local key):
  - `lang` string — UI language; the language of server-delivered copy. ↔ local `preferences.lang`
  - `ui` object — UI appearance/layout/toggles; frontend rendering. The cloud does not parse its internals. ↔ local `preferences` UI keys (`theme` ↔ local `themeColor`, see §3.4)
  - `disabledPlugins` string[] — disabled plugin IDs; the plugin loader skips them. ↔ local `preferences.disabledPlugins`
  - `prefsByProject` object — per-project preference forks (key = project dir, value = the subset that overrides global); project-level personalization. ↔ local `preferences.prefsByProject`
  - `activeProfile` object — per-project profile & role assignment (key = project, value = `{ activeId, roles:{subagent, teammate} }`); which profile subagent/teammate requests take. ↔ local per-project `active-profile.json` `{ activeId, roles }`
  - `updatedAt` ISO timestamp — last cloud write time; drives the "stale" check. No local counterpart (cloud bookkeeping).

**`PUT /config/preferences`**
- **Params** (body): `{ userId, lang?, ui?, disabledPlugins?, prefsByProject?, activeProfile? }` (partial update; absent keys untouched)
- **Returns** `200`: `{ updatedAt }`

Example:

```http
GET /config/preferences?userId=u123
```
```json
{
  "lang": "zh",
  "ui": { "theme": "dark", "sidebarCollapsed": false },
  "disabledPlugins": ["voice-pack", "telemetry"],
  "prefsByProject": {
    "/Users/x/proj-a": { "lang": "en" }
  },
  "activeProfile": {
    "/Users/x/proj-a": { "activeId": "p-glm", "roles": { "subagent": "p-openai", "teammate": "follow" } }
  },
  "updatedAt": "2026-09-21T08:00:00Z"
}
```

```http
PUT /config/preferences
```
```json
// request
{ "userId": "u123", "lang": "en", "disabledPlugins": ["telemetry"] }

// 200
{ "updatedAt": "2026-09-21T09:12:30Z" }
```

### 3.2 `proxy_profiles` (plaintext profiles, no apiKey)

**`GET /config/profiles?userId=<id>`**
- **Returns** `200`: `{ profiles: [{ profileId, name, baseUrl, modelMap }], activeProfileId, updatedAt }`
- Fields (what it stores → which feature it drives; cloud key ↔ local key):
  - `profiles[].profileId` string — profile identifier; the key for request routing and secret association. ↔ local `profiles[].id`
  - `profiles[].name` string — display name; UI profile list. ↔ local `profiles[].name`
  - `profiles[].baseUrl` string — the profile's proxy target URL; outbound requests are rewritten to it. ↔ local `profiles[].baseURL`
  - `profiles[].modelMap` object — model routing (`ANTHROPIC_MODEL`/`ANTHROPIC_DEFAULT_OPUS_MODEL`/`SONNET`/`HAIKU`/`effort`, etc.); what each model tier is rewritten to. ↔ locally these keys sit flat on the profile object (`profiles[].ANTHROPIC_MODEL`, …); the cloud nests them under `modelMap`, flattened on materialize. **No secrets.**
  - `activeProfileId` string — the currently active profile; the default for global requests. ↔ local `profile.json` `active`
  - `updatedAt` ISO timestamp.

**`PUT /config/profiles`**
- **Params** (body): `{ userId, profiles: [{ profileId, name, baseUrl, modelMap }], activeProfileId }`
  — replaces the user's whole profile set and resets the active pointer.
- **Returns** `200`: `{ updatedAt }`
- **Constraint**: no profile object may contain `apiKey`; secrets use the §4 `credentials` channel.

Example:

```http
GET /config/profiles?userId=u123
```
```json
{
  "profiles": [
    {
      "profileId": "p-openai",
      "name": "OpenAI direct",
      "baseUrl": "https://api.openai.com",
      "modelMap": { "ANTHROPIC_MODEL": "gpt-5", "effort": "high" }
    },
    {
      "profileId": "p-glm",
      "name": "GLM",
      "baseUrl": "https://open.bigmodel.cn/api/anthropic",
      "modelMap": { "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-4.6", "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.6" }
    }
  ],
  "activeProfileId": "p-openai",
  "updatedAt": "2026-09-21T08:00:00Z"
}
```

```http
PUT /config/profiles
```
```json
// request
{
  "userId": "u123",
  "profiles": [
    { "profileId": "p-openai", "name": "OpenAI direct", "baseUrl": "https://api.openai.com", "modelMap": { "ANTHROPIC_MODEL": "gpt-5", "effort": "high" } }
  ],
  "activeProfileId": "p-openai"
}

// 200
{ "updatedAt": "2026-09-21T09:15:00Z" }
```

### 3.3 `credentials` (ciphertext)

Endpoints and storage in §4.

### 3.4 Database schema

> **jsonb**: PostgreSQL's binary JSON column type; stores/indexes JSON documents directly. Suited to
> opaque, variably-shaped config blobs (`ui`, `prefsByProject`, `modelMap`, …) — stored verbatim,
> no per-column modeling needed.

**`user_preferences`**
| Column | Type | What it drives |
|---|---|---|
| `user_id` | text PK | Cloud tenant; one row = one user |
| `lang` | text | UI language → server-delivered copy language. ↔ `preferences.lang` |
| `ui` | jsonb | UI preference set → frontend rendering. Sub-keys e.g. `theme` (light/dark theme; local `preferences.json` key is `themeColor`, mapped on materialize), `modalEnabled` (approval modal toggle), `soundEnabled` (sound toggle), `notifyOnlyWhenHidden` (notify only when window hidden), `voicePack` (voice pack, below); the cloud does not parse internals |
| `disabled_plugins` | jsonb | Disabled plugin ID array `["voice-pack", …]` → loader skips by ID. ↔ `preferences.disabledPlugins` |
| `prefs_by_project` | jsonb | Per-project forks → project personalization. Shape `{ "<projectDir>": { …the ui/approvalModal subset this project overrides… } }`; `auth`/`authByProject`/`prefsByProject`/`logDir`/`claudeConfigDir` are stripped and never enter a fork. ↔ `preferences.prefsByProject` |
| `active_profile` | jsonb | Per-project profile/role assignment → subagent/teammate routing. Shape `{ "<project>": { "activeId": "<profileId>", "roles": { "subagent": "<profileId>\|follow\|max", "teammate": … } } }`; `follow` = follow activeId, `max` = built-in default, no rewrite. ↔ per-project `active-profile.json` `{ activeId, roles }` |
| `updated_at` | timestamptz | Last write time → staleness check |

> The `voicePack` subtree inside `ui`: `{ enabled, volume, events }`; `events` is a whitelisted
> event map, keys limited to `planApproval`/`askQuestion`/`turnEnd`, values = audio pack ID
> (`default`/`sanguo`/custom) or `null` (off). Drives approval/question/turn-end sound playback.

**`proxy_profiles`**
| Column | Type | What it drives |
|---|---|---|
| `profile_id` | text PK | Profile ID → routing & secret-association key. ↔ local `profiles[].id` |
| `user_id` | text FK | Owning user |
| `name` | text | Display name → UI list. ↔ local `profiles[].name` |
| `base_url` | text | Proxy target → outbound request rewrite address. ↔ local `profiles[].baseURL` |
| `model_map` | jsonb | Model routing → per-tier rewrite. Sub-keys: `ANTHROPIC_MODEL` (unified model), `ANTHROPIC_DEFAULT_OPUS_MODEL`/`SONNET`/`HAIKU` (per-tier override), `effort` (reasoning effort); the interceptor rewrites the request body's model field accordingly. ↔ locally flat on the profile top level |
| `is_active` | bool | Whether active → default requests use it. ↔ local `profile.json` `active` (value = profile_id) |
| `updated_at` | timestamptz | Last write time |

**`credentials`** → see §4.

---

## 4. Secrets (separate chapter)

Secrets are kept **fully separate** from plaintext config. Decided direction **S2: ciphertext up,
key stays local**.

- Secrets are encrypted on the machine with AES-256-GCM (local vault, master key `master.key`).
- **Only ciphertext** `base64(iv|tag|ct)` goes up; `master.key` **never leaves the machine**.
- The cloud stores ciphertext blobs it **cannot decrypt**, keyed by `user_id` + `ref`; a machine
  holding the matching `master.key` pulls and decrypts.
- With cloud sync off, the vault is purely local — nothing leaves the machine.

**Secret kinds** (`kind`):
| kind | Source | Feature it drives | `ref` discriminator |
|---|---|---|---|
| `profile-apiKey` | `profiles[].apiKey` | Bearer key for proxy outbound requests → request auth injection | `profile_id` |
| `lan-password` | `auth.password` / `authByProject.*.password` | Login password for remote/LAN cc-viewer → access auth | `global` (global) / `proj:<projectDir>` (project override) |
| `im-secret` | per-platform secret field: `appSecret` (dingtalk/feishu), `secret` (wecom), `botToken` (discord) | IM bots calling platform APIs → message-push auth | `<platform>.<field>` (e.g. `wecom.secret`, `discord.botToken`) |

**Cloud endpoints**
- **`GET /config/credentials?userId=<id>`** → `200 { creds: [{ credId, kind, ref, ciphertext, updatedAt }] }`
- **`PUT /config/credentials`** body `{ userId, creds: [{ kind, ref, ciphertext }] }` → `200 { updatedAt }`
  — upsert by `kind`+`ref`; `ciphertext` only.

Example:

```http
GET /config/credentials?userId=u123
```
```json
{
  "creds": [
    { "credId": "c1", "kind": "profile-apiKey", "ref": "p-openai", "ciphertext": "Aa9x…(base64 of iv|tag|ct)", "updatedAt": "2026-09-21T08:00:00Z" },
    { "credId": "c2", "kind": "lan-password", "ref": "global", "ciphertext": "Qp2m…", "updatedAt": "2026-09-21T08:00:00Z" },
    { "credId": "c3", "kind": "im-secret", "ref": "feishu.appSecret", "ciphertext": "Zz81…", "updatedAt": "2026-09-21T08:00:00Z" }
  ]
}
```

```http
PUT /config/credentials
```
```json
// request
{ "userId": "u123", "creds": [ { "kind": "profile-apiKey", "ref": "p-glm", "ciphertext": "Mk4t…" } ] }

// 200
{ "updatedAt": "2026-09-21T09:25:00Z" }
```

**`credentials` table**
| Column | Type | What it drives |
|---|---|---|
| `cred_id` | text PK | Credential record ID |
| `user_id` | text FK | Owning user |
| `kind` | text | Credential kind (three above) |
| `ref` | text | Discriminator: the object this secret serves (profile/project/platform) |
| `ciphertext` | text | Ciphertext `base64(iv|tag|ct)`, **never plaintext** |
| `updated_at` | timestamptz | Last write time |
