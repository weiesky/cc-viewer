---
"cc-viewer": patch
---

fix(server): same-cwd SDK twin [对话] panel no longer cross-talks during the bound-view hydration window.

A bound-project client's `/ws/terminal` connection stamps `_ccvViewInstance` from `?instance=`, which is empty until the header's first `/api/live-processes` poll resolves `boundInstance` — during that cold-mount window the broadcast filter's "exclude only the differently-stamped" rule delivered BOTH same-cwd twins' frames (modal/queue/spinner/system rows) to the bound view. The bound identity is a deterministic function of the cwd, so the server now coheres the stamp at attach/connect time to the bound cwd's primary instanceKey (`_cohereAttachInstance`, applied at the initial upgrade and all three attach re-stamp sites) instead of waiting for the client to hydrate. Narrowing-only: an explicit instanceKey is never overridden, a non-bound project is untouched, PTY mode is unchanged (isSdkMode gate), and a single-instance cwd resolves to its only session (no twin frames exist to drop). Adds `sdk-manager.resolveBoundPrimaryInstanceKey` (deterministic-boot-first, NOT the active sibling) registered from cli.js as `setSdkResolveBoundInstanceKey`. Coverage: `ws-instance-isolation.test.js` (+ resolver unit cases, + `_cohereAttachInstance` gating cases, + cohered-stamp narrowing end-to-end).
