# CCV External Sessions Protocol v1

**Status**: Stable (v1 as of ccv 1.6.158)
**Scope**: Defines how external tools (agent orchestrators, CI runners, custom launchers, etc.) record CC session logs into a directory layout that ccv can browse and live-tail.

This is a **data protocol**, not a code protocol. ccv has zero knowledge of any particular producer. ccv reads what's on disk; producers write what the schema says. The schema intentionally avoids any domain-specific vocabulary — values like `role` are free-form strings the producer chooses, and ccv renders them without interpretation.

## Shape assumption (be honest about this)

This protocol assumes a **three-tier taxonomy**: `producer / group / session`. Producers whose natural model fits this shape (one producer → several business groupings → each grouping has multiple CC sessions) can adopt v1 directly. Producers with two-tier (flat: producer → sessions) or deeper (producer → workspace → work-item → claim → session) models will have to either collapse or pad to three tiers to use v1. A layout-declaration mechanism for variable depth is on the v2 table; it is **not** in v1.

If three tiers don't fit your product, file an issue before adopting.

## Two entry points

| Direction | ccv offers |
|---|---|
| **Write** | (1) **Programmatic API** — `import { createSession } from 'cc-viewer/external'` — append entries directly from your Node process. (2) **Env-driven** — set `CCV_EXTERNAL_SESSION` and launch claude via `ccv run -- claude ...`; ccv's proxy captures HTTP traffic and writes the protocol files. |
| **Read** | `ccv view --roots <path>` — launches a read-only HTTP viewer + UI. No claude wrapper, no PTY, no workspace registration. |

Both sides are independent. Producers may use either writer path (or write files themselves following the schema) and the reader side works on any producer's output.

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

## Writer: programmatic API (recommended)

For producers running inside Node and not using claude's CLI. Install `cc-viewer` as a dependency and import:

```js
import { createSession } from 'cc-viewer/external';

const s = createSession({
  sessionDir: '/abs/path/.../sessions/session-xyz',
  sessionId: 'session-xyz',
  role: 'agent-a',            // optional, free-form
  title: 'first attempt',     // optional
});

// Every HTTP exchange:
s.appendEntry({
  timestamp: new Date().toISOString(),
  url: 'https://api.anthropic.com/v1/messages',
  method: 'POST',
  body: {...},
  response: {status: 200, body: {...}},
});

// On session exit:
s.markEnded();
```

Guarantees:
- `mkdir -p <sessionDir>` on first call.
- If `session.json` already exists, it is **not** overwritten (safe for session resume; original `startedAt` preserved).
- `appendEntry` serializes with `JSON.stringify` (single-line) and appends `\n---\n`.
- `markEnded` is idempotent.

The producer is responsible for `scope.json` and `index.json` — those are fixtures at the directory level, not per-session:

```js
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('/abs/.../my-producer/scopes/group-001', {recursive: true});
writeFileSync('/abs/.../my-producer/index.json',
  JSON.stringify({protocolVersion: 1, providerId: 'my-producer', providerName: 'My Producer'}));
writeFileSync('/abs/.../my-producer/scopes/group-001/scope.json',
  JSON.stringify({scopeId: 'group-001', title: 'Group title'}));
```

## Writer: env-driven (for ccv-proxied claude launches)

When the producer launches claude via `ccv run -- claude ...` (so ccv's HTTP proxy captures API traffic), set `CCV_EXTERNAL_SESSION` on the environment:

```bash
export CCV_EXTERNAL_SESSION='{
  "sessionDir": "/abs/root/example-producer/scopes/group-001/sessions/session-xyz",
  "sessionId": "session-xyz",
  "role": "agent-a",
  "title": "first attempt"
}'
ccv run -- claude ...
```

Accepted fields: `sessionDir` (required, absolute), `sessionId` (required), `role`, `title`. Other fields are ignored — switch to the programmatic API if you need richer control.

Behaviour: ccv writes the skeleton at proxy start, redirects the captured log to `<sessionDir>/log.jsonl`, and patches `endedAt` on proxy exit (SIGTERM / SIGINT / normal).

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

## Examples

**Example 1 — agent orchestrator using programmatic writer**

```js
// producer.js (a lia-like orchestrator)
import { createSession } from 'cc-viewer/external';
import { writeFileSync, mkdirSync } from 'node:fs';

const root = `${process.env.HOME}/.my-orch/ccv-roots`;
const providerId = 'my-orch';
const scopeId = 'task-42';
const sessionId = `worker-${Date.now()}`;

// one-time provider + scope fixtures
mkdirSync(`${root}/${providerId}/scopes/${scopeId}`, {recursive: true});
writeFileSync(`${root}/${providerId}/index.json`,
  JSON.stringify({protocolVersion: 1, providerId, providerName: 'My Orchestrator'}));
writeFileSync(`${root}/${providerId}/scopes/${scopeId}/scope.json`,
  JSON.stringify({scopeId, title: 'Implement feature X'}));

const s = createSession({
  sessionDir: `${root}/${providerId}/scopes/${scopeId}/sessions/${sessionId}`,
  sessionId, role: 'worker', title: 'first attempt',
});

// each API call your agent makes:
s.appendEntry({timestamp: new Date().toISOString(), url, method: 'POST', body, response});

// on shutdown:
s.markEnded();
```

View from another shell:

```bash
ccv view --roots "$HOME/.my-orch/ccv-roots"
```

**Example 2 — CI runner using env + ccv proxy**

```bash
ROOT="$HOME/.ci-runs/ccv"
mkdir -p "$ROOT/ci-runner/scopes/pr-1234/sessions/run-78901"
echo '{"protocolVersion":1,"providerId":"ci-runner","providerName":"CI Runner"}' > "$ROOT/ci-runner/index.json"
echo '{"scopeId":"pr-1234","title":"PR #1234: fix login flow"}' > "$ROOT/ci-runner/scopes/pr-1234/scope.json"

export CCV_EXTERNAL_SESSION=$(jq -n --arg dir "$ROOT/ci-runner/scopes/pr-1234/sessions/run-78901" \
  '{sessionDir: $dir, sessionId: "run-78901", role: "lint", title: "lint stage"}')
ccv run -- claude ...
```

Same protocol — different vocabulary. ccv renders both without modification.

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
