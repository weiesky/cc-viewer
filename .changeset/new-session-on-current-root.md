---
"cc-viewer": patch
---

feat(web): right-clicking the current project root in the file explorer's "New Workspace (Session)" now starts a brand-new session instance in that directory — a fresh claude process with no `-c`, so the two processes never share a conversation — and the view pins to the new instance. Other folders keep the picker semantics (reuse-or-spawn, `-c` iff logs exist). Electron multi-tab opens a second tab on the same directory; SDK mode falls back to the normal activate-or-register launch.
