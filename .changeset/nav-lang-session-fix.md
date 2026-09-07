---
"cc-viewer": patch
---

fix(chat): User Prompt Nav — two fixes from issue #142. (1) Switching the UI language now refreshes the nav badges/title instead of staying in the previous language: the nav-build cache key (`_navCacheKey`) now includes `props.lang`, since the cached popover content holds already-translated strings. (2) A Plan/Ask card at the END of a session is now attributed to its own session (and shows its real time) instead of tipping the session divider into the next one: session attribution and the time label use the assistant bubble's `displayTs` (the producer request's ts), not the carrier `timestamp` (which is already the next session's first entry ts). Also hardens the tool-name lookup with `Object.hasOwn` so a `tool_use` block named `constructor`/`toString` can't produce a phantom nav entry. Coverage: `promptNav.test.js` (producer-session attribution across a boundary, carrier fallback, prototype-member guard).
