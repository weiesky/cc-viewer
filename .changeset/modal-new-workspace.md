---
"cc-viewer": patch
---

feat(web): the in-app file browser modal (FileBrowserModal) folder menus also offer "New Workspace (Session)" — tree rows, grid cells, and the blank-area container launch a workspace rooted at the right-clicked folder, same as the sidebar explorer. A successful in-place launch closes the modal (Electron's new-tab launch leaves it open on the untouched tab).
