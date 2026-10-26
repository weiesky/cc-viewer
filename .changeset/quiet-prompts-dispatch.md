---
"cc-viewer": patch
---

Restore mid-task user prompts in conversation without changing model packets, keep queue snapshots scoped to the viewed session, and disable queue actions while messages are being dispatched. Preserve SDK follow-up prompts appended to existing message blocks and recover text sharing a block with an interrupt marker. Show send-now prompts immediately in the conversation and reconcile them with the real transcript. Render SDK content-block prompts safely without duplicating incremental bubbles, terminate dead PTY queue targets without blocking other sessions, and bound SDK dispatch retries.
