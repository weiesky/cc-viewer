---
"cc-viewer": patch
---

Add read-only folder browsing from CLAUDE.md details and directory-backed skills. Harden the new endpoint behind admin + same-origin checks, cap navigation depth and entries per directory, scope skill toggle/delete to the viewed project, and route errno failures to proper 4xx statuses.
