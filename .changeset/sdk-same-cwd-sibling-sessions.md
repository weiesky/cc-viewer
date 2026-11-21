---
"cc-viewer": patch
---

feat(server): SDK mode — "New Workspace (Session)" on the current root is now a same-cwd SIBLING (workspace +1), not a replacement.

The SDK session registry is re-keyed from cwd to instanceKey, so one cwd can host several concurrent Sessions. A forceNew launch appends a fresh random-keyed generation and leaves the existing session(s) alive — its resident query, conversation, and instanceKey are untouched — and the two surface as two switchable header tabs (`项目 [1] [2]`). A plain (non-forceNew) launch reuses/activates the cwd's stable primary (active → deterministic boot), never spawning a sibling.

Isolation & safety: the launch no longer retires the surviving sibling's writer routing (that moved to the explicit close path — a random fresh key is retired, a deterministic boot key is only released so a relaunch can re-create it); the resume twin-ownership guard now sees SDK liveness (not just PTYs), tracks each conversation's ACTIVE owner (an in-memory uuid→instance registry + the writer's per-instance current-sid pointer), resolves a bare caller when the project has a single live instance, refuses ambiguous/other-owned same-cwd resumes (409), and reserves an in-flight uuid against concurrent double-resume; closing a session no longer reaps a surviving same-cwd sibling's scope/scratch state; the SDK +1 path skips the project-level writer reset that would have drained the surviving sibling's in-flight buckets; and the +1's workspace_started is tagged `sibling:true` with no global empty reload, so a non-launching client keeps viewing the live sibling. A same-cwd-ambiguous cwd/project ACTION anchor (send/Stop) falls back to the cwd's primary instead of dropping the message (Mobile/bound-view parity). `currentInstanceKey` for the bound tab is the stable primary (deterministic boot key), not the shared active pointer.

Coverage: `sdk-multi-session-route.test.js` (new), `sdk-force-new.test.js` (rewritten for the sibling semantics + cwd-anchor ambiguity/primary-fallback + close retire/release), `v2-retire-instance.test.js` (+ `releaseInstance`), `resume-route.test.js`, `live-processes-close.test.js`, `sdk-session-registry.test.js`.
