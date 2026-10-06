---
"cc-viewer": patch
---

fix(multi-project): the bound project's tab now highlights instantly and correctly — viewing is computed client-side (via a new `currentInstanceKey` from /api/live-processes + a pure `resolveBoundInstance` tiebreak) instead of the shared, poll-lagged server `active` pointer. This removes both the "bound tab never lights" bug and the click→highlight delay, and works across multiple clients. Coverage: `resume-sessions-map.test.js`, `resume-route.test.js`.
