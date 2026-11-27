---
"cc-viewer": patch
---

feat(web): context compaction prompts on the first fresh above-threshold reading

The compaction reminder (confirm bubble, countdown, or automatic injection, depending on the rule's execution timing) now fires at the first turn-end check whose fresh usage reading exceeds a rule's threshold; the previous two-consecutive-readings debounce is removed. Freshness fingerprinting, hysteresis, post-injection cooldown, decline deferral, permanent ignore, and the failure circuit breaker are unchanged, as is the 960K forced compaction. The settings-modal hint (all 18 locales) and both READMEs are updated to match.

feat(web): compaction busy hint shown inline next to the confirm button

When the "Compact now" button is disabled because a turn is in flight, the reason ("Compaction is possible only after the current turn ends") now renders inline next to the button in the warning color instead of as a hover-only tooltip, so the affordance does not depend on the user hovering long enough to discover it.

feat(web): compaction bubble body explains why compaction matters

The bubble body no longer just states "rule triggered"; it now reads "rule triggered — context keeps growing, compacting now preserves response quality" in all 18 locales, so the user sees the reason to compact rather than a bare threshold hit.

Coverage: `context-compaction-i18n.test.js`.
