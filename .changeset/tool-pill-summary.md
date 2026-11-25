---
"cc-viewer": patch
---

feat(web): collapsed tool pills now carry a one-line call summary (`Bash: Run sudo true to refresh sudo credentials`) from a per-tool summary registry (apps/web/src/utils/toolSummary.js); the "Tools used:" prefix label and its `ui.toolsUsed` key are removed. Pills stack one per line and the summary renders one shade fainter than the tool name in both themes. In merged minimal-chat runs, each turn's "Thinking" collapse label now also carries that turn's own time (same formatTime as the pill popover) so consecutive turns are distinguishable.
