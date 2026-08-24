---
"cc-viewer": patch
---

Rename the Context tab's per-exchange "Turn N" concept to "Step N" — a complete session is one turn, and each user→assistant loop iteration inside it is a step. Covers the history-list and current-item labels plus the detail-panel chip (`Turn 22` → `Step 22`), the `ui.context.currentTurn`/`historyTurnNoTime` i18n keys (now `ui.context.currentStep`/`historyStepNoTime`, re-translated ×18 locales), and the ToolsFirst concept doc's cache-prefix diagram (×18 locales). Turn-end (Stop hook) naming is unchanged — it marks the end of the whole turn.
