---
"cc-viewer": patch
---

Reorganize the flat `server/lib/` namespace into semantic subdirectories (batch 1): `lib/im/` (IM bridge, config, lock, skills, process manager, dingtalk shims — 12 files), `lib/ask/` (AskUserQuestion store/reaper/constants + ask/perm hook bridges — 5 files), `lib/proxy/` (retry engine, stats, env, errors — 4 files). Pure `git mv` + specifier updates; no behavior change. Users' `~/.claude/settings.json` hook entries pointing at the old `server/lib/ask-bridge.js` / `perm-bridge.js` paths are rewritten automatically by ensure-hooks' stale-path healing on the next `ccv` launch (the hook command's `|| true` guard degrades silently to the TUI path in between — never a crash). The `GlobalSettings.md` hook-configuration docs (×18 locales) were updated to the new bridge paths.
