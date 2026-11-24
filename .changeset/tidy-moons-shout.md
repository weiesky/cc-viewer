---
"cc-viewer": patch
---

feat(web): keep the restart-and-update wait visible with a full-screen overlay. After the user confirms "Restart and update", the service is unreachable while the detached helper installs the new version and re-listens — the page used to look alive but hang, with only a small line inside a closable modal. A fixed overlay now sets the expectation up front (restart takes about 2 minutes, the page refreshes automatically), swaps to a "still waiting (up to ~15 minutes)" line once the restart outlives that window, and the UpdateModal can no longer be dismissed mid-restart (mask click, Esc and the close button are all disabled). The restart confirm no longer stays mounted on top of the overlay: its onOk no longer awaits the restart. Readiness is still detected by the existing `/api/version-info` processId poll, so no new server endpoint is needed.
