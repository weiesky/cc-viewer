---
"cc-viewer": patch
---

feat(web): show the current branch name at the top of the Git Changes panel (per-repo chip in multi-repo view). Explicit detached HEAD gets a fallback label; unknown states (old server, failed request) render no chip instead of a misleading label.
