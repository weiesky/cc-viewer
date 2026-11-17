---
"cc-viewer": patch
---

feat(web): add a copy-markdown button to concept-doc modal titles. Concept help popups (UltraPlan, Tools, CustomUltraplanExpert, etc.) and the system-text parameter-docs modal now show a small copy icon next to the title that writes the document's markdown source to the clipboard. Works over plain HTTP via the shared `copyTextToClipboard` helper.
