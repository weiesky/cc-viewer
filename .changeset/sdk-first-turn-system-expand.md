---
"cc-viewer": patch
---

fix(sdk): expand all system segments in the request JSON view on first-turn MainAgent requests, and add an SDK-mode placeholder notice in the Context tab

- `DetailPanel`'s JSON view now auto-expands the full `system` array (every segment) for first-turn MainAgent requests, instead of only expanding `system[2]` on Preflight requests. This makes the SDK base prompt visible in SDK mode and keeps CLI behavior consistent.
- The Context tab system-prompt section now shows a placeholder notice in SDK mode explaining that the full system prompt is unavailable (only a condensed 2-segment capture) and recommending TUI mode for the complete prompt.
