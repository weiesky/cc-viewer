---
"cc-viewer": patch
---

feat(web): the mobile hamburger menu's "New workspace" entry becomes "Workspace manager", opening a two-section modal — a switch section listing the live workspaces (polled from `/api/live-processes`, incl. a synthesized bound-project row so there is always a way back) that reuses the desktop tab semantics (bound row detaches, other rows activate), and a create section handing off to the shared NewProjectModal. The mobile header project label now follows the viewed project after a switch, and the context-bar percent resets on a view switch instead of backfilling the departed project's value.
