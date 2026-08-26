---
"cc-viewer": patch
---

fix(git): the Git changes panel now shows local commits on branches without an upstream — previously `getUnpushedCommits` returned an empty list whenever `@{upstream}` failed to resolve (local-only branches never pushed with `-u`, deleted remote branches, repos without any remote, detached HEAD) and the frontend hid the whole "unpushed commits" section on `hasUpstream: false`, making those commits invisible. The server now falls back to `git log HEAD --not --remotes` (commits on HEAD absent from all remote-tracking refs, capped at 100 with the truncated badge), the panel's unpushed section renders whenever commits exist, and its header tooltip explains the no-upstream case (new i18n key ×18 locales).
