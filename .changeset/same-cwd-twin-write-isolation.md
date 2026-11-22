---
"cc-viewer": patch
---

fix(server): same-cwd twin session isolation (write side) — when a second claude instance is spawned in the current directory (file-explorer "New Workspace (Session)" forceNew), the shared single server no longer cross-wires the two instances' logs. In-terminal /resume switches are now armed and consumed per-instance (the SessionStart hook carries the spawning PTY's instanceKey via env); metadata-less requests (heartbeat/countTokens) route per-instance instead of to the process-global last-spoke session; a same-project forceNew relaunch keeps the live twin's session bindings and owner.lock claims instead of releasing them; and resuming a conversation that a different LIVE same-cwd instance is actively writing is refused with 409 `session-owned` instead of letting two claude processes share one journal.
