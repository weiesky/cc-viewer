---
"cc-viewer": patch
---

feat(web): same-name project tabs/chips now disambiguate as `name [1]` / `name [2]` (cwd-lexicographic, respawn-stable), with the ordinal rendered as a non-shrinking span so a long name's ellipsis can't clip it, and the tab hover tooltip showing each project's full directory. Also fixes two same-basename tabs lighting up at once when no parallel view is attached — the bound tab is singled out by its instanceKey (the server's attached PTY), leaving the switching path untouched. Coverage: `resume-sessions-map.test.js`.
