# CCV External Sessions Protocol v1

**Status**: Draft → Stable (v1 as of ccv 1.6.158)
**Scope**: Defines how external tools (e.g. `lia`, CI runners, custom orchestrators) write CC session logs into a directory layout that ccv can browse and live-tail.

This is a **data protocol**, not a code protocol. ccv has zero knowledge of any particular producer. ccv reads what's on disk; producers write what the schema says.

## Two entry points

| Direction | ccv offers |
|---|---|
| **Write** (producer side) | ccv's `proxy.js` recognises `CCV_EXTERNAL_SESSION` env and writes `log.jsonl` + `session.json` skeleton into the protocol-prescribed location |
| **Read** (viewer side) | ccv scans `CCV_EXTERNAL_ROOTS` at startup, exposes REST + SSE endpoints, and renders an opt-in UI at `?view=external` |

Producers don't have to use ccv's proxy — they can write the files themselves. ccv just requires the directory layout and JSON schema below.

## Directory layout

```
<external-root>/                      # user-configured absolute path
  <provider-id>/                      # slug — one per producer (e.g. "lia")
    index.json                        # provider-level metadata
    scopes/
      <scope-id>/                     # slug — business grouping (e.g. "wi-lia-150")
        scope.json                    # scope metadata
        sessions/
          <session-id>/               # slug — one CC session
            session.json              # session metadata
            log.jsonl                 # ccv-format log (\n---\n separated)
```

**Slug format**: `^[a-z0-9][a-z0-9_\-\.]{0,63}$` — lowercase, starts with alnum, `.`/`_`/`-` allowed, max 64 chars.

**Rules**:
- Directories that don't match slug format are ignored by ccv
- Any JSON file that's missing or unparseable is treated as absent (ccv falls back to directory-name display)
- `log.jsonl` format is **ccv's native proxy format** — entries joined by `\n---\n` (not newline-delimited JSON, because entries may contain literal newlines)

## Schema

### index.json (provider)

```json
{
  "protocolVersion": 1,
  "providerId": "lia",
  "providerName": "Lia Work Management",
  "updatedAt": "2026-04-15T14:30:22Z"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `protocolVersion` | integer | yes | Must equal 1. Mismatched versions are skipped with a warning. |
| `providerId` | string | yes | Matches the parent directory name. |
| `providerName` | string | no | Human-readable label; falls back to `providerId`. |
| `updatedAt` | ISO 8601 | no | Informational. |

### scope.json (business grouping)

```json
{
  "scopeId": "wi-lia-150",
  "title": "实现 ccv 集成",
  "subtitle": "lia:150",
  "kind": "work-item",
  "meta": [
    {"label": "Status", "value": "in_progress", "type": "tag"},
    {"label": "Claim", "value": "mail-789", "type": "link", "href": "lia://mail/789"}
  ],
  "updatedAt": "2026-04-15T14:30:22Z"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `scopeId` | string | yes | Matches parent directory name. |
| `title` | string | yes | Displayed in sidebar. |
| `subtitle` | string | no | Shown under title. |
| `kind` | string | no | `work-item` / `project` / `custom`. Informational. |
| `meta` | array | no | See "meta entries" below. Reserved for future UI; ccv 1.6.158 doesn't render them yet. |
| `updatedAt` | ISO 8601 | no | Informational. |

### session.json (one CC session)

```json
{
  "sessionId": "worker-20260415-143022",
  "title": "worker claim attempt 1",
  "role": "worker",
  "logFile": "log.jsonl",
  "startedAt": "2026-04-15T14:30:22Z",
  "endedAt": null,
  "parentSessionId": null,
  "meta": [
    {"label": "Skills", "value": ["release", "adr"], "type": "tag"}
  ],
  "updatedAt": "2026-04-15T14:30:22Z"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionId` | string | yes | Matches parent directory name. |
| `title` | string | yes | Displayed in session list. |
| `role` | string | yes | Freeform; conventional values `worker`, `counsel`. UI provides a role filter. |
| `logFile` | string | yes | Relative path within `<session-id>/`. Must not be absolute, must not contain `..`. Typically `"log.jsonl"`. |
| `startedAt` | ISO 8601 | yes | Used for session-list sort (desc). |
| `endedAt` | ISO 8601 / null | yes | `null` means session is live; UI shows a live tag. Proxy fills this on exit. |
| `parentSessionId` | string / null | no | Reserved for sub-agent linkage (ccv doesn't follow it yet in 1.6.158). |
| `meta` | array | no | See below. Reserved for future MetadataPanel. |
| `updatedAt` | ISO 8601 | no | Informational. |

**Lifecycle invariant**: `session.json` is written **twice** at minimum — once at session start (skeleton with `endedAt: null`), once at end (`endedAt` filled). No intermediate writes required. Producers may add writes to refresh `meta`, but ccv doesn't depend on mid-session updates.

### meta entries

Reserved format for future MetadataPanel rendering. ccv 1.6.158 **does not render meta** but producers should populate it per this shape so no migration is needed when rendering lands:

```json
{"label": "Label", "value": "string or array", "type": "text|tag|link|code", "href": "optional"}
```

## Runtime: `CCV_EXTERNAL_SESSION` (writer env)

When ccv's proxy starts with this env set, it writes into the protocol-prescribed location. Example:

```bash
export CCV_EXTERNAL_SESSION='{
  "sessionDir": "/abs/root/lia/scopes/wi-lia-150/sessions/worker-20260415-143022",
  "sessionId": "worker-20260415-143022",
  "role": "worker",
  "title": "worker claim attempt 1",
  "parentSessionId": null,
  "meta": [{"label":"Skills","value":["release"],"type":"tag"}]
}'
```

Behaviour:
1. `mkdir -p <sessionDir>`
2. Write `<sessionDir>/session.json` skeleton with `startedAt: now`, `endedAt: null`, `logFile: "log.jsonl"`, and verbatim copy of `sessionId`/`role`/`title`/`parentSessionId`/`meta`
3. Append all captured requests/responses to `<sessionDir>/log.jsonl`
4. On proxy exit (SIGTERM / SIGINT / normal), patch `session.json` with `endedAt: now`, `updatedAt: now` (idempotent)

Guarantees:
- If `session.json` already exists, it is **not** overwritten (safe for session resume)
- If the env is absent or unparseable, proxy falls back to default behaviour (`~/.claude/cc-viewer/<proj>/...`) — no regression for existing users
- Log rotation is disabled in external-session mode (protocol requires a single `log.jsonl`)

Producers that don't use ccv's proxy must write session.json + log.jsonl themselves, following the same rules.

## Runtime: `CCV_EXTERNAL_ROOTS` (reader env)

Comma-separated list of absolute paths. Supports `~` and `$HOME` expansion.

```bash
export CCV_EXTERNAL_ROOTS="$HOME/.lia/ccv-roots,/tmp/ccv-external-dev"
ccv
```

ccv on startup:
1. Loads roots (env takes precedence over `preferences.json` → `externalRoots: []`)
2. `fs.watch(root, {recursive: true})` on each root
3. Exposes REST + SSE API (below)
4. The UI at `?view=external` becomes usable

When no roots are configured, none of the above activates — ccv behaves identically to prior versions.

## REST API

All endpoints are read-only, local to ccv's HTTP server.

### `GET /api/external/roots`
Returns configured roots and the providers found under each.
```json
{
  "roots": [
    {
      "index": 0,
      "path": "/home/user/.lia/ccv-roots",
      "providers": [
        {"providerId": "lia", "providerName": "Lia", "protocolVersion": 1, "updatedAt": "..."}
      ]
    }
  ]
}
```

### `GET /api/external/scopes?root=<index>&provider=<id>`
Returns the scope list for one provider. 400 on bad input.

### `GET /api/external/sessions?root=<index>&provider=<id>&scope=<id>`
Returns the session list, sorted by `startedAt` desc.

### `GET /api/external/events?root=<idx>&provider=<id>&scope=<id>&session=<id>` (SSE)
Live-tails the selected session's `log.jsonl`. Events:
- `load_start` — total entry count + `external: true`
- `load_chunk` — historical entries in batches
- `load_end` — history replay finished
- default (unnamed) — new entries appended after `load_end`
- `ping` — keepalive every 30s
- `error` — stream error detail

Returns 400 on bad params, 404 on missing log.

### Global `/events` SSE also emits:
- `external:changed` — any non-`log.jsonl` file under a watched root was created/modified. Clients typically refresh the relevant list.

## Security

- **Path whitelisting**: `provider`/`scope`/`session` query params are validated against the slug regex. Invalid → 400.
- **Path traversal defense**: `session.json`'s `logFile` field must be a relative path within its `sessionDir`. Absolute paths or `..` segments → 404.
- **Root whitelisting**: Only roots explicitly in `CCV_EXTERNAL_ROOTS` / `preferences.externalRoots` are scanned. No auto-discovery.
- **Third-party producers**: ccv executes no code from external roots. It only reads JSON and appends-only log files. Malicious JSON content in `meta` fields is text — not rendered as HTML.

## UI entry

Add `?view=external` to the ccv URL (optionally with `root=`, `provider=`, `scope=`, `session=` for deep-linking). The UI renders:

```
┌─ header (title, refresh, close) ────────────────────────────────────┐
├─ scope sidebar ─┬─ session list (role filter) ─┬─ entry timeline ──┤
│ [lia]           │ [All] [Worker] [Counsel]     │                   │
│   wi-lia-150    │ [worker] attempt 1 [live]    │ POST /v1/messages │
│   wi-lia-212    │ [counsel] reviewer           │   model=...       │
│ [other-provider]│                              │   msgs=12         │
│   ...           │                              │   ... raw JSON    │
└─────────────────┴──────────────────────────────┴───────────────────┘
```

Out of scope for v1 UI (planned for follow-up):
- Rendering `meta[]` (MetadataPanel)
- `parentSessionId` navigation to sub-agents
- Cross-session grep

## Example: end-to-end (producer = lia-like)

```bash
# 1. Prepare scope (producer responsibility)
mkdir -p "$HOME/.lia/ccv-roots/lia/scopes/wi-lia-150"
cat > "$HOME/.lia/ccv-roots/lia/index.json" <<EOF
{"protocolVersion": 1, "providerId": "lia", "providerName": "Lia"}
EOF
cat > "$HOME/.lia/ccv-roots/lia/scopes/wi-lia-150/scope.json" <<EOF
{"scopeId": "wi-lia-150", "title": "实现集成", "kind": "work-item"}
EOF

# 2. Launch claude through ccv proxy with external-session env
SESSION_ID="worker-$(date +%Y%m%d-%H%M%S)"
SESSION_DIR="$HOME/.lia/ccv-roots/lia/scopes/wi-lia-150/sessions/$SESSION_ID"
export CCV_EXTERNAL_SESSION=$(jq -n \
  --arg dir "$SESSION_DIR" --arg id "$SESSION_ID" \
  '{sessionDir: $dir, sessionId: $id, role: "worker", title: "worker claim"}')
# proxy writes session.json skeleton + log.jsonl into $SESSION_DIR
ccv run -- claude ...

# 3. View (from another shell, during or after)
CCV_EXTERNAL_ROOTS="$HOME/.lia/ccv-roots" ccv
# Browser opens; navigate to http://127.0.0.1:7008/?view=external
# Or deep-link: .../?view=external&root=0&provider=lia&scope=wi-lia-150&session=<SESSION_ID>
```

## Versioning

- `protocolVersion: 1` is frozen. Any breaking schema change bumps to `2`.
- Additive fields (new optional keys) may appear in minor ccv releases; producers should ignore unknown keys.
- If a new ccv reads `protocolVersion: 2` from a future producer, it skips with a warning and keeps functioning on v1 roots.

## Reference files in ccv source

- Writer: `lib/external-session-writer.js`
- Reader: `lib/external-sessions.js`
- Server routes: `server.js` (`/api/external/*`)
- Frontend: `src/components/external/ExternalSessionsView.jsx`
- Tests: `test/external-session-writer.test.js`, `test/external-sessions.test.js`
- Decision history: `docs/ccv-external-integration-options.md` (archived path 1/2 options)
