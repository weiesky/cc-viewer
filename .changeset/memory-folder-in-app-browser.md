---
"cc-viewer": patch
---

feat(web+server): open the persistent-memory folder in the in-app file browser. The folder icon next to "Persistent memory" now opens the project's memory directory in the built-in FileBrowserModal (rooted at the memory dir itself) instead of the OS file manager, so it works for remote/headless servers. The directory is auto-created on first open, mirroring the previous behavior.
