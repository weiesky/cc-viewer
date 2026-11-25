---
"cc-viewer": patch
---

fix(server): reconcile seed-origin per-session proxy bindings with the owning workspace's live active profile and role assignments. Previously a session's proxy binding was a one-shot snapshot taken at register/attach time and never revisited, so hot-switching a workspace's active profile left already-seeded sessions on the stale choice, and a session seeded before the workspace config existed stayed pinned to the 'max' fallback forever. Bindings now carry an `origin` provenance ('seed' vs explicit 'user'), and seed-origin bindings also record their owning workspace so a later change can re-align them; `_loadProxyProfile` re-aligns only seed-origin bindings of the current workspace on every successful load (covering both the explicit switch route and the watchFile path). Explicit session-scope choices are never overwritten; the 'max'-never-falls-back routing semantics are unchanged.
