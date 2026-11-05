---
"cc-viewer": patch
---

fix(web): keep pasted composer images across incoming chat updates

`ChatView.componentDidUpdate` cleared `pendingImages` on every `mainAgentSessions` reference change, but the merge returns a fresh outer array on every streaming tick — so a pasted image was wiped as soon as the next request arrived. The clear now runs only when the session-list identity actually changes (stable per-session ids compared by value, so same-conversation rebuilds like in-place tail replacement, cold-load replays, and shard prepends keep attachments), plus on real view/workspace switches.
