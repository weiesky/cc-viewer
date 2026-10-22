---
"cc-viewer": patch
---

fix(sdk): render turn/query failures as persistent, count-merged rows in the dialogue tail (not just a toast), and scope query-error frames by cwd/sessionId/instanceKey so multi-workspace errors no longer leak across views.
