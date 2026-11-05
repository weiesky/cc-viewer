---
"cc-viewer": patch
---

fix(logs): auto-shard oversized session logs by prompt count + manual per-shard "load earlier history"

Once a session's main conversation passes 2000 user prompts, the writer archives the current content into the session's OWN `parts/<N>/` subdir at a quiescent request boundary (no in-flight request, idle write queue) — cutting at a whole user-prompt→loop boundary so every part holds complete turns — and a fresh skeleton keeps writing at the root (journal seq stays continuous; meta identity/leader/cwd carried over). The session stays ONE folder: copy/download/delete carry all of its history. Cold load / startup now read only the latest shard; older shards load on demand via a top "load earlier history" button that walks a seq cursor across shards and prepends them. Fixes the 653MB-log startup freeze (the cold-load replay parsed the whole dir into memory and stalled the event loop). Deleting a session carries its whole history.
