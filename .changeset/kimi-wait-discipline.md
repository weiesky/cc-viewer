---
"cc-viewer": patch
---

fix(system-prompt): add a "Waiting on background agents" section to the Kimi K3 and Kimi K2.7 Code presets — verify teammate status via the `subagents/agent-*.jsonl` second source before waiting, read results back with `tail + jq` instead of a full Read, and cap idle waiting (change strategy after 2 empty rounds, escalate after ~10 minutes).
