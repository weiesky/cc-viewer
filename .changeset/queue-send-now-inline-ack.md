---
"cc-viewer": patch
---

Move the queue send-now "追加中…" chip inline after the user-bubble timestamp and clear the optimistic placeholder as soon as the dispatch leaves the server queue (plus a bounded 30s sweep), fixing placeholders that stuck until refresh in pinned/attached views.
