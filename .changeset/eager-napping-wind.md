---
"cc-viewer": patch
---

fix(server+web): unblock the in-app update flow when another cc-viewer instance is running. The `another_instance` hard error is replaced with a warning plus a "Continue anyway" danger button that asks for confirmation and then posts `/api/update/start` with `{ force: true }`, which bypasses the multi-instance port probe on the server. The new copy makes it explicit that continuing will restart the service and disconnect the current session and all other instances.
