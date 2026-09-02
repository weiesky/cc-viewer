---
"cc-viewer": patch
---

feat(chat): new "Minimal conversation" preference (default on; stored `false` is respected, only fresh installs default on) merges an agent's consecutive tool-only turns into one bubble — appended system prompts fold into a grey Claude icon with a hover popover, tool pills show their own call time on hover, thinking stays a row inside the bubble; text turns and full-display tools (Edit / Write / plan / AskUserQuestion / Agent / TaskCreate / SendMessage / Workflow) keep their own bubbles. Applies per agent (main, each sub-agent, each teammate) and only while "Show full tool content" is off.
