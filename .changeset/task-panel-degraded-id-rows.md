---
"cc-viewer": patch
---

fix(web+server): task panel no longer shows bare `#id` rows for label-less entries

In SDK mode the HUD checklist could render rows labelled only with the raw task id even though a description was available on hover. Server `getSdkTaskSnapshot` and client `sdkTaskTracker.applySnapshot` / `restoreFromStorage` now share a predicate (`@ccv/core/sdk-task-label`) that filters out terminal entries with no displayable label (`description`/`summary` empty after trim). `TaskProgressHud`'s label and current-task fallback chain is extended to `subject || description || #taskId`, so summary-bearing entries surface their text instead of a bare id. PTY-mode stub rows are deliberately kept (a live placeholder while the next TaskUpdate lands) — the filter stays SDK-scoped.

Also fixes two server-side fold bugs in the sdk-task table: (1) the LRU `delete` ran before the `get`, so `_foldSdkTask` always received `prev=undefined` and any status-only `task_updated` patch would silently replace the entry and wipe the started frame's description; (2) a `task_started` re-fire for a reused taskId now resets run-scoped state (status/summary/usage/endTime), matching the client tracker's reset semantics so a reconnect replay does not clobber the live in_progress row back to the previous run's terminal state.

Coverage: `sdk-task-table.test.js`, `sdkTaskTracker.test.js`, `sdkTaskTracker-persist.test.js`, `task-progress-hud.test.js`, `sdk-task-label.test.js`.
