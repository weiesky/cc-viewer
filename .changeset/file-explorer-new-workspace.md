---
"cc-viewer": patch
---

feat(web): add "New Workspace (Session)" to the file explorer's folder context menu — launches a workspace rooted at the right-clicked folder directly, with the workspace-picker launch semantics (`-c` auto-continue when the folder already has logs; Electron multi-tab opens a new tab via IPC, leaving the current tab untouched).
