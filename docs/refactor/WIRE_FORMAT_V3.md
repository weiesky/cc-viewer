# Wire Format v3 — metadata rows + native chat wire (server→client)

Status: **default ON since V3.S6** (escape hatch `CCV_WIRE_V3=0`). Applies to
v2 session sources on `/events` only; v1 legacy FILES always use the legacy
full-entry pipeline (permanent escape hatch, unrelated to the flag).

Motivation (measured, 68MB/3830-request real session): the legacy wire
re-synthesized full v1-shape entries — cold load 176.8MB plaintext per tab,
live channel re-broadcast the full accumulated history twice per mainAgent
turn (3.7GB per client per session). v3 sends journal-fold metadata rows +
the raw stored conv/responses lines; the client rebuilds entries locally.
Cold plaintext ÷4.2 (42.5MB), live per-turn = delta-sized, client JSON parse
÷4.2. Under brotli (axis B) both wires converge near the same entropy floor
(~8-9MB cold), so v3's wins are the remote-plaintext path, client parse, and
the live channel structure — not localhost br bytes.

## 1. Flag & negotiation

- `CCV_WIRE_V3` read ONCE at server startup into `deps.wireV3`
  (server/server.js); `V2LiveFeed` receives it as a constructor param.
- Client learns it from the `server_config` SSE frame (`wireV3: bool`),
  stored synchronously as `this._wireV3` (AppBase) — the frame precedes
  `clients.push(res)`, so every connection knows before any data frame.
- All new frames ride the axis-B compression seam automatically
  (`sseWrite`/`sendEventToClients`); never hand-roll `res.write` for them.

## 2. Frames (flagged cold load, in wire order)

1. `load_start` — `{total, incremental, v3Bytes, hasMore?, oldestTs?}`
   (total = rows window count; `v3Bytes` = exact sum of the upcoming v3 frame
   payload lengths in UTF-16 code units — the client's byte meter counts
   `event.data.length` on the same unit, so received/total is exact).
2. `v2_requests` — `{rows, totalCount, hasMore, oldestTs}`. Row schema
   (journal fold; `server/lib/v2/meta-rows.js`):
   `{seq, sessionId, timestamp, url, method, conv?, evt?, kind, mainAgent,
   teammate?, model?, proxyUrl?, proxyRole?, status?, duration?, usage?, inProgress,
   typeTag, cacheLoss}` — top-level `timestamp`/`url` keep the since-cursor
   and `timestamp|url` dedup identities; `usage` is mapped to the client
   shape (`input_tokens`…); `typeTag {type, subType}` is computed with the
   client's own `classifyRequest` (shared module, extensioned imports);
   `cacheLoss {reason, reasons}` from the bounded Pass B.
3. `v3_conv` — `{sessionId, channel, lines:[...]}` raw conv-store lines
   (`snapshot|append|ctl`) from the channel's LAST snapshot at-or-before the
   window's oldest seq (the assembler's replay baseline).
4. `v3_resp` — `{sessionId, lines:[...]}` raw responses lines for exactly
   the window member seqs.
5. `load_end` — the client assembler materializes the window here.

Legacy `load_chunk` frames are NOT sent for flagged v2 sources. An
incremental reconnect (`?since=` present) sends a since-scoped delta window
(the `v2_requests` frame carries `incremental:true` and the client UPSERTS
instead of resetting); a full cold frame (reset) also resets the client's
assembler / live-dedup state. Live: `v2_requests_delta` (one row per emitted
item; a correction re-sends the row when the NEXT request changes its
Preflight/Plan classification), plus single-line `v3_conv`/`v3_resp` frames;
the full-entry `data:` broadcast is suppressed (kv_cache_content /
context_window side events unchanged — cold values rebuild from the newest
≤3 completed mainAgent rows, mirroring the legacy scan-ring fallback depth).
Live rows MUST carry the SAME journal-truth fields as cold fold rows —
`conv`/`evt` (the assembler inputs: `buildEntry` is `if (row.conv)`-gated,
a conv-less row rebuilds with empty messages), `kind`, and kind-derived
`mainAgent` (`kind==='main' && !leader`, never body re-derivation — a
countTokens probe wears the main body shape). Threaded from the journal req
line via the synthesizer item (adapter `_emit`) into live-feed `_rowFrom`;
pinned by the live/cold row-parity tests in `test/v2-live-feed.test.js`
(2026-07-16 live chat-render regression fix).
`server_config` additionally carries `build` (server version): a tab whose
bundle predates a server upgrade reloads itself on reconnect mismatch.

## 3. On-demand detail — `GET /api/v2-entry`

`?file=v2:<project>/<dirToken>&seq=N[&sid=<uuid>]` → `{entry, prevMain}`.
`dirToken` may be the dir basename or the bare session UUID (resolved via
`resolveSessionDirName` BEFORE `validateLogPath`); `sid` disambiguates
teammate rows (the fold runs over the leader dir). Mid-session main deltas
are promoted to full replayed state (per-member checkpoint mode in
`materializeV2Window`); `prevMain` is the preceding mainAgent entry (Body
Diff / Context tab). Compressed via `sseHead({flush:false})`. Unknown seq /
rename races → 404; the client surfaces an error state with a Retry action.

## 4. Client assembler (`src/utils/v3Assembler.js`)

Replays conv lines per `(sessionId, channel)` (snapshot → reset, append →
concat, ctl replace-tail → swap last; ctl compact is a state no-op) and
builds v1-shape entries in the shape the legacy live wire delivered AFTER
server-side reconstruction: full accumulated `body.messages` (shared refs),
`_seq`/`_seqEpoch("v2:<uuid>")`/`_totalMessageCount`, `_isCheckpoint` on
snapshot rows, placeholder entries for `inProgress` rows, `response.body`
from the responses line. **No `body.tools`/`body.system`** — rows carry
classification, the detail view fetches full bodies. Entries feed the
EXISTING ingest (`_ingestLiveEntry` seam / `_chunkedEntries` at load_end):
merge guards, ChatView, team modal, tool-result maps keep exact semantics
(oracle: `test/v3-assembler.test.js` asserts field parity vs the legacy
client-reconstructed stream). The request list renders adapted rows
(`_listSource()`); deep consumers read the assembled entries
(`deepRequests`).

## 5. Deliberate divergences (test-pinned)

- Row membership = journal fold (superset: conv-gapped crash-orphans get a
  row; their detail fetch 404s gracefully).
- `mainAgent` is kind-derived (`kind==='main' && !meta.leader`) — the
  mainAgentRing semantics; "main-looking" sub bodies are no longer
  mis-tagged.
- cacheLoss `ttl` actually fires (legacy client computed the gap as
  string-minus-string NaN).
- Live rows' `typeTag` may arrive null then be corrected (lookahead).

## 6. Retained surfaces (NOT flagged)

- `/api/local-log` (log-viewer modal + IM conversation modal) still serves
  v1-shape adapter output — windowed, on-demand, low-volume.
- Downloads / workspace previews / `ccv verify` / converter: v1-shape
  adapter output, byte-true invariant untouched (v3 never reaches into the
  adapter's emit shape; `readV2SingleEntry` composes existing machinery).
- `src/utils/entry-slim.js` is RETAINED (v1 legacy files + flag-off wire
  still deliver self-contained entries); on the v3 path it is naturally idle
  (assembled entries carry no tools/system). The original S6 "retire
  entry-slim" item is superseded by the option-B assembler architecture.

## 7. Backlog

- Cold conv window: synthesize a snapshot at the window start server-side
  (today: replay from the last stored snapshot, which can drag a long tail).
- `/api/v2-search` (server-side streaming search over `iterateV2Items`,
  discipline like `verify.js`): interface reserved, NOT in this cycle.
- Remove the legacy full-entry live UI path once the `CCV_WIRE_V3=0` escape
  hatch has survived a release cycle unused.

Cross-refs: `docs/refactor/WIRE_FORMAT_V2.md` (storage), `docs/WIRE_FORMAT.md`
(v1 wire + §3.7 double-layer invariant — still governs the legacy channel).
