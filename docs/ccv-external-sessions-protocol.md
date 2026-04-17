# CCV External Sessions Protocol v1

**Status**: Stable (v1 as of ccv 1.6.158)
**Scope**: Defines how external tools (agent orchestrators, CI runners, custom launchers, etc.) record CC session logs into a directory layout that ccv can browse and live-tail.

This is a **data protocol**, not a code protocol. ccv has zero knowledge of any particular producer. ccv reads what's on disk; producers write what the schema says. The schema intentionally avoids any domain-specific vocabulary — values like `role` are free-form strings the producer chooses, and ccv renders them without interpretation.

## Shape assumption (be honest about this)

This protocol assumes a **three-tier taxonomy**: `producer / group / session`. Producers whose natural model fits this shape (one producer → several business groupings → each grouping has multiple CC sessions) can adopt v1 directly. Producers with two-tier (flat: producer → sessions) or deeper (four or more levels, e.g. producer → sub-namespace → sub-sub-namespace → session) models will have to either collapse or adapt to fit three tiers.

**The intended escape hatch for deeper models is not a protocol change — it's entry-point design.** See ["Producers with richer taxonomies"](#producers-with-richer-taxonomies) below: the producer owns its own CLI / UI command (`myprod view <ref>`, `myprod group view <ref>`, …) that translates its richer model into a single `scope` + optional `session` pair, then launches ccv with a URL deep-link. From ccv's point of view each session comes pre-contextualised — it never needs to represent layers it doesn't know about.

A generic variable-depth layout declaration is on the v2 table; it is **not** in v1. File an issue if the three-tier + entry-point pattern truly can't express your model.

## Two entry points

| Direction | ccv offers |
|---|---|
| **Write** | Set `CCV_EXTERNAL_SESSION` on the producer's environment and launch the target program through ccv's proxy (`ccv run -- <cmd>`). ccv's interceptor writes `session.json` skeleton + captures HTTP traffic into `<sessionDir>/log.jsonl`, and patches `endedAt` on exit. |
| **Read** | `ccv view --roots <path>` — launches a read-only HTTP viewer + UI. No claude wrapper, no PTY, no workspace registration. |

Producers that cannot route traffic through ccv's proxy may write `session.json` + `log.jsonl` themselves by following the schema — the file format is small enough to emit from any language.

## Directory layout

```
<external-root>/                      # user-configured absolute path
  <provider-id>/                      # slug — one per producer
    index.json                        # provider-level metadata
    scopes/
      <scope-id>/                     # slug — business grouping (producer-defined)
        scope.json                    # scope metadata
        sessions/
          <session-id>/               # slug — one CC session
            session.json              # session metadata
            log.jsonl                 # entry log (\n---\n separated)
```

**Slug format**: `^[a-z0-9][a-z0-9_\-\.]{0,63}$` — lowercase, starts with alnum, `.` / `_` / `-` allowed, max 64 chars.

**Rules**:
- Directories not matching slug format are ignored by ccv.
- Any JSON file that's missing or unparseable is treated as absent (ccv falls back to directory-name display).
- `log.jsonl` entries MUST be single-line JSON objects joined by the literal separator `\n---\n`. No pretty-printing. (`\n---\n` is used instead of plain NDJSON because entries may contain literal newlines when the producer captures multi-line API bodies verbatim.)

## Schema

### index.json (provider)

```json
{
  "protocolVersion": 1,
  "providerId": "example-producer",
  "providerName": "Example Producer"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `protocolVersion` | integer | yes | Must equal `1`. Mismatched versions are skipped with a warning. |
| `providerId` | string | yes | Matches the parent directory name. |
| `providerName` | string | no | Human-readable label; falls back to `providerId`. |

### scope.json (business grouping)

```json
{
  "scopeId": "group-001",
  "title": "Scope title",
  "subtitle": "optional extra line"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `scopeId` | string | yes | Matches parent directory name. |
| `title` | string | yes | Displayed in sidebar. |
| `subtitle` | string | no | Shown under title (small text). |

### session.json (one CC session)

```json
{
  "sessionId": "session-20260417-143022",
  "title": "human-readable session title",
  "role": "agent-a",
  "logFile": "log.jsonl",
  "startedAt": "2026-04-17T14:30:22Z",
  "endedAt": null
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionId` | string | yes | Matches parent directory name. |
| `title` | string | yes | Displayed in session list. |
| `role` | string | yes | Free-form producer-chosen label. ccv's UI groups the session list by this value and derives a filter from the distinct values it observes — no particular string is special. |
| `logFile` | string | no | Relative path within `<session-id>/`, must not be absolute, must not contain `..`. Defaults to `"log.jsonl"`. |
| `startedAt` | ISO 8601 | yes | Used for session-list sort (desc). |
| `endedAt` | ISO 8601 / null | yes | `null` means session is live; UI shows a live tag. Writer fills this on exit. |

**Lifecycle invariant**: `session.json` is written **twice** at minimum — once at session start (skeleton with `endedAt: null`), once at end (`endedAt` filled).

**Unknown fields are preserved, not enforced**: ccv ignores keys it does not understand when reading. Producers MAY add their own extension keys (e.g. `myOrg.workItemId`). A future protocol version MAY reserve additional top-level keys — producers SHOULD prefix custom keys with a namespace (`x-` or dotted) to avoid collisions.

**Deferred to v2**: `parentSessionId` (sub-session navigation), `meta[]` (structured metadata cards), variable-depth `layout`, `updatedAt` semantics. Writing these keys in v1 is not forbidden but v1 readers ignore them.

### log.jsonl (entry format)

Each entry records one HTTP exchange with the Claude API. The frontend renders entries based on these fields; producers that don't go through ccv's proxy should populate the same shape.

```json
{
  "timestamp": "2026-04-17T14:30:25.123Z",
  "url": "https://api.anthropic.com/v1/messages",
  "method": "POST",
  "body": {
    "model": "claude-opus-4-7",
    "messages": [{"role": "user", "content": "..."}]
  },
  "response": {
    "status": 200,
    "body": {"content": [{"type": "text", "text": "..."}]}
  }
}
```

| Field | Type | Required | UI use |
|---|---|---|---|
| `timestamp` | ISO 8601 | yes | Sort key, displayed per entry. |
| `url` | string | yes | Displayed. |
| `method` | string | yes | Displayed as tag. |
| `body.model` | string | rec. | Model tag on entry row. |
| `body.messages[]` | array | rec. | `msgs=N` counter + last-message content preview. |
| `response.status` | integer | rec. | Status tag (green on 2xx). |
| `response.body` | any | rec. | Shown in raw JSON expandable panel. |
| `isStream` | bool | no | Renders "stream" tag if true. |
| `inProgress` | bool | no | Renders "..." status if true (for in-flight). |

Additional fields (e.g. `pid`, `mainAgent`, `_deltaFormat`) are used by ccv's native interceptor for local-log features (cache analysis, checkpointing) — external producers can omit them.

## Writer

The producer launches its target program through ccv's proxy — typically `ccv run -- claude ...` — with `CCV_EXTERNAL_SESSION` set on the environment. ccv's HTTP proxy intercepts API traffic and writes it to the protocol-dictated path:

```bash
export CCV_EXTERNAL_SESSION='{
  "sessionDir": "/abs/root/example-producer/scopes/group-001/sessions/session-xyz",
  "sessionId": "session-xyz",
  "role": "agent-a",
  "title": "first attempt"
}'
ccv run -- claude ...
```

Accepted fields: `sessionDir` (required, absolute), `sessionId` (required), `role`, `title`. Other fields are ignored. Producers with richer needs should write `session.json` / `log.jsonl` themselves instead of piping through ccv's writer.

Behaviour: ccv writes the skeleton at proxy start, redirects the captured log to `<sessionDir>/log.jsonl`, and patches `endedAt` on proxy exit (SIGTERM / SIGINT / normal). Log rotation is disabled in this mode — the protocol requires a single `log.jsonl` per session.

The producer is also responsible for `index.json` (per provider, one-shot) and `scope.json` (per scope, one-shot). These are plain JSON fixtures — any language can emit them:

```bash
mkdir -p "$ROOT/my-producer/scopes/group-001"
echo '{"protocolVersion":1,"providerId":"my-producer","providerName":"My Producer"}' \
  > "$ROOT/my-producer/index.json"
echo '{"scopeId":"group-001","title":"Group title"}' \
  > "$ROOT/my-producer/scopes/group-001/scope.json"
```

**Mode precedence**: when both `CCV_EXTERNAL_SESSION` and `CCV_WORKSPACE_MODE=1` are set, external-session mode wins — the caller explicitly dictated the output path.

## Reader: `ccv view`

```bash
ccv view --roots $HOME/.my-producer/ccv-roots,/tmp/dev-roots
```

Only flag: `--roots <paths>` (comma-separated absolute paths; equivalent to `CCV_EXTERNAL_ROOTS=...`). Also accepts the top-level `--no-open` flag to skip auto-opening the browser.

What it does:
- Starts ccv's HTTP server, serves the built frontend, exposes the REST + SSE API below.
- Watches the roots via `fs.watch(..., {recursive: true})` and emits `external:changed` events when scope/session JSON changes.
- Redirects `/` to `/?view=external` automatically (root page shows the external view, not the main CC viewer).

What it does **not** do:
- No claude wrapper, no PTY.
- No workspace registration, no shell hook, no log interception.
- No writes anywhere outside the configured roots.

Compare: `ccv` (no subcommand) is the "wrap claude + log its traffic" entry, which is a different product facet than this protocol. Consumers of the External Sessions Protocol should use `ccv view`.

## Reader: REST API

All endpoints are read-only, local to ccv's HTTP server.

### `GET /api/external/roots`
```json
{
  "roots": [
    {
      "index": 0,
      "path": "/home/user/.my-producer/ccv-roots",
      "providers": [
        {"providerId": "my-producer", "providerName": "My Producer", "protocolVersion": 1}
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
Live-tails the selected session's `log.jsonl`:
- `load_start` — total entry count + `external: true`
- `load_chunk` — historical entries in batches (JSON array)
- `load_end` — history replay finished
- default (unnamed) event — new entries appended after `load_end` (single entry object per event)
- `ping` — keepalive every 30s
- `error` — stream error detail

Returns 400 on bad params, 404 on missing log.

### Global `/events` SSE also emits:
- `external:changed` — any non-`log.jsonl` file under a watched root was created/modified. Clients typically refresh the relevant list.

## Security

- **Path whitelisting**: `provider` / `scope` / `session` query params must match the slug regex. Invalid → 400.
- **Path traversal defense**: `session.json`'s `logFile` must be a relative path within its `sessionDir`. Absolute paths or `..` segments → 404.
- **Root whitelisting**: only roots explicitly in `CCV_EXTERNAL_ROOTS` / `--roots` are scanned. No auto-discovery.
- **No code execution**: ccv reads JSON and appends-only log files. Text fields (titles, roles, subtitles) are rendered as plain text, never as HTML.

## UI

The UI is rendered at `/?view=external` (auto-redirected from `/` under `ccv view`). Three panes:

```
┌─ scope sidebar ─┬─ session list (dynamic role filter) ─┬─ entry timeline ──┐
│ [provider A]    │ [All] [agent-a] [agent-b] ...        │ POST /v1/messages │
│   group-001     │ [agent-a] first attempt [live]       │   model=...       │
│   group-002     │ [agent-b] reviewer                   │   msgs=12         │
│ [provider B]    │                                      │   ... raw JSON    │
│   ...           │                                      │                   │
└─────────────────┴──────────────────────────────────────┴───────────────────┘
```

The role filter is built at runtime from the distinct `role` values observed in the current session list — there are no built-in role categories.

## End-to-end example

A producer (say, a CI runner or agent orchestrator) prepares the provider + scope fixtures once per business grouping, then sets `CCV_EXTERNAL_SESSION` per session and launches its target program through `ccv run`:

```bash
ROOT="$HOME/.my-producer/ccv-roots"
PROVIDER="my-producer"
SCOPE="pr-1234"
SESSION="run-$(date +%Y%m%d-%H%M%S)"

# one-time fixtures
mkdir -p "$ROOT/$PROVIDER/scopes/$SCOPE/sessions/$SESSION"
[ -f "$ROOT/$PROVIDER/index.json" ] || \
  echo '{"protocolVersion":1,"providerId":"'"$PROVIDER"'","providerName":"My Producer"}' \
    > "$ROOT/$PROVIDER/index.json"
[ -f "$ROOT/$PROVIDER/scopes/$SCOPE/scope.json" ] || \
  echo '{"scopeId":"'"$SCOPE"'","title":"PR #1234: fix login flow"}' \
    > "$ROOT/$PROVIDER/scopes/$SCOPE/scope.json"

# launch with proxy-captured logging
export CCV_EXTERNAL_SESSION=$(jq -n \
  --arg dir "$ROOT/$PROVIDER/scopes/$SCOPE/sessions/$SESSION" \
  --arg id "$SESSION" \
  '{sessionDir: $dir, sessionId: $id, role: "worker", title: "first attempt"}')
ccv run -- claude ...
```

View from another shell (can happen during or after the session):

```bash
ccv view --roots "$ROOT"
```

Producers whose `role` taxonomy differs (e.g. a CI runner with `role: "lint"` / `role: "test"`) just vary the string — ccv derives the session-list filter from observed values with no hard-coded vocabulary.

## Producers with richer taxonomies

If your model has more than three layers (e.g. `product / project / task / session`), **do not try to encode all layers into ccv's structure**. Two common temptations that both hurt:

1. Pack your full hierarchy into the `scope-id` string (e.g. `project-foo.task-42`) and hope users make sense of a flat scope list. The extra structure is invisible to ccv's UI filtering.
2. Create one `providerId` per upper-level bucket (e.g. `myprod-project-foo`, `myprod-project-bar`). Provider fixtures multiply; ccv shows them as peers of your competitors' provider blocks, cluttering the sidebar.

The right shape is **entry-point design**: own the navigation on your side, use ccv only as a single-scope viewer.

### The pattern

Your tool exposes commands like `myprod session view <ref>` or `myprod group view <ref>`. Each such command:

1. Resolves `<ref>` against your internal model (including any `product / project / …` layers ccv doesn't care about).
2. Picks one target scope (and optionally one target session).
3. Launches ccv with a URL that goes directly to that scope / session:

```bash
# Pseudocode for `myprod wi view 150` inside your CLI
SCOPE_ID=$(resolve_scope_for_wi 150)   # e.g. "project-foo.task-150" or just "task-150"
SESSION_ID=$(latest_session_for_wi 150)
ccv view --roots "$HOME/.myprod/ccv-roots" --no-open &
ccv_pid=$!
ccv_port=$(wait_for_port "$ccv_pid")
open "http://127.0.0.1:$ccv_port/?view=external&root=0&provider=myprod&scope=$SCOPE_ID&session=$SESSION_ID"
```

ccv's URL-parameter support (`root`, `provider`, `scope`, `session`) is the load-bearing interface for this integration — it accepts a fully-qualified address into its three-tier space. Your producer owns everything above that address space.

### Why this works

- ccv UI doesn't need to represent the layers above `scope` — the producer already resolved them before opening the viewer.
- Each invocation arrives pre-contextualised; the user isn't dropped into "all your data" and forced to navigate down.
- Multiple concurrent `myprod wi view` calls just open distinct deep-links; no cross-pollution, no assumption about which scope is "current".
- If the user wants to browse across scopes, they can click sibling scopes in the sidebar — but that's a secondary UX, not the primary path.

### What you give up

The user cannot use raw `ccv view --roots <path>` to discover your full content tree — they must enter through your tool's commands. If your product genuinely needs "browse everything from ccv alone" as a primary UX, this v1 protocol isn't the right fit; open an issue describing the use case.

## Scale

v1 targets single-digit roots, dozens of providers per root, hundreds of scopes per provider. Directory scans use synchronous IO; very large trees (thousands of sessions per scope) may cause UI latency. On Linux, `fs.watch({recursive: true})` consumes inotify watches — adjust `fs.inotify.max_user_watches` for large trees.

## Versioning

- `protocolVersion: 1` is frozen. Any breaking schema change bumps to `2`.
- Additive fields (new optional keys) may appear in minor ccv releases; producers should ignore unknown keys.
- If a new ccv reads `protocolVersion: 2` from a future producer, it skips with a warning and keeps functioning on v1 roots.
- Reserved for v2: `parentSessionId`, `meta[]`, variable-depth `layout`, `updatedAt` semantics.

## Reference files in ccv source

- Writer: `lib/external-session-writer.js`
- Reader: `lib/external-sessions.js`
- Server routes + view-only mode: `server.js`
- CLI entry: `cli.js` (`view` subcommand)
- Frontend: `src/components/external/ExternalSessionsView.jsx`
- Tests: `test/external-session-writer.test.js`, `test/external-sessions.test.js`, `test/external-live-tail.test.js`, `test/e2e-external.sh`
