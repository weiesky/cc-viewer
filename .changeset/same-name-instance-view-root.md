---
"cc-viewer": patch
---

fix(multi-project): project-scoped READ routes (file tree / file content / git / skills / memory / claude-md / expert / search) no longer return HTTP 400 "ambiguous project name" when two same-basename projects run at once. The frontend now sends the per-instance `instanceKey` (`?instance=` / body `instance`), and the server's view-root resolves it to the exact project directory (falling back to name-based resolution for a stale/unknown key). Stats endpoints are unchanged (two same-name projects share one stats file). Coverage: `view-root.test.js`, `view-routes-project-r4.test.js`, `api-url-gap.test.js`.
