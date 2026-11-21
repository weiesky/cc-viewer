---
"cc-viewer": patch
---

fix(server+web): "New Workspace (Session)" on the current project root now switches the chat view to the new instance's EMPTY session — in BOTH PTY and SDK mode.

PTY: the forceNew-spawned PTY record carries a `freshLaunch` mark; `/events?project&instance` suppresses the same-cwd cold-load fallback for it (`latestMainSession` `suppressFallback`) until the instance binds its own session, so the old twin's conversation is never served — a live fresh instance takes the existing empty-view contract (`load_start{empty:true}`, live feed streams the first turn in place). The client blanks the visible conversation when pinning (`handleActivateChip(..., { blankView:true })`, after the view-cache snapshot).

SDK: the cwd gets a fresh sibling generation with a NEW random instanceKey (see the sibling-sessions changeset), marked `freshLaunch` and projected through `listSdkSessions`, so the same `suppressFallback`/empty-view path applies. The mark lifts when the new generation binds its first session (writer main-turn `_onSessionResolved` → `clearSdkFreshLaunch`) or on `/resume` (switchToSession). Reused/restarted instances and header chip clicks keep today's fallback behavior.
